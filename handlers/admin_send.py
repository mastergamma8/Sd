# handlers/admin_send.py
# Commands: /send, /cancel
#
# Расширенная рассылка: после выбора цели администратор может добавить
# к сообщению одну из нескольких кнопок:
#   • Открыть приложение — зелёная (SUCCESS), синяя (PRIMARY) или красная (DANGER)
#   • Произвольная ссылка — кастомный текст + URL, тоже с выбором цвета
#   • Без кнопки
#
# FSM-цепочка:
#   /send
#     → waiting_for_target       (кому: «всем» или ID)
#     → waiting_for_button_type  (тип кнопки: 1–7)
#     → waiting_for_url_text     (только при выборе «ссылка»: текст кнопки / label)
#     → waiting_for_url_link     (только при выборе «ссылка»: сам URL)
#     → waiting_for_message      (само сообщение / медиа)

import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.enums import ButtonStyle
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, Message, WebAppInfo

import config
import database
from .admin_constants import E_CHECK, E_CROSS, E_STOP, E_TIME


# ── FSM ───────────────────────────────────────────────────────────────────────

class SendMessage(StatesGroup):
    waiting_for_target = State()
    waiting_for_channel_id = State()
    waiting_for_button_type = State()
    waiting_for_url_text = State()
    waiting_for_url_link = State()
    waiting_for_message = State()


# ── Вспомогательные функции ──────────────────────────────────────────────────

def _utf16_to_py_index(text: str, unit_pos: int) -> int:
    """
    Telegram offsets/lengths for entities are in UTF-16 code units.
    This helper converts a UTF-16 position to a Python string index.
    """
    units = 0
    for i, ch in enumerate(text):
        if units == unit_pos:
            return i
        units += 2 if ord(ch) > 0xFFFF else 1
    if units == unit_pos:
        return len(text)
    return len(text)


def _strip_custom_emoji_entities(text: str, entities) -> str:
    """
    Remove custom emoji placeholders from the visible text, keeping
    any surrounding user-entered words.
    """
    if not text or not entities:
        return (text or "").strip()

    ranges: list[tuple[int, int]] = []
    for ent in entities:
        if getattr(ent, "type", None) != "custom_emoji":
            continue
        start = _utf16_to_py_index(text, ent.offset)
        end = _utf16_to_py_index(text, ent.offset + ent.length)
        ranges.append((start, end))

    result = text
    for start, end in sorted(ranges, reverse=True):
        result = result[:start] + result[end:]

    return " ".join(result.split()).strip()


def _first_custom_emoji_id(entities) -> str | None:
    if not entities:
        return None

    for ent in entities:
        if getattr(ent, "type", None) == "custom_emoji" and getattr(ent, "custom_emoji_id", None):
            return ent.custom_emoji_id

    return None


# ── Вспомогательная функция: построить reply_markup по данным из FSM ──────────

def _build_markup(button_cfg: dict | None, target=None) -> InlineKeyboardMarkup | None:
    if not button_cfg:
        return None

    # Для канала — только безопасная URL-кнопка без style/web_app/emoji
    if target == "channel":
        if button_cfg["type"] == "webapp":
            return InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(
                    text=button_cfg.get("label", "Открыть приложение"),
                    url="http://t.me/SpaceDonutBot/app",
                )
            ]])

        if button_cfg["type"] == "url":
            return InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(
                    text=button_cfg["text"],
                    url=button_cfg["url"],
                )
            ]])

        return None

    # Для личных сообщений — полный набор возможностей
    common_extra = {}
    if button_cfg.get("icon_custom_emoji_id"):
        common_extra["icon_custom_emoji_id"] = button_cfg["icon_custom_emoji_id"]

    style_map = {
        "green": ButtonStyle.SUCCESS,
        "blue": ButtonStyle.PRIMARY,
        "red": ButtonStyle.DANGER,
    }

    if button_cfg["type"] == "webapp":
        style = style_map.get(button_cfg["style"])
        extra = {"style": style} if style is not None else {}
        extra.update(common_extra)

        btn = InlineKeyboardButton(
            text=button_cfg.get("label", "Открыть приложение"),
            web_app=WebAppInfo(url=config.WEBAPP_URL),
            **extra,
        )
        return InlineKeyboardMarkup(inline_keyboard=[[btn]])

    if button_cfg["type"] == "url":
        style = style_map.get(button_cfg.get("style"))
        extra = {"style": style} if style is not None else {}
        extra.update(common_extra)

        btn = InlineKeyboardButton(
            text=button_cfg["text"],
            url=button_cfg["url"],
            **extra,
        )
        return InlineKeyboardMarkup(inline_keyboard=[[btn]])

    return None


# ── Константы выбора кнопки ───────────────────────────────────────────────────

_BUTTON_MENU = (
    "Выберите тип кнопки для сообщения:\n\n"
    "  <b>1</b> — 🟢 Открыть приложение (зелёная)\n"
    "  <b>2</b> — 🔵 Открыть приложение (синяя)\n"
    "  <b>3</b> — 🔴 Открыть приложение (красная)\n"
    "  <b>4</b> — 🟢 Ссылка (зелёная)\n"
    "  <b>5</b> — 🔵 Ссылка (синяя)\n"
    "  <b>6</b> — 🔴 Ссылка (красная)\n"
    "  <b>7</b> — ❌ Без кнопки\n\n"
    "<i>(Для отмены введите /cancel)</i>"
)

_WEBAPP_STYLES = {
    "1": ("webapp", "green", "зелёная"),
    "2": ("webapp", "blue", "синяя"),
    "3": ("webapp", "red", "красная"),
}

_URL_STYLES = {
    "4": ("url", "green", "зелёная"),
    "5": ("url", "blue", "синяя"),
    "6": ("url", "red", "красная"),
}

_DEFAULT_WEBAPP_LABELS = {
    "green": "Открыть приложение",
    "blue": "Открыть приложение",
    "red": "Открыть приложение",
}

_DEFAULT_URL_LABELS = {
    "green": "Открыть ссылку",
    "blue": "Открыть ссылку",
    "red": "Открыть ссылку",
}


# ── Регистрация хэндлеров ─────────────────────────────────────────────────────

def register(dp: Dispatcher, bot: Bot):

    # ── /cancel ────────────────────────────────────────────────────────────────

    @dp.message(Command("cancel"))
    async def cmd_cancel(message: Message, state: FSMContext):
        current_state = await state.get_state()
        if current_state is None:
            return
        await state.clear()
        await message.answer("Действие отменено.")

    # ── /send ──────────────────────────────────────────────────────────────────

    @dp.message(Command("send"))
    async def cmd_send(message: Message, state: FSMContext):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        await message.answer(
            "Кому отправить сообщение?\n\n"
            "  • <b>всем</b> — рассылка всем пользователям\n"
            "  • <b>канал</b> — публикация в Telegram-канале\n"
            "  • числовой <b>ID пользователя</b>\n\n"
            "<i>(Для отмены введите /cancel)</i>",
            parse_mode="HTML",
        )
        await state.set_state(SendMessage.waiting_for_target)

    # ── Шаг 1: цель ───────────────────────────────────────────────────────────

    @dp.message(SendMessage.waiting_for_target)
    async def process_send_target(message: Message, state: FSMContext):
        text = message.text.lower().strip() if message.text else ""

        if text == "всем":
            await state.update_data(target="all")
        elif text == "канал":
            await state.update_data(target="channel")
            await message.answer(
                "Введите ID канала или его @username.\n\n"
                "<b>Примеры:</b>\n"
                "  <code>@mychannel</code>\n"
                "  <code>-1001234567890</code>\n\n"
                "<i>Бот должен быть администратором канала с правом публикации сообщений.</i>",
                parse_mode="HTML",
            )
            await state.set_state(SendMessage.waiting_for_channel_id)
            return
        elif text.isdigit():
            await state.update_data(target=int(text))
        else:
            await message.answer(
                "Пожалуйста, напишите <b>всем</b>, <b>канал</b> или числовой ID пользователя.",
                parse_mode="HTML",
            )
            return

        await message.answer(_BUTTON_MENU, parse_mode="HTML")
        await state.set_state(SendMessage.waiting_for_button_type)

    # ── Шаг 1б: ID или @username канала ───────────────────────────────────────

    @dp.message(SendMessage.waiting_for_channel_id)
    async def process_channel_id(message: Message, state: FSMContext):
        raw = (message.text or "").strip()

        if raw.startswith("@") and len(raw) > 1:
            channel_id = raw
        elif raw.lstrip("-").isdigit():
            channel_id = int(raw)
        else:
            await message.answer(
                f"{E_CROSS} Не похоже на ID канала.\n"
                "Введите <code>@username</code> или числовой ID вида <code>-1001234567890</code>.",
                parse_mode="HTML",
            )
            return

        await state.update_data(channel_id=channel_id)
        await message.answer(_BUTTON_MENU, parse_mode="HTML")
        await state.set_state(SendMessage.waiting_for_button_type)

    # ── Шаг 2: тип кнопки ─────────────────────────────────────────────────────

    @dp.message(SendMessage.waiting_for_button_type)
    async def process_button_type(message: Message, state: FSMContext):
        choice = (message.text or "").strip()

        # Вариант: Открыть приложение (1–3) — спрашиваем текст кнопки
        if choice in _WEBAPP_STYLES:
            _, style, color_label = _WEBAPP_STYLES[choice]
            await state.update_data(
                button_cfg={
                    "type": "webapp",
                    "style": style,
                    "label": _DEFAULT_WEBAPP_LABELS[style],
                    "icon_custom_emoji_id": None,
                }
            )
            await message.answer(
                f"Выбрана кнопка «Открыть приложение» ({color_label}).\n\n"
                f"Введите <b>текст кнопки</b> или отправьте <code>-</code> для текста по умолчанию\n"
                f"<i>(по умолчанию: «{_DEFAULT_WEBAPP_LABELS[style]}»)</i>\n\n"
                "Можно также отправить premium custom emoji вместе с текстом — оно будет показано на кнопке.",
                parse_mode="HTML",
            )
            await state.set_state(SendMessage.waiting_for_url_text)
            await state.update_data(_url_step="webapp_label")
            return

        # Вариант: произвольная ссылка (4–6) с выбором цвета
        if choice in _URL_STYLES:
            _, style, color_label = _URL_STYLES[choice]
            await state.update_data(
                button_cfg={
                    "type": "url",
                    "style": style,
                    "text": "",
                    "url": "",
                    "icon_custom_emoji_id": None,
                }
            )
            await message.answer(
                f"Выбрана кнопка-ссылка ({color_label}).\n\n"
                "Введите <b>текст кнопки</b>.\n"
                "Можно добавить premium custom emoji — оно будет показано на кнопке перед текстом.",
                parse_mode="HTML",
            )
            await state.update_data(_url_step="url_text")
            await state.set_state(SendMessage.waiting_for_url_text)
            return

        # Вариант: без кнопки
        if choice == "7":
            await state.update_data(button_cfg=None)
            await message.answer(
                "Хорошо, кнопки не будет.\n\n"
                "Теперь отправьте само <b>сообщение</b>.\n"
                "Можно прикрепить фото, видео или использовать форматирование.",
                parse_mode="HTML",
            )
            await state.set_state(SendMessage.waiting_for_message)
            return

        await message.answer("Введите число от <b>1</b> до <b>7</b>.", parse_mode="HTML")

    # ── Шаг 3: текст кнопки (для webapp — переименование; для url — label) ────

    @dp.message(SendMessage.waiting_for_url_text)
    async def process_url_text(message: Message, state: FSMContext):
        data = await state.get_data()
        url_step = data.get("_url_step")
        btn_cfg = data.get("button_cfg", {})

        custom_emoji_id = _first_custom_emoji_id(message.entities)
        clean_text = _strip_custom_emoji_entities(message.text or "", message.entities or [])

        if url_step == "webapp_label":
            # Пользователь вводит кастомный текст для кнопки webapp.
            # Если он отправил только custom emoji без текста, оставляем
            # стандартный label и просто привязываем emoji.
            if clean_text and clean_text != "-":
                btn_cfg["label"] = clean_text
            if custom_emoji_id:
                btn_cfg["icon_custom_emoji_id"] = custom_emoji_id

            await state.update_data(button_cfg=btn_cfg)
            await message.answer(
                "Отлично!\n\n"
                "Теперь отправьте само <b>сообщение</b>.\n"
                "Можно прикрепить фото, видео или использовать форматирование.",
                parse_mode="HTML",
            )
            await state.set_state(SendMessage.waiting_for_message)
            return

        if url_step == "url_text":
            if not clean_text:
                await message.answer("Текст кнопки не может быть пустым. Попробуйте ещё раз.")
                return

            btn_cfg["text"] = clean_text
            if custom_emoji_id:
                btn_cfg["icon_custom_emoji_id"] = custom_emoji_id

            await state.update_data(button_cfg=btn_cfg, _url_step="url_link")
            await message.answer(
                "Теперь введите <b>URL</b> (начинается с https://):",
                parse_mode="HTML",
            )
            await state.set_state(SendMessage.waiting_for_url_link)
            return

        # На случай неожиданного состояния — пропустить вперёд
        await state.set_state(SendMessage.waiting_for_message)

    # ── Шаг 4: URL ────────────────────────────────────────────────────────────

    @dp.message(SendMessage.waiting_for_url_link)
    async def process_url_link(message: Message, state: FSMContext):
        url = (message.text or "").strip()
        btn_cfg = (await state.get_data()).get("button_cfg", {})

        if not url.startswith(("http://", "https://")):
            await message.answer(
                f"{E_CROSS} URL должен начинаться с <code>http://</code> или <code>https://</code>.\n"
                "Попробуйте ещё раз.",
                parse_mode="HTML",
            )
            return

        btn_cfg["url"] = url
        await state.update_data(button_cfg=btn_cfg)
        await message.answer(
            f"Кнопка: «{btn_cfg['text']}» → <code>{url}</code>\n\n"
            "Теперь отправьте само <b>сообщение</b>.\n"
            "Можно прикрепить фото, видео или использовать форматирование.",
            parse_mode="HTML",
        )
        await state.set_state(SendMessage.waiting_for_message)

    # ── Шаг 5: само сообщение + отправка ─────────────────────────────────────

    @dp.message(SendMessage.waiting_for_message)
    async def process_send_message(message: Message, state: FSMContext):
        data = await state.get_data()
        target = data.get("target")
        button_cfg = data.get("button_cfg")
        await state.clear()

        markup = _build_markup(button_cfg, target)

        await message.answer(f"{E_TIME} Начинаю отправку...", parse_mode="HTML")

        success_count, fail_count = 0, 0

        if target == "all":
            users = await database.get_all_user_ids()
            for user_id in users:
                try:
                    await message.copy_to(chat_id=user_id, reply_markup=markup)
                    success_count += 1
                    await asyncio.sleep(0.05)
                except Exception:
                    fail_count += 1

            await message.answer(
                f"{E_CHECK} Рассылка завершена!\n"
                f"Успешно доставлено: <b>{success_count}</b>\n"
                f"Ошибок: <b>{fail_count}</b>",
                parse_mode="HTML",
            )
        elif target == "channel":
            channel_id = data.get("channel_id")
            try:
                await message.copy_to(chat_id=channel_id, reply_markup=markup)
                await message.answer(
                    f"{E_CHECK} Сообщение опубликовано в канале <b>{channel_id}</b>!",
                    parse_mode="HTML",
                )
            except Exception as e:
                await message.answer(
                    f"{E_CROSS} Не удалось опубликовать в канале.\n"
                    f"Убедитесь, что бот является администратором канала.\n"
                    f"Детали: <code>{e}</code>",
                    parse_mode="HTML",
                )
        else:
            try:
                await message.copy_to(chat_id=target, reply_markup=markup)
                await message.answer(
                    f"{E_CHECK} Сообщение успешно доставлено пользователю <b>{target}</b>!",
                    parse_mode="HTML",
                )
            except Exception as e:
                await message.answer(
                    f"{E_CROSS} Ошибка при отправке.\nДетали: {e}",
                    parse_mode="HTML",
                )
