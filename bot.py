# bot.py — инстанс бота и регистрация хэндлеров
#
# В продакшене (Railway) бот работает через webhook внутри FastAPI (main.py).
# Этот файл теперь только создаёт объект бота и регистрирует хэндлеры.

import logging
from aiogram import Bot, Dispatcher

import config
from handlers import start, admin

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# Инстансы создаются на уровне модуля — импортируются из main.py для webhook-режима.
bot = Bot(token=config.BOT_TOKEN)
dp = Dispatcher()


def setup_handlers():
    """Регистрирует хэндлеры на диспетчере. Вызывается один раз при старте."""
    start.register(dp, bot)
    admin.register(dp, bot)


if __name__ == "__main__":
    print("Этот файл больше не запускает polling. Используй main.py для webhook-режима.")
