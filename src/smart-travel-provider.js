import axios from 'axios';
import {parisEventInstant} from './event-dates.js';
import {PublicError} from './sync.js';

export const clean=(value,max=150)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max):'';
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const hosts=new Set(['data.geopf.fr','api.navitia.io']);
export function locationPoint(value){
 if(!object(value)||Object.keys(value).some(key=>!['lat','lon','label'].includes(key))||!Number.isFinite(value.lat)||Math.abs(value.lat)>90||!Number.isFinite(value.lon)||Math.abs(value.lon)>180||typeof value.label!=='string'||value.label.length>150)throw new PublicError('Choisissez un lieu ou utilisez votre position.');
 return {lat:Math.round(value.lat*1e6)/1e6,lon:Math.round(value.lon*1e6)/1e6,label:clean(value.label)||'Lieu choisi'};
}
export async function requestTransportJSON(address,{headers={}}={}){
 const url=new URL(address);if(url.protocol!=='https:'||!hosts.has(url.hostname)||url.username||url.password||url.port)throw new Error('TRANSPORT_HOST_REFUSED');
 const response=await axios.get(url.href,{timeout:12000,maxRedirects:0,maxContentLength:1024*1024,responseType:'text',validateStatus:()=>true,headers:{Accept:'application/json','User-Agent':'Passerelle/4.17 (+https://repere.84.235.226.127.sslip.io/agenda/)',...headers}});
 if(response.status!==200)throw Object.assign(new Error('TRANSPORT_HTTP'),{upstreamStatus:response.status});
 try{const value=typeof response.data==='string'?JSON.parse(response.data):response.data;if(!object(value))throw new Error();return value;}catch{throw new Error('TRANSPORT_JSON_INVALID');}
}
export function parsePlaces(payload){
 if(!object(payload)||!Array.isArray(payload.features))throw new Error('GEOCODING_INVALID');
 return payload.features.slice(0,5).flatMap(feature=>{
  const coordinates=feature?.geometry?.coordinates,properties=feature?.properties;if(feature?.geometry?.type!=='Point'||!Array.isArray(coordinates)||!object(properties))return [];
  try{return [{...locationPoint({lat:coordinates[1],lon:coordinates[0],label:clean(properties.label)}),score:Number.isFinite(properties.score)?properties.score:0,postcode:clean(properties.postcode,12),type:clean(properties.type,32)}];}catch{return [];}
 });
}
export async function searchTransportPlaces(query,requestJSON=requestTransportJSON){
 const url=new URL('https://data.geopf.fr/geocodage/search');url.searchParams.set('q',query);url.searchParams.set('limit','5');url.searchParams.set('autocomplete','0');
 return parsePlaces(await requestJSON(url.href));
}
export function itineraryLinks(origin,destination){
 const position=p=>p.lat+','+p.lon;
 const google=new URL('https://www.google.com/maps/dir/');google.searchParams.set('api','1');google.searchParams.set('origin',position(origin));google.searchParams.set('destination',position(destination));google.searchParams.set('travelmode','transit');
 const apple=new URL('https://maps.apple.com/');apple.searchParams.set('saddr',position(origin));apple.searchParams.set('daddr',position(destination));apple.searchParams.set('dirflg','r');
 return {google:google.href,apple:apple.href};
}
function instant(raw){
 if(typeof raw!=='string'||!/^\d{8}T\d{6}$/.test(raw))return null;
 const date=raw.slice(0,4)+'-'+raw.slice(4,6)+'-'+raw.slice(6,8),time=raw.slice(9,11)+':'+raw.slice(11,13),seconds=Number(raw.slice(13,15)),base=parisEventInstant(date,time);
 return base&&seconds<60?Date.parse(base)+seconds*1000:null;
}
function navitiaTime(value){
 const parts=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const p=Object.fromEntries(parts.map(item=>[item.type,item.value]));return p.year+p.month+p.day+'T'+p.hour+p.minute+p.second;
}
const legMode=section=>{
 if(['walking','bike','car'].includes(section.mode))return section.mode;
 if(section.type==='waiting')return 'waiting';if(section.type==='transfer')return 'walking';
 const mode=String(section.display_informations?.physical_mode||section.display_informations?.commercial_mode||'').toLowerCase();
 return mode.includes('tram')?'tram':mode.includes('bus')||mode.includes('coach')?'bus':mode.includes('metro')||mode.includes('métro')?'metro':mode.includes('train')||mode.includes('rail')||mode.includes('ter')?'train':'transit';
};
export function parseNavitiaJourneys(payload,{target,direction}){
 if(!object(payload)||!Array.isArray(payload.journeys))return [];
 if(payload.context?.timezone&&payload.context.timezone!=='Europe/Paris')throw new Error('TRAVEL_TIMEZONE_UNSUPPORTED');
 return payload.journeys.slice(0,12).flatMap(journey=>{
  const start=instant(journey.departure_date_time),end=instant(journey.arrival_date_time);
  if(!start||!end||end<=start||end-start>240*60000||direction==='outbound'&&end>target||direction==='inbound'&&start<target||/cancel|no_service/i.test(String(journey.status||''))||!Array.isArray(journey.sections)||journey.sections.length>30)return [];
  let invalid=false;const transit=[];const legs=journey.sections.map(section=>{
   const from=instant(section.departure_date_time),to=instant(section.arrival_date_time);
   if(!from||!to||to<from||from<start||to>end||section.additional_informations?.includes('cancelled'))invalid=true;
   if(['public_transport','on_demand_transport'].includes(section.type))transit.push(section.data_freshness==='realtime');
   return {mode:legMode(section),line:clean(section.display_informations?.code,60),direction:clean(section.display_informations?.direction),from:clean(section.from?.name),to:clean(section.to?.name),start:from?new Date(from).toISOString():null,end:to?new Date(to).toISOString():null,durationMinutes:from&&to?Math.ceil((to-from)/60000):0};
  });
  if(invalid||!legs.length)return [];
  const realtime=transit.length>0&&transit.every(Boolean);
  return [{departure:new Date(start).toISOString(),arrival:new Date(end).toISOString(),durationMinutes:Math.ceil((end-start)/60000),transfers:Number.isInteger(journey.nb_transfers)&&journey.nb_transfers>=0?journey.nb_transfers:0,realtime,realtimeStatus:realtime?'live':transit.some(Boolean)?'mixed':'scheduled',mode:'provider',legs}];
 }).sort((a,b)=>direction==='outbound'?Date.parse(b.departure)-Date.parse(a.departure):Date.parse(a.departure)-Date.parse(b.departure)).slice(0,3);
}
export async function computeTransportJourneys({origin,destination,target,direction,token,coverage},requestJSON=requestTransportJSON){
 const path=coverage?'coverage/'+encodeURIComponent(coverage)+'/journeys':'journeys',url=new URL('https://api.navitia.io/v1/'+path);
 url.searchParams.set('from',origin.lon+';'+origin.lat);url.searchParams.set('to',destination.lon+';'+destination.lat);url.searchParams.set('datetime',navitiaTime(target));url.searchParams.set('datetime_represents',direction==='outbound'?'arrival':'departure');url.searchParams.set('data_freshness','realtime');url.searchParams.set('max_nb_journeys','3');url.searchParams.set('depth','1');
 const payload=await requestJSON(url.href,{headers:{Authorization:token}});
 const publishers=Array.isArray(payload.feed_publishers)?[...new Set(payload.feed_publishers.slice(0,20).map(value=>clean(value?.name)).filter(Boolean))]:[];
 return parseNavitiaJourneys(payload,{target,direction}).map(journey=>({...journey,publishers}));
}
