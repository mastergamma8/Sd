// =====================================================
// ГЛАВНАЯ — СЕТКА ПОДАРКОВ
// =====================================================
function renderMainPage() {
    const grid = document.getElementById('main-gifts-grid');
    if (!grid) return;
    grid.innerHTML = '';
    const sortedEntries = Object.entries(mainGifts).sort((a, b) => a[1].required_value - b[1].required_value);
    for (const [id, gift] of sortedEntries) {
        const req = gift.required_value;
        const unlocked = myBalance >= req;
        const pct = Math.min(100, Math.round(myBalance / req * 100));
        const statusColor = unlocked ? 'text-green-400' : 'text-blue-300';
        const statusText  = unlocked ? i18n[currentLang].available : i18n[currentLang].progress;
        grid.innerHTML += `
            <div onclick="showMainGiftDetails(${id})" class="glass rounded-3xl p-5 flex items-center gap-5 cursor-pointer relative overflow-hidden active:scale-[0.98] transition-transform">
                ${unlocked ? '<div class="absolute inset-0 bg-green-500/10 pointer-events-none"></div>' : ''}
                <div class="relative w-20 h-20 flex-shrink-0 flex items-center justify-center bg-black/20 rounded-2xl border border-white/5">
                    <img src="${escapeHtml(getImgSrc(gift.photo))}" class="w-14 h-14 object-contain drop-shadow-xl" onerror="this.src='https://via.placeholder.com/64'">
                </div>
                <div class="flex-1">
                    <h4 class="font-bold text-lg mb-2 text-white ${unlocked ? 'glow-text' : ''}">${escapeHtml(gift.name)}</h4>
                    <div class="w-full bg-black/40 rounded-full h-2 mb-2 border border-white/5 shadow-inner">
                        <div class="progress-bar-fill h-full rounded-full ${unlocked ? 'from-green-400 to-emerald-500' : ''}" style="width:${pct}%"></div>
                    </div>
                    <div class="flex justify-between items-center text-xs font-bold">
                        <span class="${statusColor}">${statusText}</span>
                        <span class="text-gray-300 flex items-center gap-1">${formatBalance(myBalance)} <span class="text-blue-400/70 flex items-center gap-1">/ ${req} <img src="/gifts/dount.png" class="w-3 h-3 object-contain"></span></span>
                    </div>
                </div>
            </div>`;
    }
}

// =====================================================
// СОРТИРОВКА
// =====================================================
function openSortModal() {
    vibrate('light');
    document.querySelectorAll('.sort-option').forEach(btn => {
        btn.classList.remove('border-blue-400/50','bg-blue-500/10');
        btn.classList.add('border-white/5','bg-black/40');
        btn.querySelector('.check-icon')?.classList.add('hidden');
    });
    const activeBtn = document.getElementById(`btn-sort-${currentSortMethod}`);
    if (activeBtn) {
        activeBtn.classList.remove('border-white/5','bg-black/40');
        activeBtn.classList.add('border-blue-400/50','bg-blue-500/10');
        activeBtn.querySelector('.check-icon')?.classList.remove('hidden');
    }
    openModal('sort-modal');
}

function selectSort(method) {
    vibrate('light');
    currentSortMethod = method;
    const labelEl = document.getElementById('current-sort-label');
    const key = `sort_${method.replace('value','val')}`;
    if (labelEl) { labelEl.setAttribute('data-i18n', key); labelEl.innerText = i18n[currentLang][key]; }
    closeModal('sort-modal');
    renderBaseGiftsList();
}

function renderBaseGiftsList() {
    const searchQ = (document.getElementById('mg-search')?.value || '').toLowerCase();
    const container = document.getElementById('mg-sources');
    if (!container) return;
    let arr = Object.entries(baseGifts).map(([id, g]) => ({ id, ...g }));
    if (searchQ) arr = arr.filter(g => g.name.toLowerCase().includes(searchQ));
    arr.sort((a, b) => {
        if (currentSortMethod === 'name_asc')  return a.name.localeCompare(b.name);
        if (currentSortMethod === 'name_desc') return b.name.localeCompare(a.name);
        if (currentSortMethod === 'value_asc') return a.value - b.value;
        return b.value - a.value;
    });
    if (arr.length === 0) {
        container.innerHTML = `<div class="text-center text-blue-200/50 text-xs py-4">${i18n[currentLang].not_found}</div>`;
        return;
    }
    container.innerHTML = arr.map(gift => `
        <div class="flex justify-between items-center bg-black/20 p-2 rounded-xl border border-white/5">
            <div class="flex items-center gap-3">
                <img src="${escapeHtml(getImgSrc(gift.photo))}" class="w-8 h-8 object-contain" onerror="this.src='https://via.placeholder.com/32'">
                <span class="text-white font-medium">${escapeHtml(gift.name)}</span>
            </div>
            <span class="text-blue-300 font-bold bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20 flex items-center gap-1">+${gift.value} <img src="/gifts/dount.png" class="w-3 h-3 object-contain"></span>
        </div>`).join('');
}

function showMainGiftDetails(id) {
    vibrate('light');
    const gift = mainGifts[id];
    document.getElementById('mg-photo').src = getImgSrc(gift.photo);
    document.getElementById('mg-title').innerText = gift.name;
    const req = gift.required_value;
    const unlocked = myBalance >= req;
    document.getElementById('mg-progress-text').innerHTML = `${formatBalance(myBalance)} / ${req} <img src="/gifts/dount.png" class="w-4 h-4 object-contain">`;
    const pBar = document.getElementById('mg-progress-bar');
    pBar.style.width = `${Math.min(100, myBalance/req*100)}%`;
    pBar.style.background = unlocked ? 'linear-gradient(90deg,#34d399,#10b981)' : 'linear-gradient(90deg,#3b82f6,#8b5cf6)';
    document.getElementById('mg-search').value = '';
    currentSortMethod = 'value_desc';
    const labelEl = document.getElementById('current-sort-label');
    if (labelEl) { labelEl.setAttribute('data-i18n','sort_val_desc'); labelEl.innerText = i18n[currentLang].sort_val_desc; }
    renderBaseGiftsList();
    const btnClaim = document.getElementById('btn-claim');
    if (unlocked) { btnClaim.classList.remove('hidden'); btnClaim.onclick = () => claimGift(id); }
    else           { btnClaim.classList.add('hidden'); }
    openModal('main-gift-modal');
}

async function claimGift(giftId) {
    vibrate('heavy');
    const btn = document.getElementById('btn-claim');
    btn.innerText = i18n[currentLang].processing; btn.disabled = true;
    try {
        const res = await fetch('/api/claim', { method:'POST', headers:getApiHeaders(), body:JSON.stringify({ gift_id:giftId }) });
        const data = await res.json();
        if (res.status === 429) {
            // Обработка структурированной ошибки для мультиязычности
            if (data.detail && data.detail.error === 'cooldown') {
                const msg = i18n[currentLang].cooldown_claim_wait
                    .replace('{h}', data.detail.hours)
                    .replace('{m}', data.detail.minutes);
                showNotify(msg, 'warning');
            } else {
                showNotify(data.detail || 'Limit reached', 'warning');
            }
            return;
        }
        if (data.status === 'ok') {
            myBalance = data.balance; myGifts = data.user_gifts;
            closeModal('main-gift-modal'); updateUI(); switchTab('profile');
            setTimeout(() => showNotify(i18n[currentLang].gift_added, 'success'), 300);
        } else { showNotify(data.detail || 'Error', 'error'); }
    } catch(e) { showNotify(i18n[currentLang].err_conn, 'error'); }
    finally { btn.innerText = i18n[currentLang].claim_gift; btn.disabled = false; }
}

// Экспорт функций в глобальную область видимости
window.renderMainPage = renderMainPage;
window.openSortModal = openSortModal;
window.selectSort = selectSort;
window.renderBaseGiftsList = renderBaseGiftsList;
window.showMainGiftDetails = showMainGiftDetails;
window.claimGift = claimGift;