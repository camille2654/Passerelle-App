import test from 'node:test';
import assert from 'node:assert/strict';
import {controlFixture} from './control-fixture.js';
import {fixturePDF,fixturePNG} from './document-fixtures.js';
import {documentPreviewType} from '../src/document-preview.js';

test('preview detects actual bytes and accepts only PDF and raster image formats',()=>{
 assert.equal(documentPreviewType(fixturePDF()),'application/pdf');assert.equal(documentPreviewType(fixturePNG),'image/png');assert.equal(documentPreviewType(Buffer.from([255,216,255,224])),'image/jpeg');assert.equal(documentPreviewType(Buffer.from('RIFF1234WEBP')),'image/webp');
 for(const bytes of [Buffer.from('<svg onload=alert(1)>'),Buffer.from('<html>not a PDF</html>'),Buffer.from('ordinary text'),Buffer.alloc(0),null])assert.equal(documentPreviewType(bytes),null);
});
test('preview retains file ownership, pupil scope, authenticated headers and private response headers',async()=>{
 const f=await controlFixture();try{
  const u=f.store.user('camille'),bytes=fixturePDF(),saved=f.favorites.save(u,bytes,'Document.pdf','Personnel').item;
  const get=async(who='camille',headers={})=>{const response=await fetch(f.root+'/api/favorites/'+saved.id+'/preview',{headers:{cookie:f.cookies[who]||'','x-passerelle-account':who,'x-passerelle-student':encodeURIComponent(f.store.user(who)?.studentId||''),...headers}});return {response,bytes:Buffer.from(await response.arrayBuffer())};};
  assert.equal((await get('anonymous')).response.status,401);assert.equal((await get('nina')).response.status,404);assert.equal((await get('camille',{'x-passerelle-account':'nina'})).response.status,409);assert.equal((await get('camille',{'x-passerelle-student':'other'})).response.status,409);
  const good=await get();assert.equal(good.response.status,200);assert.equal(good.response.headers.get('cache-control'),'no-store');assert.equal(good.response.headers.get('content-type'),'application/pdf');assert.equal(good.response.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(good.bytes,bytes);
  const previous=u.studentId;u.studentId='another-student';assert.equal((await get()).response.status,404);u.studentId=previous;
  const html=f.favorites.save(u,Buffer.from('<script>private</script>'),'Misleading.pdf','Personnel').item;
  const denied=await fetch(f.root+'/api/favorites/'+html.id+'/preview',{headers:{cookie:f.cookies.camille,'x-passerelle-account':'camille','x-passerelle-student':u.studentId}});assert.equal(denied.status,415);assert.ok(!(await denied.text()).includes('<script>'));
 }finally{await f.close();}
});
test('linked copies use the same preview and links are never followed for preview',async()=>{
 const f=await controlFixture();try{
  const u=f.store.user('camille'),saved=f.favorites.save(u,fixturePNG,'Photo.png','Personnel').item;
  const added=await f.request('work-resources/add',{accountId:u.id,workId:null,favoriteId:saved.id,title:'Photo'},u.id);assert.equal(added.status,200);
  const request=async(id,who='camille')=>fetch(f.root+'/api/work-resources/'+id+'/preview',{redirect:'manual',headers:{cookie:f.cookies[who],'x-passerelle-account':who,'x-passerelle-student':f.store.user(who).studentId}});
  const response=await request(added.body.item.id);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.deepEqual(Buffer.from(await response.arrayBuffer()),fixturePNG);assert.equal((await request(added.body.item.id,'nina')).status,404);
  const linked=await f.request('work-resources/add',{accountId:u.id,workId:null,url:'https://drive.google.com/file/d/example/view',title:'Link'},u.id);assert.equal(linked.status,200);const unsupported=await request(linked.body.item.id);assert.equal(unsupported.status,415);assert.equal(unsupported.headers.get('location'),null);
 }finally{await f.close();}
});
