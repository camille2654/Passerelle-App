import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {controlFixture} from './control-fixture.js';
import {createApp} from '../src/server.js';
import {digest,random} from '../src/store.js';
import {renderCalendar} from '../src/ical.js';

const NOW=Date.parse('2026-11-04T12:00:00Z');
const ORIGIN='http://127.0.0.1',PARTNER='https://mon-ent.pages.dev';
const CALLBACK=PARTNER+'/passerelle/callback';
const SCOPES=['calendar:courses','calendar:homework','calendar:exams'];
const fresh=()=>randomBytes(32).toString('base64url');
const challenge=value=>createHash('sha256').update(value).digest('base64url');
const isFailure=result=>result.status>=400&&result.status<500;

function syntheticEvent(id,kind,title,extra={}){
 return {id,date:'2026-11-05',kind,title,rawTitle:title,created:NOW,modified:NOW,sequence:0,start:'2026-11-05T09:00:00Z',end:'2026-11-05T10:00:00Z',description:'Contenu synthétique '+kind,...extra};
}
async function fixture(){
 const f=await controlFixture();f.setNow(NOW);
 for(const user of f.store.state.users){
  user.enabled=true;user.lastSync=NOW;user.calendarFormatVersion=2;
  user.calendarEvents={course:syntheticEvent('course-'+user.id,'course','Cours autorisé '+user.id),cancelled:syntheticEvent('cancelled-'+user.id,'course','Cours annulé '+user.id,{cancelled:true})};
  user.taskCalendar={homework:syntheticEvent('homework-'+user.id,'homework','Devoir confidentiel '+user.id),exam:syntheticEvent('exam-'+user.id,'exam','Contrôle confidentiel '+user.id)};
  user.cachedICS=renderCalendar([...Object.values(user.calendarEvents),...Object.values(user.taskCalendar)]);
  user.feedETag='"'+digest(user.cachedICS)+'"';user.feedModifiedAt=NOW;
 }
 f.store.save();
 async function request(route,{body,who,origin,headers={},cookie='',method,form=false}={}){
  const address=/^https?:/.test(route)?new URL(route).pathname+new URL(route).search:route;
  const url=address.startsWith('/agenda/')?new URL(f.root).origin+address:f.root+address;
  const response=await fetch(url,{redirect:'manual',method:method||(body===undefined?'GET':'POST'),headers:{...(who?{cookie:f.cookies[who]||''}:{}),...(cookie?{cookie:[who?f.cookies[who]:'',cookie].filter(Boolean).join('; ')}:{}),...(origin!==undefined?{origin}:{}),...(body!==undefined?{'Content-Type':form?'application/x-www-form-urlencoded':'application/json'}:{}),...headers},...(body!==undefined?{body:form?new URLSearchParams(body):JSON.stringify(body)}:{})});
  const content=await response.text();let value;try{value=JSON.parse(content);}catch{value=content;}
  return {status:response.status,body:value,headers:response.headers};
 }
 async function authorize({who='camille',scope=SCOPES.join(' '),params={},cookie=''}={}){
  const verifier=fresh(),state=fresh(),query=new URLSearchParams({response_type:'code',client_id:'lapsus',redirect_uri:CALLBACK,state,scope,code_challenge:challenge(verifier),code_challenge_method:'S256',...params});
  const response=await request('/oauth/authorize?'+query,{who,cookie});
  const setCookies=response.headers.getSetCookie();
  const issued=setCookies.map(value=>value.split(';')[0]).find(value=>value.startsWith('passerelle_oauth='));
  const consentURL=response.headers.get('location'),requestId=consentURL?new URL(consentURL,f.root+'/').searchParams.get('request'):null;
  return {response,verifier,state,oauthCookie:issued||cookie,request:requestId,who,scope,consentURL};
 }
 async function consent(flow,{who=flow.who,origin=ORIGIN,cookie=flow.oauthCookie,...body}={}){
  return request('/api/oauth/consent',{who,origin,cookie,body:{request:flow.request,accountId:who,allow:true,scopes:flow.scope.split(' '),...body}});
 }
 async function token(flow,{origin=PARTNER,form=false,...body}={}){
  return request('/oauth/token',{origin,form,body:{grant_type:'authorization_code',client_id:'lapsus',redirect_uri:CALLBACK,code:flow.code,code_verifier:flow.verifier,...body}});
 }
 async function grant({who='camille',scope=SCOPES.join(' ')}={}){
  const flow=await authorize({who,scope});assert.equal(flow.response.status,302,JSON.stringify(flow.response.body));
  const approved=await consent(flow);assert.equal(approved.status,200,JSON.stringify(approved.body));
  const redirect=new URL(approved.body.redirectURL);flow.code=redirect.searchParams.get('code');
  assert.equal(redirect.origin,PARTNER);assert.equal(redirect.pathname,'/passerelle/callback');assert.equal(redirect.searchParams.get('state'),flow.state);assert.ok(flow.code);
  const exchanged=await token(flow);assert.equal(exchanged.status,200,JSON.stringify(exchanged.body));
  const calendars=await request('/api/partner/calendars',{origin:PARTNER,headers:{Authorization:'Bearer '+exchanged.body.access_token}});assert.equal(calendars.status,200,JSON.stringify(calendars.body));
  return {...flow,approved,exchanged,calendars:calendars.body.calendars};
 }
 const close=async()=>{f.partners?.close();f.server.closeAllConnections();await f.close();};
 return {...f,request,authorize,consent,token,grant,close};
}

test('partner authorization validates exact callback, state, scope and S256 before issuing any browser transaction',async()=>{
 const f=await fixture();try{
  for(const params of [
   {client_id:'unknown'},{response_type:'token'},{redirect_uri:CALLBACK+'/'},{redirect_uri:CALLBACK+'?next=https://outside.invalid'},{redirect_uri:PARTNER+'.outside.invalid/passerelle/callback'},{redirect_uri:'http://mon-ent.pages.dev/passerelle/callback'},
   {state:''},{state:'tiny'},{state:'x'.repeat(513)},{scope:'calendar:write'},{scope:'calendar:courses calendar:write'},{code_challenge_method:'plain'},{code_challenge:'short'},{code_challenge:'+'.repeat(43)}
  ]){
   const response=(await f.authorize({params})).response;assert.ok(isFailure(response),JSON.stringify(params)+' '+response.status);assert.equal(response.headers.get('location'),null,'invalid request must not redirect to its supplied URL');
  }
  const duplicate=await f.request('/oauth/authorize?'+new URLSearchParams({response_type:'code',client_id:'lapsus',redirect_uri:CALLBACK,state:fresh(),scope:'calendar:courses',code_challenge:challenge(fresh()),code_challenge_method:'S256'})+'&redirect_uri=https://outside.invalid');assert.ok(isFailure(duplicate));assert.equal(duplicate.headers.get('location'),null);
  const good=await f.authorize();assert.equal(good.response.status,302);assert.match(good.request,/^[A-Za-z0-9_-]{43}$/);assert.ok(good.oauthCookie);assert.match(good.response.headers.get('set-cookie'),/HttpOnly/i);assert.match(good.response.headers.get('set-cookie'),/SameSite=Lax/i);assert.equal(good.response.headers.get('cache-control'),'no-store');
  assert.ok(!good.consentURL.includes('code='));assert.ok(!good.consentURL.includes(f.feedTokens.camille));
 }finally{await f.close();}
});

test('consent is bound to its browser and authenticated account and never grants on a GET',async()=>{
 const f=await fixture();try{
  const flow=await f.authorize();assert.equal(flow.response.status,302);
  assert.equal((await f.request('/api/oauth/consent?request='+flow.request,{cookie:flow.oauthCookie})).status,401);
  assert.ok(isFailure(await f.request('/api/oauth/consent?request='+flow.request,{who:'camille'})));
  const view=await f.request('/api/oauth/consent?request='+flow.request,{who:'camille',cookie:flow.oauthCookie});assert.equal(view.status,200);assert.equal(view.body.request,flow.request);assert.deepEqual(view.body.requestedScopes.map(row=>row.id),SCOPES);assert.equal(view.body.available,true);assert.equal(view.body.account.id,'camille');
  const before=await f.request('/api/partners',{who:'camille'});assert.equal(before.status,200);assert.ok(!JSON.stringify(before.body).includes('Cours autorisé'));
  assert.ok(isFailure(await f.consent(flow,{cookie:''})));
  assert.equal((await f.consent(flow,{origin:PARTNER})).status,403);
  assert.ok(isFailure(await f.consent(flow,{accountId:'nina'})));
  const extra=await f.consent(flow,{scopes:['calendar:write']});assert.ok(isFailure(extra));
  const granted=await f.consent(flow,{scopes:['calendar:courses']});assert.equal(granted.status,200);const redirect=new URL(granted.body.redirectURL);assert.equal(redirect.origin,PARTNER);assert.equal(redirect.searchParams.get('state'),flow.state);assert.equal(redirect.searchParams.get('iss'),'http://127.0.0.1/agenda');
  assert.ok(!JSON.stringify(granted.body).includes(f.feedTokens.camille));assert.ok(!JSON.stringify(granted.body).includes('.ics'));assert.ok(!JSON.stringify(granted.body).includes('fixture-private-ent-token'));
  const reused=await f.consent(flow);assert.ok(isFailure(reused),'consent transaction is consumed');
 }finally{await f.close();}
});

test('refusal returns access_denied with original state and cannot later become a grant',async()=>{
 const f=await fixture();try{
  const flow=await f.authorize(),denied=await f.consent(flow,{allow:false,scopes:[]});assert.equal(denied.status,200);
  const redirect=new URL(denied.body.redirectURL);assert.equal(redirect.origin,PARTNER);assert.equal(redirect.searchParams.get('error'),'access_denied');assert.equal(redirect.searchParams.get('state'),flow.state);assert.equal(redirect.searchParams.get('code'),null);
  assert.ok(isFailure(await f.consent(flow)));
  const own=await f.request('/api/partners',{who:'camille'});assert.equal(own.status,200);assert.ok(!JSON.stringify(own.body).includes('.ics'));
 }finally{await f.close();}
});

test('the one-time authorization code requires the matching public client, callback and PKCE verifier',async()=>{
 const f=await fixture();try{
  for(const body of [{client_id:'other'},{redirect_uri:CALLBACK+'/'},{code_verifier:fresh()},{code_verifier:'short'}]){
   const flow=await f.authorize({scope:'calendar:courses'}),approved=await f.consent(flow);assert.equal(approved.status,200);flow.code=new URL(approved.body.redirectURL).searchParams.get('code');
   const refused=await f.token(flow,body);assert.ok(isFailure(refused),JSON.stringify(body));assert.equal(refused.body.access_token,undefined);
  }
  const flow=await f.authorize({scope:'calendar:courses'}),approved=await f.consent(flow);flow.code=new URL(approved.body.redirectURL).searchParams.get('code');
  const exchanged=await f.token(flow,{form:true});assert.equal(exchanged.status,200);assert.equal(exchanged.body.token_type,'Bearer');assert.equal(exchanged.body.expires_in,3600);assert.equal(exchanged.body.scope,'calendar:courses');assert.match(exchanged.body.access_token,/^[A-Za-z0-9_-]{43}$/);assert.equal(exchanged.body.refresh_token,undefined);assert.equal(exchanged.headers.get('cache-control'),'no-store');
  const authorization={Authorization:'Bearer '+exchanged.body.access_token},beforeReplay=await f.request('/api/partner/calendars',{headers:authorization});assert.equal(beforeReplay.status,200);const link=beforeReplay.body.calendars[0].url;assert.equal((await f.request(link)).status,200);
  const replay=await f.token(flow);assert.ok(isFailure(replay));assert.equal(replay.body.access_token,undefined);assert.equal((await f.request('/api/partner/calendars',{headers:authorization})).status,401,'replay revokes the token issued from this code');assert.equal((await f.request(link)).status,404,'replay revokes the corresponding feed capability');
  const raw=fs.readFileSync(f.store.file,'utf8');assert.ok(!raw.includes(flow.code));assert.ok(!raw.includes(exchanged.body.access_token));
  const logs=fs.readdirSync(path.join(f.dir,'logs')).filter(name=>name.endsWith('.jsonl')).map(name=>fs.readFileSync(path.join(f.dir,'logs',name),'utf8')).join('');for(const secret of [flow.code,flow.verifier,exchanged.body.access_token,f.feedTokens.camille])assert.ok(!logs.includes(secret));
 }finally{await f.close();}
});

test('a smaller explicit consent produces only the selected calendars and cannot be expanded later',async()=>{
 const f=await fixture();try{
  const flow=await f.authorize(),approved=await f.consent(flow,{scopes:['calendar:homework']});assert.equal(approved.status,200);flow.code=new URL(approved.body.redirectURL).searchParams.get('code');
  const exchanged=await f.token(flow);assert.equal(exchanged.status,200);assert.equal(exchanged.body.scope,'calendar:homework');
  const links=await f.request('/api/partner/calendars',{headers:{Authorization:'Bearer '+exchanged.body.access_token}});assert.equal(links.status,200);assert.deepEqual(links.body.calendars.map(row=>row.id),['homework']);
  const feed=await f.request(links.body.calendars[0].url);assert.equal(feed.status,200);assert.ok(feed.body.includes('Devoir confidentiel camille'));assert.ok(!feed.body.includes('Cours autorisé'));assert.ok(!feed.body.includes('Contrôle confidentiel'));assert.ok(isFailure(await f.request(links.body.calendars[0].url+'?type=all')));
  const user=f.store.user('camille');assert.deepEqual(user.partnerGrants.at(-1).scopes,['calendar:homework']);assert.equal(user.partnerGrants.at(-1).links.length,1);
 }finally{await f.close();}
});

test('an anonymous authorization resumes after local login while an authenticated request cannot switch accounts',async()=>{
 const f=await fixture();try{
  const anonymous=await f.authorize({who:'anonymous',scope:'calendar:courses'});assert.equal(anonymous.response.status,302);assert.equal((await f.request('/api/oauth/consent?request='+anonymous.request,{cookie:anonymous.oauthCookie})).status,401);
  const afterLogin=await f.request('/api/oauth/consent?request='+anonymous.request,{who:'camille',cookie:anonymous.oauthCookie});assert.equal(afterLogin.status,200);assert.equal(afterLogin.body.account.id,'camille');
  const approved=await f.consent(anonymous,{who:'camille'});assert.equal(approved.status,200);anonymous.code=new URL(approved.body.redirectURL).searchParams.get('code');const exchanged=await f.token(anonymous);assert.equal(exchanged.status,200);assert.equal(exchanged.body.scope,'calendar:courses');
  const fixed=await f.authorize({who:'camille'}),switched=await f.request('/api/oauth/consent?request='+fixed.request,{who:'nina',cookie:fixed.oauthCookie});assert.equal(switched.status,409);assert.ok(isFailure(await f.consent(fixed)),'a changed account consumes the old transaction');
  const codeAfterLogout=await f.authorize({who:'nina'}),consented=await f.consent(codeAfterLogout);codeAfterLogout.code=new URL(consented.body.redirectURL).searchParams.get('code');assert.equal((await f.request('/api/logout',{who:'nina',origin:ORIGIN,body:{}})).status,200);assert.ok(isFailure(await f.token(codeAfterLogout)),'an unused authorization code cannot survive logout');
 }finally{await f.close();}
});

test('an authorization started before ENT or ICS setup can resume on the same account after setup',async()=>{
 const f=await fixture();try{
  const user=f.store.user('camille'),restored={studentId:user.studentId,schoolName:user.schoolName,skolengo:user.skolengo,skolengoConnectionId:user.skolengoConnectionId,feedKey:user.feedKey,feedHash:user.feedHash,cachedICS:user.cachedICS,lastSync:user.lastSync};
  f.store.update(user.id,{studentId:null,skolengo:null,skolengoConnectionId:null,feedKey:null,feedHash:null,cachedICS:null,lastSync:null});
  const flow=await f.authorize({scope:'calendar:courses'});assert.equal(flow.response.status,302);const before=await f.request('/api/oauth/consent?request='+flow.request,{who:'camille',cookie:flow.oauthCookie});assert.equal(before.status,200);assert.equal(before.body.available,false);assert.ok(before.body.reason);assert.equal((await f.consent(flow)).status,409);
  f.store.update(user.id,restored);const after=await f.request('/api/oauth/consent?request='+flow.request,{who:'camille',cookie:flow.oauthCookie});assert.equal(after.status,200);assert.equal(after.body.available,true);const approved=await f.consent(flow);assert.equal(approved.status,200);flow.code=new URL(approved.body.redirectURL).searchParams.get('code');const exchanged=await f.token(flow);assert.equal(exchanged.status,200);
  const links=await f.request('/api/partner/calendars',{headers:{Authorization:'Bearer '+exchanged.body.access_token}});assert.equal(links.status,200);assert.equal((await f.request(links.body.calendars[0].url)).status,200);
 }finally{await f.close();}
});

test('an established grant, its scope and independent feed URLs survive a complete application restart',async()=>{
 const f=await fixture();let stopped=false,restarted,server,copy;
 try{
  const granted=await f.grant({scope:'calendar:courses calendar:exams'}),master=f.store.user('camille').feedHash;
  copy=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-partner-restart-'));fs.cpSync(f.dir,copy,{recursive:true});await f.close();stopped=true;
  restarted=createApp({dataDir:copy,baseURL:f.baseURL,bootstrap:false,clock:()=>NOW});server=restarted.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const local='http://127.0.0.1:'+server.address().port;
  const response=await fetch(local+'/agenda/api/partner/calendars',{headers:{Authorization:'Bearer '+granted.exchanged.body.access_token,Origin:PARTNER}});assert.equal(response.status,200);const calendars=(await response.json()).calendars;assert.deepEqual(calendars,granted.calendars);assert.equal(restarted.store.user('camille').feedHash,master);
  for(const calendar of calendars){const url=new URL(calendar.url),feed=await fetch(local+url.pathname,{headers:{Origin:PARTNER}});assert.equal(feed.status,200);const body=await feed.text();assert.ok(!body.includes('Devoir confidentiel'));assert.ok(!body.includes('nina'));}
  const own=await fetch(local+'/agenda/api/partners',{headers:{Cookie:f.cookies.camille}});assert.equal(own.status,200);assert.equal((await own.json()).connections[0].status,'active');
 }finally{
  if(restarted){for(const name of ['partners','control','push','passkeys','cloud','incoming','personalCalendars','travel','smartTravel','personalMail','eventSuggestions'])restarted[name]?.close();await restarted.browsers.close();if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}}
  if(!stopped)await f.close();if(copy)fs.rmSync(copy,{recursive:true,force:true});
 }
});

test('partner CORS is exact and restricted to token and calendar endpoints without sharing portal cookies',async()=>{
 const f=await fixture();try{
  const flow=await f.grant({scope:'calendar:courses'}),authorization={Authorization:'Bearer '+flow.exchanged.body.access_token};
  assert.equal(flow.exchanged.headers.get('access-control-allow-origin'),PARTNER);assert.notEqual(flow.exchanged.headers.get('access-control-allow-credentials'),'true');
  const preflight=await f.request('/oauth/token',{method:'OPTIONS',origin:PARTNER,headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}});assert.ok(preflight.status===200||preflight.status===204);assert.equal(preflight.headers.get('access-control-allow-origin'),PARTNER);assert.notEqual(preflight.headers.get('access-control-allow-credentials'),'true');
  for(const origin of ['https://outside.invalid',PARTNER+'.outside.invalid','null']){
   const response=await f.request('/api/partner/calendars',{origin,headers:authorization});assert.ok(isFailure(response));assert.equal(response.headers.get('access-control-allow-origin'),null);
   const feed=await f.request(flow.calendars[0].url,{origin});assert.ok(isFailure(feed));assert.equal(feed.headers.get('access-control-allow-origin'),null);
   const badPreflight=await f.request('/oauth/token',{method:'OPTIONS',origin,headers:{'Access-Control-Request-Method':'POST'}});assert.notEqual(badPreflight.headers.get('access-control-allow-origin'),origin);
  }
  assert.equal((await f.request('/api/partner/calendars',{who:'camille',origin:PARTNER})).status,401,'portal cookie alone cannot read the partner API');
  assert.equal((await f.request('/api/logout',{who:'camille',origin:PARTNER,body:{}})).status,403,'existing portal origin protection is preserved');
  assert.equal((await f.request('/api/oauth/consent?request='+flow.request,{who:'camille',origin:PARTNER,cookie:flow.oauthCookie})).headers.get('access-control-allow-origin'),null);
 }finally{await f.close();}
});

test('dedicated ICS links enforce granted scope, reflect updates and cancellations, and preserve the personal master subscription',async()=>{
 const f=await fixture();try{
  const user=f.store.user('camille'),master={key:user.feedKey,hash:user.feedHash,ics:user.cachedICS};
  const granted=await f.grant({scope:'calendar:courses'});assert.equal(granted.calendars.length,1);const calendar=granted.calendars[0];assert.equal(calendar.id,'courses');assert.equal(calendar.scope,'calendar:courses');assert.equal(calendar.refreshMinutes,10);assert.ok(!calendar.url.includes(f.feedTokens.camille));
  const feed=await f.request(calendar.url,{origin:PARTNER});assert.equal(feed.status,200);assert.match(feed.headers.get('content-type'),/^text\/calendar/);assert.equal(feed.headers.get('access-control-allow-origin'),PARTNER);assert.ok(feed.body.includes('Cours autorisé camille'));assert.ok(!feed.body.includes('Devoir confidentiel'));assert.ok(!feed.body.includes('Contrôle confidentiel'));assert.ok(!feed.body.includes('Cours annulé'));assert.ok(!feed.body.includes('nina'));assert.ok(!feed.body.includes('STATUS:CANCELLED'));
  const etag=feed.headers.get('etag');assert.ok(etag);assert.equal((await f.request(calendar.url,{headers:{'If-None-Match':etag}})).status,304);
  for(const query of ['?type=all','?type=homework','?subject=aaaaaaaaaaaaaaaaaaaa'])assert.ok(isFailure(await f.request(calendar.url+query)));
  user.calendarEvents.course.title='Cours déplacé camille';user.calendarEvents.course.start='2026-11-05T10:00:00Z';user.calendarEvents.course.end='2026-11-05T11:00:00Z';user.calendarEvents.course.modified=NOW+1000;user.calendarEvents.course.sequence=1;f.store.save();
  const updated=await f.request(calendar.url,{headers:{'If-None-Match':etag}});assert.equal(updated.status,200);assert.ok(updated.body.includes('Cours déplacé camille'));assert.ok(!updated.body.includes('Cours autorisé camille'));assert.ok(updated.body.includes('UID:course-camille@passerelle.invalid'));assert.ok(updated.body.includes('SEQUENCE:1'));assert.notEqual(updated.headers.get('etag'),etag);
  user.calendarEvents.course.cancelled=true;f.store.save();const cancelled=await f.request(calendar.url);assert.equal(cancelled.status,200);assert.ok(!cancelled.body.includes('UID:course-camille@passerelle.invalid'));assert.ok(!cancelled.body.includes('STATUS:CANCELLED'));
  assert.deepEqual({key:user.feedKey,hash:user.feedHash,ics:user.cachedICS},master);assert.equal(f.calls.ent.length,0);assert.equal(f.calls.mail.length,0);
 }finally{await f.close();}
});

test('an independently revocable grant cannot be managed by another user or expose raw links in connected applications',async()=>{
 const f=await fixture();try{
  const first=await f.grant({scope:'calendar:courses'}),second=await f.grant({who:'nina',scope:'calendar:homework calendar:exams'});assert.equal(second.calendars.length,2);assert.notEqual(first.calendars[0].url,second.calendars[0].url);
  const listing=await f.request('/api/partners',{who:'camille'});assert.equal(listing.status,200);const rows=listing.body.items||listing.body.connections||listing.body.partners;assert.ok(Array.isArray(rows),'connected applications are listed');assert.equal(rows.length,1);assert.ok(rows[0].id);assert.ok(!JSON.stringify(listing.body).includes(first.exchanged.body.access_token));assert.ok(!JSON.stringify(listing.body).includes('.ics'));
  const id=rows[0].id;assert.equal((await f.request('/api/partners/'+id+'/revoke',{who:'nina',origin:ORIGIN,body:{accountId:'nina'}})).status,404);assert.equal((await f.request('/api/partners/'+id+'/revoke',{who:'camille',origin:PARTNER,body:{accountId:'camille'}})).status,403);
  assert.equal((await f.request('/api/partners/'+id+'/revoke',{who:'camille',origin:ORIGIN,body:{accountId:'camille'}})).status,200);
  assert.equal((await f.request(first.calendars[0].url)).status,404);assert.equal((await f.request('/api/partner/calendars',{headers:{Authorization:'Bearer '+first.exchanged.body.access_token}})).status,401);assert.equal((await f.request(second.calendars[0].url)).status,200);
  const personal=await f.request('/calendars/'+f.feedTokens.camille+'.ics');assert.equal(personal.status,200,'revocation leaves the existing master feed operational');
 }finally{await f.close();}
});

test('temporary requests and codes expire, logout cancels pending consent, and access tokens expire without silently removing an established ICS subscription',async()=>{
 const f=await fixture();try{
  const pending=await f.authorize();f.setNow(NOW+11*60000);assert.ok(isFailure(await f.request('/api/oauth/consent?request='+pending.request,{who:'camille',cookie:pending.oauthCookie})));
  f.setNow(NOW);const coded=await f.authorize(),approved=await f.consent(coded);coded.code=new URL(approved.body.redirectURL).searchParams.get('code');f.setNow(NOW+11*60000);assert.ok(isFailure(await f.token(coded)));
  f.setNow(NOW);const granted=await f.grant({who:'nina',scope:'calendar:courses'}),logoutFlow=await f.authorize();assert.equal((await f.request('/api/logout',{who:'camille',origin:ORIGIN,body:{}})).status,200);assert.equal((await f.consent(logoutFlow)).status,401);
  f.setNow(NOW+3600001);assert.equal((await f.request('/api/partner/calendars',{headers:{Authorization:'Bearer '+granted.exchanged.body.access_token}})).status,401);assert.equal((await f.request(granted.calendars[0].url)).status,200,'ICS capability survives the short token lifetime until its explicit revocation');
  f.partners.prune();
 }finally{await f.close();}
});

test('partner feeds stop after pupil, source, feed or account status changes and never expose another profile',async()=>{
 const f=await fixture();try{
  for(const patch of [{studentId:'different-pupil'},{skolengoConnectionId:'different-ent-connection'},{feedHash:digest(random())},{feedHash:null,feedKey:null},{skolengo:null},{suspendedAt:NOW},{archivedAt:NOW}]){
   const user=f.store.user('camille'),previous=Object.fromEntries(Object.keys(patch).map(key=>[key,user[key]]));
   const granted=await f.grant({scope:'calendar:courses'});f.store.update(user.id,patch);
   assert.equal((await f.request(granted.calendars[0].url)).status,404,JSON.stringify(patch));assert.equal((await f.request('/api/partner/calendars',{headers:{Authorization:'Bearer '+granted.exchanged.body.access_token}})).status,401,JSON.stringify(patch));
   f.store.update(user.id,previous);assert.equal((await f.request(granted.calendars[0].url)).status,404,'restoring an old profile must not revive an invalidated authorization');
  }
 }finally{await f.close();}
});

test('only an administrator can configure Lapsus, and disable or callback changes permanently invalidate its grants',async()=>{
 const f=await fixture();try{
  assert.equal((await f.request('/api/admin/partners/lapsus',{who:'camille'})).status,403);assert.equal((await f.request('/api/admin/partners/lapsus',{who:'camille',origin:ORIGIN,body:{enabled:false,redirectURI:CALLBACK}})).status,403);
  const first=await f.grant({scope:'calendar:courses'}),read=await f.request('/api/admin/partners/lapsus',{who:'owner'});assert.equal(read.status,200);assert.ok(!JSON.stringify(read.body).includes(first.exchanged.body.access_token));
  for(const redirectURI of ['http://mon-ent.pages.dev/passerelle/callback','https://outside.invalid/callback',PARTNER+'/callback#fragment',PARTNER+'/callback?next=https://outside.invalid'])assert.ok(isFailure(await f.request('/api/admin/partners/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:true,redirectURI}})));
  const disabled=await f.request('/api/admin/partners/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:false,redirectURI:CALLBACK}});assert.equal(disabled.status,200);assert.equal((await f.request(first.calendars[0].url)).status,404);assert.equal((await f.request('/api/partner/calendars',{headers:{Authorization:'Bearer '+first.exchanged.body.access_token}})).status,401);assert.ok(isFailure((await f.authorize()).response));
  assert.equal((await f.request('/api/admin/partners/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:true,redirectURI:CALLBACK}})).status,200);assert.equal((await f.request(first.calendars[0].url)).status,404);
  const second=await f.grant({scope:'calendar:courses'});assert.equal((await f.request('/api/admin/partners/lapsus',{who:'owner',origin:ORIGIN,body:{enabled:true,redirectURI:PARTNER+'/new-callback'}})).status,200);assert.equal((await f.request(second.calendars[0].url)).status,404);
 }finally{await f.close();}
});
