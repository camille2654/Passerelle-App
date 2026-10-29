const installation = (() => {
  let prompt = null;
  const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  function refreshButtons() {
    document.querySelectorAll('[data-install-app]').forEach(button => {
      button.disabled = installed();
      button.textContent = installed() ? 'Application installée' : prompt ? 'Installer Passerelle' : 'Comment installer Passerelle';
    });
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); prompt = event; refreshButtons(); });
  window.addEventListener('appinstalled', () => { prompt = null; refreshButtons(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('[data-install-app]')) return;
    void (async () => {
      if (prompt) { const pending = prompt; prompt = null; await pending.prompt(); await pending.userChoice; refreshButtons(); }
      else motion.open(document.querySelector('#install-help'));
    })().catch(() => { motion.open(document.querySelector('#install-help')); });
  });
  document.addEventListener('DOMContentLoaded', () => {
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register(new URL('./sw.js', document.querySelector('script[src*="install.js"]').src), { updateViaCache:'none',scope: new URL('./', document.querySelector('script[src*="install.js"]').src).pathname }).catch(() => {});
    document.querySelector('#close-install')?.addEventListener('click', () => { void motion.close(document.querySelector('#install-help')); });
    refreshButtons();
  });
  return { installed, refresh: refreshButtons };
})();
