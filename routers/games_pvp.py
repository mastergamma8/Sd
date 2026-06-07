# routers/games_pvp.py
# =====================================================
# SPACE DONUT PVP — Игрок против Игрока
# =====================================================

import asyncio
import json
import random
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import config
import database
from handlers.security import get_current_user

# Live exchange-rate helpers shared with gifts router
try:
    from routers.gifts import (
        _fetch_portal_floor_price_async,
        _fetch_ton_to_stars_rate,
    )
    _live_exchange_available = True
except Exception:
    _live_exchange_available = False

router = APIRouter(prefix="/pvp", tags=["pvp"])

# ─────────────────────────────────────────────────────────────
# ОНЛАЙН-ТРЕКЕР
# Словарь user_id → unix-timestamp последнего heartbeat.
# Пользователь считается «онлайн», если heartbeat был
# получен менее ONLINE_TIMEOUT секунд назад.
# ─────────────────────────────────────────────────────────────

ONLINE_TIMEOUT = 90  # секунд без heartbeat → офлайн

_online_users: dict[int, float] = {}   # {user_id: last_seen_ts}
_online_lock = asyncio.Lock()


async def touch_online(user_id: int) -> None:
    """Обновляет метку активности пользователя."""
    async with _online_lock:
        _online_users[user_id] = time.time()


async def get_online_count() -> int:
    """Возвращает число пользователей онлайн прямо сейчас."""
    cutoff = time.time() - ONLINE_TIMEOUT
    async with _online_lock:
        # Заодно очищаем устаревшие записи
        expired = [uid for uid, ts in _online_users.items() if ts < cutoff]
        for uid in expired:
            del _online_users[uid]
        return len(_online_users)


async def get_online_users_snapshot() -> list[dict]:
    """Возвращает список онлайн-пользователей для /online команды бота."""
    cutoff = time.time() - ONLINE_TIMEOUT
    async with _online_lock:
        return [
            {"user_id": uid, "last_seen": ts}
            for uid, ts in _online_users.items()
            if ts >= cutoff
        ]


# ─────────────────────────────────────────────────────────────
# ПАРАМЕТРЫ
# ─────────────────────────────────────────────────────────────

COUNTDOWN_DURATION = 15.0   # секунд обратного отсчёта после 2+ игроков
ROLLING_DURATION   = 6.5    # секунд анимации шарика
FINISHED_DURATION  = 7.0    # секунд показа победителя

MIN_BET_STARS   = 15
MIN_BET_TON     = 0.1

COMMISSION_STARS  = 0.05    # 5% комиссия на звёзды
COMMISSION_TON    = 0.05    # 5% комиссия на TON

SOLO_TIMEOUT = 300.0        # 5 минут ожидания соперника, затем возврат ставок

PLAYER_COLORS = [
    "#FF6B6B", "#4ECDC4", "#45B7D1", "#96CEB4",
    "#FFEAA7", "#DDA0DD", "#98D8C8", "#F0A500",
]

# ─────────────────────────────────────────────────────────────
# ГЛОБАЛЬНОЕ СОСТОЯНИЕ
# ─────────────────────────────────────────────────────────────

_lock = asyncio.Lock()

# ─────────────────────────────────────────────────────────────
# КЭШИРОВАННЫЙ ЖИВОЙ КУРС ПОНЧИК → ЗВЁЗДЫ
# ─────────────────────────────────────────────────────────────

_cached_live_ton_rate: float = 0.0
_cached_rate_timestamp: float = 0.0
TON_RATE_CACHE_TTL: float = 30.0  # обновляем каждые 30 секунд


async def _get_live_ton_to_stars_rate() -> float:
    """Возвращает актуальный курс 1 TON → звёзды.
    Данные берутся из того же API, что и в разделе обмена.
    При недоступности API возвращает config.TON_TO_STARS_FALLBACK."""
    global _cached_live_ton_rate, _cached_rate_timestamp
    now = time.time()
    if _live_exchange_available and (
        now - _cached_rate_timestamp > TON_RATE_CACHE_TTL
        or _cached_live_ton_rate <= 0
    ):
        try:
            rate = await _fetch_ton_to_stars_rate()
            if rate and rate > 0:
                _cached_live_ton_rate = float(rate)
                _cached_rate_timestamp = now
        except Exception as e:
            print(f"[PvP] failed to fetch live TON rate: {e}")
    return _cached_live_ton_rate if _cached_live_ton_rate > 0 else config.TON_TO_STARS_FALLBACK


def _make_round_state_snapshot() -> dict:
    """Создаёт сериализуемый снимок текущего состояния раунда.
    Вызывать только под _lock, чтобы гарантировать консистентность данных.
    Ключи игроков приводятся к str для корректной JSON-сериализации;
    при восстановлении они конвертируются обратно в int."""
    return {
        "state":            pvp_round["state"],
        "countdown_end":    pvp_round["countdown_end"],
        "rolling_end":      pvp_round["rolling_end"],
        "rolling_start_ts": pvp_round["rolling_start_ts"],
        "ball_seed":        pvp_round["ball_seed"],
        "ball_target_x":    pvp_round["ball_target_x"],
        "ball_target_y":    pvp_round["ball_target_y"],
        "finished_end":     pvp_round["finished_end"],
        "winner_id":        pvp_round["winner_id"],
        "_color_idx":       pvp_round["_color_idx"],
        "first_bet_at":     pvp_round["first_bet_at"],
        "players":          {str(uid): p for uid, p in pvp_round["players"].items()},
    }


pvp_round: Dict[str, Any] = {
    "id":            0,
    "state":         "waiting",   # waiting | countdown | rolling | finished
    "countdown_end": 0.0,
    "rolling_end":      0.0,
    "rolling_start_ts": 0.0,
    "ball_seed":        0,
    "ball_target_x":    50.0,
    "ball_target_y":    50.0,
    "finished_end":  0.0,
    "players":       {},          # {user_id: {name, avatar, color, bets: [...]}}
    "winner_id":     None,
    "last_game":     None,
    "best_game":     None,
    "_color_idx":    0,
    "first_bet_at":  0.0,         # unix timestamp первой ставки; 0 = раунд пустой
}


# ─────────────────────────────────────────────────────────────
# MULBERRY32 PRNG — ИДЕНТИЧЕН КЛИЕНТСКОЙ РЕАЛИЗАЦИИ (JS)
# Позволяет серверу вычислить финальную точку шарика один раз,
# чтобы все клиенты видели одинаковую анимацию независимо от
# текущего курса пончиков.
# ─────────────────────────────────────────────────────────────

def _mulberry32(seed: int):
    """Псевдослучайный генератор Mulberry32 (float 0..1).
    Полностью совместим с реализацией в games-pvp.js."""
    s = [seed & 0xFFFFFFFF]

    def _imul32(a: int, b: int) -> int:
        return (a * b) & 0xFFFFFFFF

    def rng() -> float:
        s[0] = (s[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = _imul32(s[0] ^ (s[0] >> 15), 1 | s[0])
        t = (t ^ ((t + _imul32(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rng


def _compute_ball_target(seed: int, winner_id: int, players: list) -> dict:
    """Вычисляет координаты финальной точки шарика, используя тот же
    алгоритм и PRNG, что клиент (getPvpWinnerSectorTarget).
    Потребляет ровно 2 вызова PRNG, чтобы последующая траектория
    рикошетов была идентична на всех клиентах."""
    import math
    rng = _mulberry32(seed)

    total_chance = sum(p["win_chance"] for p in players)
    current_percent = 0.0

    for p in players:
        normalized_chance = (
            (p["win_chance"] / total_chance * 100) if total_chance > 0
            else (100 / len(players))
        )
        if str(p["user_id"]) == str(winner_id):
            padding = max(2.0, normalized_chance * 0.1)
            safe_chance = max(1.0, normalized_chance - padding * 2)
            random_percent = current_percent + padding + (rng() * safe_chance)  # вызов 1
            angle_rad = ((random_percent * 3.6) - 90) * (math.pi / 180)
            r = 12 + rng() * 16  # вызов 2
            return {
                "x": round(50 + r * math.cos(angle_rad), 4),
                "y": round(50 + r * math.sin(angle_rad), 4),
            }
        current_percent += normalized_chance

    return {"x": 50.0, "y": 50.0}

# ─────────────────────────────────────────────────────────────
# ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
# ─────────────────────────────────────────────────────────────

def _get_gift_value_stars(gift_id: int) -> int:
    """Возвращает стоимость подарка в звёздах для вычисления шанса победы."""
    for catalog in (config.TG_GIFTS, config.BASE_GIFTS, config.MAIN_GIFTS):
        gift = catalog.get(gift_id)
        if gift:
            return gift.get("required_value") or gift.get("value") or 1
    return 1


def _get_gift_info(gift_id: int) -> dict:
    for catalog in (config.TG_GIFTS, config.BASE_GIFTS, config.MAIN_GIFTS):
        if gift_id in catalog:
            return catalog[gift_id]
    return {}


async def _get_live_gift_value_stars(gift_id: int, gift_info: dict) -> int:
    """Fetch live exchange value for a gift using Portal Market pricing.
    Mirrors the /pvp/inventory endpoint exactly so win-chance weights
    reflect the real market value the player sees in the UI."""
    if not _live_exchange_available:
        return _get_gift_value_stars(gift_id)
    try:
        ton_to_stars = await _fetch_ton_to_stars_rate()

        # TG gifts: fixed bonus formula (same as inventory + exchange handler)
        if gift_id in config.TG_GIFTS:
            return _get_gift_value_stars(gift_id) + 10

        gift_name = gift_info.get("name", "")
        ton_price = await _fetch_portal_floor_price_async(gift_name) if gift_name else None

        if not ton_price or ton_price <= 0:
            stored = gift_info.get("value") or gift_info.get("required_value") or 0
            if gift_id in config.BASE_GIFTS:
                ton_price = stored / 0.80 if stored > 0 else 0
            else:
                ton_price = stored / 1.20 if stored > 0 else 0

        if ton_price and ton_price > 0 and ton_to_stars:
            return max(1, int(ton_price * ton_to_stars))
    except Exception as e:
        print(f"[PvP] live gift value error for gift {gift_id}: {e}")

    return _get_gift_value_stars(gift_id)


def _player_total_stars(player: dict, donuts_rate: float = 0) -> float:
    """Суммарная стоимость ставок игрока в эквиваленте звёзд.
    donuts_rate: живой курс TON→звёзды (1 TON = курс в звёздах);
    если 0, берётся из config."""
    rate = donuts_rate if donuts_rate > 0 else config.TON_TO_STARS_FALLBACK
    total = 0.0
    for bet in player["bets"]:
        if bet["type"] == "stars":
            total += bet["amount"]
        elif bet["type"] == "ton":
            total += bet["amount"] * rate
        elif bet["type"] == "gift":
            total += bet.get("value_stars", 1)
    return total


def _build_player_list(donuts_rate: float = 0.0) -> list:
    total_pot = sum(_player_total_stars(p, donuts_rate) for p in pvp_round["players"].values())
    result = []
    for uid, player in pvp_round["players"].items():
        ps = _player_total_stars(player, donuts_rate)
        win_chance = (ps / total_pot * 100) if total_pot > 0 else 0
        result.append({
            "user_id":    uid,
            "name":       player["name"],
            "avatar":     player["avatar"],
            "color":      player["color"],
            "win_chance": round(win_chance, 1),
            "stars_bet":  sum(b["amount"] for b in player["bets"] if b["type"] == "stars"),
            "ton_bet":    round(sum(b["amount"] for b in player["bets"] if b["type"] == "ton"), 2),
            "gift_bets":  [b for b in player["bets"] if b["type"] == "gift"],
            "value_stars": round(ps, 2),
        })
    return result


async def _determine_winner() -> Optional[int]:
    """Случайный выбор победителя с весами по стоимости ставок (живой курс TON)."""
    live_rate = await _get_live_ton_to_stars_rate()
    weights = {
        uid: _player_total_stars(player, live_rate)
        for uid, player in pvp_round["players"].items()
    }
    valid = {k: v for k, v in weights.items() if v > 0}
    if not valid:
        return None
    ids = list(valid.keys())
    ws  = [valid[uid] for uid in ids]
    return random.choices(ids, weights=ws, k=1)[0]


async def _payout_winner(winner_id: int):
    """Начисляет победителю весь банк минус комиссия и переносит подарки.
    Записывает историю ставок для ВСЕХ участников и историю выигрыша для победителя.
    Сохраняет round_id, last_game и best_game в БД после завершения раунда."""
    try:
        players = pvp_round["players"]
        if winner_id not in players:
            return

        round_id    = pvp_round["id"]
        num_players = len(players)

        total_stars  = sum(
            sum(b["amount"] for b in p["bets"] if b["type"] == "stars")
            for p in players.values()
        )
        total_ton = sum(
            sum(b["amount"] for b in p["bets"] if b["type"] == "ton")
            for p in players.values()
        )
        all_gift_bets = [
            b for p in players.values()
            for b in p["bets"] if b["type"] == "gift"
        ]

        payout_stars  = int(total_stars * (1 - COMMISSION_STARS))
        payout_ton    = round(total_ton * (1 - COMMISSION_TON), 4)

        # ── Запись ставок для ВСЕХ игроков (для истории и лидерборда) ─────────
        for uid, player in players.items():
            stars_bet  = sum(b["amount"] for b in player["bets"] if b["type"] == "stars")
            ton_bet    = round(sum(b["amount"] for b in player["bets"] if b["type"] == "ton"), 4)
            gift_bets  = [b for b in player["bets"] if b["type"] == "gift"]

            if stars_bet > 0:
                await database.add_history_entry(
                    uid, "pvp_bet_stars",
                    f"Ставка в Space PvP (раунд #{round_id}, {num_players} игр.)",
                    -stars_bet,
                )
            if ton_bet > 0:
                await database.add_history_entry(
                    uid, "pvp_bet_ton",
                    f"Ставка в Space PvP — TON (раунд #{round_id}, {num_players} игр.)",
                    -ton_bet,
                )
            for gb in gift_bets:
                await database.add_history_entry(
                    uid, "pvp_bet_gift",
                    f"Подарок в Space PvP (раунд #{round_id}) [gift_id:{gb['gift_id']}]",
                    -gb.get("value_stars", 1),
                )

        # ── Выплата и история победы ──────────────────────────────────────────
        if payout_stars > 0:
            await database.add_stars_to_user(winner_id, payout_stars)
            await database.add_history_entry(
                winner_id, "pvp_win_stars",
                f"Победа в Space PvP (раунд #{round_id}, {num_players} игр.)",
                payout_stars,
            )

        if payout_ton > 0:
            await database.add_ton_balance(winner_id, payout_ton)
            await database.add_history_entry(
                winner_id, "pvp_win_ton",
                f"Победа в Space PvP — TON (раунд #{round_id})",
                payout_ton,
            )

        for gb in all_gift_bets:
            await database.add_gift_to_user(winner_id, gb["gift_id"], 1)
            await database.add_history_entry(
                winner_id, "pvp_win_gift",
                f"Победа в Space PvP — подарок (раунд #{round_id}) [gift_id:{gb['gift_id']}]",
                gb.get("value_stars", 1),
            )

        # ── Обновить статистику лучшей/последней игры ─────────────────────────
        gifts_value_stars = sum(b.get("value_stars", 1) for b in all_gift_bets)
        total_value_stars = (
            int(payout_stars)
            + int(payout_ton * config.TON_TO_STARS_FALLBACK)
            + int(gifts_value_stars * (1 - COMMISSION_STARS))
        )
        # Проверяем анонимность победителя — перезаписываем имя/аватар
        # даже если ставка была сделана до включения анонимности
        winner_settings   = await database.get_user_settings(winner_id)
        winner_name   = "Anonim"               if winner_settings["is_anonymous"] else players[winner_id]["name"]
        winner_avatar = "/static/img/anon.svg" if winner_settings["is_anonymous"] else players[winner_id]["avatar"]
        game_info = {
            "winner_id":         winner_id,
            "name":              winner_name,
            "avatar":            winner_avatar,
            "color":             players[winner_id]["color"],
            "total_stars":       payout_stars,
            "total_ton":         payout_ton,
            "gifts_count":       len(all_gift_bets),
            "player_count":      num_players,
            "total_value_stars": total_value_stars,
        }
        pvp_round["last_game"] = game_info
        if (pvp_round["best_game"] is None
                or total_value_stars > pvp_round["best_game"].get("total_value_stars", 0)):
            pvp_round["best_game"] = game_info

        # ── Сохранить состояние раунда в БД (переживёт деплой) ───────────────
        # _payout_winner вызывается через create_task, когда state уже «finished»
        # и finished_end ещё не истёк. Снимок корректен — фаза не изменится
        # до истечения finished_end (ещё ~7 сек), а мы заканчиваем гораздо быстрее.
        await database.save_pvp_round_state(
            pvp_round["id"],
            pvp_round["last_game"],
            pvp_round["best_game"],
            _make_round_state_snapshot(),
        )

        # ── Записать статистику PvP в банк (для /bankstatus) ─────────────────
        # В PvP банк не является контрагентом — деньги движутся между игроками.
        # Банк фиксирует объём ставок, выплат и удержанную комиссию (5%) для
        # корректного отображения RTP, house edge и общего числа игр в /bankstatus.
        gifts_value_stars_int = int(gifts_value_stars)
        payout_gift_value     = int(gifts_value_stars * (1 - COMMISSION_STARS))
        await database.bank_record_pvp_game(
            total_stars=total_stars,
            total_donuts=total_ton,
            total_gift_value=gifts_value_stars_int,
            payout_stars=payout_stars,
            payout_donuts=payout_ton,
            payout_gift_value=payout_gift_value,
            # total_donuts / payout_donuts здесь — это TON, а не пончики:
            # передаём курс TON→Stars явно, чтобы банк считал верно.
            rate=config.TON_TO_STARS_FALLBACK,
        )

        # ── Записать завершённую игру в глобальную историю PvP ───────────────
        winner_stars_bet = sum(b["amount"] for b in players[winner_id]["bets"] if b["type"] == "stars")
        winner_ton_bet   = sum(b["amount"] for b in players[winner_id]["bets"] if b["type"] == "ton")
        winner_gifts_val = sum(b.get("value_stars", 1) for b in players[winner_id]["bets"] if b["type"] == "gift")
        winner_bet_value = (
            winner_stars_bet
            + winner_ton_bet * config.TON_TO_STARS_FALLBACK
            + winner_gifts_val
        )
        multiplier = round(total_value_stars / winner_bet_value, 2) if winner_bet_value > 0 else 1.0
        await database.save_pvp_game_to_history(
            round_id=round_id,
            winner_id=winner_id,
            winner_name=winner_name,
            winner_avatar=winner_avatar,
            player_count=num_players,
            total_stars=payout_stars,
            total_donuts=payout_ton,
            gifts_count=len(all_gift_bets),
            total_value_stars=total_value_stars,
            winner_bet_value_stars=round(winner_bet_value, 2),
            multiplier=multiplier,
            created_at=int(time.time()),
        )

    except Exception as e:
        print(f"[PvP] payout_winner error: {e}")


def _ensure_player(user_id: int, user_info: dict, display_name: str = None, display_avatar: str = None):
    """Добавляет игрока в раунд если ещё не участвует (вызывать под локом)."""
    if user_id not in pvp_round["players"]:
        # Фиксируем время первой ставки в раунде для отсчёта таймаута.
        if not pvp_round["players"]:
            pvp_round["first_bet_at"] = time.time()
        idx = pvp_round["_color_idx"] % len(PLAYER_COLORS)
        pvp_round["_color_idx"] += 1
        pvp_round["players"][user_id] = {
            "name":   display_name if display_name is not None else (user_info.get("first_name") or user_info.get("username") or "Игрок"),
            "avatar": display_avatar if display_avatar is not None else user_info.get("photo_url", ""),
            "color":  PLAYER_COLORS[idx],
            "bets":   [],
        }


# ─────────────────────────────────────────────────────────────
# ВОЗВРАТ СТАВОК ПРИ ТАЙМАУТЕ
# ─────────────────────────────────────────────────────────────

async def _cancel_and_refund(players_snapshot: dict, round_id: int):
    """Возвращает все ставки игрокам если раунд отменён по таймауту.
    Принимает снимок players на момент отмены, чтобы не зависеть от
    состояния pvp_round после сброса (вызывается через create_task)."""
    try:
        for uid, player in players_snapshot.items():
            for bet in player["bets"]:
                if bet["type"] == "stars":
                    await database.add_stars_to_user(uid, bet["amount"])
                    await database.add_history_entry(
                        uid, "pvp_refund_stars",
                        f"Возврат ставки Space PvP — звёзды (раунд #{round_id}, нет соперника, таймаут 5 мин)",
                        bet["amount"],
                    )
                elif bet["type"] == "ton":
                    await database.add_ton_balance(uid, bet["amount"])
                    await database.add_history_entry(
                        uid, "pvp_refund_ton",
                        f"Возврат ставки Space PvP — TON (раунд #{round_id}, нет соперника, таймаут 5 мин)",
                        bet["amount"],
                    )
                elif bet["type"] == "gift":
                    await database.add_gift_to_user(uid, bet["gift_id"], 1)
                    await database.add_history_entry(
                        uid, "pvp_refund_gift",
                        f"Возврат подарка Space PvP (раунд #{round_id}, нет соперника, таймаут 5 мин) [gift_id:{bet['gift_id']}]",
                        bet.get("value_stars", 1),
                    )
        print(f"[PvP] Раунд #{round_id} отменён по таймауту, ставки возвращены.")
    except Exception as e:
        print(f"[PvP] _cancel_and_refund error: {e}")


# ─────────────────────────────────────────────────────────────
# ФОНОВАЯ ЗАДАЧА — МЕНЕДЖЕР РАУНДОВ
# ─────────────────────────────────────────────────────────────

async def pvp_round_manager():
    # ── Восстанавливаем полное состояние из БД после деплоя ──────────────────
    try:
        state_data = await database.load_pvp_round_state()
        pvp_round["id"]        = state_data["round_id"]
        pvp_round["last_game"] = state_data["last_game"]
        pvp_round["best_game"] = state_data["best_game"]

        rs = state_data.get("round_state")
        if rs:
            pvp_round["state"]            = rs.get("state", "waiting")
            pvp_round["countdown_end"]    = rs.get("countdown_end",    0.0)
            pvp_round["rolling_end"]      = rs.get("rolling_end",      0.0)
            pvp_round["rolling_start_ts"] = rs.get("rolling_start_ts", 0.0)
            pvp_round["ball_seed"]        = rs.get("ball_seed",        0)
            pvp_round["ball_target_x"]    = rs.get("ball_target_x",    50.0)
            pvp_round["ball_target_y"]    = rs.get("ball_target_y",    50.0)
            pvp_round["finished_end"]     = rs.get("finished_end",     0.0)
            pvp_round["winner_id"]        = rs.get("winner_id")
            pvp_round["_color_idx"]       = rs.get("_color_idx",       0)
            pvp_round["first_bet_at"]     = rs.get("first_bet_at",     0.0)
            # JSON хранит ключи как строки — конвертируем обратно в int
            raw_players = rs.get("players") or {}
            pvp_round["players"] = {int(k): v for k, v in raw_players.items()}

            # ── Обработка устаревших таймеров после рестарта ──────────────────
            # Если сервер пролежал дольше, чем осталось до конца фазы,
            # менеджер разберётся на первой же итерации цикла — нужно только
            # убедиться, что состояние «waiting+solo_timeout» обрабатывается
            # немедленно: если 5 минут истекли, возврат ставок произойдёт
            # в первом же проходе без дополнительных action'ов здесь.
            print(
                f"[PvP] Restored full state from DB: "
                f"round_id={pvp_round['id']}, state={pvp_round['state']}, "
                f"players={len(pvp_round['players'])}"
            )
        else:
            print(f"[PvP] Restored round_id={pvp_round['id']} (no active round state)")
    except Exception as e:
        print(f"[PvP] Failed to restore state: {e}")

    while True:
        try:
            async with _lock:
                state = pvp_round["state"]

            if state == "waiting":
                async with _lock:
                    if len(pvp_round["players"]) >= 2 and pvp_round["state"] == "waiting":
                        pvp_round["state"]        = "countdown"
                        pvp_round["countdown_end"] = time.time() + COUNTDOWN_DURATION

                    # Таймаут одиночного игрока: никто не присоединился за 5 минут —
                    # отменяем раунд и возвращаем все ставки.
                    elif (
                        pvp_round["players"]
                        and pvp_round["first_bet_at"] > 0
                        and time.time() - pvp_round["first_bet_at"] >= SOLO_TIMEOUT
                        and pvp_round["state"] == "waiting"
                    ):
                        players_snapshot = dict(pvp_round["players"])
                        round_id         = pvp_round["id"]
                        # Сбрасываем раунд до запуска возврата, чтобы
                        # новые ставки не смешались с возвращаемыми.
                        pvp_round["id"]           += 1
                        pvp_round["players"]       = {}
                        pvp_round["first_bet_at"]  = 0.0
                        pvp_round["_color_idx"]    = 0
                        # Сохраняем новый round_id немедленно — при деплое
                        # восстановится актуальный номер, а не старый.
                        await database.save_pvp_round_state(
                            pvp_round["id"],
                            pvp_round["last_game"],
                            pvp_round["best_game"],
                            _make_round_state_snapshot(),
                        )
                        asyncio.create_task(_cancel_and_refund(players_snapshot, round_id))
                await asyncio.sleep(0.5)

            elif state == "countdown":
                if time.time() >= pvp_round["countdown_end"]:
                    async with _lock:
                        if pvp_round["state"] == "countdown":
                            live_rate = await _get_live_ton_to_stars_rate()
                            winner_id = await _determine_winner()
                            ball_seed = random.randint(1, 999999)

                            # Вычисляем финальную точку шарика на сервере один раз,
                            # используя живой курс в момент старта раунда.
                            # Все клиенты получат одинаковые координаты и увидят
                            # идентичную анимацию независимо от своего текущего курса.
                            players_snap = _build_player_list(live_rate)
                            if winner_id and players_snap:
                                target = _compute_ball_target(ball_seed, winner_id, players_snap)
                            else:
                                target = {"x": 50.0, "y": 50.0}

                            pvp_round["winner_id"]        = winner_id
                            pvp_round["state"]            = "rolling"
                            pvp_round["rolling_end"]      = time.time() + ROLLING_DURATION
                            pvp_round["rolling_start_ts"] = time.time()
                            pvp_round["ball_seed"]        = ball_seed
                            pvp_round["ball_target_x"]    = target["x"]
                            pvp_round["ball_target_y"]    = target["y"]
                            # Сохраняем состояние rolling в БД — победитель
                            # и координаты шарика переживут рестарт сервера.
                            await database.save_pvp_round_state(
                                pvp_round["id"],
                                pvp_round["last_game"],
                                pvp_round["best_game"],
                                _make_round_state_snapshot(),
                            )
                await asyncio.sleep(0.2)

            elif state == "rolling":
                if time.time() >= pvp_round["rolling_end"]:
                    async with _lock:
                        if pvp_round["state"] == "rolling":
                            pvp_round["state"]        = "finished"
                            pvp_round["finished_end"] = time.time() + FINISHED_DURATION
                            if pvp_round["winner_id"]:
                                asyncio.create_task(_payout_winner(pvp_round["winner_id"]))
                            # Сохраняем состояние finished сразу — _payout_winner
                            # дополнит запись last_game/best_game асинхронно.
                            await database.save_pvp_round_state(
                                pvp_round["id"],
                                pvp_round["last_game"],
                                pvp_round["best_game"],
                                _make_round_state_snapshot(),
                            )
                await asyncio.sleep(0.2)

            elif state == "finished":
                if time.time() >= pvp_round["finished_end"]:
                    async with _lock:
                        if pvp_round["state"] == "finished":
                            pvp_round["id"]           += 1
                            pvp_round["state"]         = "waiting"
                            pvp_round["countdown_end"] = 0.0
                            pvp_round["rolling_end"]   = 0.0
                            pvp_round["rolling_start_ts"] = 0.0
                            pvp_round["finished_end"]  = 0.0
                            pvp_round["ball_seed"]     = 0
                            pvp_round["ball_target_x"] = 50.0
                            pvp_round["ball_target_y"] = 50.0
                            pvp_round["players"]       = {}
                            pvp_round["winner_id"]     = None
                            pvp_round["first_bet_at"]  = 0.0
                            pvp_round["_color_idx"]    = 0
                            # ИСПРАВЛЕНИЕ: сохраняем инкрементированный round_id сразу
                            # после перехода finished→waiting, иначе после деплоя
                            # восстанавливается старый id из _payout_winner и раунд
                            # повторяется заново.
                            await database.save_pvp_round_state(
                                pvp_round["id"],
                                pvp_round["last_game"],
                                pvp_round["best_game"],
                                _make_round_state_snapshot(),
                            )
                await asyncio.sleep(0.5)

            else:
                await asyncio.sleep(0.5)

        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[PvP] round_manager error: {e}")
            await asyncio.sleep(2.0)


# ─────────────────────────────────────────────────────────────
# ЭНДПОИНТЫ API
# ─────────────────────────────────────────────────────────────

async def _apply_game_anonymity(game: dict | None) -> dict | None:
    """Перезаписывает name/avatar в объекте last_game/best_game согласно
    актуальным настройкам анонимности победителя. Работает даже для данных,
    сохранённых в БД до введения фичи (если winner_id присутствует)."""
    if not game:
        return game
    wid = game.get("winner_id")
    if not wid:
        return game
    settings = await database.get_user_settings(wid)
    if settings["is_anonymous"]:
        game = dict(game)          # не мутируем оригинал
        game["name"]   = "Anonim"
        game["avatar"] = "/static/img/anon.svg"
    return game


@router.get("/history")
async def get_pvp_history_endpoint(
    limit: int = 30,
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """Возвращает постраничную историю завершённых PvP-игр (все пользователи)."""
    limit  = min(max(limit, 1), 50)
    offset = max(offset, 0)
    history = await database.get_pvp_history(limit=limit, offset=offset)
    total   = await database.get_pvp_history_count()
    return {"history": history, "total": total, "offset": offset, "limit": limit}


@router.post("/heartbeat")
async def pvp_heartbeat(current_user: dict = Depends(get_current_user)):
    """Фиксирует, что пользователь активен прямо сейчас.
    Вызывается клиентом каждые 30 сек, пока приложение открыто."""
    await touch_online(current_user["id"])
    return {"ok": True, "online": await get_online_count()}


@router.get("/state")
async def get_pvp_state(current_user: dict = Depends(get_current_user)):
    # Обновляем присутствие пользователя при каждом poll состояния
    await touch_online(current_user["id"])
    # Fetch live donut→stars rate BEFORE acquiring the lock (network call)
    live_rate = await _get_live_ton_to_stars_rate()

    async with _lock:
        state            = pvp_round["state"]
        round_id         = pvp_round["id"]
        countdown_end    = pvp_round["countdown_end"]
        winner_id        = pvp_round["winner_id"] if state in ("finished", "rolling") else None
        last_game        = pvp_round["last_game"]
        best_game        = pvp_round["best_game"]
        rolling_start_ts = pvp_round["rolling_start_ts"]
        ball_seed        = pvp_round["ball_seed"]
        ball_target_x    = pvp_round["ball_target_x"]
        ball_target_y    = pvp_round["ball_target_y"]
        players          = _build_player_list(live_rate)

    time_left = max(0.0, countdown_end - time.time()) if countdown_end > 0 else 0.0
    total_stars  = sum(p.get("stars_bet", 0) for p in players)
    total_donuts = round(sum(p.get("ton_bet", 0) for p in players), 4)
    total_gifts  = sum(len(p.get("gift_bets", [])) for p in players)

    # Collect unique gift previews (photo + name) for pot display in UI
    gift_previews: list = []
    seen_gifts: set = set()
    for p in players:
        for gb in (p.get("gift_bets") or []):
            gid = gb.get("gift_id")
            if gid and gid not in seen_gifts:
                seen_gifts.add(gid)
                gift_previews.append({
                    "gift_id": gid,
                    "name":    gb.get("gift_name", ""),
                    "photo":   gb.get("gift_photo", ""),
                })

    winner_data = None
    if winner_id and state in ("rolling", "finished"):
        # winner_player уже скопирован под локом через _build_player_list,
        # поэтому ищем его в уже снятом списке players, а не в pvp_round напрямую.
        wp_list = [p for p in players if p.get("user_id") == winner_id]
        wp = wp_list[0] if wp_list else {}
        winner_data = {
            "user_id": winner_id,
            "name":    wp.get("name", "?"),
            "avatar":  wp.get("avatar", ""),
            "color":   wp.get("color", "#FF6B6B"),
        }

    return {
        "round_id":        round_id,
        "state":           state,
        "time_left":       round(time_left, 2),
        "rolling_start_ts": rolling_start_ts,
        "ball_seed":        ball_seed,
        "ball_target_x":   ball_target_x,
        "ball_target_y":   ball_target_y,
        "players":         players,
        "winner":          winner_data,
        "pot":             {"stars": total_stars, "ton": total_donuts, "gifts": total_gifts, "gift_previews": gift_previews},
        "last_game":       await _apply_game_anonymity(last_game),
        "best_game":       await _apply_game_anonymity(best_game),
        "online_count":    await get_online_count(),
    }


class BetStarsRequest(BaseModel):
    amount: int

class BetDonutsRequest(BaseModel):
    amount: float

class BetGiftRequest(BaseModel):
    gift_id: int


@router.post("/bet/stars")
async def bet_stars(data: BetStarsRequest, current_user: dict = Depends(get_current_user)):
    tg_id  = current_user["id"]
    amount = data.amount

    if amount < MIN_BET_STARS:
        raise HTTPException(400, f"Минимальная ставка {MIN_BET_STARS} ⭐")

    async with _lock:
        if pvp_round["state"] not in ("waiting", "countdown"):
            raise HTTPException(400, "Ставки сейчас не принимаются")

    ok = await database.deduct_stars(tg_id, amount)
    if not ok:
        raise HTTPException(400, "Недостаточно звёзд")

    settings = await database.get_user_settings(tg_id)
    display_name   = "Anonim" if settings["is_anonymous"] else None
    display_avatar = "/static/img/anon.svg" if settings["is_anonymous"] else None

    _save_args = None
    async with _lock:
        if pvp_round["state"] not in ("waiting", "countdown"):
            await database.add_stars_to_user(tg_id, amount)
            raise HTTPException(400, "Ставки сейчас не принимаются")
        _ensure_player(tg_id, current_user, display_name, display_avatar)
        pvp_round["players"][tg_id]["bets"].append({"type": "stars", "amount": amount})
        # Снимок берём под локом — гарантирует консистентность данных
        _save_args = (pvp_round["id"], pvp_round["last_game"], pvp_round["best_game"],
                      _make_round_state_snapshot())

    # Сохраняем ставку в БД фоном, не задерживая ответ
    asyncio.create_task(database.save_pvp_round_state(*_save_args))

    updated = await database.get_user_data(tg_id)
    return {"status": "ok", "balance": updated["balance"], "stars": updated["stars"],
            "gifts": await database.get_user_gifts(tg_id)}


@router.post("/bet/ton")
async def bet_ton(data: BetDonutsRequest, current_user: dict = Depends(get_current_user)):
    tg_id  = current_user["id"]
    amount = round(data.amount, 4)

    if amount < MIN_BET_TON:
        raise HTTPException(400, f"Минимальная ставка {MIN_BET_TON} TON")

    async with _lock:
        if pvp_round["state"] not in ("waiting", "countdown"):
            raise HTTPException(400, "Ставки сейчас не принимаются")

    ok = await database.deduct_ton_balance(tg_id, amount)
    if not ok:
        raise HTTPException(400, "Недостаточно TON")

    settings = await database.get_user_settings(tg_id)
    display_name   = "Anonim" if settings["is_anonymous"] else None
    display_avatar = "/static/img/anon.svg" if settings["is_anonymous"] else None

    _save_args = None
    async with _lock:
        if pvp_round["state"] not in ("waiting", "countdown"):
            await database.add_ton_balance(tg_id, amount)
            raise HTTPException(400, "Ставки сейчас не принимаются")
        _ensure_player(tg_id, current_user, display_name, display_avatar)
        pvp_round["players"][tg_id]["bets"].append({"type": "ton", "amount": amount})
        _save_args = (pvp_round["id"], pvp_round["last_game"], pvp_round["best_game"],
                      _make_round_state_snapshot())

    asyncio.create_task(database.save_pvp_round_state(*_save_args))

    updated = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)
    return {"status": "ok", "ton_balance": updated.get("ton_balance", 0), "balance": updated["balance"],
            "stars": updated["stars"], "gifts": updated_gifts}


@router.post("/bet/gift")
async def bet_gift(data: BetGiftRequest, current_user: dict = Depends(get_current_user)):
    tg_id   = current_user["id"]
    gift_id = data.gift_id

    async with _lock:
        if pvp_round["state"] not in ("waiting", "countdown"):
            raise HTTPException(400, "Ставки сейчас не принимаются")

    gift_info = _get_gift_info(gift_id)
    if not gift_info:
        raise HTTPException(400, "Подарок не найден")

    value_stars = await _get_live_gift_value_stars(gift_id, gift_info)

    ok = await database.remove_gift_from_user(tg_id, gift_id)
    if not ok:
        raise HTTPException(400, "Подарок не найден в инвентаре")

    settings = await database.get_user_settings(tg_id)
    display_name   = "Anonim" if settings["is_anonymous"] else None
    display_avatar = "/static/img/anon.svg" if settings["is_anonymous"] else None

    _save_args = None
    async with _lock:
        if pvp_round["state"] not in ("waiting", "countdown"):
            await database.add_gift_to_user(tg_id, gift_id, 1)
            raise HTTPException(400, "Ставки сейчас не принимаются")
        _ensure_player(tg_id, current_user, display_name, display_avatar)
        pvp_round["players"][tg_id]["bets"].append({
            "type":       "gift",
            "gift_id":    gift_id,
            "gift_name":  gift_info.get("name", ""),
            "gift_photo": gift_info.get("photo", ""),
            "value_stars": value_stars,
            "amount":     1,
        })
        _save_args = (pvp_round["id"], pvp_round["last_game"], pvp_round["best_game"],
                      _make_round_state_snapshot())

    asyncio.create_task(database.save_pvp_round_state(*_save_args))

    updated = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)
    return {"status": "ok", "balance": updated["balance"], "stars": updated["stars"],
            "gifts": updated_gifts}


@router.get("/inventory")
async def get_inventory(current_user: dict = Depends(get_current_user)):
    """Инвентарь пользователя для выбора подарков в PvP с ценами в звёздах по курсу обмена.
    Использует живой курс Portal Market (тот же, что /api/exchange-preview в профиле)."""
    tg_id  = current_user["id"]
    gifts  = await database.get_user_gifts(tg_id)

    # Fetch live rate once for all non-TG gifts
    ton_to_stars = None
    if _live_exchange_available:
        try:
            ton_to_stars = await _fetch_ton_to_stars_rate()
        except Exception:
            ton_to_stars = None

    result = []
    for gift_id, amount in gifts.items():
        info = _get_gift_info(gift_id)
        if not info:
            continue

        raw_value = _get_gift_value_stars(gift_id)

        # TG gifts: fixed bonus formula (same as exchange handler)
        if gift_id in config.TG_GIFTS:
            exchange_stars = raw_value + 10

        elif _live_exchange_available and gift_id not in config.TG_GIFTS:
            # Try live Portal Market price — mirrors /api/exchange-preview exactly
            gift_name = info.get("name", "")
            try:
                ton_price = await _fetch_portal_floor_price_async(gift_name) if gift_name else None
            except Exception:
                ton_price = None

            if not ton_price or ton_price <= 0:
                # Fallback formula (same as exchange-preview fallback)
                stored = info.get("value") or info.get("required_value") or 0
                if gift_id in config.BASE_GIFTS:
                    ton_price = stored / 0.80 if stored > 0 else 0
                else:
                    ton_price = stored / 1.20 if stored > 0 else 0

            if ton_price and ton_price > 0 and ton_to_stars:
                exchange_stars = max(1, int(ton_price * ton_to_stars))
            else:
                # Last-resort static fallback (no bonus)
                if gift_id in config.BASE_GIFTS:
                    exchange_stars = max(1, int(raw_value / 0.80))
                else:
                    exchange_stars = max(1, int(raw_value / 1.20))
        else:
            # Static fallback when live exchange is unavailable
            if gift_id in config.BASE_GIFTS:
                exchange_stars = max(1, int(raw_value / 0.80))
            else:
                exchange_stars = max(1, int(raw_value / 1.20))

        result.append({
            "gift_id":        gift_id,
            "name":           info.get("name", ""),
            "photo":          info.get("photo", ""),
            "value_stars":    raw_value,
            "exchange_stars": exchange_stars,
            "amount":         amount,
        })
    return {"gifts": result}


@router.get("/user_balance")
async def get_user_balance(current_user: dict = Depends(get_current_user)):
    """Быстрое обновление баланса и инвентаря для синхронизации после игры."""
    tg_id      = current_user["id"]
    user_data  = await database.get_user_data(tg_id)
    user_gifts = await database.get_user_gifts(tg_id)
    return {
        "balance": user_data.get("balance", 0),
        "stars":   user_data.get("stars", 0),
        "ton_balance": user_data.get("ton_balance", 0),
        "gifts":   user_gifts,
            }
