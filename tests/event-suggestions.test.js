import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ICAL from 'ical.js';
import {createApp} from '../src/server.js';
import {random,digest} from '../src/store.js';
import {weekView} from '../src/planner.js';

const initialNow=Date.parse('2026-10-29T12:00:00Z');
const publication='2026-10-28T10:00:00+01:00';
const emptyCalendar='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';
const eventsOf=ics=>new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent').map(component=>new ICAL.Event(component));
const entry=(id='article-a',content='<p>La rencontre aura lieu jeudi 5 novembre 2026 de 18 h 30 à 20h00.</p>')=>({id,title:'Rencontre des clubs',content,shortContent:'Une rencontre vous attend.',publicationDateTime:publication,school:{id:'school'}});

async function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-events-'));
  let now=initialNow,source,server;
  const calls={news:0,details:0,folders:0,messages:0,opened:0,accounts:[]};
  const control={news:[entry()],messages:[{id:'mail-a',subject:'Sortie au musée',read:false,participationsNumber:1,firstParticipationContent:'<p>La sortie se déroulera le 12 novembre 2026 de 9h à 11h.</p>',lastParticipation:{dateTime:publication}}],failNews:null,failMessages:null,gate:null,entered:null,exactPage:false};
  const cookies={},tokens={};
  const create=()=>createApp({dataDir:dir,baseURL:'http://127.0.0.1/agenda',bootstrap:false,clock:()=>now,schoolOptions:{clientFactory:async(_store,user)=>{
    calls.accounts.push(user.id);
    return {
      getSchoolInfos:async({page})=>{calls.news++;if(control.entered)control.entered();if(control.gate)await control.gate;if(control.failNews)throw control.failNews;if(page.offset&&control.exactPage)throw Object.assign(new Error('page offset out of range: beyond data set'),{status:400});return page.offset?[]:structuredClone(control.news);},
      getSchoolInfo:async id=>{calls.details++;return structuredClone(control.news.find(value=>value.id===id));},
      getUsersMailSettings:async()=>{calls.folders++;if(control.failMessages)throw control.failMessages;return {folders:[{id:'inbox-'+user.id,type:'INBOX',name:'Réception'}]};},
      getCommunicationsFolder:async(folder,_limit,offset)=>{calls.messages++;assert.equal(folder,'inbox-'+user.id);return offset?[]:structuredClone(control.messages);},
      getCommunicationParticipations:async()=>{calls.opened++;return [{dateTime:publication,sender:{person:{firstName:'Équipe',lastName:'Lycée'}},content:'<p>Le rendez-vous est le 12 novembre 2026 de 9h à 11h.</p><script>badSource()</script><img src="https://tracking.invalid/pixel">',attachments:[]}];}
    };
  }}});
  const listen=async()=>{server=source.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));};
  source=create();
  for(const id of ['a','b','offline']){
    const token=random(),feed=random();cookies[id]='agenda_session='+token;tokens[id]=feed;
    source.store.state.users.push({id,name:'Élève fixture '+id,login:id,admin:false,studentId:'student-'+id,students:[{id:'student-'+id,name:'Élève'},{id:'other-'+id,name:'Autre élève'}],schoolName:'Lycée fixture',...(id==='offline'?{}:{skolengo:source.store.seal({school:{id:'school',name:'Lycée fixture'}}),skolengoConnectionId:'connection-'+id}),calendarEvents:{},taskCalendar:{},manualWork:[],assignments:[],lastSync:now,enabled:false,feedKey:source.store.seal(feed),feedHash:digest(feed),cachedICS:emptyCalendar,feedETag:'"initial"',feedModifiedAt:now});
    source.store.state.sessions.push({hash:digest(token),userId:id,expires:Date.now()+3600000});
  }
  source.store.save();await listen();
  const stop=async()=>{source.eventSuggestions.close();source.control.close();source.push.close();await source.browsers.close();await new Promise(resolve=>server.close(resolve));};
  const f={dir,calls,control,tokens,get store(){return source.store;},get service(){return source.eventSuggestions;},get school(){return source.school;},get audit(){return source.audit;},now:()=>now,setNow:value=>{now=value;},
    async request(route,data,user='a',origin='http://127.0.0.1'){
      const response=await fetch('http://127.0.0.1:'+server.address().port+'/agenda/api/'+route,{headers:{cookie:cookies[user]||'',origin,...(data===undefined?{}:{'Content-Type':'application/json'})},...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),signal:AbortSignal.timeout(5000)});
      return {status:response.status,body:await response.json(),headers:response.headers};
    },
    async feed(user='a'){const response=await fetch('http://127.0.0.1:'+server.address().port+'/agenda/calendars/'+tokens[user]+'.ics');return {status:response.status,body:await response.text()};},
    async enable(settings={news:true,messages:true},user='a'){return this.request('event-suggestions/settings',{accountId:user,...settings},user);},
    async scan(user='a'){return this.request('event-suggestions/scan',{accountId:user},user);},
    async accept(item,changes={},user='a'){return this.request('event-suggestions/'+item.id+'/accept',{accountId:user,revision:item.revision,title:item.title,date:item.date,startTime:item.startTime||'',endTime:item.endTime||'',allDay:item.allDay,location:'Salle polyvalente',...changes},user);},
    async restart(){await stop();source=create();await listen();},
    async close(){await stop();fs.rmSync(dir,{recursive:true,force:true});}
  };return f;
}

test('event discovery is opt-in and read-only reads require the owner session',async()=>{
  const f=await fixture();try{
    assert.equal((await f.request('event-suggestions',undefined,'anonymous')).status,401);
    const initial=await f.request('event-suggestions');assert.equal(initial.status,200);assert.equal(initial.headers.get('cache-control'),'no-store');assert.deepEqual(initial.body.settings,{news:false,messages:false,personal:false});assert.deepEqual(initial.body.items,[]);
    assert.equal((await f.request('event-suggestions',undefined,'offline')).body.connected,false);
    await f.service.tick();await f.scan();assert.equal(f.calls.news+f.calls.folders+f.calls.opened,0);
    assert.equal((await f.request('event-suggestions/settings',{accountId:'a',news:true,messages:false},'a','https://foreign.invalid')).status,403);
    assert.equal((await f.request('event-suggestions/settings',{accountId:'b',news:true,messages:false})).status,409);
    assert.equal((await f.request('event-suggestions/settings',{accountId:'a',news:true,messages:false,admin:true})).status,400);
    assert.equal((await f.request('event-suggestions/settings',{accountId:'a',news:'true',messages:false})).status,400);
    assert.equal(f.calls.news+f.calls.folders,0);
  }finally{await f.close();}
});

test('discovery reads article text and inbox excerpts without opening mail or modifying an agenda',async()=>{
  const f=await fixture();try{
    f.control.news.push({...entry('menu'),title:'Menus du 2 au 6 novembre 2026'},entry('invalid','<p>Rencontre le 31 novembre 2026 à 9h.</p>'));
    const response=await f.enable();assert.equal(response.status,200);assert.equal(response.body.items.length,2);assert.equal(f.calls.opened,0);
    const news=response.body.items.find(item=>item.source.kind==='news'),message=response.body.items.find(item=>item.source.kind==='message');
    assert.deepEqual([news.date,news.startTime,news.endTime],['2026-11-05','18:30','20:00']);assert.deepEqual([message.date,message.startTime,message.endTime],['2026-11-12','09:00','11:00']);
    assert.equal(response.body.sources.messages.partial,true);assert.equal(f.store.user('a').cachedICS,emptyCalendar);assert.deepEqual(response.body.events,[]);
    assert.equal('raw'in news,false);assert.equal('sourceKey'in news,false);assert.ok(!f.store.user('a').eventSuggestionsState.includes('Rencontre des clubs'));assert.ok(!JSON.stringify(f.audit.query()).includes('Sortie au musée'));
    const source=await f.request('event-suggestions/'+message.id+'/source',{accountId:'a'});assert.equal(source.status,200);assert.equal(source.body.kind,'message');assert.equal(f.calls.opened,1);assert.ok(!JSON.stringify(source.body).includes('tracking.invalid'));assert.ok(!JSON.stringify(source.body).includes('badSource'));
    const previousIds=response.body.items.map(item=>item.id).sort();assert.deepEqual((await f.scan()).body.items.map(item=>item.id).sort(),previousIds);assert.equal(f.calls.opened,1);
    assert.equal((await f.request('status')).body.user.eventSuggestions.pending,2);
  }finally{await f.close();}
});

test('confirmation validates revisions and times then publishes one stable event to the private ICS and agenda',async()=>{
  const f=await fixture();try{
    const item=(await f.enable({news:true,messages:false})).body.items[0];
    const missing={accountId:'a',title:item.title,date:item.date,startTime:'18:30',endTime:'20:00',allDay:false,location:''};
    assert.ok([400,409].includes((await f.request('event-suggestions/'+item.id+'/accept',missing)).status));
    assert.equal((await f.accept(item,{revision:'0'.repeat(64)})).status,409);
    for(const changes of [{date:'2026-02-31'},{date:'2026-10-20'},{date:'2029-11-01'},{date:['2026-11-05']},{endTime:'18:00'},{startTime:'24:00'},{title:' '},{title:{value:'Titre'}},{location:null},{allDay:'yes'},{allDay:null},{userId:'b'}])assert.equal((await f.accept(item,changes)).status,400,JSON.stringify(changes));
    assert.equal(f.store.user('a').cachedICS,emptyCalendar);
    const accepted=await f.accept(item);assert.equal(accepted.status,200);assert.equal(accepted.body.items[0].status,'accepted');assert.equal(accepted.body.events.length,1);
    const published=await f.feed();assert.equal(published.status,200);const [event]=eventsOf(published.body);assert.equal(event.summary,item.title);assert.equal(event.startDate.toString(),'2026-11-05T17:30:00Z');assert.equal(event.endDate.toString(),'2026-11-05T19:00:00Z');
    const week=weekView(f.store.user('a'),'2026-11-05',f.now());assert.equal(week.days.find(day=>day.date==='2026-11-05').events.length,1);assert.equal(week.days.find(day=>day.date==='2026-11-05').courses.length,0);
    const snapshot=f.store.user('a').cachedICS;assert.equal((await f.accept(item)).status,200);assert.equal(f.store.user('a').cachedICS,snapshot);assert.equal(eventsOf(snapshot).length,1);
    assert.equal((await f.request('event-suggestions/'+item.id+'/dismiss',{accountId:'a',revision:item.revision})).status,409);
    assert.ok([400,409].includes((await f.request('event-suggestions/'+item.id+'/remove',{accountId:'a'})).status));
    const removed=await f.request('event-suggestions/'+item.id+'/remove',{accountId:'a',revision:item.revision});assert.equal(removed.status,200);assert.equal(removed.body.events.length,0);assert.equal(eventsOf((await f.feed()).body).length,0);
  }finally{await f.close();}
});

test('date-only proposals require explicit all-day confirmation and ignored proposals survive restart',async()=>{
  const f=await fixture();try{
    f.control.news=[entry('date-only','<p>La journée des associations aura lieu le 13 novembre 2026.</p>')];
    let item=(await f.enable({news:true,messages:false})).body.items[0];assert.equal(item.startTime,null);assert.equal(item.endTime,null);assert.equal(item.allDay,true);
    assert.equal((await f.accept(item,{allDay:false})).status,400);
    assert.equal((await f.accept(item,{allDay:true,startTime:'',endTime:''})).status,200);const [event]=eventsOf((await f.feed()).body);assert.equal(event.startDate.isDate,true);assert.equal(event.startDate.toString(),'2026-11-13');assert.equal(event.endDate.toString(),'2026-11-14');
    await f.request('event-suggestions/'+item.id+'/remove',{accountId:'a',revision:item.revision});await f.restart();
    item=(await f.scan()).body.items.find(value=>value.id===item.id);assert.equal(item.status,'dismissed');assert.equal((await f.request('status')).body.user.eventSuggestions.pending,0);assert.equal(f.calls.opened,0);
  }finally{await f.close();}
});

test('an edited source preserves an accepted event until the latest suggestion is confirmed',async()=>{
  const f=await fixture();try{
    const item=(await f.enable({news:true,messages:false})).body.items[0];await f.accept(item);const original=f.store.user('a').cachedICS;
    f.setNow(f.now()+3600001);f.control.news=[entry('article-a','<p>La rencontre est reportée au 6 novembre 2026 de 19h à 20h30.</p>')];
    const changed=(await f.scan()).body.items.find(value=>value.id===item.id);assert.ok(changed);assert.equal(changed.status,'accepted');assert.equal(changed.changed,true);assert.equal(changed.date,'2026-11-06');assert.notEqual(changed.revision,item.revision);assert.equal(f.store.user('a').cachedICS,original);
    assert.equal((await f.accept(item)).status,409);assert.equal((await f.accept(changed)).status,200);const [event]=eventsOf((await f.feed()).body);assert.equal(event.uid,eventsOf(original)[0].uid);assert.equal(event.startDate.toString(),'2026-11-06T18:00:00Z');assert.equal(event.sequence,1);
  }finally{await f.close();}
});

test('multi-date source identities remain stable when the earliest date becomes past',async()=>{
  const f=await fixture();try{
    f.control.news=[entry('two-dates','<p>Première rencontre le 5 novembre 2026 de 9h à 10h.</p><p>Deuxième rencontre le 6 novembre 2026 de 14h à 15h.</p>')];
    const initial=(await f.enable({news:true,messages:false})).body.items;assert.equal(initial.length,2);const first=initial.find(item=>item.date==='2026-11-05'),second=initial.find(item=>item.date==='2026-11-06');await f.accept(first);
    f.setNow(Date.parse('2026-11-06T08:00:00Z'));const items=(await f.scan()).body.items;const remaining=items.filter(item=>item.date==='2026-11-06');assert.equal(remaining.length,1);assert.equal(remaining[0].id,second.id);assert.equal(remaining[0].status,'pending');assert.equal(items.find(item=>item.id===first.id).date,'2026-11-05');assert.equal(eventsOf((await f.feed()).body)[0].startDate.toString(),'2026-11-05T08:00:00Z');
  }finally{await f.close();}
});

test('proposals, source opening and accepted events are isolated by account and selected pupil',async()=>{
  const f=await fixture();try{
    const item=(await f.enable({news:true,messages:false})).body.items[0];await f.accept(item);
    assert.deepEqual((await f.request('event-suggestions',undefined,'b')).body.items,[]);assert.equal((await f.accept(item,{},'b')).status,404);assert.equal((await f.request('event-suggestions/'+item.id+'/source',{accountId:'b'},'b')).status,404);assert.equal(eventsOf((await f.feed('b')).body).length,0);
    const change=await f.request('student',{studentId:'other-a'});assert.equal(change.status,200);
    const after=(await f.request('event-suggestions')).body;assert.deepEqual(after.items,[]);assert.deepEqual(after.events,[]);assert.deepEqual(after.settings,{news:false,messages:false,personal:false});assert.equal((await f.accept(item)).status,404);assert.equal(weekView(f.store.user('a'),'2026-11-05',f.now()).days.flatMap(day=>day.events).length,0);
  }finally{await f.close();}
});

test('unavailable or failing sources retain proposals and never expose underlying source errors',async()=>{
  const f=await fixture();try{
    const initial=(await f.enable()).body;f.control.failNews=Object.assign(new Error('PRIVATE SOURCE TOKEN'),{status:503});f.control.failMessages=Object.assign(new Error('PRIVATE SOURCE EMAIL'),{status:503});
    const transient=(await f.scan()).body;assert.deepEqual(transient.items,initial.items);assert.equal(transient.sources.news.state,'error');assert.equal(transient.sources.messages.state,'error');assert.ok(transient.warning);assert.ok(!JSON.stringify(transient).includes('PRIVATE SOURCE'));
    f.control.failNews=Object.assign(new Error('NOT AVAILABLE'),{status:403});f.control.failMessages=Object.assign(new Error('NOT AVAILABLE'),{status:404});const unavailable=(await f.scan()).body;assert.equal(unavailable.sources.news.state,'unavailable');assert.equal(unavailable.sources.messages.state,'unavailable');assert.deepEqual(unavailable.items,initial.items);
    f.control.failNews=null;f.control.failMessages=null;const context=f.school.context(f.store.user('a'));context.capabilities={features:{news:{state:'unavailable'},messages:{state:'unavailable'}}};const calls=f.calls.news+f.calls.messages;await f.scan();assert.equal(f.calls.news+f.calls.messages,calls);
  }finally{await f.close();}
});

test('inbox threads without available excerpts do not trigger implicit full-message reading',async()=>{
  const f=await fixture();try{
    f.control.messages=[{id:'mail-no-body',subject:'Votre réunion',read:false,participationsNumber:4,firstParticipationContent:'Réunion le 15 novembre 2026 à 9h.',lastParticipation:{dateTime:publication}}];
    const result=(await f.enable({news:false,messages:true})).body;assert.deepEqual(result.items,[]);assert.equal(result.sources.messages.partial,true);assert.equal(f.calls.opened,0);
  }finally{await f.close();}
});

test('an ENT out-of-range final page preserves the valid first page',async()=>{
  const f=await fixture();try{
    f.control.news=Array.from({length:20},(_,index)=>entry('article-'+index));f.control.exactPage=true;
    const result=(await f.enable({news:true,messages:false})).body;assert.equal(result.sources.news.state,'available');assert.equal(result.items.length,20);assert.equal(f.calls.news,2);assert.equal(result.warning,null);
  }finally{await f.close();}
});

test('a source replacement during a scan rejects late results without writing proposals for the new source',async()=>{
  const f=await fixture();let release;try{
    let entered;const enteredPromise=new Promise(resolve=>{entered=resolve;});f.control.entered=entered;f.control.gate=new Promise(resolve=>{release=resolve;});const user=f.store.user('a');f.service.settings(user,{news:true,messages:false});
    const pending=f.service.scan(user);await enteredPromise;f.store.update('a',{skolengoConnectionId:'replacement-connection'});release();await assert.rejects(pending,/connexion|élève|actualisez/i);assert.deepEqual(f.service.public(user).items,[]);assert.equal(f.calls.opened,0);
  }finally{release?.();await f.close();}
});

test('disabling discovery during an in-flight scan keeps consent disabled and discards late suggestions',async()=>{
  const f=await fixture();let release;try{
    let entered;const enteredPromise=new Promise(resolve=>{entered=resolve;});f.control.entered=entered;f.control.gate=new Promise(resolve=>{release=resolve;});const user=f.store.user('a');f.service.settings(user,{news:true,messages:false});
    const pending=f.service.scan(user);await enteredPromise;f.service.settings(user,{news:false,messages:false,personal:false});release();await pending;const result=f.service.public(user);assert.deepEqual(result.settings,{news:false,messages:false,personal:false});assert.deepEqual(result.items,[]);assert.equal(result.checkedAt,null);
  }finally{release?.();await f.close();}
});

test('background discovery respects source consent, interval, suspended accounts and the admin pause',async()=>{
  const f=await fixture();try{
    const a=f.store.user('a'),b=f.store.user('b');f.service.settings(a,{news:true,messages:false});f.service.settings(b,{news:true,messages:false});b.suspendedAt=f.now();
    f.store.state.settings.automationPaused={ent:true};await f.service.tick();assert.equal(f.calls.news,0);
    f.store.state.settings.automationPaused.ent=false;await f.service.tick();assert.equal(f.calls.news,1);assert.deepEqual(f.calls.accounts,['a']);const seq=a.eventSuggestionsSeq;await f.service.tick();assert.equal(f.calls.news,1);
    f.setNow(f.now()+10*60000);await f.service.tick();assert.equal(f.calls.news,2);assert.equal(a.eventSuggestionsSeq,seq);assert.equal(f.calls.opened,0);
  }finally{await f.close();}
});

test('accepting while a scan is pending preserves the confirmation and its calendar event',async()=>{
  const f=await fixture();let release;try{
    const item=(await f.enable({news:true,messages:false})).body.items[0];
    let entered;const enteredPromise=new Promise(resolve=>{entered=resolve;});f.control.entered=entered;f.control.gate=new Promise(resolve=>{release=resolve;});
    const pending=f.service.scan(f.store.user('a'));await enteredPromise;
    const accepted=await f.accept(item);assert.equal(accepted.status,200);const published=f.store.user('a').cachedICS;
    release();await pending;const result=f.service.public(f.store.user('a'));assert.equal(result.items[0].status,'accepted');assert.equal(result.items[0].changed,false);assert.equal(result.events.length,1);assert.equal(f.store.user('a').cachedICS,published);
  }finally{release?.();await f.close();}
});

test('editing unrelated article text does not resurrect a dismissed occurrence',async()=>{
  const f=await fixture();try{
    const item=(await f.enable({news:true,messages:false})).body.items[0];const ignored=await f.request('event-suggestions/'+item.id+'/dismiss',{accountId:'a',revision:item.revision});assert.equal(ignored.status,200);
    f.setNow(f.now()+3600001);f.control.news=[entry('article-a','<p>La rencontre aura lieu jeudi 5 novembre 2026 de 18 h 30 à 20h00.</p><p>Une précision complémentaire sur les clubs.</p>')];
    const result=(await f.scan()).body;const same=result.items.find(value=>value.id===item.id);assert.equal(same.status,'dismissed');assert.equal(f.service.summary(f.store.user('a')).pending,0);assert.deepEqual(f.store.user('a').eventNoticeQueue,[]);
  }finally{await f.close();}
});

test('a personally corrected date, time, title and location remain available separately from source guesses',async()=>{
  const f=await fixture();try{
    const item=(await f.enable({news:true,messages:false})).body.items[0];const correction={date:'2026-11-08',title:'Mon rendez-vous avec les clubs',startTime:'10:30',endTime:'11:00',allDay:false,location:'Salle A12'};
    const accepted=await f.accept(item,correction);assert.equal(accepted.status,200);let value=accepted.body.items.find(value=>value.id===item.id);assert.deepEqual(value.confirmed,correction);assert.equal(value.date,'2026-11-05');
    await f.restart();value=(await f.scan()).body.items.find(value=>value.id===item.id);assert.deepEqual(value.confirmed,correction);const [event]=eventsOf((await f.feed()).body);assert.equal(event.summary,correction.title);assert.equal(event.location,'Salle A12');assert.equal(event.startDate.toString(),'2026-11-08T09:30:00Z');
    const week=weekView(f.store.user('a'),'2026-11-08',f.now());assert.equal(week.days.find(day=>day.date===correction.date).events[0].title,correction.title);assert.equal(week.days.find(day=>day.date===item.date).events.length,0);
  }finally{await f.close();}
});

test('accepted events remain removable after many newer suggestions arrive',async()=>{
  const f=await fixture();try{
    const schedule=first=>Array.from({length:5},(_,index)=>`<p>Rencontre le ${first+index} novembre 2026 de 9h à 10h.</p>`).join('');
    f.control.news=Array.from({length:20},(_,index)=>entry('initial-'+index,schedule(1)));
    const first=(await f.enable({news:true,messages:false})).body.items[0];assert.equal((await f.accept(first)).status,200);
    f.control.news=Array.from({length:20},(_,index)=>entry('new-'+index,schedule(15)));await f.scan();
    const result=await f.request('event-suggestions/'+first.id+'/remove',{accountId:'a',revision:first.revision});assert.equal(result.status,200);assert.equal(result.body.events.some(event=>event.id===first.id),false);const event=eventsOf((await f.feed()).body).find(value=>value.uid.startsWith(first.id));assert.equal(event,undefined);
  }finally{await f.close();}
});
