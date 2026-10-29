import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ICAL from 'ical.js';
import {controlFixture} from './control-fixture.js';
import {digest} from '../src/store.js';
import {weekView} from '../src/planner.js';

const NOW=Date.parse('2026-10-29T12:00:00Z');
const GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const MICROSOFT='11111111-2222-3333-4444-555555555555';
const SENDER='direction@lycee.invalid';
const SECRET='fixture-only-oauth-client-secret';
const PRIVATE_SENTENCE='Consigne privée de la messagerie de Camille.';
const eventsOf=ics=>new ICAL.Component(ICAL.parse(ics)).getAllSubcomponents('vevent').map(component=>new ICAL.Event(component));

function gmailMessage(id='same-provider-local-id',title='Rencontre orientation personnelle',body='Réunion le 5 novembre 2026 de 18h à 19h. '+PRIVATE_SENTENCE) {
  return {id,internalDate:String(NOW-3600000),labelIds:['INBOX','UNREAD'],payload:{mimeType:'multipart/alternative',headers:[{name:'Subject',value:title},{name:'From',value:'La direction <'+SENDER+'>'}],parts:[{mimeType:'text/plain',body:{data:Buffer.from(body).toString('base64url')}},{mimeType:'text/html',body:{data:Buffer.from('<p>Le texte alternatif ne doit pas remplacer la consigne.</p><img src="https://tracking.invalid/pixel">').toString('base64url')}}]}};
}
function graphMessage(id='same-provider-local-id') {
  return {id,subject:'Sortie personnelle Outlook',from:{emailAddress:{address:SENDER}},receivedDateTime:new Date(NOW-3600000).toISOString(),isRead:false,body:{contentType:'html',content:'<p>Sortie le 12 novembre 2026 de 9h à 11h.</p><script>privateSourceAttack()</script><img src="https://tracking.invalid/pixel">'},bodyPreview:'Sortie scolaire'};
}

async function fixture() {
  const f=await controlFixture();f.setNow(NOW);
  const calls=[],tokens=new Map(),secrets=new Set([SECRET]),control={readGate:null,readEntered:null,profileAddresses:{},mailboxes:{camille:{gmail:[gmailMessage()],outlook:[graphMessage()]},nina:{gmail:[gmailMessage('nina-message','Rencontre personnelle de Nina')],outlook:[graphMessage('nina-outlook')]}},news:[{id:'ent-news-fixture',title:'Rencontre des clubs ENT',content:'Les clubs se retrouvent le 19 novembre 2026 de 16h à 17h.',publicationDateTime:new Date(NOW-3600000).toISOString(),school:{id:'school'}}]};
  f.school.clientFactory=async()=>({getSchoolInfos:async({page})=>page.offset?[]:structuredClone(control.news),getSchoolInfo:async id=>structuredClone(control.news.find(value=>value.id===id))});
  const request=async input=>{
    const url=new URL(input.url),provider=['login.microsoftonline.com','graph.microsoft.com'].includes(url.hostname)?'outlook':'gmail',method=input.method||'GET';
    assert.ok(['oauth2.googleapis.com','gmail.googleapis.com','login.microsoftonline.com','graph.microsoft.com'].includes(url.hostname),'all OAuth and mail traffic stays on the fixed fake provider allowlist');
    if(url.pathname.endsWith('/token')) {
      const body=new URLSearchParams(input.body),code=body.get('code')||'',who=code.split('/')[2];assert.equal(body.get('grant_type'),'authorization_code');assert.ok(['camille','nina'].includes(who));
      const access=provider+'-fixture-private-access-'+who+'-'+calls.length,refresh=provider+'-fixture-private-refresh-'+who+'-'+calls.length;tokens.set(access,{provider,who});secrets.add(access);secrets.add(refresh);secrets.add(code);calls.push({kind:'token',provider,who,method});
      return {access_token:access,refresh_token:refresh,expires_in:3600,scope:provider==='gmail'?GMAIL_SCOPE:'Mail.Read User.Read'};
    }
    const identity=tokens.get(String(input.headers?.Authorization||'').replace(/^Bearer /,''));assert.ok(identity,'provider requests use a token created in this fixture');assert.equal(identity.provider,provider);
    const who=identity.who;
    if(url.pathname.endsWith('/profile')||url.pathname==='/v1.0/me') {
      calls.push({kind:'profile',provider,who,method});const address=control.profileAddresses[who+':'+provider]||who+'@'+provider+'.invalid';
      return provider==='gmail'?{emailAddress:address}:{id:'outlook-subject-'+who,mail:address};
    }
    if(url.pathname.endsWith('/messages')) {
      calls.push({kind:'list',provider,who,method,url:url.href});const messages=control.mailboxes[who][provider];
      return provider==='gmail'?{messages:messages.map(({id})=>({id}))}:{value:messages.map(({id,subject,from,receivedDateTime,bodyPreview})=>({id,subject,from,receivedDateTime,bodyPreview}))};
    }
    if(/\/messages\//.test(url.pathname)) {
      const id=decodeURIComponent(url.pathname.split('/').at(-1));calls.push({kind:'read',provider,who,method,id,prefer:input.headers.Prefer||''});
      control.readEntered?.({provider,who,id});if(control.readGate)await control.readGate;
      const message=control.mailboxes[who][provider].find(value=>value.id===id);assert.ok(message,'only fixture messages are accessible');return structuredClone(message);
    }
    throw new Error('Unexpected OAuth or mailbox request in fixture.');
  };
  f.personalMail.request=request;
  const baseRequest=f.request.bind(f);
  Object.assign(f,{control,providerCalls:calls,secrets,
    user:id=>f.store.user(id),
    async configure(provider='gmail',enabled=true) {return baseRequest('admin/personal-mail/'+provider,{clientId:provider==='gmail'?'integration.apps.googleusercontent.com':MICROSOFT,clientSecret:SECRET,enabled},'owner');},
    async connect(provider='gmail',who='camille') {
      if(!f.personalMail.ready(provider))assert.equal((await this.configure(provider)).status,200);
      const started=await baseRequest('personal-mail/'+provider+'/connect',{accountId:who},who);assert.equal(started.status,200);
      const state=new URL(started.body.authorizationURL).searchParams.get('state'),session=f.store.state.sessions.find(value=>value.userId===who&&value.hash===digest(f.cookies[who].split('=')[1]));assert.ok(session);
      await f.personalMail.callback({user:f.store.user(who),session},provider,{state,code:'fixture-code/'+provider+'/'+who});return f.personalMail.connection(f.store.user(who),provider);
    },
    async choices(provider='gmail',enabled=true,senders=[SENDER],who='camille') {return baseRequest('personal-mail/'+provider+'/preferences',{accountId:who,enabled,senders},who);},
    async enable(settings={news:false,messages:false,personal:true},who='camille') {return baseRequest('event-suggestions/settings',{accountId:who,...settings},who);},
    async scan(who='camille') {return baseRequest('event-suggestions/scan',{accountId:who},who);},
    async accept(item,who='camille') {return baseRequest('event-suggestions/'+item.id+'/accept',{accountId:who,revision:item.revision,title:item.title,date:item.date,startTime:item.startTime||'',endTime:item.endTime||'',allDay:item.allDay,location:'Salle de réunion'},who);},
    async source(item,who='camille') {return baseRequest('event-suggestions/'+item.id+'/source',{accountId:who},who);},
    async feed(who='camille') {const response=await fetch(f.root+'/calendars/'+f.feedTokens[who]+'.ics');assert.equal(response.status,200);return response.text();}
  });
  const close=f.close.bind(f);f.close=async()=>{f.personalMail.close();f.eventSuggestions.close();f.server.closeAllConnections();await close();};
  return f;
}

test('personal event discovery needs global consent, an enabled provider and selected senders before reading mail',async()=>{
  const f=await fixture();try {
    await f.connect();assert.equal(f.providerCalls.filter(call=>['list','read'].includes(call.kind)).length,0);
    assert.equal((await f.choices('gmail',true)).status,200);await f.scan();assert.equal(f.providerCalls.filter(call=>call.kind==='list').length,0,'global event discovery remains disabled');
    assert.equal((await f.choices('gmail',false,[])).status,200);await f.enable();assert.equal(f.providerCalls.filter(call=>call.kind==='list').length,0,'an authorized account is not automatically enrolled in scanning');
    assert.equal((await f.choices('gmail',true,[])).status,400);await f.scan();assert.equal(f.providerCalls.filter(call=>call.kind==='list').length,0,'no selected sender means no reads');
    const connection=f.personalMail.connection(f.user('camille'),'gmail'),value=f.personalMail.open(connection);connection.sealed=f.store.seal({...value,enabled:true,senders:[]});f.store.save();await f.scan();assert.equal(f.providerCalls.filter(call=>call.kind==='list').length,0,'legacy or corrupted empty selection cannot bypass the guard');
    assert.equal((await f.choices()).status,200);const result=await f.scan();assert.equal(result.status,200);assert.equal(result.body.items.length,1);assert.equal(f.providerCalls.filter(call=>call.kind==='list').length,1);
    assert.ok(f.providerCalls.find(call=>call.kind==='list').url.includes('direction%40lycee.invalid'));assert.equal(eventsOf(await f.feed()).length,0,'detected events never enter ICS without confirmation');
  }finally {await f.close();}
});

test('Gmail OAuth connection, selected message, explicit source and confirmed event reach the same private ICS',async()=>{
  const f=await fixture();try {
    const connection=await f.connect();await f.choices();const result=await f.enable();assert.equal(result.status,200);const [item]=result.body.items;
    assert.equal(item.source.kind,'personal-mail');assert.equal(item.source.provider,'gmail');assert.equal(item.date,'2026-11-05');assert.equal(item.startTime,'18:00');assert.equal(item.endTime,'19:00');assert.equal(item.status,'pending');assert.equal(item.raw,undefined);assert.equal(eventsOf(await f.feed()).length,0);
    const detail=await f.source(item);assert.equal(detail.status,200);assert.equal(detail.body.kind,'message');assert.ok(detail.body.items[0].text.includes(PRIVATE_SENTENCE));assert.deepEqual(detail.body.items[0].files,[]);
    const accepted=await f.accept(item);assert.equal(accepted.status,200);assert.equal(accepted.body.items[0].status,'accepted');const [event]=eventsOf(await f.feed());assert.equal(event.summary,item.title);assert.equal(event.startDate.toString(),'2026-11-05T17:00:00Z');assert.equal(event.endDate.toString(),'2026-11-05T18:00:00Z');assert.ok(event.description.includes('mail personnel'));
    assert.equal(weekView(f.user('camille'),'2026-11-05',f.now()).days.find(day=>day.date===item.date).events[0].id,item.id);
    const reread=await f.scan();assert.equal(reread.body.items.length,1);assert.equal(reread.body.items[0].id,item.id);assert.equal(reread.body.items[0].status,'accepted');assert.equal(eventsOf(await f.feed()).length,1);
    assert.ok(f.providerCalls.filter(call=>call.kind!=='token').every(call=>call.method==='GET'),'source and scan never modify read state or send messages');assert.equal(f.control.mailboxes.camille.gmail[0].labelIds.includes('UNREAD'),true);assert.equal(f.calls.mail.length,0);
    const raw=f.store.open(f.user('camille').eventSuggestionsState).items[0].raw;assert.equal(JSON.parse(raw).connectionId,connection.id);
  }finally {await f.close();}
});

test('Gmail and Outlook occurrences with the same provider-local ID stay distinct and isolated from other users',async()=>{
  const f=await fixture();try {
    await f.connect();await f.connect('outlook');await f.choices();await f.choices('outlook');const initial=(await f.enable()).body;assert.equal(initial.items.length,2);
    const gmail=initial.items.find(item=>item.source.provider==='gmail'),outlook=initial.items.find(item=>item.source.provider==='outlook');assert.notEqual(gmail.id,outlook.id);assert.equal((await f.source(outlook)).status,200);assert.equal(f.control.mailboxes.camille.outlook[0].isRead,false);
    assert.ok(f.providerCalls.filter(call=>call.provider==='outlook'&&call.kind==='read').every(call=>call.prefer.includes('ImmutableId')&&call.prefer.includes('text')));
    assert.equal((await f.accept(gmail)).status,200);assert.equal((await f.accept(outlook)).status,200);assert.equal(eventsOf(await f.feed()).length,2);
    assert.deepEqual((await f.request('event-suggestions',undefined,'nina')).body.items,[]);assert.equal((await f.source(gmail,'nina')).status,404);assert.equal((await f.accept(outlook,'nina')).status,404);assert.equal(eventsOf(await f.feed('nina')).length,0);
    await f.connect('gmail','nina');await f.choices('gmail',true,[SENDER],'nina');const nina=(await f.enable(undefined,'nina')).body;assert.equal(nina.items.length,1);assert.notEqual(nina.items[0].id,gmail.id);assert.equal(nina.items[0].title,'Rencontre personnelle de Nina');assert.equal((await f.source(nina.items[0],'camille')).status,404);
  }finally {await f.close();}
});

test('disconnect purges pending personal content and source references while preserving an explicitly confirmed event',async()=>{
  const f=await fixture();try {
    f.control.mailboxes.camille.gmail.push(gmailMessage('another-message','Autre réunion personnelle','Le rendez-vous est le 6 novembre 2026 de 10h à 11h. AUTRE EXTRAIT PRIVÉ.'));
    await f.connect();await f.choices();const initial=(await f.enable()).body.items;assert.equal(initial.length,2);const confirmed=initial.find(item=>item.date==='2026-11-05'),pending=initial.find(item=>item.date==='2026-11-06');await f.accept(confirmed);const original=await f.feed();
    const disconnected=await f.request('personal-mail/gmail/disconnect',{accountId:'camille'},'camille');assert.equal(disconnected.status,200);assert.equal(disconnected.body.providers.find(value=>value.provider==='gmail').connected,false);
    const result=(await f.request('event-suggestions',undefined,'camille')).body;assert.equal(result.items.length,1);assert.equal(result.items[0].id,confirmed.id);assert.equal(result.items[0].excerpt,'');assert.equal(result.items.some(value=>value.id===pending.id),false);assert.deepEqual(f.user('camille').eventNoticeQueue,[]);
    const stored=f.store.open(f.user('camille').eventSuggestionsState).items[0];assert.equal(stored.raw,null);assert.equal(stored.excerpt,'');assert.equal(stored.source.title,'Mail personnel déconnecté');assert.equal((await f.source(confirmed)).status,410);assert.equal(await f.feed(),original,'disconnect does not silently cancel a personally confirmed appointment');
    const removed=await f.request('event-suggestions/'+confirmed.id+'/remove',{accountId:'camille',revision:result.items[0].revision},'camille');assert.equal(removed.status,200);assert.equal(eventsOf(await f.feed()).length,0);
    const count=f.providerCalls.length;await f.scan();assert.equal(f.providerCalls.length,count,'no provider requests continue after disconnect');
  }finally {await f.close();}
});

test('older event-source settings without personal keep the existing personal choice',async()=>{
  const f=await fixture();try {
    await f.connect();await f.choices();await f.enable();const saved=await f.enable({news:false,messages:false});assert.equal(saved.status,200);assert.equal(saved.body.settings.personal,true);
    const checked=(await f.request('event-suggestions',undefined,'camille')).body;assert.equal(checked.settings.personal,true);assert.equal(checked.items.filter(item=>item.source.kind==='personal-mail').length,1);
  }finally {await f.close();}
});

test('disabling a personal provider during collection discards late personal results and preserves ENT news',async()=>{
  const f=await fixture();let release;try {
    await f.connect();await f.choices();const user=f.user('camille');f.eventSuggestions.settings(user,{news:true,messages:false,personal:true});
    let entered;const began=new Promise(resolve=>{entered=resolve;});f.control.readEntered=entered;f.control.readGate=new Promise(resolve=>{release=resolve;});
    const scan=f.eventSuggestions.scan(user);await began;assert.equal((await f.choices('gmail',false,[SENDER])).status,200);release();const result=await scan;
    assert.equal(result.items.filter(item=>item.source.kind==='personal-mail').length,0);assert.equal(result.items.filter(item=>item.source.kind==='news').length,1);assert.equal(result.items[0].title,'Rencontre des clubs ENT');assert.equal(result.settings.personal,true,'the global choice is independent of provider consent');assert.equal(f.personalMail.publicSettings(user).providers[0].enabled,false);
  }finally {release?.();await f.close();}
});

test('replacing the linked mailbox during collection rejects stale personal content without losing ENT results',async()=>{
  const f=await fixture();let release;try {
    const old=await f.connect();await f.choices();const user=f.user('camille');f.eventSuggestions.settings(user,{news:true,messages:false,personal:true});
    let entered;const began=new Promise(resolve=>{entered=resolve;});f.control.readEntered=entered;f.control.readGate=new Promise(resolve=>{release=resolve;});
    const scan=f.eventSuggestions.scan(user);await began;f.control.profileAddresses['camille:gmail']='nouvelle-boite@gmail.invalid';const replacement=await f.connect();assert.notEqual(replacement.id,old.id);release();const result=await scan;
    assert.equal(result.items.filter(item=>item.source.kind==='personal-mail').length,0);assert.equal(result.items.filter(item=>item.source.kind==='news').length,1);assert.equal(f.personalMail.publicSettings(user).providers[0].enabled,false,'a different mailbox requires fresh reading choices');assert.equal(f.personalMail.publicSettings(user).providers[0].address,'nouvelle-boite@gmail.invalid');
  }finally {release?.();await f.close();}
});

test('personal mailbox and event integration APIs remain session-bound and never disclose token or client secrets',async()=>{
  const f=await fixture();try {
    assert.equal((await f.request('personal-mail',undefined,'anonymous')).status,401);assert.equal((await f.request('admin/personal-mail',undefined,'camille')).status,403);assert.equal((await f.request('admin/personal-mail/gmail',{clientId:'fixture.apps.googleusercontent.com',clientSecret:SECRET,enabled:true},'camille')).status,403);
    await f.connect();await f.choices();const item=(await f.enable()).body.items[0];await f.source(item);await f.accept(item);
    assert.equal((await f.request('personal-mail/gmail/preferences',{accountId:'nina',enabled:true,senders:[SENDER]},'camille')).status,409);assert.equal((await f.request('personal-mail/gmail/preferences',{accountId:'camille',enabled:true,senders:[SENDER],url:'https://attacker.invalid'},'camille')).status,400);assert.equal((await f.request('personal-mail/gmail/disconnect',{accountId:'camille'},'camille','https://foreign.invalid')).status,403);
    const own=await f.request('personal-mail',undefined,'camille'),admin=await f.request('admin/personal-mail',undefined,'owner'),status=await f.request('status',undefined,'camille'),suggestions=await f.request('event-suggestions',undefined,'camille');assert.equal(own.headers.get('cache-control'),'no-store');assert.equal(admin.body.providers[0].hasSecret,true);
    const publicValues=JSON.stringify([own.body,admin.body,status.body,suggestions.body]),audit=JSON.stringify(f.audit.query({limit:200})),state=fs.readFileSync(f.store.file,'utf8');
    for(const secret of f.secrets){assert.ok(!publicValues.includes(secret));assert.ok(!audit.includes(secret));assert.ok(!state.includes(secret),'provider credentials remain encrypted at rest');}
    assert.ok(!audit.includes(PRIVATE_SENTENCE));assert.ok(!audit.includes('Rencontre orientation personnelle'));assert.ok(!state.includes(PRIVATE_SENTENCE),'message excerpts are encrypted at rest');assert.equal(f.calls.mail.length,0);
  }finally {await f.close();}
});
