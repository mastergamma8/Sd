// =============================================================
// games-pvp.js — SPACE DONUT PVP (Обновленная Радиальная Арена)
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
let pvpPollingActive      = false;  // страж от race-condition при закрытии
let pvpBallAnimFrame      = null;
let pvpBetTab             = 'stars';   // 'stars' | 'ton' | 'gift'
let pvpInventory          = [];
let pvpBallPos            = { x: 50, y: 50 };
let pvpBallTrail          = [];
let pvpLastState          = '';
let pvpCountdownInterval  = null;
let pvpWinnerRevealed     = false;
let pvpRollingStart       = 0;
let pvpTrajectorySegments = [];
const PVP_ROLLING_DURATION = 6500;

// ─── Online counter ───────────────────────────────────────────
let pvpHeartbeatTimer = null;
const PVP_HEARTBEAT_INTERVAL = 30000; // 30 сек

const pvpAvatarCache = {};

// ─── Render-hash guards ───────────────────────────────────────
// Each render function stores a "content hash" of its input data.
// If the hash hasn't changed since the last render, the function
// skips the innerHTML rebuild entirely — CSS animations on existing
// DOM elements are therefore never reset by polling, which was the
// root cause of the "everything pulses/restarts every 600ms" bug.
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
function _pvpCrownIcon(size) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="#f59e0b" style="display:inline-block;vertical-align:middle;"><path d="M2 20h20v2H2v-2zM4 18l4-10 4 5 4-8 4 13H4z"/></svg>`;
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
    sendPvpHeartbeat();  // сразу при открытии
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
    if (pvpBallAnimFrame)     { cancelAnimationFrame(pvpBallAnimFrame); pvpBallAnimFrame = null; }
    if (pvpCountdownInterval) { clearInterval(pvpCountdownInterval); pvpCountdownInterval = null; }
    stopPvpHeartbeat();
}

async function pollPvpState() {
    try {
        const res  = await fetch('/api/pvp/state', { headers: getApiHeaders() });
        const data = await res.json();
        // Проверяем флаг ПОСЛЕ await: пользователь мог закрыть игру пока шёл запрос
        if (!pvpPollingActive) return;
        applyPvpState(data);
    } catch (_) {}

    if (!pvpPollingActive) return;
    const interval = pvpState.state === 'rolling' ? 300 : 600;
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

    // Обновляем счётчик онлайна при каждом обновлении состояния
    if (typeof data.online_count === 'number') {
        renderPvpOnlineCounter(data.online_count);
    }

    if (data.round_id !== prevRoundId) {
        pvpWinnerRevealed = false;
        pvpBallTrail      = [];
        pvpTrajectorySegments = [];
        // New round — force all render functions to rebuild their DOM
        _pvpArenaHash  = '';
        _pvpStatusHash = '';
        _pvpTopBarHash = '';
        _pvpPartsHash  = '';
    }

    if (data.state === 'rolling' && (prevState !== 'rolling' || !pvpBallAnimFrame)) {
        const serverNow      = Date.now() / 1000;
        const elapsedSeconds = data.rolling_start_ts > 0
            ? Math.max(0, serverNow - data.rolling_start_ts)
            : 0;
        pvpRollingStart = performance.now() - elapsedSeconds * 1000;

        const wId = data.winner ? data.winner.user_id : null;
        const serverTarget = (data.ball_target_x != null && data.ball_target_y != null)
            ? { x: data.ball_target_x, y: data.ball_target_y }
            : null;
        pvpInitBallFromSeed(data.ball_seed != null ? data.ball_seed : 1, wId, serverTarget);
        startPvpBallAnimation();
    }

    if (data.state !== 'rolling' && prevState === 'rolling') {
        stopPvpBallAnimation();
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
        stopPvpBallAnimation();
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
    pvpCountdownInterval = setInterval(() => {
        pvpLocalCountdown = Math.max(0, pvpLocalCountdown - 0.1);
        const el = document.getElementById('pvp-countdown-val');
        if (el) el.textContent = Math.ceil(pvpLocalCountdown);
        if (pvpLocalCountdown <= 0) {
            clearInterval(pvpCountdownInterval);
            pvpCountdownInterval = null;
        }
    }, 100);
}

// ─── Ball / Diamond animation ─────────────────────────────────

function startPvpBallAnimation() {
    stopPvpBallAnimation();
    animatePvpBall();
}

function stopPvpBallAnimation() {
    if (pvpBallAnimFrame) {
        cancelAnimationFrame(pvpBallAnimFrame);
        pvpBallAnimFrame = null;
    }

    const arenaInner = document.getElementById('pvp-arena-inner');
    if (arenaInner) {
        arenaInner.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
        arenaInner.style.transform  = '';
    }

    // Explicitly hide the ball so it doesn't linger if the server state
    // hasn't caught up yet. updatePvpStatus() will re-show it on 'rolling'.
    const ball = document.getElementById('pvp-ball');
    if (ball) ball.style.opacity = '0';

    pvpBallTrail = [];
    pvpBallTailPositions = [];
    renderPvpBallTail();
}

// Seed-based RNG (Mulberry32). Replaced on each pvpInitBallFromSeed call.
// Never falls back to Math.random() — all randomness must come from ball_seed.
let _pvpRng = () => 0.5;

// Pre-computed bounce thresholds — timeProgress values where ball hits a wall.
// Used to trigger haptic feedback at the exact moment of each impact.
let pvpBounceThresholds = [];

// Rolling tail — last N positions of the ball, updated every animation frame.
// Rendered as a short glowing trail directly behind the ball.
let pvpBallTailPositions = [];

function getPvpWinnerSectorTarget(winnerId) {
    const players = pvpState.players || [];
    const totalChance = players.reduce((sum, p) => sum + p.win_chance, 0);
    let currentPercent = 0;

    for (const p of players) {
        const normalizedChance = totalChance > 0
            ? (p.win_chance / totalChance) * 100
            : (100 / players.length);

        if (String(p.user_id) === String(winnerId)) {
            const padding = Math.max(2, normalizedChance * 0.1);
            const safeChance = Math.max(1, normalizedChance - padding * 2);
            const randomPercent = currentPercent + padding + (_pvpRng() * safeChance);

            const angleDeg = (randomPercent * 3.6) - 90;
            const angleRad = angleDeg * (Math.PI / 180);

            const r = 12 + _pvpRng() * 16;

            const x = 50 + r * Math.cos(angleRad);
            const y = 50 + r * Math.sin(angleRad);
            return { x, y };
        }
        currentPercent += normalizedChance;
    }
    return { x: 50, y: 50 };
}

function pvpInitBallFromSeed(seed, winnerId, serverTarget = null) {
    // ── Mulberry32 seeded RNG ────────────────────────────────────────────
    let s = seed >>> 0;
    _pvpRng = () => {
        s += 0x6D2B79F5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    // ── Determine winner target (same RNG consumption as before) ─────────
    let targetP;
    if (winnerId) {
        if (serverTarget) {
            _pvpRng(); _pvpRng(); // consume same calls as getPvpWinnerSectorTarget
            targetP = serverTarget;
        } else {
            targetP = getPvpWinnerSectorTarget(winnerId);
        }
    } else {
        targetP = { x: 50, y: 50 };
    }

    // ── Real billiard physics ────────────────────────────────────────────
    //   Ball starts at center, moves in a seeded random direction,
    //   bounces off walls with proper reflection, loses energy each bounce.
    const MIN_X = 4, MAX_X = 96, MIN_Y = 4, MAX_Y = 96;
    const ENERGY_LOSS   = 0.92;   // speed multiplier per bounce
    const MAX_JITTER    = 0.03;   // max angle perturbation (radians) per bounce
    const numBounces    = 9 + Math.floor(_pvpRng() * 4); // 9–12 bounces

    let x   = 50, y = 50;
    const initAngle = _pvpRng() * Math.PI * 2;
    let vx  = Math.cos(initAngle);   // unit direction vector
    let vy  = Math.sin(initAngle);
    let spd = 1.0;                   // normalized speed (1.0 = full speed)

    const wpts      = [{ x, y }];
    const segSpeeds = [];

    for (let b = 0; b < numBounces; b++) {
        // Cast a ray from (x, y) in direction (vx, vy) and find the nearest wall.
        let tHit = Infinity, hitWall = '';

        const check = (t, wall) => {
            if (t > 1e-9 && t < tHit) { tHit = t; hitWall = wall; }
        };
        if (vx > 0)       check((MAX_X - x) / vx,  'right');
        else if (vx < 0)  check((MIN_X - x) / vx,  'left');
        if (vy > 0)       check((MAX_Y - y) / vy,  'bottom');
        else if (vy < 0)  check((MIN_Y - y) / vy,  'top');

        if (!hitWall) break;   // safety: shouldn't happen

        // Move exactly to the wall
        x = Math.max(MIN_X, Math.min(MAX_X, x + vx * tHit));
        y = Math.max(MIN_Y, Math.min(MAX_Y, y + vy * tHit));

        segSpeeds.push(spd);
        wpts.push({ x, y });

        // Reflect: vertical wall flips vx; horizontal wall flips vy
        if (hitWall === 'left' || hitWall === 'right') vx = -vx;
        else                                            vy = -vy;

        // Energy loss each bounce
        spd *= ENERGY_LOSS;

        // Tiny seeded angle jitter (keeps motion lively but deterministic)
        const jitter = (_pvpRng() - 0.5) * MAX_JITTER * 2;
        const cosJ = Math.cos(jitter), sinJ = Math.sin(jitter);
        const nvx = vx * cosJ - vy * sinJ;
        const nvy = vx * sinJ + vy * cosJ;
        vx = nvx; vy = nvy;
    }

    // Final segment: glide toward the winning target
    segSpeeds.push(spd * ENERGY_LOSS);
    wpts.push(targetP);

    // ── Build trajectory segments with time-weighting ────────────────────
    //   Time for segment i  =  distance_i / speed_i
    //   Phase factor compresses early bounces (fast, active ricochets) and
    //   slightly extends the final approach — without over-stretching the end.
    let totalTime = 0;
    pvpTrajectorySegments = [];

    const totalSegments = wpts.length - 1;

    for (let i = 0; i < totalSegments; i++) {
        const p1  = wpts[i], p2 = wpts[i + 1];
        const dx  = p2.x - p1.x, dy = p2.y - p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        let segTime = dist / Math.max(segSpeeds[i], 0.01);

        const t = i / Math.max(1, totalSegments - 1);

        // Early bounces run compressed (58% of raw time) → lively, rapid.
        // Mid-range normalises. Final segment gets a mild 18% extension only.
        let phaseFactor;
        if      (t < 0.35) phaseFactor = 0.58;
        else if (t < 0.65) phaseFactor = 0.82;
        else               phaseFactor = 1.0;

        if (i === totalSegments - 1) phaseFactor *= 1.18;

        segTime *= phaseFactor;

        pvpTrajectorySegments.push({ p1, p2, dist, accTime: totalTime, segTime });
        totalTime += segTime;
    }

    // Normalize startT / endT to [0, 1]
    for (const seg of pvpTrajectorySegments) {
        seg.startT = seg.accTime / totalTime;
        seg.endT   = (seg.accTime + seg.segTime) / totalTime;
    }

    // ── Bounce thresholds for haptic feedback ────────────────────────────
    //   Each threshold is the startT of a wall-bounce segment (skip segment 0
    //   which starts at center, and skip the last "glide to target" segment).
    //   Thresholds beyond 0.82 are excluded to prevent multiple rapid vibrations
    //   in the final stretch just before the winner reveal haptic fires.
    pvpBounceThresholds = pvpTrajectorySegments
        .slice(1, pvpTrajectorySegments.length - 1)
        .map(seg => ({ t: seg.startT, fired: false }))
        .filter(bth => bth.t < 0.82);

    // Reset tail
    pvpBallTailPositions = [];

    pvpBallPos = { x: 50, y: 50 };
}

function animatePvpBall() {
    const elapsed = performance.now() - pvpRollingStart;

    // Single smooth deceleration curve for the entire animation.
    // easeOutCubic: fast at the start, gradually slows to a natural stop.
    // The last segment is made longer in pvpInitBallFromSeed (*1.7),
    // so there is no need — and no place — for per-segment easing overrides.
    const rawProgress  = Math.min(elapsed / PVP_ROLLING_DURATION, 1);
    const timeProgress = 1 - Math.pow(1 - rawProgress, 3); // easeOutCubic

    if (!pvpTrajectorySegments.length) { pvpBallAnimFrame = null; return; }

    // ── Interpolate along time-weighted segments ─────────────────────────
    let currentPos = pvpTrajectorySegments[pvpTrajectorySegments.length - 1].p2;
    for (const seg of pvpTrajectorySegments) {
        if (timeProgress >= seg.startT && timeProgress <= seg.endT) {
            const range  = seg.endT - seg.startT;
            const segProg = range > 0 ? (timeProgress - seg.startT) / range : 1;
            currentPos = {
                x: seg.p1.x + (seg.p2.x - seg.p1.x) * segProg,
                y: seg.p1.y + (seg.p2.y - seg.p1.y) * segProg
            };
            break;
        }
    }

    pvpBallPos = currentPos;
    const ball = document.getElementById('pvp-ball');
    if (ball) {
        ball.style.left    = pvpBallPos.x + '%';
        ball.style.top     = pvpBallPos.y + '%';
        ball.style.opacity = '1';
    }

    // ── Zoom arena toward target in the final stretch ────────────────────
    const arenaInner = document.getElementById('pvp-arena-inner');
    if (arenaInner) {
        if (timeProgress > 0.65) {
            let zoomProgress = Math.max(0, (timeProgress - 0.65) / 0.35);
            zoomProgress = zoomProgress * zoomProgress * (3 - 2 * zoomProgress);
            const scale = 1 + zoomProgress * 0.9;
            arenaInner.style.transform       = `scale(${scale.toFixed(3)})`;
            arenaInner.style.transformOrigin = `${pvpBallPos.x}% ${pvpBallPos.y}%`;
            arenaInner.style.transition      = 'none';
        } else {
            arenaInner.style.transform  = '';
            arenaInner.style.transition = '';
        }
    }

    // ── Haptic feedback on each wall bounce ──────────────────────────────
    for (const bth of pvpBounceThresholds) {
        if (!bth.fired && timeProgress >= bth.t) {
            bth.fired = true;
            _pvpHapticBounce();
        }
    }

    // ── Rolling tail (short trail directly behind the ball) ──────────────
    pvpBallTailPositions.push({ x: pvpBallPos.x, y: pvpBallPos.y });
    if (pvpBallTailPositions.length > 9) pvpBallTailPositions.shift();
    renderPvpBallTail();

    if (timeProgress < 1) {
        pvpBallAnimFrame = requestAnimationFrame(animatePvpBall);
    } else {
        pvpBallAnimFrame = null;
        stopPvpBallAnimation();
        if (pvpState.winner && !pvpWinnerRevealed) {
            pvpWinnerRevealed = true;
            showPvpWinnerReveal(pvpState.winner);
        }
    }
}

// Haptic helper — light impact for wall bounces
function _pvpHapticBounce() {
    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.impactOccurred('light');
    } else if (window.tg?.HapticFeedback) {
        window.tg.HapticFeedback.impactOccurred('light');
    } else if (typeof vibrate === 'function') {
        vibrate('light');
    }
}

// Renders a short glowing tail directly behind the ball (last 9 frames).
// The old map-wide breadcrumb trail is intentionally removed.
function renderPvpBallTail() {
    const container = document.getElementById('pvp-ball-trail');
    if (!container) return;
    container.innerHTML = '';
    const n = pvpBallTailPositions.length;
    pvpBallTailPositions.forEach((pt, i) => {
        const frac  = (i + 1) / n;        // 0→1 from oldest to newest
        const alpha = frac * 0.55;
        const size  = 3 + frac * 7;       // 3px (oldest) → 10px (newest)
        const dot   = document.createElement('div');
        dot.style.cssText =
            `position:absolute;` +
            `left:${pt.x}%;top:${pt.y}%;` +
            `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
            `border-radius:50%;` +
            `background:rgba(255,255,255,${alpha.toFixed(3)});` +
            `transform:translate(-50%,-50%);` +
            `pointer-events:none;`;
        container.appendChild(dot);
    });
}

// Legacy stub so any external callers don't break.
function renderPvpTrail() { renderPvpBallTail(); }

// ─── Arena render — РАДИАЛЬНАЯ АРЕНА (Proportional avatars) ────

function _pvpAvatarSize(normalizedChance, numPlayers) {
    // Single player → large centered avatar
    if (numPlayers <= 1) return 92;
    // Scale linearly: 0% bet → minPx, 100% of all bets → maxPx
    const minPx = 15, maxPx = 92;
    const size = minPx + (normalizedChance / 100) * (maxPx - minPx);
    return Math.max(minPx, Math.min(maxPx, Math.round(size)));
}

function renderPvpArena() {
    const container = document.getElementById('pvp-arena-players');
    const bg = document.getElementById('pvp-dynamic-bg');
    if (!container || !bg) return;

    // Skip DOM rebuild if nothing relevant has changed — prevents CSS
    // animations (orbit rings, waiting dots) from restarting every poll.
    const players = pvpState.players || [];
    const arenaHash = pvpState.state + '|' + pvpState.round_id + '|' +
        players.map(p => p.user_id + ':' + p.win_chance.toFixed(2) + ':' + p.color).join(',') +
        '|winner:' + (pvpState.winner?.user_id ?? 'none');
    if (arenaHash === _pvpArenaHash) return;
    _pvpArenaHash = arenaHash;

    container.innerHTML = '';

    if (players.length === 0) {
        bg.style.background = 'radial-gradient(ellipse at center, rgba(244,63,94,0.07) 0%, #020617 70%)';
        container.innerHTML = `
            <div class="pvp-waiting-anim">
                <!-- Orbit ring 1 -->
                <div class="pvp-orbit-ring pvp-orbit-ring-1">
                    <div class="pvp-orbit-dot pvp-orbit-dot-rose"></div>
                    <div class="pvp-orbit-dot pvp-orbit-dot-rose pvp-orbit-dot-b"></div>
                </div>
                <!-- Orbit ring 2 -->
                <div class="pvp-orbit-ring pvp-orbit-ring-2">
                    <div class="pvp-orbit-dot pvp-orbit-dot-violet"></div>
                    <div class="pvp-orbit-dot pvp-orbit-dot-violet pvp-orbit-dot-b" style="top:auto;bottom:-4px;left:50%;transform:translateX(-50%);"></div>
                </div>
                <!-- Orbit ring 3 -->
                <div class="pvp-orbit-ring pvp-orbit-ring-3">
                    <div class="pvp-orbit-dot pvp-orbit-dot-blue"></div>
                </div>
                <!-- Central icon -->
                <div class="pvp-waiting-icon-wrap">
                    <img src="/gifts/pvp.png" style="width:72px;height:72px;object-fit:contain;"
                         onerror="this.outerHTML='<span style=\\'font-size:52px;line-height:1;\\'>⚔️</span>'">
                </div>
                <!-- Label -->
                <div class="pvp-waiting-label" data-i18n="pvp_waiting">Ожидание ставок</div>
                <!-- Bouncing dots -->
                <div class="pvp-dots-loader">
                    <span></span><span></span><span></span>
                </div>
            </div>
        `;
        return;
    }

    let gradientParts = [];
    let currentPercent = 0;
    let totalChance = players.reduce((sum, p) => sum + p.win_chance, 0);

    players.forEach((p, idx) => {
        let normalizedChance = totalChance > 0 ? (p.win_chance / totalChance) * 100 : (100 / players.length);

        let start = currentPercent;
        let end = currentPercent + normalizedChance;
        gradientParts.push(`${p.color} ${start}% ${end}%`);

        let x, y;
        // Single player: center avatar
        if (players.length === 1) {
            x = 50;
            y = 50;
        } else {
            let midPercent = start + (normalizedChance / 2);
            let angleDeg = (midPercent * 3.6) - 90;
            let angleRad = angleDeg * (Math.PI / 180);
            let radius = 33;
            x = 50 + radius * Math.cos(angleRad);
            y = 50 + radius * Math.sin(angleRad);
        }

        const isWinner = pvpState.state === 'finished' && pvpState.winner?.user_id === p.user_id;

        // Proportional avatar size
        const avatarPx = _pvpAvatarSize(normalizedChance, players.length);

        const avatarWrap = document.createElement('div');
        avatarWrap.id = `pvp-player-avatar-${p.user_id}`;
        avatarWrap.className = `absolute z-10 rounded-full flex flex-col items-center justify-center border-[3px] shadow-2xl transition-all duration-500 ${isWinner ? 'z-20 pvp-winner-pulse' : ''}`;
        avatarWrap.style.cssText = `
            left: ${x}%; top: ${y}%;
            transform: translate(-50%, -50%) ${isWinner ? 'scale(1.2)' : 'scale(1)'};
            width: ${avatarPx}px; height: ${avatarPx}px;
            border-color: rgba(255,255,255,0.9);
            background: ${p.color};
            transition: width 0.5s ease, height 0.5s ease, transform 0.3s ease;
        `;

        if (p.avatar) {
            avatarWrap.innerHTML = `<img src="${p.avatar}" class="w-full h-full object-cover rounded-full" onerror="this.style.display='none'">`;
        } else {
            const fontSize = Math.max(10, Math.round(avatarPx * 0.45));
            avatarWrap.innerHTML = `<div class="w-full h-full flex items-center justify-center font-black text-white rounded-full" style="font-size:${fontSize}px">${(p.name||'?')[0]}</div>`;
        }


        // Info label: win chance
        const infoLabel = document.createElement('div');
        infoLabel.className = "absolute -bottom-6 left-1/2 -translate-x-1/2 bg-black/70 px-2 py-0.5 rounded-lg text-[9px] font-black text-white whitespace-nowrap backdrop-blur-md border border-white/20 flex flex-col items-center leading-tight shadow-lg";
        infoLabel.innerHTML = `<span>${p.win_chance.toFixed(1)}%</span>`;
        avatarWrap.appendChild(infoLabel);

        container.appendChild(avatarWrap);
        currentPercent = end;
    });

    bg.style.background = `conic-gradient(${gradientParts.join(', ')})`;
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

    // Skip DOM rebuild when last/best game data hasn't changed
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
                    ${_pvpTrophyIcon(12)} <span class="text-amber-400/60 text-[9px] font-bold uppercase tracking-wide" data-i18n="pvp_best_game">${_pvpT('pvp_best_game','Best')}</span>
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
    const countEl   = document.getElementById('pvp-countdown-overlay');
    const potEl     = document.getElementById('pvp-pot-display');
    const ball      = document.getElementById('pvp-ball');

    const starIco  = _pvpStarIcon(14);
    const donutIco = _pvpDonutIcon(14);

    // Skip status + pot rebuild when nothing has changed.
    // This is the primary fix for the "animate-pulse dot restarts every 600ms" bug:
    // the dot element was being recreated on every poll even when state didn't change.
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
            // Compact "waiting" indicator — small to fit in the header
            statusEl.innerHTML = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white/80 font-bold text-[10px] tracking-wide"
                      style="background:linear-gradient(135deg,rgba(244,63,94,0.20),rgba(168,85,247,0.15));border:1px solid rgba(244,63,94,0.35);">
                    <span class="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse inline-block"></span>
                    <span data-i18n="pvp_waiting">${_pvpT('pvp_waiting','Waiting for Players')}</span>
                </span>`;
            statusEl.className = 'flex items-center mt-0.5';
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
        } else if (s === 'finished') {
            statusEl.innerHTML = `${_pvpTrophyIcon(12)} <span class="text-amber-300 font-bold text-xs ml-1" data-i18n="pvp_winner_found">${_pvpT('pvp_winner_found','Winner found!')}</span>`;
            statusEl.className = 'text-[10px] text-white/50 font-bold tracking-wide mt-1 flex items-center';
        }
    }

    if (countEl) {
        if (pvpState.state === 'countdown') {
            countEl.classList.remove('hidden');
        } else {
            countEl.classList.add('hidden');
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

    if (ball) {
        ball.style.opacity = pvpState.state === 'rolling' && !pvpWinnerRevealed ? '1' : '0';
    }
}

// ─── Participants list ────────────────────────────────────────

function renderPvpParticipants() {
    const list = document.getElementById('pvp-participants-list');
    const cnt  = document.getElementById('pvp-players-count');
    if (!list) return;

    const players = pvpState.players || [];

    // Skip rebuild if player list + winner state unchanged
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

        // Render each gift with photo + value_stars
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
                <div class="text-right flex-shrink-0">
                    <div class="text-xs font-black" style="color:${p.color}">${p.win_chance.toFixed(1)}%</div>
                    <div class="text-[9px] text-white/40" data-i18n="pvp_chance">${_pvpT('pvp_chance','chance')}</div>
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
    const ball    = document.getElementById('pvp-ball');
    if (!overlay) return;

    if (ball) ball.style.opacity = '0';

    const pot = pvpState.pot;
    const potStr = [];
    if (pot.stars  > 0) potStr.push(`${Math.floor(pot.stars  * 0.95)}${_pvpStarIcon(16)}`);
    if (pot.ton > 0) potStr.push(`${(pot.ton * 0.95).toFixed(2)}${_pvpDonutIcon(16)}`);

    // Show actual gift images with their star value
    const previews = pot.gift_previews || [];
    if (previews.length > 0) {
        previews.slice(0, 4).forEach(g => {
            const starVal = g.value_stars || g.exchange_stars || 0;
            let gHtml = '';
            if (g.photo) {
                gHtml += `<img src="${g.photo}" title="${escHtml(g.name)}" style="width:22px;height:22px;object-fit:contain;display:inline-block;vertical-align:middle;border-radius:4px;" onerror="this.outerHTML='🎁'">`;
            } else {
                gHtml += '🎁';
            }
            if (starVal > 0) gHtml += `<span style="font-size:10px;color:#fde047;font-weight:900;margin-left:2px;">${starVal}${_pvpStarIcon(10)}</span>`;
            potStr.push(gHtml);
        });
        if (pot.gifts > 4) potStr.push(`<span style="font-size:11px;color:#c4b5fd;font-weight:700;">+${pot.gifts - 4}</span>`);
    } else if (pot.gifts > 0) {
        potStr.push(`${pot.gifts}🎁`);
    }

    overlay.innerHTML = `
        <div class="pvp-winner-card flex flex-col items-center gap-4 p-6 text-center animate-pvp-winner-pop">
            <div style="position:absolute;inset:0;background:radial-gradient(ellipse at center,${winner.color}22 0%,transparent 70%);pointer-events:none;"></div>
            <div class="text-4xl" style="position:relative;">${_pvpTrophyIcon(52)}</div>
            <div class="pvp-winner-avatar" style="position:relative;width:96px;height:96px;border-color:${winner.color};box-shadow:0 0 40px ${winner.color}99">
                ${winner.avatar
                    ? `<img src="${winner.avatar}" class="w-full h-full object-cover rounded-full" onerror="this.style.display='none'">`
                    : `<div class="w-full h-full flex items-center justify-center text-3xl font-black rounded-full" style="background:${winner.color}33">${(winner.name||'?')[0]}</div>`
                }
            </div>
            <div class="text-2xl font-black text-white" style="position:relative;text-shadow:0 0 20px ${winner.color}99">${escHtml(winner.name)}</div>
            <div class="text-sm font-semibold" style="position:relative;color:rgba(255,255,255,0.6)" data-i18n="pvp_winner_takes">${_pvpT('pvp_winner_takes','takes the entire bank!')}</div>
            <div class="flex gap-2 flex-wrap justify-center" style="position:relative;max-width:90%;">
                ${potStr.map(s => `<span style="padding:4px 14px;border-radius:999px;font-size:13px;font-weight:900;border:1px solid rgba(255,255,255,0.2);background:rgba(255,255,255,0.08);color:#fff;display:flex;align-items:center;gap:4px;">${s}</span>`).join('')}
            </div>
            <div class="pvp-confetti-emitter" id="pvp-confetti" style="position:absolute;inset:0;pointer-events:none;"></div>
        </div>
    `;
    overlay.classList.remove('hidden');
    spawnPvpConfetti();

    if (window.Telegram?.WebApp?.HapticFeedback) {
        window.Telegram.WebApp.HapticFeedback.notificationOccurred('success');
    }

    setTimeout(() => {
        overlay.classList.add('hidden');
    }, 6500);
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
