import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Skolengo} from 'scolengo-api';
import {Store} from '../src/store.js';
import {withSkolengo,LoginBrowsers,DISCOVERY} from '../src/skolengo.js';

function fixture(expiresAt){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-source-token-')),store=new Store(dir);const user={id:'synthetic-owner',studentId:'synthetic-pupil',skolengoConnectionId:'synthetic-connection',skolengo:store.seal({school:{id:'synthetic-school'},tokenSet:{access_token:'synthetic-old-access',refresh_token:'synthetic-old-refresh',expires_at:expiresAt}})};store.state.users.push(user);store.save();return {dir,store,user,close:()=>fs.rmSync(dir,{recursive:true,force:true})};}

test('an expiring source token is renewed once under the source lock and its rotated refresh token is encrypted',async()=>{
 const f=fixture(Math.floor(Date.now()/1000)+30),original=Skolengo.fromConfigObject;let renewals=0;const refreshes=[],calls=[];
 try{
  Skolengo.fromConfigObject=async(config,{onTokenRefresh})=>{
   const tokenSet={...config.tokenSet};return {tokenSet,refreshToken:async()=>{renewals++;refreshes.push(tokenSet.refresh_token);await new Promise(resolve=>setTimeout(resolve,20));Object.assign(tokenSet,{access_token:'synthetic-new-access',refresh_token:'synthetic-new-refresh',expires_at:Math.floor(Date.now()/1000)+3600});onTokenRefresh(tokenSet);return tokenSet;}};
  };
  await Promise.all([withSkolengo(f.store,f.user,async client=>calls.push(client.tokenSet.access_token)),withSkolengo(f.store,f.user,async client=>calls.push(client.tokenSet.access_token))]);
  assert.equal(renewals,1);assert.deepEqual(refreshes,['synthetic-old-refresh']);assert.deepEqual(calls,['synthetic-new-access','synthetic-new-access']);
  const saved=f.store.open(f.user.skolengo).tokenSet;assert.equal(saved.refresh_token,'synthetic-new-refresh');assert.ok(saved.expires_at>Date.now()/1000+3000);
  const disk=fs.readFileSync(f.store.file,'utf8');for(const secret of ['synthetic-old-access','synthetic-old-refresh','synthetic-new-access','synthetic-new-refresh'])assert.ok(!disk.includes(secret));
 }finally{Skolengo.fromConfigObject=original;f.close();}
});

test('a valid token or unknown expiry does not trigger an unrelated renewal timer',async()=>{
 const original=Skolengo.fromConfigObject;let renewals=0;
 try{
  Skolengo.fromConfigObject=async()=>({refreshToken:async()=>{renewals++;}});
  for(const expiry of [Math.floor(Date.now()/1000)+3600,undefined]){const f=fixture(expiry);try{await withSkolengo(f.store,f.user,async()=>{});}finally{f.close();}}
  assert.equal(renewals,0);
 }finally{Skolengo.fromConfigObject=original;}
});

test('a token renewal from an obsolete source cannot overwrite its replacement or publish old data',async()=>{
 const f=fixture(Math.floor(Date.now()/1000)-10),original=Skolengo.fromConfigObject;let release,started;
 const entered=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 try{
  Skolengo.fromConfigObject=async(_config,{onTokenRefresh})=>({refreshToken:async()=>{started();await gate;onTokenRefresh({access_token:'synthetic-stale-access',refresh_token:'synthetic-stale-refresh',expires_at:Math.floor(Date.now()/1000)+3600});}});
  const task=withSkolengo(f.store,f.user,async()=>{});await entered;
  const replacement=f.store.seal({school:{id:'replacement'},tokenSet:{refresh_token:'synthetic-replacement-refresh'}});
  f.store.update(f.user.id,{skolengoConnectionId:'new-connection',skolengo:replacement});release();
  await assert.rejects(task,/SOURCE_CHANGED/);assert.equal(f.user.skolengo,replacement);assert.equal(f.store.open(f.user.skolengo).tokenSet.refresh_token,'synthetic-replacement-refresh');
 }finally{Skolengo.fromConfigObject=original;f.close();}
});

test('provider invalid_grant is propagated to the synchronization error policy without persisting or returning tokens',async()=>{
 const f=fixture(Math.floor(Date.now()/1000)+10),original=Skolengo.fromConfigObject;
 try{
  Skolengo.fromConfigObject=async()=>({refreshToken:async()=>{throw Object.assign(new Error('provider refresh denied'),{error:'invalid_grant'});}});
  await assert.rejects(withSkolengo(f.store,f.user,async()=>assert.fail('No operation after a failed renewal')),error=>error.error==='invalid_grant');
  assert.equal(f.store.open(f.user.skolengo).tokenSet.refresh_token,'synthetic-old-refresh');
 }finally{Skolengo.fromConfigObject=original;f.close();}
});

test('managed login success and failure release browser capacity while portal login preserves its terminal status',async()=>{
 const originalClient=Skolengo.getOIDClient,originalInfo=Skolengo.prototype.getUserInfo;let authenticationFails=false;
 try{
  Skolengo.getOIDClient=async()=>({authorizationUrl:()=> 'https://sso.ent.auvergnerhonealpes.fr/authorize',callbackParams:()=>({code:'synthetic-code'}),callback:async()=>({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_at:Math.floor(Date.now()/1000)+3600})});
  Skolengo.prototype.getUserInfo=async()=>{if(authenticationFails)throw new Error('synthetic-sensitive-provider-error');return {students:[{id:'synthetic-pupil',firstName:'Élève',lastName:'Synthétique',className:'Test'}]};};
  for(const failed of [false,true])for(const releaseOnConnected of [true,false]){
   authenticationFails=failed;
   const f=fixture(Math.floor(Date.now()/1000)+3600),browsers=new LoginBrowsers(f.store);let closes=0,done;
   const completed=new Promise(resolve=>{done=resolve;});
   const listeners=new Map(),page={setDefaultTimeout(){},on(name,listener){listeners.set(name,listener);},async goto(){listeners.get('response')({headerValue:async()=> 'skoapp-prod://sign-in-callback?code=synthetic-code'});},url:()=> 'https://sso.ent.auvergnerhonealpes.fr/authorize'};
   const context={newPage:async()=>page,route:async()=>{},on(){},close:async()=>{},newCDPSession:async()=>({send:async()=>{},on(){}})};
   browsers.getBrowser=async()=>{browsers.browser={isConnected:()=>true,close:async()=>{closes++;}};return {newContext:async()=>context};};
   try{
    await browsers.start(f.user,{id:'synthetic-school',name:'Lycée de test',emsCode:'rra',emsOIDCWellKnownUrl:DISCOVERY},{store:f.store,releaseOnConnected,onConnected:async()=>{assert.equal(failed,false);done();},onError:async()=>{assert.equal(failed,true);done();}});
    await completed;await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
    assert.equal(f.store.user(f.user.id).studentId,'synthetic-pupil');
    if(releaseOnConnected){assert.equal(browsers.items.size,0);assert.equal(closes,1);assert.equal(browsers.status(f.user.id).status,'closed');}
    else{assert.equal(browsers.items.size,1);assert.equal(browsers.status(f.user.id).status,failed?'error':'connected');assert.ok(!JSON.stringify(browsers.status(f.user.id)).includes('synthetic-sensitive-provider-error'));assert.equal(closes,0);}
   }finally{await browsers.close();f.close();}
  }
 }finally{Skolengo.getOIDClient=originalClient;Skolengo.prototype.getUserInfo=originalInfo;}
});
