/* The device keeps the private key and performs its own user verification. */
const passkeyPortal=(()=>{
  let owner='',epoch=0,data=null,loading=false,busy=false,failure='',returnFocus=null,controller=null,dirty=false;
  const supported=()=>window.isSecureContext&&!!window.PublicKeyCredential&&!!navigator.credentials;
  const dialog=()=>document.querySelector('#passkeys-dialog');
  const content=()=>document.querySelector('#passkeys-content');
  const same=(id,generation)=>owner===id&&state?.user?.id===id&&epoch===generation;
  const fromB64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),char=>char.charCodeAt(0));
  const toB64=value=>{let text='';for(const byte of new Uint8Array(value))text+=String.fromCharCode(byte);return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');};
  function nativeOptions(options,register){const value={...options,challenge:fromB64(options.challenge)};if(register)value.user={...options.user,id:fromB64(options.user.id)};for(const name of ['excludeCredentials','allowCredentials'])if(options[name])value[name]=options[name].map(item=>({...item,id:fromB64(item.id)}));return value;}
  function serialized(credential){
    if(typeof credential.toJSON==='function')return credential.toJSON();
    const response={clientDataJSON:toB64(credential.response.clientDataJSON)};
    for(const key of ['attestationObject','authenticatorData','signature'])if(credential.response[key])response[key]=toB64(credential.response[key]);
    if('userHandle'in credential.response)response.userHandle=credential.response.userHandle?toB64(credential.response.userHandle):null;
    if(typeof credential.response.getTransports==='function')response.transports=credential.response.getTransports();
    return {id:credential.id,rawId:toB64(credential.rawId),type:credential.type,response,clientExtensionResults:credential.getClientExtensionResults(),authenticatorAttachment:credential.authenticatorAttachment};
  }
  function ensureDialog(){if(dialog())return;const node=document.createElement('dialog');node.id='passkeys-dialog';node.className='passkeys-dialog';node.setAttribute('aria-labelledby','passkeys-title');node.innerHTML='<header class="drawer-heading"><div><p class="eyebrow">CONNEXION / MES APPAREILS</p><h2 id="passkeys-title">Mes clés d’accès</h2></div><button type="button" class="icon-button" data-passkey="close" aria-label="Fermer les clés d’accès">'+icon('close')+'</button></header><div id="passkeys-content"></div>';document.body.append(node);}
  function reset(){owner='';epoch++;controller?.abort();controller=null;data=null;loading=false;busy=false;failure='';dirty=false;returnFocus=null;dialog()?.close();content()?.replaceChildren();}
  function bind(user){if(owner!==user.id){reset();owner=user.id;}}
  function paint(force=false){
    if(!dialog()?.open||!content()||!state?.user||owner!==state.user.id||dirty&&!force)return;
    if(!data){content().innerHTML=failure?'<p class="notice" role="alert">'+escape(failure)+'</p><button type="button" class="button secondary" data-passkey="reload">Réessayer</button>':motion.loader('Ouverture de vos clés d’accès…',true);return;}
    const available=supported()&&data.available;
    content().innerHTML=`<p class="passkeys-intro">Ouvrez Passerelle avec le déverrouillage de votre appareil : visage, empreinte, code ou clé de sécurité, selon ce qu’il propose. Votre mot de passe Passerelle reste utilisable.</p>${!available?'<p class="notice info">Cet appareil ou ce navigateur ne permet pas les clés d’accès ici. Vous pouvez continuer avec votre mot de passe.</p>':''}${failure?'<p class="notice" role="alert">'+escape(failure)+'</p>':''}<section class="passkeys-list" aria-label="Clés enregistrées">${data.items.length?data.items.map(item=>`<article class="passkey-row"><div><h3>${escape(item.label)}</h3><p>Ajoutée le ${escape(dateTime(item.createdAt))}${item.lastUsedAt?' · Utilisée le '+escape(dateTime(item.lastUsedAt)):''}</p></div><button type="button" class="text-button" data-passkey="remove-open" data-id="${escape(item.id)}">Retirer</button><form class="passkey-remove-form" data-id="${escape(item.id)}" hidden><label>Mot de passe Passerelle<input name="password" type="password" autocomplete="current-password" maxlength="256" required></label><div><button type="submit" class="button secondary">Confirmer le retrait</button><button type="button" class="text-button" data-passkey="remove-cancel">Annuler</button></div></form></article>`).join(''):'<p class="passkeys-empty">Aucune clé enregistrée pour le moment.</p>'}</section>${data.items.length<data.maxKeys?`<form id="passkey-register-form"><h3>Ajouter une clé d’accès</h3><label for="passkey-label">Nom de cette clé<input id="passkey-label" name="label" maxlength="80" placeholder="Mon téléphone" autocomplete="off" value="" ${available?'':'disabled'}></label><label for="passkey-password">Mot de passe Passerelle<input id="passkey-password" name="password" type="password" autocomplete="current-password" maxlength="256" required ${available?'':'disabled'}></label><p class="passkeys-help">Confirmez d’abord votre compte, puis laissez votre appareil créer la clé. Passerelle ne reçoit ni votre empreinte ni votre visage.</p><button type="submit" class="button" ${available?'':'disabled'}>Créer une clé d’accès</button></form>`:'<p class="passkeys-help">Huit clés sont déjà enregistrées. Retirez une ancienne clé avant d’en ajouter une autre.</p>'}<p class="passkeys-help">Les clés sont liées à cette adresse de Passerelle. Conservez un moyen de retrouver votre compte si vous changez d’appareil.</p>`;
  }
  async function call(route='',body){const id=owner,generation=epoch,result=await api('passkeys'+(route?'/'+route:''),body===undefined?undefined:{...body,accountId:id});if(!same(id,generation)||result.accountId&&result.accountId!==id)throw new Error('Le compte a changé. Rechargez votre espace.');return result;}
  async function load(){if(loading||busy||!owner)return;const id=owner,generation=epoch;loading=true;try{data=await call();failure='';paint();}catch(error){if(same(id,generation)){failure=error.message;paint();}}finally{if(same(id,generation))loading=false;}}
  function mount(user){if(!user){if(owner)reset();return;}bind(user);}
  function open(){if(!state?.user)return;bind(state.user);ensureDialog();returnFocus=document.activeElement;failure='';dirty=false;dialog().showModal();paint(true);void load();}
  async function create(form){
    if(busy)return;const id=owner,generation=epoch;busy=true;failure='';const button=form.querySelector('[type=submit]');button.disabled=true;controller=new AbortController();
    try{const result=await call('register/options',{password:form.elements.password.value,label:form.elements.label.value.trim()});if(!same(id,generation))return;form.elements.password.value='';const credential=await navigator.credentials.create({publicKey:nativeOptions(result.options,true),signal:controller.signal});if(!credential||!same(id,generation))return;data=await call('register/verify',{response:serialized(credential)});dirty=false;paint(true);toast('Votre clé d’accès est enregistrée.');}
    catch(error){if(same(id,generation)){failure=['NotAllowedError','AbortError'].includes(error.name)?'La création a été annulée. Vous pouvez réessayer ou garder votre mot de passe.':error.message;showError();}}
    finally{if(same(id,generation)){busy=false;controller=null;if(button.isConnected)button.disabled=false;}}
  }
  function showError(){if(!content()||!failure)return;let notice=document.querySelector('#passkey-error');if(!notice){notice=document.createElement('p');notice.id='passkey-error';notice.className='notice';notice.setAttribute('role','alert');content().prepend(notice);}notice.textContent=failure;}
  async function remove(form){if(busy)return;const id=owner,generation=epoch;busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;try{data=await call(encodeURIComponent(form.dataset.id)+'/remove',{password:form.elements.password.value});if(same(id,generation)){dirty=false;failure='';paint(true);toast('Cette clé a été retirée.');}}catch(error){if(same(id,generation)){failure=error.message;showError();}}finally{if(same(id,generation)){busy=false;if(button.isConnected)button.disabled=false;}}}
  async function login(){
    if(!supported()){toast('Utilisez votre mot de passe sur cet appareil.',true);return;}if(busy||state?.user)return;const generation=epoch;busy=true;controller=new AbortController();const button=document.querySelector('[data-passkey-login]');if(button)button.disabled=true;
    try{const result=await api('passkeys/authenticate/options',{});if(generation!==epoch||state?.user)return;const credential=await navigator.credentials.get({publicKey:nativeOptions(result.options,false),signal:controller.signal});if(!credential||generation!==epoch||state?.user)return;await api('passkeys/authenticate/verify',{response:serialized(credential)});if(generation===epoch){await refresh();toast('Vous êtes connecté à Passerelle.');}}
    catch(error){if(generation===epoch&&!state?.user)toast(['NotAllowedError','AbortError'].includes(error.name)?'La demande a été annulée. Vous pouvez utiliser votre mot de passe.':error.message,true);}
    finally{if(generation===epoch){busy=false;controller=null;if(button?.isConnected)button.disabled=false;}}
  }
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-passkey-login]')){void login();return;}
    const button=event.target.closest('[data-passkey]');if(!button||button.disabled)return;
    const action=button.dataset.passkey;if(action==='open'){open();return;}if(action==='close'){controller?.abort();dialog()?.close();return;}if(action==='reload'){void load();return;}
    if(action==='remove-open'){const form=button.closest('.passkey-row').querySelector('form');form.hidden=false;dirty=true;form.elements.password.focus();return;}if(action==='remove-cancel'){const form=button.closest('form');form.reset();form.hidden=true;dirty=false;}
  });
  document.addEventListener('submit',event=>{if(event.target.id==='passkey-register-form'){event.preventDefault();void create(event.target);}else if(event.target.matches('.passkey-remove-form')){event.preventDefault();void remove(event.target);}});
  document.addEventListener('input',event=>{if(event.target.closest('#passkeys-content form'))dirty=true;});
  document.addEventListener('keydown',event=>{const el=dialog();if(!el?.open||event.key!=='Tab')return;const nodes=[...el.querySelectorAll('button,input,[tabindex="0"]')].filter(node=>!node.disabled&&node.getClientRects().length),first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}});
  document.addEventListener('close',event=>{if(event.target.id!=='passkeys-dialog')return;controller?.abort();dirty=false;failure='';content()?.replaceChildren();if(state?.user&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;},true);
  return {mount,reset,open,login,isEditing:user=>!!dialog()?.open&&user?.id===owner};
})();
