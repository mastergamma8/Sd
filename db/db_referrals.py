# db_referrals.py
# Реферальная система: связи между пользователями и начисление бонусов.

from db import db_async as aiosqlite
from db.db_core import DB_NAME
from db.db_users import add_points_to_user, add_stars_to_user
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

async def distribute_referral_bonus(user_id: int, gift_value: float):
    """Начисляет реферальный бонус пригласившему пользователю.

    Бонус = 10% от стоимости подарка (с дробями, до 4 знаков).
    Если бонус равен нулю или реферера нет — ничего не происходит.
    """
    referrer_id = await get_referrer(user_id)
    if not referrer_id:
        return
    bonus = round(gift_value * 0.10, 2)
    if bonus <= 0:
        return
    await add_points_to_user(referrer_id, bonus)
    await add_history_entry(
        referrer_id,
        "referral_bonus",
        f"Реферальный бонус за покупку подарка рефералом (ID {user_id})",
        bonus
    )


async def distribute_referral_bonus_stars(user_id: int, stars_amount: int):
    """Начисляет реферальный бонус в звёздах пригласившему пользователю.

    Бонус = 10% от суммы пополнения звёздами рефералом.
    Минимум 1 звезда (дроби не используются — floor).
    Если реферера нет — ничего не происходит.
    """
    referrer_id = await get_referrer(user_id)
    if not referrer_id:
        return
    bonus = int(stars_amount * 0.10)  # floor, без округления вверх
    if bonus < 1:
        return  # Пополнение слишком мало — бонус не начисляется
    await add_stars_to_user(referrer_id, bonus)
    await add_history_entry(
        referrer_id,
        "referral_bonus_stars",
        f"Реферальный бонус ⭐ за пополнение рефералом (ID {user_id})",
        bonus
    )
