# handlers/admin_promos.py
# Commands: /addpromo, /promos, /delpromo
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message

import config
import database
from .admin_constants import E_STOP, E_CHECK, E_CROSS, E_DONUT, E_STAR


def register(dp: Dispatcher, bot: Bot):

    @dp.message(Command("addpromo"))
    async def cmd_add_promo(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args = message.text.split()
        if len(args) < 5:
            await message.answer(
                "<b>Создание промокода</b>\n\n"
                "Использование:\n"
                "<code>/addpromo CODE donuts AMOUNT USES</code>\n"
                "<code>/addpromo CODE stars AMOUNT USES</code>\n"
                "<code>/addpromo CODE case CASE_ID USES</code>\n\n"
                "Примеры:\n"
                "<code>/addpromo DONUTS100 donuts 100 50</code>\n"
                "<code>/addpromo STAR10 stars 10 100</code>\n"
                "<code>/addpromo CASE7 case 7 25</code>",
                parse_mode="HTML",
            )
            return

        code        = args[1].strip().upper()
        reward_type = args[2].strip().lower()

        try:
            if reward_type == "donuts":
                reward_value = float(args[3])
                max_uses     = int(args[4])
                case_id      = None
            elif reward_type == "stars":
                reward_value = int(args[3])
                max_uses     = int(args[4])
                case_id      = None
            elif reward_type == "case":
                case_id      = int(args[3])
                max_uses     = int(args[4])
                reward_value = 0
            else:
                await message.answer(
                    f"{E_CROSS} Тип награды должен быть donuts, stars или case.",
                    parse_mode="HTML",
                )
                return
        except ValueError:
            await message.answer(
                f"{E_CROSS} AMOUNT / USES / CASE_ID должны быть числами.", parse_mode="HTML"
            )
            return

        if max_uses <= 0:
            await message.answer(
                f"{E_CROSS} Количество активаций должно быть больше 0.", parse_mode="HTML"
            )
            return

        if reward_type in ("donuts", "stars") and reward_value <= 0:
            await message.answer(
                f"{E_CROSS} Количество награды должно быть больше 0.", parse_mode="HTML"
            )
            return

        if reward_type == "case" and case_id not in config.CASES_CONFIG:
            await message.answer(
                f"{E_CROSS} Кейса с ID {case_id} нет в конфиге.", parse_mode="HTML"
            )
            return

        created = await database.create_promo_code(
            code=code,
            reward_type=reward_type,
            reward_value=reward_value,
            max_uses=max_uses,
            case_id=case_id,
            created_by=message.from_user.id,
        )

        if not created:
            await message.answer(
                f"{E_CROSS} Промокод <code>{code}</code> уже существует.", parse_mode="HTML"
            )
            return

        if reward_type == "case":
            reward_text = f"бесплатный кейс <b>#{case_id}</b>"
        elif reward_type == "stars":
            reward_text = f"<b>{reward_value}</b> {E_STAR}"
        else:
            donut_display = int(reward_value) if reward_value == int(reward_value) else reward_value
            reward_text = f"<b>{donut_display}</b> {E_DONUT}"

        await message.answer(
            f"{E_CHECK} Промокод <code>{code}</code> создан.\n\n"
            f"Награда: {reward_text}\n"
            f"Активаций: <b>{max_uses}</b>",
            parse_mode="HTML",
        )

    # ──────────────────────────────────────────────────────────────────────────

    @dp.message(Command("promos"))
    async def cmd_list_promos(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        promos = await database.get_all_promo_codes()
        if not promos:
            await message.answer("Промокодов пока нет.")
            return

        lines = ["<b>Активные промокоды</b>\n"]
        for promo in promos[:30]:
            if promo["reward_type"] == "case":
                reward = f"case #{promo['case_id']}"
            elif promo["reward_type"] == "stars":
                reward = f"{promo['reward_value']} ⭐"
            else:
                reward = f"{promo['reward_value']} 🍩"
            lines.append(
                f"<code>{promo['code']}</code> — {reward} | "
                f"осталось: <b>{promo['uses_left']}</b>/<b>{promo['max_uses']}</b>"
            )

        await message.answer("\n".join(lines), parse_mode="HTML")

    # ──────────────────────────────────────────────────────────────────────────

    @dp.message(Command("delpromo"))
    async def cmd_del_promo(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args = message.text.split(maxsplit=1)
        if len(args) < 2 or not args[1].strip():
            await message.answer(
                "<b>Удаление промокода</b>\n\n"
                "Использование:\n"
                "<code>/delpromo CODE</code>\n\n"
                "Пример:\n"
                "<code>/delpromo DONUTS100</code>",
                parse_mode="HTML",
            )
            return

        code    = args[1].strip().upper()
        deleted = await database.delete_promo_code(code)

        if not deleted:
            await message.answer(
                f"{E_CROSS} Промокод <code>{code}</code> не найден.", parse_mode="HTML"
            )
            return

        await message.answer(
            f"{E_CHECK} Промокод <code>{code}</code> удалён.", parse_mode="HTML"
        )
