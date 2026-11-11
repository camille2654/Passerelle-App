import {digest} from './store.js';
import {parisDate,shiftDate} from './work.js';
import {accountActive} from './operational-state.js';

const MINUTE=60000,DAY=86400000;
const parisHour=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',hourCycle:'h23'});
const stamp=value=>Number.isFinite(value)&&value>0?value:null;
const windowCache=new Map();

export function schoolWindow(now=new Date()){
  const today=parisDate(now),[year,month]=today.split('-').map(Number),firstYear=month>=9?year:year-1;
  if(windowCache.has(firstYear))return {...windowCache.get(firstYear)};
  const start=firstYear+'-09-01',end=(firstYear+1)+'-08-31';
  const midnight=date=>{
    const offset=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Paris',timeZoneName:'shortOffset'}).formatToParts(new Date(date+'T00:00:00Z')).find(part=>part.type==='timeZoneName').value;
    return new Date(Date.parse(date+'T00:00:00Z')-Number(offset.replace('GMT',''))*3600000).toISOString();
  };
  const result={start,end,label:firstYear+'–'+(firstYear+1),timeMin:midnight(start),timeMax:midnight((firstYear+1)+'-09-01')};
  if(windowCache.size>=4)windowCache.delete(windowCache.keys().next().value);
  windowCache.set(firstYear,result);return {...result};
}

export function recentWindow(now=Date.now(),year=schoolWindow(new Date(now))){
  const today=parisDate(new Date(now));
  return {start:[year.start,shiftDate(today,-2)].sort().at(-1),end:[year.end,shiftDate(today,14)].sort()[0],label:year.label};
}

export function syncInterval(user,now=Date.now()){
  const active=Math.max(stamp(user.managedLastActiveAt)||0,stamp(user.lastSeenAt)||0);
  if(active>0&&active<=now&&now-active<10*MINUTE)return 2*MINUTE;
  const hour=Number(parisHour.format(new Date(now)));
  return hour>=7&&hour<20?5*MINUTE:30*MINUTE;
}

export function fullSyncDueAt(user,now=Date.now()){
  const year=schoolWindow(new Date(now));
  if(!stamp(user.lastSync)||user.dataVersion!==3||user.calendarWindow?.start!==year.start||user.calendarWindow?.end!==year.end)return 0;
  // Existing v3 installations already hold the whole year. Their latest complete
  // sync seeds the daily schedule until the first lightweight run persists it.
  const previous=stamp(user.lastFullSync)||stamp(user.lastSync);
  const jitter=parseInt(digest(String(user.id)).slice(0,8),16)%(30*MINUTE+1);
  return previous+DAY+jitter;
}

export function nextSyncAt(user,now=Date.now()){
  if(!accountActive(user)||!user.enabled||!user.skolengo||!user.studentId||user.skolengoError)return null;
  const previous=stamp(user.lastAttempt)||stamp(user.lastSync)||0;
  const normal=previous+syncInterval(user,now);
  const full=fullSyncDueAt(user,now);
  const incompatible=user.lastAttemptVersion!==3||user.lastAttemptWindow?.start!==schoolWindow(new Date(now)).start||user.lastAttemptWindow?.end!==schoolWindow(new Date(now)).end;
  let due=incompatible?0:Math.min(normal,full);
  if(stamp(user.syncRequestedAt)&&user.syncRequestedAt>previous)due=Math.min(due,Math.max(previous+MINUTE,user.syncRequestedAt));
  return Math.max(due,stamp(user.syncRetryAt)||0);
}

export function syncPolicy(user,now=Date.now()){
  const fullAt=fullSyncDueAt(user,now);
  return {intervalMs:syncInterval(user,now),nextSyncAt:nextSyncAt(user,now),lastFullSync:stamp(user.lastFullSync)||stamp(user.lastSync),fullSyncDueAt:fullAt,mode:fullAt<=now?'full':'near'};
}

export function retryDelay(error,streak,now=Date.now()){
  const headers=error?.response?.headers||error?.headers;
  const raw=typeof headers?.get==='function'?headers.get('retry-after'):headers?.['retry-after'];
  let retryAfter=0;
  if(typeof raw==='string'||typeof raw==='number'){
    const text=String(raw).trim(),seconds=/^\d+(?:\.\d+)?$/.test(text)?Number(text):null;
    retryAfter=seconds===null?Math.max(0,Date.parse(text)-now):seconds*1000;
    if(!Number.isFinite(retryAfter))retryAfter=0;
  }
  const exponential=5*MINUTE*2**Math.max(0,Math.min(6,streak-1));
  return Math.min(60*MINUTE,Math.max(exponential,retryAfter));
}

export function mergeRangeAssignments(previous,incoming,range){
  const ids=new Set(incoming.map(item=>item.id));
  return [...(previous||[]).filter(item=>(item.due<range.start||item.due>range.end)&&!ids.has(item.id)),...incoming];
}
