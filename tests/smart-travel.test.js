import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {controlFixture} from './control-fixture.js';
import {digest} from '../src/store.js';
import {dateWindow} from '../src/sync.js';
import {parsePlaces,parseNavitiaJourneys,locationPoint,itineraryLinks,computeTransportJourneys,requestTransportJSON} from '../src/smart-travel-provider.js';

const NOW=Date.parse('2026-11-04T12:00:00Z'),DAY='2026-11-05',TOKEN='synthetic-navitia-secret-123';
const HOME={lat:45.991234,lon:4.981234,label:'Domicile éphémère à ne pas conserver'},SCHOOL={lat:45.431234,lon:4.391234,label:'Lycée de démonstration'};
const routeInput=(extra={})=>({date:DAY,direction:'outbound',origin:HOME,destination:SCHOOL,bufferMinutes:10,...extra});
function geocoding({postcode='42000',score=.94,type='housenumber'}={}){return {features:[{type:'Feature',geometry:{type:'Point',coordinates:[SCHOOL.lon,SCHOOL.lat]},properties:{label:'9 boulevard du Lycée 42000 Saint-Étienne',postcode,score,type}}]};}
function journey({departure='20261105T071000',arrival='20261105T074000',freshness='realtime',status='',from=HOME.label,to=SCHOOL.label}={}){
 return {departure_date_time:departure,arrival_date_time:arrival,nb_transfers:0,status,sections:[{type:'public_transport',departure_date_time:departure,arrival_date_time:arrival,data_freshness:freshness,display_informations:{physical_mode:'Bus',code:'M4',direction:'Terminus public'},from:{name:from},to:{name:to}}]};
}
const payload=(options={})=>({context:{timezone:'Europe/Paris'},journeys:[journey(options)]});
async function fixture(){
 const f=await controlFixture();f.setNow(NOW);const requested=[];
 for(const user of f.store.state.users){user.lastSync=NOW;user.calendarWindow=dateWindow(new Date(NOW));user.skolengo=f.store.seal({school:{id:'school-'+user.id,name:user.schoolName,addressLine1:'9 boulevard du Lycée',zipCode:'42000',city:'Saint-Étienne'},tokenSet:{private:'fixture-ent-private-secret'}});user.calendarEvents={first:{id:'first-'+user.id,date:DAY,title:'Premier cours',rawTitle:'Mathématiques',kind:'course',start:DAY+'T07:00:00Z',end:DAY+'T08:00:00Z',created:NOW,modified:NOW,sequence:0},last:{id:'last-'+user.id,date:DAY,title:'Dernier cours',rawTitle:'Français',kind:'course',start:DAY+'T14:00:00Z',end:DAY+'T15:00:00Z',created:NOW,modified:NOW,sequence:0}};}
 f.store.save();f.smartTravel.requestJSON=async(address,options)=>{requested.push({address,options});throw new Error('No external transport requests are permitted in this fixture');};
 const smart=(route,body,who='camille',origin='http://127.0.0.1')=>f.request('travel/smart/'+route,{accountId:who,...body},who,origin);
 const admin=(body)=>f.request('admin/travel/routing',body,'owner');
 const close=async()=>{f.server.closeAllConnections();await f.close();};
 return {...f,requested,smart,admin,close,async enable(){assert.equal((await admin({enabled:true,token:TOKEN,coverage:'fr-example'})).status,200);}};
}

test('geocoding and location parsing reject invalid shapes, preserve coordinate order, and never accept arbitrary upstream hosts',async()=>{
 const valid=parsePlaces(geocoding());assert.equal(valid[0].lat,SCHOOL.lat);assert.equal(valid[0].lon,SCHOOL.lon);assert.equal(valid[0].postcode,'42000');assert.equal(valid[0].score,.94);
 assert.deepEqual(parsePlaces({features:[{geometry:{type:'LineString',coordinates:[1,2]},properties:{label:'bad'}},{geometry:{type:'Point',coordinates:[999,45]},properties:{label:'bad'}}]}),[]);
 assert.throws(()=>parsePlaces({items:[]}));
 for(const value of [{lat:91,lon:4,label:'x'},{lat:45,lon:-181,label:'x'},{lat:'45',lon:4,label:'x'},{...HOME,url:'http://127.0.0.1'},{...HOME,label:'x'.repeat(151)}])assert.throws(()=>locationPoint(value));
 assert.equal(locationPoint({lat:45.123456789,lon:4.123456789,label:'  Point  '}).lat,45.123457);
 const links=itineraryLinks(HOME,SCHOOL);assert.equal(new URL(links.google).hostname,'www.google.com');assert.equal(new URL(links.google).searchParams.get('travelmode'),'transit');assert.equal(new URL(links.apple).searchParams.get('dirflg'),'r');
 await assert.rejects(requestTransportJSON('https://127.0.0.1/private'),/HOST_REFUSED/);await assert.rejects(requestTransportJSON('http://api.navitia.io/v1/coverage'),/HOST_REFUSED/);
});

test('the connected lycée postal address is reused while ambiguous postcode matches require a manual choice',async()=>{
 const f=await fixture();try{
  const requests=[];f.smartTravel.requestJSON=async address=>{requests.push(new URL(address));return geocoding();};
  const before=await f.request('travel/smart?date='+DAY,undefined,'camille');assert.equal(before.status,200);assert.equal(before.body.school.address,'9 boulevard du Lycée, 42000 Saint-Étienne');assert.equal(before.body.preferences.origin,null);assert.ok(!JSON.stringify(before.body).includes('fixture-ent-private-secret'));
  const school=await f.smart('school',{});assert.equal(school.status,200);assert.equal(school.body.school.name,'Lycée fixture');assert.match(school.body.school.point.label,/9 boulevard du Lycée/);assert.equal(school.body.school.point.lat,SCHOOL.lat);assert.equal(requests[0].hostname,'data.geopf.fr');assert.equal(requests[0].pathname,'/geocodage/search');assert.equal(requests[0].searchParams.get('q'),'9 boulevard du Lycée, 42000 Saint-Étienne');assert.equal(requests[0].searchParams.get('autocomplete'),'0');
  assert.equal((await f.smart('school',{})).status,200);assert.equal(requests.length,1,'public school result is cached');assert.equal(f.store.user('camille').smartTravelPrefs,undefined);
  f.smartTravel.schools.clear();f.smartTravel.requestJSON=async()=>geocoding({postcode:'69000',score:.99});
  const ambiguous=await f.smart('school',{});assert.equal(ambiguous.status,200);assert.equal(ambiguous.body.school.point,null);assert.equal(ambiguous.body.candidates.length,1);assert.match(ambiguous.body.warning,/Vérifiez/);
  f.smartTravel.schools.clear();f.smartTravel.requestJSON=async()=>geocoding({score:.4});assert.equal((await f.smart('school',{})).body.school.point,null);
  f.smartTravel.schools.clear();f.smartTravel.requestJSON=async()=>geocoding({type:'municipality',score:1});assert.equal((await f.smart('school',{})).body.school.point,null,'a city centroid is not a precise lycée location');
  f.store.user('camille').skolengo=f.store.seal({school:{id:'city-only',name:'Ville seule',zipCode:'42000',city:'Saint-Étienne'}});f.smartTravel.requestJSON=async()=>geocoding({score:1});assert.equal((await f.smart('school',{})).body.school.point,null,'a postal code and city alone require manual confirmation');
  f.store.user('camille').skolengo=f.store.seal({school:{name:'Sans adresse'}});const absent=await f.smart('school',{});assert.equal(absent.status,200);assert.deepEqual(absent.body.candidates,[]);assert.equal(absent.body.school.point,null);
 }finally{await f.close();}
});

test('remembering a departure is explicit, encrypted, profile scoped and forgettable; invalid settings are atomic',async()=>{
 const f=await fixture();try{
  const user=f.store.user('camille'),before={prefs:user.smartTravelPrefs,scope:user.smartTravelScope,version:user.personalVersion,feed:user.cachedICS};
  const invalid=await f.smart('settings',{origin:HOME,destination:SCHOOL,bufferMinutes:10,date:'2026-02-31'});assert.equal(invalid.status,400);assert.equal(user.smartTravelPrefs,undefined);assert.deepEqual({prefs:user.smartTravelPrefs,scope:user.smartTravelScope,version:user.personalVersion,feed:user.cachedICS},before);
  const saved=await f.smart('settings',{origin:HOME,destination:SCHOOL,bufferMinutes:15,date:DAY});assert.equal(saved.status,200);assert.deepEqual(saved.body.preferences.origin,HOME);assert.ok(!fs.readFileSync(f.store.file,'utf8').includes(HOME.label));assert.ok(!fs.readFileSync(f.store.file,'utf8').includes(String(HOME.lat)));assert.deepEqual(f.store.open(user.smartTravelPrefs).origin,HOME);
  const student=user.studentId;user.studentId='different-pupil';assert.equal(f.smartTravel.preferences(user).origin,null);user.studentId=student;
  const forgot=await f.smart('settings',{origin:null,destination:null,bufferMinutes:10,date:DAY});assert.equal(forgot.status,200);assert.equal(forgot.body.preferences.origin,null);assert.equal(f.store.open(user.smartTravelPrefs).origin,null);assert.equal(f.store.open(user.smartTravelPrefs).destination,null);
  const logs=fs.readdirSync(path.join(f.dir,'logs')).filter(name=>name.endsWith('.jsonl')).map(name=>fs.readFileSync(path.join(f.dir,'logs',name),'utf8')).join('');assert.ok(!logs.includes(HOME.label));assert.ok(!logs.includes(String(HOME.lat)));assert.equal(f.calls.mail.length,0);
 }finally{await f.close();}
});

test('without a configured provider, real Maps links remain available and an explicit estimate can be added without claiming realtime',async()=>{
 const f=await fixture();try{
  let calls=0;f.smartTravel.requestJSON=async()=>{calls++;throw new Error('must not request');};
  const result=await f.smart('plan',routeInput());assert.equal(result.status,200);assert.equal(result.body.status,'provider_unavailable');assert.equal(result.body.provider.ready,false);assert.deepEqual(result.body.journeys,[]);assert.equal(calls,0);
  assert.equal(new URL(result.body.links.google).searchParams.get('origin'),HOME.lat+','+HOME.lon);assert.equal(new URL(result.body.links.apple).searchParams.get('daddr'),SCHOOL.lat+','+SCHOOL.lon);
  const draft=await f.smart('estimate',{date:DAY,direction:'outbound',minutes:35,bufferMinutes:10});assert.equal(draft.status,200);assert.equal(draft.body.journey.realtime,false);assert.equal(draft.body.journey.mode,'manual');assert.equal(f.store.user('camille').travelCalendar,undefined);
  const confirmed=await f.smart('confirm',{token:draft.body.journey.token,feed:false});assert.equal(confirmed.status,200);assert.equal(confirmed.body.block.mode,'mixed');assert.equal(confirmed.body.block.feed,false);assert.ok(!f.store.user('camille').cachedICS.includes('SUMMARY:Trajet'));assert.equal(confirmed.body.blocks[0].journey.realtime,false);assert.equal(confirmed.body.blocks[0].details,'Durée renseignée par vous ; à vérifier avant le départ.');
  const week=await f.request('week?date='+DAY,undefined,'camille');assert.equal(week.body.days.find(day=>day.date===DAY).travelEvents.length,1);
  assert.equal((await f.smart('confirm',{token:'invented',feed:true})).status,410);assert.equal(calls,0);
 }finally{await f.close();}
});

test('a provider plan uses arrival before the first class and reversed departure coordinates after the last class',async()=>{
 const f=await fixture();try{
  await f.enable();const requests=[];f.smartTravel.requestJSON=async(address,options)=>{const url=new URL(address);requests.push({url,options});return url.searchParams.get('datetime_represents')==='arrival'?payload():payload({departure:'20261105T161500',arrival:'20261105T164500',from:SCHOOL.label,to:HOME.label});};
  const out=await f.smart('plan',routeInput());assert.equal(out.status,200);assert.equal(out.body.status,'available');assert.equal(out.body.journeys[0].realtime,true);assert.equal(requests[0].url.pathname,'/v1/coverage/fr-example/journeys');assert.equal(requests[0].url.searchParams.get('from'),HOME.lon+';'+HOME.lat);assert.equal(requests[0].url.searchParams.get('to'),SCHOOL.lon+';'+SCHOOL.lat);assert.equal(requests[0].url.searchParams.get('datetime'),'20261105T075000');assert.equal(requests[0].url.searchParams.get('data_freshness'),'realtime');assert.equal(requests[0].options.headers.Authorization,TOKEN);
  const inbound=await f.smart('plan',routeInput({direction:'inbound'}));assert.equal(inbound.status,200);assert.equal(requests[1].url.searchParams.get('from'),SCHOOL.lon+';'+SCHOOL.lat);assert.equal(requests[1].url.searchParams.get('to'),HOME.lon+';'+HOME.lat);assert.equal(requests[1].url.searchParams.get('datetime'),'20261105T161000');assert.equal(requests[1].url.searchParams.get('datetime_represents'),'departure');assert.equal(new URL(inbound.body.links.google).searchParams.get('origin'),SCHOOL.lat+','+SCHOOL.lon);
  assert.equal(f.store.user('camille').travelCalendar,undefined,'a plan creates no calendar block');assert.equal(f.calls.mail.length,0);
 }finally{await f.close();}
});

test('confirmed GPS plans never persist exact endpoints, and a repeated confirmation never duplicates the calendar',async()=>{
 const f=await fixture();try{
  await f.enable();f.smartTravel.requestJSON=async()=>payload();
  const planned=await f.smart('plan',routeInput()),token=planned.body.journeys[0].token;assert.ok(token);const confirmed=await f.smart('confirm',{token,feed:true});assert.equal(confirmed.status,200);assert.equal(confirmed.body.blocks.length,1);
  const user=f.store.user('camille'),privateRows=f.store.open(user.travelBlockState),encryptedDisk=fs.readFileSync(f.store.file,'utf8');
  for(const privateValue of [HOME.label,String(HOME.lat),String(HOME.lon)]){assert.ok(!encryptedDisk.includes(privateValue));assert.ok(!JSON.stringify(privateRows).includes(privateValue));assert.ok(!user.cachedICS.includes(privateValue));}
  assert.equal(user.smartTravelPrefs,undefined);assert.equal(privateRows.items[confirmed.body.block.id].value.journey.legs[0].line,'M4');assert.equal(Object.values(privateRows.items)[0].value.journey.legs[0].from,undefined);
  const repeated=await f.smart('confirm',{token,feed:true});assert.equal(repeated.status,200);assert.equal(repeated.body.alreadySaved,true);assert.equal(Object.keys(user.travelCalendar).length,1);assert.equal((user.cachedICS.match(/SUMMARY:Trajet vers le lycée/g)||[]).length,1);
  const removed=await f.smart('remove',{id:confirmed.body.block.id});assert.equal(removed.status,200);assert.equal(removed.body.blocks.length,0);assert.ok(!user.cachedICS.includes('SUMMARY:Trajet'));
 }finally{await f.close();}
});

test('plan tokens are bound to account, session and pupil and expire; changed courses reject stale confirmation',async()=>{
 const f=await fixture();try{
  const draft=await f.smart('estimate',{date:DAY,direction:'outbound',minutes:30,bufferMinutes:10}),token=draft.body.journey.token;
  assert.equal((await f.smart('confirm',{token,feed:true},'nina')).status,409);
  const sessionToken='synthetic-second-session',user=f.store.user('camille');f.store.state.sessions.push({hash:digest(sessionToken),userId:user.id,expires:Date.now()+3600000});f.store.save();
  const other=await fetch(f.root+'/api/travel/smart/confirm',{method:'POST',headers:{cookie:'agenda_session='+sessionToken,Origin:'http://127.0.0.1','Content-Type':'application/json'},body:JSON.stringify({accountId:user.id,token,feed:true})});assert.equal(other.status,409);
  const pupil=user.studentId;user.studentId='changed';assert.equal((await f.smart('confirm',{token,feed:true})).status,409);user.studentId=pupil;
  user.calendarEvents.first.start=DAY+'T07:30:00Z';assert.equal((await f.smart('confirm',{token,feed:true})).status,409);assert.equal(user.travelCalendar,undefined);user.calendarEvents.first.start=DAY+'T07:00:00Z';
  f.setNow(NOW+600001);assert.equal((await f.smart('confirm',{token,feed:true})).status,410);assert.equal(user.travelCalendar,undefined);
 }finally{await f.close();}
});

test('authentication, same origin, strict account and request bodies prevent client supplied routing claims',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('travel/smart?date='+DAY,undefined,'anonymous')).status,401);assert.equal((await f.smart('plan',routeInput(),'camille','https://outside.invalid')).status,403);
  assert.equal((await f.smart('plan',routeInput({accountId:'nina'}))).status,409);
  for(const extra of [{realtime:true},{journey:payload()},{provider:'pretend'},{fromURL:'http://127.0.0.1'},{token:'client-chosen'}])assert.equal((await f.smart('plan',routeInput(extra))).status,400);
  for(const extra of [{minutes:0},{minutes:241},{minutes:'20'},{bufferMinutes:121},{direction:'other'}])assert.equal((await f.smart('estimate',{date:DAY,direction:'outbound',minutes:30,bufferMinutes:10,...extra})).status,400);
  assert.equal((await f.smart('confirm',{token:'pretend',feed:true,realtime:true})).status,400);assert.equal(f.store.user('camille').travelCalendar,undefined);assert.equal(f.calls.mail.length,0);
 }finally{await f.close();}
});

test('routing credentials are admin-only, encrypted and masked; configuration checks expose only coverage metadata',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('admin/travel/routing',undefined,'camille')).status,403);assert.equal((await f.request('admin/travel/routing',{enabled:true,token:TOKEN},'camille')).status,403);assert.equal((await f.admin({enabled:true})).status,400);
  await f.enable();const visible=await f.request('admin/travel/routing',undefined,'owner');assert.equal(visible.status,200);assert.equal(visible.body.routing.tokenConfigured,true);assert.equal(visible.body.routing.token,undefined);assert.ok(!JSON.stringify(visible.body).includes(TOKEN));assert.ok(!fs.readFileSync(f.store.file,'utf8').includes(TOKEN));assert.equal(f.store.open(f.store.state.settings.smartRouting).token,TOKEN);
  assert.equal((await f.admin({enabled:true,token:'',coverage:'fr-test'})).status,200);assert.equal(f.store.open(f.store.state.settings.smartRouting).token,TOKEN);
  f.smartTravel.requestJSON=async(address,options)=>{assert.equal(new URL(address).pathname,'/v1/coverage');assert.equal(options.headers.Authorization,TOKEN);return {regions:[{id:'fr-test',name:'Région synthétique',production_dates:{begin:'20261101',end:'20261201'},privateToken:TOKEN}]};};
  const checked=await f.request('admin/travel/routing/check',{},'owner');assert.equal(checked.status,200);assert.equal(checked.body.coverage[0].id,'fr-test');assert.ok(!JSON.stringify(checked.body).includes(TOKEN));
  assert.equal((await f.admin({enabled:false,clearToken:true})).status,200);assert.equal(f.store.open(f.store.state.settings.smartRouting).token,'');
 }finally{await f.close();}
});

test('provider failures, configuration changes and profile changes during a query cannot stage or write a calendar block',async()=>{
 const f=await fixture();try{
  await f.enable();f.smartTravel.requestJSON=async()=>{throw Object.assign(new Error('private internal diagnostics'),{upstreamStatus:401});};const failed=await f.smart('plan',routeInput());assert.equal(failed.status,502);assert.ok(!JSON.stringify(failed.body).includes('private internal diagnostics'));assert.equal(f.smartTravel.plans.size,0);
  let release,entered;const began=new Promise(resolve=>entered=resolve);f.smartTravel.requestJSON=async()=>{entered();await new Promise(resolve=>release=resolve);return payload();};const pending=f.smart('plan',routeInput());await began;f.store.user('camille').studentId='new-pupil';release();assert.equal((await pending).status,409);assert.equal(f.smartTravel.plans.size,0);assert.equal(f.store.user('camille').travelCalendar,undefined);
  f.store.user('camille').studentId='student-camille';let unlock,ready;const nextBegan=new Promise(resolve=>ready=resolve);f.smartTravel.requestJSON=async()=>{ready();await new Promise(resolve=>unlock=resolve);return payload();};const other=f.smart('plan',routeInput());await nextBegan;assert.equal((await f.admin({enabled:false})).status,200);unlock();assert.equal((await other).status,409);assert.equal(f.smartTravel.plans.size,0);assert.equal(f.store.user('camille').travelCalendar,undefined);
 }finally{await f.close();}
});

test('Navitia freshness follows actual transit sections; cancelled, invalid and ambiguous local-time journeys are refused',async()=>{
 const options={target:Date.parse(DAY+'T06:50:00Z'),direction:'outbound'};
 assert.equal(parseNavitiaJourneys(payload(),options)[0].realtime,true);const published=parseNavitiaJourneys(payload({freshness:'base_schedule'}),options)[0];assert.equal(published.realtime,false);assert.equal(published.realtimeStatus,'scheduled');
 const mixed=payload();mixed.journeys[0].sections[0].arrival_date_time='20261105T072500';mixed.journeys[0].sections.push({...mixed.journeys[0].sections[0],departure_date_time:'20261105T072500',arrival_date_time:'20261105T074000',data_freshness:'base_schedule'});assert.equal(parseNavitiaJourneys(mixed,options)[0].realtime,false);assert.equal(parseNavitiaJourneys(mixed,options)[0].realtimeStatus,'mixed');
 for(const invalid of [payload({status:'cancelled'}),payload({departure:'20261105T090000'}),payload({arrival:'20261105T090000'}),payload({departure:'not a timestamp'}),{journeys:[]}])assert.deepEqual(parseNavitiaJourneys(invalid,options),[]);
 const cancelled=payload();cancelled.journeys[0].sections[0].additional_informations=['cancelled'];assert.deepEqual(parseNavitiaJourneys(cancelled,options),[]);assert.throws(()=>parseNavitiaJourneys({...payload(),context:{timezone:'Asia/Tokyo'}},options),/TIMEZONE/);
 assert.deepEqual(parseNavitiaJourneys(payload({departure:'20261025T021000',arrival:'20261025T024000'}),{target:Date.parse('2026-10-25T04:00:00Z'),direction:'outbound'}),[]);
 assert.deepEqual(parseNavitiaJourneys(payload({departure:'20270328T021000',arrival:'20270328T024000'}),{target:Date.parse('2027-03-28T04:00:00Z'),direction:'outbound'}),[]);
 let queried;await computeTransportJourneys({origin:HOME,destination:SCHOOL,target:Date.parse('2027-06-01T05:50:00Z'),direction:'outbound',token:TOKEN,coverage:''},async address=>{queried=new URL(address);return {journeys:[]};});assert.equal(queried.searchParams.get('datetime'),'20270601T075000');assert.equal(queried.pathname,'/v1/journeys');
});
