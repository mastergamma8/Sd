from fastapi import APIRouter

# Импортируем наши разделенные роутеры игр
from .games_roulette import router as roulette_router
from .games_rocket import router as rocket_router
from .games_cases import router as cases_router
from .games_pvp import router as pvp_router

# Создаем главный роутер для раздела /api
# У него префикс /api, а внутренние роутеры добавят свои (например /rocket)
router = APIRouter(prefix="/api", tags=["games"])

# Подключаем роутеры конкретных игр
router.include_router(roulette_router)
router.include_router(rocket_router)
router.include_router(cases_router)
router.include_router(pvp_router)

# Теперь в твоем главном файле main.py ничего не сломается!
# Там по-прежнему достаточно написать:
# from games import router as games_router
# app.include_router(games_router)
