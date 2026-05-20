// =====================================================
// games-rocket.js — РАКЕТА (Crash) — Общий раунд
// =====================================================

'use strict';

let rocketConfigLocal    = null;
let rocketAnimFrame      = null;
let rocketPollTimer      = null;
let rocketPollingActive  = false;  // страж от race-condition при закрытии

// Кэш состояния (обновляется с сервера каждые 200–500 мс)
let rocketState = {
    round_id:       0,
    state:          'waiting',
    time_left:      0,
    current_mult:   null,
    revealed_crash: null,
    my_bet:         null,
    bets:           [],
};

// ─── Точка синхронизации для интерполяции множителя ───
// Вместо того чтобы считать мульт с нуля от старта раунда,
// мы каждый раз при получении серверного ответа запоминаем:
//   syncMult     — серверный множитель в момент ответа
//   syncPerfTime — performance.now() в момент ответа
// Затем в каждом кадре:
//   localMult = syncMult * GROWTH_SPEED ^ (now - syncPerfTime)
// Это устраняет накопление ошибки.
let syncMult     = 1.0;
let syncPerfTime = 0;
const GROWTH_SPEED_DEFAULT = 1.00006; // per millisecond

// ─────────────────────────────────────────────────────
// ОТКРЫТИЕ / ЗАКРЫТИЕ
// ─────────────────────────────────────────────────────

function openRocketGame() {
    if (typeof showGameView === 'function') {
        showGameView('games-rocket-view');
    } else {
        if (typeof vibrate === 'function') vibrate('light');
        document.getElementById('games-main-view')?.classList.add('hidden');
        document.getElementById('games-rocket-view')?.classList.remove('hidden');
    }
    if (typeof syncDemoToggles === 'function') syncDemoToggles();
    startRocketPolling();
}

function closeRocketGame() {
    if (rocketState.state === 'flying' && rocketState.my_bet?.status === 'active') {
        if (typeof showNotify === 'function') showNotify(i18n[currentLang]?.rocket_take_bet_before_exit || 'Заберите ставку перед выходом!', 'warning');
        return;
    }
    stopRocketPolling();
    if (typeof hideGameView === 'function') {
        hideGameView('games-rocket-view');
    } else {
        if (typeof vibrate === 'function') vibrate('light');
        document.getElementById('games-rocket-view')?.classList.add('hidden');
        document.getElementById('games-main-view')?.classList.remove('hidden');
    }
}

// ─────────────────────────────────────────────────────
// ПОЛЛИНГ
// ─────────────────────────────────────────────────────

function startRocketPolling() {
    stopRocketPolling();
    rocketPollingActive = true;
    pollRocketState();
}

function stopRocketPolling() {
    rocketPollingActive = false;
    if (rocketPollTimer)  { clearTimeout(rocketPollTimer);        rocketPollTimer  = null; }
    if (rocketAnimFrame)  { cancelAnimationFrame(rocketAnimFrame); rocketAnimFrame  = null; }
}

async function pollRocketState() {
    try {
        const res  = await fetch('/api/rocket/state', { headers: getApiHeaders() });
        const data = await res.json();
        // Проверяем флаг ПОСЛЕ await: пользователь мог закрыть игру пока шёл запрос
        if (!rocketPollingActive) return;
        applyServerState(data);
    } catch (_) { /* тихо */ }

    if (!rocketPollingActive) return;
    const interval = (rocketState.state === 'flying') ? 150 : 450;
    rocketPollTimer = setTimeout(pollRocketState, interval);
}

// ─────────────────────────────────────────────────────
// ПРИМЕНЕНИЕ СЕРВЕРНОГО СОСТОЯНИЯ
// ─────────────────────────────────────────────────────

function applyServerState(data) {
    const prevState = rocketState.state;
    const prevRound = rocketState.round_id;

    rocketState = data;

    // ── Новый раунд: полный сброс ──
    if (data.round_id !== prevRound) {
        _stopAnimation();
        syncMult     = 1.0;
        syncPerfTime = 0;
    }

    // ── Переход в flying ──
    if (data.state === 'flying') {
        // ВСЕГДА обновляем точку синхронизации при каждом ответе во время полёта.
        // Это ключевое исправление: мы привязываемся к последнему известному
        // серверному значению, а не считаем от нуля.
        syncMult     = data.current_mult || 1.0;
        syncPerfTime = performance.now();

        if (prevState !== 'flying') {
            // Только при первом переходе запускаем анимацию и вибрацию
            _startAnimation();
            if (typeof vibrate === 'function') vibrate('medium');
            else if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.impactOccurred('medium');
        }
    }

    // ── Краш: немедленно остановить анимацию ──
    if (data.state === 'crashed') {
        _stopAnimation();
        // Принудительно вывести правильный краш-мульт (не анимированный)
        const multEl = document.getElementById('rocket-multiplier');
        if (multEl) {
            multEl.innerText = (data.revealed_crash || 0).toFixed(2) + 'x';
        }
        // Вибрация ОДИН РАЗ — только при первом переходе в crashed
        if (prevState !== 'crashed') {
            if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.notificationOccurred('error');
            else if (window.tg?.HapticFeedback) window.tg.HapticFeedback.notificationOccurred('error');
            else if (typeof vibrate === 'function') vibrate('heavy');
        }
    }

    renderRocketUI();
    renderBetsList(data.bets || []);
    updateActionButton();
}

// ─────────────────────────────────────────────────────
// АНИМАЦИЯ МНОЖИТЕЛЯ (requestAnimationFrame)
// ─────────────────────────────────────────────────────

function _startAnimation() {
    _stopAnimation();
    const growthSpeed = rocketConfigLocal?.growth_speed || GROWTH_SPEED_DEFAULT;

    function frame() {
        if (rocketState.state !== 'flying') {
            rocketAnimFrame = null;
            return;
        }

        // Интерполяция вперёд от последней точки синхронизации
        const msSinceSync = performance.now() - syncPerfTime;
        const localMult   = syncMult * Math.pow(growthSpeed, msSinceSync);

        const multEl = document.getElementById('rocket-multiplier');
        if (multEl) multEl.innerText = localMult.toFixed(2) + 'x';

        _updateCashoutButtonMult(localMult);
        _updateBetsListMult(localMult);

        rocketAnimFrame = requestAnimationFrame(frame);
    }

    rocketAnimFrame = requestAnimationFrame(frame);
}

function _stopAnimation() {
    if (rocketAnimFrame) { cancelAnimationFrame(rocketAnimFrame); rocketAnimFrame = null; }
}

// ─────────────────────────────────────────────────────
// РЕНДЕР ОСНОВНОГО UI
// ─────────────────────────────────────────────────────

function _currencyIcon() {
    return (rocketConfigLocal?.currency === 'stars') ? '/gifts/stars.png' : '/gifts/dount.png';
}

function renderRocketUI() {
    const state      = rocketState.state;
    const myBet      = rocketState.my_bet;
    const multWrapper= document.getElementById('rocket-multiplier-wrapper');
    const multEl     = document.getElementById('rocket-multiplier');
    const rocketImg  = document.getElementById('rocket-img');
    const starsBg    = document.getElementById('rocket-stars-bg');
    const statusEl   = document.getElementById('rocket-status-text');
    const countdownEl= document.getElementById('rocket-countdown-overlay');
    const inputEl    = document.getElementById('rocket-bet-input');
    const acoRow     = document.getElementById('rocket-auto-cashout-row');
    const acoInput   = document.getElementById('rocket-auto-cashout-input');
    const btnClose   = document.getElementById('btn-close-rocket');
    const betPanel   = document.getElementById('rocket-bet-panel');
    const iconEl     = document.getElementById('rocket-currency-icon');

    if (iconEl) iconEl.src = _currencyIcon();

    if (state === 'waiting') {
        if (countdownEl) countdownEl.classList.add('hidden');
        if (rocketImg)   rocketImg.className = 'object-contain rocket-idle drop-shadow-[0_0_20px_rgba(249,115,22,0.3)] transition-transform duration-300';
        if (starsBg)     starsBg.classList.remove('bg-stars-fast');
        
        // Возвращаем враппер на исходное место слева
        if (multWrapper) multWrapper.className = 'absolute left-6 top-[58%] -translate-y-1/2 z-10 transition-all duration-500 ease-in-out';
        if (multEl)      {
            multEl.innerText  = '1.00x';
            multEl.className  = 'text-5xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-gray-400 drop-shadow-[0_4px_15px_rgba(0,0,0,0.8)] transition-all';
        }
        
        if (statusEl) {
            const tl = Math.ceil(rocketState.time_left || 0);
            const tmpl = i18n[currentLang]?.rocket_accepting_bets || '🎯 Принимаем ставки — {tl}с';
            statusEl.innerText  = tmpl.replace('{tl}', tl);
            statusEl.className  = 'text-sm font-bold bg-blue-500/20 px-3 py-1 rounded-full text-blue-300 tracking-widest uppercase border border-blue-500/30 shadow-lg';
        }
        if (inputEl)  inputEl.disabled = false;
        if (acoRow)   { acoRow.style.opacity = '1'; acoRow.style.pointerEvents = 'auto'; }
        if (acoInput) acoInput.disabled = false;
        if (btnClose) btnClose.classList.remove('opacity-50', 'pointer-events-none');
        if (betPanel) betPanel.style.opacity = '1';

    } else if (state === 'countdown') {
        if (rocketImg)  rocketImg.className = 'object-contain rocket-idle drop-shadow-[0_0_20px_rgba(249,115,22,0.3)] transition-transform duration-300';
        if (starsBg)    starsBg.classList.remove('bg-stars-fast');
        
        // Враппер все еще слева
        if (multWrapper) multWrapper.className = 'absolute left-6 top-[58%] -translate-y-1/2 z-10 transition-all duration-500 ease-in-out';
        if (multEl)     multEl.innerText = '';
        
        if (statusEl)   statusEl.innerText = '';
        if (inputEl)    inputEl.disabled = true;
        if (acoRow)     { acoRow.style.opacity = '0.4'; acoRow.style.pointerEvents = 'none'; }
        if (acoInput)   acoInput.disabled = true;
        if (btnClose)   btnClose.classList.add('opacity-50', 'pointer-events-none');
        if (betPanel)   betPanel.style.opacity = '0.5';

        if (countdownEl) {
            countdownEl.classList.remove('hidden');
            const num   = Math.ceil(rocketState.time_left || 1);
            const numEl = document.getElementById('rocket-countdown-number');
            if (numEl && numEl.dataset.num !== String(num)) {
                numEl.dataset.num = String(num);
                numEl.innerText   = num;
                numEl.classList.remove('countdown-pop');
                void numEl.offsetWidth; // trigger reflow
                numEl.classList.add('countdown-pop');
                
                // Добавляем виброотклик (Haptic Feedback) на каждую секунду отсчета
                if (window.Telegram?.WebApp?.HapticFeedback) {
                    window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
                } else if (window.tg?.HapticFeedback) {
                    window.tg.HapticFeedback.impactOccurred('light');
                } else if (typeof vibrate === 'function') {
                    vibrate('light');
                }
            }
        }

    } else if (state === 'flying') {
        if (countdownEl) countdownEl.classList.add('hidden');
        if (rocketImg)   rocketImg.className = 'object-contain rocket-flying drop-shadow-[0_0_30px_rgba(249,115,22,0.8)] transition-transform duration-300';
        if (starsBg)     starsBg.classList.add('bg-stars-fast');
        
        // Враппер остается слева
        if (multWrapper) multWrapper.className = 'absolute left-6 top-[58%] -translate-y-1/2 z-10 transition-all duration-500 ease-in-out';
        
        // Текст чуть меньше (text-[3.5rem]), чтобы ракета его не закрывала при больших значениях
        if (multEl)      multEl.className = 'text-[3.5rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-orange-300 to-orange-500 drop-shadow-[0_0_25px_rgba(249,115,22,0.8)] transition-all origin-left';
        
        if (statusEl)    statusEl.innerText = '';
        if (inputEl)     inputEl.disabled = true;
        if (acoRow)      { acoRow.style.opacity = '0.4'; acoRow.style.pointerEvents = 'none'; }
        if (acoInput)    acoInput.disabled = true;
        if (betPanel)    betPanel.style.opacity = '1';
        if (btnClose) {
            if (myBet?.status === 'active') {
                btnClose.classList.add('opacity-50', 'pointer-events-none');
            } else {
                btnClose.classList.remove('opacity-50', 'pointer-events-none');
            }
        }

    } else if (state === 'crashed') {
        if (countdownEl) countdownEl.classList.add('hidden');
        if (rocketImg)   rocketImg.className = 'object-contain rocket-crashed drop-shadow-[0_0_10px_rgba(239,68,68,0.5)] transition-transform duration-300';
        if (starsBg)     starsBg.classList.remove('bg-stars-fast');
        
        // Перемещаем враппер множителя в центр при взрыве
        if (multWrapper) multWrapper.className = 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-30 transition-all duration-500 ease-in-out';
        
        if (multEl) {
            // Показываем точный серверный краш-мульт
            multEl.innerText = (rocketState.revealed_crash || 0).toFixed(2) + 'x';
            multEl.className = 'text-6xl font-black text-red-500 drop-shadow-[0_0_30px_rgba(239,68,68,1)] transition-all scale-110';
        }
        
        if (statusEl) {
            const crashVal = (rocketState.revealed_crash || 0).toFixed(2);
            const tmpl = i18n[currentLang]?.rocket_crashed_at || '💥 Улетела на {x}x';
            statusEl.innerText = tmpl.replace('{x}', crashVal);
            statusEl.className = 'text-sm font-bold bg-red-500/20 px-3 py-1 rounded-full text-red-400 tracking-widest uppercase border border-red-500/30 shadow-lg';
        }
        if (inputEl)  inputEl.disabled = false;
        if (acoRow)   { acoRow.style.opacity = '1'; acoRow.style.pointerEvents = 'auto'; }
        if (acoInput) acoInput.disabled = false;
        if (btnClose) btnClose.classList.remove('opacity-50', 'pointer-events-none');
        if (betPanel) betPanel.style.opacity = '1';
    }
}

// ─────────────────────────────────────────────────────
// ОБНОВЛЕНИЕ КНОПКИ КЭШАУТА ВО ВРЕМЯ ПОЛЁТА
// ─────────────────────────────────────────────────────

// Рендерит текст + иконку в одну строку через inline-flex
function _setBtnText(txtAction, text, iconSrc) {
    if (iconSrc) {
        txtAction.innerHTML =
            `<span style="display:inline-flex;align-items:center;gap:5px;white-space:nowrap;">` +
            `${text}<img src="${iconSrc}" style="width:1.15em;height:1.15em;object-fit:contain;vertical-align:middle;flex-shrink:0;">` +
            `</span>`;
    } else {
        txtAction.textContent = text;
    }
}

function _updateCashoutButtonMult(mult) {
    const myBet = rocketState.my_bet;
    if (rocketState.state !== 'flying') return;
    if (myBet?.status !== 'active')     return;

    const btnAction = document.getElementById('btn-rocket-action');
    const txtAction = document.getElementById('rocket-action-text');
    if (!btnAction || !txtAction) return;

    const win  = Math.floor(myBet.bet * mult);
    const tmpl = i18n[currentLang]?.rocket_cashout_btn || 'Забрать {win}';
    _setBtnText(txtAction, tmpl.replace('{win}', win), _currencyIcon());
}

// ─────────────────────────────────────────────────────
// КНОПКА ДЕЙСТВИЯ (полный ре-рендер при смене состояния)
// ─────────────────────────────────────────────────────

function updateActionButton() {
    const state     = rocketState.state;
    const myBet     = rocketState.my_bet;
    const btnAction = document.getElementById('btn-rocket-action');
    const txtAction = document.getElementById('rocket-action-text');
    if (!btnAction || !txtAction) return;

    const icon = _currencyIcon();

    if (state === 'waiting') {
        if (!myBet) {
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-white active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg bg-gradient-to-r from-orange-500 to-red-600 shadow-orange-500/40';
            _setBtnText(txtAction, i18n[currentLang]?.rocket_place_bet_btn || 'Сделать ставку');
            btnAction.onclick = handlePlaceBet;
        } else {
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-white transition-all flex items-center justify-center gap-2 shadow-lg bg-blue-600/40 border border-blue-500/50 pointer-events-none';
            const betTmpl = i18n[currentLang]?.rocket_bet_placed_label || 'Ставка {bet}';
            _setBtnText(txtAction, betTmpl.replace('{bet}', myBet.bet), icon);
        }
    } else if (state === 'countdown') {
        btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-white transition-all flex items-center justify-center gap-2 shadow-lg bg-gray-700/50 pointer-events-none';
        _setBtnText(txtAction, i18n[currentLang]?.rocket_launching || 'Взлёт...');
    } else if (state === 'flying') {
        if (!myBet) {
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-white/40 transition-all flex items-center justify-center gap-2 shadow-lg bg-gray-700/30 pointer-events-none';
            _setBtnText(txtAction, i18n[currentLang]?.rocket_bets_closed || 'Ставки закрыты');
        } else if (myBet.status === 'active') {
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-white active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg bg-gradient-to-r from-emerald-500 to-green-600 shadow-green-500/40';
            btnAction.onclick   = handleCashout;
            const win = Math.floor(myBet.bet * (rocketState.current_mult || 1));
            const cashoutTmpl = i18n[currentLang]?.rocket_cashout_btn || 'Забрать {win}';
            _setBtnText(txtAction, cashoutTmpl.replace('{win}', win), icon);
        } else if (myBet.status === 'cashed_out') {
            const win = Math.floor(myBet.bet * (myBet.cashout_mult || 1));
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-emerald-300 transition-all flex items-center justify-center gap-2 shadow-lg bg-emerald-500/20 border border-emerald-500/40 pointer-events-none';
            const cashedTmpl = i18n[currentLang]?.rocket_cashed_out_btn || '✅ Забрали {win}';
            _setBtnText(txtAction, cashedTmpl.replace('{win}', win), icon);
        }
    } else if (state === 'crashed') {
        if (myBet?.status === 'cashed_out') {
            const win = Math.floor(myBet.bet * (myBet.cashout_mult || 1));
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-emerald-300 transition-all flex items-center justify-center gap-2 bg-emerald-500/20 border border-emerald-500/40 pointer-events-none rounded-xl shadow-lg';
            const cashedTmpl2 = i18n[currentLang]?.rocket_cashed_out_btn || '✅ Забрали {win}';
            _setBtnText(txtAction, cashedTmpl2.replace('{win}', win), icon);
        } else if (myBet?.status === 'crashed') {
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-red-400 transition-all flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 pointer-events-none shadow-lg';
            const lostTmpl = i18n[currentLang]?.rocket_lost_label || '❌ Улетела ({bet})';
            _setBtnText(txtAction, lostTmpl.replace('{bet}', myBet.bet), icon);
        } else {
            btnAction.className = 'w-full py-4 rounded-xl font-black text-xl text-white/40 transition-all flex items-center justify-center gap-2 shadow-lg bg-gray-700/30 pointer-events-none';
            _setBtnText(txtAction, i18n[currentLang]?.rocket_next_round || 'Следующий раунд...');
        }
    }
}

// ─────────────────────────────────────────────────────
// СПИСОК СТАВОК ИГРОКОВ
// ─────────────────────────────────────────────────────

function renderBetsList(bets) {
    const container = document.getElementById('rocket-bets-list');
    if (!container) return;

    // Обновляем бейдж
    const badge = document.getElementById('rocket-round-badge');
    if (badge) {
        const roundTmpl = i18n[currentLang]?.rocket_round_label || 'Раунд #{id}';
        badge.innerText = roundTmpl.replace('{id}', rocketState.round_id || 0);
    }
    const cnt = document.getElementById('rocket-bets-count');
    if (cnt) cnt.innerText = (bets || []).length;

    if (!bets || bets.length === 0) {
        container.innerHTML = `<p class="text-center text-white/30 text-sm py-4">${i18n[currentLang]?.rocket_no_bets || 'Пока нет ставок'}</p>`;
        return;
    }

    const icon = _currencyIcon();

    container.innerHTML = bets.map(b => {
        const statusClass = b.status === 'cashed_out'
            ? 'border-emerald-500/40 bg-emerald-500/10'
            : b.status === 'crashed'
                ? 'border-red-500/40 bg-red-500/10'
                : 'border-white/10 bg-white/5';

        const winColor = b.status === 'cashed_out'
            ? 'text-emerald-400'
            : b.status === 'crashed'
                ? 'text-red-400'
                : 'text-white';

        const badgeHtml = b.status === 'cashed_out'
            ? `<span class="text-xs font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded-full border border-emerald-500/30 whitespace-nowrap">✓ x${(b.cashout_mult || 1).toFixed(2)}</span>`
            : b.status === 'crashed'
                ? `<span class="text-xs font-bold text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full border border-red-500/30">✗</span>`
                : `<span class="text-xs text-white/40">🚀</span>`;

        const initial  = (b.name || '?')[0].toUpperCase();
        const avatarHtml = b.avatar
            ? `<img src="${b.avatar}" class="w-8 h-8 rounded-full object-cover border border-white/20 flex-shrink-0"
                   onerror="this.outerHTML='<div class=\\'w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0\\'>${initial}</div>'">`
            : `<div class="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-600 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">${initial}</div>`;

        return `
            <div class="bet-row flex items-center gap-3 px-3 py-2.5 rounded-2xl border ${statusClass}" data-uid="${b.user_id}" ${b.status !== "active" ? "data-done=1" : ""}>
                ${avatarHtml}
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-bold text-white truncate">${b.name || i18n[currentLang]?.rocket_default_player || 'Игрок'}</div>
                    <div class="flex items-center gap-1">
                        <span class="text-xs text-white/40">${b.bet}</span>
                        <img src="${icon}" class="w-3 h-3 object-contain opacity-60">
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    <div class="text-sm font-black ${winColor} flex items-center gap-1 justify-end bet-win-amount" data-uid="${b.user_id}" data-bet="${b.bet}">
                        ${b.current_win} <img src="${icon}" class="w-3.5 h-3.5 object-contain">
                    </div>
                    ${badgeHtml}
                </div>
            </div>`;
    }).join('');
}

// Обновляет только суммы активных ставок в списке (без перерисовки всего DOM)
function _updateBetsListMult(mult) {
    if (rocketState.state !== 'flying') return;
    const icon = _currencyIcon();
    document.querySelectorAll('.bet-win-amount').forEach(el => {
        const uid = el.getAttribute('data-uid');
        const bet = parseInt(el.getAttribute('data-bet') || '0', 10);
        // Обновляем только активные строки (без border-emerald/border-red)
        const row = document.querySelector(`.bet-row[data-uid="${uid}"]`);
        if (!row) return;
        if (row.classList.contains('bg-emerald-500\\/10') ||
            row.classList.contains('bg-red-500\\/10'))    return;

        const win = Math.floor(bet * mult);
        el.innerHTML = `${win} <img src="${icon}" class="w-3.5 h-3.5 object-contain">`;
    });
}

// ─────────────────────────────────────────────────────
// ДЕЙСТВИЯ ИГРОКА
// ─────────────────────────────────────────────────────

async function handlePlaceBet() {
    if (typeof vibrate === 'function') vibrate('light');

    const input = document.getElementById('rocket-bet-input');
    const bet   = parseInt(input?.value || 0) || 0;
    const min   = rocketConfigLocal?.min_bet || 50;
    const max   = rocketConfigLocal?.max_bet || 10000;
    const bal   = (rocketConfigLocal?.currency === 'stars') ? (myStars || 0) : (myBalance || 0);

    if (bet < min || bet > max) {
        const limitsTmpl = i18n[currentLang]?.rocket_bet_limits || 'Ставка от {min} до {max}';
        if (typeof showNotify === 'function') showNotify(limitsTmpl.replace('{min}', min).replace('{max}', max), 'error');
        return;
    }
    if (bet > bal) {
        if (typeof showNotify === 'function') showNotify(i18n[currentLang]?.rocket_not_enough_funds || 'Недостаточно средств', 'error');
        return;
    }
    if (rocketState.state !== 'waiting') {
        if (typeof showNotify === 'function') showNotify(i18n[currentLang]?.rocket_bets_closed || 'Ставки закрыты', 'warning');
        return;
    }

    const acoInput = document.getElementById('rocket-auto-cashout-input');
    const autoCo   = parseFloat(acoInput?.value || 0) || 0;

    try {
        const res  = await fetch('/api/rocket/bet', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ bet, auto_cashout: autoCo }),
        });
        const data = await res.json();

        if (data.status === 'ok') {
            if (data.balance !== undefined) myBalance = data.balance;
            if (data.stars   !== undefined) myStars   = data.stars;
            if (typeof updateUI === 'function') updateUI();
            if (typeof showNotify === 'function') showNotify(i18n[currentLang]?.rocket_bet_accepted || 'Ставка принята! 🚀', 'success');
            await pollRocketState();
        } else {
            if (typeof showNotify === 'function') showNotify(data.detail || 'Ошибка', 'error');
        }
    } catch (_) {
        if (typeof showNotify === 'function') showNotify('Ошибка соединения', 'error');
    }
}

async function handleCashout() {
    if (typeof vibrate === 'function') vibrate('medium');
    if (rocketState.state !== 'flying')             return;
    if (rocketState.my_bet?.status !== 'active')    return;

    try {
        const res  = await fetch('/api/rocket/cashout', {
            method:  'POST',
            headers: getApiHeaders(),
        });
        const data = await res.json();

        if (data.status === 'ok') {
            if (data.balance !== undefined) myBalance = data.balance;
            if (data.stars   !== undefined) myStars   = data.stars;
            if (typeof updateUI === 'function') updateUI();
            if (typeof showNotify === 'function') {
                const cur = (rocketConfigLocal?.currency === 'stars') ? '⭐' : '🍩';
                showNotify(`Забрали ${data.win_amount} ${cur} (x${(data.multiplier || 1).toFixed(2)})`, 'success');
            }
            await pollRocketState();
        } else {
            if (typeof showNotify === 'function') showNotify(data.detail || 'Ошибка', 'error');
        }
    } catch (_) {
        if (typeof showNotify === 'function') showNotify('Ошибка соединения', 'error');
    }
}

// ─────────────────────────────────────────────────────
// АВТО-ВЫВОД (UI)
// ─────────────────────────────────────────────────────

window.setAutoCashout = function(value) {
    const inputEl = document.getElementById('rocket-auto-cashout-input');
    let numVal    = parseFloat(value);
    if (isNaN(numVal) || numVal <= 1.0) numVal = 0;

    if (inputEl && document.activeElement !== inputEl) {
        inputEl.value = numVal > 0 ? numVal : '';
    }

    document.querySelectorAll('.btn-auto-cashout').forEach(btn => {
        const bv = parseFloat(btn.getAttribute('data-val'));
        const on = numVal > 0 && bv === numVal;
        btn.classList.toggle('bg-orange-500/20', on);
        btn.classList.toggle('border-orange-500',  on);
        btn.classList.toggle('text-orange-400',    on);
        btn.classList.toggle('bg-white/5',         !on);
        btn.classList.toggle('border-white/10',    !on);
        btn.classList.toggle('text-white/80',      !on);
    });
};

// ─────────────────────────────────────────────────────
// БЫСТРЫЕ СТАВКИ
// ─────────────────────────────────────────────────────

function setRocketBet(type) {
    if (rocketState.state !== 'waiting') return;
    if (typeof vibrate === 'function') vibrate('light');

    const input = document.getElementById('rocket-bet-input');
    const min   = rocketConfigLocal?.min_bet || 50;
    const max   = rocketConfigLocal?.max_bet || 10000;
    const bal   = (rocketConfigLocal?.currency === 'stars') ? (myStars || 0) : (myBalance || 0);

    let val = parseInt(input?.value) || min;
    if      (type === 'min') val = min;
    else if (type === 'x2')  val = val * 2;
    else if (type === 'max') val = Math.min(bal, max);

    val = Math.max(min, Math.min(val, max));
    if (input) input.value = val;
}

// ─────────────────────────────────────────────────────
// ЭКСПОРТ
// ─────────────────────────────────────────────────────

window.openRocketGame     = openRocketGame;
window.closeRocketGame    = closeRocketGame;
window.setRocketBet       = setRocketBet;
window.handleRocketAction = function () {
    if (rocketState.state === 'waiting' && !rocketState.my_bet) {
        handlePlaceBet();
    } else if (rocketState.state === 'flying' && rocketState.my_bet?.status === 'active') {
        handleCashout();
    }
};
