/* Guidance is stored on the account; examples never create schoolwork. */
const onboardingPortal = (() => {
  const steps = ['connect', 'home', 'agenda', 'work', 'more', 'finish'];
  const pages = {connect:'calendar', home:'school', agenda:'planner', work:'work', more:'more', finish:'school'};
  let owner = null, epoch = 0, value = null, busy = false, restored = false, welcomeSeen = false, feedback = '', feedbackError = false, painted = '', queue = Promise.resolve();
  const active = () => value?.status === 'active';
  const step = () => steps.includes(value?.step) ? value.step : 'connect';
  const dialog = () => document.querySelector('#onboarding-dialog');
  const same = (id, generation) => owner === id && state?.user?.id === id && epoch === generation;
  const button = (action, label, primary = false) => `<button type="button" class="${primary?'button':'text-button'}" data-onboarding="${action}" ${busy?'disabled':''}>${label}</button>`;

  function copy() {
    const u=state.user, connected=u.skolengoConnected&&!u.skolengoError;
    const available=connected&&u.feedURL;
    const content={
      connect:{title:'Connecter mon lycée',body:available?'Votre ENT est connecté. Les cours publiés par votre lycée peuvent maintenant apparaître dans Passerelle.':connected?'Votre ENT est connecté. Récupérez maintenant les cours publiés par votre lycée.':'Votre compte Passerelle est créé. Connectez votre ENT pour retrouver les informations publiées par votre lycée.',task:available?'Les mises à jour suivent les informations disponibles dans votre établissement.':'Recherchez votre lycée, puis utilisez vos identifiants habituels dans la fenêtre ENT.',action:available?'next':'connect',label:available?'Continuer':connected?'Afficher mes cours':'Connecter mon ENT'},
      home:{title:'Votre journée commence ici',body:'L’accueil réunit les cours et les priorités. Après la dernière classe, il vous aide à préparer demain.',task:'Essayez de passer d’aujourd’hui à demain. Un jour vide peut simplement ne contenir aucun cours publié.',action:'next',label:'Voir mon agenda',tryAction:'try-day',tryLabel:'Essayer Aujourd’hui / Demain'},
      agenda:{title:'Votre semaine, au même endroit',body:'Dans Agenda, retrouvez les horaires, les salles et les annulations publiées. Les flèches permettent de changer de semaine.',task:'Vous pouvez avancer d’une semaine, puis revenir avec « Cette semaine ».',action:'next',label:'Découvrir les devoirs',tryAction:'try-week',tryLabel:'Voir la semaine suivante'},
      work:{title:'Vos devoirs et vos contrôles',body:'Retrouvez le travail publié par votre établissement et vos ajouts personnels. « Marquer fait » sert à suivre votre travail dans Passerelle.',task:'Ouvrez le formulaire d’ajout pour repérer la date, la matière et le titre. Rien n’est ajouté tant que vous ne validez pas.',action:'next',label:'Continuer',tryAction:'try-work',tryLabel:'Ouvrir l’ajout d’un devoir'},
      more:{title:'Les autres outils sont dans Plus',body:'Ma soirée aide à choisir les priorités. Retrouvez aussi les rappels, les documents favoris et vos réglages dans Plus.',task:'En cas de difficulté, « Aide et contact » permet de demander de l’aide. Le guide reste accessible ici.',action:'next',label:'Les dernières astuces',tryAction:'try-evening',tryLabel:'Découvrir Ma soirée'},
      finish:{title:'Vous avez vos premiers repères',body:'Accueil pour préparer la journée, Agenda pour la semaine, Devoirs pour le travail et Plus pour les autres outils.',task:'Vous pouvez installer l’app et choisir vos notifications maintenant, ou le faire plus tard dans les réglages.',action:'complete',label:'J’ai mes repères'}
    };
    return content[step()];
  }

  function clearTargets() { document.querySelectorAll('.onboarding-target').forEach(el=>el.classList.remove('onboarding-target')); }
  function highlight() {
    clearTargets();
    if(!active())return;
    const current=step(), primary=current==='connect'||current==='more'||current==='finish'?'more':current==='home'?'school':current==='agenda'?'planner':'work';
    document.querySelector(`nav[aria-label="Navigation principale"] [data-page="${primary}"]`)?.classList.add('onboarding-target');
  }

  function paint(force=false) {
    if(!state?.user||owner!==state.user.id)return;
    let coach=document.querySelector('#onboarding-coach');
    if(!coach){coach=document.createElement('section');coach.id='onboarding-coach';coach.className='onboarding-coach';coach.setAttribute('aria-labelledby','onboarding-coach-title');document.querySelector('#portal-main')?.prepend(coach);painted='';}
    coach.hidden=!active();
    const current=step(),data=copy(),key=JSON.stringify([value,current,state.user.skolengoConnected,state.user.skolengoError,!!state.user.feedURL,state.user.syncing,busy,feedback,feedbackError]);
    if(active()&&(force||key!==painted)){
      const focused=coach.contains(document.activeElement)?document.activeElement:null;
      const focusedAction=focused?.dataset.onboarding,focusedTitle=focused?.id==='onboarding-coach-title';
      painted=key;coach.dataset.step=current;
      coach.innerHTML=`<div class="onboarding-coach-head"><span class="onboarding-step">Prise en main · ${steps.indexOf(current)+1} / ${steps.length}</span><button type="button" class="onboarding-close" data-onboarding="pause" aria-label="Mettre le guide en pause" ${busy?'disabled':''}>${icon('close')}</button></div><ol class="onboarding-dots" aria-label="Progression du guide">${steps.map((s,i)=>`<li data-state="${i<steps.indexOf(current)?'done':s===current?'current':'future'}" ${s===current?'aria-current="step"':''}><span class="sr-only">${i+1}. ${{connect:'Connexion',home:'Accueil',agenda:'Agenda',work:'Devoirs',more:'Outils',finish:'Dernières astuces'}[s]}</span></li>`).join('')}</ol><h2 id="onboarding-coach-title" tabindex="-1">${data.title}</h2><p class="onboarding-copy">${data.body}</p><div class="onboarding-task"><p>${data.task}</p>${data.tryAction?button(data.tryAction,data.tryLabel):''}</div><p class="onboarding-feedback" role="${feedbackError?'alert':'status'}" ${!feedback?'hidden':''}>${escape(feedback)}</p><div class="onboarding-coach-actions">${button(data.action,data.label,true)}${current==='connect'&&!state.user.syncing?button('explore','Découvrir l’app d’abord'):''}${current==='finish'?button('install','Installer sur mon téléphone')+button('notifications','Choisir mes notifications'):''}${steps.indexOf(current)>0?`<button type="button" class="text-button onboarding-back" data-onboarding="back" ${busy?'disabled':''}>Retour</button>`:''}</div>`;
      if(focusedAction)coach.querySelector(`[data-onboarding="${CSS.escape(focusedAction)}"]`)?.focus({preventScroll:true});
      else if(focusedTitle)coach.querySelector('#onboarding-coach-title')?.focus({preventScroll:true});
    }
    const setup=document.querySelector('.simple-setup');if(setup)setup.hidden=active();
    if(value?.status!=='paused')document.querySelector('.onboarding-resume')?.remove();
    if(value?.status==='paused'&&document.querySelector('#page-school')&&!document.querySelector('.onboarding-resume')){
      const resume=document.createElement('aside');resume.className='onboarding-resume';resume.setAttribute('aria-label','Reprendre la prise en main');
      resume.innerHTML=`${icon('study')}<span>Le guide vous attend là où vous l’avez laissé.</span>${button('resume','Reprendre le guide')}`;
      document.querySelector('#page-school').prepend(resume);
    }
    highlight();
  }

  function welcome() {
    if(!owner||state?.user?.id!==owner||dialog()?.open||busy)return;
    const el=dialog();if(!el)return;
    const resume=value?.status==='paused'||active();
    el.innerHTML=`<div class="onboarding-welcome-mark"><img src="./brand/symbol.png" width="44" height="44" alt=""></div><p class="onboarding-eyebrow">PRENONS NOS REPÈRES</p><h2 id="onboarding-title">Bienvenue sur Passerelle</h2><p id="onboarding-description">Un petit tour pour savoir où aller et quoi faire. Vous pouvez le mettre en pause à tout moment.</p><ul class="onboarding-intro-list"><li>${icon('calendar')}<span><strong>Votre lycée, puis vos cours</strong><small>Connectez votre ENT et découvrez votre agenda.</small></span></li><li>${icon('book')}<span><strong>Le travail à préparer</strong><small>Repérez vos devoirs et essayez les actions utiles.</small></span></li><li>${icon('sun')}<span><strong>À votre rythme</strong><small>Reprenez le guide depuis Plus quand vous voulez.</small></span></li></ul><p class="onboarding-feedback" id="onboarding-welcome-error" role="alert" hidden></p><div class="onboarding-welcome-actions">${button('start',resume?'Reprendre la visite':'Me guider',true)}${button('later','Plus tard')}</div>`;
    welcomeSeen=true;el.showModal();
  }

  function go(current=step()) {
    const app=document.querySelector('#app');
    if(app?.dataset.page===pages[current]&&(current!=='agenda'||app.dataset.tool==='week'))return;
    if(current==='agenda')extras.open('week');else portal.navigate(pages[current]||'school');
  }
  function focusCoach() {
    if(document.querySelector('dialog[open]'))return;
    const heading=document.querySelector('#onboarding-coach-title');
    heading?.focus({preventScroll:true});
    document.querySelector('#onboarding-coach')?.scrollIntoView({block:'start',behavior:'instant'});
  }

  function save(action, nextStep) {
    const id=owner,generation=epoch;
    const pending=queue.catch(()=>{}).then(async()=>{
      if(!same(id,generation))return false;
      busy=true;document.querySelectorAll('[data-onboarding]').forEach(el=>{el.disabled=true;});
      try {
        const result=await api('onboarding',{action,...(nextStep?{step:nextStep}:{})});
        if(!same(id,generation))return false;
        value=result.onboarding;state.user.onboarding=value;feedback='';feedbackError=false;
        return true;
      }catch(error){
        if(same(id,generation)){
          feedback=error.message;feedbackError=true;
          const target=document.querySelector('#onboarding-welcome-error');if(target&&dialog().open){target.textContent=error.message;target.hidden=false;}
        }
        return false;
      }finally{
        if(same(id,generation)){busy=false;paint();document.querySelectorAll('[data-onboarding]').forEach(el=>{el.disabled=false;});}
      }
    });
    queue=pending;return pending;
  }

  async function move(current) {
    if(await save('step',current)){go(current);paint();focusCoach();}
  }
  async function start() {
    if(!await save('start'))return;
    dialog()?.close();
    if(value.step==='welcome'){await move('connect');return;}
    go();paint();focusCoach();
  }
  async function pause() {
    const hadCoachFocus=!!document.querySelector('#onboarding-coach')?.contains(document.activeElement);
    if(!await save('pause'))return;
    dialog()?.close();paint();
    if(hadCoachFocus)document.querySelector('#portal-main')?.focus({preventScroll:true});
  }
  function report(message) {feedback=message;feedbackError=false;paint();}

  async function attempt(action) {
    if(action==='connect'){
      go('connect');paint();
      if(state.user.syncing){report('La récupération est en cours. Vous pouvez attendre ici ou reprendre le guide plus tard.');return;}
      if(state.user.skolengoConnected&&!state.user.skolengoError){
        const control=document.querySelector('#page-calendar [data-action="create-feed"]');control?.click();
      }else{
        const search=document.querySelector('#school-search');if(search?.hidden)document.querySelector('#page-calendar [data-action="school-search"]')?.click();
        document.querySelector('#school-form input')?.focus();
      }
      return;
    }
    if(action==='try-day'){
      go('home');
      const target=document.querySelector('#home-programme [data-home-day][aria-pressed="false"]');
      if(target){target.click();report('Le jour affiché a changé. Vous pouvez refaire ce geste quand vous en avez besoin.');}
      else report('Connectez votre ENT pour voir les journées publiées. Vous pouvez continuer la visite.');
    }
    if(action==='try-week'){
      go('agenda');
      const id=owner,generation=epoch;
      let target=document.querySelector('[data-extra="week-next"]');
      for(let attempt=0;target?.disabled&&attempt<60;attempt++){
        await new Promise(resolve=>setTimeout(resolve,100));
        if(!same(id,generation)||!active()||step()!=='agenda'||document.querySelector('#app')?.dataset.tool!=='week')return;
        target=document.querySelector('[data-extra="week-next"]');
      }
      if(target&&!target.disabled){target.click();report('La semaine suivante s’affiche. « Cette semaine » permet de revenir.');}
      else report('Utilisez les flèches de l’agenda quand son chargement est terminé.');
    }
    if(action==='try-work'){
      go('work');const details=document.querySelector('#page-work .manual-work');
      if(details){details.open=true;document.querySelector('#work-kind')?.focus();details.scrollIntoView({block:'start',behavior:'instant'});report('Formulaire ouvert. Vous pouvez continuer sans le remplir.');}
    }
    if(action==='try-evening'){extras.open('evening');report('Ma soirée est ouverte. Les durées sont des estimations que vous pouvez ajuster.');}
    if(action==='install')document.querySelector('#install-help')?.showModal();
    if(action==='notifications')features.openNotifications('app');
  }

  document.addEventListener('click',event=>{
    const control=event.target.closest('[data-onboarding]');if(!control||control.disabled)return;
    const action=control.dataset.onboarding;
    if(action==='open'){welcome();return;}
    if(action==='start'||action==='resume'){void start();return;}
    if(action==='later'||action==='pause'){void pause();return;}
    if(action==='explore'){void move('home');return;}
    if(action==='next'){void move(steps[Math.min(steps.length-1,steps.indexOf(step())+1)]);return;}
    if(action==='back'){void move(steps[Math.max(0,steps.indexOf(step())-1)]);return;}
    if(action==='complete'){void save('complete').then(ok=>{if(ok){portal.navigate('school');paint();toast('Vous avez vos repères. Le guide reste disponible dans Plus.');}});return;}
    void attempt(action);
  });
  document.addEventListener('cancel',event=>{if(event.target===dialog()){event.preventDefault();if(!busy)void pause();}},true);
  document.addEventListener('keydown',event=>{
    const modal=dialog();if(event.key!=='Tab'||!modal?.open)return;
    const controls=[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);
    if(!controls.length){event.preventDefault();return;}
    const first=controls[0],last=controls.at(-1),focused=document.activeElement;
    if(event.shiftKey&&(focused===first||!modal.contains(focused))){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&(focused===last||!modal.contains(focused))){event.preventDefault();first.focus();}
  });

  function reset() {
    epoch++;owner=null;value=null;busy=false;restored=false;welcomeSeen=false;painted='';feedback='';feedbackError=false;
    if(dialog()){dialog().close();dialog().replaceChildren();}
    document.querySelector('#onboarding-coach')?.remove();document.querySelector('.onboarding-resume')?.remove();clearTargets();
  }
  function mount(user) {
    if(!user){reset();return;}
    if(owner!==user.id){reset();owner=user.id;}
    const previousStatus=value?.status;
    const incoming=user.onboarding||{status:'available',step:'welcome'};
    if(value?.updatedAt>incoming.updatedAt)user.onboarding=value;
    else value=incoming;
    paint();
    if(value.status==='completed'&&previousStatus!=='completed'&&dialog()?.open)dialog().close();
    if(active()&&!restored){restored=true;if(!location.hash||location.hash==='#signup')go();paint();}
    if(value.status==='new'&&!welcomeSeen){const id=owner,generation=epoch;queueMicrotask(()=>{if(same(id,generation)&&!document.querySelector('dialog[open]'))welcome();});}
  }
  function visit() {if(owner&&owner===state?.user?.id)paint();}
  function isInteracting() {return !!dialog()?.open||!!document.activeElement?.closest('[data-onboarding],#onboarding-coach,.onboarding-resume');}
  return {mount,reset,visit,isInteracting};
})();
