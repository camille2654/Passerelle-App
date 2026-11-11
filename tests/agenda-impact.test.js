import test from 'node:test';
import assert from 'node:assert/strict';
import {agendaImpactDays} from '../src/agenda-impact.js';
import {changeView} from '../src/activity.js';
import '../public/agenda-view.js';
const day='2026-11-06',at=time=>day+'T'+time+':00+01:00';
const lesson=(id,start,end,cancelled=false)=>({id,start:at(start),end:at(end),cancelled,date:day});
const changed=(type,id,before,after,seq=1)=>({entity:'course',eventId:id,date:day,type,before,after,seq});
const rows=value=>globalThis.PasserelleAgenda.impactRows(value,'2026-11-05');

test('a cancelled first lesson compares the full day and announces the actual new starting time',()=>{
 const early=lesson('early','08:15','10:05',true),next=lesson('next','10:20','11:15');
 const view=agendaImpactDays({early,next},[changed('cancelled','early',{...early,cancelled:false},early)]);
 assert.equal(view.days[0].before.start,495);assert.equal(view.days[0].after.start,620);
 assert.equal(rows(view)[0].title,'Demain, vous commencez à 10:20');assert.match(rows(view)[0].detail,/2 h 05 plus tard/);
});

test('an interior cancellation or room change does not invent a later start or earlier finish',()=>{
 const a=lesson('a','08:00','09:00'),b=lesson('b','10:00','11:00',true),c=lesson('c','15:00','16:00');
 assert.deepEqual(rows(agendaImpactDays({a,b,c},[changed('cancelled','b',{...b,cancelled:false},b)])),[]);
 assert.deepEqual(rows(agendaImpactDays({a,c},[changed('updated','a',{...a,location:'A'},{...a,location:'B'})])),[]);
});

test('successive moves and restorations are reversed to the visit baseline and net reversions disappear',()=>{
 const initial=lesson('a','09:00','10:00'),middle=lesson('a','10:00','11:00'),final=lesson('a','11:00','12:00');
 const view=agendaImpactDays({a:final},[changed('updated','a',initial,middle,1),changed('updated','a',middle,final,2)]);
 assert.equal(view.days[0].before.start,540);assert.equal(view.days[0].after.start,660);
 assert.match(rows(view)[0].detail,/2 h plus tard/);
 const cancelled={...initial,cancelled:true};
 assert.deepEqual(rows(agendaImpactDays({a:initial},[changed('cancelled','a',initial,cancelled,1),changed('restored','a',cancelled,initial,2)])),[]);
 const original=structuredClone({initial,middle,final});agendaImpactDays({a:final},[changed('updated','a',initial,final)]);assert.deepEqual({initial,middle,final},original);
});

test('empty days, new days and moves to another date are represented without claiming personal availability',()=>{
 const original=lesson('a','08:00','09:00'),nextDay={...original,start:'2026-11-07T10:00:00+01:00',end:'2026-11-07T11:00:00+01:00',date:'2026-11-07'};
 const view=agendaImpactDays({a:nextDay},[changed('updated','a',original,nextDay)]);
 assert.ok(rows(view).some(row=>row.date===day&&row.title.includes('aucun cours prévu')));
 assert.ok(rows(view).some(row=>row.date==='2026-11-07'&&row.title.includes('des cours à partir de 10:00')));
});

test('missing cancellation flags, incomplete history, invalid times and another student cannot produce confident impacts',()=>{
 const early=lesson('early','08:00','09:00',true),next=lesson('next','10:00','11:00');
 const {cancelled,...legacy}=early;
 assert.deepEqual(rows(agendaImpactDays({early,next},[changed('cancelled','early',legacy,early)])),[]);
 assert.deepEqual(rows(agendaImpactDays({early,next},[changed('cancelled','early',{...early,cancelled:false},early)],{complete:false})),[]);
 const bad={id:'bad',date:day,start:'invalid',end:'invalid'};assert.deepEqual(rows(agendaImpactDays({early,next,bad},[changed('cancelled','early',{...early,cancelled:false},early)])),[]);
 const user={studentId:'new',activityScope:'old',calendarEvents:{early,next},lastAgendaVisit:{cursor:0},activityLog:[changed('cancelled','early',{...early,cancelled:false},early)]};
 assert.deepEqual(changeView({seal:value=>JSON.stringify(value)},user,Date.now()).scheduleImpact.days,[]);
 const gap={...user,activityScope:'new',activitySeq:20,activityLog:[{...changed('cancelled','early',{...early,cancelled:false},early),seq:20}]};assert.equal(changeView({seal:value=>JSON.stringify(value)},gap,Date.now()).scheduleImpact.complete,false);
});

test('live activity merges keep the original consultation baseline, including a later net reversion',()=>{
 const snapshot=(before,after)=>({complete:true,days:[{date:day,complete:true,before:{start:before,end:1000,count:2},after:{start:after,end:1000,count:2}}]});
 const merge=globalThis.PasserelleAgenda.mergeImpact;
 let view=merge(snapshot(540,600),snapshot(600,660));assert.equal(view.days[0].before.start,540);assert.equal(view.days[0].after.start,660);
 view=merge(view,snapshot(600,540));assert.deepEqual(rows(view),[]);
 assert.equal(merge(view,{complete:false,days:[]}).complete,false);
});
