"""
routers/ton.py
TON-депозиты и выводы.

POST /api/ton/deposit/create   — создать сессию ожидания депозита
POST /api/ton/deposit/verify   — проверить, пришёл ли платёж
GET  /api/ton/deposit/history  — история подтверждённых депозитов пользователя
GET  /api/ton/config           — публичная конфигурация (адрес кошелька, лимиты)
POST /api/ton/wallet/save      — сохранить адрес кошелька пользователя
POST /api/ton/withdraw         — вывести TON с баланса
GET  /api/ton/withdraw/history — история выводов пользователя
"""

import logging
import secrets
import time
import httpx

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.enums import ButtonStyle

import config
import database
from db import db_ton
from handlers.security import get_current_user

logger = logging.getLogger(__name__)

# Премиум-эмодзи TON (emoji-id 5424912684078348533)
_E_TON  = '<tg-emoji emoji-id="5424912684078348533">💎</tg-emoji>'
_ID_TON = "5424912684078348533"


def _open_app_markup() -> InlineKeyboardMarkup:
    """Кнопка «Открыть приложение» с иконкой TON."""
    return InlineKeyboardMarkup(inline_keyboard=[[
        InlineKeyboardButton(
            text="Открыть приложение",
            web_app=WebAppInfo(url=config.WEBAPP_URL),
            style=ButtonStyle.SUCCESS,
            icon_custom_emoji_id=_ID_TON,
        )
    ]])


async def _notify_deposit(user_id: int, amount: float, new_balance: float) -> None:
    """Отправляет пользователю уведомление об успешном пополнении TON-баланса."""
    try:
        from bot import bot
        text = (
            f"{_E_TON} <b>Баланс пополнен!</b>\n\n"
            f"На ваш счёт зачислено <b>{amount:.4f} TON</b>.\n"
            f"Текущий TON-баланс: <b>{new_balance:.4f} TON</b>"
        )
        await bot.send_message(
            user_id, text,
            parse_mode="HTML",
            reply_markup=_open_app_markup(),
        )
    except Exception as e:
        logger.warning("Не удалось отправить уведомление о депозите пользователю %s: %s", user_id, e)


async def _notify_withdraw(user_id: int, net_amount: float, new_balance: float, to_address: str) -> None:
    """Отправляет пользователю уведомление об успешном выводе TON."""
    try:
        from bot import bot
        short_addr = to_address[:8] + "..." + to_address[-6:]
        text = (
            f"{_E_TON} <b>Вывод TON выполнен!</b>\n\n"
            f"Отправлено <b>{net_amount:.4f} TON</b> на кошелёк "
            f"<code>{short_addr}</code>.\n"
            f"Текущий TON-баланс: <b>{new_balance:.4f} TON</b>"
        )
        await bot.send_message(
            user_id, text,
            parse_mode="HTML",
            reply_markup=_open_app_markup(),
        )
    except Exception as e:
        logger.warning("Не удалось отправить уведомление о выводе пользователю %s: %s", user_id, e)

router = APIRouter(prefix="/api/ton", tags=["ton"])

TON_CENTER_API = (
    "https://testnet.toncenter.com/api/v2"
    if config.TON_IS_TESTNET
    else "https://toncenter.com/api/v2"
)


# ── Pydantic-модели ────────────────────────────────────────────────────────────

class DepositCreateRequest(BaseModel):
    amount_ton: float


class DepositVerifyRequest(BaseModel):
    memo: str


class WalletSaveRequest(BaseModel):
    wallet_address: str


class WithdrawRequest(BaseModel):
    amount_ton: float


# ── Вспомогательные функции ───────────────────────────────────────────────────

def _generate_memo(user_id: int) -> str:
    """
    Генерирует уникальный комментарий для транзакции.
    Формат: SD-{user_id}-{8 случайных символов}
    """
    rnd = secrets.token_hex(4)
    return f"SD-{user_id}-{rnd}"


async def _fetch_ton_transactions(wallet_address: str, limit: int = 25) -> list[dict]:
    """
    Запрашивает последние транзакции кошелька через TON Center API v2.
    Возвращает список транзакций или пустой список при ошибке.
    """
    params = {"address": wallet_address, "limit": limit}
    if config.TON_CENTER_API_KEY:
        params["api_key"] = config.TON_CENTER_API_KEY

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{TON_CENTER_API}/getTransactions", params=params)
            data = resp.json()
            if data.get("ok"):
                return data.get("result", [])
    except Exception:
        pass
    return []


def _extract_comment(tx: dict) -> str:
    """Извлекает текстовый комментарий из входящего сообщения транзакции."""
    in_msg = tx.get("in_msg") or {}
    return (in_msg.get("message") or "").strip()


def _extract_amount_ton(tx: dict) -> float:
    """Возвращает сумму входящего перевода в TON (из нанотонов)."""
    in_msg = tx.get("in_msg") or {}
    try:
        return int(in_msg.get("value", 0)) / 1_000_000_000
    except (TypeError, ValueError):
        return 0.0


def _extract_tx_hash(tx: dict) -> str:
    """Возвращает хэш транзакции для защиты от двойного зачисления."""
    tx_id = tx.get("transaction_id") or {}
    return tx_id.get("hash", "")


# ── Эндпоинты ─────────────────────────────────────────────────────────────────

@router.get("/config")
async def ton_config():
    """
    Публичная конфигурация TON-депозитов.
    Фронтенд запрашивает это при открытии модального окна депозита.
    """
    if not config.TON_WALLET_ADDRESS:
        raise HTTPException(503, "TON deposits are not configured")
    return {
        "wallet_address": config.TON_WALLET_ADDRESS,
        "is_testnet":     config.TON_IS_TESTNET,
        "min_deposit":    config.TON_MIN_DEPOSIT,
        "max_deposit":    config.TON_MAX_DEPOSIT,
        "timeout_sec":    config.TON_DEPOSIT_TIMEOUT,
        "min_withdraw":   config.TON_MIN_WITHDRAW,
        "max_withdraw":   config.TON_MAX_WITHDRAW,
        "withdraw_fee":   config.TON_WITHDRAW_FEE,
    }


@router.post("/deposit/create")
async def create_deposit(
    data: DepositCreateRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Создаёт сессию ожидания депозита.
    Возвращает уникальный memo и адрес кошелька для перевода.
    """
    if not config.TON_WALLET_ADDRESS:
        raise HTTPException(503, "TON deposits are not configured")

    amount = data.amount_ton
    if amount < config.TON_MIN_DEPOSIT:
        raise HTTPException(400, f"Минимальный депозит: {config.TON_MIN_DEPOSIT} TON")
    if amount > config.TON_MAX_DEPOSIT:
        raise HTTPException(400, f"Максимальный депозит: {config.TON_MAX_DEPOSIT} TON")

    user_id = current_user["id"]
    memo    = _generate_memo(user_id)

    await db_ton.create_deposit_session(user_id, memo, amount)

    return {
        "memo":           memo,
        "wallet_address": config.TON_WALLET_ADDRESS,
        "amount_ton":     amount,
        "expires_at":     int(time.time()) + config.TON_DEPOSIT_TIMEOUT,
    }


@router.post("/deposit/verify")
async def verify_deposit(
    data: DepositVerifyRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Проверяет, пришла ли TON-транзакция с указанным memo на кошелёк.
    Фронтенд вызывает этот эндпоинт каждые 5–10 секунд после отправки транзакции.

    При подтверждении: начисляет пончики (= TON) на баланс пользователя.
    Идемпотентен: повторный вызов с подтверждённым memo вернёт ошибку 409.
    """
    user_id = current_user["id"]
    memo    = data.memo.strip()

    session = await db_ton.get_pending_deposit(user_id, memo)
    if not session:
        # Гонка: параллельный poll уже успел подтвердить эту сессию.
        # Возвращаем confirmed вместо 404, чтобы фронтенд корректно завершил поток.
        confirmed = await db_ton.get_confirmed_deposit(user_id, memo)
        if confirmed:
            updated = await database.get_user_data(user_id)
            return {
                "status":          "confirmed",
                "amount_ton":      confirmed.get("actual_amount", 0),
                "new_ton_balance": updated.get("ton_balance", 0),
                "new_balance":     updated.get("balance", 0),
                "new_stars":       updated.get("stars", 0),
            }
        raise HTTPException(
            404,
            "Сессия депозита не найдена или истекла. Создайте новый депозит."
        )

    txs = await _fetch_ton_transactions(config.TON_WALLET_ADDRESS)

    for tx in txs:
        comment  = _extract_comment(tx)
        amount   = _extract_amount_ton(tx)
        tx_hash  = _extract_tx_hash(tx)

        if comment != memo:
            continue

        if not tx_hash:
            continue

        # Защита от двойного зачисления
        already_credited = await db_ton.is_tx_already_credited(tx_hash)
        if already_credited:
            raise HTTPException(409, "Эта транзакция уже была зачислена.")

        # Подтверждаем депозит в БД
        await db_ton.confirm_deposit(session["id"], amount, tx_hash)

        # Начисляем на TON-баланс (отдельный от пончиков)
        await database.add_ton_balance(user_id, amount)

        # Логируем в историю
        await database.log_action(
            user_id,
            "ton_deposit",
            f"Пополнение через TON: {amount:.4f} TON [memo:{memo}] [tx:{tx_hash[:16]}...]",
            amount,
        )

        updated = await database.get_user_data(user_id)
        new_ton_balance = updated.get("ton_balance", 0)

        # Уведомляем пользователя в Telegram
        await _notify_deposit(user_id, amount, new_ton_balance)

        return {
            "status":          "confirmed",
            "amount_ton":      amount,
            "new_ton_balance": new_ton_balance,
            "new_balance":     updated.get("balance", 0),
            "new_stars":       updated.get("stars", 0),
        }

    # Транзакция ещё не найдена в блокчейне
    return {"status": "pending"}


@router.get("/deposit/history")
async def deposit_history(
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    """История подтверждённых TON-депозитов пользователя."""
    if limit < 1 or limit > 50:
        raise HTTPException(400, "limit: 1–50")
    user_id = current_user["id"]
    rows = await db_ton.get_user_deposit_history(user_id, limit)
    return {"deposits": rows}


@router.get("/wallet/balance")
async def get_wallet_balance(
    current_user: dict = Depends(get_current_user)
):
    """
    Возвращает фактический баланс TON-кошелька пользователя из блокчейна.
    Адрес берётся из базы данных (сохраняется при подключении TonConnect).
    """
    wallet_address = await db_ton.get_user_wallet(current_user["id"])
    if not wallet_address:
        return {"wallet_balance": None, "error": "no_wallet"}

    params: dict = {"address": wallet_address}
    if config.TON_CENTER_API_KEY:
        params["api_key"] = config.TON_CENTER_API_KEY

    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(f"{TON_CENTER_API}/getAddressBalance", params=params)
            data = resp.json()
            if data.get("ok"):
                nano = int(data.get("result", 0))
                return {"wallet_balance": nano / 1_000_000_000}
    except Exception as e:
        pass

    return {"wallet_balance": None, "error": "fetch_failed"}


@router.post("/wallet/save")
async def save_wallet(
    data: WalletSaveRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Сохраняет TON-адрес кошелька пользователя.
    Вызывается автоматически фронтендом при подключении TonConnect.
    """
    addr = data.wallet_address.strip()
    if not addr:
        raise HTTPException(400, "Пустой адрес кошелька")
    if not (addr.startswith(("EQ", "UQ", "0:")) or len(addr) >= 48):
        raise HTTPException(400, "Неверный формат TON-адреса")

    await db_ton.save_user_wallet(current_user["id"], addr)
    return {"status": "ok"}


@router.post("/withdraw")
async def withdraw_ton(
    data: WithdrawRequest,
    current_user: dict = Depends(get_current_user)
):
    """
    Выводит TON с игрового баланса пользователя на его TON-кошелёк.

    Порядок операций:
    1. Проверки (кошелёк, лимиты, кулдаун, баланс)
    2. Атомарное списание balance (deduct_balance)
    3. Отправка TON в блокчейн (send_ton)
    4. При неудаче — автоматический возврат balance (refund)
    5. Логирование результата
    """
    if not config.TON_WALLET_MNEMONIC:
        raise HTTPException(503, "Вывод TON временно недоступен")

    user_id    = current_user["id"]
    amount_ton = data.amount_ton
    fee        = config.TON_WITHDRAW_FEE
    net_amount = round(amount_ton - fee, 9)

    # ── 1. Проверки ───────────────────────────────────────────────────────────
    if amount_ton < config.TON_MIN_WITHDRAW:
        raise HTTPException(400, f"Минимальный вывод: {config.TON_MIN_WITHDRAW} TON")
    if amount_ton > config.TON_MAX_WITHDRAW:
        raise HTTPException(400, f"Максимальный вывод: {config.TON_MAX_WITHDRAW} TON")
    if net_amount <= 0:
        raise HTTPException(400, "Сумма после вычета комиссии не может быть ≤ 0")

    to_address = await db_ton.get_user_wallet(user_id)
    if not to_address:
        raise HTTPException(400, "Сначала подключите TON-кошелёк")

    last_withdraw = await db_ton.get_last_withdrawal_time(user_id)
    if last_withdraw:
        elapsed  = int(time.time()) - last_withdraw
        cooldown = config.TON_WITHDRAW_COOLDOWN
        if elapsed < cooldown:
            wait_min = (cooldown - elapsed) // 60
            raise HTTPException(429, f"Следующий вывод доступен через {wait_min} мин.")

    # ── 2. Атомарное списание ton_balance ───────────────────────────────────────
    deducted = await database.deduct_ton_balance(user_id, amount_ton)
    if not deducted:
        raise HTTPException(400, "Недостаточно TON на балансе")

    # ── 3. Создаём запись в БД ────────────────────────────────────────────────
    withdrawal_id = await db_ton.create_withdrawal_record(
        user_id, to_address, amount_ton, fee
    )

    # ── 4. Отправляем TON в блокчейн ──────────────────────────────────────────
    try:
        from utils.ton_sender import send_ton
        boc = await send_ton(
            to_address=to_address,
            amount_ton=net_amount,
            comment=f"Space Donut withdrawal #{withdrawal_id}",
        )
        await db_ton.mark_withdrawal_sent(withdrawal_id, boc)

    except Exception as err:
        # Отправка не удалась → возвращаем TON-баланс пользователю
        await database.add_ton_balance(user_id, amount_ton)
        await db_ton.mark_withdrawal_failed(withdrawal_id, str(err))
        raise HTTPException(502, "Ошибка отправки: не удалось перевести TON. Баланс возвращён.")

    # ── 5. Логируем успешный вывод ────────────────────────────────────────────
    await database.log_action(
        user_id,
        "ton_withdraw",
        f"Вывод {net_amount:.4f} TON (комиссия {fee} TON) → {to_address[:12]}... [id:{withdrawal_id}]",
        -amount_ton,
    )

    updated = await database.get_user_data(user_id)
    new_ton_balance = updated.get("ton_balance", 0)

    # Уведомляем пользователя в Telegram
    await _notify_withdraw(user_id, net_amount, new_ton_balance, to_address)

    return {
        "status":          "sent",
        "amount_ton":      net_amount,
        "fee_ton":         fee,
        "to_address":      to_address,
        "new_ton_balance": new_ton_balance,
        "new_balance":     updated.get("balance", 0),
    }


@router.get("/withdraw/history")
async def withdrawal_history(
    limit: int = 10,
    current_user: dict = Depends(get_current_user)
):
    """История выводов TON текущего пользователя."""
    if limit < 1 or limit > 50:
        raise HTTPException(400, "limit: 1–50")
    rows = await db_ton.get_user_withdrawal_history(current_user["id"], limit)
    return {"withdrawals": rows}