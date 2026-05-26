// =====================================================
// nft-gallery.js — NFT Галерея: Моя галерея, Галереи, История
// Зависимости: nft-core.js (nftGalleryData, nftLoadingHTML, getApiHeaders, escapeHtml)
// =====================================================

// ─── Моя галерея ─────────────────────────────────────────────────────────────

async function nftLoadGallery(userId = null) {
    nftViewingUserId = userId;

    const grid       = document.getElementById('nft-gallery-grid');
    const empty      = document.getElementById('nft-gallery-empty');
    const collectors = document.getElementById('nft-collectors-list');
    const title      = document.getElementById('nft-gallery-title');
    const subtitle   = document.getElementById('nft-gallery-subtitle');
    const backBtn    = document.getElementById('nft-gallery-back-btn');

    if (!grid) return;

    // БАГ-ФИX: col-span-2 добавляется в nftLoadingHTML() — спиннер занимает обе колонки грида
    grid.innerHTML = nftLoadingHTML();
    collectors.innerHTML = '';
    empty.classList.add('hidden');

    if (userId === null) {
        title.textContent    = 'Моя Галерея';
        subtitle.textContent = 'Ваша коллекция NFT';
        backBtn.classList.add('hidden');

        try {
            const res         = await fetch('/api/nft/gallery/me', { headers: getApiHeaders() });
            const galleryData = await res.json();
            nftGalleryData    = galleryData.gallery || [];
            nftRenderGalleryGrid(nftGalleryData, true);
        } catch (e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    } else {
        backBtn.classList.remove('hidden');
        // БАГ-ФИX: обновляем заголовок и подпись при просмотре чужой галереи
        // (раньше они оставались «Моя Галерея» до загрузки данных)
        subtitle.textContent = 'Коллекция пользователя';
        collectors.innerHTML = '';

        try {
            const res  = await fetch(`/api/nft/gallery/${userId}`, { headers: getApiHeaders() });
            const data = await res.json();
            nftGalleryData = data.gallery || [];
            // Обновляем заголовок с именем (если сервер вернул)
            if (data.display_name) title.textContent = data.display_name;
            nftRenderGalleryGrid(nftGalleryData, false);
        } catch (e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    }
}

function nftGalleryBackToList() {
    nftLoadGallery(null);
}

// ─── Рендер грида галереи ─────────────────────────────────────────────────────

function nftRenderGalleryGrid(items, isOwner = false) {
    const grid  = document.getElementById('nft-gallery-grid');
    const empty = document.getElementById('nft-gallery-empty');
    if (!grid) return;

    if (items.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = items.map(p => nftGalleryCardHTML(p, isOwner)).join('');
}

// ─── Карточка галереи (квадратная) ───────────────────────────────────────────

function nftGalleryCardHTML(p, isOwner) {
    const serial      = p.serial_number || 0;
    const serialLabel = serial > 0
        ? `<span style="color:#fbbf24;"> #${serial}</span>`
        : '';
    const viewOnly = !isOwner;
    const status   = p.status || 'held'; // 'held' | 'for_sale' | 'in_auction'

    let statusBadge = '';
    if (status === 'for_sale') {
        statusBadge = `<div class="nft-status-badge nft-status-for-sale">На продаже</div>`;
    } else if (status === 'in_auction') {
        statusBadge = `<div class="nft-status-badge nft-status-in-auction">На аукционе</div>`;
    }

    const myBadge = isOwner
        ? `<div class="nft-status-badge" style="top:6px;left:6px;right:auto;background:rgba(16,185,129,0.85);color:#fff;">✦ Моя картина</div>`
        : '';

    return `
    <div class="nft-gallery-card cursor-pointer relative"
         onclick="nftOpenPainting(${p.id}, true, ${viewOnly}, ${serial})">
        <div class="relative w-full" style="padding-top:100%;">
            <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                 class="absolute inset-0 w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/300x300?text=NFT'">
            <div class="absolute inset-0"
                 style="background:linear-gradient(to bottom,transparent 30%,rgba(8,4,0,0.96) 100%);"></div>
            ${myBadge}
            ${statusBadge}
            <div class="absolute bottom-2 left-2 right-2" style="z-index:1;">
                <p class="text-white font-bold text-xs truncate leading-tight">
                    ${escapeHtml(p.title)}${serialLabel}
                </p>
                <div class="flex items-center gap-1 mt-1">
                    <img src="/gifts/stars.png" class="w-3 h-3 object-contain" onerror="this.style.display='none'">
                    <span class="text-[10px] font-black" style="color:#fbbf24;">${p.price}</span>
                    <span class="text-[9px]" style="color:rgba(251,191,36,0.5);">звёзд</span>
                </div>
            </div>
        </div>
    </div>`;
}

// ─── Страница «Галереи» (список коллекционеров) ───────────────────────────────

let nftGalleriesMode = 'list'; // 'list' | 'viewer'

async function nftLoadGalleriesPage() {
    nftGalleriesMode = 'list';
    const content = document.getElementById('nft-galleries-content');
    const backRow  = document.getElementById('nft-galleries-back-row');
    if (!content) return;

    backRow.classList.add('hidden');
    content.innerHTML = nftLoadingHTML();

    try {
        const res  = await fetch('/api/nft/galleries', { headers: getApiHeaders() });
        const data = await res.json();
        nftRenderGalleriesList(data.collectors || []);
    } catch (e) {
        content.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

function nftRenderGalleriesList(collectors) {
    const content = document.getElementById('nft-galleries-content');
    if (!content) return;

    if (collectors.length === 0) {
        content.innerHTML = `
            <div class="text-center py-14">
                <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center">
                    <svg class="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fbbf24;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                </div>
                <p class="nft-muted-text text-sm">Пока нет коллекционеров</p>
            </div>`;
        return;
    }

    content.innerHTML = `<div class="space-y-2">
        ${collectors.map((c, i) => {
            const name = c.is_anonymous
                ? 'Анонимный'
                : (c.first_name || c.username || `User ${c.tg_id}`);
            const medals    = ['🥇', '🥈', '🥉'];
            const rankBadge = i < 3
                ? `<span class="text-base">${medals[i]}</span>`
                : `<div class="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black"
                        style="background:rgba(251,191,36,0.18);color:#fbbf24;">${i + 1}</div>`;

            const count  = c.collection_size;
            const countWord = count === 1 ? 'картина' : count < 5 ? 'картины' : 'картин';

            return `
            <div class="flex items-center justify-between p-3 rounded-2xl cursor-pointer active:scale-[0.98] transition-all"
                 style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);"
                 onclick="nftOpenUserGalleryPage(${c.tg_id}, '${escapeHtml(name)}')">
                <div class="flex items-center gap-2.5">
                    ${rankBadge}
                    <div>
                        <p class="text-white text-sm font-semibold">${escapeHtml(name)}</p>
                        <p class="text-[10px]" style="color:rgba(251,191,36,0.5);">${count} ${countWord}</p>
                    </div>
                </div>
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:rgba(251,191,36,0.4);">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                </svg>
            </div>`;
        }).join('')}
    </div>`;
}

async function nftOpenUserGalleryPage(userId, name) {
    vibrate('light');
    nftGalleriesMode = 'viewer';

    const content = document.getElementById('nft-galleries-content');
    const backRow  = document.getElementById('nft-galleries-back-row');
    if (!content) return;

    backRow.classList.remove('hidden');
    content.innerHTML = `
        <div class="mb-4">
            <p class="font-black text-base" style="color:#fde68a;font-family:'Georgia',serif;">${escapeHtml(name)}</p>
            <p class="text-[10px] tracking-widest uppercase" style="color:rgba(251,191,36,0.5);">Коллекция пользователя</p>
        </div>
        <div class="grid grid-cols-2 gap-3">${nftLoadingHTML()}</div>`;

    try {
        const res      = await fetch(`/api/nft/gallery/${userId}`, { headers: getApiHeaders() });
        const data     = await res.json();
        const paintings = data.gallery || [];

        // БАГ-ФИX: обновляем nftGalleryData данными чужой галереи,
        // иначе nftOpenPainting ищет по старым данным и не находит картину
        nftGalleryData = paintings;

        const headerHtml = `
            <div class="mb-4">
                <p class="font-black text-base" style="color:#fde68a;font-family:'Georgia',serif;">${escapeHtml(name)}</p>
                <p class="text-[10px] tracking-widest uppercase" style="color:rgba(251,191,36,0.5);">
                    Коллекция пользователя · ${paintings.length} картин
                </p>
            </div>`;

        if (paintings.length === 0) {
            content.innerHTML = headerHtml + `
                <div class="text-center py-10">
                    <p class="nft-muted-text text-sm">Галерея пуста</p>
                </div>`;
            return;
        }

        content.innerHTML = headerHtml + `
            <div class="grid grid-cols-2 gap-3">
                ${paintings.map(p => nftGalleryCardHTML(p, false)).join('')}
            </div>`;
    } catch (e) {
        content.innerHTML += `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

function nftGalleriesBackToList() {
    vibrate('light');
    document.getElementById('nft-galleries-back-row')?.classList.add('hidden');
    // БАГ-ФИX: сбрасываем nftGalleryData при возврате к списку, чтобы старые данные
    // чужой галереи не мешали последующим кликам по другим разделам
    nftGalleryData = [];
    nftLoadGalleriesPage();
}

// ─── История NFT ──────────────────────────────────────────────────────────────

async function nftLoadHistory() {
    const list = document.getElementById('nft-history-list');
    if (!list) return;

    list.innerHTML = nftLoadingHTML();

    try {
        const res  = await fetch('/api/nft/history', { headers: getApiHeaders() });
        const data = await res.json();
        nftRenderHistory(data.history || []);
    } catch (e) {
        list.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

function nftRenderHistory(entries) {
    const list = document.getElementById('nft-history-list');
    if (!list) return;

    if (entries.length === 0) {
        list.innerHTML = `
            <div class="text-center py-14">
                <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center">
                    <svg class="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fbbf24;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <p class="nft-muted-text text-sm font-medium mb-1">История пуста</p>
                <p class="nft-muted-text text-xs opacity-60 mt-1">Здесь будут отображаться ваши операции</p>
            </div>`;
        return;
    }

    // Типы, при которых деньги тратятся (знак минус, красный)
    const SPEND_TYPES = new Set([
        'nft_buy', 'nft_market_buy', 'nft_auction_bid',
    ]);
    // Типы, при которых деньги поступают (знак плюс, зелёный)
    const EARN_TYPES = new Set([
        'nft_topup', 'nft_stars_topup',
        'nft_market_sold', 'nft_auction_sold',
        'nft_auction_won', 'nft_auction_outbid',
    ]);

    // Иконки для типов без картинки
    const TYPE_ICON = {
        'nft_topup':         { emoji: '⭐', bg: 'rgba(16,185,129,0.18)',  color: '#34d399' },
        'nft_stars_topup':   { emoji: '⭐', bg: 'rgba(16,185,129,0.18)',  color: '#34d399' },
        'nft_market_sold':   { emoji: '🏷', bg: 'rgba(16,185,129,0.18)',  color: '#34d399' },
        'nft_auction_sold':  { emoji: '🔨', bg: 'rgba(16,185,129,0.18)',  color: '#34d399' },
        'nft_auction_won':   { emoji: '🏆', bg: 'rgba(251,191,36,0.18)',  color: '#fbbf24' },
        'nft_auction_outbid':{ emoji: '↩️', bg: 'rgba(16,185,129,0.18)',  color: '#34d399' },
        'nft_auction_bid':   { emoji: '🔨', bg: 'rgba(239,68,68,0.18)',   color: '#f87171' },
        'nft_buy':           { emoji: '🎨', bg: 'rgba(239,68,68,0.18)',   color: '#f87171' },
        'nft_market_buy':    { emoji: '🎨', bg: 'rgba(239,68,68,0.18)',   color: '#f87171' },
    };

    list.innerHTML = entries.map(e => {
        const isSpend = SPEND_TYPES.has(e.action_type);
        const isEarn  = EARN_TYPES.has(e.action_type);

        const textColor = isSpend ? '#f87171' : '#34d399';
        const sign      = isSpend ? '−' : '+';

        const date    = new Date(e.created_at * 1000);
        const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
                      + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        // Если есть картинка — показываем её; иначе эмодзи-иконка
        let iconHTML;
        if (e.painting_image) {
            iconHTML = `<img src="${escapeHtml(e.painting_image)}" alt=""
                             class="w-10 h-10 rounded-xl object-cover flex-shrink-0 border"
                             style="border-color:rgba(251,191,36,0.3);"
                             onerror="this.outerHTML='<div class=\\'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0\\' style=\\'background:rgba(251,191,36,0.12);font-size:20px;\\'>🎨</div>'">`;
        } else {
            const ic = TYPE_ICON[e.action_type] || { emoji: '📋', bg: 'rgba(251,191,36,0.12)', color: '#fbbf24' };
            iconHTML = `<div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                              style="background:${ic.bg};">${ic.emoji}</div>`;
        }

        return `
        <div class="flex items-center gap-3 p-3 rounded-2xl"
             style="background:rgba(251,191,36,0.05);border:1px solid rgba(251,191,36,0.12);">
            ${iconHTML}
            <div class="flex-1 min-w-0">
                <p class="text-white text-xs font-semibold leading-tight truncate">${escapeHtml(e.description)}</p>
                <p class="text-[10px] mt-0.5" style="color:rgba(251,191,36,0.45);">${dateStr}</p>
            </div>
            <div class="text-right flex-shrink-0">
                <div class="flex items-center gap-1 justify-end">
                    <p class="text-sm font-black" style="color:${textColor};">${sign}${Math.abs(e.amount)}</p>
                    <img src="/gifts/stars.png" class="w-3.5 h-3.5 object-contain" onerror="this.style.display='none'">
                </div>
            </div>
        </div>`;
    }).join('');
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.nftLoadGallery           = nftLoadGallery;
window.nftGalleryBackToList     = nftGalleryBackToList;
window.nftRenderGalleryGrid     = nftRenderGalleryGrid;
window.nftGalleryCardHTML       = nftGalleryCardHTML;
window.nftLoadGalleriesPage     = nftLoadGalleriesPage;
window.nftRenderGalleriesList   = nftRenderGalleriesList;
window.nftOpenUserGalleryPage   = nftOpenUserGalleryPage;
window.nftGalleriesBackToList   = nftGalleriesBackToList;
window.nftLoadHistory           = nftLoadHistory;
window.nftRenderHistory         = nftRenderHistory;