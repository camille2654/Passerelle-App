import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import {digest} from './store.js';
import {PublicError} from './sync.js';
import {parisDate,shiftDate} from './work.js';
import {parisEventInstant} from './event-dates.js';
import {accountActive,automationAllowed} from './operational-state.js';

const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const MAX_BODY=1024*1024,CACHE=60000;
const clockFormat=new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const base=()=>({enabled:false,label:'Mon trajet',originLabel:'',destinationLabel:'',outboundMinutes:30,inboundMinutes:30,bufferMinutes:10,outboundTimes:[],inboundTimes:[],weekdays:[1,2,3,4,5],routeURL:'',sourceId:null,outboundStopRef:'',inboundStopRef:'',lineRef:''});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const clean=(value,max=120)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const array=value=>Array.isArray(value)?value:value?[value]:[];
const scalar=value=>typeof value==='string'?value:object(value)?String(value.value??value.Value??''):'';
const sourceHosts=new Set(['proxy.transport.data.gouv.fr','transport.data.gouv.fr','data.mobilites-m.fr']);
function dateInput(value,now){const date=value||parisDate(new Date(now));if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T12:00:00Z'))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||Math.abs(Date.parse(date+'T12:00:00Z')-now)>400*86400000)throw new PublicError('Choisissez une date valide dans l’année scolaire.');return date;}
function routeURL(value){if(value==='')return '';try{const url=new URL(value);if(url.protocol!=='https:'||url.port||url.username||url.password||!['www.google.com','maps.google.com','maps.apple.com','www.openstreetmap.org','www.sncf-connect.com'].includes(url.hostname))throw new Error();return url.href;}catch{throw new PublicError('Utilisez un lien HTTPS Google Maps, Plans, OpenStreetMap ou SNCF Connect.');}}
function sourceURL(value,template=false){try{if(typeof value!=='string'||template&&!value.includes('{stopRef}'))throw new Error();const checked=template?value.replaceAll('{stopRef}','PASSERELLE_STOP'):value;if(/[{}]/.test(checked))throw new Error();const url=new URL(checked);if(url.protocol!=='https:'||url.port||url.username||url.password||url.hash||!sourceHosts.has(url.hostname)||url.href.length>3000||[...url.searchParams.keys()].some(key=>/token|api.?key|secret|password|auth/i.test(key)))throw new Error();return template?url.href.replaceAll('PASSERELLE_STOP','{stopRef}'):url.href;}catch{throw new PublicError('Le flux doit être une adresse HTTPS publique d’une source de transport autorisée, sans clé privée.');}}
function publicLink(value){if(!value)return '';try{const url=new URL(value);if(url.protocol!=='https:'||url.port||url.username||url.password||url.href.length>2000)throw new Error();return url.href;}catch{throw new PublicError('Renseignez une adresse HTTPS publique valide.');}}
function publicIP(value){
  const ip=value.toLowerCase();
  if(net.isIP(ip)===4){const [a,b]=ip.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0)||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19));}
  if(net.isIP(ip)===6)return !ip.includes('.')&&!ip.startsWith('::')&&!ip.startsWith('fc')&&!ip.startsWith('fd')&&!ip.startsWith('fe8')&&!ip.startsWith('fe9')&&!ip.startsWith('fea')&&!ip.startsWith('feb')&&!ip.startsWith('ff');
  return false;
}
async function fetchSIRI(address){
  const url=new URL(sourceURL(address)),addresses=await dns.lookup(url.hostname,{all:true});
  if(!addresses.length||addresses.some(value=>!publicIP(value.address)))throw new Error('TRAVEL_ADDRESS_REFUSED');
  const chosen=addresses[0];
  return new Promise((resolve,reject)=>{
    const request=https.get(url,{headers:{Accept:'application/json'},timeout:10000,lookup(_host,options,callback){if(options?.all)callback(null,[chosen]);else callback(null,chosen.address,chosen.family);}},response=>{
      if(response.statusCode!==200){response.resume();reject(new Error('TRAVEL_SOURCE_UNAVAILABLE'));return;}
      const chunks=[];let size=0;
      response.on('data',chunk=>{size+=chunk.length;if(size>MAX_BODY){request.destroy(new Error('TRAVEL_SOURCE_TOO_LARGE'));return;}chunks.push(chunk);});
      response.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('TRAVEL_SOURCE_INVALID'));}});
      response.on('error',reject);
    });
    request.on('timeout',()=>request.destroy(new Error('TRAVEL_SOURCE_TIMEOUT')));request.on('error',reject);
  });
}
function times(value){if(!Array.isArray(value)||value.length>40||value.some(item=>typeof item!=='string'||!TIME.test(item)))throw new PublicError('Ajoutez au maximum quarante horaires au format HH:MM.');return [...new Set(value)].sort();}
function normalize(input){
  const allowed=['enabled','label','originLabel','destinationLabel','outboundMinutes','inboundMinutes','bufferMinutes','outboundTimes','inboundTimes','weekdays','routeURL','sourceId','outboundStopRef','inboundStopRef','lineRef'];
  if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))||typeof input.enabled!=='boolean'||typeof input.label!=='string'||input.label.length>120||typeof input.routeURL!=='string'||input.routeURL.length>3000||!Array.isArray(input.weekdays)||!input.weekdays.length||input.weekdays.length>7||input.weekdays.some(day=>!Number.isInteger(day)||day<0||day>6)||input.sourceId!==null&&(typeof input.sourceId!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.sourceId)))throw new PublicError('Vérifiez les réglages de votre trajet.');
  for(const key of ['outboundMinutes','inboundMinutes'])if(!Number.isInteger(input[key])||input[key]<1||input[key]>240)throw new PublicError('La durée du trajet doit être comprise entre 1 et 240 minutes.');
  if(!Number.isInteger(input.bufferMinutes)||input.bufferMinutes<0||input.bufferMinutes>120)throw new PublicError('La marge doit être comprise entre 0 et 120 minutes.');
  for(const key of ['originLabel','destinationLabel','outboundStopRef','inboundStopRef','lineRef'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>150||/[\u0000-\u001f\u007f]/.test(input[key])))throw new PublicError('Vérifiez les noms et les références de vos arrêts.');
  return {enabled:input.enabled,label:clean(input.label)||'Mon trajet',originLabel:clean(input.originLabel,150),destinationLabel:clean(input.destinationLabel,150),outboundMinutes:input.outboundMinutes,inboundMinutes:input.inboundMinutes,bufferMinutes:input.bufferMinutes,outboundTimes:times(input.outboundTimes),inboundTimes:times(input.inboundTimes),weekdays:[...new Set(input.weekdays)].sort(),routeURL:routeURL(input.routeURL),sourceId:input.sourceId,outboundStopRef:clean(input.outboundStopRef,150),inboundStopRef:clean(input.inboundStopRef,150),lineRef:clean(input.lineRef,150)};
}
const point=value=>({iso:new Date(value).toISOString(),date:parisDate(new Date(value)),time:clockFormat.format(new Date(value))});
function departureTime(value){const raw=scalar(value.ExpectedDepartureTime||value.AimedDepartureTime);if(!/(?:Z|[+-]\d\d:\d\d)$/.test(raw)||!Number.isFinite(Date.parse(raw)))return null;return {at:Date.parse(raw),live:!!scalar(value.ExpectedDepartureTime)};}

// SIRI StopMonitoring and EstimatedTimetable share these journey/call fields.
// No arbitrary nested dates are guessed to be a departure.
export function parseTravelSIRI(payload,{stopRef,lineRef},now=Date.now()){
  const result=[],seen=new Set();let visited=0;
  const add=(journey,call,defaultStop='')=>{
    if(journey.Cancellation===true||String(journey.Cancellation).toLowerCase()==='true'||String(call.DepartureStatus||'').toLowerCase()==='cancelled')return;
    const stop=scalar(call.StopPointRef||call.MonitoringRef||defaultStop),line=scalar(journey.LineRef),departure=departureTime(call);
    if(stop!==stopRef||lineRef&&line!==lineRef||!departure||departure.at<now-60000||departure.at>now+30*3600000)return;
    const key=line+':'+stop+':'+departure.at;if(seen.has(key))return;seen.add(key);
    result.push({...departure,line,destination:clean(scalar(journey.DestinationName)||scalar(journey.DestinationRef),150)});
  };
  const walk=(value,depth)=>{
    if(!value||depth>22||++visited>30000)return;
    if(Array.isArray(value)){for(const item of value.slice(0,2000))walk(item,depth+1);return;}
    if(typeof value!=='object')return;
    if(value.MonitoredVehicleJourney){const journey=value.MonitoredVehicleJourney;if(object(journey)&&object(journey.MonitoredCall))add(journey,journey.MonitoredCall,scalar(value.MonitoringRef));}
    if(value.EstimatedCalls){for(const call of array(value.EstimatedCalls.EstimatedCall).slice(0,500))if(object(call))add(value,call);}
    for(const [key,item]of Object.entries(value).slice(0,200))if(key!=='MonitoredVehicleJourney')walk(item,depth+1);
  };
  walk(payload,0);return result.sort((a,b)=>a.at-b.at).slice(0,100);
}

export class TravelService{
  constructor(store,{clock=()=>Date.now(),audit=null,fetchJSON=fetchSIRI}={}){Object.assign(this,{store,clock,audit,fetchJSON});this.cache=new Map();this.pending=new Map();this.closed=false;}
  scope(user){return digest(JSON.stringify([user.id,user.studentId||null,user.schoolName||null]));}
  sources(){try{const rows=this.store.state.settings.travelSources?this.store.open(this.store.state.settings.travelSources):[];return Array.isArray(rows)?rows:[];}catch{return [];}}
  settings(user){
    let settings=base();if(user.travelScope===this.scope(user)&&user.travelSettings)try{settings={...settings,...this.store.open(user.travelSettings)};}catch{}
    return {...settings,availableSources:this.sources().filter(source=>source.enabled).map(({id,label,informationURL,licenseURL,userStops})=>({id,label,informationURL,licenseURL,userStops:!!userStops})),updatedAt:user.travelScope===this.scope(user)?user.travelUpdatedAt||null:null};
  }
  save(user,input,date){
    if(!accountActive(user))throw new PublicError('Ce compte n’est pas actif.',409);
    const selected=dateInput(date,this.clock()),settings=normalize(input),source=settings.sourceId&&this.sources().find(source=>source.id===settings.sourceId&&source.enabled);if(settings.sourceId&&!source)throw new PublicError('Cette source n’est pas disponible. Choisissez les horaires habituels.');if(source?.userStops&&(!settings.outboundStopRef||!settings.inboundStopRef))throw new PublicError('Renseignez vos deux références d’arrêt pour ce réseau.');
    this.store.update(user.id,{travelScope:this.scope(user),travelSettings:this.store.seal(settings),travelUpdatedAt:this.clock()});this.audit?.record('travel.updated',{source:'personal',userId:user.id});return this.view(user,selected);
  }
  configureSource(input){
    const allowed=['id','label','enabled','outboundURL','inboundURL','outboundStopRef','inboundStopRef','lineRef','informationURL','licenseURL','userStops'];
    if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))||typeof input.enabled!=='boolean'||input.userStops!==undefined&&typeof input.userStops!=='boolean'||typeof input.label!=='string'||!input.label.trim()||input.label.length>120||!['outboundStopRef','inboundStopRef'].every(key=>typeof input[key]==='string'&&(input.userStops||input[key].trim())&&input[key].length<=150)||typeof input.lineRef!=='string'||input.lineRef.length>150||input.id!==undefined&&(typeof input.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(input.id)))throw new PublicError('Vérifiez le nom, les arrêts et les paramètres de la source.');
    const source={id:input.id||randomUUID(),label:clean(input.label),enabled:input.enabled,userStops:!!input.userStops,outboundURL:sourceURL(input.outboundURL,!!input.userStops),inboundURL:sourceURL(input.inboundURL,!!input.userStops),outboundStopRef:clean(input.outboundStopRef,150),inboundStopRef:clean(input.inboundStopRef,150),lineRef:clean(input.lineRef,150),informationURL:publicLink(input.informationURL),licenseURL:publicLink(input.licenseURL),updatedAt:this.clock()};
    const sources=this.sources();if(!sources.some(value=>value.id===source.id)&&sources.length>=20)throw new PublicError('Vingt sources de transport sont déjà configurées.');
    this.store.state.settings.travelSources=this.store.seal([...sources.filter(value=>value.id!==source.id),source]);this.store.save();for(const key of this.cache.keys())if(key.startsWith(source.id+':'))this.cache.delete(key);return this.sources();
  }
  selectedSource(settings){const source=settings.sourceId&&this.sources().find(value=>value.id===settings.sourceId&&value.enabled);if(!source)return null;const selected=source.userStops?{...source,outboundStopRef:settings.outboundStopRef,inboundStopRef:settings.inboundStopRef,lineRef:settings.lineRef||source.lineRef}:source;if(!selected.outboundStopRef||!selected.inboundStopRef)return null;return selected;}
  cacheKey(source){return source.id+':'+digest(JSON.stringify(source));}
  day(user,requested){
    const now=this.clock(),date=dateInput(requested,now),settings=this.settings(user),courses=Object.values(user.calendarEvents||{}).filter(value=>value.date===date&&!value.cancelled&&Number.isFinite(Date.parse(value.start))&&Number.isFinite(Date.parse(value.end))&&Date.parse(value.end)>Date.parse(value.start)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start));
    const first=courses[0],last=courses.reduce((best,value)=>!best||Date.parse(value.end)>Date.parse(best.end)?value:best,null),source=this.selectedSource(settings),cached=source&&this.cache.get(this.cacheKey(source)),live=cached&&!cached.error&&cached.version===digest(JSON.stringify(source))&&cached.at>=now-2*CACHE?cached:null;
    const reliable=!!user.skolengo&&!user.skolengoError&&!user.lastError&&Number.isFinite(user.lastSync)&&user.lastSync<=now+5*60000&&now-user.lastSync<=30*60000&&!!user.calendarWindow&&date>=user.calendarWindow.start&&date<=user.calendarWindow.end;
    const reason=!user.skolengo?'Connectez votre ENT pour calculer le trajet depuis vos cours.':user.skolengoError||user.lastError?'Votre agenda rencontre un problème. Vérifiez les horaires avant de partir.':!reliable?'Votre agenda doit être actualisé avant de proposer une heure de départ.':null;
    const state={date,enabled:settings.enabled,mode:'usual',status:!settings.enabled?'disabled':!reliable?'agenda_unavailable':!courses.length?'no_classes':'available',warning:reason,firstCourse:first?{title:first.title,start:first.start}:null,lastCourse:last?{title:last.title,end:last.end}:null,outbound:null,inbound:null,source:source?{label:source.label,informationURL:source.informationURL,licenseURL:source.licenseURL,checkedAt:live?.at||null,status:live?(live.outbound.length||live.inbound.length?'available':'no_departures'):cached?.error?'error':'not_loaded'}:null,liveNotice:source?'Les départs publiés ne couvrent pas nécessairement toute la journée. Les durées restent celles que vous avez renseignées.':'Estimation basée sur votre durée habituelle ; aucun temps réel de transport n’est utilisé.'};
    if(!settings.enabled||!reliable||!courses.length)return state;
    const start=Date.parse(first.start),end=Date.parse(last.end),buffer=settings.bufferMinutes*60000,weekday=new Date(date+'T12:00:00Z').getUTCDay();
    const localTimes=values=>settings.weekdays.includes(weekday)?values.map(time=>parisEventInstant(date,time)).filter(Boolean).map(value=>({at:Date.parse(value),live:false})):[];
    const outward=live?.outbound?.filter(value=>parisDate(new Date(value.at))===date)||[],inward=live?.inbound?.filter(value=>parisDate(new Date(value.at))===date)||[];
    const outboundRows=outward.length?outward:localTimes(settings.outboundTimes),inboundRows=inward.length?inward:localTimes(settings.inboundTimes);
    const candidates=outboundRows.filter(value=>value.at+settings.outboundMinutes*60000<=start-buffer),chosen=candidates.at(-1),ready=date===parisDate(new Date(now))?Math.max(end+buffer,now):end+buffer,returning=inboundRows.find(value=>value.at>=ready);
    const departure=chosen?.at??start-buffer-settings.outboundMinutes*60000,returnDeparture=returning?.at??ready;
    state.outbound={departure:point(departure),arrival:point(departure+settings.outboundMinutes*60000),minutes:settings.outboundMinutes,mode:chosen?(outward.length?chosen.live?'live':'published':'timetable'):'usual',warning:outboundRows.length&&!chosen?'Aucun départ renseigné ou publié ne permet d’arriver à temps. L’heure affichée est une estimation de trajet.':null};
    state.inbound={departure:point(returnDeparture),arrival:point(returnDeparture+settings.inboundMinutes*60000),minutes:settings.inboundMinutes,mode:returning?(inward.length?returning.live?'live':'published':'timetable'):'usual',warning:inboundRows.length&&!returning?'Aucun départ renseigné ou publié ne suit la fin des cours. L’heure affichée est une estimation de trajet.':null};
    state.mode=[state.outbound.mode,state.inbound.mode].includes('live')?'live':[state.outbound.mode,state.inbound.mode].includes('published')?'published':[state.outbound.mode,state.inbound.mode].includes('timetable')?'timetable':'usual';return state;
  }
  view(user,date){return {accountId:user.id,settings:this.settings(user),day:this.day(user,date)};}
  async get(user,date){
    const settings=this.settings(user),scope=this.scope(user),source=this.selectedSource(settings),key=source&&this.cacheKey(source),version=source&&digest(JSON.stringify(source)),sourceStillCurrent=()=>{const current=this.selectedSource(this.settings(user));return current&&this.cacheKey(current)===key;};
    const day=dateInput(date,this.clock());
    if(!this.closed&&accountActive(user)&&settings.enabled&&source&&this.day(user,day).status==='available'&&day===parisDate(new Date(this.clock()))&&automationAllowed(this.store.state.settings,'ent',this.clock())&&(!this.cache.has(key)||this.clock()-this.cache.get(key).at>=CACHE)){
      if(!this.pending.has(key)&&this.pending.size<2){
        const task=(async()=>{try{const address=(value,stop)=>sourceURL(value.replaceAll('{stopRef}',encodeURIComponent(stop)));const [outbound,inbound]=await Promise.all([this.fetchJSON(address(source.outboundURL,source.outboundStopRef)),this.fetchJSON(address(source.inboundURL,source.inboundStopRef))]);for(const payload of [outbound,inbound])if(!object(payload)||!['Siri','ServiceDelivery','StopMonitoringDelivery','EstimatedTimetableDelivery'].some(key=>object(payload[key])||Array.isArray(payload[key])))throw new Error('TRAVEL_SOURCE_INVALID');if(this.closed||!sourceStillCurrent())return;if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{at:this.clock(),version,outbound:parseTravelSIRI(outbound,{stopRef:source.outboundStopRef,lineRef:source.lineRef},this.clock()),inbound:parseTravelSIRI(inbound,{stopRef:source.inboundStopRef,lineRef:source.lineRef},this.clock())});}catch{if(!this.closed&&sourceStillCurrent()){if(this.cache.size>=100)this.cache.delete(this.cache.keys().next().value);this.cache.set(key,{at:this.clock(),version,error:true});}}finally{this.pending.delete(key);}})();this.pending.set(key,task);
      }
      await this.pending.get(key);
    }
    if(!accountActive(user)||this.scope(user)!==scope)throw new PublicError('L’élève ou le compte a changé. Actualisez votre trajet.',409);
    return this.view(user,day);
  }
  close(){this.closed=true;}
}

export function installTravelRoutes(router,{store,auth,admin,rateLimit,clock,audit,...options}){
  const travel=new TravelService(store,{clock,audit,...options});
  router.get('/api/travel',auth,async(req,res)=>{rateLimit(req,'travel-read:'+req.user.id,100,15*60000);res.json(await travel.get(req.user,req.query.date));});
  router.post('/api/travel/settings',auth,(req,res)=>{rateLimit(req,'travel-settings:'+req.user.id,30,15*60000);if(req.body?.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);const {accountId,...input}=req.body;res.json(travel.save(req.user,input,req.query.date));});
  if(admin){router.get('/api/admin/travel/sources',auth,admin,(req,res)=>res.json({sources:travel.sources(),allowedHosts:[...sourceHosts]}));router.post('/api/admin/travel/sources',auth,admin,(req,res)=>{rateLimit(req,'travel-source:'+req.user.id,20,3600000);res.json({sources:travel.configureSource(req.body)});});}
  return travel;
}
