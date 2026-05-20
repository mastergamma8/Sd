"""
routers/bank.py — Административный роутер для управления Глобальным Банком.

Все эндпоинты требуют авторизации через Telegram InitData.
Эндпоинты с финансовой статистикой и топап доступны только администратору.
"""
from fastapi import APIRouter, Depends, HTTPException

import config
import database
from handlers.models import AdminBankTopup
from handlers.security import get_current_user

router = APIRouter(prefix="/bank", tags=["bank"])


def _safe_rtp(paid_out: int, deposited: int) -> float:
    if deposited <= 0:
        return 0.0
    return round(paid_out / deposited * 100, 2)


def _require_admin(current_user: dict) -> None:
    """Проверяет, что текущий пользователь — администратор. Бросает 403 иначе."""
    if current_user["id"] != config.ADMIN_ID:
        raise HTTPException(status_code=403, detail="Доступ запрещён")

# ── Административная статистика банка ────────────────────────────────────────

@router.get("/status")
async def bank_status(current_user: dict = Depends(get_current_user)):
    _require_admin(current_user)
    bank     = await database.get_bank()
    day      = await database.get_bank_day_stats()
    earnings = await database.get_bank_earnings_summary()
    rate     = config.DONUTS_TO_STARS_RATE

    stars_bal  = bank.get("stars_balance", 0)
    donuts_bal = bank.get("donuts_balance", 0)
    gift_bal   = bank.get("gift_value_balance", 0)
    total_liq  = stars_bal + donuts_bal * rate + gift_bal

    stars_dep   = bank.get("stars_deposited", 0)
    stars_paid  = bank.get("stars_paid_out", 0)
    donuts_dep  = bank.get("donuts_deposited", 0)
    donuts_paid = bank.get("donuts_paid_out", 0)
    gift_paid   = bank.get("gift_value_paid_out", 0)

    return {
        "exchange_rate": {
            "donuts_to_stars": rate,
            "note": f"1 donut = {rate} stars (bank value)",
        },
        "liquidity": {
            "stars":           stars_bal,
            "donuts":          donuts_bal,
            "donuts_in_stars": donuts_bal * rate,
            "gift_value":      gift_bal,
            "total_in_stars":  total_liq,
        },
        "today": {
            "date":             day["day_date"],
            "games_count":      day["games_count"],
            "deposited_value":  day["deposited_value"],
            "paid_out_value":   day["paid_out_value"],
            "house_edge_value": day["house_edge_value"],
            "rtp_percent":      _safe_rtp(day["paid_out_value"], day["deposited_value"]),
            "stars_deposited":  day["stars_deposited"],
            "stars_paid_out":   day["stars_paid_out"],
            "donuts_deposited":      day["donuts_deposited"],
            "donuts_paid_out":       day["donuts_paid_out"],
            "gift_value_deposited":  day.get("gift_value_deposited", 0),
            "gift_value_paid_out":   day.get("gift_value_paid_out", 0),
        },
        "total": {
            "games_count": earnings["games_count"],
            "deposited":   earnings["gross_deposited"],
            "paid_out":    earnings["total_paid_out"],
            "house_edge":  earnings["house_edge"],
            "rtp_percent": earnings["rtp_percent"],
        },
        "stars": {
            "deposited":   stars_dep,
            "paid_out":    stars_paid,
            "rtp_percent": _safe_rtp(stars_paid, stars_dep),
        },
        "donuts": {
            "deposited":   donuts_dep,
            "paid_out":    donuts_paid,
            "rtp_percent": _safe_rtp(donuts_paid, donuts_dep),
        },
        "gifts": {
            "value_paid_out": gift_paid,
        },
    }


# ── Статистика за конкретный день ─────────────────────────────────────────────

@router.get("/day")
async def bank_day_stats(day: str = None, current_user: dict = Depends(get_current_user)):
    """
    Статистика банка за один день (только администратор).
    Параметр day: YYYY-MM-DD. По умолчанию — сегодня (UTC).
    """
    _require_admin(current_user)
    from datetime import datetime
    if day is not None:
        try:
            datetime.strptime(day, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="Формат даты: YYYY-MM-DD")

    stats = await database.get_bank_day_stats(day)
    stats["rtp_percent"] = _safe_rtp(stats["paid_out_value"], stats["deposited_value"])
    return stats


# ── История за последние N дней ───────────────────────────────────────────────

@router.get("/history")
async def bank_day_history(days: int = 7, current_user: dict = Depends(get_current_user)):
    """Возвращает статистику за последние N дней (max 90). Только администратор."""
    _require_admin(current_user)
    if days < 1 or days > 90:
        raise HTTPException(status_code=400, detail="days должен быть от 1 до 90")
    rows = await database.get_bank_day_history(days)
    for r in rows:
        r["rtp_percent"] = _safe_rtp(r["paid_out_value"], r["deposited_value"])
    return rows


# ── Топ активных игроков сегодня ──────────────────────────────────────────────

@router.get("/top-active")
async def bank_top_active(limit: int = 3, current_user: dict = Depends(get_current_user)):
    """Топ самых активных игроков за сегодня (по количеству игр). Только администратор."""
    _require_admin(current_user)
    if limit < 1 or limit > 20:
        raise HTTPException(status_code=400, detail="limit должен быть от 1 до 20")
    return await database.get_top_active_today(limit)


# ── Администраторский топап ───────────────────────────────────────────────────

@router.post("/topup")
async def bank_topup(data: AdminBankTopup, current_user: dict = Depends(get_current_user)):
    """
    Пополнение банка администратором.
    Проверка прав — по серверному current_user["id"], не по данным из тела.
    """
    if current_user["id"] != config.ADMIN_ID:
        raise HTTPException(status_code=403, detail="Доступ запрещён")

    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Сумма должна быть > 0")
    if data.asset_type not in ("stars", "donuts"):
        raise HTTPException(status_code=400, detail="asset_type: 'stars' или 'donuts'")

    if data.asset_type == "donuts":
        await database.bank_add_donuts(data.amount)
    else:
        await database.bank_add_stars(data.amount)

    bank  = await database.get_bank()
    rate  = config.DONUTS_TO_STARS_RATE
    total_liq = (
        bank.get("stars_balance", 0)
        + bank.get("donuts_balance", 0) * rate
        + bank.get("gift_value_balance", 0)
    )
    return {
        "status":             "ok",
        "asset_type":         data.asset_type,
        "added":              data.amount,
        "new_stars_balance":  bank.get("stars_balance", 0),
        "new_donuts_balance": bank.get("donuts_balance", 0),
        "total_liquidity":    total_liq,
    }
