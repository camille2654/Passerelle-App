const menuPortal = (() => {
  const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
  const labelFormatter=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',weekday:'long',day:'numeric',month:'long'});
  const today=()=>dayFormatter.format(new Date());
  const label=value=>labelFormatter.format(new Date(value+'T12:00:00Z'));
  let owner='',selected=null,epoch=0,cache=new Map(),pending=new Set(),failures=new Map();
  function reset(){owner='';selected=null;epoch++;cache=new Map();pending=new Set();failures=new Map();}
  function paint(){
    const root=document.querySelector('#menu-root');if(!root)return;
    const detailsOpen=!!root.querySelector('.simple-menu-options[open]');const date=selected||today(),data=cache.get(date),loading=pending.has(date),error=failures.get(date);
    if(!personal.homeVisible('menu')){root.hidden=true;return;}
    if(!state.user?.skolengoConnected){root.hidden=true;return;}root.hidden=!selected&&!loading&&(!data||data.status!=='available'&&!data.next);if(root.hidden)return;
    root.innerHTML=`<div class="canteen-heading"><div><p class="eyebrow">${icon('cutlery')} À LA CANTINE</p><h2>Le menu ${date===today()?'d’aujourd’hui':'du '+escape(label(date))}</h2><p class="canteen-date">${escape(label(date))}</p></div></div><div class="canteen-content" aria-busy="${loading}">${error||data?.warning?`<p class="notice" role="alert">${escape(error||data.warning)}${data?.status==='available'?' Le dernier menu publié pour cette date reste affiché.':''}</p>`:''}${loading&&!data?motion.loader('Lecture du menu du lycée…',true):data?.status==='available'?`<ul class="canteen-dishes">${data.items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`:data?`<p class="canteen-empty">${data.status==='unreadable'?'Le PDF est disponible, mais sa lecture automatique n’a pas permis d’isoler cette journée.':data.status==='not_connected'?'Connectez votre ENT pour retrouver les menus.':'Aucun menu publié pour ce jour.'}</p>${data.next?`<button type="button" class="text-button canteen-next" data-menu-day="${escape(data.next.date)}">Voir le prochain menu · ${escape(label(data.next.date))} ${icon('arrow')}</button>`:''}`:''}${loading&&data?`<p class="canteen-updating">Mise à jour…</p>`:''}</div><details class="simple-menu-options" ${detailsOpen?'open':''}><summary>Autres jours et document original</summary><div class="canteen-controls"><button type="button" class="text-button" data-menu-today ${date===today()?'disabled':''}>Aujourd’hui</button><label><span class="sr-only">Choisir le jour du menu</span><input id="menu-date" type="date" value="${escape(date)}" aria-label="Choisir le jour du menu"></label><button type="button" class="text-button canteen-refresh" aria-label="Actualiser le menu" data-menu-refresh ${loading?'disabled':''}>${icon('sync')}</button></div>${data?.source?`<div class="canteen-source"><div><p>${escape(data.source.title)}</p>${data.status==='available'?`<span>${data.ocr?'Texte reconnu automatiquement dans le PDF.':'Extrait du PDF publié par le lycée.'} Les intitulés et labels se vérifient dans l’original.</span>`:''}</div><div>${data.imageRef?`<a href="${base}api/menu/image/${escape(data.imageRef)}" target="_blank" rel="noopener noreferrer">Voir l’extrait original ${icon('out')}</a>`:''}${data.source.fileRef?`<a href="${base}api/school/files/${escape(data.source.fileRef)}" download>Ouvrir le PDF ${icon('out')}</a>`:''}</div></div>`:''}</details>`;
  }
  async function load(force=false){
    if(!personal.homeVisible('menu')){paint();return;}
    if(!state.user?.skolengoConnected){paint();return;}
    const date=selected||today(),version=epoch;
    if(pending.has(date)){paint();return;}
    if(!force&&cache.has(date)&&Date.now()-cache.get(date).receivedAt<10*60000){paint();return;}
    pending.add(date);failures.delete(date);paint();
    try {const value=await api('menu?'+new URLSearchParams({date,...(force?{refresh:'1'}:{})}));if(version!==epoch)return;cache.set(date,{...value,receivedAt:Date.now()});while(cache.size>10)cache.delete(cache.keys().next().value);}
    catch(error){if(version===epoch)failures.set(date,error.message);}
    finally{if(version===epoch){pending.delete(date);if(date===(selected||today()))paint();}}
  }
  function mount(user){const identity=[user.id,user.studentId,user.schoolName,user.skolengoConnected].join(':');if(owner!==identity){reset();owner=identity;}paint();void load();}
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-menu-refresh]')){void load(true);return;}
    if(event.target.closest('[data-menu-today]')){selected=null;void load();return;}
    const day=event.target.closest('[data-menu-day]');if(day){selected=day.dataset.menuDay;void load();}
  });
  document.addEventListener('change',event=>{if(event.target.id==='menu-date'&&/^\d{4}-\d{2}-\d{2}$/.test(event.target.value)){selected=event.target.value===today()?null:event.target.value;void load();}});
  setInterval(()=>{if(!document.hidden&&state?.user&&document.querySelector('#app[data-page=school]')&&!document.activeElement?.matches('input,select,textarea'))void load();},60000);
  return {mount,reset};
})();
