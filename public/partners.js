/* Partner links belong to one consent, independently of personal subscriptions. */
const partnersPortal = (() => {
  let owner = '', epoch = 0, user = null, data = null, config = null, managedConfig = null, managedKey = '';
  let dialog = null, loading = false, busy = false, failure = '', notice = '';
  let returnFocus = null, mode = 'connections', dirty = false, navigating = false;
  let pendingRequest = new URLSearchParams(location.search).get('connect');
  if (!/^[A-Za-z0-9_-]{43}$/.test(pendingRequest || '')) pendingRequest = null;
  const identity = value => [value?.id, value?.studentId, value?.schoolName].join(':');
  const current = (id, generation) => owner === id && epoch === generation && identity(state?.user) === id;
  const content = () => dialog?.querySelector('#partners-content');
  const dateLabel = value => Number.isFinite(Number(value)) && Number(value) > 0 ? new Intl.DateTimeFormat('fr-FR', {day:'numeric',month:'short',year:'numeric'}).format(new Date(Number(value))) : '';

  function ensure() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.id = 'partners-dialog';
    dialog.className = 'partners-dialog';
    dialog.setAttribute('aria-labelledby', 'partners-title');
    dialog.innerHTML = `<header class="partners-heading"><div><p class="eyebrow">MON COMPTE / PARTAGE</p><h2 id="partners-title">Applications connectées</h2></div><button type="button" class="icon-button" data-partners="close" aria-label="Fermer les applications connectées">${icon('close')}</button></header><div id="partners-content" data-private-content></div>`;
    document.body.append(dialog);
    dialog.addEventListener('close', () => {
      epoch++; loading = false; busy = false; dirty = false; failure = ''; notice = '';
      data = null; config = null; managedConfig = null; managedKey = ''; content()?.replaceChildren();
      const target = returnFocus?.isConnected && returnFocus.getClientRects().length ? returnFocus : document.querySelector('#portal-main');
      if (state?.user && !document.querySelector('dialog[open]')) target?.focus({preventScroll:true});
      returnFocus = null;
    });
    dialog.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const nodes = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],summary')].filter(node => node.getClientRects().length);
      const first = nodes[0], last = nodes.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    });
  }

  function reset() {
    owner = ''; epoch++; user = null; data = null; config = null; managedConfig = null; managedKey = '';
    loading = false; busy = false; failure = ''; notice = ''; dirty = false; mode = 'connections';
    returnFocus = null;
    if (dialog?.open) dialog.close();
    dialog?.remove(); dialog = null;
    document.querySelector('#partners-setup-notice')?.remove();
  }

  function mount(nextUser) {
    if (!nextUser) { if (owner) reset(); return; }
    if (owner !== identity(nextUser)) { reset(); owner = identity(nextUser); }
    user = nextUser;
    const directory = document.querySelector('#page-settings .simple-directory');
    if (directory && !directory.querySelector('[data-partners="open"]')) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'simple-link'; button.dataset.partners = 'open';
      button.innerHTML = `${icon('share')}<span><strong>Applications connectées</strong><small>Choisir les services qui peuvent lire vos agendas</small></span>${icon('arrow')}`;
      const existing = directory.querySelector('[data-passkey="open"]');
      if (existing) directory.insertBefore(button, existing); else directory.append(button);
    }
    const previous = document.querySelector('#partners-setup-notice');
    if (pendingRequest && !(nextUser.feedURL && nextUser.skolengoConnected && nextUser.studentId)) {
      if (!previous) {
        const node = document.createElement('section'); node.id = 'partners-setup-notice'; node.className = 'partners-setup-notice'; node.setAttribute('aria-label', 'Connexion à Lapsus en attente');
        node.innerHTML = `<div>${icon('share')}<strong>Préparez votre agenda pour Lapsus</strong></div><p>Connectez votre ENT et créez votre lien ICS. Vous pourrez ensuite choisir les agendas à partager avec Lapsus.</p><div class="partners-setup-actions"><button type="button" class="button secondary" data-portal="navigate" data-page="calendar">Préparer mon agenda</button><button type="button" class="text-button" data-partners="cancel-pending">Annuler cette connexion</button></div>`;
        document.querySelector('#portal-main .page-heading')?.after(node);
      }
    } else previous?.remove();
  }

  function resume(nextState) {
    const nextUser = nextState?.user;
    if (!pendingRequest || !nextUser?.feedURL || !nextUser.skolengoConnected || !nextUser.studentId) return false;
    if (!navigating) {
      navigating = true;
      location.replace(new URL('oauth/consent?request=' + encodeURIComponent(pendingRequest), location.origin + base).href);
    }
    return true;
  }

  async function request(route, body) {
    const id = owner, generation = epoch, accountId = user?.id;
    const value = await api(route, body === undefined ? undefined : route.startsWith('admin/') ? body : {...body, accountId});
    if (!current(id, generation)) throw new Error('Le compte ou l’élève a changé. Rouvrez les applications connectées.');
    return value;
  }

  function paint() {
    if (!dialog?.open || !content() || owner !== identity(state?.user)) return;
    const loadingMarkup = failure ? '<button type="button" class="button secondary" data-partners="reload">Réessayer</button>' : motion.loader('Ouverture des applications…', true);
    if (mode === 'admin') {
      content().innerHTML = `<button type="button" class="text-button partners-back" data-partners="connections">← Mes applications</button><p class="partners-lead">Lapsus peut demander à un utilisateur de partager ses agendas. Chaque utilisateur doit accepter et peut ensuite retirer cet accès.</p>${failure ? `<p class="notice" role="alert">${escape(failure)}</p>` : ''}${!config ? loadingMarkup : `<section class="partners-app-identity"><span class="partners-app-mark" aria-hidden="true">L</span><div><h3>${escape(config.client.name)}</h3><p>${escape(config.client.origin)}</p></div><span class="badge ${config.client.enabled ? 'connected' : ''}">${config.client.enabled ? 'Activée' : 'Désactivée'}</span></section><form id="partners-config-form"><label class="partners-check"><input type="checkbox" name="enabled" ${config.client.enabled ? 'checked' : ''}>Autoriser les connexions à Lapsus</label><label for="partners-callback">Adresse de retour autorisée<input id="partners-callback" name="redirectURI" type="url" value="${escape(config.client.redirectURI)}" maxlength="500" required spellcheck="false" autocomplete="off"></label><p class="partners-help">Cette adresse doit correspondre exactement à celle utilisée par Lapsus, sur ${escape(config.client.origin)}. La changer ou désactiver Lapsus invalide les accès existants.</p><button type="submit" class="button" ${busy ? 'disabled' : ''}>Enregistrer</button></form><details class="partners-developer"><summary>Informations pour le développeur de Lapsus</summary><dl><dt>Identifiant de l’application</dt><dd><code>${escape(config.client.id)}</code></dd><dt>Autorisation</dt><dd><code>${escape(config.authorizeURL)}</code></dd><dt>Échange du code</dt><dd><code>${escape(config.tokenURL)}</code></dd><dt>Liens des agendas</dt><dd><code>${escape(config.calendarsURL)}</code></dd></dl><p class="partners-help">Connexion avec PKCE S256. Aucun secret d’application à placer dans le navigateur.</p><a class="button secondary" href="${escape(base + 'integrations/lapsus/')}" target="_blank" rel="noopener noreferrer">Guide et kit de connexion ${icon('out')}</a></details>${managedSection()}`}${notice ? `<p class="partners-notice" role="status">${escape(notice)}</p>` : ''}`;
      return;
    }
    const rows = data?.connections || [];
    content().innerHTML = `<p class="partners-lead">Retrouvez les services auxquels vous avez donné accès à vos agendas. Chaque connexion possède ses propres liens privés.</p>${failure ? `<p class="notice" role="alert">${escape(failure)}</p>` : ''}${!data ? loadingMarkup : rows.length ? `<ul class="partners-list" aria-label="Applications autorisées">${rows.map(row => `<li class="partners-connection"><div class="partners-app-identity"><span class="partners-app-mark" aria-hidden="true">${escape(row.client.name.slice(0, 1))}</span><div><h3>${escape(row.client.name)}</h3><p>${escape(row.client.origin)}</p></div><span class="badge ${row.status === 'active' ? 'connected' : ''}">${row.status === 'active' ? 'Autorisée' : 'À reconnecter'}</span></div><p class="partners-permissions">${row.scopes.map(scope => escape(scope.label)).join(' · ')}</p><p class="partners-help">Autorisée le ${escape(dateLabel(row.createdAt))}${row.lastUsedAt ? ' · Dernière lecture le ' + escape(dateLabel(row.lastUsedAt)) : ''}</p>${row.status !== 'active' ? '<p class="partners-help">Cette connexion ne donne plus accès aux agendas. Reconnectez Passerelle depuis le service concerné.</p>' : ''}<button type="button" class="button secondary" data-partners="revoke-open" data-id="${escape(row.id)}" ${busy ? 'disabled' : ''}>Retirer l’accès</button><div class="partners-revoke-confirm" data-confirm-id="${escape(row.id)}" hidden><p>Retirer l’accès de ${escape(row.client.name)} ? Ses prochaines lectures seront bloquées. Les événements déjà copiés dans ce service peuvent y rester.</p><div><button type="button" class="button secondary" data-partners="revoke" data-id="${escape(row.id)}" ${busy ? 'disabled' : ''}>Confirmer le retrait</button><button type="button" class="text-button" data-partners="revoke-cancel">Annuler</button></div></div></li>`).join('')}</ul>` : `<div class="partners-empty">${icon('share')}<h3>Vos agendas restent chez vous.</h3><p>Aucune application n’a encore accès à vos agendas. Pour relier un service compatible, choisissez « Connecter Passerelle » depuis ce service.</p></div>`}<p class="partners-help partners-privacy">${icon('lock')} Votre mot de passe Passerelle et vos identifiants ENT ne sont jamais partagés avec ces applications.</p>${user?.admin ? '<button type="button" class="text-button partners-admin-entry" data-partners="admin">Configurer Lapsus · Administration</button>' : ''}${notice ? `<p class="partners-notice" role="status">${escape(notice)}</p>` : ''}`;
  }

  function managedSection() {
    if (!managedConfig) return '<p class="partners-help">Chargement du connecteur ENT…</p>';
    return `<section class="managed-admin-block"><h3>Connexion ENT directement depuis Lapsus</h3><p><a class="button secondary" href="${escape(base + 'integrations/lapsus-managed/')}" target="_blank" rel="noopener noreferrer">Code Lapsus et guide Cloudflare</a></p><p class="partners-help">Lapsus peut utiliser le connecteur ENT sans demander un compte Passerelle à ses utilisateurs. Ses connexions techniques restent séparées des comptes et abonnements Passerelle.</p><form id="managed-config-form"><label class="partners-check"><input name="enabled" type="checkbox" ${managedConfig.enabled ? 'checked' : ''}>Activer le connecteur ENT Lapsus</label><button class="button secondary" type="submit" ${busy ? 'disabled' : ''}>Enregistrer le connecteur</button></form><p class="partners-help">Clé serveur : ${managedConfig.configured ? 'configurée' + (managedConfig.keyCreatedAt ? ' · créée le ' + escape(dateLabel(managedConfig.keyCreatedAt)) : '') : 'à créer'}.</p><p class="managed-admin-warning">La clé doit être enregistrée uniquement dans les secrets de la fonction Cloudflare de Lapsus. Elle ne doit jamais être ajoutée à son JavaScript public.</p>${managedKey ? `<div class="managed-admin-key" data-private-content><label for="managed-server-key">Clé affichée une seule fois<input id="managed-server-key" type="text" readonly value="${escape(managedKey)}" autocomplete="off" spellcheck="false"></label><div class="managed-admin-actions"><button class="button secondary" type="button" data-partners="managed-key-copy">Copier la clé</button><button class="text-button" type="button" data-partners="managed-key-hide">Masquer la clé</button></div></div>` : `<button class="button secondary" type="button" data-partners="managed-key-open">${managedConfig.configured ? 'Renouveler la clé serveur' : 'Créer la clé serveur'}</button><div id="managed-key-confirm" class="partners-revoke-confirm" hidden><p>${managedConfig.configured ? 'Le renouvellement invalide immédiatement l’ancienne clé. La fonction Cloudflare devra recevoir la nouvelle pour reprendre ses lectures. Les connexions en cours seront annulées.' : 'Une clé privée sera créée pour la fonction Cloudflare de Lapsus. Copiez-la à cette étape : elle ne sera plus affichée ensuite.'}</p><div class="managed-admin-actions"><button class="button secondary" type="button" data-partners="managed-key-issue">${managedConfig.configured ? 'Confirmer le renouvellement' : 'Créer la clé'}</button><button class="text-button" type="button" data-partners="managed-key-cancel">Annuler</button></div></div>`}<details class="partners-developer"><summary>Adresse de retour du connecteur ENT</summary><p class="partners-help"><code>${escape(managedConfig.callbackURL)}</code></p></details></section>`;
  }

  async function managedAction(button, issue, form) {
    if (busy || !user?.admin || mode !== 'admin') return;
    const id=owner, generation=epoch; busy=true; button.disabled=true; failure=''; notice='';
    try {
      const value=await request(issue ? 'admin/managed-ent/lapsus/key' : 'admin/managed-ent/lapsus', issue ? {} : {enabled:form.elements.enabled.checked});
      if(!current(id,generation)) return;
      if(issue) { managedKey=value.key; managedConfig={enabled:value.enabled,configured:value.configured,callbackURL:value.callbackURL,keyCreatedAt:value.keyCreatedAt}; }
      else { managedConfig=value; notice='Les réglages du connecteur ENT sont enregistrés.'; }
      busy=false; dirty=false; paint();
    } catch(error) { if(current(id,generation)) showFailure(error.message); }
    finally { if(current(id,generation)) { busy=false; if(button.isConnected)button.disabled=false; } }
  }

  async function load(admin = false) {
    if (loading || busy || !user) return;
    const id = owner, generation = epoch; loading = true; failure = '';
    try {
      const value = admin ? await Promise.all([request('admin/partners/lapsus'), request('admin/managed-ent/lapsus')]) : await request('partners');
      if (!current(id, generation)) return;
      if (admin) { config = value[0]; managedConfig = value[1]; } else data = value;
    } catch (error) { if (current(id, generation)) failure = error.message; }
    finally { if (current(id, generation)) { loading = false; paint(); } }
  }

  function open() {
    if (!state?.user) return;
    mount(state.user); ensure(); returnFocus = document.activeElement;
    mode = 'connections'; failure = ''; notice = ''; data = null; dirty = false;
    if (!dialog.open) dialog.showModal(); paint(); void load();
  }

  function showFailure(message) {
    failure = message;
    let node = content()?.querySelector('#partners-error');
    if (!node && content()) { node = document.createElement('p'); node.id = 'partners-error'; node.className = 'notice'; node.setAttribute('role', 'alert'); content().prepend(node); }
    if (node) node.textContent = message;
  }

  async function revoke(button) {
    if (busy) return;
    const id = owner, generation = epoch; busy = true;
    content()?.querySelectorAll('button').forEach(node => { node.disabled = true; });
    try {
      const value = await request('partners/' + encodeURIComponent(button.dataset.id) + '/revoke', {});
      if (!current(id, generation)) return;
      data = {connections:value.connections || []}; failure = ''; notice = 'L’accès de cette application a été retiré.'; dirty = false; busy = false; paint();
    } catch (error) { if (current(id, generation)) showFailure(error.message); }
    finally { if (current(id, generation)) { busy = false; content()?.querySelectorAll('button').forEach(node => { node.disabled = false; }); } }
  }

  async function saveConfig(form) {
    if (busy || !user?.admin) return;
    const redirectURI = form.elements.redirectURI.value.trim();
    let destination;
    try { destination = new URL(redirectURI); } catch { showFailure('Indiquez une adresse de retour valide.'); return; }
    if (destination.origin !== 'https://mon-ent.pages.dev' || destination.hash || destination.username || destination.password) { showFailure('L’adresse de retour doit appartenir à https://mon-ent.pages.dev, sans fragment ni identifiant.'); return; }
    const id = owner, generation = epoch, button = form.querySelector('[type="submit"]'); busy = true; button.disabled = true;
    try {
      config = await request('admin/partners/lapsus', {enabled:form.elements.enabled.checked, redirectURI});
      if (!current(id, generation)) return;
      failure = ''; notice = 'Les réglages de Lapsus sont enregistrés.'; dirty = false; busy = false; paint();
    } catch (error) { if (current(id, generation)) showFailure(error.message); }
    finally { if (current(id, generation)) { busy = false; if (button.isConnected) button.disabled = false; } }
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-partners]');
    if (!button || button.disabled) return;
    const action = button.dataset.partners;
    if (action === 'open') { open(); return; }
    if (action === 'close') { dialog?.close(); return; }
    if (action === 'cancel-pending') {
      pendingRequest = null; const url = new URL(location.href); url.searchParams.delete('connect'); history.replaceState(null, '', url.pathname + url.search + url.hash); document.querySelector('#partners-setup-notice')?.remove(); return;
    }
    if (!dialog?.open || !user || busy) return;
    if (action === 'reload') { void load(mode === 'admin'); return; }
    if (action === 'admin' && user.admin) { mode = 'admin'; config = null; managedConfig = null; managedKey = ''; failure = ''; notice = ''; dirty = false; paint(); void load(true); }
    else if (action === 'connections') { managedKey = ''; mode = 'connections'; failure = ''; notice = ''; dirty = false; paint(); if (!data) void load(); }
    else if (action === 'revoke-open') { button.closest('.partners-connection').querySelector('.partners-revoke-confirm').hidden = false; dirty = true; button.closest('.partners-connection').querySelector('[data-partners="revoke"]').focus(); }
    else if (action === 'revoke-cancel') { button.closest('.partners-revoke-confirm').hidden = true; dirty = false; }
    else if (action === 'revoke') void revoke(button);
    else if (action === 'managed-key-open' && user.admin) { content().querySelector('#managed-key-confirm').hidden = false; }
    else if (action === 'managed-key-cancel') { content().querySelector('#managed-key-confirm').hidden = true; }
    else if (action === 'managed-key-issue' && user.admin) void managedAction(button, true);
    else if (action === 'managed-key-hide') { managedKey = ''; paint(); }
    else if (action === 'managed-key-copy') void navigator.clipboard.writeText(managedKey).then(() => { if(dialog?.open) { notice = 'Clé copiée. Ajoutez-la au secret Cloudflare, puis masquez-la ici.'; paint(); } }).catch(() => showFailure('La copie automatique est indisponible. Sélectionnez la clé pour la copier.'));
  });
  document.addEventListener('submit', event => { if (event.target.id === 'managed-config-form') { event.preventDefault(); void managedAction(event.target.querySelector('[type=submit]'), false, event.target); return; } if (event.target.id === 'partners-config-form') { event.preventDefault(); void saveConfig(event.target); } });
  document.addEventListener('input', event => { if (event.target.closest('#partners-config-form, #managed-config-form')) dirty = true; });
  return {mount, reset, open, resume, isEditing:nextUser => !!dialog?.open && owner === identity(nextUser)};
})();
