import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Store,digest} from '../src/store.js';
import {PersonalMailService,installPersonalMailRoutes} from '../src/personal-mail.js';

const GMAIL='https://www.googleapis.com/auth/gmail.readonly';
const MICROSOFT='11111111-2222-3333-4444-555555555555';
const initialNow=Date.parse('2026-10-29T12:00:00Z');
const gmailMessage=(id='mail-one',sender='direction@lycee.invalid',body='Réunion le 5 novembre 2026 de 18h à 19h.')=>({id,internalDate:String(initialNow-86400000),payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:'La direction <'+sender+'>'},{name:'Subject',value:'Rencontre du lycée'}],parts:[{mimeType:'multipart/alternative',parts:[{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<p>Version HTML non choisie</p><img src="https://tracker.invalid/pixel">').toString('base64url')}}]},{mimeType:'text/plain',filename:'secret.txt',body:{data:Buffer.from('NE PAS LIRE LA PIECE JOINTE').toString('base64url')}}]}});
const graphMessage=(id='outlook-one',sender='direction@lycee.invalid')=>({id,subject:'Sortie scolaire',from:{emailAddress:{address:sender}},receivedDateTime:new Date(initialNow-86400000).toISOString(),body:{contentType:'html',content:'<p>Sortie le 12 novembre 2026 à 9h.</p><script>badTracking()</script><img src="https://tracker.invalid/pixel">'},bodyPreview:'Sortie scolaire'});

async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-personal-mail-')),store=new Store(dir);let now=initialNow;
 const calls=[],events=[],control={gmail:[gmailMessage()],outlook:[graphMessage()],tokenScope:null,noRefresh:false,refreshError:null,refreshGate:null,refreshEntered:null,profileGate:null,profileEntered:null,profileAddress:null,readGate:null,readEntered:null},app=express(),router=express.Router();
 for(const id of ['admin','a','b'])store.state.users.push({id,admin:id==='admin'});
 for(const token of ['admin','a','b','a2'])store.state.sessions.push({hash:digest(token),userId:token==='a2'?'a':token,expires:Date.now()+3600000});store.save();
 app.use(express.json({limit:'128kb'}));app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='POST'&&req.get('origin')!=='http://127.0.0.1')return res.status(403).json({error:'origin'});const session=store.state.sessions.find(value=>value.hash===digest(req.get('x-session')||'')&&value.expires>Date.now());req.session=session;req.user=session?store.user(session.userId):null;next();});
 const auth=(req,res,next)=>req.user?next():res.status(401).json({error:'auth'}),admin=(req,res,next)=>req.user.admin?next():res.status(403).json({error:'admin'});
 const request=async input=>{
  calls.push(structuredClone(input));const url=new URL(input.url),provider=url.hostname.includes('microsoft')||url.hostname==='graph.microsoft.com'?'outlook':'gmail';
  if(url.pathname.endsWith('/token')){
   const body=new URLSearchParams(input.body),refresh=body.get('grant_type')==='refresh_token';
   if(refresh&&control.refreshEntered)control.refreshEntered();if(refresh&&control.refreshGate)await control.refreshGate;if(refresh&&control.refreshError)throw control.refreshError;
   return {access_token:provider+'-private-access-'+calls.length,...(!control.noRefresh?{refresh_token:provider+'-private-refresh-'+calls.length}:{}),expires_in:3600,scope:control.tokenScope||(provider==='gmail'?GMAIL:'Mail.Read User.Read')};
  }
  if(url.pathname.endsWith('/profile')||url.pathname==='/v1.0/me'){
   if(control.profileEntered)control.profileEntered();if(control.profileGate)await control.profileGate;
   return provider==='gmail'?{emailAddress:control.profileAddress||'camille@gmail.invalid'}:{id:'subject-fixture',mail:control.profileAddress||'camille@outlook.invalid'};
  }
  if(url.pathname.endsWith('/messages'))return provider==='gmail'?{messages:control.gmail.map(({id})=>({id})),nextPageToken:'ignored-untrusted-next-token'}:{value:control.outlook.map(({id,subject,from,receivedDateTime,bodyPreview})=>({id,subject,from,receivedDateTime,bodyPreview})),'@odata.nextLink':'https://attacker.invalid/private'};
  if(/\/messages\//.test(url.pathname)){
   if(control.readEntered)control.readEntered();if(control.readGate)await control.readGate;
   const id=decodeURIComponent(url.pathname.split('/').at(-1));return structuredClone((provider==='gmail'?control.gmail:control.outlook).find(value=>value.id===id));
  }
  throw new Error('UNEXPECTED FAKE REQUEST');
 };
 const service=installPersonalMailRoutes(router,{store,auth,admin,rateLimit:()=>{},baseURL:'http://127.0.0.1/agenda',clock:()=>now,request,onDisconnect:async(user,connection)=>events.push({user:user.id,...connection})});
 app.use('/agenda',router);app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.status?error.message:'Public operation failed.'}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 return {dir,store,service,calls,control,events,requestTransport:request,now:()=>now,setNow:value=>{now=value;},user:id=>store.user(id),
  async request(route,body,session='a',origin='http://127.0.0.1'){
   const response=await fetch('http://127.0.0.1:'+server.address().port+'/agenda/api/'+route,{redirect:'manual',headers:{'x-session':session,origin,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.text(),headers:response.headers};
  },
  async configure(provider='gmail'){return this.request('admin/personal-mail/'+provider,{clientId:provider==='gmail'?'fixture.apps.googleusercontent.com':MICROSOFT,clientSecret:'application-private-secret',enabled:true},'admin');},
  async start(provider='gmail',session='a'){return this.request('personal-mail/'+provider+'/connect',{accountId:session==='a2'?'a':session},session);},
  async callback(authorizationURL,provider='gmail',session='a'){const state=new URL(authorizationURL).searchParams.get('state');return this.request('personal-mail/oauth/'+provider+'/callback?'+new URLSearchParams({state,code:'private-authorization-code'}),undefined,session);},
  async connect(provider='gmail',session='a'){await this.configure(provider);const start=await this.start(provider,session);assert.equal(start.status,200);const finish=await this.callback(start.body.authorizationURL,provider,session);assert.equal(finish.status,303);assert.equal(finish.headers.get('location'),'http://127.0.0.1/agenda/#personal-mail=connected');return this.service.connection(this.user(session==='a2'?'a':session),provider);},
  async preferences(provider='gmail',enabled=true,senders=['direction@lycee.invalid'],session='a'){return this.request('personal-mail/'+provider+'/preferences',{accountId:session==='a2'?'a':session,enabled,senders},session);},
  async close(){service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
 };
}

test('personal mailbox setup is admin-only, encrypted and unavailable before explicit configuration',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('personal-mail',undefined,'anonymous')).status,401);assert.equal((await f.request('admin/personal-mail')).status,403);
  const initial=(await f.request('personal-mail')).body;assert.equal(initial.setupRequired,true);assert.ok(initial.providers.every(value=>!value.ready&&!value.connected&&!value.enabled));await f.service.collect(f.user('a'));assert.equal(f.calls.length,0);
  assert.equal((await f.start()).status,409);
  assert.equal((await f.request('admin/personal-mail/gmail',{clientId:'fixture.apps.googleusercontent.com',clientSecret:'',enabled:true},'admin')).status,400);
  assert.equal((await f.request('admin/personal-mail/gmail',{clientId:'fixture.apps.googleusercontent.com',clientSecret:'secret',enabled:true},'admin','https://other.invalid')).status,403);
  assert.equal((await f.request('admin/personal-mail/gmail',{clientId:'fixture.apps.googleusercontent.com',clientSecret:'secret',enabled:true,extra:true},'admin')).status,400);
  assert.equal((await f.configure()).status,200);const settings=(await f.request('admin/personal-mail',undefined,'admin')).body;assert.equal(settings.providers[0].hasSecret,true);assert.ok(!JSON.stringify(settings).includes('application-private-secret'));assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('application-private-secret'));
  assert.equal((await f.request('personal-mail/gmail/connect',{accountId:'b'})).status,409);assert.equal((await f.request('personal-mail/gmail/connect',{accountId:'a',url:'https://attacker.invalid'})).status,400);
 }finally{await f.close();}
});

test('OAuth uses S256, a one-time session-bound state and read-only scopes; identity and tokens stay encrypted',async()=>{
 const f=await fixture();try{
  await f.configure();const start=await f.start(),authorization=new URL(start.body.authorizationURL);
  assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('scope'),GMAIL);assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');assert.equal(authorization.searchParams.get('access_type'),'offline');
  assert.equal(authorization.searchParams.get('redirect_uri'),'http://127.0.0.1/agenda/api/personal-mail/oauth/gmail/callback');
  assert.equal((await f.callback(authorization.href)).headers.get('location'),'http://127.0.0.1/agenda/#personal-mail=connected');
  const exchange=f.calls.find(value=>value.method==='POST'),form=new URLSearchParams(exchange.body);assert.equal(Buffer.from(digest(form.get('code_verifier')),'hex').toString('base64url'),authorization.searchParams.get('code_challenge'));
  const settings=f.service.publicSettings(f.user('a'));assert.equal(settings.providers[0].address,'camille@gmail.invalid');assert.equal(settings.providers[0].enabled,false);assert.deepEqual(settings.providers[0].senders,[]);assert.equal(settings.version,1);
  const serialized=fs.readFileSync(f.store.file,'utf8');for(const value of ['camille@gmail.invalid','gmail-private-access','gmail-private-refresh','private-authorization-code',form.get('code_verifier')])assert.ok(!serialized.includes(value));assert.ok(!JSON.stringify(settings).includes('private-access'));
  assert.equal((await f.callback(authorization.href)).headers.get('location'),'http://127.0.0.1/agenda/#personal-mail=error');assert.equal(f.calls.filter(value=>value.method==='POST').length,1);
  await f.service.collect(f.user('a'));assert.equal(f.calls.length,2,'linking alone never starts mailbox analysis');
 }finally{await f.close();}
});

test('OAuth rejects provider/session confusion, expiration, old flows and new service instances',async()=>{
 const f=await fixture();try{
  await f.configure();await f.configure('outlook');let first=await f.start();assert.match((await f.callback(first.body.authorizationURL,'gmail','a2')).headers.get('location'),/personal-mail=error$/);assert.equal(f.calls.length,0);
  first=await f.start();assert.match((await f.callback(first.body.authorizationURL,'outlook')).headers.get('location'),/personal-mail=error$/);assert.equal(f.calls.length,0);
  first=await f.start();f.setNow(f.now()+10*60000+1);assert.match((await f.callback(first.body.authorizationURL)).headers.get('location'),/personal-mail=error$/);
  first=await f.start();await f.start();assert.match((await f.callback(first.body.authorizationURL)).headers.get('location'),/personal-mail=error$/);
  first=await f.start();const restarted=new PersonalMailService(f.store,'http://127.0.0.1/agenda',{clock:f.now,request:f.requestTransport});await assert.rejects(()=>restarted.callback({user:f.user('a'),session:f.store.state.sessions.find(value=>value.hash===digest('a'))},'gmail',{state:new URL(first.body.authorizationURL).searchParams.get('state'),code:'code'}));restarted.close();assert.equal(f.calls.length,0);
 }finally{await f.close();}
});

test('broader permissions or missing offline tokens do not create a connection',async()=>{
 const f=await fixture();try{
  await f.configure();f.control.tokenScope='https://www.googleapis.com/auth/gmail.modify';let started=await f.start();assert.match((await f.callback(started.body.authorizationURL)).headers.get('location'),/personal-mail=error$/);assert.equal(f.user('a').personalMailConnections,undefined);
  f.control.tokenScope=null;f.control.noRefresh=true;started=await f.start();assert.match((await f.callback(started.body.authorizationURL)).headers.get('location'),/personal-mail=error$/);assert.equal(f.user('a').personalMailConnections,undefined);
  f.control.noRefresh=false;await f.connect('outlook');const oauthCall=f.calls.find(value=>value.url.includes('microsoftonline')&&value.method==='POST');assert.ok(oauthCall);const config=f.service.publicSettings(f.user('a'));assert.equal(config.providers.find(value=>value.provider==='outlook').address,'camille@outlook.invalid');
 }finally{await f.close();}
});

test('only chosen Gmail senders are scanned; MIME attachments and tracking content are ignored',async()=>{
 const f=await fixture();try{
  const connection=await f.connect();assert.equal((await f.preferences('gmail',true,[])).status,400);assert.equal((await f.preferences('gmail',true,['bad query OR from:other'])).status,400);assert.equal((await f.preferences()).status,200);
  f.control.gmail.push(gmailMessage('not-selected','other@lycee.invalid'));const result=await f.service.collect(f.user('a'));assert.equal(result.incoming.length,1);const item=result.incoming[0];assert.equal(item.kind,'personal-mail');assert.ok(item.text.includes('Réunion le 5 novembre'));assert.ok(!item.text.includes('HTML non choisie'));assert.ok(!item.text.includes('PIECE JOINTE'));assert.ok(!JSON.stringify(item).includes('tracker.invalid'));assert.equal(JSON.parse(item.raw).connectionId,connection.id);
  const list=f.calls.find(value=>value.url.includes('/messages?'));assert.match(new URL(list.url).searchParams.get('q'),/from:direction@lycee.invalid/);assert.equal(new URL(list.url).searchParams.get('labelIds'),'INBOX');
  assert.ok(f.calls.filter(value=>value.method==='POST').every(value=>value.url.endsWith('/token')),'no modify, send or label writes');assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('direction@lycee.invalid'));assert.equal(f.service.publicSettings(f.user('a')).providers[0].lastScan,f.now());
  const source=await f.service.source(f.user('a'),item.raw);assert.equal(source.kind,'message');assert.equal(source.items[0].files.length,0);assert.ok(source.items[0].text.includes('Réunion'));assert.equal(f.user('a').personalMailVersion,2);
 }finally{await f.close();}
});

test('Outlook reads immutable inbox IDs with text preference and never changes read state or follows next links',async()=>{
 const f=await fixture();try{
  await f.connect('outlook');await f.preferences('outlook');f.control.outlook.push(graphMessage('foreign','foreign@lycee.invalid'));const result=await f.service.collect(f.user('a'));assert.equal(result.incoming.length,1);assert.ok(result.incoming[0].text.includes('Sortie le 12 novembre'));for(const value of ['tracker.invalid','badTracking'])assert.ok(!JSON.stringify(result).includes(value));
  const list=f.calls.find(value=>value.url.includes('/mailFolders/inbox/messages'));assert.match(list.headers.Prefer,/ImmutableId/);assert.ok(!new URL(list.url).searchParams.get('$select').split(',').includes('body'));assert.match(new URL(list.url).searchParams.get('$filter'),/direction@lycee.invalid/);
  const full=f.calls.find(value=>value.url.includes('/me/messages/'));assert.match(full.headers.Prefer,/body-content-type="text"/);assert.match(full.headers.Prefer,/ImmutableId/);assert.ok(f.calls.every(value=>!value.url.includes('attacker.invalid')));assert.ok(f.calls.every(value=>!['PATCH','DELETE'].includes(value.method)));
 }finally{await f.close();}
});

test('collection bounds the recent list and rotates the ten full reads without importing old or unrelated mail',async()=>{
 const f=await fixture();try{
  await f.connect();await f.preferences();f.control.gmail=Array.from({length:25},(_,index)=>gmailMessage('mail-'+index));let first=await f.service.collect(f.user('a'));assert.equal(first.incoming.length,10);let second=await f.service.collect(f.user('a'));assert.equal(second.incoming.length,10);assert.notDeepEqual(first.incoming.map(value=>value.raw),second.incoming.map(value=>value.raw));assert.equal(new Set([...first.incoming,...second.incoming].map(value=>value.raw)).size,20);
  f.control.gmail=[{...gmailMessage(),internalDate:String(f.now()-31*86400000)}];assert.equal((await f.service.collect(f.user('a'))).incoming.length,0);
 }finally{await f.close();}
});

test('refreshes serialize and retain rotated tokens without overwriting a concurrent preference withdrawal',async()=>{
 const f=await fixture();let release;try{
  const connection=await f.connect();await f.preferences();f.setNow(f.now()+3600000);let entered;const began=new Promise(resolve=>{entered=resolve;});f.control.refreshEntered=entered;f.control.refreshGate=new Promise(resolve=>{release=resolve;});
  const pending=f.service.collect(f.user('a'));await began;await f.preferences('gmail',false,['direction@lycee.invalid']);release();const result=await pending;assert.deepEqual(result.incoming,[]);assert.equal(f.service.publicSettings(f.user('a')).providers[0].enabled,false);assert.equal(f.user('a').personalMailVersion,3);
  f.control.refreshGate=null;f.control.refreshEntered=null;await f.preferences();
  const raw=JSON.stringify({provider:'gmail',connectionId:connection.id,messageId:'mail-one'});await Promise.all([f.service.collect(f.user('a')),f.service.source(f.user('a'),raw)]);
  const refreshes=f.calls.filter(value=>value.method==='POST'&&new URLSearchParams(value.body).get('grant_type')==='refresh_token');assert.equal(refreshes.length,2,'first invalidated refresh is followed by one serialized successful rotation');const token=f.service.open(f.service.connection(f.user('a'),'gmail'));assert.match(token.refreshToken,/gmail-private-refresh-/);assert.equal(f.user('a').personalMailVersion,4,'refresh does not count as a consent change');
 }finally{release?.();await f.close();}
});

test('disconnect and a changed OAuth configuration prevent stale reads or callbacks from restoring credentials',async()=>{
 const f=await fixture();let release;try{
  const connection=await f.connect();await f.preferences();const raw=JSON.stringify({provider:'gmail',connectionId:connection.id,messageId:'mail-one'});let entered;const began=new Promise(resolve=>{entered=resolve;});f.control.readEntered=entered;f.control.readGate=new Promise(resolve=>{release=resolve;});const pending=f.service.source(f.user('a'),raw);await began;
  await f.request('personal-mail/gmail/disconnect',{accountId:'a'});release();await assert.rejects(()=>pending);assert.equal(f.service.connection(f.user('a'),'gmail'),null);assert.equal(f.events.length,1);assert.equal((await f.service.collect(f.user('a'))).incoming.length,0);
  f.control.readGate=null;f.control.readEntered=null;await f.connect();await f.preferences();const old=f.service.connection(f.user('a'),'gmail'),oldReference=JSON.stringify({provider:'gmail',connectionId:old.id,messageId:'mail-one'});const before=f.calls.length;f.service.configure('gmail',{clientId:'another.apps.googleusercontent.com',clientSecret:'another-private-secret',enabled:true});assert.equal((await f.service.collect(f.user('a'))).incoming.length,0);await assert.rejects(()=>f.service.source(f.user('a'),oldReference));assert.equal(f.calls.length,before);
  const start=await f.start();await f.request('personal-mail/gmail/disconnect',{accountId:'a'});assert.match((await f.callback(start.body.authorizationURL)).headers.get('location'),/personal-mail=error$/);
 }finally{release?.();await f.close();}
});

test('logout during OAuth identity exchange cannot link a mailbox, and private source references cannot cross accounts',async()=>{
 const f=await fixture();let release;try{
  await f.configure();const start=await f.start();let entered;const began=new Promise(resolve=>{entered=resolve;});f.control.profileEntered=entered;f.control.profileGate=new Promise(resolve=>{release=resolve;});const callback=f.callback(start.body.authorizationURL);await began;f.store.state.sessions=f.store.state.sessions.filter(value=>value.hash!==digest('a'));f.store.save();release();assert.match((await callback).headers.get('location'),/personal-mail=error$/);assert.equal(f.service.connection(f.user('a'),'gmail'),null);
  f.control.profileGate=null;f.control.profileEntered=null;await f.connect('gmail','a2');await f.preferences('gmail',true,['direction@lycee.invalid'],'a2');const source=(await f.service.collect(f.user('a'))).incoming[0];await assert.rejects(()=>f.service.source(f.user('b'),source.raw));for(const raw of ['https://attacker.invalid','{}',JSON.stringify({provider:'gmail',connectionId:'unknown',messageId:'../other'})])await assert.rejects(()=>f.service.source(f.user('b'),raw));
 }finally{release?.();await f.close();}
});


test('renewing the same mailbox preserves resource identities and choices, while another identity is a fresh link',async()=>{
 const f=await fixture();try{
  const first=await f.connect();await f.preferences();const proposal=(await f.service.collect(f.user('a'))).incoming[0];
  const renewed=await f.connect();assert.equal(renewed.id,first.id);assert.equal(f.events.length,0);assert.deepEqual(f.service.publicSettings(f.user('a')).providers[0].senders,['direction@lycee.invalid']);assert.equal(f.service.publicSettings(f.user('a')).providers[0].enabled,true);assert.equal((await f.service.collect(f.user('a'))).incoming[0].raw,proposal.raw);
  f.service.configure('gmail',{clientId:'another.apps.googleusercontent.com',clientSecret:'another-secret',enabled:true});const start=await f.start();assert.match((await f.callback(start.body.authorizationURL)).headers.get('location'),/personal-mail=connected$/);assert.equal(f.service.connection(f.user('a'),'gmail').id,first.id);assert.equal(f.service.publicSettings(f.user('a')).providers[0].enabled,true);assert.equal(f.events.length,0);
  f.control.profileAddress='another@gmail.invalid';const next=await f.start();assert.match((await f.callback(next.body.authorizationURL)).headers.get('location'),/personal-mail=connected$/);assert.notEqual(f.service.connection(f.user('a'),'gmail').id,first.id);assert.equal(f.events.length,1);assert.equal(f.service.publicSettings(f.user('a')).providers[0].enabled,false);assert.deepEqual(f.service.publicSettings(f.user('a')).providers[0].senders,[]);
 }finally{await f.close();}
});

test('a refresh finishing after renewed OAuth cannot replace the new authorization',async()=>{
 const f=await fixture();let release;try{
  const connection=await f.connect();await f.preferences();f.setNow(f.now()+3600000);let entered;const began=new Promise(resolve=>{entered=resolve;});f.control.refreshEntered=entered;f.control.refreshGate=new Promise(resolve=>{release=resolve;});const scanning=f.service.collect(f.user('a'));await began;
  const start=await f.start();await f.callback(start.body.authorizationURL);const renewed=f.service.open(f.service.connection(f.user('a'),'gmail'));assert.equal(f.service.connection(f.user('a'),'gmail').id,connection.id);release();await scanning;const final=f.service.open(f.service.connection(f.user('a'),'gmail'));assert.equal(final.authEpoch,renewed.authEpoch);assert.equal(final.refreshToken,renewed.refreshToken);assert.equal(final.accessToken,renewed.accessToken);
 }finally{release?.();await f.close();}
});

test('mail automation and maintenance pause personal collection without affecting explicit source reads',async()=>{
 const f=await fixture();try{
  await f.connect();await f.preferences();const item=(await f.service.collect(f.user('a'))).incoming[0],before=f.calls.length;f.store.state.settings.automationPaused={mail:true};f.store.save();const paused=await f.service.collect(f.user('a'));assert.equal(paused.sources.personal.state,'paused');assert.deepEqual(paused.incoming,[]);assert.equal(f.calls.length,before);
  assert.equal((await f.service.source(f.user('a'),item.raw)).kind,'message');f.store.state.settings.automationPaused={mail:false};f.store.state.settings.maintenance={enabled:true,until:f.now()+60000};f.store.save();const count=f.calls.length;assert.equal((await f.service.collect(f.user('a'))).sources.personal.state,'paused');assert.equal(f.calls.length,count);
 }finally{await f.close();}
});
