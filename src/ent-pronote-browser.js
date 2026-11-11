import {parsePronoteBootstrap,hasENTCredentials} from './pronote-bootstrap.js';
export {hasENTCredentials} from './pronote-bootstrap.js';
import {allowedEntURL,portalForURL} from './ent-providers.js';
import {PublicError} from './sync.js';
import {entRedirectDocument} from './ent-redirect.js';
const isStudentURL=input=>{try{const u=new URL(input);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^[a-z0-9-]+\.index-education\.net$/i.test(u.hostname)&&/^\/pronote\/(?:mobile\.)?eleve\.html$/.test(u.pathname);}catch{return false;}};
// A copied PRONOTE URL is an entry point only through the user's known ENT.
// Strip one-time tickets and login=true so the normal ENT/CAS redirect can run.
export function resolveEntConnection(input,school) {
 if(input!==undefined&&(typeof input!=='string'||input.length>1500))throw new PublicError('L’adresse de connexion est invalide.');
 const value=String(input||'').trim()||school?.homePageUrl;
 if(!value)throw new PublicError('Choisissez votre établissement ou renseignez son adresse ENT dans les options de connexion.');
 let url;try{url=new URL(value);}catch{throw new PublicError('Renseignez l’adresse HTTPS de votre ENT ou le lien PRONOTE de votre établissement.');}
 if(/(?:^|\.)index-education\.net$/i.test(url.hostname)){
  if(['/pronote','/pronote/'].includes(url.pathname))url.pathname='/pronote/eleve.html';
  url.search='';url.hash='';
  if(!isStudentURL(url.href))throw new PublicError('Ce lien doit ouvrir un espace Élève PRONOTE hébergé sur index-education.net.');
  const portal=portalForURL(school?.homePageUrl,school?.emsCode)||portalForURL(school?.homePageUrl);
  if(!portal)throw new PublicError('Connectez d’abord votre établissement à son ENT pour utiliser ce lien PRONOTE.',409);
  return {portal,entryURL:url.href};
 }
 const portal=portalForURL(value,school?.emsCode)||portalForURL(value);
 if(!portal)throw new PublicError('Ce portail ENT n’a pas encore de connecteur. Utilisez l’adresse habituelle d’un portail proposé, ou signalez votre établissement à l’assistance.',422);
 return {portal,entryURL:null};
}
/* Reuses the same two-session browser capacity, screenshots and keyboard route.
 * Capture the SSO bootstrap before its JavaScript spends the one-time secret.
 * HTML/cookies stay in memory and are passed over stdin to the private worker. */
export async function startEntPronote(manager,user,input,{onCapture,preferred,entryURL=null,transferTimeoutMs=90000}={}) {
 const portal=portalForURL(input,preferred);
 if(!portal)throw new PublicError('Ce portail ENT n’a pas encore de connecteur. Utilisez l’adresse habituelle d’un portail proposé, ou signalez votre établissement à l’assistance.',422);
 if(entryURL&&(!isStudentURL(entryURL)||!allowedEntURL(entryURL,portal.provider)))throw new PublicError('Le lien PRONOTE est invalide.');
 if(manager.starting)throw new PublicError('Une fenêtre ENT est en cours d’ouverture. Réessayez dans un instant.',429);
 manager.starting=true;
 try{
  await manager.stop(user.id);
  if(manager.items.size>=2)throw new PublicError('Les fenêtres ENT sont occupées. Réessayez dans un instant.',429);
  const browser=await manager.getBrowser();
  const context=await browser.newContext({viewport:{width:1000,height:740},locale:'fr-FR',acceptDownloads:false,serviceWorkers:'block'});
  const page=await context.newPage();page.setDefaultTimeout(12000);
  const item={context,page,status:'loading',busy:false,expires:Date.now()+12*60000};manager.items.set(user.id,item);
  item.timer=setTimeout(()=>{void manager.stop(user.id);},12*60000);item.timer.unref();
  const current=()=>manager.items.get(user.id)===item;
  const note=(code,method='GET',count,stage)=>{if(item.lastNote===code)return;item.lastNote=code;manager.onDiagnostic?.(user,{code,method,count,...(stage?{stage}:{})});};
  const fail=(message,code,stage)=>{if(!current())return;item.status='error';item.error=message;note(code,'GET',undefined,stage);clearTimeout(item.transferTimer);void context.close().catch(()=>{});};
  const deadline=()=>{if(!item.transferTimer){item.transferTimer=setTimeout(()=>fail('PRONOTE s’est ouvert, mais sa connexion n’a pas été transmise à Passerelle. Fermez cette fenêtre puis relancez PRONOTE depuis la rubrique de votre ENT.','SSO_TRANSFER_NOT_DETECTED'),transferTimeoutMs);item.transferTimer.unref();}};
  const isPronotePage=url=>/^[a-z0-9-]+\.index-education\.net$/i.test(url.hostname)&&/^\/pronote(?:\/|\/(?:mobile\.)?eleve\.html)?$/.test(url.pathname);
  const redirects=new Map();
  // The first navigation of a popup can arrive before Chromium creates its
  // frame. Request.frame() then throws even though the server responded normally.
  const redirectFrame=request=>{try{return request.frame?.()||page;}catch{return page;}};
  context.on('request',request=>{if(!current()||!['loading','login'].includes(item.status)||!request.isNavigationRequest())return;try{if(isPronotePage(new URL(request.url()))){note('SSO_PRONOTE_NAVIGATION',request.method());deadline();}}catch{}});
  context.on('page',p=>{p.setDefaultTimeout(12000);p.on('dialog',d=>void d.dismiss());if(current())item.page=p;p.on('close',()=>{if(current()&&item.page===p&&!['processing','confirmation','error'].includes(item.status)){const remaining=context.pages().filter(other=>!other.isClosed());if(remaining.length)item.page=remaining.at(-1);else{item.status='error';item.error='La fenêtre ENT a été fermée. Relancez la connexion.';}}});});
  page.on('dialog',d=>void d.dismiss());
  await context.route('**/*',async route=>{
   let stage='policy';
   try{
    const request=route.request(),url=request.url();
    if(!current()||!allowedEntURL(url,portal.provider))return await route.abort();
    if(['processing','confirmation','error'].includes(item.status))return await route.abort();
    const target=new URL(url);const pronotePage=isPronotePage(target);
    if(['GET','POST'].includes(request.method())&&request.isNavigationRequest()){
     stage='navigation-fetch';
     const response=await route.fetch({maxRedirects:0,timeout:20000});
     stage='navigation-response';
     const headers=response.headers();
     const redirect=entRedirectDocument(request,response.status(),headers,portal.provider);
     if(redirect){const frame=redirectFrame(request),count=(redirects.get(frame)||0)+1;redirects.set(frame,count);if(count>20){await route.abort();fail('Le portail ENT tourne en boucle pendant la connexion. Fermez cette fenêtre puis réessayez.','SSO_REDIRECT_LOOP');return;}note('SSO_REDIRECT_RESTARTED',request.method());await route.fulfill({response,status:200,...redirect});return;}
     redirects.delete(redirectFrame(request));
     if(pronotePage&&response.status()===200 && (headers['content-type']||'').includes('text/html')){
      stage='bootstrap';
      const size=Number(headers['content-length']||0);if(size>1024*1024){await route.abort();throw new Error('BOOTSTRAP_TOO_LARGE');}
      const bytes=await response.body();if(bytes.length>1024*1024){await route.abort();throw new Error('BOOTSTRAP_TOO_LARGE');}
      const html=bytes.toString('utf8');
      const attributes=parsePronoteBootstrap(html);
      note(attributes?'SSO_BOOTSTRAP_'+(target.pathname.replace(/\/$/,'')==='/pronote'?'ROOT':'STUDENT')+'_'+(hasENTCredentials(html)?'CREDENTIALS':'NO_CREDENTIALS'):'SSO_BOOTSTRAP_NOT_RECOGNIZED',request.method());
      if(attributes&&Number(attributes.a)!==3){await route.abort();fail('Votre ENT a ouvert un autre espace PRONOTE. Ouvrez l’espace Élève pour le relier à Passerelle.','SSO_WRONG_SPACE');return;}
      if(hasENTCredentials(html)){
       stage='handoff';
       clearTimeout(item.transferTimer);item.status='processing';item.hint='Connexion PRONOTE reçue. Importation de vos informations…';
       const cookies=await context.cookies(url);note('SSO_TRANSFER_STARTED',request.method(),cookies.length);
       // Stop browser authentication before forwarding the untouched bootstrap.
       await route.abort();
       try{
        const studentURL=new URL(url);studentURL.pathname=target.pathname.includes('mobile.')?'/pronote/mobile.eleve.html':'/pronote/eleve.html';studentURL.search='';studentURL.hash='';
        await onCapture({url:studentURL.href,html,cookies,attributes},portal);
        if(current()){item.status='confirmation';await context.close();}
       }catch(error){if(current()){item.status='error';item.error=error instanceof PublicError?error.message:'La connexion PRONOTE depuis l’ENT n’a pas abouti. Réessayez depuis votre ENT.';await context.close().catch(()=>{});}}
       return;
      }
      item.hint='PRONOTE est ouvert. En attente de la transmission de la connexion ENT…';
      deadline();
     }
     return await route.fulfill({response});
    }
    // During token exchange no additional requests may consume SSO credentials.
    if(item.status==='processing')return await route.abort();
    stage='asset';
    await route.continue();
   }catch(error){if(current()&&!['confirmation','error'].includes(item.status))fail(error instanceof PublicError?error.message:'Passerelle n’a pas pu récupérer la connexion de l’ENT. Fermez cette fenêtre puis réessayez.',error instanceof PublicError?error.code:'SSO_CAPTURE_FAILED',stage);await route.abort().catch(()=>{});}
  });
  try{await page.goto(entryURL||portal.url,{waitUntil:'domcontentloaded',timeout:30000});if(item.status==='loading')item.status='login';}
  catch{if(item.status==='loading'){await manager.stop(user.id);throw new PublicError('Le portail ENT n’a pas pu être ouvert. Vérifiez son adresse.',502);}}
  return {status:item.status};
 }finally{manager.starting=false;if(!manager.items.size&&manager.browser){const browser=manager.browser;manager.browser=null;await browser.close().catch(()=>{});}}
}
