// =====================================================
// globals.js — Глобальное состояние и утилиты
// =====================================================

const ALL_TABS = ['main', 'leaderboard', 'games', 'earn', 'shop', 'profile', 'roulette'];

// Глобальное состояние
let baseGifts = {};
let mainGifts = {};
let tgGifts   = {};
let rouletteConfig = {};
let casesConfig = {}; 
let myGifts = {};
let myBalance = 0;
let myStars = 0; // <-- НОВЫЙ БАЛАНС ЗВЕЗД
let myPromoCases = {};
let freeCaseConfig = null;
let botUsername = '';
let openTasksState = {};
let rouletteSpinning = false;
let currentSortMethod = 'value_desc';
let currentLang = '';

// Демо-режим — только визуал, без списания/начисления
let isDemoMode = false;

// Telegram SDK
const tg = window.Telegram?.WebApp;
window.tg = tg;

const tgUser = (tg?.initDataUnsafe?.user) ? tg.initDataUnsafe.user : {
    id: 123456789, first_name: 'Тест', username: 'test_user', photo_url: ''
};

function vibrate(style = 'light') {
    if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred(style);
}

function getImgSrc(path) {
    if (!path) return 'https://via.placeholder.com/64';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    return path.startsWith('/') ? path : '/' + path;
}

function getApiHeaders() {
    return {
        'Content-Type': 'application/json',
        'x-tg-data': tg?.initData || ''
    };
}

function hideAppLoader() {
    const pb = document.getElementById('loader-progress');
    if (pb) pb.style.width = '100%';
    setTimeout(() => {
        const loader = document.getElementById('app-loader');
        if (loader) {
            loader.classList.add('opacity-0', 'pointer-events-none');
            setTimeout(() => loader.style.display = 'none', 500);
        }
    }, 500);
}

function formatBalance(val) {
    const n = parseFloat(val) || 0;
    if (n % 1 === 0) return n.toString();
    return parseFloat(n.toFixed(2)).toString();
}
window.formatBalance = formatBalance;

function updateUI() {
    const el = document.getElementById('balance-amount');
    if (el) el.innerText = formatBalance(myBalance);

    const stEl = document.getElementById('stars-amount');
    if (stEl) stEl.innerText = myStars;

    if (typeof renderMainPage === 'function') renderMainPage();
    if (typeof renderProfile === 'function') renderProfile();
    if (typeof updateTgShopBalance === 'function') updateTgShopBalance();
}

// =====================================================
// BOTTOM SHEET IDS — список «нижних шторок»
// =====================================================
const BOTTOM_SHEET_IDS = [
    'add-gift-modal',
    'sort-modal',
    'history-modal',
    'withdraw-requirements-modal',
    'channel-sub-modal',
    'settings-modal',
    'shop-buy-modal'
];

// Открытие модального окна:
//   • Нижние шторки — JS-спринг-анимация (translateY 100% → 0) + fade бэкдропа
//   • Остальные     — мгновенный показ (как было)
function openModal(id) {
    vibrate('light');
    const modal = document.getElementById(id);
    if (!modal) return;

    const panel = modal.querySelector('.glass-panel') || modal.firstElementChild;

    if (BOTTOM_SHEET_IDS.includes(id) && panel) {
        // 1. Выставляем начальное состояние: фон прозрачный, панель за нижним краем
        modal.style.transition = 'none';
        modal.style.opacity   = '0';
        panel.style.transition = 'none';
        panel.style.transform  = 'translateY(100%)';

        // 2. Показываем (пока ещё invisible)
        modal.classList.remove('hidden');

        // 3. Принудительный reflow — браузер «видит» начальное состояние
        void panel.offsetHeight;

        // 4. Запускаем анимацию: iOS-спринг для панели + плавный fade бэкдропа
        requestAnimationFrame(() => {
            modal.style.transition  = 'opacity 0.32s ease';
            modal.style.opacity     = '1';
            panel.style.transition  = 'transform 0.44s cubic-bezier(0.16, 1, 0.3, 1)';
            panel.style.transform   = 'translateY(0)';

            // Чистим инлайн-стили после завершения — они не должны мешать свайпу
            setTimeout(() => {
                if (!modal.classList.contains('hidden')) {
                    panel.style.transition = '';
                    modal.style.transition = '';
                }
            }, 460);
        });
    } else {
        // Не-шторка: просто показываем
        if (panel) {
            modal.style.opacity   = '';
            panel.style.transition = '';
            panel.style.transform  = '';
        }
        modal.classList.remove('hidden');
    }
}

// Закрытие модального окна:
//   • Нижние шторки — панель уезжает вниз (ease-in), бэкдроп гаснет
//   • Остальные     — мгновенное скрытие
function closeModal(id) {
    vibrate('light');
    const modal = document.getElementById(id);
    if (!modal) return;
    if (modal.classList.contains('hidden')) return; // уже закрыто — не запускаем дважды

    const panel = modal.querySelector('.glass-panel') || modal.firstElementChild;

    if (BOTTOM_SHEET_IDS.includes(id) && panel) {
        // Панель уезжает вниз с acceleration-кривой, бэкдроп гаснет чуть раньше
        panel.style.transition = 'transform 0.32s cubic-bezier(0.4, 0, 1, 1)';
        panel.style.transform  = 'translateY(110%)';
        modal.style.transition = 'opacity 0.28s ease';
        modal.style.opacity    = '0';

        setTimeout(() => {
            modal.classList.add('hidden');
            modal.style.opacity   = '';
            modal.style.transition = '';
            panel.style.transform = '';
            panel.style.transition = '';
        }, 280);
    } else {
        modal.classList.add('hidden');
    }
}

// =====================================================
// ЛОГИКА ПОПОЛНЕНИЯ ЗВЕЗД
// =====================================================

function openTopupModal() {
    vibrate('medium');
    document.getElementById('custom-topup-amount').value = '';
    openModal('topup-stars-modal');
}

function setTopupAmount(amount) {
    vibrate('light');
    document.getElementById('custom-topup-amount').value = amount;
}

function validateTopupAmount(input) {
    if (input.value < 0) input.value = 0;
    if (input.value > 100000) input.value = 100000;
}

async function buyStars() {
    const input = document.getElementById('custom-topup-amount');
    const amount = parseInt(input.value);
    
    if (!amount || amount <= 0) {
        showNotify(i18n[currentLang]?.err_invalid_amount || 'Неверная сумма', 'error');
        return;
    }

    const btn = document.getElementById('btn-buy-stars');
    const originalText = btn.innerText;
    btn.disabled = true;
    btn.innerText = '⏳...';

    try {
        const response = await fetch('/api/topup/stars', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ stars_amount: amount })
        });
        
        const result = await response.json();
        
        if (result.status === 'ok') {
            if (window.Telegram?.WebApp?.openInvoice) {
                window.Telegram.WebApp.openInvoice(result.invoice_url, (payment_status) => {
                    if (payment_status === 'paid') {
                        closeModal('topup-stars-modal');
                        myStars += amount; 
                        updateUI();
                        showNotify(i18n[currentLang]?.topup_success || 'Звезды успешно зачислены!', 'success');
                    } else if (payment_status === 'cancelled') {
                        console.log('Оплата отменена пользователем');
                    } else {
                        showNotify(i18n[currentLang]?.err_payment || 'Ошибка оплаты', 'error');
                    }
                });
            } else {
                tg.openTelegramLink(result.invoice_url);
            }
        } else {
            showNotify(result.detail || i18n[currentLang]?.err_invoice || 'Ошибка создания инвойса', 'error');
        }
    } catch (e) {
        showNotify(i18n[currentLang]?.err_conn || 'Ошибка соединения', 'error');
    } finally {
        btn.disabled = false;
        btn.innerText = originalText;
    }
}

// =====================================================
// КРАСИВЫЕ МОДАЛЬНЫЕ УВЕДОМЛЕНИЯ
// =====================================================

let _notifyCallback = null;
let _notifyAutoClose = null;

const _NOTIFY_STYLES = {
    error: {
        title: 'Ошибка',
        border: 'border-red-500/40',
        shadow: '0 0 50px rgba(239,68,68,0.35)',
        ringBg: 'rgba(239,68,68,0.15)',
        ringBorder: 'border-red-500/60',
        ringPing: 'rgba(239,68,68,0.4)',
        iconColor: '#f87171',
        btn: 'background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 0 20px rgba(239,68,68,0.5);',
    },
    success: {
        title: 'Успешно',
        border: 'border-emerald-500/40',
        shadow: '0 0 50px rgba(16,185,129,0.35)',
        ringBg: 'rgba(16,185,129,0.15)',
        ringBorder: 'border-emerald-500/60',
        ringPing: 'rgba(16,185,129,0.4)',
        iconColor: '#34d399',
        btn: 'background:linear-gradient(135deg,#10b981,#059669);box-shadow:0 0 20px rgba(16,185,129,0.5);',
    },
    warning: {
        title: 'Внимание',
        border: 'border-amber-500/40',
        shadow: '0 0 50px rgba(245,158,11,0.35)',
        ringBg: 'rgba(245,158,11,0.15)',
        ringBorder: 'border-amber-500/60',
        ringPing: 'rgba(245,158,11,0.4)',
        iconColor: '#fbbf24',
        btn: 'background:linear-gradient(135deg,#f59e0b,#d97706);box-shadow:0 0 20px rgba(245,158,11,0.5);',
    },
    info: {
        title: 'Информация',
        border: 'border-blue-500/40',
        shadow: '0 0 50px rgba(59,130,246,0.35)',
        ringBg: 'rgba(59,130,246,0.15)',
        ringBorder: 'border-blue-500/60',
        ringPing: 'rgba(59,130,246,0.4)',
        iconColor: '#60a5fa',
        btn: 'background:linear-gradient(135deg,#3b82f6,#2563eb);box-shadow:0 0 20px rgba(59,130,246,0.5);',
    },
};

function showNotify(message, type = 'error', callback = null) {
    if (_notifyAutoClose) { clearTimeout(_notifyAutoClose); _notifyAutoClose = null; }
    vibrate(type === 'error' ? 'heavy' : 'light');
    _notifyCallback = callback || null;

    const modal   = document.getElementById('notify-modal');
    const card    = document.getElementById('notify-card');
    const titleEl = document.getElementById('notify-title');
    const msgEl   = document.getElementById('notify-message');
    const btn     = document.getElementById('notify-btn');
    const ring    = document.getElementById('notify-ring');
    const ping    = document.getElementById('notify-ring-ping');
    if (!modal) return;

    const s = _NOTIFY_STYLES[type] || _NOTIFY_STYLES.error;

    // Message & title
    msgEl.textContent = message;
    const _notifyTitleKeys = { error: 'notify_error', success: 'notify_success', warning: 'notify_warning', info: 'notify_info' };
    titleEl.textContent = (i18n && currentLang && i18n[currentLang]?.[_notifyTitleKeys[type]]) || s.title;

    ['error','success','warning','info'].forEach(t => {
        const ic = document.getElementById(`notify-icon-${t}`);
        if (ic) {
            ic.classList.toggle('hidden', t !== type);
            ic.style.color = s.iconColor;
        }
    });

    ring.style.background = s.ringBg;
    ring.style.borderColor = '';
    ring.className = `w-full h-full rounded-full flex items-center justify-center border-2 ${s.ringBorder}`;
    ping.style.background = s.ringPing;

    card.className = `glass-panel rounded-3xl p-7 w-full max-w-xs text-center border shadow-2xl ${s.border}`;
    card.style.boxShadow = s.shadow;

    btn.setAttribute('style', s.btn + 'width:100%;padding:14px;border-radius:12px;font-weight:700;color:#fff;font-size:14px;');

    modal.classList.remove('hidden');
    card.style.transform = 'scale(0.92)';
    card.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => {
        card.style.transform = 'scale(1)';
        card.style.opacity = '1';
    }));

    if (type === 'success' || type === 'info') {
        _notifyAutoClose = setTimeout(() => closeNotify(), 2800);
    }
}

function closeNotify() {
    if (_notifyAutoClose) { clearTimeout(_notifyAutoClose); _notifyAutoClose = null; }
    const modal = document.getElementById('notify-modal');
    const card  = document.getElementById('notify-card');
    if (!modal) return;
    card.style.transform = 'scale(0.88)';
    card.style.opacity = '0';
    setTimeout(() => {
        modal.classList.add('hidden');
        if (_notifyCallback) {
            const cb = _notifyCallback;
            _notifyCallback = null;
            cb();
        }
    }, 220);
    vibrate('light');
}

window.showNotify = showNotify;
window.closeNotify = closeNotify;
window.openModal = openModal;
window.closeModal = closeModal;
window.openTopupModal = openTopupModal;
window.setTopupAmount = setTopupAmount;
window.validateTopupAmount = validateTopupAmount;
window.buyStars = buyStars;

// ── Демо-режим ───────────────────────────────────────────────────────────────
function toggleDemoMode(sourceId) {
    isDemoMode = !isDemoMode;
    syncDemoToggles();
    if (typeof vibrate === 'function') vibrate('light');
    if (typeof fetchRouletteInfo === 'function') {
        const roulettePage = document.getElementById('page-roulette');
        if (roulettePage && !roulettePage.classList.contains('hidden-tab')) {
            fetchRouletteInfo();
        }
    }
}

function syncDemoToggles() {
    ['demo-toggle-roulette', 'demo-toggle-cases', 'demo-toggle-rocket'].forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const knob  = el.querySelector('.demo-knob');
        const track = el.querySelector('.demo-track');
        const label = el.querySelector('.demo-label');
        if (isDemoMode) {
            if (track) { track.classList.remove('bg-white/10'); track.classList.add('bg-orange-500'); }
            if (knob)  { knob.style.transform = 'translateX(20px)'; }
            if (label) { label.classList.add('text-orange-300'); label.classList.remove('text-white/50'); }
        } else {
            if (track) { track.classList.add('bg-white/10'); track.classList.remove('bg-orange-500'); }
            if (knob)  { knob.style.transform = 'translateX(0px)'; }
            if (label) { label.classList.remove('text-orange-300'); label.classList.add('text-white/50'); }
        }
    });
    const rocketRibbon = document.getElementById('rocket-demo-ribbon');
    if (rocketRibbon) rocketRibbon.classList.toggle('hidden', !isDemoMode);
}
window.syncDemoToggles = syncDemoToggles;
window.toggleDemoMode = toggleDemoMode;

// =====================================================
// ИНИЦИАЛИЗАЦИЯ "ШТОРОК" (ЗАКРЫТИЕ СВАЙПОМ / КЛИК ВНЕ)
// =====================================================
function initBottomSheets() {
    const bottomSheets = ['add-gift-modal', 'sort-modal', 'history-modal', 'pvp-history-modal', 'withdraw-requirements-modal', 'channel-sub-modal', 'settings-modal', 'shop-buy-modal'];

    // Функция поиска скроллируемого родителя, чтобы не перехватывать скролл контента
    function getScrollableParent(el, limitNode) {
        let current = el;
        while (current && current !== limitNode && current !== document.body) {
            const style = window.getComputedStyle(current);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    bottomSheets.forEach(id => {
        const modal = document.getElementById(id);
        if (!modal || modal.dataset.swipeInitialized) return;
        
        modal.dataset.swipeInitialized = 'true'; // Защита от двойной инициализации

        const panel = modal.querySelector('.glass-panel') || modal.firstElementChild;
        if (!panel) return;

        // 1. Закрытие по клику на фон (Используем чистый 'click', он работает надежно на мобильных)
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeModal(id);
            }
        });

        // 2. Свайп вниз для закрытия
        let startY = 0;
        let currentY = 0;
        let isDragging = false;
        let isScrollArea = false; 

        panel.addEventListener('touchstart', (e) => {
            const scrollable = getScrollableParent(e.target, panel);
            
            if (scrollable) {
                // Если скролл-контейнер прокручен вниз, отдаем приоритет нативному скроллу контента
                if (scrollable.scrollTop > 0) {
                    return; 
                }
                isScrollArea = true;
            } else {
                isScrollArea = false;
            }

            startY = e.touches[0].clientY;
            currentY = startY;
            isDragging = true;
            
            // Выключаем CSS плавность, чтобы шторка идеально следовала за пальцем
            panel.style.transition = 'none';
        }, { passive: true });

        // Обратите внимание на passive: false, это критично для e.preventDefault()
        panel.addEventListener('touchmove', (e) => {
            if (!isDragging) return;
            
            currentY = e.touches[0].clientY;
            const deltaY = currentY - startY;

            // Если тянем вверх внутри скролл-области - прекращаем тащить модалку
            if (isScrollArea && deltaY < 0) {
                isDragging = false;
                panel.style.transform = '';
                return;
            }

            // Тянем шторку вниз
            if (deltaY > 0) {
                // Блокируем стандартный баунс-скролл страницы браузером
                if (e.cancelable) {
                    e.preventDefault(); 
                }
                panel.style.transform = `translateY(${deltaY}px)`;
            }
        }, { passive: false }); 

        panel.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            isDragging = false;
            
            const deltaY = currentY - startY;
            
            // Если сдвинули вниз больше 80 пикселей - закрываем
            if (deltaY > 80) {
                closeModal(id);
            } else {
                // Возвращаем наверх
                panel.style.transition = 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)';
                panel.style.transform = 'translateY(0px)';
                
                // Сбрасываем стили, чтобы не сломать появление в следующий раз
                setTimeout(() => {
                    if (!modal.classList.contains('hidden')) {
                        panel.style.transform = '';
                        panel.style.transition = '';
                    }
                }, 300);
            }
        });
    });
}

// Запуск инициализации ПОСЛЕ того, как partials-loader вставит modals.html в DOM
document.addEventListener('partialsLoaded', initBottomSheets);
