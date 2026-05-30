// =====================================================
// nft-i18n.js — Локализация NFT Галереи
// Покрывает: галерея, галереи, история, маркет, торги, магазин, все модальные окна
// Зависимости: i18n.js (currentLang, i18n должны быть определены)
// =====================================================

const nftI18n = {

    // ─── РУССКИЙ ────────────────────────────────────────────────────────────────
    ru: {

        // ── Табы NFT (JS-доступ через nftT) ─────────────────────────────────
        tab_gallery:    'Галерея',
        tab_galleries:  'Галереи',
        tab_history:    'История',
        tab_market:     'Маркет',
        tab_auctions:   'Торги',
        tab_shop:       'Магазин',

        // ── Заголовки страниц ─────────────────────────────────────────────────
        my_gallery_title:        'Моя Галерея',
        my_gallery_subtitle:     'Ваша коллекция NFT',
        user_gallery_subtitle:   'Коллекция пользователя',

        // ── Склонение слова «картина» ─────────────────────────────────────────
        word_painting_1:    'картина',
        word_painting_few:  'картины',
        word_painting_many: 'картин',

        // ── Статусные бейджи ──────────────────────────────────────────────────
        status_for_sale:         '🏷 На продаже',
        status_in_auction:       '🔨 Торги',
        status_mine:             '✦ Моя',
        status_on_sale_modal:    'На продаже',
        status_in_auction_modal: 'На аукционе',

        // ── Продавец / пользователь ───────────────────────────────────────────
        seller_anonymous: 'Аноним',
        seller_user:      'Пользователь',

        // ── Коллекционеры ─────────────────────────────────────────────────────
        collectors_anonymous: 'Анонимный',
        collectors_empty:     'Пока нет коллекционеров',

        // ── Пак ──────────────────────────────────────────────────────────────
        pack_default_name:       'Пак',
        pack_badge:              '📦 Пак',
        pack_for_sale_count:     '🏷 {n} на продаже',
        pack_auction_count:      '🔨 {n} аукцион',
        pack_paintings_count:    '{n} {word} в паке',
        pack_subtitle:           'Пак · {n} {word}',

        // ── Маркет / аукционы ─────────────────────────────────────────────────
        auction_finished: 'Завершён',

        // ── Ошибка / загрузка ─────────────────────────────────────────────────
        load_error:       'Ошибка загрузки',
        gallery_empty:    'Галерея пуста',

        // ── Разделитель ───────────────────────────────────────────────────────
        standalone_paintings: 'Отдельные картины',

        // ── Звёзды ────────────────────────────────────────────────────────────
        stars_unit: 'звёзд',

        // ── Шаринг ────────────────────────────────────────────────────────────
        share_link_unavailable: '❌ Ссылка недоступна',
        share_link_copied:      '✅ Ссылка скопирована!',
        share_gallery_text:     '🖼 Посмотри NFT Галерею!',
        share_pack_text:        '📦 Посмотри пак «{name}» в NFT Галерее!',
        share_painting_text:    '🎨 Посмотри «{title}» в NFT Галерее!',
        share_title:            'NFT Галерея',

        // ── Уведомления (showNotify) ──────────────────────────────────────────
        notify_buy_success:       '🎨 Картина добавлена в вашу коллекцию!',
        notify_buy_error:         'Ошибка покупки',
        notify_sell_success:      '🏷 Картина выставлена на продажу!',
        notify_sell_error:        'Ошибка выставления',
        notify_cancel_sale:       '✓ Снято с продажи',
        notify_cancel_auction:    '✓ Аукцион отменён',
        notify_auction_created:   '🔨 Аукцион запущен!',
        notify_auction_cancelled: 'Аукцион отменён',
        notify_listing_cancelled: 'Листинг снят',
        notify_bid_accepted:      '🔨 Ставка {amount} ⭐ принята!',
        notify_bid_error:         'Ошибка ставки',
        notify_bid_min:           'Ставка должна быть выше {price} ⭐',
        notify_price_required:    'Укажите цену',
        notify_auction_price_req: 'Укажите начальную цену',
        notify_listing_not_found: 'Не удалось найти листинг',
        notify_auction_not_found: 'Не удалось найти аукцион',
        notify_conn_error:        'Ошибка соединения',
        notify_cancel_error:      'Ошибка отмены',
        notify_generic_error:     'Ошибка',
        notify_price_invalid:     'Укажите корректную цену',

        // ── Кнопки действий ─────────────────────────────────────────────────
        btn_sell:                 '🏷 Продать',
        btn_auction_start:        '🔨 Аукцион',
        btn_cancel_listing:       '✕ Снять с продажи',
        btn_cancel_auction_full:  '🔨 Отменить аукцион',
        btn_cancel_auction_short: 'Отменить аукцион',
        btn_buying:               'Покупка...',
        btn_buy_for:              'Купить за {price}',
        btn_sold_out:             'Распродано',
        btn_open_pack:            'Открыть пак',
        btn_remove_listing:       'Снять с продажи',
        btn_buy:                  'Купить',
        btn_confirm_buy:          'Подтвердить покупку',
        btn_listing_progress:     'Выставляем...',
        btn_submit_listing:       'Выставить на продажу',
        btn_creating_auction:     'Создаём...',
        btn_launch_auction:       '🔨 Запустить аукцион',
        btn_place_bid:            '🔨 Сделать ставку',
        btn_bidding:              'Ставим...',
        btn_submit_bid_label:     '🔨 Поставить',
        pack_view_btn:            'Посмотреть пак →',

        // ── Тираж / Supply ────────────────────────────────────────────────────
        supply_of:                '{remaining} из {total}',
        supply_unlimited:         '∞ Неограниченный',
        sold_out_count:           '🔴 0 из {total}',
        remaining_count:          '🔥 {remain} из {total}',
        sold_out_bare:            '0 из {total}',
        unlimited_badge:          '♾ Безлимит',
        btn_sold_out_count:       'Распродано · 0 из {total}',

        // ── Статусы и бейджи ──────────────────────────────────────────────────
        bids_no_cancel:           'Есть ставки — отмена невозможна',
        archive_badge:            '🗄 Архив',
        archive_pack_badge:       '🗄 Архив · {n} {word}',
        auction_live_badge:       'ТОРГИ',
        auction_your_live:        '🔨 Ваш аукцион · Идут торги',
        auction_leading:          '✓ Вы лидируете · Перебить',
        current_bid_label:        'Текущая ставка',
        starting_price_label:     'Начальная цена',
        nft_stars_label:          'NFT-звёзд',
        price_label:              'Цена',

        // ── Секции магазина ───────────────────────────────────────────────────
        shop_no_paintings:        'Нет доступных картин',
        shop_soon:                'Скоро появятся новые работы',
        section_packs:            '📦 Паки',
        section_paintings:        '🎨 Картины',
        swipe_hint:               '← свайп →',
        shop_all_sold:            'Все картины временно распроданы',
        section_archive:          'Архив',
        section_archive_packs:    '🗄 Архив паков',
        pack_all_sold:            'Все картины распроданы',
        pack_archived_notice:     '🗄 Пак в архиве — все картины распроданы',

        // ── Маркетплейс и аукционы ────────────────────────────────────────────
        market_empty:             'Маркетплейс пуст',
        market_empty_sub:         'Выставьте свою картину на продажу из «Моей галереи»',
        auctions_empty:           'Нет активных аукционов',
        auctions_empty_sub:       'Запустите торги из «Моей галереи»',

        // ── Время ─────────────────────────────────────────────────────────────
        time_just_now:            'только что',
        time_min_ago:             '{n} мин назад',
        time_h_ago:               '{n} ч назад',
        time_d_ago:               '{n} д назад',
    },

    // ─── ENGLISH ────────────────────────────────────────────────────────────────
    en: {

        tab_gallery:    'Gallery',
        tab_galleries:  'Galleries',
        tab_history:    'History',
        tab_market:     'Market',
        tab_auctions:   'Auctions',
        tab_shop:       'Shop',

        my_gallery_title:        'My Gallery',
        my_gallery_subtitle:     'Your NFT collection',
        user_gallery_subtitle:   "User's collection",

        word_painting_1:    'painting',
        word_painting_few:  'paintings',
        word_painting_many: 'paintings',

        status_for_sale:         '🏷 For Sale',
        status_in_auction:       '🔨 Auction',
        status_mine:             '✦ Mine',
        status_on_sale_modal:    'For Sale',
        status_in_auction_modal: 'On Auction',

        seller_anonymous: 'Anonymous',
        seller_user:      'User',

        collectors_anonymous: 'Anonymous',
        collectors_empty:     'No collectors yet',

        pack_default_name:       'Pack',
        pack_badge:              '📦 Pack',
        pack_for_sale_count:     '🏷 {n} for sale',
        pack_auction_count:      '🔨 {n} auction',
        pack_paintings_count:    '{n} {word} in pack',
        pack_subtitle:           'Pack · {n} {word}',

        auction_finished: 'Ended',

        load_error:       'Loading error',
        gallery_empty:    'Gallery is empty',

        standalone_paintings: 'Individual paintings',

        stars_unit: 'stars',

        share_link_unavailable: '❌ Link unavailable',
        share_link_copied:      '✅ Link copied!',
        share_gallery_text:     '🖼 Check out the NFT Gallery!',
        share_pack_text:        '📦 Check out the pack «{name}» in the NFT Gallery!',
        share_painting_text:    '🎨 Check out «{title}» in the NFT Gallery!',
        share_title:            'NFT Gallery',

        notify_buy_success:       '🎨 Painting added to your collection!',
        notify_buy_error:         'Purchase error',
        notify_sell_success:      '🏷 Painting listed for sale!',
        notify_sell_error:        'Listing error',
        notify_cancel_sale:       '✓ Listing removed',
        notify_cancel_auction:    '✓ Auction cancelled',
        notify_auction_created:   '🔨 Auction started!',
        notify_auction_cancelled: 'Auction cancelled',
        notify_listing_cancelled: 'Listing removed',
        notify_bid_accepted:      '🔨 Bid of {amount} ⭐ accepted!',
        notify_bid_error:         'Bid error',
        notify_bid_min:           'Bid must be above {price} ⭐',
        notify_price_required:    'Please enter a price',
        notify_auction_price_req: 'Please enter a starting price',
        notify_listing_not_found: 'Listing not found',
        notify_auction_not_found: 'Auction not found',
        notify_conn_error:        'Connection error',
        notify_cancel_error:      'Cancellation error',
        notify_generic_error:     'Error',
        notify_price_invalid:     'Please enter a valid price',

        // ── Action buttons ────────────────────────────────────────────────────
        btn_sell:                 '🏷 Sell',
        btn_auction_start:        '🔨 Auction',
        btn_cancel_listing:       '✕ Remove from sale',
        btn_cancel_auction_full:  '🔨 Cancel auction',
        btn_cancel_auction_short: 'Cancel auction',
        btn_buying:               'Buying...',
        btn_buy_for:              'Buy for {price}',
        btn_sold_out:             'Sold out',
        btn_open_pack:            'Open pack',
        btn_remove_listing:       'Remove from sale',
        btn_buy:                  'Buy',
        btn_confirm_buy:          'Confirm purchase',
        btn_listing_progress:     'Listing...',
        btn_submit_listing:       'List for sale',
        btn_creating_auction:     'Creating...',
        btn_launch_auction:       '🔨 Start auction',
        btn_place_bid:            '🔨 Place bid',
        btn_bidding:              'Bidding...',
        btn_submit_bid_label:     '🔨 Place bid',
        pack_view_btn:            'View pack →',

        // ── Supply / Stock ────────────────────────────────────────────────────
        supply_of:                '{remaining} of {total}',
        supply_unlimited:         '∞ Unlimited',
        sold_out_count:           '🔴 0 of {total}',
        remaining_count:          '🔥 {remain} of {total}',
        sold_out_bare:            '0 of {total}',
        unlimited_badge:          '♾ Unlimited',
        btn_sold_out_count:       'Sold out · 0 of {total}',

        // ── Status badges ─────────────────────────────────────────────────────
        bids_no_cancel:           'Bids placed — cannot cancel',
        archive_badge:            '🗄 Archive',
        archive_pack_badge:       '🗄 Archive · {n} {word}',
        auction_live_badge:       'LIVE',
        auction_your_live:        '🔨 Your auction · Bidding live',
        auction_leading:          "✓ You're leading · Outbid",
        current_bid_label:        'Current bid',
        starting_price_label:     'Starting price',
        nft_stars_label:          'NFT stars',
        price_label:              'Price',

        // ── Shop sections ─────────────────────────────────────────────────────
        shop_no_paintings:        'No paintings available',
        shop_soon:                'New works coming soon',
        section_packs:            '📦 Packs',
        section_paintings:        '🎨 Paintings',
        swipe_hint:               '← swipe →',
        shop_all_sold:            'All paintings temporarily sold out',
        section_archive:          'Archive',
        section_archive_packs:    '🗄 Pack archive',
        pack_all_sold:            'All paintings sold out',
        pack_archived_notice:     '🗄 Pack archived — all paintings sold out',

        // ── Marketplace & auctions ────────────────────────────────────────────
        market_empty:             'Marketplace is empty',
        market_empty_sub:         'List your painting from "My Gallery"',
        auctions_empty:           'No active auctions',
        auctions_empty_sub:       'Start an auction from "My Gallery"',

        // ── Time ──────────────────────────────────────────────────────────────
        time_just_now:            'just now',
        time_min_ago:             '{n} min ago',
        time_h_ago:               '{n} h ago',
        time_d_ago:               '{n} d ago',
    },
};

// ─── Плоский словарь для HTML data-i18n (объединяется с главным i18n) ────────
// Ключи начинаются с nft_ чтобы избежать коллизий с основным словарём

const nftI18nFlat = {
    ru: {
        // ── Страница Магазина ─────────────────────────────────────────────────
        nft_shop_island_heading: 'Магазин картин',
        nft_shop_hint:           'Лимитированные NFT-работы',
        nft_shop_loading:        'Загрузка картин...',

        // ── Страница Моя Галерея ──────────────────────────────────────────────
        nft_my_gallery_heading:  'Моя Галерея',
        nft_my_gallery_hint:     'Ваша коллекция NFT',
        nft_gallery_empty_title: 'Галерея пуста',
        nft_gallery_empty_sub:   'Купите первую картину в Магазине',
        nft_gallery_cta:         'Перейти в магазин',

        // ── Страница Галереи ──────────────────────────────────────────────────
        nft_galleries_heading:   'Галереи',
        nft_galleries_hint:      'Коллекции других пользователей',
        nft_galleries_back:      'Все коллекционеры',
        nft_collectors_empty:    'Пока нет коллекционеров',

        // ── Страница История ──────────────────────────────────────────────────
        nft_history_heading:     'История',
        nft_history_hint:        'Операции с NFT-галереей',
        nft_history_empty:       'История пуста',
        nft_history_empty_sub:   'Здесь будут отображаться ваши операции',

        // ── Страница Маркетплейс ──────────────────────────────────────────────
        nft_market_heading:      'Маркетплейс',
        nft_market_hint:         'Картины от других коллекционеров',
        nft_market_empty:        'Маркетплейс пуст',
        nft_market_empty_sub:    'Выставьте свою картину на продажу из «Моей галереи»',

        // ── Страница Аукционы ─────────────────────────────────────────────────
        nft_auctions_heading:    'Аукционы',
        nft_auctions_hint:       'Торги в реальном времени',
        nft_auctions_empty:      'Нет активных аукционов',
        nft_auctions_empty_sub:  'Выставьте картину на аукцион из «Моей галереи»',

        // ── Навигация ─────────────────────────────────────────────────────────
        nft_nav_shop:       'Магазин',
        nft_nav_market:     'Маркет',
        nft_nav_auctions:   'Торги',
        nft_nav_back:       'Назад',
        nft_nav_galleries:  'Галереи',
        nft_nav_history:    'История',
        nft_nav_gallery:    'Моя',

        // ── Модал: детали картины ─────────────────────────────────────────────
        nft_serial_label:       'Серийный №',
        nft_supply_label:       'Тираж',
        nft_seller_label:       'Продавец:',
        nft_price_cost_label:   'Стоимость',
        nft_price_unit:         'звёзд',
        nft_modal_back:         'Назад',

        // ── Модал: подтверждение покупки ──────────────────────────────────────
        nft_buy_confirm_title:  'Купить картину',
        nft_buy_confirm_price:  'Цена',
        nft_balance_label:      'Ваш баланс',
        nft_buy_confirm_btn:    'Подтвердить покупку',
        nft_cancel_btn:         'Отмена',

        // ── Модал: продажа ────────────────────────────────────────────────────
        nft_sell_sub_label:     'Продажа картины',
        nft_sell_price_label:   'Цена продажи (NFT-звёзды)',
        nft_sell_placeholder:   'Например, 100',
        nft_sell_submit_btn:    'Выставить на продажу',

        // ── Модал: аукцион ────────────────────────────────────────────────────
        nft_auction_sub_label:     'Запустить аукцион',
        nft_auction_price_label:   'Начальная цена (NFT-звёзды)',
        nft_auction_placeholder:   'Например, 50',
        nft_duration_label:        'Длительность',
        nft_dur_1h:   '1 час',
        nft_dur_3h:   '3 часа',
        nft_dur_6h:   '6 часов',
        nft_dur_12h:  '12 часов',
        nft_dur_24h:  '24 часа',
        nft_dur_48h:  '48 часов',
        nft_auction_submit_btn: '🔨 Запустить аукцион',

        // ── Модал: ставка ─────────────────────────────────────────────────────
        nft_bid_title:        'Сделать ставку',
        nft_bid_current_label: 'Текущая ставка',
        nft_bid_amount_label:  'Ваша ставка (должна быть выше текущей)',
        nft_bid_submit_btn:    '🔨 Поставить',

        // ── Модал: пак ────────────────────────────────────────────────────────
        nft_pack_badge:           '📦 Пак',
        nft_pack_paintings_label: 'Картины в паке',
        nft_close_btn:            'Закрыть',
    },

    en: {
        nft_shop_island_heading: 'Painting Shop',
        nft_shop_hint:           'Limited NFT works',
        nft_shop_loading:        'Loading paintings...',

        nft_my_gallery_heading:  'My Gallery',
        nft_my_gallery_hint:     'Your NFT collection',
        nft_gallery_empty_title: 'Gallery is empty',
        nft_gallery_empty_sub:   'Buy your first painting in the Shop',
        nft_gallery_cta:         'Go to shop',

        nft_galleries_heading:   'Galleries',
        nft_galleries_hint:      "Other users' collections",
        nft_galleries_back:      'All collectors',
        nft_collectors_empty:    'No collectors yet',

        nft_history_heading:     'History',
        nft_history_hint:        'NFT gallery transactions',
        nft_history_empty:       'History is empty',
        nft_history_empty_sub:   'Your transactions will appear here',

        nft_market_heading:      'Marketplace',
        nft_market_hint:         'Paintings from other collectors',
        nft_market_empty:        'Marketplace is empty',
        nft_market_empty_sub:    'List your painting from "My Gallery"',

        nft_auctions_heading:    'Auctions',
        nft_auctions_hint:       'Live auctions',
        nft_auctions_empty:      'No active auctions',
        nft_auctions_empty_sub:  'Start an auction from "My Gallery"',

        nft_nav_shop:       'Shop',
        nft_nav_market:     'Market',
        nft_nav_auctions:   'Auctions',
        nft_nav_back:       'Back',
        nft_nav_galleries:  'Galleries',
        nft_nav_history:    'History',
        nft_nav_gallery:    'Mine',

        nft_serial_label:       'Serial #',
        nft_supply_label:       'Supply',
        nft_seller_label:       'Seller:',
        nft_price_cost_label:   'Price',
        nft_price_unit:         'stars',
        nft_modal_back:         'Back',

        nft_buy_confirm_title:  'Buy painting',
        nft_buy_confirm_price:  'Price',
        nft_balance_label:      'Your balance',
        nft_buy_confirm_btn:    'Confirm purchase',
        nft_cancel_btn:         'Cancel',

        nft_sell_sub_label:     'List painting',
        nft_sell_price_label:   'Sale price (NFT stars)',
        nft_sell_placeholder:   'E.g. 100',
        nft_sell_submit_btn:    'List for sale',

        nft_auction_sub_label:     'Start auction',
        nft_auction_price_label:   'Starting price (NFT stars)',
        nft_auction_placeholder:   'E.g. 50',
        nft_duration_label:        'Duration',
        nft_dur_1h:   '1 hour',
        nft_dur_3h:   '3 hours',
        nft_dur_6h:   '6 hours',
        nft_dur_12h:  '12 hours',
        nft_dur_24h:  '24 hours',
        nft_dur_48h:  '48 hours',
        nft_auction_submit_btn: '🔨 Start auction',

        nft_bid_title:         'Place bid',
        nft_bid_current_label: 'Current bid',
        nft_bid_amount_label:  'Your bid (must be above current)',
        nft_bid_submit_btn:    '🔨 Place bid',

        nft_pack_badge:           '📦 Pack',
        nft_pack_paintings_label: 'Paintings in pack',
        nft_close_btn:            'Close',
    },
};

// ─── Расширяем главный словарь i18n нашими ключами ───────────────────────────
// i18n.js загружается ДО этого файла, поэтому i18n уже определён
if (typeof i18n !== 'undefined') {
    Object.assign(i18n.ru, nftI18nFlat.ru);
    Object.assign(i18n.en, nftI18nFlat.en);
}

// ─── Вспомогательная функция nftT: перевод по ключу из nftI18n ───────────────
// Для строк генерируемых динамически в JS (не через data-i18n в HTML)

function nftT(key, vars) {
    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'ru');
    const dict = nftI18n[lang] || nftI18n['ru'];
    let str = dict[key];
    if (str === undefined) str = (nftI18n['ru'] || {})[key];
    if (str === undefined) return key;
    if (vars) {
        Object.keys(vars).forEach(k => {
            str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
        });
    }
    return str;
}

// ─── Склонение «картина/paintings» ───────────────────────────────────────────
function nftPaintingWord(count) {
    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'ru');
    if (lang === 'en') return count === 1 ? nftT('word_painting_1') : nftT('word_painting_many');
    return count === 1
        ? nftT('word_painting_1')
        : count < 5
            ? nftT('word_painting_few')
            : nftT('word_painting_many');
}

// ─── Перевод data-i18n элементов внутри NFT-секции при смене языка ────────────
function nftApplyI18n() {
    const lang = (typeof currentLang !== 'undefined' ? currentLang : 'ru');
    const dict = i18n && i18n[lang] ? i18n[lang] : {};

    // Обновляем все элементы с data-i18n внутри nft-section
    const nftSection = document.getElementById('nft-section');
    if (nftSection) {
        nftSection.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (dict[key] !== undefined) el.innerHTML = dict[key];
        });
        nftSection.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (dict[key] !== undefined) el.placeholder = dict[key];
        });
    }

    // Перерисовываем динамический контент активной вкладки
    if (typeof nftCurrentTab !== 'undefined') {
        if (nftCurrentTab === 'gallery'   && typeof nftLoadGallery        === 'function') nftLoadGallery(typeof nftViewingUserId !== 'undefined' ? nftViewingUserId : null);
        if (nftCurrentTab === 'galleries' && typeof nftLoadGalleriesPage  === 'function') nftLoadGalleriesPage();
        if (nftCurrentTab === 'history'   && typeof nftLoadHistory        === 'function') nftLoadHistory();
        if (nftCurrentTab === 'market'    && typeof nftLoadMarket         === 'function') nftLoadMarket();
        if (nftCurrentTab === 'auction'   && typeof nftLoadAuctions       === 'function') nftLoadAuctions();
        if (nftCurrentTab === 'shop'      && typeof nftLoadShop           === 'function') nftLoadShop();
    }
}

window.nftT            = nftT;
window.nftPaintingWord = nftPaintingWord;
window.nftI18n         = nftI18n;
window.nftI18nFlat     = nftI18nFlat;
window.nftApplyI18n    = nftApplyI18n;