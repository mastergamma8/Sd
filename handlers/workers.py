# workers.py
import asyncio
import logging
from aiogram import Bot
from aiogram.enums import ButtonStyle
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo

import config
import database


async def roulette_reminder_worker(bot: Bot):
    """Уведомляет пользователей, когда бесплатная прокрутка рулетки снова доступна."""
    while True:
        try:
            now = int(__import__('time').time())
            users_to_notify = await database.get_users_to_notify(now)

            if users_to_notify:
                markup = InlineKeyboardMarkup(inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text="Крутить рулетку",
                            web_app=WebAppInfo(url=config.WEBAPP_URL),
                            style=ButtonStyle.SUCCESS,
                            icon_custom_emoji_id="5357376676990851742",
                        )
                    ]
                ])
                text = (
                    "<tg-emoji emoji-id=\"5357376676990851742\">🐥</tg-emoji> Напоминание! Твоя бесплатная прокрутка рулетки снова доступна.\n\n"
                    "Заходи в приложение и забирай свои награды!"
                )

                for user_id in users_to_notify:
                    try:
                        await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=markup)
                        await database.mark_user_notified(user_id)
                        await asyncio.sleep(0.05)
                    except Exception as e:
                        logging.warning(f"Не удалось отправить напоминание {user_id}: {e}")
                        await database.mark_user_notified(user_id)
        except Exception as e:
            logging.error(f"Ошибка в воркере напоминаний рулетки: {e}")

        await asyncio.sleep(300)


async def gift_claim_reminder_worker(bot: Bot):
    """Уведомляет пользователей, когда кулдаун покупки подарка с главной страницы истёк."""
    while True:
        try:
            now = int(__import__('time').time())
            users_to_notify = await database.get_users_to_notify_gift_claim(now)

            if users_to_notify:
                markup = InlineKeyboardMarkup(inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text="Купить подарок",
                            web_app=WebAppInfo(url=config.WEBAPP_URL),
                            style=ButtonStyle.SUCCESS,
                            icon_custom_emoji_id="5963213811597970978",
                        )
                    ]
                ])
                text = (
                    "<tg-emoji emoji-id=\"5354970962729148604\">🐥</tg-emoji> <b>Ограничение на покупку снято!</b>\n\n"
                    "Вы снова можете покупать подарки за пончики. Заходите в приложение!"
                )

                for user_id in users_to_notify:
                    try:
                        await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=markup)
                        await database.mark_user_notified_gift_claim(user_id)
                        await asyncio.sleep(0.05)
                    except Exception as e:
                        logging.warning(f"Не удалось отправить уведомление о покупке {user_id}: {e}")
                        await database.mark_user_notified_gift_claim(user_id)
        except Exception as e:
            logging.error(f"Ошибка в воркере уведомлений о покупке: {e}")

        await asyncio.sleep(60)


async def gift_withdraw_reminder_worker(bot: Bot):
    """Уведомляет пользователей, когда кулдаун вывода подарка истёк."""
    while True:
        try:
            now = int(__import__('time').time())
            users_to_notify = await database.get_users_to_notify_gift_withdraw(now)

            if users_to_notify:
                markup = InlineKeyboardMarkup(inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text="Открыть приложение",
                            web_app=WebAppInfo(url=config.WEBAPP_URL),
                            style=ButtonStyle.SUCCESS,
                            icon_custom_emoji_id="5963213811597970978",
                        )
                    ]
                ])
                text = (
                    "<tg-emoji emoji-id=\"5963213811597970978\">🐥</tg-emoji> <b>Вывод подарка снова доступен!</b>\n\n"
                    "Прошло 5 часов — вы можете купить или вывести новый подарок. "
                    "Заходите в приложение!"
                )

                for user_id in users_to_notify:
                    try:
                        await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=markup)
                        await database.mark_user_notified_gift_withdraw(user_id)
                        await asyncio.sleep(0.05)
                    except Exception as e:
                        logging.warning(f"Не удалось отправить уведомление о выводе {user_id}: {e}")
                        await database.mark_user_notified_gift_withdraw(user_id)
        except Exception as e:
            logging.error(f"Ошибка в воркере уведомлений о выводе: {e}")

        await asyncio.sleep(120)


async def free_case_reminder_worker(bot: Bot):
    """Уведомляет пользователей, когда бесплатный кейс снова доступен (24 ч кулдаун)."""
    while True:
        try:
            now = int(__import__('time').time())
            users_to_notify = await database.get_users_to_notify_free_case(now)

            if users_to_notify:
                markup = InlineKeyboardMarkup(inline_keyboard=[
                    [
                        InlineKeyboardButton(
                            text="Открыть бесплатный кейс",
                            web_app=WebAppInfo(url=config.WEBAPP_URL),
                            style=ButtonStyle.SUCCESS,
                            icon_custom_emoji_id="5384216206796430362",
                        )
                    ]
                ])
                text = (
                    "<tg-emoji emoji-id=\"5384216206796430362\">🐥</tg-emoji> <b>Бесплатный кейс снова доступен!</b>\n\n"
                    "Прошло 24 часа — заходи в приложение и открывай свой бесплатный кейс!"
                )

                for user_id in users_to_notify:
                    try:
                        await bot.send_message(user_id, text, parse_mode="HTML", reply_markup=markup)
                        await database.mark_user_notified_free_case(user_id)
                        await asyncio.sleep(0.05)
                    except Exception as e:
                        logging.warning(f"Не удалось отправить уведомление о кейсе {user_id}: {e}")
                        await database.mark_user_notified_free_case(user_id)
        except Exception as e:
            logging.error(f"Ошибка в воркере уведомлений о бесплатном кейсе: {e}")

        await asyncio.sleep(300)


async def price_update_worker():
    """Обновляет цены подарков каждые 30 минут."""
    while True:
        await asyncio.sleep(1800)
        logging.info("⏱ Автоматическое обновление цен по таймеру (каждые 30 мин)...")
        try:
            await asyncio.to_thread(config.update_base_gifts_prices)
        except Exception as e:
            logging.error(f"Ошибка при автоматическом обновлении цен: {e}")


async def leaderboard_season_reset_worker(bot):
    """
    Еженедельный воркер: ждёт наступления следующего понедельника 00:00 UTC,
    после чего выдаёт призы топ-3 игрокам и отправляет уведомления.
    Работает бессрочно, запускаясь заново после каждого сброса.
    """
    from datetime import datetime, timezone, timedelta
    import config as cfg
    import database

    while True:
        try:
            # Вычисляем, сколько секунд осталось до следующего понедельника 00:00 UTC
            now = datetime.now(timezone.utc)
            days_ahead = (7 - now.weekday()) % 7 or 7  # понедельник = weekday 0
            next_monday = (now + timedelta(days=days_ahead)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            wait_secs = (next_monday - now).total_seconds()
            logging.info(f"[LeaderboardWorker] следующий сброс через {wait_secs:.0f} с ({next_monday.isoformat()})")
            await asyncio.sleep(wait_secs)
        except asyncio.CancelledError:
            return
        except Exception as e:
            logging.error(f"[LeaderboardWorker] ошибка при расчёте таймера: {e}")
            await asyncio.sleep(3600)
            continue

        # Получаем топ-3 лидеров из текущего рейтинга «транжир»
        try:
            board = await database.get_leaderboard()
            top3 = board[:3]
        except Exception as e:
            logging.error(f"[LeaderboardWorker] не удалось получить лидерборд: {e}")
            await asyncio.sleep(60)
            continue

        prizes_cfg = getattr(cfg, "LEADERBOARD_PRIZES", {})

        MEDAL = {1: "🥇", 2: "🥈", 3: "🥉"}
        PLACE_NAME = {1: "1-е место", 2: "2-е место", 3: "3-е место"}

        for i, user in enumerate(top3):
            place = i + 1
            prize = prizes_cfg.get(place)
            if not prize:
                continue

            tg_id = user["tg_id"]
            ptype = prize.get("type")
            amount = prize.get("amount", 0)
            gift_id = prize.get("gift_id")

            try:
                # — Выдача приза —
                if ptype == "donuts":
                    await database.add_points_to_user(tg_id, amount)
                    prize_text = f"+{amount:,} 🍩 пончиков"
                    await database.add_history_entry(
                        tg_id,
                        "season_prize_donuts",
                        f"Приз сезонного лидерборда [place:{place}]",
                        amount,
                    )
                elif ptype == "stars":
                    await database.add_stars_to_user(tg_id, amount)
                    prize_text = f"+{amount:,} ⭐ звёзд"
                    await database.add_history_entry(
                        tg_id,
                        "season_prize_stars",
                        f"Приз сезонного лидерборда [place:{place}]",
                        amount,
                    )
                elif ptype == "base_gift":
                    gift_info = cfg.BASE_GIFTS.get(gift_id, {})
                    prize_text = f"подарок «{gift_info.get('name', gift_id)}»"
                    val = gift_info.get("value", 0)
                    if val:
                        await database.add_points_to_user(tg_id, val)
                        prize_text += f" (~{val} 🍩)"
                    await database.add_history_entry(
                        tg_id,
                        "season_prize_gift",
                        f"Приз сезонного лидерборда [place:{place}] [gift_id:{gift_id}]",
                        val or 0,
                    )
                elif ptype == "tg_gift":
                    gift_info = cfg.MAIN_GIFTS.get(gift_id, {})
                    prize_text = f"TG-подарок «{gift_info.get('name', gift_id)}»"
                    val = gift_info.get("required_value", 0)
                    if val:
                        await database.add_stars_to_user(tg_id, val)
                        prize_text += f" (~{val} ⭐)"
                    await database.add_history_entry(
                        tg_id,
                        "season_prize_tg_gift",
                        f"Приз сезонного лидерборда [place:{place}] [gift_id:{gift_id}]",
                        val or 0,
                    )
                else:
                    prize_text = "приз"

                # — Уведомление победителю —
                medal = MEDAL.get(place, "🏆")
                place_name = PLACE_NAME.get(place, f"{place}-е место")
                text = (
                    f"{medal} <b>Поздравляем! Сезон завершён.</b>\n\n"
                    f"Вы заняли <b>{place_name}</b> в таблице лидеров этой недели "
                    f"и получаете приз:\n\n"
                    f"<b>{prize_text}</b>\n\n"
                    f"Спасибо за участие! Новый сезон уже начался 🚀"
                )
                markup = InlineKeyboardMarkup(inline_keyboard=[[
                    InlineKeyboardButton(
                        text="Открыть приложение",
                        web_app=WebAppInfo(url=config.WEBAPP_URL),
                    )
                ]])
                await bot.send_message(tg_id, text, parse_mode="HTML", reply_markup=markup)
                await asyncio.sleep(0.1)
                logging.info(f"[LeaderboardWorker] приз #{place} выдан пользователю {tg_id}: {prize_text}")

            except Exception as e:
                logging.error(f"[LeaderboardWorker] ошибка при выдаче приза {place} → {tg_id}: {e}")

        logging.info("[LeaderboardWorker] раздача призов завершена, жду следующего сброса")
        await asyncio.sleep(60)  # небольшая пауза чтобы не выдавать дважды
