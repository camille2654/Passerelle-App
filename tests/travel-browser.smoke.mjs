import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {controlFixture} from './control-fixture.js';

// Synthetic account, local dates and user-entered timetables only.
const f=await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'});
const now=Date.parse('2026-11-03T06:00:00Z'),date='2026-11-03',user=f.store.user('camille');f.setNow(now);
const lesson=(id,start,end)=>({id,date,title:id,start:date+'T'+start+':00+01:00',end:date+'T'+end+':00+01:00',cancelled:false});
Object.assign(user,{lastSync:now,calendarWindow:{start:'2026-09-01',end:'2027-08-31'},calendarEvents:{first:lesson('Premier cours','08:00','09:00'),middle:lesson('Deuxième cours','10:00','11:00'),last:lesson('Dernier cours','15:00','16:00')}});f.store.save();
f.menu.get=async(_user,query)=>({date:query.date,status:'not_found',days:[]});
let browser,page;const errors=[],external=[];
const modal=()=>page.locator('#travel-dialog');
async function shot(name){await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await modal().evaluate(node=>node.scrollWidth>node.clientWidth+1),false);await page.screenshot({path:'test-results/'+name+'.png',fullPage:true,animations:'allow',caret:'initial'});}
try{
 fs.mkdirSync('test-results',{recursive:true});browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(45000);
 page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(f.root).origin)external.push(url.origin);});
 await page.context().addCookies([{name:'agenda_session',value:f.cookies.camille.split('=')[1],domain:'127.0.0.1',path:'/agenda'}]);await page.goto(f.root+'/',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Bonjour Camille',exact:true}).waitFor();
 await page.evaluate(()=>travelPortal.open());await modal().locator('#travel-settings-form').waitFor();assert.equal(await page.locator('#travel-settings-form input[name=enabled]').isChecked(),false);assert.equal(await page.locator('#travel-home-root').isHidden(),true);
 await page.locator('#travel-settings-form input[name=enabled]').check();await page.locator('#travel-label').fill('Mon train du matin');await page.locator('#travel-outbound').fill('30');await page.locator('#travel-inbound').fill('25');await page.locator('#travel-buffer').fill('10');
 await modal().locator('.travel-timetable summary').click();await page.locator('#travel-out-times').fill('07:00, 07:20, 09:20, 14:20');await page.locator('#travel-in-times').fill('16:05, 16:30, 17:15');
 await modal().getByRole('button',{name:'Enregistrer mon trajet',exact:true}).click();await modal().locator('.travel-preview-times').waitFor();assert.equal(await modal().locator('.travel-preview-times dd').first().textContent(),'07:20');assert.equal(await modal().locator('.travel-preview-times dd').nth(1).textContent(),'16:30');await shot('travel-recorded-mobile');
 assert.ok(!(await modal().textContent()).includes('Données de départ annoncées'));assert.equal(await modal().getByRole('button',{name:'Configurer un réseau · Administration',exact:true}).count(),0);
 await page.locator('#travel-label').fill('Brouillon de mon trajet');await page.locator('#travel-label').focus();user.personalVersion=(user.personalVersion||0)+1;f.store.save();await page.evaluate(()=>refresh(false));assert.equal(await page.locator('#travel-label').inputValue(),'Brouillon de mon trajet');assert.equal(await page.locator('#travel-label').evaluate(node=>node===document.activeElement),true);
 await page.setViewportSize({width:320,height:740});await page.evaluate(()=>appearance.set('dark'));await page.emulateMedia({reducedMotion:'reduce'});await shot('travel-settings-small-dark');for(let index=0;index<12;index++){await page.keyboard.press('Tab');assert.equal(await modal().evaluate(node=>node.contains(document.activeElement)),true);}
 await modal().getByRole('button',{name:'Fermer les trajets',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#travel-dialog').open);assert.equal(await page.locator('#travel-home-root').isVisible(),true);await page.locator('#travel-home-root').getByText('07:20',{exact:true}).waitFor();
 user.calendarEvents.first.cancelled=true;user.personalVersion++;f.store.save();await page.evaluate(()=>refresh(false));await page.locator('#travel-home-root').getByText('09:20',{exact:true}).waitFor();
 f.setNow(now+31*60000);await page.evaluate(()=>refresh(false));await page.locator('#travel-home-root').getByText('Votre agenda doit être actualisé avant de proposer une heure de départ.',{exact:true}).waitFor();assert.equal(await page.locator('#travel-home-root .travel-home-times').count(),0);
 await page.evaluate(()=>travelPortal.open());await modal().locator('#travel-settings-form').waitFor();await modal().getByRole('button',{name:'Fermer les trajets',exact:true}).click();
 await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();assert.equal(await modal().evaluate(node=>node.open),false);assert.equal(await page.locator('#travel-content').textContent(),'');assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(f.calls.mail.length,0);
 console.log(JSON.stringify({ok:true,enabledExplicitly:true,usualAndRecordedOnly:true,nextReturn:true,cancellationsRecalculate:true,staleAgendaWithholdsAdvice:true,draftAndFocusPreserved:true,logoutClears:true,widths:[320,390],dark:true,reducedMotion:true,externalRequests:0}));
}catch(error){await page?.screenshot({path:'test-results/travel-failure.png',animations:'allow',caret:'initial'}).catch(()=>{});throw error;}
finally{f.travel?.close();f.personalMail?.close();f.eventSuggestions?.close();await browser?.close();f.server.closeAllConnections();await f.close();console.log('Travel fixture: cleanup complete.');}
