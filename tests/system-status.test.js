import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {SystemStatus} from '../src/system-status.js';
import {controlFixture} from './control-fixture.js';
const setup=()=>{let now=1793952000000;const settings={managedENTLapsus:{enabled:true,keyHash:'private-config-key'}};return {settings,get now(){return now;},set now(value){now=value;},status:new SystemStatus({settings:()=>settings,mailReady:()=>true,pushReady:()=>true,clock:()=>now,version:'fixture'})};};
const component=(snapshot,id)=>snapshot.components.find(row=>row.id===id);

test('configuration alone never makes a worker operational; public output excludes configuration and accounts',()=>{
 const f=setup(),view=f.status.snapshot();assert.equal(view.state,'unknown');
 for(const id of ['ent','mail','push','managed'])assert.equal(component(view,id).state,'unknown');
 assert.equal(component(view,'portal').state,'operational');assert.equal(component(view,'calendars').state,'operational');
 assert.ok(!JSON.stringify(view).includes('private-config-key'));assert.equal(view.events.length,0);
});

test('worker observation deduplicates tasks, detects failures without publishing their text and recovers',async()=>{
 const f=setup();let release,runs=0;const gate=new Promise(resolve=>{release=resolve;});
 const task=f.status.track('ent',async()=>{runs++;await gate;});
 f.now+=15000;assert.equal(f.status.track('ent',()=>{runs++;}),task);await Promise.resolve();assert.equal(runs,1);
 assert.equal(component(f.status.snapshot(),'ent').state,'operational');release();await task;
 await assert.rejects(f.status.track('ent',async()=>{throw new Error('password-and-token-secret');}));
 const failed=f.status.snapshot();assert.equal(component(failed,'ent').state,'degraded');assert.ok(!JSON.stringify(failed).includes('password-and-token-secret'));
 await f.status.track('ent',async()=>{});assert.equal(component(f.status.snapshot(),'ent').state,'operational');
});

test('stale, future-dated or missing worker pulses become unverified',async()=>{
 const f=setup();await f.status.track('push',async()=>{});assert.equal(component(f.status.snapshot(),'push').state,'operational');
 f.now+=90001;assert.equal(component(f.status.snapshot(),'push').state,'unknown');
 await f.status.track('push',async()=>{});f.now-=1000;assert.equal(component(f.status.snapshot(),'push').state,'unknown');
});

test('maintenance, paused automation and disabled services have distinct public states',async()=>{
 const f=setup();for(const id of ['ent','mail','push','managed'])await f.status.track(id,async()=>{});
 assert.equal(f.status.snapshot().state,'operational');f.settings.automationPaused={mail:true};assert.equal(component(f.status.snapshot(),'mail').state,'paused');assert.equal(f.status.snapshot().state,'degraded');
 f.settings.maintenance={enabled:true,until:f.now+60000,message:'private unreviewed maintenance detail'};let view=f.status.snapshot();assert.equal(view.state,'maintenance');assert.equal(component(view,'ent').state,'paused');assert.ok(!JSON.stringify(view).includes('private unreviewed'));
 f.now+=60001;view=f.status.snapshot();assert.equal(view.maintenance.enabled,false);assert.equal(view.state,'degraded');
 const unconfigured=new SystemStatus({clock:()=>f.now});view=unconfigured.snapshot();assert.equal(component(view,'mail').state,'disabled');assert.equal(component(view,'push').state,'disabled');assert.equal(component(view,'managed').state,'disabled');
});

test('calendar failure cannot yield a green overall state; generic history is bounded and copied',()=>{
 const f=setup();let good=true;f.status.calendarCheck=()=>good?'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n':'broken';
 f.status.snapshot();for(let i=0;i<35;i++){f.now+=1000;good=!good;f.status.snapshot();}
 good=false;const view=f.status.snapshot();assert.equal(component(view,'calendars').state,'unavailable');assert.equal(view.state,'degraded');assert.equal(view.events.length,24);
 view.events[0].component='tampered';assert.notEqual(f.status.snapshot().events[0].component,'tampered');
});

test('anonymous status is read-only, bounded and identical for ordinary/admin cookies; page and assets are local',async()=>{
 const f=await controlFixture();try{
  for(const session of f.store.state.sessions)session.lastSeenAtReal=Date.now();f.store.save();
  const before=fs.readFileSync(f.store.file);
  for(const who of ['missing','camille','owner']){
   const r=await f.request('system-status?admin=true',undefined,who);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   assert.deepEqual(Object.keys(r.body).sort(),['schemaVersion','version','checkedAt','monitoringSince','refreshAfterSeconds','state','title','maintenance','components','events','scope'].sort());
   const serialized=JSON.stringify(r.body);for(const secret of ['fixture-private-ent-token','@example.invalid','student-camille',...Object.values(f.feedTokens),'private-config-key'])assert.ok(!serialized.includes(secret));
   assert.equal(r.body.components.length,6);
  }
  assert.deepEqual(fs.readFileSync(f.store.file),before);assert.equal(f.calls.ent.length,0);assert.equal(f.calls.mail.length,0);
  const root=await fetch(f.root+'/status',{redirect:'manual'});assert.equal(root.status,308);assert.equal(root.headers.get('location'),'/agenda/status/');
  for(const name of ['','style.css','page.js','symbol.png','manrope.ttf','icons.svg']){const r=await fetch(f.root+'/status/'+name);assert.equal(r.status,200);}
  assert.equal((await f.request('admin/control/overview',undefined,'missing')).status,401);
 }finally{await f.close();}
});
