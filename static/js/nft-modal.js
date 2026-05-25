// =====================================================
// nft-modal.js — NFT Галерея: Модальное окно картины
// Зависимости: nft-core.js, nft-shop.js, nft-gallery.js
// =====================================================

// ─── Открытие модального окна картины ────────────────────────────────────────

function nftOpenPainting(paintingId, fromGallery = false, viewOnly = false, serialNumber = null) {
    vibrate('light');

    let painting = null;

    if (fromGallery) {
        // Галерея: ищем по id + серийному номеру
        if (serialNumber !== null && serialNumber > 0) {
            painting = nftGalleryData.find(p => p.id === paintingId && p.serial_number === serialNumber);
        }
        if (!painting) painting = nftGalleryData.find(p => p.id === paintingId);
    } else {
        // Магазин: сначала shopData, запасной — galleryData
        painting = nftShopData.find(p => p.id === paintingId);
        if (!painting) {
            if (serialNumber !== null && serialNumber > 0) {
                painting = nftGalleryData.find(p => p.id === paintingId && p.serial_number === serialNumber);
            }
            if (!painting) painting = nftGalleryData.find(p => p.id === paintingId);
            if (painting) painting = { ...painting, owned: true, owned_count: 1 };
        }
    }

    if (!painting) return;

    nftModalPainting = painting;

    // Основные поля
    document.getElementById('nft-modal-image').src          = painting.image_url;
    document.getElementById('nft-modal-desc').textContent   = painting.description || '';
    document.getElementById('nft-modal-price').textContent  = painting.price;

    // Название + серийный номер в заголовке
    const titleEl = document.getElementById('nft-modal-title');
    const serial  = serialNumber || painting.serial_number;
    if (serial && serial > 0) {
        titleEl.innerHTML = `${escapeHtml(painting.title)} <span style="color:#fbbf24;font-size:0.75em;">#${serial}</span>`;
    } else {
        titleEl.textContent = painting.title;
    }

    // Строку серийного номера скрываем (номер уже в заголовке)
    const serialRow = document.getElementById('nft-modal-serial-row');
    if (serialRow) {
        serialRow.classList.add('hidden');
        serialRow.style.display = '';
    }

    // Строку продавца — скрываем (не нужна для магазина/галереи)
    const sellerRow = document.getElementById('nft-modal-seller-row');
    if (sellerRow) {
        sellerRow.classList.add('hidden');
        sellerRow.style.display = '';
    }

    // Бейдж лимита
    const badge = document.getElementById('nft-modal-badge');
    if (painting.total_supply > 0) {
        badge.textContent  = `${painting.sold_count} / ${painting.total_supply}`;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }

    // Тираж (строка в инфо-блоке)
    const supplyRow  = document.getElementById('nft-modal-supply-row');
    const supplyText = document.getElementById('nft-modal-supply-text');
    if (supplyRow && supplyText) {
        if (painting.total_supply > 0) {
            supplyText.textContent = `${painting.sold_count || 0} / ${painting.total_supply}`;
            supplyRow.classList.remove('hidden');
            supplyRow.style.display = 'flex';
        } else {
            supplyText.textContent = '∞ Неограниченный';
            supplyRow.classList.remove('hidden');
            supplyRow.style.display = 'flex';
        }
    }

    // Статусный бейдж (для картин, уже выставленных на продажу/аукцион)
    const statusBadgeEl = document.getElementById('nft-modal-status-badge');
    if (statusBadgeEl) {
        const st = painting.status || 'held';
        if (fromGallery && st === 'for_sale') {
            statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-for-sale">На продаже</span>`;
            statusBadgeEl.classList.remove('hidden');
        } else if (fromGallery && st === 'in_auction') {
            statusBadgeEl.innerHTML = `<span class="nft-status-badge nft-status-in-auction">На аукционе</span>`;
            statusBadgeEl.classList.remove('hidden');
        } else {
            statusBadgeEl.classList.add('hidden');
        }
    }

    // Ссылки для кнопок действий
    window._nftModalOwnedId    = painting.owned_id    || 0;
    window._nftModalListingId  = painting.listing_id  || 0;
    window._nftModalAuctionId  = painting.auction_id  || 0;
    window._nftModalHasBids    = !!(painting.has_bids || painting.bid_count > 0);
    window._nftModalImageUrl   = painting.image_url;
    window._nftModalTitle      = painting.title;
    window._nftModalPaintingId = painting.id;

    const priceBlock   = document.getElementById('nft-modal-price')?.closest('.nft-price-block');
    const buyBtn       = document.getElementById('nft-modal-buy-btn');
    const ownerActions = document.getElementById('nft-modal-owner-actions');

    const st          = painting.status || 'held';
    const isOwnHeld   = fromGallery && !viewOnly && st === 'held';
    const isOwnListed = fromGallery && !viewOnly && (st === 'for_sale' || st === 'in_auction');

    // ── Кнопки владельца ──
    if (ownerActions) {
        ownerActions.classList.add('hidden');
        ownerActions.innerHTML    = '';
        ownerActions.style.display = '';

        if (isOwnHeld) {
            ownerActions.style.display           = 'grid';
            ownerActions.style.gridTemplateColumns = '1fr 1fr';
            ownerActions.innerHTML = `
                <button onclick="nftOpenSellFromModal()"
                        class="py-3 rounded-xl text-sm font-black active:scale-95 transition-all"
                        style="background:rgba(251,191,36,0.82);color:#0d0601;box-shadow:0 4px 18px rgba(251,191,36,0.25);">
                  🏷 Продать
                </button>
                <button onclick="nftOpenAuctionFromModal()"
                        class="py-3 rounded-xl text-sm font-black active:scale-95 transition-all"
                        style="background:rgba(239,68,68,0.72);color:#fff;box-shadow:0 4px 18px rgba(239,68,68,0.2);">
                  🔨 Аукцион
                </button>`;
            ownerActions.classList.remove('hidden');

        } else if (st === 'for_sale' && isOwnListed) {
            ownerActions.style.display           = 'flex';
            ownerActions.style.gridTemplateColumns = '';
            ownerActions.innerHTML = `
                <button onclick="nftCancelListingFromModal()"
                        class="w-full py-3 rounded-xl text-sm font-black active:scale-95 transition-all"
                        style="background:rgba(239,68,68,0.18);color:rgba(239,68,68,0.85);border:1px solid rgba(239,68,68,0.3);">
                  ✕ Снять с продажи
                </button>`;
            ownerActions.classList.remove('hidden');

        } else if (st === 'in_auction' && isOwnListed) {
            ownerActions.style.display           = 'flex';
            ownerActions.style.gridTemplateColumns = '';
            if (!window._nftModalHasBids) {
                ownerActions.innerHTML = `
                    <button onclick="nftCancelAuctionFromModal()"
                            class="w-full py-3 rounded-xl text-sm font-black active:scale-95 transition-all"
                            style="background:rgba(239,68,68,0.18);color:rgba(239,68,68,0.85);border:1px solid rgba(239,68,68,0.3);">
                      🔨 Отменить аукцион
                    </button>`;
            } else {
                ownerActions.innerHTML = `
                    <div class="w-full py-3 rounded-xl text-xs font-semibold text-center"
                         style="background:rgba(251,191,36,0.06);color:rgba(251,191,36,0.45);border:1px solid rgba(251,191,36,0.12);">
                      Есть ставки — отмена невозможна
                    </div>`;
            }
            ownerActions.classList.remove('hidden');
        }
    }

    if (fromGallery) {
        // Галерея — кнопку покупки скрываем, сбрасываем стили
        if (priceBlock) priceBlock.style.display = '';
        buyBtn.style.display    = 'none';
        buyBtn.onclick          = null;
        buyBtn.disabled         = false;
        buyBtn.style.background = '';
        buyBtn.style.boxShadow  = '';
        buyBtn.style.color      = '';
    } else {
        // Магазин — стандартная кнопка покупки
        if (ownerActions) { ownerActions.classList.add('hidden'); ownerActions.innerHTML = ''; }
        if (priceBlock) priceBlock.style.display = '';
        buyBtn.style.display = '';
        buyBtn.onclick = nftBuyFromModal;

        const isSoldOut = painting.available !== null && painting.available <= 0;
        if (isSoldOut) {
            buyBtn.innerHTML        = 'Распродано';
            buyBtn.disabled         = true;
            buyBtn.style.background = 'rgba(239,68,68,0.3)';
            buyBtn.style.boxShadow  = 'none';
            buyBtn.style.color      = '#fff';
        } else {
            // БАГ-ФИX: используем innerHTML (с img) и сбрасываем color
            buyBtn.innerHTML        = `Купить за ${painting.price} <img src="/gifts/stars.png" class="w-4 h-4 inline-block align-middle ml-1 object-contain" onerror="this.style.display='none'">`;
            buyBtn.disabled         = false;
            buyBtn.style.background = 'linear-gradient(135deg, #b45309 0%, #fbbf24 50%, #f59e0b 100%)';
            buyBtn.style.boxShadow  = '0 4px 30px rgba(251,191,36,0.35)';
            buyBtn.style.color      = '#0d0601';
        }
    }

    document.getElementById('nft-painting-modal').classList.remove('hidden');
}

// ─── Продажа / Аукцион / Отмена из модального окна галереи ───────────────────

function nftOpenSellFromModal() {
    const title    = window._nftModalTitle    || '';
    const imageUrl = window._nftModalImageUrl || '';
    const ownedId  = window._nftModalOwnedId  || 0;
    closeNFTModal('nft-painting-modal');
    nftOpenListModal(ownedId, title, imageUrl);
}

function nftOpenAuctionFromModal() {
    const title    = window._nftModalTitle    || '';
    const imageUrl = window._nftModalImageUrl || '';
    const ownedId  = window._nftModalOwnedId  || 0;
    closeNFTModal('nft-painting-modal');
    nftOpenAuctionCreateModal(ownedId, title, imageUrl);
}

async function nftCancelListingFromModal() {
    vibrate('medium');
    let listingId = window._nftModalListingId || 0;

    // Ищем листинг в уже загруженных данных маркета
    if (!listingId && window.nftMarketListings) {
        const paintingId = window._nftModalPaintingId;
        const found = nftMarketListings.find(l =>
            l.painting_id === paintingId || l.nft_painting_id === paintingId
        );
        if (found) listingId = found.id;
    }

    // Крайний случай — запрашиваем маркет
    if (!listingId) {
        try {
            const res  = await fetch('/api/nft/market/listings', { headers: getApiHeaders() });
            const data = await res.json();
            const paintingId = window._nftModalPaintingId;
            const found = (data.listings || []).find(l =>
                l.painting_id === paintingId || l.nft_painting_id === paintingId || l.id === paintingId
            );
            if (found) listingId = found.id;
        } catch (e) {}
    }

    if (!listingId) {
        showNotify('Не удалось найти листинг', 'error');
        return;
    }

    closeNFTModal('nft-painting-modal');

    try {
        const res  = await fetch(`/api/nft/market/cancel/${listingId}`, {
            method: 'POST', headers: getApiHeaders(),
        });
        const data = await res.json();
        if (!res.ok) {
            showNotify(data.detail || 'Ошибка отмены', 'error');
        } else {
            showNotify('✓ Снято с продажи', 'success');
            vibrate('heavy');
            await nftLoadGallery(null);
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    }
}

async function nftCancelAuctionFromModal() {
    vibrate('medium');
    let auctionId = window._nftModalAuctionId || 0;

    // Ищем аукцион в уже загруженных данных
    if (!auctionId && window.nftAuctions) {
        const paintingId = window._nftModalPaintingId;
        const found = nftAuctions.find(a =>
            a.painting_id === paintingId || a.nft_painting_id === paintingId
        );
        if (found) auctionId = found.id;
    }

    // Крайний случай — запрашиваем список аукционов
    if (!auctionId) {
        try {
            const res  = await fetch('/api/nft/auction/list', { headers: getApiHeaders() });
            const data = await res.json();
            const paintingId = window._nftModalPaintingId;
            const found = (data.auctions || []).find(a =>
                a.painting_id === paintingId || a.nft_painting_id === paintingId || a.id === paintingId
            );
            if (found) auctionId = found.id;
        } catch (e) {}
    }

    if (!auctionId) {
        showNotify('Не удалось найти аукцион', 'error');
        return;
    }

    closeNFTModal('nft-painting-modal');

    try {
        const res  = await fetch(`/api/nft/auction/cancel/${auctionId}`, {
            method: 'POST', headers: getApiHeaders(),
        });
        const data = await res.json();
        if (!res.ok) {
            showNotify(data.detail || 'Ошибка отмены', 'error');
        } else {
            showNotify('✓ Аукцион отменён', 'success');
            vibrate('heavy');
            await nftLoadGallery(null);
        }
    } catch (e) {
        showNotify('Ошибка соединения', 'error');
    }
}

// ─── Покупка из магазина ──────────────────────────────────────────────────────

async function nftBuyFromModal() {
    if (!nftModalPainting) return;
    vibrate('medium');

    const btn = document.getElementById('nft-modal-buy-btn');
    // БАГ-ФИX: сохраняем innerHTML (содержит img), а не textContent
    const originalHTML = btn.innerHTML;
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
            showNotify(data.detail || 'Ошибка покупки', 'error');
            // БАГ-ФИX: восстанавливаем innerHTML, а не textContent
            btn.innerHTML = originalHTML;
            btn.disabled  = false;
            return;
        }

        nftStars = data.nft_stars;
        nftUpdateStarsUI();
        showNotify('🎨 Картина добавлена в вашу коллекцию!', 'success');
        vibrate('heavy');

        // Обновляем локальные данные магазина
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

    } catch (e) {
        showNotify('Ошибка соединения', 'error');
        // БАГ-ФИX: восстанавливаем innerHTML
        btn.innerHTML = originalHTML;
        btn.disabled  = false;
    }
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.nftOpenPainting           = nftOpenPainting;
window.nftBuyFromModal           = nftBuyFromModal;
window.nftOpenSellFromModal      = nftOpenSellFromModal;
window.nftOpenAuctionFromModal   = nftOpenAuctionFromModal;
window.nftCancelListingFromModal = nftCancelListingFromModal;
window.nftCancelAuctionFromModal = nftCancelAuctionFromModal;