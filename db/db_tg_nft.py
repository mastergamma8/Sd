"""
db/db_tg_nft.py — Инвентарь уникальных (NFT) Telegram-подарков.

Таблица tg_nft_inventory:
  tg_gift_id       — PRIMARY dedup-ключ (= owned_gift_id если есть, иначе UniqueGift.name)
  owned_gift_id    — сырой owned_gift_id из Telegram API (официальный ID для бизнес-аккаунтов)
  gift_name        — UniqueGift.name ("HatOfWisdom")
  base_name        — UniqueGift.base_name ("Hat of Wisdom")
  number           — UniqueGift.number (коллекционный номер, НЕ serial_number)
  business_conn_id — business_connection_id: нужен для будущей сверки инвентаря с Telegram API
  received_at      — Unix-timestamp получения
"""

import time
from db import db_async as aiosqlite
from db.db_core import DB_NAME


async def add_tg_nft_to_user(
    user_id: int,
    tg_gift_id: str,
    owned_gift_id: str = "",
    gift_name: str = "",
    base_name: str = "",
    number: int = 0,
    sticker_emoji: str = "",
    sticker_file_id: str = "",
    business_conn_id: str = "",
) -> bool:
    """
    Записывает уникальный Telegram-подарок в инвентарь пользователя.

    Дедупликация реализована через UNIQUE(tg_gift_id) + ON CONFLICT DO NOTHING.
    Возвращает True если запись создана, False если подарок уже существует.
    Отдельный pre-check (tg_nft_exists) не нужен — он был лишним запросом
    с окном гонки; результат rowcount == 1 полностью достаточен.
    """
    async with aiosqlite.connect(DB_NAME) as db:
        cur = await db.execute(
            """
            INSERT INTO tg_nft_inventory
                (user_id, tg_gift_id, owned_gift_id, gift_name, base_name,
                 number, sticker_emoji, sticker_file_id, business_conn_id, received_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (tg_gift_id) DO NOTHING
            """,
            (
                user_id, tg_gift_id, owned_gift_id, gift_name, base_name,
                number, sticker_emoji, sticker_file_id, business_conn_id,
                int(time.time()),
            ),
        )
        await db.commit()
        return cur.rowcount == 1


async def get_user_tg_nft_inventory(user_id: int) -> list[dict]:
    """Возвращает все уникальные Telegram-подарки пользователя (новые первые)."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT id, tg_gift_id, owned_gift_id, gift_name, base_name,
                   number, sticker_emoji, sticker_file_id, business_conn_id, received_at
            FROM tg_nft_inventory
            WHERE user_id = ?
            ORDER BY received_at DESC
            """,
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def get_tg_nft_by_gift_id(tg_gift_id: str) -> dict | None:
    """Возвращает запись по dedup-ключу tg_gift_id."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT id, user_id, tg_gift_id, owned_gift_id, gift_name, base_name,
                   number, sticker_emoji, sticker_file_id, business_conn_id, received_at
            FROM tg_nft_inventory
            WHERE tg_gift_id = ?
            """,
            (tg_gift_id,),
        ) as cur:
            row = await cur.fetchone()
    return dict(row) if row else None


async def get_tg_nft_inventory_count(user_id: int) -> int:
    """Количество уникальных Telegram-подарков у пользователя."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM tg_nft_inventory WHERE user_id = ?",
            (user_id,),
        ) as cur:
            row = await cur.fetchone()
    return int(row[0]) if row else 0


# ── Business-connection helpers ───────────────────────────────────────────────

async def save_business_connection(conn_id: str) -> None:
    """Сохраняет business_connection_id и помечает его как активный.
    Повторные вызовы идемпотентны; при переподключении is_active сбрасывается в 1."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            """
            INSERT INTO business_connections (conn_id, saved_at, is_active)
            VALUES (?, ?, 1)
            ON CONFLICT(conn_id) DO UPDATE SET is_active = 1, saved_at = excluded.saved_at
            """,
            (conn_id, int(time.time())),
        )
        await db.commit()


async def deactivate_business_connection(conn_id: str) -> None:
    """Помечает business_connection_id как неактивный (отключён или протух).
    Такие соединения не будут использоваться при следующей синхронизации."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "UPDATE business_connections SET is_active = 0 WHERE conn_id = ?",
            (conn_id,),
        )
        await db.commit()


async def get_business_connections() -> list[str]:
    """Возвращает только активные business_connection_id."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT conn_id FROM business_connections WHERE is_active = 1 ORDER BY saved_at"
        ) as cur:
            rows = await cur.fetchall()
    return [r[0] for r in rows]


# ── Regular-gift dedup (historical sync) ─────────────────────────────────────

async def is_regular_gift_synced(owned_gift_id: str) -> bool:
    """True если обычный подарок с таким owned_gift_id уже занесён при синхронизации."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT 1 FROM tg_regular_gift_sync_log WHERE owned_gift_id = ?",
            (owned_gift_id,),
        ) as cur:
            return (await cur.fetchone()) is not None


async def mark_regular_gift_synced(owned_gift_id: str, user_id: int) -> None:
    """Помечает обычный подарок как синхронизированный."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            """
            INSERT OR IGNORE INTO tg_regular_gift_sync_log (owned_gift_id, user_id, synced_at)
            VALUES (?, ?, ?)
            """,
            (owned_gift_id, user_id, int(time.time())),
        )
        await db.commit()