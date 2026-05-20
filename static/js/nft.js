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

    // Скрываем основной UI
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

    // Загружаем данные
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

    // Восстанавливаем основной UI
    const header     = document.querySelector('header');
    const appContent = document.getElementById('app-content');
    const mainNav    = document.querySelector('.fixed.left-0.w-full.flex.justify-center.z-40');

    if (header)     header.style.display = '';
    if (appContent) appContent.style.display = '';
    if (mainNav)    mainNav.style.display = '';
}

// ─── Переключение вкладок внутри NFT ──────────────────────────────────────────

function nftSwitchTab(tab) {
    vibrate('light');
    nftCurrentTab = tab;

    // Навигация
    document.querySelectorAll('.nft-nav-item').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`nft-nav-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Страницы
    document.getElementById('nft-page-shop').classList.add('hidden');
    document.getElementById('nft-page-gallery').classList.remove('hidden');
    document.getElementById('nft-page-gallery').classList.add('hidden');
    document.getElementById(`nft-page-${tab}`).classList.remove('hidden');

    // Скролл наверх
    const contentArea = document.getElementById('nft-content-area');
    if (contentArea) contentArea.scrollTop = 0;

    if (tab === 'shop')    nftLoadShop();
    if (tab === 'gallery') nftLoadGallery();
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
        // Моя галерея + список коллекционеров
        title.textContent    = '🏛 Моя Галерея';
        subtitle.textContent = 'Ваша коллекция NFT';
        backBtn.classList.add('hidden');

        try {
            const [galleryRes, collectorsRes] = await Promise.all([
                fetch('/api/nft/gallery/me', { headers: getApiHeaders() }),
                fetch('/api/nft/galleries',  { headers: getApiHeaders() }),
            ]);
            const galleryData    = await galleryRes.json();
            const collectorsData = await collectorsRes.json();

            nftGalleryData = galleryData.gallery || [];
            nftRenderGalleryGrid(nftGalleryData);
            nftRenderCollectors(collectorsData.collectors || []);
        } catch(e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    } else {
        // Чужая галерея
        backBtn.classList.remove('hidden');
        collectors.innerHTML = '';

        try {
            const res  = await fetch(`/api/nft/gallery/${userId}`, { headers: getApiHeaders() });
            const data = await res.json();
            nftGalleryData = data.gallery || [];
            nftRenderGalleryGrid(nftGalleryData);
        } catch(e) {
            grid.innerHTML = `<div class="text-center py-8 text-red-400/60 text-sm col-span-2">Ошибка загрузки</div>`;
        }
    }
}

function nftGalleryBackToList() {
    nftLoadGallery(null);
}

// ─── Рендер ───────────────────────────────────────────────────────────────────

function nftRenderShop() {
    const list = document.getElementById('nft-shop-list');
    if (!list) return;

    if (nftShopData.length === 0) {
        list.innerHTML = `
            <div class="text-center py-12">
                <div class="w-16 h-16 mx-auto mb-3 rounded-3xl flex items-center justify-center"
                     style="background:rgba(168,85,247,0.1);border:1px solid rgba(168,85,247,0.2);">
                    <svg class="w-8 h-8 text-purple-400/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5"
                              d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                    </svg>
                </div>
                <p class="text-purple-300/50 text-sm">Нет доступных картин</p>
                <p class="text-purple-300/30 text-xs mt-1">Скоро появятся новые работы</p>
            </div>`;
        return;
    }

    list.innerHTML = nftShopData.map(p => nftShopCardHTML(p)).join('');
}

function nftShopCardHTML(p) {
    const isOwned   = p.owned;
    const isSoldOut = p.available !== null && p.available <= 0;
    const limited   = p.total_supply > 0;
    const remain    = p.available;

    const badgeHTML = limited
        ? `<div class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white"
                style="background:rgba(168,85,247,0.85);">
               ${isSoldOut ? '🔴 Распродано' : `🔥 ${remain} из ${p.total_supply}`}
           </div>`
        : `<div class="absolute top-2 left-2 px-2 py-0.5 rounded-lg text-[10px] font-bold text-white"
                style="background:rgba(99,102,241,0.7);">♾ Неограниченный</div>`;

    const ownedBadge = isOwned
        ? `<div class="absolute top-2 right-2 px-2 py-0.5 rounded-lg text-[10px] font-bold"
                style="background:rgba(16,185,129,0.8);color:white;">✓ В коллекции</div>`
        : '';

    return `
    <div class="nft-card${isOwned ? ' owned' : ''} cursor-pointer"
         onclick="nftOpenPainting(${p.id})">
        <div class="relative w-full" style="padding-top:65%;">
            <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                 class="absolute inset-0 w-full h-full object-cover"
                 onerror="this.src='https://via.placeholder.com/400x260?text=NFT'">
            <div class="absolute inset-0" style="background:linear-gradient(to bottom,transparent 50%,rgba(10,1,24,0.9) 100%);"></div>
            ${badgeHTML}
            ${ownedBadge}
        </div>
        <div class="p-3">
            <h4 class="text-white font-bold text-sm leading-tight mb-1 truncate">${escapeHtml(p.title)}</h4>
            ${p.description ? `<p class="text-purple-300/50 text-xs mb-2 line-clamp-2">${escapeHtml(p.description)}</p>` : ''}
            <div class="flex items-center justify-between">
                <div class="flex items-center gap-1">
                    <img src="/gifts/stars.png" class="w-3.5 h-3.5 object-contain" onerror="this.style.display='none'">
                    <span class="text-white font-black text-sm">${p.price}</span>
                </div>
                ${isOwned
                    ? `<span class="text-xs font-bold px-2 py-1 rounded-lg" style="background:rgba(16,185,129,0.15);color:#34d399;">Куплено</span>`
                    : isSoldOut
                    ? `<span class="text-xs font-bold px-2 py-1 rounded-lg" style="background:rgba(239,68,68,0.15);color:#f87171;">Нет в наличии</span>`
                    : `<span class="text-xs font-bold px-2 py-1 rounded-lg" style="background:rgba(168,85,247,0.15);color:#c084fc;">Купить</span>`
                }
            </div>
        </div>
    </div>`;
}

function nftRenderGalleryGrid(items) {
    const grid  = document.getElementById('nft-gallery-grid');
    const empty = document.getElementById('nft-gallery-empty');
    if (!grid) return;

    if (items.length === 0) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');
    grid.innerHTML = items.map(p => `
        <div class="nft-card owned cursor-pointer" onclick="nftOpenPainting(${p.id}, true)">
            <div class="relative w-full" style="padding-top:100%;">
                <img src="${escapeHtml(p.image_url)}" alt="${escapeHtml(p.title)}"
                     class="absolute inset-0 w-full h-full object-cover"
                     onerror="this.src='https://via.placeholder.com/300x300?text=NFT'">
                <div class="absolute inset-0" style="background:linear-gradient(to bottom,transparent 40%,rgba(10,1,24,0.85) 100%);"></div>
                <div class="absolute bottom-2 left-2 right-2">
                    <p class="text-white font-bold text-xs truncate">${escapeHtml(p.title)}</p>
                </div>
                <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded-lg text-[9px] font-bold"
                     style="background:rgba(16,185,129,0.8);color:white;">✓</div>
            </div>
        </div>`).join('');
}

function nftRenderCollectors(collectors) {
    const container = document.getElementById('nft-collectors-list');
    if (!container) return;

    if (collectors.length === 0) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = `
        <div class="mb-3">
            <h3 class="text-white font-bold text-sm mb-2" style="color:rgba(168,85,247,0.9);">
                🌐 Галереи коллекционеров
            </h3>
            <div class="space-y-2">
                ${collectors.slice(0, 10).map((c, i) => {
                    const name = c.is_anonymous
                        ? 'Анонимный'
                        : (c.first_name || c.username || `User ${c.tg_id}`);
                    return `
                    <div class="flex items-center justify-between p-2.5 rounded-2xl cursor-pointer active:scale-[0.98] transition-all"
                         style="background:rgba(168,85,247,0.07);border:1px solid rgba(168,85,247,0.12);"
                         onclick="nftViewUserGallery(${c.tg_id}, '${escapeHtml(name)}')">
                        <div class="flex items-center gap-2.5">
                            <div class="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-black"
                                 style="background:rgba(168,85,247,0.2);color:#a855f7;">${i + 1}</div>
                            <div>
                                <p class="text-white text-xs font-semibold">${escapeHtml(name)}</p>
                                <p class="text-purple-300/50 text-[10px]">${c.collection_size} картин</p>
                            </div>
                        </div>
                        <svg class="w-4 h-4 text-purple-400/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"/>
                        </svg>
                    </div>`;
                }).join('')}
            </div>
        </div>
        <div class="mb-3">
            <h3 class="text-white font-bold text-sm mb-2" style="color:rgba(168,85,247,0.9);">
                🖼 Моя коллекция
            </h3>
        </div>`;
}

function nftViewUserGallery(userId, name) {
    vibrate('light');
    const title    = document.getElementById('nft-gallery-title');
    const subtitle = document.getElementById('nft-gallery-subtitle');
    if (title)    title.textContent    = `🏛 ${name}`;
    if (subtitle) subtitle.textContent = 'Коллекция пользователя';
    nftLoadGallery(userId);
}

// ─── Модальное окно картины ───────────────────────────────────────────────────

function nftOpenPainting(paintingId, fromGallery = false) {
    vibrate('light');

    let painting = nftShopData.find(p => p.id === paintingId);
    if (!painting) {
        painting = nftGalleryData.find(p => p.id === paintingId);
        if (painting) painting = { ...painting, owned: true };
    }
    if (!painting) return;

    nftModalPainting = painting;

    // Заполняем модалку
    document.getElementById('nft-modal-image').src   = painting.image_url;
    document.getElementById('nft-modal-title').textContent = painting.title;
    document.getElementById('nft-modal-desc').textContent  = painting.description || '';
    document.getElementById('nft-modal-price').textContent = painting.price;

    // Бейдж
    const badge = document.getElementById('nft-modal-badge');
    if (painting.total_supply > 0) {
        badge.textContent = `${painting.sold_count} / ${painting.total_supply}`;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }

    // Кнопка покупки
    const buyBtn = document.getElementById('nft-modal-buy-btn');
    if (painting.owned) {
        buyBtn.textContent = '✓ Уже в вашей коллекции';
        buyBtn.disabled    = true;
        buyBtn.style.background = 'rgba(16,185,129,0.3)';
        buyBtn.style.boxShadow  = 'none';
    } else if (painting.available !== null && painting.available <= 0) {
        buyBtn.textContent = 'Распродано';
        buyBtn.disabled    = true;
        buyBtn.style.background = 'rgba(239,68,68,0.3)';
        buyBtn.style.boxShadow  = 'none';
    } else {
        buyBtn.textContent = `Купить за ${painting.price} ⭐`;
        buyBtn.disabled    = false;
        buyBtn.style.background = 'linear-gradient(135deg, #7c3aed, #a855f7)';
        buyBtn.style.boxShadow  = '0 0 20px rgba(168,85,247,0.4)';
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

        // Обновляем стейт
        const shopItem = nftShopData.find(p => p.id === nftModalPainting.id);
        if (shopItem) {
            shopItem.owned = true;
            if (shopItem.available !== null) shopItem.available--;
            shopItem.sold_count = (shopItem.sold_count || 0) + 1;
        }

        closeNFTModal('nft-painting-modal');
        // Перерисовываем магазин
        if (nftCurrentTab === 'shop') nftRenderShop();
        else nftLoadShop();

    } catch(e) {
        showNotify('Ошибка соединения', 'error');
        btn.textContent = originalText;
        btn.disabled    = false;
    }
}

// ─── Пополнение NFT-звёзд ─────────────────────────────────────────────────────

function openNFTTopup() {
    vibrate('light');
    document.getElementById('nft-topup-amount').value = '';
    document.getElementById('nft-topup-modal').classList.remove('hidden');
}

function setNFTTopupAmount(amount) {
    document.getElementById('nft-topup-amount').value = amount;
}

async function buyNFTStars() {
    const input  = document.getElementById('nft-topup-amount');
    const amount = parseInt(input.value);

    if (!amount || amount <= 0 || amount > 100000) {
        showNotify('Введите корректную сумму', 'warning');
        return;
    }

    vibrate('medium');

    // Используем тот же Telegram Stars Invoice, что и основной проект
    try {
        const res = await fetch('/api/topup/stars', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({ amount, nft_mode: true }),
        });
        const data = await res.json();

        if (data.invoice_link) {
            closeNFTModal('nft-topup-modal');
            const tgApp = window.Telegram?.WebApp;
            if (tgApp?.openInvoice) {
                tgApp.openInvoice(data.invoice_link, async (status) => {
                    if (status === 'paid') {
                        const newBalance = await db_nft_topup_confirm(amount);
                        nftStars = newBalance;
                        nftUpdateStarsUI();
                        showNotify(`✨ Начислено ${amount} NFT-звёзд!`, 'success');
                        vibrate('heavy');
                    }
                });
            } else {
                window.open(data.invoice_link, '_blank');
            }
        } else {
            showNotify(data.detail || 'Ошибка создания счёта', 'error');
        }
    } catch(e) {
        showNotify('Ошибка соединения', 'error');
    }
}

async function db_nft_topup_confirm(amount) {
    try {
        const res  = await fetch('/api/nft/topup', {
            method:  'POST',
            headers: getApiHeaders(),
            body:    JSON.stringify({
                telegram_payment_charge_id: 'tg_' + Date.now(),
                amount,
            }),
        });
        const data = await res.json();
        return data.nft_stars || 0;
    } catch(e) {
        return nftStars + amount;
    }
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
                 style="border-color:rgba(168,85,247,0.4);border-top-color:transparent;"></div>
        </div>`;
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────
window.openNFTSection      = openNFTSection;
window.closeNFTSection     = closeNFTSection;
window.nftSwitchTab        = nftSwitchTab;
window.nftOpenPainting     = nftOpenPainting;
window.nftBuyFromModal     = nftBuyFromModal;
window.openNFTTopup        = openNFTTopup;
window.setNFTTopupAmount   = setNFTTopupAmount;
window.buyNFTStars         = buyNFTStars;
window.closeNFTModal       = closeNFTModal;
window.nftViewUserGallery  = nftViewUserGallery;
window.nftGalleryBackToList = nftGalleryBackToList;
