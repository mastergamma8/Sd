from fastapi import APIRouter, Depends, HTTPException
import time
import random
import asyncio

import config
import database
from handlers.tg_gifts import get_gift_def, get_gift_value, is_real_tg_gift
from handlers.models import SpinData
from handlers.security import get_current_user, check_channel_subscription
from utils.chance_engine import roll_with_pity, is_jackpot, COOLDOWN_START
from db import db_pity

router = APIRouter(prefix="/roulette", tags=["roulette"])

ROULETTE_HOUSE_EDGE = 0.15
ROULETTE_GAME_KEY   = "roulette"


def _get_item_value(item: dict) -> int:
    if item["type"] == "stars":
        return item.get("amount", 0)
    if item["type"] == "donuts":
        return item.get("amount", 0)
    if item["type"] == "gift":
        return get_gift_value(item.get("gift_id")) * config.DONUTS_TO_STARS_RATE
    return 0


def _roll_item(items: list) -> tuple[int, dict]:
    """Базовый взвешенный ролл без пити."""
    total_chance = sum(item.get("chance", 0) for item in items)
    if total_chance <= 0:
        total_chance = 100
    r = random.uniform(0, total_chance)
    cumulative = 0
    for i, item in enumerate(items):
        chance = item.get("chance", 0)
        if chance <= 0:
            continue
        cumulative += chance
        if r <= cumulative:
            return i, item
    return 0, items[0]


async def _roll_item_pity(items: list, currency: str, tg_id: int, cost: int) -> tuple[int, dict]:
    """Взвешенный ролл с системой пити и банковскими ограничениями."""
    bank_liquidity = await database.bank_get_max_payout()
    affordable     = [item for item in items if _get_item_value(item) <= bank_liquidity]
    if not affordable:
        cheapest = min(items, key=_get_item_value)
        return items.index(cheapest), cheapest

    pity_count, cooldown_count = await db_pity.get_pity(tg_id, ROULETTE_GAME_KEY)

    win_item = roll_with_pity(
        items          = affordable,
        get_value      = _get_item_value,
        cost           = cost,
        pity_count     = pity_count,
        cooldown_count = cooldown_count,
    )

    if is_jackpot(win_item, _get_item_value, cost):
        await db_pity.on_jackpot(tg_id, ROULETTE_GAME_KEY, cooldown_start=COOLDOWN_START)
    else:
        await db_pity.on_no_jackpot(tg_id, ROULETTE_GAME_KEY)

    real_idx = items.index(win_item) if win_item in items else 0
    return real_idx, win_item


@router.get("/info")
async def get_roulette_info(current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]
    now   = int(time.time())

    # Параллельно: состояние пользователя + пити-счётчики (было 2 последовательных)
    (user_data, (pity_count, cooldown_count)) = await asyncio.gather(
        database.get_user_data(tg_id),
        db_pity.get_pity(tg_id, ROULETTE_GAME_KEY),
    )

    last_spin = user_data.get("last_free_spin", 0)
    can_free  = (now - last_spin) >= 86400

    return {
        "status":         "ok",
        "can_free":       can_free,
        "cost":           config.ROULETTE_CONFIG["cost"],
        "currency":       config.ROULETTE_CONFIG.get("currency", "donuts"),
        "items":          config.ROULETTE_CONFIG["items"],
        "time_left":      86400 - (now - last_spin) if not can_free else 0,
        "pity_count":     pity_count,
        "cooldown_count": cooldown_count,
    }


@router.post("/spin")
async def spin_roulette(data: SpinData, current_user: dict = Depends(get_current_user)):
    tg_id    = current_user["id"]

    if not await check_channel_subscription(tg_id):
        return {"status": "error", "detail": "not_subscribed"}

    now      = int(time.time())
    currency = config.ROULETTE_CONFIG.get("currency", "donuts")
    cost     = config.ROULETTE_CONFIG["cost"]

    # ── 1. Атомарная проверка бесплатного спина ───────────────────────────────
    # claim_free_spin_atomic проверяет кулдаун через WHERE-условие в БД,
    # поэтому предварительный get_user_data здесь избыточен и убран.
    can_free = await database.claim_free_spin_atomic(tg_id, now)

    # ── 2. Платный спин: списание стоимости ───────────────────────────────────
    if not can_free:
        result = await database.deduct_and_deposit_atomic(
            user_id    = tg_id,
            gross_bet  = cost,
            house_edge = ROULETTE_HOUSE_EDGE,
            asset_type = currency,
        )
        if result is None:
            raise HTTPException(
                status_code=400,
                detail=f"Недостаточно {'звезд' if currency == 'stars' else 'пончиков'} для прокрутки",
            )
        await database.add_history_entry(
            tg_id, f"roulette_paid_{currency}",
            f"Платная прокрутка рулетки (-{cost} {currency})", -cost,
        )

    items     = config.ROULETTE_CONFIG["items"]
    spin_type = "Бесплатная прокрутка рулетки" if can_free else "Прокрутка рулетки"

    # ── 3. Выбор победителя ───────────────────────────────────────────────────
    if can_free:
        win_index = next(
            (i for i, item in enumerate(items)
             if item.get("type") == "stars" and item.get("amount") == 1),
            0,
        )
        win_item = items[win_index]
    else:
        win_index, win_item = await _roll_item_pity(items, currency, tg_id, cost)

    # ── 4. Начисление приза ───────────────────────────────────────────────────
    # Единый путь выполнения без ранних return — get_user_data вызывается
    # ровно один раз в блоке #5, независимо от ветки фолбэка.

    if win_item["type"] == "donuts":
        prize_value = win_item["amount"]
        if not can_free:
            paid = await database.bank_payout(prize_value, asset_type="donuts")
            if not paid:
                fallback  = next(
                    (i for i in items if i.get("type") == "stars" and i.get("amount") == 1),
                    items[0],
                )
                win_item  = fallback
                win_index = items.index(fallback)
                await database.add_stars_to_user(tg_id, 1)
                await database.add_history_entry(
                    tg_id, "roulette_win_stars",
                    f"{spin_type} — fallback (банк пуст)", 1,
                )
            else:
                await database.add_points_to_user(tg_id, prize_value)
                await database.add_history_entry(
                    tg_id, "roulette_win_donuts",
                    f"{spin_type} — выиграно пончиков", prize_value,
                )
        else:
            await database.add_points_to_user(tg_id, prize_value)
            await database.add_history_entry(
                tg_id, "roulette_win_donuts",
                f"{spin_type} — выиграно пончиков", prize_value,
            )

    elif win_item["type"] == "stars":
        prize_value = win_item["amount"]
        if not can_free:
            paid = await database.bank_payout(prize_value, asset_type="stars")
            if not paid:
                fallback    = min(items, key=_get_item_value)
                win_item    = fallback
                win_index   = items.index(fallback)
                prize_value = max(_get_item_value(fallback), 1)
                await database.add_stars_to_user(tg_id, prize_value)
                await database.add_history_entry(
                    tg_id, "roulette_win_stars",
                    f"{spin_type} — fallback (банк пуст)", prize_value,
                )
            else:
                await database.add_stars_to_user(tg_id, prize_value)
                await database.add_history_entry(
                    tg_id, "roulette_win_stars",
                    f"{spin_type} — выиграно звезд", prize_value,
                )
        else:
            await database.add_stars_to_user(tg_id, prize_value)
            await database.add_history_entry(
                tg_id, "roulette_win_stars",
                f"{spin_type} — выиграно звезд", prize_value,
            )

    elif win_item["type"] == "gift":
        gift_id          = win_item["gift_id"]
        gift_def         = get_gift_def(gift_id)
        gift_name        = gift_def["name"] if gift_def else "Подарок"
        gift_value       = get_gift_value(gift_id)
        awarded_fallback = False

        if not can_free and gift_value > 0:
            paid = await database.bank_payout(gift_value, asset_type="gift_value")
            if not paid:
                fallback_items = [i for i in items if i["type"] != "gift"]
                if fallback_items:
                    _, win_item = _roll_item(fallback_items)
                    win_index   = items.index(win_item)
                    ptype       = win_item["type"]
                    fv          = win_item["amount"]
                    if ptype == "stars":
                        await database.add_stars_to_user(tg_id, fv)
                    else:
                        await database.add_points_to_user(tg_id, fv)
                    await database.add_history_entry(
                        tg_id, f"roulette_win_{ptype}",
                        f"{spin_type} — замена подарка (банк пуст)", fv,
                    )
                    awarded_fallback = True

        if not awarded_fallback:
            await database.add_gift_to_user(tg_id, gift_id, 1)
            is_tg = bool(gift_def and is_real_tg_gift(gift_id))
            await database.add_history_entry(
                tg_id,
                "roulette_win_tg_gift" if is_tg else "roulette_win_gift",
                f"{spin_type} — {'Telegram gift won' if is_tg else 'выигран подарок'}: "
                f"{gift_name} [gift_id:{gift_id}]",
                0,
            )

    # ── 5. Единственный финальный fetch состояния (параллельно) ──────────────
    updated_user, updated_gifts = await asyncio.gather(
        database.get_user_data(tg_id),
        database.get_user_gifts(tg_id),
    )
    return _build_spin_response(win_index, win_item, updated_user, updated_gifts)


def _build_spin_response(win_index, win_item, updated_user, updated_gifts):
    return {
        "status":       "ok",
        "win_index":    win_index,
        "win_item":     win_item,
        "balance":      updated_user["balance"],
        "stars":        updated_user["stars"],
        "user_gifts":   updated_gifts,
        "can_free_now": False,
        "currency":     config.ROULETTE_CONFIG.get("currency", "donuts"),
    }
