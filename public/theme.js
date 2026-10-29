const appearance = (() => {
  const key = 'passerelle.theme', media = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system';
  try { const saved = localStorage.getItem(key); if (['system', 'light', 'dark'].includes(saved)) mode = saved; } catch { /* The system theme still works without local storage. */ }
  function apply() {
    const dark = mode === 'dark' || mode === 'system' && media.matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#18211d' : '#fbfcf8');
    document.querySelectorAll('[data-theme-choice]').forEach(input => { input.value = mode; });
  }
  function set(value) {
    if (!['system', 'light', 'dark'].includes(value)) return;
    mode = value; try { localStorage.setItem(key, value); } catch { /* Optional persistence. */ } apply();
  }
  media.addEventListener('change', apply);
  document.addEventListener('change', event => { if (event.target.matches('[data-theme-choice]')) set(event.target.value); });
  document.addEventListener('DOMContentLoaded', apply);
  apply();
  return { get: () => mode, set };
})();
