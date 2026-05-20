from fastapi import APIRouter, Depends, HTTPException
import random
import time

import config
import database
from handlers.tg_gifts import get_gift_def, get_gift_value, is_real_tg_gift
from handlers.models import ActionData
from handlers.security import get_current_user, check_channel_subscription
from utils.chance_engine import roll_with_pity, is_jackpot, COOLDOWN_START
from db import db_pity

router = APIRouter(prefix="/cases", tags=["cases"])

FREE_CASE_COOLDOWN = 86400  # 24 часа
CASE_HOUSE_EDGE    = 0.15


# ─── Вспомогательные функции ──────────────────────────────────────────────────

def _get_item_value_stars(item: dict) -> int:
    rate = config.DONUTS_TO_STARS_RATE

    if item["type"] == "stars":
        return item.get("amount", 0)

    if item["type"] == "donuts":
        return item.get("amount", 0) * rate

    if item["type"] == "gift":
        return get_gift_value(item.get("gift_id")) * rate

    return 0


# Оставляем старую функцию как алиас для обратной совместимости
def _get_item_value(item: dict) -> int:
    return _get_item_value_stars(item)


def _roll_item(items: list) -> dict:
    """Базовый взвешенный ролл без пити (для бесплатного кейса)."""
    total_chance = sum(item.get("chance", 0) for item in items)
    if total_chance <= 0:
        total_chance = 100
    r = random.uniform(0, total_chance)
    cumulative = 0
    for item in items:
        chance = item.get("chance", 0)
        if chance <= 0:
            continue
        cumulative += chance
        if r <= cumulative:
            return item
    return items[0]


async def _roll_item_pity(items: list, currency: str, tg_id: int, case_id, price: int) -> dict:
    """
    Взвешенный ролл с системой пити и банковскими ограничениями.

    1. Получаем счётчики пити/кулдауна из БД.
    2. Фильтруем предметы, недоступные банку.
    3. Роллим через chance_engine.roll_with_pity.
    4. Обновляем счётчики в зависимости от результата.
    """
    game_key = f"case_{case_id}"

    # ── Банковский фильтр ────────────────────────────────────────────────────
    if currency == "stars":
        bank_balance = await database.bank_get_max_payout()
        affordable   = [i for i in items if _get_item_value_stars(i) <= bank_balance]
        if not affordable:
            return min(items, key=lambda i: _get_item_value_stars(i))
    else:
        affordable = items

    # ── Пити ─────────────────────────────────────────────────────────────────
    pity_count, cooldown_count = await db_pity.get_pity(tg_id, game_key)

    win_item = roll_with_pity(
        items          = affordable,
        get_value      = _get_item_value_stars,
        cost           = price,
        pity_count     = pity_count,
        cooldown_count = cooldown_count,
    )

    # ── Обновляем счётчики ────────────────────────────────────────────────────
    if is_jackpot(win_item, _get_item_value_stars, price):
        await db_pity.on_jackpot(tg_id, game_key, cooldown_start=COOLDOWN_START)
    else:
        await db_pity.on_no_jackpot(tg_id, game_key)

    return win_item


async def _apply_win(tg_id: int, win_item: dict, case: dict, price: int, case_id: int = 0):
    case_tag = f" [case_id:{case_id}]" if case_id else ""

    if win_item["type"] == "donuts":
        await database.add_points_to_user(tg_id, win_item["amount"])
        await database.add_history_entry(tg_id, "case_win_donuts",
            f"Case '{case['name']}' — donuts won{case_tag}", win_item["amount"])
        await database.add_history_entry(
            tg_id, "case_lucky_ratio",
            f"Case '{case['name']}' — luck ratio{case_tag}",
            round(win_item["amount"] / max(price, 1) * 100)
        )

    elif win_item["type"] == "stars":
        await database.add_stars_to_user(tg_id, win_item["amount"])
        await database.add_history_entry(tg_id, "case_win_stars",
            f"Case '{case['name']}' — stars won{case_tag}", win_item["amount"])
        await database.add_history_entry(
            tg_id, "case_lucky_ratio",
            f"Case '{case['name']}' — luck ratio{case_tag}",
            round(win_item["amount"] / max(price, 1) * 100)
        )

    elif win_item["type"] == "gift":
        gift_id  = win_item["gift_id"]
        gift_def = get_gift_def(gift_id)
        gift_name  = gift_def["name"] if gift_def else "Gift"
        gift_value = get_gift_value(gift_id)

        await database.add_gift_to_user(tg_id, gift_id, 1)
        if gift_def and is_real_tg_gift(gift_id):
            await database.add_history_entry(tg_id, "case_win_tg_gift",
                f"Case '{case['name']}' — Telegram gift won: {gift_name} [gift_id:{gift_id}]{case_tag}", 0)
        else:
            await database.add_history_entry(tg_id, "case_win_gift",
                f"Case '{case['name']}' — gift won: {gift_name} [gift_id:{gift_id}]{case_tag}", 0)

        if gift_value > 0 and price > 0:
            await database.add_history_entry(
                tg_id, "case_lucky_ratio",
                f"Case '{case['name']}' — luck ratio (gift){case_tag}",
                round(gift_value / price * 100)
            )


# ─── Платный кейс ─────────────────────────────────────────────────────────────

@router.post("/open")
async def open_case(data: ActionData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    if not await check_channel_subscription(tg_id):
        return {"status": "error", "detail": "not_subscribed"}

    case_id = data.gift_id

    if case_id not in config.CASES_CONFIG:
        raise HTTPException(status_code=400, detail="Case not found")

    case     = config.CASES_CONFIG[case_id]
    currency = case.get("currency", "donuts")
    price    = case["price"]

    result = await database.deduct_and_deposit_atomic(
        user_id   = tg_id,
        gross_bet = price,
        house_edge = CASE_HOUSE_EDGE,
        asset_type = currency,
    )
    if result is None:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough {'stars' if currency == 'stars' else 'donuts'} to open this case",
        )

    await database.add_history_entry(tg_id, f"case_paid_{currency}",
        f"Case opened: '{case['name']}' [case_id:{case_id}]", -price)

    # ── Ролл с пити ───────────────────────────────────────────────────────────
    win_item  = await _roll_item_pity(case["items"], currency, tg_id, case_id, price)
    win_value = _get_item_value_stars(win_item)

    if win_value > 0:
        if win_item["type"] == "gift":
            payout_type   = "gift_value"
            payout_amount = _get_item_value_stars(win_item)
        else:
            payout_type   = win_item["type"]
            payout_amount = win_item.get("amount", 0)

        paid = await database.bank_payout(payout_amount, asset_type=payout_type)
        if not paid:
            bank_max         = await database.bank_get_max_payout(asset_type=currency)
            affordable_items = [i for i in case["items"] if _get_item_value_stars(i) <= bank_max]

            if affordable_items:
                win_item  = min(affordable_items, key=lambda i: _get_item_value_stars(i))
                win_value = _get_item_value_stars(win_item)
                if win_item["type"] == "gift":
                    fallback_payout_type   = "gift_value"
                    fallback_payout_amount = win_value
                else:
                    fallback_payout_type   = win_item["type"]
                    fallback_payout_amount = win_item.get("amount", 0)
                if win_value > 0:
                    fallback_paid = await database.bank_payout(fallback_payout_amount, asset_type=fallback_payout_type)
                    if not fallback_paid:
                        await database.add_history_entry(
                            tg_id, "case_bank_empty",
                            f"Case '{case['name']}' — банк исчерпан, приз не выдан", 0
                        )
                        updated_user  = await database.get_user_data(tg_id)
                        updated_gifts = await database.get_user_gifts(tg_id)
                        return {
                            "status":     "bank_empty",
                            "win_item":   None,
                            "balance":    updated_user["balance"],
                            "stars":      updated_user["stars"],
                            "user_gifts": updated_gifts,
                        }
            else:
                await database.add_history_entry(
                    tg_id, "case_bank_empty",
                    f"Case '{case['name']}' — банк исчерпан, приз не выдан", 0
                )
                updated_user  = await database.get_user_data(tg_id)
                updated_gifts = await database.get_user_gifts(tg_id)
                return {
                    "status":     "bank_empty",
                    "win_item":   None,
                    "balance":    updated_user["balance"],
                    "stars":      updated_user["stars"],
                    "user_gifts": updated_gifts,
                }

    await _apply_win(tg_id, win_item, case, price, case_id=case_id)

    updated_user  = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)

    return {
        "status":     "ok",
        "win_item":   win_item,
        "balance":    updated_user["balance"],
        "stars":      updated_user["stars"],
        "user_gifts": updated_gifts,
    }


@router.post("/open_promo")
async def open_promo_case(data: ActionData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    if not await check_channel_subscription(tg_id):
        return {"status": "error", "detail": "not_subscribed"}

    case_id = data.gift_id

    if case_id not in config.CASES_CONFIG:
        raise HTTPException(status_code=400, detail="Case not found")

    consumed = await database.consume_user_promo_case(tg_id, case_id)
    if not consumed:
        raise HTTPException(status_code=400, detail="У вас нет бесплатного открытия для этого кейса")

    case     = config.CASES_CONFIG[case_id]
    currency = case.get("currency", "donuts")

    await database.add_history_entry(
        tg_id, "case_promo_open",
        f"Promo case opened: '{case['name']}' [case_id:{case_id}]", 0,
    )

    # Промо-кейс тоже участвует в пити: игроку интересно получить хорошие вещи
    win_item  = await _roll_item_pity(case["items"], currency, tg_id, case_id, case["price"])
    win_value = _get_item_value_stars(win_item)

    if win_value > 0:
        if win_item["type"] == "gift":
            payout_type   = "gift_value"
            payout_amount = _get_item_value_stars(win_item)
        else:
            payout_type   = win_item["type"]
            payout_amount = win_item.get("amount", 0)

        paid = await database.bank_payout(payout_amount, asset_type=payout_type)
        if not paid:
            bank_max         = await database.bank_get_max_payout(asset_type=currency)
            affordable_items = [i for i in case["items"] if _get_item_value_stars(i) <= bank_max]

            if affordable_items:
                win_item  = min(affordable_items, key=lambda i: _get_item_value_stars(i))
                win_value = _get_item_value_stars(win_item)
                if win_item["type"] == "gift":
                    fallback_payout_type   = "gift_value"
                    fallback_payout_amount = win_value
                else:
                    fallback_payout_type   = win_item["type"]
                    fallback_payout_amount = win_item.get("amount", 0)
                if win_value > 0:
                    fallback_paid = await database.bank_payout(fallback_payout_amount, asset_type=fallback_payout_type)
                    if not fallback_paid:
                        await database.add_history_entry(
                            tg_id, "case_bank_empty",
                            f"Promo case '{case['name']}' — bank exhausted, prize not issued", 0
                        )
                        updated_user  = await database.get_user_data(tg_id)
                        updated_gifts = await database.get_user_gifts(tg_id)
                        promo_cases   = await database.get_user_promo_cases(tg_id)
                        return {
                            "status": "bank_empty", "win_item": None,
                            "balance": updated_user["balance"], "stars": updated_user["stars"],
                            "user_gifts": updated_gifts,
                            "promo_case_credits": {str(k): v for k, v in promo_cases.items()},
                        }
            else:
                await database.add_history_entry(
                    tg_id, "case_bank_empty",
                    f"Promo case '{case['name']}' — bank exhausted, prize not issued", 0
                )
                updated_user  = await database.get_user_data(tg_id)
                updated_gifts = await database.get_user_gifts(tg_id)
                promo_cases   = await database.get_user_promo_cases(tg_id)
                return {
                    "status": "bank_empty", "win_item": None,
                    "balance": updated_user["balance"], "stars": updated_user["stars"],
                    "user_gifts": updated_gifts,
                    "promo_case_credits": {str(k): v for k, v in promo_cases.items()},
                }

    await _apply_win(tg_id, win_item, case, 0, case_id=f"promo:{case_id}")

    updated_user  = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)
    promo_cases   = await database.get_user_promo_cases(tg_id)

    return {
        "status": "ok",
        "win_item": win_item,
        "balance": updated_user["balance"],
        "stars": updated_user["stars"],
        "user_gifts": updated_gifts,
        "promo_case_credits": {str(k): v for k, v in promo_cases.items()},
    }


# ─── Бесплатный кейс (раз в 24 ч) ────────────────────────────────────────────
# Бесплатный кейс НЕ участвует в системе пити: он не должен давать джекпоты,
# чтобы не обесценивать платные кейсы.

@router.get("/free_status")
async def free_case_status(current_user: dict = Depends(get_current_user)):
    tg_id     = current_user["id"]
    last      = await database.get_last_free_case(tg_id)
    now       = int(time.time())
    remaining = max(0, FREE_CASE_COOLDOWN - (now - last))
    return {"remaining_seconds": remaining, "available": remaining == 0}


@router.post("/open_free")
async def open_free_case(current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    if not await check_channel_subscription(tg_id):
        return {"status": "error", "detail": "not_subscribed"}

    if not hasattr(config, "FREE_CASE_CONFIG"):
        raise HTTPException(status_code=503, detail="Free case is not configured")

    now  = int(time.time())

    # Сначала проверяем кулдаун для красивого сообщения (без атомарности — только UI).
    last      = await database.get_last_free_case(tg_id)
    remaining = FREE_CASE_COOLDOWN - (now - last)
    if remaining > 0:
        hours   = remaining // 3600
        minutes = (remaining % 3600) // 60
        raise HTTPException(
            status_code=429,
            detail=f"Free case available in {hours}h {minutes}m",
        )

    case     = config.FREE_CASE_CONFIG
    win_item = _roll_item(case["items"])  # без пити для бесплатного кейса

    # Атомарный UPDATE с WHERE-условием на кулдаун.
    # Если два запроса пришли одновременно — только один получит rowcount=1.
    claimed = await database.claim_free_case_atomic(tg_id, now, FREE_CASE_COOLDOWN)
    if not claimed:
        raise HTTPException(status_code=429, detail="Free case cooldown not elapsed")
    await database.add_history_entry(tg_id, "case_free_open",
        f"Free case opened: '{case['name']}' [case_id:free]", 0)
    await _apply_win(tg_id, win_item, case, price=0, case_id="free")

    updated_user  = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)

    return {
        "status":       "ok",
        "win_item":     win_item,
        "balance":      updated_user["balance"],
        "stars":        updated_user["stars"],
        "user_gifts":   updated_gifts,
        "next_free_in": FREE_CASE_COOLDOWN,
    }
