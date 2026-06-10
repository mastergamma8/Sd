// =====================================================
// ЕДИНОЕ МОДАЛЬНОЕ ОКНО УСЛОВИЙ (подписка + шеринг)
// =====================================================

const CHANNEL_URL       = 'https://t.me/Space_Donut';
const SHARES_REQUIRED   = 3;

// Текущее состояние обоих условий
let _csmSubscribed  = false;
let _csmSharesCount = 0;

// ── SVG-иконки для индикаторов ────────────────────────────────────────────────

const _SVG_LOCK = `<svg class="w-4 h-4 text-white/30" viewBox="0 0 24 24" fill="currentColor">
  <path d="M12 1a5 5 0 0 0-5 5v3H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V11a2 2 0 0 0-2-2h-2V6a5 5 0 0 0-5-5zm0 2a3 3 0 0 1 3 3v3H9V6a3 3 0 0 1 3-3zm0 9a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/>
</svg>`;

const _SVG_CHECK = `<svg class="w-5 h-5 text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.8)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="20 6 9 17 4 12"/>
</svg>`;

// ── Обновление DOM ────────────────────────────────────────────────────────────

function _csmRender() {
    // ── Индикатор подписки ────────────────────────────────────────────────────
    const subInd = document.getElementById('csm-sub-indicator');
    if (subInd) {
        if (_csmSubscribed) {
            subInd.className = 'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 bg-emerald-500/20 border border-emerald-400/40 shadow-[0_0_10px_rgba(52,211,153,0.25)]';
            subInd.innerHTML = _SVG_CHECK;
        } else {
            subInd.className = 'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 bg-white/[0.08] border border-white/15';
            subInd.innerHTML = _SVG_LOCK;
        }
    }

    // ── Кнопки подписки (скрываем когда подписан) ─────────────────────────────
    const subBtns = document.getElementById('csm-sub-btns');
    if (subBtns) subBtns.style.display = _csmSubscribed ? 'none' : '';

    // ── Прогресс-точки шеринга ────────────────────────────────────────────────
    const dots = document.getElementById('csm-share-dots');
    if (dots) {
        let html = '';
        for (let i = 0; i < SHARES_REQUIRED; i++) {
            if (i < _csmSharesCount) {
                html += `<div class="w-5 h-5 rounded-full bg-violet-500 border border-violet-400/60 flex items-center justify-center shadow-[0_0_8px_rgba(139,92,246,0.5)] transition-all duration-300">
                    <svg class="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>`;
            } else {
                html += `<div class="w-5 h-5 rounded-full bg-white/[0.08] border border-white/15 flex items-center justify-center transition-all duration-300">
                    <span class="text-[9px] font-bold text-white/25">${i + 1}</span>
                </div>`;
            }
        }
        dots.innerHTML = html;
    }

    // ── Счётчик шерингов ──────────────────────────────────────────────────────
    const counter = document.getElementById('csm-share-counter');
    if (counter) {
        const done = Math.min(_csmSharesCount, SHARES_REQUIRED);
        counter.textContent = `${done}/${SHARES_REQUIRED}`;
        counter.className = done >= SHARES_REQUIRED
            ? 'text-sm font-black text-emerald-400 shrink-0'
            : 'text-sm font-black text-white/40 shrink-0';
    }

    // ── Индикатор шеринга ─────────────────────────────────────────────────────
    const shareInd = document.getElementById('csm-share-indicator');
    if (shareInd) {
        if (_csmSharesCount >= SHARES_REQUIRED) {
            shareInd.className = 'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 bg-emerald-500/20 border border-emerald-400/40 shadow-[0_0_10px_rgba(52,211,153,0.25)]';
            shareInd.innerHTML = _SVG_CHECK;
        } else {
            shareInd.className = 'w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 bg-white/[0.08] border border-white/15';
            shareInd.innerHTML = _SVG_LOCK;
        }
    }

    // ── Кнопка шеринга (скрываем когда выполнено) ─────────────────────────────
    const shareBtns = document.getElementById('csm-share-btns');
    if (shareBtns) shareBtns.style.display = _csmSharesCount >= SHARES_REQUIRED ? 'none' : '';
}

// ── Открытие модалки ──────────────────────────────────────────────────────────

function openRequirementsModal(subscribed, sharesCount) {
    _csmSubscribed  = !!subscribed;
    _csmSharesCount = sharesCount || 0;
    _csmRender();
    if (typeof openModal === 'function') {
        openModal('channel-sub-modal');
    } else {
        const el = document.getElementById('channel-sub-modal');
        if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
    }
    if (typeof applyI18n === 'function') applyI18n();
}

// Compat: вызывается из старого кода (showSubRequiredModal без аргументов)
function showSubRequiredModal() {
    openRequirementsModal(false, _csmSharesCount);
}

// ── Открыть канал ─────────────────────────────────────────────────────────────

function openChannelAndCheck() {
    try {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openTelegramLink) {
            Telegram.WebApp.openTelegramLink(CHANNEL_URL);
        } else {
            window.open(CHANNEL_URL, '_blank');
        }
    } catch (e) {
        window.open(CHANNEL_URL, '_blank');
    }
}

// ── Проверить подписку ────────────────────────────────────────────────────────

async function checkSubStatus() {
    const t   = (typeof i18n !== 'undefined' && i18n[currentLang]) ? i18n[currentLang] : {};
    const btn = document.getElementById('btn-check-sub');
    if (btn) { btn.disabled = true; btn.innerText = t.loading || '⏳ Проверяем...'; }

    try {
        const res  = await fetch('/api/check_subscription', { headers: getApiHeaders() });
        const data = await res.json();

        if (data.subscribed) {
            _csmSubscribed = true;
            _csmRender();
            if (typeof showNotify === 'function')
                showNotify(t.sub_check_ok || 'Подписка подтверждена! ✅', 'success');
            _csmCheckBothDone();
        } else {
            if (typeof showNotify === 'function')
                showNotify(t.sub_check_fail || 'Вы ещё не подписаны на @Space_Donut', 'error');
        }
    } catch (e) {
        if (typeof showNotify === 'function')
            showNotify(t.err_conn || 'Ошибка соединения', 'error');
    } finally {
        if (btn) {
            btn.disabled  = false;
            btn.innerText = t.sub_btn_check || 'Я уже подписан — проверить';
            if (typeof applyI18n === 'function') applyI18n();
        }
    }
}

// Compat alias — старый код вызывает checkSubAndClose()
function checkSubAndClose() { return checkSubStatus(); }

// ── Поделиться ссылкой ────────────────────────────────────────────────────────

async function doShareRef() {
    const btn = document.getElementById('btn-do-share-ref');
    if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

    // Открываем Telegram Share с реферальной ссылкой
    if (typeof getRefLink === 'function') {
        const link = getRefLink();
        const t    = (typeof i18n !== 'undefined' && i18n[currentLang]) ? i18n[currentLang] : {};
        const text = encodeURIComponent(t.share_text || '🍩 Играй в Space Donut!');
        try {
            if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openTelegramLink) {
                Telegram.WebApp.openTelegramLink(
                    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`
                );
            } else {
                window.open(
                    `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${text}`,
                    '_blank'
                );
            }
        } catch (e) { /* ignore */ }
    }

    // Фиксируем шеринг на бэкенде
    try {
        const res  = await fetch('/api/roulette/ref_share', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({}),
        });
        const data = await res.json();
        if (data.status === 'ok') {
            _csmSharesCount = data.shares_today;
            _csmRender();
            if (data.enough) _csmCheckBothDone();
        }
    } catch (e) {
        console.error('ref_share error:', e);
    } finally {
        const b = document.getElementById('btn-do-share-ref');
        if (b) { b.disabled = false; b.style.opacity = '1'; }
    }
}

// ── Автозакрытие когда оба условия выполнены ──────────────────────────────────

function _csmCheckBothDone() {
    if (_csmSubscribed && _csmSharesCount >= SHARES_REQUIRED) {
        const t = (typeof i18n !== 'undefined' && i18n[currentLang]) ? i18n[currentLang] : {};
        if (typeof showNotify === 'function')
            showNotify(t.share_ref_complete || '🎉 Условия выполнены — крути!', 'success');
        setTimeout(() => {
            if (typeof closeModal === 'function') closeModal('channel-sub-modal');
        }, 600);
    }
}

// ── Перехватчики ответов сервера ──────────────────────────────────────────────

/**
 * Открывает модалку при ответе not_subscribed.
 * Возвращает true если нужно прервать обработку.
 */
function handleNotSubscribed(data) {
    if (data && data.detail === 'not_subscribed') {
        openRequirementsModal(false, _csmSharesCount);
        return true;
    }
    return false;
}

/**
 * Открывает модалку при ответе not_shared_ref.
 * Возвращает true если нужно прервать обработку.
 */
function handleNotSharedRef(data) {
    if (data && data.detail === 'not_shared_ref') {
        openRequirementsModal(true, data.shares_today || 0);
        return true;
    }
    return false;
}

// Compat: если где-то ещё вызывается старое имя
function showShareRefModal(sharesCount) {
    openRequirementsModal(_csmSubscribed, sharesCount || 0);
}

// ── Экспорт в window ──────────────────────────────────────────────────────────
window.showSubRequiredModal  = showSubRequiredModal;
window.openRequirementsModal = openRequirementsModal;
window.openChannelAndCheck   = openChannelAndCheck;
window.checkSubStatus        = checkSubStatus;
window.checkSubAndClose      = checkSubAndClose;
window.doShareRef            = doShareRef;
window.handleNotSubscribed   = handleNotSubscribed;
window.handleNotSharedRef    = handleNotSharedRef;
window.showShareRefModal     = showShareRefModal;
