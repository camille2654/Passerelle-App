import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {Store} from '../src/store.js';
import {TravelService,parseTravelSIRI,installTravelRoutes} from '../src/travel.js';

const day='2026-11-03',now=Date.parse(day+'T06:00:00Z');
const lesson=(id,start,end,cancelled=false,date=day)=>({id,date,title:'Cours '+id,start:date+'T'+start+':00+01:00',end:date+'T'+end+':00+01:00',cancelled});
const input=extra=>({enabled:true,label:'Ligne privée jusqu’au lycée',outboundMinutes:30,inboundMinutes:30,bufferMinutes:10,outboundTimes:[],inboundTimes:[],weekdays:[1,2,3,4,5],routeURL:'https://maps.apple.com/?q=lycee',sourceId:null,...extra});
const source=extra=>({label:'Réseau pilote · ligne C5',enabled:true,outboundURL:'https://proxy.transport.data.gouv.fr/resource/pilot-out',inboundURL:'https://proxy.transport.data.gouv.fr/resource/pilot-in',outboundStopRef:'STOP:A',inboundStopRef:'STOP:B',lineRef:'C5',informationURL:'https://transport.data.gouv.fr/',licenseURL:'https://www.etalab.gouv.fr/licence-ouverte-open-licence/',...extra});
const siri=(stop,times,line='C5')=>({Siri:{ServiceDelivery:{StopMonitoringDelivery:[{MonitoredStopVisit:times.map(time=>({MonitoringRef:{value:stop},MonitoredVehicleJourney:{LineRef:{value:line},DestinationName:{value:'Lycée'},MonitoredCall:{ExpectedDepartureTime:day+'T'+time+':00+01:00'}}}))}]}}});
function fixture(options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-travel-')),store=new Store(dir);let instant=now;const records=[];
 const user={id:'a',studentId:'pupil-a',schoolName:'Lycée fixture',skolengo:'connected',lastSync:instant,calendarWindow:{start:'2026-09-01',end:'2027-08-31'},calendarEvents:{first:lesson('premier','08:00','09:00'),last:lesson('dernier','15:00','16:00'),cancelled:lesson('annulé','17:00','18:00',true)}};
 const other={...user,id:'b',studentId:'pupil-b'};store.state.users.push(user,other);store.save();
 const service=new TravelService(store,{clock:()=>instant,audit:{record:(event,fields)=>records.push({event,fields})},...options});
 return {dir,store,user,other,service,records,setNow:value=>{instant=value;},close(){service.close();fs.rmSync(dir,{recursive:true,force:true});}};
}

test('travel stays disabled by default, is encrypted and isolated by pupil and account',()=>{
 const f=fixture();try{
  assert.equal(f.service.day(f.user,day).status,'disabled');assert.equal(f.service.settings(f.user).enabled,false);
  f.service.save(f.user,input());assert.equal(f.service.settings(f.user).enabled,true);assert.equal(f.service.settings(f.other).enabled,false);
  const raw=fs.readFileSync(f.store.file,'utf8');assert.ok(!raw.includes('Ligne privée'));assert.ok(!raw.includes('maps.apple.com'));
  assert.ok(!JSON.stringify(f.records).includes('Ligne privée'));
  f.user.studentId='another-pupil';assert.equal(f.service.settings(f.user).enabled,false);assert.equal(f.service.day(f.user,day).outbound,null);
 }finally{f.close();}
});
test('departure and return use actual first and last non-cancelled classes and adapt to changes',()=>{
 const f=fixture();try{
  f.service.save(f.user,input());let result=f.service.day(f.user,day);assert.equal(result.outbound.departure.time,'07:20');assert.equal(result.outbound.arrival.time,'07:50');assert.equal(result.inbound.departure.time,'16:10');assert.equal(result.inbound.arrival.time,'16:40');assert.equal(result.mode,'usual');
  f.user.calendarEvents.first.cancelled=true;result=f.service.day(f.user,day);assert.equal(result.outbound.departure.time,'14:20');assert.equal(result.firstCourse.title,'Cours dernier');
  f.user.calendarEvents.last.start=day+'T16:00:00+01:00';f.user.calendarEvents.last.end=day+'T17:00:00+01:00';result=f.service.day(f.user,day);assert.equal(result.outbound.departure.time,'15:20');assert.equal(result.inbound.departure.time,'17:10');
  f.user.calendarEvents.last.cancelled=true;assert.equal(f.service.day(f.user,day).status,'no_classes');
 }finally{f.close();}
});
test('recorded timetables choose a feasible outward departure and next return without claiming live data',()=>{
 const f=fixture();try{
  f.service.save(f.user,input({outboundMinutes:20,outboundTimes:['07:10','07:25','07:50'],inboundTimes:['15:55','16:20','17:15']}));
  let result=f.service.day(f.user,day);assert.equal(result.outbound.departure.time,'07:25');assert.equal(result.inbound.departure.time,'16:20');assert.equal(result.mode,'timetable');assert.equal(result.source,null);
  f.setNow(Date.parse(day+'T16:40:00+01:00'));f.user.lastSync=Date.parse(day+'T16:40:00+01:00');result=f.service.day(f.user,day);assert.equal(result.inbound.departure.time,'17:15');
  f.service.save(f.user,input({outboundTimes:['07:50'],inboundTimes:['15:00']}));result=f.service.day(f.user,day);assert.equal(result.outbound.mode,'usual');assert.ok(result.outbound.warning);assert.equal(result.inbound.mode,'usual');assert.ok(result.inbound.warning);
 }finally{f.close();}
});
test('old, incomplete, future-dated or failing agendas never yield confident departure advice',()=>{
 const f=fixture();try{
  f.service.save(f.user,input());
  for(const modify of [()=>{f.user.lastSync=now-31*60000;},()=>{f.user.lastSync=now;f.user.lastError='unavailable';},()=>{delete f.user.lastError;f.user.calendarWindow=null;},()=>{f.user.calendarWindow={start:'2026-09-01',end:'2027-08-31'};f.user.lastSync=now+86400000;}]){
   modify();const result=f.service.day(f.user,day);assert.equal(result.status,'agenda_unavailable');assert.equal(result.outbound,null);assert.ok(result.warning);
  }
 }finally{f.close();}
});
test('Paris dates, midnight departures and daylight-saving gaps remain explicit',()=>{
 const f=fixture();try{
  f.service.save(f.user,input({outboundMinutes:60,bufferMinutes:20}));f.user.calendarEvents={early:lesson('tôt','00:30','01:30')};let result=f.service.day(f.user,day);assert.equal(result.outbound.departure.date,'2026-11-02');assert.equal(result.outbound.departure.time,'23:10');
  f.user.calendarEvents={summer:{id:'summer',date:'2026-03-29',title:'Cours',start:'2026-03-29T03:30:00+02:00',end:'2026-03-29T04:30:00+02:00'}};f.user.calendarWindow={start:'2025-09-01',end:'2026-08-31'};f.setNow(Date.parse('2026-03-28T20:00:00Z'));f.user.lastSync=Date.parse('2026-03-28T20:00:00Z');f.service.save(f.user,input({outboundTimes:['02:30'],weekdays:[0]}));result=f.service.day(f.user,'2026-03-29');assert.equal(result.outbound.mode,'usual');assert.ok(Number.isFinite(Date.parse(result.outbound.departure.iso)));
  assert.throws(()=>f.service.day(f.user,'2026-02-31'));assert.throws(()=>f.service.day(f.user,'<script>'));
 }finally{f.close();}
});
test('travel settings and route links have strict bounded inputs',()=>{
 const f=fixture();try{
  for(const bad of [{outboundMinutes:0},{outboundMinutes:241},{inboundMinutes:'30'},{bufferMinutes:121},{weekdays:[]},{weekdays:[7]},{outboundTimes:['25:00']},{outboundTimes:['7:00']},{routeURL:'http://maps.apple.com/'},{routeURL:'https://maps.apple.com.attacker.invalid/'},{routeURL:'https://user:secret@maps.apple.com/'},{routeURL:'https://maps.apple.com:8443/'},{sourceId:'unknown'},{foo:true}])assert.throws(()=>f.service.save(f.user,input(bad)),JSON.stringify(bad));
  const result=f.service.save(f.user,input({outboundTimes:['07:10','07:10','06:30'],weekdays:[2,1,2]}));assert.deepEqual(result.settings.outboundTimes,['06:30','07:10']);assert.deepEqual(result.settings.weekdays,[1,2]);
 }finally{f.close();}
});
test('a configured SIRI pilot reads exact lines and stops, labels announced departures and preserves habitual duration',async()=>{
 const calls=[],f=fixture({fetchJSON:async url=>{calls.push(url);return url.endsWith('pilot-out')?siri('STOP:A',['07:10','07:25','07:50']):siri('STOP:B',['16:05','16:25']);}});try{
  const [profile]=f.service.configureSource(source());assert.equal(f.service.settings(f.user).availableSources.length,1);
  f.service.save(f.user,input({sourceId:profile.id,outboundMinutes:20}));const result=await f.service.get(f.user,day);assert.equal(calls.length,2);assert.equal(result.day.mode,'live');assert.equal(result.day.outbound.departure.time,'07:25');assert.equal(result.day.inbound.departure.time,'16:25');assert.equal(result.day.inbound.arrival.time,'16:55');assert.ok(result.day.liveNotice.includes('durées'));assert.equal(result.day.source.status,'available');
  await f.service.get(f.user,day);assert.equal(calls.length,2,'one-minute public cache');
  f.service.save(f.user,input({sourceId:profile.id,enabled:false}));f.setNow(now+120000);await f.service.get(f.user,day);assert.equal(calls.length,2,'disabled is not read');
 }finally{f.close();}
});
test('SIRI parsing does not invent departures from arbitrary dates, wrong stops or wrong lines',()=>{
 assert.deepEqual(parseTravelSIRI({receivedAt:day+'T08:00:00+01:00',ExpectedDepartureTime:day+'T08:00:00+01:00'},{stopRef:'STOP:A',lineRef:'C5'},now),[]);
 assert.equal(parseTravelSIRI(siri('STOP:B',['07:25']),{stopRef:'STOP:A',lineRef:'C5'},now).length,0);
 assert.equal(parseTravelSIRI(siri('STOP:A',['07:25'],'C6'),{stopRef:'STOP:A',lineRef:'C5'},now).length,0);
 const et={Siri:{ServiceDelivery:{EstimatedTimetableDelivery:[{EstimatedJourneyVersionFrame:[{EstimatedVehicleJourney:[{LineRef:'C5',EstimatedCalls:{EstimatedCall:[{StopPointRef:'STOP:A',AimedDepartureTime:day+'T07:25:00+01:00'}]}}]}]}]}}};
 const parsed=parseTravelSIRI(et,{stopRef:'STOP:A',lineRef:'C5'},now);assert.equal(parsed.length,1);assert.equal(parsed[0].live,false);
 const cancelled=siri('STOP:A',['07:25']);cancelled.Siri.ServiceDelivery.StopMonitoringDelivery[0].MonitoredStopVisit[0].MonitoredVehicleJourney.Cancellation=true;assert.deepEqual(parseTravelSIRI(cancelled,{stopRef:'STOP:A',lineRef:'C5'},now),[]);
});
test('source errors, disabled profiles and automation pauses retain honest estimates and never trigger unselected sources',async()=>{
 let calls=0;const f=fixture({fetchJSON:async()=>{calls++;throw new Error('PRIVATE PROVIDER ERROR');}});try{
  const [profile]=f.service.configureSource(source());f.service.save(f.user,input());await f.service.get(f.user,day);assert.equal(calls,0);
  f.service.save(f.user,input({sourceId:profile.id}));f.store.state.settings.automationPaused={ent:true};await f.service.get(f.user,day);assert.equal(calls,0);delete f.store.state.settings.automationPaused;
  const result=await f.service.get(f.user,day);assert.equal(calls,2);assert.equal(result.day.mode,'usual');assert.equal(result.day.source.status,'error');assert.ok(!JSON.stringify(result).includes('PRIVATE PROVIDER'));
  f.service.configureSource({...source({id:profile.id}),enabled:false});assert.equal(f.service.settings(f.user).availableSources.length,0);assert.equal(f.service.day(f.user,day).source,null);
  for(const address of ['http://proxy.transport.data.gouv.fr/x','https://proxy.transport.data.gouv.fr.attacker.invalid/x','https://user:secret@proxy.transport.data.gouv.fr/x','https://127.0.0.1/x','https://proxy.transport.data.gouv.fr/x?api_key=secret','https://proxy.transport.data.gouv.fr:8443/x'])assert.throws(()=>f.service.configureSource(source({outboundURL:address})));
 }finally{f.close();}
});
test('every account has its own origin, destination, timetable and school-based departure',()=>{
 const f=fixture();try{
  f.service.save(f.user,input({originLabel:'Arrêt de ma ville',destinationLabel:'Lycée A',outboundTimes:['07:05'],outboundMinutes:35}));
  f.service.save(f.other,input({label:'Autre réseau',originLabel:'Gare B',destinationLabel:'Lycée B',outboundTimes:['06:45','07:35'],outboundMinutes:15}));
  assert.equal(f.service.settings(f.user).originLabel,'Arrêt de ma ville');assert.equal(f.service.settings(f.other).originLabel,'Gare B');
  assert.equal(f.service.day(f.user,day).outbound.departure.time,'07:05');assert.equal(f.service.day(f.other,day).outbound.departure.time,'07:35');
  const raw=fs.readFileSync(f.store.file,'utf8');assert.ok(!raw.includes('Arrêt de ma ville'));assert.ok(!raw.includes('Gare B'));
  for(const extra of [{originLabel:{}},{destinationLabel:'x'.repeat(151)},{outboundStopRef:'bad\nref'}])assert.throws(()=>f.service.save(f.user,input(extra)));
 }finally{f.close();}
});
test('a reusable network reads each user’s exact stops and line, encodes references and isolates caches',async()=>{
 const calls=[],f=fixture({fetchJSON:async address=>{calls.push(address);const ref=new URL(address).searchParams.get('MonitoringRef');return siri(ref,ref.includes('out')?['07:25']:['16:25'],ref.startsWith('B:')?'L2':'L1');}});try{
  const [profile]=f.service.configureSource(source({label:'Réseau réutilisable',userStops:true,outboundStopRef:'',inboundStopRef:'',lineRef:'',outboundURL:'https://proxy.transport.data.gouv.fr/siri?MonitoringRef={stopRef}',inboundURL:'https://proxy.transport.data.gouv.fr/siri?MonitoringRef={stopRef}'}));
  assert.equal(f.service.settings(f.user).availableSources[0].userStops,true);assert.throws(()=>f.service.save(f.user,input({sourceId:profile.id})));
  f.service.save(f.user,input({sourceId:profile.id,outboundStopRef:'A:out&private=x',inboundStopRef:'A:in',lineRef:'L1',outboundMinutes:20}));
  f.service.save(f.other,input({sourceId:profile.id,outboundStopRef:'B:out',inboundStopRef:'B:in',lineRef:'L2',outboundMinutes:20}));
  let result=await f.service.get(f.user,day);assert.equal(result.day.outbound.mode,'live');assert.equal(result.day.outbound.departure.time,'07:25');assert.equal(calls.length,2);assert.equal(new URL(calls[0]).searchParams.get('MonitoringRef'),'A:out&private=x');assert.equal(new URL(calls[0]).searchParams.has('private'),false);
  result=await f.service.get(f.other,day);assert.equal(result.day.mode,'live');assert.equal(calls.length,4);await f.service.get(f.user,day);assert.equal(calls.length,4);assert.equal(f.service.cache.size,2);
  const exposed=JSON.stringify(f.service.settings(f.other).availableSources);assert.ok(!exposed.includes('A:out'));assert.ok(!exposed.includes('B:out'));assert.ok(!exposed.includes('siri?'));
  for(const address of ['https://{stopRef}.transport.data.gouv.fr/x','https://proxy.transport.data.gouv.fr/siri?x={lineRef}','https://proxy.transport.data.gouv.fr/no-placeholder'])assert.throws(()=>f.service.configureSource(source({userStops:true,outboundURL:address})));
 }finally{f.close();}
});
test('switching a personal stop during a request cannot publish the old route',async()=>{
 let entered,release;const started=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});const f=fixture({fetchJSON:async address=>{entered();await gate;const stop=new URL(address).searchParams.get('MonitoringRef');return siri(stop,['07:25']);}});try{
  const [profile]=f.service.configureSource(source({userStops:true,outboundStopRef:'',inboundStopRef:'',outboundURL:'https://proxy.transport.data.gouv.fr/siri?MonitoringRef={stopRef}',inboundURL:'https://proxy.transport.data.gouv.fr/siri?MonitoringRef={stopRef}'}));
  f.service.save(f.user,input({sourceId:profile.id,outboundStopRef:'A',inboundStopRef:'B'}));const pending=f.service.get(f.user,day);await started;
  f.service.save(f.user,input({sourceId:profile.id,outboundStopRef:'OTHER',inboundStopRef:'B'}));release();const result=await pending;assert.equal(result.day.mode,'usual');assert.equal(result.day.source.status,'not_loaded');assert.equal(f.service.cache.size,0);
 }finally{release();f.close();}
});
test('a source changed while in flight cannot publish departures from its old stop',async()=>{
 let release,entered;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});const f=fixture({fetchJSON:async()=>{entered();await gate;return siri('STOP:A',['07:25']);}});try{
  const [profile]=f.service.configureSource(source());f.service.save(f.user,input({sourceId:profile.id}));const pending=f.service.get(f.user,day);await started;f.service.configureSource(source({id:profile.id,outboundStopRef:'STOP:OTHER'}));release();const result=await pending;assert.equal(result.day.mode,'usual');assert.equal(result.day.source.status,'not_loaded');
 }finally{release();f.close();}
});
test('authenticated routes reject wrong origins, cross-account writes and non-admin source setup',async()=>{
 const f=fixture();let server;try{
  const app=express(),router=express.Router();app.use(express.json());app.use((req,res,next)=>{res.set('Cache-Control','no-store');if(req.method==='POST'&&req.get('origin')!=='http://localhost')return res.status(403).json({error:'origin'});req.user=f.store.user(req.get('x-user'));next();});
  installTravelRoutes(router,{store:f.store,auth:(req,res,next)=>req.user?next():res.status(401).end(),admin:(req,res,next)=>req.user.id==='a'?next():res.status(403).end(),clock:()=>now,rateLimit:()=>{},fetchJSON:async()=>({})});app.use(router);app.use((error,req,res,next)=>res.status(error.status||400).json({error:error.message}));server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const root='http://127.0.0.1:'+server.address().port;
  const request=(route,body,user='a',origin='http://localhost')=>fetch(root+route,{headers:{'x-user':user,origin,...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  assert.equal((await request('/api/travel',null,'anonymous')).status,401);assert.equal((await request('/api/travel/settings',{...input(),accountId:'a'},'a','https://other.invalid')).status,403);assert.equal((await request('/api/travel/settings',{...input(),accountId:'b'})).status,409);assert.equal((await request('/api/admin/travel/sources',source(),'b')).status,403);
  const saved=await request('/api/travel/settings',{...input(),accountId:'a'});assert.equal(saved.status,200);assert.equal(saved.headers.get('cache-control'),'no-store');assert.equal((await saved.json()).day.outbound.departure.time,'07:20');assert.equal((await request('/api/travel?date=2026-02-31')).status,400);
 }finally{server?.closeAllConnections();if(server)await new Promise(resolve=>server.close(resolve));f.close();}
});
