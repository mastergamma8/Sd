# ================================================================
#  nft_catalog.py — Каталог NFT-картин
#
#  Одиночные картины: добавьте в список PAINTINGS ниже.
#  Паки с картинами: добавьте в список PACKS ниже.
#
#  Поля картины:
#    title        (str)  — название, обязательное
#    description  (str)  — описание, можно ""
#    image_url    (str)  — прямая ссылка на изображение
#    price        (int)  — цена в NFT-звёздах
#    total_supply (int)  — лимит тиража; 0 = неограниченный
#    is_active    (bool) — True = видна сразу, False = скрыта
#    author       (str)  — юзернейм автора БЕЗ @, по умолчанию "Space_Donut"
#
#  Поля пака:
#    name             (str)  — название пака
#    description      (str)  — описание пака
#    cover_image_url  (str)  — обложка пака (если пусто — берётся из первой картины)
#    paintings        (list) — список картин в паке (те же поля, что у одиночной)
# ================================================================

# ── Одиночные картины (без пака) ─────────────────────────────────────────────

PAINTINGS = [

    {
        "title":        "Cosmic Dream",
        "description":  "Первая работа из серии «Космические сны». Лимитированный тираж.",
        "image_url":    "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800",
        "price":        50,
        "total_supply": 100,
        "is_active":    True,
        "author":       "Space_Donut",   # юзернейм без @; пусто = Space_Donut
    },

    {
        "title":        "Neon City",
        "description":  "Неоновый город никогда не спит. Доступно всем.",
        "image_url":    "https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800",
        "price":        50,
        "total_supply": 20,
        "is_active":    True,
        "author":       "Space_Donut",
    },

]


# ── Паки (коллекции из нескольких картин) ─────────────────────────────────────

PACKS = [

    {
        "name":             "Space Collection",
        "description":      "Коллекция из 3 космических работ. Каждая картина имеет свой лимит.",
        "cover_image_url":  "",   # пусто — используется изображение первой картины
        "paintings": [
            {
                "title":        "Sakura Flower",
                "description":  "Цветение сакуры в стиле цифровой живописи.",
                "image_url":    "https://cdn.changes.tg/gifts/models/Sakura Flower/png/Original.png",
                "price":        150,
                "total_supply": 5,
                "is_active":    True,
            },
            {
                "title":        "Plush Pepe",
                "description":  "Культовый персонаж в уникальном исполнении.",
                "image_url":    "https://cdn.changes.tg/gifts/models/Plush Pepe/png/Original.png",
                "price":        101,
                "total_supply": 3,
                "is_active":    True,
            },
            {
                "title":        "Pool Float",
                "description":  "Летнее настроение в каждом пикселе.",
                "image_url":    "https://cdn.changes.tg/gifts/models/Pool Float/png/Original.png",
                "price":        102,
                "total_supply": 10,
                "is_active":    True,
            },
        ],
    },

    # Добавляйте свои паки ниже:
    # {
    #     "name": "My Pack",
    #     "description": "...",
    #     "cover_image_url": "",
    #     "paintings": [
    #         {"title": "...", "image_url": "...", "price": 50, "total_supply": 10, "is_active": True},
    #     ],
    # },

]
