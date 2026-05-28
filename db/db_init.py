# db_init.py
# Инициализация базы данных: создание таблиц и безопасные миграции.
# Вызывается один раз при старте приложения.
#
# PostgreSQL-only. Используется ADD COLUMN IF NOT EXISTS вместо try/except,
# что корректно работает в транзакциях PostgreSQL (и не требует SAVEPOINT).

from db import db_async as aiosqlite
from db.db_core import DB_NAME


async def init_db():
    async with aiosqlite.connect(DB_NAME) as db:
        # Telegram user IDs могут превышать 2 147 483 647 (макс. для INTEGER).
        # Все колонки, хранящие tg_id / user_id / referrer_id, должны быть BIGINT.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                tg_id       BIGINT PRIMARY KEY,
                username    TEXT,
                first_name  TEXT,
                photo_url   TEXT,
                balance     FLOAT8  DEFAULT 0,
                stars       INTEGER DEFAULT 0,
                referrer_id BIGINT  DEFAULT NULL,
                last_free_spin INTEGER DEFAULT 0
            )
        """)

        # Миграция типа для существующих баз (CREATE TABLE IF NOT EXISTS
        # не меняет типы уже существующих колонок).
        await db.execute("ALTER TABLE users ALTER COLUMN tg_id TYPE BIGINT")
        await db.execute("ALTER TABLE users ALTER COLUMN referrer_id TYPE BIGINT")
        # Migrate balance to FLOAT8 — PostgreSQL INTEGER rounds fractions (e.g. 0.5→1, 0.1→0)
        await db.execute("ALTER TABLE users ALTER COLUMN balance TYPE FLOAT8")

        # Безопасное добавление колонок для уже существующих баз.
        # ADD COLUMN IF NOT EXISTS поддерживается в PostgreSQL 9.6+
        # и не ломает транзакцию при повторном запуске в отличие от try/except.
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS balance FLOAT8 DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS stars INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_id BIGINT DEFAULT NULL")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_free_spin INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notified_free_spin INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_gift_withdraw INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notified_gift_withdraw INTEGER DEFAULT 1")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_gift_claim INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notified_gift_claim INTEGER DEFAULT 1")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_free_case INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS notified_free_case INTEGER DEFAULT 1")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_notified_free_spin INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_notified_free_case INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_anonymous INTEGER DEFAULT 0")
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS hide_username INTEGER DEFAULT 0")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_gifts (
                user_id BIGINT,
                gift_id INTEGER,
                amount  INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, gift_id)
            )
        """)
        await db.execute("ALTER TABLE user_gifts ALTER COLUMN user_id TYPE BIGINT")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_tasks (
                user_id BIGINT,
                task_id INTEGER,
                PRIMARY KEY (user_id, task_id)
            )
        """)
        await db.execute("ALTER TABLE user_tasks ALTER COLUMN user_id TYPE BIGINT")

        # id использует BIGSERIAL вместо INTEGER AUTOINCREMENT (SQLite-специфичный синтаксис).
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_history (
                id          BIGSERIAL PRIMARY KEY,
                user_id     BIGINT NOT NULL,
                action_type TEXT   NOT NULL,
                description TEXT   NOT NULL,
                amount      FLOAT8 NOT NULL,
                created_at  INTEGER NOT NULL
            )
        """)
        await db.execute("ALTER TABLE user_history ALTER COLUMN user_id TYPE BIGINT")
        # Migrate amount to FLOAT8 so fractional donut values are stored correctly
        await db.execute("ALTER TABLE user_history ALTER COLUMN amount TYPE FLOAT8")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS promo_codes (
                code         TEXT    PRIMARY KEY,
                reward_type  TEXT    NOT NULL,
                reward_value FLOAT8  NOT NULL DEFAULT 0,
                case_id      INTEGER DEFAULT NULL,
                max_uses     INTEGER NOT NULL DEFAULT 1,
                uses_left    INTEGER NOT NULL DEFAULT 1,
                created_by   BIGINT  DEFAULT NULL,
                created_at   INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute("ALTER TABLE promo_codes ALTER COLUMN created_by TYPE BIGINT")
        # Migrate reward_value to FLOAT8 to support fractional donut amounts (e.g. 0.1)
        await db.execute("ALTER TABLE promo_codes ALTER COLUMN reward_value TYPE FLOAT8")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS promo_redemptions (
                user_id     BIGINT  NOT NULL,
                code        TEXT    NOT NULL,
                redeemed_at INTEGER NOT NULL,
                PRIMARY KEY (user_id, code)
            )
        """)
        await db.execute("ALTER TABLE promo_redemptions ALTER COLUMN user_id TYPE BIGINT")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_promo_cases (
                user_id BIGINT  NOT NULL,
                case_id INTEGER NOT NULL,
                amount  INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, case_id)
            )
        """)
        await db.execute("ALTER TABLE user_promo_cases ALTER COLUMN user_id TYPE BIGINT")

        # ── Пити-система: счётчики для кейсов и рулетки ─────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_pity (
                tg_id          BIGINT  NOT NULL,
                game_key       TEXT    NOT NULL,
                pity_count     INTEGER NOT NULL DEFAULT 0,
                cooldown_count INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (tg_id, game_key)
            )
        """)
        # Безопасная миграция типов для существующих баз.
        await db.execute("ALTER TABLE user_pity ALTER COLUMN tg_id TYPE BIGINT")

        # ── Идемпотентность платежей ─────────────────────────────────────────
        # Хранит уникальный charge_id каждого обработанного платежа Telegram.
        # Предотвращает повторное начисление звёзд при ретраях вебхука
        # или повторной доставке одного и того же события successful_payment.
        await db.execute("""
            CREATE TABLE IF NOT EXISTS processed_payments (
                charge_id  TEXT    PRIMARY KEY,
                user_id    BIGINT  NOT NULL,
                stars      INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
        """)

        # ── Отслеживание инвойсов ────────────────────────────────────────────
        # Каждый созданный инвойс регистрируется здесь со статусом 'pending'.
        # При создании нового инвойса для пользователя все его предыдущие
        # pending-инвойсы переводятся в 'cancelled'.
        # Это исключает оплату нескольких «висящих» инвойсов одного пользователя.
        #
        # Статусы:
        #   pending   — инвойс создан, ждёт оплаты
        #   paid      — оплачен, звёзды начислены
        #   cancelled — аннулирован (создан новый инвойс или истёк)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS pending_invoices (
                payment_uuid TEXT    PRIMARY KEY,
                user_id      BIGINT  NOT NULL,
                stars        INTEGER NOT NULL,
                status       TEXT    NOT NULL DEFAULT 'pending',
                created_at   INTEGER NOT NULL
            )
        """)

        # ── Состояние раундов игр (PvP, Ракета) ─────────────────────────────────
        # Хранит round_id, last_game и best_game между деплоями.
        # game: 'pvp' | 'rocket'
        await db.execute("""
            CREATE TABLE IF NOT EXISTS pvp_game_history (
                id                     BIGSERIAL PRIMARY KEY,
                round_id               BIGINT  NOT NULL DEFAULT 0,
                winner_id              BIGINT  NOT NULL,
                winner_name            TEXT    NOT NULL DEFAULT '',
                winner_avatar          TEXT    NOT NULL DEFAULT '',
                player_count           INTEGER NOT NULL DEFAULT 2,
                total_stars            BIGINT  NOT NULL DEFAULT 0,
                total_donuts           REAL    NOT NULL DEFAULT 0.0,
                gifts_count            INTEGER NOT NULL DEFAULT 0,
                total_value_stars      BIGINT  NOT NULL DEFAULT 0,
                winner_bet_value_stars REAL    NOT NULL DEFAULT 0.0,
                multiplier             REAL    NOT NULL DEFAULT 1.0,
                created_at             BIGINT  NOT NULL DEFAULT 0
            )
        """)
        # Миграция для существующих баз: расширяем до BIGINT, чтобы
        # Telegram user_id (> 2 147 483 647) и большие значения звёзд
        # не вызывали «integer out of range».
        await db.execute("ALTER TABLE pvp_game_history ALTER COLUMN winner_id TYPE BIGINT")
        await db.execute("ALTER TABLE pvp_game_history ALTER COLUMN round_id TYPE BIGINT")
        await db.execute("ALTER TABLE pvp_game_history ALTER COLUMN total_stars TYPE BIGINT")
        await db.execute("ALTER TABLE pvp_game_history ALTER COLUMN total_value_stars TYPE BIGINT")
        await db.execute("ALTER TABLE pvp_game_history ALTER COLUMN created_at TYPE BIGINT")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS game_round_state (
                game       TEXT    PRIMARY KEY,
                round_id   BIGINT  NOT NULL DEFAULT 0,
                last_game  TEXT    DEFAULT NULL,
                best_game  TEXT    DEFAULT NULL,
                updated_at INTEGER NOT NULL DEFAULT 0
            )
        """)
        # Миграция round_id в game_round_state.
        await db.execute("ALTER TABLE game_round_state ALTER COLUMN round_id TYPE BIGINT")
        await db.execute("ALTER TABLE game_round_state ADD COLUMN IF NOT EXISTS last_game TEXT DEFAULT NULL")
        await db.execute("ALTER TABLE game_round_state ADD COLUMN IF NOT EXISTS best_game TEXT DEFAULT NULL")
        # Полное состояние активного раунда (игроки, ставки, таймеры) —
        # позволяет пережить рестарт без потери данных игроков.
        await db.execute("ALTER TABLE game_round_state ADD COLUMN IF NOT EXISTS round_state TEXT DEFAULT NULL")

        await db.commit()


async def init_rocket_games_table():
    """Создаёт таблицу для хранения активных ракетных игр в БД."""
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rocket_active_games (
                user_id     BIGINT  PRIMARY KEY,
                bet         FLOAT8  NOT NULL,
                currency    TEXT    NOT NULL DEFAULT 'donuts',
                crash_point REAL    NOT NULL,
                pool_amount FLOAT8  NOT NULL DEFAULT 0,
                created_at  INTEGER NOT NULL
            )
        """)
        await db.execute("ALTER TABLE rocket_active_games ALTER COLUMN user_id TYPE BIGINT")
        await db.execute("ALTER TABLE rocket_active_games ALTER COLUMN bet TYPE FLOAT8")
        await db.execute("ALTER TABLE rocket_active_games ALTER COLUMN pool_amount TYPE FLOAT8")

        # Магазин: учёт использованных рефералов для акций
        await db.execute("""
            CREATE TABLE IF NOT EXISTS shop_referral_purchases (
                id           BIGSERIAL PRIMARY KEY,
                user_id      BIGINT  NOT NULL,
                item_id      TEXT    NOT NULL,
                purchased_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
            )
        """)
        # Магазин: общий учёт покупок для проверки buy_limit
        await db.execute("""
            CREATE TABLE IF NOT EXISTS shop_item_purchases (
                id           BIGSERIAL PRIMARY KEY,
                user_id      BIGINT  NOT NULL,
                item_id      TEXT    NOT NULL,
                purchased_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
            )
        """)

        # ── NFT Галерея ───────────────────────────────────────────────────────
        # ADD COLUMN IF NOT EXISTS не ломает транзакцию при повторном запуске
        await db.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS nft_stars INTEGER DEFAULT 0")

        await db.execute("""
            CREATE TABLE IF NOT EXISTS nft_paintings (
                id           BIGSERIAL PRIMARY KEY,
                title        TEXT    NOT NULL,
                description  TEXT    DEFAULT '',
                image_url    TEXT    NOT NULL,
                price        INTEGER NOT NULL,
                total_supply INTEGER DEFAULT 0,
                sold_count   INTEGER DEFAULT 0,
                is_active    BOOLEAN DEFAULT TRUE,
                created_at   INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
            )
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS nft_owned (
                id          BIGSERIAL PRIMARY KEY,
                user_id     BIGINT  NOT NULL,
                painting_id BIGINT  NOT NULL,
                acquired_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),
                UNIQUE (user_id, painting_id)
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_nft_owned_user ON nft_owned (user_id)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_nft_owned_painting ON nft_owned (painting_id)"
        )

        # Migration: add serial_number to nft_owned (unique copy number per painting)
        await db.execute("""
            ALTER TABLE nft_owned ADD COLUMN IF NOT EXISTS serial_number INTEGER DEFAULT 0
        """)

        # Migration: allow multiple copies of the same painting per user
        await db.execute("""
            ALTER TABLE nft_owned DROP CONSTRAINT IF EXISTS nft_owned_user_id_painting_id_key
        """)

        # Migration: add ref_id to user_history (links nft_buy entries to painting)
        await db.execute("""
            ALTER TABLE user_history ADD COLUMN IF NOT EXISTS ref_id BIGINT DEFAULT NULL
        """)


        # ── NFT owned: поле статуса ('held' | 'for_sale' | 'in_auction') ──────
        await db.execute("""
            ALTER TABLE nft_owned ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'held'
        """)

        # ── Маркетплейс (фиксированная цена) ─────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS nft_market_listings (
                id           BIGSERIAL PRIMARY KEY,
                seller_id    BIGINT  NOT NULL,
                nft_owned_id BIGINT  NOT NULL,
                painting_id  BIGINT  NOT NULL,
                price        INTEGER NOT NULL,
                status       TEXT    NOT NULL DEFAULT 'active',
                buyer_id     BIGINT  DEFAULT NULL,
                created_at   INTEGER NOT NULL,
                sold_at      INTEGER DEFAULT NULL
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_nft_listings_status ON nft_market_listings (status)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_nft_listings_seller ON nft_market_listings (seller_id)"
        )

        # ── Аукционы ─────────────────────────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS nft_auctions (
                id              BIGSERIAL PRIMARY KEY,
                seller_id       BIGINT  NOT NULL,
                nft_owned_id    BIGINT  NOT NULL,
                painting_id     BIGINT  NOT NULL,
                start_price     INTEGER NOT NULL,
                current_price   INTEGER NOT NULL,
                current_bidder  BIGINT  DEFAULT NULL,
                status          TEXT    NOT NULL DEFAULT 'active',
                ends_at         INTEGER NOT NULL,
                created_at      INTEGER NOT NULL,
                ended_at        INTEGER DEFAULT NULL
            )
        """)
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_nft_auctions_status "
            "ON nft_auctions (status, ends_at)"
        )
        await db.execute(
            "CREATE INDEX IF NOT EXISTS idx_nft_auctions_seller ON nft_auctions (seller_id)"
        )

        # ── NFT Паки (коллекции картин) ───────────────────────────────────────
        await db.execute("""
            CREATE TABLE IF NOT EXISTS nft_packs (
                id              BIGSERIAL PRIMARY KEY,
                name            TEXT    NOT NULL,
                description     TEXT    DEFAULT '',
                cover_image_url TEXT    DEFAULT '',
                is_active       BOOLEAN DEFAULT TRUE,
                created_at      INTEGER NOT NULL DEFAULT 0
            )
        """)
        await db.execute("""
            ALTER TABLE nft_paintings ADD COLUMN IF NOT EXISTS pack_id BIGINT DEFAULT NULL
        """)

        # ── Архивация паков (все картины распроданы) ──────────────────────────
        await db.execute("""
            ALTER TABLE nft_packs ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE
        """)
        await db.execute("""
            ALTER TABLE nft_packs ADD COLUMN IF NOT EXISTS archived_at INTEGER DEFAULT NULL
        """)

        # ── Стабильный каталожный идентификатор ───────────────────────────────
        # catalog_id — строковый ключ из nft_catalog.py (поле "id").
        # Используется для поиска записи вместо name / title, что позволяет
        # свободно переименовывать паки и картины без создания дублей.
        await db.execute("""
            ALTER TABLE nft_packs ADD COLUMN IF NOT EXISTS catalog_id TEXT DEFAULT NULL
        """)
        await db.execute("""
            ALTER TABLE nft_paintings ADD COLUMN IF NOT EXISTS catalog_id TEXT DEFAULT NULL
        """)
        # Уникальный индекс — предотвращает случайное дублирование catalog_id.
        # NULLS NOT DISTINCT не поддерживается в старых PG; используем частичный
        # индекс (WHERE catalog_id IS NOT NULL), который игнорирует NULL-строки.
        await db.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_nft_packs_catalog_id
            ON nft_packs (catalog_id)
            WHERE catalog_id IS NOT NULL
        """)
        await db.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_nft_paintings_catalog_id
            ON nft_paintings (catalog_id)
            WHERE catalog_id IS NOT NULL
        """)

        await db.commit()