from fastapi import APIRouter, Depends, HTTPException
import httpx
import time

import cloudscraper
import config
import database
from handlers.models import ActionData
from handlers.security import get_current_user
from handlers.tg_gifts import get_gift_def, is_real_tg_gift, send_real_tg_gift, get_tg_exchange_value

router = APIRouter(prefix="/api", tags=["gifts"])

GIFT_COOLDOWN_SECONDS = 5 * 3600  # 5 часов


@router.post("/claim")
async def claim_gift(data: ActionData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    if data.gift_id not in config.MAIN_GIFTS:
        raise HTTPException(status_code=400, detail="Неверный ID подарка")

    now = int(time.time())

    last_claim = await database.get_last_gift_claim(tg_id)
    elapsed    = now - last_claim
    if elapsed < GIFT_COOLDOWN_SECONDS:
        seconds_left = GIFT_COOLDOWN_SECONDS - elapsed
        raise HTTPException(
            status_code=429,
            detail={
                "error":   "cooldown",
                "type":    "claim",
                "hours":   seconds_left // 3600,
                "minutes": (seconds_left % 3600) // 60,
            },
        )

    cost    = config.MAIN_GIFTS[data.gift_id]["required_value"]
    success = await database.claim_main_gift(tg_id, data.gift_id, cost)

    if not success:
        raise HTTPException(status_code=400, detail="Недостаточно поинтов")

    await database.update_last_gift_claim(tg_id, now)

    gift_name = config.MAIN_GIFTS[data.gift_id]["name"]
    await database.log_action(tg_id, "claim_gift", f"Покупка подарка: {gift_name} [gift_id:{data.gift_id}]", -cost)

    # Пончики списаны у пользователя — зачисляем в банк как доход.
    await database.bank_add_donuts(int(cost))

    gift_value = config.MAIN_GIFTS[data.gift_id].get("value", cost)
    await database.distribute_referral_bonus(tg_id, gift_value)

    user_data    = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)

    return {
        "status":     "ok",
        "balance":    user_data.get("balance", 0),
        "user_gifts": updated_gifts,
    }


async def _check_withdraw_requirements(tg_id: int) -> list[dict]:
    """
    Проверяет все требования вывода из WITHDRAW_REQUIREMENTS для данного пользователя.
    Возвращает список объектов с полями: type, title, url, done, [current, required].
    """
    reqs = getattr(config, "WITHDRAW_REQUIREMENTS", {})
    if not reqs.get("enabled", False):
        return []

    results = []

    async with httpx.AsyncClient(timeout=6) as client:
        # ── Подписки ──────────────────────────────────────────────────────────
        for sub in reqs.get("subscriptions", []):
            done = False
            try:
                resp = await client.get(
                    f"https://api.telegram.org/bot{config.BOT_TOKEN}/getChatMember",
                    params={"chat_id": sub["chat_id"], "user_id": tg_id}
                )
                res = resp.json()
                if res.get("ok") and res["result"]["status"] in ("member", "administrator", "creator"):
                    done = True
            except Exception:
                pass
            results.append({
                "type": "subscription",
                "chat_id": sub["chat_id"],
                "title": sub["title"],
                "url": sub.get("url", ""),
                "done": done,
            })

        # ── Бусты ─────────────────────────────────────────────────────────────
        for boost in reqs.get("boosts", []):
            done = False
            try:
                resp = await client.get(
                    f"https://api.telegram.org/bot{config.BOT_TOKEN}/getUserChatBoosts",
                    params={"chat_id": boost["chat_id"], "user_id": tg_id}
                )
                res = resp.json()
                if res.get("ok") and len(res["result"].get("boosts", [])) > 0:
                    done = True
            except Exception:
                pass
            results.append({
                "type": "boost",
                "chat_id": boost["chat_id"],
                "title": boost["title"],
                "url": boost.get("url", ""),
                "done": done,
            })

    # ── Рефералы ──────────────────────────────────────────────────────────────
    required_refs = reqs.get("referrals", 0)
    if required_refs > 0:
        referrals = await database.get_referrals(tg_id)
        current = len(referrals)
        results.append({
            "type": "referrals",
            "title": f"Пригласить {required_refs} {'друзей' if required_refs >= 5 else 'друга'}",
            "url": "",
            "done": current >= required_refs,
            "current": current,
            "required": required_refs,
        })

    return results


@router.get("/withdraw/requirements")
async def get_withdraw_requirements(current_user: dict = Depends(get_current_user)):
    """Возвращает список требований вывода и статус их выполнения для текущего пользователя."""
    tg_id = current_user["id"]
    reqs = getattr(config, "WITHDRAW_REQUIREMENTS", {})

    if not reqs.get("enabled", False):
        return {"all_done": True, "requirements": []}

    items = await _check_withdraw_requirements(tg_id)
    all_done = all(r["done"] for r in items)
    return {"all_done": all_done, "requirements": items}


@router.post("/withdraw")
async def withdraw_gift(data: ActionData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]
    now   = int(time.time())

    gift_def = get_gift_def(data.gift_id)
    if not gift_def:
        raise HTTPException(status_code=400, detail="Неверный ID подарка")

    user_gifts = await database.get_user_gifts(tg_id)
    if user_gifts.get(data.gift_id, 0) <= 0:
        raise HTTPException(status_code=400, detail="У вас нет этого подарка")

    # ── Проверка требований вывода ────────────────────────────────────────────
    reqs = getattr(config, "WITHDRAW_REQUIREMENTS", {})
    if reqs.get("enabled", False):
        items = await _check_withdraw_requirements(tg_id)
        unmet = [r["title"] for r in items if not r["done"]]
        if unmet:
            raise HTTPException(
                status_code=403,
                detail={"error": "requirements_not_met", "unmet": unmet}
            )

    gift_name = gift_def.get("name", "Неизвестный подарок")

    # Реальные Telegram-подарки выводятся без комиссии и без кулдауна
    if is_real_tg_gift(data.gift_id):
        removed = await database.remove_gift_from_user(tg_id, data.gift_id)
        if not removed:
            raise HTTPException(status_code=400, detail="Подарок не найден")

        sent = await send_real_tg_gift(
            tg_id,
            gift_def["tg_gift_id"],
            text=f"gift from Space Donut 🍩"
        )
        if not sent:
            await database.add_gift_to_user(tg_id, data.gift_id, 1)
            raise HTTPException(status_code=502, detail="Не удалось отправить Telegram-подарок")

        await database.add_history_entry(
            tg_id,
            "withdraw_tg_gift",
            f"Вывод Telegram подарка: {gift_name} [gift_id:{data.gift_id}]",
            0
        )

        updated_gifts = await database.get_user_gifts(tg_id)
        updated_user  = await database.get_user_data(tg_id)
        return {
            "status": "ok",
            "user_gifts": updated_gifts,
            "balance": updated_user.get("balance", 0),
            "stars": updated_user.get("stars", 0),
        }

    # Старый вывод для обычных подарков — с комиссией и кулдауном
    last_withdraw = await database.get_last_gift_withdraw(tg_id)
    elapsed       = now - last_withdraw
    if elapsed < GIFT_COOLDOWN_SECONDS:
        seconds_left = GIFT_COOLDOWN_SECONDS - elapsed
        raise HTTPException(
            status_code=429,
            detail={
                "error":   "cooldown",
                "type":    "withdraw",
                "hours":   seconds_left // 3600,
                "minutes": (seconds_left % 3600) // 60,
            },
        )

    # Атомарное списание комиссии
    success_deduct = await database.deduct_stars(tg_id, config.WITHDRAW_FEE_STARS)
    if not success_deduct:
        raise HTTPException(status_code=400, detail="not_enough_stars")

    # Атомарное списание подарка — проверяем результат
    removed = await database.remove_gift_from_user(tg_id, data.gift_id)
    if not removed:
        await database.add_stars_to_user(tg_id, config.WITHDRAW_FEE_STARS)
        raise HTTPException(status_code=400, detail="Подарок не найден")

    await database.update_last_gift_withdraw(tg_id, now)

    # Комиссия за вывод — звёзды списаны у пользователя, зачисляем в банк.
    await database.bank_add_stars(config.WITHDRAW_FEE_STARS)

    await database.log_action(tg_id, "withdraw_gift", f"Вывод подарка: {gift_name} [gift_id:{data.gift_id}]", 0)

    # Уведомление админа
    try:
        user_profile = await database.get_user_profile(tg_id)
        username_str = f"@{user_profile['username']}" if user_profile.get("username") else "Отсутствует/Скрыт"
        first_name   = user_profile.get("first_name", "Без имени")
        admin_text = (
            f"🚨 <b>Новая заявка на вывод подарка!</b>\n\n"
            f"👤 Пользователь: <a href='tg://user?id={tg_id}'>{first_name}</a>\n"
            f"🔗 Юзернейм: {username_str}\n"
            f"🆔 ID: <code>{tg_id}</code>\n\n"
            f"🎁 <b>Подарок:</b> {gift_name} (ID: {data.gift_id})"
        )
        url     = f"https://api.telegram.org/bot{config.BOT_TOKEN}/sendMessage"
        payload = {"chat_id": config.ADMIN_ID, "text": admin_text, "parse_mode": "HTML"}
        async with httpx.AsyncClient() as client:
            await client.post(url, json=payload)
    except Exception as e:
        print(f"Ошибка при отправке уведомления админу: {e}")

    updated_gifts = await database.get_user_gifts(tg_id)

    return {"status": "ok", "user_gifts": updated_gifts}


@router.post("/exchange")
async def exchange_gift(data: ActionData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    gift_def = get_gift_def(data.gift_id)
    if not gift_def or not is_real_tg_gift(data.gift_id):
        raise HTTPException(status_code=400, detail="Можно обменивать только реальные Telegram-подарки")

    user_gifts = await database.get_user_gifts(tg_id)
    if user_gifts.get(data.gift_id, 0) <= 0:
        raise HTTPException(status_code=400, detail="У вас нет этого подарка")

    reward_stars = get_tg_exchange_value(data.gift_id)
    if reward_stars <= 0:
        raise HTTPException(status_code=400, detail="Неверная цена обмена")

    removed = await database.remove_gift_from_user(tg_id, data.gift_id)
    if not removed:
        raise HTTPException(status_code=400, detail="Подарок не найден")

    # Списываем выплату из банка перед зачислением пользователю.
    # Если ликвидности не хватает — возвращаем подарок и отклоняем обмен.
    bank_ok = await database.bank_payout(reward_stars, asset_type="stars")
    if not bank_ok:
        await database.add_gift_to_user(tg_id, data.gift_id, 1)
        raise HTTPException(status_code=503, detail="Недостаточно ликвидности в банке. Попробуйте позже.")

    await database.add_stars_to_user(tg_id, reward_stars)
    await database.log_action(
        tg_id,
        "exchange_tg_gift",
        f"Обмен Telegram подарка: {gift_def['name']} [gift_id:{data.gift_id}] -> +{reward_stars} ⭐",
        reward_stars,
    )

    updated_user  = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)
    return {
        "status": "ok",
        "balance": updated_user.get("balance", 0),
        "stars": updated_user.get("stars", 0),
        "user_gifts": updated_gifts,
        "exchange_stars": reward_stars,
    }

async def _fetch_portal_floor_price_async(gift_name: str) -> float | None:
    """
    Асинхронно запрашивает floor_price подарка у Portal Market API.
    Возвращает полную цену в TON без каких-либо скидок и округлений.
    """
    import asyncio
    loop = asyncio.get_event_loop()
    # cloudscraper синхронный — выносим в executor
    return await loop.run_in_executor(None, _fetch_portal_floor_price, gift_name)


def _fetch_portal_floor_price(gift_name: str) -> float | None:
    """Синхронно запрашивает floor_price подарка у Portal Market API."""
    try:
        scraper = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "windows", "mobile": False}
        )
        resp = scraper.get(
            "https://portal-market.com/api/collections",
            params={"search": gift_name, "limit": 1},
            timeout=8,
        )
        if resp.status_code == 200:
            collections = resp.json().get("collections", [])
            if collections:
                fp = float(collections[0].get("floor_price", 0))
                return fp if fp > 0 else None
    except Exception as e:
        print(f"[exchange-for-donuts] Portal API error for '{gift_name}': {e}")
    return None


@router.post("/exchange-for-donuts")
async def exchange_for_donuts(data: ActionData, current_user: dict = Depends(get_current_user)):
    """Устаревший эндпоинт. Перенаправляет на /api/exchange-for-stars."""
    raise HTTPException(
        status_code=410,
        detail="Этот эндпоинт устарел. Используйте /api/exchange-for-stars",
    )


# ── Кэш курса TON → Stars (обновляется не чаще раз в 5 минут) ────────────────
_ton_stars_cache: dict = {"rate": None, "ts": 0}
_TON_STARS_CACHE_TTL = 300  # секунд

# 1 Telegram Star ≈ $0.013 (официальный курс Telegram)
_STAR_USD_PRICE = 0.013


async def _fetch_ton_to_stars_rate() -> float:
    """
    Возвращает количество Stars за 1 TON.
    Алгоритм: TON/USDT (Binance public API) / STAR_USD_PRICE.
    Результат кэшируется на 5 минут. При ошибке возвращает фоллбэк.
    """
    now = time.time()
    if _ton_stars_cache["rate"] and now - _ton_stars_cache["ts"] < _TON_STARS_CACHE_TTL:
        return _ton_stars_cache["rate"]

    fallback = getattr(config, "TON_TO_STARS_FALLBACK", 200.0)
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.get(
                "https://api.binance.com/api/v3/ticker/price",
                params={"symbol": "TONUSDT"},
            )
            if resp.status_code == 200:
                ton_usd = float(resp.json()["price"])
                rate = ton_usd / _STAR_USD_PRICE
                _ton_stars_cache["rate"] = rate
                _ton_stars_cache["ts"] = now
                return rate
    except Exception as e:
        print(f"[TON rate] Binance error: {e}")

    return fallback


async def _apply_exchange_bonus(base_stars: int) -> int:
    """Применяет бонус-процент к базовому количеству звёзд."""
    from db.db_settings import get_exchange_bonus_percent
    bonus = await get_exchange_bonus_percent()
    return max(1, int(base_stars * (1 + bonus / 100)))


async def _main_gift_stars(gift_def: dict) -> int:
    """
    MAIN_GIFT → Stars: использует ту же логику, что и BASE_GIFTS.

    Алгоритм:
      1. Запрашивает floor_price с Portal Market API по названию подарка.
      2. Конвертирует TON → Stars по живому курсу CoinGecko.
      3. Применяет бонус-процент.

    Фоллбэк (если Portal API недоступен):
      required_value × GIFT_EXCHANGE_STARS_RATE × (1 + bonus%).
    """
    gift_name = gift_def.get("name", "")
    ton_price = await _fetch_portal_floor_price_async(gift_name) if gift_name else None

    if ton_price and ton_price > 0:
        ton_to_stars = await _fetch_ton_to_stars_rate()
        base_stars = max(1, int(ton_price * ton_to_stars))
    else:
        # Фоллбэк: старая формула на случай недоступности Portal API
        base = int(gift_def.get("required_value") or gift_def.get("value") or 0)
        rate = float(getattr(config, "GIFT_EXCHANGE_STARS_RATE", 1.0))
        base_stars = max(1, int(base * rate))

    return await _apply_exchange_bonus(base_stars)


@router.get("/exchange-rate")
async def get_exchange_rate(current_user: dict = Depends(get_current_user)):
    """Возвращает актуальный курс TON → Stars для отображения в интерфейсе."""
    rate = await _fetch_ton_to_stars_rate()
    return {
        "ton_to_stars": round(rate, 2),
        "star_usd_price": _STAR_USD_PRICE,
    }


@router.get("/exchange-preview")
async def exchange_preview(gift_id: int, current_user: dict = Depends(get_current_user)):
    """
    Возвращает точное количество звёзд, которое получит пользователь при обмене
    подарка — без списания, только расчёт.

    BASE_GIFTS и MAIN_GIFTS используют единую логику:
      Portal Market floor_price → живой курс TON→Stars → бонус-процент.

    Фоллбэк при недоступности Portal API:
      BASE_GIFTS  → stored value / 0.80
      MAIN_GIFTS  → required_value / 1.20
    """
    gift_def = config.BASE_GIFTS.get(gift_id)
    gift_type = "base"
    if not gift_def:
        gift_def = config.MAIN_GIFTS.get(gift_id)
        gift_type = "main"
    if not gift_def:
        raise HTTPException(status_code=400, detail="Gift not found")

    from handlers.tg_gifts import is_real_tg_gift as _is_real_tg
    if _is_real_tg(gift_id):
        raise HTTPException(status_code=400, detail="TG gifts use /api/exchange")

    from db.db_settings import get_exchange_bonus_percent
    bonus = await get_exchange_bonus_percent()

    # ── Единая логика: Portal Market API + TON→Stars + бонус ─────────────────
    gift_name = gift_def.get("name", "")
    ton_price = await _fetch_portal_floor_price_async(gift_name) if gift_name else None

    if ton_price is None or ton_price <= 0:
        stored = gift_def.get("value") or gift_def.get("required_value") or 0
        if gift_type == "main":
            ton_price = stored / 1.2 if stored > 0 else 0
        else:
            ton_price = stored / 0.8 if stored > 0 else 0

    if ton_price <= 0:
        raise HTTPException(status_code=503, detail="Не удалось получить цену подарка")

    ton_to_stars = await _fetch_ton_to_stars_rate()
    base_stars   = max(1, int(ton_price * ton_to_stars))
    stars_reward = await _apply_exchange_bonus(base_stars)

    return {
        "gift_id":       gift_id,
        "ton_price":     round(ton_price, 6),
        "ton_to_stars":  round(ton_to_stars, 2),
        "stars_reward":  stars_reward,
        "bonus_percent": bonus,
    }

@router.post("/exchange-for-stars")
async def exchange_for_stars(data: ActionData, current_user: dict = Depends(get_current_user)):
    """
    Обменять BASE_GIFT или MAIN_GIFT подарок на звёзды.

    BASE_GIFTS и MAIN_GIFTS используют единую логику:
      Portal Market floor_price → живой курс TON→Stars → бонус-процент.

    Фоллбэк при недоступности Portal API:
      BASE_GIFTS  → stored value / 0.80
      MAIN_GIFTS  → required_value / 1.20

    TG-подарки (gift_id 2000+) не принимаются — используйте /api/exchange.
    """
    tg_id = current_user["id"]

    # Определяем тип подарка: BASE или MAIN
    gift_def = config.BASE_GIFTS.get(data.gift_id)
    gift_type = "base"
    if not gift_def:
        gift_def = config.MAIN_GIFTS.get(data.gift_id)
        gift_type = "main"

    if not gift_def:
        raise HTTPException(status_code=400, detail="Только базовые и основные подарки можно обменять на звёзды")

    # TG-подарки через этот эндпоинт не обслуживаем
    from handlers.tg_gifts import is_real_tg_gift as _is_real_tg
    if _is_real_tg(data.gift_id):
        raise HTTPException(status_code=400, detail="Используйте /api/exchange для Telegram-подарков")

    # Проверяем наличие подарка в инвентаре
    user_gifts = await database.get_user_gifts(tg_id)
    if user_gifts.get(data.gift_id, 0) <= 0:
        raise HTTPException(status_code=400, detail="У вас нет этого подарка")

    gift_name = gift_def["name"]

    from db.db_settings import get_exchange_bonus_percent
    bonus = await get_exchange_bonus_percent()

    # ── Единая логика: Portal Market API + TON→Stars + бонус ─────────────────
    ton_price = await _fetch_portal_floor_price_async(gift_name)
    if ton_price is None or ton_price <= 0:
        stored = gift_def.get("value") or gift_def.get("required_value") or 0
        if gift_type == "main":
            if stored <= 0:
                raise HTTPException(status_code=503, detail="Не удалось получить актуальную цену подарка")
            ton_price = stored / 1.2
        else:
            if stored <= 0:
                raise HTTPException(status_code=503, detail="Не удалось получить актуальную цену подарка")
            ton_price = stored / 0.8

    ton_to_stars = await _fetch_ton_to_stars_rate()
    base_stars   = max(1, int(ton_price * ton_to_stars))
    stars_reward = await _apply_exchange_bonus(base_stars)

    removed = await database.remove_gift_from_user(tg_id, data.gift_id)
    if not removed:
        raise HTTPException(status_code=400, detail="Подарок не найден")

    # Списываем выплату из банка перед зачислением пользователю.
    # Если ликвидности не хватает — возвращаем подарок и отклоняем обмен.
    bank_ok = await database.bank_payout(stars_reward, asset_type="stars")
    if not bank_ok:
        await database.add_gift_to_user(tg_id, data.gift_id, 1)
        raise HTTPException(status_code=503, detail="Недостаточно ликвидности в банке. Попробуйте позже.")

    await database.add_stars_to_user(tg_id, stars_reward)
    await database.log_action(
        tg_id,
        "exchange_gift_stars",
        f"Обмен подарка на звёзды: {gift_name} [gift_id:{data.gift_id}] "
        f"({ton_price:.4f} TON × {ton_to_stars:.1f} × +{bonus}% = {stars_reward} ⭐)",
        stars_reward,
    )

    updated_user  = await database.get_user_data(tg_id)
    updated_gifts = await database.get_user_gifts(tg_id)
    return {
        "status":       "ok",
        "stars_reward": stars_reward,
        "balance":      updated_user.get("balance", 0),
        "stars":        updated_user.get("stars", 0),
        "user_gifts":   updated_gifts,
        }
