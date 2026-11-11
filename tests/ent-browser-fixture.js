import {fixturePNG} from './document-fixtures.js';
import {qrFixture} from './hub-fixture.js';
/* Synthetic ENT menu. A remote image click opens the PRONOTE SSO bootstrap.
 * The actual portal, private API handlers and candidate confirmation remain real. */
export function installSyntheticEntMenu(f){
 const visits=[],inputs=[],controls={method:'POST',path:'/pronote/',space:3,credentials:true};let handler,context,activePage;
 const openPronote=async()=>{const root=new URL(qrFixture.url);root.pathname=controls.path;const url=root.href;const a={h:123,a:controls.space,config:{nested:true},...(controls.credentials?{e:'synthetic-ent-student',f:'synthetic-single-use-secret'}:{})};return handler({request:()=>({url:()=>url,method:()=>controls.method,isNavigationRequest:()=>true}),fetch:async({maxRedirects})=>{if(maxRedirects!==0)throw Error('Unexpected redirect policy');return {status:()=>200,headers:()=>({'content-type':'text/html'}),body:async()=>Buffer.from('<script>window.addEventListener("load",()=>{Start('+JSON.stringify(a)+')})</script>')};},abort:async()=>{},fulfill:async()=>{},continue:async()=>{throw Error('Real ENT network is forbidden');}});};
 f.browsers.getBrowser=async()=>({newContext:async()=>{
  activePage={setDefaultTimeout(){},on(){},isClosed:()=>false,url:()=>visits.at(-1)||'',goto:async url=>{visits.push(url);},screenshot:async()=>fixturePNG,mouse:{click:async()=>{inputs.push('pronote-menu');await openPronote();},wheel:async()=>{}},keyboard:{insertText:async()=>{},press:async()=>{}}};
  context={newPage:async()=>activePage,pages:()=>[activePage],on(){},route:async(_pattern,fn)=>{handler=fn;},cookies:async()=>[],close:async()=>{}};return context;
 }});
 return {visits,inputs,controls};
}
