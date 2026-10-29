/* Event suggestions stay private and require confirmation before entering the calendar. */
const eventsPortal = (() => {
  let owner='', account='', epoch=0, data=null, loading=false, busy=false, loadedAt=0, knownVersion=null, sequence=0, editor=null, editorRevision=null, editorDraft=null, source=null, dirty=false, failure='', returnFocus=null;
  const dialog=()=>document.querySelector('#events-dialog');
  const content=()=>document.querySelector('#events-content');
  const identity=user=>[user?.id,user?.studentId,user?.schoolName,user?.skolengoConnected].join(':');
  const dateLabel=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'short',day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00Z')):'Date à vérifier';
  const same=(id,generation)=>account===id&&state?.user?.id===id&&generation===epoch&&owner===identity(state.user);
  const pending=()=>data?.items.filter(item=>item.status==='pending'||item.status==='accepted'&&item.changed)||[];
  const isMail=kind=>['message','personal-mail'].includes(kind);
  const label=source=>source?.kind==='personal-mail'?'Mail personnel · '+(source.provider==='gmail'?'Gmail':source.provider==='outlook'?'Outlook':'Messagerie'):source?.kind==='message'?'Message du lycée':'Actualité du lycée';
  const itemById=id=>data?.items.find(item=>item.id===id);

  function reset(){
    owner='';account='';epoch++;data=null;loading=false;busy=false;loadedAt=0;knownVersion=null;sequence=0;editor=null;editorRevision=null;editorDraft=null;source=null;dirty=false;failure='';returnFocus=null;
    dialog()?.close();content()?.replaceChildren();document.querySelector('#events-home-root')?.replaceChildren();
    const home=document.querySelector('#events-home-root');if(home)home.hidden=true;
  }
  function bind(user){if(owner!==identity(user)){reset();owner=identity(user);account=user.id;}}
  async function call(route='',body){
    const id=account,generation=epoch;
    if(!same(id,generation))throw new Error('Le compte ou l’élève a changé.');
    const result=await api('event-suggestions'+(route?'/'+route:''),body===undefined?undefined:{...body,accountId:id});
    if(!same(id,generation)||result.accountId&&result.accountId!==id)throw new Error('Le compte ou l’élève a changé.');
    return result;
  }
  function paintHome(){
    const node=document.querySelector('#events-home-root');if(!node||!state?.user||owner!==identity(state.user))return;
    const count=data?pending().length:state.user.eventSuggestions?.pending||0;
    node.hidden=!count;
    const key=String(count);if(node.dataset.count===key&&node.childElementCount)return;node.dataset.count=key;
    node.innerHTML=count?`<span class="events-home-mark">${icon('calendar')}</span><div><strong>${count===1?'Un rendez-vous à vérifier':count+' rendez-vous à vérifier'}</strong><span>Des dates repérées dans vos informations et messages.</span></div><button type="button" class="text-button" data-events="open">Voir ${icon('arrow')}</button>`:'';
  }
  function settings(){
    const value=data.settings||{},connected=data.connected;
    return `<details class="events-settings" ${!value.news&&!value.messages&&!value.personal?'open':''}><summary>Choisir les informations à analyser</summary><p>Repérer les dates dans votre ENT et les mails personnels que vous choisissez.</p><form id="event-sources-form"><fieldset ${connected?'':'disabled'}><legend class="sr-only">Sources des propositions</legend>${[['news','Les actualités de mon lycée'],['messages','Les extraits de ma messagerie ENT'],['personal','Les mails personnels sélectionnés']].map(([key,title])=>`<label class="check-label"><input type="checkbox" name="${key}" ${value[key]?'checked':''}>${title}${data.sources?.[key]?.state==='unavailable'?'<small> · Non fourni par votre ENT</small>':''}</label>`).join('')}<p class="events-help">La détection préserve le statut non lu des messages. Les mails personnels se limitent aux expéditeurs choisis dans vos boîtes associées.</p><button type="submit" class="button secondary">Enregistrer mes choix</button></fieldset></form><div class="event-personal-settings"><button type="button" class="text-button" data-personal-mail="open">${icon('mail')} Relier Gmail ou Outlook ${icon('arrow')}</button><p class="events-help">Choisissez vos boîtes, leurs expéditeurs et leur autorisation de lecture.</p></div></details>`;
  }
  function card(item){
    const changed=item.status==='accepted'&&item.changed;
    if(item.status==='accepted'&&!changed&&item.confirmed)item={...item,...item.confirmed};
    return `<article class="event-proposal" data-event-id="${escape(item.id)}"><div class="event-proposal-meta"><span>${icon(isMail(item.source?.kind)?'mail':'bell')}${escape(label(item.source))}</span><span class="event-proposal-state">${changed?'Changement à vérifier':item.status==='accepted'?'Dans mon agenda':'À confirmer'}</span></div><h3>${escape(item.title)}</h3><p class="event-proposal-date">${escape(dateLabel(item.date))}${item.startTime?' · '+escape(item.startTime)+(item.endTime?' – '+escape(item.endTime):''):item.status==='accepted'&&item.allDay?' · Journée entière':' · Horaire non précisé'}</p>${item.location?`<p>${icon('pin')} ${escape(item.location)}</p>`:''}${item.excerpt?`<blockquote>${escape(item.excerpt)}</blockquote>`:''}${changed?'<p class="events-help">La source a changé. Votre agenda conserve les informations que vous aviez validées.</p>':''}<div class="event-proposal-actions"><button type="button" class="text-button" data-events="source" data-id="${escape(item.id)}">${isMail(item.source?.kind)?'Lire le message':'Lire l’actualité'} ${icon('out')}</button>${item.status==='pending'||changed?`<button type="button" class="button secondary" data-events="review" data-id="${escape(item.id)}">${changed?'Vérifier les changements':'Vérifier et ajouter'}</button>`:''}${item.status==='pending'?`<button type="button" class="text-button" data-events="dismiss" data-id="${escape(item.id)}">Ignorer</button>`:''}${item.status==='accepted'?`<button type="button" class="text-button" data-events="remove" data-id="${escape(item.id)}">Retirer de mon agenda</button>`:''}</div></article>`;
  }
  function review(item){
    item={...item,...editorDraft};
    const allDay=editorDraft?editorDraft.allDay:item.allDay===true||!item.startTime;
    return `<button type="button" class="text-button events-back" data-events="back">← Retour aux propositions</button><div class="events-review-intro"><span class="event-proposal-state">À vérifier avant l’ajout</span><h3>${item.status==='accepted'?'Mettre à jour ce rendez-vous':'Ajouter à mon agenda'}</h3><p>Vérifiez les informations avec ${isMail(item.source?.kind)?'le message':'l’actualité'} d’origine. L’ajout organise votre agenda personnel. Si une inscription est demandée, effectuez-la aussi auprès de l’organisateur.</p>${item.excerpt?`<blockquote>${escape(item.excerpt)}</blockquote>`:''}${item.ambiguous?'<p class="notice info">La date ou l’horaire est ambigu dans la source. Vérifiez-les avant de confirmer.</p>':''}<button type="button" class="text-button" data-events="source" data-id="${escape(item.id)}">Relire la source ${icon('out')}</button></div><form id="event-confirm-form" data-id="${escape(item.id)}" data-revision="${escape(editorRevision||item.revision)}"><label for="event-title">Titre<input id="event-title" name="title" value="${escape(item.title)}" maxlength="200" required></label><label for="event-date">Date<input id="event-date" name="date" type="date" value="${escape(item.date)}" required></label><label class="check-label"><input type="checkbox" name="allDay" ${allDay?'checked':''}>Toute la journée</label><div class="event-form-times"><label for="event-start">Début · heure de Paris<input id="event-start" name="startTime" type="time" value="${escape(item.startTime||'')}" ${allDay?'disabled':'required'}></label><label for="event-end">Fin · heure de Paris<input id="event-end" name="endTime" type="time" value="${escape(item.endTime||'')}" ${allDay?'disabled':'required'}></label></div><p class="events-help">Quand l’horaire n’est pas précisé, vous pouvez conserver une journée entière ou saisir les horaires après vérification.</p><label for="event-location">Lieu <span class="events-optional">facultatif</span><input id="event-location" name="location" value="${escape(item.location||'')}" maxlength="200"></label><button type="submit" class="button">${item.status==='accepted'?'Mettre à jour mon agenda':'Confirmer l’ajout à mon agenda'}</button></form>`;
  }
  function paint(force=false){
    paintHome();if(!dialog()?.open||!content()||!state?.user||owner!==identity(state.user)||dirty&&!force)return;
    const node=content(),focusedId=node.contains(document.activeElement)?document.activeElement?.id:'',focusedAction=node.contains(document.activeElement)?document.activeElement?.dataset.events:'';
    if(source){node.innerHTML=`<button type="button" class="text-button events-back" data-events="source-back">← ${editor?'Retour à la vérification':'Retour aux propositions'}</button><section class="event-source"><h3>${escape(source.title||'Information du lycée')}</h3>${schoolPortal.detailContent(source)}</section>`;return;}
    if(editor&&itemById(editor)){node.innerHTML=review(itemById(editor));}
    else if(!data){node.innerHTML=failure?`<p class="notice" role="alert">${escape(failure)}</p><button type="button" class="button secondary" data-events="reload">Réessayer</button>`:motion.loader('Ouverture des propositions…',true);return;}
    else{
      const proposals=pending(),accepted=data.items.filter(item=>item.status==='accepted'&&!item.changed);
      node.innerHTML=`<p class="events-intro">Vos dates utiles, au bon endroit. Vous choisissez ce qui rejoint votre agenda.</p>${!data.connected?'<p class="notice info">Connectez votre ENT pour repérer les événements de votre lycée.</p><button type="button" class="button secondary" data-events="connect">Connecter mon ENT</button>':''}${settings()}${data.warning?`<p class="notice info">${escape(data.warning)}</p>`:''}<div class="events-toolbar"><span>${data.checkedAt?'Dernière vérification · '+escape(dateTime(data.checkedAt)):'Aucune vérification pour le moment'}</span><button type="button" class="text-button" data-events="scan" ${!data.connected||!data.settings?.news&&!data.settings?.messages&&!data.settings?.personal?'disabled':''}>${icon('sync')} Vérifier maintenant</button></div><section class="events-proposals" aria-label="Propositions à confirmer">${proposals.length?proposals.map(card).join(''):`<div class="events-empty">${icon('calendar')}<h3>${data.settings?.news||data.settings?.messages||data.settings?.personal?'Aucun rendez-vous à confirmer':'Choisissez vos sources pour commencer'}</h3><p>${data.settings?.news||data.settings?.messages||data.settings?.personal?'Les événements détectés apparaîtront ici. Vous gardez toujours le choix de les ajouter.':'Choisissez les actualités, la messagerie ENT ou les mails personnels dans les réglages ci-dessus.'}</p></div>`}</section>${accepted.length?`<details class="events-accepted"><summary>Dans mon agenda · ${accepted.length}</summary>${accepted.map(card).join('')}</details>`:''}<p class="events-help">Les dates ambiguës ou les horaires absents demandent votre vérification. Cette détection peut laisser passer certains événements.</p><button type="button" class="text-button" data-events="notifications">Choisir mes notifications ${icon('arrow')}</button>`;
    }
    if(focusedId)node.querySelector('#'+CSS.escape(focusedId))?.focus({preventScroll:true});else if(focusedAction)node.querySelector('[data-events="'+CSS.escape(focusedAction)+'"]')?.focus({preventScroll:true});
    showError();
  }
  function showError(){
    let notice=document.querySelector('#events-error');if(!content())return;
    if(!failure){notice?.remove();return;}if(!notice){notice=document.createElement('p');notice.id='events-error';notice.className='notice';notice.setAttribute('role','alert');content().prepend(notice);}notice.textContent=failure;
  }
  async function load(force=false){
    if(loading||busy||!account||!force&&Date.now()-loadedAt<60000)return;
    const id=account,generation=epoch,request=++sequence;loading=true;
    try{const value=await call();if(!same(id,generation)||request!==sequence)return;data=value;loadedAt=Date.now();failure='';paint();}
    catch(error){if(same(id,generation)&&request===sequence){failure=error.message;showError();if(!data)paint();}}
    finally{if(same(id,generation))loading=false;}
  }
  function mount(user){
    if(!user){if(owner)reset();return;}bind(user);paintHome();
    const version=user.eventSuggestions?.version||0,changed=knownVersion!==version;knownVersion=version;
    if(!dirty&&!busy)void load(changed);
  }
  function open(){
    if(!state?.user)return;bind(state.user);returnFocus=document.activeElement;editor=null;editorRevision=null;editorDraft=null;source=null;dirty=false;failure='';
    if(!dialog()?.open)dialog()?.showModal();paint(true);void load(true);
  }
  function close(){dialog()?.close();}
  async function mutate(route,body,onSuccess){
    if(busy)return;const id=account,generation=epoch;sequence++;busy=true;failure='';showError();content()?.setAttribute('aria-busy','true');const progress=document.createElement('p');progress.id='events-progress';progress.className='events-help';progress.setAttribute('role','status');progress.textContent=route==='scan'||route==='settings'?'Vérification des informations de votre lycée…':'Enregistrement de votre choix…';content()?.prepend(progress);
    const controls=[...(dialog()?.querySelectorAll('button,input,select,textarea')||[])].map(node=>[node,node.disabled]);for(const [node]of controls)if(node.dataset.events!=='close')node.disabled=true;
    try{const value=await call(route,body);if(!same(id,generation))return;data=value;loadedAt=Date.now();dirty=false;onSuccess?.(value);paint(true);}
    catch(error){if(same(id,generation)){failure=error.message;showError();}}
    finally{if(same(id,generation)){busy=false;content()?.setAttribute('aria-busy','false');document.querySelector('#events-progress')?.remove();for(const [node,disabled]of controls)if(node.isConnected)node.disabled=disabled;paintHome();}}
  }
  document.addEventListener('click',event=>{
    const button=event.target.closest('[data-events]');if(!button||button.disabled)return;
    const action=button.dataset.events,id=button.dataset.id,item=itemById(id);
    if(action==='open'){open();return;}if(action==='close'){close();return;}
    if(action==='connect'){close();portal.navigate('calendar');return;}
    if(action==='back'){editor=null;editorRevision=null;editorDraft=null;source=null;dirty=false;failure='';paint(true);content()?.querySelector('[data-events="review"]')?.focus();return;}
    if(action==='source-back'){source=null;dirty=false;paint(true);dirty=!!editor;return;}
    if(action==='reload'){void load(true);return;}
    if(action==='notifications'){close();features.openNotifications('app');return;}
    if(action==='scan'){void mutate('scan',{},()=>toast('Les informations disponibles ont été vérifiées.'));return;}
    if(action==='review'&&item){editor=id;editorRevision=item.revision;editorDraft=null;source=null;dirty=false;failure='';paint(true);dirty=true;document.querySelector('#event-title')?.focus();return;}
    if((action==='dismiss'||action==='remove')&&item){void mutate(encodeURIComponent(id)+'/'+action,{revision:item.revision},()=>{editor=null;source=null;toast(action==='remove'?'Le rendez-vous a été retiré de votre agenda.':'Proposition ignorée.');});return;}
    if(action==='source'&&item){const form=document.querySelector('#event-confirm-form');if(form)editorDraft={title:form.elements.title.value,date:form.elements.date.value,allDay:form.elements.allDay.checked,startTime:form.elements.startTime.value,endTime:form.elements.endTime.value,location:form.elements.location.value};const generation=epoch,expected=account;button.disabled=true;void call(encodeURIComponent(id)+'/source',{}).then(value=>{if(!same(expected,generation)||!dialog()?.open)return;source=value;dirty=false;paint(true);dirty=true;content()?.querySelector('button')?.focus();}).catch(error=>{if(same(expected,generation)){failure=error.message;showError();}}).finally(()=>{if(button.isConnected)button.disabled=false;});}
  });
  document.addEventListener('submit',event=>{
    const form=event.target;if(form.id!=='event-sources-form'&&form.id!=='event-confirm-form')return;event.preventDefault();
    if(form.id==='event-sources-form'){void mutate('settings',{news:form.elements.news.checked,messages:form.elements.messages.checked,personal:form.elements.personal.checked},()=>toast('Vos sources ont été enregistrées.'));return;}
    const allDay=form.elements.allDay.checked,body={revision:form.dataset.revision,title:form.elements.title.value.trim(),date:form.elements.date.value,allDay,startTime:allDay?'':form.elements.startTime.value,endTime:allDay?'':form.elements.endTime.value,location:form.elements.location.value.trim()};
    void mutate(encodeURIComponent(form.dataset.id)+'/accept',body,()=>{editor=null;editorRevision=null;editorDraft=null;source=null;toast('Le rendez-vous est dans votre agenda.');void refresh(false);});
  });
  document.addEventListener('input',event=>{if(event.target.closest('#event-confirm-form,#event-sources-form'))dirty=true;});
  document.addEventListener('change',event=>{const form=event.target.closest('#event-confirm-form,#event-sources-form');if(!form)return;dirty=true;if(form.id==='event-confirm-form'&&event.target.name==='allDay')for(const name of ['startTime','endTime']){form.elements[name].disabled=form.elements.allDay.checked;form.elements[name].required=!form.elements.allDay.checked;}});
  document.addEventListener('keydown',event=>{
    const el=dialog();if(!el?.open||event.key!=='Tab')return;
    const nodes=[...el.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length);
    const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  });
  document.addEventListener('close',event=>{if(event.target.id!=='events-dialog')return;editor=null;editorRevision=null;editorDraft=null;source=null;dirty=false;failure='';content()?.replaceChildren();const target=returnFocus;returnFocus=null;if(state?.user&&target?.isConnected)target.focus({preventScroll:true});},true);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state?.user&&!dirty)void load();});
  return {mount,reset,open,isEditing:user=>!!dialog()?.open&&user?.id===account};
})();
