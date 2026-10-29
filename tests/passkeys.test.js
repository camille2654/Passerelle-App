import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Store,digest,passwordHash} from '../src/store.js';
import {installPasskeyRoutes} from '../src/passkeys.js';

const password='temporary-passkey-test-password',id=Buffer.from('fixture-credential-id').toString('base64url');
const fakeKey=Uint8Array.from(Buffer.from('fixture-cose-public-key'));
async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-passkeys-')),store=new Store(dir),calls={registration:[],authentication:[],login:[]};let now=Date.now(),counter=1,registrationGate=null,authenticationGate=null;
  for(const name of ['a','b'])store.state.users.push({id:name,name:'Fixture '+name,password:passwordHash(password),admin:name==='a'});
  for(const session of ['a','a2','b'])store.state.sessions.push({hash:digest(session),userId:session==='a2'?'a':session,expires:Date.now()+3600000});store.save();
  const app=express(),router=express.Router();app.use(express.json({limit:'128kb'}));app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='POST'&&req.get('origin')!=='http://localhost')return res.status(403).json({error:'origin'});req.session=store.state.sessions.find(value=>value.hash===digest(req.get('x-session')||'')&&value.expires>Date.now());req.user=req.session?store.user(req.session.userId):null;next();});
  const auth=(req,res,next)=>req.user?next():res.status(401).json({error:'auth'});
  const webauthn={
    generateRegistrationOptions:async options=>{calls.registration.push(options);return {challenge:'register-'+calls.registration.length,user:{id:Buffer.from(options.userID).toString('base64url')},rp:{id:options.rpID},authenticatorSelection:options.authenticatorSelection};},
    verifyRegistrationResponse:async options=>{calls.registrationVerify=options;if(registrationGate)await registrationGate;if(options.response?.fail)throw new Error('untrusted authenticator detail');return {verified:true,registrationInfo:{credential:{id,publicKey:fakeKey,counter:0,transports:['internal']},credentialDeviceType:'multiDevice',credentialBackedUp:true}};},
    generateAuthenticationOptions:async options=>{calls.authentication.push(options);return {challenge:'authenticate-'+calls.authentication.length,rpId:options.rpID,userVerification:options.userVerification};},
    verifyAuthenticationResponse:async options=>{calls.authenticationVerify=options;if(authenticationGate)await authenticationGate;if(options.response?.fail)throw new Error('private authenticator data');return {verified:true,authenticationInfo:{newCounter:counter}};}
  };
  const service=installPasskeyRoutes(router,{store,auth,rateLimit:()=>{},baseURL:'http://localhost/agenda',clock:()=>now,webauthn,login:(res,user)=>{calls.login.push(user.id);res.cookie('agenda_session','new-session',{httpOnly:true});}});app.use('/agenda',router);app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.status?error.message:'Operation failed'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port+'/agenda/api/passkeys';
  return {store,service,calls,setNow:value=>{now=value;},now:()=>now,setCounter:value=>{counter=value;},gateRegistration:value=>{registrationGate=value;},gateAuthentication:value=>{authenticationGate=value;},async request(route='',body,who='a',{cookie='',origin='http://localhost'}={}){const response=await fetch(root+(route?'/'+route:''),{headers:{origin,'x-session':who,cookie,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{method:'POST',body:JSON.stringify(body)})});return {status:response.status,body:await response.json(),cookies:response.headers.getSetCookie(),headers:response.headers};},async register(who='a'){const options=await this.request('register/options',{accountId:who,password,label:'Mon téléphone'},who);assert.equal(options.status,200);const verified=await this.request('register/verify',{accountId:who,response:{id}},who);return verified;},async begin(){const result=await this.request('authenticate/options',{},'');assert.equal(result.status,200);return result.cookies.find(value=>value.startsWith('passerelle_passkey_challenge=')).split(';')[0];},response(user='a'){return {id,response:{userHandle:store.open(store.user(user).passkeyUserID)}};},async close(){service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}};
}

test('passkey setup requires the account password, session, same origin and strict input',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('',undefined,'')).status,401);assert.equal((await f.request('register/options',{accountId:'a',password},'a',{origin:'https://outside.invalid'})).status,403);
  assert.equal((await f.request('register/options',{accountId:'b',password})).status,409);assert.equal((await f.request('register/options',{accountId:'a',password:'bad'})).status,401);
  assert.equal((await f.request('register/options',{accountId:'a',password,label:{unexpected:true}})).status,400);assert.equal((await f.request('register/options',{accountId:'a',password,admin:true})).status,400);
  const result=await f.request('register/options',{accountId:'a',password,label:'Téléphone'});assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal(f.calls.registration[0].rpID,'localhost');assert.equal(f.calls.registration[0].authenticatorSelection.userVerification,'required');assert.equal(f.calls.registration[0].authenticatorSelection.residentKey,'required');assert.equal(f.calls.registration[0].attestationType,'none');assert.ok(!Buffer.from(f.calls.registration[0].userID).toString().includes('Fixture'));
 }finally{await f.close();}
});

test('registration challenges are single-use, expire and cannot transfer to another session',async()=>{
 const f=await fixture();try{
  await f.request('register/options',{accountId:'a',password});assert.equal((await f.request('register/verify',{accountId:'a',response:{id}},'a2')).status,401);
  assert.equal((await f.request('register/verify',{accountId:'a',response:{id}})).status,200);assert.equal((await f.request('register/verify',{accountId:'a',response:{id}})).status,401);
  await f.request('register/options',{accountId:'b',password},'b');f.setNow(f.now()+5*60000+1);assert.equal((await f.request('register/verify',{accountId:'b',response:{id}},'b')).status,401);
 }finally{await f.close();}
});

test('keys are encrypted, public metadata omits credentials, and one credential cannot belong to two accounts',async()=>{
 const f=await fixture();try{
  const result=await f.register();assert.equal(result.status,200);assert.equal(result.body.items.length,1);assert.ok(!JSON.stringify(result.body).includes(id));assert.ok(!JSON.stringify(result.body).includes('publicKey'));
  const disk=fs.readFileSync(f.store.file,'utf8');assert.ok(!disk.includes(id));assert.ok(!disk.includes(Buffer.from(fakeKey).toString('base64url')));
  const duplicate=await f.register('b');assert.equal(duplicate.status,409);assert.equal(f.store.user('b').passkeys,undefined);
  assert.equal(f.calls.registrationVerify.expectedOrigin,'http://localhost');assert.equal(f.calls.registrationVerify.expectedRPID,'localhost');assert.equal(f.calls.registrationVerify.requireUserVerification,true);
 }finally{await f.close();}
});

test('logout during authenticator verification cannot attach a new key',async()=>{
 const f=await fixture();let release;try{
  await f.request('register/options',{accountId:'a',password});f.gateRegistration(new Promise(resolve=>{release=resolve;}));const pending=f.request('register/verify',{accountId:'a',response:{id}});while(!f.calls.registrationVerify)await new Promise(resolve=>setTimeout(resolve,5));f.store.state.sessions=f.store.state.sessions.filter(value=>value.userId!=='a');release();assert.equal((await pending).status,401);assert.equal(f.store.user('a').passkeys,undefined);
 }finally{release?.();await f.close();}
});

test('anonymous options disclose no account and bind a short-lived HttpOnly challenge cookie',async()=>{
 const f=await fixture();try{
  const result=await f.request('authenticate/options',{},'');assert.equal(result.status,200);assert.deepEqual(Object.keys(result.body),['options']);assert.equal(result.body.options.userVerification,'required');assert.ok(!JSON.stringify(result.body).includes('Fixture'));
  assert.match(result.cookies[0],/HttpOnly/);assert.match(result.cookies[0],/SameSite=Lax/);assert.match(result.cookies[0],/Path=\/agenda\//);assert.equal((await f.request('authenticate/options',{login:'a'},'')).status,400);assert.equal((await f.request('authenticate/options',{})).status,409);
  await f.register();const cookie=result.cookies[0].split(';')[0];f.setNow(f.now()+5*60000+1);assert.equal((await f.request('authenticate/verify',{response:f.response()},'',{cookie})).status,401);assert.deepEqual(f.calls.login,[]);
 }finally{await f.close();}
});

test('authentication validates the owner handle, origin, UV and signature counter before login',async()=>{
 const f=await fixture();try{
  await f.register();const cookie=await f.begin();const denied=await f.request('authenticate/verify',{response:{id,response:{userHandle:'wrong'}}},'',{cookie});assert.equal(denied.status,401);assert.deepEqual(f.calls.login,[]);
  const valid=await f.begin();assert.equal((await f.request('authenticate/verify',{response:f.response()},'',{cookie:valid})).status,200);assert.deepEqual(f.calls.login,['a']);assert.equal(f.calls.authenticationVerify.expectedOrigin,'http://localhost');assert.equal(f.calls.authenticationVerify.requireUserVerification,true);assert.equal(f.store.open(f.store.user('a').passkeys[0].sealed).counter,1);
  assert.equal((await f.request('authenticate/verify',{response:f.response()},'',{cookie:valid})).status,401);const cloned=await f.begin();assert.equal((await f.request('authenticate/verify',{response:f.response()},'',{cookie:cloned})).status,401);assert.deepEqual(f.calls.login,['a']);
 }finally{await f.close();}
});

test('revoked or suspended accounts cannot finish authentication; last key removal keeps the password',async()=>{
 const f=await fixture();try{
  await f.register();const key=f.store.user('a').passkeys[0],passwordHash=f.store.user('a').password,cookie=await f.begin();f.store.user('a').suspendedAt=f.now();assert.equal((await f.request('authenticate/verify',{response:f.response()},'',{cookie})).status,401);delete f.store.user('a').suspendedAt;
  assert.equal((await f.request(key.id+'/remove',{accountId:'b',password},'b')).status,404);assert.equal((await f.request(key.id+'/remove',{accountId:'a',password:'bad'})).status,401);
  assert.equal((await f.request(key.id+'/remove',{accountId:'a',password})).status,200);assert.equal(f.store.user('a').passkeys.length,0);assert.equal(f.store.user('a').password,passwordHash);
  const removed=await f.begin();assert.equal((await f.request('authenticate/verify',{response:f.response()},'',{cookie:removed})).status,401);assert.deepEqual(f.calls.login,[]);
 }finally{await f.close();}
});
