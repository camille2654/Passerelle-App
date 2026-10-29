const motion = (() => {
  const preference = matchMedia('(prefers-reduced-motion: reduce)'), running = new WeakMap();
  const ease = 'cubic-bezier(.22,.68,0,1)';
  const bootMinimumDuration = 1600;
  let bootStartedAt = performance.now();
  function play(element, frames, options = {}) {
    if (!element || preference.matches || typeof element.animate !== 'function') return Promise.resolve();
    running.get(element)?.cancel();
    const animation = element.animate(frames, { duration: 240, easing: ease, ...options });
    running.set(element, animation);
    return animation.finished.catch(() => {}).finally(() => { if (running.get(element) === animation) running.delete(element); });
  }
  function enter(element) { return play(element, [{ opacity: 0, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }]); }
  function finish(element) { return play(element, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(8px)' }], { duration: 150 }); }
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mark = '<svg class="loading-mark" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path class="loading-bridge" d="M7 23V12.5a6 6 0 0 1 12 0V18" pathLength="100"/><circle class="loading-seed" cx="18.5" cy="3" r="1.7"/></svg>';
  function loader(label = 'Chargement…', compact = false) { return `<div class="brand-loader ${compact ? 'loader-compact' : ''}" role="status">${mark}<span>${escape(label)}</span></div>`; }
  function skeleton(kind = 'rows') {
    const columns = kind === 'week' ? 7 : 3;
    return `<div class="loading-placeholder" role="status"><span class="loading-caption">${mark}Chargement…</span><div class="skeleton ${kind === 'week' ? 'skeleton-week' : 'skeleton-rows'}" aria-hidden="true">${Array.from({ length: columns }, () => '<div class="skeleton-group"><span></span><span></span><span></span></div>').join('')}</div></div>`;
  }
  function busy(label = 'En cours…', compact = false) { return `<span class="button-loading" aria-hidden="true">${mark}</span><span class="${compact ? 'sr-only' : 'busy-label'}">${escape(label)}</span>`; }
  function toastMarkup(message, error = false) {
    const shape = error ? '<path d="m7 7 10 10M7 17 17 7"/>' : '<path class="confirmation-stroke" pathLength="1" d="m5 12 4 4L19 6"/>';
    return `<svg class="toast-mark" viewBox="0 0 24 24" aria-hidden="true">${shape}</svg><span class="toast-message">${escape(message)}</span><span class="toast-lifetime ${error ? 'lifetime-error' : ''}" aria-hidden="true"></span>`;
  }
  function notice(element, hide = false) {
    const resting = { opacity: 1, transform: 'translateX(-50%)' };
    return play(element, hide ? [resting, { opacity: 0, transform: 'translateX(-50%) translateY(5px)' }] : [{ opacity: 0, transform: 'translateX(-50%) translateY(8px)' }, resting], { duration: hide ? 150 : 240 });
  }
  function stagger(root, selector = '.tomorrow-courses li, .work-item, .week-day, .study-list>li, .friend-list>li') {
    if (!root || preference.matches) return;
    [...root.querySelectorAll(selector)].filter(element => element.getClientRects().length).slice(0, 8).forEach((element, index) => {
      void play(element, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: index * 24 });
    });
  }
  function scene(root) { void enter(root); stagger(root); }
  function progress(root, previous = 0) {
    const path = root?.querySelector('[data-progress-value]'); if (!path) return;
    const target = Number(path.dataset.progressValue);
    if (target !== previous) void play(path, [{ strokeDashoffset: String(100 - previous) }, { strokeDashoffset: String(100 - target) }], { duration: 420 });
  }
  let requests = 0, requestTimer;
  function request() {
    let ended = false; requests++;
    if (!requestTimer) requestTimer = setTimeout(() => { requestTimer = null; const rail = document.querySelector('#request-progress'); if (requests && rail) rail.hidden = false; }, 140);
    return () => {
      if (ended) return; ended = true; requests = Math.max(0, requests - 1);
      if (!requests) { clearTimeout(requestTimer); requestTimer = null; const rail = document.querySelector('#request-progress'); if (rail) rail.hidden = true; }
    };
  }
  function boot(root) { bootStartedAt = performance.now(); root.setAttribute('aria-busy', 'true'); root.innerHTML = `<div class="boot-loader">${loader('Ouverture de votre espace…')}</div>`; }
  function bootError(root) { root.setAttribute('aria-busy', 'false'); root.innerHTML = '<div class="boot-error" role="alert"><h1>La connexion a été interrompue.</h1><p>Votre espace n’a pas pu être chargé.</p><button type="button" class="button secondary" data-retry-start>Réessayer</button></div>'; }
  async function leaveBoot(root) {
    const boot = root.querySelector('.boot-loader'); if (!boot) return;
    const remaining = bootMinimumDuration - (performance.now() - bootStartedAt);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    if (root.contains(boot)) await play(boot, [{ opacity: 1 }, { opacity: 0 }], { duration: 130 });
  }
  function open(dialog) {
    if (!dialog || dialog.open) return;
    dialog.showModal();
    const from = dialog.classList.contains('notifications-drawer') ? 'translateX(24px)' : 'translateY(10px) scale(.985)';
    void play(dialog, [{ opacity: 0, transform: from }, { opacity: 1, transform: 'none' }], { duration: 280 });
  }
  async function close(dialog) {
    if (!dialog?.open || dialog.dataset.closing) return;
    dialog.dataset.closing = 'true';
    const to = dialog.classList.contains('notifications-drawer') ? 'translateX(18px)' : 'translateY(7px) scale(.99)';
    await play(dialog, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: to }], { duration: 160 });
    const trigger = [...document.querySelectorAll('[aria-controls]')].find(element => element.getAttribute('aria-controls') === dialog.id && element.getClientRects().length);
    dialog.close(); delete dialog.dataset.closing; trigger?.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', event => {
    const tab = event.target.closest('[role=tab]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...tab.closest('[role=tablist]').querySelectorAll('[role=tab]')];
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); const id = tabs[index].id; tabs[index].click(); document.getElementById(id)?.focus({ preventScroll: true });
  });
  document.addEventListener('invalid', event => {
    void play(event.target, [{ transform: 'none' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(-2px)' }, { transform: 'none' }], { duration: 190 });
  }, true);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-motion-preview]')) { open(document.querySelector('#motion-preview')); return; }
    if (event.target.closest('[data-motion-close]')) { void close(document.querySelector('#motion-preview')); return; }
    const demo = event.target.closest('[data-motion-demo]'); if (!demo) return;
    const root = document.querySelector('#motion-preview');
    if (demo.dataset.motionDemo === 'arrival') stagger(root, '.motion-preview-rows>span');
    if (demo.dataset.motionDemo === 'confirmation') { const path = root.querySelector('.preview-confirmation path'); void play(path, [{ strokeDashoffset: '1' }, { strokeDashoffset: '0' }], { duration: 450 }); }
    if (demo.dataset.motionDemo === 'progress') progress(root, 0);
  });
  document.addEventListener('cancel', event => {
    if (['motion-preview', 'install-help'].includes(event.target.id)) { event.preventDefault(); void close(event.target); }
  }, true);
  preference.addEventListener('change', () => { if (preference.matches) document.getAnimations?.().forEach(animation => animation.cancel()); });
  return { enter, finish, open, close, loader, skeleton, busy, toastMarkup, notice, scene, stagger, progress, request, boot, bootError, leaveBoot, reduced: () => preference.matches };
})();
