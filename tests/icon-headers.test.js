import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {controlFixture} from './control-fixture.js';

test('installation icons are public and persistable while personal documents, status, errors and APIs stay private',async()=>{
 const f=await controlFixture();try{
  const html=await fetch(f.root+'/');assert.equal(html.headers.get('cache-control'),'no-store');const document=await html.text();const data=document.match(/rel="apple-touch-icon"[^>]*href="data:image\/png;base64,([^"]+)"/);assert.ok(data);assert.deepEqual(Buffer.from(data[1],'base64'),fs.readFileSync(new URL('../public/icons/apple-180.png',import.meta.url)));
  for(const file of ['apple-touch-icon.png','icons/apple-180.png','icons/app-192.png','icons/app-512.png','icons/favicon-64.png']){const response=await fetch(f.root+'/'+file+'?version=1',{method:'HEAD'});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'public, max-age=86400');assert.equal(response.headers.get('cross-origin-resource-policy'),'cross-origin');assert.equal(response.headers.get('access-control-allow-origin'),'*');}
  const user=f.store.user('camille'),saved=f.favorites.save(user,Buffer.from('private-test-document'),'Document privé.pdf','Personnel');
  for(const [path,cookie]of [['api/status'],['api/push'],['api/favorites'],['api/capture'],['icons/missing.png'],['api/favorites/'+saved.item.id+'/download?name=apple-touch-icon.png',f.cookies.camille]]){const response=await fetch(f.root+'/'+path,{headers:cookie?{cookie}:{}});assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('cross-origin-resource-policy'),'same-origin');assert.equal(response.headers.get('access-control-allow-origin'),null);if(cookie){assert.equal(response.status,200);assert.equal(await response.text(),'private-test-document');}}
 }finally{await f.close();}
});

test('HTTPS keeps upgrade-insecure-requests while local HTTP previews can load in WebKit, and both allow the embedded PNG',async()=>{
 for(const baseURL of ['http://127.0.0.1/agenda','https://configured.example/agenda']){const f=await controlFixture({baseURL});try{const response=await fetch(f.root+'/');const policy=response.headers.get('content-security-policy');assert.equal(policy.includes('upgrade-insecure-requests'),baseURL.startsWith('https:'));assert.ok(policy.includes("img-src 'self' blob: data:"));assert.equal(response.headers.get('cache-control'),'no-store');}finally{await f.close();}}
});
