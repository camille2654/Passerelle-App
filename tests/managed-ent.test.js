import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createApp} from '../src/server.js';
import {digest,random,passwordHash} from '../src/store.js';
import {DISCOVERY} from '../src/skolengo.js';

const NOW=Date.parse('2026-11-04T12:00:00Z'),DAY='2026-11-05',ORIGIN='http://127.0.0.1',PARTNER='https://mon-ent.pages.dev';
const CALLBACK=PARTNER+'/passerelle/ent/callback',EXTERNAL='lapsus-synthetic-subject-a',OTHER='lapsus-synthetic-subject-b';
const sourceAccess='synthetic-source-access-token-that-must-never-leave-server',sourceRefresh='synthetic-source-refresh-token-that-must-never-leave-server';
const fresh=()=>randomBytes(32).toString('base64url');
const challenge=value=>createHash('sha256').update(value).digest('base64url');
const failure=value=>value.status>=400&&value.status<500||value.status===503;
const savedPassword=passwordHash('synthetic-admin-password');

async function fixture({students=1,clientExtra={}}={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-managed-ent-')),scheduled=[],calls={source:0,agenda:0,homework:0,revoked:0,started:0};let now=NOW;
 const school={id:'synthetic-school',name:'Lycée de test',city:'Ville synthétique',emsCode:'rra',emsOIDCWellKnownUrl:DISCOVERY};
 const source=createApp({dataDir:dir,baseURL:ORIGIN+'/agenda',bootstrap:false,clock:()=>now,managedOptions:{schoolSearch:async()=>[school],schedule:fn=>scheduled.push(fn),revokeSource:async()=>{calls.revoked++;},clientFactory:async()=>{calls.source++;return {...clientExtra,getAgenda:async(_student,from,to)=>{calls.agenda++;return from<=DAY&&to>=DAY?[{date:DAY,lessons:[{id:'lesson',title:'Mathématiques',subject:{label:'Mathématiques'},startDateTime:DAY+'T09:00:00Z',endDateTime:DAY+'T10:00:00Z',canceled:false,location:'Salle synthétique',teachers:[]}]}]:[];},getHomeworkAssignments:async(_student,from,to)=>{calls.homework++;return from<=DAY&&to>=DAY?[{id:'assignment',title:'Exercice synthétique',dueDate:DAY,html:'Consigne synthétique',subject:{label:'Mathématiques'}}]:[];}};}}});
 const service=source.managedENT?.instance||source.managedENT;
 assert.ok(service,'createApp exposes the managed ENT service');
 const cookies={};for(const [id,admin]of [['owner',true],['ordinary',false]]){const token=random();cookies[id]='agenda_session='+token;source.store.state.users.push({id,name:'Compte '+id,login:id,password:savedPassword,admin,enabled:false,createdAt:NOW});source.store.state.sessions.push({hash:digest(token),userId:id,expires:Date.now()+3600000,createdAt:NOW,lastSeenAtReal:Date.now(),lastSeenAt:NOW});}source.store.save();
 const browserRows=new Map();
 source.browsers.start=async(user,selected,{store,onConnected}={})=>{
  calls.started++;assert.ok(store&&onConnected,'managed connection supplies a store and completion hook to the shared browser');assert.equal(selected.id,school.id);
  const pupils=Array.from({length:students},(_,i)=>({id:'synthetic-pupil-'+i,name:'Élève synthétique '+i,className:'Classe de test'}));
  store.update(user.id,{skolengo:store.seal({school:selected,tokenSet:{access_token:sourceAccess,refresh_token:sourceRefresh,expires_at:Math.floor(now/1000)+3600}}),skolengoConnectionId:fresh(),schoolName:selected.name,students:pupils,studentId:pupils[0].id,skolengoError:null,enabled:false});
  browserRows.set(user.id,{status:'connected',host:'sso.ent.auvergnerhonealpes.fr'});await onConnected(store.user(user.id));return {status:'connected'};
 };
 source.browsers.status=id=>browserRows.get(id)||{status:'closed'};
 source.browsers.frame=async()=>null;
 source.browsers.input=async()=>{};
 source.browsers.stop=async id=>{browserRows.delete(id);};
 source.browsers.close=async()=>{browserRows.clear();};
 const server=source.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port+'/agenda';
 async function request(route,{body,key,external,who,origin,method,cookie='',headers={}}={}){
  const parsed=/^https?:/.test(route)?new URL(route):null;const suffix=parsed?parsed.pathname.replace(/^\/agenda/,'')+parsed.search:route;
  const response=await fetch(root+suffix,{redirect:'manual',method:method||(body===undefined?'GET':'POST'),headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(who?{Cookie:cookies[who]||''}:{}),...(cookie?{Cookie:cookie}:{}),...(origin!==undefined?{Origin:origin}:{}),...(key?{Authorization:'Bearer '+key}:{}),...(external?{'X-Lapsus-User':external}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,body:value,headers:response.headers};
 }
 let key;
 async function enable(){const issued=await request('/api/admin/managed-ent/lapsus/key',{who:'owner',origin:ORIGIN,body:{}});assert.equal(issued.status,200);assert.equal(typeof issued.body.key,'string');assert.ok(issued.body.key.length>=32);key=issued.body.key;const configured=await request('/api/admin/managed-ent/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:true}});assert.equal(configured.status,200);return key;}
 async function session({external=EXTERNAL,scopes=['courses','homework','exams'],...extra}={}){const verifier=fresh(),state=fresh(),response=await request('/api/managed-ent/sessions',{key,external,body:{externalUserId:external,scopes,state,codeChallenge:challenge(verifier),...extra}});return {...response,verifier,state,external};}
 async function launch(flow){const response=await request(flow.body.launchURL);const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');return {...response,cookie};}
 async function drain(){for(let pass=0;pass<200;pass++){while(scheduled.length){await scheduled.shift()();}await new Promise(resolve=>setTimeout(resolve,5));if(!scheduled.length&&!service.engine.running.size)break;}assert.equal(service.engine.running.size,0,'synthetic source operations finish');}
 async function connect({external=EXTERNAL,scopes=['courses','homework','exams']}={}){
  const flow=await session({external,scopes});assert.equal(flow.status,200,JSON.stringify(flow.body));const started=await launch(flow);assert.equal(started.status,302);assert.ok(started.cookie);
  const schools=await request('/api/ent-connect/schools',{cookie:started.cookie,origin:ORIGIN,body:{q:'Lycée'}});assert.equal(schools.status,200);const row=schools.body.schools[0];assert.ok(row.id);
  const login=await request('/api/ent-connect/start',{cookie:started.cookie,origin:ORIGIN,body:{schoolId:row.id}});assert.equal(login.status,200,JSON.stringify(login.body));
  return {...flow,cookie:started.cookie};
 }
 async function finish(flow){await drain();const response=await request('/api/ent-connect/finish',{cookie:flow.cookie,origin:ORIGIN,body:{}});assert.equal(response.status,200,JSON.stringify(response.body));const redirect=new URL(response.body.redirectURL);assert.equal(redirect.origin+redirect.pathname,CALLBACK);assert.equal(redirect.searchParams.get('state'),flow.state);assert.equal(redirect.searchParams.get('iss'),ORIGIN+'/agenda');return {...flow,code:redirect.searchParams.get('code'),finish:response};}
 async function exchange(flow,extra={}){return request('/api/managed-ent/exchange',{key,external:flow.external,body:{code:flow.code,codeVerifier:flow.verifier,...extra}});}
 async function ready(options){const flow=await finish(await connect(options));const exchanged=await exchange(flow);assert.equal(exchanged.status,200,JSON.stringify(exchanged.body));assert.equal(exchanged.body.connectionId,flow.body.connectionId);return {...flow,exchanged};}
 async function close(){service.close();for(const name of ['partners','control','push','passkeys','cloud','incoming','personalCalendars','travel','smartTravel','personalMail','eventSuggestions'])source[name]?.close();await source.browsers.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
 return {...source,service,dir,root,cookies,calls,request,enable,session,launch,drain,connect,finish,exchange,ready,close,now:()=>now,setNow:value=>{now=value;},get key(){return key;}};
}

test('managed ENT is disabled by default; only administrators mint a server key, shown once and never persisted in cleartext',async()=>{
 const f=await fixture();try{
  const initial=await f.request('/api/admin/managed-ent/lapsus',{who:'owner'});assert.equal(initial.status,200);assert.equal(initial.body.enabled,false);assert.equal(initial.body.configured,false);assert.equal(initial.body.callbackURL,CALLBACK);
  assert.equal((await f.request('/api/admin/managed-ent/lapsus',{who:'ordinary'})).status,403);
  assert.equal((await f.request('/api/admin/managed-ent/lapsus/key',{who:'ordinary',origin:ORIGIN,body:{}})).status,403);
  assert.equal((await f.request('/api/admin/managed-ent/lapsus/key',{who:'owner',origin:PARTNER,body:{}})).status,403);
  const key=await f.enable();const status=await f.request('/api/admin/managed-ent/lapsus',{who:'owner'});assert.equal(status.body.enabled,true);assert.equal(status.body.configured,true);assert.ok(!JSON.stringify(status.body).includes(key));assert.equal(status.body.key,undefined);
  const disk=fs.readFileSync(f.store.file,'utf8');assert.ok(!disk.includes(key));assert.equal(f.store.state.users.length,2);assert.equal(f.store.state.sessions.length,2);assert.equal(f.calls.started,0);
 }finally{await f.close();}
});

test('managed sessions require backend authentication, strict PKCE and scopes; external identities are isolated without portal accounts',async()=>{
 const f=await fixture();try{
  await f.enable();const good={externalUserId:EXTERNAL,scopes:['courses'],state:fresh(),codeChallenge:challenge(fresh())};
  assert.ok(failure(await f.request('/api/managed-ent/sessions',{body:good})));
  assert.ok(failure(await f.request('/api/managed-ent/sessions',{key:'wrong-key',external:EXTERNAL,body:good})));
  for(const patch of [{externalUserId:''},{externalUserId:'x'.repeat(501)},{scopes:[]},{scopes:['courses','admin']},{scopes:['courses','courses']},{state:'tiny'},{codeChallenge:'plain'},{codeChallengeMethod:'plain'}])assert.ok(failure(await f.request('/api/managed-ent/sessions',{key:f.key,external:EXTERNAL,body:{...good,...patch}})),JSON.stringify(patch));
  const first=await f.session();assert.equal(first.status,200);assert.ok(first.body.sessionId);assert.ok(first.body.connectionId);assert.ok(first.body.expiresAt>f.now());assert.equal(new URL(first.body.launchURL).origin,ORIGIN);assert.ok(new URL(first.body.launchURL).pathname.endsWith('/ent-connect'));
  const again=await f.session(),other=await f.session({external:OTHER});assert.equal(again.status,200);assert.equal(other.status,200);assert.equal(again.body.connectionId,first.body.connectionId);assert.notEqual(other.body.connectionId,first.body.connectionId);assert.notEqual(again.body.sessionId,first.body.sessionId);
  assert.ok(failure(await f.launch(first)),'a replacement login invalidates the previous launch for the same Lapsus subject');
  const disk=fs.readFileSync(f.store.file,'utf8');assert.ok(!disk.includes(EXTERNAL));assert.ok(!disk.includes(OTHER));assert.ok(!disk.includes(f.key));assert.equal(f.store.state.users.length,2);assert.equal(f.store.state.sessions.length,2);
 }finally{await f.close();}
});

test('the ENT browser session needs its own HttpOnly cookie, same-origin writes and an unexpired launch; no Passerelle account is needed',async()=>{
 const f=await fixture();try{
  await f.enable();const flow=await f.session(),launched=await f.launch(flow);assert.equal(launched.status,302);assert.ok(launched.cookie);assert.match(launched.headers.get('set-cookie'),/HttpOnly/i);assert.match(launched.headers.get('set-cookie'),/SameSite=Lax/i);assert.equal(launched.headers.get('cache-control'),'no-store');
  assert.ok(failure(await f.request('/api/ent-connect/status')));
  assert.ok(failure(await f.request('/api/ent-connect/status',{who:'owner'})),'a portal cookie cannot substitute for the browser transaction');
  const status=await f.request('/api/ent-connect/status',{cookie:launched.cookie});assert.equal(status.status,200);assert.equal(status.body.status,'school');assert.equal(status.body.expiresAt,flow.body.expiresAt);
  assert.equal((await f.request('/api/ent-connect/schools',{cookie:launched.cookie,origin:PARTNER,body:{q:'Lycée'}})).status,403);
  assert.ok(failure(await f.request('/api/ent-connect/start',{cookie:launched.cookie,origin:ORIGIN,body:{schoolId:'unsearched-school'}})));
  assert.ok(!JSON.stringify(status.body).includes(f.key));assert.equal(f.store.state.users.length,2);assert.equal(f.store.state.sessions.length,2);
  f.setNow(NOW+13*60000);assert.ok(failure(await f.request('/api/ent-connect/status',{cookie:launched.cookie})));assert.ok(failure(await f.launch(flow)));
 }finally{await f.close();}
});

test('one ENT login synchronizes a managed connection and exchanges one short code without exposing source tokens',async()=>{
 const f=await fixture();try{
  await f.enable();const flow=await f.ready();assert.match(flow.code,/^[A-Za-z0-9_-]{43}$/);assert.equal(f.calls.started,1);assert.ok(f.calls.source>0);assert.ok(f.calls.agenda>0);
  const status=await f.request('/api/managed-ent/connections/'+flow.body.connectionId+'/status',{key:f.key,external:EXTERNAL});assert.equal(status.status,200);assert.ok(!JSON.stringify(status.body).includes(sourceAccess));assert.ok(!JSON.stringify(status.body).includes(sourceRefresh));
  assert.ok(failure(await f.exchange(flow)),'the callback code is usable only once');
  const disk=fs.readFileSync(f.store.file,'utf8');for(const secret of [sourceAccess,sourceRefresh,flow.code,f.key,EXTERNAL])assert.ok(!disk.includes(secret));
  const logs=fs.readdirSync(path.join(f.dir,'logs')).filter(name=>name.endsWith('.jsonl')).map(name=>fs.readFileSync(path.join(f.dir,'logs',name),'utf8')).join('');for(const secret of [sourceAccess,sourceRefresh,flow.code,f.key,EXTERNAL])assert.ok(!logs.includes(secret));
  assert.equal(f.store.state.users.length,2);assert.equal(f.store.state.sessions.length,2);
 }finally{await f.close();}
});

test('the completion code is bound to PKCE and the authenticated Lapsus subject',async()=>{
 const f=await fixture();try{
  await f.enable();const flow=await f.finish(await f.connect({scopes:['courses']}));
  assert.ok(failure(await f.exchange(flow,{codeVerifier:fresh()})));
  assert.ok(failure(await f.request('/api/managed-ent/exchange',{key:f.key,external:OTHER,body:{code:flow.code,codeVerifier:flow.verifier}})));
  const accepted=await f.exchange(flow);assert.equal(accepted.status,200);assert.equal(accepted.body.connectionId,flow.body.connectionId);
 }finally{await f.close();}
});

test('normalised REST data is scoped to one Lapsus user and reads cached data without renewing or querying the source',async()=>{
 const f=await fixture();try{
  await f.enable();const flow=await f.ready({scopes:['courses']}),id=flow.body.connectionId,url='/api/managed-ent/connections/'+id;
  const before={...f.calls};const own=await f.request(url+'/agenda?from='+DAY+'&to='+DAY,{key:f.key,external:EXTERNAL});assert.equal(own.status,200);const json=JSON.stringify(own.body);assert.ok(json.includes('Salle synthétique'));assert.ok(!json.includes(sourceAccess));assert.ok(!json.includes(sourceRefresh));assert.ok(!json.includes(EXTERNAL));assert.ok(!json.includes('tokenSet'));
  assert.deepEqual(f.calls,before,'REST reads do not make source requests');
  for(const external of [undefined,OTHER])assert.ok(failure(await f.request(url+'/agenda?from='+DAY+'&to='+DAY,{key:f.key,external})));
  assert.ok(failure(await f.request(url+'/homework?from='+DAY+'&to='+DAY,{key:f.key,external:EXTERNAL})),'courses permission does not include homework');
  assert.ok(failure(await f.request(url+'/agenda?from=2026-02-31&to='+DAY,{key:f.key,external:EXTERNAL})));
  assert.ok(failure(await f.request(url+'/agenda?from=2026-11-06&to=2026-11-01',{key:f.key,external:EXTERNAL})));
  assert.notEqual(own.headers.get('access-control-allow-origin'),'*');assert.equal(own.headers.get('cache-control'),'no-store');
  const activity=await f.request(url+'/activity',{key:f.key,external:EXTERNAL,body:{}});assert.equal(activity.status,200);const requested=await f.request(url+'/sync',{key:f.key,external:EXTERNAL,body:{}});assert.ok([200,202].includes(requested.status));assert.deepEqual(f.calls,before,'activity and sync requests only schedule work');
 }finally{await f.close();}
});

test('parents select an explicitly listed pupil before the first source synchronisation',async()=>{
 const f=await fixture({students:2});try{
  await f.enable();const flow=await f.connect();const status=await f.request('/api/ent-connect/status',{cookie:flow.cookie});assert.equal(status.status,200);assert.equal(status.body.status,'student');assert.equal(status.body.students.length,2);assert.equal(f.calls.source,0);
  assert.ok(failure(await f.request('/api/ent-connect/student',{cookie:flow.cookie,origin:ORIGIN,body:{studentId:'outside-pupil'}})));
  const selected=await f.request('/api/ent-connect/student',{cookie:flow.cookie,origin:ORIGIN,body:{studentId:status.body.students[1].id}});assert.equal(selected.status,200);await f.drain();
  assert.equal(f.service.store.user(flow.body.connectionId).studentId,status.body.students[1].id);assert.ok(f.calls.source>0);const finished=await f.finish(flow);assert.equal((await f.exchange(finished)).status,200);
 }finally{await f.close();}
});

test('disabling the integration or rotating its server key blocks old credentials and in-progress browser sessions',async()=>{
 const f=await fixture();try{
  const old=await f.enable(),flow=await f.session(),started=await f.launch(flow);assert.equal(started.status,302);
  const disabled=await f.request('/api/admin/managed-ent/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:false}});assert.equal(disabled.status,200);
  assert.ok(failure(await f.request('/api/ent-connect/status',{cookie:started.cookie})));assert.ok(failure(await f.request('/api/managed-ent/sessions',{key:old,external:EXTERNAL,body:{externalUserId:EXTERNAL,scopes:['courses'],state:fresh(),codeChallenge:challenge(fresh())}})));
  await f.request('/api/admin/managed-ent/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:true}});
  const freshFlow=await f.session(),freshBrowser=await f.launch(freshFlow);assert.equal(freshBrowser.status,302);
  const issued=await f.request('/api/admin/managed-ent/lapsus/key',{who:'owner',origin:ORIGIN,body:{}});assert.equal(issued.status,200);assert.notEqual(issued.body.key,old);assert.ok(!fs.readFileSync(f.store.file,'utf8').includes(issued.body.key));
  assert.ok(failure(await f.request('/api/ent-connect/status',{cookie:freshBrowser.cookie})),'rotating the backend key invalidates browser transactions authenticated with the old key');
  assert.ok(failure(await f.request('/api/managed-ent/sessions',{key:old,external:EXTERNAL,body:{externalUserId:EXTERNAL,scopes:['courses'],state:fresh(),codeChallenge:challenge(fresh())}})));
 }finally{await f.close();}
});

test('a connection can be deleted only by its owning Lapsus subject and its encrypted source data is purged',async()=>{
 const f=await fixture();try{
  await f.enable();const flow=await f.ready(),url='/api/managed-ent/connections/'+flow.body.connectionId;
  assert.ok(failure(await f.request(url,{key:f.key,external:OTHER,method:'DELETE'})));
  const removed=await f.request(url,{key:f.key,external:EXTERNAL,method:'DELETE'});assert.ok([200,204].includes(removed.status));
  assert.ok(failure(await f.request(url+'/status',{key:f.key,external:EXTERNAL})));assert.equal(f.service.store.user(flow.body.connectionId),undefined);assert.equal(f.store.state.users.length,2);assert.equal(f.store.state.sessions.length,2);
 }finally{await f.close();}
});

test('account deletion purges only the authenticated subject even when the connector is disabled and no local connection id is known',async()=>{
 const f=await fixture();try{
  await f.enable();const first=await f.ready(),other=await f.ready({external:OTHER}),portal=JSON.stringify({users:f.store.state.users,sessions:f.store.state.sessions});
  await f.request('/api/admin/managed-ent/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:false}});
  assert.equal((await f.request('/api/managed-ent/connection',{key:f.key,external:EXTERNAL})).status,503,'disabling still blocks data reads');
  const route='/api/managed-ent/connection';
  assert.equal((await f.request(route,{external:EXTERNAL,method:'DELETE'})).status,401);
  assert.equal((await f.request(route,{key:f.key,method:'DELETE'})).status,401);
  assert.equal((await f.request(route,{key:fresh(),external:EXTERNAL,method:'DELETE'})).status,401);
  assert.equal((await f.request(route,{key:f.key,external:EXTERNAL,origin:PARTNER,method:'DELETE'})).status,403);
  assert.equal((await f.request('/api/managed-ent/connections/'+first.body.connectionId,{key:f.key,external:OTHER,method:'DELETE'})).status,404);
  assert.equal((await f.request(route,{key:f.key,external:OTHER,method:'DELETE'})).status,200);
  assert.equal(f.service.store.user(other.body.connectionId),undefined);assert.ok(f.service.store.user(first.body.connectionId));
  assert.equal((await f.request('/api/managed-ent/connections/'+first.body.connectionId,{key:f.key,external:EXTERNAL,method:'DELETE'})).status,200);
  assert.equal((await f.request(route,{key:f.key,external:EXTERNAL,method:'DELETE'})).status,200,'cleanup is idempotent');
  await f.drain();assert.equal(f.calls.revoked,2);assert.equal(f.service.store.state.users.length,0);
  assert.equal(JSON.stringify({users:f.store.state.users,sessions:f.store.state.sessions}),portal);
 }finally{await f.close();}
});

test('cached source data remains unavailable until the one-time completion exchange establishes its owner',async()=>{
 const f=await fixture();try{
  await f.enable();const flow=await f.finish(await f.connect()),url='/api/managed-ent/connections/'+flow.body.connectionId;
  for(const kind of ['agenda','homework'])assert.equal((await f.request(url+'/'+kind+'?from='+DAY+'&to='+DAY,{key:f.key,external:EXTERNAL})).status,409);
  const metadata=await f.request(url+'/status',{key:f.key,external:EXTERNAL});assert.equal(metadata.status,200);assert.match(metadata.body.sourceVersion,/^[a-f0-9]{64}$/);
  assert.equal((await f.exchange(flow)).status,200);
  assert.equal((await f.request(url+'/agenda?from='+DAY+'&to='+DAY,{key:f.key,external:EXTERNAL})).status,200);
 }finally{await f.close();}
});

test('a cancelled reconnect after new ENT authentication removes the unconfirmed new source and changes its opaque version',async()=>{
 const f=await fixture();try{
  await f.enable();const first=await f.ready(),url='/api/managed-ent/connections/'+first.body.connectionId;
  const previous=(await f.request(url+'/status',{key:f.key,external:EXTERNAL})).body.sourceVersion;
  const reconnect=await f.connect();assert.equal(reconnect.body.connectionId,first.body.connectionId);await f.drain();
  const metadata=await f.request(url+'/status',{key:f.key,external:EXTERNAL});assert.notEqual(metadata.body.sourceVersion,previous);
  assert.equal((await f.request(url+'/agenda?from='+DAY+'&to='+DAY,{key:f.key,external:EXTERNAL})).status,409);
  assert.equal((await f.request('/api/ent-connect/cancel',{cookie:reconnect.cookie,origin:ORIGIN,body:{}})).status,200);
  assert.equal(f.service.store.user(first.body.connectionId),undefined);assert.equal(f.store.state.users.length,2);
 }finally{await f.close();}
});

test('abandoned draft connections from a previous server lifetime are pruned without touching established profiles',async()=>{
 const f=await fixture();try{
  await f.enable();const established=await f.ready(),draft=await f.session({external:OTHER});assert.equal(draft.status,200);
  // A process restart loses its in-memory login transaction, not the encrypted draft record.
  f.service.sessions.clear();f.setNow(NOW+13*60000);f.service.prune();
  assert.equal(f.service.store.user(draft.body.connectionId),undefined);assert.ok(f.service.store.user(established.body.connectionId));
  assert.equal(f.store.state.users.length,2);assert.equal(f.store.state.sessions.length,2);
 }finally{await f.close();}
});

test('Lapsus news and mail require their own scopes and opaque references remain bound to one technical profile',async()=>{
 const calls={messages:0,news:0,files:0};
 const f=await fixture({clientExtra:{
  getUsersMailSettings:async()=>({folders:[{id:'inbox',name:'Réception',type:'INBOX'}]}),
  getCommunicationsFolder:async()=>{calls.messages++;return [{id:'private-message',subject:'Réunion des élèves',lastParticipation:{dateTime:DAY+'T08:00:00Z',sender:{label:'Secrétariat'},contentWithoutHtml:'Demain à 10 h'},read:false,participationsNumber:1}];},
  getCommunicationParticipations:async()=>[{sender:{label:'Secrétariat'},dateTime:DAY+'T08:00:00Z',contentWithoutHtml:'Texte privé synthétique <script>alert(1)</script>',attachments:[{id:'file',name:'Document.pdf',size:8,url:'https://api.skolengo.com/api/v1/private-file'}]}],
  getSchoolInfos:async()=>{calls.news++;return [{id:'private-news',title:'Actualité du lycée',publicationDateTime:DAY+'T08:00:00Z',shortContent:'Présentation',author:{label:'Le lycée'}}];},
  getSchoolInfo:async()=>({title:'Actualité du lycée',content:'Texte complet synthétique',author:{label:'Le lycée'},attachments:[]}),
  request:async()=>{calls.files++;return {data:Buffer.from('%PDF-test')};}
 }});
 try{
  await f.enable();const flow=await f.ready({scopes:['courses','messages','news']}),id=flow.body.connectionId;
  const get=route=>f.request('/api/managed-ent/connections/'+id+route,{key:f.key,external:EXTERNAL});
  const mail=await get('/school/messages');assert.equal(mail.status,200,JSON.stringify(mail.body));assert.equal(mail.body.available,true);assert.equal(mail.body.items[0].title,'Réunion des élèves');const ref=mail.body.items[0].ref;assert.match(ref,/^[a-f0-9]{64}$/);
  assert.equal((await get('/school/messages')).status,200);assert.equal(calls.messages,1,'list reads use the ENT cache');
  const detail=await get('/detail/'+ref);assert.equal(detail.status,200,JSON.stringify(detail.body));assert.equal(detail.body.kind,'message');assert.match(detail.body.items[0].text,/Texte privé synthétique/);
  const file=await get('/files/'+detail.body.items[0].files[0].ref);assert.equal(file.status,200);assert.equal(file.body,'%PDF-test');assert.match(file.headers.get('content-disposition'),/attachment/);assert.equal(calls.files,1);
  const news=await get('/school/news');assert.equal(news.status,200);assert.equal((await get('/detail/'+news.body.items[0].ref)).body.text,'Texte complet synthétique');
  assert.equal((await get('/school/grades')).status,403);assert.equal((await get('/school/news?folder=inbox')).status,400);assert.equal((await get('/files/'+ref)).status,403);
  const other=await f.ready({external:OTHER,scopes:['courses','news']});assert.equal((await f.request('/api/managed-ent/connections/'+id+'/detail/'+ref,{key:f.key,external:OTHER})).status,404);
  assert.equal((await f.request('/api/managed-ent/connections/'+other.body.connectionId+'/detail/'+ref,{key:f.key,external:OTHER})).status,410);
  assert.equal((await f.request('/api/managed-ent/connections/'+other.body.connectionId+'/school/messages',{key:f.key,external:OTHER})).status,403);
  const serialized=JSON.stringify([mail.body,detail.body,news.body]);for(const secret of [sourceAccess,sourceRefresh,f.key,'private-message','private-news','https://api.skolengo.com'])assert.ok(!serialized.includes(secret),secret);
  f.service.store.update(id,{skolengoConnectionId:'source-replaced'});assert.equal((await get('/detail/'+ref)).status,410);assert.equal(f.store.state.users.length,2);
 }finally{await f.close();}
});

test('missing mail and news are identified as unavailable; temporary failures never pretend an empty successful source',async()=>{
 let reads=0;const f=await fixture({clientExtra:{getSchoolInfos:async()=>{reads++;throw Object.assign(new Error('Temporary source failure'),{status:500});}}});
 try{await f.enable();const flow=await f.ready({scopes:['messages','news']}),base='/api/managed-ent/connections/'+flow.body.connectionId;
  const first=await f.request(base+'/school/messages',{key:f.key,external:EXTERNAL});assert.equal(first.status,200);assert.equal(first.body.available,false);
  const failed=await f.request(base+'/school/news',{key:f.key,external:EXTERNAL});assert.equal(failed.status,503);assert.equal(failed.body.available,undefined);assert.equal(reads,1);
 }finally{await f.close();}
});

test('changing the student during a pending news read discards its response and cannot write news into the new profile',async()=>{
 let enter,release;const entered=new Promise(resolve=>enter=resolve),gate=new Promise(resolve=>release=resolve);
 const f=await fixture({clientExtra:{getSchoolInfos:async()=>{enter();await gate;return [{id:'old-student-news',title:'À ne pas transférer',shortContent:'Ancien profil'}];}}});
 try{await f.enable();const flow=await f.ready({scopes:['news']}),id=flow.body.connectionId;
  const pending=f.request('/api/managed-ent/connections/'+id+'/school/news',{key:f.key,external:EXTERNAL});await entered;
  f.service.store.update(id,{studentId:'new-student'});release();const response=await pending;assert.ok(response.status>=400);assert.ok(!JSON.stringify(response.body).includes('À ne pas transférer'));assert.equal(f.service.store.user(id).searchNews,undefined);
 }finally{release();await f.close();}
});
