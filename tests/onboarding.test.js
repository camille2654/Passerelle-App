import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';
import {digest,random} from '../src/store.js';
import {initializeOnboarding,publicOnboarding} from '../src/onboarding.js';

const initialTime=Date.parse('2026-11-03T18:00:00+01:00');
const unavailable={version:1,status:'available',step:'welcome',updatedAt:0,startedAt:null,completedAt:null};

async function fixture({dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-onboarding-')),now=initialTime}={}){
  const calls={ent:0,mail:0,push:0};let time=now;
  const source=createApp({dataDir:dir,baseURL:'http://127.0.0.1/agenda',bootstrap:false,clock:()=>time,
    syncOptions:{clientFactory:async()=>{calls.ent++;return {getAgenda:async()=>[],getHomeworkAssignments:async()=>[]};}},
    mailOptions:{transportFactory:()=>({verify:async()=>true,sendMail:async()=>{calls.mail++;return {accepted:[]};},close(){}})},
    pushOptions:{transport:async()=>{calls.push++;return {};}}
  });
  const cookies={};
  if(!source.store.state.users.length){
    for(const id of ['a','b']){
      const token=random();cookies[id]='agenda_session='+token;
      source.store.state.users.push({id,name:id==='a'?'Camille':'Nina',login:'fixture-'+id,admin:false,enabled:false,history:[],calendarEvents:{},manualWork:[],assignments:[],studentId:'fixture-student-'+id,skolengo:source.store.seal({school:{id:'fixture-school'},token:'private-fixture-'+id}),feedKey:source.store.seal('fixture-feed-'+id),feedHash:digest('fixture-feed-'+id),cachedICS:'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',emailConfig:{address:source.store.seal('fixture-'+id+'@example.invalid'),enabled:false},pushDevices:[]});
      source.store.state.sessions.push({hash:digest(token),userId:id,createdAt:time,lastSeenAt:time,lastSeenAtReal:Date.now(),expires:Date.now()+3600000});
    }
    source.store.save();
  }
  const server=source.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root='http://127.0.0.1:'+server.address().port+'/agenda';
  return {...source,dir,cookies,calls,setNow:value=>{time=value;},async request(route,body,{who='a',cookie=cookies[who]||'',origin='http://127.0.0.1',post=false}={}){
    const response=await fetch(root+'/api/'+route,{method:body!==undefined||post?'POST':'GET',...(body!==undefined?{body:JSON.stringify(body)}:{}),headers:{...(origin===null?{}:{Origin:origin}),...(cookie?{Cookie:cookie}:{}),'Content-Type':'application/json'}});
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]||'',headers:response.headers};
  },async close(){source.control.close();source.push.close();await source.browsers.close();await new Promise(resolve=>server.close(resolve));}};
}

async function useFixture(t){const f=await fixture();t.after(async()=>{await f.close();fs.rmSync(f.dir,{recursive:true,force:true});});return f;}

test('public onboarding is a bounded read-only projection and legacy accounts remain available',()=>{
  for(const user of [{},{onboarding:null},{onboarding:{version:2,status:'completed',step:'finish'}},{onboarding:{version:1,status:'injected',step:'welcome'}}]){
    const before=structuredClone(user);assert.deepEqual(publicOnboarding(user),unavailable);assert.deepEqual(user,before);
  }
  const value=initializeOnboarding(initialTime);assert.deepEqual(value,{...unavailable,status:'new',updatedAt:initialTime});
  assert.deepEqual(publicOnboarding({onboarding:{...value,secret:'fixture-secret',html:'<script>'}}),value);
  assert.equal(publicOnboarding({onboarding:{...value,updatedAt:Infinity,startedAt:-1,completedAt:'123'}}).updatedAt,0);
  assert.deepEqual(initializeOnboarding(0),{...unavailable,status:'new'});
});

test('status reads do not migrate or start an existing account and unstarted steps are rejected',async t=>{
  const f=await useFixture(t),before=fs.readFileSync(f.store.file,'utf8');
  for(let i=0;i<3;i++)assert.deepEqual((await f.request('status')).body.user.onboarding,unavailable);
  assert.equal(Object.hasOwn(f.store.user('a'),'onboarding'),false);assert.equal(fs.readFileSync(f.store.file,'utf8'),before);
  assert.equal((await f.request('onboarding',{action:'step',step:'home'})).status,409);
  assert.equal((await f.request('onboarding',{action:'complete'})).status,409);
  assert.equal(Object.hasOwn(f.store.user('a'),'onboarding'),false);
});

test('onboarding requires authentication and the configured origin and rejects all extra or invalid fields',async t=>{
  const f=await useFixture(t);
  assert.equal((await f.request('onboarding',{action:'start'},{who:''})).status,401);
  for(const origin of ['https://other.example','null',null])assert.equal((await f.request('onboarding',{action:'start'},{origin})).status,403);
  const bodies=[{},[],null,{action:'unknown'},{action:'step'},{action:'step',step:'<img src=x>'},{action:'step',step:{}},{action:'start',userId:'b'},{action:'start',html:'<script>'},{action:'start',completedAt:initialTime},{action:'start',step:'home'},{action:'complete',step:'finish'},{action:['start']},JSON.parse('{"action":"start","__proto__":{"admin":true}}')];
  for(const body of bodies)assert.equal((await f.request('onboarding',body)).status,400,JSON.stringify(body));
  assert.equal((await f.request('onboarding',undefined,{post:true})).status,400);
  assert.equal(f.store.user('a').onboarding,undefined);assert.equal(f.store.user('b').onboarding,undefined);
});

test('progress resumes across sessions and restart, supports backward navigation and completes only explicitly',async t=>{
  let f=await fixture();const dir=f.dir,firstCookie=f.cookies.a,secondToken=random(),secondCookie='agenda_session='+secondToken;
  t.after(async()=>{await f.close();fs.rmSync(dir,{recursive:true,force:true});});
  f.store.state.sessions.push({hash:digest(secondToken),userId:'a',createdAt:initialTime,lastSeenAt:initialTime,lastSeenAtReal:Date.now(),expires:Date.now()+3600000});f.store.save();
  const start=await f.request('onboarding',{action:'start'});assert.equal(start.status,200);assert.deepEqual(start.body.onboarding,{version:1,status:'active',step:'welcome',updatedAt:initialTime,startedAt:initialTime,completedAt:null});
  f.setNow(initialTime+1000);assert.deepEqual((await f.request('onboarding',{action:'start'},{cookie:secondCookie})).body,start.body);
  f.setNow(initialTime+2000);const agenda=(await f.request('onboarding',{action:'step',step:'agenda'})).body.onboarding;assert.equal(agenda.step,'agenda');
  f.setNow(initialTime+3000);assert.deepEqual((await f.request('onboarding',{action:'step',step:'agenda'},{cookie:secondCookie})).body.onboarding,agenda);
  f.setNow(initialTime+4000);const paused=(await f.request('onboarding',{action:'pause'})).body.onboarding;assert.equal(paused.status,'paused');assert.equal(paused.completedAt,null);
  assert.deepEqual((await f.request('status',undefined,{cookie:secondCookie})).body.user.onboarding,paused);
  await f.close();f=await fixture({dir,now:initialTime+5000});
  assert.deepEqual((await f.request('status',undefined,{cookie:firstCookie})).body.user.onboarding,paused);
  const resumed=(await f.request('onboarding',{action:'start'},{cookie:secondCookie})).body.onboarding;assert.equal(resumed.status,'active');assert.equal(resumed.step,'agenda');assert.equal(resumed.startedAt,initialTime);
  assert.equal((await f.request('onboarding',{action:'step',step:'home'},{cookie:firstCookie})).body.onboarding.step,'home');
  assert.equal((await f.request('status',undefined,{cookie:secondCookie})).body.user.onboarding.step,'home');
  const finish=(await f.request('onboarding',{action:'step',step:'finish'},{cookie:firstCookie})).body.onboarding;assert.equal(finish.status,'active');assert.equal(finish.completedAt,null);
  f.setNow(initialTime+6000);const done=(await f.request('onboarding',{action:'complete'},{cookie:secondCookie})).body.onboarding;assert.equal(done.status,'completed');assert.equal(done.step,'finish');assert.equal(done.completedAt,initialTime+6000);
  f.setNow(initialTime+7000);for(const action of ['pause','complete'])assert.deepEqual((await f.request('onboarding',{action},{cookie:firstCookie})).body.onboarding,done);
  assert.equal((await f.request('onboarding',{action:'step',step:'home'},{cookie:secondCookie})).status,409);
  const replay=(await f.request('onboarding',{action:'start'},{cookie:firstCookie})).body.onboarding;assert.equal(replay.status,'active');assert.equal(replay.step,'welcome');assert.equal(replay.startedAt,initialTime+7000);assert.equal(replay.completedAt,null);
});

test('pausing the welcome is persisted without starting the guide and only the authenticated account changes',async t=>{
  const f=await useFixture(t),aBefore=structuredClone(f.store.user('a')),bBefore=structuredClone(f.store.user('b'));
  const paused=await f.request('onboarding',{action:'pause'});assert.equal(paused.status,200);assert.deepEqual(paused.body.onboarding,{...unavailable,status:'paused',updatedAt:initialTime});
  f.setNow(initialTime+1000);assert.deepEqual((await f.request('onboarding',{action:'pause'})).body,paused.body);
  const {onboarding,...aAfter}=f.store.user('a');assert.deepEqual(aAfter,aBefore);assert.deepEqual(f.store.user('b'),bBefore);
  assert.deepEqual((await f.request('status',undefined,{who:'b'})).body.user.onboarding,unavailable);
  const started=(await f.request('onboarding',{action:'start'})).body.onboarding;assert.equal(started.step,'welcome');assert.equal(started.startedAt,initialTime+1000);
  const persisted=JSON.parse(fs.readFileSync(f.store.file,'utf8'));assert.deepEqual(persisted.users.find(u=>u.id==='a').onboarding,started);
  assert.deepEqual(f.calls,{ent:0,mail:0,push:0});
});

test('public and invitation signup seed a new welcome and ignore injected onboarding progress',async t=>{
  const f=await useFixture(t),signup=login=>({name:'Élève test',login,password:'a-long-fixture-password',onboarding:{version:1,status:'completed',step:'finish',completedAt:initialTime}});
  const member=await f.request('register',signup('new-public-member'),{who:''});assert.equal(member.status,200);
  const profile=(await f.request('status',undefined,{cookie:member.cookie})).body.user;assert.deepEqual(profile.onboarding,initializeOnboarding(initialTime));assert.equal(profile.admin,false);assert.equal(profile.skolengoConnected,false);assert.equal(profile.feedURL,null);
  const paused=await f.request('onboarding',{action:'pause'},{cookie:member.cookie});assert.equal(paused.body.onboarding.status,'paused');assert.equal(paused.body.onboarding.startedAt,null);
  f.store.state.invites.push({hash:digest('fixture-invitation'),admin:false,expires:Date.now()+60000});f.store.save();
  const invited=await f.request('register',{...signup('new-invited-member'),token:'fixture-invitation'},{who:''});assert.equal(invited.status,200);assert.deepEqual((await f.request('status',undefined,{cookie:invited.cookie})).body.user.onboarding,initializeOnboarding(initialTime));
  assert.deepEqual(f.calls,{ent:0,mail:0,push:0});
});

test('onboarding throttles repeated actions for one account without blocking another at the same address',async t=>{
  const f=await useFixture(t);
  for(let i=0;i<90;i++)assert.equal((await f.request('onboarding',{action:'start'})).status,200);
  const progress=structuredClone(f.store.user('a').onboarding);assert.equal((await f.request('onboarding',{action:'step',step:'home'})).status,429);assert.deepEqual(f.store.user('a').onboarding,progress);
  assert.equal((await f.request('onboarding',{action:'start'},{who:'b'})).status,200);
});
