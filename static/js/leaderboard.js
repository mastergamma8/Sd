// =====================================================
// ТАБЛИЦА ЛИДЕРОВ — три вкладки + 3D-подиум для топ-3
// =====================================================

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

let currentLeaderboardTab = 'rich';

// ─── Таймер до сброса ────────────────────────────────
let _resetCountdownInterval = null;

function startResetCountdown(resetTs) {
    const el = document.getElementById('lb-reset-countdown');
    const wrapper = document.getElementById('lb-reset-timer');
    if (!el || !wrapper) return;
    if (_resetCountdownInterval) clearInterval(_resetCountdownInterval);

    function update() {
        const now = Math.floor(Date.now() / 1000);
        const diff = resetTs - now;
        const lang = i18n[currentLang] || i18n['ru'];
        if (diff <= 0) {
            el.textContent = `0${lang.time_d} 0${lang.time_h} 0${lang.time_m}`;
            clearInterval(_resetCountdownInterval);
            return;
        }
        const d = Math.floor(diff / 86400);
        const h = Math.floor((diff % 86400) / 3600);
        const m = Math.floor((diff % 3600) / 60);
        el.textContent = d > 0
            ? `${d}${lang.time_d} ${h}${lang.time_h} ${m}${lang.time_m}`
            : `${h}${lang.time_h} ${m}${lang.time_m}`;
    }
    wrapper.classList.remove('hidden');
    update();
    _resetCountdownInterval = setInterval(update, 1000);
}

// ─── Переключение вкладок ────────────────────────────
function switchLeaderboardTab(tab) {
    currentLeaderboardTab = tab;
    document.querySelectorAll('.leaderboard-tab').forEach(btn => btn.classList.remove('active-tab'));
    const activeBtn = document.getElementById(`tab-${tab}`);
    if (activeBtn) activeBtn.classList.add('active-tab');
    loadLeaderboard();
}

// ─── Общий загрузчик ────────────────────────────────
async function loadLeaderboard() {
    const list = document.getElementById('leaderboard-list');
    const stickyRank = document.getElementById('user-sticky-rank');
    if (!list) return;
    list.innerHTML = `<div class="text-center text-blue-300/50 mt-10 animate-pulse font-bold tracking-widest uppercase">${i18n[currentLang].loading}</div>`;
    if (stickyRank) stickyRank.classList.add('hidden');
    try {
        if (currentLeaderboardTab === 'rich')    await loadRichLeaderboard(list, stickyRank);
        if (currentLeaderboardTab === 'alltime') await loadAlltimeLeaderboard(list, stickyRank);
    } catch(e) {
        list.innerHTML = `<div class="text-center text-red-400 mt-10 glass p-4 rounded-2xl">${i18n[currentLang].err_network || 'Ошибка сети'}</div>`;
    }
}

// ─── HTML-иконка приза ───────────────────────────────
function buildPrizeBadge(prize) {
    if (!prize) return '';
    const t = prize.type;
    const amount = prize.amount || 0;
    if (t === 'donuts') {
        return `<div class="flex items-center justify-center gap-1 mt-1.5 text-[11px] font-bold text-yellow-200 bg-yellow-500/20 border border-yellow-500/30 rounded-lg px-2 py-0.5">
            <img src="/gifts/dount.png" class="w-3.5 h-3.5 object-contain shrink-0">
            <span>${formatBalance(amount)}</span>
        </div>`;
    }
    if (t === 'stars') {
        return `<div class="flex items-center justify-center gap-1 mt-1.5 text-[11px] font-bold text-purple-200 bg-purple-500/20 border border-purple-500/30 rounded-lg px-2 py-0.5">
            <img src="/gifts/stars.png" class="w-3.5 h-3.5 object-contain shrink-0">
            <span>${formatBalance(amount)}</span>
        </div>`;
    }
    if ((t === 'base_gift' || t === 'tg_gift') && prize.gift_photo) {
        const name = prize.gift_name
            ? `<span class="text-white/70 text-[9px] leading-tight truncate max-w-[64px]">${escapeHtml(prize.gift_name)}</span>`
            : '';
        return `<div class="flex flex-col items-center gap-0.5 mt-1.5 bg-white/5 border border-white/10 rounded-lg px-1.5 py-1">
            <img src="${escapeHtml(prize.gift_photo)}" class="w-6 h-6 object-contain rounded-md">
            ${name}
        </div>`;
    }
    return '';
}

// ─── 3D-подиум ────────────────────────────────────────
// Порядок: 2-е (слева) | 1-е (центр, выше) | 3-е (справа)
function buildPodium(top3, prizes, myTgId) {
    const empty = { first_name: '—', photo_url: '', username: '', donuts_spent: 0, stars_spent: 0 };
    const p1 = top3[0] || empty;
    const p2 = top3[1] || empty;
    const p3 = top3[2] || empty;

    function isMe(u) {
        return u && u.tg_id != null && (
            u.tg_id == myTgId ||
            (u.username && tgUser.username && u.username === tgUser.username)
        );
    }

    function podiumSlot(user, place) {
        const me = isMe(user);
        const isAnon = me && localStorage.getItem('isAnonymous') === 'true';
        const name = isAnon ? 'Anonim' : escapeHtml(user.first_name || '—');
        const avatar = (user.photo_url && user.photo_url !== '')
            ? (isAnon ? (window.ANON_AVATAR || '') : escapeHtml(user.photo_url))
            : 'https://via.placeholder.com/80';

        const prize = prizes ? prizes[String(place)] : null;
        const lang = i18n[currentLang] || i18n['ru'];

        // Приз с лейблом «Приз сезона»
        let prizeSectionHtml = '';
        if (prize) {
            const prizeLabel = `<div class="flex items-center justify-center gap-0.5 text-[8px] font-semibold tracking-widest uppercase text-yellow-300/70 mt-1.5 mb-0.5">
                ${lang.lb_prize_season || 'Приз сезона'}
            </div>`;
            prizeSectionHtml = prizeLabel + buildPrizeBadge(prize);
        }

        const youBadge = me
            ? `<div class="text-[9px] font-bold text-blue-200 bg-blue-500/40 border border-blue-400/50 px-1.5 py-0.5 rounded-md uppercase tracking-wider mt-0.5 text-center">${lang.you || 'Вы'}</div>`
            : '';

        // Расход
        const spent = buildSpendBadgeSmall(user.donuts_spent || 0, user.stars_spent || 0);

        // Конфигурация по месту
        const cfg = {
            1: {
                avatarSize: 'w-[68px] h-[68px]',
                crown: '👑',
                ring: 'border-yellow-400',
                glow: 'bg-yellow-400',
                podiumH: 'h-20',
                podiumGrad: 'from-yellow-400 via-yellow-500 to-yellow-700',
                nameSize: 'text-[13px]',
                rankSize: 'text-2xl',
                shadow: 'shadow-[0_0_24px_rgba(234,179,8,0.5)]',
            },
            2: {
                avatarSize: 'w-14 h-14',
                crown: '🥈',
                ring: 'border-gray-300',
                glow: 'bg-gray-300',
                podiumH: 'h-14',
                podiumGrad: 'from-gray-300 via-gray-400 to-gray-600',
                nameSize: 'text-[11px]',
                rankSize: 'text-xl',
                shadow: 'shadow-[0_0_16px_rgba(209,213,219,0.4)]',
            },
            3: {
                avatarSize: 'w-12 h-12',
                crown: '🥉',
                ring: 'border-orange-400',
                glow: 'bg-orange-500',
                podiumH: 'h-10',
                podiumGrad: 'from-orange-400 via-orange-500 to-orange-700',
                nameSize: 'text-[11px]',
                rankSize: 'text-xl',
                shadow: 'shadow-[0_0_16px_rgba(249,115,22,0.4)]',
            },
        }[place];

        return `
        <div class="flex flex-col items-center select-none">
            <!-- Корона -->
            <div class="text-xl mb-0.5">${cfg.crown}</div>
            <!-- Аватар -->
            <div class="relative mb-1.5">
                <img src="${avatar}"
                     class="${cfg.avatarSize} rounded-full object-cover border-[3px] ${cfg.ring} bg-black/50 ${cfg.shadow} relative z-10"
                     onerror="this.src='https://via.placeholder.com/80'">
                <div class="absolute inset-0 rounded-full blur-lg ${cfg.glow} opacity-40 -z-0 scale-125"></div>
            </div>
            <!-- Имя -->
            <div class="max-w-[80px] text-center">
                <div class="font-bold text-white truncate ${cfg.nameSize}">${name}</div>
                ${youBadge}
            </div>
            <!-- Расходы -->
            <div class="mt-1 text-center">${spent}</div>
            <!-- Приз -->
            ${prizeSectionHtml}
            <!-- Подиум-колонна -->
            <div class="w-full mt-2 rounded-t-xl ${cfg.podiumH} bg-gradient-to-b ${cfg.podiumGrad}
                        flex items-center justify-center ${cfg.shadow}">
                <span class="font-black text-white/90 ${cfg.rankSize} drop-shadow">${place}</span>
            </div>
        </div>`;
    }

    const hasPrizes = prizes && Object.keys(prizes).length > 0;

    return `
    <div class="w-full mb-3 mt-1 px-1">
        <div class="flex items-end justify-center gap-2 sm:gap-3">
            <!-- 2-е место -->
            <div class="flex-1">${podiumSlot(p2, 2)}</div>
            <!-- 1-е место (центр, выше) -->
            <div class="flex-1">${podiumSlot(p1, 1)}</div>
            <!-- 3-е место -->
            <div class="flex-1">${podiumSlot(p3, 3)}</div>
        </div>
        ${hasPrizes
            ? `<div class="text-center text-[10px] text-white/35 mt-2.5 font-medium">
                ${(i18n[currentLang] || i18n['ru']).lb_prize_auto || 'Призы раздаются автоматически каждый понедельник'}
               </div>`
            : ''}
    </div>`;
}

// Компактный бейдж трат для строк подиума
function buildSpendBadgeSmall(donuts, stars) {
    const hasDonuts = donuts > 0;
    const hasStars  = stars  > 0;
    const lang = i18n[currentLang] || i18n['ru'];
    const label = `<div class="text-[8px] text-white/35 font-semibold tracking-widest uppercase mb-0.5">${lang.lb_spent_label || 'Потрачено'}</div>`;

    if (!hasDonuts && !hasStars) return '—';

    if (hasDonuts && hasStars) {
        return `<div class="flex flex-col items-center gap-0">
            ${label}
            <div class="flex items-center gap-0.5 whitespace-nowrap text-[10px] font-bold text-white/70">
                <span>${formatBalance(donuts)}</span>
                <img src="/gifts/dount.png" class="w-3 h-3 object-contain shrink-0">
            </div>
            <div class="flex items-center gap-0.5 whitespace-nowrap text-[10px] font-bold text-white/70">
                <span>${formatBalance(stars)}</span>
                <img src="/gifts/stars.png" class="w-3 h-3 object-contain shrink-0">
            </div>
        </div>`;
    }
    if (hasDonuts) {
        return `<div class="flex flex-col items-center gap-0">
            ${label}
            <div class="flex items-center gap-0.5 whitespace-nowrap text-[10px] font-bold text-white/70">
                <span>${formatBalance(donuts)}</span>
                <img src="/gifts/dount.png" class="w-3 h-3 object-contain shrink-0">
            </div>
        </div>`;
    }
    return `<div class="flex flex-col items-center gap-0">
        ${label}
        <div class="flex items-center gap-0.5 whitespace-nowrap text-[10px] font-bold text-white/70">
            <span>${formatBalance(stars)}</span>
            <img src="/gifts/stars.png" class="w-3 h-3 object-contain shrink-0">
        </div>
    </div>`;
}

// ─── Стили для карточек 4-50 мест ───────────────────
function getRankStyle(index) {
    if (index === 0) return {
        card: 'border-yellow-400/50 bg-gradient-to-r from-yellow-500/30 via-yellow-500/10 to-transparent shadow-[0_0_20px_rgba(234,179,8,0.15)]',
        accent: '<div class="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-yellow-300 to-yellow-600 shadow-[0_0_15px_rgba(234,179,8,1)]"></div>',
        text: 'text-transparent bg-clip-text bg-gradient-to-b from-yellow-100 via-yellow-400 to-yellow-600 drop-shadow-[0_0_12px_rgba(234,179,8,0.8)]',
        avatarBorder: 'border-yellow-400', glowColor: 'bg-yellow-500', rankNum: '1'
    };
    if (index === 1) return {
        card: 'border-gray-300/50 bg-gradient-to-r from-gray-400/30 via-gray-400/10 to-transparent shadow-[0_0_20px_rgba(209,213,219,0.15)]',
        accent: '<div class="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-gray-100 to-gray-400 shadow-[0_0_15px_rgba(209,213,219,1)]"></div>',
        text: 'text-transparent bg-clip-text bg-gradient-to-b from-white via-gray-300 to-gray-500 drop-shadow-[0_0_12px_rgba(209,213,219,0.8)]',
        avatarBorder: 'border-gray-300', glowColor: 'bg-gray-300', rankNum: '2'
    };
    if (index === 2) return {
        card: 'border-orange-500/50 bg-gradient-to-r from-orange-500/30 via-orange-500/10 to-transparent shadow-[0_0_20px_rgba(249,115,22,0.15)]',
        accent: '<div class="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-orange-300 to-orange-600 shadow-[0_0_15px_rgba(249,115,22,1)]"></div>',
        text: 'text-transparent bg-clip-text bg-gradient-to-b from-orange-100 via-orange-400 to-orange-600 drop-shadow-[0_0_12px_rgba(249,115,22,0.8)]',
        avatarBorder: 'border-orange-400', glowColor: 'bg-orange-500', rankNum: '3'
    };
    return {
        card: '', accent: '',
        text: 'text-white/50 font-medium',
        avatarBorder: 'border-white/10', glowColor: '',
        rankNum: (index + 1).toString()
    };
}

function buildCard(u, index, isMe, valueBadge) {
    const s = getRankStyle(index);
    const isAnonymous = isMe && localStorage.getItem('isAnonymous') === 'true';
    const displayName = isAnonymous ? 'Anonim' : (u.first_name || 'Без имени');
    const avatar = isAnonymous ? (window.ANON_AVATAR || '') : escapeHtml(u.photo_url || 'https://via.placeholder.com/40');
    const cardClass = s.card || (isMe ? 'border-blue-400/60 bg-gradient-to-r from-blue-600/20 to-transparent shadow-[0_0_15px_rgba(59,130,246,0.15)]' : 'border-white/5 bg-black/30');
    const accentLine = s.accent || (isMe ? '<div class="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-blue-300 to-blue-600 shadow-[0_0_10px_rgba(96,165,250,0.8)]"></div>' : '');
    const avatarBorder = isMe && index > 2 ? 'border-blue-400' : s.avatarBorder;
    const activeGlowColor = isMe && index > 2 ? 'bg-blue-500' : s.glowColor;
    let rankDisplay;
    if (index < 3) {
        rankDisplay = `<div class="w-8 sm:w-10 shrink-0 text-center text-2xl sm:text-3xl font-black italic tracking-tighter ${s.text} pr-1 sm:pr-2">${s.rankNum}</div>`;
    } else {
        rankDisplay = `<div class="w-8 sm:w-10 shrink-0 text-center text-base sm:text-lg ${s.text} pr-1 sm:pr-2">${s.rankNum}</div>`;
    }
    const badgeClass = isMe ? 'bg-blue-500/30 border-blue-400/50 text-blue-100' : 'bg-black/30 border-white/5 text-blue-300';
    return `
        <div class="glass rounded-2xl p-2.5 sm:p-3 flex items-center justify-between relative overflow-hidden border ${cardClass} transition-all duration-300 hover:scale-[1.02] gap-2">
            ${accentLine}
            <div class="flex items-center gap-1.5 sm:gap-2 pl-1 sm:pl-2 flex-1 min-w-0">
                ${rankDisplay}
                <div class="relative shrink-0">
                    <img src="${avatar}" class="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border-2 ${avatarBorder} shadow-lg relative z-10 bg-black/50 shrink-0">
                    ${activeGlowColor ? `<div class="absolute inset-0 rounded-full blur-md ${activeGlowColor} opacity-50 z-0 scale-110"></div>` : ''}
                </div>
                <div class="font-bold text-white text-[14px] sm:text-[15px] ml-1.5 sm:ml-2 flex flex-col justify-center flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="truncate">${escapeHtml(displayName)}</span>
                        ${isMe ? `<span class="shrink-0 text-[10px] leading-none text-blue-200 bg-blue-500/40 border border-blue-400/50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">${i18n[currentLang].you || 'Вы'}</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="${badgeClass} border font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl shadow-inner flex flex-wrap justify-end items-center gap-x-1 gap-y-0.5 text-xs sm:text-sm backdrop-blur-md shrink-0 max-w-[45%] sm:max-w-none text-right">
                ${valueBadge}
            </div>
        </div>`;
}

function buildStickyRankHTML(rankText, avatar, name, badgeHtml, badgeTextColorClass) {
    const safeAvatar = escapeHtml(avatar || 'https://via.placeholder.com/40');
    const safeName   = escapeHtml(name   || 'Вы');
    return `
        <div class="glass rounded-2xl p-2.5 sm:p-3 flex items-center justify-between relative overflow-hidden border-blue-400/60 bg-gradient-to-r from-blue-600/30 via-blue-500/10 to-black/40 shadow-[0_0_25px_rgba(59,130,246,0.4)] backdrop-blur-3xl gap-2">
            <div class="absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b from-blue-300 to-blue-600 shadow-[0_0_15px_rgba(96,165,250,1)]"></div>
            <div class="flex items-center gap-1.5 sm:gap-2 pl-1 sm:pl-2 flex-1 min-w-0">
                <div class="w-8 sm:w-10 shrink-0 text-center text-lg sm:text-xl font-black italic tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-blue-100 to-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.8)] pr-1 sm:pr-2">${rankText}</div>
                <div class="relative shrink-0">
                    <img src="${safeAvatar}" class="w-10 h-10 sm:w-12 sm:h-12 rounded-full object-cover border-2 border-blue-400 shadow-lg relative z-10 bg-black/50 shrink-0">
                    <div class="absolute inset-0 rounded-full blur-md bg-blue-500 opacity-60 z-0 scale-110"></div>
                </div>
                <div class="font-bold text-white text-[14px] sm:text-[15px] ml-1.5 sm:ml-2 flex flex-col justify-center flex-1 min-w-0">
                    <div class="flex items-center gap-1.5 min-w-0">
                        <span class="truncate">${safeName}</span>
                        <span class="shrink-0 text-[10px] leading-none text-blue-200 bg-blue-500/40 border border-blue-400/50 px-1.5 py-0.5 rounded-md uppercase tracking-wider">${i18n[currentLang].you || 'Вы'}</span>
                    </div>
                </div>
            </div>
            <div class="bg-black/40 border border-blue-400/50 ${badgeTextColorClass} font-bold px-2 py-1 sm:px-3 sm:py-1.5 rounded-xl shadow-inner flex flex-wrap justify-end items-center gap-x-1 gap-y-0.5 text-xs sm:text-sm backdrop-blur-md shrink-0 max-w-[45%] sm:max-w-none text-right">
                ${badgeHtml}
            </div>
        </div>`;
}

// ─── Транжиры ─────────────────────────────────────────
async function loadRichLeaderboard(list, stickyRank) {
    const res = await fetch(`/api/leaderboard`, { headers: getApiHeaders() });
    const data = await res.json();
    list.innerHTML = '';

    if (data.reset_ts) startResetCountdown(data.reset_ts);

    if (!data.leaderboard || data.leaderboard.length === 0) {
        list.innerHTML = `<div class="text-center text-white/40 mt-12 text-sm">${i18n[currentLang].lb_empty_spender || 'Пока никто ничего не потратил на этой неделе 💸'}</div>`;
        if (stickyRank) stickyRank.classList.add('hidden');
        return;
    }

    const myTgId = tgUser.id;
    const prizes = data.prizes || null;

    // 3D-подиум
    list.innerHTML = buildPodium(data.leaderboard.slice(0, 3), prizes, myTgId);

    // Разделитель
    list.innerHTML += `<div class="flex items-center gap-2 my-2 px-1">
        <div class="flex-1 h-px bg-white/10"></div>
        <span class="text-white/25 text-[10px] font-semibold tracking-widest uppercase shrink-0">${(i18n[currentLang] || i18n['ru']).lb_others_label || 'Остальные участники'}</span>
        <div class="flex-1 h-px bg-white/10"></div>
    </div>`;

    // Карточки 4+
    let currentUserRankData = null;
    data.leaderboard.forEach((u, index) => {
        const isMe = (u.tg_id == myTgId || (u.username && tgUser.username && u.username === tgUser.username));
        if (isMe) currentUserRankData = { rank: index + 1, donuts_spent: u.donuts_spent, stars_spent: u.stars_spent };
        if (index < 3) return;
        list.innerHTML += buildCard(u, index, isMe, buildSpendBadge(u.donuts_spent || 0, u.stars_spent || 0));
    });

    if (!currentUserRankData && data.user_info) currentUserRankData = data.user_info;

    const rankText    = currentUserRankData?.rank ?? '—';
    const donutsSpent = currentUserRankData?.donuts_spent ?? 0;
    const starsSpent  = currentUserRankData?.stars_spent  ?? 0;
    const myAvatar    = localStorage.getItem('isAnonymous') === 'true' ? (window.ANON_AVATAR || '') : escapeHtml(tgUser.photo_url || 'https://via.placeholder.com/40');
    const myName      = localStorage.getItem('isAnonymous') === 'true' ? 'Anonim' : escapeHtml(tgUser.first_name || 'Вы');

    if (stickyRank) {
        stickyRank.innerHTML = buildStickyRankHTML(rankText, myAvatar, myName, buildSpendBadge(donutsSpent, starsSpent), 'text-purple-200');
        stickyRank.classList.remove('hidden');
    }
}

function buildSpendBadge(donutsSpent, starsSpent) {
    const hasDonuts = donutsSpent > 0;
    const hasStars  = starsSpent  > 0;

    if (!hasDonuts && !hasStars) {
        return `<div class="flex items-center gap-1 whitespace-nowrap">0 <img src="/gifts/dount.png" class="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain shrink-0"></div>`;
    }
    if (hasDonuts && hasStars) {
        return `<div class="flex flex-col items-end gap-0.5">
            <div class="flex items-center gap-1 whitespace-nowrap">${formatBalance(donutsSpent)} <img src="/gifts/dount.png" class="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain shrink-0"></div>
            <div class="flex items-center gap-1 whitespace-nowrap">${formatBalance(starsSpent)} <img src="/gifts/stars.png" class="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain shrink-0"></div>
        </div>`;
    }
    if (hasDonuts) {
        return `<div class="flex items-center gap-1 whitespace-nowrap">${formatBalance(donutsSpent)} <img src="/gifts/dount.png" class="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain shrink-0"></div>`;
    }
    return `<div class="flex items-center gap-1 whitespace-nowrap">${formatBalance(starsSpent)} <img src="/gifts/stars.png" class="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain shrink-0"></div>`;
}

// ─── За всё время ────────────────────────────────────
async function loadAlltimeLeaderboard(list, stickyRank) {
    const res = await fetch(`/api/leaderboard/alltime`, { headers: getApiHeaders() });
    const data = await res.json();
    list.innerHTML = '';

    const timerWrapper = document.getElementById('lb-reset-timer');
    if (timerWrapper) timerWrapper.classList.add('hidden');
    if (_resetCountdownInterval) { clearInterval(_resetCountdownInterval); _resetCountdownInterval = null; }

    if (!data.leaderboard || data.leaderboard.length === 0) {
        list.innerHTML = `<div class="text-center text-white/40 mt-12 text-sm">${i18n[currentLang].lb_empty_alltime || 'Пока никто ничего не потратил 🏆'}</div>`;
        if (stickyRank) stickyRank.classList.add('hidden');
        return;
    }

    const myTgId = tgUser.id;

    // Для «за всё время» призов нет
    list.innerHTML = buildPodium(data.leaderboard.slice(0, 3), null, myTgId);

    list.innerHTML += `<div class="flex items-center gap-2 my-2 px-1">
        <div class="flex-1 h-px bg-white/10"></div>
        <span class="text-white/25 text-[10px] font-semibold tracking-widest uppercase shrink-0">${(i18n[currentLang] || i18n['ru']).lb_others_label || 'Остальные участники'}</span>
        <div class="flex-1 h-px bg-white/10"></div>
    </div>`;

    let currentUserRankData = null;
    data.leaderboard.forEach((u, index) => {
        const isMe = (u.tg_id == myTgId || (u.username && tgUser.username && u.username === tgUser.username));
        if (isMe) currentUserRankData = { rank: index + 1, donuts_spent: u.donuts_spent, stars_spent: u.stars_spent };
        if (index < 3) return;
        list.innerHTML += buildCard(u, index, isMe, buildSpendBadge(u.donuts_spent || 0, u.stars_spent || 0));
    });

    if (!currentUserRankData && data.user_info) currentUserRankData = data.user_info;

    const rankText    = currentUserRankData?.rank ?? '—';
    const donutsSpent = currentUserRankData?.donuts_spent ?? 0;
    const starsSpent  = currentUserRankData?.stars_spent  ?? 0;
    const myAvatar    = localStorage.getItem('isAnonymous') === 'true' ? (window.ANON_AVATAR || '') : escapeHtml(tgUser.photo_url || 'https://via.placeholder.com/40');
    const myName      = localStorage.getItem('isAnonymous') === 'true' ? 'Anonim' : escapeHtml(tgUser.first_name || 'Вы');

    if (stickyRank) {
        stickyRank.innerHTML = buildStickyRankHTML(rankText, myAvatar, myName, buildSpendBadge(donutsSpent, starsSpent), 'text-yellow-200');
        stickyRank.classList.remove('hidden');
    }
}

window.loadLeaderboard = loadLeaderboard;
window.switchLeaderboardTab = switchLeaderboardTab;
