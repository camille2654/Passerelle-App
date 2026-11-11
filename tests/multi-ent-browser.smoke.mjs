import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {CURRENT_RELEASE} from '../src/releases.js';
import {Skolengo} from 'scolengo-api';
import {ENT_PROVIDERS} from '../src/ent-providers.js';
import {hubFixture,qrFixture} from './hub-fixture.js';
import {openArea,openTool} from './simple-navigation.js';
const f=await hubFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'}),errors=[],external=[];
const user=f.store.user('a');Object.assign(user,{skolengo:null,studentId:null,schoolName:null,students:[],assignments:[],calendarEvents:{},lastSync:null});user.seenRelease=CURRENT_RELEASE.id;f.store.save();
const originalSearch=Skolengo.searchSchool;
Skolengo.searchSchool=async()=>ENT_PROVIDERS.map(p=>({id:'school-'+p.id,name:'Lycée de test '+p.id,city:'Ville de test',zipCode:'00000',emsCode:p.id,emsOIDCWellKnownUrl:p.discovery}));
let routeHandler,browser,page,contexts=0;
f.browsers.getBrowser=async()=>({newContext:async()=>{
 contexts++;const p={setDefaultTimeout(){},on(){},url:()=> 'https://ent.monlycee.net/',goto:async()=>{
  await routeHandler({request:()=>({url:()=>qrFixture.url,method:()=> 'GET',isNavigationRequest:()=>true}),fetch:async()=>({status:()=>200,headers:()=>({'content-type':'text/html'}),body:async()=>Buffer.from('<body onload="Start({a:3,e:\'synthetic-ent-user\',f:\'one-time-secret\',h:1})">')}),abort:async()=>{},fulfill:async()=>{},continue:async()=>{throw Error('No real ENT calls');}});
 }};
 return {newPage:async()=>p,on(){},route:async(_pattern,handler)=>{routeHandler=handler;},cookies:async()=>[],close:async()=>{}};
}});
fs.mkdirSync('test-results',{recursive:true});
try{
 browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--renderer-process-limit=1']});const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
 await context.addCookies([{name:'agenda_session',value:f.cookies.a.split('=')[1],domain:'127.0.0.1',path:'/agenda'}]);
 page=await context.newPage();page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(/Content Security Policy|Refused to/.test(msg.text()))errors.push(msg.text());});
 await page.route('**/*',route=>{if(new URL(route.request().url()).hostname!=='127.0.0.1'){external.push('unexpected');return route.abort();}return route.continue();});
 await page.goto('http://127.0.0.1:8021/agenda/',{waitUntil:'domcontentloaded'});
 console.log('phase: national search');await openArea(page,'Mon abonnement ICS');await page.getByRole('button',{name:'Connecter mon ENT',exact:false}).click();
 await page.locator('#ent-provider option').last().waitFor({state:'attached'});await page.waitForFunction(()=>document.querySelectorAll('#ent-provider option').length===20);
 await page.locator('#school-form input[name=q]').fill('Lycée');await page.locator('#ent-provider').selectOption('gdest');await page.locator('#school-form button[type=submit]').click();
 await page.locator('#school-results li').filter({hasText:'Mon Bureau Numérique'}).waitFor();assert.equal(await page.locator('#school-results li').count(),1);
 await page.locator('#ent-provider').selectOption('');await page.locator('#school-form button[type=submit]').click();await page.waitForFunction(()=>document.querySelectorAll('#school-results li').length===19);
 for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:'test-results/ent-national-'+width+'.png',fullPage:true,animations:'disabled'});}
 await page.setViewportSize({width:390,height:844});await page.locator('.ent-other>summary').click();await page.locator('#ent-portal-url').fill('https://unsupported.invalid/');await page.locator('#ent-web-form [type=submit]').click();await page.locator('#ent-web-form [role=alert]').getByText(/pas encore de connecteur/).waitFor();assert.equal(contexts,0);
 console.log('phase: ENT SSO and confirmation');await page.locator('#ent-portal-url').fill('https://ent.monlycee.net/');await page.locator('#ent-web-form [type=submit]').click();
 await page.getByRole('region',{name:'Confirmer l’élève Pronote'}).waitFor();assert.equal(await page.locator('#hub-qr-image,#hub-qr-pin,#hub-qr-data').count(),0);assert.equal(await page.locator('#ent-dialog').evaluate(n=>n.open),false);
 await page.screenshot({path:'test-results/ent-pronote-confirmation.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Oui, associer cet élève',exact:true}).click();await page.getByText('Associé à cet élève',{exact:true}).waitFor();assert.ok(f.store.user('a').studentId.startsWith('prn-'));assert.equal(f.store.user('b').pronote,undefined);
 await openArea(page,'Mon ENT');await page.getByRole('tab',{name:'Notes',exact:true}).click();await page.locator('.school-mark').filter({hasText:'16,5'}).waitFor();assert.equal(await page.getByRole('tab',{name:/Messages|Actualités/}).count(),0);
 await openArea(page,'Mon abonnement ICS');await page.getByRole('button',{name:'Créer mon lien ICS',exact:false}).click();await page.locator('#feed-url').waitFor();assert.ok(f.store.user('a').cachedICS.includes('BEGIN:VEVENT'));
 await page.screenshot({path:'test-results/ent-pronote-connected.png',fullPage:true,animations:'disabled'});
 await openTool(page,'Pronote');assert.equal(await page.locator('#hub-pronote-ent-form [name=portalURL]').count(),1);assert.equal(await page.getByText(/QR code/).count(),0);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:'test-results/ent-pronote-dark.png',fullPage:true,animations:'disabled'});
 await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();await page.getByRole('button',{name:'Créer un compte gratuit',exact:true}).waitFor();assert.equal(await page.locator('#hub-panel').count(),0);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
 console.log(JSON.stringify({ok:true,nationalSearch:true,providerFilter:true,unsupportedPortalRecovery:true,entToPronote:true,noQR:true,studentConfirmation:true,primarySourceICS:true,grades:true,unavailableMailAndNewsHidden:true,privateProfileIsolation:true,logoutPrivacy:true,widths:[320,390,820,1440],dark:true,reducedMotion:true,realENTCalls:0,realEmailsSent:0}));
}catch(error){await page?.screenshot({path:'test-results/ent-failure.png',fullPage:true,animations:'disabled'}).catch(()=>{});throw error;}
finally{Skolengo.searchSchool=originalSearch;await browser?.close();await f.close();}
