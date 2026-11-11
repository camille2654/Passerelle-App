import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {controlFixture} from './control-fixture.js';

const issuer='https://repere.84.235.226.127.sslip.io/agenda',partner='https://mon-ent.pages.dev';
const sdk=await import('../public/integrations/lapsus/passerelle-connect.js');
async function sandbox(){
  const f=await controlFixture({baseURL:issuer}),nativeFetch=globalThis.fetch;
  const previous=Object.fromEntries(['location','history','sessionStorage'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
  const storage=new Map();let current=new URL(partner+'/'),assigned=null,calls=0;
  const location={get origin(){return current.origin;},get pathname(){return current.pathname;},get search(){return current.search;},assign(value){assigned=value;}};
  Object.defineProperty(globalThis,'location',{configurable:true,value:location});
  Object.defineProperty(globalThis,'history',{configurable:true,value:{replaceState(_data,_unused,value){current=new URL(value,current);}}});
  Object.defineProperty(globalThis,'sessionStorage',{configurable:true,value:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)}});
  globalThis.fetch=async(url,options={})=>{calls++;const address=new URL(url);assert.ok(address.href.startsWith(issuer+'/'));return nativeFetch(f.root+address.pathname.slice('/agenda'.length)+address.search,{...options,headers:{...options.headers,Origin:partner}});};
  async function network(path,options={}){return nativeFetch(f.root+path,{redirect:'manual',...options});}
  async function approve(){
    const authorization=new URL(assigned);const started=await network(authorization.pathname.slice('/agenda'.length)+authorization.search,{headers:{Cookie:f.cookies.camille}});assert.equal(started.status,302);
    const request=new URL(started.headers.get('location')).searchParams.get('request');const cookie=started.headers.getSetCookie().map(value=>value.split(';')[0]).find(value=>value.startsWith('passerelle_oauth='));
    const response=await network('/api/oauth/consent',{method:'POST',headers:{Cookie:f.cookies.camille+'; '+cookie,Origin:new URL(issuer).origin,'Content-Type':'application/json'},body:JSON.stringify({request,accountId:'camille',allow:true,scopes:['calendar:courses']})});assert.equal(response.status,200);
    current=new URL((await response.json()).redirectURL);
  }
  async function close(){globalThis.fetch=nativeFetch;for(const [name,descriptor]of Object.entries(previous)){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}f.server.closeAllConnections();await f.close();}
  return {f,storage,approve,close,get assigned(){return assigned;},get current(){return current;},set current(value){current=new URL(value);},get calls(){return calls;}};
}

test('Lapsus helper completes real PKCE exchange and reads only the selected revocable calendar without storing links',async()=>{
 const s=await sandbox();try{
  await sdk.connectPasserelle(['calendar:courses','calendar:homework'],{accountKey:'lapsus-account-a'});
  const start=new URL(s.assigned);assert.equal(start.origin,new URL(issuer).origin);assert.equal(start.searchParams.get('client_id'),'lapsus');assert.equal(start.searchParams.get('code_challenge_method'),'S256');assert.equal(start.searchParams.get('redirect_uri'),partner+'/passerelle/callback');
  await s.approve();const calendars=await sdk.finishPasserelleConnection({getAccountKey:async()=>{assert.equal(s.current.search,'');return 'lapsus-account-a';}});assert.equal(calendars.length,1);assert.equal(calendars[0].id,'courses');assert.equal(s.storage.size,0);assert.equal(s.current.search,'');assert.equal(s.calls,2);
  const first=await sdk.readPasserelleCalendar(calendars[0]);assert.equal(first.unchanged,false);assert.match(first.ics,/BEGIN:VCALENDAR/);assert.ok(first.etag);
  assert.equal((await sdk.readPasserelleCalendar(calendars[0],{etag:first.etag})).unchanged,true);
  const grant=s.f.store.user('camille').partnerGrants[0];s.f.partners.revoke(s.f.store.user('camille'),grant.id);
  await assert.rejects(sdk.readPasserelleCalendar(calendars[0]),error=>error.code==='PASSERELLE_DISCONNECTED');
  assert.equal(s.f.calls.ent.length,0);assert.equal(s.f.calls.mail.length,0);
 }finally{await s.close();}
});

test('Lapsus helper rejects a changed local account, missing state or an expired transaction before contacting token API',async()=>{
 const s=await sandbox();try{
  await assert.rejects(sdk.connectPasserelle(['calendar:courses']),/compte Lapsus/);
  await sdk.connectPasserelle(['calendar:courses'],{accountKey:'lapsus-account-a'});await s.approve();
  await assert.rejects(sdk.finishPasserelleConnection({accountKey:'lapsus-account-b'}),/compte Lapsus a changé/);assert.equal(s.calls,0);assert.equal(s.storage.size,0);assert.equal(s.current.search,'');
  s.current=partner+'/';await sdk.connectPasserelle(['calendar:courses'],{accountKey:'lapsus-account-a'});await s.approve();
  const invalid=s.current;invalid.searchParams.set('state','wrong-state');s.current=invalid.href;
  await assert.rejects(sdk.finishPasserelleConnection({accountKey:'lapsus-account-a'}),/expiré/);assert.equal(s.calls,0);assert.equal(s.current.search,'');
  s.current=partner+'/';await sdk.connectPasserelle(['calendar:courses'],{accountKey:'lapsus-account-a'});await s.approve();
  for(const [key,raw]of s.storage){const value=JSON.parse(raw);value.at=Date.now()-11*60000;s.storage.set(key,JSON.stringify(value));}
  await assert.rejects(sdk.finishPasserelleConnection({accountKey:'lapsus-account-a'}),/expiré/);assert.equal(s.calls,0);assert.equal(s.storage.size,0);
 }finally{await s.close();}
});

test('Lapsus helper refuses foreign calendar URLs and explicit scope widening without performing any request',async()=>{
 const s=await sandbox();try{
  for(const url of ['https://outside.invalid/calendar.ics',issuer+'/calendars/'+'a'.repeat(43)+'.ics',issuer+'/partner-calendars/'+'a'.repeat(43)+'.ics?type=all','https://user:pass@repere.84.235.226.127.sslip.io/agenda/partner-calendars/'+'a'.repeat(43)+'.ics'])await assert.rejects(sdk.readPasserelleCalendar({url}),/invalide/);
  assert.equal(s.calls,0);
  await assert.rejects(sdk.connectPasserelle(['calendar:write'],{accountKey:'account-a'}),/agendas/);
  s.current='https://outside.invalid/';await assert.rejects(sdk.connectPasserelle(['calendar:courses'],{accountKey:'account-a'}),/réservée/);assert.equal(s.storage.size,0);
 }finally{await s.close();}
});
