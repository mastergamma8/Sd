# handlers/support.py — Бот поддержки @SpaceDonutSupportBot
import logging
from aiogram import Bot, Dispatcher, F
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import StatesGroup, State
from aiogram.types import (
    Message, CallbackQuery,
    InlineKeyboardMarkup, InlineKeyboardButton
)
from aiogram.enums import ButtonStyle

import config

logger = logging.getLogger(__name__)

# --- Premium emoji для текстов (HTML-теги) ---
E_WAVE = '<tg-emoji emoji-id="5472055112702629499">👋</tg-emoji>'
E_LIST = '<tg-emoji emoji-id="5197269100878907942">📋</tg-emoji>'
E_GIFT = '<tg-emoji emoji-id="5963213811597970978">🎁</tg-emoji>'
E_MONEY = '<tg-emoji emoji-id="5409048419211682843">💰</tg-emoji>'
E_QUESTION = '<tg-emoji emoji-id="5436113877181941026">❓</tg-emoji>'
E_ONE = '<tg-emoji emoji-id="5316544002000958685">1️⃣</tg-emoji>'
E_TWO = '<tg-emoji emoji-id="5316673387890751150">2️⃣</tg-emoji>'
E_STAR = '<tg-emoji emoji-id="5897920748101571572">⭐</tg-emoji>'
E_PICTURE = '<tg-emoji emoji-id="5357581203333487844">🖼</tg-emoji>'
E_PHONE = '<tg-emoji emoji-id="5467539229468793355">📞</tg-emoji>'
E_BACK = '<tg-emoji emoji-id="5440735760208637835">⬅️</tg-emoji>'
E_PENCIL = '<tg-emoji emoji-id="5395444784611480792">✏️</tg-emoji>'
E_CHECK = '<tg-emoji emoji-id="5206607081334906820">✅</tg-emoji>'
E_SOS = '<tg-emoji emoji-id="5220108512893344933">🆘</tg-emoji>'
E_CROSS = '<tg-emoji emoji-id="5210952531676504517">❌</tg-emoji>'
E_REPLY = '<tg-emoji emoji-id="6039539366177541657">↩️</tg-emoji>'
E_CHAT = '<tg-emoji emoji-id="5443038326535759644">💬</tg-emoji>'
E_USER = '<tg-emoji emoji-id="6035084557378654059">👤</tg-emoji>'
E_PIN = '<tg-emoji emoji-id="5397782960512444700">📌</tg-emoji>'
E_RU = '<tg-emoji emoji-id="5449408995691341691">🇷🇺</tg-emoji>'
E_EN = '<tg-emoji emoji-id="5202021044105257611">🇺🇲</tg-emoji>'

# --- ID премиум эмодзи для кнопок ---
ID_RU = "5449408995691341691"
ID_EN = "5202021044105257611"
ID_GIFT = "5963213811597970978"
ID_MONEY = "5409048419211682843"
ID_QUESTION = "5436113877181941026"
ID_PICTURE = "5357581203333487844"
ID_STAR = "5897920748101571572"
ID_PHONE = "5467539229468793355"
ID_BACK = "5440735760208637835"

# --- Список администраторов, получающих заявки ---
SUPPORT_ADMIN_IDS: list[int] = [config.ADMIN_ID]

# ─── FSM ─────────────────────────────────────────────────────────────────────

class SupportFSM(StatesGroup):
    lang = State()        # выбор языка
    category = State()    # выбор категории
    topup_type = State()  # подкатегория «не пополняется баланс»
    free_text = State()   # пользователь описывает «другую проблему»
    in_chat = State()     # диалог с оператором


# ─── Тексты ──────────────────────────────────────────────────────────────────

TEXTS = {
    "ru": {
        "welcome": (
            f"{E_WAVE} <b>Добро пожаловать в поддержку Space Donut!</b>\n\n"
            "Выберите язык / Please select your language:"
        ),
        "choose_lang": "Пожалуйста, выберите язык:",
        "choose_category": (
            f"{E_LIST} <b>Выберите тему обращения:</b>"
        ),
        "cat1": f"{E_GIFT} Не приходит подарок",
        "cat2": f"{E_MONEY} Не пополняется баланс",
        "cat3": f"{E_QUESTION} Другая проблема",
        "btn_cat1": "Не приходит подарок",
        "btn_cat2": "Не пополняется баланс",
        "btn_cat3": "Другая проблема",
        "gift_help": (
            f"{E_GIFT} <b>Не приходит подарок</b>\n\n"
            "Попробуйте следующее:\n\n"
            f"{E_ONE} Убедитесь, что вы отправили подарок на аккаунт "
            "<b>@SpaceDonutGifts</b> — именно туда принимаются все NFT-подарки.\n\n"
            f"{E_TWO} Подождите около <b>30 минут</b> — обработка может занять время.\n\n"
            "Если после ожидания подарок всё ещё не зачислен, свяжитесь с оператором."
        ),
        "topup_choose": (
            f"{E_MONEY} <b>Не пополняется баланс</b>\n\n"
            "Уточните способ пополнения:"
        ),
        "topup_nft": f"{E_PICTURE} NFT-подарком",
        "topup_stars": f"{E_STAR} Звёздами",
        "btn_topup_nft": "NFT-подарком",
        "btn_topup_stars": "Звёздами",
        "topup_nft_help": (
            f"{E_PICTURE} <b>Пополнение NFT-подарком</b>\n\n"
            "Убедитесь, что подарок был отправлен на аккаунт <b>@SpaceDonutGifts</b>.\n\n"
            "Если всё верно — напишите туда ещё раз и подождите <b>30 минут</b>.\n\n"
            "Если баланс по-прежнему не зачислен, нажмите кнопку ниже, "
            "чтобы связаться с оператором."
        ),
        "topup_stars_help": (
            f"{E_STAR} <b>Пополнение звёздами</b>\n\n"
            "Пополнение звёздами обрабатывается автоматически сразу после оплаты.\n\n"
            "Если средства списались, но баланс не пополнился — "
            "нажмите кнопку ниже, чтобы связаться с оператором. "
            "Пожалуйста, сохраните подтверждение платежа."
        ),
        "operator_btn": f"{E_PHONE} Связаться с оператором",
        "back_btn": f"{E_BACK} Назад",
        "btn_operator": "Связаться с оператором",
        "btn_back": "Назад",
        "other_prompt": (
            f"{E_PENCIL} <b>Опишите вашу проблему</b>\n\n"
            "Напишите подробное сообщение — оператор ответит вам в ближайшее время."
        ),
        "other_sent": (
            f"{E_CHECK} <b>Ваше обращение отправлено!</b>\n\n"
            "Оператор рассмотрит его и ответит вам здесь."
        ),
        "operator_connecting": (
            f"{E_PHONE} <b>Соединяем с оператором…</b>\n\n"
            "Опишите вашу проблему в следующем сообщении — "
            "оператор ответит вам в этом чате."
        ),
        "operator_notified": (
            f"{E_CHECK} Ваше сообщение отправлено оператору. Ожидайте ответа."
        ),
        "admin_ticket": (
            f"{E_SOS} <b>Новая заявка в поддержку</b>\n"
            f"{E_USER} Пользователь: <a href=\"tg://user?id={{uid}}\">{{name}}</a> "
            "(<code>{uid}</code>)\n"
            f"{E_PIN} Тема: <b>{{topic}}</b>\n"
            f"{E_CHAT} Сообщение:\n{{text}}"
        ),
        "admin_reply_hint": (
            f"{E_REPLY} Ответить: <code>/reply {{uid}} текст ответа</code>"
        ),
        "reply_sent": f"{E_CHECK} Ответ отправлен пользователю.",
        "reply_fail": f"{E_CROSS} Не удалось доставить ответ пользователю {{uid}}.",
        "user_reply": f"{E_CHAT} <b>Ответ оператора:</b>\n\n{{text}}",
        "chat_prompt": (
            f"{E_CHAT} <b>Вы в режиме диалога с оператором.</b>\n"
            "Напишите следующее сообщение — оно будет передано оператору."
        ),
        "chat_forwarded": f"{E_CHECK} Сообщение отправлено оператору.",
    },
    "en": {
        "welcome": (
            f"{E_WAVE} <b>Welcome to Space Donut Support!</b>\n\n"
            "Выберите язык / Please select your language:"
        ),
        "choose_lang": "Please select your language:",
        "choose_category": (
            f"{E_LIST} <b>Choose a support topic:</b>"
        ),
        "cat1": f"{E_GIFT} Gift not received",
        "cat2": f"{E_MONEY} Balance not topped up",
        "cat3": f"{E_QUESTION} Other issue",
        "btn_cat1": "Gift not received",
        "btn_cat2": "Balance not topped up",
        "btn_cat3": "Other issue",
        "gift_help": (
            f"{E_GIFT} <b>Gift not received</b>\n\n"
            "Please try the following:\n\n"
            f"{E_ONE} Make sure you sent the gift to <b>@SpaceDonutGifts</b> — "
            "that is the only account that accepts NFT gifts.\n\n"
            f"{E_TWO} Wait around <b>30 minutes</b> — processing can take some time.\n\n"
            "If the gift has still not arrived, please contact an operator."
        ),
        "topup_choose": (
            f"{E_MONEY} <b>Balance not topped up</b>\n\n"
            "Please select your top-up method:"
        ),
        "topup_nft": f"{E_PICTURE} NFT gift",
        "topup_stars": f"{E_STAR} Stars",
        "btn_topup_nft": "NFT gift",
        "btn_topup_stars": "Stars",
        "topup_nft_help": (
            f"{E_PICTURE} <b>Top-up via NFT gift</b>\n\n"
            "Make sure the gift was sent to <b>@SpaceDonutGifts</b>.\n\n"
            "If confirmed — send it again and wait <b>30 minutes</b>.\n\n"
            "If your balance is still not credited, press the button below "
            "to contact an operator."
        ),
        "topup_stars_help": (
            f"{E_STAR} <b>Top-up via Stars</b>\n\n"
            "Star payments are processed automatically immediately after payment.\n\n"
            "If the amount was charged but your balance was not updated — "
            "press the button below to contact an operator. "
            "Please keep your payment confirmation."
        ),
        "operator_btn": f"{E_PHONE} Contact operator",
        "back_btn": f"{E_BACK} Back",
        "btn_operator": "Contact operator",
        "btn_back": "Back",
        "other_prompt": (
            f"{E_PENCIL} <b>Describe your issue</b>\n\n"
            "Write a detailed message — an operator will reply shortly."
        ),
        "other_sent": (
            f"{E_CHECK} <b>Your request has been submitted!</b>\n\n"
            "An operator will review it and reply here."
        ),
        "operator_connecting": (
            f"{E_PHONE} <b>Connecting to an operator…</b>\n\n"
            "Describe your issue in the next message — "
            "the operator will reply in this chat."
        ),
        "operator_notified": (
            f"{E_CHECK} Your message has been sent to the operator. Please wait for a reply."
        ),
        "admin_ticket": (
            f"{E_SOS} <b>New support ticket</b>\n"
            f"{E_USER} User: <a href=\"tg://user?id={{uid}}\">{{name}}</a> "
            "(<code>{uid}</code>)\n"
            f"{E_PIN} Topic: <b>{{topic}}</b>\n"
            f"{E_CHAT} Message:\n{{text}}"
        ),
        "admin_reply_hint": (
            f"{E_REPLY} Reply: <code>/reply {{uid}} reply text</code>"
        ),
        "reply_sent": f"{E_CHECK} Reply sent to user.",
        "reply_fail": f"❌ Could not deliver reply to user {{uid}}.",
        "user_reply": f"{E_CHAT} <b>Operator reply:</b>\n\n{{text}}",
        "chat_prompt": (
            f"{E_CHAT} <b>You are in a live chat with an operator.</b>\n"
            "Write your next message — it will be forwarded to the operator."
        ),
        "chat_forwarded": f"{E_CHECK} Message forwarded to the operator.",
    },
}


def t(lang: str, key: str, **kwargs) -> str:
    text = TEXTS.get(lang, TEXTS["ru"]).get(key, key)
    return text.format(**kwargs) if kwargs else text


# ─── Клавиатуры ──────────────────────────────────────────────────────────────

def kb_lang() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="Русский",
                callback_data="sup_lang:ru",
                style=ButtonStyle.SUCCESS,
                icon_custom_emoji_id=ID_RU
            ),
            InlineKeyboardButton(
                text="English",
                callback_data="sup_lang:en",
                style=ButtonStyle.SUCCESS,
                icon_custom_emoji_id=ID_EN
            ),
        ]
    ])


def kb_category(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t(lang, "btn_cat1"), callback_data="sup_cat:1", style=ButtonStyle.PRIMARY, icon_custom_emoji_id=ID_GIFT)],
        [InlineKeyboardButton(text=t(lang, "btn_cat2"), callback_data="sup_cat:2", style=ButtonStyle.SUCCESS, icon_custom_emoji_id=ID_MONEY)],
        [InlineKeyboardButton(text=t(lang, "btn_cat3"), callback_data="sup_cat:3", style=ButtonStyle.DANGER, icon_custom_emoji_id=ID_QUESTION)],
    ])


def kb_gift_help(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t(lang, "btn_operator"), callback_data="sup_op:gift", style=ButtonStyle.DANGER, icon_custom_emoji_id=ID_PHONE)],
        [InlineKeyboardButton(text=t(lang, "btn_back"), callback_data="sup_back:category", style=ButtonStyle.PRIMARY, icon_custom_emoji_id=ID_BACK)],
    ])


def kb_topup_type(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t(lang, "btn_topup_nft"), callback_data="sup_topup:nft", style=ButtonStyle.SUCCESS, icon_custom_emoji_id=ID_PICTURE)],
        [InlineKeyboardButton(text=t(lang, "btn_topup_stars"), callback_data="sup_topup:stars", style=ButtonStyle.SUCCESS, icon_custom_emoji_id=ID_STAR)],
        [InlineKeyboardButton(text=t(lang, "btn_back"), callback_data="sup_back:category", style=ButtonStyle.PRIMARY, icon_custom_emoji_id=ID_BACK)],
    ])


def kb_topup_help(lang: str) -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=t(lang, "btn_operator"), callback_data="sup_op:topup", style=ButtonStyle.DANGER, icon_custom_emoji_id=ID_PHONE)],
        [InlineKeyboardButton(text=t(lang, "btn_back"), callback_data="sup_back:topup", style=ButtonStyle.PRIMARY, icon_custom_emoji_id=ID_BACK)],
    ])


# ─── Уведомление администраторов ─────────────────────────────────────────────

async def notify_admins(
    bot: Bot,
    user: "aiogram.types.User",
    lang: str,
    topic: str,
    text: str,
) -> None:
    msg = (
        t(lang, "admin_ticket", uid=user.id, name=user.full_name, topic=topic, text=text)
        + "\n\n"
        + t(lang, "admin_reply_hint", uid=user.id)
    )
    for admin_id in SUPPORT_ADMIN_IDS:
        try:
            await bot.send_message(admin_id, msg, parse_mode="HTML")
        except Exception as exc:
            logger.warning(f"Не удалось уведомить администратора {admin_id}: {exc}")


# ─── Регистрация хендлеров ───────────────────────────────────────────────────

def register(dp: Dispatcher, bot: Bot) -> None:

    # ── /start ──────────────────────────────────────────────────────────────

    @dp.message(F.text == "/start")
    async def support_start(message: Message, state: FSMContext):
        await state.clear()
        await message.answer(
            t("ru", "welcome"),
            reply_markup=kb_lang(),
            parse_mode="HTML",
        )
        await state.set_state(SupportFSM.lang)

    # ── Выбор языка ─────────────────────────────────────────────────────────

    @dp.callback_query(SupportFSM.lang, F.data.startswith("sup_lang:"))
    async def cb_lang(call: CallbackQuery, state: FSMContext):
        lang = call.data.split(":")[1]
        await state.update_data(lang=lang)
        await call.message.edit_text(
            t(lang, "choose_category"),
            reply_markup=kb_category(lang),
            parse_mode="HTML",
        )
        await state.set_state(SupportFSM.category)
        await call.answer()

    # ── Выбор категории ─────────────────────────────────────────────────────

    @dp.callback_query(SupportFSM.category, F.data.startswith("sup_cat:"))
    async def cb_category(call: CallbackQuery, state: FSMContext):
        data = await state.get_data()
        lang = data.get("lang", "ru")
        cat = call.data.split(":")[1]

        if cat == "1":
            await call.message.edit_text(
                t(lang, "gift_help"),
                reply_markup=kb_gift_help(lang),
                parse_mode="HTML",
            )

        elif cat == "2":
            await call.message.edit_text(
                t(lang, "topup_choose"),
                reply_markup=kb_topup_type(lang),
                parse_mode="HTML",
            )
            await state.set_state(SupportFSM.topup_type)

        elif cat == "3":
            await call.message.edit_text(
                t(lang, "other_prompt"),
                parse_mode="HTML",
            )
            await state.update_data(topic=t(lang, "cat3"))
            await state.set_state(SupportFSM.free_text)

        await call.answer()

    # ── Подкатегория пополнения ─────────────────────────────────────────────

    @dp.callback_query(SupportFSM.topup_type, F.data.startswith("sup_topup:"))
    async def cb_topup_type(call: CallbackQuery, state: FSMContext):
        data = await state.get_data()
        lang = data.get("lang", "ru")
        ttype = call.data.split(":")[1]

        if ttype == "nft":
            await call.message.edit_text(
                t(lang, "topup_nft_help"),
                reply_markup=kb_topup_help(lang),
                parse_mode="HTML",
            )
        else:
            await call.message.edit_text(
                t(lang, "topup_stars_help"),
                reply_markup=kb_topup_help(lang),
                parse_mode="HTML",
            )

        await call.answer()

    # ── Кнопка «Назад» ──────────────────────────────────────────────────────

    @dp.callback_query(F.data.startswith("sup_back:"))
    async def cb_back(call: CallbackQuery, state: FSMContext):
        data = await state.get_data()
        lang = data.get("lang", "ru")
        dest = call.data.split(":")[1]

        if dest == "category":
            await call.message.edit_text(
                t(lang, "choose_category"),
                reply_markup=kb_category(lang),
                parse_mode="HTML",
            )
            await state.set_state(SupportFSM.category)

        elif dest == "topup":
            await call.message.edit_text(
                t(lang, "topup_choose"),
                reply_markup=kb_topup_type(lang),
                parse_mode="HTML",
            )
            await state.set_state(SupportFSM.topup_type)

        await call.answer()

    # ── Связаться с оператором ──────────────────────────────────────────────

    @dp.callback_query(F.data.startswith("sup_op:"))
    async def cb_operator(call: CallbackQuery, state: FSMContext):
        data = await state.get_data()
        lang = data.get("lang", "ru")
        topic_key = call.data.split(":")[1]

        topic_map = {
            "gift": t(lang, "cat1"),
            "topup": t(lang, "cat2"),
        }
        topic = topic_map.get(topic_key, topic_key)
        await state.update_data(topic=topic)

        await call.message.edit_text(
            t(lang, "operator_connecting"),
            parse_mode="HTML",
        )
        await state.set_state(SupportFSM.in_chat)
        await call.answer()

    # ── Получение свободного текста («другая проблема») ─────────────────────

    @dp.message(SupportFSM.free_text)
    async def handle_free_text(message: Message, state: FSMContext):
        data = await state.get_data()
        lang = data.get("lang", "ru")
        topic = data.get("topic", t(lang, "cat3"))

        await notify_admins(bot, message.from_user, lang, topic, message.text or "")
        await message.answer(t(lang, "other_sent"), parse_mode="HTML")
        # Переводим в режим диалога, чтобы пользователь мог продолжить общение
        await state.set_state(SupportFSM.in_chat)

    # ── Режим живого диалога ─────────────────────────────────────────────────

    @dp.message(SupportFSM.in_chat)
    async def handle_in_chat(message: Message, state: FSMContext):
        data = await state.get_data()
        lang = data.get("lang", "ru")
        topic = data.get("topic", "—")

        await notify_admins(bot, message.from_user, lang, topic, message.text or "")
        await message.answer(t(lang, "operator_notified"), parse_mode="HTML")

    # ── Команда /reply для администратора ───────────────────────────────────

    @dp.message(F.text.startswith("/reply "))
    async def cmd_reply(message: Message):
        if message.from_user.id not in SUPPORT_ADMIN_IDS:
            return

        parts = message.text.split(" ", 2)
        if len(parts) < 3:
            await message.answer("Использование: /reply <user_id> <текст>")
            return

        try:
            target_uid = int(parts[1])
        except ValueError:
            await message.answer("Некорректный user_id.")
            return

        reply_text = parts[2]

        try:
            await bot.send_message(
                target_uid,
                TEXTS["ru"]["user_reply"].format(text=reply_text),
                parse_mode="HTML",
            )
            await message.answer(t("ru", "reply_sent"))
        except Exception as exc:
            logger.warning(f"Ошибка отправки ответа {target_uid}: {exc}")
            await message.answer(t("ru", "reply_fail", uid=target_uid))