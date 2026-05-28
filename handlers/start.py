# handlers/start.py
import logging
from aiogram import Bot, Dispatcher, F
from aiogram.filters import CommandStart
from aiogram.types import (
    Message, PreCheckoutQuery,
    InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
)
from aiogram.enums import ButtonStyle

import config
import database
from db.db_referrals import distribute_referral_bonus_stars

# --- Premium emoji (как в admin.py) ---
E_STAR = '<tg-emoji emoji-id="5897920748101571572">⭐</tg-emoji>'
E_PARTY = '<tg-emoji emoji-id="5461151367559141950">🥳</tg-emoji>'
E_STOP = '<tg-emoji emoji-id="5260293700088511294">⛔</tg-emoji>'
E_EYES = '<tg-emoji emoji-id="5210956306952758910">👀</tg-emoji>'
E_CHECK = '<tg-emoji emoji-id="5206607081334906820">✅</tg-emoji>'


def register(dp: Dispatcher, bot: Bot):

    @dp.message(CommandStart())
    async def cmd_start(message: Message):
        user_id = message.from_user.id
        logging.info(f"Пользователь {user_id} нажал /start")

        # Игры, поддерживаемые в deep-link (/start game_<key>)
        _GAME_PARAMS = {"cases", "rocket", "pvp"}

        args = message.text.split()
        referrer_id = None
        game_param  = None   # параметр ?game= для WebApp URL
        nft_param   = None   # параметр ?nft=  для WebApp URL

        if len(args) > 1:
            arg = args[1]
            if arg.isdigit():
                referrer_id = int(arg)
            elif arg.startswith("game_"):
                key = arg[len("game_"):]
                if key in _GAME_PARAMS:
                    game_param = key
            elif arg.startswith("nft_"):
                # nft_gallery | nft_pack_{id} | nft_painting_{id}_{serial}
                nft_param = arg[len("nft_"):]   # "gallery", "pack_42", "painting_7_1" …

        try:
            await database.upsert_user(
                tg_id=user_id,
                username=message.from_user.username or "",
                first_name=message.from_user.first_name or "Без имени",
                photo_url=""
            )

            if referrer_id:
                await database.set_referrer(user_id, referrer_id)

            webapp_url = config.WEBAPP_URL

            # Локальный режим: если URL не задан, просто используем его как есть
            if not webapp_url:
                await message.answer(
                    f"{E_STOP} Ошибка: WEBAPP_URL не задан",
                    parse_mode="HTML"
                )
                return

            # Если пришёл deep-link на конкретную игру — добавляем ?game=
            if game_param:
                sep = "&" if "?" in webapp_url else "?"
                webapp_url = f"{webapp_url}{sep}game={game_param}"
            # Если пришёл deep-link на NFT раздел — добавляем ?nft=
            elif nft_param:
                sep = "&" if "?" in webapp_url else "?"
                webapp_url = f"{webapp_url}{sep}nft={nft_param}" 

            _GAME_LABELS = {
                "cases": "🎁 Открыть Кейсы",
                "rocket": "🚀 Открыть Ракету",
                "pvp": "⚔️ Открыть PVP Арену"
            }
            if game_param:
                webapp_btn_text = _GAME_LABELS.get(game_param, "Открыть приложение")
            elif nft_param:
                webapp_btn_text = "🖼 Открыть NFT Галерею"
            else:
                webapp_btn_text = "Открыть приложение" 

            markup = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="Канал",
                        url="https://t.me/Space_Donut",
                        style=ButtonStyle.PRIMARY
                    ),
                    InlineKeyboardButton(
                        text=webapp_btn_text,
                        web_app=WebAppInfo(url=webapp_url),
                        style=ButtonStyle.SUCCESS
                    ),
                ]
            ])

            _game_names = {"cases": "Кейсы", "rocket": "Ракету", "pvp": "PVP Арену"}
            if game_param:
                _default_game_name = "игру"
                text = f"...{_game_names.get(game_param, _default_game_name)}!"
            elif nft_param:
                text = "🖼 Открой NFT Галерею — лимитированные картины и коллекции!"
            else:
                text = "Привет! Нажми на кнопку ниже, чтобы открыть приложение." 
            if referrer_id and referrer_id != user_id:
                text += f"\n\n{E_PARTY} Вы перешли по пригласительной ссылке!"

            await message.answer(text, reply_markup=markup, parse_mode="HTML")

        except Exception as e:
            logging.error(f"Ошибка в /start: {e}")

    @dp.pre_checkout_query()
    async def process_pre_checkout_query(pre_checkout_query: PreCheckoutQuery):
        await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)

    @dp.message(F.successful_payment)
    async def process_successful_payment(message: Message):
        payment     = message.successful_payment
        payload     = payment.invoice_payload
        charge_id   = payment.telegram_payment_charge_id  # уникальный ID платежа от Telegram

        if payload.startswith("nfttopup_"):
            parts = payload.split("_")
            if len(parts) < 3:
                logging.warning(f"successful_payment: неверный NFT payload '{payload}', charge_id={charge_id}")
                return

            user_id      = int(parts[1])
            stars_amount = int(parts[2])
            payment_uuid = parts[3] if len(parts) >= 4 else None

            if message.from_user.id != user_id:
                logging.warning(
                    f"successful_payment nft mismatch: from_user={message.from_user.id}, "
                    f"payload_user={user_id} — начисление отклонено"
                )
                await message.answer(f"{E_STOP} Ошибка верификации платежа. Обратитесь в поддержку.")
                return

            is_new = await database.claim_payment_idempotent(charge_id, user_id, stars_amount)
            if not is_new:
                logging.warning(
                    f"successful_payment duplicate NFT (charge_id): charge_id={charge_id}, user_id={user_id}"
                )
                return

            if payment_uuid is not None:
                invoice_ok = await database.claim_invoice(payment_uuid)
                if not invoice_ok:
                    logging.warning(
                        f"successful_payment nft rejected (invoice cancelled/used): "
                        f"uuid={payment_uuid}, user_id={user_id}, charge_id={charge_id}"
                    )
                    return

            await database.add_nft_stars_to_user(user_id, stars_amount)
            await database.add_history_entry(
                user_id, "topup_nft_stars", f"Пополнение NFT-галереи на {stars_amount} ⭐", stars_amount
            )

            await message.answer(
                f"🖼 <b>Успешно!</b>\nВаш NFT-баланс пополнен на <b>{stars_amount} ⭐</b>!",
                parse_mode="HTML"
            )
            return

        if payload.startswith("topup_"):
            parts = payload.split("_")
            # Поддерживаем оба формата payload:
            #   старый:  topup_{user_id}_{stars}
            #   новый:   topup_{user_id}_{stars}_{uuid}   ← устойчив к дублям инвойсов
            if len(parts) < 3:
                logging.warning(f"successful_payment: неверный payload '{payload}', charge_id={charge_id}")
                return

            user_id      = int(parts[1])
            stars_amount = int(parts[2])
            # UUID присутствует начиная с новой версии payload (parts[3]).
            # Старые инвойсы (без UUID) не проверяются по pending_invoices,
            # но по-прежнему защищены уровнем 1 (charge_id идемпотентность).
            payment_uuid = parts[3] if len(parts) >= 4 else None

            # Защита от подмены: реальный плательщик должен совпадать
            # с user_id из payload, чтобы нельзя было зачислить звёзды чужому аккаунту.
            if message.from_user.id != user_id:
                logging.warning(
                    f"successful_payment mismatch: from_user={message.from_user.id}, "
                    f"payload_user={user_id} — начисление отклонено"
                )
                await message.answer(f"{E_STOP} Ошибка верификации платежа. Обратитесь в поддержку.")
                return

            # ── Уровень 1: идемпотентность по charge_id ──────────────────────
            # Защищает от ретраев вебхука — один charge_id обрабатывается только раз.
            is_new = await database.claim_payment_idempotent(charge_id, user_id, stars_amount)
            if not is_new:
                logging.warning(
                    f"successful_payment duplicate (charge_id): charge_id={charge_id}, "
                    f"user_id={user_id} — пропущено"
                )
                return

            # ── Уровень 2: проверка статуса инвойса ──────────────────────────
            # Инвойс должен быть в статусе 'pending'. Если пользователь создал
            # несколько инвойсов, все предыдущие при создании нового переходят
            # в 'cancelled' и не могут быть оплачены повторно.
            if payment_uuid is not None:
                invoice_ok = await database.claim_invoice(payment_uuid)
                if not invoice_ok:
                    logging.warning(
                        f"successful_payment rejected (invoice cancelled/used): "
                        f"uuid={payment_uuid}, user_id={user_id}, charge_id={charge_id}"
                    )
                    return
            # ────────────────────────────────────────────────────────────────

            await database.add_stars_to_user(user_id, stars_amount)
            # Зачисляем пополнение в банк — реальные звёзды пользователя
            # должны отражаться в ликвидности банка, иначе баланс не сходится.
            await database.bank_add_stars(stars_amount)
            await database.add_history_entry(
                user_id, "topup_stars", f"Пополнение баланса на {stars_amount} {E_STAR}", stars_amount
            )

            # Реферальный бонус: 10% от пополнения звёздами пригласившему
            await distribute_referral_bonus_stars(user_id, stars_amount)

            await message.answer(
                f"{E_PARTY} <b>Успешно!</b>\nВаш баланс пополнен на <b>{stars_amount} {E_STAR}</b>!",
                parse_mode="HTML"
            )