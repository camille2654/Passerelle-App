import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePronoteBootstrap,hasENTCredentials} from '../src/pronote-bootstrap.js';
import {LoginBrowsers} from '../src/skolengo.js';
import {startEntPronote} from '../src/ent-pronote-browser.js';

test('bootstrap parser accepts current head JSON and legacy onload data without evaluating code',()=>{
 const modern='<script>window.addEventListener("load",()=>{Start ({"h":123,"a":3,"config":{"nested":true},"e":"synthetic:login","f":"a,b}c","CrA":true});});</script>';
 const data=parsePronoteBootstrap(modern);assert.equal(data.h,123);assert.equal(data.a,3);assert.equal(data.e,'synthetic:login');assert.equal(data.f,'a,b}c');assert.equal(data.CrA,true);assert.equal(data.config,undefined);assert.equal(hasENTCredentials(modern),true);
 const old='<body onload="try { Start({h:\'123\',a:3,e:\'student\',f:\'a&amp;b\\\'c\',CrA:false}) } catch(e){}">';
 assert.equal(parsePronoteBootstrap(old).f,"a&b'c");assert.equal(parsePronoteBootstrap(old).CrA,false);
 assert.equal(hasENTCredentials('<script>Start({h:2,a:3,e:"",f:""})</script>'),false);
 for(const html of ['Start({h:1,a:3,e:process.exit(),f:"secret"})','Start({h:1,a:3,e:globalThis.secret,f:"x"})','Start({h:1,a:3,e:`template`,f:"x"})','Start({h:1,a:3,e:"unterminated})'])assert.equal(parsePronoteBootstrap(html),null);
 assert.equal(Object.prototype.polluted,undefined);parsePronoteBootstrap('Start({h:1,a:3,"__proto__":{"polluted":true},e:"u",f:"f"})');assert.equal(Object.prototype.polluted,undefined);
});
async function setup(options={}){
 let handler,closed=0;const notes=[];const page={setDefaultTimeout(){},on(){},url:()=> 'https://test.ent.auvergnerhonealpes.fr/',goto:async()=>{},isClosed:()=>false};
 const context={newPage:async()=>page,pages:()=>[page],on(){},route:async(_name,fn)=>{handler=fn;},cookies:async()=>[{name:'session',value:'synthetic-cookie',domain:'demo.index-education.net',path:'/'}],close:async()=>{closed++;}};
 const manager={items:new Map(),starting:false,stop:async()=>{},getBrowser:async()=>({newContext:async()=>context}),onDiagnostic:(_user,note)=>notes.push(note)};
 let capture;
 await startEntPronote(manager,{id:'a'},'https://test.ent.auvergnerhonealpes.fr/',{onCapture:async value=>{capture=value;},...options});
 return {manager,context,notes,get capture(){return capture;},get closed(){return closed;},async request({method='GET',path='/pronote/',html='<script>Start({"h":123,"a":3,"e":"user","f":"secret"});</script>'}={}){let aborts=0,fulfills=0;await handler({request:()=>({url:()=> 'https://demo.index-education.net'+path,method:()=>method,frame:()=>{if(options.frameUnavailable)throw Error("Frame for this navigation request is not available");return page;},isNavigationRequest:()=>true}),fetch:async fetchOptions=>{if(options.fetchFailure)throw Error('synthetic-sensitive-ticket');assert.equal(fetchOptions.maxRedirects,0);return {status:()=>200,headers:()=>({'content-type':'text/html'}),body:async()=>Buffer.from(html)};},abort:async()=>{aborts++;},fulfill:async()=>{fulfills++;},continue:async()=>{throw Error('Network forbidden');}});return {aborts,fulfills};},close(){for(const item of manager.items.values()){clearTimeout(item.timer);clearTimeout(item.transferTimer);}}};
}
test('SSO at PRONOTE root or a POST is captured once and canonicalized to a student worker URL',async()=>{
 for(const method of ['GET','POST'])for(const path of ['/pronote/','/pronote/eleve.html','/pronote/mobile.eleve.html']){
  const f=await setup();try{const result=await f.request({method,path});assert.equal(result.aborts,1);assert.equal(f.capture.url,'https://demo.index-education.net'+(path.includes('mobile.')?path:'/pronote/eleve.html'));assert.equal(f.capture.attributes.e,'user');assert.equal(f.manager.items.get('a').status,'confirmation');assert.equal(f.closed,1);assert.ok(f.notes.every(n=>!JSON.stringify(n).includes('user')&&!JSON.stringify(n).includes('secret')&&!JSON.stringify(n).includes('synthetic-cookie')));}finally{f.close();}
 }
});
test('a parent space is refused before worker import, without swallowing the one-time page into a spinner',async()=>{
 const f=await setup();try{await f.request({html:'Start({h:12,a:7,e:"parent",f:"secret"})'});assert.equal(f.capture,undefined);assert.equal(f.manager.items.get('a').status,'error');assert.match(f.manager.items.get('a').error,/Élève/);assert.equal(f.closed,1);}finally{f.close();}
});
test('a popup bootstrap is captured even before its browser frame exists',async()=>{
 const f=await setup({frameUnavailable:true});try{await f.request();assert.equal(f.manager.items.get('a').status,'confirmation');assert.equal(f.capture.attributes.a,3);assert.equal(f.closed,1);}finally{f.close();}
});
test('a capture failure reports its safe stage without blaming an unavailable portal or exposing the error',async()=>{
 const f=await setup({fetchFailure:true});try{await f.request();const item=f.manager.items.get('a');assert.equal(item.status,'error');assert.match(item.error,/Passerelle/);assert.doesNotMatch(item.error,/ne répond pas|synthetic-sensitive/);assert.equal(f.notes.at(-1).code,'SSO_CAPTURE_FAILED');assert.equal(f.notes.at(-1).stage,'navigation-fetch');assert.doesNotMatch(JSON.stringify(f.notes),/synthetic-sensitive/);}finally{f.close();}
});
test('screenshot interruptions during SSO return no frame and release the busy flag',async()=>{
 const manager=new LoginBrowsers({});const item={status:'login',busy:false,page:{isClosed:()=>false,screenshot:async()=>{throw Error('Fetch is aborted');},url:()=> 'https://demo.index-education.net/pronote/'}};manager.items.set('a',item);
 assert.equal(await manager.frame('a'),null);assert.equal(item.busy,false);
 item.page.screenshot=async()=>{item.status='processing';throw Error('Execution context was destroyed');};assert.equal(await manager.frame('a'),null);assert.equal(item.busy,false);
 item.status='login';item.page.screenshot=async()=>{throw Error('Unexpected disk error');};await assert.rejects(manager.frame('a'),/Unexpected disk error/);
});

test('a PRONOTE page that never transfers its SSO credentials ends with an explicit error',async()=>{
 const f=await setup({transferTimeoutMs:25});try{const result=await f.request({html:'Start({h:1,a:3})'});assert.equal(result.fulfills,1);assert.match(f.manager.items.get('a').hint,/transmission/);await new Promise(r=>setTimeout(r,40));assert.equal(f.manager.items.get('a').status,'error');assert.match(f.manager.items.get('a').error,/pas été transmise/);assert.equal(f.capture,undefined);assert.equal(f.closed,1);}finally{f.close();}
});
