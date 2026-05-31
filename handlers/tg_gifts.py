from __future__ import annotations

from typing import Any

import httpx

import config


def get_gift_def(gift_id: int) -> dict[str, Any] | None:
    if gift_id in getattr(config, "TG_GIFTS", {}):
        return config.TG_GIFTS[gift_id]
    if gift_id in getattr(config, "MAIN_GIFTS", {}):
        return config.MAIN_GIFTS[gift_id]
    if gift_id in getattr(config, "BASE_GIFTS", {}):
        return config.BASE_GIFTS[gift_id]
    return None


def get_gift_value(gift_id: int) -> int:
    gift_def = get_gift_def(gift_id)
    if not gift_def:
        return 0
    return int(gift_def.get("required_value", gift_def.get("value", 0)) or 0)


def is_real_tg_gift(gift_id: int) -> bool:
    gift_def = get_gift_def(gift_id)
    return bool(gift_def and gift_def.get("tg_gift_id"))


def get_tg_exchange_value(gift_id: int) -> int:
    return get_gift_value(gift_id) + 10 if is_real_tg_gift(gift_id) else 0


async def _telegram_api_post(method: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    """POST helper for Telegram Bot API methods used in gift withdrawals."""
    url = f"https://api.telegram.org/bot{config.BOT_TOKEN}/{method}"
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, json=payload)
            return resp.json()
    except Exception:
        return None


def _telegram_error_code(data: dict[str, Any] | None) -> str:
    if not isinstance(data, dict):
        return "unknown"

    desc = str(data.get("description") or "").lower()
    code = str(data.get("error_code") or "")

    if any(kw in desc for kw in (
        "not enough stars", "enough star", "insufficient", "balance",
        "not enough", "stargift_usersell_balance_too_low", "stargift",
    )):
        return "not_enough_stars"
    if any(kw in desc for kw in (
        "gift not available", "gift unavailable", "not available", "not found",
        "gift is not available", "gift_id invalid", "gift id invalid",
    )):
        return "gift_not_available"
    if any(kw in desc for kw in (
        "business connection invalid", "business_connection_invalid",
        "business connection not found", "business connection expired",
    )):
        return "business_connection_invalid"
    if code == "400" and "gift" in desc:
        return "gift_not_available"
    return "unknown"


async def _business_account_star_balance(business_connection_id: str) -> int | None:
    data = await _telegram_api_post("getBusinessAccountStarBalance", {
        "business_connection_id": business_connection_id,
    })
    if not isinstance(data, dict) or not data.get("ok"):
        return None

    result = data.get("result") or {}
    if isinstance(result, dict):
        if isinstance(result.get("amount"), int):
            return int(result["amount"])
        if isinstance(result.get("star_amount"), dict) and isinstance(result["star_amount"].get("amount"), int):
            return int(result["star_amount"]["amount"])
    return None


async def _business_account_has_gift(business_connection_id: str, tg_gift_type_id: str) -> bool | None:
    """Checks that the managed business account owns the exact gift type."""
    offset: str | None = None

    while True:
        payload: dict[str, Any] = {
            "business_connection_id": business_connection_id,
            "limit": 100,
        }
        if offset:
            payload["offset"] = offset

        data = await _telegram_api_post("getBusinessAccountGifts", payload)
        if not isinstance(data, dict) or not data.get("ok"):
            return None

        result = data.get("result") or {}
        gifts_page = list(result.get("gifts", []) or []) if isinstance(result, dict) else []
        next_offset = str(result.get("next_offset") or "") if isinstance(result, dict) else ""

        for owned_gift in gifts_page:
            if not isinstance(owned_gift, dict):
                continue
            if owned_gift.get("was_refunded"):
                continue
            gift = owned_gift.get("gift") or {}
            if not isinstance(gift, dict):
                continue
            if str(gift.get("id") or "") == str(tg_gift_type_id):
                return True

        if not next_offset:
            return False
        offset = next_offset


async def send_real_tg_gift(user_id: int, tg_gift_id: str, text: str | None = None, pay_for_upgrade: bool = False) -> bool:
    url = f"https://api.telegram.org/bot{config.BOT_TOKEN}/sendGift"
    payload: dict[str, Any] = {
        "user_id": user_id,
        "gift_id": str(tg_gift_id),
        "pay_for_upgrade": pay_for_upgrade,
    }
    if text:
        payload["text"] = text[:128]

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(url, json=payload)
            data = resp.json()
            return bool(data.get("ok"))
    except Exception:
        return False


async def send_base_gift_from_business(
    user_id: int,
    base_gift_id: int,
    text: str | None = None,
) -> tuple[bool, str]:
    """
    Отправляет BASE_GIFT пользователю с бизнес-аккаунта @spacedonutgifts.

    Перед отправкой проверяем два условия:
      1. у бизнес-аккаунта есть нужный gift type в getBusinessAccountGifts;
      2. на его балансе хватает Telegram Stars.

    Возвращает (success: bool, error_code: str):
      (True,  "")                       — успех
      (False, "no_tg_mapping")          — нет маппинга BASE_GIFT_ID → Telegram Gift.id
      (False, "no_business_connection") — нет активного business_connection_id в БД
      (False, "gift_not_available")     — нужный gift type отсутствует у @spacedonutgifts
      (False, "not_enough_stars")       — на аккаунте @spacedonutgifts недостаточно звёзд
      (False, "business_connection_invalid") — connection уже невалиден
      (False, "unknown")                — прочие ошибки Telegram API или сети
    """
    from db.db_tg_nft import get_business_connections

    gift_def = config.BASE_GIFTS.get(base_gift_id, {})
    gift_price = int(gift_def.get("value", gift_def.get("required_value", 0)) or 0)

    # ── Шаг 1: Telegram Gift.id для этого BASE_GIFT ───────────────────────────
    tg_gift_type_id: str | None = getattr(config, "BASE_GIFT_ID_TO_TG_ID", {}).get(base_gift_id)
    if not tg_gift_type_id:
        return False, "no_tg_mapping"

    # ── Шаг 2: активный business_connection_id ────────────────────────────────
    connections = await get_business_connections()
    if not connections:
        return False, "no_business_connection"
    business_connection_id = connections[0]

    # ── Шаг 3: проверяем, что на бизнес-аккаунте есть нужный gift type ───────
    has_gift = await _business_account_has_gift(business_connection_id, tg_gift_type_id)
    if has_gift is False:
        return False, "gift_not_available"
    if has_gift is None:
        # Если Telegram временно не отвечает, не рискуем списывать звёзды у пользователя.
        return False, "unknown"

    # ── Шаг 4: проверяем баланс звёзд бизнес-аккаунта ────────────────────────
    if gift_price > 0:
        star_balance = await _business_account_star_balance(business_connection_id)
        if star_balance is not None and star_balance < gift_price:
            return False, "not_enough_stars"

    # ── Шаг 5: вызов sendGift от имени @spacedonutgifts ───────────────────────
    payload: dict[str, Any] = {
        "user_id": user_id,
        "gift_id": tg_gift_type_id,
        "business_connection_id": business_connection_id,
    }
    if text:
        payload["text"] = text[:128]

    data = await _telegram_api_post("sendGift", payload)
    if not isinstance(data, dict):
        return False, "unknown"

    if data.get("ok"):
        return True, ""

    error_code = _telegram_error_code(data)
    if error_code == "business_connection_invalid":
        return False, error_code
    if error_code == "not_enough_stars":
        return False, error_code
    if error_code == "gift_not_available":
        return False, error_code
    return False, "unknown"