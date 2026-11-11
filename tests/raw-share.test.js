import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import {Store,digest} from '../src/store.js';
import {Favorites} from '../src/favorites.js';
import {WorkResources} from '../src/work-resources.js';
import {MAX_DOCUMENT_BYTES} from '../src/upload-limits.js';
import {installIncomingRoutes} from '../src/incoming.js';
import {controlFixture} from './control-fixture.js';

async function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-raw-share-')),store=new Store(dir),favorites=new Favorites(store,null),resources=new WorkResources(store,favorites);let now=Date.parse('2026-10-29T12:00:00Z');
 for(const id of ['a','b'])store.state.users.push({id,studentId:'student-'+id,manualWork:[]});for(const token of ['a','a2','b'])store.state.sessions.push({hash:digest(token),userId:token==='a2'?'a':token,expires:Date.now()+3600000});store.save();
 const app=express(),router=express.Router();const json=express.json({limit:'128kb'});app.use((req,res,next)=>req.method==='POST'&&req.path==='/agenda/share'?next():json(req,res,next));app.use((req,res,next)=>{if(req.method==='POST'&&req.path!=='/agenda/share'&&req.get('origin')!=='http://localhost')return res.status(403).json({error:'origin'});req.session=store.state.sessions.find(s=>s.hash===digest(req.get('x-session')||''));req.user=req.session?store.user(req.session.userId):null;next();});
 const auth=(req,res,next)=>req.user?next():res.status(401).json({error:'auth'}),service=installIncomingRoutes(router,{store,favorites,resources,auth,rateLimit:()=>{},clock:()=>now,baseURL:'http://localhost/agenda'});app.use('/agenda',router);app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message,...(error.code?{code:error.code}:{})}));const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port+'/agenda';
 return {dir,store,favorites,resources,service,root,user:store.user('a'),setNow:value=>now=value,
  async raw(bytes,type='application/octet-stream',headers={}){const response=await fetch(root+'/share',{method:'POST',headers:{Accept:'application/json','Content-Type':type,...headers},body:bytes});return {status:response.status,body:await response.json(),headers:response.headers};},
  async api(route,body,session='a',origin='http://localhost'){const response=await fetch(root+'/api/incoming/'+route,{method:'POST',headers:{origin,'x-session':session,'Content-Type':'application/json'},body:JSON.stringify({accountId:session==='a2'?'a':session,...body})});return {status:response.status,body:await response.json()};},
  async close(){service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
 };
}

const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0,0x10,0x4a,0x46,0x49,0x46,0,0xff,0xd9]);
const pdf=Buffer.from('%PDF-1.4\nPrivate synthetic document\n%%EOF');

test('raw iPhone photos and PDFs are staged unchanged with inferred filenames and no implicit account writes',async()=>{
 const f=await fixture();try{
  const before=fs.readFileSync(f.store.file,'utf8');
  for(const [bytes,type,extension] of [[jpeg,'image/jpeg',/\.jpe?g$/i],[pdf,'application/pdf',/\.pdf$/i],[jpeg,'application/octet-stream',/\.jpe?g$/i],[pdf,'application/octet-stream',/\.pdf$/i]]){
   const shared=await f.raw(bytes,type);assert.equal(shared.status,200);assert.match(shared.body.openURL,/^http:\/\/localhost\/agenda\/#shared=/);assert.equal(fs.readFileSync(f.store.file,'utf8'),before);
   const row=await f.api('claim',{token:shared.body.token});assert.equal(row.status,200);assert.equal(row.body.file.size,bytes.length);assert.match(row.body.file.name,extension);assert.equal((await f.api('discard',{token:shared.body.token})).status,200);
  }
  assert.equal(f.user.favoriteDocuments,undefined);assert.equal(f.user.manualWork.length,0);
 }finally{await f.close();}
});

test('raw filenames are optional, Unicode-safe and stripped of paths; draft claims remain account/session scoped',async()=>{
 const f=await fixture();try{
  const response=await f.raw(pdf,'application/pdf',{'x-file-name':encodeURIComponent('../../Révision privée.pdf')});assert.equal(response.status,200);const token=response.body.token;
  const row=await f.api('claim',{token});assert.equal(row.status,200);assert.equal(row.body.file.name,'Révision privée.pdf');assert.equal((await f.api('claim',{token},'b')).status,409);assert.equal((await f.api('claim',{token},'a2')).status,409);
  assert.equal((await f.api('commit',{token,action:'library'},'a','https://other.invalid')).status,403);assert.equal((await f.api('commit',{token,action:'library',accountId:'b'})).status,409);
  assert.equal((await f.api('commit',{token,action:'library'})).status,200);const item=f.favorites.list(f.user).items[0];assert.equal(item.name,'Révision privée.pdf');assert.deepEqual(f.favorites.download(f.user,item.id).bytes,pdf);assert.equal(f.favorites.list(f.store.user('b')).items.length,0);
 }finally{await f.close();}
});

test('an exact 30 MiB raw file confirms and round-trips through encrypted favorites without duplication',async()=>{
 const f=await fixture();try{
  const bytes=Buffer.alloc(MAX_DOCUMENT_BYTES,0x71),expected=digest(bytes),before=fs.readFileSync(f.store.file,'utf8');const response=await f.raw(bytes,'application/octet-stream',{'x-file-name':encodeURIComponent('Photo originale.bin')});assert.equal(response.status,200);assert.equal(fs.readFileSync(f.store.file,'utf8'),before);const token=response.body.token;
  const claimed=await f.api('claim',{token});assert.equal(claimed.status,200);assert.equal(claimed.body.file.size,MAX_DOCUMENT_BYTES);assert.equal((await f.api('commit',{token,action:'library'})).status,200);
  const item=f.favorites.list(f.user).items[0],stored=f.favorites.download(f.user,item.id);assert.equal(stored.bytes.length,MAX_DOCUMENT_BYTES);assert.equal(digest(stored.bytes),expected);assert.ok(!fs.readFileSync(f.favorites.file(f.user,item.id)).includes(bytes.subarray(0,128)));assert.equal((await f.api('commit',{token,action:'library'})).body.alreadySaved,true);assert.equal(f.user.favoriteDocuments.length,1);
 }finally{await f.close();}
});

test('empty, unsupported and oversized raw uploads fail clearly without blocking a later valid upload',async()=>{
 const f=await fixture();try{
  const empty=await f.raw(Buffer.alloc(0),'image/jpeg');assert.equal(empty.status,400);assert.match(empty.body.error,/vide|aucun|fichier/i);
  for(const [type,body]of [['application/x-www-form-urlencoded','file=not-a-file'],['application/json','{}']]){const rejected=await f.raw(body,type);assert.equal(rejected.status,415);assert.equal(rejected.body.code,'SHARE_FILE_TYPE');}
  for(const name of ['bad%ZZname','x'.repeat(601)]){const invalid=await f.raw(pdf,'application/pdf',{'x-file-name':name});assert.equal(invalid.status,400);assert.equal(invalid.body.code,'SHARE_FILE_NAME');}
  const tooLarge=await new Promise((resolve,reject)=>{const req=http.request(f.root+'/share',{method:'POST',headers:{Accept:'application/json','Content-Type':'image/jpeg','Content-Length':MAX_DOCUMENT_BYTES+1024*1024,Connection:'close'}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())});req.destroy();});res.on('error',reject);});req.setTimeout(5000,()=>req.destroy(new Error('raw overlimit fixture timeout')));req.on('error',reject);req.end('--');});assert.equal(tooLarge.status,413);assert.equal(tooLarge.body.code,'SHARE_FILE_TOO_LARGE');assert.equal(f.service.drafts.size,0);assert.equal((await f.raw(jpeg,'image/jpeg')).status,200);assert.equal(f.user.favoriteDocuments,undefined);
 }finally{await f.close();}
});


test('the real app routes raw files before JSON parsing and keeps public sharing separate from authenticated writes',async()=>{
 const f=await controlFixture();try{
  const beforeUsers=structuredClone(f.store.state.users),beforeFiles=fs.readdirSync(f.favorites.dir);
  const invalidJSON=await fetch(f.root+'/share',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:'not JSON at all'});assert.equal(invalidJSON.status,415);assert.equal((await invalidJSON.json()).code,'SHARE_FILE_TYPE');
  const publicPhoto=await fetch(f.root+'/share',{method:'POST',headers:{Accept:'application/json','Content-Type':'image/jpeg'},body:jpeg});assert.equal(publicPhoto.status,200);const result=await publicPhoto.json();assert.match(result.openURL,/#shared=/);assert.ok(result.expiresAt>Date.now());assert.deepEqual(f.store.state.users,beforeUsers);assert.deepEqual(fs.readdirSync(f.favorites.dir),beforeFiles);
  const noType=await fetch(f.root+'/share',{method:'POST',headers:{Accept:'application/json'},body:pdf});assert.equal(noType.status,200);assert.ok((await noType.json()).openURL.includes('#shared='));
  const claim=await fetch(f.root+'/api/incoming/claim',{method:'POST',headers:{'Content-Type':'application/json',origin:'http://127.0.0.1'},body:JSON.stringify({accountId:'anonymous',token:result.token})});assert.equal(claim.status,401);assert.equal(f.calls.mail.length,0);
 }finally{f.server.closeAllConnections();await f.close();}
});

test('chunked files cannot bypass the size limit and malformed multipart does not block direct sharing',async()=>{
 const f=await fixture();try{
  const tooLarge=await new Promise((resolve,reject)=>{const req=http.request(f.root+'/share',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/octet-stream',Connection:'close'}},res=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString())}));res.on('error',reject);});req.setTimeout(10000,()=>req.destroy(new Error('chunked raw fixture timeout')));req.on('error',reject);const chunk=Buffer.alloc(1024*1024,0x71);for(let i=0;i<31;i++)req.write(chunk);req.end();});
  assert.equal(tooLarge.status,413);assert.equal(tooLarge.body.code,'SHARE_FILE_TOO_LARGE');assert.equal(f.service.drafts.size,0);
  const broken=await f.raw(Buffer.from('--incomplete'),'multipart/form-data; boundary=incomplete');assert.equal(broken.status,400);assert.equal(broken.body.code,'SHARE_MULTIPART_INVALID');assert.match(broken.body.error,/Fichier.*Entrée du raccourci/);
  assert.equal((await f.raw(jpeg,'image/jpeg')).status,200);assert.equal(f.service.drafts.size,1);assert.equal(f.user.favoriteDocuments,undefined);
 }finally{await f.close();}
});
