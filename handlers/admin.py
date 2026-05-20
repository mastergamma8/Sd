# handlers/admin.py
#
# Точка входа для всех административных команд.
# Логика вынесена в отдельные модули; здесь только регистрация.
#
# Структура модулей:
#   admin_constants.py  — общие эмодзи и ID иконок
#   admin_gifts.py      — /addgift, /addstars
#                         /addtggift  — добавить TG-подарок в инвентарь
#                         /addbasegift — добавить базовый подарок в инвентарь
#                         /addmaingift — добавить главный подарок в инвентарь
#                         /giftids    — просмотр ID подарков по типу (tg/base/main)
#   admin_bank.py       — /bankhelp, /bankstatus, /addbank
#   admin_send.py       — /send, /cancel  (с поддержкой кнопок)
#   admin_promos.py     — /addpromo, /promos, /delpromo
#   admin_features.py   — /hide, /show, /featurestatus, /maintenance
#   admin_users.py      — /genfakeusers, /delfakeusers, /addtester,
#                         /deltester, /testers, /setexchangerate

from aiogram import Bot, Dispatcher

from . import admin_gifts
from . import admin_bank
from . import admin_send
from . import admin_promos
from . import admin_features
from . import admin_users
from . import admin_gamelinks

# Реэкспортируем класс состояний, если он нужен в других частях проекта
from .admin_send import SendMessage

__all__ = ["register", "SendMessage"]


def register(dp: Dispatcher, bot: Bot) -> None:
    """Регистрирует все административные хэндлеры в диспетчере."""
    admin_gifts.register(dp, bot)
    admin_bank.register(dp, bot)
    admin_send.register(dp, bot)      # включает /cancel и расширенный /send
    admin_promos.register(dp, bot)
    admin_features.register(dp, bot)
    admin_users.register(dp, bot)
    admin_gamelinks.register(dp, bot)
