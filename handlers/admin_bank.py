# handlers/admin_bank.py
# Команды администратора для управления банком:
#   /bankhelp      — справка по командам
#   /bankstatus    — полная статистика банка (ликвидность + доходы + сегодня + топ-3)
#   /bankday [дата] — статистика за конкретный день
#   /addbank       — пополнение банка

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message
from datetime import datetime, timezone

import config
import database
from .admin_constants import (
    E_DONUT, E_STAR, E_STOP, E_CHECK,
    E_MONEY, E_BANK, E_DROP, E_BOX, E_CHART,
    E_GIFT, E_CROSS,
)

# Вспомогательные эмодзи для нового интерфейса
_E_CALENDAR  = "📅"
_E_TROPHY    = "🏆"
_E_FIRE      = "🔥"
_E_PROFIT    = "💎"
_E_GAME      = "🎮"
_E_UP        = "📈"
_E_DOWN      = "📉"


def _fmt(n: int) -> str:
    """Форматирует число с разрядными пробелами: 1234567 → '1 234 567'."""
    return f"{n:,}".replace(",", " ")


def _rtp(paid: int, dep: int) -> str:
    if dep <= 0:
        return "—"
    pct = round(paid / dep * 100, 1)
    return f"{pct}%"


def _rtp_emoji(paid: int, dep: int) -> str:
    """Добавляет смысловой индикатор к RTP."""
    if dep <= 0:
        return "—"
    pct = paid / dep * 100
    if pct >= 95:
        return f"{pct:.1f}% {_E_DOWN}"   # слишком много отдаёт
    if pct <= 85:
        return f"{pct:.1f}% {_E_UP}"     # хорошая маржа
    return f"{pct:.1f}%"


def _display_name(user: dict) -> str:
    """Выбирает читаемое имя из username / first_name."""
    username = user.get("username")
    if username:
        return f"@{username}"
    first = user.get("first_name") or "Игрок"
    return first


def register(dp: Dispatcher, bot: Bot):

    # ──────────────────────────────────────────────────────────────────────────
    # /bankhelp
    # ──────────────────────────────────────────────────────────────────────────

    @dp.message(Command("bankhelp"))
    async def cmd_bank_help(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        await message.answer(
            f"<b>{E_MONEY} Команды управления банком</b>\n\n"
            f"<b>/bankstatus</b>\n"
            f"  Полная статистика: ликвидность, доходы, сегодняшний день, топ-3 активных игроков.\n\n"
            f"<b>/bankday</b> [ГГГГ-ММ-ДД]\n"
            f"  Статистика за конкретный день. Без даты — сегодня.\n"
            f"  Пример: <code>/bankday 2025-04-20</code>\n\n"
            f"<b>/addbank &lt;сумма&gt; [stars|donuts]</b>\n"
            f"  Пополнить банк. По умолчанию — звёзды.\n"
            f"  Примеры:\n"
            f"  <code>/addbank 500</code> — +500 ⭐\n"
            f"  <code>/addbank 1000 donuts</code> — +1000 🍩",
            parse_mode="HTML",
        )

    # ──────────────────────────────────────────────────────────────────────────
    # /bankstatus — полная статистика
    # ──────────────────────────────────────────────────────────────────────────

    @dp.message(Command("bankstatus"))
    async def cmd_bank_status(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        bank     = await database.get_bank()
        day      = await database.get_bank_day_stats()
        top3     = await database.get_top_active_today(limit=3)
        earnings = await database.get_bank_earnings_summary()

        rate = config.DONUTS_TO_STARS_RATE

        # ── Ликвидность ───────────────────────────────────────────────────────
        stars_bal       = bank.get("stars_balance", 0)
        donuts_bal      = bank.get("donuts_balance", 0)
        gift_bal        = bank.get("gift_value_balance", 0)
        donuts_in_stars = donuts_bal * rate
        total_liq       = stars_bal + donuts_in_stars + gift_bal

        # ── Сегодня ───────────────────────────────────────────────────────────
        day_dep   = day["deposited_value"]
        day_paid  = day["paid_out_value"]
        day_edge  = day["house_edge_value"]
        day_games = day["games_count"]
        today_str = day["day_date"]

        # ── Всё время ─────────────────────────────────────────────────────────
        total_dep   = earnings["gross_deposited"]
        total_paid  = earnings["total_paid_out"]
        total_edge  = earnings["house_edge"]
        total_games = earnings["games_count"]

        # ── Разбивка по валютам ───────────────────────────────────────────────
        stars_dep   = bank.get("stars_deposited", 0)
        stars_paid  = bank.get("stars_paid_out", 0)
        donuts_dep  = bank.get("donuts_deposited", 0)
        donuts_paid = bank.get("donuts_paid_out", 0)
        gift_dep    = bank.get("gift_value_balance", 0)  # нет отдельного gift_deposited в system_bank
        gift_paid   = bank.get("gift_value_paid_out", 0)
        # Из дневной статистики — подарки теперь пишутся отдельно
        day_gift_dep  = day.get("gift_value_deposited", 0)
        day_gift_paid = day.get("gift_value_paid_out", 0)

        # ── Топ-3 активных сегодня ────────────────────────────────────────────
        top_lines = []
        medals = ["🥇", "🥈", "🥉"]
        for i, u in enumerate(top3):
            name   = _display_name(u)
            games  = u["games_today"]
            volume = _fmt(u["volume_today"])
            top_lines.append(
                f"  {medals[i]} {name} — <b>{games}</b> игр · {volume} в ставках"
            )
        if not top_lines:
            top_lines = ["  Сегодня игр ещё не было"]
        top_block = "\n".join(top_lines)

        text = (
            f"<b>{E_BANK} Глобальный Банк — Полная статистика</b>\n"
            f"<i>Курс: 1 {E_DONUT} = {rate} {E_STAR}</i>\n"
            f"\n"

            # ── Ликвидность
            f"<b>{E_DROP} Ликвидность</b>\n"
            f"  {E_STAR} Звёзды:      <b>{_fmt(stars_bal)}</b>\n"
            f"  {E_DONUT} Пончики:     <b>{_fmt(donuts_bal)}</b>  (≈ {_fmt(donuts_in_stars)} {E_STAR})\n"
            f"  {E_GIFT} Подарки:     <b>{_fmt(gift_bal)}</b>\n"
            f"  {E_BOX} Итого:       <b>{_fmt(total_liq)} {E_STAR}</b>\n"
            f"\n"

            # ── Сегодня
            f"<b>{_E_CALENDAR} Сегодня ({today_str})</b>\n"
            f"  {_E_GAME} Игр сыграно:     <b>{_fmt(day_games)}</b>\n"
            f"  📥 Принято ставок:  <b>{_fmt(day_dep)}</b> {E_STAR}-value\n"
            f"  📤 Выплачено:       <b>{_fmt(day_paid)}</b> {E_STAR}-value\n"
            f"  {_E_PROFIT} Заработано:     <b>{_fmt(day_edge)}</b> {E_STAR}-value\n"
            f"  {E_CHART} RTP сегодня:    <b>{_rtp(day_paid, day_dep)}</b>\n"
            f"\n"

            # ── Топ-3 активных сегодня
            f"<b>{_E_TROPHY} Топ-3 активных сегодня</b>\n"
            f"{top_block}\n"
            f"\n"

            # ── Всё время
            f"<b>{_E_UP} Всего за всё время</b>\n"
            f"  {_E_GAME} Игр сыграно:     <b>{_fmt(total_games)}</b>\n"
            f"  📥 Принято ставок:  <b>{_fmt(total_dep)}</b> {E_STAR}-value\n"
            f"  📤 Выплачено:       <b>{_fmt(total_paid)}</b> {E_STAR}-value\n"
            f"  {_E_PROFIT} Заработано:     <b>{_fmt(total_edge)}</b> {E_STAR}-value\n"
            f"  {E_CHART} Общий RTP:      <b>{_rtp_emoji(total_paid, total_dep)}</b>\n"
            f"\n"

            # ── Разбивка по валютам
            f"<b>{E_STAR} Звёзды</b>\n"
            f"  Принято: <b>{_fmt(stars_dep)}</b>  ·  "
            f"Выплачено: <b>{_fmt(stars_paid)}</b>  ·  "
            f"RTP: <b>{_rtp(stars_paid, stars_dep)}</b>\n"
            f"\n"
            f"<b>{E_DONUT} Пончики</b>\n"
            f"  Принято: <b>{_fmt(donuts_dep)}</b>  ·  "
            f"Выплачено: <b>{_fmt(donuts_paid)}</b>  ·  "
            f"RTP: <b>{_rtp(donuts_paid, donuts_dep)}</b>\n"
            f"\n"
            f"<b>{E_GIFT} Подарки (1 gift_value = 1 {E_STAR})</b>\n"
            f"  Принято: <b>{_fmt(gift_dep)}</b>  ·  "
            f"Выплачено: <b>{_fmt(gift_paid)}</b>  ·  "
            f"RTP: <b>{_rtp(gift_paid, gift_dep)}</b>\n"
            f"\n"
            f"<b>{_E_CALENDAR} Подарки сегодня</b>\n"
            f"  Принято: <b>{_fmt(day_gift_dep)}</b>  ·  "
            f"Выплачено: <b>{_fmt(day_gift_paid)}</b>  ·  "
            f"RTP: <b>{_rtp(day_gift_paid, day_gift_dep)}</b>"
        )

        await message.answer(text, parse_mode="HTML")

    # ──────────────────────────────────────────────────────────────────────────
    # /bankday [ГГГГ-ММ-ДД]  — статистика за конкретный день
    # ──────────────────────────────────────────────────────────────────────────

    @dp.message(Command("bankday"))
    async def cmd_bank_day(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        args = message.text.split()
        target_day = None

        if len(args) >= 2:
            raw = args[1].strip()
            try:
                datetime.strptime(raw, "%Y-%m-%d")
                target_day = raw
            except ValueError:
                await message.answer(
                    f"{E_CROSS} Неверный формат даты. Используйте: <code>ГГГГ-ММ-ДД</code>\n"
                    f"Пример: <code>/bankday 2025-04-20</code>",
                    parse_mode="HTML",
                )
                return

        day = await database.get_bank_day_stats(target_day)

        d        = day["day_date"]
        dep      = day["deposited_value"]
        paid     = day["paid_out_value"]
        edge     = day["house_edge_value"]
        games    = day["games_count"]
        s_dep    = day["stars_deposited"]
        s_paid   = day["stars_paid_out"]
        don_dep  = day["donuts_deposited"]
        don_paid = day["donuts_paid_out"]

        rate = config.DONUTS_TO_STARS_RATE

        if dep == 0 and games == 0:
            note = "\n<i>Данных за этот день нет.</i>"
        else:
            note = ""

        await message.answer(
            f"<b>{_E_CALENDAR} Статистика за {d}</b>{note}\n"
            f"\n"
            f"  {_E_GAME} Игр сыграно:     <b>{_fmt(games)}</b>\n"
            f"  📥 Принято ставок:  <b>{_fmt(dep)}</b> {E_STAR}-value\n"
            f"  📤 Выплачено:       <b>{_fmt(paid)}</b> {E_STAR}-value\n"
            f"  {_E_PROFIT} Заработано:     <b>{_fmt(edge)}</b> {E_STAR}-value\n"
            f"  {E_CHART} RTP:             <b>{_rtp(paid, dep)}</b>\n"
            f"\n"
            f"<b>{E_STAR} Звёзды</b>\n"
            f"  Ставок: <b>{_fmt(s_dep)}</b>  ·  Выплат: <b>{_fmt(s_paid)}</b>  ·  RTP: <b>{_rtp(s_paid, s_dep)}</b>\n"
            f"\n"
            f"<b>{E_DONUT} Пончики</b>\n"
            f"  Ставок: <b>{_fmt(don_dep)}</b>  ·  Выплат: <b>{_fmt(don_paid)}</b>  ·  RTP: <b>{_rtp(don_paid, don_dep)}</b>\n"
            f"\n"
            f"<b>{E_GIFT} Подарки</b>\n"
            f"  Ставок: <b>{_fmt(day.get('gift_value_deposited', 0))}</b>  ·  "
            f"Выплат: <b>{_fmt(day.get('gift_value_paid_out', 0))}</b>  ·  "
            f"RTP: <b>{_rtp(day.get('gift_value_paid_out', 0), day.get('gift_value_deposited', 0))}</b>",
            parse_mode="HTML",
        )

    # ──────────────────────────────────────────────────────────────────────────
    # /addbank <сумма> [stars|donuts]
    # ──────────────────────────────────────────────────────────────────────────

    @dp.message(Command("addbank"))
    async def cmd_add_bank(message: Message):
        if message.from_user.id != config.ADMIN_ID:
            await message.answer(
                f"{E_STOP} У вас нет прав. Ваш ID: {message.from_user.id}",
                parse_mode="HTML",
            )
            return

        args = message.text.split()
        if len(args) < 2 or len(args) > 3:
            await message.answer(
                f"Использование: <code>/addbank &lt;сумма&gt; [stars|donuts]</code>\n"
                f"По умолчанию — звёзды.\n\n"
                f"Примеры:\n"
                f"<code>/addbank 500</code>\n"
                f"<code>/addbank 1000 donuts</code>",
                parse_mode="HTML",
            )
            return

        try:
            amount = int(args[1])
        except ValueError:
            await message.answer(f"{E_CROSS} Сумма должна быть целым числом.", parse_mode="HTML")
            return

        if amount <= 0:
            await message.answer(f"{E_CROSS} Сумма должна быть больше нуля.", parse_mode="HTML")
            return

        asset_type = "stars"
        if len(args) == 3:
            asset_type = args[2].lower()
            if asset_type not in ("stars", "donuts"):
                await message.answer(
                    f"{E_CROSS} Тип актива: <code>stars</code> или <code>donuts</code>.",
                    parse_mode="HTML",
                )
                return

        if asset_type == "donuts":
            await database.bank_add_donuts(amount)
            label = f"{_fmt(amount)} {E_DONUT} пончиков"
        else:
            await database.bank_add_stars(amount)
            label = f"{_fmt(amount)} {E_STAR} звёзд"

        bank  = await database.get_bank()
        _rate = config.DONUTS_TO_STARS_RATE
        total_liq = (
            bank.get("stars_balance", 0)
            + bank.get("donuts_balance", 0) * _rate
            + bank.get("gift_value_balance", 0)
        )

        await message.answer(
            f"{E_CHECK} Банк пополнен на <b>{label}</b>.\n\n"
            f"{E_STAR} Звёзды:  <b>{_fmt(bank.get('stars_balance', 0))}</b>\n"
            f"{E_DONUT} Пончики: <b>{_fmt(bank.get('donuts_balance', 0))}</b>"
            f"  (≈ <b>{_fmt(bank.get('donuts_balance', 0) * _rate)}</b> {E_STAR})\n"
            f"{E_BOX} Итого:   <b>{_fmt(total_liq)} {E_STAR}</b>",
            parse_mode="HTML",
        )
