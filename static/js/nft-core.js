// =====================================================
// nft-core.js — NFT Галерея: ядро (состояние, навигация, утилиты)
// Зависимости: globals.js (vibrate, getApiHeaders, showNotify, openModal)
// =====================================================

// ─── Глобальное состояние ─────────────────────────────────────────────────────

let nftStars          = 0;
let nftShopData       = [];
let nftGalleryData    = [];
let nftCurrentTab     = 'shop';
let nftModalPainting  = null;
let nftViewingUserId  = null; // null = своя галерея

// ─── Открытие / Закрытие секции ───────────────────────────────────────────────

function openNFTSection() {
    vibrate('medium');

    const section    = document.getElementById('nft-section');
    if (!section) return;

    const header     = document.querySelector('header');
    const appContent = document.getElementById('app-content');
    const mainNav    = document.querySelector('.fixed.left-0.w-full.flex.justify-center.z-40');

    if (header)     header.style.display     = 'none';
    if (appContent) appContent.style.display = 'none';
    if (mainNav)    mainNav.style.display    = 'none';

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

    if (header)     header.style.display     = '';
    if (appContent) appContent.style.display = '';
    if (mainNav)    mainNav.style.display    = '';
}

// ─── Переключение вкладок ─────────────────────────────────────────────────────

function nftSwitchTab(tab) {
    vibrate('light');
    nftCurrentTab = tab;

    // Обновляем активную кнопку навигации
    document.querySelectorAll('.nft-nav-item').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`nft-nav-${tab}`);
    if (activeBtn) activeBtn.classList.add('active');

    // Скрываем все страницы, показываем нужную
    ['shop', 'gallery', 'galleries', 'history', 'market', 'auction'].forEach(t => {
        const el = document.getElementById(`nft-page-${t}`);
        if (el) el.classList.add('hidden');
    });
    const page = document.getElementById(`nft-page-${tab}`);
    if (page) page.classList.remove('hidden');

    // Сброс скролла
    const contentArea = document.getElementById('nft-content-area');
    if (contentArea) contentArea.scrollTop = 0;

    // Загрузка данных вкладки
    if (tab === 'shop')      nftLoadShop();
    if (tab === 'gallery')   nftLoadGallery();
    if (tab === 'galleries') nftLoadGalleriesPage();
    if (tab === 'history')   nftLoadHistory();
    if (tab === 'market')    nftLoadMarket();
    if (tab === 'auction')   nftLoadAuctions();
}

// ─── Загрузка инфо (баланс звёзд) ────────────────────────────────────────────

async function nftLoadInfo() {
    try {
        const res  = await fetch('/api/nft/info', { headers: getApiHeaders() });
        const data = await res.json();
        nftStars = data.nft_stars || 0;
        nftUpdateStarsUI();
    } catch (e) {
        console.warn('NFT info error:', e);
    }
}

// ─── Пополнение NFT-звёзд ────────────────────────────────────────────────────

function openNFTTopup() {
    vibrate('medium');
    window.nftTopupMode = true;
    const inp = document.getElementById('custom-topup-amount');
    if (inp) inp.value = '';
    openModal('topup-stars-modal');
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
        <div class="flex items-center justify-center py-12 col-span-2">
            <div class="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
                 style="border-color:rgba(251,191,36,0.35);border-top-color:transparent;"></div>
        </div>`;
}

// ─── Вспомогательные (совместимость) ──────────────────────────────────────────

/** Устаревший блок коллекторов — оставлен для совместимости */
function nftRenderCollectors(collectors) {
    const container = document.getElementById('nft-collectors-list');
    if (!container) return;
    container.innerHTML = '';
}

/** Открыть галерею другого пользователя из внешних вызовов */
function nftViewUserGallery(userId, name) {
    vibrate('light');
    const title    = document.getElementById('nft-gallery-title');
    const subtitle = document.getElementById('nft-gallery-subtitle');
    if (title)    title.textContent    = name;
    if (subtitle) subtitle.textContent = 'Коллекция пользователя';
    nftLoadGallery(userId);
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.openNFTSection      = openNFTSection;
window.closeNFTSection     = closeNFTSection;
window.nftSwitchTab        = nftSwitchTab;
window.openNFTTopup        = openNFTTopup;
window.nftUpdateStarsUI    = nftUpdateStarsUI;
window.closeNFTModal       = closeNFTModal;
window.nftLoadingHTML      = nftLoadingHTML;
window.nftViewUserGallery  = nftViewUserGallery;
window.nftRenderCollectors = nftRenderCollectors;