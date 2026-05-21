"""
db/db_nft.py
Функции базы данных для NFT Галереи.
Отдельный баланс NFT-звёзд, картины, коллекция пользователя.

Используется синтаксис "?" (SQLite-стиль), который db_async._translate_sql
автоматически конвертирует в "%s" для psycopg3.
Методы: db.execute() + .fetchone()/.fetchall() — db.fetch/fetchrow не существуют.
"""

from db import db_async as aiosqlite
from db.db_core import DB_NAME


# ─── Синхронизация каталога при старте ───────────────────────────────────────

async def sync_catalog(paintings: list[dict]) -> None:
    """
    Вызывается при старте сервера.
    Каждая запись из nft_catalog.py добавляется или обновляется в БД.
    sold_count у существующих картин не сбрасывается.
    """
    if not paintings:
        return
    async with aiosqlite.connect(DB_NAME) as db:
        for p in paintings:
            if not p.get("title") or not p.get("image_url") or not p.get("price"):
                continue
            async with db.execute(
                "SELECT id FROM nft_paintings WHERE title = ?", (p["title"],)
            ) as cur:
                existing = await cur.fetchone()
            if existing:
                await db.execute(
                    """
                    UPDATE nft_paintings
                    SET description  = ?,
                        image_url    = ?,
                        price        = ?,
                        total_supply = ?,
                        is_active    = ?
                    WHERE title = ?
                    """,
                    (
                        p.get("description", ""),
                        p["image_url"],
                        p["price"],
                        p.get("total_supply", 0),
                        p.get("is_active", True),
                        p["title"],
                    ),
                )
            else:
                await db.execute(
                    """
                    INSERT INTO nft_paintings
                        (title, description, image_url, price, total_supply, is_active)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p["title"],
                        p.get("description", ""),
                        p["image_url"],
                        p["price"],
                        p.get("total_supply", 0),
                        p.get("is_active", True),
                    ),
                )
        await db.commit()


# ─── NFT Баланс ───────────────────────────────────────────────────────────────

async def get_nft_stars(user_id: int) -> int:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT nft_stars FROM users WHERE tg_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        return int(row["nft_stars"]) if row else 0


async def add_nft_stars(user_id: int, amount: int) -> int:
    """Пополнение NFT-баланса. Возвращает новый баланс."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "UPDATE users SET nft_stars = nft_stars + ? WHERE tg_id = ? RETURNING nft_stars",
            (amount, user_id),
        ) as cur:
            row = await cur.fetchone()
        await db.commit()
        return int(row["nft_stars"]) if row else 0


async def spend_nft_stars(user_id: int, amount: int) -> tuple[bool, int]:
    """
    Списание NFT-звёзд при покупке.
    Возвращает (success, new_balance).
    """
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT nft_stars FROM users WHERE tg_id = ? FOR UPDATE", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        if not row or int(row["nft_stars"]) < amount:
            return False, int(row["nft_stars"]) if row else 0
        async with db.execute(
            "UPDATE users SET nft_stars = nft_stars - ? WHERE tg_id = ? RETURNING nft_stars",
            (amount, user_id),
        ) as cur:
            updated = await cur.fetchone()
        await db.commit()
        return True, int(updated["nft_stars"]) if updated else 0


# ─── Картины ──────────────────────────────────────────────────────────────────

async def get_active_paintings() -> list[dict]:
    """Все активные картины в магазине."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            SELECT id, title, description, image_url, price,
                   total_supply, sold_count, created_at
            FROM nft_paintings
            WHERE is_active = TRUE
            ORDER BY created_at DESC
            """
        ) as cur:
            rows = await cur.fetchall()
        result = []
        for r in rows:
            available = None
            if r["total_supply"] and r["total_supply"] > 0:
                available = r["total_supply"] - r["sold_count"]
            result.append({
                "id":           r["id"],
                "title":        r["title"],
                "description":  r["description"] or "",
                "image_url":    r["image_url"],
                "price":        r["price"],
                "total_supply": r["total_supply"],
                "sold_count":   r["sold_count"],
                "available":    available,
            })
        return result


async def get_painting(painting_id: int) -> dict | None:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT * FROM nft_paintings WHERE id = ?", (painting_id,)
        ) as cur:
            row = await cur.fetchone()
        if not row:
            return None
        return dict(row)


async def create_painting(
    title: str,
    description: str,
    image_url: str,
    price: int,
    total_supply: int = 0,
) -> dict:
    """Создание новой картины (вызывается из админки)."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            INSERT INTO nft_paintings (title, description, image_url, price, total_supply)
            VALUES (?, ?, ?, ?, ?)
            RETURNING *
            """,
            (title, description, image_url, price, total_supply),
        ) as cur:
            row = await cur.fetchone()
        await db.commit()
        return dict(row)


async def toggle_painting(painting_id: int, is_active: bool) -> bool:
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "UPDATE nft_paintings SET is_active = ? WHERE id = ?",
            (is_active, painting_id),
        )
        await db.commit()
        return True


async def delete_painting(painting_id: int) -> bool:
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("DELETE FROM nft_paintings WHERE id = ?", (painting_id,))
        await db.commit()
        return True


# ─── Покупка / Коллекция ──────────────────────────────────────────────────────

async def buy_painting(user_id: int, painting_id: int) -> tuple[bool, str]:
    """
    Атомарная покупка картины.
    Возвращает (success, error_message).
    """
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT id FROM nft_owned WHERE user_id = ? AND painting_id = ?",
            (user_id, painting_id),
        ) as cur:
            exists = await cur.fetchone()
        if exists:
            return False, "already_owned"

        async with db.execute(
            "SELECT * FROM nft_paintings WHERE id = ? FOR UPDATE", (painting_id,)
        ) as cur:
            painting = await cur.fetchone()
        if not painting or not painting["is_active"]:
            return False, "not_found"

        if painting["total_supply"] and painting["total_supply"] > 0:
            if painting["sold_count"] >= painting["total_supply"]:
                return False, "sold_out"

        price = painting["price"]
        async with db.execute(
            "SELECT nft_stars FROM users WHERE tg_id = ? FOR UPDATE", (user_id,)
        ) as cur:
            user = await cur.fetchone()
        if not user or int(user["nft_stars"]) < price:
            return False, "not_enough_stars"

        await db.execute(
            "UPDATE users SET nft_stars = nft_stars - ? WHERE tg_id = ?",
            (price, user_id),
        )
        await db.execute(
            "INSERT INTO nft_owned (user_id, painting_id) VALUES (?, ?)",
            (user_id, painting_id),
        )
        await db.execute(
            "UPDATE nft_paintings SET sold_count = sold_count + 1 WHERE id = ?",
            (painting_id,),
        )
        await db.commit()
        return True, "ok"


async def get_user_gallery(user_id: int) -> list[dict]:
    """Все картины пользователя."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            SELECT p.id, p.title, p.description, p.image_url, p.price,
                   p.total_supply, p.sold_count, o.acquired_at
            FROM nft_owned o
            JOIN nft_paintings p ON p.id = o.painting_id
            WHERE o.user_id = ?
            ORDER BY o.acquired_at DESC
            """,
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def get_gallery_owners(painting_id: int, limit: int = 20) -> list[dict]:
    """Список владельцев конкретной картины."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            SELECT u.tg_id, u.username, u.first_name, u.photo_url,
                   u.is_anonymous, o.acquired_at
            FROM nft_owned o
            JOIN users u ON u.tg_id = o.user_id
            WHERE o.painting_id = ?
            ORDER BY o.acquired_at ASC
            LIMIT ?
            """,
            (painting_id, limit),
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def get_all_galleries(limit: int = 50) -> list[dict]:
    """Топ пользователей с наибольшими коллекциями (для раздела «Галереи»)."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            SELECT u.tg_id, u.username, u.first_name, u.photo_url,
                   u.is_anonymous, COUNT(o.id) as collection_size
            FROM nft_owned o
            JOIN users u ON u.tg_id = o.user_id
            GROUP BY u.tg_id, u.username, u.first_name, u.photo_url, u.is_anonymous
            ORDER BY collection_size DESC
            LIMIT ?
            """,
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]


# ─── Все картины для админки ───────────────────────────────────────────────────

async def get_all_paintings_admin() -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            SELECT id, title, description, image_url, price,
                   total_supply, sold_count, is_active, created_at
            FROM nft_paintings
            ORDER BY created_at DESC
            """
        ) as cur:
            rows = await cur.fetchall()
        return [dict(r) for r in rows]
