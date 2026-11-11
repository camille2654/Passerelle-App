/* One ENT connection, owned by Lapsus. No Passerelle account is created here. */
(() => {
  const base=new URL('.',document.currentScript.src),main=document.querySelector('#managed-ent-content'),errorNode=document.querySelector('#managed-error'),cancel=document.querySelector('#managed-ent-cancel');
  const icon=name=>`<svg class="managed-ent-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="${new URL('integrations/lapsus-managed/assets/lapsus-icons.svg#'+name,base).href}"></use></svg>`;
  const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let current=null,signature='',timer=null,frameURL=null,busy=false,closed=false,generation=0,queue=Promise.resolve();
  const request=async(route,body)=>{
    const response=await fetch(new URL('api/ent-connect/'+route,base),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(route==='start'?65000:20000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||'Cette opération n’a pas abouti. Réessayez.'),{status:response.status});
    return data;
  };
  const fail=message=>{errorNode.hidden=false;errorNode.textContent=message;};
  const clearError=()=>{errorNode.hidden=true;errorNode.textContent='';};
  function clearFrame(){if(frameURL)URL.revokeObjectURL(frameURL);frameURL=null;const image=document.querySelector('#managed-frame');image?.removeAttribute('src');}
  function stop(){closed=true;generation++;clearTimeout(timer);clearFrame();const text=document.querySelector('#managed-text');if(text)text.value='';}
  function terminal(title,message){stop();main.setAttribute('aria-busy','false');main.innerHTML=`<h2>${escape(title)}</h2><p>${escape(message)}</p><a class="button secondary" href="https://mon-ent.pages.dev/">Revenir à Lapsus</a>`;cancel.hidden=true;}
  function markStep(status){const name=status==='school'?'school':['login','student'].includes(status)?'login':'syncing';document.querySelectorAll('[data-step]').forEach(node=>{if(node.dataset.step===name)node.setAttribute('aria-current','step');else node.removeAttribute('aria-current');});}
  function paint(value){
    if(closed)return;
    current=value;
    if(!['school','login','student','syncing','ready','error'].includes(value.status))throw new Error('L’état de cette connexion est inattendu. Relancez-la depuis Lapsus.');
    if(!Number.isFinite(value.expiresAt)||Date.now()>=value.expiresAt){terminal('Cette demande a expiré.','Relancez la connexion ENT depuis Lapsus.');return;}
    markStep(value.status);main.setAttribute('aria-busy',['login','syncing'].includes(value.status)?'true':'false');
    const labels={courses:'cours et horaires',homework:'devoirs',exams:'contrôles',messages:'mails de l’ENT',news:'actualités du lycée'};
    const types={courses:['cal','Cours'],homework:['check','Devoirs'],exams:['check','Contrôles'],messages:['mail','Mails de l’ENT'],news:['news','Actualités']};
    document.querySelector('#managed-data-types').innerHTML=(value.scopes||[]).filter(scope=>types[scope]).map(scope=>'<li>'+icon(types[scope][0])+escape(types[scope][1])+'</li>').join('');
    document.querySelector('#managed-ent-scope').textContent='Les informations suivantes seront synchronisées avec votre compte Lapsus : '+(value.scopes||[]).map(scope=>labels[scope]).filter(Boolean).join(', ')+'.';
    const next=JSON.stringify([value.status,value.schoolName,value.students]);
    if(next===signature){const host=document.querySelector('#managed-host');if(host)host.textContent=value.host||'Ouverture de votre ENT…';return;}
    signature=next;clearFrame();
    if(value.status==='school'){
      main.innerHTML=`<h2>Quel est votre lycée ?</h2><p>Recherchez votre établissement dans le catalogue national des ENT Skolengo. Les services disponibles dépendent de votre établissement.</p><form id="managed-school-form"><label for="managed-school-query">Nom du lycée ou ville<input id="managed-school-query" name="q" type="search" minlength="3" maxlength="100" autocomplete="off" required placeholder="Nom du lycée ou ville"></label><button class="button" type="submit">Rechercher</button></form><ul id="managed-schools" aria-label="Établissements trouvés"></ul>`;
    }else if(value.status==='login'){
      main.innerHTML=`<h2>Connectez-vous à votre ENT.</h2><p>Utilisez la fenêtre ci-dessous ; les informations récupérées seront disponibles dans votre compte Lapsus.</p><div class="managed-ent-host"><span>Portail :</span><strong id="managed-host">${escape(value.host||'Ouverture de votre ENT…')}</strong></div><div class="managed-ent-frame-wrap"><p id="managed-frame-loading" class="managed-ent-frame-loading" role="status">Ouverture du portail ENT…</p><img id="managed-frame" class="managed-ent-frame" alt="Fenêtre interactive de connexion ENT" hidden draggable="false"></div><input id="managed-remote" class="managed-ent-hidden-keyboard" aria-label="Clavier de la fenêtre ENT" autocomplete="off"><form id="managed-text-form" class="managed-ent-keyboard"><label for="managed-text">Clavier mobile — envoyer du texte au champ sélectionné<input id="managed-text" type="password" maxlength="1000" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Touchez d’abord le champ dans la fenêtre ENT"></label><div class="managed-ent-keyboard-row"><button class="button secondary" type="submit">Envoyer le texte</button><button class="button secondary" type="button" data-managed-key="Tab">Champ suivant</button><button class="button secondary" type="button" data-managed-key="Enter">Valider ↵</button></div></form><p>Sur ordinateur, cliquez dans la fenêtre puis utilisez votre clavier. Sur téléphone, choisissez le champ dans la fenêtre puis utilisez le clavier mobile.</p>`;
    }else if(value.status==='student'){
      main.innerHTML=`<h2>Quel emploi du temps souhaitez-vous retrouver ?</h2><p>Votre ENT donne accès à plusieurs élèves. Choisissez celui à utiliser dans Lapsus.</p><form id="managed-student-form" class="managed-ent-students">${(value.students||[]).map((student,index)=>`<label><input type="radio" name="studentId" value="${escape(student.id)}" ${index===0?'checked':''} required><span><strong>${escape(student.name)}</strong><small>${escape(student.className||'')}</small></span></label>`).join('')}<button class="button" type="submit">Continuer</button></form>`;
    }else if(value.status==='syncing'){
      main.innerHTML=`<h2>Votre ENT est connecté.</h2><p class="managed-ent-wait">Nous préparons votre emploi du temps et les informations demandées.</p><p>Cette première récupération peut prendre un moment. Les prochaines mises à jour se feront automatiquement.</p>`;
    }else if(value.status==='ready'){
      main.innerHTML=`<div class="managed-ent-ready"><span class="managed-ent-check" aria-hidden="true">${icon('check')}</span><h2>Votre agenda est prêt.</h2><p>La connexion à ${escape(value.schoolName||'votre établissement')} est établie. Retrouvez les informations demandées directement dans Lapsus.</p><button id="managed-ent-finish" class="button" type="button">Revenir à Lapsus</button></div>`;
    }else{
      main.innerHTML=`<h2>La connexion a été interrompue.</h2><p>${escape(value.error||'Relancez la connexion ENT depuis Lapsus.')}</p><a class="button secondary" href="https://mon-ent.pages.dev/">Revenir à Lapsus</a>`;
    }
  }
  async function frame(expected){
    if(closed||current?.status!=='login'||document.hidden)return;
    const response=await fetch(new URL('api/ent-connect/frame',base),{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000)});
    if(response.status===204)return;
    if(!response.ok)throw Object.assign(new Error('La fenêtre ENT ne peut pas être affichée. Réessayez.'),{status:response.status});
    const blob=await response.blob();if(closed||expected!==generation||current?.status!=='login')return;
    const image=document.querySelector('#managed-frame');if(!image)return;
    const previous=frameURL;frameURL=URL.createObjectURL(blob);image.src=frameURL;image.hidden=false;document.querySelector('#managed-frame-loading').hidden=true;if(previous)URL.revokeObjectURL(previous);
  }
  function pollSoon(delay=1500){clearTimeout(timer);if(!closed&&['login','syncing'].includes(current?.status))timer=setTimeout(()=>void poll(),delay);}
  async function poll(){
    if(closed)return;
    if(document.hidden){pollSoon(1500);return;}
    const expected=generation;
    try{const value=await request('status');if(closed||expected!==generation)return;paint(value);if(value.status==='login')await frame(expected);}
    catch(error){if(closed||expected!==generation)return;if([401,410,503].includes(error.status)){terminal('Cette connexion ne peut pas continuer.',error.message);return;}fail(error.message);}
    pollSoon();
  }
  async function act(button,operation){
    if(busy||closed)return;busy=true;clearError();if(button)button.disabled=true;const expected=generation;
    try{await operation();}catch(error){if(!closed&&expected===generation){if([401,410,503].includes(error.status))terminal('Cette connexion ne peut pas continuer.',error.message);else fail(error.message);}}
    finally{busy=false;if(button?.isConnected)button.disabled=false;}
  }
  function input(action){const expected=generation;queue=queue.then(async()=>{if(closed||expected!==generation||current?.status!=='login')return;await request('input',action);}).catch(error=>{if(!closed&&expected===generation&&current?.status==='login')fail(error.message);});return queue;}
  document.addEventListener('submit',event=>{
    const form=event.target;
    if(form.id==='managed-school-form'){event.preventDefault();void act(form.querySelector('button'),async()=>{const value=await request('schools',{q:form.elements.q.value.trim()});if(closed)return;document.querySelector('#managed-schools').innerHTML=value.schools.length?value.schools.map(school=>`<li><button type="button" data-managed-school="${escape(school.id)}">${icon('school')}<span><strong>${escape(school.name)}</strong><small>${escape(school.city||'')+(school.provider?' · '+escape(school.provider.label):'')}</small></span></button></li>`).join(''):'<li><p>Aucun établissement compatible trouvé. Essayez son nom ou sa ville.</p></li>';});}
    else if(form.id==='managed-text-form'){event.preventDefault();const text=form.querySelector('input');const value=text.value;text.value='';if(value)void input({type:'text',text:value});}
    else if(form.id==='managed-student-form'){event.preventDefault();void act(form.querySelector('button'),async()=>{paint(await request('student',{studentId:new FormData(form).get('studentId')}));pollSoon(100);});}
  });
  document.addEventListener('click',event=>{
    const school=event.target.closest('[data-managed-school]');if(school){void act(school,async()=>{current={...current,status:'login'};paint(current);pollSoon();const value=await request('start',{schoolId:school.dataset.managedSchool});if(!closed){paint(value);pollSoon(100);}});return;}
    const key=event.target.closest('[data-managed-key]');if(key){void input({type:'key',key:key.dataset.managedKey});return;}
    if(event.target.id==='managed-ent-finish')void act(event.target,async()=>{const value=await request('finish',{}),destination=new URL(value.redirectURL);if(destination.origin!=='https://mon-ent.pages.dev'||destination.pathname!=='/passerelle/ent/callback'||destination.username||destination.password||destination.hash)throw new Error('L’adresse de retour reçue est invalide.');stop();location.replace(destination.href);});
    if(event.target.id==='managed-frame'){const box=event.target.getBoundingClientRect();document.querySelector('#managed-remote')?.focus({preventScroll:true});void input({type:'click',x:(event.clientX-box.left)*1000/box.width,y:(event.clientY-box.top)*740/box.height});}
  });
  document.addEventListener('keydown',event=>{if(event.target.id!=='managed-remote')return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();void input({type:'key',key:'Control+a'});}else if(event.key.length===1&&!event.ctrlKey&&!event.metaKey){event.preventDefault();void input({type:'text',text:event.key});}else if(['Tab','Enter','Backspace','Delete','Escape','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();void input({type:'key',key:event.key==='Tab'&&event.shiftKey?'Shift+Tab':event.key});}});
  document.addEventListener('paste',event=>{if(event.target.id==='managed-remote'){event.preventDefault();void input({type:'text',text:event.clipboardData.getData('text').slice(0,1000)});}});
  document.addEventListener('wheel',event=>{if(event.target.id==='managed-frame'){event.preventDefault();void input({type:'scroll',y:event.deltaY});}},{passive:false});
  cancel.addEventListener('click',()=>void act(cancel,async()=>{await request('cancel',{});terminal('Connexion annulée.','Vous pouvez revenir à Lapsus et relancer la connexion si vous le souhaitez.');}));
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!closed&&['login','syncing'].includes(current?.status))pollSoon(100);});
  window.addEventListener('pagehide',()=>stop());
  window.addEventListener('pageshow',event=>{if(event.persisted){closed=false;signature='';void poll();}});
  void poll();
})();
