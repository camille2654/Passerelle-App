import ICAL from 'ical.js';
import {createHash} from 'node:crypto';
import {isMainThread,parentPort,workerData} from 'node:worker_threads';
const digest=value=>createHash('sha256').update(value).digest('hex');
const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'});
const parisDate=date=>dayFormatter.format(date);
const shiftDate=(day,count)=>{const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+count);return date.toISOString().slice(0,10);};
const MAX_BYTES=1024*1024,MAX_EVENTS=5000;
export const calendarSafeText=(value,max=200)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const safeText=calendarSafeText;
export const validCalendarDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const formatters=new Map();
function parts(zone,stamp){
  let formatter=formatters.get(zone);
  if(!formatter){formatter=new Intl.DateTimeFormat('en-GB',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});formatters.set(zone,formatter);}
  return Object.fromEntries(formatter.formatToParts(new Date(stamp)).filter(value=>value.type!=='literal').map(value=>[value.type,value.value]));
}
function zonedInstant(time,zone='Europe/Paris'){
  const naive=Date.UTC(time.year,time.month-1,time.day,time.hour||0,time.minute||0,time.second||0),offsets=new Set();
  for(const delta of [-86400000,0,86400000]){const sample=naive+delta,p=parts(zone,sample);offsets.add(Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)-sample);}
  const matches=[...offsets].map(offset=>naive-offset).filter(stamp=>{const p=parts(zone,stamp);return +p.year===time.year&&+p.month===time.month&&+p.day===time.day&&+p.hour===(time.hour||0)&&+p.minute===(time.minute||0)&&+p.second===(time.second||0);});
  // An ambiguous local hour must be made explicit in the source calendar.
  if(matches.length!==1)throw new Error('INVALID_LOCAL_TIME');
  return new Date(matches[0]).toISOString();
}
export function calendarMidnight(day){return zonedInstant({year:+day.slice(0,4),month:+day.slice(5,7),day:+day.slice(8,10)},'Europe/Paris');}
export function calendarAtMinute(day,minute){return zonedInstant({year:+day.slice(0,4),month:+day.slice(5,7),day:+day.slice(8,10),hour:Math.floor(minute/60),minute:minute%60},'Europe/Paris');}
function instant(time,component,calendarZone){
  if(time.isDate)return calendarMidnight(time.toString());
  if(time.zone&&time.zone.tzid!=='floating')return new Date(time.toUnixTime()*1000).toISOString();
  const tzid=component.getFirstProperty('dtstart')?.getParameter('tzid')||calendarZone||'Europe/Paris';
  return zonedInstant(time,tzid);
}
function rawDatesValid(component){
  for(const property of component.getAllProperties()){
    if(!['dtstart','dtend','recurrence-id','exdate','rdate'].includes(property.name))continue;
    for(const raw of property.jCal.slice(3)){
      const values=Array.isArray(raw)?raw:[raw];
      for(const value of values){if(typeof value!=='string')continue;const day=value.slice(0,10);if(!validCalendarDay(day)||value.length>10&&!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\dZ?$/.test(value))throw new Error('INVALID_DATE');}
    }
  }
}
export function personalCalendarRange(now){const today=parisDate(new Date(now));return {start:shiftDate(today,-30),end:shiftDate(today,366)};}

/** Synchronous core used only inside a bounded worker for untrusted calendars. */
export function parsePersonalCalendar(ics,{now=Date.now()}={}){
  if(typeof ics!=='string'||Buffer.byteLength(ics)>MAX_BYTES||!ics.trim()||ics.includes('\u0000'))throw new Error('INVALID_CALENDAR');
  const data=ICAL.parse(ics),calendar=new ICAL.Component(data);
  if(calendar.name!=='vcalendar'||calendar.getFirstPropertyValue('version')!=='2.0')throw new Error('INVALID_CALENDAR');
  const components=calendar.getAllSubcomponents('vevent');
  if(components.length>MAX_EVENTS||calendar.getAllSubcomponents('vtimezone').length>50)throw new Error('CALENDAR_LIMIT');
  const window=personalCalendarRange(now),lower=Date.parse(calendarMidnight(window.start)),upper=Date.parse(calendarMidnight(shiftDate(window.end,1))),timezone=String(calendar.getFirstPropertyValue('x-wr-timezone')||'Europe/Paris');
  const unique=new Map();
  for(const component of components){
    rawDatesValid(component);
    const uid=component.getFirstPropertyValue('uid');
    if(typeof uid!=='string'||!uid||uid.length>1000)throw new Error('INVALID_UID');
    const recurrence=component.getFirstPropertyValue('recurrence-id')?.toString()||'',key=uid+'\u0000'+recurrence,old=unique.get(key);
    const sequence=Number(component.getFirstPropertyValue('sequence')||0),stamp=component.getFirstPropertyValue('dtstamp')?.toString()||'';
    if(!Number.isSafeInteger(sequence)||sequence<0)throw new Error('INVALID_SEQUENCE');
    if(old){
      const oldSequence=Number(old.getFirstPropertyValue('sequence')||0),oldStamp=old.getFirstPropertyValue('dtstamp')?.toString()||'';
      if(sequence<oldSequence||sequence===oldSequence&&stamp<oldStamp)continue;
      if(sequence===oldSequence&&stamp===oldStamp&&component.toString()!==old.toString())throw new Error('CONFLICTING_UID');
    }
    unique.set(key,component);
  }
  const rows=[...unique.values()],masters=new Map(rows.filter(component=>!component.hasProperty('recurrence-id')).map(component=>[component.getFirstPropertyValue('uid'),component])),events=[],keys=new Set();
  let iterations=0;
  const emit=(event,start,end,recurrence)=>{
    const component=event.component;
    if(String(component.getFirstPropertyValue('status')||'').toUpperCase()==='CANCELLED')return;
    if(!start||!end)throw new Error('INVALID_EVENT_DATES');
    const allDay=start.isDate;
    if(allDay!==end.isDate)throw new Error('INVALID_EVENT_DATES');
    const startStamp=instant(start,component,timezone),endStamp=instant(end,component,timezone),a=Date.parse(startStamp),b=Date.parse(endStamp);
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<a)throw new Error('INVALID_EVENT_DATES');
    if(b===a||b<=lower||a>=upper)return;
    const uid=String(event.uid),occurrence=String(recurrence||start.toString()),key=uid+'\u0000'+occurrence;
    if(keys.has(key))return;keys.add(key);
    if(events.length>=MAX_EVENTS)throw new Error('CALENDAR_LIMIT');
    const transparent=String(component.getFirstPropertyValue('transp')||'OPAQUE').toUpperCase()==='TRANSPARENT';
    events.push({uid:digest(uid),occurrence:digest(occurrence),title:safeText(event.summary||'Rendez-vous personnel',200),location:safeText(component.getFirstPropertyValue('location'),200),start:startStamp,end:endStamp,date:allDay?start.toString():parisDate(new Date(a)),endDate:allDay?end.toString():parisDate(new Date(b)),allDay,busy:!transparent});
  };
  for(const component of rows){
    const uid=component.getFirstPropertyValue('uid');
    if(component.hasProperty('recurrence-id')&&masters.has(uid))continue;
    if(String(component.getFirstPropertyValue('status')||'').toUpperCase()==='CANCELLED')continue;
    if(!component.hasProperty('dtstart'))throw new Error('INVALID_EVENT_DATES');
    const related=rows.filter(value=>value!==component&&value.hasProperty('recurrence-id')&&value.getFirstPropertyValue('uid')===uid);
    for(const exception of related.filter(value=>String(value.getFirstPropertyValue('status')||'').toUpperCase()==='CANCELLED')){const exclusion=new ICAL.Property('exdate'),reference=exception.getFirstProperty('recurrence-id');exclusion.setValue(reference.getFirstValue());const zone=reference.getParameter('tzid');if(zone)exclusion.setParameter('tzid',zone);component.addProperty(exclusion);}
    const exceptions=related.filter(value=>String(value.getFirstPropertyValue('status')||'').toUpperCase()!=='CANCELLED');
    const event=new ICAL.Event(component,{exceptions,strictExceptions:true});
    if(!event.isRecurring()){emit(event,event.startDate,event.endDate,event.recurrenceId?.toString());continue;}
    for(const property of component.getAllProperties('rrule')){
      const rule=property.getFirstValue();
      if(['SECONDLY','MINUTELY','HOURLY'].includes(rule.freq))throw new Error('RECURRENCE_TOO_DENSE');
    }
    const initial=event.startDate,excluded=component.getAllProperties('exdate').flatMap(property=>property.getValues()).some(value=>value.isDate?value.year===initial.year&&value.month===initial.month&&value.day===initial.day:value.compare(initial)===0);
    if(!excluded){const first=event.getOccurrenceDetails(initial);emit(first.item,first.startDate,first.endDate,initial.toString());}
    const iterator=event.iterator();let value;
    while((value=iterator.next())){
      if(++iterations>50000)throw new Error('RECURRENCE_LIMIT');
      const nominal=Date.parse(instant(value,component,timezone));
      // An occurrence can be moved by an exception; expand one year past the
      // window as a bounded allowance, then include detached moved exceptions.
      if(nominal>upper+366*86400000)break;
      const detail=event.getOccurrenceDetails(value);emit(detail.item,detail.startDate,detail.endDate,value.toString());
    }
    for(const exception of exceptions){const detached=new ICAL.Event(exception);emit(detached,detached.startDate,detached.endDate,detached.recurrenceId?.toString());}
  }
  return {window,events:events.sort((a,b)=>a.start.localeCompare(b.start)||a.uid.localeCompare(b.uid))};
}

if(!isMainThread&&workerData?.kind==='passerelle:personal-calendar'){try{parentPort.postMessage({ok:true,value:parsePersonalCalendar(workerData.ics,workerData.options)});}catch{parentPort.postMessage({ok:false});}}
