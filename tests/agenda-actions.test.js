import test from 'node:test';
import assert from 'node:assert/strict';
import {controlFixture} from './control-fixture.js';
const date='2026-11-06';
test('week course details expose completed work to its owner, and the existing work action is reversible across views',async()=>{
 const f=await controlFixture();try{
  const user=f.store.user('camille');user.manualWork=[{id:'mine',title:'Exercice personnel',subjectLabel:'Mathématiques',due:date,kind:'homework',source:'manual'}];user.assignments=[{id:'from-ent',title:'Exercice ENT',subjectLabel:'Mathématiques',due:date,done:false,source:'skolengo'}];f.store.save();
  const week=()=>f.request('week?date='+date,undefined,'camille');
  const initial=(await week()).body;assert.equal(initial.work.length,2);
  for(const id of ['mine','from-ent']){
   assert.equal((await f.request('work/'+id,{done:true},'camille')).status,200);
   assert.equal(typeof f.store.user('camille').personalVersion,'number');
   const completed=(await week()).body;assert.equal(completed.work.find(item=>item.id===id).done,true);assert.equal(completed.days.flatMap(day=>day.work).some(item=>item.id===id),false);
   assert.equal((await f.request('work/'+id,{done:false},'camille')).status,200);assert.equal((await week()).body.days.flatMap(day=>day.work).some(item=>item.id===id),true);
  }
  assert.equal((await f.request('work/mine',{done:true},'nina')).status,404);assert.equal(f.store.user('camille').workOverrides.mine.done,false);
  assert.equal(f.calls.ent.length,0);assert.equal(f.calls.mail.length,0);
 }finally{await f.close();}
});
