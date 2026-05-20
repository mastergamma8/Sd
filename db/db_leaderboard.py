# db_leaderboard.py
# Таблицы лидеров: транжиры (трата за неделю), сорвиголовы (ракета), счастливчики (кейсы).

import time
from datetime import datetime, timezone, timedelta

import config
from db import db_async as aiosqlite
from db.db_core import DB_NAME


def _get_week_start_ts() -> int:
    """Возвращает Unix-timestamp начала текущей недели (понедельник 00:00 UTC)."""
    now = datetime.now(timezone.utc)
    monday = now - timedelta(days=now.weekday())
    monday = monday.replace(hour=0, minute=0, second=0, microsecond=0)
    return int(monday.timestamp())


def get_week_reset_ts() -> int:
    """Возвращает Unix-timestamp ближайшего сброса лидерборда (следующий понедельник 00:00 UTC)."""
    return _get_week_start_ts() + 7 * 86400


# Типы действий, которые считаются «расходом» пончиков или звёзд
_SPEND_ACTION_TYPES = (
    'case_paid_donuts', 'case_paid_stars',
    'roulette_paid_donuts', 'roulette_paid_stars',
    'rocket_lose_donuts', 'rocket_lose_stars',
    'claim_gift',
    # PvP: ставки (списываются в момент входа в раунд)
    'pvp_bet_donuts', 'pvp_bet_stars', 'pvp_bet_gift',
)

# Типы ставок PvP, номинированные в звёздах (для разбивки donuts/stars)
_STAR_SPEND_TYPES = frozenset({
    'case_paid_stars', 'roulette_paid_stars', 'rocket_lose_stars',
    'pvp_bet_stars', 'pvp_bet_gift',
})

_SPEND_TYPES_PLACEHOLDER = ','.join('?' * len(_SPEND_ACTION_TYPES))


# ==========================================
# ТАБЛИЦЫ ЛИДЕРОВ
# ==========================================

async def get_leaderboard():
    """Транжиры: топ по суммарным тратам за текущую неделю.
    Включает всех пользователей, даже с нулевыми тратами."""
    week_start = _get_week_start_ts()
    rate = await config.get_live_donuts_to_stars_rate()
    _star_types_placeholder = ','.join('?' * len(_STAR_SPEND_TYPES))
    star_types_list = list(_STAR_SPEND_TYPES)
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f"""
            SELECT * FROM (
                SELECT
                    u.tg_id,
                    u.username,
                    CASE WHEN u.is_anonymous = 1 THEN 'Anonim' ELSE u.first_name END AS first_name,
                    CASE WHEN u.is_anonymous = 1 THEN '/static/img/anon.svg' ELSE u.photo_url END AS photo_url,
                    COALESCE(ABS(SUM(CASE
                        WHEN h.action_type NOT IN ({_star_types_placeholder})
                        THEN h.amount ELSE 0 END)), 0) AS donuts_spent,
                    COALESCE(ABS(SUM(CASE
                        WHEN h.action_type IN ({_star_types_placeholder})
                        THEN h.amount ELSE 0 END)), 0) AS stars_spent
                FROM users u
                LEFT JOIN user_history h
                    ON  h.user_id     = u.tg_id
                    AND h.created_at  >= ?
                    AND h.amount      < 0
                    AND h.action_type IN ({_SPEND_TYPES_PLACEHOLDER})
                GROUP BY u.tg_id, u.username, u.first_name, u.photo_url, u.is_anonymous
            ) subq
            ORDER BY (donuts_spent * ? + stars_spent) DESC
            LIMIT 50
        """, (*star_types_list, *star_types_list, week_start, *_SPEND_ACTION_TYPES, rate)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def get_rocket_leaderboard():
    """Сорвиголовы: топ по максимальному множителю ракеты за 7 дней."""
    import time
    import re
    week_ago = int(time.time()) - 7 * 86400
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT h.user_id, h.description,
                   CASE WHEN u.is_anonymous = 1 THEN 'Anonim' ELSE u.first_name END AS first_name,
                   CASE WHEN u.is_anonymous = 1 THEN '/static/img/anon.svg' ELSE u.photo_url END AS photo_url,
                   u.username
            FROM user_history h
            JOIN users u ON u.tg_id = h.user_id
            WHERE h.action_type LIKE 'rocket_win_%'
              AND h.created_at >= ?
        """, (week_ago,)) as cursor:
            rows = await cursor.fetchall()

    best: dict[int, dict] = {}
    multiplier_re = re.compile(r'x([\d.]+)')
    for row in rows:
        m = multiplier_re.search(row["description"])
        if not m:
            continue
        mult = float(m.group(1))
        uid = row["user_id"]
        if uid not in best or mult > best[uid]["max_multiplier"]:
            best[uid] = {
                "tg_id": uid,
                "first_name": row["first_name"],
                "photo_url": row["photo_url"],
                "username": row["username"],
                "max_multiplier": mult,
            }

    return sorted(best.values(), key=lambda x: x["max_multiplier"], reverse=True)[:50]

async def get_user_rich_rank(tg_id: int) -> dict:
    """Возвращает место и суммарные траты пользователя в таблице транжир за текущую неделю.
    Корректно работает для пользователей с нулевыми тратами."""
    week_start = _get_week_start_ts()
    rate = await config.get_live_donuts_to_stars_rate()
    _star_types_placeholder = ','.join('?' * len(_STAR_SPEND_TYPES))
    star_types_list = list(_STAR_SPEND_TYPES)

    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row

        # Траты пользователя — раздельно по пончикам и звёздам
        async with db.execute(f"""
            SELECT
                COALESCE(ABS(SUM(CASE WHEN action_type NOT IN ({_star_types_placeholder})
                             THEN amount ELSE 0 END)), 0) AS donuts_spent,
                COALESCE(ABS(SUM(CASE WHEN action_type IN ({_star_types_placeholder})
                             THEN amount ELSE 0 END)), 0) AS stars_spent
            FROM user_history
            WHERE user_id = ? AND created_at >= ? AND amount < 0
              AND action_type IN ({_SPEND_TYPES_PLACEHOLDER})
        """, (*star_types_list, *star_types_list, tg_id, week_start, *_SPEND_ACTION_TYPES)) as cursor:
            spend_row = await cursor.fetchone()
            donuts_spent = spend_row["donuts_spent"] if spend_row else 0
            stars_spent  = spend_row["stars_spent"]  if spend_row else 0
            user_normalized = donuts_spent * rate + stars_spent

        # Количество пользователей с бо́льшим нормализованным расходом
        # HAVING по алиасу не работает в PostgreSQL — оборачиваем в подзапрос
        async with db.execute(f"""
            SELECT COUNT(*) AS cnt FROM (
                SELECT ts_normalized FROM (
                    SELECT
                           COALESCE(ABS(SUM(CASE WHEN h.action_type NOT IN ({_star_types_placeholder})
                                       THEN h.amount ELSE 0 END)), 0) * ? +
                           COALESCE(ABS(SUM(CASE WHEN h.action_type IN ({_star_types_placeholder})
                                       THEN h.amount ELSE 0 END)), 0) AS ts_normalized
                    FROM users u
                    LEFT JOIN user_history h
                        ON  h.user_id     = u.tg_id
                        AND h.created_at  >= ?
                        AND h.amount      < 0
                        AND h.action_type IN ({_SPEND_TYPES_PLACEHOLDER})
                    WHERE u.tg_id != ?
                    GROUP BY u.tg_id
                ) sub
                WHERE ts_normalized > ?
            ) ranked
        """, (*star_types_list, rate, *star_types_list, week_start, *_SPEND_ACTION_TYPES,
              tg_id, user_normalized)) as cursor:
            cnt_row = await cursor.fetchone()
            rank = (cnt_row["cnt"] + 1) if cnt_row else 1

    return {
        "rank":         rank,
        "donuts_spent": donuts_spent,
        "stars_spent":  stars_spent,
    }


async def get_rocket_leaderboard_full():
    """Возвращает полную таблицу сорвиголов (без ограничения 50) для расчёта ранга."""
    import time
    import re
    week_ago = int(time.time()) - 7 * 86400
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT h.user_id, h.description,
                   CASE WHEN u.is_anonymous = 1 THEN 'Anonim' ELSE u.first_name END AS first_name,
                   CASE WHEN u.is_anonymous = 1 THEN '/static/img/anon.svg' ELSE u.photo_url END AS photo_url,
                   u.username
            FROM user_history h
            JOIN users u ON u.tg_id = h.user_id
            WHERE h.action_type LIKE 'rocket_win_%'
              AND h.created_at >= ?
        """, (week_ago,)) as cursor:
            rows = await cursor.fetchall()

    best: dict[int, dict] = {}
    multiplier_re = re.compile(r'x([\d.]+)')
    for row in rows:
        m = multiplier_re.search(row["description"])
        if not m:
            continue
        mult = float(m.group(1))
        uid = row["user_id"]
        if uid not in best or mult > best[uid]["max_multiplier"]:
            best[uid] = {
                "tg_id": uid,
                "first_name": row["first_name"],
                "photo_url": row["photo_url"],
                "username": row["username"],
                "max_multiplier": mult,
            }
    return sorted(best.values(), key=lambda x: x["max_multiplier"], reverse=True)


async def get_user_lucky_rank(tg_id: int) -> dict:
    """Возвращает реальное место и лучший коэффициент пользователя в таблице счастливчиков."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT MAX(amount) as best FROM user_history
            WHERE user_id = ? AND action_type = 'case_lucky_ratio'
        """, (tg_id,)) as cursor:
            row = await cursor.fetchone()
            if not row or row["best"] is None:
                return {"rank": None, "ratio": None}
            user_best = row["best"]
        async with db.execute("""
            SELECT COUNT(*) as cnt FROM (
                SELECT user_id FROM user_history
                WHERE action_type = 'case_lucky_ratio'
                GROUP BY user_id
                HAVING MAX(amount) > ?
            )
        """, (user_best,)) as cursor:
            cnt_row = await cursor.fetchone()
            rank = cnt_row["cnt"] + 1
    return {"rank": rank, "ratio": user_best / 100}


async def get_alltime_leaderboard():
    """За всё время: топ по суммарным тратам без ограничения по дате."""
    rate = await config.get_live_donuts_to_stars_rate()
    _star_types_placeholder = ','.join('?' * len(_STAR_SPEND_TYPES))
    star_types_list = list(_STAR_SPEND_TYPES)
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(f"""
            SELECT * FROM (
                SELECT
                    u.tg_id,
                    u.username,
                    CASE WHEN u.is_anonymous = 1 THEN 'Anonim' ELSE u.first_name END AS first_name,
                    CASE WHEN u.is_anonymous = 1 THEN '/static/img/anon.svg' ELSE u.photo_url END AS photo_url,
                    COALESCE(ABS(SUM(CASE
                        WHEN h.action_type NOT IN ({_star_types_placeholder})
                        THEN h.amount ELSE 0 END)), 0) AS donuts_spent,
                    COALESCE(ABS(SUM(CASE
                        WHEN h.action_type IN ({_star_types_placeholder})
                        THEN h.amount ELSE 0 END)), 0) AS stars_spent
                FROM users u
                LEFT JOIN user_history h
                    ON  h.user_id     = u.tg_id
                    AND h.amount      < 0
                    AND h.action_type IN ({_SPEND_TYPES_PLACEHOLDER})
                GROUP BY u.tg_id, u.username, u.first_name, u.photo_url, u.is_anonymous
            ) subq
            ORDER BY (donuts_spent * ? + stars_spent) DESC
            LIMIT 50
        """, (*star_types_list, *star_types_list, *_SPEND_ACTION_TYPES, rate)) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]


async def get_user_alltime_rank(tg_id: int) -> dict:
    """Возвращает место и суммарные траты пользователя в таблице за всё время."""
    rate = await config.get_live_donuts_to_stars_rate()
    _star_types_placeholder = ','.join('?' * len(_STAR_SPEND_TYPES))
    star_types_list = list(_STAR_SPEND_TYPES)

    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row

        # Траты пользователя — раздельно по пончикам и звёздам
        async with db.execute(f"""
            SELECT
                COALESCE(ABS(SUM(CASE WHEN action_type NOT IN ({_star_types_placeholder})
                             THEN amount ELSE 0 END)), 0) AS donuts_spent,
                COALESCE(ABS(SUM(CASE WHEN action_type IN ({_star_types_placeholder})
                             THEN amount ELSE 0 END)), 0) AS stars_spent
            FROM user_history
            WHERE user_id = ? AND amount < 0
              AND action_type IN ({_SPEND_TYPES_PLACEHOLDER})
        """, (*star_types_list, *star_types_list, tg_id, *_SPEND_ACTION_TYPES)) as cursor:
            spend_row = await cursor.fetchone()
            donuts_spent = spend_row["donuts_spent"] if spend_row else 0
            stars_spent  = spend_row["stars_spent"]  if spend_row else 0
            user_normalized = donuts_spent * rate + stars_spent

        # Количество пользователей с бо́льшим нормализованным расходом
        # HAVING по алиасу не работает в PostgreSQL — оборачиваем в подзапрос
        async with db.execute(f"""
            SELECT COUNT(*) AS cnt FROM (
                SELECT ts_normalized FROM (
                    SELECT
                           COALESCE(ABS(SUM(CASE WHEN h.action_type NOT IN ({_star_types_placeholder})
                                       THEN h.amount ELSE 0 END)), 0) * ? +
                           COALESCE(ABS(SUM(CASE WHEN h.action_type IN ({_star_types_placeholder})
                                       THEN h.amount ELSE 0 END)), 0) AS ts_normalized
                    FROM users u
                    LEFT JOIN user_history h
                        ON  h.user_id     = u.tg_id
                        AND h.amount      < 0
                        AND h.action_type IN ({_SPEND_TYPES_PLACEHOLDER})
                    WHERE u.tg_id != ?
                    GROUP BY u.tg_id
                ) sub
                WHERE ts_normalized > ?
            ) ranked
        """, (*star_types_list, rate, *star_types_list, *_SPEND_ACTION_TYPES,
              tg_id, user_normalized)) as cursor:
            cnt_row = await cursor.fetchone()
            rank = (cnt_row["cnt"] + 1) if cnt_row else 1

    return {
        "rank":         rank,
        "donuts_spent": donuts_spent,
        "stars_spent":  stars_spent,
    }


async def get_lucky_leaderboard():
    """Счастливчики: топ по лучшему одиночному результату из кейса."""
    async with aiosqlite.connect(DB_NAME) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT h.user_id, MAX(h.amount) AS best_ratio_x100,
                   CASE WHEN u.is_anonymous = 1 THEN 'Anonim' ELSE u.first_name END AS first_name,
                   CASE WHEN u.is_anonymous = 1 THEN '/static/img/anon.svg' ELSE u.photo_url END AS photo_url,
                   u.username
            FROM user_history h
            JOIN users u ON u.tg_id = h.user_id
            WHERE h.action_type = 'case_lucky_ratio'
            GROUP BY h.user_id, u.first_name, u.photo_url, u.username, u.is_anonymous
            ORDER BY best_ratio_x100 DESC
            LIMIT 50
        """) as cursor:
            rows = await cursor.fetchall()

    return [{
        "tg_id": row["user_id"],
        "first_name": row["first_name"],
        "photo_url": row["photo_url"],
        "username": row["username"],
        "ratio": row["best_ratio_x100"] / 100,
    } for row in rows]
