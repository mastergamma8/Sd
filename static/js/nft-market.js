// =====================================================
// nft-market.js — NFT Маркетплейс и Аукционы
// Зависимости: nft-core.js, nft-gallery.js
// =====================================================

// ─── Состояние ────────────────────────────────────────────────────────────────

let nftMarketListings  = [];
let nftAuctions        = [];
let nftMarketPendingId = null;  
let nftAuctionPending  = null;  
let nftSellTarget      = null;  
let nftAuctionTarget   = null;  

let _auctionIntervalIds = [];


// ─── Маркетплейс: загрузка и рендер ──────────────────────────────────────────

async function nftLoadMarket() {
    const wrap = document.getElementById('nft-market-list');
    if (!wrap) return;

    wrap.innerHTML = nftLoadingHTML();
    try {
        const res  = await fetch('/api/nft/market/listings', { headers: getApiHeaders() });
        const data = await res.json();
        nftMarketListings = data.listings || [];
        nftRenderMarket();
    } catch (e) {
        wrap.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

function nftRenderMarket() {
    const wrap = document.getElementById('nft-market-list');
    if (!wrap) return;

    if (nftMarketListings.length === 0) {
        wrap.innerHTML = `
        <div class="text-center py-16">
          <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center">
            <svg class="w-8 h-8 opacity-35" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
            </svg>
          </div>
          <p class="nft-muted-text text-sm font-bold">Маркетплейс пуст</p>
          <p class="nft-muted-text text-xs opacity-65 mt-1.5 leading-relaxed">Выставьте свою картину на продажу из «Моей галереи»</p>
        </div>`;
        return;
    }

    wrap.innerHTML = nftMarketListings.map(l => nftListingCardHTML(l)).join('');
}

function nftListingCardHTML(l) {
    const serial     = l.serial_number > 0
        ? ` <span style="color:#fcd34d;">#${l.serial_number}</span>` : '';
    const sellerName = l.is_anonymous
        ? 'Аноним'
        : (l.username ? `@${escapeHtml(l.username)}` : escapeHtml(l.first_name || ''));
    const ago = nftTimeAgo(l.created_at);

    const actionBtn = l.is_mine
        ? `<button onclick="nftCancelListing(${l.id})"
                   class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                   style="background:rgba(239,68,68,0.12);color:rgba(239,68,68,0.9);border:1px solid rgba(239,68,68,0.25);">
             Снять с продажи
           </button>`
        : `<button onclick="nftConfirmBuyListing(${l.id}, ${l.price}, '${escapeHtml(l.title)}')"
                   class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all nft-buy-btn">
             Купить
           </button>`;

    return `
    <div class="nft-card mb-4">
      <div class="flex gap-3.5 p-4 cursor-pointer active:bg-white/[0.03] transition-colors rounded-t-3xl"
           onclick="nftOpenListingDetail(${l.id})">
        <div class="flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden"
             style="border:1px solid rgba(252,211,77,0.15);">
          <img src="${escapeHtml(l.image_url)}" alt="${escapeHtml(l.title)}"
               class="w-full h-full object-cover"
               onerror="this.src='https://via.placeholder.com/80x80?text=NFT'">
        </div>
        <div class="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <p class="font-bold text-sm truncate text-white">${escapeHtml(l.title)}${serial}</p>
            <p class="text-[10px] mt-0.5 truncate font-bold" style="color:rgba(255,255,255,0.4);">${sellerName} · ${ago}</p>
          </div>
          <div class="flex items-center gap-1.5 mt-1.5">
            <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
            <span class="font-black text-base" style="color:#fcd34d;">${l.price}</span>
            <span class="text-[10px] font-bold" style="color:rgba(255,255,255,0.45);">NFT-звёзд</span>
          </div>
        </div>
      </div>
      <div class="px-4 pb-4">${actionBtn}</div>
    </div>`;
}

// ─── Подтверждение и исполнение покупки ───────────────────────────────────────

function nftConfirmBuyListing(listingId, price, title) {
    vibrate('medium');
    nftMarketPendingId = listingId;
    document.getElementById('nft-buy-confirm-title').textContent = title;
    document.getElementById('nft-buy-confirm-price').textContent = price;
    document.getElementById('nft-buy-confirm-stars').textContent = nftStars;
    document.getElementById('nft-buy-confirm-modal').classList.remove('hidden');
}

async function nftExecuteBuyListing() {
    if (!nftMarketPendingId) return;
    vibrate('medium');

    const btn = document.getElementById('nft-buy-confirm-btn');
    btn.textContent = 'Покупка...';
    btn.disabled    = true;

    try {
        const res  = await fetch(`/api/nft/market/buy/${nftMarketPendingId}`, {
            method: 'POST', headers: getApiHeaders(),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotify(data.detail || 'Ошибка покупки', 'error');
        } else {
            nftStars = data.nft_stars;
            nftUpdateStarsUI();
            showNotify('🎨 Картина добавлена в вашу коллекцию!', 'success');
            vibrate('heavy');
            closeNFTModal('nft-buy-confirm-modal');
            await nftLoadMarket();
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    } finally {
        btn.textContent    = 'Подтвердить покупку';
        btn.disabled       = false;
        nftMarketPendingId = null;
    }
}

async function nftCancelListing(listingId) {
    vibrate('light');
    try {
        const res  = await fetch(`/api/nft/market/cancel/${listingId}`, {
            method: 'POST', headers: getApiHeaders(),
        });
        const data = await res.json();
        if (!res.ok) {
            showNotify(data.detail || 'Ошибка', 'error');
        } else {
            showNotify('Листинг снят', 'success');
            await nftLoadMarket();
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    }
}

// ─── Детальный просмотр листинга ─────────────────────────────────────────────

function nftOpenListingDetail(listingId) {
    vibrate('light');
    const l = nftMarketListings.find(x => x.id === listingId);
    if (!l) return;

    document.getElementById('nft-modal-image').src          = l.image_url;
    document.getElementById('nft-modal-desc').textContent   = l.description || '';
    document.getElementById('nft-modal-price').textContent  = l.price;

    const titleEl = document.getElementById('nft-modal-title');
    const serial  = l.serial_number;
    if (serial && serial > 0) {
        titleEl.innerHTML = `${escapeHtml(l.title)} <span style="color:#fcd34d;font-size:0.75em;">#${serial}</span>`;
    } else {
        titleEl.textContent = l.title;
    }

    const serialRow = document.getElementById('nft-modal-serial-row');
    const serialNum = document.getElementById('nft-modal-serial-num');
    if (serialRow && serialNum) {
        if (serial && serial > 0) {
            serialNum.textContent = `#${serial}`;
            serialRow.classList.remove('hidden');
            serialRow.style.display = 'flex';
        } else {
            serialRow.classList.add('hidden');
            serialRow.style.display = '';
        }
    }

    const sellerRow  = document.getElementById('nft-modal-seller-row');
    const sellerName = document.getElementById('nft-modal-seller-name');
    if (sellerRow && sellerName) {
        const name = l.is_anonymous
            ? 'Аноним'
            : (l.username ? `@${l.username}` : (l.first_name || 'Пользователь'));
        sellerName.textContent = name;
        sellerRow.classList.remove('hidden');
        sellerRow.style.display = 'flex';
    }

    const statusBadgeEl = document.getElementById('nft-modal-status-badge');
    if (statusBadgeEl) {
        statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-for-sale">На продаже</span>`;
        statusBadgeEl.classList.remove('hidden');
    }

    const badge = document.getElementById('nft-modal-badge');
    if (badge) badge.style.display = 'none';

    const supplyRow  = document.getElementById('nft-modal-supply-row');
    const supplyText = document.getElementById('nft-modal-supply-text');
    if (supplyRow && supplyText) {
        if (l.total_supply > 0) {
            const remaining = (l.available !== null && l.available !== undefined)
                ? l.available
                : (l.total_supply - (l.sold_count || 0));
            supplyText.textContent = `${remaining} из ${l.total_supply}`;
            supplyRow.classList.remove('hidden');
            supplyRow.style.display = 'flex';
        } else {
            supplyRow.classList.add('hidden');
            supplyRow.style.display = '';
        }
    }

    const ownerActions = document.getElementById('nft-modal-owner-actions');
    if (ownerActions) ownerActions.classList.add('hidden');

    const priceBlock = document.getElementById('nft-modal-price')?.closest('.nft-price-block');
    const buyBtn     = document.getElementById('nft-modal-buy-btn');
    if (priceBlock) priceBlock.style.display = '';

    if (l.is_mine) {
        buyBtn.style.display = 'none';
    } else {
        buyBtn.style.display    = '';
        buyBtn.disabled         = false;
        buyBtn.innerHTML        = `Купить за ${l.price} <img src="/gifts/stars.png" class="w-4 h-4 inline-block align-middle ml-1 object-contain" onerror="this.style.display='none'">`;
        buyBtn.style.background = 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 100%)';
        buyBtn.style.boxShadow  = '0 10px 24px -4px rgba(245,158,11,0.4)';
        buyBtn.style.color      = '#0a0704';
        buyBtn.onclick = () => {
            closeNFTModal('nft-painting-modal');
            nftConfirmBuyListing(l.id, l.price, l.title);
        };
    }

    document.getElementById('nft-painting-modal').classList.remove('hidden');
}

// ─── Листинг: форма создания ──────────────────────────────────────────────────

function nftOpenListModal(ownedId, title, imageUrl) {
    vibrate('medium');
    nftSellTarget = { owned_id: ownedId };
    document.getElementById('nft-list-modal-title').textContent = title;
    document.getElementById('nft-list-modal-img').src           = imageUrl;
    document.getElementById('nft-list-price-input').value       = '';
    document.getElementById('nft-list-modal').classList.remove('hidden');
}

async function nftSubmitListing() {
    if (!nftSellTarget) return;
    const price = parseInt(document.getElementById('nft-list-price-input').value, 10);
    if (!price || price <= 0) {
        showNotify('Укажите корректную цену', 'error');
        return;
    }

    vibrate('medium');
    const btn = document.getElementById('nft-list-submit-btn');
    btn.textContent = 'Выставляем...';
    btn.disabled    = true;

    try {
        const res  = await fetch('/api/nft/market/list', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ nft_owned_id: nftSellTarget.owned_id, price }),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotify(data.detail || 'Ошибка', 'error');
        } else {
            showNotify('🏷 Картина выставлена на продажу!', 'success');
            vibrate('heavy');
            closeNFTModal('nft-list-modal');
            nftSellTarget = null;
            await nftLoadGallery(null);
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    } finally {
        btn.textContent = 'Выставить на продажу';
        btn.disabled    = false;
    }
}


// ─── Аукционы: загрузка и рендер ─────────────────────────────────────────────

async function nftLoadAuctions() {
    const wrap = document.getElementById('nft-auction-list');
    if (!wrap) return;

    _auctionIntervalIds.forEach(clearInterval);
    _auctionIntervalIds = [];

    wrap.innerHTML = nftLoadingHTML();
    try {
        const res  = await fetch('/api/nft/auction/list', { headers: getApiHeaders() });
        const data = await res.json();
        nftAuctions = data.auctions || [];
        nftRenderAuctions();
    } catch (e) {
        wrap.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">Ошибка загрузки</div>`;
    }
}

function nftRenderAuctions() {
    const wrap = document.getElementById('nft-auction-list');
    if (!wrap) return;

    if (nftAuctions.length === 0) {
        wrap.innerHTML = `
        <div class="text-center py-16">
          <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center">
            <svg class="w-8 h-8 opacity-35" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
          </div>
          <p class="nft-muted-text text-sm font-bold">Нет активных аукционов</p>
          <p class="nft-muted-text text-xs opacity-65 mt-1.5 leading-relaxed">Запустите торги из «Моей галереи»</p>
        </div>`;
        return;
    }

    wrap.innerHTML = nftAuctions.map(a => nftAuctionCardHTML(a)).join('');

    nftAuctions.forEach(a => nftStartCountdown(a.id, a.ends_at));
}

function nftAuctionCardHTML(a) {
    const serial     = a.serial_number > 0
        ? ` <span style="color:#fcd34d;">#${a.serial_number}</span>` : '';
    const sellerName = a.is_anonymous
        ? 'Аноним'
        : (a.username ? `@${escapeHtml(a.username)}` : escapeHtml(a.first_name || ''));
    const hasBids = !!a.current_bidder;

    let actionBtn;
    if (a.is_mine && !hasBids) {
        actionBtn = `<button onclick="nftCancelAuction(${a.id})"
                             class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                             style="background:rgba(239,68,68,0.12);color:rgba(239,68,68,0.9);border:1px solid rgba(239,68,68,0.25);">
                       Отменить
                     </button>`;
    } else if (a.is_mine) {
        actionBtn = `<div class="w-full py-3.5 rounded-2xl text-xs font-black text-center"
                          style="background:rgba(252,211,77,0.06);color:rgba(252,211,77,0.5);border:1px solid rgba(252,211,77,0.15);">
                       Ваш аукцион
                     </div>`;
    } else if (a.is_leading) {
        actionBtn = `<button onclick="nftOpenBidModal(${a.id}, ${a.current_price}, '${escapeHtml(a.title)}')"
                             class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                             style="background:rgba(16,185,129,0.15);color:rgba(16,185,129,0.9);border:1px solid rgba(16,185,129,0.3);">
                       ✓ Вы лидируете · Перебить
                     </button>`;
    } else {
        actionBtn = `<button onclick="nftOpenBidModal(${a.id}, ${a.current_price}, '${escapeHtml(a.title)}')"
                             class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all nft-buy-btn">
                       🔨 Сделать ставку
                     </button>`;
    }

    const bidInfo = hasBids
        ? `<span class="text-[9px] font-bold" style="color:rgba(255,255,255,0.455);">Текущая ставка</span>`
        : `<span class="text-[9px] font-bold" style="color:rgba(255,255,255,0.455);">Начальная цена</span>`;

    const supplyLine = a.total_supply > 0
        ? `<div class="flex items-center gap-1 mt-1">
             <span class="text-[9px] font-bold" style="color:rgba(252,211,77,0.45);">Тираж:</span>
             <span class="text-[9px] font-black" style="color:rgba(252,211,77,0.75);">${a.total_supply - (a.sold_count || 0)} / ${a.total_supply}</span>
           </div>`
        : `<div class="flex items-center gap-1 mt-1">
             <span class="text-[9px] font-bold" style="color:rgba(252,211,77,0.45);">Тираж:</span>
             <span class="text-[9px] font-black" style="color:rgba(252,211,77,0.75);">∞</span>
           </div>`;

    return `
    <div class="nft-card mb-4">
      <div class="flex gap-3.5 p-4 cursor-pointer active:bg-white/[0.03] transition-colors rounded-t-3xl"
           onclick="nftOpenAuctionDetail(${a.id})">
        <div class="flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden relative"
             style="border:1px solid rgba(252,211,77,0.15);">
          <img src="${escapeHtml(a.image_url)}" alt="${escapeHtml(a.title)}"
               class="w-full h-full object-cover"
               onerror="this.src='https://via.placeholder.com/80x80?text=NFT'">
          <div class="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-lg text-[8px] font-black"
               style="background:rgba(252,211,77,0.95);color:#0a0704;box-shadow:0 2px 6px rgba(0,0,0,0.35);">ТОРГИ</div>
        </div>
        <div class="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <p class="font-bold text-sm truncate text-white">${escapeHtml(a.title)}${serial}</p>
            <p class="text-[10px] mt-0.5 truncate font-bold" style="color:rgba(255,255,255,0.4);">${sellerName}</p>
          </div>
          <div class="flex items-center gap-1.5 mt-1">
            <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
            <span class="font-black text-base" style="color:#fcd34d;">${a.current_price}</span>
            ${bidInfo}
          </div>
          ${supplyLine}
          <div class="flex items-center gap-1.5 mt-1">
            <svg class="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span id="auction-timer-${a.id}" class="text-[10px] font-bold" style="color:rgba(252,211,77,0.75);">…</span>
          </div>
        </div>
      </div>
      <div class="px-4 pb-4">${actionBtn}</div>
    </div>`;
}


// ─── Обратный отсчёт (setInterval) ───────────────────────────────

function nftStartCountdown(auctionId, endsAt) {
    const el = document.getElementById(`auction-timer-${auctionId}`);
    if (!el) return;

    function tick() {
        const secs = endsAt - Math.floor(Date.now() / 1000);
        if (secs <= 0) {
            el.textContent = 'Завершён';
            el.style.color = 'rgba(239,68,68,0.7)';
            const reloadId = setTimeout(() => nftLoadAuctions(), 2000);
            _auctionIntervalIds.push(reloadId);
            clearInterval(intervalId);
            return;
        }
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        el.textContent = h > 0
            ? `${h}ч ${String(m).padStart(2, '0')}м`
            : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        el.style.color = secs < 300 ? 'rgba(239,68,68,0.9)' : 'rgba(252,211,77,0.75)';
    }

    tick(); 
    const intervalId = setInterval(tick, 1000);
    _auctionIntervalIds.push(intervalId);
}


// ─── Аукцион: форма создания ──────────────────────────────────────────────────

function nftOpenAuctionCreateModal(ownedId, title, imageUrl) {
    vibrate('medium');
    nftAuctionTarget = { owned_id: ownedId };
    document.getElementById('nft-auction-modal-title').textContent = title;
    document.getElementById('nft-auction-modal-img').src           = imageUrl;
    document.getElementById('nft-auction-start-price').value       = '';

    document.querySelectorAll('.nft-duration-btn').forEach(btn => btn.classList.remove('active-duration'));
    document.querySelector('.nft-duration-btn[data-hours="24"]')?.classList.add('active-duration');

    document.getElementById('nft-auction-create-modal').classList.remove('hidden');
}

function nftSelectDuration(btn, hours) {
    vibrate('light');
    document.querySelectorAll('.nft-duration-btn').forEach(b => b.classList.remove('active-duration'));
    btn.classList.add('active-duration');
    btn.dataset.selected = hours;
}

async function nftSubmitAuction() {
    if (!nftAuctionTarget) return;
    const startPrice = parseInt(document.getElementById('nft-auction-start-price').value, 10);
    if (!startPrice || startPrice <= 0) {
        showNotify('Укажите начальную цену', 'error');
        return;
    }
    const activeBtn     = document.querySelector('.nft-duration-btn.active-duration');
    const durationHours = parseInt(activeBtn?.dataset.hours || '24', 10);

    vibrate('medium');
    const btn = document.getElementById('nft-auction-submit-btn');
    btn.textContent = 'Создаём...';
    btn.disabled    = true;

    try {
        const res  = await fetch('/api/nft/auction/create', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({
                nft_owned_id:   nftAuctionTarget.owned_id,
                start_price:    startPrice,
                duration_hours: durationHours,
            }),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotify(data.detail || 'Ошибка', 'error');
        } else {
            showNotify('🔨 Аукцион запущен!', 'success');
            vibrate('heavy');
            closeNFTModal('nft-auction-create-modal');
            nftAuctionTarget = null;
            await nftLoadGallery(null);
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    } finally {
        btn.textContent = '🔨 Запустить аукцион';
        btn.disabled    = false;
    }
}


// ─── Аукцион: размещение ставки ───────────────────────────────────────────────

function nftOpenBidModal(auctionId, currentPrice, title) {
    vibrate('medium');
    nftAuctionPending = { id: auctionId, current_price: currentPrice };
    document.getElementById('nft-bid-modal-title').textContent   = title;
    document.getElementById('nft-bid-current-price').textContent = currentPrice;
    document.getElementById('nft-bid-your-balance').textContent  = nftStars;
    document.getElementById('nft-bid-amount-input').value        = currentPrice + 1;
    document.getElementById('nft-bid-modal').classList.remove('hidden');
}

async function nftSubmitBid() {
    if (!nftAuctionPending) return;
    const amount = parseInt(document.getElementById('nft-bid-amount-input').value, 10);
    if (!amount || amount <= nftAuctionPending.current_price) {
        showNotify(`Ставка должна быть выше ${nftAuctionPending.current_price} ⭐`, 'error');
        return;
    }

    vibrate('medium');
    const btn = document.getElementById('nft-bid-submit-btn');
    btn.textContent = 'Ставим...';
    btn.disabled    = true;

    try {
        const res  = await fetch(`/api/nft/auction/bid/${nftAuctionPending.id}`, {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ amount }),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotify(data.detail || 'Ошибка ставки', 'error');
        } else {
            nftStars = data.nft_stars;
            nftUpdateStarsUI();
            showNotify(`🔨 Ставка ${amount} ⭐ принята!`, 'success');
            vibrate('heavy');
            closeNFTModal('nft-bid-modal');
            nftAuctionPending = null;
            await nftLoadAuctions();
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    } finally {
        btn.textContent = '🔨 Поставить';
        btn.disabled    = false;
    }
}


// ─── Отмена аукциона ──────────────────────────────────────────────────────────

async function nftCancelAuction(auctionId) {
    vibrate('light');
    try {
        const res  = await fetch(`/api/nft/auction/cancel/${auctionId}`, {
            method: 'POST', headers: getApiHeaders(),
        });
        const data = await res.json();
        if (!res.ok) {
            showNotify(data.detail || 'Ошибка', 'error');
        } else {
            showNotify('Аукцион отменён', 'success');
            await nftLoadAuctions();
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    }
}


// ─── Детальный просмотр аукциона ─────────────────────────────────────────────

function nftOpenAuctionDetail(auctionId) {
    vibrate('light');
    const a = nftAuctions.find(x => x.id === auctionId);
    if (!a) return;

    document.getElementById('nft-modal-image').src          = a.image_url;
    document.getElementById('nft-modal-desc').textContent   = a.description || '';
    document.getElementById('nft-modal-price').textContent  = a.current_price;

    const titleEl = document.getElementById('nft-modal-title');
    const serial  = a.serial_number;
    if (serial && serial > 0) {
        titleEl.innerHTML = `${escapeHtml(a.title)} <span style="color:#fcd34d;font-size:0.75em;">#${serial}</span>`;
    } else {
        titleEl.textContent = a.title;
    }

    const serialRow = document.getElementById('nft-modal-serial-row');
    const serialNum = document.getElementById('nft-modal-serial-num');
    if (serialRow && serialNum) {
        if (serial && serial > 0) {
            serialNum.textContent = `#${serial}`;
            serialRow.classList.remove('hidden');
            serialRow.style.display = 'flex';
        } else {
            serialRow.classList.add('hidden');
            serialRow.style.display = '';
        }
    }

    const sellerRow  = document.getElementById('nft-modal-seller-row');
    const sellerName = document.getElementById('nft-modal-seller-name');
    if (sellerRow && sellerName) {
        const name = a.is_anonymous
            ? 'Аноним'
            : (a.username ? `@${a.username}` : (a.first_name || 'Пользователь'));
        sellerName.textContent = name;
        sellerRow.classList.remove('hidden');
        sellerRow.style.display = 'flex';
    }

    const statusBadgeEl = document.getElementById('nft-modal-status-badge');
    if (statusBadgeEl) {
        statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-in-auction">На аукционе</span>`;
        statusBadgeEl.classList.remove('hidden');
    }

    const priceLabel = document.querySelector('.nft-price-block .nft-price-label');
    if (priceLabel) priceLabel.textContent = a.current_bidder ? 'Текущая ставка' : 'Начальная цена';

    const badge = document.getElementById('nft-modal-badge');
    if (badge) badge.style.display = 'none';

    const supplyRowA  = document.getElementById('nft-modal-supply-row');
    const supplyTextA = document.getElementById('nft-modal-supply-text');
    if (supplyRowA && supplyTextA) {
        if (a.total_supply > 0) {
            const remainingA = (a.available !== null && a.available !== undefined)
                ? a.available
                : (a.total_supply - (a.sold_count || 0));
            supplyTextA.textContent = `${remainingA} из ${a.total_supply}`;
            supplyRowA.classList.remove('hidden');
            supplyRowA.style.display = 'flex';
        } else {
            supplyRowA.classList.add('hidden');
            supplyRowA.style.display = '';
        }
    }

    const ownerActions = document.getElementById('nft-modal-owner-actions');
    if (ownerActions) ownerActions.classList.add('hidden');

    const priceBlock = document.getElementById('nft-modal-price')?.closest('.nft-price-block');
    const buyBtn     = document.getElementById('nft-modal-buy-btn');
    if (priceBlock) priceBlock.style.display = '';

    if (a.is_mine) {
        buyBtn.style.display = 'none';
    } else if (a.is_leading) {
        buyBtn.style.display    = '';
        buyBtn.disabled         = false;
        buyBtn.innerHTML        = `✓ Вы лидируете · Перебить`;
        buyBtn.style.background = 'rgba(16,185,129,0.22)';
        buyBtn.style.boxShadow  = '0 8px 20px rgba(16,185,129,0.15)';
        buyBtn.style.color      = '#ffffff';
        buyBtn.onclick = () => {
            closeNFTModal('nft-painting-modal');
            nftOpenBidModal(a.id, a.current_price, a.title);
        };
    } else {
        buyBtn.style.display    = '';
        buyBtn.disabled         = false;
        buyBtn.innerHTML        = `Сделать ставку`;
        buyBtn.style.background = 'linear-gradient(135deg, #fcd34d 0%, #f59e0b 100%)';
        buyBtn.style.boxShadow  = '0 10px 24px -4px rgba(245,158,11,0.4)';
        buyBtn.style.color      = '#0a0704';
        buyBtn.onclick = () => {
            closeNFTModal('nft-painting-modal');
            nftOpenBidModal(a.id, a.current_price, a.title);
        };
    }

    document.getElementById('nft-painting-modal').classList.remove('hidden');
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

function nftTimeAgo(ts) {
    const diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60)    return 'только что';
    if (diff < 3600)  return `${Math.floor(diff / 60)} мин назад`;
    if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
    return `${Math.floor(diff / 86400)} д назад`;
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.nftLoadMarket            = nftLoadMarket;
window.nftRenderMarket          = nftRenderMarket;
window.nftConfirmBuyListing     = nftConfirmBuyListing;
window.nftExecuteBuyListing     = nftExecuteBuyListing;
window.nftCancelListing         = nftCancelListing;
window.nftOpenListingDetail     = nftOpenListingDetail;
window.nftOpenListModal         = nftOpenListModal;
window.nftSubmitListing         = nftSubmitListing;
window.nftLoadAuctions          = nftLoadAuctions;
window.nftRenderAuctions        = nftRenderAuctions;
window.nftOpenAuctionCreateModal = nftOpenAuctionCreateModal;
window.nftSelectDuration        = nftSelectDuration;
window.nftSubmitAuction         = nftSubmitAuction;
window.nftOpenBidModal          = nftOpenBidModal;
window.nftSubmitBid             = nftSubmitBid;
window.nftCancelAuction         = nftCancelAuction;
window.nftOpenAuctionDetail     = nftOpenAuctionDetail;
window.nftTimeAgo               = nftTimeAgo;