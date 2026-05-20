// =====================================================
// profile-core.js
// Gift type helpers, profile rendering, state sync
// =====================================================

// ── Gift type detection ──────────────────────────────────────────────────────

function isRealTgGift(giftId) {
    return !!(tgGifts && tgGifts[giftId] && tgGifts[giftId].tg_gift_id);
}

function isBaseGift(giftId) {
    return !!(baseGifts && baseGifts[giftId] && !isRealTgGift(giftId) && !mainGifts[giftId]);
}

function isMainGift(giftId) {
    return !!(mainGifts && mainGifts[giftId] && !isRealTgGift(giftId));
}

function getGiftDefinitionById(giftId) {
    return mainGifts[giftId] || tgGifts[giftId] || baseGifts[giftId] || null;
}

function getTgGiftExchangeStars(giftId) {
    const giftDef  = getGiftDefinitionById(giftId);
    const baseValue = giftDef ? parseInt(giftDef.required_value || giftDef.value || 0) : 0;
    return isRealTgGift(giftId) ? baseValue + 10 : 0;
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function performGiftAction(giftId, action) {
    const endpoint = action === 'exchange' ? '/api/exchange' : '/api/withdraw';
    const res = await fetch(endpoint, {
        method: 'POST',
        headers: getApiHeaders(),
        body: JSON.stringify({ gift_id: giftId })
    });
    const data = await res.json();
    return { res, data };
}

async function redeemPromoCode() {
    const input = document.getElementById('promo-code-input');
    const code = (input?.value || '').trim();

    if (!code) {
        showNotify(i18n[currentLang]?.promo_empty || 'Введите промокод', 'warning');
        return;
    }

    const btn = document.getElementById('promo-redeem-btn');
    const original = btn ? btn.innerText : '';
    if (btn) {
        btn.disabled = true;
        btn.innerText = i18n[currentLang]?.processing || '⏳ Обработка...';
    }

    try {
        const res = await fetch('/api/promo/redeem', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ code })
        });
        const data = await res.json();

        if (!res.ok || data.status !== 'ok') {
            showNotify(data.detail || i18n[currentLang]?.promo_error || 'Не удалось активировать промокод', 'error');
            return;
        }

        if (data.balance !== undefined) myBalance = data.balance;
        if (data.stars !== undefined) myStars = data.stars;
        if (data.promo_case_credits) myPromoCases = data.promo_case_credits;
        updateUI();
        if (typeof renderCasesGrid === 'function') renderCasesGrid();
        closeModal('promo-modal');

        const detail = data.detail || {};
        let msg = i18n[currentLang]?.promo_success || 'Промокод активирован!';
        if (detail.type === 'case') {
            const caseName = (casesConfig && casesConfig[detail.case_id]) ? casesConfig[detail.case_id].name : `#${detail.case_id}`;
            msg = (i18n[currentLang]?.promo_case_success || 'Вы получили бесплатный кейс: {case}.')
                .replace('{case}', caseName);
        } else if (detail.type === 'stars') {
            msg = (i18n[currentLang]?.promo_stars_success || 'Начислено {value} ⭐ по промокоду.')
                .replace('{value}', detail.value);
        } else if (detail.type === 'donuts') {
            msg = (i18n[currentLang]?.promo_donuts_success || 'Начислено {value} 🍩 по промокоду.')
                .replace('{value}', detail.value);
        }
        showNotify(msg, 'success');
    } catch (e) {
        showNotify(i18n[currentLang]?.err_conn || 'Ошибка соединения', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = original || (i18n[currentLang]?.promo_redeem || 'Активировать');
        }
    }
}

function openPromoModal() {
    const input = document.getElementById('promo-code-input');
    if (input) input.value = '';
    openModal('promo-modal');
    setTimeout(() => input?.focus(), 150);
}


// ── State sync after server response ────────────────────────────────────────

function syncGiftStateFromResponse(data) {
    if (!data) return;
    if (data.balance  !== undefined) myBalance = data.balance;
    if (data.stars    !== undefined) myStars   = data.stars;
    if (data.user_gifts) myGifts = data.user_gifts;
    if (data.promo_case_credits) myPromoCases = data.promo_case_credits;
    if (typeof updateUI      === 'function') updateUI();
    if (typeof renderProfile === 'function') renderProfile();
}

// ── Profile rendering ────────────────────────────────────────────────────────

// SVG-аватарка «Anonim» — синий круг с буквой А
const ANON_AVATAR = '/static/img/anon.svg';
window.ANON_AVATAR = ANON_AVATAR;

function renderProfile() {
    const el = (id) => document.getElementById(id);

    const hideUsername = localStorage.getItem('hideUsername') === 'true';
    const isAnonymous  = localStorage.getItem('isAnonymous')  === 'true';

    if (isAnonymous) {
        el('profile-name').innerText = 'Anonim';
        el('profile-avatar').src     = ANON_AVATAR;
        el('profile-username').style.display = 'none';
    } else {
        if (tgUser.first_name) el('profile-name').innerText = tgUser.first_name;
        if (tgUser.photo_url)  el('profile-avatar').src     = tgUser.photo_url;

        const usernameEl = el('profile-username');
        if (hideUsername || !tgUser.username) {
            usernameEl.style.display = 'none';
        } else {
            usernameEl.style.display = '';
            usernameEl.innerText = `@${tgUser.username}`;
        }
    }

    const grid = el('profile-gifts-grid');
    if (!grid) return;
    grid.innerHTML = '';
    let hasGifts = false;

    for (const [id, amount] of Object.entries(myGifts)) {
        const giftDef = getGiftDefinitionById(id);

        if (amount > 0 && giftDef) {
            hasGifts = true;
            grid.innerHTML += `
                <div onclick="openWithdrawModal('${id}')"
                     class="glass rounded-2xl p-4 flex flex-col items-center relative transition-transform active:scale-95 cursor-pointer border border-green-500/20 bg-green-500/5">
                    <div class="absolute -top-2 -right-2 bg-gradient-to-r from-green-500 to-emerald-500 text-white text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center border-2 border-[#0f172a] shadow-lg z-10">${amount}</div>
                    <div class="bg-black/20 w-16 h-16 rounded-xl flex items-center justify-center mb-3 border border-white/5 shadow-inner">
                        <img src="${escapeHtml(getImgSrc(giftDef.photo))}" class="w-12 h-12 object-contain drop-shadow-md" onerror="this.src='https://via.placeholder.com/48'">
                    </div>
                    <span class="text-xs text-center font-bold text-white mb-1 leading-tight">${escapeHtml(giftDef.name)}</span>
                    <span class="text-[10px] font-bold text-gray-400 bg-black/30 px-2 py-0.5 rounded-full mt-auto">${i18n[currentLang].click}</span>
                </div>`;
        }
    }

    if (!hasGifts) {
        grid.innerHTML = `<div class="col-span-3 text-center text-blue-200/40 text-sm mt-6 border border-white/5 border-dashed rounded-2xl p-6">${i18n[currentLang].no_gifts_yet}</div>`;
    }
}

// ── Exports ──────────────────────────────────────────────────────────────────

window.isRealTgGift            = isRealTgGift;
window.isBaseGift              = isBaseGift;
window.isMainGift              = isMainGift;
window.getGiftDefinitionById   = getGiftDefinitionById;
window.getTgGiftExchangeStars  = getTgGiftExchangeStars;
window.performGiftAction       = performGiftAction;
window.syncGiftStateFromResponse = syncGiftStateFromResponse;
window.renderProfile           = renderProfile;

window.openPromoModal = openPromoModal;
window.redeemPromoCode = redeemPromoCode;
