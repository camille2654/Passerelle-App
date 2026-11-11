const releasePortal = (() => {
  let owner=null, release=null, user=null, modal=null, timer=null, epoch=0, closing=false, returnFocus=null;
  const dismissed=new Set(), saving=new Set();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const key=()=>owner+':'+release?.id;
  const same=(id,generation)=>owner===id&&epoch===generation&&state?.user?.id===id;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  function schedule(delay=1200){clearTimeout(timer);if(owner&&release?.pending&&!dismissed.has(key()))timer=setTimeout(attempt,delay);}
  function attempt(){
    if(!owner||!release?.pending||dismissed.has(key())||modal?.open)return;
    if(document.hidden||!document.querySelector('#portal-main')||['new','active'].includes(user?.onboarding?.status)||document.querySelector('dialog[open]')||document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')){schedule(2000);return;}
    open();
  }
  function build(){
    if(modal)return;
    modal=document.createElement('dialog');modal.id='release-sheet';modal.className='release-sheet';modal.setAttribute('aria-labelledby','release-title');modal.setAttribute('aria-describedby','release-description');
    document.body.append(modal);
    modal.addEventListener('cancel',event=>{event.preventDefault();void dismiss();});
    modal.addEventListener('keydown',event=>{
      if(event.key!=='Tab')return;
      const controls=[...modal.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length);
      if(!controls.length){event.preventDefault();return;}
      const first=controls[0],last=controls.at(-1),active=document.activeElement;
      if(event.shiftKey&&(active===first||!controls.includes(active))){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&(active===last||!controls.includes(active))){event.preventDefault();first.focus();}
    });
    modal.addEventListener('click',event=>{
      if(event.target.closest('[data-release-dismiss]'))void dismiss();
      else if(event.target===modal){const r=modal.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)void dismiss();}
    });
    modal.addEventListener('close',()=>{document.body.classList.remove('release-sheet-open');});
  }
  function open(){
    if(!owner||!release||state?.user?.id!==owner||closing||document.querySelector('dialog[open]'))return;
    clearTimeout(timer);build();returnFocus=document.activeElement;
    const banner=typeof release.banner==='string'&&/^\.\/brand\/campaign\/[a-z0-9-]+\.(?:png|webp)$/.test(release.banner)?release.banner:'./brand/campaign/banner-app.webp';
    modal.innerHTML=`<div class="release-cover"><img src="${esc(banner)}" width="1920" height="640" alt="" decoding="async"><button type="button" class="release-close" data-release-dismiss aria-label="Fermer les nouveautés">${icon('close')}</button></div><button class="release-grip" type="button" data-release-dismiss aria-label="Fermer les nouveautés, ou glisser vers le bas"><span></span></button><div class="release-content"><p class="release-eyebrow">LA SUITE PREND FORME <span>Version ${esc(release.version)}</span></p><h2 id="release-title" tabindex="-1">${esc(release.title)}</h2><p id="release-description" class="release-description">${esc(release.subtitle)}</p><ul class="release-features">${(release.features||[]).slice(0,5).map((feature,index)=>`<li><span class="release-feature-icon release-accent-${index%3}">${icon(/^[a-z-]+$/.test(feature.icon)&&document.getElementById('i-'+feature.icon)?feature.icon:'news')}</span><div><h3>${esc(feature.title)}</h3><p>${esc(feature.description)}</p></div></li>`).join('')}</ul><button class="button release-continue" type="button" data-release-dismiss>C’est parti ${icon('arrow')}</button><p class="release-footnote">À retrouver dans Plus → Nouveautés de Passerelle.</p></div>`;
    wireSwipe(modal.querySelector('.release-grip'));document.body.classList.add('release-sheet-open');modal.showModal();modal.querySelector('#release-title').focus({preventScroll:true});
  }
  function wireSwipe(grip){
    let start=null,delta=0;
    grip.addEventListener('pointerdown',event=>{if(event.pointerType==='mouse'||closing)return;start=event.clientY;delta=0;grip.setPointerCapture(event.pointerId);});
    grip.addEventListener('pointermove',event=>{if(start===null)return;delta=Math.max(0,event.clientY-start);if(!reduced())modal.style.transform=`translateY(${delta}px)`;});
    const end=()=>{if(start===null)return;start=null;if(modal)modal.style.transform='';if(delta>72)void dismiss();delta=0;};
    grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',()=>{start=null;delta=0;if(modal)modal.style.transform='';});
  }
  async function acknowledge(id,releaseId,generation){
    const token=id+':'+releaseId;if(saving.has(token))return;saving.add(token);
    try{const result=await api('releases/seen',{releaseId});if(same(id,generation)&&release?.id===releaseId){release=result.release;user.release=release;state.user.release=release;}}
    catch{if(same(id,generation))toast('La fermeture n’a pas pu être enregistrée. Les nouveautés pourront réapparaître à la prochaine visite.',true);}
    finally{saving.delete(token);}
  }
  async function dismiss(){
    if(!modal?.open||closing)return;
    const id=owner,releaseId=release.id,generation=epoch,element=modal,shouldSave=release.pending;
    closing=true;dismissed.add(key());if(dismissed.size>32)dismissed.delete(dismissed.values().next().value);clearTimeout(timer);
    if(shouldSave)void acknowledge(id,releaseId,generation);
    element.classList.add('is-closing');await new Promise(resolve=>setTimeout(resolve,reduced()?0:210));
    if(!same(id,generation)||modal!==element)return;
    element.close();element.classList.remove('is-closing');closing=false;
    const target=returnFocus?.isConnected&&!returnFocus.closest('[hidden]')?returnFocus:document.querySelector('#portal-main');target?.focus({preventScroll:true});returnFocus=null;
  }
  function reset(){
    epoch++;clearTimeout(timer);timer=null;owner=null;release=null;user=null;closing=false;returnFocus=null;
    modal?.close();modal?.remove();modal=null;document.body.classList.remove('release-sheet-open');
  }
  function mount(next){
    if(!next){reset();return;}if(owner!==next.id){reset();owner=next.id;}
    user=next;const previous=release?.id;release=next.release||null;
    if(previous&&previous!==release?.id&&modal?.open){modal.close();modal.remove();modal=null;closing=false;}
    schedule();
  }
  document.addEventListener('click',event=>{if(event.target.closest('[data-release-open]'))open();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(800);});
  return {mount,reset,open,isEditing:next=>owner===next?.id&&!!modal?.open};
})();
