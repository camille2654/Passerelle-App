// Usage: node scripts/verify-lapsus-contract.mjs /path/to/mon-ent
// Exercises both real local services; only Supabase Auth and ENT are synthetic.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {DISCOVERY} from '../src/skolengo.js';
import {random,digest} from '../src/store.js';
const lapsus=path.resolve(process.argv[2]||'../lapsus-passerelle');
const {createHandler}=await import(pathToFileURL(path.join(lapsus,'functions/api/passerelle/[[path]].js')));
const ISSUER='https://repere.84.235.226.127.sslip.io/agenda',ORIGIN='https://mon-ent.pages.dev';
const AUTH='https://synthetic-project.supabase.co',OWNER='11111111-1111-4111-8111-111111111111',OTHER='22222222-2222-4222-8222-222222222222';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-lapsus-contract-')),scheduled=[];let authUser=OWNER,sourceCalls=0;
const now=Date.parse('2026-11-04T12:00:00Z'),day='2026-11-05',school={id:'contract-school',name:'Lycée synthétique',emsCode:'rra',emsOIDCWellKnownUrl:DISCOVERY};
const source=createApp({dataDir:dir,baseURL:ISSUER,bootstrap:false,clock:()=>now,managedOptions:{schedule:fn=>scheduled.push(fn),schoolSearch:async()=>[school],revokeSource:async()=>{},clientFactory:async()=>({getAgenda:async(_student,from,to)=>{sourceCalls++;return from<=day&&to>=day?[{date:day,lessons:[{id:'lesson',title:'Cours synthétique',subject:{label:'Mathématiques'},startDateTime:day+'T09:00:00Z',endDateTime:day+'T10:00:00Z',canceled:false,teachers:[]}]}]:[];},getHomeworkAssignments:async()=>[],getUsersMailSettings:async()=>({folders:[{id:'inbox',name:'Réception',type:'INBOX'}]}),getCommunicationsFolder:async()=>[{id:'message',subject:'Mail contractuel',read:false,lastParticipation:{dateTime:day+'T08:00:00Z',sender:{label:'Vie scolaire'},contentWithoutHtml:'Aperçu'}}],getCommunicationParticipations:async()=>[{sender:{label:'Vie scolaire'},contentWithoutHtml:'Contenu contractuel',attachments:[{id:'file',name:'Document.pdf',size:8,url:'https://api.skolengo.com/api/v1/file'}]}],getSchoolInfos:async()=>[{id:'news',title:'Actualité contractuelle',shortContent:'Aperçu de la sortie'}],getSchoolInfo:async()=>({title:'Actualité contractuelle',content:'Contenu de la sortie'}),request:async()=>({data:Buffer.from('%PDF-test')})})}});
const portalFeed=random();source.store.state.users.push({id:'portal-existing',admin:true,name:'Compte synthétique préservé',feedHash:digest(portalFeed),feedKey:source.store.seal(portalFeed)});source.store.save();
const originalPortal=JSON.stringify(source.store.state.users),originalSessions=JSON.stringify(source.store.state.sessions);
const key=source.managedENT.issueKey({id:'portal-existing'}).key;source.managedENT.configure({enabled:true},{id:'portal-existing'});
source.browsers.start=async(user,selected,{store,onConnected})=>{store.update(user.id,{skolengo:store.seal({school:selected,tokenSet:{access_token:'synthetic-provider-secret',refresh_token:'synthetic-refresh-secret'}}),skolengoConnectionId:random(),schoolName:selected.name,students:[{id:'pupil',name:'Élève synthétique'}],studentId:'pupil'});await onConnected(store.user(user.id));return {status:'connected'};};
source.browsers.stop=async()=>{};source.browsers.status=()=>({status:'closed'});source.browsers.close=async()=>{};
const server=source.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const local='http://127.0.0.1:'+server.address().port;
const handler=createHandler({now:()=>now,fetcher:async(url,options)=>{
 if(url===AUTH+'/auth/v1/user')return Response.json({id:authUser,is_anonymous:false});
 assert.ok(String(url).startsWith(ISSUER+'/api/managed-ent/'));
 return fetch(local+new URL(url).pathname+new URL(url).search,options);
}});
const env={PASSERELLE_MANAGED_KEY:key,LAPSUS_SUPABASE_URL:AUTH,LAPSUS_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic_public_123456789'};
async function worker(route,{body,cookie,method}={}){const response=await handler({env,request:new Request(ORIGIN+'/api/passerelle'+route,{method:method||(body===undefined?'GET':'POST'),headers:{Authorization:'Bearer synthetic-lapsus-user-session-token-123456',Origin:ORIGIN,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})})});return {status:response.status,headers:response.headers,body:response.headers.get('content-type')?.includes('application/octet-stream')?await response.text():await response.json()};}
async function browser(route,{body,cookie}={}){const u=new URL(route,ISSUER+'/');const response=await fetch(local+u.pathname+u.search,{redirect:'manual',headers:{Origin:new URL(ISSUER).origin,...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{method:'POST',body:JSON.stringify(body)}:{})});const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,headers:response.headers,body:value};}
try{
 const opened=await worker('/connect',{body:{scopes:['courses','homework','exams','messages','news']}});assert.equal(opened.status,200);const workerCookie=opened.headers.get('set-cookie').split(';')[0];
 const launch=await browser(opened.body.launchURL);assert.equal(launch.status,302);const entCookie=launch.headers.getSetCookie()[0].split(';')[0];
 const schools=await browser(ISSUER+'/api/ent-connect/schools',{cookie:entCookie,body:{q:'Lycée'}});assert.equal(schools.status,200);
 const login=await browser(ISSUER+'/api/ent-connect/start',{cookie:entCookie,body:{schoolId:schools.body.schools[0].id}});assert.equal(login.status,200);
 while(scheduled.length)await scheduled.shift()();
 const finished=await browser(ISSUER+'/api/ent-connect/finish',{cookie:entCookie,body:{}});assert.equal(finished.status,200);
 const callback=new URL(finished.body.redirectURL),payload=Object.fromEntries(callback.searchParams);
 const linked=await worker('/exchange',{body:payload,cookie:workerCookie});assert.equal(linked.status,200);const id=linked.body.connectionId;
 const read=await worker('/connections/'+id+'/agenda?from=2026-11-01&to=2026-11-15');assert.equal(read.status,200);assert.equal(read.body.events.length,1);assert.equal(read.body.events[0].title,'Cours synthétique');
 assert.equal((await worker('/connections/'+id+'/homework?from=2026-11-01&to=2026-11-15')).status,200);
 const messages=await worker('/connections/'+id+'/school/messages');assert.equal(messages.status,200,JSON.stringify(messages.body));assert.equal(messages.body.items[0].title,'Mail contractuel');
 const mail=await worker('/connections/'+id+'/detail/'+messages.body.items[0].ref);assert.equal(mail.status,200);assert.equal(mail.body.items[0].text,'Contenu contractuel');
 const file=await worker('/connections/'+id+'/files/'+mail.body.items[0].files[0].ref);assert.equal(file.status,200);assert.equal(file.body,'%PDF-test');
 const news=await worker('/connections/'+id+'/school/news');assert.equal(news.status,200);assert.equal(news.body.items[0].title,'Actualité contractuelle');
 assert.equal((await worker('/connections/'+id+'/detail/'+news.body.items[0].ref)).body.text,'Contenu de la sortie');
 authUser=OTHER;assert.equal((await worker('/connections/'+id+'/detail/'+messages.body.items[0].ref)).status,404);authUser=OWNER;
 const afterReads=sourceCalls;await worker('/connection');await worker('/connections/'+id+'/status');assert.equal(sourceCalls,afterReads,'REST reads do not call the source');
 const exposed=JSON.stringify([opened.body,linked.body,read.body]);for(const secret of [key,'synthetic-provider-secret','synthetic-refresh-secret'])assert.ok(!exposed.includes(secret));
 authUser=OTHER;assert.equal((await worker('/connections/'+id+'/agenda?from=2026-11-01&to=2026-11-15')).status,404);authUser=OWNER;
 source.managedENT.configure({enabled:false},{id:'portal-existing'});
 assert.equal((await worker('/connection')).status,503);
 authUser=OTHER;assert.equal((await worker('/connection',{method:'DELETE'})).status,200);assert.equal(source.managedENT.store.state.users.length,1);authUser=OWNER;
 assert.equal((await worker('/connection',{method:'DELETE'})).status,200);assert.equal(source.managedENT.store.state.users.length,0);
 assert.equal((await worker('/connection',{method:'DELETE'})).status,200,'account cleanup is idempotent');
 assert.equal(JSON.stringify(source.store.state.users),originalPortal);assert.equal(JSON.stringify(source.store.state.sessions),originalSessions);
 console.log(JSON.stringify({ok:true,cloudflareToPasserelle:true,pkceExchange:true,normalizedREST:true,mailAndNews:true,fullContents:true,privateFiles:true,tenantIsolation:true,sourceTokensNeverExposed:true,accountCleanupWhenDisabled:true,portalAccountsAndSessionsPreserved:true,realENTCalls:0,realSupabaseCalls:0}));
}finally{
 for(const name of ['managedENT','partners','control','push','passkeys','cloud','incoming','personalCalendars','travel','smartTravel','personalMail','eventSuggestions'])source[name]?.close();
 await source.browsers.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});
}
