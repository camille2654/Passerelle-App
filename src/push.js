import {eventScope} from './event-scope.js';
import webpush from 'web-push';
import {ECDH,randomUUID} from 'node:crypto';
import {digest} from './store.js';
import {PublicError} from './sync.js';
import {parisDate,buildBrief} from './work.js';
import {vacationPaused} from './personal.js';
import {accountActive,automationAllowed} from './operational-state.js';

const minutes=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const at=value=>Number(value.slice(0,2))*60+Number(value.slice(3));
const defaults={changes:true,homework:false,events:false,brief:false,time:'20:00',quiet:{enabled:true,start:'22:00',end:'07:00'}};
const time=value=>typeof value==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function pushPreferences(user){const value=user.pushPreferences||{};return {...defaults,...value,quiet:{...defaults.quiet,...value.quiet}};}
export function quietAt(config,date=new Date()){
  if(!config.quiet.enabled)return false;
  const start=at(config.quiet.start),end=at(config.quiet.end),value=at(minutes.format(date));
  return start<end?value>=start&&value<end:value>=start||value<end;
}
export function normalizePushPreferences(input,previous=defaults){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new PublicError('Préférences de notification invalides.');
  const result={...defaults,...previous,quiet:{...defaults.quiet,...previous.quiet}};
  for(const key of ['changes','homework','events','brief'])if(input[key]!==undefined){if(typeof input[key]!=='boolean')throw new PublicError('Choisissez les notifications à recevoir.');result[key]=input[key];}
  if(input.time!==undefined){if(!time(input.time))throw new PublicError('Choisissez une heure de brief valide.');result.time=input.time;}
  if(input.quiet!==undefined){if(!input.quiet||typeof input.quiet.enabled!=='boolean'||!time(input.quiet.start)||!time(input.quiet.end)||input.quiet.start===input.quiet.end)throw new PublicError('Choisissez un début et une fin différents pour les heures calmes.');result.quiet={enabled:input.quiet.enabled,start:input.quiet.start,end:input.quiet.end};}
  if(result.brief&&quietAt(result,new Date('2026-01-15T'+result.time+':00+01:00')))throw new PublicError('Choisissez une heure de brief en dehors de vos heures calmes.');
  return result;
}
export function validatePushSubscription(input,now=Date.now()){
  if(!input||typeof input!=='object'||typeof input.endpoint!=='string'||input.endpoint.length>4000)throw new PublicError('Abonnement de cet appareil invalide.');
  let url;try{url=new URL(input.endpoint);}catch{throw new PublicError('Service de notification invalide.');}
  const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','push.services.mozilla.com'].includes(url.hostname)||/^(?:[a-z0-9-]+\.)+push\.apple\.com$/.test(url.hostname);
  if(!allowed||url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.hash||url.pathname==='/')throw new PublicError('Ce service de notification n’est pas pris en charge.');
  const key=(value,length)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]+={0,2}$/.test(value))throw new PublicError('Clé de notification invalide.');const bytes=Buffer.from(value,'base64url');if(bytes.length!==length||bytes.toString('base64url')!==value.replace(/=+$/,''))throw new PublicError('Clé de notification invalide.');return bytes;};
  const point=key(input.keys?.p256dh,65),auth=key(input.keys?.auth,16);try{if(point[0]!==4)throw new Error();ECDH.convertKey(point,'prime256v1');}catch{throw new PublicError('Clé de notification invalide.');}
  if(input.expirationTime!=null&&(!Number.isSafeInteger(input.expirationTime)||input.expirationTime<=now))throw new PublicError('L’autorisation de cet appareil a expiré.');
  return {endpoint:url.href,expirationTime:input.expirationTime??null,keys:{p256dh:point.toString('base64url'),auth:auth.toString('base64url')}};
}
export const activePushSession=(store,user,device)=>accountActive(user)&&store.state.sessions.some(session=>session.userId===user.id&&session.hash===device.sessionHash&&session.expires>Date.now());
export function detachPushSession(store,user,sessionHash){if(!user.pushDevices?.some(device=>device.sessionHash===sessionHash))return;user.pushDevices=user.pushDevices.filter(device=>device.sessionHash!==sessionHash);store.save();}

export class PushEngine {
  constructor(store,baseURL,{clock=()=>Date.now(),audit=null,transport=webpush.sendNotification.bind(webpush)}={}){
    Object.assign(this,{store,baseURL,clock,audit,transport});this.running=false;this.closed=false;
    const url=new URL(baseURL);this.ready=url.protocol==='https:'||['127.0.0.1','localhost'].includes(url.hostname);
    if(!store.state.settings.webPushKeys){store.state.settings.webPushKeys=store.seal(webpush.generateVAPIDKeys());store.save();}
    this.keys=store.open(store.state.settings.webPushKeys);
  }
  settings(user){return {accountId:user.id,ready:this.ready,publicKey:this.keys.publicKey,preferences:pushPreferences(user),devices:(user.pushDevices||[]).map(device=>({id:device.id,label:device.label,createdAt:device.createdAt,lastSeenAt:device.lastSeenAt,lastSentAt:device.lastSentAt||null,active:activePushSession(this.store,user,device),lastError:device.lastError||null,lastDelivery:device.lastDelivery||null})),serverNow:this.clock()};}
  updatePreferences(user,preferences){const previous=pushPreferences(user);user.pushStarts={...user.pushStarts};for(const key of ['changes','homework','events'])if(preferences[key]&&(!previous[key]||user.pushStarts[key]===undefined))user.pushStarts[key]=key==='events'?(user.eventSuggestionsSeq||0):(user.activitySeq||0);user.pushPreferences=preferences;}
  subscribe(req,input){
    if(!this.ready)throw new PublicError('Les notifications nécessitent une connexion HTTPS.',409);
    const user=req.user,subscription=validatePushSubscription(input.subscription,this.clock()),hash=digest(subscription.endpoint),preferences=normalizePushPreferences(input.preferences||{},pushPreferences(user));
    const own=(user.pushDevices||[]).find(device=>device.endpointHash===hash);
    if(!own&&(user.pushDevices||[]).length>=5)throw new PublicError('Cinq appareils sont déjà activés. Retirez un ancien appareil pour continuer.',409);
    // Explicit activation transfers this browser's endpoint without revealing another account.
    for(const other of this.store.state.users)if(other.id!==user.id)other.pushDevices=(other.pushDevices||[]).filter(device=>device.endpointHash!==hash);
    const device={id:own?.id||randomUUID(),endpointHash:hash,subscriptionHash:digest(JSON.stringify(subscription)),subscription:this.store.seal(subscription),label:/mobile|android|iphone|ipad/i.test(req.get('user-agent')||'')?'Téléphone ou tablette':'Ordinateur',createdAt:own?.createdAt||this.clock(),lastSeenAt:this.clock(),sessionHash:req.session.hash,profile:user.studentId||null,cursor:user.activitySeq||0,eventCursor:user.eventSuggestionsSeq||0,lastBriefDate:own?.lastBriefDate||null,lastDelivery:own?.lastDelivery||null};
    user.pushDevices=[...(user.pushDevices||[]).filter(item=>item.id!==device.id),device];this.updatePreferences(user,preferences);this.store.save();
    this.audit?.record('push.subscribed',{source:'push',userId:user.id,meta:{jobId:device.id,count:user.pushDevices.length}});return {deviceId:device.id,...this.settings(user)};
  }
  device(req,input){const subscription=validatePushSubscription(input.subscription,this.clock()),hash=digest(subscription.endpoint),device=(req.user.pushDevices||[]).find(item=>item.endpointHash===hash&&item.subscriptionHash===digest(JSON.stringify(subscription)));if(!device)return {deviceId:null,...this.settings(req.user)};if(device.sessionHash!==req.session.hash||this.clock()-(device.lastSeenAt||0)>86400000){device.sessionHash=req.session.hash;device.lastSeenAt=this.clock();this.store.save();}return {deviceId:device.id,...this.settings(req.user)};}
  preferences(user,input){this.updatePreferences(user,normalizePushPreferences(input,pushPreferences(user)));this.store.save();this.audit?.record('push.preferences',{source:'push',userId:user.id});return this.settings(user);}
  remove(user,id){const device=(user.pushDevices||[]).find(item=>item.id===id);if(!device)throw new PublicError('Cet appareil n’est plus associé à votre compte.',404);user.pushDevices=user.pushDevices.filter(item=>item.id!==id);this.store.save();this.audit?.record('push.removed',{source:'push',userId:user.id,meta:{jobId:id}});return this.settings(user);}
  message(kind,both=false){return {version:1,title:kind==='test'?'Passerelle · Notifications activées':kind==='brief'?'Votre brief de demain':kind==='events'?'Un rendez-vous à vérifier':'Votre agenda a changé',body:kind==='test'?'Les notifications fonctionnent sur cet appareil.':kind==='events'?'Une date a été repérée dans vos informations ou messages. Vérifiez la proposition dans Passerelle.':kind==='brief'?both?'Votre journée de demain et vos nouveautés sont à consulter dans Passerelle.':'Consultez vos cours, devoirs et contrôles pour demain dans Passerelle.':'Des nouveautés sont à consulter dans Passerelle.',kind,target:kind==='events'?'events':kind==='changes'?'changes':kind==='brief'?'tomorrow':'home',tag:'passerelle-'+kind};}
  async send(user,device,kind,{both=false,manual=false}={}){
    if(!activePushSession(this.store,user,device)||!user.pushDevices?.some(item=>item.id===device.id)){if(manual)throw new PublicError('Cet appareil doit être réactivé.',409);return false;}
    if(!manual&&!automationAllowed(this.store.state.settings,'push',this.clock()))return false;
    const now=this.clock();device.lastAttempt=now;this.store.save();
    try{
      const subscription=validatePushSubscription(this.store.open(device.subscription),now);
      const response=await this.transport(subscription,JSON.stringify(this.message(kind,both)),{vapidDetails:{subject:this.baseURL.startsWith('https:')?this.baseURL+'/':'https://example.invalid/',...this.keys},TTL:kind==='brief'?1800:300,urgency:'normal',topic:digest('passerelle:'+kind).slice(0,24),timeout:8000,...(process.env.HTTPS_PROXY||process.env.HTTP_PROXY?{proxy:process.env.HTTPS_PROXY||process.env.HTTP_PROXY}:{})});
      if(![200,201,202].includes(response?.statusCode))throw Object.assign(new Error('PUSH_NOT_ACCEPTED'),{statusCode:response?.statusCode});
      // A logout while a request is in flight must not recreate the removed device.
      if(user.pushDevices?.some(item=>item.id===device.id)){Object.assign(device,{lastSentAt:now,lastError:null,failures:0,retryAt:null,lastDelivery:{status:'accepted',at:now}});this.store.save();}
      this.audit?.record('push.accepted',{source:'push',userId:user.id,meta:{jobId:device.id,status:response.statusCode,mode:kind}});return true;
    }catch(error){
      const status=Number(error.statusCode)||0;
      if([404,410].includes(status)){user.pushDevices=(user.pushDevices||[]).filter(item=>item.id!==device.id);this.store.save();}
      else if(user.pushDevices?.some(item=>item.id===device.id)){const failures=Math.min(10,(device.failures||0)+1),retry=Number(error.headers?.['retry-after']);Object.assign(device,{failures,retryAt:now+Math.max(60000,Math.min(6*3600000,Number.isFinite(retry)&&retry>0?retry*1000:60000*2**(failures-1))),lastError:'L’envoi a été interrompu. Une nouvelle tentative sera faite.',lastDelivery:{status:'failed',at:now}});this.store.save();}
      this.audit?.record('push.failed',{source:'push',level:'warn',userId:user.id,meta:{jobId:device.id,status,errorCode:[404,410].includes(status)?'PUSH_EXPIRED':'PUSH_RETRY'}});
      if(manual)throw new PublicError([404,410].includes(status)?'L’autorisation a expiré. Activez à nouveau cet appareil.':'Le service de notification ne répond pas. Réessayez plus tard.',502);
      return false;
    }
  }
  async test(req,id){const device=(req.user.pushDevices||[]).find(item=>item.id===id&&item.sessionHash===req.session.hash);if(!device)throw new PublicError('Activez les notifications sur cet appareil.',409);if(device.lastTestAt&&this.clock()-device.lastTestAt<30000)throw new PublicError('Attendez trente secondes avant un nouveau test.',429);device.lastTestAt=this.clock();this.store.save();await this.send(req.user,device,'test',{manual:true});return {accepted:true,message:'Le service a accepté le test. Vérifiez la notification sur cet appareil.'};}
  async tick(){
    if(this.running||this.closed||!this.ready||!automationAllowed(this.store.state.settings,'push',this.clock()))return;
    this.running=true;const began=performance.now();let sent=0;
    try{
      const now=this.clock(),date=parisDate(new Date(now)),rows=this.store.state.users.filter(accountActive).flatMap(user=>(user.pushDevices||[]).map(device=>({user,device}))).sort((a,b)=>(a.device.lastAttempt||0)-(b.device.lastAttempt||0));
      for(const {user,device}of rows){
        if(this.closed||sent>=25||performance.now()-began>20000||!automationAllowed(this.store.state.settings,'push',this.clock()))break;
        if(!activePushSession(this.store,user,device)||device.retryAt>now)continue;
        if(device.profile!==(user.studentId||null)){Object.assign(device,{profile:user.studentId||null,cursor:user.activitySeq||0,eventCursor:user.eventSuggestionsSeq||0,lastBriefDate:null});user.pushStarts={changes:user.activitySeq||0,homework:user.activitySeq||0,events:user.eventSuggestionsSeq||0};this.store.save();}
        const config=pushPreferences(user),seq=user.activitySeq||0;
        const changes=(user.activityLog||[]).filter(item=>item.seq>(device.cursor||0)&&item.at>now-86400000&&item.date>=date&&(item.entity==='course'&&config.changes&&item.seq>(user.pushStarts?.changes||0)&&(['cancelled','restored'].includes(item.type)||item.type==='updated'&&['start','end','location'].some(key=>item.before?.[key]!==item.after?.[key]))||item.entity==='work'&&config.homework&&item.seq>(user.pushStarts?.homework||0)));
        const eventSeq=user.eventSuggestionsSeq||0,eventChanges=config.events&&user.eventSuggestionsScope===eventScope(user)?(user.eventNoticeQueue||[]).filter(item=>item.seq>Math.max(device.eventCursor||0,user.pushStarts?.events||0)&&item.at>now-86400000&&item.date>=date):[];
        if(!eventChanges.length&&device.eventCursor!==eventSeq){device.eventCursor=eventSeq;this.store.save();}
        const due=at(minutes.format(new Date(now)))-at(config.time),brief=buildBrief(user,new Date(now));
        const briefDue=config.brief&&!vacationPaused(user,new Date(now))&&device.lastBriefDate!==date&&due>=0&&due<90&&(brief.courses.length||brief.homework.length||brief.exams.length);
        if(!changes.length&&device.cursor!==seq){device.cursor=seq;this.store.save();}
        if((!changes.length&&!eventChanges.length&&!briefDue)||quietAt(config,new Date(now))||now-(device.lastSentAt||0)<60000)continue;
        const kind=briefDue?'brief':changes.length?'changes':'events';
        sent++;const ok=await this.send(user,device,kind,{both:briefDue&&changes.length>0});
        if(ok&&user.pushDevices?.some(item=>item.id===device.id)){device.cursor=seq;if(kind==='events')device.eventCursor=eventSeq;if(briefDue)device.lastBriefDate=date;this.store.save();}
      }
    }finally{this.running=false;}
  }
  close(){this.closed=true;}
}

export function installPushRoutes(router,{store,auth,rateLimit,baseURL,audit,clock,...options}){
  const push=new PushEngine(store,baseURL,{audit,clock,...options});
  router.get('/api/push',auth,(req,res)=>res.json(push.settings(req.user)));
  const sameAccount=(req,res,next)=>{if(req.body.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);next();};
  router.post('/api/push/device',auth,sameAccount,(req,res)=>{rateLimit(req,'push-device:'+req.user.id,120,15*60000);res.json(push.device(req,req.body));});
  router.post('/api/push/subscribe',auth,sameAccount,(req,res)=>{rateLimit(req,'push-subscribe:'+req.user.id,12,15*60000);res.json(push.subscribe(req,req.body));});
  router.post('/api/push/preferences',auth,sameAccount,(req,res)=>{rateLimit(req,'push-preferences:'+req.user.id,30,15*60000);res.json(push.preferences(req.user,req.body));});
  router.post('/api/push/devices/:id/remove',auth,sameAccount,(req,res)=>res.json(push.remove(req.user,req.params.id)));
  router.post('/api/push/test',auth,sameAccount,async(req,res)=>{rateLimit(req,'push-test:'+req.user.id,5,15*60000);res.json(await push.test(req,String(req.body.deviceId||'')));});
  return push;
}
