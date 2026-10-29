import {eventScope} from '../src/event-scope.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createECDH,randomBytes} from 'node:crypto';
import webpush from 'web-push';
import {controlFixture} from './control-fixture.js';
import {validatePushSubscription,pushPreferences,quietAt,normalizePushPreferences} from '../src/push.js';
import {activityPatch} from '../src/activity.js';
import {parisDate,shiftDate} from '../src/work.js';

function subscription(name='sample'){const curve=createECDH('prime256v1');curve.generateKeys();return {endpoint:'https://fcm.googleapis.com/fcm/send/'+name,expirationTime:null,keys:{p256dh:curve.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};}
async function setup(transport){const sent=[],f=await controlFixture({pushOptions:{transport:async(...args)=>{sent.push(args);return transport?transport(...args):{statusCode:201};}}});f.setNow(Date.parse('2026-11-03T12:00:00+01:00'));return Object.assign(f,{sent,pushRequest(route,body={},who='camille',origin){return f.request('push'+(route?'/'+route:''),{...body,accountId:who},who,origin);},async subscribe(who='camille',sub=subscription(who),preferences={}){const result=await this.pushRequest('subscribe',{subscription:sub,preferences},who);assert.equal(result.status,200);return {sub,id:result.body.deviceId};}});}
function change(f,id='change',type='updated',entity='course'){const user=f.store.user('camille'),date=shiftDate(parisDate(new Date(f.now())),1);f.store.update(user.id,activityPatch(user,[{id,entity,type,at:f.now(),date,title:'A private course title',text:'A private instruction',before:{location:'Private room A'},after:{location:'Private room B'}}],f.now()));}

test('subscription validation rejects arbitrary endpoints, credentials, insecure transport and invalid curve keys',()=>{
 const sub=subscription();assert.deepEqual(validatePushSubscription(sub),sub);
 for(const endpoint of ['http://fcm.googleapis.com/send/a','https://127.0.0.1/private','https://fcm.googleapis.com.evil.invalid/send/a','https://user:secret@fcm.googleapis.com/send/a','https://fcm.googleapis.com:8443/send/a','https://fcm.googleapis.com/send/a#fragment','https://fcm.googleapis.com/'])assert.throws(()=>validatePushSubscription({...sub,endpoint}));
 assert.throws(()=>validatePushSubscription({...sub,keys:{...sub.keys,p256dh:randomBytes(65).toString('base64url')}}));assert.throws(()=>validatePushSubscription({...sub,expirationTime:Date.now()-1}));
 assert.ok(validatePushSubscription({...sub,endpoint:'https://web.push.apple.com/a'}));assert.ok(validatePushSubscription({...sub,endpoint:'https://updates.push.services.mozilla.com/wpush/v2/a'}));
});
test('VAPID and subscription secrets are encrypted, only an authenticated matching account can activate, and retries do not duplicate devices',async()=>{
 const f=await setup();try{
  assert.equal((await f.request('push',undefined,'anonymous')).status,401);
  assert.equal((await f.pushRequest('subscribe',{subscription:subscription()},'camille','https://other.invalid')).status,403);
  assert.equal((await f.request('push/subscribe',{subscription:subscription(),accountId:'nina'},'camille')).status,409);
  const {sub,id}=await f.subscribe();const repeated=await f.pushRequest('subscribe',{subscription:sub});assert.equal(repeated.body.deviceId,id);assert.equal(repeated.body.devices.length,1);
  const settings=(await f.request('push',undefined,'camille')).body,raw=fs.readFileSync(f.store.file,'utf8');
  for(const secret of [sub.endpoint,sub.keys.auth,sub.keys.p256dh,f.push.keys.privateKey]){assert.ok(!raw.includes(secret));assert.ok(!JSON.stringify(settings).includes(secret));assert.ok(!JSON.stringify(f.audit.query({limit:200})).includes(secret));}
  assert.equal(f.sent.length,0);assert.equal(settings.preferences.quiet.enabled,true);assert.equal(settings.preferences.brief,false);
 }finally{await f.close();}
});
test('an endpoint is explicitly transferred to the currently activated account and cannot be deleted or tested by another account',async()=>{
 const f=await setup();try{const {sub,id}=await f.subscribe();const next=await f.subscribe('nina',sub);assert.equal(f.store.user('camille').pushDevices.length,0);assert.equal(f.store.user('nina').pushDevices.length,1);assert.equal((await f.pushRequest('devices/'+next.id+'/remove')).status,404);assert.equal((await f.pushRequest('test',{deviceId:next.id})).status,409);assert.notEqual(id,next.id);}finally{await f.close();}
});
test('changes are future-only, opt-in and delivered once per device without exposing school content',async()=>{
 const f=await setup();try{
  change(f,'before-activation');await f.subscribe();await f.push.tick();assert.equal(f.sent.length,0);
  change(f);await f.push.tick();assert.equal(f.sent.length,1);const [sub,payload,options]=f.sent[0];assert.equal(JSON.parse(payload).kind,'changes');assert.ok(!payload.includes('private'));assert.ok(!payload.includes('Private'));assert.equal(options.contentEncoding,undefined);assert.equal(options.TTL,300);assert.equal(options.vapidDetails.privateKey,f.push.keys.privateKey);
  const request=webpush.generateRequestDetails(sub,payload,options);assert.ok(request.headers.Authorization||request.headers.authorization);assert.ok(!request.body.toString().includes('Votre agenda'));await f.push.tick();assert.equal(f.sent.length,1);assert.equal(f.calls.mail.length,0);
 }finally{await f.close();}
});
test('quiet hours defer useful changes, collapse the batch, and preference updates preserve deferred course alerts',async()=>{
 const f=await setup();try{
  await f.subscribe();f.setNow(Date.parse('2026-11-03T23:30:00+01:00'));change(f,'night-one');await f.push.tick();assert.equal(f.sent.length,0);
  await f.pushRequest('preferences',{homework:true,quiet:{enabled:true,start:'22:30',end:'07:00'}});change(f,'night-two');await f.push.tick();assert.equal(f.sent.length,0);
  f.setNow(Date.parse('2026-11-04T07:00:00+01:00'));await f.push.tick();assert.equal(f.sent.length,1);await f.push.tick();assert.equal(f.sent.length,1);
 }finally{await f.close();}
});
test('homework opt-in does not send work published before activation while later assignments are included',async()=>{
 const f=await setup();try{await f.subscribe();change(f,'old-work','added','work');await f.pushRequest('preferences',{homework:true});await f.push.tick();assert.equal(f.sent.length,0);change(f,'new-work','added','work');await f.push.tick();assert.equal(f.sent.length,1);}finally{await f.close();}
});
test('a daily brief is sent once with relevant cached data, respects vacations, and combines with pending changes',async()=>{
 const f=await setup();try{
  const user=f.store.user('camille'),date='2026-11-04';user.manualWork=[{id:'task',title:'Private assessment',subjectLabel:'Mathématiques',kind:'exam',due:date,source:'manual'}];
  await f.subscribe('camille',subscription(),{brief:true});f.setNow(Date.parse('2026-11-03T20:00:00+01:00'));change(f);await f.push.tick();assert.equal(f.sent.length,1);assert.equal(JSON.parse(f.sent[0][1]).kind,'brief');assert.ok(!f.sent[0][1].includes('Private assessment'));await f.push.tick();assert.equal(f.sent.length,1);
  f.setNow(Date.parse('2026-11-04T20:00:00+01:00'));user.manualWork[0].due='2026-11-05';user.personalSettings={vacation:{start:'2026-11-04',end:'2026-11-08'}};await f.push.tick();assert.equal(f.sent.length,1);
  assert.throws(()=>normalizePushPreferences({brief:true,time:'23:00'}));assert.throws(()=>normalizePushPreferences({quiet:{enabled:true,start:'07:00',end:'07:00'}}));
 }finally{await f.close();}
});
test('expired subscriptions are removed, transient failures back off and do not consume queued changes',async()=>{
 let status=503;const f=await setup(async()=>{throw Object.assign(new Error('Private provider response'),{statusCode:status});});try{
  await f.subscribe();change(f);await f.push.tick();assert.equal(f.sent.length,1);await f.push.tick();assert.equal(f.sent.length,1);f.setNow(f.now()+61000);status=410;await f.push.tick();assert.equal(f.sent.length,2);assert.equal(f.store.user('camille').pushDevices.length,0);assert.ok(!JSON.stringify(f.audit.query({limit:100})).includes('Private provider response'));
 }finally{await f.close();}
});
test('logout, revoked sessions, suspension and a global pause stop future deliveries',async()=>{
 const f=await setup();try{
  await f.subscribe();change(f);f.store.state.settings.automationPaused={push:true};await f.push.tick();assert.equal(f.sent.length,0);f.store.state.settings.automationPaused={};f.store.user('camille').suspendedAt=f.now();await f.push.tick();assert.equal(f.sent.length,0);f.store.user('camille').suspendedAt=null;
  await f.request('logout',{},'camille');await f.push.tick();assert.equal(f.sent.length,0);assert.equal(f.store.user('camille').pushDevices.length,0);
  await f.subscribe('nina');f.store.state.sessions=f.store.state.sessions.filter(item=>item.userId!=='nina');f.store.user('nina').activityLog=[{seq:1,at:f.now(),date:'2026-11-04',entity:'course',type:'cancelled'}];f.store.user('nina').activitySeq=1;await f.push.tick();assert.equal(f.sent.length,0);
 }finally{await f.close();}
});
test('test notifications are explicit, session-bound, rate-limited and cannot reattach a device removed in flight',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;});const f=await setup(async()=>{await gate;return {statusCode:201};});try{
  const {id}=await f.subscribe();const pending=f.pushRequest('test',{deviceId:id});for(let i=0;i<100&&!f.sent.length;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(f.sent.length,1);await f.request('logout',{},'camille');release();assert.equal((await pending).status,200);assert.equal(f.store.user('camille').pushDevices.length,0);assert.equal(f.sent.length,1);
 }finally{release();await f.close();}
});


test('event proposals have an independent opt-in cursor, generic payload, quiet hours and no duplicate push',async()=>{
 const f=await setup();try{
  await f.subscribe();const user=f.store.user('camille');
  const proposal=(seq,date='2026-11-05')=>{f.store.update(user.id,{eventSuggestionsScope:eventScope(user),eventSuggestionsSeq:seq,eventNoticeQueue:[{id:'PRIVATE ARTICLE REFERENCE',seq,at:f.now(),date}]});};
  proposal(1);await f.push.tick();assert.equal(f.sent.length,0);assert.equal(pushPreferences(user).events,false);
  await f.pushRequest('preferences',{events:true});await f.push.tick();assert.equal(f.sent.length,0);
  proposal(2);await f.push.tick();assert.equal(f.sent.length,1);const payload=JSON.parse(f.sent[0][1]);assert.equal(payload.kind,'events');assert.equal(payload.target,'events');assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
  await f.push.tick();assert.equal(f.sent.length,1);
  f.setNow(Date.parse('2026-11-03T23:00:00+01:00'));proposal(3);await f.push.tick();assert.equal(f.sent.length,1);
  f.setNow(Date.parse('2026-11-04T07:01:00+01:00'));await f.push.tick();assert.equal(f.sent.length,2);
  f.setNow(f.now()+61000);proposal(4);await f.request('logout',{},'camille');await f.push.tick();assert.equal(f.sent.length,2);
 }finally{await f.close();}
});

test('accepted or ignored event queues and a changed pupil cannot deliver stale event notifications',async()=>{
 const f=await setup();try{
  await f.subscribe('camille',subscription('events-cleared'),{events:true});const user=f.store.user('camille');
  f.store.update(user.id,{eventSuggestionsScope:eventScope(user),eventSuggestionsSeq:1,eventNoticeQueue:[]});await f.push.tick();assert.equal(f.sent.length,0);
  f.store.update(user.id,{eventSuggestionsSeq:2,eventNoticeQueue:[{id:'event',seq:2,at:f.now(),date:'2026-11-05'}],studentId:'a-different-pupil'});await f.push.tick();assert.equal(f.sent.length,0);
 }finally{await f.close();}
});
