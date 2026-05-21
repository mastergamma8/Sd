# ================================================================
#  nft_catalog.py — Каталог NFT-картин
#
#  Чтобы добавить новую картину:
#    1. Добавьте новый словарь в список PAINTINGS ниже.
#    2. Запустите скрипт публикации:  python publish_nft.py
#
#  Поля словаря:
#    title        (str)  — название картины, обязательное
#    description  (str)  — описание, можно оставить пустым ""
#    image_url    (str)  — прямая ссылка на изображение, обязательная
#    price        (int)  — цена в NFT-звёздах, обязательная
#    total_supply (int)  — лимит тиража; 0 = неограниченный
#    is_active    (bool) — True = сразу видна в магазине
#                          False = скрыта до ручного запуска
# ================================================================

PAINTINGS = [

    # ── Пример 1: лимитированная картина ────────────────────────
    {
        "title":        "Cosmic Dream #1",
        "description":  "Первая работа из серии «Космические сны». Лимитированный тираж.",
        "image_url":    "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800",
        "price":        150,
        "total_supply": 10,   # только 10 штук
        "is_active":    True,
    },

    # ── Пример 2: безлимитная картина ───────────────────────────
    {
        "title":        "Neon City",
        "description":  "Неоновый город никогда не спит. Доступно всем.",
        "image_url":    "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800",
        "price":        50,
        "total_supply": 0,    # безлимитно
        "is_active":    True,
    },

    # ── Пример 3: скрытая — выйдет позже ────────────────────────
    {
        "title":        "Sakura Flower",
        "description":  "Настоящий шедевр исскуства",
        "image_url":    "https://cdn.changes.tg/gifts/models/Sakura Flower/png/Original.png",
        "price":        300,
        "total_supply": 5,
        "is_active":    True,  # не видна в магазине до публикации
    },

    # ── Добавляйте свои картины ниже ────────────────────────────
    # {
    #     "title":        "Название",
    #     "description":  "Описание",
    #     "image_url":    "https://...",
    #     "price":        100,
    #     "total_supply": 0,
    #     "is_active":    True,
    # },

]