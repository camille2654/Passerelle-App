import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {controlFixture} from './control-fixture.js';
const f=await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'}),errors=[],requests=[];
await f.systemStatus.track('ent',async()=>{});await f.systemStatus.track('push',async()=>{});
let browser,page,mode='live',held,resolveHeld;
fs.mkdirSync('test-results',{recursive:true});
try{
 browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});page=await browser.newPage({viewport:{width:1440,height:1100},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});page.setDefaultTimeout(30000);await page.clock.install();
 page.on('pageerror',e=>errors.push(e.stack||e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text());});
 page.on('request',request=>{if(request.url().includes('/api/'))requests.push(new URL(request.url()).pathname);});
 await page.context().addCookies([{name:'agenda_session',value:f.cookies.owner.split('=')[1],url:f.root}]);
 await page.route('**/api/system-status',async route=>{
  assert.equal(route.request().headers().cookie,undefined,'status fetch omits the signed-in cookie');
  if(mode==='offline')return route.fulfill({status:503,body:'service offline'});
  if(mode==='malformed')return route.fulfill({status:200,contentType:'application/json',body:'{}'});
  if(mode==='hold'){await held;}
  return route.continue();
 });
 await page.goto(f.root+'/status/',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Les services suivis fonctionnent',exact:true}).waitFor();
 assert.equal(await page.locator('.component').count(),6);assert.equal(await page.locator('.component').getByText('Non activé',{exact:true}).count(),2);assert.equal(await page.locator('[data-state=operational].component').count(),4);
 assert.ok(!(await page.locator('body').textContent()).includes('owner@example.invalid'));
 for(const width of [320,390,820,1440]){
  await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:'test-results/system-status-'+width+'.png',animations:'disabled'});
 }
 await page.setViewportSize({width:390,height:844});await page.getByRole('button',{name:'Activer le thème sombre',exact:true}).click();await page.screenshot({path:'test-results/system-status-dark.png',animations:'disabled'});
 f.store.state.settings.automationPaused={ent:true};await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByRole('heading',{name:'Certains services demandent une vérification',exact:true}).waitFor();await page.locator('.component').filter({hasText:'Synchronisation des cours'}).getByText('En pause',{exact:true}).waitFor();
 f.store.state.settings.maintenance={enabled:true,until:f.now()+60000,message:'private maintenance detail'};await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByRole('heading',{name:'Une maintenance est en cours',exact:true}).waitFor();assert.ok(!(await page.locator('body').textContent()).includes('private maintenance detail'));
 await page.locator('.history summary').click();assert.ok(await page.locator('#events li').count()>0);
 await page.screenshot({path:'test-results/system-status-maintenance.png',animations:'disabled'});
 delete f.store.state.settings.maintenance;delete f.store.state.settings.automationPaused;
 mode='offline';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByRole('heading',{name:'Impossible de joindre Passerelle',exact:true}).waitFor();assert.equal(await page.locator('.component[data-state=operational]').count(),0);assert.ok(await page.getByText(/Dernier contrôle réussi/).count());await page.screenshot({path:'test-results/system-status-offline.png',animations:'disabled'});
 mode='malformed';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);assert.equal(await page.locator('.component[data-state=operational]').count(),0);
 mode='live';await page.getByRole('button',{name:'Actualiser',exact:true}).click();await page.getByRole('heading',{name:'Les services suivis fonctionnent',exact:true}).waitFor();
 // A suspended tab returning to a pending request must not retain fresh green badges.
 held=new Promise(resolve=>{resolveHeld=resolve;});mode='hold';
 await page.clock.fastForward(76000);await page.getByRole('heading',{name:'Impossible de joindre Passerelle',exact:true}).waitFor();assert.equal(await page.locator('.component[data-state=operational]').count(),0);
 resolveHeld();mode='live';await page.getByRole('heading',{name:'Les services suivis fonctionnent',exact:true}).waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});assert.deepEqual(errors,[]);assert.deepEqual([...new Set(requests)],['/agenda/api/system-status']);
 assert.equal(f.calls.ent.length,0);assert.equal(f.calls.mail.length,0);
 await page.goto(f.root+'/',{waitUntil:'domcontentloaded'});await page.getByRole('navigation',{name:'Navigation principale',exact:true}).waitFor();
 await page.setViewportSize({width:320,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.getByRole('link',{name:'Statut du système',exact:true}).waitFor();
 console.log(JSON.stringify({ok:true,publicStatus:true,credentialsOmitted:true,configuredVsObserved:true,maintenance:true,pause:true,offlineRemovesGreen:true,malformedRemovesGreen:true,recovery:true,staleRemovesGreen:true,history:true,widths:[320,390,820,1440],dark:true,reducedMotion:true,appFooterLink:true,privateDataExposed:false,jsAndCSPErrors:0,realENTCalls:0,realEmailsSent:0}));
}finally{resolveHeld?.();await browser?.close();await f.close();}
