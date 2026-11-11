(() => {
  const required = [
    'editor.name', 'editor.legalForm', 'editor.address', 'editor.email',
    'editor.phone', 'editor.publicationDirector', 'host.name', 'host.address', 'host.phone', 'privacyContact'
  ];
  const read = (value, path) => path.split('.').reduce((entry, key) => entry && typeof entry === 'object' ? entry[key] : '', value);
  const usable = value => typeof value === 'string' && value.trim().length > 0;

  fetch('./site-info.json', { cache: 'no-store', credentials: 'omit' })
    .then(response => {
      if (!response.ok) throw new Error('LEGAL_CONFIG_UNAVAILABLE');
      return response.json();
    })
    .then(info => {
      document.querySelectorAll('[data-legal-field]').forEach(element => {
        const value = read(info, element.dataset.legalField);
        if (usable(value)) {
          element.textContent = value.trim();
          element.classList.remove('is-missing');
        } else {
          element.textContent = element.dataset.fallback || 'À renseigner par l’éditeur';
          element.classList.add('is-missing');
        }
      });
      const reviewed = typeof info.lastReviewed === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(info.lastReviewed) ? info.lastReviewed : '';
      const date = document.querySelector('#legal-updated');
      if (date && reviewed) {
        date.dateTime = reviewed;
        date.textContent = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Europe/Paris' }).format(new Date(`${reviewed}T12:00:00Z`));
      }
      const complete = info.status === 'published' && required.every(path => usable(read(info, path)));
      const notice = document.querySelector('#completion-notice');
      if (notice) notice.hidden = complete;
      document.documentElement.dataset.legalStatus = complete ? 'published' : 'draft';
    })
    .catch(() => {
      document.documentElement.dataset.legalStatus = 'unavailable';
    });
})();
