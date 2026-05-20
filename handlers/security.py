"""
handlers/security.py
Валидация Telegram WebApp InitData и извлечение текущего пользователя.

Все роутеры должны использовать get_current_user как Depends — никакого
tg_id из тела запроса или query-параметров.
"""

import json
import time
import hmac
import hashlib
from urllib.parse import parse_qsl

from fastapi import HTTPException, Header

import config


def parse_telegram_init_data(init_data: str) -> dict:
    """
    Разбирает и верифицирует строку Telegram WebApp InitData.
    Возвращает распарсенный словарь при успехе.
    Бросает HTTPException(403) при любой ошибке.
    """
    if not init_data:
        raise HTTPException(status_code=403, detail="Нет данных авторизации")

    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
        received_hash = parsed.pop("hash", None)
        if not received_hash:
            raise HTTPException(status_code=403, detail="Нет hash в данных авторизации")

        auth_date = int(parsed.get("auth_date", "0"))
        if time.time() - auth_date > 86400:
            raise HTTPException(status_code=403, detail="Данные авторизации устарели (>24 ч)")

        data_check_string = "\n".join(
            f"{k}={v}" for k, v in sorted(parsed.items())
        )
        secret_key = hmac.new(
            key=b"WebAppData",
            msg=config.BOT_TOKEN.encode(),
            digestmod=hashlib.sha256,
        ).digest()
        calculated_hash = hmac.new(
            key=secret_key,
            msg=data_check_string.encode(),
            digestmod=hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(calculated_hash, received_hash):
            raise HTTPException(status_code=403, detail="Недействительная подпись Telegram")

        return parsed

    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=403, detail="Недействительные данные Telegram")


async def get_current_user(x_tg_data: str = Header(None)) -> dict:
    """
    FastAPI Depends: извлекает и верифицирует пользователя из заголовка X-Tg-Data.
    Возвращает словарь {"id", "username", "first_name", "photo_url"}.

    Использование в роутере:
        @router.post("/spin")
        async def spin(data: SpinData, current_user: dict = Depends(get_current_user)):
            user_id = current_user["id"]
    """
    if not config.BOT_TOKEN:
        raise HTTPException(status_code=500, detail="Токен бота не настроен")

    parsed = parse_telegram_init_data(x_tg_data)

    try:
        user = json.loads(parsed["user"])
    except (KeyError, json.JSONDecodeError):
        raise HTTPException(status_code=403, detail="Нет данных о пользователе в InitData")

    return {
        "id":         int(user["id"]),
        "username":   user.get("username", ""),
        "first_name": user.get("first_name", ""),
        "photo_url":  user.get("photo_url", ""),
    }


# Обратная совместимость: старый verify_user больше не нужен,
# но оставлен как алиас чтобы не ломать возможные прямые импорты.
async def verify_user(x_tg_data: str = Header(None)) -> bool:
    await get_current_user(x_tg_data)
    return True


# ── Проверка подписки на канал ───────────────────────────────────────────────

import httpx as _httpx

async def check_channel_subscription(tg_id: int) -> bool:
    """Проверяет, подписан ли пользователь tg_id на config.REQUIRED_CHANNEL."""
    import config as _cfg
    try:
        async with _httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"https://api.telegram.org/bot{_cfg.BOT_TOKEN}/getChatMember",
                params={"chat_id": _cfg.REQUIRED_CHANNEL, "user_id": tg_id},
            )
            res = resp.json()
            if res.get("ok"):
                return res["result"]["status"] in ("member", "administrator", "creator")
    except Exception:
        pass
    return False
