/* Catalogue metadata only; no credentials or school profiles are stored here. */
const entConnect=(()=>{
 let providers=null,pending=null,owner='',epoch=0;
 async function mount(user){
  const next=user?[user.id,user.studentId,user.schoolName].join(':'):'';
  if(next!==owner){owner=next;epoch++;}
  if(!user)return;
  const version=epoch,select=document.querySelector('#ent-provider');if(!select)return;
  try{
   if(!providers){pending??=api('ent/providers').then(value=>{providers=value.providers;return providers;}).finally(()=>{pending=null;});await pending;}
   if(epoch!==version||!select.isConnected)return;
   const selected=select.value;select.replaceChildren(new Option('Tous les ENT Skolengo',''));
   for(const p of providers.filter(item=>item.family==='skolengo'))select.add(new Option(p.label+' · '+p.region,p.id));
   select.value=selected;
  }catch{/* National school search and manual portal entry remain usable. */}
 }
 document.addEventListener('submit',event=>{
  const form=event.target;if(form.id!=='ent-web-form')return;event.preventDefault();
  const version=epoch,node=form.querySelector('[role=alert]');node.hidden=true;
  void act(form.querySelector('[type=submit]'),async()=>{try{await startENTConnection('ent/start',{portalURL:form.elements.portalURL.value.trim(),accountPin:form.elements.accountPin.value});}catch(error){if(version===epoch&&node.isConnected){node.textContent=error.message;node.hidden=false;}throw error;}});
 });
 return {mount};
})();
