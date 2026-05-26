// =====================================================
// nft-shop.js — NFT Галерея: Магазин картин
// Зависимости: nft-core.js (nftShopData, nftLoadingHTML, getApiHeaders, escapeHtml)
// =====================================================

// ─── Загрузка магазина ────────────────────────────────────────────────────────

async function nftLoadShop() {
    const list = document.getElementById('nft-shop-list');
    if (!list) return;

    list.innerHTML = nftLoadingHTML();

    try {
        const res  = await fetch('/api/nft/shop', { headers: getApiHeaders() });
        const data = await res.json();
        nftShopData = data.paintings || [];
        nftRenderShop();
    } catch (e) {
        list.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

// ─── Рендер магазина ──────────────────────────────────────────────────────────

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

// ─── Карточка магазина ────────────────────────────────────────────────────────

function nftShopCardHTML(p) {
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

    return `
    <div class="nft-card cursor-pointer"
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
            <div class="flex items-center gap-1">
                <img src="/gifts/stars.png" class="w-3.5 h-3.5 object-contain" onerror="this.style.display='none'">
                <span class="font-black text-sm" style="color:#fbbf24;">${p.price}</span>
                <span class="text-[10px]" style="color:rgba(251,191,36,0.5);">звёзд</span>
            </div>
        </div>
    </div>`;
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.nftLoadShop    = nftLoadShop;
window.nftRenderShop  = nftRenderShop;
window.nftShopCardHTML = nftShopCardHTML;