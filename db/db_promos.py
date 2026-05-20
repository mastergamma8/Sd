# db_promos.py
# Промокоды: создание, активация и бесплатные кейсы по промо.

import time
from db import db_async as aiosqlite
from db.db_core import DB_NAME


async def init_promo_tables():
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS promo_codes (
                code TEXT PRIMARY KEY,
                reward_type TEXT NOT NULL,
                reward_value REAL NOT NULL DEFAULT 0,
                case_id INTEGER DEFAULT NULL,
                max_uses INTEGER NOT NULL DEFAULT 1,
                uses_left INTEGER NOT NULL DEFAULT 1,
                created_by INTEGER DEFAULT NULL,
                created_at INTEGER NOT NULL DEFAULT 0
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS promo_redemptions (
                user_id INTEGER NOT NULL,
                code TEXT NOT NULL,
                redeemed_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, code)
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_promo_cases (
                user_id INTEGER NOT NULL,
                case_id INTEGER NOT NULL,
                amount INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, case_id)
            )
        """)

        await db.commit()


async def create_promo_code(code: str, reward_type: str, reward_value: float, max_uses: int, case_id: int | None = None, created_by: int | None = None) -> bool:
    code = code.strip().upper()
    reward_type = reward_type.strip().lower()

    async with aiosqlite.connect(DB_NAME) as db:
        try:
            await db.execute("""
                INSERT INTO promo_codes (
                    code, reward_type, reward_value, case_id,
                    max_uses, uses_left, created_by, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (code, reward_type, reward_value, case_id, max_uses, max_uses, created_by, int(time.time())))
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False


async def get_promo_code(code: str):
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM promo_codes WHERE code = ?", (code.strip().upper(),)) as cursor:
            row = await cursor.fetchone()
            return dict(row) if row else None


async def delete_promo_code(code: str) -> bool:
    async with aiosqlite.connect(DB_NAME) as db:
        cur = await db.execute("DELETE FROM promo_codes WHERE code = ?", (code.strip().upper(),))
        await db.commit()
        return cur.rowcount > 0


async def remove_user_promo_case(user_id: int, case_id: int) -> bool:
    async with aiosqlite.connect(DB_NAME) as db:
        cur = await db.execute("DELETE FROM user_promo_cases WHERE user_id = ? AND case_id = ?", (user_id, case_id))
        await db.commit()
        return cur.rowcount > 0


async def has_user_redeemed_promo(user_id: int, code: str) -> bool:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute("SELECT 1 FROM promo_redemptions WHERE user_id = ? AND code = ?", (user_id, code.strip().upper())) as cursor:
            row = await cursor.fetchone()
            return row is not None


async def get_user_promo_cases(user_id: int) -> dict[int, int]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT case_id, amount FROM user_promo_cases WHERE user_id = ? AND amount > 0", (user_id,)) as cursor:
            rows = await cursor.fetchall()
            return {int(row["case_id"]): int(row["amount"]) for row in rows}


async def consume_user_promo_case(user_id: int, case_id: int) -> bool:
    async with aiosqlite.connect(DB_NAME) as db:
        try:
            await db.execute("BEGIN IMMEDIATE")
            cur = await db.execute("""
                UPDATE user_promo_cases
                SET amount = amount - 1
                WHERE user_id = ? AND case_id = ? AND amount > 0
            """, (user_id, case_id))
            if cur.rowcount != 1:
                await db.rollback()
                return False

            await db.execute("""
                DELETE FROM user_promo_cases
                WHERE user_id = ? AND case_id = ? AND amount <= 0
            """, (user_id, case_id))
            await db.commit()
            return True
        except Exception:
            await db.rollback()
            raise


async def redeem_promo_code(user_id: int, code: str) -> tuple[bool, str, dict | None]:
    promo = await get_promo_code(code)
    if not promo:
        return False, "promo_not_found", None

    code_norm = promo["code"]

    if await has_user_redeemed_promo(user_id, code_norm):
        return False, "promo_already_used", promo

    async with aiosqlite.connect(DB_NAME) as db:
        try:
            await db.execute("BEGIN IMMEDIATE")

            async with db.execute("SELECT uses_left FROM promo_codes WHERE code = ?", (code_norm,)) as cursor:
                row = await cursor.fetchone()

            if not row or row[0] <= 0:
                await db.rollback()
                return False, "promo_no_uses", promo

            await db.execute(
                "INSERT INTO promo_redemptions (user_id, code, redeemed_at) VALUES (?, ?, ?)",
                (user_id, code_norm, int(time.time()))
            )

            await db.execute(
                "UPDATE promo_codes SET uses_left = uses_left - 1 WHERE code = ? AND uses_left > 0",
                (code_norm,)
            )

            if promo["reward_type"] == "case":
                case_id = int(promo["case_id"] or 0)
                await db.execute("""
                    INSERT INTO user_promo_cases (user_id, case_id, amount)
                    VALUES (?, ?, 1)
                    ON CONFLICT(user_id, case_id) DO UPDATE SET amount = user_promo_cases.amount + 1
                """, (user_id, case_id))
            elif promo["reward_type"] == "donuts":
                await db.execute("UPDATE users SET balance = balance + ? WHERE tg_id = ?", (float(promo["reward_value"]), user_id))
            elif promo["reward_type"] == "stars":
                await db.execute("UPDATE users SET stars = stars + ? WHERE tg_id = ?", (int(promo["reward_value"]), user_id))

            async with db.execute("SELECT uses_left FROM promo_codes WHERE code = ?", (code_norm,)) as cursor:
                after = await cursor.fetchone()
            if not after or after[0] <= 0:
                await db.execute("DELETE FROM promo_codes WHERE code = ?", (code_norm,))

            await db.commit()
            return True, "promo_ok", promo
        except Exception:
            await db.rollback()
            raise


async def get_all_promo_codes() -> list[dict]:
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM promo_codes WHERE uses_left > 0 ORDER BY created_at DESC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
