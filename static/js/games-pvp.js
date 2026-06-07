// =============================================================
// games-pvp.js — SPACE DONUT PVP (Колесо Фортуны / Рулетка)
// =============================================================
'use strict';

// ─── State ────────────────────────────────────────────────────
let pvpState = {
    round_id: 0,
    state: 'waiting',
    time_left: 0,
    players: [],
    winner: null,
    pot: { stars: 0, ton: 0, gifts: 0 },
    last_game: null,
    best_game: null,
};

let pvpPollTimer          = null;
let pvpPollingActive      = false;
let pvpBetTab             = 'stars';   // 'stars' | 'ton' | 'gift'
let pvpInventory          = [];
let pvpLastState          = '';
let pvpCountdownInterval  = null;
let pvpWinnerRevealed     = false;

// ─── Online counter ───────────────────────────────────────────
let pvpHeartbeatTimer = null;
const PVP_HEARTBEAT_INTERVAL = 30000; // 30 сек

const pvpAvatarCache = {};

// Текущий результирующий угол барабана (чтобы вращать плавно из предыдущих положений)
let pvpCurrentRotation = 0; 

// ─── Haptic state ──────────────────────────────────────────────
// rAF-цикл читает реальную CSS-матрицу колеса и триггерит вибрацию
// при каждом пересечении виртуальной «насечки» (аналогично roulette.js)
let pvpHapticTimer     = null;   // активный requestAnimationFrame ID

// ─── Render-hash guards ───────────────────────────────────────
let _pvpArenaHash     = '';
let _pvpStatusHash    = '';
let _pvpTopBarHash    = '';
let _pvpPartsHash     = '';

// ─── i18n helper ──────────────────────────────────────────────
function _pvpT(key, fallback) {
    const lang = (typeof currentLang !== 'undefined') ? currentLang : 'en';
    return (typeof i18n !== 'undefined' && i18n[lang] && i18n[lang][key])
        ? i18n[lang][key] : (fallback || key);
}

// ─── Icon helpers ──────────────────────────────────────────────
function _pvpStarIcon(size) {
    return `<img src="/gifts/stars.png" class="inline-block object-contain" style="width:${size}px;height:${size}px;vertical-align:middle;" onerror="this.outerHTML='★'">`;
}
function _pvpDonutIcon(size) {
    return `<img src="/gifts/ton.png" class="inline-block object-contain" style="width:${size}px;height:${size}px;vertical-align:middle;" onerror="this.outerHTML='💎'">`;
}
function _pvpGiftIcon(size) {
    return `<img src="/gifts/spacedount.png" class="inline-block object-contain" style="width:${size}px;height:${size}px;vertical-align:middle;" onerror="this.outerHTML='🎁'">`;
}
function _pvpTrophyIcon(size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;color:#f59e0b"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>`;
}

// ─── Open / Close ─────────────────────────────────────────────

function openPvpGame() {
    if (typeof showGameView === 'function') {
        showGameView('games-pvp-view');
    } else {
        document.getElementById('games-main-view')?.classList.add('hidden');
        document.getElementById('games-pvp-view')?.classList.remove('hidden');
    }
    pvpWinnerRevealed = false;
    pvpCurrentRotation = 0;
    
    // Сброс вращения колеса при открытии
    const wheel = document.getElementById('pvp-roulette-wheel');
    if (wheel) {
        wheel.style.transition = 'none';
        wheel.style.transform = 'rotate(0deg)';
    }

    startPvpPolling();
    loadPvpInventory();
}

function closePvpGame() {
    stopPvpPolling();
    if (typeof hideGameView === 'function') {
        hideGameView('games-pvp-view');
    } else {
        document.getElementById('games-pvp-view')?.classList.add('hidden');
        document.getElementById('games-main-view')?.classList.remove('hidden');
    }
}

// ─── Heartbeat ────────────────────────────────────────────────

async function sendPvpHeartbeat() {
    try {
        await fetch('/api/pvp/heartbeat', {
            method: 'POST',
            headers: getApiHeaders(),
        });
    } catch (_) {}
}

function startPvpHeartbeat() {
    stopPvpHeartbeat();
    sendPvpHeartbeat();
    pvpHeartbeatTimer = setInterval(sendPvpHeartbeat, PVP_HEARTBEAT_INTERVAL);
}

function stopPvpHeartbeat() {
    if (pvpHeartbeatTimer) { clearInterval(pvpHeartbeatTimer); pvpHeartbeatTimer = null; }
}

// ─── Online counter render ────────────────────────────────────

function renderPvpOnlineCounter(count) {
    const badge = document.getElementById('pvp-online-badge');
    const dot   = document.getElementById('pvp-online-dot');
    const num   = document.getElementById('pvp-online-count');
    if (!badge || !dot || !num) return;

    num.textContent = count;

    if (count > 0) {
        badge.style.background      = 'rgba(34,197,94,0.12)';
        badge.style.borderColor     = 'rgba(34,197,94,0.35)';
        badge.style.color           = 'rgba(134,239,172,0.9)';
        dot.style.background        = '#22c55e';
        dot.className               = 'w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse transition-colors duration-500';
    } else {
        badge.style.background      = 'rgba(255,255,255,0.04)';
        badge.style.borderColor     = 'rgba(255,255,255,0.08)';
        badge.style.color           = 'rgba(255,255,255,0.25)';
        dot.style.background        = '#6b7280';
        dot.className               = 'w-1.5 h-1.5 rounded-full bg-gray-500 transition-colors duration-500';
    }
}

// ─── Polling ──────────────────────────────────────────────────

function startPvpPolling() {
    stopPvpPolling();
    pvpPollingActive = true;
    startPvpHeartbeat();
    pollPvpState();
}

function stopPvpPolling() {
    pvpPollingActive = false;
    if (pvpPollTimer)         { clearTimeout(pvpPollTimer);          pvpPollTimer     = null; }
    if (pvpCountdownInterval) { clearInterval(pvpCountdownInterval); pvpCountdownInterval = null; }
    clearPvpHaptics();
    stopPvpHeartbeat();
}

async function pollPvpState() {
    try {
        const res  = await fetch('/api/pvp/state', { headers: getApiHeaders() });
        const data = await res.json();
        if (!pvpPollingActive) return;
        applyPvpState(data);
    } catch (_) {}

    if (!pvpPollingActive) return;
    const interval = pvpState.state === 'rolling' ? 500 : 800;
    pvpPollTimer = setTimeout(pollPvpState, interval);
}

async function loadPvpInventory() {
    try {
        const res  = await fetch('/api/pvp/inventory', { headers: getApiHeaders() });
        const data = await res.json();
        pvpInventory = data.gifts || [];
        renderPvpInventory();
    } catch (_) {}
}

// ─── State application ────────────────────────────────────────

function applyPvpState(data) {
    const prevState   = pvpState.state;
    const prevRoundId = pvpState.round_id;
    pvpState = data;

    if (typeof data.online_count === 'number') {
        renderPvpOnlineCounter(data.online_count);
    }

    if (data.round_id !== prevRoundId) {
        pvpWinnerRevealed = false;
        _pvpArenaHash  = '';
        _pvpStatusHash = '';
        _pvpTopBarHash = '';
        _pvpPartsHash  = '';
        
        // Сбрасываем угол к 0 при новом раунде
        pvpCurrentRotation = 0;
        const wheel = document.getElementById('pvp-roulette-wheel');
        if (wheel) {
            wheel.style.transition = 'none';
            wheel.style.transform = 'rotate(0deg)';
        }
    }

    // Если фаза сменилась на rolling - запускаем колесо рулетки
    if (data.state === 'rolling' && prevState !== 'rolling') {
        spinRouletteWheel(data.winner);
    }

    if (data.state === 'countdown') {
        if (prevState !== 'countdown') {
            startPvpCountdown(data.time_left);
        }
    } else {
        if (pvpCountdownInterval) {
            clearInterval(pvpCountdownInterval);
            pvpCountdownInterval = null;
        }
    }

    if (data.state === 'finished' && !pvpWinnerRevealed && data.winner) {
        pvpWinnerRevealed = true;
        showPvpWinnerReveal(data.winner);
    }

    pvpLastState = data.state;
    renderPvpArena();
    renderPvpBetPanel();
    renderPvpParticipants();
    renderPvpTopBar();
    updatePvpStatus();

    const badge = document.getElementById('pvp-round-badge');
    if (badge) badge.textContent = `Round #${data.round_id}`;

    if ((data.state === 'finished' && prevState === 'rolling') ||
        (data.state === 'waiting' && prevState === 'finished')) {
        setTimeout(pvpRefreshUserData, 1200);
    }
}

// ─── Countdown ────────────────────────────────────────────────

let pvpLocalCountdown = 0;

function startPvpCountdown(timeLeft) {
    pvpLocalCountdown = timeLeft;
    if (pvpCountdownInterval) clearInterval(pvpCountdownInterval);
    
    const maxTime = 15; // Длительность таймера по умолчанию
    
    pvpCountdownInterval = setInterval(() => {
        pvpLocalCountdown = Math.max(0, pvpLocalCountdown - 0.1);
        
        // Обновляем круговой прогресс-бар в центре
        const progCircle = document.getElementById('pvp-center-progress-bar');
        if (progCircle) {
            // Длина окружности 2 * PI * 51 = 320.44
            const dashoffset = 320 - (320 * (pvpLocalCountdown / maxTime));
            progCircle.style.strokeDashoffset = Math.max(0, Math.min(320, dashoffset));
        }

        // Обновляем текстовый таймер
        const timerText = document.getElementById('pvp-center-timer');
        if (timerText) {
            const secs = Math.floor(pvpLocalCountdown);
            const decs = Math.floor((pvpLocalCountdown % 1) * 100);
            timerText.textContent = `00:${secs.toString().padStart(2, '0')}`;
        }

        const label = document.getElementById('pvp-center-label');
        if (label) label.textContent = 'СТАРТ';

        if (pvpLocalCountdown <= 0) {
            clearInterval(pvpCountdownInterval);
            pvpCountdownInterval = null;
        }
    }, 100);
}

// ─── Roulette Spin Mechanic (Крутилка Рулетки) ──────────────────

// ─── Детерминированный ГПСЧ (seeded PRNG) для синхронизации барабана ───
// Одинаковый seed → одинаковый результат на всех устройствах.
function _pvpSeed(roundId) {
    // FNV-1a hash: строка round_id → 32-битное целое
    let h = 0x811c9dc5 >>> 0;
    const s = String(roundId || 0);
    for (let i = 0; i < s.length; i++) {
        h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    }
    return h;
}
function _pvpRand(seed) {
    // xorshift32 — быстрый, детерминированный, равномерный [0, 1)
    let x = seed >>> 0;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;  x >>>= 0;
    return x / 4294967296;
}

function spinRouletteWheel(winner) {
    const wheel = document.getElementById('pvp-roulette-wheel');
    if (!wheel || !winner) return;

    // Рассчитываем точные сектора игроков
    const players = pvpState.players || [];
    const totalChance = players.reduce((sum, p) => sum + p.win_chance, 0);
    
    let currentPercent = 0;
    let targetSectorStartDeg = 0;
    let targetSectorEndDeg = 360;

    // Ищем сектор победителя на окружности
    for (const p of players) {
        const normalizedChance = totalChance > 0 
            ? (p.win_chance / totalChance) * 100 
            : (100 / players.length);
            
        if (String(p.user_id) === String(winner.user_id)) {
            targetSectorStartDeg = currentPercent * 3.6;
            targetSectorEndDeg = (currentPercent + normalizedChance) * 3.6;
            break;
        }
        currentPercent += normalizedChance;
    }

    // Детерминированные «случайные» числа на основе round_id —
    // все клиенты получают одинаковый результат для одного раунда.
    const seed = _pvpSeed(pvpState.round_id);
    const r1 = _pvpRand(seed);
    const r2 = _pvpRand(seed ^ 0xA5A5A5A5);

    const margin = Math.min(3, (targetSectorEndDeg - targetSectorStartDeg) * 0.1);
    const targetDegInSector = targetSectorStartDeg + margin + (r1 * (targetSectorEndDeg - targetSectorStartDeg - margin * 2));

    // Стрелка находится сверху на отметке 12 часов (270 градусов по тригонометрическому кругу).
    // Чтобы выигравший сектор оказался наверху под стрелкой, мы должны повернуть колесо на:
    // Angle = 360 - targetDegInSector
    // Добавим к этому несколько полных оборотов (от 5 до 8) для зрелищности вращения.
    const extraSpins = 5 + Math.floor(r2 * 4); // 5-8 оборотов, одинаково на всех устройствах
    const finalRotation = (extraSpins * 360) + (360 - targetDegInSector);
    
    pvpCurrentRotation = finalRotation;

    // Запускаем плавное вращение при помощи CSS transition
    wheel.style.transition = 'transform 6.5s cubic-bezier(0.12, 0.8, 0.15, 1)';
    wheel.style.transform = `rotate(${finalRotation}deg)`;

    // Инжектируем @keyframes для контр-ротации аватарок.
    // CSS-анимация надёжнее CSS-transition для только что созданных элементов:
    // она стартует с явного from (0°) без необходимости принудительного reflow.
    let kvStyle = document.getElementById('pvp-balance-kf');
    if (!kvStyle) {
        kvStyle = document.createElement('style');
        kvStyle.id = 'pvp-balance-kf';
        document.head.appendChild(kvStyle);
    }
    kvStyle.textContent = `@keyframes pvpAvatarBalance { from { transform: rotate(0deg); } to { transform: rotate(${-finalRotation}deg); } }`;

    // Синхронизируем вибрацию с реальным движением колеса через rAF
    triggerSpinHaptics(wheel, finalRotation);
}

// ─── Синхронные хаптики колеса ─────────────────────────────────

// Сбрасываем rAF и обнуляем таймер (вызывается при остановке/новом раунде)
function clearPvpHaptics() {
    if (pvpHapticTimer) { cancelAnimationFrame(pvpHapticTimer); pvpHapticTimer = null; }
}

// ─── Синхронная вибрация колеса (rAF-based, как roulette.js) ────────────────
//
// На каждом кадре читаем CSS-матрицу колеса через getComputedStyle,
// извлекаем текущий угол (mod 360) и накапливаем пройденный путь.
// Вибрация срабатывает при пересечении виртуальных «насечек» (TICK_DEG) —
// точно так же, как roulette.js стреляет haptic при смене слота ленты.
// Интенсивность убывает вместе со скоростью: heavy → medium → light.
function triggerSpinHaptics(wheelEl, finalRotation) {
    clearPvpHaptics();

    const DURATION = 6500;  // мс — совпадает с CSS transition
    const TICK_DEG = 12;    // виртуальная насечка (30 насечек на оборот)

    const startTime = performance.now();
    let prevRawDeg   = -1;      // угол из матрицы на прошлом кадре
    let cumDeg       = 0;       // суммарный пройденный угол
    let lastTickCum  = 0;       // cumDeg в момент последней вибрации

    // Читаем текущий угол колеса из CSS-матрицы трансформации.
    // CSS transition обновляет матрицу на каждом кадре —
    // никакой экстраполяции не нужно, данные всегда актуальны.
    function getRawDeg(el) {
        const tr = window.getComputedStyle(el).transform;
        if (!tr || tr === 'none') return 0;
        const m = tr.match(/^matrix\(([^)]+)\)/);
        if (!m) return 0;
        const vals = m[1].split(',');
        const deg  = Math.atan2(+vals[1], +vals[0]) * 180 / Math.PI;
        return (deg + 360) % 360;
    }

    function step(now) {
        if (!pvpPollingActive) { pvpHapticTimer = null; return; }

        const elapsed  = now - startTime;
        const progress = Math.min(elapsed / DURATION, 1);
        const rawDeg   = getRawDeg(wheelEl);

        if (prevRawDeg < 0) {
            // Первый кадр — инициализируем без вибрации
            prevRawDeg = rawDeg;
        } else {
            // Дельта всегда ≥ 0: колесо крутится только вперёд (по часовой)
            let delta = rawDeg - prevRawDeg;
            if (delta < 0) delta += 360;   // пересечение 359° → 0°
            cumDeg   += delta;
            prevRawDeg = rawDeg;

            // Проверяем, пересекли ли мы очередную насечку
            if (cumDeg - lastTickCum >= TICK_DEG) {
                lastTickCum = Math.floor(cumDeg / TICK_DEG) * TICK_DEG;
                // Та же логика интенсивности, что и в roulette.js
                if      (progress < 0.55) vibrate('heavy');
                else if (progress < 0.82) vibrate('medium');
                else                       vibrate('light');
            }
        }

        if (progress < 1) {
            pvpHapticTimer = requestAnimationFrame(step);
        } else {
            pvpHapticTimer = null;
        }
    }

    pvpHapticTimer = requestAnimationFrame(step);
}

// ─── Arena render — РУЛЕТОЧНЫЙ БАРАБАН (Proportional Sectors) ───

function renderPvpArena() {
    const container = document.getElementById('pvp-arena-players');
    const bg = document.getElementById('pvp-dynamic-bg');
    if (!container || !bg) return;

    const players = pvpState.players || [];
    const arenaHash = pvpState.state + '|' + pvpState.round_id + '|' +
        players.map(p => p.user_id + ':' + p.win_chance.toFixed(2) + ':' + p.color).join(',') +
        '|winner:' + (pvpState.winner?.user_id ?? 'none');
    
    if (arenaHash === _pvpArenaHash) return;
    _pvpArenaHash = arenaHash;

    container.innerHTML = '';

    // Если участников еще нет — выводим красивую анимацию ожидания
    if (players.length === 0) {
        bg.style.background = 'radial-gradient(circle, rgba(244,63,94,0.12) 0%, #020617 100%)';
        container.innerHTML = `
            <div class="pvp-waiting-anim">
                <div class="pvp-orbit-ring pvp-orbit-ring-1">
                    <div class="pvp-orbit-dot pvp-orbit-dot-rose"></div>
                    <div class="pvp-orbit-dot pvp-orbit-dot-rose pvp-orbit-dot-b"></div>
                </div>
                <div class="pvp-orbit-ring pvp-orbit-ring-2">
                    <div class="pvp-orbit-dot pvp-orbit-dot-violet"></div>
                    <div class="pvp-orbit-dot pvp-orbit-dot-violet pvp-orbit-dot-b"></div>
                </div>
                <div class="pvp-waiting-icon-wrap">
                    <img src="/gifts/pvp.png" style="width:72px;height:72px;object-fit:contain;"
                         onerror="this.outerHTML='<span style=\\'font-size:52px;line-height:1;\\'>⚔️</span>'">
                </div>
            </div>
        `;
        
        // Сбросим значения индикатора в центре
        const progCircle = document.getElementById('pvp-center-progress-bar');
        if (progCircle) progCircle.style.strokeDashoffset = '320';
        const timerText = document.getElementById('pvp-center-timer');
        if (timerText) timerText.textContent = '00:00';
        const labelText = document.getElementById('pvp-center-label');
        if (labelText) labelText.textContent = 'ожидание';
        
        return;
    }

    // Сектора колеса строятся на основе conic-gradient
    let gradientParts = [];
    let currentPercent = 0;
    let totalChance = players.reduce((sum, p) => sum + p.win_chance, 0);

    players.forEach((p, idx) => {
        let normalizedChance = totalChance > 0 ? (p.win_chance / totalChance) * 100 : (100 / players.length);

        let start = currentPercent;
        let end = currentPercent + normalizedChance;
        gradientParts.push(`${p.color} ${start}% ${end}%`);

        // Позиционируем аватарку строго по центру дуги (сектора) игрока
        let midPercent = start + (normalizedChance / 2);
        let angleDeg = (midPercent * 3.6) - 90; // Сдвиг на -90 градусов, чтобы 0% начинался сверху
        let angleRad = angleDeg * (Math.PI / 180);
        
        // Радиус размещения аватарок от центра барабана рулетки
        let radius = 68; // в процентах (пространство внутри колеса)
        let x = 50 + (radius / 2) * Math.cos(angleRad);
        let y = 50 + (radius / 2) * Math.sin(angleRad);

        const isWinner = pvpState.state === 'finished' && pvpState.winner?.user_id === p.user_id;

        // Размер аватарки пропорционально шансу победы (от 32px до 64px)
        const avatarPx = Math.max(34, Math.min(64, 34 + (normalizedChance / 100) * 30));

        // Контейнер аватарки на колесе рулетки
        const avatarContainer = document.createElement('div');
        avatarContainer.className = 'pvp-roulette-avatar-container absolute';
        avatarContainer.style.left = `${x}%`;
        avatarContainer.style.top = `${y}%`;
        avatarContainer.style.width = `${avatarPx}px`;
        avatarContainer.style.height = `${avatarPx}px`;
        avatarContainer.style.transform = `translate(-50%, -50%)`;

        // Внутренний контейнер с аватаром
        const avatarWrap = document.createElement('div');
        avatarWrap.className = `pvp-roulette-avatar-wrapper w-full h-full ${isWinner ? 'pvp-winner-pulse' : ''}`;
        avatarWrap.style.cssText = `
            border-color: rgba(255,255,255,0.9);
            background: ${p.color};
        `;

        if (p.avatar) {
            avatarWrap.innerHTML = `<img src="${p.avatar}" class="w-full h-full object-cover rounded-full" onerror="this.style.display='none'">`;
        } else {
            const fontSize = Math.max(12, Math.round(avatarPx * 0.45));
            avatarWrap.innerHTML = `<div class="w-full h-full flex items-center justify-center font-black text-white rounded-full" style="font-size:${fontSize}px">${(p.name||'?')[0].toUpperCase()}</div>`;
        }

        avatarContainer.appendChild(avatarWrap);

        container.appendChild(avatarContainer);
        currentPercent = end;
    });

    // Применяем фоновый радиальный градиент секторов
    bg.style.background = `conic-gradient(${gradientParts.join(', ')})`;

    // Балансировка аватарок: avatarContainer вращается вместе с барабаном
    // (аватарка остаётся на своём секторе), а avatarWrap контр-ротируется
    // с помощью CSS-анимации — так изображение всегда стоит вертикально ровно.
    // CSS @keyframes надёжнее CSS transition для только что созданных элементов:
    // анимация явно стартует с rotate(0deg) без reflow-трюков.
    if (pvpState.state === 'rolling') {
        container.querySelectorAll('.pvp-roulette-avatar-wrapper').forEach(w => {
            w.style.animation = 'pvpAvatarBalance 6.5s cubic-bezier(0.12, 0.8, 0.15, 1) both';
        });
    } else if (pvpCurrentRotation !== 0) {
        // finished — барабан уже встал, просто фиксируем финальный угол
        container.querySelectorAll('.pvp-roulette-avatar-wrapper').forEach(w => {
            w.style.transform = `rotate(${-pvpCurrentRotation}deg)`;
        });
    }
}

// ─── Top bar ──────────────────────────────────────────────────

function _formatGameStars(game) {
    if (!game) return '';
    const val = game.total_value_stars || game.total_stars || 0;
    return val > 0 ? `+${val}` : '';
}

function renderPvpTopBar() {
    const last = pvpState.last_game;
    const best = pvpState.best_game;

    const topBarHash = JSON.stringify({ l: last, b: best });
    if (topBarHash === _pvpTopBarHash) return;
    _pvpTopBarHash = topBarHash;

    const lastEl = document.getElementById('pvp-last-game');
    const bestEl = document.getElementById('pvp-best-game');
    const starIco = _pvpStarIcon(10);

    if (lastEl) {
        if (last) {
            const valStr = _formatGameStars(last);
            lastEl.innerHTML = `
                <div class="flex items-center gap-1.5">
                    <span class="text-white/40 text-[9px] font-bold uppercase tracking-wide" data-i18n="pvp_last_game">${_pvpT('pvp_last_game','Last')}</span>
                </div>
                <div class="flex items-center gap-1.5 mt-0.5">
                    ${last.avatar ? `<img src="${last.avatar}" class="w-5 h-5 rounded-full object-cover" onerror="this.style.display='none'">` : ''}
                    <span class="text-white/80 text-[10px] font-bold truncate max-w-[70px]">${escHtml(last.name)}</span>
                    ${valStr ? `<span class="text-yellow-300 text-[10px] font-black flex items-center gap-0.5">${valStr}${starIco}</span>` : ''}
                </div>
            `;
        } else {
            lastEl.innerHTML = `<span class="text-white/20 text-[9px]" data-i18n="pvp_no_data">${_pvpT('pvp_no_data','No data')}</span>`;
        }
    }

    if (bestEl) {
        if (best) {
            const valStr = _formatGameStars(best);
            bestEl.innerHTML = `
                <div class="flex items-center gap-1.5">
                    <span class="text-amber-400/60 text-[9px] font-bold uppercase tracking-wide" data-i18n="pvp_best_game">${_pvpT('pvp_best_game','Best')}</span>
                </div>
                <div class="flex items-center gap-1.5 mt-0.5">
                    ${best.avatar ? `<img src="${best.avatar}" class="w-5 h-5 rounded-full object-cover" onerror="this.style.display='none'">` : ''}
                    <span class="text-white/80 text-[10px] font-bold truncate max-w-[70px]">${escHtml(best.name)}</span>
                    ${valStr ? `<span class="text-amber-300 text-[10px] font-black flex items-center gap-0.5">${valStr}${starIco}</span>` : ''}
                </div>
            `;
        } else {
            bestEl.innerHTML = `<span class="text-white/20 text-[9px]" data-i18n="pvp_no_data">${_pvpT('pvp_no_data','No data')}</span>`;
        }
    }
}

// ─── Status overlay ───────────────────────────────────────────

function updatePvpStatus() {
    const statusEl  = document.getElementById('pvp-status-text');
    const potEl     = document.getElementById('pvp-pot-display');

    const starIco  = _pvpStarIcon(14);
    const donutIco = _pvpDonutIcon(14);

    const p = pvpState.pot;
    const statusHash = pvpState.state + '|' + (p?.stars||0) + '|' + (p?.ton||0) + '|' + (p?.gifts||0) + '|' +
        JSON.stringify(p?.gift_previews||[]) + '|winner:' + (pvpState.winner?.user_id ?? 'none');
    const skipStatusRebuild = (statusHash === _pvpStatusHash);
    
    if (!skipStatusRebuild) {
        _pvpStatusHash = statusHash;
    }

    if (statusEl && !skipStatusRebuild) {
        const s = pvpState.state;
        if (s === 'waiting') {
            statusEl.innerHTML = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white/80 font-bold text-[10px] tracking-wide"
                      style="background:linear-gradient(135deg,rgba(244,63,94,0.20),rgba(168,85,247,0.15));border:1px solid rgba(244,63,94,0.35);">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse inline-block"></span>
                    <span data-i18n="pvp_waiting">${_pvpT('pvp_waiting','Waiting for Players')}</span>
                </span>`;
            statusEl.className = 'flex items-center mt-0.5';
            
            // Настройка центрального кольца для режима ожидания
            const centerProgress = document.getElementById('pvp-center-progress-bar');
            if (centerProgress) centerProgress.style.strokeDashoffset = '320';
            const centerTimer = document.getElementById('pvp-center-timer');
            if (centerTimer) centerTimer.textContent = 'WAIT';
            const centerLabel = document.getElementById('pvp-center-label');
            if (centerLabel) centerLabel.textContent = 'ИГРОКИ';
            
        } else if (s === 'countdown') {
            statusEl.innerHTML = `<span class="text-green-300 font-bold text-xs tracking-wide" data-i18n="pvp_accepting_bets">${_pvpT('pvp_accepting_bets','Accepting Bets')}</span>`;
            statusEl.className = 'text-[10px] text-white/50 font-bold tracking-wide mt-1';
            
        } else if (s === 'rolling') {
            statusEl.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="#a78bfa" style="display:inline-block;vertical-align:middle">
                    <path d="M12 2L9 9H2l5.5 4-2 7L12 16l6.5 4-2-7L22 9h-7z"/>
                </svg>
                <span class="text-purple-300 font-bold text-xs ml-1" data-i18n="pvp_rolling">${_pvpT('pvp_rolling','Choosing winner...')}</span>`;
            statusEl.className = 'text-[10px] text-white/50 font-bold tracking-wide mt-1 flex items-center';
            
            // Настройка центрального кольца в режиме вращения
            const centerProgress = document.getElementById('pvp-center-progress-bar');
            if (centerProgress) {
                centerProgress.style.strokeDashoffset = '0';
                centerProgress.style.stroke = '#a78bfa';
            }
            const centerTimer = document.getElementById('pvp-center-timer');
            if (centerTimer) centerTimer.textContent = 'SPIN';
            const centerLabel = document.getElementById('pvp-center-label');
            if (centerLabel) centerLabel.textContent = 'РУЛЕТКА';
            
        } else if (s === 'finished') {
            statusEl.innerHTML = `<span class="text-amber-300 font-bold text-xs ml-1" data-i18n="pvp_winner_found">${_pvpT('pvp_winner_found','Winner found!')}</span>`;
            statusEl.className = 'text-[10px] text-white/50 font-bold tracking-wide mt-1 flex items-center';
            
            // Настройка центрального кольца по окончании раунда
            const centerTimer = document.getElementById('pvp-center-timer');
            if (centerTimer) centerTimer.textContent = 'WIN';
            const centerLabel = document.getElementById('pvp-center-label');
            if (centerLabel) centerLabel.textContent = 'КОНЕЦ';
        }
    }

    if (potEl && !skipStatusRebuild) {
        const p = pvpState.pot;
        let html = '';

        if (p.stars > 0) {
            html += `<span class="pvp-pot-badge pvp-pot-badge-stars">${p.stars}<img src="/gifts/stars.png" onerror="this.outerHTML='★'"></span>`;
        }
        if (p.ton > 0) {
            if (html) html += `<span class="text-white/30 text-xs font-black self-center">+</span>`;
            const tn = p.ton.toFixed(2);
            html += `<span class="pvp-pot-badge pvp-pot-badge-donuts">${tn}<img src="/gifts/ton.png" onerror="this.outerHTML='💎'"></span>`;
        }

        const previews = p.gift_previews || [];
        if (previews.length > 0) {
            if (html) html += `<span class="text-white/30 text-xs font-black self-center">+</span>`;
            previews.slice(0, 3).forEach(g => {
                const starVal = g.value_stars || g.exchange_stars || 0;
                const imgHtml = g.photo
                    ? `<img src="${escHtml(g.photo)}" title="${escHtml(g.name)}" style="width:14px;height:14px;object-fit:contain;border-radius:3px;" onerror="this.outerHTML='🎁'">`
                    : `<span style="font-size:13px;line-height:1;">🎁</span>`;
                html += `<span class="pvp-pot-badge pvp-pot-badge-gift">${imgHtml}${starVal > 0 ? `<span style="font-size:11px;color:#fde047;font-weight:900;">${starVal}</span>` : ''}</span>`;
            });
            if (p.gifts > 3) html += `<span class="pvp-pot-badge pvp-pot-badge-gift" style="font-size:10px;">+${p.gifts - 3}</span>`;
        } else if (p.gifts > 0) {
            if (html) html += `<span class="text-white/30 text-xs font-black self-center">+</span>`;
            html += `<span class="pvp-pot-badge pvp-pot-badge-gift">🎁 ${p.gifts}</span>`;
        }

        potEl.innerHTML = html
            ? html
            : `<span class="text-white/30 text-xs" data-i18n="pvp_bank_empty">${_pvpT('pvp_bank_empty','Bank empty')}</span>`;
    }
}

// ─── Participants list ────────────────────────────────────────

function renderPvpParticipants() {
    const list = document.getElementById('pvp-participants-list');
    const cnt  = document.getElementById('pvp-players-count');
    if (!list) return;

    const players = pvpState.players || [];

    const partsHash = pvpState.state + '|' + pvpState.round_id + '|' +
        players.map(p => p.user_id + ':' + p.win_chance.toFixed(2) + ':' + (p.stars_bet||0) + ':' + (p.ton_bet||0)).join(',') +
        '|winner:' + (pvpState.winner?.user_id ?? 'none');
    if (partsHash === _pvpPartsHash) return;
    _pvpPartsHash = partsHash;

    if (cnt) cnt.textContent = players.length;

    if (players.length === 0) {
        list.innerHTML = `<p class="text-center text-white/30 text-xs py-3" data-i18n="pvp_no_participants">${_pvpT('pvp_no_participants','No participants yet')}</p>`;
        return;
    }

    list.innerHTML = players.map(p => {
        const betParts = [];
        if (p.stars_bet  > 0) betParts.push(`<span class="inline-flex items-center gap-1 text-yellow-300 font-bold text-xs">${p.stars_bet}${_pvpStarIcon(13)}</span>`);
        if (p.ton_bet > 0) betParts.push(`<span class="inline-flex items-center gap-1 text-blue-300 font-bold text-xs">${p.ton_bet}${_pvpDonutIcon(13)}</span>`);

        if (p.gift_bets?.length > 0) {
            p.gift_bets.forEach(gb => {
                const photo = gb.gift_photo || gb.photo || '';
                const stars = gb.value_stars || gb.exchange_stars || 0;
                const giftName = escHtml(gb.gift_name || gb.name || 'Gift');
                if (photo) {
                    betParts.push(`
                        <span class="inline-flex items-center gap-1 text-purple-300 font-bold text-xs">
                            <img src="${photo}" title="${giftName}" style="width:13px;height:13px;object-fit:contain;vertical-align:middle;border-radius:3px;" onerror="this.style.display='none'">
                            ${stars > 0 ? `<span class="inline-flex items-center gap-0.5 text-yellow-300 font-bold text-xs">${stars}${_pvpStarIcon(12)}</span>` : ''}
                        </span>`);
                } else {
                    betParts.push(`<span class="inline-flex items-center gap-1 text-purple-300 font-bold text-xs">${_pvpGiftIcon(13)}${stars > 0 ? `<span class="inline-flex items-center gap-0.5 text-yellow-300 text-xs">${stars}${_pvpStarIcon(12)}</span>` : ''}</span>`);
                }
            });
        }

        const isWinner = pvpState.state === 'finished' && pvpState.winner?.user_id === p.user_id;

        return `
            <div class="flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all ${isWinner ? 'bg-gradient-to-r from-amber-500/20 to-yellow-500/10 border border-amber-500/40' : 'bg-white/3 border border-white/5'}">
                <div class="relative flex-shrink-0">
                    <div class="w-8 h-8 rounded-full overflow-hidden border-2 flex-shrink-0" style="border-color:${p.color}">
                        ${p.avatar
                            ? `<img src="${p.avatar}" class="w-full h-full object-cover" onerror="this.outerHTML='<div class=\\'w-full h-full flex items-center justify-center text-xs font-black\\'>${(p.name||'?')[0].toUpperCase()}</div>'">`
                            : `<div class="w-full h-full flex items-center justify-center text-xs font-black" style="background:${p.color}44">${(p.name||'?')[0].toUpperCase()}</div>`
                        }
                    </div>
                    ${isWinner ? `<div style="position:absolute;top:-8px;right:-8px;font-size:14px;line-height:1;filter:drop-shadow(0 0 5px rgba(255,215,0,0.9));pointer-events:none;">👑</div>` : ''}
                </div>
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-bold text-white truncate">${escHtml(p.name)}</div>
                    <div class="flex items-center gap-1.5 mt-0.5 flex-wrap">${betParts.join('')}</div>
                </div>

            </div>
        `;
    }).join('');
}

// ─── Bet panel ────────────────────────────────────────────────

function renderPvpBetPanel() {
    const panel  = document.getElementById('pvp-bet-panel');
    const canBet = pvpState.state === 'waiting' || pvpState.state === 'countdown';
    if (panel) {
        panel.style.opacity     = canBet ? '1' : '0.45';
        panel.style.pointerEvents = canBet ? 'auto' : 'none';
    }
}

function pvpSwitchBetTab(tab) {
    pvpBetTab = tab;
    ['stars', 'ton', 'gift'].forEach(t => {
        const btn    = document.getElementById(`pvp-tab-${t}`);
        const pane   = document.getElementById(`pvp-pane-${t}`);
        const active = t === tab;
        if (btn) {
            btn.classList.toggle('pvp-tab-active', active);
            btn.classList.toggle('text-white', active);
            btn.classList.toggle('text-white/40', !active);
        }
        if (pane) pane.classList.toggle('hidden', !active);
    });
}

function renderPvpInventory() {
    const grid = document.getElementById('pvp-gift-grid');
    if (!grid) return;

    if (pvpInventory.length === 0) {
        grid.innerHTML = `<p class="col-span-3 text-center text-white/30 text-xs py-4" data-i18n="pvp_inventory_empty">${_pvpT('pvp_inventory_empty','Inventory is empty')}</p>`;
        return;
    }

    grid.innerHTML = pvpInventory.map(g => {
        const exchangeStars = g.exchange_stars > 0 ? g.exchange_stars : g.value_stars;
        return `
        <div onclick="placePvpGiftBet(${g.gift_id})"
             class="glass rounded-xl p-2 flex flex-col items-center gap-1 cursor-pointer active:scale-95 transition-transform border border-white/10 hover:border-purple-500/40 relative">
            <img src="${g.photo}" class="w-10 h-10 object-contain drop-shadow-md" onerror="this.src='/gifts/dount.png'">
            <div class="text-[9px] text-white/70 text-center leading-tight max-w-[56px] truncate">${escHtml(g.name || 'Gift')}</div>
            <div class="flex items-center gap-0.5 text-[9px] text-amber-300 font-bold leading-tight">
                <span>${exchangeStars}</span>
                <img src="/gifts/stars.png" class="w-3 h-3 object-contain inline-block" onerror="this.outerHTML='★'">
            </div>
            ${g.amount > 1 ? `<div class="absolute top-1 right-1 bg-purple-500 rounded-full w-4 h-4 flex items-center justify-center text-[8px] font-black text-white">${g.amount}</div>` : ''}
        </div>
    `}).join('');
}

// ─── Balance + inventory sync ─────────────────────────────────

async function pvpRefreshUserData() {
    try {
        const res  = await fetch('/api/pvp/user_balance', { headers: getApiHeaders() });
        const data = await res.json();
        if (data.balance     !== undefined) myBalance    = data.balance;
        if (data.ton_balance !== undefined) myTonBalance = data.ton_balance;
        if (data.stars       !== undefined) myStars      = data.stars;
        if (data.gifts       !== undefined) myGifts      = data.gifts;
        if (typeof updateUI      === 'function') updateUI();
        if (typeof renderProfile === 'function') renderProfile();
    } catch (_) {}
    await loadPvpInventory();
}

// ─── Placing bets ─────────────────────────────────────────────

async function placePvpBet() {
    const state = pvpState.state;
    if (state !== 'waiting' && state !== 'countdown') {
        if (typeof showNotify === 'function') showNotify(_pvpT('pvp_bets_closed', 'Bets are not accepted right now'), 'warning');
        return;
    }

    if (pvpBetTab === 'stars') {
        const amount = parseInt(document.getElementById('pvp-stars-input')?.value || '0');
        if (!amount || amount < 15) {
            if (typeof showNotify === 'function') showNotify(_pvpT('pvp_min_stars_warn', 'Minimum 15 ⭐'), 'warning');
            return;
        }
        await sendPvpBet('/api/pvp/bet/stars', { amount });

    } else if (pvpBetTab === 'ton') {
        const amount = parseFloat(document.getElementById('pvp-ton-input')?.value || '0');
        if (!amount || amount < 0.1) {
            if (typeof showNotify === 'function') showNotify(_pvpT('pvp_min_ton_warn', 'Minimum 0.1 TON'), 'warning');
            return;
        }
        await sendPvpBet('/api/pvp/bet/ton', { amount });
    }
}

async function placePvpGiftBet(gift_id) {
    const state = pvpState.state;
    if (state !== 'waiting' && state !== 'countdown') {
        if (typeof showNotify === 'function') showNotify(_pvpT('pvp_bets_closed', 'Bets are not accepted right now'), 'warning');
        return;
    }
    if (typeof vibrate === 'function') vibrate('light');
    await sendPvpBet('/api/pvp/bet/gift', { gift_id });
    await loadPvpInventory();
}

async function sendPvpBet(url, body) {
    const btn = document.getElementById('pvp-bet-btn');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); }
    try {
        if (typeof vibrate === 'function') vibrate('light');
        const res  = await fetch(url, {
            method: 'POST',
            headers: { ...getApiHeaders(), 'Content-Type': 'application/json' },
            body:    JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
            if (typeof showNotify === 'function') showNotify(data.detail || _pvpT('notify_error', 'Error'), 'error');
            return;
        }
        if (typeof showNotify === 'function') showNotify(_pvpT('pvp_bet_accepted', 'Bet accepted! 🎯'), 'success');
        if (data.balance !== undefined) myBalance = data.balance;
        if (data.ton_balance !== undefined) myTonBalance = data.ton_balance;
        if (data.stars   !== undefined) myStars   = data.stars;
        if (data.gifts   !== undefined) myGifts   = data.gifts;
        if (typeof updateUI      === 'function') updateUI();
        if (typeof renderProfile === 'function') renderProfile();
    } catch (e) {
        if (typeof showNotify === 'function') showNotify(_pvpT('err_conn', 'Connection error'), 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); }
    }
}

function setPvpStarsBet(preset) {
    const inp = document.getElementById('pvp-stars-input');
    if (!inp) return;
    const balance = (typeof myStars !== 'undefined' ? myStars : 0);
    if (preset === 'min')       inp.value = 15;
    else if (preset === 'x2')   inp.value = Math.min(balance, Math.max(15, parseInt(inp.value || '15') * 2));
    else if (preset === 'max')  inp.value = balance;
    else                        inp.value = preset;
}

function setPvpTonBet(preset) {
    const inp = document.getElementById('pvp-ton-input');
    if (!inp) return;
    const balance = (typeof myTonBalance !== 'undefined' ? myTonBalance : 0);
    if (preset === 'min')      inp.value = 0.1;
    else if (preset === 'x2')  inp.value = Math.min(balance, Math.max(0.1, parseFloat(inp.value || '0.1') * 2)).toFixed(2);
    else if (preset === 'max') inp.value = balance;
    else                       inp.value = preset;
}

// ─── Winner reveal ────────────────────────────────────────────

function showPvpWinnerReveal(winner) {
    const overlay = document.getElementById('pvp-winner-overlay');
    if (!overlay) return;

    const pot = pvpState.pot;
    const potStr = [];
    if (pot.stars  > 0) potStr.push(`${Math.floor(pot.stars  * 0.95)}${_pvpStarIcon(16)}`);
    if (pot.ton > 0) potStr.push(`${(pot.ton * 0.95).toFixed(2)}${_pvpDonutIcon(16)}`);

    const previews = pot.gift_previews || [];
    if (previews.length > 0) {
        previews.slice(0, 3).forEach(g => {
            const starVal = g.value_stars || g.exchange_stars || 0;
            let gHtml = '';
            if (g.photo) {
                gHtml += `<img src="${g.photo}" title="${escHtml(g.name)}" style="width:18px;height:18px;object-fit:contain;display:inline-block;vertical-align:middle;border-radius:3px;" onerror="this.outerHTML='🎁'">`;
            } else {
                gHtml += '🎁';
            }
            if (starVal > 0) gHtml += `<span style="font-size:10px;color:#fde047;font-weight:900;margin-left:2px;">${starVal}${_pvpStarIcon(10)}</span>`;
            potStr.push(gHtml);
        });
        if (pot.gifts > 3) potStr.push(`<span style="font-size:11px;color:#c4b5fd;font-weight:700;">+${pot.gifts - 3}</span>`);
    } else if (pot.gifts > 0) {
        potStr.push(`${pot.gifts}🎁`);
    }

    overlay.innerHTML = `
        <div class="pvp-winner-card text-center animate-pvp-winner-pop"
             style="padding:12px 14px;gap:5px;display:flex;flex-direction:column;align-items:center;">
            <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,${winner.color}22 0%,transparent 70%);pointer-events:none;"></div>
            <div style="position:relative;flex-shrink:0;line-height:1;">${_pvpTrophyIcon(30)}</div>
            <div class="pvp-winner-avatar"
                 style="position:relative;border-color:${winner.color};box-shadow:0 0 28px ${winner.color}99;flex-shrink:0;">
                ${winner.avatar
                    ? `<img src="${winner.avatar}" class="w-full h-full object-cover rounded-full" onerror="this.style.display='none'">`
                    : `<div class="w-full h-full flex items-center justify-center text-2xl font-black rounded-full" style="background:${winner.color}33">${(winner.name||'?')[0]}</div>`
                }
            </div>
            <div class="font-black text-white"
                 style="position:relative;font-size:15px;line-height:1.25;text-shadow:0 0 16px ${winner.color}99;flex-shrink:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
            >${escHtml(winner.name)}</div>
            <div class="font-semibold"
                 style="position:relative;font-size:10px;color:rgba(255,255,255,0.55);flex-shrink:0;"
                 data-i18n="pvp_winner_takes">${_pvpT('pvp_winner_takes','takes the entire bank!')}</div>
            <div class="flex flex-wrap justify-center"
                 style="position:relative;gap:4px;max-width:96%;max-height:44px;overflow:hidden;">
                ${potStr.map(s => `<span style="padding:3px 9px;border-radius:999px;font-size:11px;font-weight:900;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;display:flex;align-items:center;gap:3px;">${s}</span>`).join('')}
            </div>
        </div>
        <div class="pvp-confetti-emitter" id="pvp-confetti" style="position:absolute;inset:0;pointer-events:none;"></div>
    `;
    
    // Показываем победителя спустя небольшую задержку (чтобы колесо успело завершить вращение)
    setTimeout(() => {
        overlay.classList.remove('hidden');
        spawnPvpConfetti();

        if (window.Telegram?.WebApp?.HapticFeedback) {
            window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
        }
    }, 6000);

    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 12000);
}

function spawnPvpConfetti() {
    const container = document.getElementById('pvp-confetti');
    if (!container) return;
    const colors = ['#FFD700', '#FF6B6B', '#4ECDC4', '#fff', '#FFEAA7', '#DDA0DD'];
    for (let i = 0; i < 40; i++) {
        const c = document.createElement('div');
        c.className = 'pvp-confetti-piece';
        c.style.cssText = `
            position:absolute;
            width:${4 + Math.random() * 6}px;
            height:${4 + Math.random() * 6}px;
            background:${colors[Math.floor(Math.random() * colors.length)]};
            border-radius:${Math.random() > 0.5 ? '50%' : '2px'};
            left:${Math.random() * 100}%;
            top:0;
            opacity:1;
            animation: pvpConfettiFall ${1.5 + Math.random() * 2}s ease-out forwards;
            animation-delay:${Math.random() * 0.8}s;
        `;
        container.appendChild(c);
    }
}

// ─── Utility ──────────────────────────────────────────────────

function escHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}