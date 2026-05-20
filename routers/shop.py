"""
routers/shop.py
Магазин: конфиг разделов и покупка товаров.

GET  /api/shop/config        — публичный конфиг разделов + лимитированные подарки
GET  /api/shop/referrals     — сколько рефералов доступно для использования в акциях
POST /api/shop/buy           — покупка товара из кастомного раздела

Атомарность лимитов
───────────────────
Для товаров с buy_limit / total_limit используется двухфазный подход:

  Фаза 1 — резервирование слота (до списания валюты):
    - Открывается одна транзакция.
    - Вызывается pg_advisory_xact_lock(hashtext(item_id)) — транзакционная
      блокировка, которая сериализует параллельные покупки одного товара.
      Блокировка удерживается до конца транзакции и не требует явного снятия.
    - Внутри той же транзакции проверяются buy_limit и total_limit.
    - При прохождении обеих проверок вставляется строка в shop_item_purchases
      (RETURNING id → purchase_id).
    - COMMIT: блокировка снимается, слот зафиксирован.

  Фаза 2 — исполнение сделки (после резервирования):
    - Списывается валюта.
    - Выдаётся товар.
    - При любой ошибке на фазе 2 валюта возвращается, а зарезервированная
      строка удаляется из shop_item_purchases (DELETE WHERE id = purchase_id).

Результат:
  - Два параллельных запроса не могут одновременно пройти проверку лимита:
    второй будет ждать снятия advisory lock первого.
  - Запись о покупке появляется в БД до выдачи товара (резервирование),
    но удаляется при любом сбое — пользователь не теряет право на покупку
    из-за неудачной попытки.
"""

import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

import config
import database
from db import db_async as aiosqlite
from db.db_core import DB_NAME
from handlers.security import get_current_user
from handlers.tg_gifts import send_real_tg_gift

router = APIRouter(prefix="/api/shop", tags=["shop"])


# ────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────

TG_SHOP_GIFT_IDS: set[int] = {2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019}


def _build_limited_section() -> dict:
    """Строит раздел «Лимитированные подарки» из TG_GIFTS."""
    items = []
    for gift_id in sorted(TG_SHOP_GIFT_IDS):
        gift = config.TG_GIFTS.get(gift_id)
        if not gift or not gift.get("price"):
            continue
        items.append({
            "id":       f"limited_{gift_id}",
            "type":     "limited_gift",
            "gift_id":  gift_id,
            "image":    gift.get("photo", ""),
            "currency": "stars",
            "price":    gift.get("price", 60),
            "title":    {
                "ru": gift.get("name") or f"Подарок #{gift_id}",
                "en": gift.get("name") or f"Gift #{gift_id}",
            },
            "enabled":  True,
        })
    return {
        "id":    "limited_gifts",
        "title": {"ru": "Лимитированные подарки", "en": "Limited Gifts"},
        "items": items,
    }


def _is_item_expired(item: dict) -> bool:
    """Возвращает True, если у товара задан expires_at и он уже прошёл."""
    exp = item.get("expires_at")
    if not exp:
        return False
    try:
        dt = datetime.fromisoformat(exp)
        # Если нет tzinfo — считаем UTC
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) >= dt
    except (ValueError, TypeError):
        return False


def _enabled_sections() -> list[dict]:
    """Возвращает только включённые разделы и товары (без просроченных)."""
    sections = []
    for section in getattr(config, "SHOP_SECTIONS", []):
        enabled_items = [
            i for i in section.get("items", [])
            if i.get("enabled", True) and not _is_item_expired(i)
        ]
        if enabled_items:
            sections.append({**section, "items": enabled_items})
    return sections


async def _get_used_referrals(user_id: int) -> int:
    """Возвращает количество рефералов, уже использованных в акциях."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM shop_referral_purchases WHERE user_id = ?",
            (user_id,)
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def _record_referral_purchase(user_id: int, item_id: str):
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "INSERT INTO shop_referral_purchases (user_id, item_id, purchased_at) VALUES (?, ?, ?)",
            (user_id, item_id, int(time.time()))
        )
        await db.commit()


async def _get_item_buy_count(user_id: int, item_id: str) -> int:
    """Сколько раз пользователь уже купил конкретный товар."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM shop_item_purchases WHERE user_id = ? AND item_id = ?",
            (user_id, item_id)
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def _get_all_item_buy_counts(user_id: int) -> dict[str, int]:
    """Возвращает словарь {item_id: count} для всех покупок пользователя."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT item_id, COUNT(*) FROM shop_item_purchases WHERE user_id = ? GROUP BY item_id",
            (user_id,)
        ) as cur:
            rows = await cur.fetchall()
            return {row[0]: row[1] for row in rows}


async def _get_total_item_buy_count(item_id: str) -> int:
    """Суммарное количество покупок товара всеми пользователями (для global total_limit)."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM shop_item_purchases WHERE item_id = ?",
            (item_id,)
        ) as cur:
            row = await cur.fetchone()
            return row[0] if row else 0


async def _get_all_total_buy_counts() -> dict[str, int]:
    """Возвращает словарь {item_id: total_count} по всем пользователям."""
    async with aiosqlite.connect(DB_NAME) as db:
        async with db.execute(
            "SELECT item_id, COUNT(*) FROM shop_item_purchases GROUP BY item_id"
        ) as cur:
            rows = await cur.fetchall()
            return {row[0]: row[1] for row in rows}


# ────────────────────────────────────────────────────────────
# Атомарное резервирование слота покупки
# ────────────────────────────────────────────────────────────

async def _reserve_purchase_slot(
    user_id: int,
    item_id: str,
    buy_limit: int | None,
    total_limit: int | None,
) -> int:
    """
    Атомарно проверяет лимиты и вставляет запись о покупке в одной транзакции.

    Алгоритм:
      1. pg_advisory_xact_lock(hashtext(item_id)) — сериализует все параллельные
         покупки данного товара на уровне БД. Блокировка снимается при COMMIT/ROLLBACK.
      2. Проверка buy_limit (персональный лимит) и total_limit (глобальный лимит).
      3. INSERT INTO shop_item_purchases ... RETURNING id.
      4. COMMIT.

    Возвращает id вставленной строки (purchase_id), который используется
    для отмены резервирования (_cancel_purchase_slot) при ошибке выдачи товара.

    Выбрасывает HTTPException(400) при исчерпанном лимите.
    """
    async with aiosqlite.connect(DB_NAME) as db:
        # Advisory lock уровня транзакции: второй запрос с тем же ключом
        # будет ждать здесь, пока первый не завершит транзакцию.
        await db.execute(
            "SELECT pg_advisory_xact_lock(hashtext(?))",
            (item_id,)
        )

        if buy_limit is not None:
            async with db.execute(
                "SELECT COUNT(*) FROM shop_item_purchases WHERE user_id = ? AND item_id = ?",
                (user_id, item_id)
            ) as cur:
                row = await cur.fetchone()
                if (row[0] if row else 0) >= buy_limit:
                    raise HTTPException(status_code=400, detail="buy_limit_reached")

        if total_limit is not None:
            async with db.execute(
                "SELECT COUNT(*) FROM shop_item_purchases WHERE item_id = ?",
                (item_id,)
            ) as cur:
                row = await cur.fetchone()
                if (row[0] if row else 0) >= total_limit:
                    raise HTTPException(status_code=400, detail="total_limit_reached")

        async with db.execute(
            "INSERT INTO shop_item_purchases (user_id, item_id, purchased_at)"
            " VALUES (?, ?, ?) RETURNING id",
            (user_id, item_id, int(time.time()))
        ) as cur:
            row = await cur.fetchone()
            purchase_id: int = row[0]

        await db.commit()
        # Транзакция закрыта → advisory lock снят → следующий ожидающий запрос
        # разблокирован и увидит уже зафиксированную строку.
        return purchase_id


async def _cancel_purchase_slot(purchase_id: int) -> None:
    """
    Удаляет ранее зарезервированный слот покупки.

    Вызывается при любой ошибке после резервирования, чтобы пользователь
    не потерял право на покупку из-за неудачной попытки.
    """
    async with aiosqlite.connect(DB_NAME) as db:
        await db.execute(
            "DELETE FROM shop_item_purchases WHERE id = ?",
            (purchase_id,)
        )
        await db.commit()


# ────────────────────────────────────────────────────────────
# Routes
# ────────────────────────────────────────────────────────────

@router.get("/config")
async def get_shop_config(current_user: dict = Depends(get_current_user)):
    """
    Возвращает конфиг магазина: лимитированные подарки + кастомные разделы.

    Учитывает флаги видимости из БД:
      • limited_gifts == False       → limited_section не возвращается (None).
      • shop_section_<id> == False   → кастомный раздел исключается целиком.
      • shop_item_<item_id> == False → конкретный товар исключается из раздела.

    Для товаров с buy_limit добавляет user_buy_count — сколько раз текущий
    пользователь уже купил этот товар.
    Для товаров с total_limit добавляет total_buy_count — суммарное количество
    покупок всеми пользователями (чтобы фронтенд скрывал исчерпанные товары).
    """
    tg_id = current_user["id"]
    user_buy_counts  = await _get_all_item_buy_counts(tg_id)
    total_buy_counts = await _get_all_total_buy_counts()

    # Загружаем актуальные флаги из БД
    feature_flags = await database.get_feature_flags()

    # Beta-тестеры видят весь контент магазина вне зависимости от флагов
    # видимости: скрытые разделы, товары и лимитированные подарки
    # остаются для них доступными.
    is_tester = await database.is_beta_tester(tg_id)

    # ── Лимитированные подарки ────────────────────────────────────────────────
    # Флаг limited_gifts == False → скрываем раздел полностью (не для тестеров).
    limited_section = (
        _build_limited_section()
        if (is_tester or feature_flags.get("limited_gifts", True))
        else None
    )

    # ── Кастомные разделы ─────────────────────────────────────────────────────
    # _enabled_sections() уже фильтрует товары с enabled=False из config.py.
    # Здесь дополнительно применяем динамические флаги из БД (кроме тестеров).
    sections = []
    for section in _enabled_sections():
        section_id = section.get("id", "")

        # Скрыть раздел целиком, если флаг shop_section_<id> == False
        # (тестеры обходят это ограничение)
        if not is_tester and not feature_flags.get(f"shop_section_{section_id}", True):
            continue

        # Фильтруем товары: убираем те, у которых shop_item_<item_id> == False
        # (тестеры видят все товары раздела)
        visible_items = [
            item for item in section.get("items", [])
            if is_tester or feature_flags.get(f"shop_item_{item["id"]}", True)
        ]
        if not visible_items:
            continue  # раздел пуст — не включаем

        # Добавляем счётчики покупок для товаров с лимитами
        for item in visible_items:
            item_id     = item["id"]
            buy_limit   = item.get("buy_limit")
            total_limit = item.get("total_limit")
            if buy_limit is not None:
                item["user_buy_count"] = user_buy_counts.get(item_id, 0)
            if total_limit is not None:
                item["total_buy_count"] = total_buy_counts.get(item_id, 0)
            # Гарантируем передачу визуальных полей на фронтенд
            # (background, expires_at уже присутствуют в dict из config.py,
            #  но если отсутствуют — явно ставим None, чтобы фронтенд не ломался)
            item.setdefault("background", None)
            item.setdefault("expires_at", None)

        sections.append({**section, "items": visible_items})

    return {
        "limited_section": limited_section,
        "sections":        sections,
    }


@router.get("/referrals")
async def get_available_referrals(current_user: dict = Depends(get_current_user)):
    """Возвращает количество рефералов, доступных для использования в акциях."""
    tg_id = current_user["id"]
    from db.db_referrals import get_referrals
    total = len(await get_referrals(tg_id))
    used  = await _get_used_referrals(tg_id)
    return {"total": total, "used": used, "available": max(0, total - used)}


class ShopBuyData(BaseModel):
    item_id:    str
    section_id: str


@router.post("/buy")
async def shop_buy(data: ShopBuyData, current_user: dict = Depends(get_current_user)):
    tg_id = current_user["id"]

    # ── Найти товар в конфиге ───────────────────────────────
    item = None
    for section in _enabled_sections():
        if section["id"] == data.section_id:
            for i in section["items"]:
                if i["id"] == data.item_id:
                    item = i
                    break
        if item:
            break

    if not item:
        raise HTTPException(status_code=404, detail="item_not_found")

    # Дополнительная проверка срока действия на стороне сервера
    # (на случай, если фронтенд не успел скрыть товар)
    if _is_item_expired(item):
        raise HTTPException(status_code=400, detail="item_expired")

    # Определяем список вознаграждений
    # Если задан rewards[] — используем его; иначе собираем из одиночных полей
    rewards_list: list[dict] = item.get("rewards") or []
    if not rewards_list:
        rewards_list = [{"type": item["type"], "amount": item.get("amount"), "gift_id": item.get("gift_id")}]

    item_type   = item.get("type", rewards_list[0].get("type", ""))
    currency    = item["currency"]
    price       = item["price"]
    buy_limit   = item.get("buy_limit")
    total_limit = item.get("total_limit")

    # ── Фаза 1: атомарное резервирование слота ──────────────
    #
    # Если у товара есть лимит, выполняется проверка + INSERT в одной
    # транзакции под advisory lock. Второй параллельный запрос будет ждать
    # завершения этой транзакции и увидит уже обновлённый счётчик.
    #
    # HTTPException от _reserve_purchase_slot (лимит исчерпан) прокидывается
    # напрямую — INSERT не произошёл, отменять нечего.
    purchase_id: int | None = None
    if buy_limit is not None or total_limit is not None:
        purchase_id = await _reserve_purchase_slot(
            tg_id, data.item_id, buy_limit, total_limit
        )

    # ── Фаза 2: списание валюты и выдача товара ─────────────
    #
    # При любой ошибке: возвращаем валюту (если уже списана) и удаляем
    # зарезервированный слот.
    try:
        # ── Списание валюты ─────────────────────────────────
        if currency == "donuts":
            success = await database.deduct_balance(tg_id, price)
            if not success:
                raise HTTPException(status_code=400, detail="not_enough_donuts")

        elif currency == "stars":
            success = await database.deduct_stars(tg_id, price)
            if not success:
                raise HTTPException(status_code=400, detail="not_enough_stars")

        elif currency == "referral":
            from db.db_referrals import get_referrals
            total     = len(await get_referrals(tg_id))
            used      = await _get_used_referrals(tg_id)
            available = max(0, total - used)
            if available < price:
                raise HTTPException(status_code=400, detail="not_enough_referrals")
            for _ in range(price):
                await _record_referral_purchase(tg_id, data.item_id)

        elif currency == "free":
            pass  # бесплатно

        else:
            raise HTTPException(status_code=400, detail="unknown_currency")

        # ── Начисление товаров (1–4 вознаграждения) ─────────────────────────
        item_title = item.get("title") or {}
        title_ru   = item_title.get("ru") or data.item_id
        title_en   = item_title.get("en") or data.item_id
        title_tag  = f"[title_ru:{title_ru}][title_en:{title_en}]"

        for reward in rewards_list:
            r_type    = reward.get("type", "")
            r_amount  = reward.get("amount")
            r_gift_id = reward.get("gift_id")

            if r_type == "stars":
                amount = r_amount
                await database.add_stars_to_user(tg_id, amount)
                await database.log_action(
                    tg_id, "shop_buy_stars",
                    f"{title_tag}[amount:{amount}⭐][paid:{price}{currency}]", amount
                )

            elif r_type == "donuts":
                amount = r_amount
                await database.add_points_to_user(tg_id, amount)
                await database.log_action(
                    tg_id, "shop_buy_donuts",
                    f"{title_tag}[amount:{amount}🍩][paid:{price}{currency}]", amount
                )

            elif r_type in ("limited_gift", "base_gift"):
                gift_id = r_gift_id

                if r_type == "limited_gift":
                    gift_def = config.TG_GIFTS.get(gift_id)
                    if not gift_def:
                        raise HTTPException(status_code=400, detail="gift_config_not_found")

                    tg_gift_id = gift_def.get("tg_gift_id")
                    sent = await send_real_tg_gift(tg_id, tg_gift_id, text="gift from Space Donut 🍩")
                    if not sent:
                        raise HTTPException(status_code=502, detail="send_gift_failed")

                    gift_name = gift_def.get("name") or f"Gift #{gift_id}"
                    await database.log_action(
                        tg_id, "shop_buy_gift",
                        f"{title_tag}[gift_id:{gift_id}][gift:{gift_name}][paid:{price}{currency}]", -price
                    )

                else:  # base_gift
                    gift_def = config.BASE_GIFTS.get(gift_id)
                    if not gift_def:
                        raise HTTPException(status_code=400, detail="gift_config_not_found")

                    await database.add_gift_to_user(tg_id, gift_id, 1)
                    gift_name = gift_def.get("name") or f"Gift #{gift_id}"
                    await database.log_action(
                        tg_id, "shop_buy_gift",
                        f"{title_tag}[gift_id:{gift_id}][gift:{gift_name}][paid:{price}{currency}]", -price
                    )

            else:
                raise HTTPException(status_code=400, detail="unknown_item_type")

    except HTTPException as exc:
        # ── Откат: снимаем резерв и возвращаем валюту ───────
        #
        # Сначала отменяем слот, чтобы пользователь мог немедленно попробовать
        # снова, не упираясь в «съеденный» лимит.
        if purchase_id is not None:
            await _cancel_purchase_slot(purchase_id)

        # Возврат валюты только если причина ошибки — НЕ нехватка средств
        # (т.е. валюта была успешно списана, но выдача товара не удалась).
        no_refund_codes = {
            "not_enough_donuts",
            "not_enough_stars",
            "not_enough_referrals",
            "unknown_currency",
            "unknown_item_type",
        }
        if exc.detail not in no_refund_codes:
            if currency == "donuts":
                await database.add_points_to_user(tg_id, price)
            elif currency == "stars":
                await database.add_stars_to_user(tg_id, price)
            # Рефералы не возвращаются: запись shop_referral_purchases отражает
            # сам факт попытки использования реферала, а не успех выдачи товара.

        raise

    # ── Успех: возвращаем актуальные данные ─────────────────
    updated = await database.get_user_data(tg_id)

    new_user_count  = await _get_item_buy_count(tg_id, data.item_id)
    new_total_count = await _get_total_item_buy_count(data.item_id)

    return {
        "status":          "ok",
        "balance":         updated.get("balance", 0),
        "stars":           updated.get("stars", 0),
        "item_id":         data.item_id,
        "user_buy_count":  new_user_count,
        "total_buy_count": new_total_count,
      }
