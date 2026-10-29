import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {controlFixture} from './control-fixture.js';
import {imageInfo} from '../src/capture.js';
import {MAX_DOCUMENT_BYTES,MAX_FAVORITE_BYTES} from '../src/upload-limits.js';
import {digest} from '../src/store.js';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=','base64');
async function raw(f,route,bytes,who='camille',extra={}){const response=await fetch(f.root+'/api/'+route,{method:'POST',headers:{cookie:f.cookies[who]||'',origin:'http://127.0.0.1','Content-Type':route==='capture'?'image/png':'application/octet-stream','x-passerelle-account':who,...extra},body:bytes});return {status:response.status,body:await response.json()};}

test('image metadata is checked before OCR, including format, dimensions and payload limits',()=>{
 assert.equal(imageInfo(image).width,1);assert.throws(()=>imageInfo(Buffer.from('<svg width="100" height="100"></svg>')));assert.throws(()=>imageInfo(Buffer.alloc(8*1024*1024+1)));
 const huge=Buffer.from(image);huge.writeUInt32BE(7000,16);assert.throws(()=>imageInfo(huge));
});
test('photo reading requires the matching account, returns an editable draft, saves no homework and logs no recognized text',async()=>{
 const f=await controlFixture({captureOptions:{recognize:async()=>({text:'Exercices de maths\nTerminer le chapitre privé.',truncated:false})}});try{
  assert.equal((await raw(f,'capture',image,'anonymous')).status,401);assert.equal((await raw(f,'capture',image,'camille',{'x-passerelle-account':'nina'})).status,409);
  const result=await raw(f,'capture',image);assert.equal(result.status,200);assert.equal(result.body.title,'Exercices de maths');assert.ok(result.body.text.includes('chapitre privé'));assert.deepEqual(f.store.user('camille').manualWork,[]);assert.ok(!JSON.stringify(f.audit.query({limit:200})).includes('chapitre privé'));
 }finally{await f.close();}
});
test('a photo response from another student or a logged-out session is discarded and OCR concurrency is bounded',async()=>{
 let release,started;const gate=new Promise(resolve=>{release=resolve;}),began=new Promise(resolve=>{started=resolve;});
 const f=await controlFixture({captureOptions:{recognize:async()=>{started();await gate;return {text:'private recognized text'};}}});try{
  const pending=raw(f,'capture',image);await began;assert.equal((await raw(f,'capture',image,'nina')).status,429);f.store.user('camille').studentId='another-profile';release();assert.equal((await pending).status,409);assert.equal(f.capture.busy,false);
 }finally{release();await f.close();}
});
test('favorites are encrypted private copies, deduplicated per profile and preserved beyond ENT reference expiry',async()=>{
 const f=await controlFixture();try{
  const user=f.store.user('camille'),context=f.school.context(user),ref=f.school.reference(context,'file','file-one',{url:'https://api.skolengo.com/api/v1/files/one',name:'Cours privé.pdf'}),bytes=Buffer.from('An original private course file.');
  f.school.download=async(account,reference)=>{f.school.lookup(account,reference,'file');return {bytes,name:'Cours privé.pdf'};};
  const add=await f.request('favorites/from-ent',{ref,accountId:'camille'},'camille');assert.equal(add.status,200);const item=add.body.item;assert.equal(item.name,'Cours privé.pdf');
  const repeated=await f.request('favorites/from-ent',{ref,accountId:'camille'},'camille');assert.equal(repeated.body.alreadySaved,true);assert.equal(user.favoriteDocuments.length,1);
  const disk=fs.readFileSync(f.favorites.file(user,item.id)),state=fs.readFileSync(f.store.file,'utf8');assert.ok(!disk.includes(bytes));assert.ok(!state.includes('Cours privé.pdf'));assert.equal(fs.statSync(f.favorites.file(user,item.id)).mode&0o777,0o600);
  f.school.contexts.clear();assert.deepEqual(f.favorites.download(user,item.id).bytes,bytes);assert.equal((await f.request('favorites/'+item.id+'/download',undefined,'nina')).status,404);
  const profile=user.studentId;user.studentId='other';assert.equal(f.favorites.list(user).items.length,0);assert.throws(()=>f.favorites.download(user,item.id));user.studentId=profile;assert.equal(f.favorites.list(user).items.length,1);
  const downloaded=await fetch(f.root+'/api/favorites/'+item.id+'/download',{headers:{cookie:f.cookies.camille}});assert.equal(downloaded.status,200);assert.ok(downloaded.headers.get('content-disposition').startsWith('attachment;'));assert.equal(downloaded.headers.get('content-type'),'application/octet-stream');assert.equal(await downloaded.text(),bytes.toString());
  await f.request('favorites/'+item.id+'/remove',{accountId:'camille'},'camille');assert.equal(fs.existsSync(f.favorites.file(user,item.id)),false);assert.equal(f.favorites.list(user).items.length,0);
 }finally{await f.close();}
});
test('uploads enforce origin, account, size and quota boundaries and modified encrypted files cannot be downloaded',async()=>{
 const f=await controlFixture();try{
  assert.equal((await raw(f,'favorites/upload',Buffer.from('private'),'camille',{'x-passerelle-account':'nina'})).status,409);
  const upload=await raw(f,'favorites/upload',Buffer.from('private course contents'),'camille',{'x-file-name':encodeURIComponent('../../Cours\r\nsecret.pdf')});assert.equal(upload.status,200);assert.equal(upload.body.item.name,'Courssecret.pdf');
  const user=f.store.user('camille'),item=upload.body.item,disk=f.favorites.file(user,item.id),encoded=fs.readFileSync(disk);encoded[encoded.length-1]^=1;fs.writeFileSync(disk,encoded);assert.throws(()=>f.favorites.download(user,item.id),/copie/);
  for(let i=0;i<19;i++)f.favorites.save(user,Buffer.from('document-'+i),'cours-'+i+'.pdf','Personnel');assert.throws(()=>f.favorites.save(user,Buffer.from('extra'),'extra.pdf','Personnel'),/pleins/);assert.throws(()=>f.favorites.save(user,Buffer.alloc(MAX_DOCUMENT_BYTES+1),'large.pdf','Personnel'));
 }finally{await f.close();}
});


test('private raw uploads above 10 MiB are accepted and advertise the enlarged file and storage quotas',async()=>{
 const f=await controlFixture();try{
  const bytes=Buffer.alloc(11*1024*1024,0x6d),expected=digest(bytes),uploaded=await raw(f,'favorites/upload',bytes,'camille',{'x-file-name':encodeURIComponent('Grand document privé.pdf')});
  assert.equal(uploaded.status,200);assert.equal(uploaded.body.maxFileBytes,30*1024*1024);assert.equal(uploaded.body.maxFileBytes,MAX_DOCUMENT_BYTES);assert.equal(uploaded.body.maxBytes,150*1024*1024);assert.equal(uploaded.body.maxBytes,MAX_FAVORITE_BYTES);assert.equal(uploaded.body.item.size,bytes.length);
  const file=f.favorites.download(f.store.user('camille'),uploaded.body.item.id);assert.equal(file.name,'Grand document privé.pdf');assert.equal(digest(file.bytes),expected);assert.equal((await f.request('favorites',undefined,'nina')).body.items.length,0);
 }finally{await f.close();}
});
