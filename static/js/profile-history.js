// =====================================================
// profile-history.js
// Transaction history: metadata, loading, and rendering.
// Depends on: profile-core.js
// =====================================================

// ── Event metadata ────────────────────────────────────────────────────────────

/**
 * Maps every action_type to a display icon, colour bucket, and amount sign.
 * colour: 'green' | 'red' | 'amber' | 'purple' | 'gray'
 * sign:   '+' | '-' | null (null = no amount badge, e.g. gift events)
 */
const HISTORY_ICONS = {
    // ── Top-ups & admin ──────────────────────────────────────────────────────
    topup_stars:          { icon: '⭐', color: 'green',  sign: '+' },
    admin_add_stars:      { icon: '⭐', color: 'green',  sign: '+' },

    // ── Gifts (admin / system) ───────────────────────────────────────────────
    gift_added:           { icon: '🎁', color: 'green',  sign: '+' },

    // ── TG Shop purchase ─────────────────────────────────────────────────────
    tg_shop_buy:          { icon: '🛒', color: 'red',    sign: '-' },

    // ── Roulette ─────────────────────────────────────────────────────────────
    roulette_win_donuts:  { icon: '🎰', color: 'green',  sign: '+' },
    roulette_win_stars:   { icon: '🎰', color: 'green',  sign: '+' },
    roulette_win_gift:    { icon: '🎁', color: 'green',  sign: null },
    roulette_win_tg_gift: { icon: '🎁', color: 'green',  sign: null },
    roulette_paid_donuts: { icon: '🎰', color: 'red',    sign: '-' },
    roulette_paid_stars:  { icon: '🎰', color: 'red',    sign: '-' },
    roulette_paid:        { icon: '🎰', color: 'red',    sign: '-' },

    // ── Cases ────────────────────────────────────────────────────────────────
    case_win_donuts:      { icon: '📦', color: 'green',  sign: '+' },
    case_win_stars:       { icon: '📦', color: 'green',  sign: '+' },
    case_win_gift:        { icon: '🎁', color: 'green',  sign: null },
    case_win_tg_gift:     { icon: '🎁', color: 'green',  sign: null },
    case_paid_donuts:     { icon: '📦', color: 'red',    sign: '-' },
    case_paid_stars:      { icon: '📦', color: 'red',    sign: '-' },
    case_free_open:       { icon: '🎁', color: 'green',  sign: null },
    case_promo_open:      { icon: '📦', color: 'green',  sign: null },

    // ── Rocket ───────────────────────────────────────────────────────────────
    rocket_win_donuts:    { icon: '🚀', color: 'green',  sign: '+' },
    rocket_win_stars:     { icon: '🚀', color: 'green',  sign: '+' },
    rocket_lose_donuts:   { icon: '💥', color: 'red',    sign: '-' },
    rocket_lose_stars:    { icon: '💥', color: 'red',    sign: '-' },

    // ── Space PvP ────────────────────────────────────────────────────────────
    pvp_bet_stars:        { icon: '⚔️', color: 'red',    sign: '-' },
    pvp_bet_donuts:       { icon: '⚔️', color: 'red',    sign: '-' },
    pvp_bet_gift:         { icon: '⚔️', color: 'red',    sign: null },
    pvp_win_stars:        { icon: '🏆', color: 'green',  sign: '+' },
    pvp_win_donuts:       { icon: '🏆', color: 'green',  sign: '+' },
    pvp_win_gift:         { icon: '🏆', color: 'green',  sign: null },
    pvp_refund_stars:     { icon: '↩️', color: 'amber',  sign: '+' },
    pvp_refund_donuts:    { icon: '↩️', color: 'amber',  sign: '+' },
    pvp_refund_gift:      { icon: '↩️', color: 'amber',  sign: null },

    // ── Promo codes ───────────────────────────────────────────────────────────
    promo_donuts:         { icon: '🎟️', color: 'green',  sign: '+' },
    promo_stars:          { icon: '🎟️', color: 'green',  sign: '+' },

    // ── Withdraw / exchange ───────────────────────────────────────────────────
    claim_gift:           { icon: '🛍️', color: 'red',    sign: '-' },
    withdraw_gift:        { icon: '📤', color: 'gray',   sign: null },
    withdraw_tg_gift:     { icon: '📤', color: 'gray',   sign: null },
    exchange_tg_gift:     { icon: '🔁', color: 'amber',  sign: '+' },
    exchange_gift_donuts: { icon: '🍩', color: 'green',  sign: '+' },
    exchange_gift_stars:  { icon: '⭐', color: 'amber',  sign: '+' },

    // ── Tasks & referrals ────────────────────────────────────────────────────
    task_reward:          { icon: '✅', color: 'green',  sign: '+' },
    task_reward_stars:    { icon: '✅', color: 'green',  sign: '+' },
    referral_bonus:       { icon: '👥', color: 'green',  sign: '+' },
    referral_bonus_stars: { icon: '👥', color: 'green',  sign: '+' },

    // ── Shop purchases ───────────────────────────────────────────────────────
    shop_buy_stars:        { icon: '🛍️', color: 'green',  sign: '+' },
    shop_buy_donuts:       { icon: '🛍️', color: 'green',  sign: '+' },
    shop_buy_gift:         { icon: '🎁', color: 'purple', sign: null },

    // ── Season leaderboard prizes ────────────────────────────────────────────
    season_prize_donuts:   { icon: '🏆', color: 'amber',  sign: '+' },
    season_prize_stars:    { icon: '🏆', color: 'amber',  sign: '+' },
    season_prize_gift:     { icon: '🏆', color: 'amber',  sign: null },
    season_prize_tg_gift:  { icon: '🏆', color: 'amber',  sign: null },
};

/** Action types that are internal / should never surface in the UI. */
const HISTORY_HIDDEN_TYPES = new Set(['case_lucky_ratio', 'rocket_win_fake']);

/** Action types denominated in stars (uses star icon). */
const STAR_AMOUNT_TYPES = new Set([
    'topup_stars', 'admin_add_stars',
    'roulette_win_stars', 'roulette_paid_stars',
    'case_win_stars', 'case_paid_stars',
    'rocket_win_stars', 'rocket_lose_stars', 'promo_stars',
    'exchange_tg_gift', 'exchange_gift_stars',
    'task_reward_stars', 'referral_bonus_stars',
    'tg_shop_buy',
    // PvP — star-denominated bets, wins and refunds
    'pvp_bet_stars', 'pvp_win_stars', 'pvp_refund_stars',
    // Shop
    'shop_buy_stars',
    // Season prizes
    'season_prize_stars',
]);

// ── Localised labels ──────────────────────────────────────────────────────────

const HISTORY_LABELS = {
    ru: {
        topup_stars:          'Пополнение баланса',
        admin_add_stars:      'Начисление звёзд администратором',
        gift_added:           'Получен подарок',
        tg_shop_buy:          'Покупка лимитированного подарка',
        roulette_win_donuts:  'Выигрыш в рулетке',
        roulette_win_stars:   'Выигрыш в рулетке',
        roulette_win_gift:    'Выигрыш NFT-подарка в рулетке',
        roulette_win_tg_gift: 'Выигрыш Telegram-подарка в рулетке',
        roulette_paid_donuts: 'Ставка в рулетке',
        roulette_paid_stars:  'Ставка в рулетке',
        roulette_paid:        'Ставка в рулетке',
        case_win_donuts:      'Выигрыш из кейса',
        case_win_stars:       'Выигрыш из кейса',
        case_win_gift:        'Выигрыш NFT-подарка из кейса',
        case_win_tg_gift:     'Выигрыш Telegram-подарка из кейса',
        case_paid_donuts:     'Открытие кейса',
        case_paid_stars:      'Открытие кейса',
        case_free_open:       'Бесплатный кейс',
        case_promo_open:      'Промо-кейс',
        rocket_win_donuts:    'Выигрыш в ракете',
        rocket_win_stars:     'Выигрыш в ракете',
        rocket_lose_donuts:   'Проигрыш в ракете',
        rocket_lose_stars:    'Проигрыш в ракете',

        pvp_bet_stars:        'Ставка в Space PvP',
        pvp_bet_donuts:       'Ставка в Space PvP',
        pvp_bet_gift:         'Подарок в Space PvP',
        pvp_win_stars:        'Победа в Space PvP',
        pvp_win_donuts:       'Победа в Space PvP',
        pvp_win_gift:         'Победа в Space PvP — подарок',
        pvp_refund_stars:     'Возврат ставки PvP — звёзды',
        pvp_refund_donuts:    'Возврат ставки PvP — пончики',
        pvp_refund_gift:      'Возврат подарка PvP',

        promo_donuts:         'Промокод — пончики',
        promo_stars:          'Промокод — звёзды',
        claim_gift:           'Получение NFT-подарка',
        withdraw_gift:        'Вывод NFT-подарка',
        withdraw_tg_gift:     'Вывод Telegram-подарка',
        exchange_tg_gift:     'Обмен Telegram-подарка',
        exchange_gift_donuts: 'Обмен NFT-подарка на пончики',
        exchange_gift_stars:  'Обмен NFT-подарка на звёзды',
        task_reward:          'Награда за задание',
        task_reward_stars:    'Награда за задание',
        referral_bonus:       'Реферальный бонус',
        referral_bonus_stars: 'Реферальный бонус ⭐',
        shop_buy_stars:       'Покупка в магазине',
        shop_buy_donuts:      'Покупка в магазине',
        shop_buy_gift:        'Покупка подарка в магазине',
        season_prize_donuts:  'Приз сезонного лидерборда',
        season_prize_stars:   'Приз сезонного лидерборда',
        season_prize_gift:    'Приз сезонного лидерборда',
        season_prize_tg_gift: 'Приз сезонного лидерборда',
    },
    en: {
        topup_stars:          'Balance top-up',
        admin_add_stars:      'Stars granted by admin',
        gift_added:           'Gift received',
        tg_shop_buy:          'Limited gift purchase',
        roulette_win_donuts:  'Roulette win',
        roulette_win_stars:   'Roulette win',
        roulette_win_gift:    'NFT gift won in roulette',
        roulette_win_tg_gift: 'Telegram gift won in roulette',
        roulette_paid_donuts: 'Roulette bet',
        roulette_paid_stars:  'Roulette bet',
        roulette_paid:        'Roulette bet',
        case_win_donuts:      'Case win',
        case_win_stars:       'Case win',
        case_win_gift:        'NFT gift won from case',
        case_win_tg_gift:     'Telegram gift won from case',
        case_paid_donuts:     'Case opened',
        case_paid_stars:      'Case opened',
        case_free_open:       'Free case',
        case_promo_open:      'Promo case',
        rocket_win_donuts:    'Rocket win',
        rocket_win_stars:     'Rocket win',
        rocket_lose_donuts:   'Rocket loss',
        rocket_lose_stars:    'Rocket loss',

        pvp_bet_stars:        'Space PvP bet',
        pvp_bet_donuts:       'Space PvP bet',
        pvp_bet_gift:         'Space PvP gift bet',
        pvp_win_stars:        'Space PvP win',
        pvp_win_donuts:       'Space PvP win',
        pvp_win_gift:         'Space PvP win — gift',
        pvp_refund_stars:     'PvP bet refunded — stars',
        pvp_refund_donuts:    'PvP bet refunded — donuts',
        pvp_refund_gift:      'PvP gift refunded',

        promo_donuts:         'Promo code — donuts',
        promo_stars:          'Promo code — stars',
        claim_gift:           'NFT gift claimed',
        withdraw_gift:        'NFT Gift withdrawn',
        withdraw_tg_gift:     'Telegram gift withdrawn',
        exchange_tg_gift:     'Telegram gift exchanged',
        exchange_gift_donuts: 'NFT gift exchanged for donuts',
        exchange_gift_stars:  'NFT gift exchanged for stars',
        task_reward:          'Task reward',
        task_reward_stars:    'Task reward',
        referral_bonus:       'Referral bonus',
        referral_bonus_stars: 'Referral bonus ⭐',
        shop_buy_stars:       'Shop purchase',
        shop_buy_donuts:      'Shop purchase',
        shop_buy_gift:        'Gift purchase in shop',
        season_prize_donuts:  'Season leaderboard prize',
        season_prize_stars:   'Season leaderboard prize',
        season_prize_gift:    'Season leaderboard prize',
        season_prize_tg_gift: 'Season leaderboard prize',
    }
};

// ── Date formatting ───────────────────────────────────────────────────────────

function formatHistoryDate(ts) {
    const d   = new Date(ts * 1000);
    const pad = n => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Gift photo resolution ─────────────────────────────────────────────────────

/**
 * Returns the photo URL to display as the icon for a history entry, or null
 * if the default emoji icon should be used instead.
 */
function getHistoryGiftPhoto(entry) {
    // Free case always shows the free-case image
    if (entry.action_type === 'case_free_open') return '/gifts/freecase.png';

    // TG Shop purchase — show the gift's photo, resolved from description tag
    if (entry.action_type === 'tg_shop_buy') {
        if (!entry.description) return null;
        const m = entry.description.match(/\[gift_id:([^\]]+)\]/);
        if (!m) return null;
        const gid  = Number(m[1]);
        const def  = (tgGifts && tgGifts[gid]) ? tgGifts[gid] : null;
        return def ? def.photo : null;
    }

    // Shop gift purchase — resolve icon from [gift_id:...] tag
    // Supports both base_gift (baseGifts, ID 1–114) and limited_gift (tgGifts, ID 2011+)
    if (entry.action_type === 'shop_buy_gift' && entry.description) {
        const m = entry.description.match(/\[gift_id:([^\]]+)\]/);
        if (m) {
            const giftDef = getGiftDefinitionById(Number(m[1])) || getGiftDefinitionById(m[1]);
            if (giftDef && giftDef.photo) return giftDef.photo;
        }
        return null;
    }

    // Admin star grant — use the stars icon asset
    if (entry.action_type === 'admin_add_stars') return '/gifts/stars.png';

    // Season leaderboard prizes — resolve icon by prize type
    if (entry.action_type === 'season_prize_donuts') return '/gifts/dount.png';
    if (entry.action_type === 'season_prize_stars')  return '/gifts/stars.png';
    if ((entry.action_type === 'season_prize_gift' || entry.action_type === 'season_prize_tg_gift') && entry.description) {
        const m = entry.description.match(/\[gift_id:([^\]]+)\]/);
        if (m) {
            const giftDef = getGiftDefinitionById(m[1]);
            if (giftDef && giftDef.photo) return giftDef.photo;
        }
    }

    // PvP general events (non-gift) — use pvp.png banner image
    const pvpBannerTypes = new Set(['pvp_bet_stars', 'pvp_bet_donuts', 'pvp_win_stars', 'pvp_win_donuts',
                                    'pvp_refund_stars', 'pvp_refund_donuts']);
    if (pvpBannerTypes.has(entry.action_type)) return '/gifts/pvp.png';

    // PvP gift events — resolve the actual gift photo via [gift_id:...] tag
    const pvpGiftTypes = new Set(['pvp_bet_gift', 'pvp_win_gift', 'pvp_refund_gift']);
    if (pvpGiftTypes.has(entry.action_type) && entry.description) {
        const pvpMatch = entry.description.match(/\[gift_id:([^\]]+)\]/);
        if (pvpMatch) {
            const giftDef = getGiftDefinitionById(pvpMatch[1]);
            if (giftDef) return giftDef.photo;
        }
        return '/gifts/pvp.png';
    }

    // Case entries that show the case artwork (not the won prize)
    const caseAssetTypes = new Set([
        'case_win_donuts', 'case_win_stars',
        'case_paid_donuts', 'case_paid_stars',
        'case_promo_open',
    ]);
    if (caseAssetTypes.has(entry.action_type) && entry.description) {
        const caseMatch = entry.description.match(/\[case_id:([^\]]+)\]/);
        if (caseMatch) {
            const cid = caseMatch[1];
            if (cid === 'free') return '/gifts/freecase.png';
            if (casesConfig && casesConfig[cid] && casesConfig[cid].photo) {
                return casesConfig[cid].photo;
            }
        }
    }

    // Gift-related entries — resolve gift photo by [gift_id:...] tag
    const giftTypes = new Set([
        'gift_added', 'claim_gift', 'withdraw_gift', 'withdraw_tg_gift',
        'exchange_tg_gift', 'roulette_win_gift', 'roulette_win_tg_gift',
        'case_win_gift', 'case_win_tg_gift', 'exchange_gift_donuts', 'exchange_gift_stars',
    ]);
    if (!giftTypes.has(entry.action_type) || !entry.description) return null;

    const match   = entry.description.match(/\[gift_id:([^\]]+)\]/);
    if (!match) return null;
    const giftDef = getGiftDefinitionById(match[1]);
    return giftDef ? giftDef.photo : null;
}

// ── Amount rendering ──────────────────────────────────────────────────────────

/**
 * Builds the amount badge HTML for a single history entry.
 */
function _buildAmountHtml(entry, meta) {
    const useStars    = STAR_AMOUNT_TYPES.has(entry.action_type);
    const currencyUrl = useStars ? '/gifts/stars.png' : '/gifts/dount.png';
    const rawAbs      = Math.abs(entry.amount);
    // For donut-denominated amounts use formatBalance so fractions render correctly
    const absAmount   = useStars ? rawAbs : formatBalance(rawAbs);

    if (entry.action_type === 'tg_shop_buy') {
        // Always show as negative stars, regardless of stored sign
        return `<span class="text-red-400 font-extrabold text-base flex items-center gap-1">
                    -${rawAbs}
                    <img src="/gifts/stars.png" class="w-4 h-4 object-contain">
                </span>`;
    }

    if (meta.sign === '+' && entry.amount > 0) {
        return `<span class="text-green-400 font-extrabold text-base flex items-center gap-1">
                    +${absAmount}
                    <img src="${currencyUrl}" class="w-4 h-4 object-contain">
                </span>`;
    }

    if (meta.sign === '-' && entry.amount !== 0) {
        return `<span class="text-red-400 font-extrabold text-base flex items-center gap-1">
                    -${absAmount}
                    <img src="${currencyUrl}" class="w-4 h-4 object-contain">
                </span>`;
    }

    return `<span class="text-gray-400 font-bold text-sm">—</span>`;
}

// ── Title resolution ──────────────────────────────────────────────────────────

/**
 * Returns the localised display title for a history entry.
 * For case entries the case name is injected when available.
 * For tg_shop_buy the gift name is shown when available.
 */
function _buildEntryTitle(entry) {
    const labels = HISTORY_LABELS[currentLang] || HISTORY_LABELS['ru'];
    let title    = labels[entry.action_type] || entry.action_type;

    // Shop purchases — extract bilingual item title from structured description
    const shopBuyTypes = new Set(['shop_buy_stars', 'shop_buy_donuts', 'shop_buy_gift']);
    if (shopBuyTypes.has(entry.action_type) && entry.description) {
        const key  = currentLang === 'en' ? 'title_en' : 'title_ru';
        const m    = entry.description.match(new RegExp(`\\[${key}:([^\\]]+)\\]`));
        if (m && m[1]) {
            const prefix = currentLang === 'ru' ? 'Магазин: ' : 'Shop: ';
            return prefix + m[1];
        }
    }

    // TG Shop purchase — append gift name if resolvable
    if (entry.action_type === 'tg_shop_buy' && entry.description) {
        const m = entry.description.match(/\[gift_id:([^\]]+)\]/);
        if (m) {
            const gid = Number(m[1]);
            const def = (tgGifts && tgGifts[gid]) ? tgGifts[gid] : null;
            if (def && def.name) {
                title = currentLang === 'ru'
                    ? `Покупка: ${def.name}`
                    : `Purchase: ${def.name}`;
            }
        }
        return title;
    }

    // Case entries — inject case name
    const caseActionTypes = new Set([
        'case_win_donuts', 'case_win_stars',
        'case_paid_donuts', 'case_paid_stars', 'case_free_open',
        'case_promo_open',
    ]);
    if (caseActionTypes.has(entry.action_type) && entry.description) {
        const nameMatch = entry.description.match(/Case '([^']+)'/);
        if (nameMatch) {
            const caseName = nameMatch[1];
            const isWin    = entry.action_type.startsWith('case_win');
            const isFree   = entry.action_type === 'case_free_open';
            const isPromo  = entry.action_type === 'case_promo_open';
            if (isFree) {
                title = currentLang === 'ru' ? 'Бесплатный кейс' : 'Free case';
            } else if (isPromo) {
                title = currentLang === 'ru' ? `Промо-кейс: ${caseName}` : `Promo case: ${caseName}`;
            } else if (isWin) {
                title = currentLang === 'ru' ? `Выигрыш: ${caseName}` : `Win: ${caseName}`;
            } else {
                title = currentLang === 'ru' ? `Кейс: ${caseName}` : `Case: ${caseName}`;
            }
        }
    }

    // Season leaderboard prizes — append place badge from [place:N] tag
    const seasonPrizeTypes = new Set([
        'season_prize_donuts', 'season_prize_stars',
        'season_prize_gift',   'season_prize_tg_gift',
    ]);
    if (seasonPrizeTypes.has(entry.action_type) && entry.description) {
        const placeMatch = entry.description.match(/\[place:(\d+)\]/);
        if (placeMatch) {
            const place = parseInt(placeMatch[1], 10);
            const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
            const medal  = medals[place] || '🏆';
            const placeName = currentLang === 'ru'
                ? `${place}-е место`
                : `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : 'rd'} place`;
            return `${medal} ${title} — ${placeName}`;
        }
    }

    // PvP entries — append round number and player count from description
    const pvpTypes = new Set([
        'pvp_bet_stars', 'pvp_bet_donuts', 'pvp_bet_gift',
        'pvp_win_stars', 'pvp_win_donuts', 'pvp_win_gift',
        'pvp_refund_stars', 'pvp_refund_donuts', 'pvp_refund_gift',
    ]);
    if (pvpTypes.has(entry.action_type) && entry.description) {
        const roundMatch   = entry.description.match(/раунд #(\d+)/);
        const playersMatch = entry.description.match(/(\d+) игр\./);
        if (roundMatch) {
            const roundNum   = roundMatch[1];
            const playersPart = playersMatch ? (currentLang === 'ru' ? `, ${playersMatch[1]} игр.` : `, ${playersMatch[1]} players`) : '';
            title = `${title} #${roundNum}${playersPart}`;
        }
    }

    return title;
}

// ── Colour helpers ────────────────────────────────────────────────────────────

function _borderClass(color) {
    if (color === 'green')  return 'border-green-500/20 bg-green-500/5';
    if (color === 'red')    return 'border-red-500/20 bg-red-500/5';
    if (color === 'amber')  return 'border-amber-500/20 bg-amber-500/5';
    if (color === 'purple') return 'border-purple-500/20 bg-purple-500/5';
    return 'border-white/5 bg-black/20';
}

function _iconBgClass(color) {
    if (color === 'green')  return 'bg-green-500/20 border border-green-400/30';
    if (color === 'red')    return 'bg-red-500/20 border border-red-400/30';
    if (color === 'amber')  return 'bg-amber-500/20 border border-amber-400/30';
    if (color === 'purple') return 'bg-purple-500/20 border border-purple-400/30';
    return 'bg-white/5 border border-white/10';
}

// ── Single entry card ─────────────────────────────────────────────────────────

function _buildEntryCard(entry) {
    const meta         = HISTORY_ICONS[entry.action_type] || { icon: '📋', color: 'gray', sign: null };
    const giftPhotoUrl = getHistoryGiftPhoto(entry);

    const iconHtml = giftPhotoUrl
        ? `<img src="${escapeHtml(getImgSrc(giftPhotoUrl))}" class="w-7 h-7 object-contain drop-shadow-md"
               onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
           <span style="display:none">${meta.icon}</span>`
        : meta.icon;

    const title      = _buildEntryTitle(entry);
    const amountHtml = _buildAmountHtml(entry, meta);

    return `
        <div class="glass rounded-2xl px-4 py-3 flex items-center justify-between border ${_borderClass(meta.color)} gap-3">
            <div class="flex items-center gap-3 min-w-0">
                <div class="w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center text-xl ${_iconBgClass(meta.color)}">
                    ${iconHtml}
                </div>
                <div class="min-w-0">
                    <div class="font-semibold text-white text-sm leading-tight truncate">${escapeHtml(title)}</div>
                    <div class="text-[11px] text-blue-200/40 mt-0.5">${formatHistoryDate(entry.created_at)}</div>
                </div>
            </div>
            <div class="flex-shrink-0 ml-2">${amountHtml}</div>
        </div>`;
}

// ── Infinite-scroll history ───────────────────────────────────────────────────

let historyOffset    = 0;
const HISTORY_PAGE_SIZE = 30;
let historyLoading   = false;
let historyAllLoaded = false;
let historyGrouped   = {};   // accumulated, grouped by display-date key

function resetHistoryState() {
    historyOffset    = 0;
    historyLoading   = false;
    historyAllLoaded = false;
    historyGrouped   = {};
}

async function openHistoryModal() {
    vibrate('light');
    openModal('history-modal');
    resetHistoryState();

    const list = document.getElementById('history-list');
    list.innerHTML = `<div class="text-center text-blue-300/50 py-10 animate-pulse font-bold tracking-widest uppercase text-sm">${i18n[currentLang].loading}</div>`;

    // Attach scroll listener for infinite loading
    const modal = document.getElementById('history-modal');
    if (modal) {
        modal._historyScrollHandler = () => {
            const scrollEl = modal.querySelector('.overflow-y-auto') || modal;
            const nearBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 120;
            if (nearBottom && !historyLoading && !historyAllLoaded) loadMoreHistory();
        };
        const scrollEl = modal.querySelector('.overflow-y-auto') || modal;
        scrollEl.removeEventListener('scroll', modal._historyScrollHandler);
        scrollEl.addEventListener('scroll', modal._historyScrollHandler);
    }

    await loadMoreHistory(true);
}

async function loadMoreHistory(isFirstLoad = false) {
    if (historyLoading || historyAllLoaded) return;
    historyLoading = true;

    const list = document.getElementById('history-list');

    let spinner = document.getElementById('history-load-spinner');
    if (!isFirstLoad && !spinner) {
        spinner = document.createElement('div');
        spinner.id        = 'history-load-spinner';
        spinner.className = 'text-center text-blue-300/50 py-6 animate-pulse font-bold tracking-widest uppercase text-xs';
        spinner.textContent = i18n[currentLang].loading || 'Загрузка...';
        list.appendChild(spinner);
    }

    try {
        const res  = await fetch(`/api/history?offset=${historyOffset}&limit=${HISTORY_PAGE_SIZE}`, {
            headers: getApiHeaders()
        });
        const data = await res.json();

        spinner = document.getElementById('history-load-spinner');
        if (spinner) spinner.remove();

        // ── Empty result ──────────────────────────────────────────────────────
        if (!data.history || data.history.length === 0) {
            if (isFirstLoad) {
                list.innerHTML = `<div class="text-center text-blue-200/40 text-sm py-10 border border-white/5 border-dashed rounded-2xl px-4">${i18n[currentLang].history_empty}</div>`;
            } else {
                const endMsg = document.createElement('div');
                endMsg.className   = 'text-center text-blue-200/30 text-xs py-4 font-semibold tracking-widest uppercase';
                endMsg.textContent = currentLang === 'ru' ? 'Больше записей нет' : 'No more records';
                list.appendChild(endMsg);
            }
            historyAllLoaded = true;
            historyLoading   = false;
            return;
        }

        // ── Accumulate into groups ────────────────────────────────────────────
        historyOffset += data.history.length;
        if (historyOffset >= data.total || data.history.length < HISTORY_PAGE_SIZE) {
            historyAllLoaded = true;
        }

        const today     = new Date();
        const yesterday = new Date();
        yesterday.setDate(today.getDate() - 1);

        data.history.forEach(entry => {
            if (HISTORY_HIDDEN_TYPES.has(entry.action_type)) return;

            const dateObj  = new Date(entry.created_at * 1000);
            let dateLabel  = dateObj.toLocaleDateString(
                currentLang === 'ru' ? 'ru-RU' : 'en-US',
                { day: 'numeric', month: 'long' }
            );
            if (dateObj.toDateString() === today.toDateString()) {
                dateLabel = currentLang === 'ru' ? 'Сегодня' : 'Today';
            } else if (dateObj.toDateString() === yesterday.toDateString()) {
                dateLabel = currentLang === 'ru' ? 'Вчера' : 'Yesterday';
            }

            if (!historyGrouped[dateLabel]) historyGrouped[dateLabel] = [];
            historyGrouped[dateLabel].push(entry);
        });

        // ── Render ────────────────────────────────────────────────────────────
        const getPlural = (n, one, two, five) => {
            let mod = Math.abs(n) % 100;
            if (mod >= 5 && mod <= 20) return five;
            mod %= 10;
            if (mod === 1) return one;
            if (mod >= 2 && mod <= 4) return two;
            return five;
        };

        let html = '';
        for (const [dateLabel, entries] of Object.entries(historyGrouped)) {
            const count      = entries.length;
            const actionText = currentLang === 'ru'
                ? `${count} ${getPlural(count, 'действие', 'действия', 'действий')}`
                : `${count} action${count !== 1 ? 's' : ''}`;

            html += `
                <div class="sticky top-[-5px] z-20 flex items-center justify-between bg-[#0f172a]/80 backdrop-blur-xl py-2.5 px-3 mt-5 mb-3 first:mt-0 rounded-xl border border-white/10 shadow-lg">
                    <div class="flex items-center gap-3">
                        <div class="w-1.5 h-4 bg-gradient-to-b from-blue-400 to-indigo-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.6)]"></div>
                        <span class="text-sm font-bold text-white/90 capitalize tracking-wide drop-shadow-md">${escapeHtml(dateLabel)}</span>
                    </div>
                    <div class="flex items-center gap-1.5 bg-white/5 text-white/70 px-2.5 py-1 rounded-full border border-white/10 shadow-inner">
                        <svg xmlns="http://www.w3.org/2000/svg" class="w-3.5 h-3.5 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>
                        <span class="text-[10px] font-bold uppercase tracking-wider">${actionText}</span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 relative z-10">
                    ${entries.map(_buildEntryCard).join('')}
                </div>`;
        }

        list.innerHTML = html;

    } catch (e) {
        const spinner2 = document.getElementById('history-load-spinner');
        if (spinner2) spinner2.remove();
        if (isFirstLoad) {
            list.innerHTML = `<div class="text-center text-red-400/70 text-sm py-10">${i18n[currentLang].err_network}</div>`;
        }
    }

    historyLoading = false;
}

// ── Exports ───────────────────────────────────────────────────────────────────

window.openHistoryModal = openHistoryModal;
window.loadMoreHistory  = loadMoreHistory;
