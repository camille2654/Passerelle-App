import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {controlFixture} from './control-fixture.js';
import {initializeOnboarding} from '../src/onboarding.js';
import {CURRENT_RELEASE} from '../src/releases.js';

// Every identity, acknowledgement and delivery transport is local and temporary.
const f=await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda',releasePending:true});
f.store.user('nina').onboarding=initializeOnboarding(f.now());
f.store.user('coadmin').onboarding={version:1,status:'active',step:'finish',updatedAt:f.now(),startedAt:f.now(),completedAt:null};
f.menu.get=async(_user,query)=>({date:query.date,status:'not_found',next:null,days:[]});
f.store.save();

let browser,page,permissionRequests=0,pushSubscriptions=0;
const errors=[],external=[],base=f.root;
const sheet=()=>page.locator('#release-sheet');
const openSheet=()=>page.locator('#release-sheet[open]');
async function go(name){await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name,exact:true}).click();}
async function switchAccount(id,{blockWithDialog=false}={}){
 await page.context().addCookies([{name:'agenda_session',value:f.cookies[id].split('=')[1],url:base+'/'}]);
 await page.goto(base+'/'+(blockWithDialog?'?fixture-dialog=1':''),{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Bonjour '+f.store.user(id).name,exact:true}).waitFor();
}
async function visibleSheet(){
 await openSheet().waitFor();
 await sheet().evaluate(async node=>{await Promise.all(node.getAnimations().map(animation=>animation.finished));});
 await page.waitForFunction(()=>{const image=document.querySelector('#release-sheet .release-cover img');return image?.complete&&image.naturalWidth>0;});
}
async function closedSheet(){await page.waitForFunction(()=>!document.querySelector('#release-sheet')?.open);}
async function shot(name){
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' page has no horizontal overflow');
 assert.equal(await sheet().evaluate(node=>node.scrollWidth>node.clientWidth+1),false,name+' sheet has no horizontal overflow');
 const bounds=await sheet().boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=(await page.viewportSize()).width+1,name+' stays within the screen');
 await page.screenshot({path:'test-results/'+name+'.png',fullPage:true,animations:'allow',caret:'initial',timeout:60000});
}
async function dismissPrimary(){
 const saved=page.waitForResponse(response=>response.url().endsWith('/api/releases/seen')&&response.request().method()==='POST'&&response.status()===200);
 await sheet().getByRole('button',{name:/^C’est parti/}).click();await saved;await closedSheet();
}

try{
 fs.mkdirSync('test-results',{recursive:true});
 browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
 const context=await browser.newContext({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});
 await context.exposeBinding('__releaseAttempt',(_source,kind)=>{if(kind==='permission')permissionRequests++;else if(kind==='subscription')pushSubscriptions++;});
 await context.addInitScript(()=>{
  // The blocking dialog must exist before the app's first presentation timer,
  // including on a slow VM where waiting for a heading can exceed that timer.
  if(new URL(location.href).searchParams.has('fixture-dialog'))document.addEventListener('DOMContentLoaded',()=>{const dialog=document.createElement('dialog');dialog.id='release-fixture-dialog';dialog.textContent='Autre dialogue local';document.body.append(dialog);dialog.showModal();},{once:true});
  if(window.Notification)Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=>{await window.__releaseAttempt('permission');return 'denied';}});
  if(window.PushManager)Object.defineProperty(PushManager.prototype,'subscribe',{configurable:true,value:async()=>{await window.__releaseAttempt('subscription');throw new Error('No push subscription is allowed in the release fixture.');}});
 });
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(base).origin){external.push(url.origin);return route.abort();}
  return route.continue();
 });
 page=await context.newPage();page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Content Security Policy'))errors.push(message.text());});

 // A major announcement opens after the workspace, but does not acknowledge itself.
 await switchAccount('camille');await visibleSheet();
 assert.equal(f.store.user('camille').seenRelease,undefined);
 assert.equal(await sheet().getByRole('heading',{name:CURRENT_RELEASE.title,exact:true}).count(),1);
 assert.equal(await sheet().evaluate(node=>node.contains(document.activeElement)),true);
 assert.equal(await sheet().locator('.release-features>li').count(),3);
 await shot('release-sheet-mobile');
 for(let n=0;n<10;n++){await page.keyboard.press('Tab');assert.equal(await sheet().evaluate(node=>node.contains(document.activeElement)),true,'native modal keeps keyboard focus');}

 // Small dark screens and reduced motion keep the same controls and readable content.
 await page.setViewportSize({width:320,height:740});await page.evaluate(()=>appearance.set('dark'));await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await sheet().evaluate(node=>getComputedStyle(node).animationName),'none');
 await shot('release-sheet-small-dark');
 await page.setViewportSize({width:1440,height:1050});await page.evaluate(()=>appearance.set('light'));await page.emulateMedia({reducedMotion:'no-preference'});
 await shot('release-sheet-desktop');
 await dismissPrimary();assert.equal(f.store.user('camille').seenRelease,CURRENT_RELEASE.id);const firstSeen=f.store.user('camille').seenReleaseAt;

 // Dismissal persists; reopening is voluntary and Escape restores the launcher's focus.
 await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Bonjour Camille',exact:true}).waitFor();
 await page.waitForTimeout(2250);assert.equal(await openSheet().count(),0,'acknowledged announcement does not reopen');
 await go('Plus');const launcher=page.locator('[data-release-open]');await launcher.focus();await launcher.click();await visibleSheet();
 await page.keyboard.press('Escape');await closedSheet();assert.equal(await launcher.evaluate(node=>node===document.activeElement),true,'Escape restores focus to the launcher');
 assert.equal(f.store.user('camille').seenReleaseAt,firstSeen);

 // Logging out from another control/session while the sheet is open removes its account UI.
 await launcher.click();await visibleSheet();
 await page.evaluate(async()=>{await api('logout',{});await refresh();});
 await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();
 assert.equal(await sheet().count(),0);assert.equal(await page.evaluate(()=>document.body.classList.contains('release-sheet-open')),false);

 // Another account is still pending. Existing dialogs and typing defer presentation.
 await switchAccount('owner',{blockWithDialog:true});
 await page.waitForTimeout(2250);assert.equal(await openSheet().count(),0,'another modal is not interrupted');
 await page.evaluate(()=>{document.querySelector('#release-fixture-dialog').close();document.querySelector('#release-fixture-dialog').remove();const input=document.createElement('input');input.id='release-fixture-input';input.setAttribute('aria-label','Brouillon local');document.querySelector('#portal-main').append(input);input.focus();});
 await page.locator('#release-fixture-input').fill('Un brouillon en cours');await page.waitForTimeout(2250);
 assert.equal(await openSheet().count(),0,'typing is not interrupted');assert.equal(await page.locator('#release-fixture-input').inputValue(),'Un brouillon en cours');
 await page.evaluate(()=>document.querySelector('#release-fixture-input').blur());await visibleSheet();
 assert.equal(f.store.user('owner').seenRelease,undefined);assert.equal(f.store.user('nina').seenRelease,undefined);
 const savedOwner=page.waitForResponse(response=>response.url().endsWith('/api/releases/seen')&&response.status()===200);
 await sheet().getByRole('button',{name:'Fermer les nouveautés',exact:true}).click();await savedOwner;await closedSheet();
 assert.equal(f.store.user('owner').seenRelease,CURRENT_RELEASE.id);assert.equal(f.store.user('camille').seenReleaseAt,firstSeen);

 // A new account keeps its welcome and active guide first, then sees the announcement after pause.
 await switchAccount('nina');await page.locator('#onboarding-dialog[open]').waitFor();await page.waitForTimeout(2250);
 assert.equal(await openSheet().count(),0,'the new-account welcome has priority');
 await page.locator('#onboarding-dialog').getByRole('button',{name:'Me guider',exact:true}).click();
 await page.locator('#onboarding-coach[data-step="connect"]').waitFor();await page.waitForTimeout(2250);
 assert.equal(await openSheet().count(),0,'the active guide has priority');
 await page.locator('#onboarding-coach').getByRole('button',{name:'Mettre le guide en pause',exact:true}).click();
 await visibleSheet();assert.equal(f.store.user('nina').onboarding.status,'paused');await dismissPrimary();

 // Completing an existing guide unlocks the same deferred presentation.
 await switchAccount('coadmin');await page.locator('#onboarding-coach[data-step="finish"]').waitFor();
 assert.equal(await openSheet().count(),0);
 await page.locator('#onboarding-coach').getByRole('button',{name:'J’ai mes repères',exact:true}).click();
 await visibleSheet();assert.equal(f.store.user('coadmin').onboarding.status,'completed');await dismissPrimary();

 assert.equal(f.calls.mail.length,0);assert.equal(f.calls.ent.length,0);assert.equal(permissionRequests,0);assert.equal(pushSubscriptions,0);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,automaticOnce:true,persistedDismissal:true,voluntaryReplay:true,keyboardFocus:true,escape:true,accountIsolation:true,logoutPrivacy:true,typingDeferred:true,otherModalDeferred:true,onboardingWelcomeDeferred:true,onboardingActiveDeferred:true,afterPause:true,afterCompletion:true,widths:[320,390,1440],dark:true,reducedMotion:true,externalRequests:0,realMessagesSent:0,permissionRequests:0}));
}catch(error){
 await page?.screenshot({path:'test-results/releases-failure.png',fullPage:true,animations:'allow',caret:'initial',timeout:60000}).catch(()=>{});throw error;
}finally{await browser?.close();f.server.closeAllConnections();await f.close();}
