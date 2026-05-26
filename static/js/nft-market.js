// =====================================================
// nft-market.js — NFT Маркетплейс и Аукционы
// Зависимости: nft-core.js, nft-gallery.js
// =====================================================

// ─── Состояние ────────────────────────────────────────────────────────────────

let nftMarketListings  = [];
let nftAuctions        = [];
let nftMarketPendingId = null;  // listing_id, ожидающий подтверждения покупки
let nftAuctionPending  = null;  // { id, current_price } для подтверждения ставки
let nftSellTarget      = null;  // { owned_id } для создания листинга
let nftAuctionTarget   = null;  // { owned_id } для создания аукциона

// БАГ-ФИX: хранить ID интервалов (а не setTimeout), чтобы корректно очищать
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
        <div class="text-center py-14">
          <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center">
            <svg class="w-8 h-8 opacity-35" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fbbf24;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z"/>
            </svg>
          </div>
          <p class="nft-muted-text text-sm font-medium">Маркетплейс пуст</p>
          <p class="nft-muted-text text-xs opacity-60 mt-1">Выставьте свою картину на продажу из «Моей галереи»</p>
        </div>`;
        return;
    }

    wrap.innerHTML = nftMarketListings.map(l => nftListingCardHTML(l)).join('');
}

function nftListingCardHTML(l) {
    const serial     = l.serial_number > 0
        ? ` <span style="color:#fbbf24;">#${l.serial_number}</span>` : '';
    const sellerName = l.is_anonymous
        ? 'Аноним'
        : (l.username ? `@${escapeHtml(l.username)}` : escapeHtml(l.first_name || ''));
    const ago = nftTimeAgo(l.created_at);

    const actionBtn = l.is_mine
        ? `<button onclick="nftCancelListing(${l.id})"
                   class="flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-all"
                   style="background:rgba(239,68,68,0.15);color:rgba(239,68,68,0.8);border:1px solid rgba(239,68,68,0.25);">
             Снять с продажи
           </button>`
        : `<button onclick="nftConfirmBuyListing(${l.id}, ${l.price}, '${escapeHtml(l.title)}')"
                   class="flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-all nft-buy-btn">
             Купить
           </button>`;

    return `
    <div class="nft-card mb-3">
      <div class="flex gap-3 p-3 cursor-pointer active:bg-white/5 transition-colors rounded-t-[1.25rem]"
           onclick="nftOpenListingDetail(${l.id})">
        <div class="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden"
             style="border:1px solid rgba(251,191,36,0.18);">
          <img src="${escapeHtml(l.image_url)}" alt="${escapeHtml(l.title)}"
               class="w-full h-full object-cover"
               onerror="this.src='https://via.placeholder.com/80x80?text=NFT'">
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-sm truncate" style="color:#fdf4e3;">${escapeHtml(l.title)}${serial}</p>
          <p class="text-[10px] mt-0.5 truncate" style="color:rgba(251,191,36,0.5);">${sellerName} · ${ago}</p>
          <div class="flex items-center gap-1 mt-1.5">
            <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
            <span class="font-black text-base" style="color:#fbbf24;">${l.price}</span>
            <span class="text-[10px]" style="color:rgba(251,191,36,0.5);">NFT-звёзд</span>
          </div>
          <p class="text-[9px] mt-1" style="color:rgba(251,191,36,0.35);">Нажмите для подробностей</p>
        </div>
      </div>
      <div class="px-3 pb-3">${actionBtn}</div>
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
        titleEl.innerHTML = `${escapeHtml(l.title)} <span style="color:#fbbf24;font-size:0.75em;">#${serial}</span>`;
    } else {
        titleEl.textContent = l.title;
    }

    // Строка серийного номера
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

    // Продавец
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

    // Статус-бейдж
    const statusBadgeEl = document.getElementById('nft-modal-status-badge');
    if (statusBadgeEl) {
        statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-for-sale">На продаже</span>`;
        statusBadgeEl.classList.remove('hidden');
    }

    const badge = document.getElementById('nft-modal-badge');
    if (badge) badge.style.display = 'none';

    // Тираж
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
        buyBtn.style.background = 'linear-gradient(135deg, #b45309 0%, #fbbf24 50%, #f59e0b 100%)';
        buyBtn.style.boxShadow  = '0 4px 30px rgba(251,191,36,0.35)';
        // БАГ-ФИX: явно сбрасываем color, чтобы не унаследовать «зелёный» цвет от экрана аукциона
        buyBtn.style.color      = '#0d0601';
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
        // БАГ-ФИX: восстанавливаем полный текст кнопки
        btn.textContent = 'Выставить на продажу';
        btn.disabled    = false;
    }
}


// ─── Аукционы: загрузка и рендер ─────────────────────────────────────────────

async function nftLoadAuctions() {
    const wrap = document.getElementById('nft-auction-list');
    if (!wrap) return;

    // БАГ-ФИX: clearInterval вместо clearTimeout — интервалы живут бесконечно
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
        <div class="text-center py-14">
          <div class="nft-empty-frame w-16 h-16 mx-auto mb-4 rounded-2xl flex items-center justify-center">
            <svg class="w-8 h-8 opacity-35" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fbbf24;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                    d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
          </div>
          <p class="nft-muted-text text-sm font-medium">Нет активных аукционов</p>
          <p class="nft-muted-text text-xs opacity-60 mt-1">Запустите торги из «Моей галереи»</p>
        </div>`;
        return;
    }

    wrap.innerHTML = nftAuctions.map(a => nftAuctionCardHTML(a)).join('');

    // БАГ-ФИX: setInterval вместо цепочки setTimeout — таймеры корректно очищаются при смене вкладки
    nftAuctions.forEach(a => nftStartCountdown(a.id, a.ends_at));
}

function nftAuctionCardHTML(a) {
    const serial     = a.serial_number > 0
        ? ` <span style="color:#fbbf24;">#${a.serial_number}</span>` : '';
    const sellerName = a.is_anonymous
        ? 'Аноним'
        : (a.username ? `@${escapeHtml(a.username)}` : escapeHtml(a.first_name || ''));
    const hasBids = !!a.current_bidder;

    let actionBtn;
    if (a.is_mine && !hasBids) {
        actionBtn = `<button onclick="nftCancelAuction(${a.id})"
                             class="flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-all"
                             style="background:rgba(239,68,68,0.15);color:rgba(239,68,68,0.8);border:1px solid rgba(239,68,68,0.25);">
                       Отменить
                     </button>`;
    } else if (a.is_mine) {
        actionBtn = `<div class="flex-1 py-2.5 rounded-xl text-xs font-bold text-center"
                          style="background:rgba(251,191,36,0.07);color:rgba(251,191,36,0.5);border:1px solid rgba(251,191,36,0.15);">
                       Ваш аукцион
                     </div>`;
    } else if (a.is_leading) {
        actionBtn = `<button onclick="nftOpenBidModal(${a.id}, ${a.current_price}, '${escapeHtml(a.title)}')"
                             class="flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-all"
                             style="background:rgba(34,197,94,0.18);color:rgba(34,197,94,0.9);border:1px solid rgba(34,197,94,0.3);">
                       ✓ Вы лидируете · Перебить
                     </button>`;
    } else {
        actionBtn = `<button onclick="nftOpenBidModal(${a.id}, ${a.current_price}, '${escapeHtml(a.title)}')"
                             class="flex-1 py-2.5 rounded-xl text-xs font-bold active:scale-95 transition-all nft-buy-btn">
                       🔨 Сделать ставку
                     </button>`;
    }

    const bidInfo = hasBids
        ? `<span class="text-[9px]" style="color:rgba(251,191,36,0.5);">Текущая ставка</span>`
        : `<span class="text-[9px]" style="color:rgba(251,191,36,0.5);">Начальная цена</span>`;

    return `
    <div class="nft-card mb-3">
      <div class="flex gap-3 p-3 cursor-pointer active:bg-white/5 transition-colors rounded-t-[1.25rem]"
           onclick="nftOpenAuctionDetail(${a.id})">
        <div class="flex-shrink-0 w-20 h-20 rounded-xl overflow-hidden relative"
             style="border:1px solid rgba(251,191,36,0.18);">
          <img src="${escapeHtml(a.image_url)}" alt="${escapeHtml(a.title)}"
               class="w-full h-full object-cover"
               onerror="this.src='https://via.placeholder.com/80x80?text=NFT'">
          <div class="absolute top-1 left-1 px-1.5 py-0.5 rounded-md text-[8px] font-bold"
               style="background:rgba(251,191,36,0.85);color:#0d0601;">ТОРГИ</div>
        </div>
        <div class="flex-1 min-w-0">
          <p class="font-bold text-sm truncate" style="color:#fdf4e3;">${escapeHtml(a.title)}${serial}</p>
          <p class="text-[10px] mt-0.5 truncate" style="color:rgba(251,191,36,0.5);">${sellerName}</p>
          <div class="flex items-center gap-1 mt-1.5">
            <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
            <span class="font-black text-base" style="color:#fbbf24;">${a.current_price}</span>
            ${bidInfo}
          </div>
          <div class="flex items-center gap-1 mt-1">
            <svg class="w-3 h-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fbbf24;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span id="auction-timer-${a.id}" class="text-[10px] font-semibold" style="color:rgba(251,191,36,0.65);">…</span>
          </div>
          <p class="text-[9px] mt-1" style="color:rgba(251,191,36,0.35);">Нажмите для подробностей</p>
        </div>
      </div>
      <div class="px-3 pb-3">${actionBtn}</div>
    </div>`;
}


// ─── Обратный отсчёт (setInterval, без утечек) ───────────────────────────────

function nftStartCountdown(auctionId, endsAt) {
    const el = document.getElementById(`auction-timer-${auctionId}`);
    if (!el) return;

    function tick() {
        const secs = endsAt - Math.floor(Date.now() / 1000);
        if (secs <= 0) {
            el.textContent = 'Завершён';
            el.style.color = 'rgba(239,68,68,0.7)';
            // Перезагружаем список через 2 сек и прекращаем тикать
            const reloadId = setTimeout(() => nftLoadAuctions(), 2000);
            _auctionIntervalIds.push(reloadId);
            // Останавливаем конкретный интервал
            clearInterval(intervalId);
            return;
        }
        const h = Math.floor(secs / 3600);
        const m = Math.floor((secs % 3600) / 60);
        const s = secs % 60;
        el.textContent = h > 0
            ? `${h}ч ${String(m).padStart(2, '0')}м`
            : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        el.style.color = secs < 300 ? 'rgba(239,68,68,0.85)' : 'rgba(251,191,36,0.65)';
    }

    tick(); // первый вызов сразу
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
        // БАГ-ФИX: восстанавливаем полный текст кнопки с эмодзи
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
        // БАГ-ФИX: восстанавливаем текст с эмодзи
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
        titleEl.innerHTML = `${escapeHtml(a.title)} <span style="color:#fbbf24;font-size:0.75em;">#${serial}</span>`;
    } else {
        titleEl.textContent = a.title;
    }

    // Серийный номер
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

    // Продавец
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

    // Статус-бейдж
    const statusBadgeEl = document.getElementById('nft-modal-status-badge');
    if (statusBadgeEl) {
        statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-in-auction">На аукционе</span>`;
        statusBadgeEl.classList.remove('hidden');
    }

    // Лейбл цены
    const priceLabel = document.querySelector('.nft-price-block .nft-price-label');
    if (priceLabel) priceLabel.textContent = a.current_bidder ? 'Текущая ставка' : 'Начальная цена';

    const badge = document.getElementById('nft-modal-badge');
    if (badge) badge.style.display = 'none';

    // Тираж
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
        buyBtn.style.background = 'rgba(34,197,94,0.25)';
        buyBtn.style.boxShadow  = '0 4px 20px rgba(34,197,94,0.15)';
        buyBtn.style.color      = 'rgba(34,197,94,0.95)';
        buyBtn.onclick = () => {
            closeNFTModal('nft-painting-modal');
            nftOpenBidModal(a.id, a.current_price, a.title);
        };
    } else {
        buyBtn.style.display    = '';
        buyBtn.disabled         = false;
        buyBtn.innerHTML        = `Сделать ставку`;
        buyBtn.style.background = 'linear-gradient(135deg, #b45309 0%, #fbbf24 50%, #f59e0b 100%)';
        buyBtn.style.boxShadow  = '0 4px 30px rgba(251,191,36,0.35)';
        buyBtn.style.color      = '#0d0601';
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