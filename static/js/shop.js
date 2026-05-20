// =====================================================
// shop.js — Страница Магазин
// =====================================================

let shopConfig = null;          // { limited_section, sections[] }
let shopBuyPending = null;      // { item, sectionId }
let shopAvailableReferrals = 0; // кэш доступных рефералов
let _shopConfigLoading = null;  // промис загрузки конфига (защита от дублирующих запросов)
let _shopModalTimer    = null;  // setInterval для таймера в модальном окне

// ── Таймеры обратного отсчёта по карточкам ────────────────────────────────────
// Ключ: item.id, значение: setInterval id
const _shopItemTimers = {};

function _clearShopItemTimers() {
    Object.keys(_shopItemTimers).forEach(k => {
        clearInterval(_shopItemTimers[k]);
        delete _shopItemTimers[k];
    });
}

function _getShopSecondsLeft(expiresAt) {
    if (!expiresAt) return null;
    const diff = Math.floor((new Date(expiresAt) - Date.now()) / 1000);
    return diff > 0 ? diff : 0;
}

function _formatShopCountdown(s) {
    if (s >= 86400) {
        const d = Math.floor(s / 86400);
        const h = Math.floor((s % 86400) / 3600);
        return `${d}д ${String(h).padStart(2,'0')}ч`;
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function _startShopItemTimer(itemId, secondsLeft, el) {
    if (_shopItemTimers[itemId]) {
        clearInterval(_shopItemTimers[itemId]);
        delete _shopItemTimers[itemId];
    }
    let s = secondsLeft;
    const update = () => {
        if (!document.body.contains(el)) {
            clearInterval(_shopItemTimers[itemId]);
            delete _shopItemTimers[itemId];
            return;
        }
        if (s <= 0) {
            clearInterval(_shopItemTimers[itemId]);
            delete _shopItemTimers[itemId];
            // Перерисовываем разделы — просроченный товар исчезнет
            renderCustomSections();
            return;
        }
        const isUrgent = s < 86400;
        el.textContent = '⏱ ' + _formatShopCountdown(s);
        el.style.color = isUrgent ? '#f87171' : 'rgba(255,255,255,0.55)';
        s--;
    };
    update();
    _shopItemTimers[itemId] = setInterval(update, 1000);
}

// Пресеты фонов (те же, что у кейсов)
const SHOP_BG_PRESETS = {
    green:  { cardClass: 'case-bg-green',  glowColor: 'rgba(34,197,94,0.35)',  iconShadow: '0 0 8px rgba(34,197,94,0.7)'  },
    gold:   { cardClass: 'case-bg-gold',   glowColor: 'rgba(234,179,8,0.35)',  iconShadow: '0 0 8px rgba(234,179,8,0.7)'  },
    purple: { cardClass: 'case-bg-purple', glowColor: 'rgba(168,85,247,0.35)', iconShadow: '0 0 8px rgba(168,85,247,0.7)' },
    red:    { cardClass: 'case-bg-red',    glowColor: 'rgba(239,68,68,0.35)',  iconShadow: '0 0 8px rgba(239,68,68,0.7)'  },
};

// ── Загрузка конфига (единственная точка входа) ───────────────────────────────
// Все функции, которым нужен shopConfig, должны вызывать _ensureShopConfig().
// Повторные вызовы во время загрузки дожидаются уже запущенного промиса —
// второй fetch не создаётся.

async function _ensureShopConfig() {
    if (shopConfig) return shopConfig;
    if (_shopConfigLoading) return _shopConfigLoading;

    _shopConfigLoading = (async () => {
        try {
            const [cfgRes, refRes] = await Promise.all([
                fetch('/api/shop/config', { headers: getApiHeaders() }),
                fetch('/api/shop/referrals', { headers: getApiHeaders() })
            ]);
            shopConfig = await cfgRes.json();
            const refData = await refRes.json();
            shopAvailableReferrals = refData.available ?? 0;
        } catch (e) {
            console.error('Shop init error:', e);
        }
        _shopConfigLoading = null;
        return shopConfig;
    })();

    return _shopConfigLoading;
}

// ── Инициализация страницы ────────────────────────────────────────────────────

async function initShopPage() {
    await _ensureShopConfig();
    renderShop();
}

// ── Рендер страницы ───────────────────────────────────────

function renderShop() {
    if (!shopConfig) return;

    // Баннер лимитированных подарков: скрываем, если API вернул limited_section: null
    const bannerSection = document.getElementById('shop-section-limited');
    if (bannerSection) {
        bannerSection.style.display = shopConfig.limited_section ? '' : 'none';
    }

    renderCustomSections();
}

// ── Кастомные разделы ─────────────────────────────────────

function renderCustomSections() {
    const container = document.getElementById('shop-custom-sections');
    if (!container) return;

    // Останавливаем все активные таймеры перед перерисовкой
    _clearShopItemTimers();

    const sections = shopConfig.sections || [];
    if (!sections.length) {
        container.innerHTML = '';
        return;
    }

    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
    container.innerHTML = '';

    sections.forEach(section => {
        const title = (section.title && section.title[lang]) || section.title?.ru || '';

        const sectionEl = document.createElement('div');
        sectionEl.className = 'mb-7';
        sectionEl.id = `shop-custom-section-${section.id}`;
        sectionEl.innerHTML = `
            <h3 class="text-base font-bold text-white/80 uppercase tracking-wider mb-3 flex items-center gap-2">
                <span class="w-1 h-4 rounded-full bg-purple-500 inline-block"></span>
                <span>${title}</span>
            </h3>
            <div class="grid grid-cols-3 gap-2" id="shop-section-${section.id}"></div>
        `;
        container.appendChild(sectionEl);

        const grid = document.getElementById(`shop-section-${section.id}`);
        (section.items || []).filter(item => {
            // Фильтр по лимитам покупок
            const limit      = item.buy_limit   ?? null;
            const count      = item.user_buy_count  ?? 0;
            const totalLimit = item.total_limit  ?? null;
            const totalCount = item.total_buy_count ?? 0;
            const userOk  = limit      === null || count      < limit;
            const totalOk = totalLimit === null || totalCount < totalLimit;
            // Фильтр по сроку действия (клиентская сторона)
            const expOk = !item.expires_at || (new Date(item.expires_at) > new Date());
            return userOk && totalOk && expOk;
        }).forEach(item => {
            const card = _buildItemCard(item, section.id, lang);
            grid.appendChild(card);
            // Запускаем таймер если есть expires_at
            if (item.expires_at) {
                const secsLeft = _getShopSecondsLeft(item.expires_at);
                if (secsLeft !== null && secsLeft > 0) {
                    const timerEl = card.querySelector('.shop-item-timer');
                    if (timerEl) _startShopItemTimer(item.id, secsLeft, timerEl);
                }
            }
        });
    });
}

function _rewardIconSrc(r) {
    if (r.type === 'stars')  return '/gifts/stars.png';
    if (r.type === 'donuts') return '/gifts/dount.png';
    // base_gift → смотрим в baseGifts (ID 1–114)
    if (r.type === 'base_gift' && r.gift_id) {
        const gDef = (typeof baseGifts !== 'undefined') ? baseGifts[r.gift_id] : null;
        if (gDef && gDef.photo) return gDef.photo;
        return '/gifts/limitedgifts.png';
    }
    // limited_gift / tg_gift → смотрим в tgGifts
    if (r.gift_id && typeof tgGifts !== 'undefined' && tgGifts[r.gift_id]) {
        return tgGifts[r.gift_id].photo || '/gifts/limitedgifts.png';
    }
    return '/gifts/limitedgifts.png';
}

// Строит HTML сетки иконок (1–4 штуки) внутри квадратного контейнера.
// iconShadow — CSS-значение для filter:drop-shadow(...).
// size: 'sm' (карточка) | 'lg' (модал)
function _buildIconGrid(rewardList, iconShadow, size) {
    const shadow  = iconShadow || '0 0 8px rgba(168,85,247,0.5)';
    const isLarge = size === 'lg';
    const count   = rewardList.length;
    const padding = isLarge ? 'p-2'   : 'p-1';
    const gap     = isLarge ? 'gap-1.5' : 'gap-1';
    const imgPad  = isLarge ? 'p-1.5' : 'p-1';

    // 1 иконка — занимает весь квадрат
    if (count === 1) {
        const src = _rewardIconSrc(rewardList[0]);
        return `<div class="w-full h-full flex items-center justify-center ${padding}">
                    <img src="${src}" class="w-full h-full object-contain"
                         style="filter:drop-shadow(${shadow})"
                         onerror="this.src='https://via.placeholder.com/80?text=🎁'">
                </div>`;
    }

    // 2–4 иконки — сетка 2×2
    const cells = rewardList.slice(0, 4).map(r => `
        <div class="aspect-square rounded-md bg-black/20 flex items-center justify-center ${imgPad} overflow-hidden">
            <img src="${_rewardIconSrc(r)}" class="w-full h-full object-contain"
                 style="filter:drop-shadow(${shadow})"
                 onerror="this.src='https://via.placeholder.com/40?text=🎁'">
        </div>`).join('');
    return `<div class="w-full h-full grid grid-cols-2 ${gap} ${padding}">${cells}</div>`;
}

function _buildItemCard(item, sectionId, lang) {
    const title      = (item.title && item.title[lang]) || item.title?.ru || '';
    const priceLabel = _getPriceLabel(item, lang);

    const bg = item.background && SHOP_BG_PRESETS[item.background]
        ? SHOP_BG_PRESETS[item.background]
        : null;

    const card = document.createElement('div');
    card.className = [
        'glass rounded-xl p-2 flex flex-col items-center gap-1.5',
        'cursor-pointer active:scale-95 transition-all',
        'shadow-[0_4px_15px_rgba(0,0,0,0.3)]',
        bg ? bg.cardClass : 'border border-purple-500/20 hover:border-purple-400/50 hover:bg-white/5',
    ].join(' ');
    card.onclick = () => openShopBuyModal(item, sectionId);

    // Нормализуем список наград: rewards[] или одиночный тип
    const rewardList = item.rewards && item.rewards.length
        ? item.rewards.slice(0, 4)
        : [{ type: item.type, amount: item.amount, gift_id: item.gift_id }];

    const _innerColorMap = {
        green:  'bg-green-500/20 border border-green-400/35',
        gold:   'bg-yellow-500/20 border border-yellow-400/35',
        purple: 'bg-purple-500/20 border border-purple-400/35',
        red:    'bg-red-500/20 border border-red-400/35',
    };
    const squareBg   = bg
        ? (_innerColorMap[item.background] || 'bg-white/10 border border-white/20')
        : 'bg-white/10 border border-white/20';
    const bgGradStyle = bg
        ? `background:radial-gradient(ellipse at 50% 0%,${bg.glowColor} 0%,transparent 70%);`
        : '';
    const iconShadow  = bg ? bg.iconShadow : '0 0 8px rgba(168,85,247,0.5)';

    // Таймер
    const secsLeft = _getShopSecondsLeft(item.expires_at);
    const isUrgent = secsLeft !== null && secsLeft < 86400;
    const timerHtml = secsLeft !== null && secsLeft > 0
        ? `<div class="shop-item-timer w-full text-center font-mono text-[9px] font-bold"
               style="color:${isUrgent ? '#f87171' : 'rgba(255,255,255,0.5)'}">⏱ ${_formatShopCountdown(secsLeft)}</div>`
        : '';

    card.innerHTML = `
        <div class="w-full aspect-square rounded-lg ${squareBg} overflow-hidden relative"
             style="${bgGradStyle}">
            ${_buildIconGrid(rewardList, iconShadow, 'sm')}
        </div>
        <p class="text-[11px] font-bold text-white text-center leading-tight line-clamp-2 w-full px-0.5">${title}</p>
        <div class="flex items-center gap-0.5">${priceLabel}</div>
        ${timerHtml}
    `;
    return card;
}

// i18n-хелпер: берёт строку из i18n[lang][key] или fallback
function _t(lang, key, fallback) {
    return (i18n[lang] || i18n['ru'])[key] || fallback;
}

function _getItemImage(item) {
    if (item.image) return item.image;
    // Для multi-reward берём первое вознаграждение для иконки
    const firstReward = item.rewards ? item.rewards[0] : item;
    if (firstReward.gift_id) {
        const giftDef = (typeof tgGifts !== 'undefined') ? tgGifts[firstReward.gift_id] : null;
        if (giftDef && giftDef.photo) return giftDef.photo;
    }
    if ((firstReward.type || item.type) === 'stars')  return '/gifts/stars.png';
    if ((firstReward.type || item.type) === 'donuts') return '/gifts/dount.png';
    return '/gifts/limitedgifts.png';
}

function _getPriceLabel(item, lang) {
    const currency = item.currency;
    const price    = item.price;

    if (currency === 'free') {
        const txt = (i18n[lang] || i18n['ru'])['shop_price_free'] || 'Бесплатно';
        return `<span class="text-[11px] font-black text-green-400">${txt}</span>`;
    }
    if (currency === 'stars') {
        return `<span class="text-[11px] font-black text-yellow-300">${price}</span>
                <img src="/gifts/stars.png" class="w-3 h-3 object-contain" alt="⭐">`;
    }
    if (currency === 'donuts') {
        return `<span class="text-[11px] font-black text-orange-300">${price}</span>
                <img src="/gifts/dount.png" class="w-3 h-3 object-contain" alt="🍩">`;
    }
    if (currency === 'referral') {
        const txt = (i18n[lang] || i18n['ru'])['shop_price_referral'] || 'реф.';
        return `<span class="text-[11px] font-black text-blue-300">${price} ${txt}</span>`;
    }
    return `<span class="text-[11px] font-black text-white">${price}</span>`;
}

// ── Лимитированные подарки (отдельный вид) ────────────────

async function openShopLimitedGifts() {
    if (typeof vibrate === 'function') vibrate('light');

    const mainContent = document.getElementById('page-shop');
    const fullView    = document.getElementById('shop-limited-full');
    if (!mainContent || !fullView) return;

    // Убеждаемся, что конфиг загружен, прежде чем что-то рендерить.
    // Если загрузка уже идёт, дожидаемся её завершения.
    await _ensureShopConfig();

    const sectionLimited = document.getElementById('shop-section-limited');
    const customSections = document.getElementById('shop-custom-sections');
    const pageTitle      = document.querySelector('#page-shop > h2');

    if (sectionLimited) sectionLimited.style.display = 'none';
    if (customSections) customSections.style.display = 'none';
    if (pageTitle)      pageTitle.style.display      = 'none';

    fullView.classList.remove('hidden');
    renderShopLimitedGrid();
}

function closeShopLimitedGifts() {
    if (typeof vibrate === 'function') vibrate('light');

    const sectionLimited = document.getElementById('shop-section-limited');
    const customSections = document.getElementById('shop-custom-sections');
    const pageTitle      = document.querySelector('#page-shop > h2');
    const fullView       = document.getElementById('shop-limited-full');

    if (sectionLimited) sectionLimited.style.display = '';
    if (customSections) customSections.style.display = '';
    if (pageTitle)      pageTitle.style.display      = '';
    if (fullView)       fullView.classList.add('hidden');
}

function renderShopLimitedGrid() {
    const grid = document.getElementById('shop-limited-grid');
    if (!grid) return;
    grid.innerHTML = '';

    if (!shopConfig || !shopConfig.limited_section) return;

    const items = shopConfig.limited_section.items || [];
    const lang  = (typeof currentLang !== 'undefined') ? currentLang : 'ru';

    items.forEach(item => {
        const giftId  = item.gift_id;
        const giftDef = (typeof tgGifts !== 'undefined') ? tgGifts[giftId] : null;
        const photo   = giftDef ? giftDef.photo : (item.image || '');
        const price   = item.price || 0;

        const card = document.createElement('div');
        card.className = [
            'glass rounded-xl p-2 flex flex-col items-center gap-1.5',
            'border border-orange-500/20 cursor-pointer',
            'active:scale-95 transition-all',
            'hover:border-orange-400/50 hover:bg-white/5',
            'shadow-[0_4px_15px_rgba(0,0,0,0.3)]'
        ].join(' ');
        card.onclick = () => {
            // Переиспользуем старый модал из tg-shop.js
            if (typeof openTgBuyModal === 'function') openTgBuyModal(giftId);
        };

        card.innerHTML = `
            <div class="w-full aspect-square rounded-lg bg-orange-500/10 border border-orange-400/15
                        flex items-center justify-center overflow-hidden">
                <img src="${photo}"
                     class="w-full h-full object-contain p-1.5 drop-shadow-[0_0_8px_rgba(249,115,22,0.5)]"
                     onerror="this.src='https://via.placeholder.com/80?text=🎁'">
            </div>
            <div class="flex items-center gap-0.5 mt-0.5">
                <span class="text-[11px] font-black text-yellow-300">${price}</span>
                <img src="/gifts/stars.png" class="w-3 h-3 object-contain" alt="⭐">
            </div>
        `;
        grid.appendChild(card);
    });
}

// ── Модал покупки кастомного товара ──────────────────────

function _stopModalTimer() {
    if (_shopModalTimer) { clearInterval(_shopModalTimer); _shopModalTimer = null; }
}

function _startModalTimer(expiresAt) {
    _stopModalTimer();
    const wrap    = document.getElementById('shop-buy-modal-timer-wrap');
    const timerEl = document.getElementById('shop-buy-modal-timer');
    if (!wrap || !timerEl || !expiresAt) { if (wrap) wrap.classList.add('hidden'); return; }

    let s = _getShopSecondsLeft(expiresAt);
    if (s === null || s <= 0) { wrap.classList.add('hidden'); return; }

    wrap.classList.remove('hidden');
    const update = () => {
        if (!document.getElementById('shop-buy-modal-timer')) { _stopModalTimer(); return; }
        if (s <= 0) {
            _stopModalTimer();
            wrap.classList.add('hidden');
            closeShopBuyModal();
            renderCustomSections();
            return;
        }
        const urgent = s < 86400;
        timerEl.textContent = '⏱ ' + _formatShopCountdown(s);
        timerEl.style.color = urgent ? '#f87171' : 'rgba(255,255,255,0.75)';
        s--;
    };
    update();
    _shopModalTimer = setInterval(update, 1000);
}

async function openShopBuyModal(item, sectionId) {
    if (typeof vibrate === 'function') vibrate('medium');
    shopBuyPending = { item, sectionId };

    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
    const t    = i18n[lang] || i18n['ru'];

    // ── Иконки товара (1 или сетка 2×2) ─────────────────────────────────────
    const iconsEl = document.getElementById('shop-buy-modal-icons');
    if (iconsEl) {
        // Сбрасываем стили контейнера под текущий фон товара
        const bg = item.background && SHOP_BG_PRESETS[item.background]
            ? SHOP_BG_PRESETS[item.background] : null;
        iconsEl.style.background = bg
            ? `radial-gradient(ellipse at 50% 0%,${bg.glowColor} 0%,transparent 70%)`
            : '';
        iconsEl.className = [
            'w-24 h-24 rounded-2xl overflow-hidden',
            bg ? bg.cardClass : 'bg-purple-500/10 border border-purple-400/20',
        ].join(' ');

        const rewardList = item.rewards && item.rewards.length
            ? item.rewards.slice(0, 4)
            : [{ type: item.type, amount: item.amount, gift_id: item.gift_id }];
        const iconShadow = bg ? bg.iconShadow : '0 0 10px rgba(168,85,247,0.6)';
        iconsEl.innerHTML = _buildIconGrid(rewardList, iconShadow, 'lg');
    }

    // ── Таймер ───────────────────────────────────────────────────────────────
    _startModalTimer(item.expires_at || null);

    // ── Название ─────────────────────────────────────────────────────────────
    const titleEl = document.getElementById('shop-buy-modal-title');
    if (titleEl) titleEl.textContent = (item.title && item.title[lang]) || item.title?.ru || '';

    // ── Стоимость ────────────────────────────────────────────────────────────
    const costEl = document.getElementById('shop-buy-modal-cost');
    if (costEl) {
        if (item.currency === 'free')         costEl.textContent = t['shop_price_free'] || 'Бесплатно';
        else if (item.currency === 'stars')   costEl.textContent = `${item.price} ⭐`;
        else if (item.currency === 'donuts')  costEl.textContent = `${item.price} 🍩`;
        else if (item.currency === 'referral')costEl.textContent = `${item.price} ${t['shop_price_referral'] || 'реф.'}`;
    }

    // ── Что получает пользователь ────────────────────────────────────────────
    const rewardEl = document.getElementById('shop-buy-modal-reward');
    if (rewardEl) {
        const rewards = item.rewards && item.rewards.length ? item.rewards : null;
        if (rewards && rewards.length > 1) {
            const parts = rewards.slice(0, 4).map(r => {
                if (r.type === 'stars')  return `${r.amount} ⭐`;
                if (r.type === 'donuts') return `${r.amount} 🍩`;
                return t['shop_reward_gift'] || '🎁 Подарок';
            });
            rewardEl.textContent = parts.join(' + ');
        } else if (rewards && rewards.length === 1) {
            const r = rewards[0];
            if (r.type === 'stars')  rewardEl.textContent = `${r.amount} ⭐`;
            else if (r.type === 'donuts') rewardEl.textContent = `${r.amount} 🍩`;
            else rewardEl.textContent = t['shop_reward_gift'] || '🎁 Подарок';
        } else {
            if (item.type === 'stars')        rewardEl.textContent = `${item.amount} ⭐`;
            else if (item.type === 'donuts')  rewardEl.textContent = `${item.amount} 🍩`;
            else rewardEl.textContent = t['shop_reward_gift'] || '🎁 Telegram-подарок';
        }
    }

    // ── Строка рефералов ─────────────────────────────────────────────────────
    const refRow   = document.getElementById('shop-buy-modal-referral-row');
    const refCount = document.getElementById('shop-buy-modal-refs-count');
    if (item.currency === 'referral') {
        try {
            const res  = await fetch('/api/shop/referrals', { headers: getApiHeaders() });
            const data = await res.json();
            shopAvailableReferrals = data.available ?? 0;
        } catch (_) {}
        if (refRow)   refRow.classList.remove('hidden');
        if (refCount) refCount.textContent = shopAvailableReferrals;
    } else {
        if (refRow) refRow.classList.add('hidden');
    }

    // ── Кнопка ───────────────────────────────────────────────────────────────
    const labelEl = document.getElementById('shop-buy-confirm-label');
    if (labelEl) labelEl.textContent = t['shop_modal_confirm_btn'] || 'Купить';

    if (typeof openModal === 'function') openModal('shop-buy-modal');
    else document.getElementById('shop-buy-modal')?.classList.remove('hidden');
}

function closeShopBuyModal() {
    shopBuyPending = null;
    _stopModalTimer();
    if (typeof closeModal === 'function') closeModal('shop-buy-modal');
    else document.getElementById('shop-buy-modal')?.classList.add('hidden');
}

async function confirmShopBuy() {
    if (!shopBuyPending) return;
    const { item, sectionId } = shopBuyPending;
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'ru';
    const t    = i18n[lang] || i18n['ru'];

    const btn = document.getElementById('shop-buy-confirm-btn');
    const originalHTML = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="opacity-70">${t['processing'] || '⏳...'}</span>`; }

    try {
        const res = await fetch('/api/shop/buy', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ item_id: item.id, section_id: sectionId }),
        });
        const data = await res.json();

        if (res.ok && data.status === 'ok') {
            // Обновляем баланс
            if (typeof myBalance !== 'undefined' && data.balance !== undefined) myBalance = data.balance;
            if (typeof myStars   !== 'undefined' && data.stars   !== undefined) myStars   = data.stars;
            if (typeof updateUI === 'function') updateUI();

            // ── Мгновенное обновление инвентаря подарков в профиле ──────────
            // Для base_gift сервер добавляет подарок в БД, но локальный myGifts
            // не обновляется — профиль показывал старый список до перезагрузки.
            // Здесь обновляем myGifts и перерендериваем профиль сразу.
            const _boughtRewards = item.rewards && item.rewards.length
                ? item.rewards
                : [{ type: item.type, gift_id: item.gift_id }];
            const _hasBaseGift = _boughtRewards.some(r => r.type === 'base_gift');
            if (_hasBaseGift && typeof myGifts !== 'undefined') {
                _boughtRewards.forEach(r => {
                    if (r.type === 'base_gift' && r.gift_id != null) {
                        const k = String(r.gift_id);
                        myGifts[k] = (myGifts[k] || 0) + 1;
                    }
                });
                if (typeof renderProfile === 'function') renderProfile();
            }

            closeShopBuyModal();

            // Сбрасываем кэш рефералов
            shopAvailableReferrals = Math.max(0, shopAvailableReferrals - (item.currency === 'referral' ? item.price : 0));

            // ── Обновляем локальные счётчики в shopConfig ────────
            // Это позволяет мгновенно скрыть товар без перезагрузки страницы,
            // если пользователь исчерпал персональный или глобальный лимит.
            if (shopConfig && data.item_id) {
                for (const section of (shopConfig.sections || [])) {
                    for (const shopItem of (section.items || [])) {
                        if (shopItem.id === data.item_id) {
                            if (data.user_buy_count !== undefined) {
                                shopItem.user_buy_count = data.user_buy_count;
                            }
                            if (data.total_buy_count !== undefined) {
                                shopItem.total_buy_count = data.total_buy_count;
                            }
                        }
                    }
                }
                // Перерисовываем разделы — товары с исчерпанным лимитом исчезнут
                renderCustomSections();
            }

            showNotify(t['shop_buy_success'] || '✅ Куплено!', 'success');
        } else {
            const detail = data.detail || '';
            let msg = t['shop_buy_error'] || 'Ошибка покупки';
            if (detail === 'not_enough_donuts') msg = t['not_enough_donuts'] || 'Недостаточно пончиков!';
            if (detail === 'not_enough_stars')  msg = t['not_enough_stars']  || 'Недостаточно звёзд!';
            if (detail === 'not_enough_referrals') msg = t['shop_not_enough_referrals'] || 'Недостаточно приглашённых друзей!';
            if (detail === 'send_gift_failed')  msg = t['tg_buy_error'] || 'Не удалось отправить подарок';
            if (detail === 'buy_limit_reached') msg = t['shop_buy_limit_reached'] || 'Лимит покупок исчерпан!';
            if (detail === 'item_expired') {
                msg = t['shop_item_expired'] || 'Акция уже закончилась!';
                renderCustomSections(); // убираем просроченную карточку
                closeShopBuyModal();
            }
            if (detail === 'total_limit_reached') {
                msg = t['shop_total_limit_reached'] || 'Товар полностью раскуплен!';
                // Скрываем товар локально — глобальный запас исчерпан
                if (shopConfig) {
                    for (const section of (shopConfig.sections || [])) {
                        for (const shopItem of (section.items || [])) {
                            if (shopItem.id === item.id && shopItem.total_limit != null) {
                                shopItem.total_buy_count = shopItem.total_limit;
                            }
                        }
                    }
                    renderCustomSections();
                }
                closeShopBuyModal();
            }
            showNotify(msg, 'error');
        }
    } catch (e) {
        console.error('Shop buy error:', e);
        showNotify(t['err_conn'] || 'Ошибка соединения', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
    }
}

// ── Экспорт ───────────────────────────────────────────────

window.initShopPage              = initShopPage;
window.openShopLimitedGifts      = openShopLimitedGifts;
window.closeShopLimitedGifts     = closeShopLimitedGifts;
window.openShopBuyModal          = openShopBuyModal;
window.closeShopBuyModal         = closeShopBuyModal;
window.confirmShopBuy            = confirmShopBuy;

// ── Сброс магазина на главный экран ──────────────────────
// Вызывается при повторном нажатии на кнопку "Магазин" в навигации.

function resetShopView() {
    const fullView = document.getElementById('shop-limited-full');
    if (fullView && !fullView.classList.contains('hidden')) {
        closeShopLimitedGifts();
        return true;
    }
    return false;
}

window.resetShopView = resetShopView;
