// =====================================================
// games.js — Базовый роутер и логика для раздела Игр
// =====================================================

/**
 * Открывает экран игры и скрывает главное меню игр.
 * Используй эту функцию для добавления новых игр.
 * @param {string} viewId - ID HTML-контейнера новой игры (например, 'games-mines-view')
 */
function showGameView(viewId) {
    if (typeof vibrate === 'function') vibrate('light');
    const mainView = document.getElementById('games-main-view');
    const gameView = document.getElementById(viewId);
    
    if (mainView) mainView.classList.add('hidden');
    if (gameView) gameView.classList.remove('hidden');
}

/**
 * Закрывает экран игры и возвращает в главное меню игр.
 * Используй эту функцию для кнопки "Назад" в новых играх.
 * @param {string} viewId - ID HTML-контейнера текущей игры
 */
function hideGameView(viewId) {
    if (typeof vibrate === 'function') vibrate('light');
    const mainView = document.getElementById('games-main-view');
    const gameView = document.getElementById(viewId);
    
    if (gameView) gameView.classList.add('hidden');
    if (mainView) mainView.classList.remove('hidden');
}

// Экспорт базовых функций в глобальную область видимости
window.showGameView = showGameView;
window.hideGameView = hideGameView;
/**
 * Сбрасывает раздел игр на главный экран со списком игр.
 * Вызывается при повторном нажатии на кнопку "Игры" в навигации.
 *
 * Важно: вызываем именно close-функции каждой игры, а не прячем DOM напрямую.
 * Это гарантирует остановку поллинга и вибрации (в т.ч. при race-condition
 * когда async-запрос уже в полёте в момент закрытия).
 *
 * Возвращает true, если какой-то игровой экран был закрыт.
 */
function resetGamesView() {
    let anyOpen = false;

    // Ракета
    const rocketView = document.getElementById('games-rocket-view');
    if (rocketView && !rocketView.classList.contains('hidden')) {
        if (typeof closeRocketGame === 'function') {
            closeRocketGame();
        } else {
            rocketView.classList.add('hidden');
        }
        anyOpen = true;
    }

    // Кейсы
    const casesView = document.getElementById('games-cases-list-view');
    if (casesView && !casesView.classList.contains('hidden')) {
        if (typeof closeGamesCases === 'function') {
            closeGamesCases();
        } else {
            casesView.classList.add('hidden');
        }
        anyOpen = true;
    }

    // PVP
    const pvpView = document.getElementById('games-pvp-view');
    if (pvpView && !pvpView.classList.contains('hidden')) {
        if (typeof closePvpGame === 'function') {
            closePvpGame();
        } else {
            pvpView.classList.add('hidden');
        }
        anyOpen = true;
    }

    // Показываем главный экран, если что-то было закрыто
    if (anyOpen) {
        const mainView = document.getElementById('games-main-view');
        if (mainView) mainView.classList.remove('hidden');
        if (typeof vibrate === 'function') vibrate('light');
    }

    return anyOpen;
}

window.resetGamesView = resetGamesView;
