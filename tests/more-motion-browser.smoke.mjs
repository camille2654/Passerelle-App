import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {controlFixture} from './control-fixture.js';
import {parisDate} from '../src/work.js';
import {subjectFor} from '../src/subjects.js';
import {openTool} from './simple-navigation.js';

const f=await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'}),errors=[],external=[];
const date=parisDate(new Date()),user=f.store.user('camille');
user.calendarEvents={math:{id:'math',title:'Mathématiques',date,start:date+'T08:00:00+01:00',end:date+'T09:00:00+01:00',location:'B204',subject:subjectFor({label:'Mathématiques'}),created:Date.now(),modified:Date.now()}};
f.menu.get=async()=>({date,status:'not_found',next:null,days:[]});f.store.save();
let browser,page;
const main=name=>page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name,exact:true});
async function settle(){await page.evaluate(async()=>{await document.fonts.ready;await Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{})));});}
async function shot(name){await settle();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);await page.screenshot({path:'test-results/'+name+'.png',animations:'disabled'});}
try{
 fs.mkdirSync('test-results',{recursive:true});browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
 page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});page.setDefaultTimeout(45000);
 page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text());});
 page.on('request',r=>{const u=new URL(r.url());if(['http:','https:'].includes(u.protocol)&&u.origin!==new URL(f.root).origin)external.push(u.origin);});
 await page.context().addCookies([{name:'agenda_session',value:f.cookies.camille.split('=')[1],url:f.root}]);await page.goto(f.root+'/',{waitUntil:'domcontentloaded'});await main('Accueil').waitFor();await settle();
 // Measure an actual intermediate render, not just the presence of animation declarations.
 const navMotion=await page.evaluate(async()=>{
  const nav=document.querySelector('.sidebar nav'),before=getComputedStyle(nav.querySelector('.nav-motion-indicator')).transform;
  nav.querySelector('[data-page=more]').click();
  const marker=nav.querySelector('.nav-motion-indicator'),animation=marker.getAnimations()[0];
  if(!animation)return {animated:false};animation.pause();animation.currentTime=animation.effect.getTiming().duration/2;
  const middle=getComputedStyle(marker).transform;animation.finish();
  return {animated:true,before,middle,after:getComputedStyle(marker).transform,cards:document.querySelectorAll('.more-quick>.simple-link').length,staggered:[...document.querySelectorAll('.more-quick>.simple-link')].filter(n=>n.getAnimations().length).length};
 });
 assert.equal(navMotion.animated,true);assert.notEqual(navMotion.middle,navMotion.before);assert.notEqual(navMotion.middle,navMotion.after);assert.equal(navMotion.cards,4);assert.equal(navMotion.staggered,4);
 assert.equal(await page.locator('#page-more .more-disclosure[open]').count(),0);assert.equal(await page.locator('#page-more .simple-link:visible').count(),6);await shot('more-motion-mobile');
 const folderMotion=await page.evaluate(async()=>{
  const node=document.querySelector('.simple-toolbox'),before=node.offsetHeight;node.querySelector('summary').click();const animation=node.getAnimations()[0];
  if(!animation)return {animated:false};animation.pause();animation.currentTime=160;const middle=node.getBoundingClientRect().height;animation.finish();await animation.finished;await Promise.resolve();
  return {animated:true,before,middle,after:node.getBoundingClientRect().height,open:node.open};
 });
 assert.equal(folderMotion.animated,true);assert.ok(folderMotion.middle>folderMotion.before+10);assert.ok(folderMotion.middle<folderMotion.after);assert.equal(folderMotion.open,true);
 await page.locator('.simple-toolbox').getByRole('button',{name:/^Mon sac/}).waitFor();
 await page.locator('.simple-toolbox>summary').focus();await page.keyboard.press('Enter');await settle();assert.equal(await page.locator('.simple-toolbox').evaluate(n=>n.open),false);
 // Reversing during the height transition ends with the latest requested state.
 await page.evaluate(()=>{const summary=document.querySelector('.simple-toolbox>summary');summary.click();summary.click();summary.click();});await settle();assert.equal(await page.locator('.simple-toolbox').evaluate(n=>n.open),true);
 await page.locator('.simple-toolbox').getByRole('button',{name:/^Mon sac/}).click();await page.locator('#bag-date').waitFor();
 await openTool(page,'Changements');await page.locator('#app[data-page=hub]').waitFor();
 await main('Plus').click();if(!await page.locator('.more-secondary').evaluate(n=>n.open))await page.locator('.more-secondary>summary').click();await settle();await page.getByRole('button',{name:/^Aide et contact/}).click();await page.locator('#app[data-page=hub]').waitFor();
 await main('Agenda').click();await page.getByRole('button',{name:'Journée',exact:true}).click();await page.locator('[data-extra=agenda-day][data-date="'+date+'"]').click();await settle();
 const sheet=await page.evaluate(()=>{
  document.querySelector('[data-agenda-course=math]').click();const dialog=document.querySelector('#agenda-course-dialog'),animation=dialog.getAnimations().find(a=>a.effect?.target===dialog&&a.effect.getKeyframes().some(frame=>frame.transform&&frame.transform!=='none'));if(!animation)return {animated:false};
  animation.pause();animation.currentTime=0;const start=dialog.getBoundingClientRect().top;animation.currentTime=200;const middle=dialog.getBoundingClientRect().top;animation.finish();return {animated:true,start,middle,end:dialog.getBoundingClientRect().top};
 });
 assert.equal(sheet.animated,true);assert.ok(sheet.start>sheet.middle+10);assert.ok(sheet.middle>sheet.end);await page.getByRole('dialog').getByRole('heading',{name:'Mathématiques',exact:true}).waitFor();await page.getByRole('button',{name:'Fermer les détails du cours',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#agenda-course-dialog').open);
 for(const width of [320,390,820,1440]){
  await page.setViewportSize({width,height:900});await main('Plus').click();await shot('more-motion-'+width);
  const aligned=await page.evaluate(()=>{const nav=document.querySelector('.sidebar nav'),selected=nav.querySelector('.selected').getBoundingClientRect(),marker=nav.querySelector('.nav-motion-indicator').getBoundingClientRect();return Math.abs(selected.left+selected.width/2-marker.left-marker.width/2)<2&&Math.abs(selected.top+selected.height/2-marker.top-marker.height/2)<2;});assert.equal(aligned,true,'navigation marker aligns after resize');
 }
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await shot('more-motion-dark');
 await page.emulateMedia({reducedMotion:'reduce'});await main('Accueil').click();await main('Plus').click();if(await page.locator('.simple-toolbox').evaluate(n=>n.open))await page.locator('.simple-toolbox>summary').click();await page.locator('.simple-toolbox>summary').click();assert.equal(await page.locator('.simple-toolbox').evaluate(n=>n.open),true);assert.equal(await page.evaluate(()=>document.getAnimations().length),0);await page.locator('.simple-toolbox>summary').click();assert.equal(await page.locator('.simple-toolbox').evaluate(n=>n.open),false);
 await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();assert.equal(await page.locator('.nav-motion-indicator').count(),0);
 await page.context().addCookies([{name:'agenda_session',value:f.cookies.owner.split('=')[1],url:f.root}]);await page.reload({waitUntil:'domcontentloaded'});await main('Plus').click();await page.locator('#page-more').getByRole('button',{name:/^Administration/}).click();await page.locator('#app[data-page=control]').waitFor();assert.equal(await page.locator('.nav-motion-indicator').isVisible(),false);
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({ok:true,visibleActions:6,quickLinks:4,groupedToolsReachable:true,intermediateNavigationMotion:true,staggeredCards:true,animatedDisclosure:true,keyboardAndRapidToggle:true,sheetSlidesFromBottom:true,widths:[320,390,820,1440],dark:true,reducedMotion:true,adminAccessible:true,realENTCalls:0,realEmailsSent:0}));
}catch(error){console.log(JSON.stringify({errors,page:await page?.locator('#app').getAttribute('data-page')}));await page?.screenshot({path:'test-results/more-motion-failure.png',timeout:15000}).catch(()=>{});throw error;}finally{await browser?.close();await f.close();}
