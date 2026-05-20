# routers/games_rocket.py
# =====================================================
# РАКЕТА (CRASH) — ОБЩИЙ РАУНД ДЛЯ ВСЕХ ИГРОКОВ
# =====================================================

import asyncio
import math
import random
import time
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import config
import database
from handlers.security import get_current_user

router = APIRouter(prefix="/rocket", tags=["rocket"])

# ─────────────────────────────────────────────────────────────
# ПАРАМЕТРЫ
# ─────────────────────────────────────────────────────────────

WAITING_DURATION   = 12.0
COUNTDOWN_DURATION =  3.0
CRASH_SHOW_DURATION =  4.0

HOUSE_EDGE   = config.ROCKET_CONFIG.get("house_edge", 0.13)
GROWTH_SPEED = config.ROCKET_CONFIG.get("growth_speed", 1.00006)
MAX_MULT     = config.ROCKET_CONFIG.get("max_multiplier", 100.0)
CURRENCY     = config.ROCKET_CONFIG.get("currency", "stars")

# ─────────────────────────────────────────────────────────────
# ГЛОБАЛЬНОЕ СОСТОЯНИЕ
# ─────────────────────────────────────────────────────────────

_lock = asyncio.Lock()

rocket_round: Dict[str, Any] = {
    "id":          0,
    "state":       "waiting",
    "crash_point": 0.0,
    "start_time":  0.0,
    "phase_end":   0.0,
    "bets":        {},
    "_processing": set(),
}


# ─────────────────────────────────────────────────────────────
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ─────────────────────────────────────────────────────────────

def _calc_mult() -> float:
    if rocket_round["state"] != "flying":
        return 1.0
    elapsed_ms = max(0.0, (time.time() - rocket_round["start_time"]) * 1000)
    return round(pow(GROWTH_SPEED, elapsed_ms), 4)


async def _generate_crash_point(total_bet: int = 0) -> float:
    """
    Генерирует краш-поинт с учётом ликвидности банка.
    Если банк не может покрыть потенциальную выплату — краш-поинт
    ограничивается значением bank_balance / total_bet (как в оригинале).
    """
    r = random.uniform(0, 1)
    if r < HOUSE_EDGE:
        raw_crash = 1.0
    else:
        raw_crash = round(0.95 / (1.0 - r), 2)
        raw_crash = min(raw_crash, MAX_MULT)

    # Проверяем ликвидность банка (как в оригинальном generate_crash_point)
    if total_bet > 0:
        bank_balance = await database.bank_get_max_payout(asset_type=CURRENCY)
        if bank_balance <= 0:
            return 1.0
        max_allowed = round(bank_balance / total_bet, 2)
        if max_allowed < 1.0:
            return 1.0
        raw_crash = min(raw_crash, max_allowed)

    return raw_crash


async def _deduct_and_deposit(user_id: int, bet: int, currency: str) -> bool:
    """
    Атомарно (в одной транзакции BEGIN IMMEDIATE) списывает ставку с баланса
    игрока и зачисляет pool_amount в банк вместе с house_edge и дневной статистикой.

    Использует database.deduct_and_deposit_atomic — единственный правильный путь,
    гарантирующий отсутствие рассинхронизации даже при падении сервера между шагами.
    При недостатке средств возвращает False без каких-либо изменений в БД.
    """
    result = await database.deduct_and_deposit_atomic(
        user_id=user_id,
        gross_bet=bet,
        house_edge=HOUSE_EDGE,
        asset_type=currency,
    )
    return result is not None


async def _do_cashout(user_id: int, bet_data: dict, mult: float):
    bet         = bet_data["bet"]
    currency    = bet_data["currency"]
    crash_point = rocket_round.get("crash_point", mult)
    actual_mult = round(min(mult, crash_point), 4)
    win_amount  = int(bet * actual_mult)
    profit      = win_amount - bet

    try:
        if profit > 0:
            paid = await database.bank_payout(profit, asset_type=currency)
            if not paid:
                async with _lock:
                    if user_id in rocket_round["bets"]:
                        rocket_round["bets"][user_id]["status"] = "crashed"
                    rocket_round["_processing"].discard(user_id)
                return

        if currency == "stars":
            await database.add_stars_to_user(user_id, win_amount)
        else:
            await database.add_points_to_user(user_id, win_amount)

        await database.add_history_entry(
            user_id, f"rocket_win_{currency}",
            f"Ракета (x{actual_mult:.2f})", profit,
        )

        async with _lock:
            if user_id in rocket_round["bets"]:
                rocket_round["bets"][user_id]["status"]       = "cashed_out"
                rocket_round["bets"][user_id]["cashout_mult"] = actual_mult
            rocket_round["_processing"].discard(user_id)

    except Exception:
        async with _lock:
            rocket_round["_processing"].discard(user_id)


async def _process_auto_cashouts(current_mult: float):
    to_process = []
    async with _lock:
        for uid, bet in rocket_round["bets"].items():
            if (
                bet["status"] == "active"
                and bet["auto_cashout"] > 1.0
                and current_mult >= bet["auto_cashout"]
                and uid not in rocket_round["_processing"]
            ):
                rocket_round["_processing"].add(uid)
                to_process.append((uid, bet.copy(), bet["auto_cashout"]))

    for uid, bet_data, mult in to_process:
        asyncio.create_task(_do_cashout(uid, bet_data, mult))


# ─────────────────────────────────────────────────────────────
# ФОНОВАЯ ЗАДАЧА — МЕНЕДЖЕР РАУНДОВ
# ─────────────────────────────────────────────────────────────

async def round_manager():
    global rocket_round
    # ── Восстанавливаем round_id из БД после деплоя ──────────────────────────
    try:
        saved_id = await database.load_rocket_round_id()
        if saved_id > 0:
            rocket_round["id"] = saved_id
            print(f"[Rocket] Restored round_id from DB: {saved_id}")
    except Exception as e:
        print(f"[Rocket] Failed to restore round_id: {e}")

    while True:
        try:
            # ЖДЁМ СТАВКИ
            async with _lock:
                rocket_round["id"]          += 1
                rocket_round["state"]        = "waiting"
                rocket_round["crash_point"]  = 0.0
                rocket_round["start_time"]   = 0.0
                rocket_round["phase_end"]    = time.time() + WAITING_DURATION
                rocket_round["bets"]         = {}
                rocket_round["_processing"]  = set()
                _current_round_id = rocket_round["id"]

            # Сохраняем новый round_id в БД асинхронно
            asyncio.create_task(database.save_rocket_round_id(_current_round_id))

            await asyncio.sleep(WAITING_DURATION)

            # ОБРАТНЫЙ ОТСЧЁТ
            async with _lock:
                total_bet = sum(b["bet"] for b in rocket_round["bets"].values())

            crash_point = await _generate_crash_point(total_bet)
            async with _lock:
                rocket_round["state"]       = "countdown"
                rocket_round["crash_point"] = crash_point
                rocket_round["phase_end"]   = time.time() + COUNTDOWN_DURATION

            await asyncio.sleep(COUNTDOWN_DURATION)

            # ПОЛЁТ
            async with _lock:
                rocket_round["state"]      = "flying"
                rocket_round["start_time"] = time.time()
                rocket_round["phase_end"]  = 0.0

            crash_time = (math.log(crash_point) / math.log(GROWTH_SPEED)) / 1000.0
            elapsed    = 0.0
            interval   = 0.1

            while elapsed < crash_time:
                await asyncio.sleep(interval)
                elapsed += interval
                await _process_auto_cashouts(_calc_mult())

            # КРАШ
            async with _lock:
                rocket_round["state"]     = "crashed"
                rocket_round["phase_end"] = time.time() + CRASH_SHOW_DURATION
                crashed_users = []
                for uid, bet in rocket_round["bets"].items():
                    if bet["status"] == "active":
                        bet["status"] = "crashed"
                        crashed_users.append((uid, bet.copy()))

            for uid, bet in crashed_users:
                try:
                    await database.add_history_entry(
                        uid, f"rocket_lose_{bet['currency']}",
                        f"Ракета улетела на x{crash_point:.2f} (ставка: {bet['bet']})",
                        -bet["bet"],
                    )
                except Exception:
                    pass

            await asyncio.sleep(CRASH_SHOW_DURATION)

        except asyncio.CancelledError:
            break
        except Exception:
            await asyncio.sleep(2.0)


# ─────────────────────────────────────────────────────────────
# ЭНДПОИНТЫ API
# ─────────────────────────────────────────────────────────────

@router.get("/state")
async def get_state(current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    async with _lock:
        state       = rocket_round["state"]
        round_id    = rocket_round["id"]
        phase_end   = rocket_round["phase_end"]
        crash_point = rocket_round["crash_point"]

        mult      = _calc_mult() if state == "flying" else 1.0
        time_left = round(max(0.0, phase_end - time.time()), 2) if phase_end > 0 else 0.0

        my_raw = rocket_round["bets"].get(tg_id)
        my_bet = {
            "bet":          my_raw["bet"],
            "currency":     my_raw["currency"],
            "status":       my_raw["status"],
            "cashout_mult": my_raw.get("cashout_mult"),
            "auto_cashout": my_raw.get("auto_cashout", 0),
        } if my_raw else None

        bets_list = []
        for uid, b in rocket_round["bets"].items():
            if b["status"] == "active" and state == "flying":
                cw = int(b["bet"] * mult)
            elif b["status"] == "cashed_out" and b.get("cashout_mult"):
                cw = int(b["bet"] * b["cashout_mult"])
            else:
                cw = b["bet"]

            bets_list.append({
                "user_id":      uid,
                "name":         b["name"],
                "avatar":       b["avatar"],
                "bet":          b["bet"],
                "currency":     b["currency"],
                "status":       b["status"],
                "cashout_mult": b.get("cashout_mult"),
                "current_win":  cw,
            })

    return {
        "round_id":       round_id,
        "state":          state,
        "time_left":      time_left,
        "current_mult":   round(mult, 4) if state == "flying" else None,
        "revealed_crash": round(crash_point, 2) if state == "crashed" else None,
        "my_bet":         my_bet,
        "bets":           bets_list,
    }


class BetRequest(BaseModel):
    bet: int
    auto_cashout: float = 0.0


@router.post("/bet")
async def place_bet(data: BetRequest, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]
    bet   = data.bet

    min_bet = config.ROCKET_CONFIG["min_bet"]
    max_bet = config.ROCKET_CONFIG["max_bet"]
    if bet < min_bet or bet > max_bet:
        raise HTTPException(400, f"Ставка от {min_bet} до {max_bet}")

    async with _lock:
        if rocket_round["state"] != "waiting":
            raise HTTPException(400, "Ставки принимаются только перед раундом")
        if tg_id in rocket_round["bets"]:
            raise HTTPException(400, "Вы уже сделали ставку в этом раунде")

    ok = await _deduct_and_deposit(tg_id, bet, CURRENCY)
    if not ok:
        raise HTTPException(400, "Недостаточно средств")

    async with _lock:
        if rocket_round["state"] != "waiting" or tg_id in rocket_round["bets"]:
            # Вернуть деньги если раунд уже начался
            if CURRENCY == "stars":
                await database.add_stars_to_user(tg_id, bet)
            else:
                await database.add_points_to_user(tg_id, bet)
            raise HTTPException(400, "Раунд уже начался, ставка возвращена")

        auto_co = max(0.0, float(data.auto_cashout)) if data.auto_cashout else 0.0
        settings = await database.get_user_settings(tg_id)
        display_name   = "Anonim" if settings["is_anonymous"] else (current_user.get("first_name") or current_user.get("username") or "Игрок")
        display_avatar = "/static/img/anon.svg" if settings["is_anonymous"] else current_user.get("photo_url", "")
        rocket_round["bets"][tg_id] = {
            "user_id":      tg_id,
            "name":         display_name,
            "avatar":       display_avatar,
            "bet":          bet,
            "currency":     CURRENCY,
            "auto_cashout": auto_co,
            "status":       "active",
            "cashout_mult": None,
        }

    updated = await database.get_user_data(tg_id)
    return {"status": "ok", "balance": updated["balance"], "stars": updated["stars"]}


@router.post("/cashout")
async def do_cashout(current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    async with _lock:
        if rocket_round["state"] != "flying":
            raise HTTPException(400, "Ракета не летит")
        bet_data = rocket_round["bets"].get(tg_id)
        if not bet_data:
            raise HTTPException(400, "Вы не участвуете в этом раунде")
        if bet_data["status"] != "active":
            raise HTTPException(400, "Ставка уже завершена")
        if tg_id in rocket_round["_processing"]:
            raise HTTPException(400, "Вывод обрабатывается")

        mult = _calc_mult()
        if mult >= rocket_round["crash_point"]:
            raise HTTPException(400, "Ракета уже улетела!")

        rocket_round["_processing"].add(tg_id)
        snapshot = bet_data.copy()

    await _do_cashout(tg_id, snapshot, mult)

    updated = await database.get_user_data(tg_id)
    async with _lock:
        r = rocket_round["bets"].get(tg_id, {})
        cashout_mult = r.get("cashout_mult", mult)
        win_amount   = int(snapshot["bet"] * cashout_mult)

    return {
        "status":     "ok",
        "win_amount": win_amount,
        "multiplier": cashout_mult,
        "balance":    updated["balance"],
        "stars":      updated["stars"],
    }
