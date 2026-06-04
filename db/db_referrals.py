# db_referrals.py
# Реферальная система: связи между пользователями и начисление бонусов.

from db import db_async as aiosqlite
from db.db_core import DB_NAME
from db.db_users import add_ref_ton_earned, add_ref_stars_earned
from db.db_history import add_history_entry


# ==========================================
# РЕФЕРАЛЫ
# ==========================================

async def set_referrer(user_id: int, referrer_id: int):
    async with aiosqlite.connect(DB_NAME) as db:
        if user_id != referrer_id:
            await db.execute("""
                UPDATE users SET referrer_id = ?
                WHERE tg_id = ? AND referrer_id IS NULL
            """, (referrer_id, user_id))
            await db.commit()

async def get_referrer(user_id: int):
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT referrer_id FROM users WHERE tg_id = ?", (user_id,)
        ) as cursor:
            row = await cursor.fetchone()
            return row[0] if row else None

async def get_referrals(user_id: int):
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT first_name, photo_url FROM users WHERE referrer_id = ?", (user_id,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def distribute_referral_bonus(user_id: int, deposit_amount: float):
    """Начисляет реферальный бонус в TON в накопительный баланс пригласившему.

    Бонус = 10% от суммы пополнения TON рефералом (до 6 знаков).
    Если бонус равен нулю или реферера нет — ничего не происходит.
    """
    referrer_id = await get_referrer(user_id)
    if not referrer_id:
        return
    bonus = round(deposit_amount * 0.10, 6)
    if bonus <= 0:
        return
    await add_ref_ton_earned(referrer_id, bonus)
    await add_history_entry(
        referrer_id,
        "referral_bonus_ton",
        f"Реферальный бонус TON за пополнение рефералом (ID {user_id})",
        bonus
    )


async def distribute_referral_bonus_stars(user_id: int, stars_amount: int):
    """Начисляет реферальный бонус в звёздах в накопительный баланс пригласившему.

    Бонус = 10% от суммы пополнения звёздами рефералом.
    Минимум 1 звезда (floor). Если реферера нет — ничего не происходит.
    """
    referrer_id = await get_referrer(user_id)
    if not referrer_id:
        return
    bonus = int(stars_amount * 0.10)
    if bonus < 1:
        return
    await add_ref_stars_earned(referrer_id, bonus)
    await add_history_entry(
        referrer_id,
        "referral_bonus_stars",
        f"Реферальный бонус ⭐ за пополнение рефералом (ID {user_id})",
        bonus
    )
