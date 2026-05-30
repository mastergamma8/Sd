// =====================================================
// ton.js — TonConnect: кошелёк, депозит, вывод TON
// Зависимости: globals.js (getApiHeaders, showNotify, formatBalance)
// CDN: @tonconnect/ui, tonweb (загружаются в header.html)
// =====================================================

// ── Глобальное состояние ─────────────────────────────────────────────────────

let tonConnectUI       = null;
let tonWalletAddress   = null;
let currentDepositMemo = null;
let depositPollInterval = null;

// ── Инициализация TonConnect ─────────────────────────────────────────────────

async function initTonConnect() {
    if (tonConnectUI) return;

    // Ждём загрузки CDN-библиотеки
    if (typeof TON_CONNECT_UI === 'undefined') {
        console.warn('[TON] TonConnect UI не загружен');
        return;
    }

    try {
        tonConnectUI = new TON_CONNECT_UI.TonConnectUI({
            manifestUrl: `${window.location.origin}/tonconnect-manifest.json`,
        });

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
    } catch (e) {
        console.warn('[TON] Ошибка инициализации TonConnect:', e);
    }
}

// ── Обновление UI при смене статуса кошелька ─────────────────────────────────

function _updateTonWalletUI(wallet) {
    const addr      = wallet ? wallet.account.address : null;
    const shortAddr = addr ? (addr.slice(0, 6) + '...' + addr.slice(-4)) : '';

    // Header: элементы без изменений (баланс обновляется через updateUI)

    // Профиль: кнопки connect/connected
    const connectBtn    = document.getElementById('ton-connect-btn-profile');
    const connectedPanel = document.getElementById('ton-connected-panel-profile');
    const profileAddrEl  = document.getElementById('profile-ton-address-short');
    const profileWalletEl = document.getElementById('profile-ton-wallet-address');

    if (connectBtn)     connectBtn.classList.toggle('hidden', !!wallet);
    if (connectedPanel) connectedPanel.classList.toggle('hidden', !wallet);
    if (profileAddrEl)  profileAddrEl.textContent = shortAddr;
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
        const bal = typeof myBalance !== 'undefined' ? formatBalance(myBalance) : '—';
        if (modalBalance) modalBalance.textContent = `${bal} 🍩`;
    }
}

// ── Подключение / отключение ─────────────────────────────────────────────────

async function connectTonWallet() {
    if (!tonConnectUI) await initTonConnect();
    if (!tonConnectUI) {
        showNotify('TonConnect не загружен. Проверьте соединение.', 'error');
        return;
    }
    try {
        await tonConnectUI.openModal();
    } catch (e) {
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
    if (modalBalance && typeof myBalance !== 'undefined') {
        modalBalance.textContent = `${formatBalance(myBalance)} 🍩`;
    }

    // Если кошелёк уже подключён — показываем панель connected
    _updateTonWalletUI(tonWalletAddress ? { account: { address: tonWalletAddress } } : null);

    modal.classList.remove('hidden');

    // Если ещё не инициализировали — инициализируем в фоне
    if (!tonConnectUI) initTonConnect();
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
    if (modal) {
        modal.classList.remove('hidden');
        const statusEl = document.getElementById('ton-deposit-status');
        if (statusEl) statusEl.textContent = '';
        const amountEl = document.getElementById('ton-deposit-amount');
        if (amountEl) amountEl.value = '';
    }
}

function closeTonDepositModal() {
    const modal = document.getElementById('ton-deposit-modal');
    if (modal) modal.classList.add('hidden');
    if (depositPollInterval) {
        clearInterval(depositPollInterval);
        depositPollInterval = null;
    }
}

async function startTonDeposit() {
    const amountInput = document.getElementById('ton-deposit-amount');
    const amount = parseFloat(amountInput?.value);

    if (!amount || amount <= 0) {
        showNotify('Введите сумму депозита', 'error');
        return;
    }

    const statusEl = document.getElementById('ton-deposit-status');
    if (statusEl) statusEl.textContent = 'Создаём сессию...';

    try {
        // 1. Создаём сессию на сервере
        const createResp = await fetch('/api/ton/deposit/create', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ amount_ton: amount })
        });
        if (!createResp.ok) {
            const err = await createResp.json();
            throw new Error(err.detail || 'Ошибка создания депозита');
        }
        const { memo, wallet_address, expires_at } = await createResp.json();
        currentDepositMemo = memo;

        // 2. Кодируем комментарий как TON BOC
        if (typeof TonWeb === 'undefined') {
            throw new Error('TonWeb не загружен');
        }
        const cell = new TonWeb.boc.Cell();
        cell.bits.writeUint(0, 32);     // opcode 0 = текстовый комментарий
        cell.bits.writeString(memo);
        const bocBytes = await cell.toBoc(false);
        const payload  = TonWeb.utils.bytesToBase64(bocBytes);

        // 3. Отправляем транзакцию через TonConnect
        await tonConnectUI.sendTransaction({
            validUntil: expires_at,
            messages: [{
                address: wallet_address,
                amount:  String(Math.floor(amount * 1_000_000_000)),
                payload: payload,
            }]
        });

        // 4. Polling каждые 5 секунд
        if (statusEl) statusEl.textContent = 'Ожидаем подтверждения транзакции...';
        depositPollInterval = setInterval(_pollDepositStatus, 5000);

    } catch (err) {
        if (depositPollInterval) {
            clearInterval(depositPollInterval);
            depositPollInterval = null;
        }
        if (err?.message?.includes('User rejects') || err?.message?.includes('cancelled')) {
            showNotify('Транзакция отклонена', 'error');
            if (statusEl) statusEl.textContent = '';
        } else {
            showNotify(err.message || 'Ошибка отправки транзакции', 'error');
            if (statusEl) statusEl.textContent = '';
            console.error('[TON deposit]', err);
        }
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

            // Обновляем баланс в UI
            if (typeof myBalance !== 'undefined' && data.new_balance !== undefined) {
                myBalance = data.new_balance;
                if (typeof updateUI === 'function') updateUI();
            }
            closeTonDepositModal();
            showNotify(`✅ Депозит зачислен: ${(data.amount_ton || 0).toFixed(4)} TON`, 'success');

        } else if (resp.status === 404 || resp.status === 409) {
            clearInterval(depositPollInterval);
            depositPollInterval = null;
            const err = await resp.json().catch(() => ({}));
            showNotify(err.detail || 'Ошибка депозита', 'error');
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
    if (modal) {
        modal.classList.remove('hidden');
        const amountEl = document.getElementById('ton-withdraw-amount');
        if (amountEl) amountEl.value = '';
    }
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

        if (!resp.ok) {
            throw new Error(data.detail || 'Ошибка вывода');
        }

        closeTonWithdrawModal();
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
// Вызывается из updateUI() в globals.js автоматически

function updateTonBalanceUI() {
    // Баланс TON в хэдере = баланс пончиков (1 TON = 1 пончик)
    const el = document.getElementById('ton-balance-amount');
    if (el && typeof myBalance !== 'undefined') {
        el.textContent = formatBalance(myBalance);
    }
}

// ── Автозапуск ────────────────────────────────────────────────────────────────

// Инициализируем TonConnect после загрузки страницы
document.addEventListener('DOMContentLoaded', () => {
    // Небольшая задержка для загрузки CDN-скриптов
    setTimeout(initTonConnect, 500);
});

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