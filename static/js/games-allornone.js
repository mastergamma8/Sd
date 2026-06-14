// =====================================================
// games-allornone.js — Игра «Всё или ничего»
// =====================================================

let allOrNoneGifts       = [];
let allOrNoneSelected    = null;   // { gift_id, name, photo, value_stars }
let allOrNoneRealValue   = 0;      // точная рыночная цена (из /price)
let allOrNoneChance      = 10;
let allOrNoneSpinning    = false;
let allOrNoneShowGrid    = false;
let allOrNoneLoadingPrice = false;

// ─────────────────────────────────────────────────────────────────────────────
// Открытие / закрытие
// ─────────────────────────────────────────────────────────────────────────────

function openAllOrNoneGame() {
    if (typeof showGameView === 'function') showGameView('games-allornone-view');
    if (typeof syncDemoToggles === 'function') syncDemoToggles();
    allOrNoneSelected   = null;
    allOrNoneRealValue  = 0;
    allOrNoneChance     = 10;
    allOrNoneShowGrid   = false;
    _aonRenderSelectBtn();
    _aonHideGrid();
    _aonUpdateSlider();
    if (allOrNoneGifts.length === 0) _aonLoadGifts();
}

function closeAllOrNoneGame() {
    if (typeof hideGameView === 'function') hideGameView('games-allornone-view');
    allOrNoneSpinning = false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Загрузка списка подарков
// ─────────────────────────────────────────────────────────────────────────────

async function _aonLoadGifts() {
    const grid = document.getElementById('aon-gifts-grid');
    if (grid) grid.innerHTML = `<p class="col-span-3 text-center text-white/30 text-xs py-4">${_aonT('loading')}</p>`;
    try {
        const res  = await fetch('/api/allornone/gifts', { headers: getApiHeaders() });
        const data = await res.json();
        allOrNoneGifts = data.gifts || [];
        _aonRenderGrid();
    } catch {
        const g = document.getElementById('aon-gifts-grid');
        if (g) g.innerHTML = `<p class="col-span-3 text-center text-red-400 text-xs py-4">${_aonT('err_conn')}</p>`;
    }
}

function _aonRenderGrid() {
    const grid = document.getElementById('aon-gifts-grid');
    if (!grid || !allOrNoneGifts.length) return;
    grid.innerHTML = allOrNoneGifts.map(g => {
        const sel = allOrNoneSelected?.gift_id == g.gift_id;
        return `
        <div onclick="aonSelectGift(${g.gift_id})"
             class="aon-gift-card flex flex-col items-center gap-1 p-2 rounded-2xl cursor-pointer active:scale-95 transition-all
                    ${sel ? 'border border-yellow-400/70 bg-yellow-400/8 shadow-[0_0_12px_rgba(234,179,8,0.25)]'
                           : 'border border-white/10 bg-white/3 hover:border-white/20'}"
             style="${sel ? 'background:rgba(234,179,8,0.06)' : ''}">
            <img src="${g.photo}" class="w-12 h-12 object-contain"
                 onerror="this.src='https://via.placeholder.com/48?text=🎁'">
            <span class="text-[9px] text-white/75 font-bold text-center leading-tight line-clamp-2">${g.name}</span>
            <span class="flex items-center gap-0.5 text-[9px] text-yellow-300 font-black mt-0.5">
                ${g.value_stars}
                <img src="/gifts/stars.png" class="w-2.5 h-2.5 object-contain">
            </span>
        </div>`;
    }).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// Выбор подарка
// ─────────────────────────────────────────────────────────────────────────────

function aonToggleGrid() {
    allOrNoneShowGrid = !allOrNoneShowGrid;
    if (allOrNoneShowGrid) {
        if (!allOrNoneGifts.length) _aonLoadGifts(); else _aonRenderGrid();
        const w = document.getElementById('aon-grid-wrapper');
        if (w) w.classList.remove('hidden');
        const c = document.getElementById('aon-chevron');
        if (c) c.style.transform = 'rotate(180deg)';
    } else {
        _aonHideGrid();
    }
}

function _aonHideGrid() {
    allOrNoneShowGrid = false;
    const w = document.getElementById('aon-grid-wrapper');
    if (w) w.classList.add('hidden');
    const c = document.getElementById('aon-chevron');
    if (c) c.style.transform = 'rotate(0deg)';
}

async function aonSelectGift(giftId) {
    if (typeof vibrate === 'function') vibrate('light');
    allOrNoneSelected = allOrNoneGifts.find(g => g.gift_id == giftId) || null;
    allOrNoneRealValue = allOrNoneSelected?.value_stars || 0;   // показываем приблиз. пока грузим
    _aonHideGrid();
    _aonRenderSelectBtn();
    _aonUpdateSlider();

    if (!allOrNoneSelected) return;

    // Запрашиваем точную рыночную цену с Portal Market (один раз при выборе)
    allOrNoneLoadingPrice = true;
    _aonShowPriceLoading();
    try {
        const res  = await fetch(
            `/api/allornone/price?gift_id=${giftId}&chance_percent=${allOrNoneChance}`,
            { headers: getApiHeaders() }
        );
        const data = await res.json();
        if (data.value_stars) {
            allOrNoneRealValue = data.value_stars;
            // Обновляем приблизительную цену в сетке подарков
            const found = allOrNoneGifts.find(g => g.gift_id == giftId);
            if (found) found.value_stars = data.value_stars;
        }
    } catch { /* оставляем приблизительную */ }
    allOrNoneLoadingPrice = false;
    _aonRenderSelectBtn();   // обновляем кнопку с реальной ценой
    _aonUpdateSlider();
}

function _aonRenderSelectBtn() {
    const btn = document.getElementById('aon-select-btn');
    if (!btn) return;
    if (allOrNoneSelected) {
        const displayVal = allOrNoneRealValue || allOrNoneSelected.value_stars || 0;
        const priceHtml  = displayVal
            ? `${displayVal} <img src="/gifts/stars.png" class="w-3 h-3 object-contain">`
            : `<span class="text-white/30 animate-pulse">${_aonT('aon_loading_price')}</span>`;
        btn.innerHTML = `
            <img src="${allOrNoneSelected.photo}" class="w-10 h-10 object-contain flex-shrink-0"
                 onerror="this.src='https://via.placeholder.com/40?text=🎁'">
            <div class="flex-1 min-w-0">
                <div class="text-sm font-black text-white truncate">${allOrNoneSelected.name}</div>
                <div class="flex items-center gap-1 text-[10px] text-yellow-300 font-black mt-0.5">
                    ${priceHtml}
                </div>
            </div>
            <svg id="aon-chevron" class="w-4 h-4 text-white/40 flex-shrink-0 transition-transform duration-200"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>`;
    } else {
        btn.innerHTML = `
            <span class="text-2xl">🎁</span>
            <span class="flex-1 text-sm font-bold text-white/50">${_aonT('aon_select_gift')}</span>
            <svg id="aon-chevron" class="w-4 h-4 text-white/40 flex-shrink-0 transition-transform duration-200"
                 fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
            </svg>`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Ползунок шанса
// ─────────────────────────────────────────────────────────────────────────────

function aonOnSliderInput(val) {
    allOrNoneChance = parseInt(val, 10);
    _aonUpdateSlider();
}

function _aonShowPriceLoading() {
    const p = document.getElementById('aon-price-display');
    if (p) p.innerHTML = `
        <div class="flex items-center gap-2">
            <div class="w-4 h-4 border-2 border-yellow-400/40 border-t-yellow-400 rounded-full animate-spin"></div>
            <span class="text-white/40 text-xs">${_aonT('aon_loading_price')}</span>
        </div>`;
    const b = document.getElementById('aon-spin-btn');
    if (b) { b.disabled = true; b.innerHTML = `<span>${_aonT('aon_loading_price')}</span>`; }
}

function _aonUpdateSlider() {
    const pct      = allOrNoneChance;
    const pctEl    = document.getElementById('aon-chance-pct');
    const sliderEl = document.getElementById('aon-chance-slider');
    const barEl    = document.getElementById('aon-slider-bar');

    if (pctEl)    pctEl.textContent = `${pct}%`;
    if (sliderEl) sliderEl.value = pct;
    if (barEl) {
        const f = (pct - 1) / 49;
        barEl.style.background = `linear-gradient(to right,#eab308 0%,#f59e0b ${f*100}%,rgba(255,255,255,0.1) ${f*100}%)`;
    }

    if (allOrNoneLoadingPrice) return;

    const priceEl = document.getElementById('aon-price-display');
    const btnEl   = document.getElementById('aon-spin-btn');

    if (!allOrNoneSelected) {
        if (priceEl) priceEl.innerHTML =
            `<span class="text-white/30 text-sm">${_aonT('aon_select_first')}</span>`;
        if (btnEl) {
            btnEl.disabled = true;
            btnEl.innerHTML = `<span>${_aonT('aon_select_first')}</span>`;
        }
        return;
    }

    const valueStars = allOrNoneRealValue || allOrNoneSelected.value_stars || 0;
    const cost       = _aonCalcCost(valueStars, pct);
    const hasEnough  = isDemoMode || myStars >= cost;

    if (priceEl) {
        priceEl.innerHTML = `
            <div class="flex items-center justify-between w-full">
                <span class="text-white/45 text-xs">${_aonT('aon_cost_label')}</span>
                <span class="flex items-center gap-1 text-yellow-300 font-black text-lg leading-none">
                    ${cost} <img src="/gifts/stars.png" class="w-4 h-4 object-contain">
                </span>
            </div>
            <div class="flex items-center justify-between w-full mt-1.5 pt-1.5 border-t border-white/5">
                <span class="text-white/35 text-xs">${_aonT('aon_your_balance')}</span>
                <span class="flex items-center gap-1 text-white/60 text-xs font-bold">
                    ${typeof myStars !== 'undefined' ? myStars : '—'} <img src="/gifts/stars.png" class="w-3 h-3 object-contain">
                </span>
            </div>`;
    }

    if (btnEl) {
        btnEl.disabled = !hasEnough && !isDemoMode;
        btnEl.innerHTML = `
            <span class="font-bold">${_aonT('aon_spin_btn')}${isDemoMode ? ' (' + _aonT('aon_demo') + ')' : ''}</span>
            <span class="flex items-center gap-1 font-black text-base">
                ${cost} <img src="/gifts/stars.png" class="w-4 h-4 object-contain">
            </span>`;
        btnEl.style.opacity = hasEnough || isDemoMode ? '1' : '0.45';
    }
}

function _aonCalcCost(valueStars, chance) {
    if (!valueStars || !chance) return 1;
    return Math.max(1, Math.round(valueStars * (chance / 100) / 0.85));
}

// ─────────────────────────────────────────────────────────────────────────────
// Спин
// ─────────────────────────────────────────────────────────────────────────────

async function aonSpin() {
    if (allOrNoneSpinning || allOrNoneLoadingPrice) return;
    if (!allOrNoneSelected) {
        if (typeof showNotify === 'function') showNotify(_aonT('aon_select_first'), 'warning');
        return;
    }
    const valueStars = allOrNoneRealValue || allOrNoneSelected.value_stars || 0;
    const cost       = _aonCalcCost(valueStars, allOrNoneChance);
    if (!isDemoMode && myStars < cost) {
        if (typeof showNotify === 'function') showNotify(_aonT('not_enough_stars'), 'warning');
        return;
    }
    if (typeof vibrate === 'function') vibrate('medium');

    allOrNoneSpinning = true;
    const btnEl = document.getElementById('aon-spin-btn');
    if (btnEl) { btnEl.disabled = true; btnEl.innerHTML = `<div class="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin mx-auto"></div>`; }

    try {
        const res  = await fetch('/api/allornone/spin', {
            method: 'POST', headers: getApiHeaders(),
            body: JSON.stringify({
                gift_id:        allOrNoneSelected.gift_id,
                chance_percent: allOrNoneChance,
                is_demo:        isDemoMode,
            }),
        });
        const data = await res.json();

        if (data.status !== 'ok') {
            allOrNoneSpinning = false;
            if (typeof showNotify === 'function') showNotify(data.detail || _aonT('err_conn'), 'error');
            _aonUpdateSlider();
            return;
        }

        // Обновляем баланс немедленно
        if (typeof myStars !== 'undefined') myStars = data.stars;
        if (data.user_gifts) myGifts = data.user_gifts;
        if (typeof updateUI === 'function') updateUI();

        // Запускаем анимацию
        await _aonPlayAnimation(data.won, data.gift_photo, data.gift_name, data.demo);

    } catch {
        allOrNoneSpinning = false;
        if (typeof showNotify === 'function') showNotify(_aonT('err_conn_srv'), 'error');
        _aonUpdateSlider();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Анимация рулетки (модальное окно, идентично кейсам)
// ─────────────────────────────────────────────────────────────────────────────

function _aonPlayAnimation(won, giftPhoto, giftName, isDemo) {
    const modal       = document.getElementById('aon-anim-modal');
    const track       = document.getElementById('aon-anim-track');
    const slotPhase   = document.getElementById('aon-anim-slot');
    const resultWin   = document.getElementById('aon-anim-win');
    const resultLose  = document.getElementById('aon-anim-lose');
    const flash       = document.getElementById('aon-anim-flash');
    const progressBar = document.getElementById('aon-anim-progress');
    const spinLabel   = document.getElementById('aon-anim-label');
    const demoBadge   = document.getElementById('aon-anim-demo-badge');

    if (!modal || !track) return Promise.resolve();

    // Сброс фаз
    slotPhase.classList.remove('hidden');  slotPhase.style.display = '';
    resultWin.classList.add('hidden');     resultWin.style.display = 'none';
    resultLose.classList.add('hidden');    resultLose.style.display = 'none';
    flash.style.opacity = '0';
    progressBar.style.transition = 'none';
    progressBar.style.width = '0%';
    if (spinLabel) { spinLabel.textContent = _aonT('case_spinning') || 'Вращается...'; }
    if (demoBadge) demoBadge.style.display = isDemo ? '' : 'none';

    // Название подарка в шапке
    const titleEl = document.getElementById('aon-anim-gift-name');
    if (titleEl) titleEl.textContent = giftName;

    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // ── Строим ленту (60 позиций, WIN_INDEX=52) ───────────────────────────
    const ITEM_W = 96, GAP = 10, STEP = ITEM_W + GAP;
    const TOTAL  = 60, WIN_IDX = 52;

    track.style.transition = 'none';
    track.style.transform  = 'translateX(0px)';
    track.innerHTML = '';

    for (let i = 0; i < TOTAL; i++) {
        const isWinner = (i === WIN_IDX);
        const showGift = isWinner ? won : (i % 2 === 0);

        const card = document.createElement('div');
        card.style.cssText = `
            min-width:${ITEM_W}px; height:96px; border-radius:14px;
            display:flex; flex-direction:column; align-items:center;
            justify-content:center; padding:8px 4px; gap:4px; flex-shrink:0;
            background:${isWinner && won ? 'rgba(245,158,11,0.18)' : 'rgba(255,255,255,0.04)'};
            border:1.5px solid ${isWinner && won ? 'rgba(250,204,21,0.65)' : 'rgba(255,255,255,0.08)'};
            box-shadow:${isWinner && won ? '0 0 18px rgba(245,158,11,0.38)' : 'none'};`;

        if (showGift) {
            card.innerHTML = `
                <img src="${giftPhoto}" style="width:52px;height:52px;object-fit:contain;"
                     onerror="this.src='https://via.placeholder.com/52?text=🎁'">
                <span style="font-size:9px;color:rgba(255,255,255,0.6);font-weight:700;
                             text-align:center;max-width:88px;overflow:hidden;
                             text-overflow:ellipsis;white-space:nowrap;">${giftName}</span>`;
        } else {
            card.innerHTML = `
                <span style="font-size:26px;opacity:0.22;">✕</span>
                <span style="font-size:9px;color:rgba(255,255,255,0.25);font-weight:800;
                             letter-spacing:.05em;">${_aonT('aon_nothing')}</span>`;
        }
        track.appendChild(card);
    }

    return new Promise(resolve => {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const visibleW    = track.parentElement.offsetWidth;
                const centerOff   = Math.floor(visibleW / 2);
                const PADDING     = 12;
                const finalX      = -(WIN_IDX * STEP + PADDING - centerOff + ITEM_W / 2);
                const DURATION    = 5200;

                // Прогресс-бар
                progressBar.style.transition = `width ${DURATION}ms linear`;
                progressBar.style.width = '100%';

                if (typeof vibrate === 'function') vibrate('heavy');

                track.style.transition = `transform ${DURATION}ms cubic-bezier(0.12,0.8,0.25,1.0)`;
                track.style.transform  = `translateX(${finalX}px)`;

                // Прогрессивная вибрация (heavy → medium → light)
                const t0 = performance.now();
                let lastIdx = -1;
                function vibStep(now) {
                    const elapsed  = now - t0;
                    const progress = Math.min(elapsed / DURATION, 1);
                    const eased    = 1 - Math.pow(1 - progress, 3);
                    const curX     = finalX * eased;
                    const curIdx   = Math.floor((-curX + PADDING + centerOff - ITEM_W / 2) / STEP);
                    if (curIdx > lastIdx && curIdx >= 0 && curIdx < TOTAL) {
                        if (typeof vibrate === 'function') {
                            if      (progress < 0.60) vibrate('heavy');
                            else if (progress < 0.85) vibrate('medium');
                            else                       vibrate('light');
                        }
                        lastIdx = curIdx;
                    }
                    if (progress < 1) requestAnimationFrame(vibStep);
                }
                requestAnimationFrame(vibStep);

                // «Почти...» на 65% длительности
                setTimeout(() => {
                    if (spinLabel) spinLabel.textContent = _aonT('case_almost') || 'Почти...';
                }, DURATION * 0.65);

                // Финал
                setTimeout(() => {
                    flash.style.transition = 'opacity 0.15s ease';
                    flash.style.opacity    = '1';
                    if (typeof vibrate === 'function') vibrate('heavy');

                    setTimeout(() => {
                        flash.style.transition = 'opacity 0.5s ease';
                        flash.style.opacity    = '0';
                        slotPhase.style.display = 'none';
                        slotPhase.classList.add('hidden');

                        const resultEl = won ? resultWin : resultLose;
                        if (won) {
                            const img  = document.getElementById('aon-anim-result-img');
                            const name = document.getElementById('aon-anim-result-name');
                            if (img)  img.src         = giftPhoto;
                            if (name) name.textContent = giftName;
                        }

                        resultEl.classList.remove('hidden');
                        resultEl.style.display    = 'flex';
                        resultEl.style.opacity    = '0';
                        resultEl.style.transform  = 'scale(0.85)';
                        resultEl.style.transition =
                            'opacity 0.4s ease, transform 0.4s cubic-bezier(0.175,0.885,0.32,1.275)';

                        requestAnimationFrame(() => requestAnimationFrame(() => {
                            resultEl.style.opacity   = '1';
                            resultEl.style.transform = 'scale(1)';
                        }));

                        if (typeof vibrate === 'function') vibrate('heavy');
                        resolve();
                    }, 180);
                }, DURATION + 100);
            });
        });
    });
}

function closeAonAnimation() {
    if (typeof vibrate === 'function') vibrate('light');
    const modal = document.getElementById('aon-anim-modal');
    if (modal) { modal.classList.add('hidden'); modal.style.display = ''; }
    allOrNoneSpinning = false;
    _aonUpdateSlider();
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function _aonT(key) {
    return (i18n && i18n[currentLang] && i18n[currentLang][key]) ? i18n[currentLang][key] : key;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
window.openAllOrNoneGame  = openAllOrNoneGame;
window.closeAllOrNoneGame = closeAllOrNoneGame;
window.aonToggleGrid      = aonToggleGrid;
window.aonSelectGift      = aonSelectGift;
window.aonOnSliderInput   = aonOnSliderInput;
window.aonSpin            = aonSpin;
window.closeAonAnimation  = closeAonAnimation;