import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Store,digest} from '../src/store.js';
import {Favorites} from '../src/favorites.js';
import {installResourceRoutes} from '../src/work-resources.js';

async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-resources-')),store=new Store(dir);let now=Date.now(),gate=null;
 for(const id of ['a','b'])store.state.users.push({id,name:'Fixture '+id,studentId:'student-'+id,manualWork:[{id:'work-'+id,source:'manual',due:'2026-11-01',title:'Fixture assignment',subjectLabel:'Mathématiques'}]});
 for(const id of ['a','a2','b'])store.state.sessions.push({hash:digest(id),userId:id==='a2'?'a':id,expires:Date.now()+3600000});store.save();
 const favorites=new Favorites(store,null),configs={gmail:{clientId:'fake-google-client',clientSecret:'fake-google-secret',enabled:true},outlook:{clientId:'fake-microsoft-client',clientSecret:'fake-microsoft-secret',enabled:true}},calls=[],drafts=[];
 let tokenScope=null,tokenValue='fake-access-token',graphURL='https://onedrive.live.com/?id=fixture';
 const personalMail={ready:provider=>!!configs[provider]?.enabled,config:provider=>configs[provider]},app=express(),router=express.Router();
 app.use(express.json());app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='POST'&&req.get('origin')!=='http://localhost')return res.status(403).json({error:'origin'});req.session=store.state.sessions.find(item=>item.hash===digest(req.get('x-session')||'')&&item.expires>Date.now());req.user=req.session?store.user(req.session.userId):null;next();});
 const request=async input=>{calls.push(input);if(gate)await gate;if(input.url.includes('/token'))return {access_token:tokenValue,token_type:'Bearer',...(tokenScope===null?{}:{scope:tokenScope})};if(input.url.includes('googleapis.com/drive/v3/files/'))return {id:'file_12345',name:'My cloud document',webViewLink:'https://docs.google.com/document/d/file_12345/edit'};if(input.url.includes('/children?'))return {value:[{id:'folder-1',name:'Lesson folder',folder:{}},{id:'file-1',name:'Document <unsafe>',file:{}}],'@odata.nextLink':'https://attacker.invalid/do-not-follow'};return {id:'file-1',name:'My OneDrive document',webUrl:graphURL,file:{}};};
 const auth=(req,res,next)=>req.user?next():res.status(401).json({error:'auth'}),service=installResourceRoutes(router,{store,favorites,personalMail,auth,rateLimit:()=>{},baseURL:'http://localhost/agenda',clock:()=>now,request,incoming:()=>({fromCloud(req,links,workId){drafts.push({owner:req.user.id,links,workId});return {token:'incoming-token'};}})});
 app.use('/agenda',router);app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.status?error.message:'Operation failed'}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port+'/agenda/api/';
 return {store,favorites,...service,configs,calls,drafts,now:()=>now,setNow:value=>{now=value;},setScope:value=>{tokenScope=value;},setToken:value=>{tokenValue=value;},setGraphURL:value=>{graphURL=value;},setGate:value=>{gate=value;},req:(id='a')=>({user:store.user(id==='a2'?'a':id),session:store.state.sessions.find(item=>item.hash===digest(id))}),async request(route,body,who='a',options={}){const response=await fetch(root+route,{redirect:'manual',headers:{origin:options.origin||'http://localhost','x-session':who,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});let value;try{value=await response.json();}catch{value=null;}return {status:response.status,body:value,headers:response.headers};},async start(provider='gmail',workId='work-a'){const result=await this.request('cloud-documents/'+provider+'/start',{accountId:'a',workId});assert.equal(result.status,200);return new URL(result.body.authorizationURL);},async close(){service.cloud.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}};
}

test('resources require authenticated account-bound strict mutations and cloud-only HTTPS links',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('work-resources',undefined,'')).status,401);
  const valid={accountId:'a',workId:'work-a',title:'Fiche',url:'https://docs.google.com/document/d/example/edit'};
  for(const body of [{...valid,accountId:'b'},{...valid,workId:'work-b'},{...valid,url:'https://evil.invalid/file'},{...valid,url:'http://drive.google.com/file'},{...valid,url:'https://user:secret@drive.google.com/file'},{...valid,url:{link:valid.url}},{...valid,title:{name:'no'}},{...valid,admin:true},{...valid,favoriteId:'any'}])assert.ok((await f.request('work-resources/add',body)).status>=400);
  assert.equal((await f.request('work-resources/add',valid,'a',{origin:'https://evil.invalid'})).status,403);
  const result=await f.request('work-resources/add',valid);assert.equal(result.status,200);assert.equal(result.body.item.workId,'work-a');assert.equal(result.body.item.provider,'Google Drive');assert.ok(!JSON.stringify(result.body).includes(valid.url));
  const duplicate=await f.request('work-resources/add',valid);assert.equal(duplicate.body.alreadySaved,true);assert.equal(duplicate.body.items.length,1);
  assert.ok(!fs.readFileSync(f.store.file,'utf8').includes(valid.url));assert.equal((await f.request('work-resources')).headers.get('cache-control'),'no-store');
 }finally{await f.close();}
});

test('linked documents and copies stay isolated by account and pupil, and explicit open resolves current source',async()=>{
 const f=await fixture();try{
  const user=f.store.user('a'),copy=f.favorites.save(user,Buffer.from('private fixture file'),'Fixture.pdf','Personnel');
  const added=await f.request('work-resources/add',{accountId:'a',workId:'work-a',title:'Private copy',favoriteId:copy.item.id});assert.equal(added.status,200);const id=added.body.item.id;
  assert.equal((await f.request('work-resources/'+id+'/open',undefined,'b')).status,404);
  assert.equal((await f.request('work-resources/'+id+'/remove',{accountId:'b'},'b')).status,404);
  assert.equal((await f.request('work-resources/add',{accountId:'b',workId:'work-b',title:'steal',favoriteId:copy.item.id},'b')).status,404);
  f.favorites.remove(user,copy.item.id);assert.equal((await f.request('work-resources')).body.items[0].available,false);assert.equal((await f.request('work-resources/'+id+'/open')).status,404);
  const link=await f.request('work-resources/add',{accountId:'a',workId:'work-a',title:'Current',url:'https://drive.google.com/file/d/live/view'});const opened=await f.request('work-resources/'+link.body.item.id+'/open');assert.equal(opened.status,303);assert.equal(opened.headers.get('location'),'https://drive.google.com/file/d/live/view');assert.equal(opened.headers.get('referrer-policy'),'no-referrer');
  user.studentId='other-student';assert.deepEqual((await f.request('work-resources')).body.items,[]);assert.equal((await f.request('work-resources/'+link.body.item.id+'/open')).status,404);
  user.workResourcesData=f.store.seal({scope:f.resources.scope(user),items:'corrupt'});assert.deepEqual(f.resources.rows(user),[]);
 }finally{await f.close();}
});

test('cloud selectors request separate minimal permissions with PKCE and honest provider readiness',async()=>{
 const f=await fixture();try{
  f.configs.gmail.enabled=false;assert.equal((await f.request('cloud-documents/providers')).body.providers[0].ready,false);assert.equal((await f.request('cloud-documents/gmail/start',{accountId:'a',workId:'work-a'})).status,409);f.configs.gmail.enabled=true;
  const google=await f.start();assert.equal(google.origin,'https://accounts.google.com');assert.equal(google.searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');assert.equal(google.searchParams.get('trigger_onepick'),'true');assert.equal(google.searchParams.get('include_granted_scopes'),'false');assert.equal(google.searchParams.get('code_challenge_method'),'S256');assert.equal(google.searchParams.get('redirect_uri'),'http://localhost/agenda/api/cloud-documents/oauth/gmail/callback');assert.equal(google.searchParams.get('access_type'),null);
  const microsoft=await f.start('outlook');assert.equal(microsoft.searchParams.get('scope'),'https://graph.microsoft.com/Files.Read');assert.ok(!microsoft.search.includes('Mail.Read'));assert.ok(!microsoft.search.includes('offline_access'));
  assert.equal((await f.request('cloud-documents/gmail/start',{accountId:'a',workId:{id:'work-a'}})).status,400);
 }finally{await f.close();}
});

test('Google selection is session-bound, single-use and stages reviewed links without storing cloud tokens',async()=>{
 const f=await fixture();try{
  const url=await f.start(),query={state:url.searchParams.get('state'),code:'fake-code',picked_file_ids:'file_12345'};
  await assert.rejects(()=>f.cloud.callback(f.req('a2'),'gmail',query),/expiré/);assert.equal(f.calls.length,0);
  const second=await f.start();query.state=second.searchParams.get('state');const result=await f.cloud.callback(f.req(),'gmail',query);assert.deepEqual(result,{kind:'incoming',token:'incoming-token'});assert.equal(f.drafts.length,1);assert.equal(f.drafts[0].workId,'work-a');assert.equal(f.drafts[0].links[0].url,'https://docs.google.com/document/d/file_12345/edit');assert.equal(f.resources.rows(f.store.user('a')).length,0);assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('fake-access-token'));assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('fake-code'));
  await assert.rejects(()=>f.cloud.callback(f.req(),'gmail',query),/expiré/);assert.equal(f.drafts.length,1);assert.ok(new URLSearchParams(f.calls[0].body).get('code_verifier'));
 }finally{await f.close();}
});

test('selectors reject wrong scopes, empty tokens, expired flows and changed configuration',async()=>{
 const f=await fixture();try{
  for(const scope of ['https://www.googleapis.com/auth/drive.readonly','Files.Read','']){const url=await f.start();f.setScope(scope);await assert.rejects(()=>f.cloud.callback(f.req(),'gmail',{state:url.searchParams.get('state'),code:'code',picked_file_ids:'file_12345'}),/permissions/);}
  f.setScope(null);f.setToken('');let url=await f.start();await assert.rejects(()=>f.cloud.callback(f.req(),'gmail',{state:url.searchParams.get('state'),code:'code',picked_file_ids:'file_12345'}),/échoué/);f.setToken('fake-access-token');
  url=await f.start();f.configs.gmail.clientSecret='changed';await assert.rejects(()=>f.cloud.callback(f.req(),'gmail',{state:url.searchParams.get('state'),code:'code',picked_file_ids:'file_12345'}),/réglages/);
  url=await f.start();f.setNow(f.now()+600001);await assert.rejects(()=>f.cloud.callback(f.req(),'gmail',{state:url.searchParams.get('state'),code:'code',picked_file_ids:'file_12345'}),/expiré/);assert.equal(f.drafts.length,0);
 }finally{await f.close();}
});

test('OneDrive folder browsing never follows external pagination and choosing consumes its session-bound picker',async()=>{
 const f=await fixture();try{
  f.setScope('Files.Read');const url=await f.start('outlook'),result=await f.cloud.callback(f.req(),'outlook',{state:url.searchParams.get('state'),code:'code'});assert.equal(result.kind,'picker');
  await assert.rejects(()=>f.cloud.files(f.req('b'),result.token,null),/expiré/);const files=await f.cloud.files(f.req(),result.token,null);assert.equal(files.items.length,2);assert.equal(files.truncated,true);assert.equal(files.items[0].folder,true);assert.ok(!f.calls.some(call=>call.url.includes('attacker.invalid')));assert.ok(!JSON.stringify(files).includes('webUrl'));
  const selected=await f.cloud.choose(f.req(),result.token,'file-1');assert.equal(selected.token,'incoming-token');assert.equal(f.drafts.length,1);assert.equal(f.drafts[0].links[0].url,'https://onedrive.live.com/?id=fixture');await assert.rejects(()=>f.cloud.choose(f.req(),result.token,'file-1'),/expiré/);
  assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('fake-access-token'));
 }finally{await f.close();}
});

test('logout during cloud fetch, account context changes and service closure cancel selection',async()=>{
 const f=await fixture();let release;try{
  const url=await f.start();f.setGate(new Promise(resolve=>{release=resolve;}));const pending=f.cloud.callback(f.req(),'gmail',{state:url.searchParams.get('state'),code:'code',picked_file_ids:'file_12345'});while(f.calls.length===0)await new Promise(resolve=>setTimeout(resolve,5));f.store.state.sessions=f.store.state.sessions.filter(item=>item.hash!==digest('a'));release();await assert.rejects(()=>pending,/échoué/);assert.equal(f.drafts.length,0);
  f.setGate(null);const other=f.req('a2'),start=f.cloud.start(other,'outlook','work-a');const result=await f.cloud.callback(other,'outlook',{state:new URL(start.authorizationURL).searchParams.get('state'),code:'code'});f.store.user('a').studentId='changed';await assert.rejects(()=>f.cloud.files(other,result.token,null),/expiré/);
  f.cloud.close();assert.throws(()=>f.cloud.start(other,'gmail',null),/Reconnectez/);
 }finally{release?.();await f.close();}
});

test('documents from a removed homework remain accessible and removable in the personal library',async()=>{
 const f=await fixture();try{
  const added=await f.request('work-resources/add',{accountId:'a',workId:'work-a',title:'À conserver',url:'https://docs.google.com/document/d/retained/edit'});assert.equal(added.status,200);
  f.store.user('a').manualWork=[];f.store.save();const list=await f.request('work-resources');assert.equal(list.body.items[0].workId,null);
  assert.equal((await f.request('work-resources/'+added.body.item.id+'/open')).status,303);
  assert.equal((await f.request('work-resources/'+added.body.item.id+'/remove',{accountId:'a'})).status,200);
  assert.equal((await f.request('work-resources')).body.items.length,0);
 }finally{await f.close();}
});
