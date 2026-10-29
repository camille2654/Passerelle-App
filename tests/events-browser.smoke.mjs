import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {controlFixture} from './control-fixture.js';
import {schoolClient} from './school-fixture.js';
import {parisDate,shiftDate} from '../src/work.js';
import {openArea} from './simple-navigation.js';

// Synthetic accounts and ENT replies only; no production accounts or deliveries.
const f=await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'});
const user=f.store.user('camille'),today=parisDate(new Date(f.now())),meeting=shiftDate(today,2),wholeDay=shiftDate(today,3),delegates=shiftDate(today,4);
const numeric=day=>day.split('-').reverse().join('/');
const publication=new Date(f.now()).toISOString(),calls={opened:0},errors=[],external=[];
const articles=[
  {id:'fixture-orientation',title:'Rencontre orientation',content:'La rencontre aura lieu le '+numeric(meeting)+' à 9h. Rendez-vous au bâtiment A.',publicationDateTime:publication},
  {id:'fixture-associations',title:'Journée des associations',content:'La journée des associations se déroulera le '+numeric(wholeDay)+'.',publicationDateTime:publication}
];
f.school.clientFactory=async(_store,member)=>({...schoolClient(member,calls),
  getSchoolInfos:async()=>articles,
  getSchoolInfo:async id=>({...articles.find(item=>item.id===id),attachments:[]}),
  getCommunicationsFolder:async(_folder,_limit,offset)=>offset?[]:[{id:'fixture-delegates',subject:'Réunion des délégués',firstParticipationContent:'Réunion le '+numeric(delegates)+' de 14h à 15h.',read:false,participationsNumber:1,lastParticipation:{dateTime:publication,sender:{person:{firstName:'Alex',lastName:'Exemple'}}}}],
  getCommunicationParticipations:async()=>{calls.opened++;return [{dateTime:publication,sender:{person:{firstName:'Alex',lastName:'Exemple'}},content:'<p>Réunion le '+numeric(delegates)+' de 14h à 15h.</p><script>window.sourceAttack=true</script><img src="https://attacker.invalid/tracker">',attachments:[]}];}
});
f.menu.get=async(_user,query)=>({date:query.date,status:'not_found',days:[]});
f.store.save();
let browser,page;
const modal=()=>page.locator('#events-dialog');
const card=title=>modal().locator('.event-proposal').filter({has:page.getByRole('heading',{name:title,exact:true})});
const count=()=>Object.values(user.schoolEventCalendar||{}).filter(item=>!item.cancelled).length;
async function close(){await modal().getByRole('button',{name:'Fermer les événements',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#events-dialog').open);}
async function screenshot(name){await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' has no page overflow');assert.equal(await modal().evaluate(el=>el.scrollWidth>el.clientWidth+1),false,name+' has no dialog overflow');await page.screenshot({path:'test-results/'+name+'.png',fullPage:true,animations:'allow',caret:'initial',timeout:60000});}
async function feed(){const response=await fetch(f.root+'/calendars/'+f.feedTokens.camille+'.ics');assert.equal(response.status,200);return response.text();}
try{
  fs.mkdirSync('test-results',{recursive:true});
  browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
  page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});
  page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy/i.test(message.text()))errors.push(message.text());});
  page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(f.root).origin)external.push(url.origin);});
  await page.addInitScript(()=>{
    window.__eventPermissionRequests=0;window.__eventSubscriptions=0;
    if(window.Notification)Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=>{window.__eventPermissionRequests++;return 'denied';}});
    if(window.PushManager)Object.defineProperty(PushManager.prototype,'subscribe',{configurable:true,value:async()=>{window.__eventSubscriptions++;throw new Error('Push transport is disabled in this fixture.');}});
  });
  await page.context().addCookies([{name:'agenda_session',value:f.cookies.camille.split('=')[1],domain:'127.0.0.1',path:'/agenda'}]);
  await page.goto(f.root+'/',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bonjour Camille',exact:true}).waitFor();
  assert.equal(await page.locator('#onboarding-dialog').evaluate(el=>el.open),false,'legacy account has no forced welcome');
  await openArea(page,'Mon ENT');
  await page.getByRole('button',{name:'Événements repérés',exact:true}).click();
  await modal().locator('#event-sources-form').waitFor();
  assert.equal(await modal().getByLabel('Les actualités de mon lycée',{exact:false}).isChecked(),false);
  assert.equal(await modal().getByLabel('Les extraits de ma messagerie ENT',{exact:false}).isChecked(),false);
  assert.equal(count(),0);assert.equal(calls.opened,0);
  await modal().getByLabel('Les actualités de mon lycée',{exact:false}).check();
  await modal().getByLabel('Les extraits de ma messagerie ENT',{exact:false}).check();
  await modal().getByRole('button',{name:'Enregistrer mes choix',exact:true}).click();
  await card('Rencontre orientation').waitFor();await card('Réunion des délégués').waitFor();
  assert.equal(await modal().locator('.event-proposal').count(),3);assert.equal(calls.opened,0,'automatic scan does not read a message thread');
  assert.equal(count(),0);assert.equal((await feed()).includes('Rencontre orientation'),false,'suggestions are not automatically put in ICS');
  assert.equal(await page.evaluate(()=>window.__eventPermissionRequests),0);
  await screenshot('events-suggestions-mobile');console.log('Events fixture: sources opt-in and private suggestions verified.');

  await card('Réunion des délégués').getByRole('button',{name:'Lire le message',exact:false}).click();
  await modal().locator('.event-source').waitFor();assert.equal(calls.opened,1);
  assert.equal(await page.evaluate(()=>window.sourceAttack),undefined);assert.equal(await modal().locator('.event-source img').count(),0);
  await modal().getByRole('button',{name:'Retour aux propositions',exact:false}).click();
  await card('Rencontre orientation').getByRole('button',{name:'Vérifier et ajouter',exact:true}).click();
  await modal().locator('#event-confirm-form').waitFor();
  assert.equal(await page.locator('#event-start').inputValue(),'09:00');
  assert.equal(await page.locator('#event-end').inputValue(),'','missing duration is not invented');
  assert.equal(await page.locator('#event-end').evaluate(el=>el.required),true);
  await modal().getByRole('button',{name:'Confirmer l’ajout à mon agenda',exact:true}).click();
  assert.equal(count(),0,'incomplete hours cannot submit an event');
  await page.locator('#event-end').fill('10:15');await page.locator('#event-location').fill('Salle A103');
  await page.locator('#event-title').fill('Orientation à préparer');await page.locator('#event-location').focus();
  user.personalVersion=(user.personalVersion||0)+1;f.store.save();await page.evaluate(()=>refresh(false));
  assert.equal(await page.locator('#event-title').inputValue(),'Orientation à préparer');assert.equal(await page.locator('#event-location').inputValue(),'Salle A103');
  assert.equal(await page.locator('#event-location').evaluate(el=>el===document.activeElement),true,'background refresh keeps draft focus');
  await modal().getByRole('button',{name:'Relire la source',exact:false}).click();await modal().locator('.event-source').waitFor();
  await modal().getByRole('button',{name:'Retour à la vérification',exact:false}).click();
  assert.equal(await page.locator('#event-title').inputValue(),'Orientation à préparer');assert.equal(await page.locator('#event-end').inputValue(),'10:15');assert.equal(await page.locator('#event-location').inputValue(),'Salle A103');
  await page.setViewportSize({width:320,height:740});await page.evaluate(()=>appearance.set('dark'));await page.emulateMedia({reducedMotion:'reduce'});
  await screenshot('events-confirm-small-dark');
  for(let index=0;index<12;index++){await page.keyboard.press('Tab');assert.equal(await modal().evaluate(el=>el.contains(document.activeElement)),true,'dialog retains keyboard focus');}
  await modal().getByRole('button',{name:'Confirmer l’ajout à mon agenda',exact:true}).click();
  await modal().locator('#event-confirm-form').waitFor({state:'detached'});assert.equal(count(),1);
  const timed=Object.values(user.schoolEventCalendar).find(item=>item.title==='Orientation à préparer');
  assert.equal(timed.allDay,false);assert.equal(timed.location,'Salle A103');assert.equal((Date.parse(timed.end)-Date.parse(timed.start))/60000,75);
  assert.ok((await feed()).includes('SUMMARY:Orientation à préparer'));console.log('Events fixture: draft, source review and timed confirmation verified.');

  await card('Journée des associations').getByRole('button',{name:'Vérifier et ajouter',exact:true}).click();
  assert.equal(await modal().getByLabel('Toute la journée',{exact:true}).isChecked(),true);assert.equal(await page.locator('#event-start').isDisabled(),true);
  await modal().getByRole('button',{name:'Confirmer l’ajout à mon agenda',exact:true}).click();
  await modal().locator('#event-confirm-form').waitFor({state:'detached'});assert.equal(count(),2);
  const allDay=Object.values(user.schoolEventCalendar).find(item=>item.allDay);assert.equal(allDay.start,wholeDay);assert.equal(allDay.end,shiftDate(wholeDay,1));
  const ics=await feed();assert.ok(ics.includes('DTSTART;VALUE=DATE:'+wholeDay.replaceAll('-','')));assert.ok(ics.includes('DTEND;VALUE=DATE:'+shiftDate(wholeDay,1).replaceAll('-','')));
  await close();await page.setViewportSize({width:1440,height:1050});await page.evaluate(()=>appearance.set('light'));
  await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name:'Agenda',exact:true}).click();
  await page.locator('#week-date').fill(meeting);await page.locator('#week-date').dispatchEvent('change');
  await page.getByRole('button',{name:/Événement.*Orientation à préparer/}).waitFor();
  assert.equal(await page.locator('.week-lycee-event').count(),2,'confirmed events are in the actual week view');
  await page.getByRole('button',{name:/Événement.*Orientation à préparer/}).click();
  await modal().locator('.events-accepted summary').click();
  const accepted=card('Orientation à préparer');await accepted.getByRole('button',{name:'Retirer de mon agenda',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('#events-dialog .events-accepted .event-proposal').length===1);assert.equal(count(),1);assert.equal(user.schoolEventCalendar[timed.id].cancelled,true);
  const removed=(await feed()).split('BEGIN:VEVENT').find(item=>item.includes('UID:'+timed.id+'@'));assert.equal(removed,undefined);
  await screenshot('events-confirmed-desktop');console.log('Events fixture: week, all-day ICS and calendar removal verified.');
  await card('Réunion des délégués').getByRole('button',{name:'Ignorer',exact:true}).click();
  await card('Réunion des délégués').waitFor({state:'detached'});await close();
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Bonjour Camille',exact:true}).waitFor();
  await openArea(page,'Mon ENT');await page.getByRole('button',{name:'Événements repérés',exact:true}).click();
  await modal().getByRole('heading',{name:'Aucun rendez-vous à confirmer',exact:true}).waitFor();
  await modal().getByRole('button',{name:'Vérifier maintenant',exact:false}).click();await modal().getByRole('heading',{name:'Aucun rendez-vous à confirmer',exact:true}).waitFor();assert.equal(calls.opened,1);
  await modal().getByRole('button',{name:'Choisir mes notifications',exact:false}).click();
  await page.locator('#notifications-dialog[open]').waitFor();await page.locator('#push-preferences-form input[name=events]').waitFor();
  assert.equal(await page.locator('#push-preferences-form input[name=events]').isChecked(),false,'event notifications require a separate choice');
  assert.equal(await page.evaluate(()=>window.__eventPermissionRequests),0);assert.equal(await page.evaluate(()=>window.__eventSubscriptions),0);
  await page.locator('#notifications-dialog').getByRole('button',{name:'Fermer les notifications',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#notifications-dialog').open);

  // Release a former account's GET after logout: it must not restore private UI.
  await page.evaluate(()=>{
    const original=api;window.__lateEventStarted=false;
    api=async(route,body)=>{const result=await original(route,body);if(route==='event-suggestions'&&body===undefined){window.__lateEventStarted=true;await new Promise(resolve=>{window.__releaseEventRead=resolve;});}return result;};
    eventsPortal.reset();eventsPortal.mount(state.user);
  });
  await page.waitForFunction(()=>window.__lateEventStarted);
  await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();
  await page.evaluate(async()=>{window.__releaseEventRead();await new Promise(resolve=>setTimeout(resolve,50));});
  assert.equal(await modal().evaluate(el=>el.open),false);assert.equal(await page.locator('#events-content').textContent(),'');assert.equal(await page.locator('#events-home-root').count(),0);
  assert.equal(await page.getByText('Rencontre orientation',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(f.calls.mail.length,0);
  console.log(JSON.stringify({ok:true,engine:'chromium',sourcesOptIn:true,noReadMarkDuringScan:true,explicitSourceRead:true,noAutomaticCalendarWrites:true,missingDurationNotInvented:true,confirmationToWeekAndICS:true,allDayExclusiveEnd:true,calendarRemovalCancellation:true,dismissPersists:true,sourceReviewPreservesDraft:true,backgroundRefreshPreservesFocus:true,lateLogoutResponseDiscarded:true,separateNotificationOptIn:true,permissionPrompts:0,realMessagesSent:0,widths:[320,390,1440],dark:true,reducedMotion:true,externalRequests:0}));
}catch(error){await page?.screenshot({path:'test-results/events-failure.png',animations:'allow',caret:'initial',timeout:60000}).catch(()=>{});throw error;}
finally{f.eventSuggestions.close();await browser?.close();f.server.closeAllConnections();await f.close();console.log('Events fixture: cleanup complete.');}
