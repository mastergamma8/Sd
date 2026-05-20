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

--- Эндпоинты для администратора ---
GET  /api/nft/admin/paintings        — все картины
POST /api/nft/admin/paintings        — создать картину
PATCH /api/nft/admin/paintings/{id}  — включить / выключить
DELETE /api/nft/admin/paintings/{id} — удалить картину
"""

import json
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import config
from db import db_nft
from handlers.security import get_current_user

router = APIRouter(prefix="/api/nft", tags=["nft"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class BuyRequest(BaseModel):
    painting_id: int


class TopupRequest(BaseModel):
    telegram_payment_charge_id: str
    amount: int


class CreatePaintingRequest(BaseModel):
    title: str
    description: str = ""
    image_url: str
    price: int
    total_supply: int = 0  # 0 = безлимитно


class TogglePaintingRequest(BaseModel):
    is_active: bool


# ─── Вспомогательные функции ──────────────────────────────────────────────────

def _is_admin(user_id: int) -> bool:
    return user_id == config.ADMIN_ID


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

    # Отмечаем, какие картины уже куплены пользователем
    owned = await db_nft.get_user_gallery(user_id)
    owned_ids = {p["id"] for p in owned}

    for p in paintings:
        p["owned"] = p["id"] in owned_ids

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
            "already_owned":      "Вы уже владеете этой картиной",
            "not_found":          "Картина не найдена или недоступна",
            "sold_out":           "Картина распродана",
            "not_enough_stars":   "Недостаточно NFT-звёзд",
        }
        raise HTTPException(status_code=400, detail=errors.get(message, message))

    nft_stars = await db_nft.get_nft_stars(user_id)
    gallery = await db_nft.get_user_gallery(user_id)
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
    return {"status": "ok", "nft_stars": new_balance}


# ─── Эндпоинты администратора ─────────────────────────────────────────────────

@router.get("/admin/paintings")
async def admin_get_paintings(current_user: dict = Depends(get_current_user)):
    if not _is_admin(current_user["id"]):
        raise HTTPException(status_code=403, detail="Нет доступа")
    paintings = await db_nft.get_all_paintings_admin()
    return {"paintings": paintings}


@router.post("/admin/paintings")
async def admin_create_painting(
    req: CreatePaintingRequest,
    current_user: dict = Depends(get_current_user),
):
    if not _is_admin(current_user["id"]):
        raise HTTPException(status_code=403, detail="Нет доступа")

    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Название обязательно")
    if not req.image_url.strip():
        raise HTTPException(status_code=400, detail="URL изображения обязателен")
    if req.price <= 0:
        raise HTTPException(status_code=400, detail="Цена должна быть > 0")

    painting = await db_nft.create_painting(
        title=req.title.strip(),
        description=req.description.strip(),
        image_url=req.image_url.strip(),
        price=req.price,
        total_supply=req.total_supply,
    )
    return {"status": "ok", "painting": painting}


@router.patch("/admin/paintings/{painting_id}")
async def admin_toggle_painting(
    painting_id: int,
    req: TogglePaintingRequest,
    current_user: dict = Depends(get_current_user),
):
    if not _is_admin(current_user["id"]):
        raise HTTPException(status_code=403, detail="Нет доступа")
    await db_nft.toggle_painting(painting_id, req.is_active)
    return {"status": "ok"}


@router.delete("/admin/paintings/{painting_id}")
async def admin_delete_painting(
    painting_id: int,
    current_user: dict = Depends(get_current_user),
):
    if not _is_admin(current_user["id"]):
        raise HTTPException(status_code=403, detail="Нет доступа")
    await db_nft.delete_painting(painting_id)
    return {"status": "ok"}
