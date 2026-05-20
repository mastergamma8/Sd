// =====================================================
// ПРОВЕРКА ПОДПИСКИ НА КАНАЛ @Space_Donut
// =====================================================

const CHANNEL_URL = 'https://t.me/Space_Donut';

/**
 * Показывает модальное окно с требованием подписки.
 * Возвращает Promise, который резолвится в true (подписан)
 * или остаётся открытым до проверки.
 */
function showSubRequiredModal() {
    if (typeof openModal === 'function') {
        openModal('channel-sub-modal');
    } else {
        const el = document.getElementById('channel-sub-modal');
        if (el) { el.classList.remove('hidden'); el.classList.add('flex'); }
    }
    // Применяем актуальный язык к элементам модального окна
    if (typeof applyI18n === 'function') applyI18n();
}

/** Открывает канал в Telegram (через TG WebApp или браузер). */
function openChannelAndCheck() {
    try {
        if (window.Telegram && Telegram.WebApp && Telegram.WebApp.openTelegramLink) {
            Telegram.WebApp.openTelegramLink(CHANNEL_URL);
        } else {
            window.open(CHANNEL_URL, '_blank');
        }
    } catch (e) {
        window.open(CHANNEL_URL, '_blank');
    }
}

/** Делает запрос к бэкенду для проверки подписки и закрывает модалку при успехе. */
async function checkSubAndClose() {
    const t   = (typeof i18n !== 'undefined' && i18n[currentLang]) ? i18n[currentLang] : {};
    const btn = document.getElementById('btn-check-sub');
    if (btn) {
        btn.disabled   = true;
        btn.innerText  = t.loading || '⏳ Проверяем...';
    }

    try {
        const res  = await fetch('/api/check_subscription', { headers: getApiHeaders() });
        const data = await res.json();

        if (data.subscribed) {
            if (typeof showNotify === 'function') {
                showNotify(t.sub_check_ok || 'Подписка подтверждена! ✅', 'success');
            }
            if (typeof closeModal === 'function') {
                closeModal('channel-sub-modal');
            } else {
                const el = document.getElementById('channel-sub-modal');
                if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
            }
        } else {
            if (typeof showNotify === 'function') {
                showNotify(t.sub_check_fail || 'Вы ещё не подписаны на @Space_Donut', 'error');
            }
        }
    } catch (e) {
        if (typeof showNotify === 'function') {
            showNotify(t.err_conn || 'Ошибка соединения', 'error');
        }
    } finally {
        if (btn) {
            btn.disabled  = false;
            btn.innerText = t.sub_btn_check || 'Я уже подписан — проверить';
            if (typeof applyI18n === 'function') applyI18n();
        }
    }
}

/**
 * Универсальный перехватчик ответа от сервера.
 * Вызывать сразу после fetch, до обработки данных.
 * Возвращает true если нужно прервать выполнение (показали модалку).
 */
function handleNotSubscribed(data) {
    if (data && data.detail === 'not_subscribed') {
        showSubRequiredModal();
        return true;
    }
    return false;
}

window.showSubRequiredModal = showSubRequiredModal;
window.openChannelAndCheck  = openChannelAndCheck;
window.checkSubAndClose     = checkSubAndClose;
window.handleNotSubscribed  = handleNotSubscribed;
