import {digest} from './store.js';
import {PublicError,dateWindow} from './sync.js';
import {parisDate,shiftDate} from './work.js';
import {accountActive} from './operational-state.js';
import {rebuildCalendar} from './calendar.js';

const MAX_BLOCKS=800,MAX_JOURNEY_BYTES=20000;
const modes={transit:'Transports en commun',walking:'À pied',cycling:'À vélo',driving:'En voiture',mixed:'Trajet multimodal'};
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const text=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
export const travelBlockScope=user=>digest(JSON.stringify([user.id,user.studentId||null,user.schoolName||null,user.skolengoConnectionId||null]));
const blockId=(scope,date,direction)=>'travel-'+digest(JSON.stringify([scope,date,direction])).slice(0,40);
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;}
function instant(value){if(typeof value!=='string'||value.length>40||!validDate(value.slice(0,10))||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new PublicError('Choisissez des horaires de trajet valides.');return new Date(value).toISOString();}
export function travelCourseBounds(user,date){
 const courses=Object.values(user.calendarEvents||{}).filter(course=>course.date===date&&!course.cancelled&&Number.isFinite(Date.parse(course.start))&&Number.isFinite(Date.parse(course.end))&&Date.parse(course.end)>Date.parse(course.start));
 const first=courses.reduce((best,course)=>!best||Date.parse(course.start)<Date.parse(best.start)?course:best,null),last=courses.reduce((best,course)=>!best||Date.parse(course.end)>Date.parse(best.end)?course:best,null);
 return {first:first?new Date(first.start).toISOString():null,last:last?new Date(last.end).toISOString():null};
}
function isCurrent(user,row){const bounds=travelCourseBounds(user,row.date);return row.courseBoundary===(row.direction==='outbound'?bounds.first:bounds.last)&&!!row.courseBoundary;}
function currentRows(user){return user?.skolengo&&user.travelBlockScope===travelBlockScope(user)?Object.values(user.travelCalendar||{}):[];}
const visible=row=>({id:row.id,date:row.date,direction:row.direction,title:row.title,start:row.start,end:row.end,feed:row.feed,mode:row.mode,created:row.created,modified:row.modified,sequence:row.sequence});

// This envelope never contains an address, position, route geometry or free text.
// It can be used by the existing calendar pipeline without decrypting a trip.
export function travelCalendarRows(user,{start=null,end=null,date=null,includeReview=true}={}){
 return currentRows(user).filter(row=>(!date||row.date===date)&&(!start||row.date>=start)&&(!end||row.date<=end)).map(row=>({...visible(row),kind:'travel',allDay:false,busy:isCurrent(user,row),needsReview:!isCurrent(user,row),warning:isCurrent(user,row)?null:'Les horaires des cours ont changé. Vérifiez ce trajet avant de partir.'})).filter(row=>includeReview||!row.needsReview).sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id));
}
export function travelCalendarEvents(user){
 return currentRows(user).filter(row=>row.feed&&isCurrent(user,row)).map(row=>({id:row.id,date:row.date,kind:'travel',title:row.title,start:row.start,end:row.end,allDay:false,location:'',description:row.description,created:row.created,modified:row.modified,sequence:row.sequence,cancelled:false}));
}
function privateState(store,user){
 if(user.travelBlockScope!==travelBlockScope(user)||!user.travelBlockState)return {items:{}};
 try{const state=store.open(user.travelBlockState);if(!object(state)||!object(state.items))throw new Error();return state;}
 catch{throw new PublicError('Vos trajets enregistrés ne peuvent pas être ouverts. Contactez l’assistance.',409);}
}
export function listTravelBlocks(store,user,options={}){
 const state=privateState(store,user);
 return travelCalendarRows(user,options).map(row=>({...row,...structuredClone(state.items[row.id]?.value||{})}));
}
function privateJSON(value){
 if(value===undefined)return null;let count=0;
 const valid=(item,depth=0)=>{if(++count>3000||depth>14)return false;if(item===null||typeof item==='boolean')return true;if(typeof item==='number')return Number.isFinite(item);if(typeof item==='string')return item.length<=10000;if(Array.isArray(item))return item.length<=1000&&item.every(value=>valid(value,depth+1));if(!object(item)||![Object.prototype,null].includes(Object.getPrototypeOf(item)))return false;return Object.entries(item).every(([key,value])=>key.length<=100&&!['__proto__','constructor','prototype'].includes(key)&&valid(value,depth+1));};
 if(!valid(value))throw new PublicError('Les détails du trajet sont invalides.');
 const encoded=JSON.stringify(value);if(Buffer.byteLength(encoded)>MAX_JOURNEY_BYTES)throw new PublicError('Le détail du trajet est trop volumineux.');return JSON.parse(encoded);
}
function assertOwner(store,user){if(!accountActive(user)||store.user(user.id)!==user)throw new PublicError('Le compte a changé. Rechargez vos trajets.',409);}
function persist(store,user,values,now){
 const previous=structuredClone(user);
 try{store.update(user.id,values);rebuildCalendar(store,user.id,now);}
 catch(error){for(const key of Object.keys(user))delete user[key];Object.assign(user,previous);store.save();throw error;}
}
export function saveTravelBlock(store,user,input,now=Date.now()){
 assertOwner(store,user);
 const allowed=['date','direction','start','end','feed','courseStart','courseEnd','label','details','journey','mode'];
 if(!object(input)||Object.keys(input).some(key=>!allowed.includes(key))||!validDate(input.date)||!['outbound','inbound'].includes(input.direction)||typeof input.feed!=='boolean')throw new PublicError('Vérifiez le jour, le sens et la destination du trajet.');
 const window=dateWindow(new Date(now));if(input.date<window.start||input.date>window.end)throw new PublicError('Choisissez une journée de l’année scolaire en cours.');
 if(!user.skolengo||!user.studentId||user.skolengoError||user.lastError||!Number.isFinite(user.lastSync)||user.lastSync>now+5*60000||now-user.lastSync>30*60000||!user.calendarWindow||input.date<user.calendarWindow.start||input.date>user.calendarWindow.end)throw new PublicError('Actualisez votre emploi du temps avant de confirmer ce trajet.',409);
 const bounds=travelCourseBounds(user,input.date),boundary=input.direction==='outbound'?bounds.first:bounds.last,provided=input.direction==='outbound'?input.courseStart:input.courseEnd;
 if(!boundary)throw new PublicError('Aucun cours actif n’est publié pour cette journée.',409);
 if(provided===undefined||instant(provided)!==boundary)throw new PublicError('Les horaires des cours ont changé. Recalculez le trajet.',409);
 if(input.courseStart!==undefined&&instant(input.courseStart)!==bounds.first||input.courseEnd!==undefined&&instant(input.courseEnd)!==bounds.last)throw new PublicError('Les horaires des cours ont changé. Recalculez le trajet.',409);
 const start=instant(input.start),end=instant(input.end),a=Date.parse(start),b=Date.parse(end),limit=Date.parse(boundary);
 if(b<=a||b-a>6*3600000||parisDate(new Date(a))<shiftDate(input.date,-1)||parisDate(new Date(b))>shiftDate(input.date,1)||input.direction==='outbound'&&(b>limit||limit-b>2*3600000)||input.direction==='inbound'&&(a<limit||a-limit>2*3600000))throw new PublicError('Le trajet doit précéder le premier cours ou suivre le dernier cours, avec une marge de deux heures maximum.');
 for(const key of ['label','details'])if(input[key]!==undefined&&(typeof input[key]!=='string'||input[key].length>(key==='label'?200:4000)))throw new PublicError('Le texte du trajet est trop long.');
 const mode=input.mode||'transit';if(!Object.hasOwn(modes,mode))throw new PublicError('Choisissez un mode de déplacement valide.');
 const scope=travelBlockScope(user),id=blockId(scope,input.date,input.direction),state=privateState(store,user),value={label:text(input.label,200),details:text(input.details,4000),journey:privateJSON(input.journey)};
 const rows=user.travelBlockScope===scope?structuredClone(user.travelCalendar||{}):{},prior=rows[id],privateHash=digest(JSON.stringify(value));
 const hash=digest(JSON.stringify({date:input.date,direction:input.direction,start,end,feed:input.feed,courseBoundary:boundary,mode})),unchanged=prior?.hash===hash;
 if(unchanged&&state.items[id]?.hash===privateHash)return {ok:true,alreadySaved:true,block:travelCalendarRows(user,{date:input.date}).find(row=>row.id===id)};
 const row={id,date:input.date,direction:input.direction,title:input.direction==='outbound'?'Trajet vers le lycée':'Trajet retour',start,end,feed:input.feed,courseBoundary:boundary,mode,description:`${modes[mode]}. Trajet confirmé dans Passerelle ; les horaires de transport peuvent évoluer.`,hash,created:prior?.created||now,modified:unchanged?prior.modified:now,sequence:prior?(prior.sequence||0)+(unchanged?0:1):0};
 rows[id]=row;state.items[id]={hash:privateHash,value};
 const oldest=shiftDate(parisDate(new Date(now)),-90);
 for(const [key,event]of Object.entries(rows))if(event.date<oldest){delete rows[key];delete state.items[key];}
 if(Object.keys(rows).length>MAX_BLOCKS)throw new PublicError('Le nombre maximal de trajets enregistrés est atteint. Retirez d’anciens trajets avant de continuer.',409);
 persist(store,user,{travelBlockScope:scope,travelCalendar:rows,travelBlockState:store.seal(state),personalVersion:now},now);
 return {ok:true,block:travelCalendarRows(user,{date:input.date}).find(value=>value.id===id)};
}
export function removeTravelBlock(store,user,id,now=Date.now()){
 assertOwner(store,user);
 if(typeof id!=='string'||!/^travel-[a-f0-9]{40}$/.test(id)||!currentRows(user).some(row=>row.id===id))throw new PublicError('Ce trajet n’appartient pas à ce profil.',404);
 const rows=structuredClone(user.travelCalendar),state=privateState(store,user);delete rows[id];delete state.items[id];
 persist(store,user,{travelCalendar:rows,travelBlockState:store.seal(state),personalVersion:now},now);return {ok:true};
}
