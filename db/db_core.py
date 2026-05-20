# db_core.py
# Общие константы подключения к базе данных.
# Импортируется всеми остальными db_*.py модулями.
#
# Требует PostgreSQL. Если DATABASE_URL не задан — приложение не стартует.
# Никакого fallback на SQLite нет намеренно: молчаливый откат к файловой БД
# на Railway (или в любом другом облаке) был бы опаснее явной ошибки.

import os

from db import db_async as aiosqlite  # noqa: F401 — совместимый API для PostgreSQL

DB_NAME = (
    os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or os.getenv("RAILWAY_DATABASE_URL")
)

if not DB_NAME:
    raise RuntimeError(
        "DATABASE_URL не задан. Для запуска требуется строка подключения PostgreSQL.\n"
        "Задайте переменную окружения, например:\n"
        "  DATABASE_URL=postgresql://user:password@host:5432/dbname\n"
        "\n"
        "На Railway переменная добавляется автоматически при подключении сервиса PostgreSQL."
    )

GIFT_WITHDRAW_COOLDOWN = 5 * 3600  # 5 часов — лимит вывода (инвентарь)
GIFT_CLAIM_COOLDOWN   = 5 * 3600  # 5 часов — лимит покупки (главная)
