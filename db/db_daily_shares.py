# db/db_daily_shares.py
# Ежедневный счётчик отправки реферальной ссылки.
# Каждая отправка (нажатие «Поделиться») инкрементирует счётчик за текущую дату.
# Для бесплатного спина/кейса требуется share_count >= DAILY_SHARE_REQUIRED (3).

import datetime
from db import db_async as aiosqlite
from db.db_core import DB_NAME

DAILY_SHARE_REQUIRED = 3  # сколько шерингов нужно сделать за день


def _today() -> str:
    """Возвращает текущую дату в формате YYYY-MM-DD (UTC)."""
    return datetime.datetime.utcnow().strftime("%Y-%m-%d")


async def get_daily_share_count(tg_id: int) -> int:
    """Возвращает количество шерингов реферальной ссылки пользователем сегодня."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT share_count FROM daily_ref_shares WHERE tg_id = ? AND share_date = ?",
            (tg_id, _today()),
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else 0


async def increment_daily_share(tg_id: int) -> int:
    """Инкрементирует счётчик шерингов на 1 и возвращает новое значение.
    Максимум фиксируется на DAILY_SHARE_REQUIRED через LEAST(), чтобы
    не накапливать лишние клики сверх нужного порога."""
    today = _today()
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            INSERT INTO daily_ref_shares (tg_id, share_date, share_count)
            VALUES (?, ?, 1)
            ON CONFLICT (tg_id, share_date)
            DO UPDATE SET share_count = LEAST(daily_ref_shares.share_count + 1, 3)
        """, (tg_id, today))
        await db.commit()

        async with db.execute(
            "SELECT share_count FROM daily_ref_shares WHERE tg_id = ? AND share_date = ?",
            (tg_id, today),
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else 1


async def has_shared_enough(tg_id: int) -> bool:
    """True если пользователь уже отправил ссылку нужное количество раз сегодня."""
    return await get_daily_share_count(tg_id) >= DAILY_SHARE_REQUIRED
