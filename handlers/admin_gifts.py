# handlers/admin_gifts.py
# Commands: /addgift, /addstars
#           /addtggift, /addbasegift, /addmaingift  — добавление в инвентарь по типу
#           /giftids                                 — просмотр доступных ID подарков
import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.enums import ButtonStyle
from aiogram.types import (
    Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
)

import config
import database
from .admin_constants import (
    E_DONUT, E_GIFT, E_STAR, E_STOP, E_CHECK,
    E_PARTY, E_TIME, E_CROSS,
    ID_EYES, ID_STAR,
)

# ──────────────────────────────────────────────────────────────────────────────
# Вспомогательные функции
# ──────────────────────────────────────────────────────────────────────────────

def _profile_markup() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="Посмотреть в профиле",
            web_app=WebAppInfo(url=config.WEBAPP_URL),
            style=ButtonStyle.SUCCESS,
            icon_custom_emoji_id=ID_EYES,
        )
    ]])


async def _notify_user(bot: Bot, user_id: int, text: str) -> None:
    """Отправляет уведомление пользователю; молча проглатывает ошибки."""
    try:
        await bot.send_message(
            user_id, text, parse_mode="HTML", reply_markup=_profile_markup()
        )
    except Exception as e:
        logging.warning(f"Не удалось отправить уведомление пользователю {user_id}: {e}")


# ──────────────────────────────────────────────────────────────────────────────


def register(dp: Dispatcher, bot: Bot):

    # ── /addgift ───────────────────────────────────────────────────────────────

    @dp.message(Command("addgift"))
    async def cmd_add_gift(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        args = message.text.split()
        if len(args) != 4:
            await message.answer(
                "Использование: /addgift &lt;user_id&gt; &lt;gift_id&gt; &lt;кол-во&gt;\n"
                "Пример: /addgift 123456789 2 5\n\n"
                "<i>Для BASE_GIFTS конвертирует стоимость подарка в донуты.\n"
                "Для добавления подарка напрямую в инвентарь используйте:\n"
                "  /addbasegift — базовые подарки\n"
                "  /addtggift   — Telegram-подарки\n"
                "  /addmaingift — главные подарки</i>",
                parse_mode="HTML",
            )
            return

        try:
            user_id = int(args[1])
            gift_id = int(args[2])
            amount  = int(args[3])

            if amount <= 0:
                await message.answer("Количество должно быть больше 0.")
                return

            if gift_id in config.BASE_GIFTS:
                await message.answer(
                    f"{E_TIME} Получаю актуальную цену из API...", parse_mode="HTML"
                )
                await asyncio.to_thread(config.update_base_gifts_prices)

                fresh_value   = float(config.BASE_GIFTS[gift_id]["value"])
                points_to_add = round(amount * fresh_value, 4)
                gift_name     = config.BASE_GIFTS[gift_id]["name"]

                await database.add_points_to_user(user_id, points_to_add)
                await database.add_history_entry(
                    user_id, "gift_added",
                    f"Добавлен подарок: {gift_name} ({amount} шт.) [gift_id:{gift_id}]",
                    points_to_add,
                )

                await message.answer(
                    f"{E_CHECK} Успешно!\n"
                    f"Пользователю {user_id} начислено <b>{points_to_add} {E_DONUT}</b> "
                    f"(за {amount} шт. '{gift_name}' по актуальной цене"
                    f" <b>{fresh_value} {E_DONUT}/шт.</b>).",
                    parse_mode="HTML",
                )
                await _notify_user(
                    bot, user_id,
                    f"{E_GIFT} <b>Получен новый подарок!</b>\n"
                    f"<b>{gift_name}</b> ({amount} шт.).\n"
                    f"Вам начислено <b>{points_to_add} {E_DONUT}</b>!",
                )

                referrer_id = await database.get_referrer(user_id)
                if referrer_id:
                    bonus = round(points_to_add * 0.10, 2)
                    if bonus > 0:
                        await database.distribute_referral_bonus(user_id, points_to_add)
                        try:
                            await bot.send_message(
                                referrer_id,
                                f"{E_PARTY} Ваш реферал добавил подарок!\n"
                                f"Вам начислено <b>{bonus} {E_DONUT}</b>"
                                f" (10% бонус за {gift_name}).",
                                parse_mode="HTML",
                            )
                        except Exception:
                            pass

            elif gift_id in getattr(config, "TG_GIFTS", {}):
                await database.add_gift_to_user(user_id, gift_id, amount)
                gift_name = config.TG_GIFTS[gift_id]["name"] or f"TG gift {gift_id}"

                await database.add_history_entry(
                    user_id, "gift_added",
                    f"Добавлен подарок: {gift_name} ({amount} шт.) [gift_id:{gift_id}]",
                    0,
                )
                await message.answer(
                    f"{E_CHECK} Успешно!\n"
                    f"Пользователю {user_id} выдан Telegram-подарок '{gift_name}' ({amount} шт.).",
                    parse_mode="HTML",
                )
                await _notify_user(
                    bot, user_id,
                    f"{E_GIFT} <b>Вы получили подарок!</b>\n"
                    f"<b>{gift_name}</b> ({amount} шт.).\n"
                    f"Зайдите в приложение, чтобы увидеть его в профиле!",
                )

            elif gift_id in config.MAIN_GIFTS:
                await database.add_gift_to_user(user_id, gift_id, amount)
                gift_name = config.MAIN_GIFTS[gift_id]["name"]

                await database.add_history_entry(
                    user_id, "gift_added",
                    f"Добавлен подарок: {gift_name} ({amount} шт.) [gift_id:{gift_id}]",
                    0,
                )
                await message.answer(
                    f"{E_CHECK} Успешно!\n"
                    f"Пользователю {user_id} выдан Главный подарок '{gift_name}' ({amount} шт.).",
                    parse_mode="HTML",
                )
                await _notify_user(
                    bot, user_id,
                    f"{E_GIFT} <b>Вы получили подарок!</b>\n"
                    f"<b>{gift_name}</b> ({amount} шт.).\n"
                    f"Зайдите в приложение, чтобы увидеть его в профиле!",
                )

            else:
                await message.answer(f"Подарок с ID {gift_id} не найден в config.py.")

        except ValueError:
            await message.answer("Ошибка: ID и Количество должны быть числами.")

    # ── /addtggift ─────────────────────────────────────────────────────────────

    @dp.message(Command("addtggift"))
    async def cmd_add_tg_gift(message: Message):
        """Добавляет Telegram-подарок (TG_GIFTS) в инвентарь пользователя."""
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        args = message.text.split()
        if len(args) != 4:
            await message.answer(
                f"{E_GIFT} <b>Добавление TG-подарка в инвентарь</b>\n\n"
                "Использование: <code>/addtggift &lt;user_id&gt; &lt;gift_id&gt; &lt;кол-во&gt;</code>\n"
                "Пример: <code>/addtggift 123456789 2011 1</code>\n\n"
                "Посмотреть доступные ID: <code>/giftids tg</code>",
                parse_mode="HTML",
            )
            return

        try:
            user_id = int(args[1])
            gift_id = int(args[2])
            amount  = int(args[3])

            if amount <= 0:
                await message.answer(f"{E_CROSS} Количество должно быть больше 0.", parse_mode="HTML")
                return

            tg_gifts = getattr(config, "TG_GIFTS", {})
            if gift_id not in tg_gifts:
                ids_hint = ", ".join(str(k) for k in list(tg_gifts.keys())[:10])
                await message.answer(
                    f"{E_CROSS} TG-подарок с ID <code>{gift_id}</code> не найден.\n"
                    f"Первые 10 доступных ID: {ids_hint} ...\n"
                    f"Полный список: <code>/giftids tg</code>",
                    parse_mode="HTML",
                )
                return

            gift_name = tg_gifts[gift_id]["name"] or f"TG gift {gift_id}"

            await database.add_gift_to_user(user_id, gift_id, amount)
            await database.add_history_entry(
                user_id, "gift_added",
                f"Добавлен TG-подарок: {gift_name} ({amount} шт.) [gift_id:{gift_id}]",
                0,
            )

            await message.answer(
                f"{E_CHECK} <b>Готово!</b>\n"
                f"Пользователю <code>{user_id}</code> добавлен TG-подарок "
                f"<b>{gift_name}</b> ({amount} шт.) в инвентарь.",
                parse_mode="HTML",
            )
            await _notify_user(
                bot, user_id,
                f"{E_GIFT} <b>Вы получили Telegram-подарок!</b>\n"
                f"<b>{gift_name}</b> ({amount} шт.) добавлен в ваш инвентарь.\n"
                f"Зайдите в приложение, чтобы увидеть его в профиле!",
            )

        except ValueError:
            await message.answer(
                f"{E_CROSS} Ошибка: user_id, gift_id и количество должны быть числами.",
                parse_mode="HTML",
            )

    # ── /addbasegift ───────────────────────────────────────────────────────────

    @dp.message(Command("addbasegift"))
    async def cmd_add_base_gift(message: Message):
        """Добавляет базовый подарок (BASE_GIFTS) в инвентарь пользователя.
        В отличие от /addgift, не конвертирует в донуты — кладёт подарок в инвентарь."""
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        args = message.text.split()
        if len(args) != 4:
            await message.answer(
                f"{E_GIFT} <b>Добавление базового подарка в инвентарь</b>\n\n"
                "Использование: <code>/addbasegift &lt;user_id&gt; &lt;gift_id&gt; &lt;кол-во&gt;</code>\n"
                "Пример: <code>/addbasegift 123456789 12 3</code>\n\n"
                "<i>Подарок добавляется в инвентарь; донуты не начисляются.\n"
                "Для начисления донутов используйте /addgift.</i>\n\n"
                "Посмотреть доступные ID: <code>/giftids base</code>",
                parse_mode="HTML",
            )
            return

        try:
            user_id = int(args[1])
            gift_id = int(args[2])
            amount  = int(args[3])

            if amount <= 0:
                await message.answer(f"{E_CROSS} Количество должно быть больше 0.", parse_mode="HTML")
                return

            if gift_id not in config.BASE_GIFTS:
                ids_hint = ", ".join(str(k) for k in list(config.BASE_GIFTS.keys())[:10])
                await message.answer(
                    f"{E_CROSS} Базовый подарок с ID <code>{gift_id}</code> не найден.\n"
                    f"Первые 10 доступных ID: {ids_hint} ...\n"
                    f"Полный список: <code>/giftids base</code>",
                    parse_mode="HTML",
                )
                return

            gift_name = config.BASE_GIFTS[gift_id]["name"]

            await database.add_gift_to_user(user_id, gift_id, amount)
            await database.add_history_entry(
                user_id, "gift_added",
                f"Добавлен базовый подарок: {gift_name} ({amount} шт.) [gift_id:{gift_id}]",
                0,
            )

            await message.answer(
                f"{E_CHECK} <b>Готово!</b>\n"
                f"Пользователю <code>{user_id}</code> добавлен базовый подарок "
                f"<b>{gift_name}</b> ({amount} шт.) в инвентарь.",
                parse_mode="HTML",
            )
            await _notify_user(
                bot, user_id,
                f"{E_GIFT} <b>Вы получили подарок!</b>\n"
                f"<b>{gift_name}</b> ({amount} шт.) добавлен в ваш инвентарь.\n"
                f"Зайдите в приложение, чтобы увидеть его в профиле!",
            )

        except ValueError:
            await message.answer(
                f"{E_CROSS} Ошибка: user_id, gift_id и количество должны быть числами.",
                parse_mode="HTML",
            )

    # ── /addmaingift ───────────────────────────────────────────────────────────

    @dp.message(Command("addmaingift"))
    async def cmd_add_main_gift(message: Message):
        """Добавляет главный подарок (MAIN_GIFTS) в инвентарь пользователя."""
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        args = message.text.split()
        if len(args) != 4:
            await message.answer(
                f"{E_GIFT} <b>Добавление главного подарка в инвентарь</b>\n\n"
                "Использование: <code>/addmaingift &lt;user_id&gt; &lt;gift_id&gt; &lt;кол-во&gt;</code>\n"
                "Пример: <code>/addmaingift 123456789 1004 1</code>\n\n"
                "Посмотреть доступные ID: <code>/giftids main</code>",
                parse_mode="HTML",
            )
            return

        try:
            user_id = int(args[1])
            gift_id = int(args[2])
            amount  = int(args[3])

            if amount <= 0:
                await message.answer(f"{E_CROSS} Количество должно быть больше 0.", parse_mode="HTML")
                return

            if gift_id not in config.MAIN_GIFTS:
                ids_hint = ", ".join(str(k) for k in config.MAIN_GIFTS.keys())
                await message.answer(
                    f"{E_CROSS} Главный подарок с ID <code>{gift_id}</code> не найден.\n"
                    f"Доступные ID: {ids_hint}\n"
                    f"Полный список: <code>/giftids main</code>",
                    parse_mode="HTML",
                )
                return

            gift_name = config.MAIN_GIFTS[gift_id]["name"]

            await database.add_gift_to_user(user_id, gift_id, amount)
            await database.add_history_entry(
                user_id, "gift_added",
                f"Добавлен главный подарок: {gift_name} ({amount} шт.) [gift_id:{gift_id}]",
                0,
            )

            await message.answer(
                f"{E_CHECK} <b>Готово!</b>\n"
                f"Пользователю <code>{user_id}</code> добавлен главный подарок "
                f"<b>{gift_name}</b> ({amount} шт.) в инвентарь.",
                parse_mode="HTML",
            )
            await _notify_user(
                bot, user_id,
                f"{E_GIFT} <b>Вы получили главный подарок!</b>\n"
                f"<b>{gift_name}</b> ({amount} шт.) добавлен в ваш инвентарь.\n"
                f"Зайдите в приложение, чтобы увидеть его в профиле!",
            )

        except ValueError:
            await message.answer(
                f"{E_CROSS} Ошибка: user_id, gift_id и количество должны быть числами.",
                parse_mode="HTML",
            )

    # ── /giftids ───────────────────────────────────────────────────────────────

    @dp.message(Command("giftids"))
    async def cmd_gift_ids(message: Message):
        """Выводит список доступных ID подарков с именами и ценами по типу (tg / base / main)."""
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args      = message.text.split()
        gift_type = args[1].lower() if len(args) > 1 else None

        try:
            page = int(args[2]) if len(args) > 2 else 1
        except ValueError:
            page = 1

        if gift_type not in ("tg", "base", "main"):
            tg_gifts  = getattr(config, "TG_GIFTS", {})
            tg_range  = f"2000–{max(tg_gifts.keys())}" if tg_gifts else "нет данных"
            base_range = f"1–{max(config.BASE_GIFTS.keys())}"
            main_ids  = ", ".join(str(k) for k in config.MAIN_GIFTS.keys())
            await message.answer(
                f"{E_GIFT} <b>Просмотр ID подарков</b>\n\n"
                "Использование: <code>/giftids [tg|base|main] [страница]</code>\n\n"
                f"  <code>/giftids tg</code>   — Telegram-подарки (ID {tg_range})\n"
                f"  <code>/giftids base</code> — Базовые подарки (ID {base_range})\n"
                f"  <code>/giftids main</code> — Главные подарки (ID {main_ids})\n\n"
                "Быстрые команды добавления в инвентарь:\n"
                "  <code>/addtggift</code>  /  <code>/addbasegift</code>  /  <code>/addmaingift</code>",
                parse_mode="HTML",
            )
            return

        PAGE_SIZE = 25

        if gift_type == "tg":
            tg_gifts = getattr(config, "TG_GIFTS", {})
            items    = list(tg_gifts.items())
            title    = "Telegram-подарки (TG_GIFTS)"
        elif gift_type == "base":
            items = list(config.BASE_GIFTS.items())
            title = "Базовые подарки (BASE_GIFTS)"
        else:
            items = list(config.MAIN_GIFTS.items())
            title = "Главные подарки (MAIN_GIFTS)"

        total       = len(items)
        total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
        page        = max(1, min(page, total_pages))
        start       = (page - 1) * PAGE_SIZE
        page_items  = items[start : start + PAGE_SIZE]

        lines = [f"<b>{E_GIFT} {title}</b>  (стр. {page}/{total_pages}, всего {total})\n"]

        for gid, g in page_items:
            name = g.get("name") or f"ID {gid}"
            if gift_type == "tg":
                price = g.get("price") or g.get("required_value", "?")
                lines.append(f"<code>{gid}</code>  {name or '—'}  <i>({price} ⭐)</i>")
            elif gift_type == "base":
                lines.append(f"<code>{gid}</code>  {name}  <i>({g['value']} {E_DONUT})</i>")
            else:
                lines.append(f"<code>{gid}</code>  {name}  <i>(треб. {g['required_value']} {E_DONUT})</i>")

        if total_pages > 1:
            nav = []
            if page > 1:
                nav.append(f"⬅️ /giftids {gift_type} {page - 1}")
            if page < total_pages:
                nav.append(f"➡️ /giftids {gift_type} {page + 1}")
            lines.append("\n" + "  |  ".join(nav))

        await message.answer("\n".join(lines), parse_mode="HTML")

    # ── /addstars ──────────────────────────────────────────────────────────────

    @dp.message(Command("addstars"))
    async def cmd_add_stars(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        args = message.text.split()
        if len(args) != 3:
            await message.answer(
                "Использование: /addstars <ID пользователя> <Количество>\n"
                "Пример: /addstars 123456789 50"
            )
            return

        try:
            user_id      = int(args[1])
            stars_amount = int(args[2])

            if stars_amount <= 0:
                await message.answer("Количество звезд должно быть больше нуля.")
                return

            await database.add_stars_to_user(user_id, stars_amount)
            await database.add_history_entry(
                user_id, "admin_add_stars", "Выдача звезд администратором", stars_amount
            )

            await message.answer(
                f"{E_CHECK} Успешно!\nПользователю {user_id} начислено {stars_amount} {E_STAR}.",
                parse_mode="HTML",
            )

            try:
                star_markup = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(
                        text="Посмотреть баланс",
                        web_app=WebAppInfo(url=config.WEBAPP_URL),
                        style=ButtonStyle.SUCCESS,
                        icon_custom_emoji_id=ID_STAR,
                    )
                ]])
                await bot.send_message(
                    user_id,
                    f"{E_STAR} <b>Вам начислены звезды!</b>\n"
                    f"Администратор выдал вам <b>{stars_amount} {E_STAR}</b>.",
                    parse_mode="HTML",
                    reply_markup=star_markup,
                )
            except Exception as e:
                logging.warning(
                    f"Не удалось отправить уведомление пользователю {user_id}: {e}"
                )

        except ValueError:
            await message.answer("Ошибка: ID и Количество должны быть числами.")
