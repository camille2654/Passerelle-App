/* This page exchanges consent only. The calendar links stay out of redirects. */
(() => {
  const base = new URL('.', document.currentScript.src);
  const requestId = new URLSearchParams(location.search).get('request');
  const main = document.querySelector('#partner-connect-main');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let consent = null, busy = false;
  const icons = {
    courses:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v5m10-5v5M3 11h18M5 5h14a2 2 0 0 1 2 2v13H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 10h3"/></svg>',
    homework:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h10a2 2 0 0 1 2 2v16H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2m2 5h8m-8 4h8m-8 5 2 2 5-5"/></svg>',
    exams:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8v4H8V3Zm0 2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14V7a2 2 0 0 0-2-2h-1M8 11h3m-3 4h2m3-2 2 2 3-4"/></svg>'
  };
  function homeLink(label = 'Retour à Passerelle') { return `<a class="button secondary" href="${esc(base.href)}">${esc(label)}</a>`; }
  function frame(body) { main.innerHTML = `<section class="partner-connect-card">${body}</section>`; main.setAttribute('aria-busy', 'false'); }
  function errorView(message) { frame(`<p class="eyebrow">CONNEXION INTERROMPUE</p><h1>Cette demande ne peut pas continuer.</h1><p class="partner-connect-lead" role="alert">${esc(message)}</p><p class="partner-connect-help">Relancez « Connecter Passerelle » depuis Lapsus pour obtenir une nouvelle demande.</p>${homeLink()}`); }
  function loginView() {
    const login = new URL(base.href); login.searchParams.set('connect', requestId);
    frame(`<div class="partner-connect-symbol"><img src="${esc(new URL('brand/symbol.png', base).href)}" width="52" height="52" alt=""></div><p class="eyebrow">CONNECTER MON AGENDA</p><h1>Votre agenda, là où vous en avez besoin.</h1><p class="partner-connect-lead">Connectez-vous à Passerelle pour choisir les agendas à partager avec Lapsus.</p><a class="button partner-connect-primary" href="${esc(login.href)}">Se connecter à Passerelle</a><p class="partner-connect-help">Vous pourrez accepter ou refuser le partage après la connexion. Votre mot de passe reste chez Passerelle.</p>${homeLink('Revenir à mon espace')}`);
  }
  function paint() {
    const client = consent.client, scopes = consent.requestedScopes || [];
    document.title = `Connecter ${client.name} · Passerelle`;
    const origin = new URL(client.origin);
    frame(`<div class="partner-connect-bridge" aria-hidden="true"><img src="${esc(new URL('brand/symbol.png', base).href)}" width="52" height="52" alt=""><span>→</span><span class="partner-client-mark">${esc(client.name.slice(0, 1))}</span></div><p class="eyebrow">UN PARTAGE QUE VOUS CHOISISSEZ</p><h1>Connecter votre agenda à ${esc(client.name)}.</h1><p class="partner-connect-destination">${esc(origin.hostname)}</p><p class="partner-connect-account">Connecté à Passerelle en tant que <strong>${esc(consent.account.displayName)}</strong>.</p>${consent.available ? `<form id="partner-consent-form"><fieldset class="partner-connect-scopes"><legend>Quels agendas souhaitez-vous partager ?</legend>${scopes.map(scope => `<label class="partner-scope"><input name="scopes" type="checkbox" value="${esc(scope.id)}" ${scope.id === 'calendar:courses' ? 'checked' : ''}><span class="partner-scope-icon">${icons[scope.id.split(':')[1]] || icons.courses}</span><span><strong>${esc(scope.label)}</strong><small>${esc(scope.description)}</small></span></label>`).join('')}</fieldset><p class="partner-connect-privacy">${esc(client.name)} pourra lire les agendas sélectionnés. Vous pourrez retirer son accès dans Réglages → Applications connectées.</p><p class="partner-connect-error" id="partner-consent-error" role="alert" hidden></p><div class="partner-connect-actions"><button class="button partner-connect-primary" type="submit">Autoriser le partage</button><button class="button secondary" type="button" data-consent-deny>Refuser</button></div></form>` : `<p class="notice" role="status">${esc(consent.reason || 'Connectez votre ENT et créez votre lien ICS avant de partager votre agenda.')}</p>${setupLink()}<button class="text-button" type="button" data-consent-deny>Refuser cette connexion</button>`}<p class="partner-connect-help partner-connect-last">Vos mots de passe Passerelle et ENT ne sont jamais transmis à ${esc(client.name)}. L’accès est en lecture seule.</p>`);
  }
  function setupLink() {
    const target = new URL(base.href); target.searchParams.set('connect', requestId);
    return `<a class="button partner-connect-primary" href="${esc(target.href)}">Préparer mon agenda dans Passerelle</a>`;
  }
  async function jsonFetch(route, body) {
    const response = await fetch(new URL('api/' + route, base), {credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(15000), ...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const value = await response.json();
    if (!response.ok) throw Object.assign(new Error(value.error || 'La connexion n’a pas pu aboutir.'), {status:response.status});
    return value;
  }
  async function load() {
    if (!/^[A-Za-z0-9_-]{43}$/.test(requestId || '')) { errorView('Cette demande est invalide ou incomplète.'); return; }
    try {
      consent = await jsonFetch('oauth/consent?request=' + encodeURIComponent(requestId));
      if (consent.request !== requestId || consent.client?.id !== 'lapsus' || consent.client?.origin !== 'https://mon-ent.pages.dev' || !consent.account?.id || !Array.isArray(consent.requestedScopes) || consent.requestedScopes.some(scope => !['calendar:courses','calendar:homework','calendar:exams'].includes(scope.id))) throw new Error('Les informations de cette demande sont invalides.');
      paint();
    } catch (error) { if (error.status === 401) loginView(); else errorView(error.message); }
  }
  function showError(message) {
    let node = document.querySelector('#partner-consent-error');
    if (!node) { node = document.createElement('p'); node.id = 'partner-consent-error'; node.className = 'partner-connect-error'; node.setAttribute('role', 'alert'); main.querySelector('.partner-connect-card')?.append(node); }
    node.hidden = false; node.textContent = message;
  }
  async function decide(allow) {
    if (busy || !consent) return;
    const scopes = allow ? [...document.querySelectorAll('input[name="scopes"]:checked')].map(input => input.value) : [];
    if (allow && !scopes.length) { showError('Choisissez au moins un agenda à partager, ou refusez la connexion.'); return; }
    busy = true; main.setAttribute('aria-busy', 'true');
    main.querySelectorAll('button,input').forEach(node => { node.disabled = true; });
    try {
      const result = await jsonFetch('oauth/consent', {request:requestId, accountId:consent.account.id, allow, scopes});
      const target = new URL(result.redirectURL);
      if (target.origin !== consent.client.origin || target.username || target.password || target.hash) throw new Error('L’adresse de retour reçue est invalide.');
      location.replace(target.href);
    } catch (error) {
      showError(error.message); busy = false; main.setAttribute('aria-busy', 'false');
      main.querySelectorAll('button,input').forEach(node => { node.disabled = false; });
    }
  }
  document.addEventListener('submit', event => { if (event.target.id === 'partner-consent-form') { event.preventDefault(); void decide(true); } });
  document.addEventListener('click', event => { if (event.target.closest('[data-consent-deny]')) void decide(false); });
  window.addEventListener('pageshow', event => { if (event.persisted) { consent = null; busy = false; void load(); } });
  void load();
})();
