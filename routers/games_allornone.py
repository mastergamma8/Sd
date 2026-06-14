import time
import random
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import config
import database
from handlers.tg_gifts import is_real_tg_gift
from routers.gifts import _fetch_ton_to_stars_rate, _fetch_portal_floor_price_async
from handlers.security import get_current_user

router = APIRouter(prefix="/allornone", tags=["allornone"])

ALLORNONE_HOUSE_EDGE = 0.15      # 15% в пользу дома

# ── Кэш Portal Market цен (per gift, TTL=15 мин) ────────────────────────────
_portal_cache: dict[int, dict] = {}
_PORTAL_TTL = 900   # секунд


async def _get_gift_ton_price(gift_id: int, gift_name: str) -> float | None:
    """Portal Market floor_price с кэшем."""
    now = time.time()
    cached = _portal_cache.get(gift_id)
    if cached and (now - cached["ts"]) < _PORTAL_TTL:
        return cached["ton_price"]
    ton_price = await _fetch_portal_floor_price_async(gift_name)
    if ton_price and ton_price > 0:
        _portal_cache[gift_id] = {"ton_price": ton_price, "ts": now}
        return ton_price
    return None


def _fallback_stars(gift_id: int, ton_rate: float) -> int:
    """Запасной расчёт через donut-value из конфига."""
    gift_def = config.BASE_GIFTS.get(gift_id)
    if not gift_def:
        return 0
    return max(1, int(gift_def.get("value", 0) * config.DONUT_TO_TON_RATE * ton_rate))


async def _get_value_stars(gift_id: int, ton_rate: float) -> int:
    """Возвращает реальную рыночную ценность подарка в звёздах (Portal → fallback)."""
    gift_def = config.BASE_GIFTS.get(gift_id)
    if not gift_def:
        return 0
    ton_price = await _get_gift_ton_price(gift_id, gift_def.get("name", ""))
    if ton_price and ton_price > 0:
        return max(1, int(ton_price * ton_rate))
    return _fallback_stars(gift_id, ton_rate)


def _calc_cost(value_stars: int, chance: int) -> int:
    """cost = value * chance% / (1 - house_edge).  Минимум 1 звезда."""
    if not value_stars or not chance:
        return 1
    return max(1, int(value_stars * (chance / 100) / (1 - ALLORNONE_HOUSE_EDGE)))


class SpinAllOrNone(BaseModel):
    gift_id: int
    chance_percent: int   # 1–50
    is_demo: bool = False


@router.get("/gifts")
async def get_gifts_list(current_user: dict = Depends(get_current_user)):
    """Быстрый список подарков с приблизительной ценой (из конфига) для сетки."""
    ton_rate = await _fetch_ton_to_stars_rate()
    gifts = []
    for gift_id, gift in config.BASE_GIFTS.items():
        approx = _fallback_stars(gift_id, ton_rate)
        if approx < 1:
            continue
        gifts.append({
            "gift_id":      gift_id,
            "name":         gift["name"],
            "photo":        gift["photo"],
            "value_stars":  approx,   # приблизительно, уточняется через /price
        })
    gifts.sort(key=lambda g: g["value_stars"])
    return {"gifts": gifts}


@router.get("/price")
async def get_price(gift_id: int, chance_percent: int,
                    current_user: dict = Depends(get_current_user)):
    """
    Точная цена попытки через Portal Market.
    Вызывается один раз при выборе подарка; результат кэшируется в браузере.
    """
    chance    = max(1, min(50, chance_percent))
    gift_def  = config.BASE_GIFTS.get(gift_id)
    if not gift_def:
        raise HTTPException(status_code=400, detail="Неверный gift_id")

    ton_rate    = await _fetch_ton_to_stars_rate()
    value_stars = await _get_value_stars(gift_id, ton_rate)
    cost        = _calc_cost(value_stars, chance)

    return {
        "gift_id":     gift_id,
        "value_stars": value_stars,
        "chance":      chance,
        "cost":        cost,
    }


@router.post("/spin")
async def spin_allornone(data: SpinAllOrNone,
                         current_user: dict = Depends(get_current_user)):
    tg_id  = current_user["id"]
    chance = max(1, min(50, data.chance_percent))

    gift_def = config.BASE_GIFTS.get(data.gift_id)
    if not gift_def:
        raise HTTPException(status_code=400, detail="Неверный gift_id")

    ton_rate    = await _fetch_ton_to_stars_rate()
    value_stars = await _get_value_stars(data.gift_id, ton_rate)
    cost        = _calc_cost(value_stars, chance)

    # ── ДЕМО ────────────────────────────────────────────────────────────────
    if data.is_demo:
        won       = random.randint(1, 100) <= chance
        user_data = await database.get_user_data(tg_id)
        return {
            "status":     "ok",
            "demo":       True,
            "won":        won,
            "cost":       cost,
            "chance":     chance,
            "gift_id":    data.gift_id,
            "gift_name":  gift_def["name"],
            "gift_photo": gift_def["photo"],
            "stars":      user_data.get("stars", 0),
        }

    # ── РЕАЛЬНЫЙ СПИН ────────────────────────────────────────────────────────
    result = await database.deduct_and_deposit_atomic(
        user_id    = tg_id,
        gross_bet  = cost,
        house_edge = ALLORNONE_HOUSE_EDGE,
        asset_type = "stars",
    )
    if result is None:
        raise HTTPException(status_code=400, detail="Недостаточно звёзд")

    await database.add_history_entry(
        tg_id, "allornone_paid",
        f"«Всё или ничего» — подарок: {gift_def['name']} [gift_id:{data.gift_id}]", -cost,
    )

    won = random.randint(1, 100) <= chance

    if won:
        can_pay = await database.bank_payout(value_stars, asset_type="gift_value")
        if not can_pay:
            won = False

    if won:
        await database.add_gift_to_user(tg_id, data.gift_id, 1)
        is_tg = bool(is_real_tg_gift(data.gift_id))
        await database.add_history_entry(
            tg_id,
            "allornone_win_tg_gift" if is_tg else "allornone_win_gift",
            f"«Всё или ничего» — выигрыш: {gift_def['name']} [gift_id:{data.gift_id}]", 0,
        )

    updated_user, updated_gifts = await asyncio.gather(
        database.get_user_data(tg_id),
        database.get_user_gifts(tg_id),
    )

    return {
        "status":      "ok",
        "demo":        False,
        "won":         won,
        "cost":        cost,
        "chance":      chance,
        "gift_id":     data.gift_id,
        "gift_name":   gift_def["name"],
        "gift_photo":  gift_def["photo"],
        "stars":       updated_user.get("stars", 0),
        "user_gifts":  updated_gifts,
    }
