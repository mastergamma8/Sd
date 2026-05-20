// =====================================================
// tg-shop.js — Магазин TG Подарков (IDs 2011–2017, 60 ⭐)
// =====================================================

// Цена каждого подарка задаётся в config.py → TG_GIFTS[id].price
// и передаётся фронтенду через объект tgGifts
const TG_SHOP_GIFT_IDS = [2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019];

let tgShopSelectedGiftId = null;

// ── Открыть / закрыть страницу магазина ───────────────────────────────────

// openTgShop / closeTgShop — оставлены для обратной совместимости.
// Реальная логика переключения вида теперь в shop.js (openShopLimitedGifts).
function openTgShop() {
    if (typeof openShopLimitedGifts === 'function') openShopLimitedGifts();
}

function closeTgShop() {
    if (typeof closeShopLimitedGifts === 'function') closeShopLimitedGifts();
}

// ── Обновить тексты баннера/заголовка с актуальной ценой ─────────────────
// Подставляет {price} в строки i18n для баннера, заголовка страницы и кнопки

function updateTgShopTexts() {
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';

    // Берём цену первого доступного подарка (все одинаковые по умолчанию)
    const firstGift = (typeof tgGifts !== 'undefined')
        ? tgGifts[TG_SHOP_GIFT_IDS[0]] : null;
    const price = firstGift ? (firstGift.price ?? 60) : 60;

    const fill = (key) => (i18n[lang][key] || '').replace(/\{price\}/g, price);

    const bannerEl = document.getElementById('tg-shop-banner-desc');
    if (bannerEl) bannerEl.innerHTML = fill('tg_shop_banner_desc');

    const headerEl = document.getElementById('tg-shop-header-desc');
    if (headerEl) headerEl.innerHTML = fill('tg_shop_header_desc');
}

// ── Рендер сетки подарков ─────────────────────────────────────────────────

function renderTgShopGrid() {
    const grid = document.getElementById('tg-shop-grid');
    if (!grid) return;

    grid.innerHTML = '';

    TG_SHOP_GIFT_IDS.forEach(id => {
        const gift = (typeof tgGifts !== 'undefined') ? tgGifts[id] : null;
        const photo = gift ? gift.photo : '';

        const card = document.createElement('div');
        card.className = [
            'glass rounded-2xl p-3 flex flex-col items-center gap-2',
            'border border-purple-500/20 cursor-pointer',
            'active:scale-95 transition-all',
            'hover:border-purple-400/50 hover:bg-white/5',
            'shadow-[0_4px_15px_rgba(0,0,0,0.3)]'
        ].join(' ');
        card.onclick = () => openTgBuyModal(id);

        const price = gift ? (gift.price ?? '?') : '?';

        card.innerHTML = `
            <div class="w-full aspect-square rounded-xl bg-purple-500/10 flex items-center justify-center overflow-hidden border border-purple-400/15">
                <img src="${photo}" class="w-full h-full object-contain p-1 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]"
                     onerror="this.src='https://via.placeholder.com/80?text=🎁'">
            </div>
            <div class="flex items-center gap-1 mt-0.5">
                <span class="text-sm font-black text-yellow-300">${price}</span>
                <img src="/gifts/stars.png" class="w-3.5 h-3.5 object-contain" alt="⭐">
            </div>
        `;

        grid.appendChild(card);
    });
}

// ── Модальное окно покупки ────────────────────────────────────────────────

function openTgBuyModal(giftId) {
    if (typeof vibrate === 'function') vibrate('medium');
    tgShopSelectedGiftId = giftId;

    const gift   = (typeof tgGifts !== 'undefined') ? tgGifts[giftId] : null;
    const photo  = gift ? gift.photo : '';
    const price  = gift ? (gift.price ?? 0) : 0;
    const stars  = (typeof myStars !== 'undefined') ? myStars : 0;

    const imgEl  = document.getElementById('tg-buy-modal-img');
    const balEl  = document.getElementById('tg-buy-modal-balance');
    const btnEl  = document.getElementById('tg-buy-confirm-btn');

    if (imgEl)  imgEl.src = photo;
    if (balEl)  balEl.textContent = stars;

    // Подставляем цену в строку "Стоимость"
    const priceEl = document.getElementById('tg-buy-modal-price');
    if (priceEl) priceEl.textContent = price;

    // Подставляем цену в текст кнопки подтверждения
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
    const labelEl = document.getElementById('tg-buy-confirm-label');
    if (labelEl) {
        const btnText = (i18n[lang]?.tg_buy_confirm_btn || 'Купить за {price}')
            .replace(/\{price\}/g, price);
        labelEl.textContent = btnText;
    }

    // Если звёзд не хватает — красим кнопку
    if (btnEl) {
        if (stars < price) {
            btnEl.className = btnEl.className
                .replace('from-purple-600 to-pink-600', 'from-gray-600 to-gray-700')
                .replace('shadow-[0_0_20px_rgba(168,85,247,0.4)]', 'shadow-none');
        } else {
            // Восстанавливаем
            btnEl.style.background = '';
            btnEl.className = btnEl.className
                .replace('from-gray-600 to-gray-700', 'from-purple-600 to-pink-600');
        }
    }

    document.getElementById('tg-shop-buy-modal')?.classList.remove('hidden');
}

function closeTgBuyModal() {
    if (typeof vibrate === 'function') vibrate('light');
    tgShopSelectedGiftId = null;
    document.getElementById('tg-shop-buy-modal')?.classList.add('hidden');
}

// ── Подтверждение покупки ─────────────────────────────────────────────────

async function confirmTgGiftPurchase() {
    const stars = (typeof myStars !== 'undefined') ? myStars : 0;
    const selectedGift = (typeof tgGifts !== 'undefined' && tgShopSelectedGiftId)
        ? tgGifts[tgShopSelectedGiftId] : null;
    const price = selectedGift ? (selectedGift.price ?? 0) : 0;

    // Не хватает звёзд → открыть пополнение
    if (stars < price) {
        closeTgBuyModal();
        if (typeof openTopupModal === 'function') {
            openTopupModal();
        }
        return;
    }

    const btn = document.getElementById('tg-buy-confirm-btn');
    const originalHTML = btn ? btn.innerHTML : '';
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="opacity-70">${i18n[lang].tg_buy_sending}</span>`; }

    try {
        const resp = await fetch('/api/tg_shop/buy', {
            method:  'POST',
            headers: (typeof getApiHeaders === 'function') ? getApiHeaders() : { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ gift_id: tgShopSelectedGiftId })
        });

        const data = await resp.json();

        if (data.status === 'ok') {
            // Обновляем баланс
            if (typeof myStars !== 'undefined') myStars = data.stars ?? (myStars - price);
            if (typeof updateUI === 'function') updateUI();

            closeTgBuyModal();

            // Показываем успех
            const successMsg = i18n[(typeof currentLang !== 'undefined') ? currentLang : 'ru'].tg_buy_success;
            showNotify(successMsg, 'success');
        } else if (data.detail === 'not_enough_stars') {
            closeTgBuyModal();
            if (typeof openTopupModal === 'function') openTopupModal();
        } else {
            const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
            const msg = data.detail || i18n[lang].tg_buy_error;
            showNotify(msg, 'error');
        }
    } catch (e) {
        console.error('TG Shop buy error:', e);
        const errMsg = i18n[(typeof currentLang !== 'undefined') ? currentLang : 'ru'].err_conn;
        showNotify(errMsg, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
    }
}

// ── Экспорт ───────────────────────────────────────────────────────────────
window.openTgShop          = openTgShop;
window.closeTgShop         = closeTgShop;
window.openTgBuyModal      = openTgBuyModal;
window.closeTgBuyModal     = closeTgBuyModal;
window.confirmTgGiftPurchase = confirmTgGiftPurchase;
window.updateTgShopTexts   = updateTgShopTexts;
