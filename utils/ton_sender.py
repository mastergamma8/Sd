"""
utils/ton_sender.py
Подпись и отправка TON-транзакций от имени кошелька бота.

Использует tonsdk для локальной подписи (приватный ключ никуда не уходит)
и TON Center API v2 для широковещательной рассылки подписанного BOC.
"""

import httpx
from tonsdk.contract.wallet import Wallets, WalletVersionEnum
from tonsdk.utils import to_nano, bytes_to_b64str

import config

_TON_CENTER = "https://toncenter.com/api/v2"


def _api_params(extra: dict = None) -> dict:
    """Добавляет API-ключ к параметрам запроса, если он задан."""
    params = dict(extra or {})
    if config.TON_CENTER_API_KEY:
        params["api_key"] = config.TON_CENTER_API_KEY
    return params


async def _get_wallet_seqno(address: str) -> int:
    """
    Запрашивает текущий seqno у смарт-контракта кошелька бота.
    Seqno защищает от воспроизведения транзакций (replay attack).
    Возвращает 0, если кошелёк ещё не инициализирован.
    """
    params = _api_params({
        "address": address,
        "method":  "seqno",
        "stack":   "[]",
    })
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp   = await client.get(f"{_TON_CENTER}/runGetMethod", params=params)
            result = resp.json()
            if result.get("ok"):
                stack = result["result"].get("stack", [])
                if stack:
                    raw = stack[0][1]  # ["num", "0x5"] или ["num", "5"]
                    return int(raw, 16) if str(raw).startswith("0x") else int(raw)
    except Exception:
        pass
    return 0


async def send_ton(to_address: str, amount_ton: float, comment: str = "") -> str:
    """
    Подписывает и отправляет перевод TON с кошелька бота.

    Параметры:
        to_address  — адрес получателя в любом формате (UQ..., EQ..., 0:hex)
        amount_ton  — сумма в TON (не нанотонах)
        comment     — необязательный текстовый комментарий

    Возвращает base64-строку BOC (идентификатор транзакции).
    Бросает Exception при любой ошибке сети или валидации.
    """
    if not config.TON_WALLET_MNEMONIC:
        raise ValueError("TON_WALLET_MNEMONIC не задан в конфиге")

    # Восстанавливаем кошелёк бота из мнемоники (ключи не покидают сервер)
    _, _, _, wallet = Wallets.from_mnemonics(
        config.TON_WALLET_MNEMONIC,
        WalletVersionEnum.v4r2,
        workchain=0,
    )

    bot_address = wallet.address.to_string(True, True, True)
    seqno       = await _get_wallet_seqno(bot_address)

    # Формируем и подписываем транзакцию локально
    transfer = wallet.create_transfer_message(
        to_addr=to_address,
        amount=to_nano(amount_ton, "ton"),
        seqno=seqno,
        payload=comment or "",
        send_mode=3,       # 1 (оплата комиссии отдельно) + 2 (ignore errors)
    )

    boc = bytes_to_b64str(transfer["message"].to_boc(False))

    # Широковещательно отправляем подписанный BOC в блокчейн
    params = _api_params()
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp   = await client.post(f"{_TON_CENTER}/sendBoc", json={"boc": boc}, params=params)
        result = resp.json()

    if not result.get("ok"):
        err = result.get("error", "unknown error")
        raise RuntimeError(f"TON sendBoc failed: {err}")

    return boc  # служит уникальным идентификатором транзакции