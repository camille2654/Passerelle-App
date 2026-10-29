/* Personal mail access is voluntary; provider credentials are never rendered. */
const personalMailPortal = (() => {
  const providers=['gmail','outlook'];
  const names={gmail:'Gmail',outlook:'Outlook'};
  let owner='',epoch=0,data=null,adminData=null,loading=false,busy=false,dirty=false,view='user',failure='',message='',loadedAt=0,returnFocus=null,pendingCallback=null,sequence=0;
  const dialog=()=>document.querySelector('#personal-mail-dialog');
  const content=()=>document.querySelector('#personal-mail-content');
  const same=(id,generation)=>owner===id&&state?.user?.id===id&&generation===epoch;
  const providerName=provider=>names[provider]||'Messagerie';
  const manage={gmail:'https://myaccount.google.com/connections',outlook:'https://account.live.com/consent/Manage'};

  function reset(){
    owner='';epoch++;data=null;adminData=null;loading=false;busy=false;dirty=false;view='user';failure='';message='';loadedAt=0;returnFocus=null;sequence++;
    dialog()?.close();content()?.replaceChildren();
  }
  function bind(user){if(owner!==user.id){reset();owner=user.id;}}
  async function call(route='',body,administration=false){
    const id=owner,generation=epoch;
    if(!same(id,generation)||administration&&!state.user.admin)throw new Error('Le compte a changé. Rechargez votre espace.');
    const result=await api((administration?'admin/personal-mail':'personal-mail')+(route?'/'+route:''),body===undefined?undefined:administration?body:{...body,accountId:id});
    if(!same(id,generation)||administration&&!state.user.admin||result.accountId&&result.accountId!==id)throw new Error('Le compte a changé. Rechargez votre espace.');
    return result;
  }
  function providerCard(value){
    const provider=value.provider,name=providerName(provider),connected=value.connected===true,canDisconnect=!!value.connectionId;
    return `<section class="mail-provider" data-mail-provider="${escape(provider)}"><header class="mail-provider-heading"><span class="mail-provider-mark" aria-hidden="true">${icon('mail')}</span><div><h3>${name}</h3><p>${connected?escape(value.address||'Boîte associée'):canDisconnect?'Accès à renouveler':value.ready?'À connecter':'Configuration de Passerelle requise'}</p></div><span class="badge ${connected&&value.ready?'connected':''}">${connected?'Associée':canDisconnect?'À reconnecter':value.ready?'Disponible':'À configurer'}</span></header>${value.warning?`<p class="notice info">${escape(value.warning)}</p>`:''}${!value.ready?'<p class="personal-mail-help">L’administrateur doit configurer cette connexion avant son utilisation.</p>':''}${connected?`<form class="personal-mail-preferences" data-provider="${escape(provider)}"><label for="mail-senders-${provider}">Expéditeurs à analyser<textarea id="mail-senders-${provider}" name="senders" rows="3" maxlength="2600" placeholder="direction@mon-lycee.fr&#10;orientation@mon-lycee.fr" spellcheck="false" autocapitalize="none" autocomplete="off">${escape((value.senders||[]).join('\n'))}</textarea></label><p class="personal-mail-help">Jusqu’à dix adresses précises, séparées par une virgule ou un retour à la ligne. Seuls leurs messages récents dans votre boîte de réception sont recherchés.</p><label class="check-label"><input type="checkbox" name="enabled" ${value.enabled?'checked':''}>J’autorise la lecture des messages de ces expéditeurs pour repérer des rendez-vous.</label><p class="personal-mail-help">La lecture conserve les messages non lus et ne permet aucun envoi. Les permissions présentées par ${provider==='gmail'?'Google':'Microsoft'} donnent techniquement accès à la lecture de votre boîte ; Passerelle applique votre sélection d’expéditeurs.</p><button type="submit" class="button secondary">Enregistrer ma sélection</button></form><div class="personal-mail-provider-actions"><button type="button" class="text-button" data-personal-mail="connect" data-provider="${provider}" ${value.ready?'':'disabled'}>Reconnecter ${name}</button><button type="button" class="text-button" data-personal-mail="disconnect" data-provider="${provider}">Déconnecter cette boîte</button></div>${value.lastScan?`<p class="personal-mail-help">Dernière lecture · ${escape(dateTime(value.lastScan))}</p>`:''}<p class="personal-mail-help"><a href="${manage[provider]}" target="_blank" rel="noopener noreferrer">Gérer aussi l’autorisation chez ${provider==='gmail'?'Google':'Microsoft'} ${icon('out')}</a></p>`:`<button type="button" class="button secondary" data-personal-mail="connect" data-provider="${provider}" ${value.ready?'':'disabled'}>${canDisconnect?'Reconnecter '+name:'Continuer avec '+(provider==='gmail'?'Google':'Microsoft')} ${icon('arrow')}</button>${canDisconnect?`<div class="personal-mail-provider-actions"><button type="button" class="text-button" data-personal-mail="disconnect" data-provider="${provider}">Déconnecter cette boîte</button></div><p class="personal-mail-help"><a href="${manage[provider]}" target="_blank" rel="noopener noreferrer">Gérer aussi l’autorisation chez ${provider==='gmail'?'Google':'Microsoft'} ${icon('out')}</a></p>`:''}`}</section>`;
  }
  function userView(){
    const values=Array.isArray(data?.providers)?data.providers.filter(value=>providers.includes(value.provider)):[];
    return `<p class="personal-mail-intro">Reliez votre messagerie personnelle, puis choisissez les expéditeurs utiles. Chaque date repérée reste à vérifier avant d’entrer dans votre agenda.</p>${!state.user.skolengoConnected?'<p class="notice info">Connectez aussi votre ENT pour utiliser ces propositions dans l’agenda de votre profil scolaire.</p>':''}<div class="personal-mail-providers">${values.map(providerCard).join('')}</div><div class="personal-mail-bottom"><button type="button" class="button secondary" data-personal-mail="events">Voir mes événements repérés ${icon('arrow')}</button>${state.user.admin?'<button type="button" class="text-button" data-personal-mail="admin">Configurer les connexions · Administration</button>':''}</div><p class="personal-mail-help">L’analyse des mails personnels se choisit aussi dans les sources des événements repérés. Les pièces jointes et les images ne sont pas analysées.</p>`;
  }
  function adminProvider(value){
    const provider=value.provider,name=providerName(provider);
    return `<section class="mail-provider personal-mail-admin-provider"><header class="mail-provider-heading"><span class="mail-provider-mark" aria-hidden="true">${icon('settings')}</span><div><h3>${name}</h3><p>${value.hasSecret?'Secret enregistré':'Identifiants d’application à renseigner'}</p></div></header><label for="mail-redirect-${provider}">Adresse de retour à déclarer<div class="personal-mail-copy"><input id="mail-redirect-${provider}" value="${escape(value.redirectURI||'')}" readonly><button type="button" class="button secondary" data-personal-mail="copy-redirect" data-provider="${provider}" aria-label="Copier l’adresse de retour ${name}">${icon('copy')}</button></div></label><form class="personal-mail-admin-form" data-provider="${provider}"><label for="mail-client-${provider}">Identifiant du client<input id="mail-client-${provider}" name="clientId" value="${escape(value.clientId||'')}" maxlength="300" autocomplete="off" spellcheck="false" required></label><label for="mail-secret-${provider}">Secret du client<input id="mail-secret-${provider}" name="clientSecret" type="password" value="" maxlength="4096" autocomplete="new-password" placeholder="${value.hasSecret?'Laisser vide pour conserver le secret':'Secret fourni par '+name}"></label><label class="check-label"><input name="enabled" type="checkbox" ${value.enabled?'checked':''}>Autoriser les connexions ${name} dans Passerelle</label><p class="personal-mail-help">Les secrets restent dans les réglages privés du serveur. Modifier les identifiants d’application peut demander aux utilisateurs de reconnecter leur boîte.</p><button type="submit" class="button">Enregistrer ${name}</button></form>${provider==='gmail'?'<p class="personal-mail-help">Créer un client Web, activer Gmail API et déclarer cette adresse de retour. La lecture Gmail utilise une permission restreinte : la mise à disposition du public exige les vérifications Google applicables. En mode test, les autorisations Gmail expirent rapidement.</p><a class="text-button" href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer">Ouvrir Google Cloud '+icon('out')+'</a>':'<p class="personal-mail-help">Créer une application Web pour les comptes professionnels et personnels. Déclarer cette adresse de retour et les permissions déléguées Mail.Read et User.Read, avec offline_access.</p><a class="text-button" href="https://entra.microsoft.com/" target="_blank" rel="noopener noreferrer">Ouvrir Microsoft Entra '+icon('out')+'</a>'}</section>`;
  }
  function adminView(){
    return `<button type="button" class="text-button personal-mail-back" data-personal-mail="user">← Retour à mes boîtes</button><p class="personal-mail-intro">Configurez les applications officielles de Passerelle. Chaque utilisateur choisira ensuite sa propre boîte et donnera son autorisation chez Google ou Microsoft.</p>${(adminData?.providers||[]).filter(value=>providers.includes(value.provider)).map(adminProvider).join('')}`;
  }
  function paint(force=false){
    if(!dialog()?.open||!content()||!state?.user||owner!==state.user.id||dirty&&!force)return;
    const node=content(),focusId=node.contains(document.activeElement)?document.activeElement.id:'';
    document.querySelector('#personal-mail-title').textContent=view==='admin'?'Connexions des messageries':'Mes mails personnels';
    if(view==='admin'&&!state.user.admin){view='user';adminData=null;}
    if(view==='admin'?!adminData:!data){node.innerHTML=failure?'<button type="button" class="button secondary" data-personal-mail="reload">Réessayer</button>':motion.loader('Ouverture des messageries…',true);}
    else node.innerHTML=view==='admin'?adminView():userView();
    if(message){const status=document.createElement('p');status.className='personal-mail-message';status.setAttribute('role','status');status.textContent=message;node.prepend(status);}
    showError();
    if(focusId)node.querySelector('#'+CSS.escape(focusId))?.focus({preventScroll:true});
  }
  function showError(){
    if(!content())return;let node=document.querySelector('#personal-mail-error');
    if(!failure){node?.remove();return;}
    if(!node){node=document.createElement('p');node.id='personal-mail-error';node.className='notice';node.setAttribute('role','alert');content().prepend(node);}node.textContent=failure;
  }
  async function load(force=false){
    if(loading||busy||!owner||!force&&Date.now()-loadedAt<60000)return;
    const id=owner,generation=epoch,request=++sequence,expectedView=view;loading=true;
    try{const result=await call('',undefined,expectedView==='admin');if(!same(id,generation)||request!==sequence||view!==expectedView)return;if(expectedView==='admin')adminData=result;else data=result;loadedAt=Date.now();failure='';paint();}
    catch(error){if(same(id,generation)&&request===sequence){failure=error.message;showError();if(expectedView==='admin'?!adminData:!data)paint();}}
    finally{if(same(id,generation)){loading=false;if(view!==expectedView&&dialog()?.open&&!dirty)queueMicrotask(()=>void load(true));}}
  }
  function open(administration=false){
    if(!state?.user)return;bind(state.user);if(administration&&!state.user.admin)return;
    document.querySelector('#events-dialog')?.close();document.querySelector('#notifications-dialog')?.close();
    if(!dialog()?.open)returnFocus=document.activeElement;
    view=administration?'admin':'user';dirty=false;failure='';message='';loadedAt=0;
    if(!dialog()?.open)dialog()?.showModal();paint(true);void load(true);
  }
  function close(){dialog()?.close();}
  function applyCallback(){
    if(!pendingCallback||!state?.user)return;const result=pendingCallback;pendingCallback=null;
    open();message=result==='connected'?'Retour de connexion reçu. Vérifiez la boîte associée ci-dessous et choisissez ses expéditeurs.':'La connexion n’a pas abouti. Vous pouvez la relancer ci-dessous.';paint(true);
  }
  function mount(user){
    if(!user){if(owner)reset();return;}bind(user);
    if(!user.admin&&view==='admin'){view='user';adminData=null;dirty=false;paint(true);}
    applyCallback();if(dialog()?.open&&!dirty&&!busy)void load();
  }
  function handleHash(params){const value=params?.get('personal-mail');if(['connected','error'].includes(value))pendingCallback=value;}
  async function mutate(route,body,onSuccess,administration=false){
    if(busy)return;const id=owner,generation=epoch;sequence++;busy=true;failure='';message='';showError();content()?.setAttribute('aria-busy','true');
    const nodes=[...(dialog()?.querySelectorAll('button,input,textarea,select')||[])].map(node=>[node,node.disabled]);for(const [node]of nodes)if(node.dataset.personalMail!=='close')node.disabled=true;
    try{const result=await call(route,body,administration);if(!same(id,generation))return;dirty=false;onSuccess?.(result);loadedAt=0;if(dialog()?.open){if(administration)adminData=null;else data=null;paint(true);}}
    catch(error){if(same(id,generation)){failure=error.message;showError();}}
    finally{if(same(id,generation)){busy=false;content()?.setAttribute('aria-busy','false');for(const [node,disabled]of nodes)if(node.isConnected)node.disabled=disabled;if(!failure&&dialog()?.open)void load(true);}}
  }
  function authorize(value,provider){
    let url;try{url=new URL(value.authorizationURL);}catch{throw new Error('La connexion n’a pas pu être ouverte.');}
    const valid=provider==='gmail'?url.hostname==='accounts.google.com'&&url.pathname==='/o/oauth2/v2/auth':url.hostname==='login.microsoftonline.com'&&url.pathname==='/common/oauth2/v2.0/authorize';
    if(url.protocol!=='https:'||url.username||url.password||!valid)throw new Error('L’adresse de connexion du fournisseur est invalide.');
    location.assign(url.href);
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-personal-mail]');if(!button||button.disabled)return;
    const action=button.dataset.personalMail,provider=button.dataset.provider;
    if(action==='open'){open();return;}if(action==='close'){close();return;}if(action==='admin'){open(true);return;}if(action==='user'){open(false);return;}
    if(action==='reload'){void load(true);return;}
    if(action==='events'){close();eventsPortal.open();return;}
    if(!providers.includes(provider))return;
    if(action==='copy-redirect'){const value=document.querySelector('#mail-redirect-'+provider)?.value;if(value)void navigator.clipboard.writeText(value).then(()=>toast('L’adresse de retour est copiée.')).catch(()=>toast('Sélectionnez puis copiez l’adresse de retour.'));return;}
    if(action==='connect'){void mutate(provider+'/connect',{},value=>authorize(value,provider));return;}
    if(action==='disconnect'){
      if(!confirm('Déconnecter '+providerName(provider)+' ? Les accès enregistrés et ses propositions seront retirés. Les événements déjà ajoutés à votre agenda resteront en place.'))return;
      void mutate(provider+'/disconnect',{},()=>{message='La boîte a été déconnectée de Passerelle.';void refresh(false);});
    }
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(!form.matches('.personal-mail-preferences,.personal-mail-admin-form'))return;event.preventDefault();
    const provider=form.dataset.provider;if(!providers.includes(provider))return;
    if(form.matches('.personal-mail-admin-form')){
      if(!state?.user?.admin)return;
      const value=adminData?.providers.find(item=>item.provider===provider),secret=form.elements.clientSecret.value;
      if(form.elements.enabled.checked&&!secret&&!value?.hasSecret){failure='Renseignez le secret fourni par '+providerName(provider)+' avant d’activer cette connexion.';showError();return;}
      void mutate(provider,{clientId:form.elements.clientId.value.trim(),clientSecret:secret,enabled:form.elements.enabled.checked},()=>{message=providerName(provider)+' : réglages enregistrés.';data=null;},true);return;
    }
    const senders=[...new Set(form.elements.senders.value.split(/[\s,;]+/).map(value=>value.trim().toLowerCase()).filter(Boolean))];
    if(senders.length>10||senders.some(value=>!/^[-a-z0-9._+]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value))||form.elements.enabled.checked&&!senders.length){failure='Indiquez une à dix adresses mail précises pour activer la lecture.';showError();return;}
    void mutate(provider+'/preferences',{enabled:form.elements.enabled.checked,senders},()=>{message='Votre sélection d’expéditeurs est enregistrée.';void refresh(false);});
  });
  document.addEventListener('input',event=>{if(event.target.closest('#personal-mail-content form'))dirty=true;});
  document.addEventListener('change',event=>{if(event.target.closest('#personal-mail-content form'))dirty=true;});
  document.addEventListener('keydown',event=>{
    const el=dialog();if(!el?.open||event.key!=='Tab')return;
    const nodes=[...el.querySelectorAll('button,input,textarea,select,a[href],summary,[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length),first=nodes[0],last=nodes.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  document.addEventListener('close',event=>{if(event.target.id!=='personal-mail-dialog')return;dirty=false;failure='';message='';adminData=null;content()?.replaceChildren();const target=returnFocus;returnFocus=null;if(state?.user&&target?.isConnected)target.focus({preventScroll:true});},true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&dialog()?.open&&!dirty)void load();});
  return {mount,reset,open,handleHash,isEditing:user=>!!dialog()?.open&&user?.id===owner};
})();
