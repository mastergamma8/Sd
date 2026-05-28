"""
db/db_nft.py  —  База данных для NFT Галереи (SQLite / aiosqlite).
"""

import time
from db import db_async as aiosqlite
from db.db_core import DB_NAME


# ─── Синхронизация каталога при старте ───────────────────────────────────────

async def sync_packs(packs_data: list[dict]) -> None:
    """Sync pack definitions from nft_catalog.PACKS to DB.

    Поиск записи идёт по catalog_id (стабильный ключ из каталога).
    Если catalog_id не заполнен — откат на поиск по name для совместимости
    со старыми записями, которые были добавлены до введения id-логики.
    """
    if not packs_data:
        return
    async with aiosqlite.connect(DB_NAME) as db:
        for pack in packs_data:
            catalog_id = pack.get("id") or ""
            if not catalog_id and not pack.get("name"):
                continue

            paintings_in_pack = pack.get("paintings", [])
            cover = pack.get("cover_image_url") or (
                paintings_in_pack[0]["image_url"] if paintings_in_pack else ""
            )

            # ── Найти существующий пак ──────────────────────────────────────
            pack_db_id = None

            if catalog_id:
                # Основной путь: по стабильному catalog_id
                async with db.execute(
                    "SELECT id FROM nft_packs WHERE catalog_id = ?", (catalog_id,)
                ) as cur:
                    row = await cur.fetchone()
                if row:
                    pack_db_id = row[0]
                else:
                    # Обратная совместимость: запись могла быть создана до
                    # введения id — ищем по name и проставляем catalog_id
                    async with db.execute(
                        "SELECT id FROM nft_packs WHERE catalog_id IS NULL AND name = ?",
                        (pack["name"],),
                    ) as cur:
                        row = await cur.fetchone()
                    if row:
                        pack_db_id = row[0]
                        await db.execute(
                            "UPDATE nft_packs SET catalog_id = ? WHERE id = ?",
                            (catalog_id, pack_db_id),
                        )
            else:
                # Нет id в каталоге — старая логика по name
                async with db.execute(
                    "SELECT id FROM nft_packs WHERE name = ?", (pack["name"],)
                ) as cur:
                    row = await cur.fetchone()
                if row:
                    pack_db_id = row[0]

            # ── Обновить или создать пак ─────────────────────────────────────
            if pack_db_id:
                # Не трогаем is_active / is_archived у заархивированных паков
                await db.execute(
                    """UPDATE nft_packs
                       SET name=?, description=?, cover_image_url=?
                       WHERE id=? AND (is_archived IS NULL OR is_archived = FALSE)""",
                    (pack.get("name", ""), pack.get("description", ""), cover, pack_db_id),
                )
                await db.execute(
                    """UPDATE nft_packs
                       SET is_active=TRUE
                       WHERE id=? AND (is_archived IS NULL OR is_archived = FALSE)""",
                    (pack_db_id,),
                )
            else:
                async with db.execute(
                    """INSERT INTO nft_packs
                           (catalog_id, name, description, cover_image_url, is_active, created_at)
                       VALUES (?,?,?,?,TRUE,?) RETURNING id""",
                    (catalog_id or None, pack.get("name", ""),
                     pack.get("description", ""), cover, int(time.time())),
                ) as cur:
                    row2 = await cur.fetchone()
                pack_db_id = row2[0]

            # ── Синхронизировать картины пака ────────────────────────────────
            for p in paintings_in_pack:
                if not p.get("image_url") or not p.get("price"):
                    continue

                p_catalog_id = p.get("id") or ""
                p_title = p.get("title", "")

                painting_db_id = None

                if p_catalog_id:
                    async with db.execute(
                        "SELECT id FROM nft_paintings WHERE catalog_id = ?", (p_catalog_id,)
                    ) as cur:
                        row3 = await cur.fetchone()
                    if row3:
                        painting_db_id = row3[0]
                    else:
                        # Обратная совместимость: ищем по title без catalog_id
                        async with db.execute(
                            "SELECT id FROM nft_paintings WHERE catalog_id IS NULL AND title = ?",
                            (p_title,),
                        ) as cur:
                            row3 = await cur.fetchone()
                        if row3:
                            painting_db_id = row3[0]
                            await db.execute(
                                "UPDATE nft_paintings SET catalog_id = ? WHERE id = ?",
                                (p_catalog_id, painting_db_id),
                            )
                else:
                    # Нет id в каталоге — старая логика по title
                    async with db.execute(
                        "SELECT id FROM nft_paintings WHERE title = ?", (p_title,)
                    ) as cur:
                        row3 = await cur.fetchone()
                    if row3:
                        painting_db_id = row3[0]

                if painting_db_id:
                    await db.execute(
                        """UPDATE nft_paintings
                           SET title=?, description=?, image_url=?, price=?,
                               total_supply=?, is_active=?, pack_id=?
                           WHERE id=?""",
                        (p_title, p.get("description", ""), p["image_url"], p["price"],
                         p.get("total_supply", 0), bool(p.get("is_active", True)),
                         pack_db_id, painting_db_id),
                    )
                else:
                    await db.execute(
                        """INSERT INTO nft_paintings
                             (catalog_id, title, description, image_url, price,
                              total_supply, is_active, pack_id, created_at)
                           VALUES (?,?,?,?,?,?,?,?,?)""",
                        (p_catalog_id or None, p_title, p.get("description", ""),
                         p["image_url"], p["price"], p.get("total_supply", 0),
                         bool(p.get("is_active", True)), pack_db_id, int(time.time())),
                    )

        await db.commit()


async def get_packs_with_paintings() -> list[dict]:
    """Return all active packs with their paintings (for shop display)."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, name, description, cover_image_url FROM nft_packs WHERE is_active=TRUE ORDER BY created_at DESC"
        ) as cur:
            pack_rows = await cur.fetchall()

        result = []
        for pk in pack_rows:
            pack_id = pk["id"]
            async with db.execute(
                """SELECT id, title, description, image_url, price,
                          total_supply, sold_count, created_at
                   FROM nft_paintings
                   WHERE pack_id=? AND is_active=TRUE
                   ORDER BY created_at ASC""",
                (pack_id,),
            ) as cur2:
                p_rows = await cur2.fetchall()

            paintings = []
            for r in p_rows:
                ts = r["total_supply"]
                sc = r["sold_count"]
                available = (ts - sc) if ts and ts > 0 else None
                paintings.append({
                    "id":           r["id"],
                    "title":        r["title"],
                    "description":  r["description"] or "",
                    "image_url":    r["image_url"],
                    "price":        r["price"],
                    "total_supply": ts,
                    "sold_count":   sc,
                    "available":    available,
                    "pack_id":      pack_id,
                })

            cover = pk["cover_image_url"] or (paintings[0]["image_url"] if paintings else "")
            result.append({
                "id":              pack_id,
                "name":            pk["name"],
                "description":     pk["description"] or "",
                "cover_image_url": cover,
                "paintings":       paintings,
            })
        return result


async def sync_catalog(paintings: list[dict]) -> None:
    """Sync standalone paintings (without pack) from nft_catalog.PAINTINGS to DB.

    Поиск идёт по catalog_id; при его отсутствии — откат на title.
    """
    if not paintings:
        return
    async with aiosqlite.connect(DB_NAME) as db:
        for p in paintings:
            if not p.get("image_url") or not p.get("price"):
                continue

            p_catalog_id = p.get("id") or ""
            p_title = p.get("title", "")

            painting_db_id = None

            if p_catalog_id:
                async with db.execute(
                    "SELECT id FROM nft_paintings WHERE catalog_id = ?", (p_catalog_id,)
                ) as cur:
                    row = await cur.fetchone()
                if row:
                    painting_db_id = row[0]
                else:
                    # Обратная совместимость: ищем по title и проставляем catalog_id
                    async with db.execute(
                        "SELECT id FROM nft_paintings WHERE catalog_id IS NULL AND title = ?",
                        (p_title,),
                    ) as cur:
                        row = await cur.fetchone()
                    if row:
                        painting_db_id = row[0]
                        await db.execute(
                            "UPDATE nft_paintings SET catalog_id = ? WHERE id = ?",
                            (p_catalog_id, painting_db_id),
                        )
            else:
                async with db.execute(
                    "SELECT id FROM nft_paintings WHERE title = ?", (p_title,)
                ) as cur:
                    row = await cur.fetchone()
                if row:
                    painting_db_id = row[0]

            if painting_db_id:
                await db.execute(
                    """UPDATE nft_paintings
                       SET title=?, description=?, image_url=?, price=?,
                           total_supply=?, is_active=?
                       WHERE id=?""",
                    (p_title, p.get("description", ""), p["image_url"], p["price"],
                     p.get("total_supply", 0), bool(p.get("is_active", True)),
                     painting_db_id),
                )
            else:
                await db.execute(
                    """INSERT INTO nft_paintings
                         (catalog_id, title, description, image_url, price,
                          total_supply, is_active, created_at)
                       VALUES (?,?,?,?,?,?,?,?)""",
                    (p_catalog_id or None, p_title, p.get("description", ""),
                     p["image_url"], p["price"], p.get("total_supply", 0),
                     bool(p.get("is_active", True)), int(time.time())),
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
               FROM nft_paintings WHERE is_active=TRUE AND pack_id IS NULL ORDER BY created_at DESC"""
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


# ─── Автоархивация пака ───────────────────────────────────────────────────────

async def _maybe_archive_pack(db, pack_id: int) -> bool:
    """
    Проверяет, все ли картины пака распроданы.
    Если да — переводит пак в архив (is_active=FALSE, is_archived=TRUE).
    Возвращает True, если пак был заархивирован прямо сейчас.
    """
    async with db.execute(
        """SELECT
               COUNT(*) AS total,
               COUNT(CASE WHEN total_supply > 0 AND sold_count >= total_supply THEN 1 END) AS sold_out,
               COUNT(CASE WHEN total_supply IS NULL OR total_supply = 0 THEN 1 END)        AS unlimited
           FROM nft_paintings
           WHERE pack_id = ? AND is_active = TRUE""",
        (pack_id,),
    ) as cur:
        row = await cur.fetchone()

    total, sold_out, unlimited = row[0], row[1], row[2]
    if total > 0 and unlimited == 0 and sold_out == total:
        await db.execute(
            """UPDATE nft_packs
               SET is_active = FALSE, is_archived = TRUE, archived_at = ?
               WHERE id = ?""",
            (int(time.time()), pack_id),
        )
        await db.commit()
        return True
    return False


async def get_archived_packs() -> list[dict]:
    """Возвращает все архивные паки (все картины распроданы) с их картинами."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT id, name, description, cover_image_url, archived_at
               FROM nft_packs
               WHERE is_archived = TRUE
               ORDER BY archived_at DESC"""
        ) as cur:
            pack_rows = await cur.fetchall()

        result = []
        for pk in pack_rows:
            pack_id = pk["id"]
            async with db.execute(
                """SELECT id, title, description, image_url, price,
                          total_supply, sold_count
                   FROM nft_paintings
                   WHERE pack_id = ?
                   ORDER BY created_at ASC""",
                (pack_id,),
            ) as cur2:
                p_rows = await cur2.fetchall()

            paintings = []
            for r in p_rows:
                paintings.append({
                    "id":           r["id"],
                    "title":        r["title"],
                    "description":  r["description"] or "",
                    "image_url":    r["image_url"],
                    "price":        r["price"],
                    "total_supply": r["total_supply"],
                    "sold_count":   r["sold_count"],
                    "available":    0,
                    "pack_id":      pack_id,
                })

            cover = pk["cover_image_url"] or (paintings[0]["image_url"] if paintings else "")
            result.append({
                "id":              pack_id,
                "name":            pk["name"],
                "description":     pk["description"] or "",
                "cover_image_url": cover,
                "archived_at":     pk["archived_at"],
                "paintings":       paintings,
            })
        return result


# ─── Покупка / Коллекция ──────────────────────────────────────────────────────

async def buy_painting(user_id: int, painting_id: int) -> tuple[bool, str]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, price, total_supply, sold_count, is_active, pack_id FROM nft_paintings WHERE id=?",
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

        cur2 = await db.execute(
            "UPDATE users SET nft_stars = nft_stars - ? WHERE tg_id=? AND nft_stars >= ?",
            (price, user_id, price),
        )
        await db.commit()
        if cur2.rowcount != 1:
            return False, "not_enough_stars"

        try:
            await db.execute(
                """INSERT INTO nft_owned (user_id, painting_id, acquired_at, serial_number)
                   VALUES (?, ?, ?, (
                       SELECT COALESCE(MAX(serial_number), 0) + 1
                       FROM nft_owned WHERE painting_id = ?
                   ))""",
                (user_id, painting_id, int(time.time()), painting_id),
            )
        except Exception:
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

        pack_id = painting["pack_id"]
        if pack_id:
            await _maybe_archive_pack(db, pack_id)

        return True, "ok"


async def get_user_gallery(user_id: int) -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT p.id, p.title, p.description, p.image_url,
                      p.price, p.total_supply, p.sold_count, o.acquired_at,
                      o.serial_number, o.id as owned_id, o.status,
                      ml.id   as listing_id,
                      au.id   as auction_id,
                      CASE WHEN au.current_bidder IS NOT NULL THEN 1 ELSE 0 END as has_bids,
                      p.pack_id,
                      pk.name as pack_name,
                      pk.cover_image_url as pack_cover
               FROM nft_owned o
               JOIN nft_paintings p ON p.id = o.painting_id
               LEFT JOIN nft_packs pk ON pk.id = p.pack_id
               LEFT JOIN nft_market_listings ml
                      ON ml.nft_owned_id = o.id AND ml.status = 'active'
               LEFT JOIN nft_auctions au
                      ON au.nft_owned_id = o.id AND au.status = 'active'
               WHERE o.user_id=? ORDER BY o.acquired_at DESC""",
            (user_id,),
        ) as cur:
            rows = await cur.fetchall()
    result = []
    for r in rows:
        d = dict(r)
        ts = d.get("total_supply") or 0
        sc = d.get("sold_count") or 0
        d["available"] = (ts - sc) if ts > 0 else None
        result.append(d)
    return result


async def get_all_galleries(limit: int = 50) -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT u.tg_id, u.username, u.first_name,
                      COALESCE(u.is_anonymous,0) as is_anonymous,
                      CASE WHEN u.is_anonymous = 1 THEN NULL ELSE u.photo_url END AS photo_url,
                      COUNT(o.id) as collection_size
               FROM nft_owned o JOIN users u ON u.tg_id = o.user_id
               GROUP BY u.tg_id, u.username, u.first_name, u.is_anonymous, u.photo_url
               ORDER BY collection_size DESC LIMIT ?""",
            (limit,),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


# ─── История NFT-действий ─────────────────────────────────────────────────────

async def get_nft_history(user_id: int, limit: int = 40, offset: int = 0) -> list[dict]:
    """Возвращает историю NFT-операций пользователя из общей таблицы user_history."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT h.id, h.action_type, h.description, h.amount, h.created_at,
                      h.ref_id,
                      CASE h.action_type
                        WHEN 'nft_buy' THEN (
                            SELECT image_url FROM nft_paintings WHERE id = h.ref_id
                        )
                        WHEN 'nft_market_buy' THEN (
                            SELECT p.image_url FROM nft_market_listings ml
                            JOIN nft_paintings p ON p.id = ml.painting_id
                            WHERE ml.id = h.ref_id
                        )
                        WHEN 'nft_market_sold' THEN (
                            SELECT p.image_url FROM nft_market_listings ml
                            JOIN nft_paintings p ON p.id = ml.painting_id
                            WHERE ml.id = h.ref_id
                        )
                        WHEN 'nft_auction_won' THEN (
                            SELECT p.image_url FROM nft_auctions a
                            JOIN nft_paintings p ON p.id = a.painting_id
                            WHERE a.id = h.ref_id
                        )
                        WHEN 'nft_auction_sold' THEN (
                            SELECT p.image_url FROM nft_auctions a
                            JOIN nft_paintings p ON p.id = a.painting_id
                            WHERE a.id = h.ref_id
                        )
                        WHEN 'nft_auction_bid' THEN (
                            SELECT p.image_url FROM nft_auctions a
                            JOIN nft_paintings p ON p.id = a.painting_id
                            WHERE a.id = h.ref_id
                        )
                        WHEN 'nft_auction_outbid' THEN (
                            SELECT p.image_url FROM nft_auctions a
                            JOIN nft_paintings p ON p.id = a.painting_id
                            WHERE a.id = h.ref_id
                        )
                        ELSE NULL
                      END AS painting_image
               FROM user_history h
               WHERE h.user_id = ?
                 AND h.action_type IN (
                     'nft_buy',
                     'nft_topup', 'nft_stars_topup',
                     'nft_market_buy', 'nft_market_sold',
                     'nft_auction_bid', 'nft_auction_won',
                     'nft_auction_sold', 'nft_auction_outbid'
                 )
               ORDER BY h.created_at DESC
               LIMIT ? OFFSET ?""",
            (user_id, limit, offset),
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]
