const $ = s => document.querySelector(s);
const app = $('#app');
// Older cached HTML can briefly coexist with the updated application script.
const entCloseFeedback=(()=>{let button=$('#ent-close-feedback');if(!button){button=document.createElement('button');button.id='ent-close-feedback';button.type='button';button.className='button secondary full';button.textContent='Revenir à Passerelle';button.hidden=true;$('#ent-dialog').append(button);}return button;})();
// Resolve API routes from the deployed script, independently of the page URL.
const base = new URL('.', document.currentScript?.src || location.href).pathname;
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Recover URLs produced by the previously unhandled native connection form.
// Never re-submit a security code or one-time link from a query string.
const initialPageURL=new URL(location.href);
let returnToPronote=initialPageURL.searchParams.has('portalURL')||initialPageURL.searchParams.has('accountPin');
if(returnToPronote){initialPageURL.searchParams.delete('portalURL');initialPageURL.searchParams.delete('accountPin');history.replaceState(history.state,'',initialPageURL.pathname+initialPageURL.search+initialPageURL.hash);}
let state, invitation, invitationAdmin = false, schoolResults = [], searchText = '', inviteURL = '', entTimer, entFrameURL, toastTimer, remoteQueue = Promise.resolve();
let entAttempt=0,entPollActive=0,entFrameAbort=null,entClosing=null,entRoute='';
let statusVersion = '', authMode = 'login', refreshSequence = 0, resetPasswordToken = new URLSearchParams(location.hash.slice(1)).get('reset-password');
if(resetPasswordToken)history.replaceState(null,'',location.pathname + location.search);

async function api(url, data) {
  const end = url === 'status' ? () => {} : motion.request();
  try {
    const response = await fetch(base + 'api/' + url, { ...(data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), signal: AbortSignal.timeout(url==='skolengo/status'?15000:url.startsWith('pronote/')?200000:120000) });
    let result;
    try { result = await response.json(); }
    catch { throw Object.assign(new Error(response.status===413?'Le document est trop volumineux pour être envoyé.':response.status===429?'Trop de demandes rapprochées. Patientez un instant avant de réessayer.':'Le service ne répond pas correctement. Réessayez dans un instant.'), {status:response.status,code:'INVALID_RESPONSE'}); }
    if (!response.ok) throw Object.assign(new Error(result.code === 'ROUTE_NOT_FOUND' ? 'Le portail a été mis à jour. Rechargez cette page puis réessayez.' : result.error || 'Une erreur est survenue.'),{code:result.code,status:response.status});
    return result;
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError' || !error.status&&/fetch is aborted|operation.*aborted/i.test(error.message||'')) throw Object.assign(new Error('La demande prend trop de temps. Vérifiez votre connexion puis réessayez.'), {code:'REQUEST_TIMEOUT'});
    if (error instanceof TypeError) throw Object.assign(new Error(navigator.onLine === false ? 'Vous êtes hors connexion. Retrouvez Internet puis réessayez.' : 'Impossible de joindre Passerelle. Vérifiez votre connexion puis réessayez.'), {code:'NETWORK_UNAVAILABLE'});
    throw error;
  } finally { end(); }
}
let toastSequence = 0;
function resetToast() { clearTimeout(toastTimer); toastSequence++; const element=$('#toast'); element.hidden=true; element.replaceChildren(); }
function toast(message, error = false, action = null) {
  const element = $('#toast'), sequence = ++toastSequence;
  element.innerHTML = motion.toastMarkup(message, error); element.className = 'toast' + (error ? ' error' : ''); element.hidden = false;
  const dismiss = async () => { if (toastSequence!==sequence) return; await motion.notice(element,true); if(toastSequence===sequence) element.hidden=true; };
  const schedule = () => { clearTimeout(toastTimer); toastTimer=setTimeout(()=>void dismiss(),action?12000:error?9000:5000); };
  if (action) {
    const button=document.createElement('button');button.type='button';button.className='text-button undo-button';button.textContent=action.label;
    button.addEventListener('click',()=>{clearTimeout(toastTimer);void act(button,async()=>{await action.run();if(toastSequence===sequence)toast('Modification annulée.');});});element.append(button);
  }
  element.onpointerenter=()=>clearTimeout(toastTimer);element.onpointerleave=schedule;
  element.onfocusin=()=>clearTimeout(toastTimer);element.onfocusout=schedule;
  void motion.notice(element); schedule();
}
function dateTime(ms) { return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(ms)); }
function time(iso) { return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)); }
async function refresh(force = true) {
  const sequence = ++refreshSequence, nextState = await api('status');
  if(sequence !== refreshSequence) return;
  await motion.leaveBoot(app);
  if(sequence !== refreshSequence) return;
  state = nextState; experience.bind(state.user);documentPreview.bind(state.user);
  if(state.user){libraryPortal.bind(state.user);hub.bind(state.user);}
  if (!resetPasswordToken && partnersPortal.resume(state)) return;
  if (!state.user) {libraryPortal.reset();releasePortal.reset();onboardingPortal.reset();eventsPortal.reset();personalMailPortal.reset();passkeyPortal.reset();personalCalendarPortal.reset();travelPortal.reset();smartTravelPortal.reset();partnersPortal.reset();resourcesPortal.reset();incomingPortal.reset();}
  else if (document.querySelector('#portal-main')) {onboardingPortal.mount(state.user);eventsPortal.mount(state.user);personalMailPortal.mount(state.user);passkeyPortal.mount(state.user);personalCalendarPortal.mount(state.user);travelPortal.mount(state.user);smartTravelPortal.mount(state.user);partnersPortal.mount(state.user);resourcesPortal.mount(state.user);incomingPortal.mount(state.user);releasePortal.mount(state.user);}
  const version = JSON.stringify([state.user?.release?.id,state.user?.release?.pending,state.user?.eventSuggestions?.version,state.user?.eventSuggestions?.pending,state.user?.onboarding,state.user?.id, state.user?.enabled, state.user?.syncing, state.user?.lastAttempt, state.user?.lastError, state.user?.skolengoError, state.user?.feedURL, state.user?.skolengoConnected, state.user?.studentId, state.user?.schoolName, state.user?.friendshipVersion, state.user?.personalVersion, state.user?.pronote?.lastSync, state.user?.pronote?.connected, state.user?.pronote?.lastError, state.user?.pronote?.needsReconnect, state.user?.support?.pending, state.user?.support?.unread, state.user?.brief?.date,state.user?.lastSync,state.user?.today?.date,state.user?.home?.phase,state.user?.home?.next?.id,state.user?.home?.next?.minutesUntil, state.user?.email?.address, state.user?.email?.verified, state.user?.email?.pending, state.user?.email?.enabled, state.user?.email?.alertsEnabled, state.user?.email?.lastChangeAlert?.at, state.user?.email?.lastDelivery?.status, state.mailReady, state.registrationOpen, state.operations?.version, state.operations?.maintenance.enabled, state.adminSession?.version]);
  if (force || version !== statusVersion) { if (!force && state.user && (libraryPortal.isEditing(state.user)||features.isEditing(state.user)||personal.isEditing(state.user)||hub.isEditing(state.user)||adminPro.isEditing(state.user)||pushPortal.isEditing(state.user)||favoritePortal.isEditing(state.user)||eventsPortal.isEditing(state.user)||personalMailPortal.isEditing(state.user)||passkeyPortal.isEditing(state.user)||personalCalendarPortal.isEditing(state.user)||travelPortal.isEditing(state.user)||smartTravelPortal.isEditing(state.user)||partnersPortal.isEditing(state.user)||resourcesPortal.isEditing(state.user)||incomingPortal.isEditing(state.user)||onboardingPortal.isInteracting()||releasePortal.isEditing(state.user)||document.activeElement?.matches('input, textarea, select'))) return; render(); statusVersion = version; }
}
function render() {
  portal.remember();
  app.setAttribute('aria-busy', 'false');
  experience.bind(state.user); adminPro.siteBanner(); document.body.classList.toggle('is-admin',!!state.user?.admin);
  $('#logout').hidden = !state.user;
  $('#notifications-button').hidden = !state.user;
  $('#global-search-button').hidden = !state.user;
  features.mount(state.user);
  document.body.classList.toggle('authenticated', !!state.user);
  if (!state.user) {entConnect.mount(null); extras.clear(); releasePortal.reset(); personalMailPortal.reset();passkeyPortal.reset();personalCalendarPortal.reset();travelPortal.reset();smartTravelPortal.reset();partnersPortal.reset();resourcesPortal.reset();incomingPortal.reset();eventsPortal.reset();onboardingPortal.reset();portal.reset();libraryPortal.reset();favoritePortal.reset();schoolPortal.reset(); menuPortal.reset(); personal.reset(); hub.reset(); adminPro.reset(); $('#motion-preview')?.close(); return resetPasswordToken?renderPasswordReset():renderAuth(); }
  if(!state.user.admin)adminPro.reset();
  if(resetPasswordToken)return renderPasswordReset();
  const u = state.user, ready = u.skolengoConnected && !u.skolengoError, hasFeed = !!u.feedURL, busy = u.syncing;
  const webcal = hasFeed ? u.feedURL.replace(/^https?:/, 'webcal:') : '';
  app.innerHTML = `
    <section class="hero welcome-row"><div><p class="hello">Bonjour ${escape(u.name)} 👋</p><p class="eyebrow">UN PEU MOINS À GÉRER</p><h1>Votre emploi du temps,<br><span>dans votre agenda.</span></h1><p class="subtitle">Connectez votre ENT, puis abonnez-vous avec votre lien ICS.<br class="desktop-break"> Vos cours restent au même endroit, même quand ils changent.</p></div><span class="status-pill ${u.enabled ? 'active' : ''}"><span class="status-dot"></span>${busy ? 'Vérification en cours' : u.enabled ? 'Actualisation active' : hasFeed ? 'Actualisation en pause' : ready ? 'Prêt à créer votre lien' : 'Connectez votre ENT'}</span></section>
    ${u.lastError ? `<div class="notice" role="alert">${escape(u.lastError)}</div>` : ''}
    <section class="connection-grid" aria-label="Votre connexion et votre lien ICS">
      <article class="card connection-card"><div class="card-top"><span class="service-logo skolengo-logo">${icon('calendar')}</span><span class="badge ${u.skolengoError ? 'error' : u.skolengoConnected ? 'connected' : ''}">${u.skolengoError ? 'À reconnecter' : u.skolengoConnected ? '✓ Connecté' : 'Non connecté'}</span></div><h2><span class="step">01</span>Votre établissement</h2><p>${u.skolengoConnected ? `${escape(u.schoolName)}<br>${escape(u.students?.find(s => s.id === u.studentId)?.name || '')}` : 'Recherchez votre établissement ou connectez votre portail ENT avec PRONOTE.'}</p><div class="card-bottom"><button class="button secondary" data-action="school-search" ${busy ? 'disabled' : ''}>${u.skolengoConnected ? 'Reconnecter mon ENT' : 'Connecter mon ENT'} ${icon('arrow')}</button>${u.skolengoConnected ? `<button class="text-button disconnect" data-action="disconnect-skolengo" ${busy ? 'disabled' : ''}>Déconnecter</button>` : ''}</div><div id="school-search" class="school-search" hidden><p class="ent-coverage">Recherche nationale · établissements Skolengo compatibles</p><form id="school-form" class="inline-form ent-school-form"><label class="ent-provider-field" for="ent-provider">Votre ENT <span class="muted">(facultatif)</span><select id="ent-provider" name="provider"><option value="">Tous les ENT Skolengo</option></select></label><input name="q" aria-label="Nom ou ville de l’établissement" placeholder="Nom du lycée ou ville" minlength="3" maxlength="100" value="${escape(searchText)}" required><button class="button secondary" type="submit">Chercher</button></form><ul class="schools" id="school-results"></ul><details class="ent-other"><summary>Mon établissement utilise un autre ENT</summary><p>Votre ENT ouvre PRONOTE ? Utilisez son adresse habituelle, connectez-vous puis ouvrez PRONOTE dans la fenêtre. Les notes, cours et devoirs disponibles pourront être récupérés.</p><form id="ent-web-form"><label for="ent-portal-url">Adresse de votre portail ENT<input id="ent-portal-url" name="portalURL" type="url" maxlength="1500" required placeholder="https://…" autocomplete="url"></label><details><summary>PRONOTE demande un code de sécurité</summary><label>Code de sécurité de votre compte<input name="accountPin" type="password" maxlength="128" autocomplete="off"></label></details><button class="button secondary" type="submit">Continuer avec mon ENT</button><p class="form-error" role="alert" hidden></p></form><p class="small muted">Portails proposés : Monlycée.net, Lycée Connecté, Atrium, ENT Hauts-de-France, L’Éduc de Normandie, Toutatice, NET O’Centre, e-lyco et Wilapa. Connexion en bêta : elle dépend du SSO PRONOTE de l’établissement. Mails et actualités ne sont pas importés par ce parcours.</p><button type="button" class="text-button" data-hub-open="support">Mon ENT n’est pas proposé</button></details></div>${u.students?.length > 1 ? `<div class="field student-field"><label for="student">Élève à synchroniser</label><select id="student" ${busy ? 'disabled' : ''}>${u.students.map(s => `<option value="${escape(s.id)}" ${u.studentId === s.id ? 'selected' : ''}>${escape(s.name)} ${escape(s.className)}</option>`).join('')}</select></div>` : ''}</article>
      <span class="connector" aria-hidden="true">${icon('arrow')}</span>
      <article class="card connection-card feed-card"><div class="card-top"><span class="service-logo feed-logo">${icon('calendar')}</span><span class="badge ${hasFeed ? 'connected' : ''}">${hasFeed ? '✓ Lien disponible' : 'À créer'}</span></div><h2><span class="step">02</span>Votre lien ICS privé</h2><p>${hasFeed ? 'Ajoutez ce lien comme abonnement dans votre agenda pour recevoir les mises à jour.' : 'Un lien personnel à ajouter dans l’application d’agenda de votre choix.'}</p>${hasFeed ? `<label for="feed-url">Lien d’abonnement</label><div class="copy-row feed-copy"><input id="feed-url" value="${escape(u.feedURL)}" readonly><button class="button secondary" data-action="copy-feed" aria-label="Copier le lien ICS">${icon('copy')}</button></div><a class="button full" href="${escape(webcal)}">S’abonner à l’agenda ${icon('out')}</a><p class="small feed-privacy">Ce lien inclut vos cours, devoirs et contrôles. Gardez-le privé.</p><details class="simple-feed-options"><summary>Options de mon abonnement</summary>${features.feedTools(u)}<div class="feed-controls"><button class="text-button" data-action="rotate-feed" ${busy ? 'disabled' : ''}>Renouveler le lien</button><button class="text-button" data-action="revoke-feed" ${busy ? 'disabled' : ''}>Désactiver le lien</button></div></details>` : `<button class="button" data-action="create-feed" ${!ready || busy ? 'disabled' : ''}>Créer mon lien ICS ${icon('arrow')}</button>`}</article>
    </section>
    <section class="card automation"><span class="automation-icon">${icon('sync')}</span><div class="automation-content"><h2>Les cours changent. Votre lien reste le même.</h2><p>${u.enabled ? 'Vos prochains cours sont vérifiés plus souvent lorsque vous utilisez Passerelle.' : hasFeed ? 'En pause : votre lien continue de servir le dernier emploi du temps récupéré.' : 'Les mises à jour automatiques démarrent à la création de votre lien.'}</p></div><button class="switch" role="switch" aria-label="Actualisation automatique de l’ENT" aria-checked="${!!u.enabled}" data-action="toggle" ${busy || (!u.enabled && (!ready || !hasFeed)) ? 'disabled' : ''}><span></span></button></section>
    <p class="small muted feed-refresh-note">${icon('clock')} Année scolaire ${escape(state.schoolYear?.label || "en cours")} · Votre application d’agenda choisit sa fréquence de rafraîchissement. Ajoutez le lien en abonnement pour recevoir les changements ; importer le fichier une seule fois ne crée pas d’abonnement.</p>
    ${features.render(u)}
    <div class="trust-row"><span>${icon('lock')} Connexion ENT chiffrée</span><span>${icon('check')} Un lien privé par personne</span><span>${icon('sync')} Ajouts, modifications, annulations</span></div>
    ${u.admin ? renderAdmin() + features.renderSMTP() : ''}`;
  portal.enhance(u);
  entConnect.mount(u);
  if(returnToPronote){returnToPronote=false;queueMicrotask(()=>{if(state.user?.id===u.id)hub.open('sources');});}
  onboardingPortal.mount(u);
  eventsPortal.mount(u);
  personalMailPortal.mount(u);
  passkeyPortal.mount(u);personalCalendarPortal.mount(u);travelPortal.mount(u);smartTravelPortal.mount(u);partnersPortal.mount(u);resourcesPortal.mount(u);incomingPortal.mount(u);releasePortal.mount(u);
}
function renderPasswordReset() {
  app.innerHTML=`<section class="password-reset-card"><p class="eyebrow">PASSERELLE / ACCÈS AU COMPTE</p><h1>Choisir un nouveau mot de passe.</h1><p>Ce lien est personnel et utilisable une seule fois.</p><form id="reset-password-form"><label for="reset-new-password">Nouveau mot de passe<input id="reset-new-password" name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label><label for="reset-confirm-password">Confirmer le mot de passe<input id="reset-confirm-password" name="confirm" type="password" minlength="12" maxlength="256" autocomplete="new-password" required></label><p class="form-error" id="reset-password-error" role="alert" hidden></p><button class="button" type="submit">Enregistrer mon mot de passe</button></form></section>`;
}
document.addEventListener('submit',event=>{if(event.target.id!=='reset-password-form')return;event.preventDefault();const form=event.target;void act(form.querySelector('[type=submit]'),async()=>{try{if(form.elements.password.value!==form.elements.confirm.value)throw new Error('Les deux mots de passe ne correspondent pas.');await api('password/reset',{token:resetPasswordToken,password:form.elements.password.value});resetPasswordToken=null;form.reset();await refresh();toast('Votre mot de passe est enregistré. Vous pouvez vous connecter.');}catch(error){document.querySelector('#reset-password-error').textContent=error.message;document.querySelector('#reset-password-error').hidden=false;}});});
function renderAuth() {
  const signUp = !!invitation || authMode === 'signup' && state.registrationOpen;
  app.innerHTML = `<div class="auth-grid public-auth"><section class="hero"><p class="auth-open-label">${state.registrationOpen ? 'Inscriptions ouvertes · Bêta gratuite' : 'Passerelle'}</p><h1>Votre espace <span>scolaire.</span></h1><p class="subtitle">Les cours de votre ENT, vos devoirs et vos révisions.</p><ul class="auth-index"><li>${icon('calendar')}<span>Emploi du temps synchronisé</span></li><li>${icon('book')}<span>Devoirs et contrôles</span></li><li>${icon('study')}<span>Révisions et notifications</span></li></ul><p class="auth-scope">Plusieurs régions et ENT. La disponibilité des services dépend de votre établissement.</p></section><section class="card auth-card">${!invitation ? `<div class="auth-modes" aria-label="Accès à Passerelle"><button type="button" data-auth-mode="login" aria-pressed="${!signUp}" class="${!signUp ? 'selected' : ''}">Connexion</button>${state.registrationOpen ? `<button type="button" data-auth-mode="signup" aria-label="Créer un compte gratuit" aria-pressed="${signUp}" class="${signUp ? 'selected' : ''}">Inscription</button>` : ''}</div>` : '<p class="eyebrow">Invitation personnelle</p>'}<h2>${signUp ? invitationAdmin && invitation ? 'Compte administrateur' : 'Créer un compte' : 'Connexion'}</h2><p>${signUp ? 'Votre ENT pourra être connecté ensuite.' : 'Retrouvez votre espace personnel.'}</p>${!state.registrationOpen && !invitation ? '<p class="notice info">Les nouvelles inscriptions sont momentanément fermées. Les comptes existants et les invitations restent utilisables.</p>' : ''}<div id="auth-error" class="form-error" role="alert" hidden></div><form id="auth-form" data-mode="${signUp ? 'signup' : 'login'}">${signUp ? '<div class="field"><label for="name">Votre prénom</label><input id="name" name="name" autocomplete="given-name" placeholder="Camille" maxlength="80" required></div><div class="bot-field" aria-hidden="true"><label for="company-website">Ne pas remplir</label><input id="company-website" name="companyWebsite" tabindex="-1" autocomplete="off"></div>' : ''}<div class="field"><label for="login">Identifiant du portail</label><input id="login" name="login" autocomplete="username" placeholder="Identifiant ou adresse mail" minlength="3" maxlength="100" required>${signUp ? '<span class="field-hint">Lettres sans accent, chiffres, point ou adresse mail.</span>' : ''}</div><div class="field"><label for="password">Mot de passe du portail</label><div class="password-field"><input id="password" name="password" type="password" autocomplete="${signUp ? 'new-password' : 'current-password'}" placeholder="${signUp ? '12 caractères minimum' : 'Mot de passe'}" minlength="${signUp ? '12' : '1'}" maxlength="256" required><button type="button" data-password-visibility aria-label="Afficher le mot de passe" aria-pressed="false">Voir</button></div></div><button class="button full" type="submit">${signUp ? 'Créer mon espace' : 'Se connecter'} ${icon('arrow')}</button></form>${!signUp?'<button type="button" class="button secondary full passkey-login-button" data-passkey-login>Se connecter avec une clé d’accès</button>':''}<p class="auth-note muted">${signUp ? 'Bêta gratuite, sans carte bancaire.' : 'Utilisez votre mot de passe Passerelle.'}</p></section></div>`;
  motion.scene($('.auth-grid'));
}
document.addEventListener('click', event => {
  const mode = event.target.closest('[data-auth-mode]');
  if (mode && !state?.user) { authMode = mode.dataset.authMode; renderAuth(); return; }
  const visibility = event.target.closest('[data-password-visibility]');
  if (visibility) { const input = $('#password'), visible = input.type === 'password'; input.type = visible ? 'text' : 'password'; visibility.textContent = visible ? 'Masquer' : 'Voir'; visibility.setAttribute('aria-label', visible ? 'Masquer le mot de passe' : 'Afficher le mot de passe'); visibility.setAttribute('aria-pressed', visible); }
});
function renderEvents(events = []) {
  const next = events.filter(e => Date.parse(e.end) > Date.now()).slice(0, 5);
  if (!next.length) return `<div class="empty-state"><span class="empty-icon">${icon('calendar')}</span><strong>${state.user.lastSync ? 'Rien de prévu pour le moment' : 'Votre semaine prendra place ici'}</strong><p>${state.user.lastSync ? 'Aucun prochain cours dans l’emploi du temps récupéré.' : 'Connectez votre ENT et créez votre lien ICS pour retrouver vos cours.'}</p></div>`;
  return `<ul class="event-list">${next.map(e => { const d = new Date(e.start); return `<li><span class="event-date">${escape(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short' }).format(d))}<strong>${escape(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric' }).format(d))}</strong></span><div class="event-info"><strong>${escape(e.title)}</strong><span>${escape(e.location || 'Salle non précisée')}</span></div><span class="event-time">${escape(time(e.start))} – ${escape(time(e.end))}</span></li>`; }).join('')}</ul>`;
}
function renderHistory(history = []) {
  if (!history.length) return `<div class="empty-state"><span class="empty-icon">${icon('sync')}</span><strong>Tout commence par une connexion</strong><p>Vous retrouverez ici le résultat de chaque vérification.</p></div>`;
  return history.slice(0, 4).map(h => `<div class="history-item"><strong class="${h.ok ? 'success-text' : ''}">${h.ok ? '✓ ' + (h.added + h.updated + h.deleted ? 'Emploi du temps mis à jour' : 'Votre lien ICS est à jour') : 'Vérification interrompue'}</strong><p>${h.ok ? `${h.added} ajout${h.added > 1 ? 's' : ''} · ${h.updated} modification${h.updated > 1 ? 's' : ''} · ${h.deleted} annulation${h.deleted > 1 ? 's' : ''}` : escape(h.message)}</p><time>${escape(dateTime(h.at))}</time></div>`).join('');
}
function renderAdmin() {
  return `<details class="settings" open><summary>Administration · Invitations</summary><div class="settings-body"><section class="card"><h2>Inviter votre ami</h2><p>Générez un lien personnel et envoyez-le à votre ami. Il créera son espace, connectera son ENT et récupérera son propre lien ICS.</p><button class="button secondary full" data-action="invite">Créer un lien d’invitation ${icon('arrow')}</button><div class="invitation-result" id="invitation-result" ${inviteURL ? '' : 'hidden'}><label for="invitation-url">Invitation valable 7 jours, utilisable une seule fois</label><div class="copy-row"><input id="invitation-url" readonly value="${escape(inviteURL)}"><button class="button secondary" data-action="copy-invite" aria-label="Copier le lien d’invitation">${icon('copy')}</button></div></div><p class="small muted">Chaque personne dispose de son espace et de son lien privé. Les mises à jour continuent lorsque le portail est fermé.</p></section><section class="card"><h2>Un abonnement, un emploi du temps à jour</h2><p>Sur téléphone, utilisez « S’abonner à l’agenda ». Vous pouvez aussi copier le lien ICS et l’ajouter comme abonnement par URL dans votre application d’agenda.</p><div class="howto">Passerelle adapte les vérifications à votre activité et conserve une couverture de toute l’année scolaire. Votre application choisit ensuite quand relire le lien : le délai d’affichage peut donc être plus long.</div><p class="small muted">Le lien couvre toute l’année scolaire ${escape(state.schoolYear?.label || "en cours")}, du 1er septembre au 31 août. Les cours déjà publiés par Skolengo sont récupérés. Les connecteurs dépendent des services publiés par l’établissement.</p></section></div></details>`;
}
async function act(button, task) {
  const before = button?.innerHTML, previousBusy = button?.getAttribute('aria-busy');
  if (button) {
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    const key = button.dataset.action || button.dataset.feature || button.dataset.extra;
    const label = key === 'sync' ? 'Vérification…' : key === 'create-feed' ? 'Création du lien…' : key === 'school-select' ? 'Connexion…' : /envoyer|confirmer|envoi/i.test(button.textContent) ? 'Envoi…' : 'En cours…';
    if (!button.matches('[role=switch]')) button.innerHTML = motion.busy(label, button.id === 'logout' || button.classList.contains('icon-button'));
  }
  try { await task(); }
  catch (error) { toast(error.message, true); }
  finally { if (button?.isConnected) { button.disabled = false; button.innerHTML = before; if (previousBusy === null) button.removeAttribute('aria-busy'); else button.setAttribute('aria-busy', previousBusy); } }
}
document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  void act(button, async () => {
    if (action === 'school-search') { $('#school-search').hidden = !$('#school-search').hidden; if (!$('#school-search').hidden) $('#school-form input').focus(); }
    else if (action === 'school-select') {
      await startENTConnection('skolengo/start',{schoolId:button.dataset.id});
    }
    else if (action === 'sync') { await api('sync', {}); await refresh(); toast('Votre emploi du temps a été vérifié. Le lien ICS a été actualisé.'); }
    else if (action === 'toggle') { await api('sync/toggle', { enabled: !state.user.enabled }); await refresh(); toast(state.user.enabled ? 'Les mises à jour automatiques sont activées.' : 'Les mises à jour sont en pause.'); }
    else if (action === 'create-feed') { await api('feed/create', {}); await refresh(); toast('Votre lien ICS est prêt. Ajoutez-le en abonnement dans votre agenda.'); }
    else if (action === 'rotate-feed') {
      if (!confirm('Renouveler votre lien ICS ? L’ancien lien cessera de fonctionner. Il faudra vous abonner avec le nouveau lien.')) return;
      await api('feed/rotate', {}); await refresh(); toast('Votre nouveau lien ICS est prêt.');
    }
    else if (action === 'revoke-feed') {
      if (!confirm('Désactiver votre lien ICS et les mises à jour ? Votre application pourra conserver les cours déjà téléchargés.')) return;
      await api('feed/revoke', {}); await refresh(); toast('Le lien ICS a été désactivé.');
    }
    else if (action === 'disconnect-skolengo') {
      if (!confirm('Déconnecter Skolengo ? Cela désactivera également votre lien ICS.')) return;
      await api('disconnect/skolengo', {}); await refresh(); toast('La connexion ENT et le lien ICS ont été désactivés.');
    }
    else if (action === 'invite') { inviteURL = (await api('admin/invitations', {})).url; $('#invitation-result').hidden = false; $('#invitation-url').value = inviteURL; toast('Votre invitation est prête à être envoyée.'); }
    else if (action === 'copy-feed' || action === 'copy-invite') { const input = $(action === 'copy-feed' ? '#feed-url' : '#invitation-url'); try { await navigator.clipboard.writeText(input.value); toast('Lien copié.'); } catch { input.select(); toast('Sélectionnez puis copiez le lien.'); } }
  });
});
document.addEventListener('submit', event => {
  const form = event.target;
  if (!['auth-form', 'school-form'].includes(form.id)) return;
  event.preventDefault(); const values = Object.fromEntries(new FormData(form));
  void act(form.querySelector('button[type=submit]'), async () => {
    if (form.id === 'auth-form') {
      try { await api(form.dataset.mode === 'signup' ? 'register' : 'login', { ...values, ...(invitation ? { token: invitation } : {}) }); invitation = null; authMode = 'login'; await refresh(); if(!document.querySelector('dialog[open]'))$('#portal-main')?.focus({ preventScroll: true }); window.scrollTo({ top: 0, left: 0 }); }
      catch (error) { $('#auth-error').textContent = error.message; $('#auth-error').hidden = false; }
    }
    else {
      searchText = values.q;
      try { schoolResults = (await api('skolengo/schools?q=' + encodeURIComponent(values.q)+'&provider='+encodeURIComponent(values.provider||''))).schools; }
      catch (error) { $('#school-results').innerHTML='<li class="school-notice" role="alert">'+escape(error.message)+' Vous pouvez relancer la recherche avec le même nom.</li>'; throw error; }
      $('#school-results').innerHTML = schoolResults.length ? schoolResults.map(s => `<li><div><strong>${escape(s.name)}</strong><small>${escape(s.zipCode)} ${escape(s.city)}${s.provider?' · '+escape(s.provider.label):''}</small></div><button class="button secondary" data-action="school-select" data-id="${escape(s.id)}">Choisir</button></li>`).join('') : '<li class="school-notice">Aucun établissement compatible trouvé. Essayez sa ville, un autre ENT ou le parcours ci-dessous.</li>';
    }
  });
});
document.addEventListener('change', event => { if (event.target.id !== 'student') return; if (state.user.feedURL && !confirm('Changer d’élève désactivera le lien ICS actuel. Vous pourrez créer un nouveau lien pour cet élève.')) { event.target.value = state.user.studentId; return; } void api('student', { studentId: event.target.value }).then(() => refresh()).catch(e => toast(e.message, true)); });
$('#logout').addEventListener('click', () => { void act($('#logout'), async () => { await api('logout', {});pushPortal.disconnected(); await refresh(); window.scrollTo({ top: 0, left: 0 }); }); });
async function startENTConnection(route,body) {
  if(entClosing)await entClosing;
  if($('#ent-dialog').open)throw new Error('Une connexion ENT est déjà ouverte.');
  entAttempt++;entRoute=route;entCloseFeedback.hidden=true;$('#remote-text-form').hidden=false;$('#ent-dialog').classList.remove('ent-processing','ent-error');$('#ent-title').textContent=route==='skolengo/start'?'Connectez-vous à votre ENT':'Relier PRONOTE depuis votre ENT';
  $('#ent-message').textContent=route==='skolengo/start'?'Cliquez dans le champ à remplir, puis utilisez la saisie ci-dessous.':'Connectez-vous à votre ENT puis ouvrez PRONOTE depuis son menu.';
  $('#ent-progress span').textContent='Étape 2 sur 3 · Connexion à mon lycée';
  motion.open($('#ent-dialog'));document.body.classList.add('no-scroll');$('#ent-loading').textContent='Ouverture de votre ENT…';$('#ent-loading').hidden=false;$('#ent-frame').hidden=true;$('#ent-message').setAttribute('role','status');$('#close-ent').disabled=true;
  try{await api(route,body);await pollENT();}
  catch(error){await closeENT();experience.connectionError(error);throw error;}
  finally{$('#close-ent').disabled=false;}
}
async function closeENT() {
  if(entClosing)return entClosing;
  entAttempt++;clearTimeout(entTimer);entFrameAbort?.abort();entFrameAbort=null;
  const closing=(async()=>{await motion.close($('#ent-dialog'));document.body.classList.remove('no-scroll');if(entFrameURL)URL.revokeObjectURL(entFrameURL);entFrameURL=null;$('#ent-frame').removeAttribute('src');$('#ent-frame').hidden=true;$('#remote-text').value='';await api('skolengo/stop',{}).catch(()=>{});})();
  entClosing=closing;try{await closing;}finally{if(entClosing===closing)entClosing=null;}
}
$('#close-ent').addEventListener('click',()=>{void closeENT();});
entCloseFeedback.addEventListener('click',()=>{void closeENT();});
$('#ent-dialog').addEventListener('cancel',event=>{event.preventDefault();if(!$('#close-ent').disabled)void closeENT();});
function entFailure(message){
  $('#ent-dialog').classList.add('ent-error');$('#ent-progress span').textContent='Connexion interrompue';$('#ent-message').textContent=message;$('#ent-message').setAttribute('role','alert');$('#remote-text-form').hidden=true;$('#ent-frame').hidden=true;$('#ent-loading').hidden=true;entCloseFeedback.hidden=false;$('#close-ent').disabled=false;entCloseFeedback.focus({preventScroll:true});
}
async function pollENT() {
  clearTimeout(entTimer);const attempt=entAttempt;
  if(!$('#ent-dialog').open||entPollActive===attempt)return;
  entPollActive=attempt;let next=true,controller;
  const current=()=>attempt===entAttempt&&$('#ent-dialog').open;
  try{
    const status=await api('skolengo/status');if(!current())return;
    if(status.status==='confirmation'){next=false;await closeENT();await refresh();hub.open('sources');return;}
    if(status.status==='connected'){next=false;await closeENT();await refresh();toast('Votre ENT est connecté. Vous pouvez maintenant récupérer vos cours.');return;}
    if(['error','closed'].includes(status.status)){next=false;entFailure(status.error||'La fenêtre de connexion a expiré. Fermez-la puis relancez la connexion.');return;}
    $('#ent-host').textContent=status.host||'Ouverture du site officiel…';$('#ent-message').setAttribute('role','status');entCloseFeedback.hidden=true;
    const processing=status.status==='processing';$('#ent-dialog').classList.toggle('ent-processing',processing);$('#remote-text-form').hidden=processing;
    $('#ent-progress span').textContent=processing?'Étape 3 sur 3 · Importation depuis PRONOTE':'Étape 2 sur 3 · Connexion à mon lycée';
    $('#ent-message').textContent=status.hint||(processing?'Connexion reçue. Récupération de vos informations…':entRoute==='skolengo/start'?'Cliquez sur le champ à remplir, puis utilisez la saisie ci-dessous.':'Connectez-vous à votre ENT puis ouvrez PRONOTE depuis son menu.');
    if(processing){$('#ent-frame').hidden=true;$('#ent-loading').textContent='PRONOTE est connecté. Importation en cours…';$('#ent-loading').hidden=false;return;}
    controller=new AbortController();entFrameAbort=controller;const timeout=setTimeout(()=>controller.abort(),15000);
    let response;try{response=await fetch(base+'api/skolengo/frame',{signal:controller.signal,cache:'no-store'});}finally{clearTimeout(timeout);}
    if(!current())return;
    if(response.status===401||response.status===403){next=false;entFailure('Votre session Passerelle a expiré. Fermez cette fenêtre puis reconnectez-vous à Passerelle.');return;}
    if(response.status===200){const blob=await response.blob();if(!current())return;const old=entFrameURL;entFrameURL=URL.createObjectURL(blob);$('#ent-frame').src=entFrameURL;$('#ent-frame').hidden=false;$('#ent-loading').hidden=true;if(old)URL.revokeObjectURL(old);}
  }catch(error){if(!current())return;if([401,403].includes(error.status)){next=false;entFailure('Votre session Passerelle a expiré. Fermez cette fenêtre puis reconnectez-vous.');return;}$('#ent-message').textContent='L’affichage de la fenêtre a été interrompu un instant. La vérification reprend automatiquement.';}
  finally{if(entPollActive===attempt)entPollActive=0;if(entFrameAbort===controller)entFrameAbort=null;if(next&&current())entTimer=setTimeout(()=>{void pollENT();},1100);}
}
function remoteInput(action) {
  remoteQueue = remoteQueue.then(() => api('skolengo/input', action)).catch(e => toast(e.message, true));
  return remoteQueue;
}
$('#ent-frame').addEventListener('click', e => { const r = e.target.getBoundingClientRect(); $('#remote').focus({ preventScroll: true }); void remoteInput({ type: 'click', x: (e.clientX - r.left) * 1000 / r.width, y: (e.clientY - r.top) * 740 / r.height }); });
$('#remote').addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) {
    if (e.key.toLowerCase() === 'a') { e.preventDefault(); void remoteInput({ type: 'key', key: 'Control+a' }); }
    return;
  }
  if (e.key.length === 1) { e.preventDefault(); void remoteInput({ type: 'text', text: e.key }); }
  else if (['Tab', 'Enter', 'Backspace', 'Delete', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) { e.preventDefault(); void remoteInput({ type: 'key', key: e.key === 'Tab' && e.shiftKey ? 'Shift+Tab' : e.key }); }
});
$('#remote').addEventListener('paste', e => { e.preventDefault(); void remoteInput({ type: 'text', text: e.clipboardData.getData('text').slice(0, 1000) }); });
$('#remote').addEventListener('wheel', e => { e.preventDefault(); void remoteInput({ type: 'scroll', y: e.deltaY }); }, { passive: false });
$('#remote-text-form').addEventListener('submit', e => { e.preventDefault(); const text = $('#remote-text').value; $('#remote-text').value = ''; if (text) void remoteInput({ type: 'text', text }); });
$('#remote-tab').addEventListener('click', () => { void remoteInput({ type: 'key', key: 'Tab' }); });
$('#remote-enter').addEventListener('click', () => { void remoteInput({ type: 'key', key: 'Enter' }); });
async function init() {
  const params = new URLSearchParams(location.hash.slice(1));
  invitation = params.get('invitation');
  authMode = params.has('signup') ? 'signup' : 'login';
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  if (invitation) {
    try { invitationAdmin = (await api('invitation/check', { token: invitation })).admin; }
    catch (e) { invitation = null; toast(e.message, true); }
  }
  incomingPortal.handleHash(params);resourcesPortal.handleHash(params);extras.handleHash(params);pushPortal.handleTarget(params.get('push'));personalMailPortal.handleHash(params);
  try { await features.handleHash(params); } catch (error) { toast(error.message, true); }
  await refresh();
  if (params.has('verify-email') && state.user) features.openNotifications('email');
}
void init().catch(() => motion.bootError(app));
document.addEventListener('click', event => { if (!event.target.closest('[data-retry-start]')) return; motion.boot(app); void refresh().catch(() => motion.bootError(app)); });
window.addEventListener('hashchange', () => { void init().catch(e => toast(e.message, true)); });
setInterval(() => { if (state?.user && !document.hidden && !$('#ent-dialog').open) void refresh(false).catch(() => {}); }, 15000);
