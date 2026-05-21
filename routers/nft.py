"""
routers/nft.py
NFT Галерея — API эндпоинты.

GET  /api/nft/info                  — баланс NFT-звёзд + кол-во картин в коллекции
GET  /api/nft/shop                  — список активных картин в магазине
POST /api/nft/buy                   — купить картину
GET  /api/nft/gallery/me            — моя коллекция
GET  /api/nft/gallery/{user_id}     — коллекция другого пользователя
GET  /api/nft/galleries             — топ коллекционеров
POST /api/nft/topup                 — пополнить NFT-звёзды (через Telegram Stars)

Картины управляются через nft_catalog.py + publish_nft.py
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from db import db_nft
from db.db_history import add_history_entry
from handlers.security import get_current_user

router = APIRouter(prefix="/api/nft", tags=["nft"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class BuyRequest(BaseModel):
    painting_id: int


class TopupRequest(BaseModel):
    telegram_payment_charge_id: str
    amount: int


# ─── Публичные эндпоинты ──────────────────────────────────────────────────────

@router.get("/info")
async def nft_info(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    nft_stars = await db_nft.get_nft_stars(user_id)
    gallery = await db_nft.get_user_gallery(user_id)
    return {
        "nft_stars": nft_stars,
        "collection_size": len(gallery),
    }


@router.get("/shop")
async def nft_shop(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    paintings = await db_nft.get_active_paintings()

    # Отмечаем, какие картины уже куплены пользователем и сколько копий
    owned = await db_nft.get_user_gallery(user_id)
    owned_counts: dict[int, int] = {}
    for p in owned:
        owned_counts[p["id"]] = owned_counts.get(p["id"], 0) + 1

    for p in paintings:
        p["owned_count"] = owned_counts.get(p["id"], 0)
        p["owned"] = p["owned_count"] > 0

    return {"paintings": paintings}


@router.post("/buy")
async def nft_buy(
    req: BuyRequest,
    current_user: dict = Depends(get_current_user),
):
    user_id = current_user["id"]
    success, message = await db_nft.buy_painting(user_id, req.painting_id)

    if not success:
        errors = {
            "not_found":          "Картина не найдена или недоступна",
            "sold_out":           "Картина распродана",
            "not_enough_stars":   "Недостаточно NFT-звёзд",
        }
        raise HTTPException(status_code=400, detail=errors.get(message, message))

    nft_stars = await db_nft.get_nft_stars(user_id)
    gallery = await db_nft.get_user_gallery(user_id)

    # Логируем покупку в историю
    # Берём последнюю купленную копию этой картины (самый большой serial_number)
    copies = [p for p in gallery if p["id"] == req.painting_id]
    painting = max(copies, key=lambda p: p.get("serial_number", 0)) if copies else None
    title = painting["title"] if painting else f"Картина #{req.painting_id}"
    serial = painting.get("serial_number", 0) if painting else 0
    await add_history_entry(
        user_id, "nft_buy",
        f"Куплена картина «{title}» #{serial}",
        painting["price"] if painting else 0,
        ref_id=req.painting_id,
    )

    return {
        "status": "ok",
        "nft_stars": nft_stars,
        "collection_size": len(gallery),
    }


@router.get("/gallery/me")
async def nft_gallery_me(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    gallery = await db_nft.get_user_gallery(user_id)
    return {"gallery": gallery}


@router.get("/gallery/{user_id}")
async def nft_gallery_user(
    user_id: int,
    current_user: dict = Depends(get_current_user),
):
    gallery = await db_nft.get_user_gallery(user_id)
    return {"gallery": gallery, "user_id": user_id}


@router.get("/galleries")
async def nft_galleries(current_user: dict = Depends(get_current_user)):
    collectors = await db_nft.get_all_galleries()
    return {"collectors": collectors}


@router.post("/topup")
async def nft_topup(
    req: TopupRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Пополнение NFT-звёзд через Telegram Stars.
    Сумма в Telegram Stars = сумма NFT-звёзд (1:1).
    """
    if req.amount <= 0 or req.amount > 100_000:
        raise HTTPException(status_code=400, detail="Некорректная сумма")

    user_id = current_user["id"]
    new_balance = await db_nft.add_nft_stars(user_id, req.amount)

    # Логируем пополнение в историю
    await add_history_entry(
        user_id, "nft_topup",
        f"Пополнение NFT-звёзд на {req.amount} ⭐",
        req.amount,
    )

    return {"status": "ok", "nft_stars": new_balance}


@router.get("/history")
async def nft_history(current_user: dict = Depends(get_current_user)):
    user_id = current_user["id"]
    entries = await db_nft.get_nft_history(user_id)
    return {"history": entries}