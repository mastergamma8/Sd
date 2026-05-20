# db_history.py
# История действий пользователей и выполненные задания.

from db import db_async as aiosqlite
from db.db_core import DB_NAME


# ==========================================
# ЗАДАНИЯ
# ==========================================

async def get_completed_tasks(user_id: int) -> list[int]:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT task_id FROM user_tasks WHERE user_id = ?", (user_id,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [row[0] for row in rows]

async def mark_task_completed(user_id: int, task_id: int):
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "INSERT OR IGNORE INTO user_tasks (user_id, task_id) VALUES (?, ?)",
            (user_id, task_id)
        )
        await db.commit()


# ==========================================
# ИСТОРИЯ ДЕЙСТВИЙ
# ==========================================

async def add_history_entry(user_id: int, action_type: str, description: str, amount: float):
    import time
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            INSERT INTO user_history (user_id, action_type, description, amount, created_at)
            VALUES (?, ?, ?, ?, ?)
        """, (user_id, action_type, description, amount, int(time.time())))
        await db.commit()

async def log_action(user_id: int, action_type: str, description: str, amount: float):
    """Алиас add_history_entry, используется в gifts.py."""
    await add_history_entry(user_id, action_type, description, amount)

async def get_user_history(user_id: int, limit: int = 30, offset: int = 0):
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT id, action_type, description, amount, created_at
            FROM user_history
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?
        """, (user_id, limit, offset)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def get_user_history_count(user_id: int) -> int:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM user_history WHERE user_id = ?", (user_id,)
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else 0
