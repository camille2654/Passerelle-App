import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {SyncEngine,dateWindow} from '../src/sync.js';
import {schoolWindow,recentWindow,syncInterval,fullSyncDueAt,nextSyncAt,syncPolicy,retryDelay,mergeRangeAssignments} from '../src/sync-policy.js';

const NOW=Date.parse('2026-11-04T12:00:00Z'),MINUTE=60000,DAY=86400000;
const lesson=(id,date,extra={})=>({id,title:'Cours '+id,subject:{label:'Mathématiques'},startDateTime:date+'T09:00:00Z',endDateTime:date+'T10:00:00Z',location:'B204',teachers:[],canceled:false,...extra});
const homework=(id,dueDate,extra={})=>({id,title:'Devoir '+id,dueDate,html:'Consigne '+id,subject:{label:'Mathématiques'},...extra});
async function fixture({now=NOW}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-sync-policy-')),store=new Store(dir);
 const context={now,calls:[],lessons:[lesson('past','2026-09-15'),lesson('near','2026-11-05'),lesson('far','2027-06-15')],homework:[homework('past','2026-09-16'),homework('near','2026-11-06'),homework('far','2027-06-16')],failure:null,gate:null,active:0,peak:0};
 for(const id of ['a','b'])store.state.users.push({id,studentId:'pupil-'+id,schoolName:'Lycée test',skolengo:store.seal({school:{id:'school-test'}}),skolengoConnectionId:'connection-'+id,enabled:true});store.save();
 const engine=new SyncEngine(store,{clock:()=>context.now,clientFactory:async(_store,user)=>({
  getAgenda:async(_student,start,end)=>{
   context.calls.push({id:user.id,kind:'agenda',start,end});context.active++;context.peak=Math.max(context.peak,context.active);
   try{if(context.gate)await context.gate;if(context.failure)throw context.failure;
    return context.lessons.filter(value=>value.startDateTime.slice(0,10)>=start&&value.startDateTime.slice(0,10)<=end).map(value=>({date:value.startDateTime.slice(0,10),lessons:[value]}));
   }finally{context.active--;}
  },
  getHomeworkAssignments:async(_student,start,end,limit,offset)=>{
   context.calls.push({id:user.id,kind:'work',start,end});return context.homework.filter(value=>value.dueDate>=start&&value.dueDate<=end).slice(offset,offset+limit);
  }
 })});
 return {store,engine,context,user:store.user('a'),close:()=>fs.rmSync(dir,{recursive:true,force:true})};
}

test('suspending an account during an upstream response prevents that response from changing its stored agenda',async()=>{
 const f=await fixture();let release;
 try{
  f.context.gate=new Promise(resolve=>{release=resolve;});
  const operation=f.engine.run('a');
  for(let i=0;i<20&&!f.context.calls.length;i++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok(f.context.calls.length>0);
  f.store.update('a',{suspendedAt:NOW});const before=fs.readFileSync(f.store.file,'utf8');
  release();await assert.rejects(operation,error=>error.status===409);
  assert.equal(fs.readFileSync(f.store.file,'utf8'),before);assert.equal(f.user.calendarEvents,undefined);
 }finally{release?.();f.close();}
});

test('school coverage and recent windows obey Paris dates, September boundaries and leap years',()=>{
 assert.deepEqual(dateWindow(new Date(NOW)),schoolWindow(new Date(NOW)));
 assert.equal(recentWindow(NOW).start,'2026-11-02');assert.equal(recentWindow(NOW).end,'2026-11-18');
 assert.equal(recentWindow(Date.parse('2026-08-31T21:59:59Z')).end,'2026-08-31');
 const next=recentWindow(Date.parse('2026-08-31T22:00:00Z'));assert.equal(next.start,'2026-09-01');assert.equal(next.end,'2026-09-15');
 assert.equal(recentWindow(Date.parse('2028-02-29T12:00:00Z')).start,'2028-02-27');assert.equal(recentWindow(Date.parse('2028-02-29T12:00:00Z')).end,'2028-03-14');
 const mutable=schoolWindow(new Date(NOW));mutable.start='broken';assert.equal(schoolWindow(new Date(NOW)).start,'2026-09-01');
});

test('active users sync every two minutes, daytime every five, night every thirty in Paris across daylight saving',()=>{
 assert.equal(syncInterval({},NOW),5*MINUTE);assert.equal(syncInterval({managedLastActiveAt:NOW},NOW),2*MINUTE);assert.equal(syncInterval({lastSeenAt:NOW-9*MINUTE},NOW),2*MINUTE);assert.equal(syncInterval({lastSeenAt:NOW-10*MINUTE},NOW),5*MINUTE);
 assert.equal(syncInterval({lastSeenAt:NOW+DAY},NOW),5*MINUTE);
 assert.equal(syncInterval({},Date.parse('2026-11-04T05:59:59Z')),30*MINUTE);assert.equal(syncInterval({},Date.parse('2026-11-04T06:00:00Z')),5*MINUTE);assert.equal(syncInterval({},Date.parse('2026-11-04T19:00:00Z')),30*MINUTE);
 assert.equal(syncInterval({},Date.parse('2027-03-28T04:59:59Z')),30*MINUTE);assert.equal(syncInterval({},Date.parse('2027-03-28T05:00:00Z')),5*MINUTE);
});

test('existing complete snapshots seed the daily full scan and lightweight success cannot postpone it indefinitely',async()=>{
 const f=await fixture();try{
  await f.engine.run('a');delete f.user.lastFullSync;f.store.save();
  const due=fullSyncDueAt(f.user,NOW);assert.ok(due>=NOW+DAY&&due<=NOW+DAY+30*MINUTE);assert.equal(syncPolicy(f.user,NOW).mode,'near');
  f.context.now+=2*MINUTE;await f.engine.run('a',{mode:'near'});assert.equal(f.user.lastFullSync,NOW);assert.equal(fullSyncDueAt(f.user,f.context.now),due);
  f.context.now=due;assert.equal(syncPolicy(f.user,f.context.now).mode,'full');
  f.store.update('b',{enabled:false});f.context.calls=[];await f.engine.tick();assert.equal(f.user.lastSyncMode,'full');assert.equal(f.context.calls.filter(row=>row.kind==='agenda').length,27);assert.equal(f.user.lastFullSync,due);
 }finally{f.close();}
});

test('fresh accounts build the complete year before a requested recent scan',async()=>{
 const f=await fixture();try{
  await f.engine.run('a',{mode:'near'});assert.equal(f.user.lastSyncMode,'full');assert.equal(f.context.calls.filter(row=>row.kind==='agenda').length,27);
  f.context.calls=[];f.context.now+=MINUTE;await f.engine.run('a',{mode:'near'});assert.equal(f.context.calls.filter(row=>row.kind==='agenda').length,2);assert.equal(f.context.calls.filter(row=>row.kind==='work').length,1);
  assert.deepEqual(f.user.calendarWindow,{start:'2026-09-01',end:'2027-08-31',label:'2026–2027'});assert.deepEqual(f.user.lastSyncRange,{start:'2026-11-02',end:'2026-11-18'});assert.equal(f.user.lastFullSync,NOW);
 }finally{f.close();}
});

test('a recent scan keeps distant courses and homework, updates their stable identities and only removes missing local work',async()=>{
 const f=await fixture();try{
  await f.engine.run('a');const farCourse=structuredClone(Object.values(f.user.calendarEvents).find(row=>row.date==='2027-06-15')),farWork=structuredClone(f.user.assignments.find(row=>row.due==='2027-06-16'));
  const nearId=Object.values(f.user.calendarEvents).find(row=>row.date==='2026-11-05').id,nearWork=f.user.assignments.find(row=>row.due==='2026-11-06').id;
  f.context.lessons.find(row=>row.id==='near').location='C105';f.context.lessons.find(row=>row.id==='far').location='Non encore vérifié';f.context.homework=f.context.homework.filter(row=>row.id!=='near');f.context.homework.push(homework('new','2026-11-07'));f.context.now+=2*MINUTE;
  await f.engine.run('a',{mode:'near'});
  assert.deepEqual(f.user.calendarEvents[farCourse.id],farCourse);assert.deepEqual(f.user.assignments.find(row=>row.id===farWork.id),farWork);assert.equal(f.user.calendarEvents[nearId].location,'C105');assert.equal(f.user.calendarEvents[nearId].sequence,1);
  assert.ok(!f.user.assignments.some(row=>row.id===nearWork));assert.equal(f.user.taskCalendar[nearWork].cancelled,true);assert.ok(f.user.assignments.some(row=>row.sourceId==='new'));
  const beforeFar=structuredClone(f.user.calendarEvents[farCourse.id]);f.context.lessons=f.context.lessons.filter(row=>row.id!=='near');
  f.context.now+=2*MINUTE;await f.engine.run('a',{mode:'near'});assert.equal(f.user.calendarEvents[nearId].cancelled,false);assert.equal(f.user.calendarEvents[nearId].missingCount,1);
  f.context.now+=2*MINUTE;await f.engine.run('a',{mode:'near'});assert.equal(f.user.calendarEvents[nearId].cancelled,true);assert.deepEqual(f.user.calendarEvents[farCourse.id],beforeFar);
 }finally{f.close();}
});

test('old courses from the current school year survive recent scans even after ninety days',async()=>{
 const f=await fixture({now:Date.parse('2027-03-04T12:00:00Z')});try{
  f.context.lessons.push(lesson('march','2027-03-05'));await f.engine.run('a');const old=structuredClone(Object.values(f.user.calendarEvents).find(row=>row.date==='2026-09-15'));
  f.context.lessons=f.context.lessons.filter(row=>row.id!=='past');f.context.now+=MINUTE;await f.engine.run('a',{mode:'near'});assert.deepEqual(f.user.calendarEvents[old.id],old);
 }finally{f.close();}
});

test('range work merging never duplicates an ID moved in from a distant date',()=>{
 const previous=[{id:'same',due:'2027-01-01'},{id:'outside',due:'2027-05-01'},{id:'removed',due:'2026-11-05'}],incoming=[{id:'same',due:'2026-11-06'}];
 assert.deepEqual(mergeRangeAssignments(previous,incoming,{start:'2026-11-02',end:'2026-11-18'}),[{id:'outside',due:'2027-05-01'},{id:'same',due:'2026-11-06'}]);
});

test('overlapping ticks and explicit requests share one worker and reject duplicate account jobs',async()=>{
 const f=await fixture();try{
  let release;f.context.gate=new Promise(resolve=>{release=resolve;});const one=f.engine.tick(),again=f.engine.tick();assert.equal(one,again);
  await new Promise(resolve=>setImmediate(resolve));assert.equal(f.context.calls.length,1);assert.equal(f.context.calls[0].id,'a');
  await assert.rejects(f.engine.run('a'),error=>error.status===409);
  const manual=f.engine.run('b');await new Promise(resolve=>setImmediate(resolve));assert.equal(f.context.calls.length,1);assert.equal(f.engine.running.size,2);
  release();await Promise.all([one,manual]);assert.equal(f.context.peak,1);assert.equal(f.engine.running.size,0);assert.equal(f.engine.tickPromise,null);
 }finally{f.close();}
});

test('a queued job cannot silently follow another pupil and does not alter its new profile on failure',async()=>{
 const f=await fixture();try{
  let release;f.context.gate=new Promise(resolve=>{release=resolve;});const first=f.engine.run('a'),second=f.engine.run('b');f.store.update('b',{studentId:'another-pupil'});const rejected=assert.rejects(second,error=>error.status===409);
  release();await first;await rejected;assert.equal(f.context.calls.filter(row=>row.id==='b').length,0);assert.equal(f.store.user('b').lastAttempt,undefined);assert.equal(f.store.user('b').lastError,undefined);
 }finally{f.close();}
});

test('transient failures preserve snapshots and back off, Retry-After is bounded, invalid grants stop automation',async()=>{
 const f=await fixture();try{
  await f.engine.run('a');f.store.update('b',{enabled:false});const cached=f.user.cachedICS,events=structuredClone(f.user.calendarEvents);
  f.context.failure=Object.assign(new Error('service unavailable'),{response:{status:503}});f.context.now+=5*MINUTE;await assert.rejects(f.engine.run('a',{mode:'near'}));assert.equal(f.user.syncErrorStreak,1);assert.equal(f.user.syncRetryAt,f.context.now+5*MINUTE);assert.equal(f.user.cachedICS,cached);assert.deepEqual(f.user.calendarEvents,events);
  const calls=f.context.calls.length;f.context.now+=5*MINUTE-1;await f.engine.tick();assert.equal(f.context.calls.length,calls);f.context.now++;await f.engine.tick();assert.equal(f.user.syncErrorStreak,2);assert.equal(f.user.syncRetryAt,f.context.now+10*MINUTE);
  f.context.failure=Object.assign(new Error('expired'),{error:'invalid_grant'});await assert.rejects(f.engine.run('a',{mode:'near'}));assert.equal(f.user.enabled,false);assert.equal(nextSyncAt(f.user,f.context.now),null);
  assert.equal(retryDelay({response:{headers:{'retry-after':'900'}}},1,NOW),15*MINUTE);assert.equal(retryDelay({response:{headers:{'retry-after':new Date(NOW+20*MINUTE).toUTCString()}}},1,NOW),20*MINUTE);assert.equal(retryDelay({response:{headers:{'retry-after':'99999'}}},1,NOW),60*MINUTE);assert.equal(retryDelay({},20,NOW),60*MINUTE);
 }finally{f.close();}
});

test('a partial homework failure preserves all assignments while a later success clears error backoff',async()=>{
 const f=await fixture();try{
  await f.engine.run('a');const assignments=structuredClone(f.user.assignments);const original=f.engine.clientFactory;
  f.engine.clientFactory=async(...args)=>{const client=await original(...args);client.getHomeworkAssignments=async()=>{throw new Error('work unavailable');};return client;};
  f.context.now+=2*MINUTE;await f.engine.run('a',{mode:'near'});assert.deepEqual(f.user.assignments,assignments);assert.equal(f.user.homeworkAvailable,false);
  f.engine.clientFactory=original;f.user.syncErrorStreak=3;f.user.syncRetryAt=f.context.now+DAY;f.context.now+=2*MINUTE;await f.engine.run('a',{mode:'near'});assert.equal(f.user.syncErrorStreak,0);assert.equal(f.user.syncRetryAt,null);assert.equal(f.user.homeworkAvailable,true);
 }finally{f.close();}
});

test('explicit refresh requests have a one minute cooldown and cannot bypass a failure delay or disabled account',async()=>{
 const f=await fixture();try{
  await f.engine.run('a');f.user.managedLastActiveAt=NOW+1000;f.user.syncRequestedAt=NOW+1000;assert.equal(nextSyncAt(f.user,NOW+1000),NOW+MINUTE);
  f.user.syncRetryAt=NOW+20*MINUTE;assert.equal(nextSyncAt(f.user,NOW+1000),NOW+20*MINUTE);
  f.user.enabled=false;assert.equal(nextSyncAt(f.user,NOW+1000),null);
  f.user.enabled=true;f.user.suspendedAt=NOW;assert.equal(nextSyncAt(f.user,NOW+1000),null);
 }finally{f.close();}
});

test('homework rate limits delay the next scan without discarding valid courses, while expired credentials stop automation',async()=>{
 const f=await fixture();try{
  await f.engine.run('a');const assignments=structuredClone(f.user.assignments),original=f.engine.clientFactory;let failure=Object.assign(new Error('limited'),{response:{status:429,headers:{'retry-after':'900'}}});
  f.engine.clientFactory=async(...args)=>{const client=await original(...args);client.getHomeworkAssignments=async()=>{throw failure;};return client;};
  f.context.lessons.find(row=>row.id==='near').location='C106';f.context.now+=MINUTE;await f.engine.run('a',{mode:'near'});
  assert.equal(f.user.syncRetryAt,f.context.now+15*MINUTE);assert.deepEqual(f.user.assignments,assignments);assert.equal(Object.values(f.user.calendarEvents).find(row=>row.date==='2026-11-05').location,'C106');
  const lastSync=f.user.lastSync;failure=Object.assign(new Error('expired'),{error:'invalid_grant'});f.context.now+=MINUTE;await assert.rejects(f.engine.run('a',{mode:'near'}));assert.equal(f.user.enabled,false);assert.equal(f.user.lastSync,lastSync);
 }finally{f.close();}
});
