import http from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startEntPronote} from '../src/ent-pronote-browser.js';

// Real Chromium, real HTTP redirects, synthetic ENT/PRONOTE on loopback only.
// Mapping at the transport boundary retains the production domain checks.
const ent='https://test.ent.auvergnerhonealpes.fr',pn='https://demo.index-education.net';
let mode,spent=0,posts=[],requests=[],bootstrapLoads=0;
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 requests.push(req.url);
 if(req.url==='/start'){
  res.setHeader('content-type','text/html');
  const target=mode.startsWith('POPUP')?' target="_blank"':'';
  const href=mode==='POPUP_DIRECT200'?'/pronote/eleve.html':'/cas/login';
  res.end('<a id="go" href="'+href+'"'+target+'>PRONOTE</a><form action="/cas/login" method="post"'+target+'><input name="SAMLResponse" value="synthetic+a/b=&amp;&lt;&quot;"><input name="submit" value="safe"><button id="post">Se connecter</button></form>');return;
 }
 if(req.url.startsWith('/cas/')){
  if(req.method==='POST')posts.push(new URLSearchParams(body));
  if(mode==='blocked'){res.writeHead(302,{location:'https://untrusted.invalid/private'});res.end();return;}
  if(mode==='loop'){res.writeHead(302,{location:ent+'/cas/login'});res.end();return;}
  const first=req.url==='/cas/login',code=first?Number(mode.slice(-3)):303;
  res.writeHead(code,{location:first?ent+'/cas/middle':pn+'/pronote/eleve.html?ticket=synthetic-ticket','set-cookie':'bridge=synthetic-session; Path=/; HttpOnly; SameSite=Lax'});res.end();return;
 }
 if(req.url.startsWith('/pronote/eleve.html')){
  bootstrapLoads++;res.setHeader('content-type','text/html');res.end('<script>function Start(){fetch("/spent")}Start({"h":123,"a":3,"e":"synthetic-user","f":"synthetic-secret","config":{"nested":true}})</script>');return;
 }
 if(req.url==='/spent'){spent++;res.end('spent');return;}
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const local='http://127.0.0.1:'+server.address().port;
const logical=input=>{const u=new URL(input);return (u.pathname.startsWith('/pronote/')?pn:ent)+u.pathname+u.search;};
const physical=input=>String(input).replaceAll(ent,local).replaceAll(pn,local);
let browser,outbound=0;
try{
 browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--renderer-process-limit=1']});
 const scenarios=process.argv.slice(2).length?process.argv.slice(2):['GET302','POST302','POST303','GET307','GET308','POST307','POST308','POPUP_DIRECT200','POPUP_GET302','POPUP_POST307','blocked','loop'];
 for(const scenario of scenarios){
  console.log('scenario: '+scenario);
  mode=scenario;spent=0;posts=[];requests=[];bootstrapLoads=0;let capture;
  const manager={items:new Map(),starting:false,async stop(){},async getBrowser(){return {newContext:async options=>{
   const context=await browser.newContext(options),nativeRoute=context.route.bind(context),nativePage=context.newPage.bind(context),nativeCookies=context.cookies.bind(context);
   context.cookies=urls=>nativeCookies(Array.isArray(urls)?urls.map(physical):physical(urls));
   context.newPage=async()=>{const page=await nativePage(),goto=page.goto.bind(page);page.goto=(url,opts)=>goto(physical(url),opts);return page;};
   context.route=(pattern,handler)=>nativeRoute(pattern,async route=>{
    const request=route.request();if(!request.url().startsWith(local+'/')){outbound++;await route.abort();return;}
    const wrappedRequest={url:()=>logical(request.url()),method:()=>request.method(),headers:()=>request.headers(),postDataBuffer:()=>request.postDataBuffer(),frame:()=>request.frame(),isNavigationRequest:()=>request.isNavigationRequest()};
    return handler({request:()=>wrappedRequest,fetch:options=>route.fetch(options),abort:()=>route.abort(),continue:()=>route.continue(),fulfill:options=>route.fulfill({...options,...(options.body?{body:physical(options.body)}:{}),...(options.headers?{headers:Object.fromEntries(Object.entries(options.headers).map(([key,value])=>[key,physical(value)]))}:{})})});
   });return context;
  }};}};
  try{
   await startEntPronote(manager,{id:'synthetic'},ent+'/start',{onCapture:async value=>{capture=value;}});
   const item=manager.items.get('synthetic');
   assert.equal(item.status,'login','Initial ENT menu: '+(item.error||item.status));
   assert.equal(await item.page.locator('#go').count(),1,'Initial menu should render');
   const button=scenario.includes('POST')?'#post':'#go';
   let clickError;const click=item.page.locator(button).click({noWaitAfter:true}).catch(error=>{if(!/closed|aborted|interrupted/i.test(error.message))clickError=error;});
   const until=Date.now()+20000;
   while(!['confirmation','error'].includes(item.status)&&Date.now()<until)await new Promise(r=>setTimeout(r,40));
   if(scenario==='blocked'||scenario==='loop'){
    assert.equal(item.status,'error',scenario);assert.equal(capture,undefined);assert.equal(bootstrapLoads,0);assert.match(item.error,scenario==='loop'?/boucle/:/autorisé/);
   }else{
    assert.equal(item.status,'confirmation',scenario+': '+(item.error||'no handoff'));assert.equal(capture.attributes.e,'synthetic-user');assert.equal(capture.attributes.f,'synthetic-secret');assert.equal(capture.url,pn+'/pronote/eleve.html');assert.equal(bootstrapLoads,1);assert.equal(spent,0,'Browser must not consume the one-time bootstrap');
    if(scenario.includes('POST')){assert.equal(posts.length,[307,308].includes(Number(scenario.slice(-3)))?2:1);for(const data of posts){assert.equal(data.get('SAMLResponse'),'synthetic+a/b=&<"');assert.equal(data.get('submit'),'safe');}}
   }
   await click;
   if(clickError)throw clickError;
  }finally{for(const item of manager.items.values()){clearTimeout(item.timer);clearTimeout(item.transferTimer);await item.context.close().catch(()=>{});}}
 }
 assert.equal(outbound,0);
 console.log(JSON.stringify({ok:true,realChromiumRedirects:true,scenarios:scenarios.length,popupsBeforeFrame:true,getAndPost:true,preservingPost307And308:true,noBootstrapConsumed:true,redirectLoopBounded:true,unknownRedirectBlocked:true,realENTCalls:0}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
