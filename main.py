import asyncio
import os
import time
import uvicorn

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse, Response
from aiogram.types import Update
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from db import db_async as aiosqlite
from db.db_async import init_pool, close_pool
import config
import database
from routers import users, gifts, games, tasks, bank
from routers import tg_shop
from routers import shop
from routers import nft
from routers import nft_market
from db.db_core import DB_NAME

# Секрет для верификации webhook-запросов от Telegram.
# Установи переменную окружения WEBHOOK_SECRET на Railway.
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")


# ── Rate Limiter (SQLite-backed, multi-process safe) ──────────────────────────
#
# Хранит временны́е метки запросов в таблице rate_limit_log.
# В отличие от in-memory dict, работает корректно при нескольких
# воркерах uvicorn или нескольких инстансах приложения.
#
# Схема: (ip TEXT, path_prefix TEXT, ts INTEGER)
# Индекс по (ip, path_prefix, ts) делает очистку устаревших записей быстрой.
#
# ВАЖНО: все игровые роуты доступны исключительно через /api/... (games.router).
# Прямые дубли /roulette/... и /cases/... удалены — лимиты охватывают
# единственный канонический путь для каждого эндпоинта.

# (путь_prefix, max_requests, window_seconds)
RATE_LIMITS: list[tuple[str, int, int]] = [
    ("/api/init",              30, 60),
    ("/api/topup/stars",       10, 60),
    # ── Рулетка ──────────────────────────────────────────────────────────────
    ("/api/roulette/spin",     20, 60),
    # ── Ракета ───────────────────────────────────────────────────────────────
    ("/api/rocket/bet",        20, 60),
    ("/api/rocket/cashout",    20, 60),
    # ── Кейсы ────────────────────────────────────────────────────────────────
    ("/api/cases/open",        15, 60),   # платный кейс
    ("/api/cases/open_promo",  10, 60),   # промо-кейс
    ("/api/cases/open_free",    5, 60),   # бесплатный (доп. защита, cooldown в логике)
    # ── Подарки / вывод ──────────────────────────────────────────────────────
    ("/api/gifts/claim",       10, 60),
    ("/api/gifts/withdraw",     5, 60),
    ("/api/withdraw",           5, 60),
    ("/api/claim",             10, 60),
    ("/api/tg_shop/buy",        5, 60),
    ("/api/shop/buy",           5, 60),
]


async def _init_rate_limit_table():
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS rate_limit_log (
                ip          TEXT    NOT NULL,
                path_prefix TEXT    NOT NULL,
                ts          INTEGER NOT NULL
            )
        """)
        await db.execute("""
            CREATE INDEX IF NOT EXISTS idx_rate_limit
            ON rate_limit_log (ip, path_prefix, ts)
        """)
        await db.commit()


async def _check_rate_limit_db(ip: str, path: str) -> bool:
    """
    Скользящее окно через SQLite.
    Возвращает True если запрос разрешён, False если лимит превышен.

    ИСПРАВЛЕНИЕ race condition: INSERT вставляется первым (безусловно),
    затем в той же транзакции считается итоговое число записей в окне.
    Если лимит превышен — транзакция откатывается, запись не сохраняется.
    Это гарантирует атомарность: два одновременных запроса не могут оба
    пройти проверку прежде чем один из них зафиксирует свою запись.
    """
    now = int(time.time())
    for prefix, max_req, window in RATE_LIMITS:
        if not path.startswith(prefix):
            continue

        cutoff = now - window
        async with aiosqlite.connect(DB_NAME) as db:
            # Шаг 1: вставляем запись ДО проверки счётчика.
            await db.execute(
                "INSERT INTO rate_limit_log (ip, path_prefix, ts) VALUES (?, ?, ?)",
                (ip, prefix, now),
            )
            # Шаг 2: считаем все записи в окне, включая только что вставленную.
            async with db.execute(
                "SELECT COUNT(*) FROM rate_limit_log WHERE ip = ? AND path_prefix = ? AND ts > ?",
                (ip, prefix, cutoff),
            ) as cur:
                row = await cur.fetchone()
            count = row[0] if row else 1

            if count > max_req:
                # Лимит превышен — откат, вставка не фиксируется.
                await db.rollback()
                return False

            # Чистим устаревшие записи этого ключа, фиксируем вставку.
            await db.execute(
                "DELETE FROM rate_limit_log WHERE ip = ? AND path_prefix = ? AND ts <= ?",
                (ip, prefix, cutoff),
            )
            await db.commit()
        return True

    return True


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Пул соединений инициализируется первым — все последующие вызовы БД его используют.
    # min_size=5: 5 соединений всегда открыты и готовы.
    # max_size=20: при пиковой нагрузке пул расширяется до 20 соединений.
    await init_pool(DB_NAME, min_size=5, max_size=20)

    rocket_task = None
    pvp_task    = None

    try:
        await database.init_db()
        await database.init_bank()
        await database.init_rocket_games_table()
        await database.init_settings_table()
        await database.init_beta_testers_table()
        await _init_rate_limit_table()

        # Синхронизация NFT-каталога: все картины из nft_catalog.py
        # автоматически появляются в магазине при каждом запуске.
        from db.db_nft import sync_catalog
        from nft_catalog import PAINTINGS
        await sync_catalog(PAINTINGS)

        print("Инициализация обновления цен подарков (API Portals)...")
        config.update_base_gifts_prices()

        # ── Боты (webhook-режим) ───────────────────────────────────────────────
        from bot import bot as main_bot, dp as main_dp, setup_handlers as setup_main
        from support_bot import support_bot, support_dp, setup_handlers as setup_support
        from handlers.workers import (
            roulette_reminder_worker,
            gift_claim_reminder_worker,
            gift_withdraw_reminder_worker,
            free_case_reminder_worker,
            price_update_worker,
            leaderboard_season_reset_worker,
        )

        setup_main()
        setup_support()

        # Фоновые задачи бота (напоминания, воркеры)
        asyncio.create_task(roulette_reminder_worker(main_bot))
        asyncio.create_task(gift_claim_reminder_worker(main_bot))
        asyncio.create_task(gift_withdraw_reminder_worker(main_bot))
        asyncio.create_task(free_case_reminder_worker(main_bot))
        asyncio.create_task(price_update_worker())
        asyncio.create_task(leaderboard_season_reset_worker(main_bot))

        # Регистрация webhook-адресов в Telegram
        webhook_base = config.WEBAPP_URL.rstrip("/")

        if webhook_base.startswith("https://"):
            try:
                secret = WEBHOOK_SECRET or None
                await main_bot.set_webhook(
                    url=f"{webhook_base}/webhook/main",
                    secret_token=secret,
                    drop_pending_updates=True,
                )
                await support_bot.set_webhook(
                    url=f"{webhook_base}/webhook/support",
                    secret_token=secret,
                    drop_pending_updates=True,
                )
                print(f"✅ Webhooks зарегистрированы: {webhook_base}/webhook/main, /webhook/support")
            except Exception as e:
                print(f"⚠️ Не удалось зарегистрировать webhook: {e}")
                print("⚠️ Бот работает без webhook — обновите WEBAPP_URL на рабочий публичный адрес")
        else:
            print("⚠️ Локальный режим: webhook пропущен, потому что WEBAPP_URL не https://")

        # Запускаем менеджер общих раундов ракеты
        from routers.games_rocket import round_manager
        rocket_task = asyncio.create_task(round_manager())
        print("✅ Менеджер раундов ракеты запущен")

        # Запускаем менеджер раундов PvP
        from routers.games_pvp import pvp_round_manager
        pvp_task = asyncio.create_task(pvp_round_manager())
        print("✅ Менеджер раундов PvP запущен")

        yield

    finally:
        if rocket_task is not None:
            rocket_task.cancel()
            try:
                await rocket_task
            except asyncio.CancelledError:
                pass

        if pvp_task is not None:
            pvp_task.cancel()
            try:
                await pvp_task
            except asyncio.CancelledError:
                pass

        # Снимаем webhooks и закрываем сессии ботов
        try:
            from bot import bot as main_bot
            from support_bot import support_bot
            await main_bot.delete_webhook()
            await support_bot.delete_webhook()
            await main_bot.session.close()
            await support_bot.session.close()
        except Exception:
            pass

        await close_pool()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(lifespan=lifespan)

origins = [
    config.WEBAPP_URL.rstrip("/"),
    "http://localhost",
    "http://127.0.0.1:8080",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    ip   = request.client.host if request.client else "unknown"
    path = request.url.path
    if not await _check_rate_limit_db(ip, path):
        return JSONResponse(
            status_code=429,
            content={"detail": "Слишком много запросов. Подождите немного."},
        )
    return await call_next(request)


# ── Maintenance Mode Middleware ───────────────────────────────────────────────

# Эти пути разрешены даже в режиме тех. обслуживания
_MAINTENANCE_WHITELIST = {"/", "/api/features", "/api/shop/config", "/api/shop/referrals"}


def _extract_user_id_unsafe(init_data: str | None) -> int | None:
    """
    Пытается извлечь user_id из Telegram InitData без проверки HMAC.
    Используется ТОЛЬКО в middleware для быстрой проверки beta-тестеров —
    полная валидация подписи всё равно произойдёт в get_current_user().
    Возвращает None при любой ошибке.
    """
    if not init_data:
        return None
    try:
        import json
        from urllib.parse import parse_qsl
        parsed = dict(parse_qsl(init_data, keep_blank_values=True))
        user = json.loads(parsed.get("user", "{}"))
        uid = user.get("id")
        return int(uid) if uid else None
    except Exception:
        return None


@app.middleware("http")
async def maintenance_middleware(request: Request, call_next):
    path = request.url.path
    # Разрешаем статические файлы, шаблоны и белый список API
    if (
        path.startswith("/static")
        or path.startswith("/gifts")
        or path.startswith("/partials")
        or path.startswith("/webhook")   # webhook-запросы от Telegram всегда пропускаем
        or path in _MAINTENANCE_WHITELIST
    ):
        return await call_next(request)

    if await database.get_maintenance_mode():
        # Проверяем, является ли пользователь beta-тестером.
        # Полная HMAC-валидация произойдёт в самом роутере — здесь нам
        # достаточно знать user_id, чтобы пропустить запрос через maintenance.
        init_data = request.headers.get("x-tg-data")
        user_id = _extract_user_id_unsafe(init_data)
        if user_id and await database.is_beta_tester(user_id):
            return await call_next(request)

        return JSONResponse(
            status_code=503,
            content={"detail": "maintenance", "message": "Технический перерыв. Следите за обновлениями в @Space_Donut"},
        )
    return await call_next(request)


# ── Static & templates ────────────────────────────────────────────────────────

os.makedirs("gifts",     exist_ok=True)
os.makedirs("static",    exist_ok=True)
os.makedirs("partials",  exist_ok=True)
os.makedirs("templates", exist_ok=True)

app.mount("/gifts",    StaticFiles(directory="gifts"),    name="gifts")
app.mount("/static",   StaticFiles(directory="static"),   name="static")
app.mount("/partials", StaticFiles(directory="partials"), name="partials")

templates = Jinja2Templates(directory="templates")


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(users.router)
app.include_router(gifts.router)
# games.router монтирует все игры под /api: /api/roulette, /api/rocket, /api/cases
# Прямые дубли games_roulette.router и games_cases.router намеренно убраны —
# иначе те же эндпоинты появятся на /roulette/* и /cases/* без rate limiting.
app.include_router(games.router)
app.include_router(tasks.router)
app.include_router(bank.router)
app.include_router(tg_shop.router)
app.include_router(shop.router)
app.include_router(nft.router)
app.include_router(nft_market.router)


# ── Webhook endpoints для Telegram ───────────────────────────────────────────

def _verify_webhook_secret(request: Request) -> bool:
    """Проверяет X-Telegram-Bot-Api-Secret-Token если WEBHOOK_SECRET задан."""
    if not WEBHOOK_SECRET:
        return True
    return request.headers.get("X-Telegram-Bot-Api-Secret-Token", "") == WEBHOOK_SECRET


@app.post("/webhook/main")
async def webhook_main(request: Request):
    if not _verify_webhook_secret(request):
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    from bot import bot as main_bot, dp as main_dp
    update = Update.model_validate(await request.json())
    await main_dp.feed_update(bot=main_bot, update=update)
    return Response()


@app.post("/webhook/support")
async def webhook_support(request: Request):
    if not _verify_webhook_secret(request):
        return JSONResponse(status_code=403, content={"error": "Forbidden"})
    from support_bot import support_bot, support_dp
    update = Update.model_validate(await request.json())
    await support_dp.feed_update(bot=support_bot, update=update)
    return Response()


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    from fastapi.responses import FileResponse
    return FileResponse("static/favicon.ico")


@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse(
    request=request,
    name="index.html",
    context={"request": request}
    )



# ── Entrypoint ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # reload=False для продакшена — иначе воркеры не шарят состояние и памяти
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 5000)))