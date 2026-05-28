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

# Имя Mini App (часть URL после /bot_username/)  → https://t.me/BOT/APP_NAME?startapp=...
_APP_NAME = lambda: getattr(config, 'BOT_APP_NAME', 'app')

# Все поддерживаемые игры: ключ команды → (параметр deep-link, русское название)
GAME_LINKS: dict[str, tuple[str, str]] = {
    "cases":   ("cases",   "🎁 Кейсы"),
    "rocket":  ("rocket",  "🚀 Ракета"),
    "pvp":     ("pvp",     "⚔️ PVP Арена"),
    # NFT deep-links
    "gallery": ("gallery", "🖼 NFT Галерея"),
}

# NFT-специфичные ссылки (не в GAME_LINKS, но поддерживаются)
# /gamelink pack 42       → ?nft=pack_42
# /gamelink painting 7 1  → ?nft=painting_7_1


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

        # ── nft pack / painting shortcuts ────────────────────────────────────
        if game_key == "pack" and len(args) >= 3:
            pack_id = args[2]
            bot_username = config.BOT_USERNAME.lstrip("@")
            app_name     = _APP_NAME()
            deep_link    = f"https://t.me/{bot_username}/{app_name}?startapp=nft_pack_{pack_id}"
            await message.answer(
                f"{E_CHECK} Ссылка на пак <b>#{pack_id}</b>:\n\n"
                f"<code>{deep_link}</code>",
                parse_mode="HTML",
            )
            return

        if game_key == "painting" and len(args) >= 3:
            painting_id = args[2]
            serial      = args[3] if len(args) >= 4 else "1"
            bot_username = config.BOT_USERNAME.lstrip("@")
            app_name     = _APP_NAME()
            deep_link    = f"https://t.me/{bot_username}/{app_name}?startapp=nft_painting_{painting_id}_{serial}"
            await message.answer(
                f"{E_CHECK} Ссылка на картину <b>#{painting_id}</b> серия <b>{serial}</b>:\n\n"
                f"<code>{deep_link}</code>",
                parse_mode="HTML",
            )
            return
        # ─────────────────────────────────────────────────────────────────────

        if game_key not in GAME_LINKS:
            known = ", ".join(GAME_LINKS.keys())
            await message.answer(
                f"{E_STOP} Неизвестная игра: <b>{game_key}</b>\n"
                f"Доступные: {known}\n"
                f"Или: <code>/gamelink pack &lt;id&gt;</code> / <code>/gamelink painting &lt;id&gt; &lt;serial&gt;</code>",
                parse_mode="HTML",
            )
            return

        param, label = GAME_LINKS[game_key]
        bot_username = config.BOT_USERNAME.lstrip("@")
        app_name     = _APP_NAME()

        # NFT-галерея: prefix nft_, остальные game_
        if game_key == "gallery":
            deep_link = f"https://t.me/{bot_username}/{app_name}?startapp=nft_{param}"
            caption   = "При переходе сразу откроется NFT Галерея."
        else:
            deep_link = f"https://t.me/{bot_username}/{app_name}?startapp=game_{param}"
            caption   = "При переходе по ссылке сразу откроется эта игра."

        await message.answer(
            f"{E_CHECK} Ссылка для <b>{label}</b>:\n\n"
            f"<code>{deep_link}</code>\n\n"
            f"<i>{caption}</i>\n\n"
            "<b>Пак/картина:</b>\n"
            "  <code>/gamelink pack &lt;pack_id&gt;</code>\n"
            "  <code>/gamelink painting &lt;painting_id&gt; &lt;serial&gt;</code>",
            parse_mode="HTML",
        )