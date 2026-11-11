import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {hubFixture,qrFixture} from './hub-fixture.js';
import {installSyntheticEntMenu} from './ent-browser-fixture.js';
import {CURRENT_RELEASE} from '../src/releases.js';
import {openTool} from './simple-navigation.js';
import {digest} from '../src/store.js';
const baseURL='http://127.0.0.1:8021/agenda',f=await hubFixture({port:8021,baseURL}),u=f.store.user('a');
for(const user of f.store.state.users)user.seenRelease=CURRENT_RELEASE.id;
const source={school:{id:'school',name:u.schoolName,homePageUrl:'https://test.ent.auvergnerhonealpes.fr/',emsCode:'rra'}};
u.skolengo=f.store.seal(source);u.feedKey=f.store.seal('synthetic-existing-private-feed');u.feedHash=digest('synthetic-existing-private-feed');u.cachedICS='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n';f.store.save();
const sourceBefore=u.skolengo,studentBefore=u.studentId,feedBefore=u.feedHash,menu=installSyntheticEntMenu(f),errors=[],outbound=[],documents=[],submitted=[];
let browser,page,releaseImport;const initialWorker=f.pronote.worker;let delayedImport=true;f.pronote.worker=async(payload,save)=>{if(delayedImport){await new Promise(resolve=>{releaseImport=resolve;});}return initialWorker(payload,save);};
const confirm=()=>page.getByRole('region',{name:'Confirmer l’élève Pronote'});
const waitFrame=async()=>{await page.locator('#ent-dialog').waitFor({state:'visible'});await page.locator('#ent-frame').waitFor({state:'visible'});};
async function submitForm(viaKeyboard=false){
 const before=documents.length;const reply=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/api/pronote/ent/start'));
 if(viaKeyboard)await page.locator('#hub-ent-url').press('Enter');else await page.locator('#hub-pronote-ent-form [type=submit]').click();
 const response=await reply;assert.equal(response.request().method(),'POST');assert.equal(response.status(),200,JSON.stringify(await response.json()));
 await waitFrame();await page.locator('#ent-frame').click();if(delayedImport){await page.locator('#ent-progress').getByText('Étape 3 sur 3 · Importation depuis PRONOTE',{exact:true}).waitFor();assert.equal(await page.locator('#remote-text-form').isVisible(),false);assert.equal(await page.locator('#ent-frame').isVisible(),false);releaseImport();delayedImport=false;}await confirm().waitFor();assert.equal(documents.length,before);assert.equal(new URL(page.url()).search,'');
 await page.getByRole('button',{name:'Oui, associer cet élève',exact:true}).click();await page.getByText('Associé à cet élève',{exact:true}).waitFor();
 assert.equal(u.skolengo,sourceBefore);assert.equal(u.studentId,studentBefore);assert.equal(u.feedHash,feedBefore);assert.equal(f.store.user('b').pronote,undefined);
}
try{
 fs.mkdirSync('test-results',{recursive:true});browser=await chromium.launch({headless:true,args:['--disable-dev-shm-usage','--renderer-process-limit=1']});
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris',reducedMotion:'reduce'});
 await context.addCookies([{name:'agenda_session',value:f.cookies.a.split('=')[1],domain:'127.0.0.1',path:'/agenda'}]);page=await context.newPage();page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(/Content Security Policy|Refused to/.test(m.text()))errors.push(m.text());});
 page.on('request',r=>{if(r.isNavigationRequest()&&r.frame()===page.mainFrame())documents.push(new URL(r.url()).pathname);if(new URL(r.url()).pathname.endsWith('/api/pronote/ent/start'))submitted.push(JSON.parse(r.postData()||'{}'));});
 await page.route('**/*',r=>{if(new URL(r.request().url()).hostname!=='127.0.0.1'){outbound.push('unexpected');return r.abort();}return r.continue();});
 await page.goto(baseURL+'/',{waitUntil:'domcontentloaded'});await page.evaluate(()=>{window.entMessages=[];new MutationObserver(()=>window.entMessages.push(document.querySelector('#ent-message').textContent)).observe(document.querySelector('#ent-message'),{childList:true,subtree:true,characterData:true});});let firstFrame=true;await page.route('**/api/skolengo/frame',r=>{if(firstFrame){firstFrame=false;return r.abort('aborted');}return r.continue();});await openTool(page,'Pronote');await page.locator('#hub-pronote-ent-form').waitFor();
 assert.equal(await page.locator('#hub-pronote-ent-form').getAttribute('method'),'post');assert.equal(await page.locator('#hub-ent-url').inputValue(),'');assert.equal(await page.locator('#hub-pronote-ent-form input[name=accountPin]').isVisible(),false);
 console.log('phase: submit actual PRONOTE form, connected ENT selected automatically');await submitForm();assert.deepEqual(menu.visits,[source.school.homePageUrl]);assert.ok(await page.evaluate(()=>window.entMessages.some(s=>s.includes('interrompu un instant'))));assert.equal(await page.evaluate(()=>window.entMessages.some(s=>s.includes('Fetch is aborted'))),false);assert.equal(submitted[0].accountPin,'');
 console.log('phase: copied PRONOTE link and Enter submission');await page.locator('.pronote-setup>summary').click();await page.locator('#hub-pronote-ent-form>details>summary').click();
 await page.locator('#hub-ent-url').fill(qrFixture.url+'?login=true&ticket=synthetic-expired');await submitForm(true);assert.equal(menu.visits[1],qrFixture.url);assert.equal(menu.inputs.length,2);assert.equal(submitted.length,2);
 console.log('phase: wrong PRONOTE space gets a persistent message');menu.controls.space=7;await page.locator('.pronote-setup>summary').click();await page.locator('#hub-pronote-ent-form [type=submit]').click();await waitFrame();await page.locator('#ent-frame').click();await page.locator('#ent-message').getByText(/espace Élève/).waitFor();assert.equal(await page.locator('#ent-close-feedback').isVisible(),true);assert.equal(u.skolengo,sourceBefore);assert.equal(u.feedHash,feedBefore);await page.locator('#ent-close-feedback').click();await page.locator('#ent-dialog').waitFor({state:'hidden'});menu.controls.space=3;
 console.log('phase: invalid portal remains in the same form');await page.locator('#hub-pronote-ent-form>details>summary').click();await page.locator('#hub-ent-url').fill('https://unsupported.invalid/');
 const documentsBefore=documents.length;await page.locator('#hub-pronote-ent-form [type=submit]').click();await page.locator('#hub-pronote-ent-form [role=alert]').getByText(/pas encore de connecteur/).waitFor();assert.equal(documents.length,documentsBefore);assert.equal(menu.visits.length,3);assert.equal(new URL(page.url()).search,'');
 await page.screenshot({path:'test-results/pronote-form-mobile.png',fullPage:true,animations:'disabled'});await page.setViewportSize({width:1440,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/pronote-form-desktop.png',fullPage:true,animations:'disabled'});
 console.log('phase: recover an old native form URL without submitting its query');const postsBefore=submitted.length;
 await page.goto(baseURL+'/?portalURL='+encodeURIComponent(qrFixture.url)+'&accountPin=synthetic-old-code&v=recovery',{waitUntil:'domcontentloaded'});await page.getByText('Associé à cet élève',{exact:true}).waitFor();await page.locator('#hub-pronote-ent-form').waitFor({state:'attached'});assert.equal(new URL(page.url()).search,'?v=recovery');assert.equal(submitted.length,postsBefore);assert.equal(await page.locator('#hub-pronote-ent-form input[name=accountPin]').inputValue(),'');
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.screenshot({path:'test-results/pronote-form-dark.png',fullPage:true,animations:'disabled'});
 assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
 console.log(JSON.stringify({ok:true,actualPronoteForm:true,buttonAndEnter:true,connectedENTSelected:true,noExtraCodeRequired:true,entMenuSSO:true,copiedPronoteLink:true,noNativeNavigation:true,rootPostSSO:true,processingStep:true,interruptedFrameRecovery:true,wrongSpaceFeedback:true,invalidAddressInline:true,oldQueryCleaned:true,oldQueryNotSubmitted:true,studentAndFeedPreserved:true,mobile:true,desktop:true,dark:true,reducedMotion:true,realENTCalls:0,realEmailsSent:0}));
}catch(error){await page?.screenshot({path:'test-results/pronote-form-failure.png',fullPage:true,animations:'disabled'}).catch(()=>{});throw error;}
finally{await browser?.close();await f.close();}
