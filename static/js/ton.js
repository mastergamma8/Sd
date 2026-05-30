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

// ── Обновление UI при смене статуса кошелька ─────────────────────────────────

function _updateTonWalletUI(wallet) {
    const addr      = wallet ? wallet.account.address : null;
    const shortAddr = addr ? (addr.slice(0, 6) + '...' + addr.slice(-4)) : '';

    // Профиль: кнопки connect / connected
    const connectBtn     = document.getElementById('ton-connect-btn-profile');
    const connectedPanel = document.getElementById('ton-connected-panel-profile');
    const profileAddrEl  = document.getElementById('profile-ton-address-short');
    const profileWalletEl = document.getElementById('profile-ton-wallet-address');

    if (connectBtn)      connectBtn.classList.toggle('hidden', !!wallet);
    if (connectedPanel)  connectedPanel.classList.toggle('hidden', !wallet);
    if (profileAddrEl)   profileAddrEl.textContent = shortAddr;
    if (profileWalletEl) profileWalletEl.textContent = shortAddr;

    // Модальное окно кошелька
    const modalDisconnected = document.getElementById('ton-modal-disconnected');
    const modalConnected    = document.getElementById('ton-modal-connected');
    const modalPreview      = document.getElementById('ton-modal-wallet-preview');
    const modalBalance      = document.getElementById('ton-modal-balance');

    if (modalDisconnected) modalDisconnected.classList.toggle('hidden', !!wallet);
    if (modalConnected)    modalConnected.classList.toggle('hidden', !wallet);
    if (modalPreview)      modalPreview.textContent = shortAddr;
    if (modalBalance && wallet) {
        const bal = typeof myTonBalance !== 'undefined' ? formatBalance(myTonBalance) : '—';
        modalBalance.textContent = `${bal} TON`;
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
        showNotify('Не удалось загрузить TonConnect. Проверьте интернет-соединение.', 'error');
        return;
    }

    try {
        await tonConnectUI.openModal();
    } catch (e) {
        console.error('[TON] Ошибка открытия модала TonConnect:', e);
        showNotify('Не удалось открыть TonConnect', 'error');
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
    vibrate && vibrate('medium');
    const modal = document.getElementById('ton-wallet-modal');
    if (!modal) return;

    // Обновляем баланс в модалке
    const modalBalance = document.getElementById('ton-modal-balance');
    if (modalBalance && typeof myTonBalance !== 'undefined') {
        modalBalance.textContent = `${formatBalance(myTonBalance)} TON`;
    }

    // Синхронизируем состояние connected/disconnected
    _updateTonWalletUI(tonWalletAddress ? { account: { address: tonWalletAddress } } : null);

    modal.classList.remove('hidden');
}

function closeTonWalletModal() {
    const modal = document.getElementById('ton-wallet-modal');
    if (modal) modal.classList.add('hidden');
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
    modal.classList.remove('hidden');
}

function closeTonDepositModal() {
    const modal = document.getElementById('ton-deposit-modal');
    if (modal) modal.classList.add('hidden');
    if (depositPollInterval) {
        clearInterval(depositPollInterval);
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
        clearInterval(depositPollInterval);
        depositPollInterval = null;
    }
    const amountInput = document.getElementById('ton-deposit-amount');
    const amount = parseFloat(amountInput?.value);

    if (!amount || amount <= 0) {
        showNotify('Введите сумму депозита', 'error');
        return;
    }

    const statusEl = document.getElementById('ton-deposit-status');
    if (statusEl) statusEl.textContent = 'Создаём сессию...';

    try {
        const createResp = await fetch('/api/ton/deposit/create', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ amount_ton: amount })
        });

        if (!createResp.ok) {
            const err = await createResp.json().catch(() => ({}));
            throw new Error(err.detail || 'Ошибка создания сессии депозита');
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
        if (statusEl) statusEl.textContent = 'Ожидаем подтверждения транзакции...';
        depositPollInterval = setInterval(_pollDepositStatus, 5000);

    } catch (err) {
        if (depositPollInterval) {
            clearInterval(depositPollInterval);
            depositPollInterval = null;
        }
        showNotify(err?.message || 'Ошибка отправки транзакции', 'error');
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
            clearInterval(depositPollInterval);
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
            showNotify(`✅ Депозит зачислен: ${(data.amount_ton || 0).toFixed(4)} TON`, 'success');

        } else if (!resp.ok) {
            // Гонка: если Poll A уже подтвердил депозит и обнулил currentDepositMemo,
            // Poll B не должен показывать ошибку.
            if (!currentDepositMemo) return;
            clearInterval(depositPollInterval);
            depositPollInterval = null;
            showNotify(data.detail || 'Ошибка депозита', 'error');
        }
        // status === 'pending' — просто ждём дальше
    } catch (err) {
        console.warn('[TON poll]', err);
    }
}

// ── Модальное окно вывода ─────────────────────────────────────────────────────

function openTonWithdrawModal() {
    if (!tonWalletAddress) {
        showNotify('Сначала подключите TON-кошелёк', 'error');
        connectTonWallet();
        return;
    }
    const addrEl = document.getElementById('withdraw-wallet-preview');
    if (addrEl) {
        addrEl.textContent = tonWalletAddress.slice(0, 8) + '...' + tonWalletAddress.slice(-6);
    }
    const modal = document.getElementById('ton-withdraw-modal');
    if (!modal) return;
    const amountEl = document.getElementById('ton-withdraw-amount');
    if (amountEl) amountEl.value = '';
    modal.classList.remove('hidden');
}

function closeTonWithdrawModal() {
    const modal = document.getElementById('ton-withdraw-modal');
    if (modal) modal.classList.add('hidden');
}

async function submitTonWithdraw() {
    const amountInput = document.getElementById('ton-withdraw-amount');
    const amount = parseFloat(amountInput?.value);

    if (!amount || amount <= 0) {
        showNotify('Введите сумму вывода', 'error');
        return;
    }

    const btn = document.getElementById('ton-withdraw-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Отправляем...'; }

    try {
        const resp = await fetch('/api/ton/withdraw', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ amount_ton: amount })
        });
        const data = await resp.json();

        if (!resp.ok) throw new Error(data.detail || 'Ошибка вывода');

        closeTonWithdrawModal();
        if (typeof myTonBalance !== 'undefined' && data.new_ton_balance !== undefined) {
            myTonBalance = data.new_ton_balance;
            if (typeof updateTonBalanceUI === 'function') updateTonBalanceUI();
        }
        if (typeof myBalance !== 'undefined' && data.new_balance !== undefined) {
            myBalance = data.new_balance;
            if (typeof updateUI === 'function') updateUI();
        }
        showNotify(
            `✅ Отправлено ${(data.amount_ton || 0).toFixed(4)} TON → ${(data.to_address || '').slice(0, 8)}...`,
            'success'
        );
    } catch (err) {
        showNotify(err.message || 'Ошибка вывода', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Вывести'; }
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