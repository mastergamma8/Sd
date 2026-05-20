// =====================================================
// РУЛЕТКА — ГОРИЗОНТАЛЬНАЯ ЛЕНТА v3
// =====================================================

// ── Константы анимации спина ──────────────────────────────────────────────────
const RSTRIP_ITEM_W    = 80;    // ширина одного слота (px): 72px предмет + 4px margin с каждой стороны
const RSTRIP_REPEAT    = 20;    // сколько раз повторяем массив items в ленте
const RSTRIP_LAPS      = 8;     // полных оборотов до победителя
const RSTRIP_START_LAP = 2;     // с какого «оборота» начинается каждая анимация
const RSTRIP_DURATION  = 6200;  // длительность анимации спина, мс

// ── Константы холостого прокрута ──────────────────────────────────────────────
const RSTRIP_IDLE_SPEED = 45;   // px/s — медленная прокрутка для предпросмотра призов

// ── Состояние холостого прокрута ──────────────────────────────────────────────
let _rstripIdleFrame    = null;
let _rstripIdleLastTime = 0;
let _rstripIdleX        = 0;    // текущий translateX во время idle

// ── Вспомогательная функция: картинка и подпись элемента ─────────────────────
function _rstripItemMeta(item) {
    let photoSrc = 'https://via.placeholder.com/48';
    let label    = '';
    if (item.type === 'gift') {
        const def = mainGifts[item.gift_id] || tgGifts[item.gift_id] || baseGifts[item.gift_id];
        if (def) { photoSrc = getImgSrc(def.photo); label = def.name; }
    } else if (item.type === 'stars') {
        photoSrc = getImgSrc(item.photo || '/gifts/stars.png');
        label = `+${item.amount}`;          // без ⭐ — иконка уже на картинке
    } else if (item.type === 'donuts') {
        photoSrc = getImgSrc(item.photo || '/gifts/dount.png');
        label = `+${item.amount}`;
    }
    return { photoSrc, label };
}

// ── Рендер ленты (вызывается один раз при открытии) ──────────────────────────
function renderRouletteStrip() {
    const strip = document.getElementById('roulette-strip');
    if (!strip || !rouletteConfig.items) return;

    const items = rouletteConfig.items;
    let html = '';

    for (let lap = 0; lap < RSTRIP_REPEAT; lap++) {
        items.forEach((item, idx) => {
            const { photoSrc, label } = _rstripItemMeta(item);
            html += `<div class="rstrip-item"
                data-lap="${lap}" data-idx="${idx}"
                style="flex-shrink:0;
                       width:72px;height:88px;margin:0 4px;
                       border-radius:13px;
                       background:rgba(255,255,255,0.05);
                       border:1px solid rgba(255,255,255,0.1);
                       display:flex;flex-direction:column;
                       align-items:center;justify-content:center;gap:4px;
                       transition:border-color .25s,background .25s,box-shadow .25s,transform .25s;">
                <img src="${photoSrc}"
                     style="width:42px;height:42px;object-fit:contain;
                            filter:drop-shadow(0 3px 8px rgba(0,0,0,0.7));"
                     onerror="this.src='https://via.placeholder.com/48'">
                <span style="font-size:10px;font-weight:700;color:rgba(255,255,255,0.72);
                             text-align:center;line-height:1.2;
                             max-width:68px;overflow:hidden;
                             white-space:nowrap;text-overflow:ellipsis;
                             padding:0 3px;">${label}</span>
            </div>`;
        });
    }

    strip.innerHTML = html;

    // Начальная позиция для idle-прокрута: элемент 0 лапа START_LAP по центру
    const container = document.getElementById('roulette-strip-container');
    const cx        = container ? container.offsetWidth / 2 : 200;
    _rstripIdleX    = cx - RSTRIP_START_LAP * items.length * RSTRIP_ITEM_W - RSTRIP_ITEM_W / 2;
    strip.style.transition = 'none';
    strip.style.transform  = `translateX(${_rstripIdleX}px)`;
}

// ── Холостой прокрут: старт ───────────────────────────────────────────────────
function _rstripStartIdle() {
    if (_rstripIdleFrame) return;   // уже запущен

    const container = document.getElementById('roulette-strip-container');
    const strip     = document.getElementById('roulette-strip');
    if (!container || !strip || !rouletteConfig.items) return;

    // Страховка: если контейнер ещё скрыт (offsetWidth=0), повторим через 50 мс
    const cx = container.offsetWidth / 2;
    if (cx === 0) {
        setTimeout(_rstripStartIdle, 50);
        return;
    }

    const items     = rouletteConfig.items;
    const loopWidth = items.length * RSTRIP_ITEM_W;  // один «оборот» в пикселях

    // Граница заворота: когда X уходит левее, чем лап 15 от центра — возвращаем на loopWidth вперёд
    const wrapThreshold = cx - 15 * loopWidth - RSTRIP_ITEM_W / 2;

    // Берём текущую позицию из трансформации, чтобы idle продолжил с того места
    const match  = strip.style.transform.match(/translateX\(([-\d.]+)px\)/);
    _rstripIdleX = match ? parseFloat(match[1]) : _rstripIdleX;
    _rstripIdleLastTime = performance.now();

    function frame(now) {
        const dt = Math.min(now - _rstripIdleLastTime, 50); // cap 50ms для табов в фоне
        _rstripIdleLastTime = now;

        _rstripIdleX -= RSTRIP_IDLE_SPEED * dt / 1000;

        // Бесшовный заворот: сдвигаем на один полный оборот назад (то же визуально)
        if (_rstripIdleX < wrapThreshold) {
            _rstripIdleX += loopWidth;
        }

        strip.style.transform = `translateX(${_rstripIdleX}px)`;
        _rstripIdleFrame = requestAnimationFrame(frame);
    }

    _rstripIdleFrame = requestAnimationFrame(frame);
}

// ── Холостой прокрут: стоп ────────────────────────────────────────────────────
function _rstripStopIdle() {
    if (_rstripIdleFrame) {
        cancelAnimationFrame(_rstripIdleFrame);
        _rstripIdleFrame = null;
    }
}

// ── Ждать закрытия модалки, затем выполнить callback ─────────────────────────
function _onModalClose(modalId, cb) {
    const el = document.getElementById(modalId);
    if (!el) { setTimeout(cb, 500); return; }
    const obs = new MutationObserver(() => {
        if (el.classList.contains('hidden')) {
            obs.disconnect();
            cb();
        }
    });
    obs.observe(el, { attributes: true, attributeFilter: ['class'] });
}

// ── Мгновенный перенос ленты (без анимации) ───────────────────────────────────
function _rstripJumpTo(absIdx) {
    const container = document.getElementById('roulette-strip-container');
    const strip     = document.getElementById('roulette-strip');
    if (!container || !strip) return;
    const cx = container.offsetWidth / 2;
    const x  = cx - (absIdx * RSTRIP_ITEM_W + RSTRIP_ITEM_W / 2);
    strip.style.transition = 'none';
    strip.style.transform  = `translateX(${x}px)`;
}

// ── Анимация спина к победителю ───────────────────────────────────────────────
function animateRouletteStrip(winIndex, callback) {
    const container = document.getElementById('roulette-strip-container');
    const strip     = document.getElementById('roulette-strip');
    if (!container || !strip) { if (callback) callback(); return; }

    const items  = rouletteConfig.items;
    const cx     = container.offsetWidth / 2;

    // Стартовая позиция (фиксированная, мгновенный прыжок)
    const startAbsIdx = RSTRIP_START_LAP * items.length;
    const startX      = cx - (startAbsIdx * RSTRIP_ITEM_W + RSTRIP_ITEM_W / 2);

    // Финальная позиция: победитель в нужном «круге»
    const winAbsIdx = (RSTRIP_START_LAP + RSTRIP_LAPS) * items.length + winIndex;
    const targetX   = cx - (winAbsIdx * RSTRIP_ITEM_W + RSTRIP_ITEM_W / 2);

    strip.style.transition = 'none';
    strip.style.transform  = `translateX(${startX}px)`;
    strip.offsetWidth;                  // force reflow

    const startTime = performance.now();
    let   lastSlot  = Math.floor((cx - startX) / RSTRIP_ITEM_W);

    function easeOutQuint(t) { return 1 - Math.pow(1 - t, 5); }

    function step(now) {
        const elapsed  = now - startTime;
        const progress = Math.min(elapsed / RSTRIP_DURATION, 1);
        const eased    = easeOutQuint(progress);
        const currentX = startX + (targetX - startX) * eased;

        strip.style.transform = `translateX(${currentX}px)`;

        // Вибрация при пересечении границы слота
        const curSlot = Math.floor((cx - currentX) / RSTRIP_ITEM_W);
        if (curSlot !== lastSlot) {
            lastSlot = curSlot;
            if      (progress < 0.55) vibrate('heavy');
            else if (progress < 0.82) vibrate('medium');
            else                       vibrate('light');
        }

        if (progress < 1) {
            requestAnimationFrame(step);
        } else {
            // Запоминаем финальный X для idle, чтобы он продолжил с этой позиции
            _rstripIdleX = targetX;

            // Подсветка победного элемента
            const winEl = strip.querySelector(
                `[data-lap="${RSTRIP_START_LAP + RSTRIP_LAPS}"][data-idx="${winIndex}"]`
            );
            if (winEl) {
                winEl.style.borderColor = 'rgba(168,85,247,0.9)';
                winEl.style.background  = 'rgba(168,85,247,0.18)';
                winEl.style.boxShadow   = '0 0 26px rgba(168,85,247,0.65)';
                winEl.style.transform   = 'scale(1.07)';
            }
            if (callback) callback();
        }
    }

    requestAnimationFrame(step);
}

// ── Загрузка информации о рулетке (кулдаун / стоимость) ───────────────────────
async function fetchRouletteInfo() {
    const btn      = document.getElementById('btn-spin');
    const costText = document.getElementById('spin-cost-text');
    if (!btn) return;
    const btnSpan = btn.querySelector('span');

    if (isDemoMode) {
        btnSpan.innerText = currentLang === 'en' ? 'Spin (Demo)' : 'Крутить (Демо)';
        if (costText) costText.innerText = currentLang === 'en'
            ? 'Demo — nothing is credited' : 'Демо — ничего не начисляется';
        btn.disabled = false;
        return;
    }

    btnSpan.innerText = i18n[currentLang].loading;
    btn.disabled = true;
    try {
        const res  = await fetch('/api/roulette/info', { headers: getApiHeaders() });
        const data = await res.json();
        const icon = data.currency === 'stars' ? '/gifts/stars.png' : '/gifts/dount.png';

        if (data.can_free) {
            btnSpan.innerText = i18n[currentLang].spin_free;
            if (costText) costText.innerText = i18n[currentLang].free_24h;
        } else {
            btnSpan.innerHTML = `${i18n[currentLang].spin_for} ${data.cost} <img src="${icon}" class="w-5 h-5 inline object-contain align-text-bottom">`;
            if (costText) costText.innerText =
                `${i18n[currentLang].until_free} ${Math.ceil(data.time_left / 3600)} ${i18n[currentLang].h}`;
        }
        btn.disabled = false;
    } catch (e) {
        if (btnSpan) btnSpan.innerText = 'Error';
    }
}

// ── Открытие страницы рулетки ─────────────────────────────────────────────────
async function openRoulette() {
    if (!rouletteConfig.items) return;
    vibrate('medium');
    switchTab('roulette');
    syncDemoToggles();

    _rstripStopIdle();

    // Принудительно читаем offsetWidth сразу после switchTab — это заставляет
    // браузер синхронно вычислить layout (reflow), поэтому container.offsetWidth
    // уже будет реальным значением, а не нулём из скрытого состояния.
    const _ctr = document.getElementById('roulette-strip-container');
    if (_ctr) void _ctr.offsetWidth;

    renderRouletteStrip();
    _rstripStartIdle();

    await fetchRouletteInfo();
}

// ── Запуск прокрутки ──────────────────────────────────────────────────────────
async function spinRoulette() {
    if (rouletteSpinning) return;
    vibrate('heavy');
    const btn = document.getElementById('btn-spin');
    btn.disabled = true;

    // Останавливаем idle перед спином
    _rstripStopIdle();

    // ── Демо-режим ────────────────────────────────────────────────────────────
    if (isDemoMode) {
        rouletteSpinning = true;
        renderRouletteStrip();
        const demoIndex = Math.floor(Math.random() * rouletteConfig.items.length);

        animateRouletteStrip(demoIndex, () => {
            rouletteSpinning = false;
            showRouletteResultModal(rouletteConfig.items[demoIndex], true);
            fetchRouletteInfo();
            // Возобновляем idle после закрытия модалки
            _onModalClose('roulette-result-modal', _rstripStartIdle);
        });
        return;
    }

    // ── Боевой режим ──────────────────────────────────────────────────────────
    try {
        const res  = await fetch('/api/roulette/spin', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({}),
        });
        const data = await res.json();

        if (typeof handleNotSubscribed === 'function' && handleNotSubscribed(data)) {
            btn.disabled = false;
            _rstripStartIdle();   // спин не состоялся — возобновляем idle
            return;
        }
        if (data.status !== 'ok') {
            showNotify(data.detail || 'Error!', 'error');
            btn.disabled = false;
            _rstripStartIdle();
            return;
        }

        rouletteSpinning = true;
        renderRouletteStrip();    // чистая лента перед анимацией спина

        animateRouletteStrip(data.win_index, () => {
            rouletteSpinning = false;
            if (data.balance !== undefined) myBalance = data.balance;
            if (data.stars   !== undefined) myStars   = data.stars;
            myGifts = data.user_gifts;
            updateUI();
            showRouletteResultModal(data.win_item);
            fetchRouletteInfo();
            // После закрытия модалки («Забрать приз») — снова медленный прокрут
            _onModalClose('roulette-result-modal', _rstripStartIdle);
        });
    } catch (e) {
        showNotify(i18n[currentLang].err_conn, 'error');
        btn.disabled = false;
        _rstripStartIdle();
    }
}

// ── Модальное окно результата ─────────────────────────────────────────────────
function showRouletteResultModal(item, isDemo = false) {
    vibrate('heavy');
    const isGift = item.type === 'gift';
    let photoSrc = 'https://via.placeholder.com/48';
    let text     = 'Приз';

    if (isGift) {
        const def = mainGifts[item.gift_id] || tgGifts[item.gift_id] || baseGifts[item.gift_id];
        if (def) { photoSrc = getImgSrc(def.photo); text = def.name; }
    } else if (item.type === 'stars') {
        photoSrc = getImgSrc(item.photo || '/gifts/stars.png');
        text = `+${item.amount} ${currentLang === 'en' ? 'stars!' : 'звезд!'}`;
    } else if (item.type === 'donuts') {
        photoSrc = getImgSrc(item.photo || '/gifts/dount.png');
        text = `+${item.amount} ${i18n[currentLang].donuts_text || 'пончиков!'}`;
    }

    document.getElementById('rr-photo').src      = photoSrc;
    document.getElementById('rr-text').innerHTML = text;

    if (typeof configureCaseGiftActionsIfNeeded === 'function') {
        if (isGift) {
            configureCaseGiftActionsIfNeeded(item.gift_id, 'roulette', isDemo);
        } else {
            const actionsBox = document.getElementById('rr-gift-actions');
            const closeBtn   = document.getElementById('rr-btn-close');
            if (actionsBox) actionsBox.classList.add('hidden');
            if (closeBtn)   closeBtn.classList.remove('hidden');
        }
    }

    const demoBadge = document.getElementById('rr-demo-badge');
    if (demoBadge) demoBadge.style.display = isDemo ? '' : 'none';

    const content = document.getElementById('rrm-content');
    if (content) { content.classList.remove('scale-95'); content.classList.add('scale-100'); }

    openModal('roulette-result-modal');
}

// ── Экспорт ───────────────────────────────────────────────────────────────────
window.renderRouletteStrip = renderRouletteStrip;
window.openRoulette        = openRoulette;
window.spinRoulette        = spinRoulette;
window.fetchRouletteInfo   = fetchRouletteInfo;
window._rstripStartIdle    = _rstripStartIdle;
window._rstripStopIdle     = _rstripStopIdle;

// ── Блокировка горизонтального свайпа на странице рулетки ─────────────────────
(function blockHorizontalSwipe() {
    function attach() {
        const page = document.getElementById('page-roulette');
        if (!page) { setTimeout(attach, 300); return; }
        page.addEventListener('touchstart', function (e) {
            this._tsx = e.touches[0].clientX;
            this._tsy = e.touches[0].clientY;
        }, { passive: true });
        page.addEventListener('touchmove', function (e) {
            const dx = Math.abs(e.touches[0].clientX - (this._tsx || 0));
            const dy = Math.abs(e.touches[0].clientY - (this._tsy || 0));
            if (dx > dy && dx > 8 && e.cancelable) e.preventDefault();
        }, { passive: false });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', attach);
    } else {
        attach();
    }
})();
