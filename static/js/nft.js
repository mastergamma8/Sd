// =====================================================
// nft.js — NFT Галерея
// =====================================================

// ─── Состояние ────────────────────────────────────────────────────────────────

let nftStars       = 0;
let nftShopData    = [];
let nftGalleryData = [];
let nftCurrentTab  = 'shop';
let nftModalPainting = null;
let nftViewingUserId = null; // null = смотрим свою галерею

// ─── Открытие / Закрытие секции ───────────────────────────────────────────────

function openNFTSection() {
    vibrate('medium');

    const section = document.getElementById('nft-section');
    if (!section) return;

    const header   = document.querySelector('header');
    const appContent = document.getElementById('app-content');
    const mainNav  = document.querySelector('.fixed.left-0.w-full.flex.justify-center.z-40');

    if (header)     header.style.display = 'none';
    if (appContent) appContent.style.display = 'none';
    if (mainNav)    mainNav.style.display = 'none';

    section.classList.remove('hidden');
    section.style.display = 'flex';
    section.classList.add('nft-enter');
    setTimeout(() => section.classList.remove('nft-enter'), 350);

    nftLoadInfo();
    nftSwitchTab(nftCurrentTab);
}

function closeNFTSection() {
    vibrate('light');

    const section = document.getElementById('nft-section');
    if (section) {
        section.style.display = 'none';
        section.classList.add('hidden');
    }

    const header     = document.querySelector('header');
    const appContent = document.getElementById('app-content');
    const mainNav    = document.querySelector('.fixed.left-0.w-full.flex.justify-center.z-40');

    if (header)     header.style.display = '';
    if (appContent) appContent.style.display = '';
    if (mainNav)    mainNav.style.display = '';
}

// ─── Переключение вкладок ─────────────────────────────────────────────────────

function nftSwitchTab(tab) {
    vibrate('light');
    nftCurrentTab = tab;

    document.querySelectorAll('.nft-nav-item').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`nft-nav-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');

    ['shop', 'gallery', 'galleries', 'history'].forEach(t => {
        const el = document.getElementById(`nft-page-${t}`);
        if (el) el.classList.add('hidden');
    });
    const page = document.getElementById(`nft-page-${tab}`);
    if (page) page.classList.remove('hidden');

    const contentArea = document.getElementById('nft-content-area');
    if (contentArea) contentArea.scrollTop = 0;

    if (tab === 'shop')      nftLoadShop();
    if (tab === 'gallery')   nftLoadGallery();
    if (tab === 'galleries') nftLoadGalleriesPage();
    if (tab === 'history')   nftLoadHistory();
}

// ─── Загрузка данных ──────────────────────────────────────────────────────────

async function nftLoadInfo() {
    try {
        const res  = await fetch('/api/nft/info', { headers: getApiHeaders() });
        const data = await res.json();
        nftStars = data.nft_stars || 0;
        nftUpdateStarsUI();
    } catch(e) {
        console.warn('NFT info error:', e);
    }
}

async function nftLoadShop() {
    const list = document.getElementById('nft-shop-list');
    if (!list) return;

    list.innerHTML = nftLoadingHTML();

    try {
        const res  = await fetch('/api/nft/shop', { headers: getApiHeaders() });
        const data = await res.json();
        nftShopData = data.paintings || [];
        nftRenderShop();
    } catch(e) {
        list.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

async function nftLoadGallery(userId = null) {
    nftViewingUserId = userId;

    const grid     = document.getElementById('nft-gallery-grid');
    const empty    = document.getElementById('nft-gallery-empty');
    const collectors = document.getElementById('nft-collectors-list');
    const title    = document.getElementById('nft-gallery-title');
    const subtitle = document.getElementById('nft-gallery-subtitle');
    const backBtn  = document.getElementById('nft-gallery-back-btn');

    if (!grid) return;

    grid.innerHTML = nftLoadingHTML();
    collectors.innerHTML = '';
    empty.classList.add('hidden');

    if (userId === null) {
        title.textContent    = '🏛 Моя Галерея';
        subtitle.textContent = 'Ваша коллекция NFT';
        backBtn.classList.add('hidden');

        try {
            const res = await fetch('/api/nft/gallery/me', { headers: getApiHeaders() });
            const galleryData = await res.json();
            nftGalleryData = galleryData.gallery || [];
            nftRenderGalleryGrid(nftGalleryData, true);
        } catch(e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    } else {
        backBtn.classList.remove('hidden');
        collectors.innerHTML = '';

        try {
            const res  = await fetch(`/api/nft/gallery/${userId}`, { headers: getApiHeaders() });
            const data = await res.json();
            nftGalleryData = data.gallery || [];
            nftRenderGalleryGrid(nftGalleryData, false);
        } catch(e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    }
}

function nftGalleryBackToList() {
    nftLoadGallery(null);
}

// ─── Страница «Галереи» ───────────────────────────────────────────────────────

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
    } catch(e) {
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
            const name = c.is_anonymous ? 'Анонимный' : (c.first_name || c.username || `User ${c.tg_id}`);
            const medals = ['🥇','🥈','🥉'];
            const rankBadge = i < 3
                ? `<span class="text-base">${medals[i]}</span>`
                : `<div class="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black"
                        style="background:rgba(251,191,36,0.18);color:#fbbf24;">${i + 1}</div>`;
            return `
            <div class="flex items-center justify-between p-3 rounded-2xl cursor-pointer active:scale-[0.98] transition-all"
                 style="background:rgba(251,191,36,0.06);border:1px solid rgba(251,191,36,0.15);"
                 onclick="nftOpenUserGalleryPage(${c.tg_id}, '${escapeHtml(name)}')">
                <div class="flex items-center gap-2.5">
                    ${rankBadge}
                    <div>
                        <p class="text-white text-sm font-semibold">${escapeHtml(name)}</p>
                        <p class="text-[10px]" style="color:rgba(251,191,36,0.5);">${c.collection_size} ${c.collection_size === 1 ? 'картина' : c.collection_size < 5 ? 'картины' : 'картин'}</p>
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
            <p class="font-black text-base" style="color:#fde68a;font-family:'Georgia',serif;">🏛 ${escapeHtml(name)}</p>
            <p class="text-[10px] tracking-widest uppercase" style="color:rgba(251,191,36,0.5);">Коллекция пользователя</p>
        </div>
        ${nftLoadingHTML()}`;

    try {
        const res  = await fetch(`/api/nft/gallery/${userId}`, { headers: getApiHeaders() });
        const data = await res.json();
        const paintings = data.gallery || [];

        const headerHtml = `
            <div class="mb-4">
                <p class="font-black text-base" style="color:#fde68a;font-family:'Georgia',serif;">🏛 ${escapeHtml(name)}</p>
                <p class="text-[10px] tracking-widest uppercase" style="color:rgba(251,191,36,0.5);">Коллекция пользователя · ${paintings.length} картин</p>
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
    } catch(e) {
        content.innerHTML += `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

function nftGalleriesBackToList() {
    vibrate('light');
    const backRow = document.getElementById('nft-galleries-back-row');
    backRow.classList.add('hidden');
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
    } catch(e) {
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

    list.innerHTML = entries.map(e => {
        const isBuy    = e.action_type === 'nft_buy';
        const isTopup  = e.action_type === 'nft_topup' || e.action_type === 'nft_stars_topup';
        const color    = isBuy ? 'rgba(239,68,68,0.18)' : 'rgba(16,185,129,0.18)';
        const textColor= isBuy ? '#f87171' : '#34d399';
        const sign     = isBuy ? '−' : '+';
        const date     = new Date(e.created_at * 1000);
        const dateStr  = date.toLocaleDateString('ru-RU', { day:'2-digit', month:'short' })
                       + ' ' + date.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });

        // Иконка: для покупки — фото картины, для пополнения — SVG-звезда
        let iconHTML;
        if (isBuy && e.painting_image) {
            iconHTML = `<img src="${escapeHtml(e.painting_image)}" alt=""
                             class="w-10 h-10 rounded-xl object-cover flex-shrink-0 border"
                             style="border-color:rgba(251,191,36,0.3);"
                             onerror="this.outerHTML='<div class=\\'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0\\' style=\\'background:rgba(239,68,68,0.18);\\'>&#127912;</div>'">`;
        } else if (isBuy) {
            iconHTML = `<div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                              style="background:${color};">
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#f87171;">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                </svg>
            </div>`;
        } else {
            iconHTML = `<div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                              style="background:${color};">
                <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" style="color:#34d399;">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
                </svg>
            </div>`;
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

// ─── Рендер Магазина ──────────────────────────────────────────────────────────

function nftRenderShop() {
    const list = document.getElementById('nft-shop-list');
    if (!list) return;

    if (nftShopData.length === 0) {
        list.innerHTML = `
            <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-3 rounded-3xl flex items-center justify-center"
                     style="background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.18);">
                    <svg class="w-8 h-8 text-yellow-700/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                </div>
                <p class="text-yellow-600/50 text-sm">Нет доступных картин</p>
                <p class="text-yellow-600/30 text-xs mt-1">Скоро появятся новые работы</p>
            </div>`;
        return;
    }

    const available = nftShopData.filter(p => p.available === null || p.available > 0);
    const archived  = nftShopData.filter(p => p.available !== null && p.available <= 0);

    let html = '';

    if (available.length > 0) {
        html += available.map(p => nftShopCardHTML(p)).join('');
    } else {
        html += `
            <div class="text-center py-8">
                <p class="text-yellow-600/40 text-sm">Все картины временно распроданы</p>
            </div>`;
    }

    if (archived.length > 0) {
        html += `
        <div class="mt-6 mb-3">
            <div class="flex items-center gap-3">
                <div class="nft-ornament-line flex-1"></div>
                <div class="flex items-center gap-1.5">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:rgba(251,191,36,0.5);">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8M10 12v4m4-4v4"/>
                    </svg>
                    <span class="text-[10px] font-bold tracking-[0.2em] uppercase" style="color:rgba(251,191,36,0.5);">Архив</span>
                </div>
                <div class="nft-ornament-line flex-1"></div>
            </div>
            <p class="text-center text-[9px] tracking-widest uppercase mt-1" style="color:rgba(251,191,36,0.3);">Завершённые коллекции</p>
        </div>
        <div class="space-y-3 opacity-60">
            ${archived.map(p => nftShopCardHTML(p)).join('')}
        </div>`;
    }

    list.innerHTML = html;
}

function nftShopCardHTML(p) {
    const ownedCount = p.owned_count || 0;
    const isOwned   = ownedCount > 0;
    const isSoldOut = p.available !== null && p.available <= 0;
    const limited   = p.total_supply > 0;
    const remain    = p.available;

    const badgeHTML = limited
        ? `<div class="absolute top-2 left-2 px-2 py-0.5 rounded-xl text-[10px] font-bold"
                style="background:rgba(251,191,36,0.9);color:#0d0601;backdrop-filter:blur(8px);">
               ${isSoldOut ? '🔴 Распродано' : `🔥 ${remain} из ${p.total_supply}`}
           </div>`
        : `<div class="absolute top-2 left-2 px-2 py-0.5 rounded-xl text-[10px] font-bold"
                style="background:rgba(99,102,241,0.78);color:#fff;backdrop-filter:blur(8px);">♾ Неограниченный</div>`;

    const statusLabel = isSoldOut
        ? `<span class="text-xs font-bold px-2 py-1 rounded-xl" style="background:rgba(239,68,68,0.15);color:#f87171;">Нет в наличии</span>`
        : `<span class="text-xs font-bold px-2.5 py-1 rounded-xl" style="background:rgba(251,191,36,0.14);color:#fbbf24;">Купить</span>`;

    return `
    <div class="nft-card${isOwned ? ' owned' : ''} cursor-pointer"
         onclick="nftOpenPainting(${p.id})">
        <div class="relative w-full" style="padding-top:65%;">
            <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                 class="absolute inset-0 w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/400x260?text=NFT'">
            <div class="absolute inset-0" style="background:linear-gradient(to bottom,transparent 45%,rgba(8,4,0,0.95) 100%);"></div>
            ${badgeHTML}
        </div>
        <div class="p-3">
            <h4 class="text-white font-bold text-sm leading-tight mb-1 truncate">${escapeHtml(p.title)}</h4>
            ${p.description ? `<p class="text-xs mb-2 line-clamp-2" style="color:rgba(251,191,36,0.45);">${escapeHtml(p.description)}</p>` : ''}
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1">
                    <img src="/gifts/stars.png" class="w-3.5 h-3.5 object-contain" onerror="this.style.display='none'">
                    <span class="font-black text-sm" style="color:#fbbf24;">${p.price}</span>
                </div>
                ${statusLabel}
            </div>
        </div>
    </div>`;
}

// ─── Рендер Галереи ───────────────────────────────────────────────────────────

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

function nftGalleryCardHTML(p, isOwner) {
    const serial = p.serial_number || 0;
    const serialLabel = serial > 0
        ? `<span style="color:#fbbf24;"> #${serial}</span>`
        : '';
    const viewOnly = !isOwner;

    return `
    <div class="nft-gallery-card cursor-pointer" onclick="nftOpenPainting(${p.id}, true, ${viewOnly}, ${serial})">
        <div class="relative w-full" style="padding-top:100%;">
            <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                 class="absolute inset-0 w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/300x300?text=NFT'">
            <div class="absolute inset-0" style="background:linear-gradient(to bottom,transparent 30%,rgba(8,4,0,0.96) 100%);"></div>
            <div class="absolute bottom-2 left-2 right-2">
                <p class="text-white font-bold text-xs truncate leading-tight">${escapeHtml(p.title)}${serialLabel}</p>
                <div class="flex items-center gap-1 mt-1">
                    <img src="/gifts/stars.png" class="w-3 h-3 object-contain" onerror="this.style.display='none'">
                    <span class="text-[10px] font-black" style="color:#fbbf24;">${p.price}</span>
                    <span class="text-[9px]" style="color:rgba(251,191,36,0.5);">звёзд</span>
                </div>
            </div>
        </div>
    </div>`;
}

// ─── Модальное окно картины ───────────────────────────────────────────────────

function nftOpenPainting(paintingId, fromGallery = false, viewOnly = false, serialNumber = null) {
    vibrate('light');

    let painting = nftShopData.find(p => p.id === paintingId);
    if (!painting) {
        // Ищем конкретную копию по serial_number (если передан), иначе первую
        if (serialNumber !== null && serialNumber > 0) {
            painting = nftGalleryData.find(p => p.id === paintingId && p.serial_number === serialNumber);
        }
        if (!painting) painting = nftGalleryData.find(p => p.id === paintingId);
        if (painting) painting = { ...painting, owned: true, owned_count: 1 };
    }
    if (!painting) return;

    nftModalPainting = painting;

    document.getElementById('nft-modal-image').src  = painting.image_url;
    document.getElementById('nft-modal-desc').textContent = painting.description || '';
    document.getElementById('nft-modal-price').textContent = painting.price;

    // Название + серийный номер (показываем если открыто из галереи и serial известен)
    const titleEl = document.getElementById('nft-modal-title');
    const serial  = serialNumber || painting.serial_number;
    if (serial && serial > 0) {
        titleEl.innerHTML = `${escapeHtml(painting.title)} <span style="color:#fbbf24;font-size:0.75em;">#${serial}</span>`;
    } else {
        titleEl.textContent = painting.title;
    }

    // Бейдж лимита
    const badge = document.getElementById('nft-modal-badge');
    if (painting.total_supply > 0) {
        badge.textContent = `${painting.sold_count} / ${painting.total_supply}`;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }

    // Ценовой блок и кнопка покупки
    const priceBlock = document.getElementById('nft-modal-price').closest('.nft-price-block');
    const buyBtn     = document.getElementById('nft-modal-buy-btn');

    if (viewOnly || fromGallery) {
        // Чужая или своя галерея — показываем цену, но скрываем кнопку покупки
        if (priceBlock) priceBlock.style.display = '';
        buyBtn.style.display = 'none';
    } else {
        if (priceBlock) priceBlock.style.display = '';
        buyBtn.style.display = '';

        const isSoldOut = painting.available !== null && painting.available <= 0;

        if (isSoldOut) {
            buyBtn.innerHTML = 'Распродано';
            buyBtn.disabled    = true;
            buyBtn.style.background = 'rgba(239,68,68,0.3)';
            buyBtn.style.boxShadow  = 'none';
        } else {
            buyBtn.innerHTML = `Купить за ${painting.price} <img src="/gifts/stars.png" class="w-4 h-4 inline-block align-middle ml-1 object-contain" onerror="this.style.display='none'">`;
            buyBtn.disabled    = false;
            buyBtn.style.background = 'linear-gradient(135deg, #b45309 0%, #fbbf24 50%, #f59e0b 100%)';
            buyBtn.style.boxShadow  = '0 4px 30px rgba(251,191,36,0.35)';
        }
    }

    document.getElementById('nft-painting-modal').classList.remove('hidden');
}

async function nftBuyFromModal() {
    if (!nftModalPainting) return;
    vibrate('medium');

    const btn = document.getElementById('nft-modal-buy-btn');
    const originalText = btn.textContent;
    btn.textContent = 'Покупка...';
    btn.disabled    = true;

    try {
        const res  = await fetch('/api/nft/buy', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ painting_id: nftModalPainting.id }),
        });
        const data = await res.json();

        if (!res.ok) {
            const msg = data.detail || 'Ошибка покупки';
            showNotify(msg, 'error');
            btn.textContent = originalText;
            btn.disabled    = false;
            return;
        }

        nftStars = data.nft_stars;
        nftUpdateStarsUI();
        showNotify('🎨 Картина добавлена в вашу коллекцию!', 'success');
        vibrate('heavy');

        const shopItem = nftShopData.find(p => p.id === nftModalPainting.id);
        if (shopItem) {
            shopItem.owned_count = (shopItem.owned_count || 0) + 1;
            shopItem.owned = true;
            if (shopItem.available !== null) shopItem.available--;
            shopItem.sold_count = (shopItem.sold_count || 0) + 1;
        }

        closeNFTModal('nft-painting-modal');
        if (nftCurrentTab === 'shop') nftRenderShop();
        else nftLoadShop();

    } catch(e) {
        showNotify('Ошибка соединения', 'error');
        btn.textContent = originalText;
        btn.disabled    = false;
    }
}

// ─── Пополнение NFT-звёзд ────────────────────────────────────────────────────

function openNFTTopup() {
    vibrate('medium');
    window.nftTopupMode = true;
    document.getElementById('custom-topup-amount').value = '';
    openModal('topup-stars-modal');
}

// ─── Коллекторы (в «Моей галерее» — устаревший блок, оставлен для совместимости) ──

function nftRenderCollectors(collectors) {
    const container = document.getElementById('nft-collectors-list');
    if (!container) return;
    container.innerHTML = '';
}

function nftViewUserGallery(userId, name) {
    vibrate('light');
    const title    = document.getElementById('nft-gallery-title');
    const subtitle = document.getElementById('nft-gallery-subtitle');
    if (title)    title.textContent    = `🏛 ${name}`;
    if (subtitle) subtitle.textContent = 'Коллекция пользователя';
    nftLoadGallery(userId);
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function nftUpdateStarsUI() {
    const el = document.getElementById('nft-stars-amount');
    if (el) el.textContent = nftStars;
}

function closeNFTModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
}

function nftLoadingHTML() {
    return `
        <div class="flex items-center justify-center py-12">
            <div class="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                 style="border-color:rgba(251,191,36,0.35);border-top-color:transparent;"></div>
        </div>`;
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────
window.openNFTSection       = openNFTSection;
window.closeNFTSection      = closeNFTSection;
window.nftSwitchTab         = nftSwitchTab;
window.nftOpenPainting      = nftOpenPainting;
window.nftBuyFromModal      = nftBuyFromModal;
window.openNFTTopup         = openNFTTopup;
window.closeNFTModal        = closeNFTModal;
window.nftViewUserGallery   = nftViewUserGallery;
window.nftGalleryBackToList = nftGalleryBackToList;
window.nftOpenUserGalleryPage = nftOpenUserGalleryPage;
window.nftGalleriesBackToList = nftGalleriesBackToList;