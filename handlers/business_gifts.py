"""
handlers/business_gifts.py — Обработчик Telegram-подарков через Telegram Business.

РЕЖИМ РАБОТЫ:
  — Бот принимает business_connection ТОЛЬКО от аккаунта @spacedonutgifts.
    Любые другие аккаунты отклоняются; их соединения не сохраняются в БД.
  — Обрабатываются ТОЛЬКО обычные (regular) подарки, присутствующие
    в TG_STICKER_TO_BASE_GIFT_ID → BASE_GIFTS.
  — Уникальные (NFT / TG gift / unique) подарки игнорируются ПОЛНОСТЬЮ:
    не добавляются в инвентарь, не логируются в историю, уведомление
    пользователю НЕ отправляется.

Поддерживается один сценарий:
  ОБЫЧНЫЙ TELEGRAM-ПОДАРОК (star gift, тип "regular")
    Бот сверяет Gift.id с TG_STICKER_TO_BASE_GIFT_ID и начисляет
    соответствующий BASE_GIFT в user_gifts.

Структура Bot API (актуально):
  message.gift              → GiftInfo (обычный подарок)
    .id                     → str, идентификатор типа подарка (Gift.id из Bot API)
  message.unique_gift       → UniqueGiftInfo (уникальный — игнорируем)

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
    save_business_connection,
    deactivate_business_connection,
    get_business_connections,
    is_regular_gift_synced,
    mark_regular_gift_synced,
)
from .admin_constants import E_GIFT, ID_EYES

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Разрешённый бизнес-аккаунт
# Только этот аккаунт может подключить бота через Telegram Business.
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_BUSINESS_USERNAME: str = "spacedonutgifts"


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
# Определение типа подарка
# ─────────────────────────────────────────────────────────────────────────────

def _is_unique_gift_message(message: Message) -> bool:
    """
    Возвращает True если сообщение содержит уникальный (NFT / TG gift) подарок.

    Проверяет оба возможных пути, которые использует Bot API:
      Путь 1 (Bot API 8.3+): message.unique_gift → UniqueGiftInfo
      Путь 2 (старая структура): message.gift содержит UniqueGift с полями
                                 .number / .base_name, которых нет у обычного Gift.

    Уникальные подарки НЕ обрабатываются и должны быть отброшены без каких-либо
    действий (инвентарь не меняется, уведомление не отправляется).
    """
    # Путь 1: явное поле unique_gift (основной путь в Bot API 8.3+)
    if getattr(message, "unique_gift", None) is not None:
        return True

    # Путь 2: UniqueGift внутри message.gift
    gift_wrapper = getattr(message, "gift", None)
    if gift_wrapper is not None:
        # UniqueGift прямо на обёртке (base_name / number — маркеры уникального)
        if hasattr(gift_wrapper, "number") or hasattr(gift_wrapper, "base_name"):
            return True
        # UniqueGift вложен внутрь gift_wrapper.gift
        inner = getattr(gift_wrapper, "gift", None)
        if inner is not None and (
            hasattr(inner, "number") or hasattr(inner, "base_name")
        ):
            return True

    return False


def _get_regular_gift_type_id(message: Message) -> str | None:
    """
    Возвращает Gift.id обычного (regular) Telegram-подарка из бизнес-сообщения.

    Gift.id — официальный идентификатор типа подарка в Bot API; это не
    file_unique_id (идентификатор файла), непригодный для маппинга.

    Возвращает None если:
      — в сообщении нет подарка вообще,
      — подарок является уникальным (NFT) — определяется через _is_unique_gift_message,
        но здесь тоже добавлена двойная защита.
    """
    # Уникальные подарки здесь не обрабатываем
    if _is_unique_gift_message(message):
        return None

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
        # Ещё один шанс поймать уникальный подарок по внутреннему объекту
        if hasattr(inner, "number") or hasattr(inner, "base_name"):
            return None
        gid = getattr(inner, "id", None)
        if gid:
            return str(gid)

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Регистрация хэндлеров
# ─────────────────────────────────────────────────────────────────────────────

def register(dp: Dispatcher, bot: Bot) -> None:
    """Регистрирует хэндлеры бизнес-сообщений. Вызывается один раз из bot.py."""

    @dp.business_connection()
    async def handle_business_connection(bc: BusinessConnection) -> None:
        """
        Срабатывает когда бизнес-аккаунт подключает (или отключает) бота.

        ЗАЩИТА: Принимаются подключения ТОЛЬКО от @spacedonutgifts.
        Любой другой аккаунт получает предупреждение в лог и немедленный возврат
        без сохранения conn_id в БД — таким образом его сообщения никогда
        не пройдут проверку в handle_business_message.
        """
        conn_id = str(bc.id or "")
        if not conn_id:
            return

        # ── Проверка владельца бизнес-подключения ─────────────────────────────
        owner = getattr(bc, "user", None)
        owner_username = (getattr(owner, "username", None) or "").lower().lstrip("@")

        if owner_username != ALLOWED_BUSINESS_USERNAME:
            logger.warning(
                "[business_gifts] ⛔ Отклонено business_connection от "
                "неавторизованного аккаунта @%s (conn_id=%s). "
                "Разрешён только @%s.",
                owner_username or "unknown", conn_id, ALLOWED_BUSINESS_USERNAME,
            )
            # Не сохраняем — соединение не получит обработку сообщений
            return

        # ── Авторизованный аккаунт @spacedonutgifts ───────────────────────────
        if bc.is_enabled:
            await save_business_connection(conn_id)
            logger.info(
                "[business_gifts] ✅ business_connection сохранён: %s "
                "(@%s, is_enabled=%s)",
                conn_id, owner_username, bc.is_enabled,
            )
            asyncio.create_task(sync_historical_gifts(bot))
        else:
            await deactivate_business_connection(conn_id)
            logger.info(
                "[business_gifts] business_connection отключён и деактивирован: "
                "%s (@%s)",
                conn_id, owner_username,
            )

    @dp.business_message()
    async def handle_business_message(message: Message) -> None:
        """
        Обрабатывает входящие business_message.

        Порядок проверок:
          1. Авторизация соединения — если conn_id не в сохранённых
             активных соединениях, сообщение отбрасывается без обработки.
          2. Уникальный (NFT / TG gift) подарок — молча игнорируется
             (без записей в инвентарь, без уведомлений).
          3. Обычный BASE_GIFT → начисляется в user_gifts + уведомление.
          4. Всё остальное — молчаливый пропуск.
        """
        if message.from_user is None:
            return

        sender_id:        int = message.from_user.id
        business_conn_id: str = str(message.business_connection_id or "")

        # ── Шаг 1: проверка авторизации соединения ────────────────────────────
        # Если conn_id не сохранён у нас — значит аккаунт не прошёл проверку
        # в handle_business_connection (не @spacedonutgifts) и мы его игнорируем.
        if business_conn_id:
            active_connections = await get_business_connections()
            if business_conn_id not in active_connections:
                logger.warning(
                    "[business_gifts] ⛔ Сообщение из неавторизованного соединения "
                    "%s (user_id=%s) — пропуск.",
                    business_conn_id, sender_id,
                )
                return

        # ── Шаг 2: уникальный (NFT / TG gift) подарок — игнорируем полностью ──
        if _is_unique_gift_message(message):
            logger.debug(
                "[business_gifts] Уникальный (TG/NFT) подарок от user_id=%s — "
                "пропуск (не обрабатываются).",
                sender_id,
            )
            return

        # ── Шаг 3: обычный BASE_GIFT ───────────────────────────────────────────
        tg_gift_type_id = _get_regular_gift_type_id(message)
        if tg_gift_type_id is not None:
            # Регистрируем пользователя только при реальном зачислении подарка
            try:
                await database.upsert_user(
                    tg_id=sender_id,
                    username=message.from_user.username or "",
                    first_name=message.from_user.first_name or "Игрок",
                    photo_url="",
                )
            except Exception as exc:
                logger.error("[business_gifts] upsert_user error: %s", exc)

            await _handle_regular_gift(bot, sender_id, tg_gift_type_id, business_conn_id)
            return

        logger.debug(
            "[business_gifts] business_message от user_id=%s без BASE_GIFT — пропуск.",
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
            "(business_conn=%s).",
            tg_gift_type_id, business_conn_id,
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
        logger.warning(
            "[business_gifts] add_history_entry error user=%s: %s", sender_id, exc
        )

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
        logger.warning(
            "[business_gifts] Уведомление не доставлено user=%s: %s", sender_id, exc
        )


# ─────────────────────────────────────────────────────────────────────────────
# Историческая синхронизация (подарки, пришедшие до активации хэндлера)
# ─────────────────────────────────────────────────────────────────────────────

async def sync_historical_gifts(bot: Bot) -> dict:
    """
    Запрашивает все подарки из истории @SpaceDonutGifts через
    getBusinessAccountGifts и начисляет ТОЛЬКО обычные BASE_GIFT подарки.

    Уникальные (NFT / TG gift, тип "unique") подарки полностью пропускаются —
    они не записываются в инвентарь и не попадают в историю.

    Идемпотентна: повторный запуск не создаёт дублей.
    Дедупликация обычных подарков — через tg_regular_gift_sync_log по owned_gift_id.

    Возвращает словарь со статистикой: regular_added, skipped.
    """
    connections = await get_business_connections()
    if not connections:
        logger.info(
            "[sync] Нет сохранённых business_connection_id — синхронизация пропущена."
        )
        return {"regular_added": 0, "skipped": 0}

    total_regular = 0
    total_skip    = 0

    for conn_id in connections:
        offset: str | None = None
        page = 0

        while True:
            # ── Запрос страницы подарков ──────────────────────────────────────
            try:
                kwargs: dict[str, Any] = {
                    "business_connection_id": conn_id,
                    "limit": 100,
                }
                if offset:
                    kwargs["offset"] = offset
                gifts_page = await bot.get_business_account_gifts(**kwargs)
            except AttributeError:
                logger.warning(
                    "[sync] bot.get_business_account_gifts недоступен в этой версии "
                    "aiogram. Обновите aiogram до 3.15+ для поддержки Bot API 9.0."
                )
                break
            except Exception as exc:
                error_text = str(exc)
                logger.error(
                    "[sync] getBusinessAccountGifts conn=%s: %s", conn_id, exc
                )
                if "BUSINESS_CONNECTION_INVALID" in error_text:
                    logger.info(
                        "[sync] Соединение conn=%s недействительно — деактивируем.",
                        conn_id,
                    )
                    await deactivate_business_connection(conn_id)
                break

            gifts       = list(getattr(gifts_page, "gifts", []) or [])
            next_offset = getattr(gifts_page, "next_offset", None)

            logger.info(
                "[sync] conn=%s page=%d gifts=%d", conn_id, page, len(gifts)
            )

            for owned_gift in gifts:
                gift_type = str(getattr(owned_gift, "type", "") or "")

                # ── Уникальные (NFT / TG gift) — полностью пропускаем ─────────
                if gift_type == "unique":
                    total_skip += 1
                    continue

                # ── Только обычные (regular) подарки ──────────────────────────
                if gift_type != "regular":
                    total_skip += 1
                    continue

                # Пропускаем анонимные — не знаем, кому начислить
                sender = getattr(owned_gift, "sender_user", None)
                if sender is None:
                    total_skip += 1
                    continue
                sender_id_val: int | None = getattr(sender, "id", None)
                if not sender_id_val:
                    total_skip += 1
                    continue

                owned_id   = str(getattr(owned_gift, "owned_gift_id", "") or "")
                inner_gift = getattr(owned_gift, "gift", None)

                if inner_gift is None:
                    total_skip += 1
                    continue

                gift_id_str = str(getattr(inner_gift, "id", "") or "")
                if not gift_id_str:
                    total_skip += 1
                    continue

                base_gift_id = config.TG_STICKER_TO_BASE_GIFT_ID.get(gift_id_str)
                if base_gift_id is None:
                    total_skip += 1
                    continue

                # ── Дедупликация по owned_gift_id (Bot API >= 9.0) ────────────
                if owned_id and await is_regular_gift_synced(owned_id):
                    total_skip += 1
                    continue

                # ── Upsert пользователя ────────────────────────────────────────
                try:
                    await database.upsert_user(
                        tg_id=sender_id_val,
                        username=str(getattr(sender, "username", "") or ""),
                        first_name=str(getattr(sender, "first_name", "") or "Игрок"),
                        photo_url="",
                    )
                except Exception as exc:
                    logger.warning(
                        "[sync] upsert_user user=%s: %s", sender_id_val, exc
                    )

                # ── Начисление подарка ─────────────────────────────────────────
                try:
                    await database.add_gift_to_user(sender_id_val, base_gift_id, 1)
                    if owned_id:
                        await mark_regular_gift_synced(owned_id, sender_id_val)
                    total_regular += 1
                    logger.info(
                        "[sync] ✅ Regular gift_id=%r → user_id=%s BASE_GIFT#%s",
                        gift_id_str, sender_id_val, base_gift_id,
                    )
                    gift_name = config.BASE_GIFTS.get(base_gift_id, {}).get(
                        "name", f"Подарок #{base_gift_id}"
                    )
                    await database.add_history_entry(
                        sender_id_val,
                        "tg_gift_received",
                        f"Получен TG-подарок: {gift_name} [gift_id:{base_gift_id}]",
                        0,
                    )
                except Exception as exc:
                    logger.error(
                        "[sync] add_gift_to_user user=%s gift=%s: %s",
                        sender_id_val, base_gift_id, exc,
                    )
                    total_skip += 1

            if not next_offset or not gifts:
                break
            offset = next_offset
            page  += 1

    logger.info(
        "[sync] Завершено: обычных=%d пропущено=%d",
        total_regular, total_skip,
    )
    return {"regular_added": total_regular, "skipped": total_skip}
