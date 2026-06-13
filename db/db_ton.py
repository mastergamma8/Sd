# db/db_ton.py
# TON-депозиты и выводы: создание сессий, верификация, защита от двойного зачисления.

import time
from db import db_async as aiosqlite
from db.db_core import DB_NAME


# ── Депозиты ─────────────────────────────────────────────────────────────────

async def create_deposit_session(user_id: int, memo: str, expected_amount: float) -> int:
    """Создаёт запись о новом ожидаемом депозите. Возвращает id записи."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            INSERT INTO ton_deposits (user_id, memo, expected_amount, status, created_at)
            VALUES (?, ?, ?, 'pending', ?) RETURNING id
            """,
            (user_id, memo, expected_amount, int(time.time()))
        ) as cur:
            row = await cur.fetchone()
            await db.commit()
            return row["id"]


async def get_pending_deposit(user_id: int, memo: str) -> dict | None:
    """Возвращает незакрытую сессию депозита по user_id + memo."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM ton_deposits
            WHERE user_id = ? AND memo = ? AND status = 'pending'
              AND created_at > ?
            """,
            (user_id, memo, int(time.time()) - 3600)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def get_confirmed_deposit(user_id: int, memo: str) -> dict | None:
    """Возвращает уже подтверждённую сессию депозита по user_id + memo."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT * FROM ton_deposits
            WHERE user_id = ? AND memo = ? AND status = 'confirmed'
            """,
            (user_id, memo)
        ) as cur:
            row = await cur.fetchone()
            return dict(row) if row else None


async def confirm_deposit(deposit_id: int, actual_amount: float, tx_hash: str) -> bool:
    """Переводит депозит в статус 'confirmed'.
    Возвращает True если запись обновлена (т.е. это первое подтверждение),
    False — если депозит уже был подтверждён (race condition, двойной вызов).
    UNIQUE индекс на tx_hash даёт дополнительную защиту на уровне БД."""
    try:
        async with aiosqlite.connect(DB_NAME) as db:
            cur = await db.execute(
                """
                UPDATE ton_deposits
                SET status = 'confirmed', actual_amount = ?, tx_hash = ?, confirmed_at = ?
                WHERE id = ? AND status = 'pending'
                """,
                (actual_amount, tx_hash, int(time.time()), deposit_id)
            )
            await db.commit()
            return cur.rowcount > 0
    except aiosqlite.IntegrityError:
        # UNIQUE-конфликт на tx_hash: этот хэш уже записан в другой строке — двойное зачисление
        return False


async def is_tx_already_credited(tx_hash: str) -> bool:
    """
    Защита от двойного зачисления. Проверяет, не был ли tx_hash уже обработан.
    Критично: без этой проверки повторный вызов verify даст пользователю
    пончики второй раз за ту же транзакцию.
    """
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT 1 FROM ton_deposits WHERE tx_hash = ? AND status = 'confirmed'",
            (tx_hash,)
        ) as cur:
            return (await cur.fetchone()) is not None


async def expire_old_deposits() -> int:
    """Закрывает просроченные ожидающие депозиты. Возвращает количество закрытых."""
    cutoff = int(time.time()) - 3600
    async with aiosqlite.connect(DB_NAME) as db:
        cur = await db.execute(
            "UPDATE ton_deposits SET status = 'expired' WHERE status = 'pending' AND created_at < ?",
            (cutoff,)
        )
        await db.commit()
        return cur.rowcount


async def get_user_deposit_history(user_id: int, limit: int = 10) -> list[dict]:
    """История депозитов пользователя (подтверждённые)."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT memo, actual_amount, tx_hash, confirmed_at
            FROM ton_deposits
            WHERE user_id = ? AND status = 'confirmed'
            ORDER BY confirmed_at DESC
            LIMIT ?
            """,
            (user_id, limit)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]


# ── Выводы ────────────────────────────────────────────────────────────────────

async def save_user_wallet(user_id: int, wallet_address: str) -> None:
    """Сохраняет (или обновляет) TON-адрес кошелька пользователя."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "UPDATE users SET ton_wallet = ? WHERE tg_id = ?",
            (wallet_address, user_id)
        )
        await db.commit()


async def get_user_wallet(user_id: int) -> str | None:
    """Возвращает сохранённый TON-адрес пользователя или None."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT ton_wallet FROM users WHERE tg_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else None


async def get_last_withdrawal_time(user_id: int) -> int:
    """Возвращает timestamp последнего успешного вывода (0 если не было)."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            """
            SELECT created_at FROM ton_withdrawals
            WHERE user_id = ? AND status = 'sent'
            ORDER BY created_at DESC LIMIT 1
            """,
            (user_id,)
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def check_cooldown_and_create_withdrawal(
    user_id: int,
    to_address: str,
    amount_ton: float,
    fee_ton: float,
    cooldown: int,
) -> tuple[bool, int | None, str | None]:
    """Атомарно проверяет кулдаун и создаёт запись о выводе в одной транзакции.

    Возвращает (ok, withdrawal_id, wait_msg):
      - (True,  id,   None)       — кулдаун прошёл, запись создана
      - (False, None, wait_msg)   — кулдаун не прошёл, запись не создана
    """
    now = int(time.time())
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("BEGIN IMMEDIATE")
        try:
            # Проверяем кулдаун внутри блокировки
            async with db.execute(
                """
                SELECT created_at FROM ton_withdrawals
                WHERE user_id = ? AND status = 'sent'
                ORDER BY created_at DESC LIMIT 1
                """,
                (user_id,)
            ) as cur:
                row = await cur.fetchone()
                last_ts = row[0] if row else 0

            elapsed = now - last_ts
            if last_ts and elapsed < cooldown:
                await db.commit()
                wait_min = (cooldown - elapsed) // 60
                return False, None, f"Следующий вывод доступен через {wait_min} мин."

            # Кулдаун пройден — создаём запись
            async with db.execute(
                """
                INSERT INTO ton_withdrawals (user_id, to_address, amount_ton, fee_ton, status, created_at)
                VALUES (?, ?, ?, ?, 'pending', ?) RETURNING id
                """,
                (user_id, to_address, amount_ton, fee_ton, now)
            ) as cur:
                row = await cur.fetchone()
                withdrawal_id = row[0] if row else None

            await db.commit()
            return True, withdrawal_id, None
        except Exception:
            await db.rollback()
            raise


async def mark_withdrawal_sent(withdrawal_id: int, boc: str) -> None:
    """Помечает вывод как успешно отправленный в блокчейн."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            """
            UPDATE ton_withdrawals
            SET status = 'sent', boc_hash = ?, confirmed_at = ?
            WHERE id = ?
            """,
            (boc[:64], int(time.time()), withdrawal_id)
        )
        await db.commit()


async def mark_withdrawal_failed(withdrawal_id: int, error: str) -> None:
    """Помечает вывод как неуспешный. После этого вызывается refund."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "UPDATE ton_withdrawals SET status = 'failed', error = ? WHERE id = ?",
            (error[:255], withdrawal_id)
        )
        await db.commit()


async def get_user_withdrawal_history(user_id: int, limit: int = 10) -> list[dict]:
    """История выводов пользователя."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT to_address, amount_ton, fee_ton, status, boc_hash, created_at
            FROM ton_withdrawals
            WHERE user_id = ?
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (user_id, limit)
        ) as cur:
            rows = await cur.fetchall()
            return [dict(r) for r in rows]