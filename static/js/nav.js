// =====================================================
// nav.js — Навигация
// =====================================================

function switchTab(tabId) {
    vibrate('light');

    // Если вкладка уже активна — сбрасываем вложенный экран вместо переключения
    const currentNav = document.getElementById(`nav-${tabId}`);
    if (currentNav && currentNav.classList.contains('active')) {
        if (tabId === 'games' && typeof resetGamesView === 'function') {
            resetGamesView();
        }
        if (tabId === 'shop' && typeof resetShopView === 'function') {
            resetShopView();
        }
        return;
    }

    ALL_TABS.forEach(id => {
        const page = document.getElementById(`page-${id}`);
        const nav  = document.getElementById(`nav-${id}`);
        if (page) page.classList.add('hidden-tab');
        if (nav)  nav.classList.remove('active');
    });
    const activePage = document.getElementById(`page-${tabId}`);
    const activeNav  = document.getElementById(`nav-${tabId}`);
    if (activePage) activePage.classList.remove('hidden-tab');
    if (activeNav)  activeNav.classList.add('active');

    onTabSwitch(tabId);
}

function onTabSwitch(tabId) {
    // Останавливаем холостой прокрут рулетки при уходе с вкладки
    if (tabId !== 'roulette' && typeof window._rstripStopIdle === 'function') {
        window._rstripStopIdle();
    }

    if (tabId === 'leaderboard' && typeof loadLeaderboard === 'function') loadLeaderboard();
    if (tabId === 'earn' && typeof loadEarnData === 'function') loadEarnData();
    if (tabId === 'shop' && typeof initShopPage === 'function') initShopPage();

    if (tabId === 'roulette') {
        if (typeof fetchRouletteInfo === 'function') fetchRouletteInfo();
        // Перерисовываем ленту с правильными размерами (контейнер уже виден)
        // и запускаем холостой прокрут, если он ещё не идёт
        if (typeof renderRouletteStrip === 'function') renderRouletteStrip();
        if (typeof window._rstripStartIdle === 'function') window._rstripStartIdle();
    }
}

window.switchTab = switchTab;
