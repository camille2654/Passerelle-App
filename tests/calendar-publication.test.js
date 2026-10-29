import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ICAL from 'ical.js';
import {Store,digest,random} from '../src/store.js';
import {createApp} from '../src/server.js';
import {CALENDAR_FORMAT_VERSION,rebuildCalendar,upgradeCalendarFeeds} from '../src/calendar.js';
import {renderCalendar} from '../src/ical.js';
import {dateWindow,normalizeLessons,reconcileSnapshot} from '../src/sync.js';
import {taskEvents} from '../src/work.js';
import {controlFixture} from './control-fixture.js';

const initialNow=Date.parse('2026-10-29T12:00:00Z');
const course={id:'fixture-source-course',title:'Mathématiques',subject:{label:'Mathématiques'},startDateTime:'2026-11-03T08:00:00+01:00',endDateTime:'2026-11-03T09:00:00+01:00',location:'B204',teachers:[],canceled:false};
const manual=(id,kind='homework')=>({id,title:kind==='exam'?'Contrôle de maths':'Exercices de maths',subjectLabel:'Mathématiques',due:'2026-11-04',kind,source:'manual',done:false});
const parse=text=>new ICAL.Component(ICAL.parse(text));
const events=text=>parse(text).getAllSubcomponents('vevent').map(component=>new ICAL.Event(component));
async function feed(f,query='',headers={}){const response=await fetch(f.root+'/calendars/'+f.feedTokens.camille+'.ics'+query,{headers});return {status:response.status,body:await response.text(),headers:response.headers};}
const uid=id=>id+'@passerelle.invalid';

function syntheticCalendar(user,canceled=false){const window=dateWindow(new Date(initialNow));return reconcileSnapshot(normalizeLessons([{date:'2026-11-03',lessons:[{...course,canceled}]}],user,window),{},window,initialNow).calendar;}
function legacyCalendar(rows){const blocks=rows.map(row=>{const text=renderCalendar([{...row,cancelled:false}]);const block=text.slice(text.indexOf('BEGIN:VEVENT'),text.indexOf('END:VEVENT')+'END:VEVENT'.length);return row.cancelled?block.replace('STATUS:CONFIRMED','STATUS:CANCELLED'):block;});return ['BEGIN:VCALENDAR','VERSION:2.0','METHOD:PUBLISH',...blocks,'END:VCALENDAR',''].join('\r\n');}
async function closeSource(source){for(const key of ['control','push','passkeys','cloud','incoming','personalCalendars','travel','personalMail','eventSuggestions'])source[key]?.close();await source.browsers.close();}

test('subscription snapshots omit cancellation tombstones and never publish a scheduling METHOD',()=>{
 const owner={id:'a',studentId:'pupil'},live=Object.values(syntheticCalendar(owner))[0],cancelled={...live,id:'old-course',cancelled:true};
 const published=renderCalendar([live,cancelled]);assert.equal(parse(published).getFirstPropertyValue('method'),null);assert.equal(events(published).length,1);assert.equal(events(published)[0].uid,uid(live.id));assert.ok(!published.includes('STATUS:CANCELLED'));assert.equal(events(published)[0].component.getFirstPropertyValue('status'),'CONFIRMED');
 assert.equal(events(renderCalendar([cancelled])).length,0);assert.ok(renderCalendar([]).endsWith('END:VCALENDAR\r\n'));
});

test('HTTP subscriptions update a course under one UID, omit cancellations in every filter, and restore that UID',async()=>{
 const f=await controlFixture();let source={...course};f.setNow(initialNow);const user=f.store.user('camille');user.manualWork=[manual('work-one'),manual('exam-one','exam')];f.store.save();
 f.engine.clientFactory=async()=>({getAgenda:async(_student,start,end)=>source&&'2026-11-03'>=start&&'2026-11-03'<=end?[{date:'2026-11-03',lessons:[structuredClone(source)]}]:[],getHomeworkAssignments:async()=>[]});
 try{
  assert.equal((await f.request('sync',{},'camille')).status,200);const initial=await feed(f),initialEvents=events(initial.body),courseId=Object.keys(user.calendarEvents)[0],courseUID=uid(courseId),first=initialEvents.find(event=>event.uid===courseUID);assert.equal(initial.status,200);assert.equal(initialEvents.length,3);assert.equal(first.component.getFirstPropertyValue('sequence'),0);
  assert.equal((await feed(f,'',{'If-None-Match':initial.headers.get('etag')})).status,304);assert.equal((await feed(f,'',{'If-Modified-Since':initial.headers.get('last-modified')})).status,304);
  f.setNow(initialNow+600000);source={...course,title:'Mathématiques · chapitre 2',location:'C105',startDateTime:'2026-11-03T10:00:00+01:00',endDateTime:'2026-11-03T11:00:00+01:00'};assert.equal((await f.request('sync',{},'camille')).status,200);
  const moved=await feed(f,'',{'If-None-Match':initial.headers.get('etag')}),movedEvent=events(moved.body).find(event=>event.uid===courseUID);assert.equal(moved.status,200);assert.notEqual(moved.headers.get('etag'),initial.headers.get('etag'));assert.equal(events(moved.body).length,3);assert.equal(movedEvent.startDate.toJSDate().toISOString(),'2026-11-03T09:00:00.000Z');assert.equal(movedEvent.location,'C105');assert.equal(movedEvent.component.getFirstPropertyValue('sequence'),1);assert.equal(events(moved.body).filter(event=>event.uid===courseUID).length,1);
  f.setNow(initialNow+1200000);source.canceled=true;assert.equal((await f.request('sync',{},'camille')).status,200);const removed=await feed(f,'',{'If-None-Match':moved.headers.get('etag')});assert.equal(removed.status,200);assert.equal(events(removed.body).length,2);assert.equal(user.calendarEvents[courseId].cancelled,true);assert.equal(events(removed.body).some(event=>event.uid===courseUID),false);
  const subjectKey=user.calendarEvents[courseId].subject.key;for(const [query,count]of [['?type=all',2],['?type=course',0],['?type=homework',1],['?type=exam',1],['?subject='+subjectKey,2],['?type=course&subject='+subjectKey,0]]){const result=await feed(f,query);assert.equal(result.status,200,query);assert.equal(events(result.body).length,count,query);assert.ok(!result.body.includes('STATUS:CANCELLED'),query);assert.equal(parse(result.body).getFirstPropertyValue('method'),null);assert.equal((await feed(f,query,{'If-None-Match':result.headers.get('etag')})).status,304,query);}
  f.setNow(initialNow+1800000);source.canceled=false;assert.equal((await f.request('sync',{},'camille')).status,200);const restored=await feed(f);assert.equal(events(restored.body).length,3);assert.equal(events(restored.body).find(event=>event.uid===courseUID).component.getFirstPropertyValue('sequence'),3);
  source=null;f.setNow(initialNow+2400000);assert.equal((await f.request('sync',{},'camille')).status,200);assert.ok(events((await feed(f)).body).some(event=>event.uid===courseUID),'one missing source read does not remove the course');
  f.setNow(initialNow+3000000);assert.equal((await f.request('sync',{},'camille')).status,200);assert.equal(events((await feed(f)).body).some(event=>event.uid===courseUID),false);assert.equal(user.calendarEvents[courseId].missingCount,2);assert.equal(user.calendarEvents[courseId].cancelled,true);
  assert.equal(f.calls.mail.length,0);
 }finally{f.server.closeAllConnections();await f.close();}
});

test('all-day homework and exams disappear on completion/deletion and restore without duplicate identities',async()=>{
 const f=await controlFixture();f.setNow(initialNow);const user=f.store.user('camille');user.manualWork=[manual('manual-homework'),manual('manual-exam','exam')];rebuildCalendar(f.store,user.id,f.now());
 try{
  const initial=await feed(f);assert.equal(events(initial.body).length,2);for(const event of events(initial.body))assert.equal(event.startDate.isDate,true);
  f.setNow(initialNow+600000);assert.equal((await f.request('work/manual-exam',{done:true},'camille')).status,200);const done=await feed(f,'',{'If-None-Match':initial.headers.get('etag')});assert.equal(done.status,200);assert.deepEqual(events(done.body).map(event=>event.uid),[uid('manual-homework')]);assert.equal(events((await feed(f,'?type=exam')).body).length,0);assert.equal(user.taskCalendar['manual-exam'].cancelled,true);
  f.setNow(initialNow+1200000);assert.equal((await f.request('work/manual-exam',{done:false},'camille')).status,200);const restored=events((await feed(f,'?type=exam')).body);assert.equal(restored.length,1);assert.equal(restored[0].uid,uid('manual-exam'));assert.equal(restored[0].component.getFirstPropertyValue('sequence'),2);
  f.setNow(initialNow+1800000);user.manualWork=user.manualWork.map(item=>item.id==='manual-exam'?{...item,title:'Contrôle déplacé',due:'2026-11-06'}:item);rebuildCalendar(f.store,user.id,f.now());const edited=events((await feed(f,'?type=exam')).body);assert.equal(edited.length,1);assert.equal(edited[0].uid,uid('manual-exam'));assert.equal(edited[0].startDate.toString(),'2026-11-06');assert.match(edited[0].summary,/Contrôle déplacé/);
  f.setNow(initialNow+2400000);assert.equal((await f.request('work/manual-exam/remove',{},'camille')).status,200);const deleted=await feed(f);assert.deepEqual(events(deleted.body).map(event=>event.uid),[uid('manual-homework')]);assert.equal(user.taskCalendar['manual-exam'].cancelled,true);assert.equal(events((await feed(f,'?type=exam')).body).length,0);
  f.setNow(initialNow+3000000);assert.equal((await f.request('work/manual-homework/remove',{},'camille')).status,200);const empty=await feed(f);assert.equal(events(empty.body).length,0);assert.ok(!empty.body.includes('STATUS:CANCELLED'));assert.equal((await feed(f,'',{'If-None-Match':deleted.headers.get('etag')})).status,200);assert.equal((await feed(f,'',{'If-None-Match':empty.headers.get('etag')})).status,304);assert.equal(f.calls.mail.length,0);
 }finally{f.server.closeAllConnections();await f.close();}
});

test('startup upgrades paused legacy feeds without changing UIDs, internal revisions, credentials or subsequent cache timestamps',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-calendar-upgrade-')),store=new Store(dir),token=random(),owner={id:'legacy-paused',studentId:'pupil',name:'Fixture',enabled:false,lastSync:initialNow,manualWork:[manual('legacy-done','exam')],workOverrides:{'legacy-done':{done:true}},feedKey:store.seal(token),feedHash:digest(token),feedModifiedAt:initialNow};let source,server;
 try{
  owner.calendarEvents=syntheticCalendar(owner);const active=Object.values(owner.calendarEvents)[0],cancelled={...active,id:'legacy-cancelled',cancelled:true,sequence:4};owner.calendarEvents[cancelled.id]=cancelled;owner.taskCalendar=taskEvents(owner,{},initialNow);owner.cachedICS=legacyCalendar([...Object.values(owner.calendarEvents),...Object.values(owner.taskCalendar)]);owner.feedETag='"'+digest(owner.cachedICS)+'"';store.state.users.push(owner,{id:'unconnected',name:'No feed'});store.save();
  const previous=structuredClone(owner),migrationAt=initialNow+600000;assert.equal(events(previous.cachedICS).length,3);assert.equal(events(previous.cachedICS).filter(event=>event.component.getFirstPropertyValue('status')==='CANCELLED').length,2);
  source=createApp({dataDir:dir,baseURL:'http://127.0.0.1/agenda',bootstrap:false,clock:()=>migrationAt});const upgraded=source.store.user(owner.id);assert.equal(upgraded.enabled,false);assert.equal(upgraded.calendarFormatVersion,CALENDAR_FORMAT_VERSION);assert.notEqual(upgraded.cachedICS,previous.cachedICS);assert.notEqual(upgraded.feedETag,previous.feedETag);assert.equal(upgraded.feedModifiedAt,migrationAt);assert.equal(parse(upgraded.cachedICS).getFirstPropertyValue('method'),null);assert.deepEqual(events(upgraded.cachedICS).map(event=>event.uid),[uid(active.id)]);
  assert.deepEqual(upgraded.calendarEvents,previous.calendarEvents);assert.deepEqual(upgraded.taskCalendar,previous.taskCalendar);assert.equal(upgraded.feedKey,previous.feedKey);assert.equal(upgraded.feedHash,previous.feedHash);assert.equal(upgraded.lastSync,previous.lastSync);assert.equal(source.store.user('unconnected').calendarFormatVersion,undefined);
  server=source.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const address='http://127.0.0.1:'+server.address().port+'/agenda/calendars/'+token+'.ics',refreshed=await fetch(address,{headers:{'If-None-Match':previous.feedETag}});assert.equal(refreshed.status,200);assert.deepEqual(events(await refreshed.text()).map(event=>event.uid),[uid(active.id)]);assert.equal((await fetch(address,{headers:{'If-None-Match':upgraded.feedETag}})).status,304);
  const bytes=fs.readFileSync(source.store.file),snapshot=structuredClone(upgraded);assert.equal(upgradeCalendarFeeds(source.store,migrationAt+600000),0);assert.deepEqual(upgraded,snapshot);assert.deepEqual(fs.readFileSync(source.store.file),bytes);
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}if(source)await closeSource(source);fs.rmSync(dir,{recursive:true,force:true});}
});

test('removing the last task of a subject publishes an empty subject subscription even after tombstone expiry',async()=>{
 const f=await controlFixture();f.setNow(initialNow);const user=f.store.user('camille');user.manualWork=[{...manual('only-subject-task'),subjectLabel:'Atelier de robotique'}];rebuildCalendar(f.store,user.id,f.now());
 try{
  const key=user.taskCalendar['only-subject-task'].subject.key,query='?subject='+key,initial=await feed(f,query);assert.equal(initial.status,200);assert.equal(events(initial.body).length,1);
  f.setNow(initialNow+600000);assert.equal((await f.request('work/only-subject-task/remove',{},'camille')).status,200);
  const removed=await feed(f,query,{'If-None-Match':initial.headers.get('etag')});assert.equal(removed.status,200);assert.equal(events(removed.body).length,0);
  user.taskCalendar={};rebuildCalendar(f.store,user.id,f.now()+1000);const expired=await feed(f,query);assert.equal(expired.status,200);assert.equal(events(expired.body).length,0);assert.equal((await feed(f,query,{'If-None-Match':expired.headers.get('etag')})).status,304);
  assert.equal((await feed(f,'?subject=not-a-valid-subject-key')).status,404);assert.equal(f.calls.mail.length,0);
 }finally{f.server.closeAllConnections();await f.close();}
});
