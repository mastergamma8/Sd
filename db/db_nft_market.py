"""
db/db_nft_market.py — База данных для NFT Маркетплейса и Аукционов.

Маркетплейс: пользователь выставляет картину по фиксированной цене в NFT-звёздах.
Аукцион:     пользователь запускает торги на заданное время; при перебивании ставки
             предыдущая сумма возвращается автоматически.
"""

import time
from db import db_async as aiosqlite
from db.db_core import DB_NAME

# Допустимые длительности аукциона в часах
ALLOWED_DURATIONS = (1, 3, 6, 12, 24, 48)


# ─── Внутренний хелпер ────────────────────────────────────────────────────────

async def _finalize_expired(db) -> list[dict]:
    """
    Завершить все аукционы с истёкшим сроком внутри уже открытого соединения.
    Победитель получает NFT, продавец — звёзды. Если ставок не было — NFT
    возвращается продавцу.
    Возвращает список завершённых аукционов с деталями для уведомлений.
    """
    now = int(time.time())
    db.row_factory = aiosqlite.Row
    async with db.execute(
        """SELECT a.id, a.seller_id, a.nft_owned_id, a.current_price, a.current_bidder,
                  p.title
           FROM nft_auctions a
           JOIN nft_paintings p ON p.id = a.painting_id
           WHERE a.status = 'active' AND a.ends_at <= ?""",
        (now,),
    ) as cur:
        expired = await cur.fetchall()
    db.row_factory = None

    finalized = []
    for a in expired:
        owned_id = a["nft_owned_id"]
        if a["current_bidder"]:
            # Передаём NFT победителю
            await db.execute(
                "UPDATE nft_owned SET user_id = ?, status = 'held' WHERE id = ?",
                (a["current_bidder"], owned_id),
            )
            # Начисляем финальную ставку продавцу
            await db.execute(
                "UPDATE users SET nft_stars = nft_stars + ? WHERE tg_id = ?",
                (a["current_price"], a["seller_id"]),
            )
        else:
            # Ставок нет — просто снимаем блокировку
            await db.execute(
                "UPDATE nft_owned SET status = 'held' WHERE id = ?",
                (owned_id,),
            )
        await db.execute(
            "UPDATE nft_auctions SET status = 'ended', ended_at = ? WHERE id = ?",
            (now, a["id"]),
        )
        finalized.append({
            "auction_id":    a["id"],
            "seller_id":     a["seller_id"],
            "winner_id":     a["current_bidder"],
            "final_price":   a["current_price"],
            "title":         a["title"],
        })

    if expired:
        await db.commit()

    return finalized


async def get_and_clear_finalized_auctions() -> list[dict]:
    """
    Публичный хелпер: завершает просроченные аукционы и возвращает список
    только что завершённых лотов (для отправки уведомлений в боте).
    """
    async with aiosqlite.connect(DB_NAME) as db:
        return await _finalize_expired(db)


# ─── Маркетплейс (фиксированная цена) ────────────────────────────────────────

async def get_active_listings(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT ml.id,
                      ml.seller_id, ml.nft_owned_id, ml.painting_id,
                      ml.price, ml.created_at,
                      p.title, p.description, p.image_url, p.total_supply,
                      o.serial_number,
                      u.username, u.first_name,
                      COALESCE(u.is_anonymous, 0) AS is_anonymous
               FROM nft_market_listings ml
               JOIN nft_paintings p ON p.id    = ml.painting_id
               JOIN nft_owned     o ON o.id    = ml.nft_owned_id
               JOIN users         u ON u.tg_id = ml.seller_id
               WHERE ml.status = 'active'
               ORDER BY ml.created_at DESC
               LIMIT ?""",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def create_listing(seller_id: int, nft_owned_id: int, price: int) -> tuple[bool, str]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, user_id, painting_id, status FROM nft_owned WHERE id = ? AND user_id = ?",
            (nft_owned_id, seller_id),
        ) as cur:
            owned = await cur.fetchone()
        db.row_factory = None

        if not owned:
            return False, "not_owned"
        if owned["status"] != "held":
            return False, "already_listed"

        now = int(time.time())
        await db.execute(
            """INSERT INTO nft_market_listings
               (seller_id, nft_owned_id, painting_id, price, status, created_at)
               VALUES (?, ?, ?, ?, 'active', ?)""",
            (seller_id, nft_owned_id, owned["painting_id"], price, now),
        )
        await db.execute(
            "UPDATE nft_owned SET status = 'for_sale' WHERE id = ?",
            (nft_owned_id,),
        )
        await db.commit()
        return True, "ok"


async def cancel_listing(listing_id: int, seller_id: int) -> tuple[bool, str]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, seller_id, nft_owned_id, status FROM nft_market_listings WHERE id = ?",
            (listing_id,),
        ) as cur:
            listing = await cur.fetchone()
        db.row_factory = None

        if not listing:
            return False, "not_found"
        if listing["seller_id"] != seller_id:
            return False, "not_owner"
        if listing["status"] != "active":
            return False, "not_active"

        await db.execute(
            "UPDATE nft_market_listings SET status = 'cancelled' WHERE id = ?",
            (listing_id,),
        )
        await db.execute(
            "UPDATE nft_owned SET status = 'held' WHERE id = ?",
            (listing["nft_owned_id"],),
        )
        await db.commit()
        return True, "ok"


async def buy_listing(listing_id: int, buyer_id: int) -> tuple[bool, str | dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT ml.id, ml.seller_id, ml.nft_owned_id, ml.painting_id, ml.price,
                      ml.status, p.title
               FROM nft_market_listings ml
               JOIN nft_paintings p ON p.id = ml.painting_id
               WHERE ml.id = ?""",
            (listing_id,),
        ) as cur:
            listing = await cur.fetchone()
        db.row_factory = None

        if not listing:
            return False, "not_found"
        if listing["status"] != "active":
            return False, "not_active"
        if listing["seller_id"] == buyer_id:
            return False, "own_listing"

        price     = listing["price"]
        seller_id = listing["seller_id"]
        owned_id  = listing["nft_owned_id"]
        title     = listing["title"]

        # Атомарное списание звёзд у покупателя
        cur2 = await db.execute(
            "UPDATE users SET nft_stars = nft_stars - ? WHERE tg_id = ? AND nft_stars >= ?",
            (price, buyer_id, price),
        )
        await db.commit()
        if cur2.rowcount != 1:
            return False, "not_enough_stars"

        # Зачисление продавцу
        await db.execute(
            "UPDATE users SET nft_stars = nft_stars + ? WHERE tg_id = ?",
            (price, seller_id),
        )
        # Смена владельца NFT
        await db.execute(
            "UPDATE nft_owned SET user_id = ?, status = 'held' WHERE id = ?",
            (buyer_id, owned_id),
        )
        # Закрываем листинг
        await db.execute(
            "UPDATE nft_market_listings SET status = 'sold', buyer_id = ?, sold_at = ? WHERE id = ?",
            (buyer_id, int(time.time()), listing_id),
        )
        await db.commit()
        return True, {"price": price, "seller_id": seller_id, "title": title}


# ─── Аукционы ─────────────────────────────────────────────────────────────────

async def get_active_auctions(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        await _finalize_expired(db)
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT a.id,
                      a.seller_id, a.painting_id, a.nft_owned_id,
                      a.start_price, a.current_price,
                      a.current_bidder, a.status, a.ends_at, a.created_at,
                      p.title, p.description, p.image_url,
                      p.total_supply, p.sold_count,
                      o.serial_number,
                      u.username, u.first_name,
                      COALESCE(u.is_anonymous, 0) AS is_anonymous
               FROM nft_auctions a
               JOIN nft_paintings p ON p.id    = a.painting_id
               JOIN nft_owned     o ON o.id    = a.nft_owned_id
               JOIN users         u ON u.tg_id = a.seller_id
               WHERE a.status = 'active'
               ORDER BY a.ends_at ASC
               LIMIT ?""",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def create_auction(
    seller_id: int,
    nft_owned_id: int,
    start_price: int,
    duration_hours: int,
) -> tuple[bool, str]:
    if duration_hours not in ALLOWED_DURATIONS:
        return False, "invalid_duration"

    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, user_id, painting_id, status FROM nft_owned WHERE id = ? AND user_id = ?",
            (nft_owned_id, seller_id),
        ) as cur:
            owned = await cur.fetchone()
        db.row_factory = None

        if not owned:
            return False, "not_owned"
        if owned["status"] != "held":
            return False, "already_listed"

        now     = int(time.time())
        ends_at = now + duration_hours * 3600

        await db.execute(
            """INSERT INTO nft_auctions
               (seller_id, nft_owned_id, painting_id,
                start_price, current_price, status, ends_at, created_at)
               VALUES (?, ?, ?, ?, ?, 'active', ?, ?)""",
            (seller_id, nft_owned_id, owned["painting_id"],
             start_price, start_price, ends_at, now),
        )
        await db.execute(
            "UPDATE nft_owned SET status = 'in_auction' WHERE id = ?",
            (nft_owned_id,),
        )
        await db.commit()
        return True, "ok"


async def place_bid(auction_id: int, bidder_id: int, amount: int) -> tuple[bool, str | dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        await _finalize_expired(db)
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT a.id, a.seller_id, a.nft_owned_id, a.current_price,
                      a.current_bidder, a.status, a.ends_at, p.title
               FROM nft_auctions a
               JOIN nft_paintings p ON p.id = a.painting_id
               WHERE a.id = ?""",
            (auction_id,),
        ) as cur:
            auction = await cur.fetchone()
        db.row_factory = None

        if not auction:
            return False, "not_found"
        if auction["status"] != "active":
            return False, "not_active"
        if auction["ends_at"] <= int(time.time()):
            return False, "ended"
        if auction["seller_id"] == bidder_id:
            return False, "own_auction"
        if amount <= auction["current_price"]:
            return False, "bid_too_low"

        prev_bidder = auction["current_bidder"]
        prev_price  = auction["current_price"]
        title       = auction["title"]

        # Атомарное списание у нового участника
        cur2 = await db.execute(
            "UPDATE users SET nft_stars = nft_stars - ? WHERE tg_id = ? AND nft_stars >= ?",
            (amount, bidder_id, amount),
        )
        await db.commit()
        if cur2.rowcount != 1:
            return False, "not_enough_stars"

        # Возврат предыдущему участнику
        if prev_bidder:
            await db.execute(
                "UPDATE users SET nft_stars = nft_stars + ? WHERE tg_id = ?",
                (prev_price, prev_bidder),
            )

        await db.execute(
            "UPDATE nft_auctions SET current_price = ?, current_bidder = ? WHERE id = ?",
            (amount, bidder_id, auction_id),
        )
        await db.commit()
        return True, {
            "title":       title,
            "prev_bidder": prev_bidder,
            "prev_price":  prev_price,
            "new_amount":  amount,
        }


async def cancel_auction(auction_id: int, seller_id: int) -> tuple[bool, str]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT id, seller_id, nft_owned_id, current_bidder, status
               FROM nft_auctions WHERE id = ?""",
            (auction_id,),
        ) as cur:
            auction = await cur.fetchone()
        db.row_factory = None

        if not auction:
            return False, "not_found"
        if auction["seller_id"] != seller_id:
            return False, "not_owner"
        if auction["status"] != "active":
            return False, "not_active"
        if auction["current_bidder"]:
            return False, "has_bids"

        await db.execute(
            "UPDATE nft_auctions SET status = 'cancelled', ended_at = ? WHERE id = ?",
            (int(time.time()), auction_id),
        )
        await db.execute(
            "UPDATE nft_owned SET status = 'held' WHERE id = ?",
            (auction["nft_owned_id"],),
        )
        await db.commit()
        return True, "ok"