# ================================================================
#  nft_catalog.py — Каталог NFT-картин
#
#  Одиночные картины: добавьте в список PAINTINGS ниже.
#  Паки с картинами: добавьте в список PACKS ниже.
#
#  ВАЖНО: поле "id" — стабильный уникальный ключ (строка, латиница,
#  без пробелов). Именно по нему БД находит запись при синхронизации.
#  Название (name / title) можно менять свободно — id остаётся
#  неизменным, и старые данные (sold_count, владельцы) не теряются.
#
#  Поля картины:
#    id           (str)  — уникальный ключ картины, ОБЯЗАТЕЛЬНОЕ
#    title        (str)  — название, обязательное
#    description  (str)  — описание, можно ""
#    image_url    (str)  — прямая ссылка на изображение
#    price        (int)  — цена в NFT-звёздах
#    total_supply (int)  — лимит тиража; 0 = неограниченный
#    is_active    (bool) — True = видна сразу, False = скрыта
#    author       (str)  — юзернейм автора БЕЗ @, по умолчанию "Space_Donut"
#
#  Поля пака:
#    id               (str)  — уникальный ключ пака, ОБЯЗАТЕЛЬНОЕ
#    name             (str)  — название пака
#    description      (str)  — описание пака
#    cover_image_url  (str)  — обложка пака (если пусто — берётся из первой картины)
#    paintings        (list) — список картин в паке (те же поля, что у одиночной)
# ================================================================

# ── Одиночные картины (без пака) ─────────────────────────────────────────────

PAINTINGS = [

    {
        "id":           "cosmic_dream",          # ← стабильный ключ, не менять
        "title":        "Cosmic Dream",
        "description":  "Первая работа из серии «Космические сны». Лимитированный тираж.",
        "image_url":    "https://images.unsplash.com/photo-1465101162946-4377e57745c3?w=800",
        "price":        50,
        "total_supply": 100,
        "is_active":    True,
        "author":       "Space_Donut",
    },

    {
        "id":           "neon_city",             # ← стабильный ключ, не менять
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
        "id":               "space_collection",  # ← стабильный ключ, не менять
        "name":             "Space Collection hs",
        "description":      "Коллекция из 3 космических работ. Каждая картина имеет свой лимит.",
        "cover_image_url":  "",
        "paintings": [
            {
                "id":           "scream",        # ← стабильный ключ, не менять
                "title":        "Scream",
                "description":  "Цветение сакуры в стиле цифровой живописи.",
                "image_url":    "/paintings/scream.png",
                "price":        150,
                "total_supply": 5,
                "is_active":    True,
            },
            {
                "id":           "starry_night",  # ← стабильный ключ, не менять
                "title":        "Starry Night",
                "description":  "Культовый персонаж в уникальном исполнении.",
                "image_url":    "/paintings/starrynight.png",
                "price":        101,
                "total_supply": 3,
                "is_active":    True,
            },
            {
                "id":           "mona_lisa",     # ← стабильный ключ, не менять
                "title":        "Mona Lisa",
                "description":  "Летнее настроение в каждом пикселе.",
                "image_url":    "/paintings/monalisa.png",
                "price":        102,
                "total_supply": 10,
                "is_active":    True,
            },
        ],
    },

    # Добавляйте свои паки ниже:
    # {
    #     "id":   "my_pack",          # ← придумайте уникальный ключ (латиница, _)
    #     "name": "My Pack",
    #     "description": "...",
    #     "cover_image_url": "",
    #     "paintings": [
    #         {"id": "my_painting_1", "title": "...", "image_url": "...", "price": 50, "total_supply": 10, "is_active": True},
    #     ],
    # },

]