// =====================================================
// profile-withdraw.js
// Withdraw / exchange modal logic, requirements check,
// and in-game gift action buttons (cases + roulette).
// Depends on: profile-core.js
// =====================================================

// ── Module state ─────────────────────────────────────────────────────────────

let currentWithdrawGiftId     = null;
let currentWithdrawIsTgGift   = false;
let currentWithdrawExchangeStars = 0;
let withdrawFeeAmount = (window.appConfig && window.appConfig.withdraw_fee)
    ? window.appConfig.withdraw_fee : 25;

// ── Spinner helper ────────────────────────────────────────────────────────────

const _SPINNER_HTML = `<svg class="animate-spin h-5 w-5 text-white mx-auto" fill="none" viewBox="0 0 24 24">
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
</svg>`;

function _setBtnLoading(btn, loading) {
    if (loading) {
        btn._savedHTML = btn.innerHTML;
        btn.disabled   = true;
        btn.innerHTML  = _SPINNER_HTML;
    } else {
        btn.disabled = false;
        if (btn._savedHTML !== undefined) btn.innerHTML = btn._savedHTML;
    }
}

// ── Approximate exchange calculation (client-side) ───────────────────────────

/**
 * Calculates an approximate star reward for a BASE/MAIN gift before the
 * server responds. Uses the separate gift_exchange_stars_rate, not the
 * bank rate.
 */
function calcApproxExchangeStars(giftId) {
    const rate = (window.appConfig && window.appConfig.gift_exchange_stars_rate != null)
        ? window.appConfig.gift_exchange_stars_rate
        : (window.appConfig && window.appConfig.donuts_to_stars_rate
            ? window.appConfig.donuts_to_stars_rate : 0.01);
    const gid = Number(giftId);
    if (baseGifts && baseGifts[gid]) {
        const val = parseInt(baseGifts[gid].value || 0);
        return Math.max(1, Math.floor(val * rate));
    }
    if (mainGifts && mainGifts[gid]) {
        const val = parseInt(mainGifts[gid].required_value || mainGifts[gid].value || 0);
        return Math.max(1, Math.floor(val * rate));
    }
    return 0;
}

// ── Withdraw requirements ─────────────────────────────────────────────────────

let _pendingWithdrawGiftId = null;

function _renderWithdrawRequirements(items) {
    const list = document.getElementById('wr-list');
    if (!list) return;

    list.innerHTML = items.map(req => {
        const done = req.done;

        const icon = done
            ? `<div class="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-400/50 flex items-center justify-center flex-shrink-0 shadow-[0_0_10px_rgba(52,211,153,0.2)]">
                   <svg class="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>
               </div>`
            : `<div class="w-8 h-8 rounded-full bg-red-500/15 border border-red-400/30 flex items-center justify-center flex-shrink-0">
                   <svg class="w-4 h-4 text-red-400/80" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
               </div>`;

        let subtext = '';
        if (req.type === 'referrals') {
            const cur  = req.current  || 0;
            const req2 = req.required || 0;
            const pct  = req2 > 0 ? Math.min(100, Math.round(cur / req2 * 100)) : 0;
            subtext = `
                <div class="flex items-center gap-2 mt-1.5">
                    <div class="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
                        <div class="h-full rounded-full ${done ? 'bg-emerald-400' : 'bg-blue-400/70'} transition-all duration-500" style="width:${pct}%"></div>
                    </div>
                    <span class="text-[11px] text-white/40 font-medium tabular-nums">${cur}/${req2}</span>
                </div>`;
        }

        let actionBtn = '';
        if (!done) {
            if (req.type === 'referrals') {
                actionBtn = `<button onclick="_wrShareInvite()" class="flex-shrink-0 text-xs bg-blue-500/25 border border-blue-400/40 text-blue-300 px-3 py-1.5 rounded-xl font-bold active:scale-95 transition-transform whitespace-nowrap">${i18n[currentLang].wr_btn_invite || 'Пригласить'}</button>`;
            } else if (req.url) {
                actionBtn = `<a href="${req.url}" target="_blank" rel="noopener" class="flex-shrink-0 text-xs bg-blue-500/25 border border-blue-400/40 text-blue-300 px-3 py-1.5 rounded-xl font-bold active:scale-95 transition-transform whitespace-nowrap">${i18n[currentLang].wr_btn_complete || 'Выполнить'}</a>`;
            }
        }

        return `
            <div class="rounded-2xl p-3.5 flex items-start gap-3 border transition-all ${done
                ? 'bg-emerald-500/5 border-emerald-400/20'
                : 'bg-white/[0.03] border-white/8'}">
                <div class="mt-0.5">${icon}</div>
                <div class="flex-1 min-w-0">
                    <span class="text-sm font-semibold leading-tight ${done ? 'text-white/50 line-through decoration-white/30' : 'text-white'}">${req.title}</span>
                    ${subtext}
                </div>
                ${actionBtn}
            </div>`;
    }).join('');
}

function _wrShareInvite() {
    vibrate('medium');
    const link = (typeof getRefLink === 'function') ? getRefLink() : '';
    const text = (i18n && i18n[currentLang] && i18n[currentLang].share_text) || 'Присоединяйся!';
    if (window.Telegram && Telegram.WebApp) {
        Telegram.WebApp.openTelegramLink(
            `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`
        );
    }
}
window._wrShareInvite = _wrShareInvite;

async function recheckWithdrawRequirements() {
    const btn      = document.getElementById('wr-check-btn');
    const statusEl = document.getElementById('wr-status');
    if (btn) {
        btn.disabled  = true;
        btn.innerHTML = `<svg class="animate-spin h-4 w-4 inline mr-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>${i18n[currentLang].wr_checking || 'Проверяем...'}`;
    }
    if (statusEl) statusEl.innerHTML = '';

    try {
        const res  = await fetch('/api/withdraw/requirements', { headers: getApiHeaders() });
        const data = await res.json();

        _renderWithdrawRequirements(data.requirements || []);

        if (data.all_done) {
            if (statusEl) statusEl.innerHTML = `<div class="flex items-center justify-center gap-2 text-emerald-400 text-sm font-semibold"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"/></svg>${i18n[currentLang].wr_all_done || 'Все условия выполнены!'}</div>`;
            setTimeout(() => {
                closeModal('withdraw-requirements-modal');
                setTimeout(() => {
                    if (_pendingWithdrawGiftId !== null) {
                        _openWithdrawModalDirect_impl(_pendingWithdrawGiftId);
                        _pendingWithdrawGiftId = null;
                    }
                }, 320);
            }, 700);
        } else {
            const unmet = (data.requirements || []).filter(r => !r.done).map(r => r.title);
            if (statusEl) {
                statusEl.innerHTML = `
                    <div class="text-left rounded-xl bg-red-500/10 border border-red-400/20 p-3">
                        <p class="text-red-400 text-xs font-bold mb-1.5">${i18n[currentLang].wr_unmet_label || 'Не выполнено:'}</p>
                        ${unmet.map(t => `<p class="text-red-300/80 text-xs flex items-start gap-1.5"><span class="text-red-400 mt-0.5">•</span>${t}</p>`).join('')}
                    </div>`;
            }
        }
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<p class="text-red-400 text-xs text-center">${i18n[currentLang]?.err_network || 'Ошибка сети'}</p>`;
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = i18n[currentLang].wr_check_btn || 'Проверить выполнение'; }
    }
}
window.recheckWithdrawRequirements = recheckWithdrawRequirements;

/**
 * Checks requirements and either proceeds to withdraw or opens the
 * requirements modal if conditions are not yet met.
 */
async function _checkRequirementsAndWithdraw(giftId) {
    _pendingWithdrawGiftId = giftId;
    try {
        const res  = await fetch('/api/withdraw/requirements', { headers: getApiHeaders() });
        const data = await res.json();

        if (data.all_done) {
            _pendingWithdrawGiftId = null;
            confirmWithdrawGift(giftId, false);
        } else {
            closeModal('withdraw-confirm-modal');
            setTimeout(() => {
                _renderWithdrawRequirements(data.requirements || []);
                const statusEl = document.getElementById('wr-status');
                if (statusEl) statusEl.innerHTML = '';
                openModal('withdraw-requirements-modal');
            }, 320);
        }
    } catch (e) {
        // Network error — proceed anyway
        _pendingWithdrawGiftId = null;
        confirmWithdrawGift(giftId, false);
    }
}

// ── Withdraw / exchange modal ─────────────────────────────────────────────────

/** Entry point — requirements are checked only when the user taps Withdraw. */
function openWithdrawModal(giftId) {
    vibrate('medium');
    _openWithdrawModalDirect_impl(giftId);
}

function _openWithdrawModalDirect_impl(giftId) {
    currentWithdrawGiftId = giftId;
    const giftDef = getGiftDefinitionById(giftId);
    if (!giftDef) return;

    currentWithdrawIsTgGift      = isRealTgGift(giftId);
    currentWithdrawExchangeStars = getTgGiftExchangeStars(giftId);

    const titleEl       = document.getElementById('wcm-title');
    const descEl        = document.getElementById('wcm-desc');
    const imgEl         = document.getElementById('wcm-gift-img');
    const nameEl        = document.getElementById('wcm-gift-name');
    const feeRow        = document.getElementById('wcm-fee-row');
    const tgActions     = document.getElementById('wcm-tg-actions');
    const baseActions   = document.getElementById('wcm-base-actions');
    const keepRow       = document.getElementById('wcm-keep-row');
    const exchangeInfo  = document.getElementById('wcm-exchange-info');
    const btnConfirm    = document.getElementById('wcm-btn-confirm');
    const btnConfirmLabel = document.getElementById('wcm-btn-confirm-label');
    const feeAmount     = document.getElementById('wcm-fee-amount');

    imgEl.src        = getImgSrc(giftDef.photo);
    nameEl.innerText = giftDef.name;

    // Reset all sections
    feeRow.classList.add('hidden');
    tgActions.classList.add('hidden');
    if (baseActions) baseActions.classList.add('hidden');
    if (keepRow)     keepRow.classList.add('hidden');
    exchangeInfo.classList.add('hidden');

    if (currentWithdrawIsTgGift) {
        // ── TG gift: withdraw to Telegram or exchange for stars ──────────────
        titleEl.innerText = i18n[currentLang].tg_gift_modal_title;
        descEl.innerText  = i18n[currentLang].tg_gift_modal_desc;
        tgActions.classList.remove('hidden');
        if (keepRow) keepRow.classList.remove('hidden');
        exchangeInfo.classList.remove('hidden');

        exchangeInfo.innerHTML = `${i18n[currentLang].btn_tg_exchange}: +${currentWithdrawExchangeStars} <img src="/gifts/stars.png" class="w-4 h-4 inline-block align-middle pb-[2px] object-contain">`;
        document.getElementById('wcm-btn-withdraw-tg').textContent   = i18n[currentLang].btn_tg_withdraw;
        document.getElementById('wcm-btn-exchange').innerHTML         = `<div class="flex items-center justify-center gap-1.5"><span>${i18n[currentLang].btn_tg_exchange} +${currentWithdrawExchangeStars}</span> <img src="/gifts/stars.png" class="w-5 h-5 object-contain"></div>`;
        document.getElementById('wcm-btn-keep').textContent          = i18n[currentLang].btn_tg_keep;

        document.getElementById('wcm-btn-withdraw-tg').onclick = () => confirmWithdrawGift(giftId, true);
        document.getElementById('wcm-btn-exchange').onclick    = () => confirmExchangeGift(giftId);
        document.getElementById('wcm-btn-keep').onclick        = () => closeModal('withdraw-confirm-modal');

    } else if (isBaseGift(Number(giftId)) || isMainGift(Number(giftId))) {
        // ── BASE / MAIN gift: withdraw for fee or exchange for stars ─────────
        titleEl.innerText = i18n[currentLang].tg_gift_modal_title || 'Ваш подарок';
        descEl.innerText  = i18n[currentLang].tg_gift_modal_desc  || '';
        if (baseActions) baseActions.classList.remove('hidden');
        feeRow.classList.remove('hidden');
        btnConfirmLabel.innerText = i18n[currentLang].withdraw_confirm_btn || 'Вывести за';
        feeAmount.innerText       = withdrawFeeAmount;
        btnConfirm.onclick        = () => _checkRequirementsAndWithdraw(giftId);
        if (keepRow) keepRow.classList.remove('hidden');

        const wcmStarsBtn = document.getElementById('wcm-btn-exchange-donuts');
        if (wcmStarsBtn) {
            const t           = i18n[currentLang];
            const approxStars = calcApproxExchangeStars(giftId);

            const _setLabel = (stars, loading) => {
                const prefix = t.btn_exchange_stars || 'Обменять на';
                wcmStarsBtn.innerHTML = loading
                    ? `<div class="flex items-center justify-center gap-2"><svg class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg><span>${prefix} ...</span></div>`
                    : `<div class="flex items-center justify-center gap-1.5"><span>${prefix} ${stars}</span> <img src="/gifts/stars.png" class="w-5 h-5 object-contain"></div>`;
            };

            _setLabel(approxStars, true);
            fetch(`/api/exchange-preview?gift_id=${Number(giftId)}`, { headers: getApiHeaders() })
                .then(r => r.json())
                .then(data => { _setLabel(data.stars_reward ?? approxStars, false); })
                .catch(() => _setLabel(approxStars, false));

            wcmStarsBtn.onclick = async () => {
                wcmStarsBtn.disabled = true;
                wcmStarsBtn._savedHTML = wcmStarsBtn.innerHTML;
                wcmStarsBtn.innerHTML  = _SPINNER_HTML;
                try {
                    const res  = await fetch('/api/exchange-for-stars', {
                        method:  'POST',
                        headers: getApiHeaders(),
                        body:    JSON.stringify({ gift_id: Number(giftId) })
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.detail || 'Exchange error');
                    syncGiftStateFromResponse(data);
                    closeModal('withdraw-confirm-modal');
                    showNotify(`${t.exchange_stars_success || 'Обменяно!'} +${data.stars_reward} ⭐`, 'success');
                } catch (e) {
                    showNotify((e && e.message) ? e.message : (t.err_conn || 'Connection error'), 'error');
                } finally {
                    wcmStarsBtn.disabled = false;
                    if (wcmStarsBtn._savedHTML) wcmStarsBtn.innerHTML = wcmStarsBtn._savedHTML;
                }
            };
        }

        const keepBtn = document.getElementById('wcm-btn-keep');
        if (keepBtn) {
            keepBtn.textContent = i18n[currentLang].btn_tg_keep;
            keepBtn.onclick     = () => closeModal('withdraw-confirm-modal');
        }

    } else {
        // ── Generic gift ──────────────────────────────────────────────────────
        titleEl.innerText         = i18n[currentLang].withdraw_confirm_title;
        descEl.innerText          = i18n[currentLang].withdraw_confirm_desc;
        feeRow.classList.remove('hidden');
        btnConfirmLabel.innerText = i18n[currentLang].withdraw_confirm_btn || 'Вывести за';
        feeAmount.innerText       = withdrawFeeAmount;
        btnConfirm.onclick        = () => _checkRequirementsAndWithdraw(giftId);
    }

    openModal('withdraw-confirm-modal');
}

// ── Confirm withdraw ──────────────────────────────────────────────────────────

async function confirmWithdrawGift(giftId, isTgGift = false) {
    vibrate('heavy');
    const btn          = isTgGift
        ? document.getElementById('wcm-btn-withdraw-tg')
        : document.getElementById('wcm-btn-confirm');
    const originalHtml = btn.innerHTML;
    _setBtnLoading(btn, true);

    try {
        const { res, data } = await performGiftAction(giftId, 'withdraw');

        if (res.status === 429) {
            if (data.detail && data.detail.error === 'cooldown') {
                const msg = i18n[currentLang].cooldown_withdraw_wait
                    .replace('{h}', data.detail.hours)
                    .replace('{m}', data.detail.minutes);
                closeModal('withdraw-confirm-modal');
                showNotify(msg, 'warning');
            } else {
                showNotify(data.detail || 'Limit reached', 'warning');
            }
            return;
        }

        if (!res.ok) {
            if (data.detail === 'not_enough_stars') {
                closeModal('withdraw-confirm-modal');
                showNotify(i18n[currentLang].not_enough_stars_alert, 'error', () => {
                    openModal('topup-stars-modal');
                });
                return;
            }
            throw new Error(data.detail || 'Withdraw error');
        }

        syncGiftStateFromResponse(data);
        closeModal('withdraw-confirm-modal');

        if (isTgGift) {
            showNotify(i18n[currentLang].tg_withdraw_success || 'Подарок отправлен!', 'success');
        } else {
            setTimeout(() => openModal('success-withdraw-modal'), 300);
        }

    } catch (e) {
        console.error(e);
        showNotify(i18n[currentLang].err_conn, 'error');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled  = false;
    }
}

// ── Confirm exchange (TG gift → stars) ───────────────────────────────────────

async function confirmExchangeGift(giftId) {
    vibrate('heavy');
    const btn          = document.getElementById('wcm-btn-exchange');
    const originalHtml = btn.innerHTML;
    _setBtnLoading(btn, true);

    try {
        const { res, data } = await performGiftAction(giftId, 'exchange');
        if (!res.ok) throw new Error(data.detail || 'Exchange error');
        syncGiftStateFromResponse(data);
        closeModal('withdraw-confirm-modal');
        showNotify(`${i18n[currentLang].tg_exchange_success} +${data.exchange_stars || getTgGiftExchangeStars(giftId)} ⭐`, 'success');
    } catch (e) {
        console.error(e);
        showNotify(i18n[currentLang].err_conn, 'error');
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled  = false;
    }
}

// ── In-game gift action error handler ────────────────────────────────────────

function _closeGameModal(source) {
    if (source === 'case') closeCaseAnimation();
    else closeModal('roulette-result-modal');
}

/**
 * Unified error handler for withdraw/exchange actions triggered from inside
 * game result modals (cases, roulette). Returns true if an error was handled.
 */
function _handleWithdrawErrorInGame(res, data, source) {
    const t = (i18n && i18n[currentLang]) ? i18n[currentLang] : {};

    if (res.status === 429) {
        const detail = data.detail;
        if (detail && typeof detail === 'object' && detail.error === 'cooldown') {
            const h   = detail.hours   ?? 0;
            const m   = detail.minutes ?? 0;
            const msg = (t.cooldown_withdraw_wait || 'Подождите {h}ч {m}м')
                .replace('{h}', h).replace('{m}', m);
            showNotify(msg, 'warning');
        } else {
            const msg = typeof detail === 'string' ? detail : (t.limit_reached || 'Лимит достигнут. Попробуйте позже.');
            showNotify(msg, 'warning');
        }
        return true;
    }

    if (!res.ok) {
        const detail = data.detail;
        if (detail === 'not_enough_stars') {
            _closeGameModal(source);
            showNotify(t.not_enough_stars_alert || 'Недостаточно звёзд для вывода', 'error', () => {
                openModal('topup-stars-modal');
            });
            return true;
        }
        const msg = typeof detail === 'object'
            ? (detail?.message || detail?.detail || t.err_conn || 'Ошибка')
            : (detail || t.err_conn || 'Ошибка');
        showNotify(msg, 'error');
        return true;
    }

    return false;
}

// ── In-game gift action buttons (case / roulette result screens) ─────────────

function configureCaseGiftActionsIfNeeded(giftId, source = 'case', isDemo = false) {
    const prefix            = source === 'case' ? 'cam' : 'rr';
    const actionsBox        = document.getElementById(`${prefix}-gift-actions`);
    const closeBtn          = document.getElementById(`${prefix}-btn-close`);
    const withdrawBtn       = document.getElementById(`${prefix}-btn-withdraw`);
    const exchangeBtn       = document.getElementById(`${prefix}-btn-exchange`);
    const exchangeDonutsBtn = document.getElementById(`${prefix}-btn-exchange-donuts`);
    const keepBtn           = document.getElementById(`${prefix}-btn-keep`);

    if (!actionsBox || !closeBtn || !withdrawBtn || !exchangeBtn || !keepBtn) return;

    const giftDef  = getGiftDefinitionById(giftId);
    const isTgGift = isRealTgGift(giftId);
    const isBase   = isBaseGift(giftId);

    if (!giftDef || (!isTgGift && !isBase)) {
        actionsBox.classList.add('hidden');
        closeBtn.classList.remove('hidden');
        return;
    }

    actionsBox.classList.remove('hidden');
    closeBtn.classList.add('hidden');
    keepBtn.textContent = i18n[currentLang].btn_tg_keep;
    keepBtn.onclick     = () => _closeGameModal(source);

    if (isTgGift) {
        // ── TG gift in game ──────────────────────────────────────────────────
        const exchangeStars = getTgGiftExchangeStars(giftId);

        withdrawBtn.textContent = i18n[currentLang].btn_tg_withdraw;
        withdrawBtn.classList.remove('hidden');
        exchangeBtn.innerHTML = `<div class="flex items-center justify-center gap-1.5"><span>${i18n[currentLang].btn_tg_exchange} +${exchangeStars}</span> <img src="/gifts/stars.png" class="w-5 h-5 object-contain"></div>`;
        exchangeBtn.classList.remove('hidden');
        if (exchangeDonutsBtn) exchangeDonutsBtn.classList.add('hidden');

        withdrawBtn.onclick = async () => {
            if (isDemo) { _closeGameModal(source); return; }
            _setBtnLoading(withdrawBtn, true);
            try {
                const { res, data } = await performGiftAction(giftId, 'withdraw');
                if (_handleWithdrawErrorInGame(res, data, source)) return;
                syncGiftStateFromResponse(data);
                _closeGameModal(source);
                showNotify(i18n[currentLang].tg_withdraw_success || 'Подарок отправлен!', 'success');
            } catch (e) {
                showNotify(i18n[currentLang]?.err_conn || 'Ошибка соединения', 'error');
            } finally {
                _setBtnLoading(withdrawBtn, false);
            }
        };

        exchangeBtn.onclick = async () => {
            if (isDemo) { _closeGameModal(source); return; }
            _setBtnLoading(exchangeBtn, true);
            try {
                const { res, data } = await performGiftAction(giftId, 'exchange');
                if (_handleWithdrawErrorInGame(res, data, source)) return;
                syncGiftStateFromResponse(data);
                _closeGameModal(source);
                showNotify(`${i18n[currentLang].tg_exchange_success || 'Обменяно!'} +${data.exchange_stars || exchangeStars} ⭐`, 'success');
            } catch (e) {
                showNotify(i18n[currentLang]?.err_conn || 'Ошибка соединения', 'error');
            } finally {
                _setBtnLoading(exchangeBtn, false);
            }
        };

    } else {
        // ── BASE / MAIN gift in game ──────────────────────────────────────────
        const approxStars = calcApproxExchangeStars(giftId);

        withdrawBtn.innerHTML = `<div class="flex items-center justify-center gap-1.5"><span>${i18n[currentLang].withdraw_confirm_btn || 'Вывести за'} ${withdrawFeeAmount}</span> <img src="/gifts/stars.png" class="w-5 h-5 object-contain"></div>`;
        withdrawBtn.classList.remove('hidden');

        const _setExchangeLabel = (stars, loading) => {
            const pfx = i18n[currentLang].btn_exchange_stars || 'Обменять на';
            exchangeBtn.innerHTML = loading
                ? `<div class="flex items-center justify-center gap-2"><svg class="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg><span>${pfx} ...</span></div>`
                : `<div class="flex items-center justify-center gap-1.5"><span>${pfx} ${stars}</span> <img src="/gifts/stars.png" class="w-5 h-5 object-contain"></div>`;
        };
        _setExchangeLabel(approxStars, true);
        fetch(`/api/exchange-preview?gift_id=${Number(giftId)}`, { headers: getApiHeaders() })
            .then(r => r.json())
            .then(data => { _setExchangeLabel(data.stars_reward ?? approxStars, false); })
            .catch(() => _setExchangeLabel(approxStars, false));

        exchangeBtn.classList.remove('hidden');
        if (exchangeDonutsBtn) exchangeDonutsBtn.classList.add('hidden');

        withdrawBtn.onclick = async () => {
            if (isDemo) { _closeGameModal(source); return; }
            _setBtnLoading(withdrawBtn, true);
            try {
                // ── Проверка требований вывода (как в инвентаре профиля) ──────
                const reqRes  = await fetch('/api/withdraw/requirements', { headers: getApiHeaders() });
                const reqData = await reqRes.json();

                if (!reqData.all_done) {
                    // Условия не выполнены — закрываем игровое окно,
                    // запоминаем подарок и открываем модалку заданий
                    _pendingWithdrawGiftId = giftId;
                    _closeGameModal(source);
                    setTimeout(() => {
                        _renderWithdrawRequirements(reqData.requirements || []);
                        const statusEl = document.getElementById('wr-status');
                        if (statusEl) statusEl.innerHTML = '';
                        openModal('withdraw-requirements-modal');
                    }, 320);
                    return;
                }

                // Все условия выполнены — выводим подарок
                const { res, data } = await performGiftAction(giftId, 'withdraw');
                if (_handleWithdrawErrorInGame(res, data, source)) return;
                syncGiftStateFromResponse(data);
                _closeGameModal(source);
                showNotify(i18n[currentLang].tg_withdraw_success || 'Подарок выведен!', 'success');
            } catch (e) {
                showNotify(i18n[currentLang]?.err_conn || 'Ошибка соединения', 'error');
            } finally {
                _setBtnLoading(withdrawBtn, false);
            }
        };

        exchangeBtn.onclick = async () => {
            if (isDemo) { _closeGameModal(source); return; }
            _setBtnLoading(exchangeBtn, true);
            try {
                const res  = await fetch('/api/exchange-for-stars', {
                    method:  'POST',
                    headers: getApiHeaders(),
                    body:    JSON.stringify({ gift_id: giftId })
                });
                const data = await res.json();
                if (_handleWithdrawErrorInGame(res, data, source)) return;
                syncGiftStateFromResponse(data);
                _closeGameModal(source);
                showNotify(`${i18n[currentLang].exchange_stars_success || 'Обменяно!'} +${data.stars_reward} ⭐`, 'success');
            } catch (e) {
                showNotify(i18n[currentLang]?.err_conn || 'Ошибка соединения', 'error');
            } finally {
                _setBtnLoading(exchangeBtn, false);
            }
        };
    }
}

// ── Exports ───────────────────────────────────────────────────────────────────

window.openWithdrawModal              = openWithdrawModal;
window.confirmWithdrawGift            = confirmWithdrawGift;
window.confirmWithdraw                = confirmWithdrawGift; // legacy alias
window.confirmExchangeGift            = confirmExchangeGift;
window.configureCaseGiftActionsIfNeeded = configureCaseGiftActionsIfNeeded;
window.calcApproxExchangeStars        = calcApproxExchangeStars;