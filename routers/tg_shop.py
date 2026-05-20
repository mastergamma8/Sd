"""
routers/tg_shop.py
Маршрут: POST /api/tg_shop/buy
Покупка TG-подарка (IDs 2011–2017) за фиксированную стоимость 55 ⭐.
"""

from fastapi import APIRouter, Depends, HTTPException

import config
import database
from handlers.models import ActionData
from handlers.security import get_current_user
from handlers.tg_gifts import send_real_tg_gift

router = APIRouter(prefix="/api/tg_shop", tags=["tg_shop"])

# Подарки, доступные в магазине (IDs 2011–2017)
# Цена каждого подарка задаётся в config.py через поле "price" в TG_GIFTS
TG_SHOP_GIFT_IDS = {2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019}


@router.post("/buy")
async def buy_tg_gift(data: ActionData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    # Валидация: подарок должен быть из магазина
    if data.gift_id not in TG_SHOP_GIFT_IDS:
        raise HTTPException(status_code=400, detail="Недопустимый ID подарка")

    # Проверяем наличие подарка в конфиге
    gift_def = config.TG_GIFTS.get(data.gift_id)
    if not gift_def:
        raise HTTPException(status_code=400, detail="Подарок не найден в конфиге")

    tg_gift_id = gift_def.get("tg_gift_id")
    if not tg_gift_id:
        raise HTTPException(status_code=400, detail="Неверный конфиг подарка")

    # Цена берётся из конфига — поле "price" в TG_GIFTS
    gift_price = gift_def.get("price")
    if not gift_price:
        raise HTTPException(status_code=400, detail="Цена подарка не задана в конфиге")

    # Списываем звёзды атомарно
    success = await database.deduct_stars(tg_id, gift_price)
    if not success:
        raise HTTPException(status_code=400, detail="not_enough_stars")

    # Отправляем Telegram-подарок
    sent = await send_real_tg_gift(
        tg_id,
        tg_gift_id,
        text="gift from Space Donut 🍩"
    )

    if not sent:
        # Возвращаем звёзды при неудаче
        await database.add_stars_to_user(tg_id, gift_price)
        raise HTTPException(status_code=502, detail="Не удалось отправить Telegram-подарок. Попробуйте позже.")

    # Логируем
    gift_name = gift_def.get("name", f"Gift #{data.gift_id}")
    await database.log_action(
        tg_id,
        "tg_shop_buy",
        f"Покупка лимит. подарка '{gift_name}' [gift_id:{data.gift_id}] за {gift_price} ⭐",
        -gift_price,
    )

    updated_user = await database.get_user_data(tg_id)

    return {
        "status": "ok",
        "stars":  updated_user.get("stars", 0),
        "balance": updated_user.get("balance", 0),
    }
