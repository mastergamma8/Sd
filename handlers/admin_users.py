# handlers/admin_users.py
# Commands: /addtester, /deltester, /testers, /fixbalances
from db import db_async as aiosqlite
from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message

import config
import database
from db.db_core import DB_NAME
from .admin_constants import E_STOP, E_CHECK, E_CROSS, E_TIME, E_DONUT


def register(dp: Dispatcher, bot: Bot):

    # ── /fixbalances ───────────────────────────────────────────────────────────
    # Разовая миграция балансов пончиков (заменяет migrate_donut_balances.py).
    #
    # До:    balance хранился как TON-эквивалент (FLOAT, напр. 0.1, 0.5, 1.5)
    # После: balance хранится как целые пончики (1 пончик = 0.1 TON),
    #        т.е. старый 0.1 → 1, 0.5 → 5, 1.5 → 15.
    #
    # Формула: new_balance = ROUND(old_balance * 10)
    # ⚠️ Одноразовая операция — повторный запуск снова умножит балансы на 10.

    @dp.message(Command("fixbalances"))
    async def cmd_fix_balances(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args = message.text.split()
        if len(args) < 2 or args[1].lower() != "confirm":
            await message.answer(
                f"{E_TIME} <b>Миграция балансов {E_DONUT}</b>\n\n"
                "Пересчитывает <code>balance</code> у всех пользователей: "
                "из старого формата (TON-эквивалент) в новый "
                f"(целые пончики, 1 {E_DONUT} = 0.1 TON):\n\n"
                "<code>new_balance = ROUND(old_balance * 10)</code>\n"
                "Например: 0.1 → 1, 0.5 → 5, 1.5 → 15.\n\n"
                f"{E_STOP} Это <b>одноразовая</b> операция. Повторный запуск "
                "снова умножит все балансы на 10 и испортит данные.\n\n"
                "Для запуска подтвердите:\n"
                "<code>/fixbalances confirm</code>",
                parse_mode="HTML",
            )
            return

        await message.answer(f"{E_TIME} Выполняю миграцию балансов...", parse_mode="HTML")

        async with aiosqlite.connect(DB_NAME) as db:
            # Статистика до миграции
            async with db.execute(
                "SELECT COUNT(*), SUM(balance), MAX(balance) FROM users WHERE balance > 0"
            ) as cur:
                before = await cur.fetchone()

            # Сама миграция: new_balance = ROUND(old_balance * 10).
            # Приводим к numeric — у PostgreSQL нет ROUND(double precision),
            # а balance хранится как FLOAT8.
            result = await db.execute(
                "UPDATE users SET balance = ROUND((balance * 10)::numeric) "
                "WHERE balance IS NOT NULL"
            )
            updated = result.rowcount
            await db.commit()

            # Статистика после миграции
            async with db.execute(
                "SELECT COUNT(*), SUM(balance), MAX(balance) FROM users WHERE balance > 0"
            ) as cur:
                after = await cur.fetchone()

            # Проверка: не осталось ли дробных балансов
            async with db.execute(
                "SELECT COUNT(*) FROM users WHERE balance != FLOOR(balance)"
            ) as cur:
                frac = await cur.fetchone()

        before_count = before[0] or 0
        before_sum   = before[1] or 0.0
        before_max   = before[2] or 0.0

        after_count = after[0] or 0
        after_sum   = int(after[1] or 0)
        after_max   = int(after[2] or 0)

        frac_count = frac[0] or 0

        lines = [
            f"{E_CHECK} <b>Миграция балансов завершена</b>",
            f"<i>Строк обновлено: {updated}</i>",
            "",
            "<b>До:</b>",
            f"  Пользователей с балансом &gt; 0: <b>{before_count}</b>",
            f"  Сумма всех балансов: <b>{before_sum:.4f}</b>",
            f"  Максимальный баланс: <b>{before_max:.4f}</b>",
            "",
            "<b>После:</b>",
            f"  Пользователей с балансом &gt; 0: <b>{after_count}</b>",
            f"  Сумма всех балансов: <b>{after_sum}</b> {E_DONUT}",
            f"  Максимальный баланс: <b>{after_max}</b> {E_DONUT}",
            "",
        ]

        if frac_count == 0:
            lines.append(f"{E_CHECK} Все балансы целые. Миграция успешна.")
        else:
            lines.append(
                f"{E_CROSS} Осталось <b>{frac_count}</b> пользователей с дробными балансами."
            )

        await message.answer("\n".join(lines), parse_mode="HTML")

    # ── /addtester ─────────────────────────────────────────────────────────────

    @dp.message(Command("addtester"))
    async def cmd_add_tester(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args = message.text.split()[1:]
        if not args:
            await message.answer(
                "<b>👁 Добавление beta-тестеров</b>\n\n"
                "Использование:\n"
                "<code>/addtester &lt;ID&gt; [ID2 ID3 ...]</code>\n\n"
                "Можно указать один или несколько ID через пробел.\n"
                "<i>Beta-тестеры видят приложение даже при maintenance mode "
                "и при отключённых разделах/кейсах.</i>",
                parse_mode="HTML",
            )
            return

        added, already, invalid = [], [], []

        for raw in args:
            try:
                uid = int(raw)
            except ValueError:
                invalid.append(raw)
                continue
            ok = await database.add_beta_tester(uid)
            (added if ok else already).append(uid)

        lines = []
        if added:
            lines.append(f"{E_CHECK} Добавлены: " + ", ".join(f"<code>{i}</code>" for i in added))
        if already:
            lines.append("ℹ️ Уже в списке: " + ", ".join(f"<code>{i}</code>" for i in already))
        if invalid:
            lines.append(f"{E_CROSS} Неверный формат ID: " + ", ".join(f"<code>{i}</code>" for i in invalid))

        await message.answer("\n".join(lines) or "Нет данных для обработки.", parse_mode="HTML")

    # ── /deltester ─────────────────────────────────────────────────────────────

    @dp.message(Command("deltester"))
    async def cmd_del_tester(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args = message.text.split()[1:]
        if not args:
            await message.answer(
                "<b>🗑 Удаление beta-тестера</b>\n\n"
                "Использование:\n"
                "<code>/deltester &lt;ID&gt; [ID2 ID3 ...]</code>",
                parse_mode="HTML",
            )
            return

        removed, not_found, invalid = [], [], []

        for raw in args:
            try:
                uid = int(raw)
            except ValueError:
                invalid.append(raw)
                continue
            ok = await database.remove_beta_tester(uid)
            (removed if ok else not_found).append(uid)

        lines = []
        if removed:
            lines.append(f"{E_CHECK} Удалены: " + ", ".join(f"<code>{i}</code>" for i in removed))
        if not_found:
            lines.append("ℹ️ Не найдены: " + ", ".join(f"<code>{i}</code>" for i in not_found))
        if invalid:
            lines.append(f"{E_CROSS} Неверный формат ID: " + ", ".join(f"<code>{i}</code>" for i in invalid))

        await message.answer("\n".join(lines) or "Нет данных для обработки.", parse_mode="HTML")

    # ── /testers ───────────────────────────────────────────────────────────────

    @dp.message(Command("testers"))
    async def cmd_testers(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        testers = await database.get_beta_testers()

        if not testers:
            await message.answer(
                "<b>👁 Beta-тестеры</b>\n\nСписок пуст.\n\n"
                "Добавить: <code>/addtester &lt;ID&gt;</code>",
                parse_mode="HTML",
            )
            return

        lines = ["<b>👁 Beta-тестеры</b>\n"]
        for i, t in enumerate(testers, 1):
            lines.append(f"{i}. <code>{t['user_id']}</code>  — добавлен {t['added_at'][:10]}")

        lines.append(
            f"\n<i>Всего: {len(testers)}</i>\n\n"
            "Добавить: <code>/addtester &lt;ID&gt;</code>\n"
            "Удалить:  <code>/deltester &lt;ID&gt;</code>"
        )

        await message.answer("\n".join(lines), parse_mode="HTML")

    # ── /online ────────────────────────────────────────────────────────────────

    @dp.message(Command("online"))
    async def cmd_online(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        from routers.games_pvp import get_online_users_snapshot, ONLINE_TIMEOUT
        from db.db_core import DB_NAME
        snapshot = await get_online_users_snapshot()

        if not snapshot:
            await message.answer(
                "<b>🟢 Онлайн пользователи</b>\n\n"
                "⚫ Никого нет онлайн прямо сейчас.\n\n"
                f"<i>Пользователь считается онлайн, если он открывал приложение в последние {ONLINE_TIMEOUT} сек.</i>",
                parse_mode="HTML",
            )
            return

        # Подтягиваем username для каждого user_id
        user_ids = [row["user_id"] for row in snapshot]
        from db import db_async as aiosqlite
        async with aiosqlite.connect(DB_NAME) as db:
            db.row_factory = aiosqlite.Row
            placeholders = ",".join("?" * len(user_ids))
            async with db.execute(
                f"SELECT tg_id, username, first_name FROM users WHERE tg_id IN ({placeholders})",
                user_ids,
            ) as cur:
                rows = await cur.fetchall()
        user_map = {r["tg_id"]: dict(r) for r in rows}

        import time as _time
        lines = [f"<b>🟢 Онлайн: {len(snapshot)}</b>\n"]
        for i, row in enumerate(snapshot, 1):
            uid = row["user_id"]
            u = user_map.get(uid, {})
            uname = u.get("username") or u.get("first_name") or "—"
            ago = int(_time.time() - row["last_seen"])
            lines.append(
                f"{i}. @{uname}  |  <code>{uid}</code>  |  <i>{ago} сек назад</i>"
            )

        lines.append(f"\n<i>Таймаут: {ONLINE_TIMEOUT} сек</i>")
        await message.answer("\n".join(lines), parse_mode="HTML")

    # ── /users ─────────────────────────────────────────────────────────────────

    @dp.message(Command("users"))
    async def cmd_users(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        args = message.text.split()
        try:
            page = int(args[1]) if len(args) > 1 else 1
            page = max(1, page)
        except ValueError:
            page = 1

        PAGE_SIZE = 30
        offset = (page - 1) * PAGE_SIZE

        from db import db_async as aiosqlite
        from db.db_core import DB_NAME

        async with aiosqlite.connect(DB_NAME) as db:
            db.row_factory = aiosqlite.Row
            # Исключаем фейковых пользователей (tg_id >= 9_000_000_000)
            async with db.execute(
                "SELECT COUNT(*) FROM users WHERE tg_id < 9000000000"
            ) as cur:
                total = (await cur.fetchone())[0]
            async with db.execute(
                "SELECT tg_id, username, first_name FROM users "
                "WHERE tg_id < 9000000000 ORDER BY tg_id DESC LIMIT ? OFFSET ?",
                (PAGE_SIZE, offset),
            ) as cur:
                rows = await cur.fetchall()

        if not rows:
            await message.answer(
                f"<b>👥 Пользователи</b>\n\nСтраница {page} пуста.",
                parse_mode="HTML",
            )
            return

        total_pages = (total + PAGE_SIZE - 1) // PAGE_SIZE
        lines = [f"<b>👥 Пользователи</b>  (стр. {page}/{total_pages}, всего {total})\n"]
        for r in rows:
            uid   = r["tg_id"]
            uname = r["username"] or r["first_name"] or "—"
            lines.append(f"@{uname}  <code>{uid}</code>")

        if page < total_pages:
            lines.append(f"\n<i>Следующая страница: /users {page + 1}</i>")

        await message.answer("\n".join(lines), parse_mode="HTML")

    # ── /addton ────────────────────────────────────────────────────────────────

    @dp.message(Command("addton"))
    async def cmd_add_ton(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(f"{E_STOP} У вас нет прав.", parse_mode="HTML")
            return

        from .admin_constants import E_TON, ID_TON

        args = message.text.split()
        if len(args) != 3:
            await message.answer(
                f"{E_TON} <b>Начисление TON пользователю</b>\n\n"
                "Использование:\n"
                "<code>/addton &lt;user_id&gt; &lt;сумма&gt;</code>\n\n"
                "Пример: <code>/addton 123456789 5.5</code>",
                parse_mode="HTML",
            )
            return

        try:
            target_id = int(args[1])
        except ValueError:
            await message.answer(
                f"{E_CROSS} Неверный формат user_id. Укажите числовой Telegram ID.",
                parse_mode="HTML",
            )
            return

        try:
            amount = float(args[2])
        except ValueError:
            await message.answer(
                f"{E_CROSS} Неверный формат суммы. Укажите число, например: <code>5.5</code>",
                parse_mode="HTML",
            )
            return

        if amount <= 0:
            await message.answer(f"{E_CROSS} Сумма должна быть больше нуля.", parse_mode="HTML")
            return

        # Проверяем, что пользователь существует
        user_data = await database.get_user_data(target_id)
        if not user_data:
            await message.answer(
                f"{E_CROSS} Пользователь <code>{target_id}</code> не найден в базе.",
                parse_mode="HTML",
            )
            return

        old_balance = user_data.get("ton_balance", 0)

        # Начисляем TON-баланс
        await database.add_ton_balance(target_id, amount)

        # Логируем действие
        await database.log_action(
            target_id,
            "ton_admin_add",
            f"Администратор начислил {amount:.4f} TON (admin_id: {message.from_user.id})",
            amount,
        )

        new_data    = await database.get_user_data(target_id)
        new_balance = new_data.get("ton_balance", 0)

        await message.answer(
            f"{E_TON} <b>TON успешно начислены!</b>\n\n"
            f"Пользователь: <code>{target_id}</code>\n"
            f"Начислено: <b>+{amount:.4f} TON</b>\n"
            f"Баланс до: <b>{old_balance:.4f} TON</b>\n"
            f"Баланс после: <b>{new_balance:.4f} TON</b>",
            parse_mode="HTML",
        )

        # Уведомляем самого пользователя
        try:
            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
            from aiogram.enums import ButtonStyle
            markup = InlineKeyboardMarkup(inline_keyboard=[[
                InlineKeyboardButton(
                    text="Открыть приложение",
                    web_app=WebAppInfo(url=config.WEBAPP_URL),
                    style=ButtonStyle.SUCCESS,
                    icon_custom_emoji_id=ID_TON,
                )
            ]])
            e_ton = '<tg-emoji emoji-id="5424912684078348533">💎</tg-emoji>'
            await bot.send_message(
                target_id,
                f"{e_ton} <b>Вам начислен TON!</b>\n\n"
                f"Администратор пополнил ваш TON-баланс на <b>{amount:.4f} TON</b>.\n"
                f"Текущий TON-баланс: <b>{new_balance:.4f} TON</b>",
                parse_mode="HTML",
                reply_markup=markup,
            )
        except Exception:
            pass  # Уведомление пользователя опционально