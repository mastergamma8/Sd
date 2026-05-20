"""
db/db_pity.py
─────────────
Хранение счётчиков пити и кулдауна для игровых механик (кейсы, рулетка).

Таблица: user_pity
──────────────────
    tg_id          BIGINT  — идентификатор пользователя
    game_key       TEXT    — ключ игры, например: "case_1", "case_2", "roulette"
    pity_count     INT     — кол-во спинов подряд без джекпота
    cooldown_count INT     — оставшиеся спины кулдауна после последнего джекпота

Таблица создаётся через db_init.py при старте приложения.
Функция ensure_table() здесь для обратной совместимости (no-op после первого
вызова), но основная инициализация — в db_init.init_db().

Публичные функции
──────────────────
    get_pity(tg_id, game_key)                      → (pity_count, cooldown_count)
    set_pity(tg_id, game_key, pity, cooldown)      → None
    on_jackpot(tg_id, game_key, cooldown_start)    → None   # сброс после джекпота
    on_no_jackpot(tg_id, game_key)                 → None   # инкремент после обычного спина

Примечание о плейсхолдерах
───────────────────────────
Здесь используется синтаксис "?" (SQLite-стиль), который db_async._translate_sql
автоматически конвертирует в "%s" для psycopg3. Не используйте "$1/$2" —
проект не применяет ClientCursor, поэтому нативный PostgreSQL-стиль не сработает.
"""

from __future__ import annotations

from db import db_async as aiosqlite
from db.db_core import DB_NAME

_table_ensured = False


# ── Инициализация таблицы ─────────────────────────────────────────────────────

async def ensure_table() -> None:
    """Создаёт таблицу user_pity, если она ещё не существует.

    Вызывается автоматически перед первым обращением к таблице.
    Основная инициализация происходит через db_init.init_db() при старте,
    поэтому ensure_table() является просто защитным слоем.
    """
    global _table_ensured
    if _table_ensured:
        return
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_pity (
                tg_id          BIGINT  NOT NULL,
                game_key       TEXT    NOT NULL,
                pity_count     INTEGER NOT NULL DEFAULT 0,
                cooldown_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (tg_id, game_key)
            )
        """)
        await db.commit()
    _table_ensured = True


# ── Чтение / запись ───────────────────────────────────────────────────────────

async def get_pity(tg_id: int, game_key: str) -> tuple[int, int]:
    """
    Возвращает (pity_count, cooldown_count) для пользователя.
    Если записи нет — возвращает (0, 0).
    """
    await ensure_table()
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT pity_count, cooldown_count FROM user_pity "
            "WHERE tg_id = ? AND game_key = ?",
            (tg_id, game_key),
        ) as cursor:
            row = await cursor.fetchone()
            if row:
                return int(row["pity_count"]), int(row["cooldown_count"])
            return 0, 0


async def set_pity(
    tg_id: int,
    game_key: str,
    pity_count: int,
    cooldown_count: int,
) -> None:
    """Записывает или обновляет счётчики пити и кулдауна."""
    await ensure_table()
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            """
            INSERT INTO user_pity (tg_id, game_key, pity_count, cooldown_count)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (tg_id, game_key) DO UPDATE
                SET pity_count     = EXCLUDED.pity_count,
                    cooldown_count = EXCLUDED.cooldown_count
            """,
            (tg_id, game_key, pity_count, cooldown_count),
        )
        await db.commit()


# ── Высокоуровневые хелперы ───────────────────────────────────────────────────

async def on_jackpot(tg_id: int, game_key: str, cooldown_start: int = 5) -> None:
    """
    Вызывается сразу после выпадения джекпота.
    Сбрасывает pity_count в 0 и устанавливает кулдаун.
    """
    await set_pity(tg_id, game_key, pity_count=0, cooldown_count=cooldown_start)


async def on_no_jackpot(tg_id: int, game_key: str) -> None:
    """
    Вызывается после обычного (не джекпот) спина.
    Инкрементирует pity_count, уменьшает cooldown_count (минимум 0).
    """
    pity, cooldown = await get_pity(tg_id, game_key)
    await set_pity(
        tg_id,
        game_key,
        pity_count     = pity + 1,
        cooldown_count = max(0, cooldown - 1),
    )
