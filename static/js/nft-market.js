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
        wrap.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">${nftT('load_error')}</div>`;
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
          <p class="nft-muted-text text-sm font-bold">${nftT('market_empty')}</p>
          <p class="nft-muted-text text-xs opacity-65 mt-1.5 leading-relaxed">${nftT('market_empty_sub')}</p>
        </div>`;
        return;
    }

    wrap.innerHTML = nftMarketListings.map(l => nftListingCardHTML(l)).join('');
}

function nftListingCardHTML(l) {
    const serial     = l.serial_number > 0
        ? ` <span style="color:#fcd34d;">#${l.serial_number}</span>` : '';
    const sellerName = l.is_anonymous
        ? (window.nftT ? window.nftT('seller_anonymous') : 'Аноним')
        : escapeHtml(l.first_name || '');
    const ago = nftTimeAgo(l.created_at);

    const actionBtn = l.is_mine
        ? `<button onclick="nftCancelListing(${l.id})"
                   class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                   style="background:rgba(239,68,68,0.12);color:rgba(239,68,68,0.9);border:1px solid rgba(239,68,68,0.25);">
             ${nftT('btn_remove_listing')}
           </button>`
        : `<button onclick="nftConfirmBuyListing(${l.id}, ${l.price}, '${escapeHtml(l.title)}')"
                   class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all nft-buy-btn">
             ${nftT('btn_buy')}
           </button>`;

    return `
    <div class="nft-card mb-4">
      <div class="flex gap-3.5 p-4 cursor-pointer active:bg-white/[0.03] transition-colors rounded-t-3xl"
           onclick="nftOpenListingDetail(${l.id})">
        <div class="flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden nft-art-frame"
             style="border:1px solid rgba(252,211,77,0.15);">
          <div class="art-blur" style="background-image:url(&quot;${l.image_url.replace(/"/g,'')}&quot;)"></div>
          <img src="${escapeHtml(l.image_url)}" alt="${escapeHtml(l.title)}"
               class="art-img"
               onerror="this.src='https://via.placeholder.com/80x80?text=NFT'">
        </div>
        <div class="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <p class="font-bold text-sm truncate text-white">${escapeHtml(l.title)}${serial}</p>
            <p class="text-[10px] mt-0.5 truncate font-bold" style="color:rgba(255,255,255,0.4);">by @${escapeHtml((l.author||'Space_Donut').replace(/^@/,''))} · ${sellerName} · ${ago}</p>
          </div>
          <div class="flex items-center gap-1.5 mt-1.5">
            <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
            <span class="font-black text-base" style="color:#fcd34d;">${l.price}</span>
            <span class="text-[10px] font-bold" style="color:rgba(255,255,255,0.45);">${nftT('nft_stars_label')}</span>
          </div>
        </div>
      </div>
      <div class="px-4 pb-4 flex gap-2">
        <div class="flex-1">${actionBtn}</div>
        <button onclick="event.stopPropagation();nftShareItem('painting',${l.id},${l.serial_number||0},'${escapeHtml(l.title).replace(/'/g,"\\'")}');event.preventDefault();"
                class="flex-shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
                style="background:rgba(252,211,77,0.08);border:1px solid rgba(252,211,77,0.2);">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
          </svg>
        </button>
      </div>
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
    btn.textContent = nftT('btn_buying');
    btn.disabled    = true;

    try {
        const res  = await fetch(`/api/nft/market/buy/${nftMarketPendingId}`, {
            method: 'POST', headers: getApiHeaders(),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotify(data.detail || nftT('notify_buy_error'), 'error');
        } else {
            nftStars = data.nft_stars;
            nftUpdateStarsUI();
            showNotify(nftT('notify_buy_success'), 'success');
            vibrate('heavy');
            closeNFTModal('nft-buy-confirm-modal');
            await nftLoadMarket();
        }
    } catch (e) {
        showNotify(nftT('notify_conn_error'), 'error');
    } finally {
        btn.textContent    = nftT('btn_confirm_buy');
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
            showNotify(data.detail || nftT('notify_generic_error'), 'error');
        } else {
            showNotify(nftT('notify_listing_cancelled'), 'success');
            await nftLoadMarket();
        }
    } catch (e) {
        showNotify(nftT('notify_conn_error'), 'error');
    }
}

// ─── Детальный просмотр листинга ─────────────────────────────────────────────

function nftOpenListingDetail(listingId) {
    vibrate('light');
    const l = nftMarketListings.find(x => x.id === listingId);
    if (!l) return;

    document.getElementById('nft-modal-image').src          = l.image_url;
    const _bL = document.getElementById('nft-modal-blur'); if (_bL) _bL.style.backgroundImage = `url("${l.image_url.replace(/"/g,'')}")`;
    document.getElementById('nft-modal-desc').textContent   = l.description || '';
    document.getElementById('nft-modal-price').textContent  = l.price;

    const titleEl = document.getElementById('nft-modal-title');
    const serial  = l.serial_number;
    if (serial && serial > 0) {
        titleEl.innerHTML = `${escapeHtml(l.title)} <span style="color:#fcd34d;font-size:0.75em;">#${serial}</span>`;
    } else {
        titleEl.textContent = l.title;
    }

    const authorEl = document.getElementById('nft-modal-author');
    if (authorEl) {
        const handle = (l.author || 'Space_Donut').replace(/^@/, '');
        authorEl.innerHTML = `by <a href="https://t.me/${encodeURIComponent(handle)}" target="_blank"
            style="color:rgba(255,255,255,0.55);text-decoration:none;font-weight:700;">@${escapeHtml(handle)}</a>`;
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
            ? (window.nftT ? window.nftT('seller_anonymous') : 'Аноним')
            : (l.first_name || (window.nftT ? window.nftT('seller_user') : 'Пользователь'));
        sellerName.textContent = name;
        sellerRow.classList.remove('hidden');
        sellerRow.style.display = 'flex';
    }

    const statusBadgeEl = document.getElementById('nft-modal-status-badge');
    if (statusBadgeEl) {
        statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-for-sale">${nftT('status_on_sale_modal')}</span>`;
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
            supplyText.textContent = nftT('supply_of', { remaining, total: l.total_supply });
            supplyRow.classList.remove('hidden');
            supplyRow.style.display = 'flex';
        } else {
            supplyRow.classList.add('hidden');
            supplyRow.style.display = '';
        }
    }

    const ownerActions = document.getElementById('nft-modal-owner-actions');
    // ⚠️ ВАЖНО: сбросить inline style.display, иначе Tailwind .hidden не сработает
    if (ownerActions) {
        ownerActions.innerHTML            = '';
        ownerActions.style.display        = 'none';
        ownerActions.style.gridTemplateColumns = '';
        ownerActions.classList.add('hidden');
    }

    const priceBlock = document.getElementById('nft-modal-price')?.closest('.nft-price-block');
    const buyBtn     = document.getElementById('nft-modal-buy-btn');
    if (priceBlock) priceBlock.style.display = '';

    if (l.is_mine) {
        buyBtn.style.display = 'none';
        if (ownerActions) {
            ownerActions.style.display        = 'flex';
            ownerActions.style.gridTemplateColumns = '';
            ownerActions.innerHTML = `
                <button onclick="nftCancelListing(${l.id})"
                        class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                        style="background:rgba(239,68,68,0.12);color:rgba(239,68,68,0.9);border:1px solid rgba(239,68,68,0.25);">
                  ${nftT('btn_cancel_listing')}
                </button>`;
            ownerActions.classList.remove('hidden');
        }
    } else {
        buyBtn.style.display    = '';
        buyBtn.disabled         = false;
        buyBtn.innerHTML        = `${nftT('btn_buy_for', { price: l.price })} <img src="/gifts/stars.png" class="w-4 h-4 inline-block align-middle ml-1 object-contain" onerror="this.style.display='none'">`;
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
    const _bLi = document.getElementById('nft-list-modal-blur'); if (_bLi) _bLi.style.backgroundImage = `url("${imageUrl.replace(/"/g,'')}")`;
    document.getElementById('nft-list-price-input').value       = '';
    document.getElementById('nft-list-modal').classList.remove('hidden');
}

async function nftSubmitListing() {
    if (!nftSellTarget) return;
    const price = parseInt(document.getElementById('nft-list-price-input').value, 10);
    if (!price || price <= 0) {
        showNotify(nftT('notify_price_invalid'), 'error');
        return;
    }

    vibrate('medium');
    const btn = document.getElementById('nft-list-submit-btn');
    btn.textContent = nftT('btn_listing_progress');
    btn.disabled    = true;

    try {
        const res  = await fetch('/api/nft/market/list', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ nft_owned_id: nftSellTarget.owned_id, price }),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotify(data.detail || nftT('notify_generic_error'), 'error');
        } else {
            showNotify(nftT('notify_sell_success'), 'success');
            vibrate('heavy');
            closeNFTModal('nft-list-modal');
            nftSellTarget = null;
            await nftLoadGallery(null);
        }
    } catch (e) {
        showNotify(nftT('notify_conn_error'), 'error');
    } finally {
        btn.textContent = nftT('btn_submit_listing');
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
        wrap.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm">${nftT('load_error')}</div>`;
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
          <p class="nft-muted-text text-sm font-bold">${nftT('auctions_empty')}</p>
          <p class="nft-muted-text text-xs opacity-65 mt-1.5 leading-relaxed">${nftT('auctions_empty_sub')}</p>
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
        ? (window.nftT ? window.nftT('seller_anonymous') : 'Аноним')
        : escapeHtml(a.first_name || '');
    const hasBids = !!a.current_bidder;

    let actionBtn;
    if (a.is_mine && !hasBids) {
        actionBtn = `<button onclick="nftCancelAuction(${a.id})"
                             class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                             style="background:rgba(239,68,68,0.12);color:rgba(239,68,68,0.9);border:1px solid rgba(239,68,68,0.25);">
                       ${nftT('btn_cancel_auction_short')}
                     </button>`;
    } else if (a.is_mine) {
        actionBtn = `<div class="w-full py-3.5 rounded-2xl text-xs font-black text-center"
                          style="background:rgba(252,211,77,0.06);color:rgba(252,211,77,0.5);border:1px solid rgba(252,211,77,0.15);">
                       ${nftT('auction_your_live')}
                     </div>`;
    } else if (a.is_leading) {
        actionBtn = `<button onclick="nftOpenBidModal(${a.id}, ${a.current_price}, '${escapeHtml(a.title)}')"
                             class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                             style="background:rgba(16,185,129,0.15);color:rgba(16,185,129,0.9);border:1px solid rgba(16,185,129,0.3);">
                       ${nftT('auction_leading')}
                     </button>`;
    } else {
        actionBtn = `<button onclick="nftOpenBidModal(${a.id}, ${a.current_price}, '${escapeHtml(a.title)}')"
                             class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all nft-buy-btn">
                       ${nftT('btn_place_bid')}
                     </button>`;
    }

    const bidInfo = hasBids
        ? `<span class="text-[9px] font-bold" style="color:rgba(255,255,255,0.455);">${nftT('current_bid_label')}</span>`
        : `<span class="text-[9px] font-bold" style="color:rgba(255,255,255,0.455);">${nftT('starting_price_label')}</span>`;

    return `
    <div class="nft-card mb-4">
      <div class="flex gap-3.5 p-4 cursor-pointer active:bg-white/[0.03] transition-colors rounded-t-3xl"
           onclick="nftOpenAuctionDetail(${a.id})">
        <div class="flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden nft-art-frame relative"
             style="border:1px solid rgba(252,211,77,0.15);">
          <div class="art-blur" style="background-image:url(&quot;${a.image_url.replace(/"/g,'')}&quot;)"></div>
          <img src="${escapeHtml(a.image_url)}" alt="${escapeHtml(a.title)}"
               class="art-img"
               onerror="this.src='https://via.placeholder.com/80x80?text=NFT'">
          <div class="absolute top-1.5 left-1.5 z-20 px-2 py-0.5 rounded-lg text-[8px] font-black"
               style="background:rgba(252,211,77,0.95);color:#0a0704;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${nftT('auction_live_badge')}</div>
        </div>
        <div class="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            <p class="font-bold text-sm truncate text-white">${escapeHtml(a.title)}${serial}</p>
            <p class="text-[10px] mt-0.5 truncate font-bold" style="color:rgba(255,255,255,0.4);">by @${escapeHtml((a.author||'Space_Donut').replace(/^@/,''))} · ${sellerName}</p>
          </div>
          <div class="flex items-center gap-1.5 mt-1">
            <img src="/gifts/stars.png" class="w-4 h-4 object-contain" onerror="this.style.display='none'">
            <span class="font-black text-base" style="color:#fcd34d;">${a.current_price}</span>
            ${bidInfo}
          </div>
          <div class="flex items-center gap-1.5 mt-1">
            <svg class="w-3.5 h-3.5 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/>
            </svg>
            <span id="auction-timer-${a.id}" class="text-[10px] font-bold" style="color:rgba(252,211,77,0.75);">…</span>
          </div>
        </div>
      </div>
      <div class="px-4 pb-4 flex gap-2">
        <div class="flex-1">${actionBtn}</div>
        <button onclick="event.stopPropagation();nftShareItem('painting',${a.painting_id||a.id},${a.serial_number||0},'${escapeHtml(a.title).replace(/'/g,"\\'")}');"
                class="flex-shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center active:scale-90 transition-all"
                style="background:rgba(252,211,77,0.08);border:1px solid rgba(252,211,77,0.2);">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" style="color:#fcd34d;">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5"
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"/>
          </svg>
        </button>
      </div>
    </div>`;
}


// ─── Обратный отсчёт (setInterval) ───────────────────────────────

function nftStartCountdown(auctionId, endsAt) {
    const el = document.getElementById(`auction-timer-${auctionId}`);
    if (!el) return;

    function tick() {
        const secs = endsAt - Math.floor(Date.now() / 1000);
        if (secs <= 0) {
            el.textContent = window.nftT ? nftT('auction_finished') : 'Завершён';
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
    const _bAu = document.getElementById('nft-auction-modal-blur'); if (_bAu) _bAu.style.backgroundImage = `url("${imageUrl.replace(/"/g,'')}")`;
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
        showNotify(nftT('notify_auction_price_req'), 'error');
        return;
    }
    const activeBtn     = document.querySelector('.nft-duration-btn.active-duration');
    const durationHours = parseInt(activeBtn?.dataset.hours || '24', 10);

    vibrate('medium');
    const btn = document.getElementById('nft-auction-submit-btn');
    btn.textContent = nftT('btn_creating_auction');
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
            showNotify(data.detail || nftT('notify_generic_error'), 'error');
        } else {
            showNotify(nftT('notify_auction_created'), 'success');
            vibrate('heavy');
            closeNFTModal('nft-auction-create-modal');
            nftAuctionTarget = null;
            await nftLoadGallery(null);
        }
    } catch (e) {
        showNotify(nftT('notify_conn_error'), 'error');
    } finally {
        btn.textContent = nftT('btn_launch_auction');
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
        showNotify(nftT('notify_bid_min', { price: nftAuctionPending.current_price }), 'error');
        return;
    }

    vibrate('medium');
    const btn = document.getElementById('nft-bid-submit-btn');
    btn.textContent = nftT('btn_bidding');
    btn.disabled    = true;

    try {
        const res  = await fetch(`/api/nft/auction/bid/${nftAuctionPending.id}`, {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ amount }),
        });
        const data = await res.json();

        if (!res.ok) {
            showNotify(data.detail || nftT('notify_bid_error'), 'error');
        } else {
            nftStars = data.nft_stars;
            nftUpdateStarsUI();
            showNotify(nftT('notify_bid_accepted', { amount }), 'success');
            vibrate('heavy');
            closeNFTModal('nft-bid-modal');
            nftAuctionPending = null;
            await nftLoadAuctions();
        }
    } catch (e) {
        showNotify(nftT('notify_conn_error'), 'error');
    } finally {
        btn.textContent = nftT('btn_submit_bid_label');
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
            showNotify(data.detail || nftT('notify_generic_error'), 'error');
        } else {
            showNotify(nftT('notify_auction_cancelled'), 'success');
            await nftLoadAuctions();
        }
    } catch (e) {
        showNotify(nftT('notify_conn_error'), 'error');
    }
}


// ─── Детальный просмотр аукциона ─────────────────────────────────────────────

function nftOpenAuctionDetail(auctionId) {
    vibrate('light');
    const a = nftAuctions.find(x => x.id === auctionId);
    if (!a) return;

    document.getElementById('nft-modal-image').src          = a.image_url;
    const _bA = document.getElementById('nft-modal-blur'); if (_bA) _bA.style.backgroundImage = `url("${a.image_url.replace(/"/g,'')}")`;
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
            ? (window.nftT ? window.nftT('seller_anonymous') : 'Аноним')
            : (a.first_name || (window.nftT ? window.nftT('seller_user') : 'Пользователь'));
        sellerName.textContent = name;
        sellerRow.classList.remove('hidden');
        sellerRow.style.display = 'flex';
    }

    const statusBadgeEl = document.getElementById('nft-modal-status-badge');
    if (statusBadgeEl) {
        statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-in-auction">${nftT('status_in_auction_modal')}</span>`;
        statusBadgeEl.classList.remove('hidden');
    }

    const priceLabel = document.querySelector('.nft-price-block .nft-price-label');
    if (priceLabel) priceLabel.textContent = a.current_bidder ? nftT('current_bid_label') : nftT('starting_price_label');

    const badge = document.getElementById('nft-modal-badge');
    if (badge) badge.style.display = 'none';

    const supplyRowA  = document.getElementById('nft-modal-supply-row');
    const supplyTextA = document.getElementById('nft-modal-supply-text');
    if (supplyRowA && supplyTextA) {
        if (a.total_supply > 0) {
            const remainingA = (a.available !== null && a.available !== undefined)
                ? a.available
                : (a.total_supply - (a.sold_count || 0));
            supplyTextA.textContent = nftT('supply_of', { remaining: remainingA, total: a.total_supply });
            supplyRowA.classList.remove('hidden');
            supplyRowA.style.display = 'flex';
        } else {
            supplyRowA.classList.add('hidden');
            supplyRowA.style.display = '';
        }
    }

    const ownerActions = document.getElementById('nft-modal-owner-actions');
    // ⚠️ ВАЖНО: сбросить inline style.display, иначе Tailwind .hidden не сработает
    if (ownerActions) {
        ownerActions.innerHTML            = '';
        ownerActions.style.display        = 'none';
        ownerActions.style.gridTemplateColumns = '';
        ownerActions.classList.add('hidden');
    }

    const priceBlock = document.getElementById('nft-modal-price')?.closest('.nft-price-block');
    const buyBtn     = document.getElementById('nft-modal-buy-btn');
    if (priceBlock) priceBlock.style.display = '';

    if (a.is_mine) {
        buyBtn.style.display = 'none';
        // Показываем кнопку отмены аукциона в ownerActions
        if (ownerActions) {
            ownerActions.style.display        = 'flex';
            ownerActions.style.gridTemplateColumns = '';
            if (!a.current_bidder) {
                ownerActions.innerHTML = `
                    <button onclick="nftCancelAuction(${a.id})"
                            class="w-full py-3.5 rounded-2xl text-xs font-black active:scale-[0.97] transition-all"
                            style="background:rgba(239,68,68,0.12);color:rgba(239,68,68,0.95);border:1px solid rgba(239,68,68,0.25);">
                      ${nftT('btn_cancel_auction_full')}
                    </button>`;
            } else {
                ownerActions.innerHTML = `
                    <div class="w-full py-3.5 rounded-2xl text-[10px] font-bold text-center"
                         style="background:rgba(255,255,255,0.02);color:rgba(255,255,255,0.3);border:1px solid rgba(255,255,255,0.06);">
                      ${nftT('bids_no_cancel')}
                    </div>`;
            }
            ownerActions.classList.remove('hidden');
        }
    } else if (a.is_leading) {
        buyBtn.style.display    = '';
        buyBtn.disabled         = false;
        buyBtn.innerHTML        = nftT('auction_leading');
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
        buyBtn.innerHTML        = nftT('btn_place_bid');
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
    if (diff < 60)    return nftT('time_just_now');
    if (diff < 3600)  return nftT('time_min_ago', { n: Math.floor(diff / 60) });
    if (diff < 86400) return nftT('time_h_ago',   { n: Math.floor(diff / 3600) });
    return nftT('time_d_ago', { n: Math.floor(diff / 86400) });
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