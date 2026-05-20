# config.py
import os
import time
import requests
import cloudscraper  # <-- Библиотека для обхода Cloudflare
from dotenv import load_dotenv

# Загружаем переменные из .env файла
load_dotenv()

# Безопасное получение токена
BOT_TOKEN = os.getenv("BOT_TOKEN")
if not BOT_TOKEN:
    raise ValueError("BOT_TOKEN не найден в переменных окружения (.env)!")

BOT_USERNAME = os.getenv("BOT_USERNAME")

# Канал на который нужно быть подписаным для игры в рулетку и открытия кейсов
REQUIRED_CHANNEL     = "@Space_Donut"
REQUIRED_CHANNEL_URL = "https://t.me/Space_Donut"
if not BOT_USERNAME:
    raise ValueError("BOT_USERNAME не найден в переменных окружения (.env)!") 

WEBAPP_URL = os.getenv("WEBAPP_URL")
if not WEBAPP_URL:
    raise ValueError("WEBAPP_URL не найден в переменных окружения (.env)!") 

_ADMIN_ID_RAW = os.getenv("ADMIN_ID")
if not _ADMIN_ID_RAW:
    raise ValueError("ADMIN_ID не найден в переменных окружения (.env)!")
try:
    ADMIN_ID: int = int(_ADMIN_ID_RAW)
except ValueError:
    raise ValueError("ADMIN_ID должен быть целым числом (Telegram user_id)!")

# ── Курс конвертации валют для банка ─────────────────────────────────────────
# 1 пончик = 1 TON.  Поэтому базовый курс пончик→звёзды равен TON→Stars.
# games_pvp.py при запуске использует живой курс CoinGecko; это значение
# применяется только как статический фолбэк (обновляйте вместе с TON_TO_STARS_FALLBACK).
DONUTS_TO_STARS_RATE: int = 200  # = TON_TO_STARS_FALLBACK

# ── Бонус при обмене подарков на звёзды ──────────────────────────────────────
# Сколько процентов сверх рыночной цены (Portal Market) получает пользователь.
# Изменяется командой /setexchangebonus <процент> в боте (сохраняется в БД).
# Значение здесь используется только как внутренний базовый множитель
# для MAIN_GIFTS (у которых нет портальной цены).
GIFT_EXCHANGE_STARS_RATE: float = 1.0   # базовый множитель для MAIN_GIFTS
EXCHANGE_BONUS_PERCENT: float   = 10.0  # +10% к рыночной цене по умолчанию

# Фоллбэк курса TON→Stars (используется если CoinGecko недоступен).
# Обновляйте вручную при существенном изменении курса TON.
TON_TO_STARS_FALLBACK: float = 200.0

# ── Живой курс TON → Stars (для лидербордов) ─────────────────────────────────
# Кэш обновляется раз в 5 минут. Используется вместо статического
# DONUTS_TO_STARS_RATE во всех функциях расчёта лидербордов.
_ton_stars_live_cache: dict = {"rate": 0.0, "ts": 0.0}
_TON_STARS_LIVE_CACHE_TTL: float = 300.0   # 5 минут
_STAR_USD_PRICE: float = 0.013             # официальный курс Telegram: 1 Star ≈ $0.013


async def get_live_donuts_to_stars_rate() -> float:
    """Возвращает актуальный курс 1 TON (= 1 пончик) → Stars.

    Алгоритм:
      • Запрашивает цену TONUSDT у Binance Public API.
      • Делит на стоимость одной звезды ($0.013) → количество Stars за 1 TON.
      • Результат кэшируется на 5 минут.
      • При любой ошибке возвращает TON_TO_STARS_FALLBACK (200).
    """
    import httpx  # импортируем здесь, чтобы не ломать синхронный старт config.py

    global _ton_stars_live_cache
    now = time.time()
    if (
        _ton_stars_live_cache["rate"] > 0
        and now - _ton_stars_live_cache["ts"] < _TON_STARS_LIVE_CACHE_TTL
    ):
        return _ton_stars_live_cache["rate"]

    try:
        async with httpx.AsyncClient(timeout=6) as client:
            resp = await client.get(
                "https://api.binance.com/api/v3/ticker/price",
                params={"symbol": "TONUSDT"},
            )
            if resp.status_code == 200:
                ton_usd = float(resp.json()["price"])
                rate = ton_usd / _STAR_USD_PRICE
                _ton_stars_live_cache["rate"] = rate
                _ton_stars_live_cache["ts"] = now
                return rate
    except Exception as e:
        print(f"[Leaderboard rate] Binance error: {e}")

    return TON_TO_STARS_FALLBACK

# Комиссия за вывод подарка в звездах
WITHDRAW_FEE_STARS = 25

# ==========================================
# РЕЖИМ ТЕХНИЧЕСКОГО ОБСЛУЖИВАНИЯ
# ==========================================
# True — все пользователи видят экран "тех. перерыв", ничего не работает.
# Включается командой /maintenance on, выключается /maintenance off
MAINTENANCE_MODE: bool = False

# ==========================================
# ФЛАГИ ВИДИМОСТИ РАЗДЕЛОВ (Feature Flags)
# ==========================================
# Каждый флаг управляет видимостью соответствующего раздела в интерфейсе.
# False — раздел полностью скрыт для всех пользователей.
# Управляется командами /hide и /show в боте.
FEATURE_FLAGS: dict = {
    "roulette": True,        # Рулетка (Колесо Фортуны)
    "cases": True,           # Все кейсы разом
    "rocket": True,          # Ракета (Crash-игра)
    "limited_gifts": True,   # TG Подарки / Лимитированные подарки
    "pvp": True,             # PvP Арена

    # Отдельные кейсы — ключ "case_<id>": True/False
    # Заполняются автоматически командами /hide case <id> и /show case <id>
}

# ==========================================
# ТРЕБОВАНИЯ ДЛЯ ВЫВОДА ПОДАРКОВ
# ==========================================
# enabled: False — отключает все требования (вывод без ограничений)
# subscriptions: список каналов, на которые нужно подписаться
# boosts: список каналов, которые нужно бустнуть/проголосовать
# referrals: сколько друзей нужно пригласить (0 = не требуется)
WITHDRAW_REQUIREMENTS = {
    "enabled": True,
    "subscriptions": [
        {
            "chat_id": "@Space_Donut",
            "title": "Подписаться на @Space_Donut",
            "url": "https://t.me/Space_Donut"
        },
        # Пример второго канала — раскомментируйте и заполните:
         {
             "chat_id": "@DewidNFT",
             "title": "Подписаться на @DewidNFT",
             "url": "https://t.me/DewidNFT"
         },
    ],
    "boosts": [
        # Пример буста — раскомментируйте и заполните:
        # {
        #     "chat_id": "@Space_Donut",
        #     "title": "Буст канала @Space_Donut",
        #     "url": "https://t.me/boost/Space_Donut"
        # },
    ],
    "referrals": 1,   # Поставьте > 0, чтобы требовать приглашений
}

# ==========================================
# ЗАДАНИЯ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ
# ==========================================
TASKS = {
    1: {
        "title":    "Подписаться на наш канал",
        "title_en": "Subscribe to our channel",
        "url": "https://t.me/Space_Donut",
        "chat_id": "@Space_Donut",
        "reward": 3,
        "reward_type": "stars",
        "type": "subscription"
    },
    2: {
        "title":    "Подписаться на Dewid NFT",
        "title_en": "Subscribe to Dewid NFT",
        "url": "https://t.me/DewidNFT",
        "chat_id": "@DewidNFT",
        "reward": 3,
        "reward_type": "stars",
        "type": "subscription"
    },
    3: {
        "title":    "Проголосовать за канал",
        "title_en": "Boost our channel",
        "url": "https://t.me/boost/Space_Donut",
        "chat_id": "@Space_Donut",
        "reward": 3,
        "reward_type": "stars",
        "type": "boost"
    },
    4: {
        "title":    "Пригласить 1 друга",
        "title_en": "Invite 1 friend",
        "url": "",
        "reward": 5,
        "reward_type": "stars",
        "type": "referral",
        "required_referrals": 1
    },
    5: {
        "title":    "Пригласить 5 друзей",
        "title_en": "Invite 5 friends",
        "url": "",
        "reward": 0.5,
        "reward_type": "donuts",
        "type": "referral",
        "required_referrals": 5
    },
    6: {
        "title":    "Пригласить 10 друзей",
        "title_en": "Invite 10 friends",
        "url": "",
        "reward": 1,
        "reward_type": "donuts", 
        "type": "referral",
        "required_referrals": 10
    }
}

# ==========================================
# НАСТРОЙКИ РУЛЕТКИ
# ==========================================
ROULETTE_CONFIG = {
    "currency": "stars", 
    "cost": 50,
    "items": [
        {"type": "stars", "amount": 1, "photo": "gifts/stars.png", "chance": 15},
        {"type": "stars", "amount": 10, "photo": "gifts/stars.png", "chance": 15},  
        {"type": "stars", "amount": 25, "photo": "gifts/stars.png", "chance": 15},
        {"type": "stars", "amount": 55, "photo": "gifts/stars.png", "chance": 30},
        {"type": "stars", "amount": 110, "photo": "gifts/stars.png", "chance": 10}, 
        {"type": "donuts", "amount": 0.5, "photo": "gifts/dount.png", "chance": 5}, 
        {"type": "donuts", "amount": 1, "photo": "gifts/dount.png", "chance": 3},
        {"type": "donuts", "amount": 2, "photo": "gifts/dount.png", "chance": 1}, 
        {"type": "gift", "gift_id": 2009, "chance": 25},
        {"type": "gift", "gift_id": 2017, "chance": 20},
        {"type": "gift", "gift_id": 2001, "chance": 1},
        {"type": "gift", "gift_id": 110, "chance": 0},
        {"type": "gift", "gift_id": 106, "chance": 0},
        {"type": "gift", "gift_id": 101, "chance": 0},
    ]
}

# ==========================================
# БЕСПЛАТНЫЙ КЕЙС (раз в 24 часа)
# ==========================================
FREE_CASE_CONFIG = {
    "name": "Free Case",
    "photo": "/gifts/freecase.png",
    "items": [
        {"type": "stars", "amount": 1,  "chance": 50},
        {"type": "stars", "amount": 2, "chance": 40},
        {"type": "stars", "amount": 4, "chance": 5},
        {"type": "stars",  "amount": 7,  "chance": 3},
        {"type": "stars",  "amount": 9,  "chance": 2},
        {"type": "stars",  "amount": 12,  "chance": 1},
        {"type": "stars",  "amount": 20,  "chance": 1},
        {"type": "stars",  "amount": 50,  "chance": 0},
        {"type": "donuts", "amount": 0.1, "chance": 1},
        {"type": "donuts", "amount": 0.5, "chance": 0},
        {"type": "gift", "gift_id": 2009, "chance": 0},
        {"type": "gift", "gift_id": 2010, "chance": 0},
        {"type": "gift", "gift_id": 2008, "chance": 0},
        {"type": "gift", "gift_id": 5, "chance": 0}
    ]
}

# ==========================================
# НАСТРОЙКИ КЕЙСОВ
# ==========================================
CASES_CONFIG = {
    1: {
        "name": "Broke Case",
        "photo": "https://cdn.changes.tg/gifts/models/Instant Ramen/png/Original.png", 
        "currency": "stars", 
        "price": 15,
        "is_new": False,
        "background": "green",
        "expires_at": None,
        "items": [
            {"type": "stars", "amount": 5, "chance": 40},
            {"type": "stars", "amount": 7, "chance": 30},
            {"type": "stars", "amount": 10, "chance": 10},
            {"type": "stars", "amount": 15, "chance": 20},
            {"type": "stars", "amount": 20, "chance": 8},
            {"type": "stars", "amount": 25, "chance": 5},
            {"type": "stars", "amount": 35, "chance": 3},
            {"type": "donuts", "amount": 0.1, "chance": 5},
            {"type": "donuts", "amount": 0.5, "chance": 2},
            {"type": "gift", "gift_id": 2009, "chance": 1},
            {"type": "gift", "gift_id": 2008, "chance": 1},
            {"type": "gift", "gift_id": 2007, "chance": 1},
            {"type": "gift", "gift_id": 8, "chance": 0},
            {"type": "gift", "gift_id": 2017, "chance": 0}
        ]
    },
    2: {
        "name": "Elite Case",
        "photo": "https://cdn.changes.tg/gifts/models/Victory Medal/png/Original.png",
        "currency": "stars",
        "price": 50,
        "is_new": False,
        "background": "purple",
        "expires_at": None,
        "items": [
            {"type": "stars", "amount": 15, "chance": 40},
            {"type": "stars", "amount": 20, "chance": 30},
            {"type": "stars", "amount": 30, "chance": 20},
            {"type": "stars", "amount": 50, "chance": 25},
            {"type": "stars", "amount": 70, "chance": 10},
            {"type": "donuts", "amount": 0.1, "chance": 7},                         
            {"type": "donuts", "amount": 0.5, "chance": 3},                         
            {"type": "donuts", "amount": 5, "chance": 1},
            {"type": "gift", "gift_id": 2008, "chance": 30},
            {"type": "gift", "gift_id": 2009, "chance": 30},
            {"type": "gift", "gift_id": 2001, "chance": 5},
            {"type": "gift", "gift_id": 2017, "chance": 10},
            {"type": "gift", "gift_id": 1, "chance": 0},
            {"type": "gift", "gift_id": 5, "chance": 0},
            {"type": "gift", "gift_id": 7, "chance": 0}
        ]
    },
    3: {
        "name": "Space Case",
        "photo": "https://cdn.changes.tg/gifts/models/Toy Bear/png/Ursa Major.png",
        "currency": "stars", 
        "price": 150,
        "is_new": False,
        "background": "purple",
        "expires_at": None,
        "items": [
            {"type": "stars", "amount": 50, "chance": 40},
            {"type": "stars", "amount": 70, "chance": 30},
            {"type": "stars", "amount": 100, "chance": 5},
            {"type": "stars", "amount": 150, "chance": 6},
            {"type": "stars", "amount": 200, "chance": 1},
            {"type": "donuts", "amount": 0.5, "chance": 10},                         
            {"type": "donuts", "amount": 1, "chance": 5},                         
            {"type": "donuts", "amount": 1.5, "chance": 4},
            {"type": "gift", "gift_id": 2008, "chance": 20},
            {"type": "gift", "gift_id": 2009, "chance": 30},
            {"type": "gift", "gift_id": 2000, "chance": 30},
            {"type": "gift", "gift_id": 2001, "chance": 10},
            {"type": "gift", "gift_id": 2002, "chance": 10},
            {"type": "gift", "gift_id": 2011, "chance": 13},
            {"type": "gift", "gift_id": 2012, "chance": 13},
            {"type": "gift", "gift_id": 2017, "chance": 13},
            {"type": "gift", "gift_id": 1, "chance": 0},
            {"type": "gift", "gift_id": 5, "chance": 0},
            {"type": "gift", "gift_id": 7, "chance": 0},
            {"type": "gift", "gift_id": 51, "chance": 0}
        ]
    },
    4: {
        "name": "NFT Case",
        "photo": "https://cdn.changes.tg/gifts/models/Durov's Cap/png/Aurora.png",
        "currency": "stars", 
        "price": 450,
        "is_new": False,
        "background": "gold",
        "expires_at": None,
        "items": [
            {"type": "gift", "gift_id": 113, "chance": 28},
            {"type": "gift", "gift_id": 114, "chance": 28},
            {"type": "gift", "gift_id": 110, "chance": 10},
            {"type": "gift", "gift_id": 94, "chance": 28},
            {"type": "gift", "gift_id": 67, "chance": 28},
            {"type": "donuts", "amount": 0.5, "chance": 37},                         
            {"type": "donuts", "amount": 1, "chance": 35},                         
            {"type": "donuts", "amount": 2, "chance": 30},
            {"type": "donuts", "amount": 2.8, "chance": 28},                         
            {"type": "donuts", "amount": 5, "chance": 9},                         
            {"type": "donuts", "amount": 9, "chance": 1},
            {"type": "gift", "gift_id": 65, "chance": 20},
            {"type": "gift", "gift_id": 39, "chance": 28},
            {"type": "gift", "gift_id": 35, "chance": 25},
            {"type": "gift", "gift_id": 29, "chance": 28},
            {"type": "gift", "gift_id": 111, "chance": 20},
            {"type": "gift", "gift_id": 100, "chance": 0},
            {"type": "gift", "gift_id": 101, "chance": 0},
            {"type": "gift", "gift_id": 105, "chance": 0},
            {"type": "gift", "gift_id": 1, "chance": 28},
            {"type": "gift", "gift_id": 5, "chance": 28},
            {"type": "gift", "gift_id": 7, "chance": 15},
            {"type": "gift", "gift_id": 2, "chance": 10},
            # --- НОВЫЕ ПОДАРКИ ---
            {"type": "gift", "gift_id": 106, "chance": 0},
            {"type": "gift", "gift_id": 107, "chance": 0},
            {"type": "gift", "gift_id": 108, "chance": 0},
            {"type": "gift", "gift_id": 102, "chance": 0},
            {"type": "gift", "gift_id": 103, "chance": 0},
            {"type": "gift", "gift_id": 95, "chance": 20},
            {"type": "gift", "gift_id": 91, "chance": 28},
            {"type": "gift", "gift_id": 83, "chance": 1},
            {"type": "gift", "gift_id": 84, "chance": 0},
            {"type": "gift", "gift_id": 55, "chance": 1},
            {"type": "gift", "gift_id": 50, "chance": 0},
            {"type": "gift", "gift_id": 51, "chance": 0},
            {"type": "gift", "gift_id": 79, "chance": 0},
            {"type": "gift", "gift_id": 78, "chance": 1},
            {"type": "gift", "gift_id": 54, "chance": 0},
            {"type": "gift", "gift_id": 44, "chance": 1},
            {"type": "gift", "gift_id": 2001, "chance": 40},
            {"type": "gift", "gift_id": 2002, "chance": 40},
            {"type": "gift", "gift_id": 2017, "chance": 35},
            {"type": "gift", "gift_id": 2018, "chance": 35},
            {"type": "stars", "amount": 200, "chance": 34},
            {"type": "stars", "amount": 350, "chance": 33},
            {"type": "stars", "amount": 500, "chance": 26}
        ]
    },
    5: {
        "name": "May Case",
        "photo": "https://cdn.changes.tg/gifts/originals/6026193266406327981/Original.png", 
        "currency": "stars", 
        "price": 10,
        "is_new": True,
        "background": "red",
        "expires_at": "2026-05-06T00:00:00",
        "items": [
            {"type": "stars", "amount": 2, "chance": 40},
            {"type": "stars", "amount": 5, "chance": 30},
            {"type": "stars", "amount": 7, "chance": 10},
            {"type": "stars", "amount": 10, "chance": 20},
            {"type": "stars", "amount": 15, "chance": 8},
            {"type": "stars", "amount": 25, "chance": 5},
            {"type": "donuts", "amount": 0.1, "chance": 5},
            {"type": "gift", "gift_id": 2009, "chance": 2},
            {"type": "gift", "gift_id": 2008, "chance": 2},
            {"type": "gift", "gift_id": 2019, "chance": 1},
            {"type": "gift", "gift_id": 51, "chance": 0}
        ]
    }
}

# ==========================================
# НАСТРОЙКИ РАКЕТЫ (CRASH ИГРА)
# ==========================================
ROCKET_CONFIG = {
    "currency": "stars",          
    "min_bet": 50,                  
    "max_bet": 10000,              
    "house_edge": 0.13,            
    "max_multiplier": 100.0,      
    "growth_speed": 1.00006        
}

# ==========================================
# БАЗОВЫЕ ПОДАРКИ
# ==========================================
BASE_GIFTS = {
    1: {"name": "Victory Medal", "photo": "https://cdn.changes.tg/gifts/models/Victory Medal/png/Original.png", "value": 4},
    2: {"name": "Desk Calendar", "photo": "https://cdn.changes.tg/gifts/models/Desk Calendar/png/Original.png", "value": 5},
    3: {"name": "Homemade Cake", "photo": "https://cdn.changes.tg/gifts/models/Homemade Cake/png/Original.png", "value": 4},
    4: {"name": "Jingle Bells", "photo": "https://cdn.changes.tg/gifts/models/Jingle Bells/png/Original.png", "value": 8},
    5: {"name": "Lol Pop", "photo": "https://cdn.changes.tg/gifts/models/Lol Pop/png/Original.png", "value": 4},
    6: {"name": "Sakura Flower", "photo": "https://cdn.changes.tg/gifts/models/Sakura Flower/png/Original.png", "value": 9},
    7: {"name": "Happy Brownie", "photo": "https://cdn.changes.tg/gifts/models/Happy Brownie/png/Original.png", "value": 4},
    8: {"name": "Instant Ramen", "photo": "https://cdn.changes.tg/gifts/models/Instant Ramen/png/Original.png", "value": 3},
    9: {"name": "Spring Basket", "photo": "https://cdn.changes.tg/gifts/models/Spring Basket/png/Original.png", "value": 4},
    10: {"name": "Input Key", "photo": "https://cdn.changes.tg/gifts/models/Input Key/png/Original.png", "value": 5},
    11: {"name": "Santa Hat", "photo": "https://cdn.changes.tg/gifts/models/Santa Hat/png/Original.png", "value": 4},
    12: {"name": "Signet Ring", "photo": "https://cdn.changes.tg/gifts/models/Signet Ring/png/Original.png", "value": 30},
    13: {"name": "Precious Peach", "photo": "https://cdn.changes.tg/gifts/models/Precious Peach/png/Original.png", "value": 380},
    14: {"name": "Spiced Wine", "photo": "https://cdn.changes.tg/gifts/models/Spiced Wine/png/Original.png", "value": 5},
    15: {"name": "Jelly Bunny", "photo": "https://cdn.changes.tg/gifts/models/Jelly Bunny/png/Original.png", "value": 7},
    16: {"name": "Eternal Rose", "photo": "https://cdn.changes.tg/gifts/models/Eternal Rose/png/Original.png", "value": 25},
    17: {"name": "Berry Box", "photo": "https://cdn.changes.tg/gifts/models/Berry Box/png/Original.png", "value": 7},
    18: {"name": "Vintage Cigar", "photo": "https://cdn.changes.tg/gifts/models/Vintage Cigar/png/Original.png", "value": 30},
    19: {"name": "Magic Potion", "photo": "https://cdn.changes.tg/gifts/models/Magic Potion/png/Original.png", "value": 75},
    20: {"name": "Kissed Frog", "photo": "https://cdn.changes.tg/gifts/models/Kissed Frog/png/Original.png", "value": 55},
    21: {"name": "Hex Pot", "photo": "https://cdn.changes.tg/gifts/models/Hex Pot/png/Original.png", "value": 4},
    22: {"name": "Evil Eye", "photo": "https://cdn.changes.tg/gifts/models/Evil Eye/png/Original.png", "value": 6},
    23: {"name": "Sharp Tongue", "photo": "https://cdn.changes.tg/gifts/models/Sharp Tongue/png/Original.png", "value": 40},
    24: {"name": "Trapped Heart", "photo": "https://cdn.changes.tg/gifts/models/Trapped Heart/png/Original.png", "value": 12},
    25: {"name": "Skull Flower", "photo": "https://cdn.changes.tg/gifts/models/Skull Flower/png/Original.png", "value": 30},
    26: {"name": "Scared Cat", "photo": "https://cdn.changes.tg/gifts/models/Scared Cat/png/Original.png", "value": 150},
    27: {"name": "Spy Agaric", "photo": "https://cdn.changes.tg/gifts/models/Spy Agaric/png/Original.png", "value": 5},
    28: {"name": "Genie Lamp", "photo": "https://cdn.changes.tg/gifts/models/Genie Lamp/png/Original.png", "value": 50},
    29: {"name": "Lunar Snake", "photo": "https://cdn.changes.tg/gifts/models/Lunar Snake/png/Original.png", "value": 4},
    30: {"name": "Party Sparkler", "photo": "https://cdn.changes.tg/gifts/models/Party Sparkler/png/Original.png", "value": 4},
    31: {"name": "Jester Hat", "photo": "https://cdn.changes.tg/gifts/models/Jester Hat/png/Original.png", "value": 4},
    32: {"name": "Witch Hat", "photo": "https://cdn.changes.tg/gifts/models/Witch Hat/png/Original.png", "value": 5},
    33: {"name": "Hanging Star", "photo": "https://cdn.changes.tg/gifts/models/Hanging Star/png/Original.png", "value": 8},
    34: {"name": "Love Candle", "photo": "https://cdn.changes.tg/gifts/models/Love Candle/png/Original.png", "value": 10},
    35: {"name": "Cookie Heart", "photo": "https://cdn.changes.tg/gifts/models/Cookie Heart/png/Original.png", "value": 5},
    36: {"name": "Snow Mittens", "photo": "https://cdn.changes.tg/gifts/models/Snow Mittens/png/Original.png", "value": 6},
    37: {"name": "Voodoo Doll", "photo": "https://cdn.changes.tg/gifts/models/Voodoo Doll/png/Original.png", "value": 25},
    38: {"name": "Mad Pumpkin", "photo": "https://cdn.changes.tg/gifts/models/Mad Pumpkin/png/Original.png", "value": 12},
    39: {"name": "Hypno Lollipop", "photo": "https://cdn.changes.tg/gifts/models/Hypno Lollipop/png/Original.png", "value": 4},
    40: {"name": "B-Day Candle", "photo": "https://cdn.changes.tg/gifts/models/B-Day Candle/png/Original.png", "value": 4},
    41: {"name": "Bunny Muffin", "photo": "https://cdn.changes.tg/gifts/models/Bunny Muffin/png/Original.png", "value": 6},
    42: {"name": "Astral Shard", "photo": "https://cdn.changes.tg/gifts/models/Astral Shard/png/Original.png", "value": 185},
    43: {"name": "Flying Broom", "photo": "https://cdn.changes.tg/gifts/models/Flying Broom/png/Original.png", "value": 10},
    44: {"name": "Crystal Ball", "photo": "https://cdn.changes.tg/gifts/models/Crystal Ball/png/Original.png", "value": 10},
    45: {"name": "Eternal Candle", "photo": "https://cdn.changes.tg/gifts/models/Eternal Candle/png/Original.png", "value": 5},
    46: {"name": "Ginger Cookie", "photo": "https://cdn.changes.tg/gifts/models/Ginger Cookie/png/Original.png", "value": 4},
    47: {"name": "Mini Oscar", "photo": "https://cdn.changes.tg/gifts/models/Mini Oscar/png/Original.png", "value": 85},
    48: {"name": "Star Notepad", "photo": "https://cdn.changes.tg/gifts/models/Star Notepad/png/Original.png", "value": 4},
    49: {"name": "Loot Bag", "photo": "https://cdn.changes.tg/gifts/models/Loot Bag/png/Original.png", "value": 150},
    50: {"name": "Love Potion", "photo": "https://cdn.changes.tg/gifts/models/Love Potion/png/Original.png", "value": 12},
    51: {"name": "Toy Bear", "photo": "https://cdn.changes.tg/gifts/models/Toy Bear/png/Original.png", "value": 40},
    52: {"name": "Diamond Ring", "photo": "https://cdn.changes.tg/gifts/models/Diamond Ring/png/Original.png", "value": 25},
    53: {"name": "Sleigh Bell", "photo": "https://cdn.changes.tg/gifts/models/Sleigh Bell/png/Original.png", "value": 8},
    54: {"name": "Top Hat", "photo": "https://cdn.changes.tg/gifts/models/Top Hat/png/Original.png", "value": 10},
    55: {"name": "Record Player", "photo": "https://cdn.changes.tg/gifts/models/Record Player/png/Original.png", "value": 11},
    56: {"name": "Winter Wreath", "photo": "https://cdn.changes.tg/gifts/models/Winter Wreath/png/Original.png", "value": 4},
    57: {"name": "Snow Globe", "photo": "https://cdn.changes.tg/gifts/models/Snow Globe/png/Original.png", "value": 4},
    58: {"name": "Electric Skull", "photo": "https://cdn.changes.tg/gifts/models/Electric Skull/png/Original.png", "value": 25},
    59: {"name": "Tama Gadget", "photo": "https://cdn.changes.tg/gifts/models/Tama Gadget/png/Original.png", "value": 4},
    60: {"name": "Candy Cane", "photo": "https://cdn.changes.tg/gifts/models/Candy Cane/png/Original.png", "value": 4},
    61: {"name": "Neko Helmet", "photo": "https://cdn.changes.tg/gifts/models/Neko Helmet/png/Original.png", "value": 35},
    62: {"name": "Jack-in-the-Box", "photo": "https://cdn.changes.tg/gifts/models/Jack-in-the-Box/png/Original.png", "value": 4},
    63: {"name": "Easter Egg", "photo": "https://cdn.changes.tg/gifts/models/Easter Egg/png/Original.png", "value": 4},
    64: {"name": "Bonded Ring", "photo": "https://cdn.changes.tg/gifts/models/Bonded Ring/png/Original.png", "value": 45},
    65: {"name": "Pet Snake", "photo": "https://cdn.changes.tg/gifts/models/Pet Snake/png/Original.png", "value": 4},
    66: {"name": "Snake Box", "photo": "https://cdn.changes.tg/gifts/models/Snake Box/png/Original.png", "value": 4},
    67: {"name": "Xmas Stocking", "photo": "https://cdn.changes.tg/gifts/models/Xmas Stocking/png/Original.png", "value": 4},
    68: {"name": "Big Year", "photo": "https://cdn.changes.tg/gifts/models/Big Year/png/Original.png", "value": 4},
    69: {"name": "Holiday Drink", "photo": "https://cdn.changes.tg/gifts/models/Holiday Drink/png/Original.png", "value": 4},
    70: {"name": "Gem Signet", "photo": "https://cdn.changes.tg/gifts/models/Gem Signet/png/Original.png", "value": 60},
    71: {"name": "Light Sword", "photo": "https://cdn.changes.tg/gifts/models/Light Sword/png/Original.png", "value": 5},
    72: {"name": "Restless Jar", "photo": "https://cdn.changes.tg/gifts/models/Restless Jar/png/Original.png", "value": 4},
    73: {"name": "Nail Bracelet", "photo": "https://cdn.changes.tg/gifts/models/Nail Bracelet/png/Original.png", "value": 125},
    74: {"name": "Heroic Helmet", "photo": "https://cdn.changes.tg/gifts/models/Heroic Helmet/png/Original.png", "value": 230},
    75: {"name": "Bow Tie", "photo": "https://cdn.changes.tg/gifts/models/Bow Tie/png/Original.png", "value": 5},
    76: {"name": "Lush Bouquet", "photo": "https://cdn.changes.tg/gifts/models/Lush Bouquet/png/Original.png", "value": 6},
    77: {"name": "Whip Cupcake", "photo": "https://cdn.changes.tg/gifts/models/Whip Cupcake/png/Original.png", "value": 4},
    78: {"name": "Joyful Bundle", "photo": "https://cdn.changes.tg/gifts/models/Joyful Bundle/png/Original.png", "value": 7},
    79: {"name": "Cupid Charm", "photo": "https://cdn.changes.tg/gifts/models/Cupid Charm/png/Original.png", "value": 20},
    80: {"name": "Valentine Box", "photo": "https://cdn.changes.tg/gifts/models/Valentine Box/png/Original.png", "value": 10},
    81: {"name": "Snoop Dogg", "photo": "https://cdn.changes.tg/gifts/models/Snoop Dogg/png/Original.png", "value": 4},
    82: {"name": "Swag Bag", "photo": "https://cdn.changes.tg/gifts/models/Swag Bag/png/Original.png", "value": 4},
    83: {"name": "Snoop Cigar", "photo": "https://cdn.changes.tg/gifts/models/Snoop Cigar/png/Original.png", "value": 10},
    84: {"name": "Low Rider", "photo": "https://cdn.changes.tg/gifts/models/Low Rider/png/Original.png", "value": 45},
    85: {"name": "Westside Sign", "photo": "https://cdn.changes.tg/gifts/models/Westside Sign/png/Original.png", "value": 95},
    86: {"name": "Stellar Rocket", "photo": "https://cdn.changes.tg/gifts/models/Stellar Rocket/png/Original.png", "value": 4},
    87: {"name": "Jolly Chimp", "photo": "https://cdn.changes.tg/gifts/models/Jolly Chimp/png/Original.png", "value": 6},
    88: {"name": "Moon Pendant", "photo": "https://cdn.changes.tg/gifts/models/Moon Pendant/png/Original.png", "value": 4},
    89: {"name": "Ionic Dryer", "photo": "https://cdn.changes.tg/gifts/models/Ionic Dryer/png/Original.png", "value": 15},
    90: {"name": "Mighty Arm", "photo": "https://cdn.changes.tg/gifts/models/Mighty Arm/png/Original.png", "value": 150},
    91: {"name": "Clover Pin", "photo": "https://cdn.changes.tg/gifts/models/Clover Pin/png/Original.png", "value": 4},
    92: {"name": "Sky Stilettos", "photo": "https://cdn.changes.tg/gifts/models/Sky Stilettos/png/Original.png", "value": 13},
    93: {"name": "Fresh Socks", "photo": "https://cdn.changes.tg/gifts/models/Fresh Socks/png/Original.png", "value": 4},
    94: {"name": "Ice Cream", "photo": "https://cdn.changes.tg/gifts/models/Ice Cream/png/Original.png", "value": 4},
    95: {"name": "Faith Amulet", "photo": "https://cdn.changes.tg/gifts/models/Faith Amulet/png/Original.png", "value": 4},
    96: {"name": "Mousse Cake", "photo": "https://cdn.changes.tg/gifts/models/Mousse Cake/png/Original.png", "value": 4},
    97: {"name": "Bling Binky", "photo": "https://cdn.changes.tg/gifts/models/Bling Binky/png/Original.png", "value": 30},
    98: {"name": "Money Pot", "photo": "https://cdn.changes.tg/gifts/models/Money Pot/png/Original.png", "value": 4},
    99: {"name": "Pretty Posy", "photo": "https://cdn.changes.tg/gifts/models/Pretty Posy/png/Original.png", "value": 5},
    # --- ДОБАВЛЕННЫЕ НОВЫЕ ПОДАРКИ ---
    100: {"name": "Plush Pepe", "photo": "https://cdn.changes.tg/gifts/models/Plush Pepe/png/Original.png", "value": 50},
    101: {"name": "Durov's Cap", "photo": "https://cdn.changes.tg/gifts/models/Durov's Cap/png/Original.png", "value": 50},
    102: {"name": "Perfume Bottle", "photo": "https://cdn.changes.tg/gifts/models/Perfume Bottle/png/Original.png", "value": 50},
    103: {"name": "Swiss Watch", "photo": "https://cdn.changes.tg/gifts/models/Swiss Watch/png/Original.png", "value": 50},
    104: {"name": "Ion Gem", "photo": "https://cdn.changes.tg/gifts/models/Ion Gem/png/Original.png", "value": 50},
    105: {"name": "Heart Locket", "photo": "https://cdn.changes.tg/gifts/models/Heart Locket/png/Original.png", "value": 50},
    106: {"name": "Artisan Brick", "photo": "https://cdn.changes.tg/gifts/models/Artisan Brick/png/Original.png", "value": 50},
    107: {"name": "Khabib's Papakha", "photo": "https://cdn.changes.tg/gifts/models/Khabib's Papakha/png/Original.png", "value": 50},
    108: {"name": "UFC Strike", "photo": "https://cdn.changes.tg/gifts/models/UFC Strike/png/Original.png", "value": 50},
    109: {"name": "Rare Bird", "photo": "https://cdn.changes.tg/gifts/models/Rare Bird/png/Original.png", "value": 50},
    110: {"name": "Mood Pack", "photo": "https://cdn.changes.tg/gifts/models/Mood Pack/png/Original.png", "value": 50},
    111: {"name": "Pool Float", "photo": "https://cdn.changes.tg/gifts/models/Pool Float/png/Original.png", "value": 50},
    112: {"name": "Timeless Book", "photo": "https://cdn.changes.tg/gifts/models/Timeless Book/png/Original.png", "value": 50},
    113: {"name": "Chill Flame", "photo": "https://cdn.changes.tg/gifts/models/Chill Flame/png/Original.png", "value": 50},
    114: {"name": "Vice Cream", "photo": "https://cdn.changes.tg/gifts/models/Vice Cream/png/Original.png", "value": 50}
}
    
# ==========================================
MAIN_GIFTS = {
    1000: {"name": "Swiss Watch", "photo": "https://cdn.changes.tg/gifts/models/Swiss Watch/png/Original.png", "required_value": 50},
    1001: {"name": "Artisan Brick", "photo": "https://cdn.changes.tg/gifts/models/Artisan Brick/png/Original.png", "required_value": 100},
    1002: {"name": "Perfume Bottle", "photo": "https://cdn.changes.tg/gifts/models/Perfume Bottle/png/Original.png", "required_value": 100},
    1003: {"name": "Ion Gem", "photo": "https://cdn.changes.tg/gifts/models/Ion Gem/png/Original.png", "required_value": 100},
    1004: {"name": "Durov's Cap", "photo": "https://cdn.changes.tg/gifts/models/Durov's Cap/png/Original.png", "required_value": 700},
    1005: {"name": "Toy Bear", "photo": "https://cdn.changes.tg/gifts/models/Toy Bear/png/Original.png", "required_value": 50},
    1006: {"name": "Vintage Cigar", "photo": "https://cdn.changes.tg/gifts/models/Vintage Cigar/png/Original.png", "required_value": 30}
}


# ==========================================
# РЕАЛЬНЫЕ TELEGRAM GIFTS ДЛЯ ВЫИГРЫШЕЙ
# ==========================================
TG_GIFTS = {
    2000: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/6028601630662853006/Original.png", "required_value": 50,  "tg_gift_id": "6028601630662853006"},
    2001: {"name": "", "photo": "https://cdn.changes.tg/gifts/originals/5170521118301225164/Original.png", "required_value": 100, "tg_gift_id": "5170521118301225164"},
    2002: {"name": "", "photo": "https://cdn.changes.tg/gifts/originals/5170690322832818290/Original.png", "required_value": 100, "tg_gift_id": "5170690322832818290"},
    2003: {"name": "", "photo": "https://cdn.changes.tg/gifts/originals/5168043875654172773/Original.png", "required_value": 100, "tg_gift_id": "5168043875654172773"},
    2004: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5170564780938756245/Original.png", "required_value": 50,  "tg_gift_id": "5170564780938756245"},
    2005: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5170314324215857265/Original.png", "required_value": 50,  "tg_gift_id": "5170314324215857265"},
    2006: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5170144170496491616/Original.png", "required_value": 50,  "tg_gift_id": "5170144170496491616"},
    2007: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5168103777563050263/Original.png", "required_value": 25,  "tg_gift_id": "5168103777563050263"},
    2008: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5170250947678437525/Original.png", "required_value": 25,  "tg_gift_id": "5170250947678437525"},
    2009: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5170233102089322756/Original.png", "required_value": 15,  "tg_gift_id": "5170233102089322756"},
    2010: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5170145012310081615/Original.png", "required_value": 15,  "tg_gift_id": "5170145012310081615"},
    2011: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5801108895304779062/Original.png", "required_value": 50,  "tg_gift_id": "5801108895304779062", "price": 60},
    2012: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5922558454332916696/Original.png", "required_value": 50,  "tg_gift_id": "5922558454332916696", "price": 60},
    2013: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5956217000635139069/Original.png", "required_value": 50,  "tg_gift_id": "5956217000635139069", "price": 60},
    2014: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5800655655995968830/Original.png", "required_value": 50,  "tg_gift_id": "5800655655995968830", "price": 60},
    2015: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5866352046986232958/Original.png", "required_value": 50,  "tg_gift_id": "5866352046986232958", "price": 60},
    2016: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5893356958802511476/Original.png", "required_value": 50,  "tg_gift_id": "5893356958802511476", "price": 60},
    2017: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5935895822435615975/Original.png", "required_value": 50,  "tg_gift_id": "5935895822435615975", "price": 60},
    2018: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/5969796561943660080/Original.png", "required_value": 50,  "tg_gift_id": "5969796561943660080", "price": 60},
    2019: {"name": "",  "photo": "https://cdn.changes.tg/gifts/originals/6026193266406327981/Original.png", "required_value": 50,  "tg_gift_id": "6026193266406327981", "price": 60},
}


# ==========================================
# МАГАЗИН — РАЗДЕЛЫ И АКЦИИ
# ==========================================
# Каждый раздел имеет:
#   id        — уникальный идентификатор
#   title     — {ru, en} название раздела
#   items     — список товаров
#
# Каждый товар:
#   id        — уникальный строковый ID (используется при покупке)
#   type      — "stars" | "donuts" | "limited_gift" | "base_gift"
#   amount    — количество (для stars/donuts)
#   gift_id   — для limited_gift: ID из TG_GIFTS (2011–2019)
#               для base_gift: ID из BASE_GIFTS (1–114)
#   currency  — "stars" | "donuts" | "free" | "referral"
#   price     — цена в выбранной валюте (для referral — кол-во приглашённых друзей)
#   image     — URL картинки (опционально; для limited_gift и base_gift берётся из TG_GIFTS)
#   title     — {ru, en} название товара
#   enabled   — True/False (по умолчанию True)
#   buy_limit — максимальное количество покупок ОДНИМ пользователем
#               None или отсутствие = без персонального ограничения
#   total_limit — общий запас товара (суммарно по всем пользователям)
#                 Как только total_limit покупок совершено, товар исчезает
#                 из интерфейса у всех пользователей без перезагрузки страницы.
#                 None или отсутствие = без ограничения на общее количество
#
# Лимитированные подарки (TG Shop) рендерятся автоматически в отдельном
# разделе «Лимитированные подарки» на основе TG_GIFTS[id].price.
# Добавлять их сюда не нужно — только кастомные акции.

SHOP_SECTIONS: list[dict] = [
    # ─────────────────────────────────────────────────────────────────────────
    # Поля товара (item):
    #
    #   id           — уникальный строковый идентификатор товара
    #   type         — тип одиночного вознаграждения: "stars" | "donuts" |
    #                  "limited_gift" | "base_gift"
    #                  Используется, если поле "rewards" НЕ задано.
    #   amount       — количество звёзд / пончиков (для type stars/donuts)
    #   gift_id      — ID подарка (для type limited_gift / base_gift)
    #   rewards      — список из 1 до 4 вознаграждений; если указан, поля
    #                  type/amount/gift_id игнорируются.
    #                  Каждый элемент: {"type": "stars"|"donuts"|"limited_gift"|
    #                                  "base_gift", "amount": N, "gift_id": N}
    #   currency     — валюта оплаты: "free" | "stars" | "donuts" | "referral"
    #   price        — стоимость (0 для free)
    #   image        — URL изображения (необязательно)
    #   title        — {ru: ..., en: ...}
    #   enabled      — False скрывает товар статически
    #   buy_limit    — максимальное число покупок одним пользователем (None = ∞)
    #   total_limit  — глобальный лимит покупок всеми (None = ∞)
    #   background   — цветовая тема карточки: "green" | "gold" | "purple" | "red"
    #                  None или отсутствие = стандартный стиль
    #   expires_at   — ISO-строка окончания акции, например "2026-06-01T23:59:59"
    #                  None или отсутствие = без ограничения по времени
    #                  По истечении товар автоматически исчезает из интерфейса
    #                  и блокируется на покупку (сервер тоже проверяет срок)
    # ─────────────────────────────────────────────────────────────────────────
    {
        "id": "promotions",
        "title": {"ru": "Акции", "en": "Promotions"},
        "items": [
            {
                "id": "plushpepe",
                "type": "base_gift",
                "gift_id": 100,
                "currency": "referral",
                "price": 1337,
                "title": {"ru": "😁", "en": "😁"},
                "enabled": True,
                "buy_limit": 1,     # None или отсутствие = без персонального ограничения
                "total_limit": 1,  # None или отсутствие = без глобального ограничения
                "background": "green",
                "expires_at": "2026-05-21T23:59:59", # пример: "2026-06-01T23:59:59"
            },
            {
                "id": "donuts_0_1_free",
                "type": "donuts",
                "amount": 0.1,
                "currency": "free",
                "price": 0,
                "image": "/gifts/dount.png",
                "title": {"ru": "0.1 пончик бесплатно", "en": "0.1 donut free"},
                "enabled": True,
                "buy_limit": 1,
                "total_limit": 10,
                "background": "gold",
                "expires_at": None,
            },
            {
                "id": "stars_donuts_25_for_referral",
                # Пример товара с несколькими вознаграждениями (rewards):
                # пользователь получает сразу 25 звёзд + 0.1 пончика за 3 реферала
                "rewards": [
                    {"type": "stars",  "amount": 25},
                    {"type": "donuts", "amount": 0.1}
                ],
                "currency": "referral",
                "price": 3,
                "image": "/gifts/stars.png",
                "title": {"ru": "25⭐ + 0.1🍩", "en": "25 stars + 0.1🍩 per friend"},
                "enabled": True,
                "buy_limit": 1,
                "background": "gold",
                "expires_at": None,
            },
            # --- Примеры для подарков (раскомментируйте при необходимости) ---
            # {
            #     "id": "limited_gift_2011_free",
            #     "type": "limited_gift",
            #     "gift_id": 2011,
            #     "currency": "free",
            #     "price": 0,
            #     "title": {"ru": "Подарок бесплатно", "en": "Free gift"},
            #     "enabled": False,
            #     "background": "red",
            #     "expires_at": "2026-06-01T23:59:59",
            # },
            # {
            #     "id": "bundle_stars_gift",
            #     # Бандл: 50 звёзд + подарок за 30 звёзд
            #     "rewards": [
            #         {"type": "stars",       "amount": 50},
            #         {"type": "base_gift",   "gift_id": 1},
            #     ],
            #     "currency": "stars",
            #     "price": 30,
            #     "title": {"ru": "Бандл: звёзды + медаль", "en": "Bundle: stars + medal"},
            #     "enabled": False,
            #     "background": "gold",
            #     "expires_at": "2026-06-01T23:59:59",
            # },
        ],
    },
]


# ==========================================
# АВТООБНОВЛЕНИЕ ЦЕН ПОДАРКОВ ИЗ API
# ==========================================
def _build_scraper():
    """Создаёт cloudscraper, имитирующий обычный браузер Chrome."""
    return cloudscraper.create_scraper(
        browser={"browser": "chrome", "platform": "windows", "mobile": False}
    )


def _fetch_market_prices_bulk(scraper, limit: int = 300) -> dict:
    """
    Загружает батч цен с Portal Market API.
    Возвращает словарь {name.lower(): floor_price}.
    """
    try:
        resp = scraper.get(
            "https://portal-market.com/api/collections",
            params={"limit": limit},
            timeout=15,
        )
        if resp.status_code == 200:
            prices = {}
            for item in resp.json().get("collections", []):
                prices[item["name"].lower()] = float(item.get("floor_price", 0))
            return prices
        print(f"⚠️ Portal API вернул статус {resp.status_code}")
    except Exception as e:
        print(f"Не удалось выгрузить общую базу цен: {e}")
    return {}


def _fetch_market_price_single(scraper, name: str) -> float | None:
    """Точечный запрос цены одного подарка по имени."""
    try:
        resp = scraper.get(
            "https://portal-market.com/api/collections",
            params={"search": name, "limit": 1},
            timeout=5,
        )
        if resp.status_code == 200:
            cols = resp.json().get("collections", [])
            if cols:
                return float(cols[0].get("floor_price", 0))
    except Exception:
        pass
    return None


def update_all_gifts_prices():
    """
    Обновляет цены BASE_GIFTS и MAIN_GIFTS из Portal Market API за один проход.

    BASE_GIFTS : новая цена = floor_price × 0.85 (−15%), с дробями до 0.01, минимум 0.01.
    MAIN_GIFTS : новая цена = floor_price × 1.2  (+20%), без дробей, минимум 1.

    Сначала делается один батч-запрос (limit=300), затем точечные запросы
    для подарков, не найденных в батче.
    """
    print("🔄 Загрузка актуальных цен подарков из Portal Market API...")

    try:
        scraper = _build_scraper()
    except Exception as e:
        print(f"Не удалось инициализировать cloudscraper: {e}")
        return

    market_prices = _fetch_market_prices_bulk(scraper)

    def resolve_price(name: str) -> float | None:
        """Возвращает floor_price: сначала из батча, затем точечным запросом."""
        fp = market_prices.get(name.lower())
        if fp and fp > 0:
            return fp
        return _fetch_market_price_single(scraper, name)

    base_updated = main_updated = 0

    # ── BASE_GIFTS: floor_price × 0.85, с дробями до 0.01 ───────────────
    for gift_id, gift in BASE_GIFTS.items():
        fp = resolve_price(gift["name"])
        if fp and fp > 0:
            BASE_GIFTS[gift_id]["value"] = max(0.01, round(fp * 0.85, 2))
            base_updated += 1

    # ── MAIN_GIFTS: floor_price × 1.2, без дробей ────────────────────────
    for gift_id, gift in MAIN_GIFTS.items():
        fp = resolve_price(gift["name"])
        if fp and fp > 0:
            MAIN_GIFTS[gift_id]["required_value"] = max(1, int(fp * 1.1))
            main_updated += 1

    print(
        f"✅ Цены обновлены: BASE {base_updated}/{len(BASE_GIFTS)}, "
        f"MAIN {main_updated}/{len(MAIN_GIFTS)}"
    )


# Псевдоним для обратной совместимости (старые call site не трогаем руками)
def update_base_gifts_prices():
    update_all_gifts_prices()


# ==========================================
# ПРИЗЫ ЗА ТОПОВЫЕ МЕСТА В ЛИДЕРБОРДЕ
# ==========================================
# Призы выдаются автоматически при еженедельном сбросе сезона (каждый понедельник 00:00 UTC).
#
# type:     "donuts"    — пончики (поле amount обязательно)
#           "stars"     — звёзды  (поле amount обязательно)
#           "base_gift" — подарок из BASE_GIFTS (поле gift_id = ключ из BASE_GIFTS)
#           "tg_gift"   — TG-подарок из MAIN_GIFTS (поле gift_id = ключ из MAIN_GIFTS)
#
# amount:   количество пончиков или звёзд (только для типов "donuts" и "stars")
# gift_id:  числовой ключ из BASE_GIFTS или MAIN_GIFTS (только для типов "base_gift"/"tg_gift")
#
# Примеры:
#   {"type": "donuts",    "amount": 5000}
#   {"type": "stars",     "amount": 500}
#   {"type": "base_gift", "gift_id": 1}
#   {"type": "tg_gift",   "gift_id": 2001}

LEADERBOARD_PRIZES: dict = {
    1: {"type": "donuts", "amount": 10},   # 🥇 1-е место
    2: {"type": "donuts", "amount": 5},   # 🥈 2-е место
    3: {"type": "donuts", "amount": 2},   # 🥉 3-е место
}
