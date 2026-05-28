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

// ─── Контекст для кнопки "Поделиться" ─────────────────────────────────────────
// type: 'gallery' | 'pack' | 'painting'
let nftShareContext = { type: 'gallery' };

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

    // Сбрасываем контекст шаринга при переключении вкладки
    nftShareContext = { type: tab === 'gallery' || tab === 'galleries' ? 'gallery' : tab };

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

// ─── Поделиться — генерация ссылки ───────────────────────────────────────────

/**
 * Устанавливает контекст для кнопки "Поделиться".
 * Вызывается из nft-gallery.js и nft-modal.js при навигации.
 */
function nftSetShareContext(ctx) {
    nftShareContext = Object.assign({}, nftShareContext, ctx);
}

/**
 * Открывает нативный диалог шаринга Telegram с ссылкой
 * на текущую страницу (галерею, пак или картину).
 *
 * Форматы deep-link параметра ?start=:
 *   nft_gallery              — страница NFT галереи
 *   nft_pack_{packId}        — конкретный пак по ID
 *   nft_painting_{id}_{serial} — конкретная картина
 */
function nftShareCurrentPage() {
    vibrate('light');

    const bot = (window.botUsername || '').replace('@', '');
    if (!bot) {
        if (typeof showNotify === 'function') showNotify('❌ Ссылка недоступна');
        return;
    }

    let startParam, shareText;

    if (nftShareContext.type === 'pack' && nftShareContext.packId) {
        startParam = `nft_pack_${nftShareContext.packId}`;
        const name = nftShareContext.packName || 'Пак';
        shareText  = `📦 Посмотри пак «${name}» в NFT Галерее!`;
    } else if (nftShareContext.type === 'painting' && nftShareContext.paintingId) {
        const serial = nftShareContext.paintingSerial || 1;
        startParam = `nft_painting_${nftShareContext.paintingId}_${serial}`;
        const title = nftShareContext.paintingTitle || 'Картина';
        shareText   = `🎨 Посмотри «${title} #${serial}» в NFT Галерее!`;
    } else {
        startParam = 'nft_gallery';
        shareText  = '🖼 Посмотри NFT Галерею!';
    }

    // Формат ссылки: https://t.me/BotName/AppName?startapp=nft_gallery
    // AppName берём из window.botAppName (приходит из /api/init → config.BOT_APP_NAME)
    const appName = (window.botAppName || 'app').replace(/^@/, '');
    const link    = `https://t.me/${bot}/${appName}?startapp=${startParam}`;
    const tgApp   = window.Telegram && window.Telegram.WebApp;

    // Telegram WebApp — нативный диалог выбора чата (используем tg — глобальный из globals.js, как в earn.js)
    const _tgApp = (typeof tg !== 'undefined' && tg) || (window.Telegram && window.Telegram.WebApp);
    if (_tgApp && _tgApp.openTelegramLink) {
        _tgApp.openTelegramLink(
            `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`
        );
        return;
    }

    // Web Share API (мобильный браузер)
    if (navigator.share) {
        navigator.share({ title: 'NFT Галерея', text: shareText, url: link }).catch(() => {});
        return;
    }

    // Fallback — копируем в буфер обмена
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
            if (typeof showNotify === 'function') showNotify('✅ Ссылка скопирована!');
        });
    }
}

// ─── Прямой шаринг элемента (картина или пак) ────────────────────────────────
//
// Вызывается с кнопок на карточках галереи и в модале пака.
// Не зависит от состояния nftShareContext — формирует ссылку напрямую.
//
//   type  : 'painting' | 'pack'
//   id    : painting.id   / pack.id
//   serial: serial_number (только для painting; для pack передать 0 / null)
//   title : название для текста сообщения

function nftShareItem(type, id, serial, title) {
    vibrate('light');

    const bot     = (window.botUsername || botUsername || '').replace('@', '');
    const appName = (window.botAppName  || 'app').replace(/^@/, '');

    let startParam, shareText;
    if (type === 'painting') {
        startParam = `nft_painting_${id}_${serial || 1}`;
        shareText  = `🎨 Посмотри «${title}${serial ? ' #' + serial : ''}» в NFT Галерее!`;
    } else {
        startParam = `nft_pack_${id}`;
        shareText  = `📦 Посмотри пак «${title}» в NFT Галерее!`;
    }

    const link = bot
        ? `https://t.me/${bot}/${appName}?startapp=${startParam}`
        : `https://t.me/${appName}`;

    // Используем tg (глобальный из globals.js) — та же логика, что и в earn.js
    if (typeof tg !== 'undefined' && tg && tg.openTelegramLink) {
        tg.openTelegramLink(
            `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`
        );
        return;
    }
    if (navigator.share) {
        navigator.share({ title: 'NFT Галерея', text: shareText, url: link }).catch(() => {});
        return;
    }
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => {
            if (typeof showNotify === 'function') showNotify('✅ Ссылка скопирована!');
        });
    }
}

/**
 * Хелпер для кнопок на карточках галереи: ищет картину в nftGalleryData,
 * берёт title и вызывает nftShareItem.
 */
function nftShareGalleryPainting(paintingId, serial) {
    const painting = (typeof nftGalleryData !== 'undefined' ? nftGalleryData : [])
        .find(p => p.id === paintingId && (serial > 0 ? p.serial_number === serial : true))
        || (typeof nftGalleryData !== 'undefined' ? nftGalleryData : [])
            .find(p => p.id === paintingId);
    nftShareItem('painting', paintingId, serial, painting?.title || '');
}

/**
 * Хелпер для строк паков в галерее: ищет пак по ID и шарит его.
 * nftGalleryPacksData — массив паков, доступный из nft-gallery.js.
 */
function nftShareGalleryPack(packId, packName) {
    nftShareItem('pack', packId, 0, packName || '');
}

/**
 * Шаринг текущей открытой картины в модальном окне (nft-painting-modal).
 * Использует контекст nftShareContext, установленный при открытии через nftOpenPainting().
 */
function nftSharePaintingModal() {
    if (nftShareContext.type === 'painting' && nftShareContext.paintingId) {
        nftShareItem(
            'painting',
            nftShareContext.paintingId,
            nftShareContext.paintingSerial || 1,
            nftShareContext.paintingTitle  || ''
        );
    } else {
        nftShareCurrentPage();
    }
}

// ─── Экспорт ──────────────────────────────────────────────────────────────────

window.openNFTSection      = openNFTSection;
window.nftSharePaintingModal = nftSharePaintingModal;
window.closeNFTSection     = closeNFTSection;
window.nftSwitchTab        = nftSwitchTab;
window.openNFTTopup        = openNFTTopup;
window.nftUpdateStarsUI    = nftUpdateStarsUI;
window.closeNFTModal       = closeNFTModal;
window.nftLoadingHTML      = nftLoadingHTML;
window.nftViewUserGallery  = nftViewUserGallery;
window.nftRenderCollectors = nftRenderCollectors;
window.nftSetShareContext   = nftSetShareContext;
window.nftShareCurrentPage  = nftShareCurrentPage;
window.nftShareItem         = nftShareItem;
window.nftShareGalleryPainting = nftShareGalleryPainting;
window.nftShareGalleryPack     = nftShareGalleryPack;