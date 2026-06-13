// =====================================================
// ton.js — TonConnect: кошелёк, депозит, вывод TON
// Зависимости: globals.js (getApiHeaders, showNotify, formatBalance)
// CDN: @tonconnect/ui, tonweb — подключены в <head> index.html
// =====================================================

// ── Глобальное состояние ─────────────────────────────────────────────────────

let tonConnectUI        = null;
let tonWalletAddress    = null;
let currentDepositMemo  = null;
let depositPollInterval = null;
let tonNetwork          = null;   // '-3' testnet | '-239' mainnet; загружается из /api/ton/config
let tonConfigLoaded     = false;
let walletBlockchainBalance = null; // Реальный баланс кошелька из блокчейна (не баланс приложения)

// Лимиты из конфига (заполняются при loadTonConfig)
let tonMinDeposit  = 0.1;
let tonMaxDeposit  = 100.0;
let tonMinWithdraw = 0.5;
let tonMaxWithdraw = 50.0;
let tonWithdrawFee = 0.05;

// ── Вспомогательные функции для адресов и сумм ───────────────────────────────

/**
 * Converts a raw TON address (0:hex64) to a user-friendly base64url format
 * (UQ... on mainnet / kQ... on testnet).
 * Falls back to the raw string if TonWeb is unavailable or conversion fails.
 */
function _toFriendlyAddr(raw) {
    if (!raw) return '';
    try {
        if (typeof TonWeb !== 'undefined' && TonWeb.utils && TonWeb.utils.Address) {
            const addr = new TonWeb.utils.Address(raw);
            // non-bounceable (UQ.../kQ...) is the standard user-facing format
            return addr.toString(true, true, false, !!window.__TON_TESTNET__);
        }
    } catch (e) { /* fall through */ }
    return raw;
}

/** Returns a short label for compact display: "UQBm_A...ExAW" */
function _shortAddr(raw) {
    if (!raw) return '';
    const friendly = _toFriendlyAddr(raw);
    return friendly.length > 12
        ? friendly.slice(0, 6) + '...' + friendly.slice(-4)
        : friendly;
}

/** Formats a TON amount with up to 4 decimal places, trailing zeros stripped. */
function _fmtTon(amount) {
    if (amount === undefined || amount === null || amount === '') return '—';
    const n = parseFloat(amount);
    return isNaN(n) ? '—' : parseFloat(n.toFixed(4)).toString();
}

/** Возвращает локализованную строку лимитов из i18n словаря */
function _limitsText(key, min, max) {
    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
    const tpl = (typeof i18n !== 'undefined' && i18n[lang] && i18n[lang][key])
        ? i18n[lang][key]
        : 'Min. {min} · Max. {max}';
    return tpl.replace('{min}', min).replace('{max}', max);
}

/** Обновляет строки лимитов и комиссии в обоих модальных окнах. */
function _updateLimitsUI() {
    const depLim = document.getElementById('ton-deposit-limits');
    if (depLim) depLim.textContent = _limitsText('ton_deposit_limits', tonMinDeposit, tonMaxDeposit);

    const witLim = document.getElementById('ton-withdraw-limits');
    if (witLim) witLim.textContent = _limitsText('ton_withdraw_limits', tonMinWithdraw, tonMaxWithdraw);

    const feeEl = document.getElementById('ton-withdraw-fee-value');
    if (feeEl) feeEl.textContent = `~${tonWithdrawFee} TON`;
}

// ── Загрузка конфигурации сети с сервера ─────────────────────────────────────
// Определяет сеть (testnet / mainnet) один раз и кэширует результат.
// Вызывается из initTonConnect() до создания TonConnectUI.

async function loadTonConfig() {
    if (tonConfigLoaded) return;

    const resp = await fetch('/api/ton/config', {
        method: 'GET',
        headers: getApiHeaders(),
    });

    if (!resp.ok) {
        throw new Error('Не удалось загрузить TON config');
    }

    const cfg = await resp.json();
    tonNetwork             = cfg.is_testnet ? '-3' : '-239';
    window.__TON_TESTNET__ = !!cfg.is_testnet; // булевый флаг для startTonDeposit
    tonConfigLoaded        = true;

    // Сохраняем лимиты из конфига
    if (cfg.min_deposit  !== undefined) tonMinDeposit  = cfg.min_deposit;
    if (cfg.max_deposit  !== undefined) tonMaxDeposit  = cfg.max_deposit;
    if (cfg.min_withdraw !== undefined) tonMinWithdraw = cfg.min_withdraw;
    if (cfg.max_withdraw !== undefined) tonMaxWithdraw = cfg.max_withdraw;
    if (cfg.withdraw_fee !== undefined) tonWithdrawFee = cfg.withdraw_fee;

    // Обновляем атрибуты input-полей из реальных лимитов конфига
    const depInput = document.getElementById('ton-deposit-amount');
    if (depInput) { depInput.min = tonMinDeposit; depInput.max = tonMaxDeposit; }
    const witInput = document.getElementById('ton-withdraw-amount');
    if (witInput) { witInput.min = tonMinWithdraw; witInput.max = tonMaxWithdraw; }

    // Обновляем строки лимитов в UI
    _updateLimitsUI();
}

// ── Инициализация TonConnect ─────────────────────────────────────────────────
// CDN загружается синхронно в <head>, поэтому TON_CONNECT_UI гарантированно
// доступен к моменту выполнения этого файла.

async function initTonConnect() {
    if (tonConnectUI) return;   // уже инициализирован

    if (typeof TON_CONNECT_UI === 'undefined') {
        console.error(
            '[TON] TON_CONNECT_UI не определён. ' +
            'Убедитесь, что <script src="@tonconnect/ui"> находится в <head> index.html, ' +
            'а не внутри партиала (скрипты в innerHTML/outerHTML не исполняются браузером).'
        );
        return;
    }

    try {
        await loadTonConfig();

        tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
            manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
        });

        // Слушаем изменение статуса подключения
        tonConnectUI.onStatusChange(async wallet => {
            tonWalletAddress = wallet ? wallet.account.address : null;
            _updateTonWalletUI(wallet);

            // При подключении — сохраняем адрес на сервере
            if (wallet) {
                try {
                    await fetch('/api/ton/wallet/save', {
                        method: 'POST',
                        headers: getApiHeaders(),
                        body: JSON.stringify({ wallet_address: wallet.account.address })
                    });
                } catch (e) {
                    console.warn('[TON] Не удалось сохранить адрес кошелька:', e);
                }
            }
        });

        console.log('[TON] TonConnect инициализирован');
    } catch (e) {
        console.error('[TON] Ошибка инициализации TonConnect:', e);
        tonConnectUI = null;
    }
}

// ── Получение реального баланса кошелька из блокчейна ────────────────────────
// Запрашивает /api/ton/wallet/balance, который проксирует запрос к Toncenter.
// Результат кэшируется в walletBlockchainBalance и обновляет все открытые элементы.

async function _fetchWalletBalance() {
    if (!tonWalletAddress) {
        walletBlockchainBalance = null;
        _applyWalletBalanceToUI('—');
        return null;
    }

    // Показываем индикатор загрузки
    _applyWalletBalanceToUI('...');

    try {
        const resp = await fetch('/api/ton/wallet/balance', {
            method: 'GET',
            headers: getApiHeaders(),
        });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        const data = await resp.json();

        if (data.wallet_balance !== null && data.wallet_balance !== undefined) {
            walletBlockchainBalance = data.wallet_balance;
            _applyWalletBalanceToUI(_fmtTon(walletBlockchainBalance));
            return walletBlockchainBalance;
        }
    } catch (e) {
        console.warn('[TON] Не удалось получить баланс кошелька:', e);
    }

    walletBlockchainBalance = null;
    _applyWalletBalanceToUI('—');
    return null;
}

/** Применяет строку балансa ко всем отображающим его элементам кошелька. */
function _applyWalletBalanceToUI(text) {
    const walletBal  = document.getElementById('ton-modal-balance');
    const depositBal = document.getElementById('ton-deposit-bal');
    if (walletBal)  walletBal.textContent  = text;
    if (depositBal) depositBal.textContent = text;
}

// ── Обновление UI при смене статуса кошелька ─────────────────────────────────

function _updateTonWalletUI(wallet) {
    const addr      = wallet ? wallet.account.address : null;
    const shortAddr = addr ? _shortAddr(addr) : '';

    // Профиль: кнопки connect / connected (элементы удалены, но проверки null-safe)
    const connectBtn      = document.getElementById('ton-connect-btn-profile');
    const connectedPanel  = document.getElementById('ton-connected-panel-profile');
    const profileAddrEl   = document.getElementById('profile-ton-address-short');
    const profileWalletEl = document.getElementById('profile-ton-wallet-address');

    if (connectBtn)      connectBtn.classList.toggle('hidden', !!wallet);
    if (connectedPanel)  connectedPanel.classList.toggle('hidden', !wallet);
    if (profileAddrEl)   profileAddrEl.textContent = shortAddr;
    if (profileWalletEl) profileWalletEl.textContent = shortAddr;

    // Модальное окно кошелька
    const modalDisconnected = document.getElementById('ton-modal-disconnected');
    const modalConnected    = document.getElementById('ton-modal-connected');
    const modalPreview      = document.getElementById('ton-modal-wallet-preview');
    const modalAddr         = document.getElementById('ton-modal-addr');
    const modalBalance      = document.getElementById('ton-modal-balance');

    if (modalDisconnected) modalDisconnected.classList.toggle('hidden', !!wallet);
    if (modalConnected)    modalConnected.classList.toggle('hidden', !wallet);
    if (modalPreview)      modalPreview.textContent = shortAddr;
    if (modalAddr)         modalAddr.textContent = shortAddr;

    // Баланс кошелька: показываем реальный блокчейн-баланс, а не баланс приложения
    if (modalBalance) {
        if (!wallet) {
            modalBalance.textContent = '—';
        } else if (walletBlockchainBalance !== null) {
            modalBalance.textContent = _fmtTon(walletBlockchainBalance);
        } else {
            modalBalance.textContent = '...'; // идёт загрузка
        }
    }
}

// ── Подключение / отключение ─────────────────────────────────────────────────

async function connectTonWallet() {
    // На случай если initTonConnect ещё не вызывался (edge-case)
    if (!tonConnectUI) {
        await initTonConnect();
    }

    if (!tonConnectUI) {
        // CDN не загружен — скорее всего проблема с сетью
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
        const msg = (typeof i18n !== 'undefined' && i18n[lang]?.ton_connect_error)
            ? i18n[lang].ton_connect_error
            : 'Не удалось загрузить TonConnect. Проверьте интернет-соединение.';
        showNotify(msg, 'error');
        return;
    }

    try {
        await tonConnectUI.openModal();
    } catch (e) {
        console.error('[TON] Ошибка открытия модала TonConnect:', e);
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
        const msg = (typeof i18n !== 'undefined' && i18n[lang]?.ton_connect_modal_error)
            ? i18n[lang].ton_connect_modal_error
            : 'Не удалось открыть TonConnect';
        showNotify(msg, 'error');
    }
}

async function disconnectTonWallet() {
    if (tonConnectUI) {
        await tonConnectUI.disconnect();
    }
    closeTonWalletModal();
}

// ── Модальное окно кошелька ───────────────────────────────────────────────────

function openTonWalletModal() {
    _updateTonWalletUI(tonWalletAddress ? { account: { address: tonWalletAddress } } : null);
    openModal('ton-wallet-modal');
    // Асинхронно загружаем реальный баланс кошелька из блокчейна
    if (tonWalletAddress) _fetchWalletBalance();
}

function closeTonWalletModal() {
    closeModal('ton-wallet-modal');
}

// ── Модальное окно депозита ───────────────────────────────────────────────────

async function openTonDepositModal() {
    if (!tonConnectUI || !tonWalletAddress) {
        await connectTonWallet();
        return;
    }
    const modal = document.getElementById('ton-deposit-modal');
    if (!modal) return;
    const statusEl = document.getElementById('ton-deposit-status');
    if (statusEl) statusEl.textContent = '';
    const amountEl = document.getElementById('ton-deposit-amount');
    if (amountEl) amountEl.value = '';

    // Заполняем адрес кошелька
    const addrEl = document.getElementById('ton-deposit-addr');
    if (addrEl) addrEl.textContent = _shortAddr(tonWalletAddress);

    // Показываем '...' пока грузится реальный баланс
    const balEl = document.getElementById('ton-deposit-bal');
    if (balEl) balEl.textContent = walletBlockchainBalance !== null ? _fmtTon(walletBlockchainBalance) : '...';

    // Обновляем строки лимитов
    _updateLimitsUI();

    openModal('ton-deposit-modal');

    // Загружаем актуальный баланс кошелька из блокчейна
    _fetchWalletBalance();
}

function closeTonDepositModal() {
    closeModal('ton-deposit-modal');
    if (depositPollInterval) {
        clearTimeout(depositPollInterval);
        depositPollInterval = null;
    }
    currentDepositMemo = null; // ← очищаем memo при закрытии
}

// ── Построение BOC-payload для текстового комментария ────────────────────────
// Заменяем ручной BOC на TonWeb.boc.Cell — официальный способ из документации TON.
// Ручная сборка была подозрительным местом: незначительная ошибка в дескрипторных
// байтах или выравнивании приводила бы к NPE внутри Android-кошелька.
// Base64 по-прежнему через нативный btoa: TonWeb.utils.bytesToBase64 нестабилен
// на Android и оставлен вне цепочки.

async function _buildCommentPayload(text) {
    const cell = new TonWeb.boc.Cell();
    cell.bits.writeUint(0, 32);   // op-code = 0 → текстовый комментарий
    cell.bits.writeString(text);
    const bocBytes = await cell.toBoc(false); // Uint8Array; false = без CRC32
    let binary = '';
    bocBytes.forEach(b => { binary += String.fromCharCode(b); });
    return btoa(binary);
}

async function startTonDeposit() {
    // Остановить предыдущий цикл, если он ещё активен (двойной клик и т.п.)
    if (depositPollInterval) {
        clearTimeout(depositPollInterval);
        depositPollInterval = null;
    }
    const amountInput = document.getElementById('ton-deposit-amount');
    const amount = parseFloat(amountInput?.value);

    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
    const t = (key, fallback) => (typeof i18n !== 'undefined' && i18n[lang]?.[key]) ? i18n[lang][key] : fallback;

    if (!amount || amount <= 0) {
        showNotify(t('ton_deposit_error_amount', 'Введите сумму депозита'), 'error');
        return;
    }
    if (amount < tonMinDeposit) {
        showNotify(t('ton_deposit_error_min', 'Минимальная сумма пополнения: {min} TON').replace('{min}', tonMinDeposit), 'error');
        return;
    }
    if (amount > tonMaxDeposit) {
        showNotify(t('ton_deposit_error_max', 'Максимальная сумма пополнения: {max} TON').replace('{max}', tonMaxDeposit), 'error');
        return;
    }
    if (walletBlockchainBalance !== null && amount > walletBlockchainBalance) {
        showNotify(t('ton_deposit_error_no_funds', 'Недостаточно TON в кошельке'), 'error');
        return;
    }

    const statusEl = document.getElementById('ton-deposit-status');
    if (statusEl) statusEl.textContent = t('ton_deposit_creating', 'Создаём сессию...');

    try {
        const createResp = await fetch('/api/ton/deposit/create', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ amount_ton: amount })
        });

        if (!createResp.ok) {
            const errData = await createResp.json().catch(() => ({}));
            // Map known server-side error codes to user-friendly i18n keys
            if (createResp.status === 503 || createResp.status === 500) {
                throw Object.assign(new Error(errData.detail || ''), { _i18nKey: 'ton_deposit_error_session' });
            }
            throw new Error(errData.detail || 'Ошибка создания сессии депозита');
        }

        const { memo, wallet_address, expires_at } = await createResp.json();

        const recipient = String(wallet_address || '').trim();
        if (!recipient) {
            throw new Error('Пустой адрес получателя TON');
        }

        const network = window.__TON_TESTNET__ ? '-3' : '-239';
        const payload = await _buildCommentPayload(memo); // async: TonWeb.boc.Cell

        console.log('[TON deposit tx]', {
            network,
            recipient,
            amountNano: String(Math.floor(amount * 1_000_000_000)),
            payloadLen: payload?.length || 0,
        });

        // ── ДИАГНОСТИКА ──────────────────────────────────────────────────────
        // Если транзакция проходит без payload → проблема в _buildCommentPayload.
        // Для теста: замените txMessages ниже на закомментированный вариант.
        const txMessages = [{
            address: recipient,
            amount:  String(Math.floor(amount * 1_000_000_000)),
            payload: payload,
        }];
        // Тест без payload:
        // const txMessages = [{
        //     address: recipient,
        //     amount:  String(Math.floor(amount * 1_000_000_000)),
        // }];
        // ─────────────────────────────────────────────────────────────────────

        await tonConnectUI.sendTransaction({
            validUntil: Number(expires_at),
            network,
            messages: txMessages,
        });

        currentDepositMemo = memo;
        if (statusEl) statusEl.textContent = t('ton_deposit_waiting', 'Ожидаем подтверждения транзакции...');
        depositPollInterval = setTimeout(_pollDepositStatus, 5000);

    } catch (err) {
        if (depositPollInterval) {
            clearTimeout(depositPollInterval);
            depositPollInterval = null;
        }

        // Classify error for a user-friendly message
        const errMsg  = (err?.message || '').toLowerCase();
        const errCode = err?.code;

        let notifyMsg;
        if (err?._i18nKey) {
            // Server mapped a specific key (e.g. session creation failure)
            notifyMsg = t(err._i18nKey, err.message);
        } else if (errCode === 300 || errMsg.includes('reject') || errMsg.includes('cancel') || errMsg.includes('declined') || errMsg.includes('user closed')) {
            // User tapped "Cancel" / closed the wallet popup
            notifyMsg = t('ton_deposit_cancelled', 'Транзакция отменена');
        } else if (errMsg.includes('expired') || errMsg.includes('timeout') || errMsg.includes('valid until')) {
            // Transaction window expired before the user confirmed
            notifyMsg = t('ton_deposit_expired', 'Время сессии истекло. Начните заново');
        } else if (errMsg.includes('failed to fetch') || errMsg.includes('networkerror') || errMsg.includes('network') || errMsg.includes('connection')) {
            // Internet / server unreachable
            notifyMsg = t('ton_deposit_error_network', 'Ошибка соединения. Попробуйте ещё раз');
        } else {
            notifyMsg = t('ton_deposit_error_generic', 'Ошибка при отправке транзакции. Попробуйте ещё раз');
        }

        showNotify(notifyMsg, 'error');
        if (statusEl) statusEl.textContent = '';
        console.error('[TON deposit]', err);
    }
}

async function _pollDepositStatus() {
    if (!currentDepositMemo) return;

    try {
        const resp = await fetch('/api/ton/deposit/verify', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ memo: currentDepositMemo })
        });
        const data = await resp.json();

        if (data.status === 'confirmed') {
            clearTimeout(depositPollInterval);
            depositPollInterval = null;
            currentDepositMemo  = null;

            if (typeof myTonBalance !== 'undefined' && data.new_ton_balance !== undefined) {
                myTonBalance = data.new_ton_balance;
                if (typeof updateTonBalanceUI === 'function') updateTonBalanceUI();
            }
            if (typeof myBalance !== 'undefined' && data.new_balance !== undefined) {
                myBalance = data.new_balance;
                if (typeof updateUI === 'function') updateUI();
            }
            closeTonDepositModal();

            const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
            const tpl = (typeof i18n !== 'undefined' && i18n[lang]?.ton_deposit_success)
                ? i18n[lang].ton_deposit_success
                : '✅ Депозит зачислен: {amount} TON';
            showNotify(tpl.replace('{amount}', (data.amount_ton || 0).toFixed(4)), 'success');

        } else if (!resp.ok) {
            // Гонка: если Poll A уже подтвердил депозит и обнулил currentDepositMemo,
            // Poll B не должен показывать ошибку.
            if (!currentDepositMemo) return;
            clearTimeout(depositPollInterval);
            depositPollInterval = null;
            showNotify(data.detail || 'Ошибка депозита', 'error');
        }
        // status === 'pending' — просто ждём дальше
    } catch (err) {
        console.warn('[TON poll]', err);
    }
    // Следующий вызов только после завершения текущего (рекурсивный setTimeout вместо setInterval)
    if (currentDepositMemo) {
        depositPollInterval = setTimeout(_pollDepositStatus, 5000);
    }
}

// ── Модальное окно вывода ─────────────────────────────────────────────────────

function openTonWithdrawModal() {
    if (!tonWalletAddress) {
        const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
        const msg = (typeof i18n !== 'undefined' && i18n[lang]?.ton_no_wallet_error)
            ? i18n[lang].ton_no_wallet_error
            : 'Сначала подключите TON-кошелёк';
        showNotify(msg, 'error');
        connectTonWallet();
        return;
    }
    const modal = document.getElementById('ton-withdraw-modal');
    if (!modal) return;

    // Заполняем адрес и доступный баланс в приложении (не блокчейн-баланс!)
    const addrEl = document.getElementById('withdraw-wallet-preview');
    if (addrEl) addrEl.textContent = _shortAddr(tonWalletAddress);
    const balEl = document.getElementById('ton-withdraw-bal');
    if (balEl) balEl.textContent = typeof myTonBalance !== 'undefined' ? _fmtTon(myTonBalance) : '—';

    const amountEl = document.getElementById('ton-withdraw-amount');
    if (amountEl) amountEl.value = '';

    // Обновляем строки лимитов и комиссию
    _updateLimitsUI();

    openModal('ton-withdraw-modal');
}

function closeTonWithdrawModal() {
    closeModal('ton-withdraw-modal');
}

async function submitTonWithdraw() {
    const amountInput = document.getElementById('ton-withdraw-amount');
    const amount = parseFloat(amountInput?.value);

    const lang = typeof currentLang !== 'undefined' ? currentLang : 'ru';
    const t = (key, fallback) => (typeof i18n !== 'undefined' && i18n[lang]?.[key]) ? i18n[lang][key] : fallback;

    if (!amount || amount <= 0) {
        showNotify(t('ton_withdraw_error_amount', 'Введите сумму вывода'), 'error');
        return;
    }
    if (amount < tonMinWithdraw) {
        showNotify(t('ton_withdraw_error_min', 'Минимальная сумма вывода: {min} TON').replace('{min}', tonMinWithdraw), 'error');
        return;
    }
    if (amount > tonMaxWithdraw) {
        showNotify(t('ton_withdraw_error_max', 'Максимальная сумма вывода: {max} TON').replace('{max}', tonMaxWithdraw), 'error');
        return;
    }
    if (typeof myTonBalance !== 'undefined' && amount > myTonBalance) {
        showNotify(t('ton_withdraw_error_no_funds', 'Недостаточно TON для вывода'), 'error');
        return;
    }

    const btn = document.getElementById('ton-withdraw-btn');
    if (btn) { btn.disabled = true; btn.textContent = t('ton_withdraw_sending', 'Отправляем...'); }

    try {
        const resp = await fetch('/api/ton/withdraw', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ amount_ton: amount })
        });
        const data = await resp.json();

        if (!resp.ok) {
            // Map known error codes to i18n keys
            if (data.detail && data.detail.toLowerCase().includes('insuffic')) {
                throw Object.assign(new Error(data.detail), { _i18nKey: 'ton_withdraw_error_no_funds' });
            }
            throw new Error(data.detail || '');
        }

        closeTonWithdrawModal();
        if (typeof myTonBalance !== 'undefined' && data.new_ton_balance !== undefined) {
            myTonBalance = data.new_ton_balance;
            if (typeof updateTonBalanceUI === 'function') updateTonBalanceUI();
        }
        if (typeof myBalance !== 'undefined' && data.new_balance !== undefined) {
            myBalance = data.new_balance;
            if (typeof updateUI === 'function') updateUI();
        }

        const tpl = t('ton_withdraw_success_msg', '✅ Отправлено {amount} TON → {addr}...');
        showNotify(
            tpl.replace('{amount}', (data.amount_ton || 0).toFixed(4))
               .replace('{addr}', (data.to_address || '').slice(0, 8)),
            'success'
        );
    } catch (err) {
        const errMsg = (err?.message || '').toLowerCase();
        let notifyMsg;
        if (err?._i18nKey) {
            notifyMsg = t(err._i18nKey, err.message);
        } else if (errMsg.includes('insuffic') || errMsg.includes('недостаточно')) {
            notifyMsg = t('ton_withdraw_error_no_funds', 'Недостаточно TON для вывода');
        } else if (errMsg.includes('failed to fetch') || errMsg.includes('network') || errMsg.includes('connection')) {
            notifyMsg = t('ton_deposit_error_network', 'Ошибка соединения. Попробуйте ещё раз');
        } else {
            notifyMsg = t('ton_withdraw_error_generic', 'Ошибка при выводе средств. Попробуйте позже');
        }
        showNotify(notifyMsg, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = t('ton_withdraw_btn_label', 'Вывести'); }
    }
}

// ── Обновление баланса TON в хэдере ─────────────────────────────────────────
// Вызывается из updateUI() в globals.js

function updateTonBalanceUI() {
    const el = document.getElementById('ton-balance-amount');
    if (el && typeof myTonBalance !== 'undefined') {
        el.textContent = formatBalance(myTonBalance);
    }
}

// ── MAX-кнопки: вставить весь баланс в поле ввода ────────────────────────────

/** Вставляет весь баланс кошелька в поле суммы депозита. */
function fillDepositMax() {
    if (walletBlockchainBalance === null || walletBlockchainBalance <= 0) return;
    const input = document.getElementById('ton-deposit-amount');
    if (input) {
        vibrate('light');
        // Округляем до 4 знаков и убираем лишние нули
        input.value = parseFloat(walletBlockchainBalance.toFixed(4));
        input.dispatchEvent(new Event('input'));
    }
}

/** Вставляет весь баланс приложения в поле суммы вывода. */
function fillWithdrawMax() {
    if (typeof myTonBalance === 'undefined' || myTonBalance <= 0) return;
    const input = document.getElementById('ton-withdraw-amount');
    if (input) {
        vibrate('light');
        input.value = parseFloat(myTonBalance.toFixed(4));
        input.dispatchEvent(new Event('input'));
    }
}

// ── Запуск: CDN в <head> гарантирует, что TON_CONNECT_UI доступен здесь ──────

initTonConnect();

// ── Экспорт ───────────────────────────────────────────────────────────────────

window.initTonConnect        = initTonConnect;
window.connectTonWallet      = connectTonWallet;
window.disconnectTonWallet   = disconnectTonWallet;
window.openTonWalletModal    = openTonWalletModal;
window.closeTonWalletModal   = closeTonWalletModal;
window.openTonDepositModal   = openTonDepositModal;
window.closeTonDepositModal  = closeTonDepositModal;
window.startTonDeposit       = startTonDeposit;
window.openTonWithdrawModal  = openTonWithdrawModal;
window.closeTonWithdrawModal = closeTonWithdrawModal;
window.submitTonWithdraw     = submitTonWithdraw;
window.updateTonBalanceUI    = updateTonBalanceUI;
window.fillDepositMax        = fillDepositMax;
window.fillWithdrawMax       = fillWithdrawMax;