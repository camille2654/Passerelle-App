/* Presentation and recovery only. Private preferences stay in the existing APIs. */
const experience = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const identity = () => [state?.user?.id,state?.user?.studentId,state?.user?.schoolName].join(':');
  let scope = '', undoSequence = 0;
  function bind(user) {
    const next = user ? [user.id,user.studentId,user.schoolName].join(':') : '';
    if (next === scope) return;
    scope = next; undoSequence++;searchText='';schoolResults=[];
    const notice = document.querySelector('#toast');
    if (notice) resetToast();
    document.querySelector('#connection-recovery')?.remove();
  }
  function connection(user) {
    const connected = user.skolengoConnected && !user.skolengoError;
    const complete = connected && !!user.feedURL && !!user.lastSync;
    const current = !user.schoolName ? 0 : !connected ? 1 : 2;
    return `<section class="connection-guide" aria-label="Étapes de connexion"><p class="connection-kicker">${complete?'Votre espace est prêt':'Retrouver mon lycée'}</p><h2>${complete?'Vos cours sont à portée de main':connected?'Dernière étape : récupérer vos cours':'Quelques étapes pour commencer'}</h2><ol>${['Mon lycée','Connexion ENT','Mes cours'].map((label,index)=>`<li class="${complete||index<current?'is-complete':index===current?'is-current':''}" ${!complete&&index===current?'aria-current="step"':''}><span aria-hidden="true">${complete||index<current?icon('check'):index+1}</span><strong>${label}</strong><small class="sr-only">${complete||index<current?'Terminé':index===current?'Étape en cours':'À venir'}</small></li>`).join('')}</ol>${complete?`<div class="connection-result"><span>${icon('check')} ${Number(user.total||0)} cours récupéré${Number(user.total||0)!==1?'s':''}</span><span>${icon('homework')} ${(user.work||[]).length} ${(user.work||[]).length===1?'travail disponible':'travaux disponibles'}</span><button type="button" class="button" data-portal="navigate" data-page="planner">Ouvrir mon agenda ${icon('arrow')}</button></div>`:`<p class="connection-explanation">${connected?'Affichez vos cours dans Passerelle. Vous pourrez ensuite ajouter votre lien ICS à votre agenda habituel.':'Choisissez votre établissement, puis utilisez vos identifiants habituels sur le site de votre ENT.'}</p>`}<div id="connection-recovery" role="alert" hidden></div></section>`;
  }
  function issue(user) {
    if (!user.skolengoError && !user.lastError) return '';
    const reconnect = !!user.skolengoError || !user.skolengoConnected;
    return `<aside class="recovery-notice" role="alert"><div>${icon(reconnect?'lock':'sync')}<div><strong>${reconnect?'Reconnectez votre lycée':'La mise à jour n’a pas abouti'}</strong><p>${reconnect?'Reconnectez l’ENT pour recevoir les prochaines mises à jour.':user.lastSync?'Les dernières données récupérées restent disponibles. Réessayez dans un instant.':'Vos données n’ont pas encore pu être récupérées. Réessayez dans un instant.'}</p>${user.lastSync?`<small>Dernière récupération : ${esc(dateTime(user.lastSync))}</small>`:''}<details><summary>Détail du problème</summary><p>${esc(user.skolengoError||user.lastError)}</p></details></div></div><div class="recovery-actions">${reconnect?'<button type="button" class="button secondary" data-home-connect>Reconnecter mon ENT</button>':`<button type="button" class="button secondary" data-action="sync" ${user.syncing?'disabled':''}>${user.syncing?'Vérification en cours…':'Réessayer'}</button>`}<button type="button" class="text-button" data-hub-open="support">Signaler le problème</button></div></aside>`;
  }
  function connectionError(error) {
    const root = document.querySelector('#connection-recovery');
    if (!root) return;
    root.hidden = false;
    root.innerHTML = `<strong>La connexion n’a pas pu aboutir</strong><p>${esc(error.message)}</p><button type="button" class="text-button" data-home-connect>Réessayer la connexion ${icon('arrow')}</button><button type="button" class="text-button" data-hub-open="support">Signaler le problème</button>`;
    root.scrollIntoView({block:'nearest',behavior:'instant'});
  }
  function workFeedback(work, before, owner, {reload, onUndo, container} = {}) {
    if (identity() !== owner) return;
    const sequence = ++undoSequence;
    const message = before ? 'Travail remis à faire.' : 'Travail marqué comme fait.';
    const run = async () => {
      if (identity() !== owner || sequence !== undoSequence) throw new Error('Ce travail a changé depuis cette action. Retrouvez-le dans vos devoirs.');
      await api('work/'+encodeURIComponent(work.id), {done:before});
      if (identity() !== owner || sequence !== undoSequence) return;
      undoSequence++; const currentWork=state.user.work?.find(item=>item.id===work.id);if(currentWork)currentWork.done=before;onUndo?.(before);
      try { if (reload) await reload(); if (identity()===owner) await refresh(); }
      catch { if(identity()===owner)toast('Modification annulée. L’affichage sera actualisé à la prochaine ouverture.'); }
    };
    if (container?.isConnected) {
      container.hidden = false; container.replaceChildren();const label=document.createElement('span');label.textContent=message;container.append(label,' ');
      const button = document.createElement('button'); button.type='button'; button.className='text-button undo-button'; button.textContent='Annuler';
      button.addEventListener('click', () => void act(button, async () => { try {await run(); if (container.isConnected) container.textContent='Modification annulée.';}catch(error){if(container.isConnected&&identity()===owner)label.textContent=error.message;} }));
      container.append(button);
    } else toast(message, false, {label:'Annuler', run});
  }
  return {bind,identity,connection,issue,connectionError,workFeedback};
})();
