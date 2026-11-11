import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Skolengo} from 'scolengo-api';
import {ENT_PROVIDERS,publicProvider,portalForURL,allowedEntURL,trustedSchool} from '../src/ent-providers.js';
import {searchSchools,skolengoClient} from '../src/skolengo.js';
import {hasENTCredentials,startEntPronote} from '../src/ent-pronote-browser.js';
import {hubFixture,fixtureNow} from './hub-fixture.js';
import {userWork} from '../src/work.js';
import {isEntPronote} from '../src/ent-profile.js';

const school=p=>({id:'school-'+p.id,name:'Établissement '+p.id,emsCode:p.id,emsOIDCWellKnownUrl:p.discovery});
test('national catalogue accepts exact trusted OIDC pairs across regions and rejects hostile issuers',async()=>{
 assert.equal(ENT_PROVIDERS.length,19);const original=Skolengo.searchSchool;
 try{Skolengo.searchSchool=async()=>[...ENT_PROVIDERS.map(school),{...school(ENT_PROVIDERS[0]),emsOIDCWellKnownUrl:'https://127.0.0.1/private'},{...school(ENT_PROVIDERS[0]),emsCode:'unknown'}];
  const all=await searchSchools('Lycée');assert.equal(all.length,19);assert.ok(all.some(s=>publicProvider(s).region==='Grand Est'));assert.equal((await searchSchools('Lycée','entmip')).length,1);assert.equal(trustedSchool({emsCode:'rra',emsOIDCWellKnownUrl:ENT_PROVIDERS[1].discovery}),null);
 }finally{Skolengo.searchSchool=original;}
});
test('portal routes admit catalogue families and academic login hosts, never arbitrary hosts or lookalikes',()=>{
 for(const url of ['https://ent.monlycee.net/','https://ent.iledefrance.fr/','https://mon.lyceeconnecte.fr/','https://connexion.enthdf.fr/','https://www.toutatice.fr/portail/'])assert.ok(portalForURL(url));
 for(const url of ['http://ent.monlycee.net/','https://localhost/','https://127.0.0.1/','https://[::1]/','https://ent.monlycee.net.evil.invalid/','https://user:secret@ent.monlycee.net/','https://ent.monlycee.net:8020/','https://ent.monlycee.net/#token'])assert.equal(portalForURL(url),null,url);
 const p=portalForURL('https://ent.monlycee.net/').provider;
 assert.equal(allowedEntURL('https://educonnect.education.gouv.fr/idp/',p),true);assert.equal(allowedEntURL('https://seshat.ac-rennes.fr/idp/',p),true);
 for(const url of ['http://ent.monlycee.net/','https://localhost/','https://attacker.invalid/','https://ac-rennes.fr.evil.invalid/','file:///etc/passwd'])assert.equal(allowedEntURL(url,p),false);
 assert.equal(hasENTCredentials('<body onload="Start({a:3,e:\'u\',f:\'secret\',h:1})">'),true);
 for(const html of ['Start({a:3})','Start({a:3,e:\'\',f:\'secret\'})','<p>f:secret,e:user</p>'])assert.equal(hasENTCredentials(html),false);
});
test('QR route is retired and public callers cannot inject an ENT cookie, snapshot or token',async()=>{
 const f=await hubFixture();try{
  assert.equal((await f.request('pronote/connect',{qr:{},pin:'1234'})).status,410);
  assert.equal((await f.request('pronote/connect',{ent:{html:'private'},credentials:{password:'injected'}})).status,410);
  assert.equal((await f.request('ent/start',{portalURL:'https://127.0.0.1/private'})).status,422);
  assert.equal((await f.request('ent/start',{portalURL:'https://ent.monlycee.net'},'a','https://evil.invalid')).status,403);
  assert.equal((await f.request('ent/providers',undefined,'anonymous')).status,401);
  const providers=await f.request('ent/providers');assert.equal(providers.status,200);assert.equal(providers.body.providers.filter(p=>p.family==='skolengo').length,19);
  assert.equal(f.controls.rotations,0);
 }finally{await f.close();}
});
test('an ENT→PRONOTE profile works as the main timetable source without a pre-existing regional ENT connection',async()=>{
 const f=await hubFixture();try{
  const u=f.store.user('a');Object.assign(u,{skolengo:null,studentId:null,schoolName:null,students:[],assignments:[],calendarEvents:{},lastSync:null});
  const draft=await f.captureENT('a',{}, {primary:true});assert.equal(draft.status,200);assert.equal(u.skolengo,null);assert.equal(userWork(u).length,0);
  assert.equal((await f.request('pronote/confirm',{candidate:draft.body.candidate,confirm:true},'b')).status,409);
  assert.equal((await f.request('pronote/confirm',{candidate:draft.body.candidate,confirm:true})).status,200);assert.equal(isEntPronote(f.store,u),true);
  const capabilities=(await f.request('capabilities')).body.features;assert.equal(capabilities.news.state,'unavailable');assert.equal(capabilities.messages.state,'unavailable');assert.equal(capabilities.grades.state,'available');
  const earlyWork=userWork(u)[0];assert.equal((await f.request('work/'+earlyWork.id,{done:true})).status,200);
  const student=u.studentId;const result=await f.engine.run(u.id);assert.ok(result);assert.equal(Object.values(u.calendarEvents).length,1);assert.equal(userWork(u).length,1);assert.equal(userWork(u)[0].id,earlyWork.id);assert.equal(userWork(u)[0].done,true);assert.deepEqual(userWork(u)[0].sources,['Pronote']);
  const client=await skolengoClient(f.store,u);assert.throws(()=>client.getCommunicationsFolder('anything'),/SERVICE_NOT_AVAILABLE/);
  assert.equal((await f.request('feed/create',{})).status,200);const feed=u.feedHash,event=Object.values(u.calendarEvents)[0];assert.ok(u.cachedICS.includes('BEGIN:VEVENT'));
  const work=userWork(u)[0];assert.equal((await f.request('work/'+work.id,{done:true})).status,200);
  f.controls.snapshot.sections.courses.data[0].id='rotated-session-reference';f.controls.snapshot.sections.courses.data[0].cancelled=true;
  f.controls.snapshot.sections.homework.data[0].id='rotated-homework';f.setNow(fixtureNow+180000);await f.engine.run(u.id);
  assert.equal(Object.values(u.calendarEvents).length,1);assert.equal(Object.values(u.calendarEvents)[0].id,event.id);assert.equal(Object.values(u.calendarEvents)[0].cancelled,true);assert.equal(userWork(u).length,1);assert.equal(userWork(u)[0].done,true);assert.equal(u.feedHash,feed);
  f.controls.snapshot.identity.id='new-session-student';const again=await f.captureENT('a',{}, {primary:true});assert.equal(again.status,200);assert.equal((await f.request('pronote/confirm',{candidate:again.body.candidate,confirm:true})).status,200);assert.equal(u.studentId,student);assert.equal(u.feedHash,feed);
  const serialized=fs.readFileSync(f.store.file,'utf8');for(const secret of ['private-mobile-token','synthetic-ent-secret','synthetic-ent-user'])assert.ok(!serialized.includes(secret));
  f.controls.outage=true;f.setNow(fixtureNow+600000);const before=JSON.stringify(u.calendarEvents);await assert.rejects(f.engine.run(u.id));assert.equal(JSON.stringify(u.calendarEvents),before);assert.equal(u.pronoteNeedsReconnect,true);assert.ok(u.skolengoError);
  assert.equal((await f.request('disconnect/skolengo',{})).status,200);assert.equal(u.pronote,null);assert.equal(u.feedHash,null);assert.equal(u.skolengo,null);
 }finally{await f.close();}
});
test('abandoned bootstrap cannot attach credentials after the session changes',async()=>{
 const f=await hubFixture();try{
  const source=f.store.user('a').skolengo;
  const result=await f.captureENT('a',{}, {isCurrent:()=>false});assert.equal(result.status,502);assert.equal(f.store.user('a').pendingPronote,null);assert.equal(f.store.user('a').skolengo,source);
 }finally{await f.close();}
});
test('SSO browser intercepts the unspent bootstrap, keeps screenshots private and releases context before confirmation',async()=>{
 let handle,pageCreated,popupClosed,closed=0,aborted=0,captured,continued=0;
 const page={setDefaultTimeout(){},on(){},url:()=> 'https://ent.monlycee.net/',goto:async()=>{},isClosed:()=>false};
 const context={newPage:async()=>page,pages:()=>[page],on(name,fn){if(name==='page')pageCreated=fn;},route:async(_pattern,fn)=>{handle=fn;},cookies:async()=>[{name:'session',value:'synthetic-cookie',domain:'demo.index-education.net',path:'/'}],close:async()=>{closed++;}};
 const manager={items:new Map(),starting:false,stop:async id=>{manager.items.delete(id);},getBrowser:async()=>({newContext:async()=>context})};
 await startEntPronote(manager,{id:'a'},'https://ent.monlycee.net/',{onCapture:async value=>{captured=value;}});
 const popup={setDefaultTimeout(){},on(name,fn){if(name==='close')popupClosed=fn;}};pageCreated(popup);assert.equal(manager.items.get('a').page,popup);popupClosed();assert.equal(manager.items.get('a').page,page);
 const route=(url,html)=>({request:()=>({url:()=>url,method:()=> 'GET',isNavigationRequest:()=>true}),fetch:async options=>{assert.equal(options.maxRedirects,0);return {status:()=>200,headers:()=>({'content-type':'text/html'}),body:async()=>Buffer.from(html)};},abort:async()=>{aborted++;},continue:async()=>{continued++;},fulfill:async()=>{}});
 await handle(route('https://evil.invalid/',''));assert.equal(continued,0);
 await handle(route('https://demo.index-education.net/pronote/eleve.html','<body onload="Start({a:3,e:\'u\',f:\'secret\',h:1})">'));
 assert.ok(captured.html.includes('Start'));assert.equal(captured.cookies[0].value,'synthetic-cookie');assert.equal(manager.items.get('a').status,'confirmation');assert.equal(closed,1);assert.equal(aborted,2);
 clearTimeout(manager.items.get('a').timer);
});

test('connection entry defaults to the connected ENT and accepts its direct PRONOTE URL without one-time parameters',async()=>{
 const {resolveEntConnection}=await import('../src/ent-pronote-browser.js');
 const source={homePageUrl:'https://test.ent.auvergnerhonealpes.fr/',emsCode:'rra'};
 assert.equal(resolveEntConnection('',source).portal.url,source.homePageUrl);
 assert.equal(resolveEntConnection('',source).entryURL,null);
 for(const path of ['/pronote/','/pronote/eleve.html','/pronote/mobile.eleve.html']){
  const value=resolveEntConnection('https://demo.index-education.net'+path+'?login=true&ticket=synthetic-stale#section',source);
  assert.equal(value.portal.provider.id,'rra');assert.ok(value.entryURL.endsWith('eleve.html'));assert.ok(!value.entryURL.includes('?'));assert.ok(!value.entryURL.includes('#'));
 }
 assert.equal(resolveEntConnection('https://ent.monlycee.net/',source).portal.provider.id,'monlycee');
});
test('direct PRONOTE entries require a known ENT and reject private, insecure, parent and arbitrary paths',async()=>{
 const {resolveEntConnection}=await import('../src/ent-pronote-browser.js');
 const source={homePageUrl:'https://test.ent.auvergnerhonealpes.fr/',emsCode:'rra'};
 assert.throws(()=>resolveEntConnection('',null),/Choisissez votre établissement/);
 assert.throws(()=>resolveEntConnection('https://demo.index-education.net/pronote/eleve.html',null),error=>error.status===409);
 for(const url of ['https://127.0.0.1/pronote/eleve.html','http://demo.index-education.net/pronote/eleve.html','https://demo.index-education.net/pronote/parent.html','https://demo.index-education.net:8020/pronote/eleve.html','https://user:secret@demo.index-education.net/pronote/eleve.html','https://demo.index-education.net/other/eleve.html'])assert.throws(()=>resolveEntConnection(url,source));
 assert.throws(()=>resolveEntConnection({portalURL:'bad'},source));
});
