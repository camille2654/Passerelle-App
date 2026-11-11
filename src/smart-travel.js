import {digest,random} from './store.js';
import {PublicError} from './sync.js';
import {accountActive} from './operational-state.js';
import {parisDate,shiftDate} from './work.js';
import {clean,locationPoint,searchTransportPlaces,itineraryLinks,computeTransportJourneys,requestTransportJSON} from './smart-travel-provider.js';
import {saveTravelBlock,removeTravelBlock,listTravelBlocks,travelCalendarRows} from './travel-calendar.js';

const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message,status=400)=>new PublicError(message,status);
function dateValue(value,now){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value)||!Number.isFinite(Date.parse(value+'T12:00:00Z'))||new Date(value+'T12:00:00Z').toISOString().slice(0,10)!==value||Math.abs(Date.parse(value+'T12:00:00Z')-now)>400*86400000)throw fail('Choisissez une date valide.');return value;}
function margin(value){if(!Number.isInteger(value)||value<0||value>120)throw fail('Choisissez une marge de 0 à 120 minutes.');return value;}
const directionValue=value=>{if(!['outbound','inbound'].includes(value))throw fail('Choisissez le trajet aller ou retour.');return value;};
export class SmartTravelService {
 constructor(store,{clock=()=>Date.now(),audit=null,requestJSON=requestTransportJSON}={}){Object.assign(this,{store,clock,audit,requestJSON});this.schools=new Map();this.plans=new Map();this.closed=false;this.inFlight=0;this.pendingSchools=new Map();this.pruneTimer=setInterval(()=>this.prune(),60000);this.pruneTimer.unref();}
 school(user){
  let source={};try{source=this.store.open(user.skolengo)?.school||{};}catch{}
  const name=clean(source.name||user.schoolName),address=[source.addressLine1,source.addressLine2,source.addressLine3,[source.zipCode,source.city].filter(Boolean).join(' ')].map(value=>clean(value,150)).filter(Boolean).join(', ').slice(0,450);
  const key=digest(JSON.stringify([source.id,name,address])),cached=this.schools.get(key),point=cached&&cached.expires>this.clock()?cached.point:null;
  return {name,address,point,key,hasStreet:!![source.addressLine1,source.addressLine2,source.addressLine3].some(value=>clean(value)),postcode:clean(source.zipCode,12)};
 }
 scope(user){return digest(JSON.stringify([user.id,user.studentId||null,user.schoolName||null,this.school(user).key]));}
 context(user){return digest(JSON.stringify([this.scope(user),user.skolengoConnectionId||null]));}
 assert(req,context){if(this.closed||!accountActive(req.user)||this.store.user(req.user.id)!==req.user||this.context(req.user)!==context||!this.store.state.sessions.some(value=>value.hash===req.session?.hash&&value.userId===req.user.id&&value.expires>Date.now()))throw fail('La connexion ou l’élève a changé. Rouvrez votre trajet.',409);}
 preferences(user){let value={origin:null,destination:null,bufferMinutes:10};if(user.smartTravelScope===this.scope(user)&&user.smartTravelPrefs)try{value={...value,...this.store.open(user.smartTravelPrefs)};}catch{}return value;}
 routing(){let value={enabled:false,token:'',coverage:''};try{if(this.store.state.settings.smartRouting)value={...value,...this.store.open(this.store.state.settings.smartRouting)};}catch{}return value;}
 publicRouting(){const value=this.routing();return {provider:'Navitia',label:'Navitia',enabled:value.enabled,configured:!!value.token,ready:!!(value.enabled&&value.token),coverage:value.coverage,tokenConfigured:!!value.token};}
 day(user,date){
  const now=this.clock(),courses=Object.values(user.calendarEvents||{}).filter(value=>value.date===date&&!value.cancelled&&Number.isFinite(Date.parse(value.start))&&Number.isFinite(Date.parse(value.end))&&Date.parse(value.end)>Date.parse(value.start)).sort((a,b)=>Date.parse(a.start)-Date.parse(b.start)),last=courses.reduce((best,value)=>!best||Date.parse(best.end)<Date.parse(value.end)?value:best,null);
  const reliable=!!user.skolengo&&!user.skolengoError&&!user.lastError&&Number.isFinite(user.lastSync)&&user.lastSync<=now+300000&&now-user.lastSync<=1800000&&user.calendarWindow&&date>=user.calendarWindow.start&&date<=user.calendarWindow.end;
  return {status:!reliable?'agenda_unavailable':!courses.length?'no_classes':'available',warning:!reliable?'Actualisez votre agenda pour préparer le trajet à partir de vos cours.':null,firstCourse:courses[0]?{title:clean(courses[0].title),start:courses[0].start}:null,lastCourse:last?{title:clean(last.title),end:last.end}:null};
 }
 view(user,requested){const date=dateValue(requested||parisDate(new Date(this.clock())),this.clock()),{name,address,point}=this.school(user);return {accountId:user.id,date,school:{name,address,point},preferences:this.preferences(user),provider:this.publicRouting(),day:this.day(user,date),blocks:listTravelBlocks(this.store,user,{date})};}
 summary(user,legacyEnabled=false){const today=parisDate(new Date(this.clock())),blocks=travelCalendarRows(user,{start:today,end:shiftDate(today,1)});return {showHome:!!user.skolengo&&(!legacyEnabled||blocks.length>0),blocks};}
 async schoolPlaces(req){
  const context=this.context(req.user),school=this.school(req.user);this.assert(req,context);
  if(!school.address)return {school:{name:school.name,address:'',point:null},candidates:[],warning:'L’adresse du lycée est absente de l’ENT. Vous pouvez choisir sa destination manuellement.'};
  let cached=this.schools.get(school.key);
  if(!cached||cached.expires<=this.clock()){
   if(!this.pendingSchools.has(school.key)){
    if(this.pendingSchools.size>=2)throw fail('La recherche des établissements est occupée. Réessayez dans un instant.',429);
    const task=(async()=>{const places=await searchTransportPlaces(school.address,this.requestJSON),best=places[0],point=best&&school.hasStreet&&best.score>=.8&&!['municipality','locality'].includes(best.type)&&(!school.postcode||best.postcode===school.postcode)?locationPoint({lat:best.lat,lon:best.lon,label:best.label}):null;const row={point,places,expires:this.clock()+7*86400000};if(!this.closed){if(this.schools.size>=200)this.schools.delete(this.schools.keys().next().value);this.schools.set(school.key,row);}return row;})().finally(()=>this.pendingSchools.delete(school.key));this.pendingSchools.set(school.key,task);
   }
   try{cached=await this.pendingSchools.get(school.key);}catch{throw fail('La recherche d’adresse est indisponible. Vous pouvez saisir une autre adresse ou réessayer.',502);}
  }
  this.assert(req,context);return {school:{name:school.name,address:school.address,point:cached.point},candidates:cached.places.map(({lat,lon,label})=>({lat,lon,label})),...(!cached.point?{warning:'Vérifiez l’adresse et choisissez le lieu correspondant à votre lycée.'}:{})};
 }
 async places(req,query){
  if(typeof query!=='string'||query.trim().length<3||query.length>200)throw fail('Saisissez une adresse ou un lieu de 3 à 200 caractères.');
  const context=this.context(req.user);this.assert(req,context);if(this.inFlight>=2)throw fail('Une recherche est déjà en cours. Réessayez dans un instant.',429);this.inFlight++;
  try{const rows=await searchTransportPlaces(clean(query,200),this.requestJSON);this.assert(req,context);return {places:rows.map(({lat,lon,label})=>({lat,lon,label}))};}catch(error){if(error instanceof PublicError)throw error;throw fail('La recherche d’adresse est indisponible. Réessayez dans un instant.',502);}finally{this.inFlight--;}
 }
 savePreferences(req,input){
  this.assert(req,this.context(req.user));const date=dateValue(input.date||parisDate(new Date(this.clock())),this.clock()),value={origin:input.origin===null?null:locationPoint(input.origin),destination:input.destination===null?null:locationPoint(input.destination),bufferMinutes:margin(input.bufferMinutes)};
  this.store.update(req.user.id,{smartTravelScope:this.scope(req.user),smartTravelPrefs:this.store.seal(value),personalVersion:this.clock()});this.audit?.record('travel.updated',{source:'personal',userId:req.user.id,meta:{mode:'locations'}});return this.view(req.user,date);
 }
 target(user,date,direction,buffer){
  const day=this.day(user,date);if(day.status!=='available')throw fail(day.status==='no_classes'?'Aucun cours publié pour cette journée.':day.warning,409);
  const at=direction==='outbound'?Date.parse(day.firstCourse.start)-buffer*60000:Date.parse(day.lastCourse.end)+buffer*60000;
  if(at<this.clock()-60000)throw fail('L’horaire de ce trajet est déjà passé. Choisissez une journée à venir ou ouvrez votre application de plans.',409);
  return {at,...(direction==='outbound'?{courseStart:day.firstCourse.start}:{courseEnd:day.lastCourse.end})};
 }
 prune(){for(const [key,row]of this.plans)if(row.expires<=this.clock())this.plans.delete(key);}
 stage(req,journey,details){
  this.prune();if(this.plans.size>=200)throw fail('Trop de trajets sont en préparation. Réessayez plus tard.',429);
  const token=random();this.plans.set(digest(token),{userId:req.user.id,session:req.session.hash,context:this.context(req.user),expires:this.clock()+600000,journey,...details});return {...journey,token};
 }
 async plan(req,input){
  const context=this.context(req.user);this.assert(req,context);const date=dateValue(input.date,this.clock()),direction=directionValue(input.direction),buffer=margin(input.bufferMinutes),origin=locationPoint(input.origin),destination=locationPoint(input.destination),target=this.target(req.user,date,direction,buffer),routing=this.routing();
  const from=direction==='inbound'?destination:origin,to=direction==='inbound'?origin:destination;
  const result={status:'provider_unavailable',journeys:[],links:itineraryLinks(from,to),provider:this.publicRouting(),target};if(!routing.enabled||!routing.token)return result;
  if(this.inFlight>=2)throw fail('Le calcul des trajets est occupé. Réessayez dans un instant.',429);this.inFlight++;
  try{const journeys=(await computeTransportJourneys({origin:from,destination:to,target:target.at,direction,token:routing.token,coverage:routing.coverage},this.requestJSON)).filter(journey=>Date.parse(journey.departure)>=this.clock()-60000);this.assert(req,context);if(digest(JSON.stringify(this.routing()))!==digest(JSON.stringify(routing)))throw fail('Le service de transport a changé. Recalculez le trajet.',409);result.status=journeys.length?'available':'no_journeys';result.journeys=journeys.map(journey=>this.stage(req,journey,{date,direction,target}));return result;}catch(error){if(error instanceof PublicError)throw error;throw fail(error.upstreamStatus===401||error.upstreamStatus===403?'La connexion au service de transport doit être vérifiée par l’administration.':'Le service de transport ne répond pas. Vous pouvez ouvrir votre application de plans.',502);}finally{this.inFlight--;}
 }
 estimate(req,input){
  this.assert(req,this.context(req.user));const date=dateValue(input.date,this.clock()),direction=directionValue(input.direction),buffer=margin(input.bufferMinutes);if(!Number.isInteger(input.minutes)||input.minutes<1||input.minutes>240)throw fail('Choisissez une durée de 1 à 240 minutes.');const target=this.target(req.user,date,direction,buffer),start=direction==='outbound'?target.at-input.minutes*60000:target.at,end=start+input.minutes*60000;
  if(start<this.clock()-60000)throw fail('Avec cette durée, l’heure de départ est déjà passée. Choisissez une autre journée ou ouvrez votre application de plans.',409);
  return {journey:this.stage(req,{departure:new Date(start).toISOString(),arrival:new Date(end).toISOString(),durationMinutes:input.minutes,transfers:0,realtime:false,mode:'manual',legs:[]},{date,direction,target})};
 }
 confirm(req,input){
  this.prune();this.assert(req,this.context(req.user));if(typeof input.token!=='string'||input.token.length>200||typeof input.feed!=='boolean')throw fail('Choisissez le trajet à ajouter à votre agenda.');const row=this.plans.get(digest(input.token));if(!row||row.expires<=this.clock())throw fail('Ce trajet a expiré. Recalculez-le avant de confirmer.',410);
  if(row.userId!==req.user.id||row.session!==req.session.hash||row.context!==this.context(req.user))throw fail('Ce trajet appartient à une autre session. Recalculez-le.',409);
  if(row.result)return {...row.result,blocks:listTravelBlocks(this.store,req.user,{date:row.date}),alreadySaved:true};const journey=row.journey;
  // Keep GPS and address endpoints ephemeral, even when a calendar block is
  // confirmed. Remembering a departure is a separate explicit preference.
  const privateJourney={durationMinutes:journey.durationMinutes,transfers:journey.transfers,realtime:journey.realtime,mode:journey.mode,legs:journey.legs.map(({mode,line,direction,start,end,durationMinutes})=>({mode,line,direction,start,end,durationMinutes}))};
  row.result=saveTravelBlock(this.store,req.user,{date:row.date,direction:row.direction,start:journey.departure,end:journey.arrival,feed:input.feed,...(row.target.courseStart?{courseStart:row.target.courseStart}:{courseEnd:row.target.courseEnd}),mode:journey.mode==='manual'?'mixed':'transit',label:row.direction==='outbound'?'Trajet vers le lycée':'Trajet retour',details:journey.mode==='manual'?'Durée renseignée par vous ; à vérifier avant le départ.':journey.realtime?'Horaires annoncés lors du calcul.':'Horaires prévus lors du calcul.',journey:privateJourney},this.clock());row.journey=null;
  this.audit?.record('travel.updated',{source:'personal',userId:req.user.id,meta:{mode:'calendar'}});return {...row.result,blocks:listTravelBlocks(this.store,req.user,{date:row.date})};
 }
 remove(req,id){this.assert(req,this.context(req.user));const date=listTravelBlocks(this.store,req.user).find(row=>row.id===id)?.date;const result=removeTravelBlock(this.store,req.user,id,this.clock());return {...result,blocks:listTravelBlocks(this.store,req.user,{date})};}
 configure(input){
  const allowed=['enabled','token','coverage','clearToken'];if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))||typeof input.enabled!=='boolean'||input.token!==undefined&&(typeof input.token!=='string'||input.token.length>256||input.token&&!/^[a-zA-Z0-9._~+\/-]{8,256}$/.test(input.token))||input.coverage!==undefined&&(typeof input.coverage!=='string'||!/^[a-zA-Z0-9_.:-]{0,100}$/.test(input.coverage))||input.clearToken!==undefined&&typeof input.clearToken!=='boolean')throw fail('Vérifiez les paramètres du service de transport.');
  const old=this.routing(),token=input.clearToken?'':input.token||old.token;if(input.enabled&&!token)throw fail('Ajoutez la clé du service de transport avant de l’activer.');const value={enabled:input.enabled,token,coverage:input.coverage??old.coverage};this.store.state.settings.smartRouting=this.store.seal(value);this.store.save();this.plans.clear();return {routing:this.publicRouting()};
 }
 async checkRouting(){const config=this.routing();if(!config.token)throw fail('Ajoutez d’abord une clé de connexion.');let data;try{data=await this.requestJSON('https://api.navitia.io/v1/coverage',{headers:{Authorization:config.token}});}catch{throw fail('Le service de transport a refusé la connexion ou est indisponible.',502);}if(!Array.isArray(data.regions))throw fail('Le service n’a pas retourné ses zones de couverture.',502);return {ok:true,coverage:data.regions.slice(0,50).map(value=>({id:clean(value.id,100),name:clean(value.name),start:clean(value.production_dates?.begin,32),end:clean(value.production_dates?.end,32)}))};}
 close(){this.closed=true;clearInterval(this.pruneTimer);this.plans.clear();this.schools.clear();}
}
export function installSmartTravelRoutes(router,{store,auth,admin,rateLimit,clock,audit,...options}){
 const service=new SmartTravelService(store,{clock,audit,...options});
 const body=(req,keys)=>{if(!object(req.body)||req.body.accountId!==req.user.id)throw fail('Le compte a changé. Rechargez Passerelle.',409);if(Object.keys(req.body).some(key=>!['accountId',...keys].includes(key)))throw fail('Paramètres de trajet invalides.');return req.body;};
 router.get('/api/travel/smart',auth,(req,res)=>{rateLimit(req,'smart-travel-view:'+req.user.id,100,900000);res.json(service.view(req.user,req.query.date));});
 router.post('/api/travel/smart/school',auth,async(req,res)=>{body(req,[]);rateLimit(req,'smart-travel-school:'+req.user.id,12,900000);res.json(await service.schoolPlaces(req));});
 router.post('/api/travel/smart/places',auth,async(req,res)=>{const input=body(req,['q']);rateLimit(req,'smart-travel-places:'+req.user.id,30,900000);res.json(await service.places(req,input.q));});
 router.post('/api/travel/smart/settings',auth,(req,res)=>{const input=body(req,['origin','destination','bufferMinutes','date']);rateLimit(req,'smart-travel-settings:'+req.user.id,30,900000);res.json(service.savePreferences(req,input));});
 router.post('/api/travel/smart/plan',auth,async(req,res)=>{const input=body(req,['date','direction','origin','destination','bufferMinutes']);rateLimit(req,'smart-travel-plan:'+req.user.id,12,900000);res.json(await service.plan(req,input));});
 router.post('/api/travel/smart/estimate',auth,(req,res)=>{const input=body(req,['date','direction','minutes','bufferMinutes']);rateLimit(req,'smart-travel-estimate:'+req.user.id,30,900000);res.json(service.estimate(req,input));});
 router.post('/api/travel/smart/confirm',auth,(req,res)=>{const input=body(req,['token','feed']);rateLimit(req,'smart-travel-confirm:'+req.user.id,30,900000);res.json(service.confirm(req,input));});
 router.post('/api/travel/smart/remove',auth,(req,res)=>{const input=body(req,['id']);res.json(service.remove(req,input.id));});
 if(admin){router.get('/api/admin/travel/routing',auth,admin,(req,res)=>res.json({routing:service.publicRouting()}));router.post('/api/admin/travel/routing',auth,admin,(req,res)=>{rateLimit(req,'smart-travel-routing',20,3600000);res.json(service.configure(req.body));audit?.record('travel.updated',{source:'admin',actorId:req.user.id,meta:{mode:'routing'}});});router.post('/api/admin/travel/routing/check',auth,admin,async(req,res)=>{rateLimit(req,'smart-travel-check',10,3600000);res.json(await service.checkRouting());});}
 return service;
}
