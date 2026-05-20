# support_bot.py — инстанс бота поддержки и регистрация хэндлеров
#
# В продакшене (Railway) бот работает через webhook внутри FastAPI (main.py).
# Этот файл теперь только создаёт объект бота и регистрирует хэндлеры.

import logging
import os

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from dotenv import load_dotenv

load_dotenv()

SUPPORT_BOT_TOKEN = os.getenv("SUPPORT_BOT_TOKEN")
if not SUPPORT_BOT_TOKEN:
    raise ValueError(
        "SUPPORT_BOT_TOKEN не найден в переменных окружения (.env)!\n"
        "Добавь строку: SUPPORT_BOT_TOKEN=<токен бота поддержки>"
    )

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(name)s - %(message)s",
)

# Инстансы создаются на уровне модуля — импортируются из main.py для webhook-режима.
support_bot = Bot(token=SUPPORT_BOT_TOKEN)
support_dp = Dispatcher(storage=MemoryStorage())


def setup_handlers():
    """Регистрирует хэндлеры на диспетчере. Вызывается один раз при старте."""
    from handlers.support import register
    register(support_dp, support_bot)


if __name__ == "__main__":
    print("Этот файл больше не запускает polling. Используй main.py для webhook-режима.")
