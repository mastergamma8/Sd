// =====================================================
// ЗАРАБОТОК И РЕФЕРАЛЫ (Earn.js)
// =====================================================

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function switchEarnSubtab(subTabId) {
    vibrate('light');
    ['referrals', 'tasks'].forEach(id => {
        document.getElementById(`earn-${id}`)?.classList.add('hidden-tab');
        document.getElementById(`subtab-${id}`)?.classList.remove('active');
    });
    document.getElementById(`earn-${subTabId}`)?.classList.remove('hidden-tab');
    document.getElementById(`subtab-${subTabId}`)?.classList.add('active');
}

function getRefLink() { 
    return `https://t.me/${botUsername}?start=${tgUser.id}`; 
}

function copyRefLink() {
    vibrate('medium');
    const tmp = document.createElement('input');
    tmp.value = getRefLink();
    document.body.appendChild(tmp);
    tmp.select();
    document.execCommand('copy');
    document.body.removeChild(tmp);
    showNotify(i18n[currentLang].ref_copied, 'info');
}

function shareRefLink() {
    vibrate('medium');
    const link = getRefLink();
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(i18n[currentLang].share_text)}`);
}

async function loadEarnData() {
    try {
        const res = await fetch(`/api/earn_data`, { headers: getApiHeaders() });
        const data = await res.json();
        
        const refList = document.getElementById('referrals-list');
        if (data.referrals.length === 0) {
            refList.innerHTML = `<div class="text-center text-sm text-gray-500 py-4 glass rounded-2xl border border-white/5 border-dashed">${i18n[currentLang].no_refs}</div>`;
        } else {
            refList.innerHTML = '';
            data.referrals.forEach(user => {
                const avatar = escapeHtml(user.photo_url || 'https://via.placeholder.com/40');
                refList.innerHTML += `<div class="glass rounded-2xl p-3 flex items-center gap-3"><img src="${avatar}" class="w-10 h-10 rounded-full border border-white/10"><div class="font-bold text-white text-sm">${escapeHtml(user.first_name || i18n[currentLang]?.no_name || 'Без имени')}</div></div>`;
            });
        }
        
        const taskList = document.getElementById('tasks-list');
        taskList.innerHTML = '';
        if (data.tasks.length === 0) {
            taskList.innerHTML = `<div class="text-center text-sm text-gray-500 py-4 glass rounded-2xl border border-white/5 border-dashed">${i18n[currentLang].no_tasks}</div>`;
        } else {
            data.tasks.forEach(task => {
                // Выбираем заголовок задания по текущему языку интерфейса
                const taskTitle = (currentLang === 'en' && task.title_en) ? task.title_en : task.title;

                if (task.completed) {
                    taskList.innerHTML += `<div class="glass rounded-2xl p-4 flex items-center justify-between opacity-50"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center text-xl">✅</div><div><div class="font-bold text-white text-sm line-through">${taskTitle}</div><div class="text-xs text-green-400">${i18n[currentLang].completed}</div></div></div></div>`;
                } else {
                    const isChecking = openTasksState[task.id];
                    const btn = isChecking
                        ? `<button onclick="checkTask(${task.id})" id="btn-task-${task.id}" class="bg-blue-500 text-white px-4 py-2 rounded-xl text-sm font-bold active:scale-95 transition-transform shadow-[0_0_10px_rgba(59,130,246,0.5)]">${i18n[currentLang].check}</button>`
                        : `<button onclick="openTaskUrl(${task.id},'${task.url}')" class="glass px-4 py-2 rounded-xl text-sm font-bold text-white active:scale-95 transition-transform border border-blue-400/30">${i18n[currentLang].go}</button>`;
                    
                    // --- ИЗМЕНЕНИЯ: Формируем дизайн для разных типов валют ---
                    let rewardHtml = '';
                    if (task.reward_type === 'stars') {
                        rewardHtml = `<div class="text-xs text-yellow-400 flex items-center gap-1 font-bold">+${task.reward}<img src="/gifts/stars.png" class="w-3 h-3 inline object-contain"></div>`;
                    } else {
                        rewardHtml = `<div class="text-xs text-blue-300 flex items-center gap-1">+${task.reward} <img src="/gifts/dount.png" class="w-3 h-3 inline object-contain"></div>`;
                    }

                    taskList.innerHTML += `<div class="glass rounded-2xl p-4 flex items-center justify-between border border-blue-500/20 bg-blue-500/5"><div class="flex items-center gap-3"><div class="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-xl border border-blue-400/30">📢</div><div><div class="font-bold text-white text-sm">${taskTitle}</div>${rewardHtml}</div></div>${btn}</div>`;
                }
            });
        }
    } catch(e) { 
        console.error('loadEarnData:', e); 
    }
}

function openTaskUrl(taskId, url) {
    vibrate('light');
    openTasksState[taskId] = true;
    
    // ПРОВЕРКА: Если URL пустой (как в заданиях на рефералов), открываем окно шеринга!
    if (!url || url.trim() === '' || url === 'undefined' || url === 'null') {
        shareRefLink();
    } else {
        tg.openTelegramLink(url);
    }
    
    setTimeout(loadEarnData, 1000);
}

async function checkTask(taskId) {
    vibrate('medium');
    const btn = document.getElementById(`btn-task-${taskId}`);
    if (btn) { btn.innerText = '⏳...'; btn.disabled = true; }
    try {
        const res = await fetch('/api/check_task', {
            method: 'POST',
            headers: getApiHeaders(),
            body: JSON.stringify({ task_id: taskId })
        });
        const data = await res.json();
        if (data.status === 'ok') {
            vibrate('heavy');
            showNotify(i18n[currentLang].task_done, 'success');
            
            // --- ИЗМЕНЕНИЯ: Обновляем оба баланса сразу ---
            myBalance = data.balance;
            if (data.stars !== undefined) {
                myStars = data.stars; 
            }
            
            if (typeof updateUI === 'function') updateUI();
            loadEarnData();
        } else {
            showNotify(data.detail || i18n[currentLang].err_check, 'error');
            if (btn) { btn.innerText = i18n[currentLang].check; btn.disabled = false; }
        }
    } catch(e) {
        showNotify(i18n[currentLang].err_conn_srv, 'error');
        if (btn) { btn.innerText = i18n[currentLang].check; btn.disabled = false; }
    }
}

// =====================================================
// ЭКСПОРТЫ В WINDOW ДЛЯ ДОСТУПА ИЗ HTML
// =====================================================
window.switchEarnSubtab = switchEarnSubtab;
window.copyRefLink = copyRefLink;
window.shareRefLink = shareRefLink;
window.openTaskUrl = openTaskUrl;
window.checkTask = checkTask;
window.loadEarnData = loadEarnData;