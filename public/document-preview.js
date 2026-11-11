/* Only authenticated copies are fetched; cloud links keep opening at their source. */
const documentPreview=(()=>{
 const root=new URL('.',document.currentScript.src),types=new Set(['application/pdf','image/png','image/jpeg','image/webp']);
 let owner='',epoch=0,renderEpoch=0,controller=null,loadingTask=null,pdf=null,renderTask=null,url=null,origin=null,selected=null,page=1,zoom=1,image=null,modulePromise=null;
 const identity=u=>u?[u.id,u.studentId,u.schoolName].join(':'):'';
 const node=()=>document.querySelector('#document-preview-dialog'),stage=()=>document.querySelector('#document-preview-stage');
 const current=version=>version===epoch&&owner===identity(state.user)&&!!state.user&&!!node()?.open;
 function release(){controller?.abort();controller=null;renderEpoch++;renderTask?.cancel();renderTask=null;void loadingTask?.destroy()?.catch(()=>{});loadingTask=null;pdf=null;if(url)URL.revokeObjectURL(url);url=null;image=null;selected=null;}
 function reset(){epoch++;release();node()?.close();node()?.replaceChildren();owner='';origin=null;}
 function bind(user){const next=identity(user);if(owner!==next){reset();owner=next;}}
 function shell(){
  if(!node()){const el=document.createElement('dialog');el.id='document-preview-dialog';el.className='document-preview-dialog';el.setAttribute('aria-labelledby','document-preview-title');document.body.append(el);}
  node().innerHTML=`<header class="preview-heading"><div><p>Aperçu du document</p><h2 id="document-preview-title"></h2></div><button type="button" class="icon-button" data-preview-close aria-label="Fermer l’aperçu">${icon('close')}</button></header><div class="preview-toolbar" role="group" aria-label="Parcourir et agrandir le document"><button type="button" class="icon-button preview-previous" data-preview-page="-1" aria-label="Page précédente" disabled>${icon('arrow')}</button><span id="preview-pages" role="status"></span><button type="button" class="icon-button" data-preview-page="1" aria-label="Page suivante" disabled>${icon('arrow')}</button><span class="preview-toolbar-space"></span><button type="button" class="icon-button" data-preview-zoom="-1" aria-label="Réduire le document" disabled>−</button><button type="button" class="text-button" data-preview-fit disabled>Ajuster</button><button type="button" class="icon-button" data-preview-zoom="1" aria-label="Agrandir le document" disabled>+</button><a id="preview-download" class="button secondary" download>Télécharger ${icon('download')}</a></div><p id="preview-feedback" role="status"></p><div id="document-preview-stage" class="preview-stage" aria-busy="true"></div>`;
 }
 function message(text,error=false){const el=document.querySelector('#preview-feedback');if(el){el.textContent=text;el.classList.toggle('is-error',error);}}
 function controls(){
  if(!node()?.open)return;const ready=!!pdf||!!image;
  node().querySelector('[data-preview-page="-1"]').disabled=!pdf||page<=1;
  node().querySelector('[data-preview-page="1"]').disabled=!pdf||page>=pdf.numPages;
  node().querySelector('[data-preview-zoom="-1"]').disabled=!ready||zoom<=.5;
  node().querySelector('[data-preview-zoom="1"]').disabled=!ready||zoom>=3;
  const fit=node().querySelector('[data-preview-fit]');fit.disabled=!ready;fit.textContent=zoom===1?'Ajuster':Math.round(zoom*100)+' %';
  document.querySelector('#preview-pages').textContent=pdf?'Page '+page+' / '+pdf.numPages:image?'Photo':'';
 }
 async function render(){
  const version=epoch,ticket=++renderEpoch,container=stage();if(!current(version)||!container)return;
  renderTask?.cancel();renderTask=null;container.setAttribute('aria-busy','true');controls();
  try{
   const width=Math.max(180,container.clientWidth-32);
   if(image){const view=document.createElement('img');view.src=url;view.alt=selected.name;view.style.width=Math.round(Math.min(image.naturalWidth,width)*zoom)+'px';view.draggable=false;if(current(version)&&ticket===renderEpoch)container.replaceChildren(view);}
   else if(pdf){
    message('Affichage de la page…');const doc=pdf,number=page,value=await doc.getPage(number);if(!current(version)||ticket!==renderEpoch)return;
    const natural=value.getViewport({scale:1}),viewport=value.getViewport({scale:width/natural.width*zoom});
    const ratio=Math.min(devicePixelRatio||1,2,Math.sqrt(6000000/(viewport.width*viewport.height))),canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));canvas.style.width=Math.round(viewport.width)+'px';canvas.style.height=Math.round(viewport.height)+'px';canvas.setAttribute('role','img');canvas.setAttribute('aria-label',selected.name+' · page '+number+' sur '+doc.numPages);
    const task=value.render({canvasContext:canvas.getContext('2d'),viewport,transform:ratio===1?null:[ratio,0,0,ratio,0,0]});renderTask=task;await task.promise;
    if(!current(version)||ticket!==renderEpoch)return;container.replaceChildren(canvas);renderTask=null;
   }
   if(current(version)&&ticket===renderEpoch)message('');
  }catch(error){if(current(version)&&ticket===renderEpoch&&error.name!=='RenderingCancelledException')message('Cette page ne peut pas être affichée. Vous pouvez télécharger le document.',true);}
  finally{if(current(version)&&ticket===renderEpoch)container.setAttribute('aria-busy','false');}
 }
 async function open({kind,id,name},trigger){
  if(!state.user||!['favorite','resource'].includes(kind)||!id)return;
  bind(state.user);epoch++;release();const version=epoch;origin=trigger||document.activeElement;selected={kind,id,name:name||'Document'};page=1;zoom=1;shell();
  document.querySelector('#document-preview-title').textContent=selected.name;
  const prefix=kind==='favorite'?'favorites':'work-resources',path=new URL('api/'+prefix+'/'+encodeURIComponent(id)+'/',root);
  document.querySelector('#preview-download').href=new URL(kind==='favorite'?'download':'open',path).href;
  motion.open(node());message('Ouverture du document…');const endRequest=motion.request();const abort=new AbortController();controller=abort;
  const timeout=setTimeout(()=>abort.abort(),60000);let password=false;
  try{
   const response=await fetch(new URL('preview',path),{headers:{'x-passerelle-account':state.user.id,'x-passerelle-student':encodeURIComponent(state.user.studentId||'')},signal:abort.signal,cache:'no-store'});
   if(!current(version))return;
   if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'Le document ne peut pas être ouvert. Réessayez depuis vos favoris.');}
   const type=response.headers.get('content-type')?.split(';')[0];if(!types.has(type))throw new Error('Ce format peut être téléchargé, mais son aperçu n’est pas disponible.');
   const bytes=await response.arrayBuffer();if(!current(version))return;if(bytes.byteLength>30*1048576)throw new Error('Ce document est trop volumineux pour l’aperçu.');
   if(type==='application/pdf'){
    modulePromise??=import(new URL('vendor/pdfjs-6.5.438/pdf.mjs',root).href).catch(error=>{modulePromise=null;throw error;});const lib=await modulePromise;if(!current(version))return;
    lib.GlobalWorkerOptions.workerSrc=new URL('vendor/pdfjs-6.5.438/pdf.worker.mjs',root).href;
    const task=lib.getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useWasm:false,enableXfa:false,maxImageSize:32000000,canvasMaxAreaInBytes:24000000,standardFontDataUrl:new URL('vendor/pdfjs-6.5.438/standard_fonts/',root).href,cMapUrl:new URL('vendor/pdfjs-6.5.438/cmaps/',root).href,cMapPacked:true,iccUrl:new URL('vendor/pdfjs-6.5.438/iccs/',root).href,disableWorkerRendering:true});
    loadingTask=task;task.onPassword=()=>{password=true;void task.destroy().catch(()=>{});};
    const value=await task.promise;if(!current(version)){void task.destroy().catch(()=>{});return;}pdf=value;
   }else{url=URL.createObjectURL(new Blob([bytes],{type}));const value=new Image();value.src=url;await value.decode();if(!current(version))return;image=value;}
   controls();await render();
  }catch(error){if(current(version)){stage()?.setAttribute('aria-busy','false');message(password?'Ce PDF demande un mot de passe. Téléchargez-le pour l’ouvrir dans votre lecteur.':error.name==='AbortError'?'L’ouverture a été interrompue. Fermez l’aperçu puis réessayez.':error.name==='Error'?error.message:'L’aperçu ne peut pas être affiché. Vous pouvez télécharger le document.',true);}}
  finally{clearTimeout(timeout);endRequest();}
 }
 async function close(){const trigger=origin,el=node();if(el?.open)await motion.close(el);reset();if(state.user)owner=identity(state.user);if(trigger?.isConnected)trigger.focus({preventScroll:true});}
 document.addEventListener('click',event=>{
  const link=event.target.closest('[data-document-preview]');if(link&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey){event.preventDefault();void open({kind:link.dataset.documentPreview,id:link.dataset.documentId,name:link.dataset.documentName||link.textContent.trim()},link);return;}
  if(event.target.closest('[data-preview-close]')){void close();return;}
  if(!node()?.open)return;
  const pager=event.target.closest('[data-preview-page]');if(pager&&!pager.disabled&&pdf){page=Math.max(1,Math.min(pdf.numPages,page+Number(pager.dataset.previewPage)));void render();return;}
  const magnify=event.target.closest('[data-preview-zoom]');if(magnify&&!magnify.disabled){zoom=Math.max(.5,Math.min(3,Math.round((zoom+Number(magnify.dataset.previewZoom)*.25)*100)/100));void render();return;}
  if(event.target.closest('[data-preview-fit]')){zoom=1;void render();}
 });
 document.addEventListener('cancel',event=>{if(event.target===node()){event.preventDefault();void close();}},true);
 document.addEventListener('close',event=>{if(event.target===node()&&selected&&!node()?.open)reset();},true);
 let resizing;window.addEventListener('resize',()=>{clearTimeout(resizing);resizing=setTimeout(()=>{if(node()?.open&&(pdf||image))void render();},120);});
 return {bind,reset,open};
})();
