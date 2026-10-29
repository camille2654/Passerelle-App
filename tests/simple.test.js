import test from 'node:test';
import assert from 'node:assert/strict';
import {controlFixture} from './control-fixture.js';

test('the daily home view uses the Paris date and cached courses, preserves cancellations and isolates accounts',async()=>{
 const f=await controlFixture();try{
  f.setNow(Date.parse('2026-10-25T23:30:00Z'));const user=f.store.user('camille');
  const lesson=(id,date,hour,cancelled=false)=>({id,date,start:date+'T'+hour+':00:00Z',end:date+'T'+hour+':50:00Z',title:id,cancelled});
  user.calendarEvents={previous:lesson('previous','2026-10-25','18'),late:lesson('late','2026-10-26','10'),early:lesson('early','2026-10-26','08'),cancelled:lesson('cancelled','2026-10-26','09',true),tomorrow:lesson('tomorrow','2026-10-27','09')};
  const status=await f.request('status',undefined,'camille');assert.equal(status.body.user.today.date,'2026-10-26');assert.deepEqual(status.body.user.today.courses.map(c=>c.id),['early','cancelled','late']);assert.equal(status.body.user.today.courses[1].cancelled,true);
  assert.equal(status.body.user.brief.date,'2026-10-27');assert.deepEqual(status.body.user.brief.courses.map(c=>c.id),['tomorrow']);
  assert.deepEqual((await f.request('status',undefined,'nina')).body.user.today.courses,[]);assert.equal((await f.request('status',undefined,'anonymous')).body.user,null);assert.equal(f.calls.ent.length,0);assert.equal(f.calls.mail.length,0);
 }finally{await f.close();}
});
