# db_pvp.py
# Персистентное хранение состояния раундов PvP в БД.
# Обеспечивает сохранение round_id, last_game и best_game между деплоями.

import json
import time

from db import db_async as aiosqlite
from db.db_core import DB_NAME


async def load_pvp_round_state() -> dict:
    """Загружает сохранённое состояние PvP-раунда из БД.
    Возвращает словарь {round_id, last_game, best_game, round_state} или значения по умолчанию.
    round_state содержит полное состояние активного раунда (игроки, ставки, таймеры)."""
    try:
        async with aiosqlite.connect(DB_NAME) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT round_id, last_game, best_game, round_state "
                "FROM game_round_state WHERE game = 'pvp'"
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    return {
                        "round_id":    row["round_id"] or 0,
                        "last_game":   json.loads(row["last_game"])   if row["last_game"]   else None,
                        "best_game":   json.loads(row["best_game"])   if row["best_game"]   else None,
                        "round_state": json.loads(row["round_state"]) if row["round_state"] else None,
                    }
    except Exception as e:
        print(f"[PvP] load_pvp_round_state error: {e}")
    return {"round_id": 0, "last_game": None, "best_game": None, "round_state": None}


async def save_pvp_round_state(
    round_id: int,
    last_game,
    best_game,
    round_state: dict | None = None,
) -> None:
    """Сохраняет состояние PvP-раунда в БД (upsert).

    round_state — полный снимок активного раунда (state, players, таймеры и т.д.),
    позволяет восстановить раунд после рестарта сервера без потери ставок игроков.
    Если round_state=None, колонка обнуляется (после завершения раунда не нужна).
    """
    try:
        last_json  = json.dumps(last_game,   default=str) if last_game   is not None else None
        best_json  = json.dumps(best_game,   default=str) if best_game   is not None else None
        state_json = json.dumps(round_state, default=str) if round_state is not None else None
        async with aiosqlite.connect(DB_NAME) as db:
            await db.execute("""
                INSERT INTO game_round_state (game, round_id, last_game, best_game, round_state, updated_at)
                VALUES ('pvp', ?, ?, ?, ?, ?)
                ON CONFLICT (game) DO UPDATE SET
                    round_id    = EXCLUDED.round_id,
                    last_game   = EXCLUDED.last_game,
                    best_game   = EXCLUDED.best_game,
                    round_state = EXCLUDED.round_state,
                    updated_at  = EXCLUDED.updated_at
            """, (round_id, last_json, best_json, state_json, int(time.time())))
            await db.commit()
    except Exception as e:
        print(f"[PvP] save_pvp_round_state error: {e}")


async def load_rocket_round_id() -> int:
    """Загружает последний round_id ракеты из БД."""
    try:
        async with aiosqlite.connect(DB_NAME) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT round_id FROM game_round_state WHERE game = 'rocket'"
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    return row["round_id"] or 0
    except Exception as e:
        print(f"[Rocket] load_rocket_round_id error: {e}")
    return 0


# ─────────────────────────────────────────────────────────────
# PVP GAME HISTORY
# ─────────────────────────────────────────────────────────────

async def save_pvp_game_to_history(
    round_id: int,
    winner_id: int,
    winner_name: str,
    winner_avatar: str,
    player_count: int,
    total_stars: int,
    total_donuts: float,
    gifts_count: int,
    total_value_stars: int,
    winner_bet_value_stars: float,
    multiplier: float,
    created_at: int,
) -> None:
    """Записывает завершённую PvP-игру в таблицу истории."""
    try:
        async with aiosqlite.connect(DB_NAME) as db:
            await db.execute("""
                INSERT INTO pvp_game_history
                    (round_id, winner_id, winner_name, winner_avatar,
                     player_count, total_stars, total_donuts, gifts_count,
                     total_value_stars, winner_bet_value_stars, multiplier, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                round_id, winner_id, winner_name, winner_avatar,
                player_count, total_stars, total_donuts, gifts_count,
                total_value_stars, winner_bet_value_stars, multiplier, created_at,
            ))
            await db.commit()
    except Exception as e:
        print(f"[PvP] save_pvp_game_to_history error: {e}")


async def get_pvp_history(limit: int = 30, offset: int = 0) -> list[dict]:
    """Возвращает последние PvP-игры (все игроки, сортировка по убыванию времени)."""
    try:
        async with aiosqlite.connect(DB_NAME) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""
                SELECT id, round_id, winner_id, winner_name, winner_avatar,
                       player_count, total_stars, total_donuts, gifts_count,
                       total_value_stars, winner_bet_value_stars, multiplier, created_at
                FROM pvp_game_history
                ORDER BY created_at DESC
                LIMIT ? OFFSET ?
            """, (limit, offset)) as cursor:
                rows = await cursor.fetchall()
                return [dict(r) for r in rows]
    except Exception as e:
        print(f"[PvP] get_pvp_history error: {e}")
    return []


async def get_pvp_history_count() -> int:
    """Возвращает общее число записей в истории PvP-игр."""
    try:
        async with aiosqlite.connect(DB_NAME) as db:
            async with db.execute("SELECT COUNT(*) FROM pvp_game_history") as cursor:
                row = await cursor.fetchone()
                return row[0] if row else 0
    except Exception as e:
        print(f"[PvP] get_pvp_history_count error: {e}")
    return 0


async def save_rocket_round_id(round_id: int) -> None:
    """Сохраняет текущий round_id ракеты в БД (upsert).

    ИСПРАВЛЕНО: заменены $1/$2 на ? — корень ошибки
    «the query has 0 placeholders but 2 parameters were passed».
    db_async._translate_sql конвертирует ? → %s для psycopg3,
    но $N — нет, поэтому psycopg3 видел 0 плейсхолдеров при 2 параметрах.
    """
    try:
        async with aiosqlite.connect(DB_NAME) as db:
            await db.execute("""
                INSERT INTO game_round_state (game, round_id, updated_at)
                VALUES ('rocket', ?, ?)
                ON CONFLICT (game) DO UPDATE SET
                    round_id   = EXCLUDED.round_id,
                    updated_at = EXCLUDED.updated_at
            """, (round_id, int(time.time())))
            await db.commit()
    except Exception as e:
        print(f"[Rocket] save_rocket_round_id error: {e}")
