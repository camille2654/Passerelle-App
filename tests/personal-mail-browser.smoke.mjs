import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {controlFixture} from './control-fixture.js';
import {parisDate,shiftDate} from '../src/work.js';

// Temporary accounts, application credentials and provider replies only.
const f=await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'});
const user=f.store.user('camille'),today=parisDate(new Date(f.now())),meeting=shiftDate(today,7),sender='direction@lycee.invalid';
const calls=[],errors=[],external=[];
const mail={id:'fixture-personal-mail',internalDate:String(f.now()-86400000),payload:{mimeType:'text/plain',headers:[{name:'From',value:'La direction <'+sender+'>'},{name:'Subject',value:'Rencontre personnelle'}],body:{data:Buffer.from('Réunion le '+meeting.split('-').reverse().join('/')+' de 18h à 19h.').toString('base64url')}}};
f.personalMail.request=async request=>{
  calls.push(request);const url=new URL(request.url);
  if(url.href==='https://oauth2.googleapis.com/token')return {access_token:'fixture-private-access',refresh_token:'fixture-private-refresh',expires_in:3600,scope:'https://www.googleapis.com/auth/gmail.readonly'};
  if(url.pathname==='/gmail/v1/users/me/profile')return {emailAddress:'camille@gmail.invalid'};
  if(url.pathname==='/gmail/v1/users/me/messages')return {messages:[{id:mail.id}]};
  if(url.pathname==='/gmail/v1/users/me/messages/'+mail.id)return mail;
  throw new Error('Unexpected provider request in the synthetic fixture.');
};
f.menu.get=async(_user,query)=>({date:query.date,status:'not_found',days:[]});
let browser,page;
const modal=()=>page.locator('#personal-mail-dialog');
const provider=kind=>modal().locator('[data-mail-provider="'+kind+'"]');
async function session(id){await page.context().clearCookies();await page.context().addCookies([{name:'agenda_session',value:f.cookies[id].split('=')[1],domain:'127.0.0.1',path:'/agenda'}]);}
async function openMail(){
  await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name:'Plus',exact:true}).click();
  await page.locator('#page-more .simple-link').filter({has:page.locator('strong',{hasText:/^Réglages$/})}).click();
  await page.locator('#page-settings .simple-link').filter({has:page.locator('strong',{hasText:/^Mails personnels$/})}).click();
  await modal().waitFor({state:'visible'});await modal().getByRole('heading',{name:'Gmail',exact:true}).waitFor();
}
async function closeMail(){await modal().getByRole('button',{name:'Fermer les mails personnels',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#personal-mail-dialog').open);}
async function shot(name){await page.evaluate(()=>document.fonts.ready);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await modal().evaluate(el=>el.scrollWidth>el.clientWidth+1),false);await page.screenshot({path:'test-results/'+name+'.png',fullPage:true,animations:'allow',caret:'initial',timeout:60000});}
async function feed(){const response=await fetch(f.root+'/calendars/'+f.feedTokens.camille+'.ics');assert.equal(response.status,200);return response.text();}
try{
  fs.mkdirSync('test-results',{recursive:true});browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
  page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'});page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',value=>{if(value.type()==='error'&&/Content Security Policy/i.test(value.text()))errors.push(value.text());});
  page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(f.root).origin)external.push(url.origin);});
  await page.addInitScript(()=>{window.__mailPermissionRequests=0;if(window.Notification)Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=>{window.__mailPermissionRequests++;return 'denied';}});});
  await session('camille');await page.goto(f.root+'/',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Bonjour Camille',exact:true}).waitFor();await openMail();
  assert.equal(await provider('gmail').getByRole('button',{name:'Continuer avec Google',exact:false}).isDisabled(),true);assert.equal(await provider('outlook').getByRole('button',{name:'Continuer avec Microsoft',exact:false}).isDisabled(),true);
  assert.equal(await modal().getByRole('button',{name:'Configurer les connexions · Administration',exact:true}).count(),0);assert.equal(calls.length,0);await shot('personal-mail-unconfigured-mobile');await closeMail();

  await session('owner');await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Bonjour Administrateur',exact:true}).waitFor();await openMail();
  await modal().getByRole('button',{name:'Configurer les connexions · Administration',exact:true}).click();
  const admin=modal().locator('.personal-mail-admin-form[data-provider="gmail"]');await admin.waitFor();
  assert.equal(await page.locator('#mail-redirect-gmail').inputValue(),f.root+'/api/personal-mail/oauth/gmail/callback');
  await admin.getByLabel('Identifiant du client',{exact:true}).fill('fixture.apps.googleusercontent.com');await admin.getByLabel('Secret du client',{exact:true}).fill('fixture-only-client-secret');await admin.getByLabel('Autoriser les connexions Gmail dans Passerelle',{exact:true}).check();
  await admin.getByRole('button',{name:'Enregistrer Gmail',exact:true}).click();await modal().getByText('Secret enregistré',{exact:true}).waitFor();
  assert.equal(await modal().locator('.personal-mail-admin-form[data-provider="gmail"] input[name=clientSecret]').inputValue(),'');assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('fixture-only-client-secret'));
  await page.setViewportSize({width:1440,height:1050});await shot('personal-mail-admin-desktop');await closeMail();

  // The actual local callback exchanges an invented code using the fake transport.
  const started=await f.request('personal-mail/gmail/connect',{accountId:'camille'},'camille');assert.equal(started.status,200);
  const authorization=new URL(started.body.authorizationURL);assert.equal(authorization.origin,'https://accounts.google.com');assert.equal(authorization.searchParams.get('code_challenge_method'),'S256');
  const callback=await fetch(f.root+'/api/personal-mail/oauth/gmail/callback?'+new URLSearchParams({state:authorization.searchParams.get('state'),code:'fixture-authorization-code'}),{redirect:'manual',headers:{cookie:f.cookies.camille}});assert.equal(callback.status,303);
  assert.equal(callback.headers.get('location'),f.root+'/#personal-mail=connected');assert.equal(calls.length,2,'linking a mailbox does not read messages');
  await session('camille');await page.setViewportSize({width:390,height:844});await page.goto(callback.headers.get('location'),{waitUntil:'domcontentloaded'});
  await modal().getByText('camille@gmail.invalid',{exact:true}).waitFor();assert.ok(!page.url().includes('personal-mail='));
  const preferences=provider('gmail').locator('.personal-mail-preferences');assert.equal(await preferences.locator('input[name=enabled]').isChecked(),false);assert.equal(await preferences.locator('textarea[name=senders]').inputValue(),'');
  await preferences.locator('input[name=enabled]').check();await preferences.getByRole('button',{name:'Enregistrer ma sélection',exact:true}).click();await modal().getByText('Indiquez une à dix adresses mail précises pour activer la lecture.',{exact:true}).waitFor();assert.equal(calls.length,2);
  await preferences.locator('textarea[name=senders]').fill(sender);await preferences.locator('textarea[name=senders]').focus();user.personalVersion=(user.personalVersion||0)+1;f.store.save();await page.evaluate(()=>refresh(false));assert.equal(await preferences.locator('textarea[name=senders]').inputValue(),sender);assert.equal(await preferences.locator('textarea[name=senders]').evaluate(el=>el===document.activeElement),true);
  await page.setViewportSize({width:320,height:740});await page.evaluate(()=>appearance.set('dark'));await page.emulateMedia({reducedMotion:'reduce'});await shot('personal-mail-selection-small-dark');
  await preferences.getByRole('button',{name:'Enregistrer ma sélection',exact:true}).click();await modal().getByText('Votre sélection d’expéditeurs est enregistrée.',{exact:true}).waitFor();assert.equal(calls.length,2,'sender consent alone does not scan until the source is selected');
  for(let index=0;index<14;index++){await page.keyboard.press('Tab');assert.equal(await modal().evaluate(el=>el.contains(document.activeElement)),true);}
  await modal().getByRole('button',{name:'Voir mes événements repérés',exact:false}).click();
  const events=page.locator('#events-dialog');await events.locator('#event-sources-form').waitFor();assert.equal(await events.getByLabel('Les mails personnels sélectionnés',{exact:false}).isChecked(),false);await events.getByLabel('Les mails personnels sélectionnés',{exact:false}).check();await events.getByRole('button',{name:'Enregistrer mes choix',exact:true}).click();
  const proposal=events.locator('.event-proposal').filter({has:page.getByRole('heading',{name:'Rencontre personnelle',exact:true})});await proposal.waitFor();await proposal.getByText('Mail personnel · Gmail',{exact:false}).waitFor();assert.ok(!(await feed()).includes('Rencontre personnelle'));
  await proposal.getByRole('button',{name:'Lire le message',exact:false}).click();await events.locator('.event-source').waitFor();assert.equal(await events.locator('.event-source img').count(),0);await events.getByRole('button',{name:'Retour aux propositions',exact:false}).click();await proposal.getByRole('button',{name:'Vérifier et ajouter',exact:true}).click();
  assert.equal(await page.locator('#event-start').inputValue(),'18:00');assert.equal(await page.locator('#event-end').inputValue(),'19:00');await events.getByRole('button',{name:'Confirmer l’ajout à mon agenda',exact:true}).click();await events.locator('#event-confirm-form').waitFor({state:'detached'});assert.ok((await feed()).includes('SUMMARY:Rencontre personnelle'));
  await events.getByRole('button',{name:'Fermer les événements',exact:true}).click();await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name:'Agenda',exact:true}).click();await page.locator('#week-date').fill(meeting);await page.locator('#week-date').dispatchEvent('change');await page.getByRole('button',{name:/Événement.*Rencontre personnelle/}).waitFor();

  // A stale application registration still leaves a way to remove local access.
  f.personalMail.configure('gmail',{clientId:'changed.apps.googleusercontent.com',clientSecret:'changed-fixture-secret',enabled:true});await openMail();await provider('gmail').getByText('Accès à renouveler',{exact:true}).waitFor();assert.equal(await provider('gmail').getByRole('button',{name:'Déconnecter cette boîte',exact:true}).isEnabled(),true);
  page.once('dialog',value=>value.accept());await provider('gmail').getByRole('button',{name:'Déconnecter cette boîte',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#personal-mail-content [data-personal-mail=disconnect]'));assert.equal(f.personalMail.connection(user,'gmail'),null);assert.ok((await feed()).includes('SUMMARY:Rencontre personnelle'),'confirmed events survive mailbox disconnection');
  await closeMail();

  await page.evaluate(()=>{const original=api;window.__latePersonalRead=false;api=async(route,body)=>{const value=await original(route,body);if(route==='personal-mail'&&body===undefined){window.__latePersonalRead=true;await new Promise(resolve=>{window.__releasePersonalRead=resolve;});}return value;};personalMailPortal.open();});
  await page.waitForFunction(()=>window.__latePersonalRead);await closeMail();await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();await page.evaluate(async()=>{window.__releasePersonalRead();await new Promise(resolve=>setTimeout(resolve,50));});
  assert.equal(await modal().evaluate(el=>el.open),false);assert.equal(await page.locator('#personal-mail-content').textContent(),'');assert.equal(await page.getByText('camille@gmail.invalid',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.__mailPermissionRequests),0);
  assert.ok(calls.filter(value=>value.method==='POST').every(value=>value.url==='https://oauth2.googleapis.com/token'));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(f.calls.mail.length,0);
  console.log(JSON.stringify({ok:true,engine:'chromium',unconfiguredButtonsDisabled:true,adminCredentialsEncrypted:true,adminSecretNeverRefilled:true,realLocalOAuthCallback:true,callbackHashConsumed:true,explicitSenderConsent:true,sourceConsent:true,personalMailToWeekAndICS:true,staleConnectionRemovable:true,confirmedEventsPreserved:true,draftAndFocusPreserved:true,lateLogoutResponseDiscarded:true,widths:[320,390,1440],dark:true,reducedMotion:true,externalBrowserRequests:0,realMessagesSent:0}));
}catch(error){await page?.screenshot({path:'test-results/personal-mail-failure.png',animations:'allow',caret:'initial',timeout:60000}).catch(()=>{});throw error;}
finally{f.personalMail.close();f.eventSuggestions.close();await browser?.close();f.server.closeAllConnections();await f.close();console.log('Personal mail fixture: cleanup complete.');}
