"""
routers/nft_market.py
NFT Маркетплейс и Аукционы — API эндпоинты.

Маркетплейс (фиксированная цена):
  GET  /api/nft/market/listings          — все активные листинги
  POST /api/nft/market/list              — выставить свою картину на продажу
  POST /api/nft/market/cancel/{id}       — снять листинг
  POST /api/nft/market/buy/{id}          — купить картину с листинга

Аукционы:
  GET  /api/nft/auction/list             — все активные аукционы
  POST /api/nft/auction/create           — создать аукцион
  POST /api/nft/auction/bid/{id}         — поставить ставку
  POST /api/nft/auction/cancel/{id}      — отменить аукцион (только без ставок)
"""

import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from db import db_nft_market, db_nft
from db.db_history import add_history_entry
from handlers.security import get_current_user
import config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/nft", tags=["nft_market"])


# ─── Схемы запросов ───────────────────────────────────────────────────────────

class ListRequest(BaseModel):
    nft_owned_id: int
    price: int = Field(gt=0, le=1_000_000, description="Цена в NFT-звёздах")


class AuctionCreateRequest(BaseModel):
    nft_owned_id:   int
    start_price:    int = Field(gt=0, le=1_000_000)
    duration_hours: int = Field(description="Длительность: 1, 3, 6, 12, 24 или 48 ч")


class BidRequest(BaseModel):
    amount: int = Field(gt=0, le=1_000_000, description="Ставка в NFT-звёздах")


# ─── Вспомогательная функция: уведомление в бот ───────────────────────────────

async def _send_bot_notify(user_id: int, text: str) -> None:
    """Отправляет уведомление пользователю через бот. Ошибки не прерывают основной поток."""
    try:
        from bot import bot
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
        markup = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(
                text="🎨 Открыть галерею",
                web_app=WebAppInfo(url=config.WEBAPP_URL),
            )
        ]])
        await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=markup)
    except Exception as e:
        logger.warning("bot notify failed for user %s: %s", user_id, e)


# ─── Маркетплейс ──────────────────────────────────────────────────────────────

@router.get("/market/listings")
async def market_listings(current_user: dict = Depends(get_current_user)):
    """Возвращает все активные листинги с флагами is_mine для текущего пользователя."""
    user_id  = current_user["id"]
    listings = await db_nft_market.get_active_listings()
    for item in listings:
        item["is_mine"] = (item["seller_id"] == user_id)
    return {"listings": listings}


@router.post("/market/list")
async def market_list(
    req: ListRequest,
    current_user: dict = Depends(get_current_user),
):
    """Выставить картину на продажу по фиксированной цене."""
    user_id = current_user["id"]
    ok, err = await db_nft_market.create_listing(user_id, req.nft_owned_id, req.price)
    if not ok:
        errors = {
            "not_owned":      "NFT не найдено в вашей коллекции",
            "already_listed": "Эта картина уже выставлена на продажу или аукцион",
        }
        raise HTTPException(status_code=400, detail=errors.get(err, err))
    return {"status": "ok"}


@router.post("/market/cancel/{listing_id}")
async def market_cancel(
    listing_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Снять собственный листинг."""
    user_id = current_user["id"]
    ok, err = await db_nft_market.cancel_listing(listing_id, user_id)
    if not ok:
        errors = {
            "not_found":  "Листинг не найден",
            "not_owner":  "Это не ваш листинг",
            "not_active": "Листинг уже неактивен",
        }
        raise HTTPException(status_code=400, detail=errors.get(err, err))
    return {"status": "ok"}


@router.post("/market/buy/{listing_id}")
async def market_buy(
    listing_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Купить картину с листинга. Звёзды списываются у покупателя и зачисляются продавцу."""
    user_id = current_user["id"]
    ok, result = await db_nft_market.buy_listing(listing_id, user_id)
    if not ok:
        errors = {
            "not_found":        "Листинг не найден",
            "not_active":       "Листинг уже закрыт",
            "own_listing":      "Нельзя купить собственный листинг",
            "not_enough_stars": "Недостаточно NFT-звёзд",
        }
        raise HTTPException(status_code=400, detail=errors.get(result, result))

    info      = result  # dict: price, seller_id, title
    price     = info["price"]
    seller_id = info["seller_id"]
    title     = info["title"]

    nft_stars = await db_nft.get_nft_stars(user_id)

    # История покупателя
    await add_history_entry(
        user_id, "nft_market_buy",
        f"Куплена картина «{title}» с маркетплейса за {price} ⭐",
        price, ref_id=listing_id,
    )
    # История продавца
    await add_history_entry(
        seller_id, "nft_market_sold",
        f"Картина «{title}» продана на маркетплейсе за {price} ⭐",
        price, ref_id=listing_id,
    )

    # Уведомление продавцу в бот
    await _send_bot_notify(
        seller_id,
        f"🎨 <b>Ваша картина продана!</b>\n\n"
        f"«{title}» куплена с маркетплейса за <b>{price} ⭐</b>\n"
        f"Звёзды уже начислены на ваш баланс.",
    )

    return {"status": "ok", "nft_stars": nft_stars}


# ─── Аукционы ─────────────────────────────────────────────────────────────────

@router.get("/auction/list")
async def auction_list(current_user: dict = Depends(get_current_user)):
    """
    Возвращает все активные аукционы.
    Истёкшие аукционы завершаются автоматически при каждом вызове.
    """
    user_id  = current_user["id"]

    # Завершаем просроченные и получаем список для уведомлений
    finalized = await db_nft_market.get_and_clear_finalized_auctions()
    for f in finalized:
        if f["winner_id"]:
            # История победителя
            await add_history_entry(
                f["winner_id"], "nft_auction_won",
                f"Выиграна картина «{f['title']}» на аукционе за {f['final_price']} ⭐",
                f["final_price"], ref_id=f["auction_id"],
            )
            # История продавца
            await add_history_entry(
                f["seller_id"], "nft_auction_sold",
                f"Картина «{f['title']}» продана на аукционе за {f['final_price']} ⭐",
                f["final_price"], ref_id=f["auction_id"],
            )
            # Уведомление победителю
            await _send_bot_notify(
                f["winner_id"],
                f"🏆 <b>Вы выиграли аукцион!</b>\n\n"
                f"Картина «{f['title']}» теперь в вашей коллекции.\n"
                f"Финальная ставка: <b>{f['final_price']} ⭐</b>",
            )
            # Уведомление продавцу
            await _send_bot_notify(
                f["seller_id"],
                f"🎨 <b>Аукцион завершён!</b>\n\n"
                f"«{f['title']}» продана за <b>{f['final_price']} ⭐</b>\n"
                f"Звёзды уже начислены на ваш баланс.",
            )

    auctions = await db_nft_market.get_active_auctions()
    for item in auctions:
        item["is_mine"]    = (item["seller_id"]      == user_id)
        item["is_leading"] = (item["current_bidder"] == user_id)
    return {"auctions": auctions}


@router.post("/auction/create")
async def auction_create(
    req: AuctionCreateRequest,
    current_user: dict = Depends(get_current_user),
):
    """Создать аукцион. Картина блокируется до завершения торгов."""
    user_id = current_user["id"]
    ok, err = await db_nft_market.create_auction(
        user_id, req.nft_owned_id, req.start_price, req.duration_hours
    )
    if not ok:
        errors = {
            "not_owned":        "NFT не найдено в вашей коллекции",
            "already_listed":   "Эта картина уже выставлена на продажу или аукцион",
            "invalid_duration": "Допустимые значения: 1, 3, 6, 12, 24, 48 ч",
        }
        raise HTTPException(status_code=400, detail=errors.get(err, err))
    return {"status": "ok"}


@router.post("/auction/bid/{auction_id}")
async def auction_bid(
    auction_id: int,
    req: BidRequest,
    current_user: dict = Depends(get_current_user),
):
    """
    Поставить ставку. Ставка списывается сразу; предыдущая ставка возвращается
    перебитому участнику в тот же момент.
    """
    user_id = current_user["id"]
    ok, result = await db_nft_market.place_bid(auction_id, user_id, req.amount)
    if not ok:
        errors = {
            "not_found":        "Аукцион не найден",
            "not_active":       "Аукцион завершён",
            "ended":            "Время аукциона истекло",
            "own_auction":      "Нельзя ставить на собственный аукцион",
            "bid_too_low":      "Ставка должна быть выше текущей",
            "not_enough_stars": "Недостаточно NFT-звёзд",
        }
        raise HTTPException(status_code=400, detail=errors.get(result, result))

    info        = result  # dict: title, prev_bidder, prev_price, new_amount
    title       = info["title"]
    prev_bidder = info["prev_bidder"]
    prev_price  = info["prev_price"]

    nft_stars = await db_nft.get_nft_stars(user_id)

    # История нового участника
    await add_history_entry(
        user_id, "nft_auction_bid",
        f"Ставка {req.amount} ⭐ на картину «{title}» (аукцион #{auction_id})",
        req.amount, ref_id=auction_id,
    )

    # Перебитый участник: история возврата + уведомление
    if prev_bidder:
        await add_history_entry(
            prev_bidder, "nft_auction_outbid",
            f"Ставка перебита — {prev_price} ⭐ возвращены (аукцион «{title}»)",
            prev_price, ref_id=auction_id,
        )
        await _send_bot_notify(
            prev_bidder,
            f"⚠️ <b>Вашу ставку перебили!</b>\n\n"
            f"Аукцион: «{title}»\n"
            f"Ваши <b>{prev_price} ⭐</b> возвращены на баланс.\n"
            f"Сделайте новую ставку, чтобы не упустить картину.",
        )

    return {"status": "ok", "nft_stars": nft_stars}


@router.post("/auction/cancel/{auction_id}")
async def auction_cancel(
    auction_id: int,
    current_user: dict = Depends(get_current_user),
):
    """Отменить аукцион. Возможно только при отсутствии ставок."""
    user_id = current_user["id"]
    ok, err = await db_nft_market.cancel_auction(auction_id, user_id)
    if not ok:
        errors = {
            "not_found":  "Аукцион не найден",
            "not_owner":  "Это не ваш аукцион",
            "not_active": "Аукцион уже завершён",
            "has_bids":   "Нельзя отменить — уже есть ставки",
        }
        raise HTTPException(status_code=400, detail=errors.get(err, err))
    return {"status": "ok"}