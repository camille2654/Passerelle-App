import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {CURRENT_RELEASE,publicRelease} from '../src/releases.js';
import {createApp} from '../src/server.js';
import {controlFixture} from './control-fixture.js';

async function stop(context,server=context.server){
 for(const name of ['control','push','passkeys','cloud','incoming','personalCalendars','travel','personalMail','eventSuggestions'])context[name].close();
 await context.browsers.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
}

test('release metadata is curated, copied and scoped to the signed-in account without implicit acknowledgement',async()=>{
 assert.equal(publicRelease(null),null);
 const first=publicRelease({}),second=publicRelease({});
 assert.equal(first.pending,true);assert.equal(first.id,'2026-11-trajets');assert.equal(first.version,'4.17.0');assert.equal(first.banner,'./brand/campaign/banner-app.webp');
 assert.equal(first.features.length,3);first.features[0].title='Mutated copy';assert.notEqual(second.features[0].title,first.features[0].title);assert.notEqual(CURRENT_RELEASE.features[0].title,first.features[0].title);
 const f=await controlFixture({releasePending:true});try{
  const anonymous=await f.request('status',undefined,'anonymous');assert.equal(anonymous.status,200);assert.equal(anonymous.body.user,null);assert.equal(anonymous.body.release,undefined);
  f.store.user('owner').seenRelease='older-major-release';f.store.user('nina').seenRelease=CURRENT_RELEASE.id;f.store.save();
  const owner=await f.request('status',undefined,'owner'),nina=await f.request('status',undefined,'nina');
  assert.equal(owner.body.user.release.pending,true);assert.equal(nina.body.user.release.pending,false);assert.equal(f.store.user('owner').seenRelease,'older-major-release');assert.equal(f.store.user('camille').seenRelease,undefined);
  assert.equal(owner.body.user.seenRelease,undefined);assert.equal(owner.body.user.seenReleaseAt,undefined);assert.equal(f.calls.mail.length,0);assert.equal(f.calls.ent.length,0);
 }finally{f.server.closeAllConnections();await f.close();}
});

test('release acknowledgement requires authentication, origin and strict current ID; writes only its account and is idempotent',async()=>{
 const f=await controlFixture({releasePending:true});try{
  const good={releaseId:CURRENT_RELEASE.id};
  assert.equal((await f.request('releases/seen',good,'anonymous')).status,401);
  assert.equal((await f.request('releases/seen',good,'owner','https://other.invalid')).status,403);
  for(const body of [{},{releaseId:'2099-future'},{releaseId:CURRENT_RELEASE.version},{releaseId:3},[],null,{...good,accountId:'nina'},{...good,pending:false}]){
   assert.equal((await f.request('releases/seen',body)).status,400);
  }
  assert.equal(f.store.user('owner').seenRelease,undefined);assert.equal(f.store.user('nina').seenRelease,undefined);
  const before={feed:f.store.user('owner').feedKey,student:f.store.user('owner').studentId,onboarding:f.store.user('owner').onboarding};
  const saved=await f.request('releases/seen',good);assert.equal(saved.status,200);assert.equal(saved.body.release.pending,false);assert.equal(saved.body.release.id,CURRENT_RELEASE.id);
  assert.equal(f.store.user('owner').seenRelease,CURRENT_RELEASE.id);const at=f.store.user('owner').seenReleaseAt;assert.equal(at,f.now());
  assert.equal(f.store.user('nina').seenRelease,undefined);assert.equal((await f.request('status',undefined,'nina')).body.user.release.pending,true);
  assert.deepEqual({feed:f.store.user('owner').feedKey,student:f.store.user('owner').studentId,onboarding:f.store.user('owner').onboarding},before);
  f.setNow(f.now()+60000);assert.equal((await f.request('releases/seen',good)).status,200);assert.equal(f.store.user('owner').seenReleaseAt,at);
  assert.equal(f.calls.mail.length,0);assert.equal(f.calls.ent.length,0);
 }finally{f.server.closeAllConnections();await f.close();}
});

test('acknowledged major release survives a complete app restart while another account still sees it pending',async()=>{
 const f=await controlFixture({releasePending:true});let stopped=false,restarted,server;
 try{
  const saved=await f.request('releases/seen',{releaseId:CURRENT_RELEASE.id},'camille');assert.equal(saved.status,200);
  const at=f.store.user('camille').seenReleaseAt,dir=f.dir,cookie=f.cookies.camille;
  await stop(f);stopped=true;
  restarted=createApp({dataDir:dir,baseURL:'http://127.0.0.1/agenda',bootstrap:false});server=restarted.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const root='http://127.0.0.1:'+server.address().port+'/agenda';
  const own=await fetch(root+'/api/status',{headers:{Cookie:cookie}});assert.equal(own.status,200);assert.equal((await own.json()).user.release.pending,false);
  const other=await fetch(root+'/api/status',{headers:{Cookie:f.cookies.nina}});assert.equal((await other.json()).user.release.pending,true);
  assert.equal(restarted.store.user('camille').seenReleaseAt,at);assert.equal(restarted.store.user('nina').seenRelease,undefined);
 }finally{if(restarted)await stop(restarted,server);else if(!stopped)await stop(f);fs.rmSync(f.dir,{recursive:true,force:true});}
});
