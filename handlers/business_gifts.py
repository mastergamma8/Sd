"""
handlers/business_gifts.py — Обработчик Telegram-подарков через Telegram Business.

Поддерживаются два сценария:

1. ОБЫЧНЫЙ TELEGRAM-ПОДАРОК (star gift)
   Бот сверяет Gift.id с TG_STICKER_TO_BASE_GIFT_ID и начисляет
   соответствующий BASE_GIFT в user_gifts.

2. УНИКАЛЬНЫЙ (NFT) TELEGRAM-ПОДАРОК
   Бот записывает подарок в tg_nft_inventory, используя owned_gift_id
   как основной ключ дедупликации (это официальный уникальный идентификатор
   подарка в контексте бизнес-аккаунта согласно Bot API).

Структура Bot API (актуально):
  message.unique_gift       → UniqueGiftInfo
    .owned_gift_id          → str, основной dedup-ключ для бизнес-аккаунтов
    .gift                   → UniqueGift
        .name               → уникальное имя ("HatOfWisdom")
        .base_name          → читаемое имя ("Hat of Wisdom")
        .number             → коллекционный номер (не serial_number!)
        .model / .symbol    → содержат .sticker с emoji и file_id

  message.gift              → GiftInfo (обычный подарок)
    .id                     → str, идентификатор типа подарка (Gift.id из Bot API)
    [НЕ использовать .sticker.file_unique_id — это идентификатор файла, не подарка]

Требования к настройке:
  — @SpaceDonutGifts подключён как Telegram Business.
  — Бот подключён через «Настройки → Telegram Business → Chatbot».
  — Webhook: allowed_updates=["business_message", "business_connection", ...].
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from aiogram import Bot, Dispatcher
from aiogram.enums import ButtonStyle
from aiogram.types import (
    Message, BusinessConnection,
    InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo,
)

import config
import database
from db.db_tg_nft import (
    add_tg_nft_to_user,
    save_business_connection,
    deactivate_business_connection,
    get_business_connections,
    is_regular_gift_synced,
    mark_regular_gift_synced,
)
from .admin_constants import E_GIFT, ID_EYES

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Разметка уведомительного сообщения (кнопка «Посмотреть в профиле»)
# ─────────────────────────────────────────────────────────────────────────────

def _profile_markup() -> InlineKeyboardMarkup:
    """Кнопка с WebApp-ссылкой, открывающей профиль прямо в Telegram."""
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="Посмотреть в профиле",
            web_app=WebAppInfo(url=config.WEBAPP_URL),
            style=ButtonStyle.SUCCESS,
            icon_custom_emoji_id=ID_EYES,
        )
    ]])


# ─────────────────────────────────────────────────────────────────────────────
# Вспомогательные функции: извлечение данных уникального подарка
# ─────────────────────────────────────────────────────────────────────────────

def _is_unique_gift(obj: Any) -> bool:
    """
    Проверяет, является ли объект UniqueGift.
    UniqueGift содержит поле 'number' (коллекционный номер) и/или 'base_name',
    которых нет у обычного Gift. Ранее ошибочно проверялось 'serial_number'.
    """
    return hasattr(obj, "number") or hasattr(obj, "base_name")


def _extract_sticker_info(gift_obj: Any) -> tuple[str, str]:
    """Извлекает (emoji, file_id) стикера из UniqueGift.model или .symbol."""
    emoji = ""
    file_id = ""
    for attr in ("model", "symbol", "sticker"):
        part = getattr(gift_obj, attr, None)
        if part is None:
            continue
        sticker = getattr(part, "sticker", part)
        e = getattr(sticker, "emoji", None)
        f = getattr(sticker, "file_id", None)
        if e:
            emoji = str(e)
        if f:
            file_id = str(f)
        if emoji and file_id:
            break
    return emoji, file_id


def _parse_unique_gift_obj(obj: Any, owned_gift_id: str = "") -> dict[str, Any]:
    """
    Нормализует UniqueGift-совместимый объект в словарь.

    owned_gift_id передаётся сверху (из UniqueGiftInfo-обёртки),
    так как на внутреннем объекте UniqueGift этого поля нет.
    Он используется как основной ключ дедупликации tg_gift_id.
    """
    name      = str(getattr(obj, "name", "") or "")
    base_name = str(getattr(obj, "base_name", "") or "")
    number    = int(getattr(obj, "number", 0) or 0)   # Bot API: UniqueGift.number

    sticker_emoji, sticker_file_id = _extract_sticker_info(obj)

    # Приоритет ключа дедупликации: owned_gift_id > name > fallback
    tg_gift_id = owned_gift_id or name or f"{base_name}#{number}"

    return {
        "tg_gift_id":      tg_gift_id,
        "owned_gift_id":   owned_gift_id,
        "gift_name":       name,
        "base_name":       base_name,
        "number":          number,
        "sticker_emoji":   sticker_emoji,
        "sticker_file_id": sticker_file_id,
    }


def _extract_unique_gift_data(message: Message) -> dict[str, Any] | None:
    """
    Извлекает данные уникального (NFT) подарка из бизнес-сообщения.

    Путь 1 (приоритетный, Bot API 8.3+):
        message.unique_gift  →  UniqueGiftInfo
            .owned_gift_id   — официальный уникальный ID для бизнес-аккаунтов
            .gift            — UniqueGift с .name, .base_name, .number

    Путь 2 (резервный, старая структура):
        message.gift         →  обёртка, может содержать UniqueGift в .gift
            .owned_gift_id   — если присутствует на обёртке
    """
    # ── Путь 1: message.unique_gift (UniqueGiftInfo) ──────────────────────────
    ug_info = getattr(message, "unique_gift", None)
    if ug_info is not None:
        owned = str(getattr(ug_info, "owned_gift_id", "") or "")
        inner = getattr(ug_info, "gift", ug_info)   # UniqueGift внутри
        return _parse_unique_gift_obj(inner, owned_gift_id=owned)

    # ── Путь 2: message.gift с вложенным UniqueGift ────────────────────────────
    gift_wrapper = getattr(message, "gift", None)
    if gift_wrapper is not None:
        owned = str(getattr(gift_wrapper, "owned_gift_id", "") or "")
        inner = getattr(gift_wrapper, "gift", None)
        if inner is not None and _is_unique_gift(inner):
            return _parse_unique_gift_obj(inner, owned_gift_id=owned)
        if _is_unique_gift(gift_wrapper):
            return _parse_unique_gift_obj(gift_wrapper, owned_gift_id=owned)

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Вспомогательные функции: извлечение ID обычного подарка
# ─────────────────────────────────────────────────────────────────────────────

def _get_gift_type_id(message: Message) -> str | None:
    """
    Возвращает Gift.id обычного Telegram-подарка из бизнес-сообщения.

    Gift.id — официальный идентификатор типа подарка в Bot API (не file_unique_id,
    который является идентификатором файла и непригоден для маппинга).
    Резервный путь на sticker.file_unique_id намеренно убран.

    Возвращает None, если подарка нет или он не является обычным Gift.
    """
    gift = getattr(message, "gift", None)
    if gift is None:
        return None

    # Путь 1: message.gift.id  (стандартная позиция в Bot API 7.x+)
    gid = getattr(gift, "id", None)
    if gid:
        return str(gid)

    # Путь 2: message.gift.gift.id  (если Gift обёрнут в GiftInfo)
    inner = getattr(gift, "gift", None)
    if inner is not None:
        gid = getattr(inner, "id", None)
        if gid:
            return str(gid)

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Регистрация хэндлера
# ─────────────────────────────────────────────────────────────────────────────

def register(dp: Dispatcher, bot: Bot) -> None:
    """Регистрирует хэндлер бизнес-сообщений. Вызывается один раз из bot.py."""

    @dp.business_connection()
    async def handle_business_connection(bc: BusinessConnection) -> None:
        """
        Срабатывает когда @SpaceDonutGifts подключает (или отключает) бот.
        Сохраняем conn_id, чтобы впоследствии вызывать getBusinessAccountGifts
        и синхронизировать подарки, пришедшие до активации хэндлера.
        После сохранения сразу запускаем историческую синхронизацию.
        При отключении (is_enabled=False) помечаем соединение неактивным,
        чтобы оно не использовалось при будущих синхронизациях.
        """
        conn_id = str(bc.id or "")
        if not conn_id:
            return
        if bc.is_enabled:
            await save_business_connection(conn_id)
            logger.info("[business_gifts] business_connection сохранён: %s (is_enabled=%s)", conn_id, bc.is_enabled)
            asyncio.create_task(sync_historical_gifts(bot))
        else:
            await deactivate_business_connection(conn_id)
            logger.info("[business_gifts] business_connection отключён и деактивирован: %s", conn_id)

    @dp.business_message()
    async def handle_business_message(message: Message) -> None:
        """
        Обрабатывает все business_message.

        Порядок проверок:
          1. Уникальный (NFT) подарок → tg_nft_inventory
          2. Обычный подарок из BASE_GIFTS → user_gifts
          3. Всё остальное — игнорируется.
        """
        if message.from_user is None:
            return

        sender_id:       int = message.from_user.id
        business_conn_id: str = str(message.business_connection_id or "")

        # ── Регистрируем пользователя (upsert — безопасен при повторе) ─────────
        try:
            await database.upsert_user(
                tg_id=sender_id,
                username=message.from_user.username or "",
                first_name=message.from_user.first_name or "Игрок",
                photo_url="",
            )
        except Exception as exc:
            logger.error("[business_gifts] upsert_user error: %s", exc)

        # ── Шаг 1: уникальный (NFT) подарок ───────────────────────────────────
        unique_data = _extract_unique_gift_data(message)
        if unique_data is not None:
            await _handle_unique_gift(bot, sender_id, unique_data, business_conn_id)
            return

        # ── Шаг 2: обычный BASE_GIFT ───────────────────────────────────────────
        tg_gift_type_id = _get_gift_type_id(message)
        if tg_gift_type_id is not None:
            await _handle_regular_gift(bot, sender_id, tg_gift_type_id, business_conn_id)
            return

        logger.debug(
            "[business_gifts] business_message от user_id=%s без подарка — пропуск.",
            sender_id,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Обработка обычного подарка (BASE_GIFT)
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_regular_gift(
    bot: Bot,
    sender_id: int,
    tg_gift_type_id: str,
    business_conn_id: str = "",
) -> None:
    """
    Находит BASE_GIFT по Gift.id, начисляет его в user_gifts,
    записывает событие в историю и уведомляет пользователя.
    """
    base_gift_id = config.TG_STICKER_TO_BASE_GIFT_ID.get(tg_gift_type_id)
    if base_gift_id is None:
        logger.info(
            "[business_gifts] Gift.id=%r не найден в TG_STICKER_TO_BASE_GIFT_ID "
            "(business_conn=%s).", tg_gift_type_id, business_conn_id,
        )
        return

    gift_def  = config.BASE_GIFTS.get(base_gift_id, {})
    gift_name = gift_def.get("name", f"Подарок #{base_gift_id}")

    logger.info(
        "[business_gifts] Обычный подарок: user_id=%s gift_id=%r → "
        "BASE_GIFT#%s (%s) conn=%s",
        sender_id, tg_gift_type_id, base_gift_id, gift_name, business_conn_id,
    )

    try:
        await database.add_gift_to_user(sender_id, base_gift_id, 1)
    except Exception as exc:
        logger.error(
            "[business_gifts] add_gift_to_user error user=%s gift=%s: %s",
            sender_id, base_gift_id, exc,
        )
        return

    # ── История операции ──────────────────────────────────────────────────────
    try:
        await database.add_history_entry(
            sender_id,
            "tg_gift_received",
            f"Получен TG-подарок: {gift_name} [gift_id:{base_gift_id}]",
            0,
        )
    except Exception as exc:
        logger.warning("[business_gifts] add_history_entry error user=%s: %s", sender_id, exc)

    # ── Уведомление пользователя ──────────────────────────────────────────────
    try:
        await bot.send_message(
            chat_id=sender_id,
            text=(
                f"{E_GIFT} <b>Получен новый подарок!</b>\n\n"
                f"<b>{gift_name}</b> добавлен в твой инвентарь.\n"
                f"Открой приложение, чтобы посмотреть свою коллекцию!"
            ),
            parse_mode="HTML",
            reply_markup=_profile_markup(),
        )
    except Exception as exc:
        logger.warning("[business_gifts] Уведомление не доставлено user=%s: %s", sender_id, exc)


# ─────────────────────────────────────────────────────────────────────────────
# Обработка уникального (NFT) подарка
# ─────────────────────────────────────────────────────────────────────────────

async def _handle_unique_gift(
    bot: Bot,
    sender_id: int,
    gift_data: dict[str, Any],
    business_conn_id: str = "",
) -> None:
    """
    Обрабатывает уникальный (NFT) Telegram-подарок.

    Логика:
      1. Записывает подарок в tg_nft_inventory для дедупликации
         (UNIQUE(tg_gift_id) ON CONFLICT DO NOTHING → rowcount=0 при дубле).
      2. Ищет соответствующий BASE_GIFT по UniqueGift.base_name.
      3. Если нашёл — начисляет его в обычный инвентарь user_gifts,
         чтобы подарок отображался рядом с остальными с иконкой из BASE_GIFTS.
    """
    tg_gift_id    = gift_data["tg_gift_id"]
    owned_gift_id = gift_data["owned_gift_id"]
    gift_name     = gift_data["gift_name"]
    base_name     = gift_data["base_name"]
    number        = gift_data["number"]
    sticker_emoji = gift_data["sticker_emoji"]
    sticker_fid   = gift_data["sticker_file_id"]

    # ── Шаг 1: дедупликация через tg_nft_inventory ───────────────────────────
    added = await add_tg_nft_to_user(
        user_id=sender_id,
        tg_gift_id=tg_gift_id,
        owned_gift_id=owned_gift_id,
        gift_name=gift_name,
        base_name=base_name,
        number=number,
        sticker_emoji=sticker_emoji,
        sticker_file_id=sticker_fid,
        business_conn_id=business_conn_id,
    )

    if not added:
        logger.info(
            "[business_gifts] NFT %r уже в инвентаре (дубль), пропуск.", tg_gift_id
        )
        return

    logger.info(
        "[business_gifts] NFT: user_id=%s owned_id=%r name=%r base=%r #%s conn=%s",
        sender_id, owned_gift_id, gift_name, base_name, number, business_conn_id,
    )

    # ── Шаг 2: сопоставление с BASE_GIFT ─────────────────────────────────────
    base_gift_id = config.BASE_GIFT_NAME_TO_ID.get((base_name or "").lower())

    if base_gift_id is None:
        logger.warning(
            "[business_gifts] Уникальный подарок %r (base_name=%r) не найден в BASE_GIFTS.",
            tg_gift_id, base_name,
        )
        return

    gift_def  = config.BASE_GIFTS.get(base_gift_id, {})
    gift_disp = gift_def.get("name", base_name or gift_name)
    gift_val  = gift_def.get("value", 0)

    # ── Шаг 3: зачисление в обычный инвентарь user_gifts ─────────────────────
    try:
        await database.add_gift_to_user(sender_id, base_gift_id, 1)
    except Exception as exc:
        logger.error(
            "[business_gifts] add_gift_to_user error user=%s gift=%s: %s",
            sender_id, base_gift_id, exc,
        )
        return

    logger.info(
        "[business_gifts] ✅ NFT %r → BASE_GIFT#%s (%s) → user_gifts user_id=%s",
        tg_gift_id, base_gift_id, gift_disp, sender_id,
    )

    display_name = gift_disp
    emoji        = sticker_emoji or "🎁"

    # ── История операции ──────────────────────────────────────────────────────
    history_desc = (
        f"Получен NFT-подарок: {display_name} #{number} [gift_id:{base_gift_id}]"
    )
    try:
        await database.add_history_entry(
            sender_id,
            "tg_nft_received",
            history_desc,
            0,
        )
    except Exception as exc:
        logger.warning("[business_gifts] add_history_entry error user=%s: %s", sender_id, exc)

    # ── Уведомление пользователя ──────────────────────────────────────────────
    try:
        await bot.send_message(
            chat_id=sender_id,
            text=(
                f"{E_GIFT} <b>Получен уникальный подарок!</b>\n\n"
                f"{emoji} <b>{display_name}</b> (#{number}) добавлен в твой инвентарь.\n"
                f"Открой приложение, чтобы посмотреть свою коллекцию!"
            ),
            parse_mode="HTML",
            reply_markup=_profile_markup(),
        )
    except Exception as exc:
        logger.warning("[business_gifts] Уведомление не доставлено user=%s: %s", sender_id, exc)


# ─────────────────────────────────────────────────────────────────────────────
# Историческая синхронизация (подарки, пришедшие до активации хэндлера)
# ─────────────────────────────────────────────────────────────────────────────

async def sync_historical_gifts(bot: Bot) -> dict:
    """
    Запрашивает все подарки из истории @SpaceDonutGifts через
    getBusinessAccountGifts и начисляет их пользователям, которые
    уже есть в базе. Идемпотентна: повторный запуск не создаёт дублей.

    NFT-подарки: дедупликация через UNIQUE(tg_gift_id) в tg_nft_inventory.
    Обычные подарки: дедупликация через tg_regular_gift_sync_log (по owned_gift_id).

    Возвращает словарь со статистикой: nft_added, regular_added, skipped.
    """
    connections = await get_business_connections()
    if not connections:
        logger.info("[sync] Нет сохранённых business_connection_id — синхронизация пропущена.")
        return {"nft_added": 0, "regular_added": 0, "skipped": 0}

    total_nft     = 0
    total_regular = 0
    total_skip    = 0

    for conn_id in connections:
        offset: str | None = None
        page = 0

        while True:
            # ── Запрос страницы подарков ──────────────────────────────────────
            try:
                kwargs: dict = {"business_connection_id": conn_id, "limit": 100}
                if offset:
                    kwargs["offset"] = offset
                gifts_page = await bot.get_business_account_gifts(**kwargs)
            except AttributeError:
                logger.warning(
                    "[sync] bot.get_business_account_gifts недоступен в этой версии aiogram. "
                    "Обновите aiogram до 3.15+ для поддержки Bot API 9.0."
                )
                break
            except Exception as exc:
                error_text = str(exc)
                logger.error("[sync] getBusinessAccountGifts conn=%s: %s", conn_id, exc)
                if "BUSINESS_CONNECTION_INVALID" in error_text:
                    logger.info(
                        "[sync] Соединение conn=%s недействительно — деактивируем в БД.",
                        conn_id,
                    )
                    await deactivate_business_connection(conn_id)
                break

            gifts       = list(getattr(gifts_page, "gifts", []) or [])
            next_offset = getattr(gifts_page, "next_offset", None)

            logger.info("[sync] conn=%s page=%d gifts=%d", conn_id, page, len(gifts))

            for owned_gift in gifts:
                # Пропускаем анонимные подарки — не знаем, кому начислить
                sender = getattr(owned_gift, "sender_user", None)
                if sender is None:
                    total_skip += 1
                    continue
                sender_id: int | None = getattr(sender, "id", None)
                if not sender_id:
                    total_skip += 1
                    continue

                gift_type  = str(getattr(owned_gift, "type", "") or "")
                owned_id   = str(getattr(owned_gift, "owned_gift_id", "") or "")
                inner_gift = getattr(owned_gift, "gift", None)

                if inner_gift is None:
                    total_skip += 1
                    continue

                # ── Upsert пользователя (может не быть в БД) ─────────────────
                try:
                    await database.upsert_user(
                        tg_id=sender_id,
                        username=str(getattr(sender, "username", "") or ""),
                        first_name=str(getattr(sender, "first_name", "") or "Игрок"),
                        photo_url="",
                    )
                except Exception as exc:
                    logger.warning("[sync] upsert_user user=%s: %s", sender_id, exc)

                # ── NFT (уникальный) подарок ──────────────────────────────────
                if gift_type == "unique":
                    data = _parse_unique_gift_obj(inner_gift, owned_gift_id=owned_id)

                    # Дедупликация через tg_nft_inventory
                    added = await add_tg_nft_to_user(
                        user_id=sender_id,
                        tg_gift_id=data["tg_gift_id"],
                        owned_gift_id=data["owned_gift_id"],
                        gift_name=data["gift_name"],
                        base_name=data["base_name"],
                        number=data["number"],
                        sticker_emoji=data["sticker_emoji"],
                        sticker_file_id=data["sticker_file_id"],
                        business_conn_id=conn_id,
                    )
                    if not added:
                        total_skip += 1  # уже в инвентаре
                        continue

                    # Начисляем как BASE_GIFT в обычный инвентарь
                    base_gift_id = config.BASE_GIFT_NAME_TO_ID.get(
                        (data["base_name"] or "").lower()
                    )
                    if base_gift_id:
                        try:
                            await database.add_gift_to_user(sender_id, base_gift_id, 1)
                            total_nft += 1
                            logger.info(
                                "[sync] ✅ NFT %r → BASE_GIFT#%s → user_id=%s",
                                data["tg_gift_id"], base_gift_id, sender_id,
                            )
                            await database.add_history_entry(
                                sender_id,
                                "tg_nft_received",
                                f"Получен NFT-подарок: {data['base_name']} #{data['number']} [gift_id:{base_gift_id}]",
                                0,
                            )
                        except Exception as exc:
                            logger.error("[sync] add_gift_to_user NFT user=%s: %s", sender_id, exc)
                            total_skip += 1
                    else:
                        logger.warning(
                            "[sync] NFT %r base_name=%r не найден в BASE_GIFTS",
                            data["tg_gift_id"], data["base_name"],
                        )
                        total_skip += 1

                # ── Обычный подарок (BASE_GIFT) ───────────────────────────────
                elif gift_type == "regular":
                    gift_id_str = str(getattr(inner_gift, "id", "") or "")
                    if not gift_id_str:
                        total_skip += 1
                        continue

                    base_gift_id = config.TG_STICKER_TO_BASE_GIFT_ID.get(gift_id_str)
                    if base_gift_id is None:
                        total_skip += 1
                        continue

                    # Дедупликация: только подарки с owned_gift_id (Bot API ≥ 9.0)
                    if owned_id:
                        if await is_regular_gift_synced(owned_id):
                            total_skip += 1
                            continue

                    try:
                        await database.add_gift_to_user(sender_id, base_gift_id, 1)
                        if owned_id:
                            await mark_regular_gift_synced(owned_id, sender_id)
                        total_regular += 1
                        logger.info(
                            "[sync] ✅ Regular gift_id=%r → user_id=%s BASE_GIFT#%s",
                            gift_id_str, sender_id, base_gift_id,
                        )
                        gift_name = config.BASE_GIFTS.get(base_gift_id, {}).get("name", f"Подарок #{base_gift_id}")
                        await database.add_history_entry(
                            sender_id,
                            "tg_gift_received",
                            f"Получен TG-подарок: {gift_name} [gift_id:{base_gift_id}]",
                            0,
                        )
                    except Exception as exc:
                        logger.error("[sync] add_gift_to_user user=%s gift=%s: %s", sender_id, base_gift_id, exc)
                        total_skip += 1
                else:
                    total_skip += 1

            if not next_offset or not gifts:
                break
            offset = next_offset
            page  += 1

    logger.info(
        "[sync] Завершено: NFT=%d обычных=%d пропущено=%d",
        total_nft, total_regular, total_skip,
    )
    return {"nft_added": total_nft, "regular_added": total_regular, "skipped": total_skip}