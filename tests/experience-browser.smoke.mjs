import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {controlFixture} from './control-fixture.js';
import {parisDate} from '../src/work.js';
import {subjectFor} from '../src/subjects.js';
import {openArea,openTool} from './simple-navigation.js';

const f=await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'});
const date=parisDate(new Date()), user=f.store.user('camille'), errors=[], external=[];
const subject=subjectFor({label:'Mathématiques'});
for(let n=0;n<8;n++){
  const id='course-'+n, start=String(8+n).padStart(2,'0')+':00', end=String(9+n).padStart(2,'0')+':00';
  user.calendarEvents[id]={id,title:'MATHEMATIQUES',rawTitle:'MATHEMATIQUES',date,start:date+'T'+start+':00+01:00',end:date+'T'+end+':00+01:00',location:'B'+(204+n),subject,created:Date.now(),modified:Date.now()};
}
Object.assign(user,{total:8,enabled:true,manualWork:[{id:'ux-work',title:'Préparer les exercices',subjectLabel:'Mathématiques',due:date,kind:'homework',source:'manual'}]});
f.menu.get=async()=>({date,status:'not_found',next:null,days:[]});f.store.save();
let browser,page;
async function main(name){await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name,exact:true}).click();}
async function refresh(){await page.evaluate(()=>window.refresh(true));}
async function shot(name){await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name);await page.screenshot({path:'test-results/'+name+'.png',animations:'disabled'});}
try {
  fs.mkdirSync('test-results',{recursive:true});
  browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
  page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris',reducedMotion:'reduce',serviceWorkers:'block'});page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text());});
  page.on('request',r=>{const url=new URL(r.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(f.root).origin)external.push(url.origin);});
  await page.context().addCookies([{name:'agenda_session',value:f.cookies.camille.split('=')[1],url:f.root}]);await page.goto(f.root+'/',{waitUntil:'domcontentloaded'});
  console.log('phase: settings');await main('Plus');await page.locator('#page-more').getByRole('button',{name:/^Réglages/}).click();
  assert.equal(await page.locator('.settings-group').count(),4);assert.equal(await page.locator('.settings-group[open]').count(),0);await shot('experience-settings-mobile');
  await page.locator('[data-settings-group=account]>summary').click();await page.getByRole('button',{name:/^Applications connectées/}).click();await page.getByRole('dialog',{name:'Applications connectées'}).waitFor();await page.getByRole('button',{name:'Fermer les applications connectées',exact:true}).click();
  console.log('phase: connection');await openArea(page,'Mon abonnement ICS');await page.getByRole('heading',{name:'Vos cours sont à portée de main',exact:true}).waitFor();assert.equal(await page.locator('.connection-guide .is-complete').count(),3);await page.getByText('8 cours récupérés',{exact:true}).waitFor();await shot('experience-connection-ready');
  console.log('phase: agenda');await page.getByRole('button',{name:'Ouvrir mon agenda',exact:true}).click();await page.locator('.agenda-presentation').waitFor();
  if(await page.getByRole('button',{name:'Journée',exact:true}).getAttribute('aria-pressed')!=='true')await page.getByRole('button',{name:'Journée',exact:true}).click();
  await page.locator('[data-extra=agenda-day][data-date="'+date+'"]').click();await page.locator('[data-agenda-course=course-6]').scrollIntoViewIfNeeded();
  const scroll=await page.evaluate(()=>scrollY);assert.ok(scroll>50,'a long agenda scrolls');
  await page.emulateMedia({reducedMotion:'no-preference'});await page.locator('[data-agenda-course=course-6]').click();await page.getByRole('dialog').getByRole('heading',{name:'Mathématiques',exact:true}).waitFor();await page.emulateMedia({reducedMotion:'reduce'});
  await page.getByLabel('Ajouter une note personnelle',{exact:true}).fill('Brouillon à préserver');
  await page.getByRole('checkbox',{name:'Marquer comme fait : Préparer les exercices',exact:true}).check();await page.locator('#agenda-work-status').getByRole('button',{name:'Annuler',exact:true}).waitFor();assert.equal(f.store.user('camille').workOverrides['ux-work'].done,true);
  await page.route('**/api/work/ux-work',r=>r.fulfill({status:409,json:{error:'La synchronisation est en cours.'}}));await page.locator('#agenda-work-status').getByRole('button',{name:'Annuler',exact:true}).click();await page.locator('#agenda-work-status').getByText('La synchronisation est en cours.',{exact:true}).waitFor();assert.equal(f.store.user('camille').workOverrides['ux-work'].done,true);await page.unroute('**/api/work/ux-work');
  await page.locator('#agenda-work-status').getByRole('button',{name:'Annuler',exact:true}).click();await page.getByText('Modification annulée.',{exact:true}).waitFor();assert.equal(f.store.user('camille').workOverrides['ux-work'].done,false);assert.equal(await page.evaluate(()=>state.user.work.find(w=>w.id==='ux-work').done),false);
  assert.equal(await page.getByLabel('Ajouter une note personnelle',{exact:true}).inputValue(),'Brouillon à préserver');
  await page.getByRole('button',{name:'Fermer les détails du cours',exact:true}).click();
  assert.equal(await page.locator('[data-agenda-course=course-6]').evaluate(n=>n===document.activeElement),true,'focus returns to the recreated course');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-scroll)<5,'course close retains page position');
  console.log('phase: scroll return');await main('Devoirs');await main('Agenda');await page.waitForFunction(top=>Math.abs(scrollY-top)<5,scroll);assert.equal(await page.locator('#week-date').inputValue(),date);await shot('experience-agenda-mobile');
  console.log('phase: work feedback');await main('Devoirs');console.log(JSON.stringify({serverWork:(await f.request('status',undefined,'camille')).body.user.work.map(w=>({id:w.id,done:w.done})),clientWork:await page.evaluate(()=>state.user.work.map(w=>({id:w.id,done:w.done})))}));await page.locator('#page-work [data-feature=work-done][data-id=ux-work]').click();await page.locator('#toast').getByRole('button',{name:'Annuler',exact:true}).waitFor();
  await page.locator('#toast').getByRole('button',{name:'Annuler',exact:true}).focus();assert.equal(await page.locator('#toast').isVisible(),true);await page.keyboard.press('Enter');await page.locator('#toast').getByText('Modification annulée.',{exact:true}).waitFor();assert.equal(f.store.user('camille').workOverrides['ux-work'].done,false);
  // A failed undo keeps the saved value and presents the service's explanation.
  await page.locator('#page-work [data-feature=work-done][data-id=ux-work]').click();await page.locator('#toast').getByRole('button',{name:'Annuler',exact:true}).waitFor();
  await page.route('**/api/work/ux-work',r=>r.fulfill({status:409,json:{error:'Attendez la fin de la synchronisation.'}}));await page.locator('#toast').getByRole('button',{name:'Annuler',exact:true}).click();await page.locator('#toast').getByText('Attendez la fin de la synchronisation.',{exact:true}).waitFor();assert.equal(f.store.user('camille').workOverrides['ux-work'].done,true);await page.unroute('**/api/work/ux-work');
  console.log('phase: subject undo');
  await main('Plus');await page.locator('#page-more [data-library-all]').click();await page.locator('[data-library-subject]').filter({hasText:'Mathématiques'}).click();
  await page.locator('.library-completed>summary').click();await page.locator('[data-library-work=ux-work]').uncheck();await page.locator('#toast .undo-button').waitFor();assert.equal(f.store.user('camille').workOverrides['ux-work'].done,false);
  await page.locator('#toast .undo-button').click();await page.locator('#toast').getByText('Modification annulée.',{exact:true}).waitFor();assert.equal(f.store.user('camille').workOverrides['ux-work'].done,true);
  // Reconnect is distinguished from a temporary source failure, with real recovery navigation.
  console.log('phase: recovery');user.skolengoError='Connexion expirée de démonstration';user.lastError='Connexion expirée de démonstration';f.store.save();await refresh();
  await page.locator('.recovery-notice').getByText('Reconnectez votre lycée',{exact:true}).waitFor();await page.locator('.recovery-notice').getByRole('button',{name:'Reconnecter mon ENT',exact:true}).click();assert.equal(await page.locator('#school-search').isVisible(),true);assert.equal(await page.locator('.connection-guide [aria-current=step] strong').textContent(),'Connexion ENT');
  await page.route('**/api/skolengo/schools?*',r=>r.fulfill({status:502,contentType:'text/html',body:'Unavailable'}));await page.getByRole('textbox',{name:'Nom ou ville de l’établissement'}).fill('Lycée exemple');await page.getByRole('button',{name:'Chercher',exact:true}).click();await page.locator('#school-results [role=alert]').getByText(/Le service ne répond pas correctement/).waitFor();assert.equal(await page.getByRole('textbox',{name:'Nom ou ville de l’établissement'}).inputValue(),'Lycée exemple');await page.unroute('**/api/skolengo/schools?*');
  await page.route('**/api/skolengo/schools?*',r=>r.fulfill({json:{schools:[{id:'synthetic',name:'Lycée exemple',city:'Ville test',zipCode:'00000'}]}}));await page.route('**/api/skolengo/start',r=>r.fulfill({status:502,json:{error:'Le lycée ne répond pas. Réessayez plus tard.'}}));
  await page.getByRole('button',{name:'Chercher',exact:true}).click();await page.getByRole('button',{name:'Choisir',exact:true}).click();await page.locator('#connection-recovery').getByText('La connexion n’a pas pu aboutir',{exact:true}).waitFor();assert.equal(await page.locator('#ent-dialog').evaluate(n=>n.open),false);await shot('experience-connection-error');
  await page.unroute('**/api/skolengo/start');await page.unroute('**/api/skolengo/schools?*');
  user.skolengoError=null;user.lastError='Source temporairement indisponible.';f.store.save();await refresh();await page.getByText('La mise à jour n’a pas abouti',{exact:true}).waitFor();
  await page.route('**/api/sync',r=>r.abort('internetdisconnected'));await page.locator('.recovery-notice').getByRole('button',{name:'Réessayer',exact:true}).click();await page.locator('#toast').getByText(/Impossible de joindre Passerelle/).waitFor();await page.unroute('**/api/sync');
  user.lastError=null;f.store.save();await refresh();
  for(const width of [320,390,820,1440]){await page.setViewportSize({width,height:900});await openTool(page,'Semaine');await shot('experience-agenda-'+width);await main('Plus');await page.locator('#page-more').getByRole('button',{name:/^Réglages/}).click();await shot('experience-settings-'+width);}
  await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await openTool(page,'Semaine');await shot('experience-dark-reduced');assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  // No undo or scroll state from one account is inherited by the next one.
  await main('Devoirs');await page.getByRole('button',{name:'Afficher les travaux faits',exact:true}).click();await page.locator('#page-work [data-feature=work-done][data-id=ux-work]').click();await page.locator('#toast .undo-button').waitFor();
  await page.context().addCookies([{name:'agenda_session',value:f.cookies.nina.split('=')[1],url:f.root}]);await refresh();await page.getByRole('heading',{name:'Bonjour Nina',exact:true}).waitFor();assert.equal(await page.locator('#toast').isVisible(),false);await main('Agenda');await page.waitForFunction(()=>scrollY===0);
  const newcomer=f.store.user('nina');Object.assign(newcomer,{skolengo:null,schoolName:null,studentId:null,feedKey:null,feedHash:null,lastSync:null});f.store.save();await refresh();
  await page.getByRole('button',{name:'Connecter mon ENT',exact:true}).click();await page.locator('.connection-guide').getByRole('heading',{name:'Quelques étapes pour commencer',exact:true}).waitFor();assert.equal(await page.locator('.connection-guide [aria-current=step] strong').textContent(),'Mon lycée');await shot('experience-connection-first');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);console.log(JSON.stringify({ok:true,connectionSteps:true,settingsGroups:4,undoSavedAndFailed:true,scrollAndFocusRestored:true,actionableErrors:true,identityIsolation:true,widths:[320,390,820,1440],dark:true,reducedMotion:true,realENTCalls:0,realEmailsSent:0}));
} catch(error) {console.log(JSON.stringify({errors,dialogs:await page?.locator('dialog[open]').evaluateAll(ns=>ns.map(n=>n.id)),page:await page?.locator('#app').getAttribute('data-page')}));await page?.screenshot({path:'test-results/experience-failure.png',timeout:15000}).catch(()=>{});throw error;} finally {await browser?.close();await f.close();}
