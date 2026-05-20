# db/db_settings.py
# Хранит глобальные настройки приложения в SQLite-таблице app_settings.
# Оба процесса (бот и FastAPI) читают и пишут через эти функции,
# поэтому изменения от бота мгновенно видны FastAPI — и наоборот.
#
# Схема:  key TEXT PRIMARY KEY, value TEXT
#
# Ключи:
#   maintenance_mode      — "1" / "0"
#   feature_flag_roulette — "1" / "0"
#   feature_flag_cases    — "1" / "0"
#   feature_flag_rocket   — "1" / "0"
#   feature_flag_limited_gifts — "1" / "0"
#   feature_flag_pvp          — "1" / "0"
#   feature_flag_case_<id>     — "1" / "0"  (для конкретного кейса)
#
# Таблица beta_testers:
#   user_id INTEGER PRIMARY KEY  — ID пользователей с полным доступом,
#   которые видят приложение даже при maintenance mode или отключённых фичах.

from db import db_async as aiosqlite
from db.db_core import DB_NAME

# ── Инициализация ──────────────────────────────────────────────────────────────

async def init_settings_table():
    """Создаёт таблицу app_settings, если её ещё нет, и вставляет дефолты."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS app_settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL DEFAULT '1'
            )
        """)
        # Вставляем дефолты только если ключа ещё нет (INSERT OR IGNORE)
        defaults = [
            ("maintenance_mode",            "0"),
            ("feature_flag_roulette",       "1"),
            ("feature_flag_cases",          "1"),
            ("feature_flag_rocket",         "1"),
            ("exchange_bonus_percent",   "10"),
            ("feature_flag_limited_gifts",  "1"),
            ("feature_flag_pvp",             "1"),
        ]
        await db.executemany(
            "INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)",
            defaults,
        )
        await db.commit()

# ── Низкоуровневые get / set ──────────────────────────────────────────────────

async def _get(key: str, default: str = "1") -> str:
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT value FROM app_settings WHERE key = ?", (key,)
        ) as cur:
            row = await cur.fetchone()
    return row[0] if row else default


async def _set(key: str, value: str) -> None:
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "INSERT INTO app_settings (key, value) VALUES (?, ?)"
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()

# ── Maintenance mode ──────────────────────────────────────────────────────────

async def get_maintenance_mode() -> bool:
    return (await _get("maintenance_mode", "0")) == "1"


async def set_maintenance_mode(enabled: bool) -> None:
    await _set("maintenance_mode", "1" if enabled else "0")

# ── Feature flags ─────────────────────────────────────────────────────────────

async def get_feature_flags() -> dict:
    """
    Возвращает словарь флагов видимости разделов.
    Ключи: roulette, cases, rocket, limited_gifts, case_<id>, ...
    Значения: True (видим) / False (скрыт).
    """
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT key, value FROM app_settings WHERE key LIKE 'feature_flag_%'"
        ) as cur:
            rows = await cur.fetchall()

    flags = {}
    for row in rows:
        # row[0] = key, row[1] = value
        # Используем индексный доступ вместо распаковки, так как _RowProxy
        # (PostgreSQL-адаптер) итерируется по именам колонок, а не по значениям.
        # "feature_flag_roulette" → "roulette"
        flag_name = row[0].replace("feature_flag_", "", 1)
        flags[flag_name] = row[1] == "1"

    # Совместимость со старым названием feature_flag_mines
    legacy_mines = flags.pop("mines", None)
    if "pvp" not in flags and legacy_mines is not None:
        flags["pvp"] = legacy_mines

    # Гарантируем, что базовые ключи всегда присутствуют
    for name in ("roulette", "cases", "rocket", "limited_gifts", "pvp"):
        flags.setdefault(name, True)

    return flags


async def set_feature_flag(name: str, enabled: bool) -> None:
    """
    name — например 'roulette', 'cases', 'rocket', 'limited_gifts', 'case_3'.
    """
    await _set(f"feature_flag_{name}", "1" if enabled else "0")


# ── Beta Testers ──────────────────────────────────────────────────────────────

async def init_beta_testers_table():
    """Создаёт таблицу beta_testers, если её ещё нет."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS beta_testers (
                user_id BIGINT PRIMARY KEY,
                added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()
        # Миграция: если колонка была создана как INTEGER — расширяем до BIGINT
        try:
            await db.execute(
                "ALTER TABLE beta_testers ALTER COLUMN user_id TYPE BIGINT"
            )
            await db.commit()
        except Exception:
            pass  # колонка уже BIGINT или БД не поддерживает ALTER COLUMN


async def add_beta_tester(user_id: int) -> bool:
    """
    Добавляет пользователя в список beta-тестеров.
    Возвращает True если добавлен, False если уже существует.
    """
    async with aiosqlite.connect(DB_NAME) as db:
        try:
            await db.execute(
                "INSERT INTO beta_testers (user_id) VALUES (?)", (user_id,)
            )
            await db.commit()
            return True
        except aiosqlite.IntegrityError:
            return False


async def remove_beta_tester(user_id: int) -> bool:
    """
    Удаляет пользователя из списка beta-тестеров.
    Возвращает True если удалён, False если не найден.
    """
    async with aiosqlite.connect(DB_NAME) as db:
        cur = await db.execute(
            "DELETE FROM beta_testers WHERE user_id = ?", (user_id,)
        )
        await db.commit()
        return cur.rowcount > 0


async def get_beta_testers() -> list[dict]:
    """Возвращает список всех beta-тестеров с датой добавления."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT user_id, added_at FROM beta_testers ORDER BY added_at"
        ) as cur:
            rows = await cur.fetchall()
    return [{"user_id": r[0], "added_at": r[1]} for r in rows]


async def is_beta_tester(user_id: int) -> bool:
    """Проверяет, входит ли пользователь в список beta-тестеров."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT 1 FROM beta_testers WHERE user_id = ?", (user_id,)
        ) as cur:
            row = await cur.fetchone()
    return row is not None
    
async def get_exchange_bonus_percent() -> float:
    """Возвращает бонус-процент при обмене подарков на звёзды (по умолчанию 10%)."""
    val = await _get("exchange_bonus_percent", "10")
    try:
        return float(val)
    except (ValueError, TypeError):
        return 10.0

async def set_exchange_bonus_percent(percent: float) -> None:
    """Сохраняет бонус-процент при обмене подарков на звёзды."""
    await _set("exchange_bonus_percent", str(percent))
