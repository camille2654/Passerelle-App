import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import express from 'express';
import {Store,digest} from '../src/store.js';
import {parsePersonalCalendar,parsePersonalCalendarSafely,PersonalCalendarService,personalBusyEvents,personalCalendarScope,safeCalendarURL,publicCalendarAddress,fetchCalendar,installPersonalCalendarRoutes} from '../src/personal-calendar.js';
import {weekView,revisionPlan,commonSlots} from '../src/planner.js';

const now=Date.parse('2026-10-29T12:00:00Z');
const event=(uid='private-event',extra=[])=>['BEGIN:VEVENT','UID:'+uid,'DTSTART:20261105T170000Z','DTEND:20261105T180000Z','SUMMARY:Private appointment','LOCATION:Private room',...extra,'END:VEVENT'];
const calendar=(events=[event()],extra=[])=>['BEGIN:VCALENDAR','VERSION:2.0',...extra,...events.flat(),'END:VCALENDAR'].join('\r\n');
const parse=ics=>parsePersonalCalendar(ics,{now});
async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-personal-calendar-')),store=new Store(dir),app=express(),router=express.Router();
  const controls={ics:calendar(),fail:null,gate:null,entered:null,calls:0};let at=now;
  for(const id of ['a','b'])store.state.users.push({id,name:'Fixture',studentId:'student-'+id,schoolName:'School',calendarEvents:{},cachedICS:'unchanged school calendar'});
  for(const id of ['a','b'])store.state.sessions.push({hash:digest(id),userId:id,expires:Date.now()+3600000});store.save();
  app.use(express.json({limit:'128kb'}));app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='POST'&&req.get('origin')!=='http://127.0.0.1')return res.status(403).json({error:'origin'});req.session=store.state.sessions.find(session=>session.hash===digest(req.get('x-session')||'')&&session.expires>Date.now());req.user=req.session&&store.user(req.session.userId);next();});
  const auth=(req,res,next)=>req.user?next():res.status(401).json({error:'auth'});
  const service=installPersonalCalendarRoutes(router,{store,auth,rateLimit:()=>{},clock:()=>at,fetcher:async()=>{controls.calls++;controls.entered?.();if(controls.gate)await controls.gate;if(controls.fail)throw controls.fail;return controls.ics;}});app.use('/agenda',router);app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.message}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  return {store,service,controls,setNow:value=>{at=value;},async request(route,body,who='a',origin='http://127.0.0.1',raw=false){const response=await fetch('http://127.0.0.1:'+server.address().port+'/agenda/api/'+route,{headers:{'x-session':who,origin,...(body!==undefined?{'Content-Type':raw?'text/calendar':'application/json'}:{}),...(raw?{'x-passerelle-account':who,'x-calendar-title':encodeURIComponent('Private file')}:{} )},...(body!==undefined?{method:'POST',body:raw?body:JSON.stringify(body)}:{})});return {status:response.status,body:await response.json(),headers:response.headers};},async close(){service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}};
}

test('ICS imports preserve UTC, duration and all-day transparency without cancelled appointments',()=>{
  const ics=calendar([event(),['BEGIN:VEVENT','UID:duration','DTSTART:20261106T180000Z','DURATION:PT90M','SUMMARY:Practice','END:VEVENT'],['BEGIN:VEVENT','UID:day','DTSTART;VALUE=DATE:20261107','DTEND;VALUE=DATE:20261108','TRANSP:TRANSPARENT','SUMMARY:Reminder','END:VEVENT'],event('cancelled',['STATUS:CANCELLED'])]);
  const result=parse(ics);assert.equal(result.events.length,3);assert.equal(result.events[0].start,'2026-11-05T17:00:00.000Z');const duration=result.events.find(item=>item.title==='Practice');assert.equal(duration.end,'2026-11-06T19:30:00.000Z');const whole=result.events.find(item=>item.allDay);assert.equal(whole.start,'2026-11-06T23:00:00.000Z');assert.equal(whole.end,'2026-11-07T23:00:00.000Z');assert.equal(whole.busy,false);
});

test('RRULE, RDATE, EXDATE and recurrence exceptions use stable occurrence identities',()=>{
  const base=['BEGIN:VEVENT','UID:weekly','DTSTART;TZID=Europe/Paris:20261102T180000','DTEND;TZID=Europe/Paris:20261102T190000','RRULE:FREQ=WEEKLY;COUNT=3','RDATE;TZID=Europe/Paris:20261104T180000','EXDATE;TZID=Europe/Paris:20261109T180000','SUMMARY:Weekly sport','END:VEVENT'];
  const exception=['BEGIN:VEVENT','UID:weekly','RECURRENCE-ID;TZID=Europe/Paris:20261116T180000','DTSTART;TZID=Europe/Paris:20261117T190000','DTEND;TZID=Europe/Paris:20261117T200000','SUMMARY:Moved sport','END:VEVENT'];
  const rows=parse(calendar([base,exception])).events;assert.deepEqual(rows.map(item=>item.date),['2026-11-02','2026-11-04','2026-11-17']);assert.equal(rows[0].start,'2026-11-02T17:00:00.000Z');assert.equal(rows[2].title,'Moved sport');assert.equal(new Set(rows.map(item=>item.occurrence)).size,3);
  const onlyRDate=calendar([['BEGIN:VEVENT','UID:rdate','DTSTART:20261102T180000Z','DURATION:PT1H','RDATE:20261105T180000Z','END:VEVENT']]);assert.deepEqual(parse(onlyRDate).events.map(item=>item.date),['2026-11-02','2026-11-05']);
});

test('IANA floating dates and source VTIMEZONE handle the Paris winter transition',()=>{
  const recurring=['BEGIN:VEVENT','UID:dst','DTSTART;TZID=Europe/Paris:20261022T180000','DTEND;TZID=Europe/Paris:20261022T190000','RRULE:FREQ=WEEKLY;COUNT=3','SUMMARY:Sport','END:VEVENT'];
  assert.deepEqual(parse(calendar([recurring])).events.map(item=>item.start),['2026-10-22T16:00:00.000Z','2026-10-29T17:00:00.000Z','2026-11-05T17:00:00.000Z']);
  const zone=['BEGIN:VTIMEZONE','TZID:School/Paris','BEGIN:STANDARD','DTSTART:19701025T030000','TZOFFSETFROM:+0200','TZOFFSETTO:+0100','RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU','END:STANDARD','BEGIN:DAYLIGHT','DTSTART:19700329T020000','TZOFFSETFROM:+0100','TZOFFSETTO:+0200','RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU','END:DAYLIGHT','END:VTIMEZONE'];
  assert.deepEqual(parse(calendar([recurring.map(line=>line.replace('Europe/Paris','School/Paris'))],zone)).events.map(item=>item.start),['2026-10-22T16:00:00.000Z','2026-10-29T17:00:00.000Z','2026-11-05T17:00:00.000Z']);
  assert.throws(()=>parse(calendar([event().map(line=>line.replace('DTSTART:20261105T170000Z','DTSTART;TZID=Unknown/Zone:20261105T170000'))])));
});

test('duplicate UIDs reconcile source revisions and reject contradictory or invalid calendars',()=>{
  const first=event('same',['SEQUENCE:1']),updated=event('same',['SEQUENCE:2']).map(line=>line.replace('Private appointment','Updated appointment'));
  assert.equal(parse(calendar([first,updated,updated])).events.length,1);assert.equal(parse(calendar([first,updated])).events[0].title,'Updated appointment');
  assert.throws(()=>parse(calendar([first,first.map(line=>line.replace('Private appointment','Conflict'))])));
  for(const input of ['not an ICS',calendar([event().filter(line=>!line.startsWith('UID:'))]),calendar([event().map(line=>line.replace('20261105T170000Z','20261131T170000Z'))]),calendar([event().map(line=>line.replace('20261105T170000Z','20261105T250000Z'))]),calendar([event('dense',['RRULE:FREQ=SECONDLY;COUNT=1000000'])]),' '.repeat(1024*1024+1)])assert.throws(()=>parse(input));
});

test('calendar parsing runs in a bounded worker and rejects dense recurrence safely',async()=>{
  assert.equal((await parsePersonalCalendarSafely(calendar(),{now})).events.length,1);
  const started=performance.now();await assert.rejects(()=>parsePersonalCalendarSafely(calendar([event('dense',['RRULE:FREQ=SECONDLY;COUNT=9999999'])]),{now}),/invalide|complexe/);assert.ok(performance.now()-started<5000);
});

test('calendar APIs require the account and origin and never expose stored URLs or source text',async()=>{
  const f=await fixture();try{
    assert.equal((await f.request('personal-calendars',undefined,'none')).status,401);assert.equal((await f.request('personal-calendars/add',{accountId:'a',title:'Private calendar',ics:calendar()},'a','https://outside.invalid')).status,403);assert.equal((await f.request('personal-calendars/add',{accountId:'b',title:'Private calendar',ics:calendar()})).status,409);
    const result=await f.request('personal-calendars/add',{accountId:'a',title:'Private calendar',url:'https://calendar.google.com/calendar/ical/private-token/basic.ics'});assert.equal(result.status,200);assert.equal(result.body.items.length,1);assert.equal(result.body.items[0].hasSource,true);assert.equal(result.headers.get('cache-control'),'no-store');
    const stored=fs.readFileSync(f.store.file,'utf8');for(const secret of ['private-token','Private calendar','Private appointment','Private room','BEGIN:VCALENDAR'])assert.equal(stored.includes(secret),false,secret);
    assert.equal(JSON.stringify(result.body).includes('private-token'),false);assert.deepEqual((await f.request('personal-calendars',undefined,'b')).body.items,[]);assert.equal((await f.request('personal-calendars/'+result.body.items[0].id+'/remove',{accountId:'b'},'b')).status,404);assert.equal(f.store.user('a').cachedICS,'unchanged school calendar');
  }finally{await f.close();}
});

test('files larger than the JSON parser limit upload privately and keep all source data encrypted',async()=>{
  const f=await fixture();try{
    const large=calendar([event()],['X-WR-CALDESC:'+ 'a'.repeat(150000)]),result=await f.request('personal-calendars/upload',large,'a','http://127.0.0.1',true);assert.equal(result.status,200);assert.equal(result.body.items[0].sourceType,'file');assert.equal(f.controls.calls,0);const view=await f.request('personal-calendars/view?start=2026-11-05&end=2026-11-05');assert.equal(view.status,200);assert.equal(view.body.events.length,1);
    assert.equal((await f.request('personal-calendars/upload','x'.repeat(1024*1024+1),'a','http://127.0.0.1',true)).status,413);
  }finally{await f.close();}
});

test('refresh preserves the last valid snapshot, updates UID events once, and removal persists',async()=>{
  const f=await fixture();try{
    const user=f.store.user('a'),added=await f.service.add(user,{title:'Subscription',url:'https://calendar.google.com/calendar/ical/private/basic.ics'}),id=added.items[0].id,first=f.service.view(user,'2026-11-05','2026-11-05').events[0];
    f.controls.ics='invalid';assert.equal((await f.request('personal-calendars/'+id+'/refresh',{accountId:'a'})).status,400);assert.equal(f.service.view(user,'2026-11-05','2026-11-05').events[0].id,first.id);assert.ok(f.service.settings(user).items[0].error);
    f.controls.ics=calendar([event().map(line=>line.replace('Private appointment','Updated appointment'))]);assert.equal((await f.request('personal-calendars/'+id+'/refresh',{accountId:'a'})).status,200);const rows=f.service.view(user,'2026-11-05','2026-11-05').events;assert.equal(rows.length,1);assert.equal(rows[0].id,first.id);assert.equal(rows[0].title,'Updated appointment');
    f.controls.ics=calendar([event('private-event',['STATUS:CANCELLED'])]);await f.service.refresh(user,id);assert.equal(f.service.busy(user,'2026-11-05').length,0);await f.service.remove(user,id);assert.equal(f.service.settings(user).items.length,0);assert.equal(user.cachedICS,'unchanged school calendar');
  }finally{await f.close();}
});

test('personal conflicts and busy intervals stay within the selected account and school profile',async()=>{
  const f=await fixture();try{
    const user=f.store.user('a');await f.service.add(user,{title:'Local',ics:calendar()});user.calendarEvents={course:{id:'course',date:'2026-11-05',title:'Maths',start:'2026-11-05T17:30:00Z',end:'2026-11-05T18:30:00Z',cancelled:false}};
    assert.equal(f.service.view(user,'2026-11-05','2026-11-05').conflicts.length,1);assert.equal(personalBusyEvents(user,'2026-11-05','2026-11-05',f.store).length,1);assert.deepEqual(personalBusyEvents(f.store.user('b'),'2026-11-05','2026-11-05',f.store),[]);
    user.studentId='another-pupil';assert.deepEqual(f.service.settings(user).items,[]);assert.deepEqual(f.service.busy(user,'2026-11-05'),[]);await f.service.add(user,{title:'Another profile',ics:calendar([event('other')])});user.studentId='student-a';assert.deepEqual(f.service.settings(user).items,[]);
  }finally{await f.close();}
});

test('calendar quotas, strict payloads and date windows are enforced',async()=>{
  const f=await fixture();try{
    for(let i=0;i<3;i++)assert.equal((await f.request('personal-calendars/add',{accountId:'a',title:'Calendar '+i,ics:calendar([event('id-'+i)])})).status,200);
    assert.equal((await f.request('personal-calendars/add',{accountId:'a',title:'Fourth',ics:calendar([event('fourth')])})).status,409);assert.equal((await f.request('personal-calendars/add',{accountId:'b',title:'Bad',ics:calendar(),admin:true},'b')).status,400);
    for(const query of ['start=2026-02-31&end=2026-11-05','start=2026-11-06&end=2026-11-05','start=2026-11-05&end=2027-03-05','start=2030-11-05&end=2030-11-06'])assert.equal((await f.request('personal-calendars/view?'+query)).status,400);
  }finally{await f.close();}
});

test('removing a calendar, logging out or changing profile during a refresh cannot restore source data',async()=>{
  const f=await fixture();try{
    const user=f.store.user('a'),added=await f.service.add(user,{title:'Local',url:'https://calendar.google.com/calendar/ical/private/basic.ics'}),id=added.items[0].id;
    let release,entered;f.controls.gate=new Promise(resolve=>{release=resolve;});const gate=new Promise(resolve=>{entered=resolve;});f.controls.entered=entered;
    const pending=f.service.refresh(user,id);await gate;f.service.remove(user,id);release();await assert.rejects(pending);assert.equal(f.service.settings(user).items.length,0);
    f.controls.gate=null;f.controls.entered=null;const second=await f.service.add(user,{title:'Second',url:'https://calendar.google.com/calendar/ical/second/basic.ics'}),secondId=second.items[0].id;let resolve;f.controls.gate=new Promise(done=>{resolve=done;});let signal;const began=new Promise(done=>{signal=done;});f.controls.entered=signal;
    const scoped=f.service.refresh(user,secondId,{sessionHash:digest('a')});await began;f.store.state.sessions=f.store.state.sessions.filter(row=>row.userId!=='a');const version=user.personalCalendarVersion;resolve();await assert.rejects(scoped);assert.equal(user.personalCalendarVersion,version);
  }finally{await f.close();}
});

test('background refresh respects explicit subscriptions, operator pauses and the refresh interval',async()=>{
  const f=await fixture();try{
    const user=f.store.user('a');await f.service.add(user,{title:'File',ics:calendar()});await f.service.tick();assert.equal(f.controls.calls,0);await f.service.add(user,{title:'Remote',url:'https://calendar.google.com/calendar/ical/private/basic.ics'});assert.equal(f.controls.calls,1);await f.service.tick();assert.equal(f.controls.calls,1);
    f.setNow(now+31*60000);f.store.state.settings.automationPaused={ent:true};await f.service.tick();assert.equal(f.controls.calls,1);f.store.state.settings.automationPaused.ent=false;await f.service.tick();assert.equal(f.controls.calls,2);
  }finally{await f.close();}
});

test('calendar URLs reject arbitrary hosts, credentials, redirects and all private address families',async()=>{
  for(const value of ['http://calendar.google.com/private','https://calendar.google.com.evil.invalid/private','https://127.0.0.1/private','https://user:secret@calendar.google.com/private','https://calendar.google.com:8443/private','https://calendar.google.com/private#secret'])assert.throws(()=>safeCalendarURL(value));
  assert.equal(safeCalendarURL('webcal://p123-caldav.icloud.com/published/2/private').protocol,'https:');
  for(const address of ['127.0.0.1','10.2.3.4','172.16.0.1','192.168.1.1','169.254.169.254','100.64.1.1','::1','::ffff:127.0.0.1','0:0:0:0:0:ffff:7f00:1','fd00::1','fe80::1','2001:db8::1'])assert.equal(publicCalendarAddress(address),false,address);
  assert.equal(publicCalendarAddress('142.250.1.1'),true);assert.equal(publicCalendarAddress('2607:f8b0:400a:801::200e'),true);
  let requested=0;await assert.rejects(()=>fetchCalendar('https://calendar.google.com/private',{lookup:async()=>[{address:'127.0.0.1',family:4}],request:()=>{requested++;}}));assert.equal(requested,0);
  function transport(status,body){return (url,options,callback)=>{requested++;assert.equal(url.hostname,'calendar.google.com');options.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'142.250.1.1');assert.equal(family,4);});const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const response=Readable.from([Buffer.from(body)]);response.statusCode=status;response.headers={};callback(response);});return req;};}
  const options={lookup:async()=>[{address:'142.250.1.1',family:4}]};assert.equal(await fetchCalendar('https://calendar.google.com/private',{...options,request:transport(200,calendar())}),calendar());await assert.rejects(()=>fetchCalendar('https://calendar.google.com/private',{...options,request:transport(302,'redirect')}));await assert.rejects(()=>fetchCalendar('https://calendar.google.com/private',{...options,request:transport(200,'a'.repeat(1024*1024+1))}));
});


test('cancelled recurring exceptions without DTSTART remove only their own occurrence',()=>{
 const base=['BEGIN:VEVENT','UID:weekly','DTSTART;TZID=Europe/Paris:20261102T180000','DTEND;TZID=Europe/Paris:20261102T190000','RRULE:FREQ=WEEKLY;COUNT=3','SUMMARY:Weekly sport','END:VEVENT'];
 const cancelled=['BEGIN:VEVENT','UID:weekly','RECURRENCE-ID;TZID=Europe/Paris:20261109T180000','STATUS:CANCELLED','END:VEVENT'];
 const rows=parse(calendar([base,cancelled,event('different-uid')])).events;
 assert.deepEqual(rows.filter(item=>item.title==='Weekly sport').map(item=>item.date),['2026-11-02','2026-11-16']);assert.equal(rows.filter(item=>item.title==='Private appointment').length,1);
});

test('unreadable calendar storage never claims a free slot or overwrites the failed encrypted state',async()=>{
 const f=await fixture();try{
  const user=f.store.user('a');await f.service.add(user,{title:'Local',ics:calendar()});const original=user.personalCalendarState;user.personalCalendarState='broken encrypted state';
  assert.ok(f.service.settings(user).warning);assert.equal(f.service.view(user,'2026-11-05','2026-11-05').complete,false);assert.throws(()=>f.service.busy(user,'2026-11-05'));assert.throws(()=>personalBusyEvents(user,'2026-11-05','2026-11-05',f.store));await assert.rejects(()=>f.service.add(user,{title:'New',ics:calendar()}));assert.equal(user.personalCalendarState,'broken encrypted state');user.personalCalendarState=original;
 }finally{await f.close();}
});

test('uploaded recurring snapshots are re-expanded as days advance without pretending their source was downloaded',async()=>{
 const f=await fixture();try{
  const user=f.store.user('a');await f.service.add(user,{title:'Local',ics:calendar([['BEGIN:VEVENT','UID:weekly','DTSTART:20261102T180000Z','DURATION:PT1H','RRULE:FREQ=WEEKLY','END:VEVENT']])});const synced=f.service.settings(user).items[0].lastSync;
  f.setNow(now+86400000);assert.equal(f.service.view(user,'2027-10-31','2027-10-31').complete,false);await f.service.tick();assert.equal(f.service.view(user,'2027-10-31','2027-10-31').complete,true);assert.equal(f.service.settings(user).items[0].lastSync,synced);assert.equal(f.controls.calls,0);
 }finally{await f.close();}
});

test('own week shows private multi-day appointments and conflicts without changing reciprocal school availability or ICS',async()=>{
 const f=await fixture();try{
  const user=f.store.user('a');await f.service.add(user,{title:'Personal',ics:calendar([['BEGIN:VEVENT','UID:trip','DTSTART;VALUE=DATE:20261104','DTEND;VALUE=DATE:20261106','SUMMARY:Private trip','END:VEVENT']])});
  user.calendarEvents={course:{id:'course',date:'2026-11-05',title:'Maths',start:'2026-11-05T09:00:00Z',end:'2026-11-05T10:00:00Z',cancelled:false}};
  const week=weekView(user,'2026-11-05',now,f.service);
  assert.equal(week.days.find(day=>day.date==='2026-11-04').personalEvents.length,1);
  assert.equal(week.days.find(day=>day.date==='2026-11-05').personalEvents[0].conflict,true);
  assert.equal(week.days.find(day=>day.date==='2026-11-06').personalEvents.length,0);
  assert.equal(weekView(f.store.user('b'),'2026-11-05',now,f.service).days.flatMap(day=>day.personalEvents).length,0);
  assert.deepEqual(commonSlots([user],'2026-11-05',{start:480,end:720,duration:60}),[{start:480,end:600},{start:660,end:720}]);
  assert.equal(user.cachedICS,'unchanged school calendar');
 }finally{await f.close();}
});

test('revision sessions use actual owner free intervals, ignore transparent appointments and retain the daily cap',async()=>{
 const f=await fixture();try{
  const user=f.store.user('a');user.manualWork=[{id:'exam',kind:'exam',title:'Maths exam',subjectLabel:'Mathématiques',due:'2026-11-07'}];
  await f.service.add(user,{title:'Personal',ics:calendar([['BEGIN:VEVENT','UID:unavailable','DTSTART;VALUE=DATE:20261029','DTEND;VALUE=DATE:20261106','SUMMARY:Away','END:VEVENT'],['BEGIN:VEVENT','UID:transparent','DTSTART;VALUE=DATE:20261106','DTEND;VALUE=DATE:20261107','TRANSP:TRANSPARENT','SUMMARY:Reminder','END:VEVENT'],['BEGIN:VEVENT','UID:morning','DTSTART:20261106T070000Z','DTEND:20261106T090000Z','SUMMARY:Sport','END:VEVENT']])});
  user.calendarEvents={course:{id:'class',date:'2026-11-06',title:'Class',start:'2026-11-06T09:00:00Z',end:'2026-11-06T11:00:00Z'}};
  user.studySessions=[{id:'old',examId:'another-exam',day:'2026-11-06',minutes:25,done:false,title:'Existing session'}];
  const plan=revisionPlan(user,{examId:'exam',totalMinutes:90,sessionMinutes:30},now,f.service),sessions=plan.sessions.filter(session=>session.examId==='exam');
  assert.equal(sessions.length,3);assert.ok(sessions.every(session=>session.day==='2026-11-06'));
  assert.equal(sessions[0].start,'2026-11-06T11:25:00.000Z');
  assert.equal(plan.sessions.reduce((sum,session)=>sum+session.minutes,0),115);
  for(const session of sessions){assert.equal(Date.parse(session.end)-Date.parse(session.start),session.minutes*60000);assert.ok(Date.parse(session.start)>=Date.parse('2026-11-06T11:25:00Z'));}
  assert.throws(()=>revisionPlan(user,{examId:'exam',totalMinutes:120,sessionMinutes:30},now,f.service),/insuffisant/);
  user.personalCalendarState='broken';assert.throws(()=>revisionPlan(user,{examId:'exam',totalMinutes:90,sessionMinutes:30},now,f.service),/Actualisez/);
 }finally{await f.close();}
});

test('revision times remain Paris wall-clock hours across the summer transition',async()=>{
 const f=await fixture();try{
  const spring=Date.parse('2027-03-28T04:00:00Z');f.setNow(spring);const user=f.store.user('a');user.manualWork=[{id:'exam',kind:'exam',title:'Exam',subjectLabel:'Mathématiques',due:'2027-03-29'}];
  const plan=revisionPlan(user,{examId:'exam',totalMinutes:30,sessionMinutes:30},spring,f.service);
  assert.equal(plan.sessions[0].start,'2027-03-28T06:00:00.000Z');assert.equal(plan.sessions[0].end,'2027-03-28T06:30:00.000Z');
 }finally{await f.close();}
});
