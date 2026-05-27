// =====================================================
// nft-shop.js — NFT Магазин: одиночные картины + паки
// Зависимости: nft-core.js, nft-modal.js
// =====================================================

let nftPacksData         = [];   // паки из API
let nftArchivedPacksData = [];   // архивные паки (все картины распроданы)
let nftCurrentPackModal  = null; // открытый пак в модальном окне
let nftPackSelectedIdx   = 0;    // индекс выбранной картины в паке

// ─── Загрузка магазина ────────────────────────────────────────────────────────

async function nftLoadShop() {
    const list = document.getElementById('nft-shop-list');
    if (!list) return;

    list.innerHTML = nftLoadingHTML();

    try {
        const res  = await fetch('/api/nft/shop', { headers: getApiHeaders() });
        const data = await res.json();
        nftShopData          = data.paintings      || [];
        nftPacksData         = data.packs          || [];
        nftArchivedPacksData = data.archived_packs || [];
        nftRenderShop();
    } catch (e) {
        list.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

// ─── Рендер магазина ──────────────────────────────────────────────────────────

function nftRenderShop() {
    const list = document.getElementById('nft-shop-list');
    if (!list) return;

    const hasStandalone   = nftShopData.length > 0;
    const hasPacks        = nftPacksData.length > 0;
    const hasArchivedPacks = nftArchivedPacksData.length > 0;

    if (!hasStandalone && !hasPacks && !hasArchivedPacks) {
        list.innerHTML = `
            <div class="text-center py-16">
                <div class="w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center"
                     style="background:rgba(252,211,77,0.06);border:1px solid rgba(252,211,77,0.18);">
                    <svg class="w-7 h-7 text-yellow-500/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                </div>
                <p class="text-yellow-500/70 text-sm font-bold">Нет доступных картин</p>
                <p class="text-yellow-500/40 text-xs mt-1">Скоро появятся новые работы</p>
            </div>`;
        return;
    }

    let html = '';

    // ── Паки ─────────────────────────────────────────────────────────────────
    if (hasPacks) {
        html += `
        <div class="mb-6">
          <div class="flex items-center gap-2 mb-3.5 px-0.5">
            <div class="flex-1 h-px" style="background:rgba(252,211,77,0.12);"></div>
            <span class="text-[10px] font-black tracking-[0.18em] uppercase" style="color:rgba(252,211,77,0.55);">📦 Паки</span>
            <div class="flex-1 h-px" style="background:rgba(252,211,77,0.12);"></div>
          </div>
          <div class="space-y-4">
            ${nftPacksData.map(pack => nftPackCardHTML(pack)).join('')}
          </div>
        </div>`;
    }

    // ── Одиночные картины (свайп-карусель) ───────────────────────────────────
    if (hasStandalone) {
        const available = nftShopData.filter(p => p.available === null || p.available > 0);
        const archived  = nftShopData.filter(p => p.available !== null && p.available <= 0);

        if (hasPacks && hasStandalone) {
            html += `
            <div class="flex items-center gap-2 mb-3.5 px-0.5">
                <div class="flex-1 h-px" style="background:rgba(252,211,77,0.12);"></div>
                <span class="text-[10px] font-black tracking-[0.18em] uppercase" style="color:rgba(252,211,77,0.55);">🎨 Картины</span>
                <div class="flex-1 h-px" style="background:rgba(252,211,77,0.12);"></div>
            </div>`;
        }

        if (available.length > 0) {
            // Горизонтальная свайп-карусель
            html += `
            <div class="nft-swipe-hint text-[9px] text-center mb-2 font-bold tracking-widest uppercase"
                 style="color:rgba(252,211,77,0.35);">← свайп →</div>
            <div class="nft-shop-carousel flex gap-3 overflow-x-auto pb-3 -mx-4 px-4"
                 style="scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;">
              ${available.map(p => nftShopCarouselCardHTML(p)).join('')}
            </div>`;
        } else {
            html += `<div class="text-center py-8"><p class="text-yellow-500/50 text-sm font-medium">Все картины временно распроданы</p></div>`;
        }

        if (archived.length > 0) {
            html += `
            <div class="mt-8 mb-4">
                <div class="flex items-center gap-3">
                    <div class="flex-1 h-px" style="background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent);"></div>
                    <span class="text-[10px] font-black tracking-[0.2em] uppercase" style="color:rgba(252,211,77,0.55);">Архив</span>
                    <div class="flex-1 h-px" style="background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent);"></div>
                </div>
            </div>
            <div class="nft-shop-carousel flex gap-3 overflow-x-auto pb-3 -mx-4 px-4 opacity-50"
                 style="scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;scrollbar-width:none;">
              ${archived.map(p => nftShopCarouselCardHTML(p)).join('')}
            </div>`;
        }
    }

    // ── Архивные паки (все картины распроданы) ────────────────────────────────
    if (hasArchivedPacks) {
        html += `
        <div class="mt-8 mb-4">
            <div class="flex items-center gap-3">
                <div class="flex-1 h-px" style="background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent);"></div>
                <span class="text-[10px] font-black tracking-[0.2em] uppercase" style="color:rgba(252,211,77,0.35);">🗄 Архив паков</span>
                <div class="flex-1 h-px" style="background:linear-gradient(90deg,transparent,rgba(255,255,255,0.1),transparent);"></div>
            </div>
        </div>
        <div class="space-y-4 opacity-60">
            ${nftArchivedPacksData.map(pack => nftArchivedPackCardHTML(pack)).join('')}
        </div>`;
    }

    list.innerHTML = html;
}

// ─── Карточка карусели (свайп в магазине) ─────────────────────────────────────

function nftShopCarouselCardHTML(p) {
    const isSoldOut = p.available !== null && p.available <= 0;
    const limited   = p.total_supply > 0;
    const remain    = p.available;

    const badgeHTML = limited
        ? `<div class="absolute top-3 left-3 px-2.5 py-1 rounded-xl text-[10px] font-black"
                style="background:rgba(252,211,77,0.95);color:#0a0704;box-shadow:0 4px 10px rgba(0,0,0,0.3);">
               ${isSoldOut ? `🔴 0 из ${p.total_supply}` : `🔥 ${remain} из ${p.total_supply}`}
           </div>`
        : `<div class="absolute top-3 left-3 px-2.5 py-1 rounded-xl text-[10px] font-black"
                style="background:rgba(99,102,241,0.85);color:#fff;box-shadow:0 4px 10px rgba(0,0,0,0.3);">♾ Безлимит</div>`;

    return `
    <div class="flex-shrink-0 nft-card cursor-pointer relative overflow-hidden"
         style="width:72vw;max-width:300px;scroll-snap-align:start;border-radius:1.5rem;"
         onclick="nftOpenPainting(${p.id})">
        <div class="relative w-full" style="padding-top:68%;">
            <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                 class="absolute inset-0 w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/300x200?text=NFT'">
            <div class="absolute inset-0" style="background:linear-gradient(to bottom,transparent 35%,rgba(10,7,4,0.98) 100%);"></div>
            ${badgeHTML}
        </div>
        <div class="p-4 relative z-10">
            <h4 class="text-white font-bold text-sm leading-tight mb-1 truncate">${escapeHtml(p.title)}</h4>
            ${p.description ? `<p class="text-xs mb-2.5 line-clamp-2" style="color:rgba(255,255,255,0.45);">${escapeHtml(p.description)}</p>` : ''}
            <div class="flex items-center gap-1.5">
                <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
                <span class="font-black text-sm" style="color:#fcd34d;">${p.price}</span>
                <span class="text-[10px] font-bold" style="color:rgba(255,255,255,0.45);">звёзд</span>
            </div>
        </div>
    </div>`;
}

// ─── Карточка пака ────────────────────────────────────────────────────────────

function nftPackCardHTML(pack) {
    const count     = pack.paintings.length;
    const countWord = count === 1 ? 'картина' : count < 5 ? 'картины' : 'картин';
    const cover     = pack.cover_image_url || (pack.paintings[0]?.image_url || '');

    // Маленькие превью картин (до 4-х)
    const thumbs = pack.paintings.slice(0, 4).map(p =>
        `<div class="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" style="border:1px solid rgba(252,211,77,0.15);">
            <img src="${escapeHtml(p.image_url)}" class="w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/40x40?text=NFT'">
         </div>`
    ).join('');

    const moreCount = pack.paintings.length > 4 ? pack.paintings.length - 4 : 0;
    const moreBadge = moreCount > 0
        ? `<div class="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-[11px] font-black"
                style="background:rgba(252,211,77,0.08);color:#fcd34d;border:1px solid rgba(252,211,77,0.15);">+${moreCount}</div>`
        : '';

    return `
    <div class="nft-card overflow-hidden cursor-pointer active:scale-[0.985] transition-all"
         onclick="nftOpenPackModal(${pack.id})">
        <!-- Обложка пака -->
        <div class="relative w-full" style="padding-top:52%;">
            <img src="${escapeHtml(cover)}" alt="${escapeHtml(pack.name)}"
                 class="absolute inset-0 w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/400x208?text=Pack'">
            <div class="absolute inset-0" style="background:linear-gradient(to bottom,rgba(10,7,4,0.1) 0%,rgba(10,7,4,0.92) 100%);"></div>
            <!-- Бейдж пака -->
            <div class="absolute top-3 left-3 px-2.5 py-1 rounded-xl text-[10px] font-black"
                 style="background:rgba(252,211,77,0.95);color:#0a0704;">📦 Пак · ${count} ${countWord}</div>
            <!-- Название на фото -->
            <div class="absolute bottom-3 left-4 right-4">
                <h4 class="text-white font-black text-base leading-tight truncate">${escapeHtml(pack.name)}</h4>
                ${pack.description ? `<p class="text-[11px] mt-0.5 line-clamp-1" style="color:rgba(255,255,255,0.55);">${escapeHtml(pack.description)}</p>` : ''}
            </div>
        </div>
        <!-- Превью картин + кнопка -->
        <div class="px-4 py-3.5 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
                ${thumbs}${moreBadge}
            </div>
            <button class="flex-shrink-0 px-4 py-2 rounded-xl text-xs font-black active:scale-95 transition-all nft-buy-btn"
                    onclick="event.stopPropagation();nftOpenPackModal(${pack.id})">
                Открыть пак
            </button>
        </div>
    </div>`;
}

// ─── Открытие модального окна пака ───────────────────────────────────────────

function nftOpenPackModal(packId) {
    vibrate('medium');
    let pack = nftPacksData.find(p => p.id === packId);
    const isArchived = !pack;
    if (isArchived) pack = nftArchivedPacksData.find(p => p.id === packId);
    if (!pack || !pack.paintings.length) return;

    nftCurrentPackModal = { ...pack, _archived: isArchived };
    nftPackSelectedIdx  = 0;

    document.getElementById('nft-pack-modal-name').textContent = pack.name;
    document.getElementById('nft-pack-modal-desc').textContent = pack.description || '';

    _nftRenderPackThumbs(nftCurrentPackModal);
    _nftRenderPackSelected(0);

    document.getElementById('nft-pack-modal').classList.remove('hidden');
}

function _nftRenderPackThumbs(pack) {
    const container = document.getElementById('nft-pack-modal-thumbs');
    if (!container) return;
    container.innerHTML = pack.paintings.map((p, i) => `
        <div id="pack-thumb-${i}"
             class="flex-shrink-0 rounded-xl overflow-hidden cursor-pointer transition-all active:scale-95"
             style="width:64px;height:64px;border:2px solid ${i === 0 ? 'rgba(252,211,77,0.8)' : 'rgba(255,255,255,0.08)'};"
             onclick="nftPackSelectPainting(${i})">
            <img src="${escapeHtml(p.image_url)}" class="w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/64x64?text=NFT'">
        </div>`
    ).join('');
}

function nftPackSelectPainting(idx) {
    vibrate('light');
    if (!nftCurrentPackModal) return;
    nftPackSelectedIdx = idx;

    // Обновляем рамки миниатюр
    nftCurrentPackModal.paintings.forEach((_, i) => {
        const el = document.getElementById(`pack-thumb-${i}`);
        if (el) el.style.borderColor = i === idx ? 'rgba(252,211,77,0.8)' : 'rgba(255,255,255,0.08)';
    });

    _nftRenderPackSelected(idx);
}

function _nftRenderPackSelected(idx) {
    const pack    = nftCurrentPackModal;
    if (!pack) return;
    const p       = pack.paintings[idx];
    if (!p) return;

    // Большое изображение
    const img = document.getElementById('nft-pack-modal-main-img');
    if (img) {
        img.style.opacity = '0';
        setTimeout(() => {
            img.src = p.image_url;
            img.style.opacity = '1';
        }, 150);
    }

    // Данные картины
    const info = document.getElementById('nft-pack-modal-painting-info');
    if (!info) return;

    const isArchived = !!(pack && pack._archived);
    const isSoldOut  = isArchived || (p.available !== null && p.available <= 0);
    const limited    = p.total_supply > 0;
    const remain     = p.available;

    const supplyBadge = isArchived
        ? `<span class="px-2.5 py-0.5 rounded-xl text-[10px] font-black"
                style="background:rgba(100,100,100,0.2);color:rgba(255,255,255,0.4);">🗄 Архив</span>`
        : limited
            ? `<span class="px-2.5 py-0.5 rounded-xl text-[10px] font-black"
                    style="background:${isSoldOut ? 'rgba(239,68,68,0.15)' : 'rgba(252,211,77,0.12)'};color:${isSoldOut ? '#f87171' : '#fcd34d'};">
                   ${isSoldOut ? `🔴 0 из ${p.total_supply}` : `🔥 ${remain} из ${p.total_supply}`}
               </span>`
            : `<span class="px-2.5 py-0.5 rounded-xl text-[10px] font-black"
                    style="background:rgba(99,102,241,0.15);color:#a5b4fc;">♾ Безлимит</span>`;

    const actionBlock = isArchived
        ? `<div class="w-full py-4 rounded-2xl font-black text-sm text-center mb-2.5"
                style="background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.3);">
               🗄 Пак в архиве — все картины распроданы
           </div>`
        : `<button onclick="nftBuyFromPackModal()"
                class="w-full py-4 rounded-2xl font-black text-sm active:scale-[0.97] transition-all ${isSoldOut ? '' : 'nft-buy-btn'} mb-2.5"
                ${isSoldOut ? 'disabled style="background:rgba(239,68,68,0.2);color:#ffffff;"' : ''}>
               ${isSoldOut ? `Распродано · 0 из ${p.total_supply}` : `Купить за ${p.price} ⭐`}
           </button>`;

    info.innerHTML = `
        <div class="flex items-start justify-between gap-2 mb-1.5">
            <h4 class="font-black text-base text-white leading-tight">${escapeHtml(p.title)}</h4>
            ${supplyBadge}
        </div>
        ${p.description ? `<p class="text-xs mb-3 leading-relaxed" style="color:rgba(255,255,255,0.5);">${escapeHtml(p.description)}</p>` : ''}
        <div class="flex items-center justify-between p-3.5 rounded-2xl mb-4 nft-price-block">
            <span class="text-xs nft-price-label">Цена</span>
            <div class="flex items-center gap-1.5">
                <img src="/gifts/stars.png" class="w-5 h-5 object-contain" onerror="this.style.display='none'">
                <span class="font-black text-lg nft-price-value">${p.price}</span>
                <span class="text-[10px] nft-price-unit">звёзд</span>
            </div>
        </div>
        ${actionBlock}`;
}

async function nftBuyFromPackModal() {
    const pack = nftCurrentPackModal;
    if (!pack) return;
    const p = pack.paintings[nftPackSelectedIdx];
    if (!p) return;
    vibrate('medium');

    // Переиспользуем nftModalPainting для покупки
    nftModalPainting = p;
    await nftBuyFromModal();

    // После покупки обновляем данные пака
    if (nftCurrentPackModal) {
        const updatedPack = nftPacksData.find(pk => pk.id === pack.id);
        if (updatedPack) {
            const updatedP = updatedPack.paintings[nftPackSelectedIdx];
            if (updatedP && updatedP.available !== null) updatedP.available--;
        }
        _nftRenderPackSelected(nftPackSelectedIdx);
    }
}

// ─── Карточка архивного пака (распродан) ─────────────────────────────────────

function nftArchivedPackCardHTML(pack) {
    const count     = pack.paintings.length;
    const countWord = count === 1 ? 'картина' : count < 5 ? 'картины' : 'картин';
    const cover     = pack.cover_image_url || (pack.paintings[0]?.image_url || '');

    const paintingRows = pack.paintings.map(p =>
        `<div class="flex items-center gap-3 py-2" style="border-bottom:1px solid rgba(255,255,255,0.05);">
            <div class="w-9 h-9 rounded-lg overflow-hidden flex-shrink-0" style="border:1px solid rgba(255,255,255,0.08);">
                <img src="${escapeHtml(p.image_url)}" class="w-full h-full object-cover grayscale"
                     onerror="this.src='https://via.placeholder.com/36x36?text=NFT'">
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-[11px] font-bold truncate" style="color:rgba(255,255,255,0.55);">${escapeHtml(p.title)}</p>
            </div>
            <div class="flex-shrink-0 text-[10px] font-black px-2 py-0.5 rounded-lg"
                 style="background:rgba(239,68,68,0.12);color:#f87171;">
                0 из ${p.total_supply}
            </div>
        </div>`
    ).join('');

    return `
    <div class="nft-card overflow-hidden cursor-pointer active:scale-[0.985] transition-all" style="filter:grayscale(0.4);"
         onclick="nftOpenPackModal(${pack.id})">
        <div class="relative w-full" style="padding-top:52%;">
            <img src="${escapeHtml(cover)}" alt="${escapeHtml(pack.name)}"
                 class="absolute inset-0 w-full h-full object-cover grayscale"
                 onerror="this.src='https://via.placeholder.com/400x208?text=Pack'">
            <div class="absolute inset-0" style="background:linear-gradient(to bottom,rgba(10,7,4,0.3) 0%,rgba(10,7,4,0.95) 100%);"></div>
            <div class="absolute top-3 left-3 px-2.5 py-1 rounded-xl text-[10px] font-black"
                 style="background:rgba(100,100,100,0.7);color:#ccc;">🗄 Архив · ${count} ${countWord}</div>
            <div class="absolute bottom-3 left-4 right-4">
                <h4 class="font-black text-base leading-tight truncate" style="color:rgba(255,255,255,0.6);">${escapeHtml(pack.name)}</h4>
                <p class="text-[11px] mt-0.5" style="color:rgba(255,255,255,0.35);">Все картины распроданы</p>
            </div>
        </div>
        <div class="px-4 pt-3 pb-1">
            ${paintingRows}
        </div>
        <div class="px-4 py-3 flex justify-end">
            <div class="px-4 py-2 rounded-xl text-xs font-black"
                 style="background:rgba(255,255,255,0.05);color:rgba(255,255,255,0.3);">Посмотреть пак →</div>
        </div>
    </div>`;
}

// ─── Совместимость: nftShopCardHTML для внешних вызовов ──────────────────────

function nftShopCardHTML(p) {
    return nftShopCarouselCardHTML(p);
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.nftLoadShop             = nftLoadShop;
window.nftRenderShop           = nftRenderShop;
window.nftShopCardHTML         = nftShopCardHTML;
window.nftShopCarouselCardHTML = nftShopCarouselCardHTML;
window.nftPackCardHTML         = nftPackCardHTML;
window.nftArchivedPackCardHTML = nftArchivedPackCardHTML;
window.nftOpenPackModal        = nftOpenPackModal;
window.nftPackSelectPainting   = nftPackSelectPainting;
window.nftBuyFromPackModal     = nftBuyFromPackModal;
