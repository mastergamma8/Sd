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
