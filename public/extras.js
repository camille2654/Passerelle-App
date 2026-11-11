const extras = (() => {
  let owner = null, active = 'week', weekDate = null, weekDay = null, bagDate = null, data = {}, error = '', loading = false, serial = 0, editingKit = 'daily', inviteURL = '', friendToken = null, offered = '', selectedFriends = [], animatePanel = false;
  try { friendToken = sessionStorage.getItem('passerelle.friendInvite'); } catch { /* Optional persistence across sign-in. */ }
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (date, days) => { const value = new Date(date + 'T12:00:00Z'); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
  const clamp = date => date < state.schoolYear.start ? state.schoolYear.start : date > state.schoolYear.end ? state.schoolYear.end : date;
  const dayLabel = (day, short = false) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: short ? 'short' : 'long', day: 'numeric', month: 'short' }).format(new Date(day + 'T12:00:00Z'));
  const minutes = value => String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  const tabs = [['evening','sun','Ma soirée'],['notes','book','Notes de cours'],['load','activity','Charge de travail'],['preferences','palette','Préférences'],['week', 'calendar', 'Semaine'], ['bag', 'bag', 'Mon sac'], ['study', 'study', 'Révisions'], ['friends', 'users', 'Entre amis'], ['app', 'phone', 'Application']];
  const agendaMedia=matchMedia('(max-width:1000px)');
  let agendaMode='',agendaTransition='';
  try{const saved=localStorage.getItem('passerelle.agendaView');if(['week','day'].includes(saved))agendaMode=saved;}catch{}
  const currentAgendaMode=()=>agendaMode||(agendaMedia.matches?'day':'week');
  agendaMedia.addEventListener('change',()=>{if(!agendaMode&&owner&&active==='week'&&state?.user&&!$('#page-planner')?.hidden)paint();});
  function reset(user) {
    const identity = [user.id,user.studentId,user.schoolName].join(':'); if (owner === identity) return;
    agendaUI.reset(); owner = identity; active = 'week'; weekDay=null; weekDate = clamp(today()); bagDate = shift(today(), 1); data = {}; error = ''; loading = false; serial++; editingKit = 'daily'; inviteURL = ''; selectedFriends = [];
  }
  function dateField(id, label, value) {
    return `<label class="organizer-date" for="${id}"><span>${label}</span><input id="${id}" type="date" value="${escape(value)}" min="${escape(state.schoolYear.start)}" max="${escape(id === 'bag-date' ? shift(state.schoolYear.end, 7) : state.schoolYear.end)}"></label>`;
  }
  function render(user) {
    reset(user);
    return `<span id="organizer-tab-${active}" class="sr-only">${tabs.find(([id])=>id===active)?.[2]||''}</span><div class="organizer-panel" id="organizer-panel" role="region" aria-busy="${loading}" aria-labelledby="organizer-tab-${active}">${error ? `<p class="notice" role="alert">${escape(error)}</p>` : ''}${loading && data[active] ? `<div class="organizer-refresh">${motion.loader('Mise à jour…', true)}</div>` : ''}${loading && !data[active] ? motion.skeleton(active === 'week' ? 'week' : 'rows') : personal.tabs.includes(active)?personal.render(active): active === 'week' ? week() : active === 'bag' ? bag() : active === 'study' ? study() : active === 'friends' ? friends() : application()}</div>`;
  }
  function paint() { const root = $('#extras-root'); if (root && state?.user && [state.user.id,state.user.studentId,state.user.schoolName].join(':') === owner) { if(personal.tabs.includes(active)&&personal.isEditing()&&root.querySelector('#personal-panel')){root.querySelector('#organizer-panel')?.setAttribute('aria-busy',String(loading));return;} const previous = Number(root.querySelector('[data-progress-value]')?.dataset.progressValue || 0); root.innerHTML = render(state.user); PasserelleAgenda.place(root); if(agendaTransition){const panel=root.querySelector('.agenda-presentation');if(panel)panel.dataset.agendaTransition=agendaTransition;agendaTransition='';} motion.progress(root, previous); installation.refresh(); if (animatePanel && !loading) { animatePanel = false; motion.scene($('#organizer-panel')); } } }
  function week() {
    const view=data.week,mode=currentAgendaMode(),isDay=mode==='day';
    const selected=view?.days.find(day=>day.date===weekDay)?.date||view?.days.find(day=>day.date===weekDate)?.date||view?.days.find(day=>day.date===today())?.date||view?.days[0]?.date||weekDate;
    const selectedDate=new Date(selected+'T12:00:00Z');
    const title=isDay?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'numeric',month:'long'}).format(selectedDate):PasserelleAgenda.period(view?.start,view?.end).replace(/ \d{4}/g,'');
    const firstYear=view?.start?.slice(0,4)||selected.slice(0,4),lastYear=view?.end?.slice(0,4)||firstYear;
    const subtitle=isDay?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long'}).format(selectedDate)+' · '+selected.slice(0,4):'Semaine · '+firstYear+(lastYear!==firstYear?'–'+lastYear:'');
    const previousDisabled=loading||!view||(isDay?selected<=state.schoolYear.start:view.start<=state.schoolYear.start);
    const nextDisabled=loading||!view||(isDay?selected>=state.schoolYear.end:view.end>=state.schoolYear.end);
    return `<div class="agenda-toolbar organizer-heading"><h2>Mon agenda</h2><div class="agenda-toolbar-actions"><div class="agenda-mode" role="group" aria-label="Affichage de l’agenda">${[['week','Semaine'],['day','Journée']].map(([value,label])=>`<button type="button" data-extra="agenda-mode" data-mode="${value}" aria-pressed="${mode===value}">${label}</button>`).join('')}</div><button type="button" class="icon-button agenda-refresh" data-action="sync" aria-label="Actualiser l’agenda" ${!state.user.skolengoConnected||state.user.syncing?'disabled':''}>${icon('sync')}</button></div></div><div class="agenda-datebar" role="group" aria-label="Parcourir l’agenda"><button type="button" class="icon-button agenda-previous" data-extra="week-prev" aria-label="${isDay?'Jour précédent':'Semaine précédente'}" ${previousDisabled?'disabled':''}>${icon('arrow')}</button><label class="agenda-date-picker" for="week-date"><span class="agenda-date-caption" aria-hidden="true"><strong>${escape(title)}</strong><small>${escape(subtitle)}</small></span>${icon('calendar')}<span class="sr-only">Choisir une date</span><input id="week-date" type="date" value="${escape(selected)}" min="${escape(state.schoolYear.start)}" max="${escape(state.schoolYear.end)}"></label><button type="button" class="icon-button" data-extra="week-next" aria-label="${isDay?'Jour suivant':'Semaine suivante'}" ${nextDisabled?'disabled':''}>${icon('arrow')}</button><button type="button" class="button secondary agenda-today" data-extra="week-today" ${loading?'disabled':''}>Aujourd’hui</button></div>${view?.warning?`<p class="notice info">${escape(view.warning)}</p>`:''}${view?.personalCalendarWarning?`<p class="notice info">${escape(view.personalCalendarWarning)}</p>`:''}${PasserelleAgenda.render(view,{mode,selectedDay:selected,today:today(),changes:hub.agendaChanges()})}<p class="agenda-freshness">${view?.lastSync?'Dernière récupération : '+escape(dateTime(view.lastSync))+'.':''}</p>`;
  }
  function bag() {
    const view = data.bag;
    if (!view) return '<p class="empty-copy">Chargement du sac…</p>';
    const done = view.items.filter(item => item.checked).length, subjects = [{ key: 'daily', label: 'Toujours dans mon sac', emoji: '🎒' }, ...view.subjects];
    if (!subjects.some(s => s.key === editingKit)) editingKit = 'daily';
    return `<div class="organizer-heading"><div><p class="eyebrow">UN OUBLI EN MOINS</p><h2>Mon sac pour ${escape(dayLabel(view.date, true))}</h2></div>${dateField('bag-date', 'Préparer le sac du', bagDate)}</div><div class="bag-layout"><section class="card bag-checklist"><div class="section-heading"><h3>À emporter</h3><span class="badge ${done && done === view.items.length ? 'connected' : ''}">${done} / ${view.items.length} prêt${done > 1 ? 's' : ''}</span></div>${view.items.length ? `<progress class="sr-only" max="${view.items.length}" value="${done}" aria-label="Préparation du sac"></progress><svg class="bag-progress" viewBox="0 0 100 2" preserveAspectRatio="none" aria-hidden="true"><path class="bag-progress-track" d="M0 1h100"/><path class="bag-progress-fill" d="M0 1h100" pathLength="100" stroke-dasharray="100" stroke-dashoffset="${100 - Math.round(done / view.items.length * 100)}" data-progress-value="${Math.round(done / view.items.length * 100)}"/></svg><ul>${view.items.map(item => `<li><label class="bag-item ${item.checked ? 'is-done' : ''}"><input type="checkbox" data-bag-item="${escape(item.id)}" ${item.checked ? 'checked' : ''} ${loading ? 'disabled' : ''}><span><strong>${escape(item.label)}</strong><small>${item.subject ? escape(item.subject.emoji + ' ' + item.subject.label) : 'Tous les jours'}</small></span></label></li>`).join('')}</ul>` : '<p class="empty-copy">Ajoutez d’abord votre matériel dans la liste ci-contre. Le sac reprendra automatiquement les matières des cours de cette date.</p>'}${!view.hasCourses ? '<p class="small muted">Aucun cours publié pour cette date. Votre liste générale reste disponible.</p>' : ''}</section><section class="card bag-editor"><h3>Mon matériel par matière</h3><p>Préparez cette liste une fois. Les objets seront proposés les jours où vous avez cette matière.</p><form id="bag-kit-form"><div class="field"><label for="bag-subject">Liste à personnaliser</label><select id="bag-subject" name="subjectKey">${subjects.map(subject => `<option value="${escape(subject.key)}" ${subject.key === editingKit ? 'selected' : ''}>${escape(subject.emoji + ' ' + subject.label)}</option>`).join('')}</select></div><div class="field"><label for="bag-material">Matériel · un objet par ligne</label><textarea id="bag-material" name="items" rows="6" placeholder="Cahier de cours\nCalculatrice\nLivre">${escape((view.kit[editingKit] || []).map(item => item.label).join('\n'))}</textarea></div><button class="button" type="submit">Enregistrer ma liste</button></form><p class="small muted">Les cases cochées sont propres à chaque date et restent privées.</p></section></div>`;
  }
  function study() {
    const view = data.study;
    if (!view) return '<p class="empty-copy">Chargement des révisions…</p>';
    const sessions = [...view.sessions].sort((a, b) => a.day.localeCompare(b.day)), upcoming = sessions.filter(s => !s.done), done = sessions.filter(s => s.done);
    return `<div class="organizer-heading"><div><p class="eyebrow">UN PEU CHAQUE JOUR</p><h2>Mes révisions</h2><p>Répartissez votre préparation avant un contrôle et suivez les séances terminées.</p></div><button class="text-button" data-extra="go-work">Ajouter un contrôle personnel →</button></div><div class="study-layout"><section class="card study-planner"><h3>Préparer un contrôle</h3>${!view.exams.length ? '<p class="notice info">Aucun contrôle à venir dans votre espace. Vous pouvez en ajouter dans Devoirs & contrôles.</p>' : ''}<form id="study-plan-form"><div class="field"><label for="study-exam">Contrôle à préparer</label><select id="study-exam" name="examId" ${view.exams.length ? '' : 'disabled'}>${view.exams.map(exam => `<option value="${escape(exam.id)}">${escape(exam.subject.emoji + ' ' + exam.title + ' · ' + dayLabel(exam.due, true) + (exam.source === 'skolengo' && exam.detectedExam ? ' · repéré dans l’ENT' : ''))}</option>`).join('')}</select></div><div class="field"><label for="study-total">Temps total à prévoir · minutes</label><input id="study-total" type="number" name="totalMinutes" min="15" max="600" step="5" value="90" required></div><div class="field"><label for="study-size">Durée d’une séance</label><select id="study-size" name="sessionMinutes">${[15, 25, 30, 45, 60].map(value => `<option value="${value}" ${value === 25 ? 'selected' : ''}>${value} minutes</option>`).join('')}</select></div><button class="button" type="submit" ${view.exams.length ? '' : 'disabled'}>Planifier mes révisions</button></form><p class="small muted">Les contrôles repérés dans les consignes restent à vérifier avec votre enseignant. Les séances sont proposées entre 8 h et 21 h, en dehors des cours, des rendez-vous confirmés et des calendriers personnels ajoutés, jusqu’à deux heures par jour. Vérifiez les disponibilités qui ne sont pas encore dans Passerelle. Replanifier remplace ses séances à faire et conserve les séances déjà réalisées.</p></section><section class="card study-sessions"><div class="section-heading"><h3>Mes prochaines séances</h3><span class="badge">${upcoming.reduce((sum, session) => sum + session.minutes, 0)} min à prévoir</span></div>${studyRows(upcoming)}${done.length ? `<details class="study-completed"><summary>${done.length} séance${done.length > 1 ? 's' : ''} terminée${done.length > 1 ? 's' : ''}</summary>${studyRows(done)}</details>` : ''}</section></div>`;
  }
  function studyRows(sessions) {
    return sessions.length ? `<ul class="study-list">${sessions.map(session => `<li class="${session.done ? 'is-done' : ''}"><div><time>${escape(dayLabel(session.day, true))}${session.start?' · '+escape(time(session.start))+'–'+escape(time(session.end)):''}</time><span>${session.minutes} min</span></div><strong>${escape(session.title)}</strong><p>${escape(session.subjectLabel)}</p><div class="study-actions"><button class="button secondary" data-extra="study-done" data-id="${escape(session.id)}">${session.done ? 'Remettre à faire' : '✓ Séance terminée'}</button><button class="text-button danger" data-extra="study-remove" data-id="${escape(session.id)}">Retirer</button></div></li>`).join('')}</ul>` : '<p class="empty-copy">Aucune séance à faire. Choisissez un contrôle pour préparer votre planning.</p>';
  }
  function friends() {
    const view = data.friends;
    if (!view) return '<p class="empty-copy">Chargement des partages…</p>';
    const people = view.friends;
    return `<div class="organizer-heading"><div><p class="eyebrow">TRAVAILLER ENSEMBLE</p><h2>Trouver un créneau entre amis</h2><p>Partagez vos disponibilités avec les personnes de votre choix.</p></div></div>${friendToken ? `<section class="card friend-invitation"><h3>${view.invitation ? escape(view.invitation.name) + ' vous propose un partage' : 'Invitation à vérifier'}</h3><p>En acceptant, vous pourrez chercher des créneaux libres communs. Les matières, salles, devoirs et liens ICS restent privés.</p><button class="button" data-extra="accept-friend" ${view.invitation ? '' : 'disabled'}>Accepter le partage réciproque</button><button class="text-button" data-extra="decline-friend">Ignorer cette invitation</button></section>` : ''}<div class="friend-layout"><section class="card"><h3>Mes partages</h3>${people.length ? `<ul class="friend-list">${people.map(friend => `<li><span>${icon('users')}<strong>${escape(friend.name)}</strong></span><button class="text-button danger" data-extra="remove-friend" data-id="${escape(friend.id)}">Arrêter le partage</button></li>`).join('')}</ul>` : '<p class="empty-copy">Aucun partage pour le moment. Créez un lien et transmettez-le à votre ami.</p>'}<form id="friend-invite-form"><label class="check-label"><input name="consent" type="checkbox" required>J’accepte de partager mes créneaux libres avec la personne qui acceptera mon lien.</label><button class="button secondary" type="submit">Créer un lien de partage</button></form>${inviteURL ? `<div class="friend-link"><label for="friend-url">Lien personnel · valable 7 jours, une seule utilisation</label><div class="copy-row"><input id="friend-url" value="${escape(inviteURL)}" readonly><button class="button secondary" data-extra="copy-friend" aria-label="Copier le lien de partage">${icon('copy')}</button></div></div>` : ''}<button class="text-button" data-extra="revoke-friend-invites">Révoquer mes invitations non utilisées</button><p class="small muted">Votre ami doit disposer d’un compte sur ce portail. Chacun peut arrêter le partage à tout moment.</p></section><section class="card"><h3>Chercher nos disponibilités</h3><form id="availability-form"><fieldset class="friend-choices"><legend>Avec qui ?</legend>${people.map(friend => `<label class="check-label"><input name="friends" type="checkbox" value="${escape(friend.id)}" ${selectedFriends.includes(friend.id) ? 'checked' : ''}>${escape(friend.name)}</label>`).join('') || '<p class="small muted">Un partage accepté est nécessaire pour chercher un créneau.</p>'}</fieldset><div class="field"><label for="friends-date">Semaine contenant le</label><input id="friends-date" name="date" type="date" value="${escape(weekDate)}" min="${escape(state.schoolYear.start)}" max="${escape(state.schoolYear.end)}" required></div><div class="availability-fields"><div class="field"><label for="friends-start">À partir de</label><input id="friends-start" name="start" type="time" value="08:00" required></div><div class="field"><label for="friends-end">Jusqu’à</label><input id="friends-end" name="end" type="time" value="20:00" required></div></div><div class="field"><label for="friends-duration">Durée minimum</label><select id="friends-duration" name="duration">${[30, 45, 60, 90, 120, 180].map(value => `<option value="${value}" ${value === 60 ? 'selected' : ''}>${value} minutes</option>`).join('')}</select></div><button class="button" type="submit" ${people.length ? '' : 'disabled'}>Chercher un créneau commun</button></form><p class="small muted">Horaires de Paris, calculés sur les cours publiés. Vérifiez vos autres engagements avant de vous organiser. Si un agenda est trop ancien ou indisponible, aucun créneau libre n’est affirmé.</p></section></div>${data.availability ? `<section class="card availability-results"><h3>Nos créneaux communs</h3><div>${data.availability.days.map(day => `<article><h4>${escape(dayLabel(day.date))}</h4>${!day.complete ? `<p class="small muted">Agenda à actualiser : ${escape(day.unavailable.join(', '))}.</p>` : day.slots.length ? `<ul>${day.slots.map(slot => `<li>${minutes(slot.start)}–${minutes(slot.end)}</li>`).join('')}</ul>` : '<p class="small muted">Aucun créneau commun assez long sur cette plage.</p>'}</article>`).join('')}</div></section>` : ''}`;
  }
  function selectDay(date,direction=''){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<state.schoolYear.start||date>state.schoolYear.end)return;
    weekDay=date;weekDate=date;agendaMode='day';agendaTransition=direction;try{localStorage.setItem('passerelle.agendaView','day');}catch{}
    if(!data.week?.days.some(day=>day.date===date)){void load().then(()=>document.querySelector(`[data-extra="agenda-day"][data-date="${date}"]`)?.focus({preventScroll:true}));}else paint();
    document.querySelector(`[data-extra="agenda-day"][data-date="${date}"]`)?.focus({preventScroll:true});
  }
  agendaUI.configure({getView:()=>data.week,identity:()=>owner,changes:()=>hub.agendaChanges(),selectDay,reload:load});
  document.addEventListener('passerelle:agenda-changes',()=>{if(owner&&state?.user&&active==='week'&&!$('#page-planner')?.hidden&&!loading)paint();});
  function application() {
    return `<div class="organizer-heading"><div><p class="eyebrow">VOTRE ESPACE VOUS SUIT</p><h2>Passerelle sur mes appareils</h2></div></div><div class="application-grid"><section class="card"><h3>Installer Passerelle</h3><p>Retrouvez votre espace sur l’écran d’accueil et ouvrez-le dans sa propre fenêtre.</p><button class="button" type="button" data-install-app>Installer Passerelle</button><p class="small muted">Selon votre navigateur, l’installation se fait depuis ce bouton ou depuis son menu. Une connexion Internet reste nécessaire pour consulter vos informations à jour.</p></section><section class="card"><h3>Mon thème</h3><p>Choisissez une apparence, ou suivez automatiquement celle de votre appareil.</p><label for="app-theme">Thème d’affichage</label><select id="app-theme" data-theme-choice>${[['system', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([value, title]) => `<option value="${value}" ${appearance.get() === value ? 'selected' : ''}>${title}</option>`).join('')}</select><p class="small muted">Ce choix est mémorisé sur cet appareil.</p><button class="text-button" data-extra="go-email">Gérer mes notifications →</button><div class="motion-access"><button class="text-button" type="button" data-motion-preview aria-haspopup="dialog" aria-controls="motion-preview">${icon('activity')} Aperçu des animations</button><p>Chargement, transitions et confirmations. Le réglage de mouvement réduit de votre appareil est respecté.</p></div></section></div>`;
  }
  async function load() {
    if (!state?.user || $('#page-planner')?.hidden) return;
    const request = ++serial, userId = state.user.id, scope = owner, tab = active; loading = true; error = ''; paint();
    try {
      let result;
      if(personal.tabs.includes(tab)){await personal.load();result={loaded:true};}
      if (tab === 'week') result = await api('week?date=' + encodeURIComponent(weekDate));
      if (tab === 'bag') result = await api('bag?date=' + encodeURIComponent(bagDate));
      if (tab === 'study') result = await api('study');
      if (tab === 'friends') {
        result = await api('friends');
        if (selectedFriends.some(id => !result.friends.some(friend => friend.id === id))) { data.availability = null; selectedFriends = []; }
        if (friendToken) { try { result.invitation = await api('friends/preview', { token: friendToken }); } catch (failure) { error = failure.message; } }
      }
      if (request !== serial || owner !== scope || state.user?.id !== userId) return;
      if (result) data[tab] = result;
    } catch (failure) { if (request === serial) error = failure.message; }
    finally { if (request === serial && state.user?.id === userId) { loading = false; paint(); portal.settlePosition(); } }
  }
  function activate(tab = 'week') { if (!tabs.some(([id]) => id === tab)) return; if(active!==tab)personal.leaveEditor(); active = tab; animatePanel = true; portal.navigate('planner'); window.scrollTo({ top: 0 }); }
  function clearInvitation() { friendToken = null; try { sessionStorage.removeItem('passerelle.friendInvite'); } catch { /* Optional persistence. */ } }
  function onUser(user) {
    reset(user);
    if (friendToken && offered !== user.id + friendToken) { offered = user.id + friendToken; activate('friends'); }
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-extra]'); if (!button || button.disabled) return;
    const action = button.dataset.extra;
    if (action === 'open' || action === 'tab') { activate(button.dataset.tab); return; }
    if(action==='agenda-mode') {const mode=button.dataset.mode;if(!['week','day'].includes(mode))return;agendaMode=mode;try{localStorage.setItem('passerelle.agendaView',mode);}catch{}paint();document.querySelector(`[data-extra="agenda-mode"][data-mode="${mode}"]`)?.focus({preventScroll:true});return;}
    if(action==='agenda-day') {selectDay(button.dataset.date);return;}
    if (['week-prev', 'week-next', 'week-today'].includes(action)) {
      const mode=currentAgendaMode(),selected=$('#week-date')?.value||weekDay||weekDate,delta=(action==='week-next'?1:-1)*(mode==='day'?1:7);
      const target=clamp(action==='week-today'?today():shift(selected,delta));
      if(mode==='day'){selectDay(target,action==='week-today'?'':delta>0?'next':'previous');return;}
      weekDay=target;weekDate=target;
      if(data.week?.days.some(day=>day.date===target))paint();else void load();
      return;
    }
    if (action === 'go-email') { features.openNotifications('email'); return; }
    if (action === 'go-work') { features.open('work');window.scrollTo({top:0}); return; }
    void act(button, async () => {
      if (action === 'study-done') { const session = data.study.sessions.find(item => item.id === button.dataset.id); await api('study/' + session.id, { done: !session.done }); await motion.finish(button.closest('li')); await load(); }
      if (action === 'study-remove') { await api('study/' + button.dataset.id + '/remove', {}); await load(); }
      if (action === 'copy-friend') { try { await navigator.clipboard.writeText(inviteURL); toast('Lien de partage copié.'); } catch { $('#friend-url').select(); toast('Sélectionnez puis copiez le lien.'); } }
      if (action === 'accept-friend') { await api('friends/accept', { token: friendToken, shareAvailability: true }); clearInvitation(); await load(); toast('Le partage réciproque est activé.'); }
      if (action === 'decline-friend') { clearInvitation(); await load(); }
      if (action === 'remove-friend') { await api('friends/' + button.dataset.id + '/remove', {}); data.availability = null; selectedFriends = selectedFriends.filter(id => id !== button.dataset.id); await load(); toast('Le partage est arrêté pour vous deux.'); }
      if (action === 'revoke-friend-invites') { await api('friends/invites/revoke', {}); inviteURL = ''; paint(); toast('Vos invitations non utilisées sont révoquées.'); }
    });
  });
  document.addEventListener('change', event => {
    const input = event.target;
    if (input.id === 'week-date') { if (!input.value) { input.value = weekDate; return; } weekDate = input.value; weekDay=input.value; void load(); }
    if (input.id === 'bag-date') { if (!input.value) { input.value = bagDate; return; } bagDate = input.value; void load(); }
    if (input.id === 'bag-subject') { editingKit = input.value; paint(); }
    if (input.matches('[data-bag-item]')) { const id = input.dataset.bagItem, checked = input.checked; input.disabled = true; void api('bag/check', { date: bagDate, id, checked }).then(load).catch(failure => { input.disabled = false; input.checked = !checked; toast(failure.message, true); }); }
  });
  document.addEventListener('submit', event => {
    const form = event.target;
    if (!['bag-kit-form', 'study-plan-form', 'friend-invite-form', 'availability-form'].includes(form.id)) return;
    event.preventDefault(); const values = Object.fromEntries(new FormData(form));
    void act(form.querySelector('button[type=submit]'), async () => {
      if (form.id === 'bag-kit-form') { await api('bag/kit', { subjectKey: values.subjectKey, items: values.items.split(/\r?\n/) }); await load(); toast('Votre liste de matériel est enregistrée.'); }
      if (form.id === 'study-plan-form') { const result = await api('study/plan', values); await load(); if(result.warning){error=result.warning;paint();} toast(result.planned ? result.planned + ' séance(s) de révision planifiée(s).' : 'Votre objectif est déjà atteint avec les séances terminées.'); }
      if (form.id === 'friend-invite-form') { inviteURL = (await api('friends/invite', { shareAvailability: form.elements.consent.checked })).url; paint(); toast('Le lien est prêt à être transmis à votre ami.'); }
      if (form.id === 'availability-form') { selectedFriends = new FormData(form).getAll('friends'); data.availability = null; paint(); try { data.availability = await api('friends/availability?' + new URLSearchParams({ ...values, friends: selectedFriends.join(',') })); paint(); } catch (failure) { await load(); throw failure; } }
    });
  });
  function handleHash(params) {
    const token = params.get('friend'); if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
    friendToken = token; data.friends = null; offered = ''; try { sessionStorage.setItem('passerelle.friendInvite', token); } catch { /* Current visit still works. */ }
  }
  function open(tab){if(!tabs.some(([id])=>id===tab))return;active=tab;animatePanel=true;portal.navigate('planner');paint();void load();}
  return { clear:()=>{owner=null;serial++;data={};agendaUI.reset();},open,label:()=>tabs.find(([id])=>id===active)?.[2]||'Agenda',current: () => active, render, mount: load, onUser, handleHash };
})();
