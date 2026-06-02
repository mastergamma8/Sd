"""
migrate_donut_balances.py
=========================
Одноразовая миграция балансов пончиков.

До:  balance хранился как TON-эквивалент (FLOAT, напр. 0.1, 0.5, 1.5)
После: balance хранится как целые пончики (1 пончик = 0.1 TON),
       т.е. старый 0.1 → 1, 0.5 → 5, 1.5 → 15.

Формула: new_balance = ROUND(old_balance * 10)

ЗАПУСК (один раз перед рестартом сервера):
    python migrate_donut_balances.py

Требует DATABASE_URL в переменных окружения.
"""

import asyncio
import os

import psycopg


DB_DSN = (
    os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or os.getenv("RAILWAY_DATABASE_URL")
)

if not DB_DSN:
    raise RuntimeError("DATABASE_URL не задан.")


async def run_migration():
    print("=== Миграция балансов пончиков ===")
    print("Формула: new_balance = ROUND(old_balance * 10)\n")

    async with await psycopg.AsyncConnection.connect(DB_DSN) as conn:
        async with conn.cursor() as cur:

            # 1. Статистика до
            await cur.execute("SELECT COUNT(*), SUM(balance), MAX(balance) FROM users WHERE balance > 0")
            row = await cur.fetchone()
            print(f"До миграции:")
            print(f"  Пользователей с балансом > 0 : {row[0]}")
            print(f"  Сумма всех балансов          : {row[1]:.4f}")
            print(f"  Максимальный баланс           : {row[2]:.4f}")

            # 2. Выполняем миграцию
            await cur.execute("""
                UPDATE users
                SET balance = ROUND(balance * 10)
                WHERE balance IS NOT NULL
            """)
            updated = cur.rowcount
            await conn.commit()

            # 3. Статистика после
            await cur.execute("SELECT COUNT(*), SUM(balance), MAX(balance) FROM users WHERE balance > 0")
            row = await cur.fetchone()
            print(f"\nПосле миграции (строк обновлено: {updated}):")
            print(f"  Пользователей с балансом > 0 : {row[0]}")
            print(f"  Сумма всех балансов          : {row[1]}")
            print(f"  Максимальный баланс           : {row[2]}")

            # 4. Проверяем что не осталось дробей
            await cur.execute("SELECT COUNT(*) FROM users WHERE balance != FLOOR(balance)")
            frac = await cur.fetchone()
            if frac[0] == 0:
                print("\n✅ Все балансы целые. Миграция успешна.")
            else:
                print(f"\n⚠️  Осталось {frac[0]} пользователей с дробными балансами.")


asyncio.run(run_migration())