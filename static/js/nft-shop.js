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

    const available = nftShopData.filter(p => p.available === null || p.available > 0);
    const archived  = nftShopData.filter(p => p.available !== null && p.available <= 0);

    let html = '';

    if (available.length > 0) {
        html += available.map(p => nftShopCardHTML(p)).join('');
    } else {
        html += `
            <div class="text-center py-12">
                <p class="text-yellow-500/50 text-sm font-medium">Все картины временно распроданы</p>
            </div>`;
    }

    if (archived.length > 0) {
        html += `
        <div class="mt-8 mb-4">
            <div class="flex items-center gap-3">
                <div class="flex-1 h-px" style="background:linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);"></div>
                <div class="flex items-center gap-1.5">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:rgba(252,211,77,0.55);">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8l1 12a2 2 0 002 2h8a2 2 0 002-2L19 8M10 12v4m4-4v4"/>
                    </svg>
                    <span class="text-[10px] font-black tracking-[0.2em] uppercase" style="color:rgba(252,211,77,0.55);">Архив</span>
                </div>
                <div class="flex-1 h-px" style="background:linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent);"></div>
            </div>
            <p class="text-center text-[9px] tracking-widest uppercase mt-1.5" style="color:rgba(252,211,77,0.35);">Завершённые коллекции</p>
        </div>
        <div class="space-y-4 opacity-50">
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
        ? `<div class="absolute top-3 left-3 px-3 py-1 rounded-xl text-[10px] font-black"
                style="background:rgba(252,211,77,0.95);color:#0a0704;backdrop-filter:blur(8px);box-shadow:0 4px 10px rgba(0,0,0,0.3);">
               ${isSoldOut ? '🔴 Распродано' : `🔥 ${remain} из ${p.total_supply}`}
           </div>`
        : `<div class="absolute top-3 left-3 px-3 py-1 rounded-xl text-[10px] font-black"
                style="background:rgba(99,102,241,0.85);color:#ffffff;backdrop-filter:blur(8px);box-shadow:0 4px 10px rgba(0,0,0,0.3);">♾ Неограниченный</div>`;

    return `
    <div class="nft-card cursor-pointer relative"
         onclick="nftOpenPainting(${p.id})">
        <div class="relative w-full" style="padding-top:64%;">
            <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                 class="absolute inset-0 w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/400x260?text=NFT'">
            <div class="absolute inset-0" style="background:linear-gradient(to bottom,transparent 40%,rgba(10,7,4,0.98) 100%);"></div>
            ${badgeHTML}
        </div>
        <div class="p-4 relative z-10">
            <h4 class="text-white font-bold text-sm leading-tight mb-1 truncate">${escapeHtml(p.title)}</h4>
            ${p.description ? `<p class="text-xs mb-3 line-clamp-2" style="color:rgba(255,255,255,0.45);">${escapeHtml(p.description)}</p>` : ''}
            <div class="flex items-center gap-1.5">
                <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
                <span class="font-black text-sm" style="color:#fcd34d;">${p.price}</span>
                <span class="text-[10px] font-bold" style="color:rgba(255,255,255,0.45);">звёзд</span>
            </div>
        </div>
    </div>`;
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.nftLoadShop    = nftLoadShop;
window.nftRenderShop  = nftRenderShop;
window.nftShopCardHTML = nftShopCardHTML;