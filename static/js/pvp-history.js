// =====================================================
// pvp-history.js
// История PvP-игр: загрузка и рендеринг.
// =====================================================
'use strict';

// ── i18n helper ───────────────────────────────────────────────
function _pvpT(key) {
    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'ru');
    return (i18n && i18n[lang] && i18n[lang][key]) || key;
}

// ── Pagination state ──────────────────────────────────────────

let pvpHistoryOffset    = 0;
const PVP_HISTORY_PAGE  = 30;
let pvpHistoryLoading   = false;
let pvpHistoryAllLoaded = false;
let pvpHistoryGrouped   = {};   // { dateLabel: [entries] }

function _resetPvpHistoryState() {
    pvpHistoryOffset    = 0;
    pvpHistoryLoading   = false;
    pvpHistoryAllLoaded = false;
    pvpHistoryGrouped   = {};
}

// ── Date helper ───────────────────────────────────────────────

function _fmtPvpDate(ts) {
    const d   = new Date(ts * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Plural helper (RU) ────────────────────────────────────────

function _pvpPlural(n) {
    const mod = Math.abs(n) % 100;
    if (mod >= 5 && mod <= 20) return _pvpT('pvp_hist_game_many');
    const mod10 = mod % 10;
    if (mod10 === 1) return _pvpT('pvp_hist_game_one');
    if (mod10 >= 2 && mod10 <= 4) return _pvpT('pvp_hist_game_few');
    return _pvpT('pvp_hist_game_many');
}

// ── Single entry card ─────────────────────────────────────────

function _buildPvpHistoryCard(entry) {
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    // Avatar: use img with fallback to first letter
    const letter     = esc((entry.winner_name || '?')[0].toUpperCase());
    const avatarHtml = entry.winner_avatar && entry.winner_avatar !== '/static/img/anon.svg'
        ? `<img src="${esc(entry.winner_avatar)}" alt="" class="w-full h-full object-cover rounded-full"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"
           ><div class="w-full h-full rounded-full bg-gradient-to-br from-rose-500/60 to-fuchsia-600/60 items-center justify-center text-white font-black text-lg hidden">${letter}</div>`
        : `<div class="w-full h-full rounded-full bg-gradient-to-br from-rose-500/60 to-fuchsia-600/60 flex items-center justify-center text-white font-black text-lg">${letter}</div>`;

    // Winnings line
    const parts = [];
    if (entry.total_stars > 0) {
        parts.push(`<span class="flex items-center gap-0.5 text-yellow-300 font-bold text-xs">+${entry.total_stars}<img src="/gifts/stars.png" class="w-3.5 h-3.5 object-contain ml-0.5"></span>`);
    }
    if (entry.total_donuts > 0) {
        const d = (typeof formatBalance === 'function') ? formatBalance(entry.total_donuts) : entry.total_donuts;
        parts.push(`<span class="flex items-center gap-0.5 text-amber-300 font-bold text-xs">+${d}<img src="/gifts/dount.png" class="w-3.5 h-3.5 object-contain ml-0.5"></span>`);
    }
    if (entry.gifts_count > 0) {
        parts.push(`<span class="text-purple-300 font-bold text-xs">+${entry.gifts_count} 🎁</span>`);
    }
    const winningsHtml = parts.length
        ? parts.join('<span class="text-white/20 text-[10px]">·</span>')
        : `<span class="text-white/30 text-xs">—</span>`;

    // Multiplier badge
    const mult      = Number(entry.multiplier) || 1;
    const multFmt   = mult >= 10 ? mult.toFixed(1) : mult.toFixed(2);
    const multColor = mult >= 5 ? 'text-rose-300' : mult >= 2 ? 'text-fuchsia-300' : 'text-white/50';

    // Sub-label: player count
    const players      = entry.player_count || 2;
    const playersLabel = `${players} ${_pvpT('pvp_hist_players_label')}`;

    return `
        <div class="glass rounded-2xl px-4 py-3 flex items-center justify-between border border-rose-500/15 bg-rose-500/4 gap-3">
            <div class="flex items-center gap-3 min-w-0">

                <!-- Avatar wrapper with trophy badge -->
                <div class="relative w-11 h-11 flex-shrink-0">
                    <div class="w-11 h-11 rounded-full overflow-hidden ring-2 ring-rose-500/30">${avatarHtml}</div>
                    <div class="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-gradient-to-tr from-rose-500 to-fuchsia-500 flex items-center justify-center text-[10px] shadow-[0_0_8px_rgba(244,63,94,0.6)]">🏆</div>
                </div>

                <!-- Text block -->
                <div class="min-w-0">
                    <div class="font-semibold text-white text-sm leading-tight truncate">${esc(entry.winner_name)}</div>
                    <div class="text-[10px] text-rose-200/40 mt-0.5 font-medium">${esc(playersLabel)} · ${_fmtPvpDate(entry.created_at)}</div>
                    <div class="flex items-center gap-1.5 flex-wrap mt-1">${winningsHtml}</div>
                </div>
            </div>

            <!-- Multiplier -->
            <div class="flex-shrink-0 text-right ml-2">
                <div class="text-lg font-black ${multColor} drop-shadow-[0_0_8px_rgba(244,63,94,0.4)]">×${multFmt}</div>
                <div class="text-[9px] text-white/25 font-semibold uppercase tracking-wide">${_pvpT('pvp_hist_of_bet')}</div>
            </div>
        </div>`;
}

// ── Open modal ────────────────────────────────────────────────

async function openPvpHistoryModal() {
    if (typeof vibrate === 'function') vibrate('light');
    if (typeof openModal === 'function') openModal('pvp-history-modal');
    _resetPvpHistoryState();

    const list = document.getElementById('pvp-history-list');
    list.innerHTML = `<div class="text-center text-rose-300/50 py-10 animate-pulse font-bold tracking-widest uppercase text-sm">${_pvpT('pvp_hist_loading')}</div>`;

    // Attach scroll listener for infinite loading
    const modal = document.getElementById('pvp-history-modal');
    if (modal) {
        const scrollEl = modal.querySelector('.overflow-y-auto') || modal;
        scrollEl.removeEventListener('scroll', _pvpHistoryScrollHandler);
        scrollEl.addEventListener('scroll', _pvpHistoryScrollHandler);
    }

    await _loadMorePvpHistory(true);
}

function _pvpHistoryScrollHandler() {
    const modal = document.getElementById('pvp-history-modal');
    if (!modal) return;
    const scrollEl   = modal.querySelector('.overflow-y-auto') || modal;
    const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
    if (nearBottom && !pvpHistoryLoading && !pvpHistoryAllLoaded) _loadMorePvpHistory();
}

// ── Load page ─────────────────────────────────────────────────

async function _loadMorePvpHistory(isFirstLoad = false) {
    if (pvpHistoryLoading || pvpHistoryAllLoaded) return;
    pvpHistoryLoading = true;

    const list = document.getElementById('pvp-history-list');

    let spinner = document.getElementById('pvp-history-spinner');
    if (!isFirstLoad && !spinner) {
        spinner = document.createElement('div');
        spinner.id        = 'pvp-history-spinner';
        spinner.className = 'text-center text-rose-300/50 py-6 animate-pulse font-bold tracking-widest uppercase text-xs';
        spinner.textContent = _pvpT('pvp_hist_loading');
        list.appendChild(spinner);
    }

    try {
        const headers = (typeof getApiHeaders === 'function') ? getApiHeaders() : {};
        const res  = await fetch(`/api/pvp/history?offset=${pvpHistoryOffset}&limit=${PVP_HISTORY_PAGE}`, { headers });
        const data = await res.json();

        spinner = document.getElementById('pvp-history-spinner');
        if (spinner) spinner.remove();

        // ── Пустой результат ──
        if (!data.history || data.history.length === 0) {
            if (isFirstLoad) {
                list.innerHTML = `
                    <div class="text-center text-rose-200/30 text-sm py-12 border border-rose-500/10 border-dashed rounded-2xl px-4">
                        ${_pvpT('pvp_hist_empty')}
                    </div>`;
            } else {
                const endMsg = document.createElement('div');
                endMsg.className   = 'text-center text-rose-200/20 text-xs py-4 font-semibold tracking-widest uppercase';
                endMsg.textContent = _pvpT('pvp_hist_no_more');
                list.appendChild(endMsg);
            }
            pvpHistoryAllLoaded = true;
            pvpHistoryLoading   = false;
            return;
        }

        // ── Накапливаем в группы по дате ──
        pvpHistoryOffset += data.history.length;
        if (pvpHistoryOffset >= data.total || data.history.length < PVP_HISTORY_PAGE) {
            pvpHistoryAllLoaded = true;
        }

        const lang      = (typeof currentLang !== 'undefined' ? currentLang : 'ru');
        const today     = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        data.history.forEach(entry => {
            const dateObj = new Date(entry.created_at * 1000);
            let dateLabel = dateObj.toLocaleDateString(
                lang === 'ru' ? 'ru-RU' : 'en-US',
                { day: 'numeric', month: 'long' }
            );
            if (dateObj.toDateString() === today.toDateString()) {
                dateLabel = _pvpT('pvp_hist_today');
            } else if (dateObj.toDateString() === yesterday.toDateString()) {
                dateLabel = _pvpT('pvp_hist_yesterday');
            }
            if (!pvpHistoryGrouped[dateLabel]) pvpHistoryGrouped[dateLabel] = [];
            pvpHistoryGrouped[dateLabel].push(entry);
        });

        // ── Рендерим ──
        let html = '';
        for (const [dateLabel, entries] of Object.entries(pvpHistoryGrouped)) {
            const count      = entries.length;
            const actionText = lang === 'ru'
                ? `${count} ${_pvpPlural(count)}`
                : `${count} ${count !== 1 ? _pvpT('pvp_hist_game_many') : _pvpT('pvp_hist_game_one')}`;

            html += `
                <div class="sticky top-[-5px] z-20 flex items-center justify-between bg-[#0f172a]/80 backdrop-blur-xl py-2.5 px-3 mt-5 mb-3 first:mt-0 rounded-xl border border-rose-500/15 shadow-lg">
                    <div class="flex items-center gap-3">
                        <div class="w-1.5 h-4 bg-gradient-to-b from-rose-400 to-fuchsia-500 rounded-full shadow-[0_0_10px_rgba(244,63,94,0.6)]"></div>
                        <span class="text-sm font-bold text-white/90 capitalize tracking-wide drop-shadow-md">${dateLabel}</span>
                    </div>
                    <div class="flex items-center gap-1.5 bg-rose-500/8 text-rose-300/70 px-2.5 py-1 rounded-full border border-rose-500/15 shadow-inner">
                        <span class="text-[10px]">⚔️</span>
                        <span class="text-[10px] font-bold uppercase tracking-wider">${actionText}</span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 relative z-10">
                    ${entries.map(_buildPvpHistoryCard).join('')}
                </div>`;
        }

        list.innerHTML = html;

    } catch (e) {
        const spinner2 = document.getElementById('pvp-history-spinner');
        if (spinner2) spinner2.remove();
        if (isFirstLoad) {
            list.innerHTML = `<div class="text-center text-red-400/70 text-sm py-10">${_pvpT('pvp_hist_error')}</div>`;
        }
    }

    pvpHistoryLoading = false;
}

// ── Exports ───────────────────────────────────────────────────

window.openPvpHistoryModal = openPvpHistoryModal;
