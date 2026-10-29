import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import express from 'express';
import {parsePersonalCalendar,calendarSafeText,validCalendarDay,calendarMidnight,personalCalendarRange} from './personal-calendar-worker.js';
export {parsePersonalCalendar} from './personal-calendar-worker.js';
import {digest} from './store.js';
import {PublicError} from './sync.js';
import {parisDate,shiftDate} from './work.js';
import {accountActive,automationAllowed} from './operational-state.js';

const MAX_BYTES=1024*1024,MAX_CALENDARS=3,REFRESH=30*60000;
const safeText=calendarSafeText,validDay=validCalendarDay,midnight=calendarMidnight,range=personalCalendarRange;
const isObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const personalCalendarScope=user=>digest(JSON.stringify([user.id,user.studentId||null,user.schoolName||null]));

let parserBusy=false;
export async function parsePersonalCalendarSafely(ics,options={}){
  if(parserBusy)throw new PublicError('Un agenda est déjà en cours de lecture. Réessayez dans un instant.',429);
  parserBusy=true;
  try{return await new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./personal-calendar-worker.js',import.meta.url),{execArgv:[],workerData:{kind:'passerelle:personal-calendar',ics,options},resourceLimits:{maxOldGenerationSizeMb:96,maxYoungGenerationSizeMb:8}});
    let finished=false;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);void worker.terminate().catch(()=>{}).finally(()=>error?reject(error):resolve(value));};
    const invalid=()=>new PublicError('Cet agenda est invalide, trop complexe ou trop volumineux. La dernière copie valide est conservée.',400);
    // Leave room for a cold worker on the small VM while keeping untrusted
    // parsing serial, memory-limited and bounded in wall-clock time.
    const timer=setTimeout(()=>finish(invalid()),10000);
    worker.once('message',message=>message?.ok?finish(null,message.value):finish(invalid()));worker.once('error',()=>finish(invalid()));worker.once('exit',code=>{if(!finished&&code!==0)finish(invalid());});
  });}finally{parserBusy=false;}
}

export function safeCalendarURL(value){
  if(typeof value!=='string'||value.length>4000)throw new PublicError('Choisissez un lien privé ICS Google, Outlook ou iCloud.');
  let url;try{url=new URL(value.replace(/^webcal:/i,'https:'));}catch{throw new PublicError('Ce lien d’agenda est invalide.');}
  const allowed=['calendar.google.com','outlook.live.com','outlook.office365.com','outlook.office.com'].includes(url.hostname)||/^p\d+-caldav\.icloud\.com$/.test(url.hostname);
  if(!allowed||url.protocol!=='https:'||url.port||url.username||url.password||url.hash)throw new PublicError('Utilisez un lien ICS HTTPS Google, Outlook ou iCloud, ou importez le fichier.');
  return url;
}
export function publicCalendarAddress(address){
  if(net.isIP(address)===4){
    const [a,b]=address.split('.').map(Number);
    return !(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19)||a>=224||a===192&&b===0);
  }
  if(net.isIP(address)===6){const compact=address.toLowerCase(),first=parseInt(compact.split(':')[0],16);return first>=0x2000&&first<=0x3fff&&!compact.startsWith('2001:db8:')&&!/^2001:(?:0:|0{2,4}:|1[0-9a-f]:|2[0-9a-f]:)/.test(compact)&&!compact.startsWith('2002:')&&!compact.startsWith('3fff:');}
  return false;
}
export async function fetchCalendar(value,{lookup=dns.lookup,request=https.request}={}){
  const url=safeCalendarURL(value),began=performance.now();let dnsTimer;
  const addresses=await Promise.race([Promise.resolve().then(()=>lookup(url.hostname,{all:true,verbatim:true})),new Promise((_,reject)=>{dnsTimer=setTimeout(()=>reject(new PublicError('L’adresse réseau de cet agenda ne répond pas.',502)),3500);})]).finally(()=>clearTimeout(dnsTimer));
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(value=>!publicCalendarAddress(value.address)))throw new PublicError('L’adresse réseau de cet agenda n’est pas autorisée.',400);
  const selected=addresses.find(value=>value.family===4)||addresses[0];
  return new Promise((resolve,reject)=>{
    let finished=false,bytes=0,chunks=[],timer;
    const finish=(error,value)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(value);};
    const fail=()=>new PublicError('L’agenda distant ne répond pas. La dernière copie valide reste disponible.',502);
    const req=request(url,{method:'GET',headers:{Accept:'text/calendar, application/ics;q=0.9','User-Agent':'Passerelle/PersonalCalendar'},lookup:(_hostname,options,callback)=>{if(typeof options==='function')callback=options;if(options?.all)callback(null,[selected]);else callback(null,selected.address,selected.family);},servername:url.hostname},response=>{
      if(response.statusCode!==200){response.resume();finish(fail());return;}
      if(Number(response.headers['content-length'])>MAX_BYTES){response.destroy();finish(new PublicError('Choisissez un agenda de moins de 1 Mo.',413));return;}
      response.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES){response.destroy();finish(new PublicError('Choisissez un agenda de moins de 1 Mo.',413));}else chunks.push(chunk);});
      response.once('error',()=>finish(fail()));response.once('end',()=>finish(null,Buffer.concat(chunks).toString('utf8')));
    });
    timer=setTimeout(()=>{req.destroy();finish(fail());},Math.max(1000,10000-(performance.now()-began)));req.once('error',()=>finish(fail()));req.end();
  });
}

function calendarState(store,user){if(!store||user.personalCalendarScope!==personalCalendarScope(user)||!user.personalCalendarState)return {items:[]};try{const state=store.open(user.personalCalendarState);return Array.isArray(state.items)?state:{items:[],unavailable:true};}catch{return {items:[],unavailable:true};}}
function selectedEvents(state,start,end){
  const lower=Date.parse(midnight(start)),upper=Date.parse(midnight(shiftDate(end,1)));
  return state.items.flatMap(calendar=>(calendar.events||[]).filter(event=>Date.parse(event.end)>lower&&Date.parse(event.start)<upper).map(({uid,occurrence,...event})=>({...event,id:digest(calendar.id+':'+uid+':'+occurrence),calendarId:calendar.id,calendarTitle:calendar.title,source:'personal-calendar'}))).sort((a,b)=>a.start.localeCompare(b.start));
}
export function personalBusyEvents(user,start,end,store){if(!validDay(start)||!validDay(end)||start>end)throw new PublicError('La période demandée est invalide.');const state=calendarState(store,user);if(state.unavailable||state.items.some(item=>!item.window||item.window.start>start||item.window.end<end))throw new PublicError('Les disponibilités personnelles ne peuvent pas être confirmées pour cette période.',409);return selectedEvents(state,start,end).filter(event=>event.busy);}

export class PersonalCalendarService {
  constructor(store,{clock=()=>Date.now(),audit=null,fetcher=fetchCalendar,parser=parsePersonalCalendarSafely}={}){Object.assign(this,{store,clock,audit,fetcher,parser});this.running=new Set();this.closed=false;}
  state(user){return calendarState(this.store,user);}
  save(user,state){this.store.update(user.id,{personalCalendarScope:personalCalendarScope(user),personalCalendarState:this.store.seal(state),personalCalendarVersion:(user.personalCalendarVersion||0)+1});}
  settings(user){const state=this.state(user);return {accountId:user.id,version:user.personalCalendarVersion||0,maxCalendars:MAX_CALENDARS,maxFileBytes:MAX_BYTES,window:range(this.clock()),warning:state.unavailable?'Vos calendriers ne peuvent pas être ouverts. Contactez l’assistance.':null,items:state.items.map(({id,title,sourceType,lastSync,error,events,window})=>({id,title,sourceType,lastSync,error:error||null,count:events.length,window,hasSource:sourceType==='subscription'}))};}
  view(user,start,end){
    const bounds=range(this.clock());start=start||parisDate(new Date(this.clock()));end=end||shiftDate(start,6);
    if(!validDay(start)||!validDay(end)||start>end||Date.parse(end)-Date.parse(start)>92*86400000||start<bounds.start||end>bounds.end)throw new PublicError('Choisissez une plage de 93 jours au maximum, dans la période disponible.');
    const state=this.state(user),events=selectedEvents(state,start,end),complete=!state.unavailable&&state.items.every(item=>item.window?.start<=start&&item.window?.end>=end),conflicts=[];
    for(const event of events.filter(value=>value.busy))for(const course of Object.values(user.calendarEvents||{}))if(!course.cancelled&&Date.parse(event.start)<Date.parse(course.end)&&Date.parse(event.end)>Date.parse(course.start))conflicts.push({eventId:event.id,courseId:course.id,date:course.date,title:event.title,courseTitle:course.title});
    return {accountId:user.id,start,end,events,complete,conflicts:conflicts.slice(0,100),warning:!complete?'La période de ces calendriers doit être recalculée. Réessayez après leur actualisation.':state.items.some(item=>item.error)?'Un abonnement n’a pas pu être actualisé. Sa dernière copie valide reste affichée.':null};
  }
  busy(user,date){const value=this.view(user,date,date);if(!value.complete)throw new PublicError('Les disponibilités personnelles ne peuvent pas être confirmées pour cette période.',409);return value.events.filter(event=>event.busy);}
  assertCurrent(user,scope,sessionHash){if(this.closed||!accountActive(user)||personalCalendarScope(user)!==scope||sessionHash&&!this.store.state.sessions.some(session=>session.userId===user.id&&session.hash===sessionHash&&session.expires>Date.now()))throw new PublicError('Le compte, l’élève ou la connexion a changé. Relancez l’opération.',409);}
  async add(user,input,{sessionHash}={}){
    if(!isObject(input)||Object.keys(input).some(key=>!['accountId','title','ics','url'].includes(key))||typeof input.title!=='string'||!safeText(input.title)||input.title.length>100||Boolean(input.ics)===Boolean(input.url))throw new PublicError('Indiquez un nom et un fichier ICS ou un lien d’abonnement.');
    if(this.state(user).unavailable)throw new PublicError('Vos calendriers ne peuvent pas être ouverts. Contactez l’assistance.',409);
    if(this.state(user).items.length>=MAX_CALENDARS)throw new PublicError('Trois calendriers sont déjà associés à ce profil. Retirez-en un avant de continuer.',409);
    const scope=personalCalendarScope(user);this.assertCurrent(user,scope,sessionHash);
    const url=input.url?safeCalendarURL(input.url).href:null,ics=url?await this.fetcher(url):input.ics,parsed=await this.parser(ics,{now:this.clock()});
    this.assertCurrent(user,scope,sessionHash);const state=this.state(user);
    if(state.items.length>=MAX_CALENDARS)throw new PublicError('Trois calendriers sont déjà associés à ce profil.',409);
    if(state.items.some(item=>url&&item.url===url||!url&&digest(item.ics)===digest(ics)))throw new PublicError('Ce calendrier est déjà associé à votre profil.',409);
    state.items.push({id:randomUUID(),title:safeText(input.title,100),sourceType:url?'subscription':'file',url,ics,...parsed,lastSync:this.clock(),lastAttempt:this.clock(),error:null});this.save(user,state);
    this.audit?.record('personal.calendar.added',{source:'personal',userId:user.id,meta:{count:1,mode:url?'subscription':'file'}});return this.settings(user);
  }
  async refresh(user,id,{sessionHash}={}){
    const state=this.state(user),row=state.items.find(item=>item.id===id);
    if(!row)throw new PublicError('Ce calendrier n’est plus associé à votre profil.',404);
    if(!row.url)throw new PublicError('Ce calendrier vient d’un fichier. Importez sa nouvelle version pour l’actualiser.',409);
    if(this.running.has(id))throw new PublicError('Ce calendrier est déjà en cours d’actualisation.',409);
    const scope=personalCalendarScope(user),source=row.url;this.running.add(id);
    try{
      const ics=await this.fetcher(source),parsed=await this.parser(ics,{now:this.clock()});this.assertCurrent(user,scope,sessionHash);
      const latest=this.state(user),current=latest.items.find(item=>item.id===id&&item.url===source);if(!current)throw new PublicError('Ce calendrier a été retiré.',409);
      Object.assign(current,{ics,...parsed,lastSync:this.clock(),lastAttempt:this.clock(),error:null});this.save(user,latest);return this.settings(user);
    }catch(error){
      if(!this.closed&&accountActive(user)&&scope===personalCalendarScope(user)&&(!sessionHash||this.store.state.sessions.some(session=>session.userId===user.id&&session.hash===sessionHash&&session.expires>Date.now()))){const latest=this.state(user),current=latest.items.find(item=>item.id===id&&item.url===source);if(current){Object.assign(current,{lastAttempt:this.clock(),error:'L’actualisation a échoué. La dernière copie valide reste disponible.'});this.save(user,latest);}}
      throw error instanceof PublicError?error:new PublicError('L’actualisation a échoué. La dernière copie valide reste disponible.',502);
    }finally{this.running.delete(id);}
  }
  remove(user,id){const state=this.state(user);if(!state.items.some(item=>item.id===id))throw new PublicError('Ce calendrier n’est plus associé à votre profil.',404);state.items=state.items.filter(item=>item.id!==id);this.save(user,state);this.audit?.record('personal.calendar.removed',{source:'personal',userId:user.id,meta:{count:1}});return this.settings(user);}
  async tick(){
    if(this.closed||!automationAllowed(this.store.state.settings,'ent',this.clock())||this.running.size)return;
    const bounds=range(this.clock());
    for(const user of this.store.state.users.filter(accountActive)){
      const row=this.state(user).items.find(item=>item.url?this.clock()-(item.lastAttempt||0)>=REFRESH:!item.window||item.window.end<bounds.end);
      if(!row)continue;
      if(row.url){await this.refresh(user,row.id).catch(()=>{});return;}
      // Re-expand the same uploaded snapshot as time advances. This does not
      // pretend that the original calendar file has been downloaded again.
      const scope=personalCalendarScope(user),hash=digest(row.ics);this.running.add(row.id);
      try{const parsed=await this.parser(row.ics,{now:this.clock()});this.assertCurrent(user,scope);const latest=this.state(user),current=latest.items.find(item=>item.id===row.id&&digest(item.ics)===hash);if(current){Object.assign(current,parsed,{lastExpandedAt:this.clock()});this.save(user,latest);}}catch{}finally{this.running.delete(row.id);}
      return;
    }
  }
  close(){this.closed=true;}
}

export function installPersonalCalendarRoutes(router,{store,auth,rateLimit,clock,audit,...options}){
  const service=new PersonalCalendarService(store,{clock,audit,...options});
  const same=req=>{if(req.body?.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);};
  router.get('/api/personal-calendars',auth,(req,res)=>res.json(service.settings(req.user)));
  router.get('/api/personal-calendars/view',auth,(req,res)=>{rateLimit(req,'personal-calendar-view:'+req.user.id,100,15*60000);res.json(service.view(req.user,req.query.start,req.query.end));});
  router.post('/api/personal-calendars/add',auth,async(req,res)=>{same(req);rateLimit(req,'personal-calendar-add:'+req.user.id,10,15*60000);res.json(await service.add(req.user,req.body,{sessionHash:req.session.hash}));});
  const raw=express.raw({type:'text/calendar',limit:MAX_BYTES});
  router.post('/api/personal-calendars/upload',auth,(req,res,next)=>{if(req.get('x-passerelle-account')!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);rateLimit(req,'personal-calendar-add:'+req.user.id,10,15*60000);req.personalCalendarProfile=personalCalendarScope(req.user);raw(req,res,error=>error?next(new PublicError('Choisissez un fichier ICS de moins de 1 Mo.',413)):next());},async(req,res)=>{let title;try{title=decodeURIComponent(req.get('x-calendar-title')||'Agenda personnel');}catch{throw new PublicError('Le nom du calendrier est invalide.');}service.assertCurrent(req.user,req.personalCalendarProfile,req.session.hash);if(!Buffer.isBuffer(req.body))throw new PublicError('Choisissez un fichier ICS.');res.json(await service.add(req.user,{title,ics:req.body.toString('utf8')},{sessionHash:req.session.hash}));});
  for(const action of ['refresh','remove'])router.post('/api/personal-calendars/:id/'+action,auth,async(req,res)=>{same(req);if(Object.keys(req.body).some(key=>key!=='accountId'))throw new PublicError('La requête contient des champs invalides.');rateLimit(req,'personal-calendar-write:'+req.user.id,20,15*60000);res.json(action==='refresh'?await service.refresh(req.user,req.params.id,{sessionHash:req.session.hash}):service.remove(req.user,req.params.id));});
  return service;
}

