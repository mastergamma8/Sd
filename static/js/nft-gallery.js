// =====================================================
// nft-gallery.js — NFT Галерея: Моя галерея, Галереи, История
// Зависимости: nft-core.js (nftGalleryData, nftLoadingHTML, getApiHeaders, escapeHtml)
// =====================================================

// ─── Моя галерея ─────────────────────────────────────────────────────────────

async function nftLoadGallery(userId = null) {
    nftViewingUserId        = userId;
    nftGalleryViewContext   = userId === null ? 'mine' : 'others';
    nftGalleryViewUserState = null;
    nftGalleryPackView      = null;

    const grid       = document.getElementById('nft-gallery-grid');
    const empty      = document.getElementById('nft-gallery-empty');
    const collectors = document.getElementById('nft-collectors-list');
    const title      = document.getElementById('nft-gallery-title');
    const subtitle   = document.getElementById('nft-gallery-subtitle');
    const backBtn    = document.getElementById('nft-gallery-back-btn');

    if (!grid) return;

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

            // ── Обработка deep-link: авто-открытие пака или картины ──────
            if (window._nftDeepLinkPackId) {
                const _packId = window._nftDeepLinkPackId;
                delete window._nftDeepLinkPackId;
                setTimeout(() => nftOpenPackInGallery(_packId, true), 150);
            } else if (window._nftDeepLinkPainting) {
                const { paintingId: _pid, serial: _ser } = window._nftDeepLinkPainting;
                delete window._nftDeepLinkPainting;
                setTimeout(() => nftOpenPainting(_pid, true, false, _ser), 150);
            }
        } catch (e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    } else {
        backBtn.classList.remove('hidden');
        subtitle.textContent = 'Коллекция пользователя';
        collectors.innerHTML = '';

        try {
            const res  = await fetch(`/api/nft/gallery/${userId}`, { headers: getApiHeaders() });
            const data = await res.json();
            nftGalleryData = data.gallery || [];
            if (data.display_name) title.textContent = data.display_name;
            nftRenderGalleryGrid(nftGalleryData, false);
        } catch (e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    }
}

// ─── Состояние просмотра пака в галерее ──────────────────────────────────────

let nftGalleryPackView    = null;  // текущий пак открытый в галерее
let nftGalleryViewContext = 'mine'; // 'mine' | 'others'
let nftGalleryViewUserState = null; // { userId, name } — для возврата из пака в галерею пользователя

// ─── Рендер грида галереи ─────────────────────────────────────────────────────

function nftRenderGalleryGrid(items, isOwner = false) {
    const grid  = document.getElementById('nft-gallery-grid');
    const empty = document.getElementById('nft-gallery-empty');
    if (!grid) return;

    nftGalleryPackView = null;

    if (items.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    // Группируем по пакам
    const packsMap = {};
    const standalone = [];

    for (const p of items) {
        if (p.pack_id) {
            if (!packsMap[p.pack_id]) {
                packsMap[p.pack_id] = {
                    pack_id:   p.pack_id,
                    pack_name: p.pack_name  || 'Пак',
                    pack_cover: p.pack_cover || p.image_url,
                    paintings: [],
                };
            }
            packsMap[p.pack_id].paintings.push(p);
        } else {
            standalone.push(p);
        }
    }

    const packs       = Object.values(packsMap);
    const hasPacks    = packs.length > 0;
    const hasStandalone = standalone.length > 0;

    let html = '';

    // Строки паков (полная ширина)
    if (hasPacks) {
        html += `<div class="col-span-2 space-y-3 mb-4">`;
        html += packs.map(pack => nftPackGalleryRowHTML(pack, isOwner)).join('');
        html += `</div>`;
    }

    // Разделитель
    if (hasPacks && hasStandalone) {
        html += `
        <div class="col-span-2 flex items-center gap-2 mb-3">
            <div class="flex-1 h-px" style="background:rgba(255,255,255,0.06);"></div>
            <span class="text-[9px] font-black tracking-widest uppercase" style="color:rgba(255,255,255,0.2);">Отдельные картины</span>
            <div class="flex-1 h-px" style="background:rgba(255,255,255,0.06);"></div>
        </div>`;
    }

    // Грид одиночных картин
    if (hasStandalone) {
        html += standalone.map(p => nftGalleryCardHTML(p, isOwner)).join('');
    }

    grid.innerHTML = html;
}

// ─── Карточка галереи (квадратная iOS 26) ───────────────────────────────────────────

function nftGalleryCardHTML(p, isOwner) {
    const serial      = p.serial_number || 0;
    const serialLabel = serial > 0
        ? `<span style="color:#fcd34d;"> #${serial}</span>`
        : '';
    const viewOnly = !isOwner;
    const status   = p.status || 'held'; 

    let statusBadge = '';
    if (status === 'for_sale') {
        statusBadge = `<div class="nft-status-badge nft-status-for-sale">🏷 На продаже</div>`;
    } else if (status === 'in_auction') {
        statusBadge = `<div class="nft-status-badge nft-status-in-auction">🔨 Торги</div>`;
    }

    const myBadge = isOwner
        ? `<div class="nft-status-badge" style="top:8px;left:8px;right:auto;background:rgba(16,185,129,0.9);color:#ffffff;">✦ Моя</div>`
        : '';

    const shareBtn = ''; // Кнопка поделиться убрана с карточки (только в модальном окне)

    return `
    <div class="nft-gallery-card cursor-pointer relative"
         onclick="nftOpenPainting(${p.id}, true, ${viewOnly}, ${serial})">
        <div class="nft-art-frame relative w-full" style="padding-top:100%;">
            <div class="art-blur" style="background-image:url(&quot;${p.image_url.replace(/"/g,'')}&quot;)"></div>
            <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                 class="art-img"
                 onerror="this.src='https://via.placeholder.com/300x300?text=NFT'">
            <div class="absolute inset-0 z-10"
                 style="background:linear-gradient(to bottom,transparent 25%,rgba(10,7,4,0.98) 100%);"></div>
            ${myBadge}${statusBadge}${shareBtn}
            <div class="absolute bottom-3 left-3 right-3 z-20">
                <p class="text-white font-bold text-xs truncate leading-tight">
                    ${escapeHtml(p.title)}${serialLabel}
                </p>
                <p class="text-[9px] font-bold truncate mt-0.5" style="color:rgba(255,255,255,0.38);">by @${escapeHtml((p.author||'Space_Donut').replace(/^@/,''))}</p>
                <div class="flex items-center gap-1 mt-1">
                    <img src="/gifts/stars.png" class="w-3 h-3 object-contain" onerror="this.style.display='none'">
                    <span class="text-[11px] font-black" style="color:#fcd34d;">${p.price}</span>
                    <span class="text-[9px] font-bold" style="color:rgba(255,255,255,0.4);">звёзд</span>
                </div>
            </div>
        </div>
    </div>`;
}

// ─── Строка пака в галерее ───────────────────────────────────────────────────

function nftPackGalleryRowHTML(pack, isOwner) {
    const count     = pack.paintings.length;
    const countWord = count === 1 ? 'картина' : count < 5 ? 'картины' : 'картин';

    // Статусные бейджи: если есть картины на продаже/аукционе
    const forSale   = pack.paintings.filter(p => p.status === 'for_sale').length;
    const inAuction = pack.paintings.filter(p => p.status === 'in_auction').length;
    let statusBadges = '';
    if (forSale > 0)   statusBadges += `<span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[9px] font-black flex-shrink-0" style="background:rgba(252,211,77,0.18);color:#fcd34d;">🏷 ${forSale} на продаже</span>`;
    if (inAuction > 0) statusBadges += `<span class="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-lg text-[9px] font-black flex-shrink-0" style="background:rgba(239,68,68,0.18);color:#f87171;">🔨 ${inAuction} аукцион</span>`;

    const packShareBtn = ''; // Кнопка поделиться убрана со строки пака (только внутри страницы пака)

    return `
    <div class="flex items-center gap-3 p-3.5 rounded-2xl cursor-pointer active:scale-[0.985] transition-all"
         style="background:rgba(252,211,77,0.04);border:1px solid rgba(252,211,77,0.12);"
         onclick="nftOpenPackInGallery(${pack.pack_id}, ${isOwner})">
        <div class="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0"
             style="border:1px solid rgba(252,211,77,0.2);">
            <img src="${escapeHtml(pack.pack_cover)}" class="w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/64x64?text=Pack'">
        </div>
        <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                <span class="px-2 py-0.5 rounded-lg text-[9px] font-black flex-shrink-0"
                      style="background:rgba(252,211,77,0.12);color:#fcd34d;">📦 Пак</span>
                ${statusBadges}
            </div>
            <p class="text-white font-bold text-sm truncate leading-tight">${escapeHtml(pack.pack_name)}</p>
            <p class="text-[11px] mt-0.5 font-bold" style="color:rgba(255,255,255,0.4);">${count} ${countWord}</p>
        </div>
        ${packShareBtn}
        <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:rgba(252,211,77,0.4);">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/>
        </svg>
    </div>`;
}

// ─── Открытие пака в галерее (под-страница) ───────────────────────────────────

function nftOpenPackInGallery(packId, isOwner) {
    vibrate('light');

    const allItems = nftGalleryData;
    const packItems = allItems.filter(p => p.pack_id === packId);
    if (!packItems.length) return;

    const packName   = packItems[0].pack_name || 'Пак';

    // Обновляем контекст кнопки «Поделиться»
    if (typeof nftSetShareContext === 'function') {
        nftSetShareContext({ type: 'pack', packId: packId, packName: packName });
    }
    const count      = packItems.length;
    const countWord  = count === 1 ? 'картина' : count < 5 ? 'картины' : 'картин';
    nftGalleryPackView = { packId, isOwner };

    if (nftGalleryViewContext === 'others') {
        // Вкладка «Галереи» — рендерим в nft-galleries-content
        const content = document.getElementById('nft-galleries-content');
        if (!content) return;

        const _shareOtherBtn = isOwner ? `
            <button onclick="nftShareGalleryPack(${packId}, '${packName.replace(/'/g,"\\'")}');"
                    class="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all"
                    style="background:rgba(252,211,77,0.08);border:1px solid rgba(252,211,77,0.2);">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
              </svg>
            </button>` : '';
        content.innerHTML = `
            <div class="mb-4 flex items-center justify-between">
                <div>
                    <p class="font-black text-base" style="color:#fef08a;font-family:-apple-system,BlinkMacSystemFont,sans-serif;">${escapeHtml(packName)}</p>
                    <p class="text-[9px] tracking-widest uppercase font-bold" style="color:rgba(252,211,77,0.55);">
                        Пак · ${count} ${countWord}
                    </p>
                </div>
                ${_shareOtherBtn}
            </div>
            <div class="grid grid-cols-2 gap-3.5">
                ${packItems.map(p => nftGalleryCardHTML(p, isOwner)).join('')}
            </div>`;
    } else {
        // Вкладка «Моя Галерея» — рендерим в nft-gallery-grid
        const grid    = document.getElementById('nft-gallery-grid');
        const empty   = document.getElementById('nft-gallery-empty');
        const title   = document.getElementById('nft-gallery-title');
        const backBtn = document.getElementById('nft-gallery-back-btn');
        if (!grid) return;

        backBtn.classList.remove('hidden');
        if (title) title.textContent = packName;

        empty.classList.add('hidden');
        const _sharePackBtn = isOwner ? `
            <button onclick="nftShareGalleryPack(${packId}, '${packName.replace(/'/g,"\\'")}');"
                    class="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center active:scale-90 transition-all"
                    style="background:rgba(252,211,77,0.08);border:1px solid rgba(252,211,77,0.2);">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
              </svg>
            </button>` : '';
        grid.innerHTML = `
            <div class="col-span-2 mb-3 flex items-center justify-between">
                <p class="text-[9px] tracking-widest uppercase font-bold" style="color:rgba(252,211,77,0.5);">
                    ${count} ${countWord} в паке
                </p>
                ${_sharePackBtn}
            </div>
            ${packItems.map(p => nftGalleryCardHTML(p, isOwner)).join('')}`;
    }
}

// ─── Назад из пака в галерее ─────────────────────────────────────────────────

function nftGalleryBackToList() {
    // Сбрасываем шаринг на «галерея»
    if (typeof nftSetShareContext === 'function') nftSetShareContext({ type: 'gallery' });

    if (nftGalleryPackView) {
        // Вернуться к общему виду галереи
        nftGalleryPackView = null;
        const backBtn = document.getElementById('nft-gallery-back-btn');
        if (backBtn) backBtn.classList.add('hidden');
        const title = document.getElementById('nft-gallery-title');
        if (title) title.textContent = nftViewingUserId === null ? 'Моя Галерея' : 'Галерея';
        nftRenderGalleryGrid(nftGalleryData, nftViewingUserId === null);
    } else {
        nftLoadGallery(null);
    }
}

let nftGalleriesMode = 'list'; 

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
            <div class="text-center py-16">
                <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center">
                    <svg class="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>
                    </svg>
                </div>
                <p class="nft-muted-text text-sm">Пока нет коллекционеров</p>
            </div>`;
        return;
    }

    const AVATAR_COLORS = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6','#ef4444','#14b8a6'];

    function makeCollectorAvatar(c, name) {
        const initial = name.charAt(0).toUpperCase();
        const color   = AVATAR_COLORS[Math.abs(c.tg_id || 0) % AVATAR_COLORS.length];
        if (c.photo_url) {
            return `<img src="${escapeHtml(c.photo_url)}" alt="${initial}"
                        class="w-11 h-11 rounded-full object-cover flex-shrink-0"
                        style="border:2px solid rgba(252,211,77,0.25);"
                        onerror="this.style.display='none';this.insertAdjacentHTML('afterend','<div class=\\'w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white font-black text-base\\' style=\\'background:${color};border:2px solid rgba(252,211,77,0.2);\\'>${initial}</div>')">`; 
        }
        return `<div class="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 text-white font-black text-base"
                     style="background:${color};border:2px solid rgba(252,211,77,0.2);">${initial}</div>`;
    }

    const medals         = ['🥇', '🥈', '🥉'];
    const topBorderGlow  = ['rgba(255,215,0,0.3)', 'rgba(192,192,192,0.25)', 'rgba(205,127,50,0.25)'];
    const topBgColor     = ['rgba(255,215,0,0.06)', 'rgba(255,255,255,0.04)', 'rgba(205,127,50,0.05)'];

    content.innerHTML = `<div class="space-y-2.5">
        ${collectors.map((c, i) => {
            const name = c.is_anonymous
                ? 'Анонимный'
                : (c.first_name || c.username || `User ${c.tg_id}`);

            const count     = c.collection_size;
            const countWord = count === 1 ? 'картина' : count < 5 ? 'картины' : 'картин';

            const isTop  = i < 3;
            const border = isTop ? topBorderGlow[i] : 'rgba(255,255,255,0.05)';
            const bg     = isTop ? topBgColor[i]    : 'rgba(255,255,255,0.02)';

            const rankEl = isTop
                ? `<span class="text-lg leading-none flex-shrink-0">${medals[i]}</span>`
                : `<div class="w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black flex-shrink-0"
                        style="background:rgba(252,211,77,0.1);color:rgba(252,211,77,0.7);">${i + 1}</div>`;

            const usernameHtml = (!c.is_anonymous && c.username)
                ? `<p class="text-[9px] font-bold truncate" style="color:rgba(255,255,255,0.3);">@${escapeHtml(c.username)}</p>`
                : '';

            return `
            <div class="flex items-center gap-3 px-4 py-3.5 rounded-2xl cursor-pointer active:scale-[0.985] transition-all"
                 style="background:${bg};border:1px solid ${border};"
                 onclick="nftOpenUserGalleryPage(${c.tg_id}, '${escapeHtml(name)}')">
                ${rankEl}
                ${makeCollectorAvatar(c, name)}
                <div class="flex-1 min-w-0">
                    <p class="text-white text-xs font-bold leading-none mb-0.5 truncate">${escapeHtml(name)}</p>
                    ${usernameHtml}
                    <div class="flex items-center gap-1 mt-1">
                        <span class="text-[9px] font-black" style="color:#fcd34d;">${count}</span>
                        <span class="text-[9px] font-bold" style="color:rgba(255,255,255,0.35);">${countWord}</span>
                    </div>
                </div>
                <svg class="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:rgba(252,211,77,0.4);">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M9 5l7 7-7 7"/>
                </svg>
            </div>`;
        }).join('')}
    </div>`;
}

async function nftOpenUserGalleryPage(userId, name) {
    vibrate('light');
    nftGalleriesMode      = 'viewer';
    nftGalleryViewContext = 'others';
    nftGalleryViewUserState = { userId, name };
    nftGalleryPackView    = null;

    const content = document.getElementById('nft-galleries-content');
    const backRow  = document.getElementById('nft-galleries-back-row');
    if (!content) return;

    backRow.classList.remove('hidden');
    content.innerHTML = `
        <div class="mb-4">
            <p class="font-black text-base" style="color:#fef08a;font-family:-apple-system, BlinkMacSystemFont, sans-serif;">${escapeHtml(name)}</p>
            <p class="text-[9px] tracking-widest uppercase font-bold" style="color:rgba(252,211,77,0.55);">Коллекция пользователя</p>
        </div>
        <div class="grid grid-cols-2 gap-3.5">${nftLoadingHTML()}</div>`;

    try {
        const res       = await fetch(`/api/nft/gallery/${userId}`, { headers: getApiHeaders() });
        const data      = await res.json();
        const paintings = data.gallery || [];

        nftGalleryData = paintings;

        const total     = paintings.length;
        const totalWord = total === 1 ? 'картина' : total < 5 ? 'картины' : 'картин';

        const headerHtml = `
            <div class="mb-5">
                <p class="font-black text-base" style="color:#fef08a;font-family:-apple-system, BlinkMacSystemFont, sans-serif;">${escapeHtml(name)}</p>
                <p class="text-[9px] tracking-widest uppercase font-bold" style="color:rgba(252,211,77,0.55);">
                    Коллекция пользователя · ${total} ${totalWord}
                </p>
            </div>`;

        if (paintings.length === 0) {
            content.innerHTML = headerHtml + `
                <div class="text-center py-12">
                    <p class="nft-muted-text text-xs font-bold">Галерея пуста</p>
                </div>`;
            return;
        }

        // Group by packs (same logic as nftRenderGalleryGrid)
        const packsMap   = {};
        const standalone = [];
        for (const p of paintings) {
            if (p.pack_id) {
                if (!packsMap[p.pack_id]) {
                    packsMap[p.pack_id] = {
                        pack_id: p.pack_id,
                        pack_name: p.pack_name || 'Пак',
                        pack_cover: p.pack_cover || p.image_url,
                        paintings: [],
                    };
                }
                packsMap[p.pack_id].paintings.push(p);
            } else {
                standalone.push(p);
            }
        }

        const packs         = Object.values(packsMap);
        const hasPacks      = packs.length > 0;
        const hasStandalone = standalone.length > 0;

        let gridHtml = '';

        if (hasPacks) {
            gridHtml += `<div class="space-y-3 mb-4">
                ${packs.map(pack => nftPackGalleryRowHTML(pack, false)).join('')}
            </div>`;
        }

        if (hasPacks && hasStandalone) {
            gridHtml += `
            <div class="flex items-center gap-2 mb-3">
                <div class="flex-1 h-px" style="background:rgba(255,255,255,0.06);"></div>
                <span class="text-[9px] font-black tracking-widest uppercase" style="color:rgba(255,255,255,0.2);">Отдельные картины</span>
                <div class="flex-1 h-px" style="background:rgba(255,255,255,0.06);"></div>
            </div>`;
        }

        if (hasStandalone) {
            gridHtml += `<div class="grid grid-cols-2 gap-3.5">
                ${standalone.map(p => nftGalleryCardHTML(p, false)).join('')}
            </div>`;
        } else if (!hasPacks) {
            gridHtml += `<div class="grid grid-cols-2 gap-3.5">
                ${paintings.map(p => nftGalleryCardHTML(p, false)).join('')}
            </div>`;
        }

        content.innerHTML = headerHtml + gridHtml;
    } catch (e) {
        content.innerHTML += `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

function nftGalleriesBackToList() {
    vibrate('light');

    // Если открыт пак внутри чужой галереи — вернуться к этой галерее
    if (nftGalleryPackView && nftGalleryViewContext === 'others' && nftGalleryViewUserState) {
        nftGalleryPackView = null;
        nftOpenUserGalleryPage(nftGalleryViewUserState.userId, nftGalleryViewUserState.name);
        return;
    }

    // Иначе — вернуться к списку коллекционеров
    document.getElementById('nft-galleries-back-row')?.classList.add('hidden');
    nftGalleryData          = [];
    nftGalleryViewContext   = 'mine';
    nftGalleryViewUserState = null;
    nftGalleryPackView      = null;
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
            <div class="text-center py-16">
                <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-xl flex items-center justify-center">
                    <svg class="w-8 h-8 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <p class="nft-muted-text text-sm font-bold mb-1">История пуста</p>
                <p class="nft-muted-text text-xs opacity-60 mt-1">Здесь будут отображаться ваши операции</p>
            </div>`;
        return;
    }

    const SPEND_TYPES = new Set([
        'nft_buy', 'nft_market_buy', 'nft_auction_bid',
    ]);
    const EARN_TYPES = new Set([
        'nft_topup', 'nft_stars_topup',
        'nft_market_sold', 'nft_auction_sold',
        'nft_auction_won', 'nft_auction_outbid',
    ]);

    const TYPE_ICON = {
        'nft_topup':         { emoji: '⭐', bg: 'rgba(16,185,129,0.12)',  color: '#34d399' },
        'nft_stars_topup':   { emoji: '⭐', bg: 'rgba(16,185,129,0.12)',  color: '#34d399' },
        'nft_market_sold':   { emoji: '🏷', bg: 'rgba(16,185,129,0.12)',  color: '#34d399' },
        'nft_auction_sold':  { emoji: '🔨', bg: 'rgba(16,185,129,0.12)',  color: '#34d399' },
        'nft_auction_won':   { emoji: '🏆', bg: 'rgba(252,211,77,0.12)',  color: '#fcd34d' },
        'nft_auction_outbid':{ emoji: '↩️', bg: 'rgba(16,185,129,0.12)',  color: '#34d399' },
        'nft_auction_bid':   { emoji: '🔨', bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
        'nft_buy':           { emoji: '🎨', bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
        'nft_market_buy':    { emoji: '🎨', bg: 'rgba(239,68,68,0.12)',   color: '#f87171' },
    };

    list.innerHTML = entries.map(e => {
        const isSpend = SPEND_TYPES.has(e.action_type);
        const isEarn  = EARN_TYPES.has(e.action_type);

        const textColor = isSpend ? '#f87171' : '#34d399';
        const sign      = isSpend ? '−' : '+';

        const date    = new Date(e.created_at * 1000);
        const dateStr = date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
                      + ' ' + date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

        let iconHTML;
        if (e.painting_image) {
            iconHTML = `<img src="${escapeHtml(e.painting_image)}" alt=""
                             class="w-11 h-11 rounded-xl object-cover flex-shrink-0 border"
                             style="border-color:rgba(252,211,77,0.15);"
                             onerror="this.outerHTML='<div class=\\'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0\\' style=\\'background:rgba(252,211,77,0.08);font-size:20px;\\'>🎨</div>'">`;
        } else {
            const ic = TYPE_ICON[e.action_type] || { emoji: '📋', bg: 'rgba(252,211,77,0.08)', color: '#fcd34d' };
            iconHTML = `<div class="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-xl"
                              style="background:${ic.bg};">${ic.emoji}</div>`;
        }

        return `
        <div class="flex items-center gap-3 p-3.5 rounded-2xl"
             style="background:rgba(255,255,255,0.015);border:1px solid rgba(255,255,255,0.04);">
            ${iconHTML}
            <div class="flex-1 min-w-0">
                <p class="text-white text-xs font-bold leading-tight truncate">${escapeHtml(e.description)}</p>
                <p class="text-[9px] mt-1 font-bold" style="color:rgba(255,255,255,0.35);">${dateStr}</p>
            </div>
            <div class="text-right flex-shrink-0">
                <div class="flex items-center gap-1 justify-end">
                    <p class="text-xs font-black" style="color:${textColor};">${sign}${Math.abs(e.amount)}</p>
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
window.nftPackGalleryRowHTML    = nftPackGalleryRowHTML;
window.nftOpenPackInGallery     = nftOpenPackInGallery;
window.nftLoadGalleriesPage     = nftLoadGalleriesPage;
window.nftRenderGalleriesList   = nftRenderGalleriesList;
window.nftOpenUserGalleryPage   = nftOpenUserGalleryPage;
window.nftGalleriesBackToList   = nftGalleriesBackToList;
window.nftLoadHistory           = nftLoadHistory;
window.nftRenderHistory         = nftRenderHistory;