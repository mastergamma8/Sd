# handlers/admin_gamelinks.py
# Command: /gamelink — генерирует ссылку для прямого открытия игры
#
# Использование (только для ADMIN_ID):
#   /gamelink cases   — кейсы
#   /gamelink rocket  — ракета
#   /gamelink pvp     — PVP арена
#   /gamelink         — показать справку

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message

import config
from .admin_constants import E_STOP, E_CHECK

# Все поддерживаемые игры: ключ команды → (параметр deep-link, русское название)
GAME_LINKS: dict[str, tuple[str, str]] = {
    "cases":  ("cases",  "🎁 Кейсы"),
    "rocket": ("rocket", "🚀 Ракета"),
    "pvp":    ("pvp",    "⚔️ PVP Арена"),
}


def register(dp: Dispatcher, bot: Bot) -> None:

    @dp.message(Command("gamelink"))
    async def cmd_gamelink(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args = message.text.split()

        if len(args) < 2:
            lines = [
                "<b>🔗 Ссылки на игры</b>",
                "",
                "Генерирует прямую ссылку, при открытии которой сразу откроется нужная игра.",
                "",
                "<b>Использование:</b>",
            ]
            for key, (_, label) in GAME_LINKS.items():
                lines.append(f"  <code>/gamelink {key}</code> — {label}")
            await message.answer("\n".join(lines), parse_mode="HTML")
            return

        game_key = args[1].lower()

        if game_key not in GAME_LINKS:
            known = ", ".join(GAME_LINKS.keys())
            await message.answer(
                f"{E_STOP} Неизвестная игра: <b>{game_key}</b>\n"
                f"Доступные: {known}",
                parse_mode="HTML",
            )
            return

        param, label = GAME_LINKS[game_key]
        bot_username = config.BOT_USERNAME.lstrip("@")
        deep_link = f"https://t.me/{bot_username}?start=game_{param}"

        await message.answer(
            f"{E_CHECK} Ссылка для игры <b>{label}</b>:\n\n"
            f"<code>{deep_link}</code>\n\n"
            "<i>При переходе по ссылке у пользователя сразу откроется эта игра.</i>",
            parse_mode="HTML",
        )
