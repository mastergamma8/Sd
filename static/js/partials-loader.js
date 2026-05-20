// =====================================================
// partials-loader.js
// =====================================================
(async function loadPartials() {
  const nodes = Array.from(document.querySelectorAll('[data-partial]'));
  
  // Загружаем все куски HTML параллельно для скорости
  await Promise.all(nodes.map(async (node) => {
    const url = node.getAttribute('data-partial');
    try {
      const res = await fetch(url, {cache: "no-cache"});
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      node.outerHTML = html;
    } catch (err) {
      console.error('Failed to load partial', url, err);
      node.outerHTML = `<div style="color:#f88;padding:10px">Ошибка загрузки ${url}</div>`;
    }
  }));

  // Создаем глобальный флаг и вызываем событие, когда весь HTML готов
  window.partialsAreLoaded = true;
  document.dispatchEvent(new Event('partialsLoaded'));
})();