"""
db/db_nft.py  —  База данных для NFT Галереи (SQLite / aiosqlite).
"""

import time
from db import db_async as aiosqlite
from db.db_core import DB_NAME


# ─── Синхронизация каталога при старте ───────────────────────────────────────

async def sync_catalog(paintings: list[dict]) -> None:
    if not paintings:
        return
    async with aiosqlite.connect(DB_NAME) as db:
        for p in paintings:
            if not p.get("title") or not p.get("image_url") or not p.get("price"):
                continue
            async with db.execute(
                "SELECT id FROM nft_paintings WHERE title = ?", (p["title"],)
            ) as cur:
                row = await cur.fetchone()
            if row:
                await db.execute(
                    """UPDATE nft_paintings
                       SET description=?, image_url=?, price=?, total_supply=?, is_active=?
                       WHERE title=?""",
                    (p.get("description",""), p["image_url"], p["price"],
                     p.get("total_supply", 0), bool(p.get("is_active", True)),
                     p["title"]),
                )
            else:
                await db.execute(
                    """INSERT INTO nft_paintings
                         (title, description, image_url, price, total_supply, is_active, created_at)
                       VALUES (?,?,?,?,?,?,?)""",
                    (p["title"], p.get("description",""), p["image_url"], p["price"],
                     p.get("total_supply", 0), bool(p.get("is_active", True)),
                     int(time.time())),
                )
        await db.commit()


# ─── NFT Баланс ───────────────────────────────────────────────────────────────

async def get_nft_stars(user_id: int) -> int:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT nft_stars FROM users WHERE tg_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        return int(row[0]) if row else 0


async def add_nft_stars(user_id: int, amount: int) -> int:
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "UPDATE users SET nft_stars = nft_stars + ? WHERE tg_id = ?",
            (amount, user_id),
        )
        await db.commit()
        async with db.execute(
            "SELECT nft_stars FROM users WHERE tg_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
        return int(row[0]) if row else 0


# ─── Картины ──────────────────────────────────────────────────────────────────

async def get_active_paintings() -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT id, title, description, image_url, price,
                      total_supply, sold_count, created_at
               FROM nft_paintings WHERE is_active=1 ORDER BY created_at DESC"""
        ) as cur:
            rows = await cur.fetchall()
    result = []
    for r in rows:
        ts = r["total_supply"]
        sc = r["sold_count"]
        available = (ts - sc) if ts and ts > 0 else None
        result.append({
            "id":           r["id"],
            "title":        r["title"],
            "description":  r["description"] or "",
            "image_url":    r["image_url"],
            "price":        r["price"],
            "total_supply": ts,
            "sold_count":   sc,
            "available":    available,
        })
    return result


# ─── Покупка / Коллекция ──────────────────────────────────────────────────────

async def buy_painting(user_id: int, painting_id: int) -> tuple[bool, str]:
    async with aiosqlite.connect(DB_NAME) as db:
        # Уже куплено?
        async with db.execute(
            "SELECT id FROM nft_owned WHERE user_id=? AND painting_id=?",
            (user_id, painting_id),
        ) as cur:
            if await cur.fetchone():
                return False, "already_owned"

        # Картина существует?
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, price, total_supply, sold_count, is_active FROM nft_paintings WHERE id=?",
            (painting_id,),
        ) as cur:
            painting = await cur.fetchone()
        db.row_factory = None

        if not painting or not painting["is_active"]:
            return False, "not_found"

        ts = painting["total_supply"]
        if ts and ts > 0 and painting["sold_count"] >= ts:
            return False, "sold_out"

        price = painting["price"]

        # Достаточно NFT-звёзд? (атомарное списание)
        cur2 = await db.execute(
            "UPDATE users SET nft_stars = nft_stars - ? WHERE tg_id=? AND nft_stars >= ?",
            (price, user_id, price),
        )
        await db.commit()
        if cur2.rowcount != 1:
            return False, "not_enough_stars"

        # Добавляем в коллекцию
        try:
            await db.execute(
                "INSERT INTO nft_owned (user_id, painting_id, acquired_at) VALUES (?,?,?)",
                (user_id, painting_id, int(time.time())),
            )
        except Exception:
            # Если гонка — откатываем списание
            await db.execute(
                "UPDATE users SET nft_stars = nft_stars + ? WHERE tg_id=?",
                (price, user_id),
            )
            await db.commit()
            return False, "already_owned"

        await db.execute(
            "UPDATE nft_paintings SET sold_count = sold_count + 1 WHERE id=?",
            (painting_id,),
        )
        await db.commit()
        return True, "ok"


async def get_user_gallery(user_id: int) -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT p.id, p.title, p.description, p.image_url,
                      p.price, p.total_supply, p.sold_count, o.acquired_at
               FROM nft_owned o JOIN nft_paintings p ON p.id = o.painting_id
               WHERE o.user_id=? ORDER BY o.acquired_at DESC""",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def get_all_galleries(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT u.tg_id, u.username, u.first_name,
                      COALESCE(u.is_anonymous,0) as is_anonymous,
                      COUNT(o.id) as collection_size
               FROM nft_owned o JOIN users u ON u.tg_id = o.user_id
               GROUP BY u.tg_id, u.username, u.first_name, u.is_anonymous
               ORDER BY collection_size DESC LIMIT ?""",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]