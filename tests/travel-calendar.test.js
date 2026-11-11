import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ICAL from 'ical.js';
import {Store} from '../src/store.js';
import {dateWindow} from '../src/sync.js';
import {subjectFor} from '../src/subjects.js';
import {combinedEvents,rebuildCalendar} from '../src/calendar.js';
import {weekView,revisionPlan,commonSlots} from '../src/planner.js';
import {saveTravelBlock,removeTravelBlock,listTravelBlocks,travelCalendarRows,travelCalendarEvents,travelBlockScope} from '../src/travel-calendar.js';

const now=Date.parse('2026-11-04T12:00:00Z'),day='2026-11-05';
const input=(extra={})=>({date:day,direction:'outbound',start:day+'T06:15:00Z',end:day+'T06:50:00Z',courseStart:day+'T07:00:00Z',feed:true,mode:'transit',...extra});
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-travel-calendar-')),store=new Store(dir),subject=subjectFor({label:'Mathématiques'});
 for(const id of ['a','b'])store.state.users.push({id,studentId:'pupil-'+id,schoolName:'Lycée de test',skolengoConnectionId:'connection-'+id,skolengo:store.seal({school:{name:'Lycée de test'}}),lastSync:now,calendarWindow:dateWindow(new Date(now)),calendarEvents:{first:{id:'first-'+id,date:day,title:'Mathématiques',rawTitle:'Mathématiques',kind:'course',subject,start:day+'T07:00:00Z',end:day+'T08:00:00Z',location:'Salle 1',created:now,modified:now,sequence:0},last:{id:'last-'+id,date:day,title:'Mathématiques',rawTitle:'Mathématiques',kind:'course',subject,start:day+'T14:00:00Z',end:day+'T15:00:00Z',location:'Salle 1',created:now,modified:now,sequence:0}}});store.save();
 return {dir,store,user:store.user('a'),close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
const parse=ics=>new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent');
const trips=ics=>parse(ics).filter(event=>String(event.getFirstPropertyValue('uid')).startsWith('travel-'));

test('confirmed travel stores private details encrypted and exports only a generic timed envelope',()=>{
 const f=fixture();try{
  const secret='Maison particulière au 78 rue Confidentielle',gps=45.991234,details='Changer de bus près de mon domicile';
  const saved=saveTravelBlock(f.store,f.user,input({label:secret,details,journey:{origin:{latitude:gps,longitude:4.981234},destination:{name:'Lycée test'},steps:['bus T3']}}),now);
  assert.equal(saved.ok,true);assert.equal(saved.block.title,'Trajet vers le lycée');assert.equal(saved.block.needsReview,false);assert.equal(saved.block.busy,true);
  const disk=fs.readFileSync(f.store.file,'utf8');for(const privateValue of [secret,String(gps),details]){assert.ok(!disk.includes(privateValue));assert.ok(!f.user.cachedICS.includes(privateValue));}
  const own=listTravelBlocks(f.store,f.user,{date:day});assert.equal(own.length,1);assert.equal(own[0].label,secret);assert.equal(own[0].journey.origin.latitude,gps);assert.equal(listTravelBlocks(f.store,f.store.user('b')).length,0);
  const event=trips(f.user.cachedICS)[0];assert.equal(event.getFirstPropertyValue('summary'),'Trajet vers le lycée');assert.equal(event.getFirstPropertyValue('location'),'');assert.equal(event.getFirstPropertyValue('status'),'CONFIRMED');assert.equal(event.getFirstPropertyValue('transp'),'OPAQUE');assert.equal(event.getFirstPropertyValue('dtstart').toJSDate().toISOString(),day+'T06:15:00.000Z');
  const week=weekView(f.user,day,now);assert.equal(week.days.find(value=>value.date===day).travelEvents.length,1);assert.ok(!JSON.stringify(week).includes(secret));
 }finally{f.close();}
});

test('same-day direction updates one stable UID, supports exact retry, optional feed and deletion',()=>{
 const f=fixture();try{
  const one=saveTravelBlock(f.store,f.user,input(),now),first=trips(f.user.cachedICS)[0],uid=first.getFirstPropertyValue('uid'),etag=f.user.feedETag,bytes=fs.readFileSync(f.store.file);
  assert.equal(saveTravelBlock(f.store,f.user,input(),now+1000).alreadySaved,true);assert.deepEqual(fs.readFileSync(f.store.file),bytes);assert.equal(f.user.feedETag,etag);
  const changed=saveTravelBlock(f.store,f.user,input({start:day+'T06:10:00Z'}),now+2000);assert.equal(changed.block.id,one.block.id);assert.equal(changed.block.sequence,1);assert.equal(trips(f.user.cachedICS).length,1);assert.equal(trips(f.user.cachedICS)[0].getFirstPropertyValue('uid'),uid);assert.notEqual(f.user.feedETag,etag);
  const updatedETag=f.user.feedETag;saveTravelBlock(f.store,f.user,input({start:day+'T06:10:00Z',details:'Nouveau détail privé'}),now+3000);assert.equal(f.user.feedETag,updatedETag);assert.equal(travelCalendarRows(f.user)[0].sequence,1);
  saveTravelBlock(f.store,f.user,input({feed:false}),now+4000);assert.equal(trips(f.user.cachedICS).length,0);assert.equal(travelCalendarRows(f.user).length,1);assert.equal(travelCalendarRows(f.user)[0].feed,false);
  saveTravelBlock(f.store,f.user,input({direction:'inbound',start:day+'T15:10:00Z',end:day+'T15:50:00Z',courseStart:undefined,courseEnd:day+'T15:00:00Z'}),now+5000);assert.equal(travelCalendarRows(f.user).length,2);assert.equal(trips(f.user.cachedICS).length,1);assert.equal(trips(f.user.cachedICS)[0].getFirstPropertyValue('summary'),'Trajet retour');
  removeTravelBlock(f.store,f.user,one.block.id,now+6000);assert.equal(travelCalendarRows(f.user).length,1);assert.ok(!f.user.cachedICS.includes('STATUS:CANCELLED'));assert.throws(()=>removeTravelBlock(f.store,f.user,one.block.id,now),error=>error.status===404);
 }finally{f.close();}
});

test('changed or cancelled course boundaries require review and disappear from a rebuilt feed until reconfirmed',()=>{
 const f=fixture();try{
  const saved=saveTravelBlock(f.store,f.user,input(),now);f.user.calendarEvents.first.start=day+'T07:30:00Z';
  assert.equal(travelCalendarRows(f.user)[0].needsReview,true);assert.equal(travelCalendarRows(f.user)[0].busy,false);assert.equal(travelCalendarEvents(f.user).length,0);rebuildCalendar(f.store,f.user.id,now+60000);assert.equal(trips(f.user.cachedICS).length,0);
  const before=fs.readFileSync(f.store.file);assert.throws(()=>saveTravelBlock(f.store,f.user,input(),now+60000),error=>error.status===409);assert.deepEqual(fs.readFileSync(f.store.file),before);
  const restored=saveTravelBlock(f.store,f.user,input({start:day+'T06:45:00Z',end:day+'T07:20:00Z',courseStart:day+'T07:30:00Z'}),now+60000);assert.equal(restored.block.id,saved.block.id);assert.equal(restored.block.created,saved.block.created);assert.equal(restored.block.needsReview,false);assert.equal(trips(f.user.cachedICS).length,1);
  for(const course of Object.values(f.user.calendarEvents))course.cancelled=true;rebuildCalendar(f.store,f.user.id,now+120000);assert.equal(trips(f.user.cachedICS).length,0);assert.equal(travelCalendarRows(f.user)[0].needsReview,true);assert.throws(()=>saveTravelBlock(f.store,f.user,input(),now+120000),error=>error.status===409);
 }finally{f.close();}
});

test('confirmed blocks are scoped to the actual account, pupil, school and source connection',()=>{
 const f=fixture();try{
  const saved=saveTravelBlock(f.store,f.user,input(),now),scope=travelBlockScope(f.user);assert.throws(()=>removeTravelBlock(f.store,f.store.user('b'),saved.block.id,now),error=>error.status===404);assert.throws(()=>saveTravelBlock(f.store,{...f.user},input(),now),error=>error.status===409);
  for(const [field,value]of [['studentId','other-pupil'],['schoolName','Autre lycée'],['skolengoConnectionId','other-connection']]){const prior=f.user[field];f.user[field]=value;assert.notEqual(travelBlockScope(f.user),scope);assert.deepEqual(travelCalendarRows(f.user),[]);assert.deepEqual(listTravelBlocks(f.store,f.user),[]);assert.equal(combinedEvents(f.user).filter(event=>event.kind==='travel').length,0);f.user[field]=prior;}
  f.user.skolengo=null;assert.deepEqual(travelCalendarRows(f.user),[]);assert.throws(()=>saveTravelBlock(f.store,f.user,input(),now),error=>error.status===409);
 }finally{f.close();}
});

test('invalid confirmation, stale agendas and out-of-bounds journeys cannot mutate stored data',()=>{
 const f=fixture();try{
  const before=fs.readFileSync(f.store.file);
  const malformed=[{accountId:'b'},{date:'2026-02-31'},{direction:'sideways'},{feed:'true'},{feed:undefined},{courseStart:undefined},{courseStart:day+'T08:00:00Z'},{start:day+'T07:10:00Z',end:day+'T07:20:00Z'},{start:day+'T06:50:00Z',end:day+'T06:15:00Z'},{start:day+'T00:00:00Z'},{end:day+'T04:30:00Z'},{mode:'<script>'},{label:'x'.repeat(201)},{details:'x'.repeat(4001)},{journey:{geometry:'x'.repeat(10001)}},{journey:{secret:Infinity}},{direction:'inbound',start:day+'T14:10:00Z',end:day+'T15:00:00Z',courseEnd:day+'T15:00:00Z'}];
  for(const extra of malformed){assert.throws(()=>saveTravelBlock(f.store,f.user,input(extra),now));assert.deepEqual(fs.readFileSync(f.store.file),before);}
  f.user.lastSync=now-31*60000;assert.throws(()=>saveTravelBlock(f.store,f.user,input(),now),error=>error.status===409);assert.deepEqual(fs.readFileSync(f.store.file),before);
  f.user.lastSync=now;f.user.suspendedAt=now;assert.throws(()=>saveTravelBlock(f.store,f.user,input(),now),error=>error.status===409);assert.deepEqual(fs.readFileSync(f.store.file),before);
 }finally{f.close();}
});

test('private travel blocks reserve revision time while reciprocal friends retain the school-only boundary',()=>{
 const f=fixture();try{
  const first=f.user.calendarEvents.first;first.start=day+'T09:00:00Z';first.end=day+'T10:00:00Z';delete f.user.calendarEvents.last;
  const before=commonSlots([f.user],day,{start:480,end:720,duration:30});
  saveTravelBlock(f.store,f.user,input({start:day+'T07:00:00Z',end:day+'T08:50:00Z',courseStart:first.start,feed:false}),now);
  assert.deepEqual(commonSlots([f.user],day,{start:480,end:720,duration:30}),before);
  f.user.manualWork=[{id:'exam',kind:'exam',title:'Contrôle',subjectLabel:'Mathématiques',due:'2026-11-06'}];
  const plan=revisionPlan(f.user,{examId:'exam',totalMinutes:120,sessionMinutes:60},Date.parse('2026-11-05T06:00:00Z'));assert.ok(plan.sessions.every(session=>!(Date.parse(session.start)<Date.parse(day+'T08:50:00Z')&&Date.parse(session.end)>Date.parse(day+'T07:00:00Z'))));
  assert.equal(trips(f.user.cachedICS).length,0);assert.equal(weekView(f.user,day,now).days.find(value=>value.date===day).travelEvents.length,1);
 }finally{f.close();}
});

test('encrypted details and stable calendar identities survive restart and UTC offsets across daylight saving',()=>{
 const f=fixture();try{
  const spring='2027-03-28';for(const course of Object.values(f.user.calendarEvents)){course.date=spring;course.start=spring+'T07:00:00Z';course.end=spring+'T08:00:00Z';}
  const saved=saveTravelBlock(f.store,f.user,input({date:spring,start:spring+'T08:15:00+02:00',end:spring+'T08:50:00+02:00',courseStart:spring+'T09:00:00+02:00',journey:{note:'Détail à conserver'}}),now),uid=trips(f.user.cachedICS)[0].getFirstPropertyValue('uid'),etag=f.user.feedETag;
  const restarted=new Store(f.dir),user=restarted.user('a');assert.equal(listTravelBlocks(restarted,user)[0].journey.note,'Détail à conserver');rebuildCalendar(restarted,user.id,now+1000);assert.equal(user.feedETag,etag);assert.equal(trips(user.cachedICS)[0].getFirstPropertyValue('uid'),uid);assert.equal(travelCalendarRows(user)[0].id,saved.block.id);assert.equal(trips(user.cachedICS)[0].getFirstPropertyValue('dtstart').toJSDate().toISOString(),spring+'T06:15:00.000Z');
 }finally{f.close();}
});
