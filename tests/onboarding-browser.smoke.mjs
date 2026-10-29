import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {controlFixture} from './control-fixture.js';
import {initializeOnboarding} from '../src/onboarding.js';
import {parisDate,shiftDate} from '../src/work.js';
import {subjectFor} from '../src/subjects.js';

// All accounts, ENT replies and delivery transports belong to this temporary fixture.
const engine=process.env.PASSERELLE_TEST_ENGINE==='webkit'?'webkit':'chromium';
const baseURL=engine==='webkit'?'https://127.0.0.1:8035/agenda':'http://127.0.0.1:8021/agenda';
const f=await controlFixture({port:8021,baseURL});
let tlsServer,tlsDir;
if(engine==='webkit'){
  tlsDir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-onboarding-tls-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(tlsDir,'key.pem'),'-out',path.join(tlsDir,'cert.pem'),'-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost','-days','1'],{stdio:'ignore'});
  tlsServer=https.createServer({key:fs.readFileSync(path.join(tlsDir,'key.pem')),cert:fs.readFileSync(path.join(tlsDir,'cert.pem'))},f.app);
  tlsServer.listen(8035,'127.0.0.1');await new Promise(resolve=>tlsServer.once('listening',resolve));
  f.root=baseURL;
}
const errors=[],externalRequests=[],today=parisDate(new Date()),tomorrow=shiftDate(today,1);
const subject=subjectFor({label:'Mathématiques'}),legacy=f.store.user('camille');
legacy.calendarEvents={
  today:{id:'today',title:'Mathématiques',rawTitle:'Mathématiques',date:today,start:today+'T08:00:00Z',end:today+'T09:00:00Z',location:'B204',subject},
  tomorrow:{id:'tomorrow',title:'Mathématiques',rawTitle:'Mathématiques',date:tomorrow,start:tomorrow+'T08:00:00Z',end:tomorrow+'T09:00:00Z',location:'B204',subject}
};
for(const course of Object.values(legacy.calendarEvents))Object.assign(course,{created:Date.now(),modified:Date.now(),sequence:0});
legacy.manualWork=[{id:'legacy-work',title:'Exercices de démonstration',subjectLabel:'Mathématiques',due:tomorrow,kind:'homework',source:'manual'}];
const connected=f.store.user('nina');
Object.assign(connected,{onboarding:initializeOnboarding(f.now()),feedKey:null,feedHash:null,cachedICS:null,lastSync:null});
f.menu.get=async(_user,query)=>({date:query.date,status:'not_found',next:null,days:[]});
f.store.save();

let browser,page;
const userByLogin=login=>f.store.state.users.find(user=>user.login===login);
const coach=()=>page.locator('#onboarding-coach');
const welcome=()=>page.locator('#onboarding-dialog');
async function waitStep(step){
  await page.locator(`#onboarding-coach[data-step="${step}"]`).waitFor();
  assert.equal(await coach().isVisible(),true,'the current guide step is visible');
}
async function guideButton(name){await coach().getByRole('button',{name,exact:true}).click();}
async function go(name){await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name,exact:true}).click();}
async function shot(name){
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' has no horizontal overflow');
  await page.screenshot({path:'test-results/'+name+'.png',fullPage:true,animations:'allow',caret:'initial',timeout:60000});
}
async function beginWelcome(){
  await welcome().waitFor();
  await welcome().getByRole('button',{name:/^(Me guider|Reprendre la visite)$/}).click();
  await waitStep('connect');
}
async function logout(){
  await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();
  await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();
  assert.equal(await coach().isVisible(),false);
  assert.equal(await welcome().evaluate(dialog=>dialog.open),false);
  assert.equal(await page.locator('.onboarding-target').count(),0);
}

try{
  fs.mkdirSync('test-results',{recursive:true});
  browser=await(engine==='webkit'?webkit.launch({headless:true}):chromium.launch({headless:true,args:['--renderer-process-limit=1']}));
  page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris',ignoreHTTPSErrors:engine==='webkit',...(process.env.PASSERELLE_TEST_NO_SW?{serviceWorkers:'block'}:{})});
  page.setDefaultTimeout(45000);page.setDefaultNavigationTimeout(60000);
  page.on('pageerror',error=>errors.push(error.message));
  if(engine==='webkit'){
    page.on('framenavigated',frame=>{if(frame===page.mainFrame())console.log('WebKit navigation '+new URL(frame.url()).pathname);});
    page.on('requestfailed',request=>console.log('WebKit failed '+new URL(request.url()).pathname+' '+request.failure()?.errorText));
    page.on('request',request=>{if(request.isNavigationRequest())console.log('WebKit navigation request '+request.method()+' '+new URL(request.url()).pathname+' queryFields='+[...new URL(request.url()).searchParams.keys()].join(','));});
    page.on('crash',()=>console.log('WebKit page crashed'));
  }
  page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Content Security Policy'))errors.push(message.text());});
  // Observe only: route interception races with WebKit service-worker process swaps.
  // ENT, menus and delivery transports are already local fakes in the fixture.
  page.on('request',request=>{
    const url=new URL(request.url());
    if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(f.root).origin)externalRequests.push(url.origin);
  });
  await page.addInitScript(()=>{
    window.__onboardingPermissionRequests=0;window.__onboardingSubscriptions=0;
    if(window.Notification)Object.defineProperty(Notification,'requestPermission',{configurable:true,value:async()=>{window.__onboardingPermissionRequests++;return 'denied';}});
    if(window.PushManager)Object.defineProperty(PushManager.prototype,'subscribe',{configurable:true,value:async()=>{window.__onboardingSubscriptions++;throw new Error('No subscription is allowed in the onboarding fixture.');}});
  });

  // A real public registration displays help without making the user connect the ENT first.
  await page.goto(f.root+'/',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Créer un compte gratuit',exact:true}).click();
  await page.getByLabel('Votre prénom',{exact:true}).fill('Alex');
  await page.getByLabel('Identifiant du portail',{exact:true}).fill('alex-onboarding');
  await page.getByLabel('Mot de passe du portail',{exact:true}).fill('temporary-onboarding-password');
  await page.getByRole('button',{name:'Créer mon espace',exact:false}).click();
  await welcome().getByRole('heading',{name:'Bienvenue sur Passerelle',exact:true}).waitFor();
  const member=userByLogin('alex-onboarding');
  assert.ok(member);assert.equal(member.admin,false);assert.equal(member.onboarding.status,'new');
  assert.equal(await welcome().evaluate(el=>el.contains(document.activeElement)),true,'welcome receives keyboard focus');
  for(let i=0;i<8;i++){await page.keyboard.press('Tab');assert.equal(await welcome().evaluate(el=>el.contains(document.activeElement)),true,'welcome traps focus while modal');}
  await shot('onboarding-welcome-mobile');
  await page.setViewportSize({width:320,height:740});
  await page.evaluate(()=>appearance.set('dark'));
  await page.emulateMedia({reducedMotion:'reduce'});
  await shot('onboarding-welcome-small-dark');
  await page.waitForFunction(()=>document.getAnimations().length===0);
  await welcome().getByRole('button',{name:'Plus tard',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#onboarding-dialog').open);
  assert.equal(member.onboarding.status,'paused');assert.equal(member.onboarding.completedAt,null);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bonjour Alex',exact:true}).waitFor();
  assert.equal(await welcome().evaluate(dialog=>dialog.open),false,'a postponed welcome does not reopen after reload');
  await page.locator('.onboarding-resume').getByRole('button',{name:'Reprendre le guide',exact:true}).click();
  if(await welcome().evaluate(dialog=>dialog.open))await beginWelcome();else await waitStep('connect');
  assert.equal(member.onboarding.status,'active');
  assert.equal(await page.locator('#app').getAttribute('data-page'),'calendar');
  await guideButton('Connecter mon ENT');
  await page.getByLabel('Nom ou ville de l’établissement',{exact:true}).waitFor();
  assert.equal(member.skolengo,undefined,'opening the connection search does not connect an account');
  await guideButton('Découvrir l’app d’abord');
  await waitStep('home');
  assert.equal(await page.locator('#app').getAttribute('data-page'),'school');
  assert.ok((await coach().boundingBox()).y>=65,'the guidance is not hidden behind the mobile header');
  await shot('onboarding-context-small-dark');

  // The guide operates the real destinations and records a resumable position.
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>appearance.set('light'));
  await guideButton('Voir mon agenda');await waitStep('agenda');
  await page.locator('.week-day').first().waitFor();
  const weekBefore=await page.locator('#week-date').inputValue();
  await guideButton('Voir la semaine suivante');
  await page.waitForFunction(value=>document.querySelector('#week-date')?.value!==value,weekBefore);
  assert.equal(await page.locator('#app').getAttribute('data-page'),'planner');
  await coach().getByRole('button',{name:'Mettre le guide en pause',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#onboarding-coach')?.hidden!==false);
  assert.equal(member.onboarding.status,'paused');assert.equal(member.onboarding.step,'agenda');
  await go('Accueil');
  const resumeButton=page.locator('.onboarding-resume').getByRole('button',{name:'Reprendre le guide',exact:true});
  await resumeButton.focus();await page.evaluate(()=>refresh(false));
  assert.equal(await resumeButton.evaluate(el=>el===document.activeElement),true,'background refresh preserves resume keyboard focus');
  await go('Plus');
  assert.equal(await page.getByRole('button',{name:'Guide de démarrage',exact:false}).isEnabled(),true,'the guide entry is reenabled after pausing');
  await go('Accueil');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.locator('.onboarding-resume').getByRole('button',{name:'Reprendre le guide',exact:true}).click();
  await waitStep('agenda');
  assert.equal(await page.locator('#app').getAttribute('data-page'),'planner');
  await guideButton('Découvrir les devoirs');await waitStep('work');
  assert.equal(await page.locator('#app').getAttribute('data-page'),'work');
  const workCount=(member.manualWork||[]).length;
  await guideButton('Ouvrir l’ajout d’un devoir');
  assert.equal(await page.locator('.manual-work').evaluate(element=>element.open),true);
  await page.getByLabel('Titre',{exact:true}).fill('Brouillon conservé pendant la visite');
  await page.evaluate(()=>refresh(false));
  assert.equal(await page.getByLabel('Titre',{exact:true}).inputValue(),'Brouillon conservé pendant la visite');
  assert.equal((member.manualWork||[]).length,workCount,'trying the form never creates a homework item');
  await shot('onboarding-work-mobile');
  await page.getByLabel('Titre',{exact:true}).fill('');
  await guideButton('Continuer');await waitStep('more');
  await guideButton('Découvrir Ma soirée');
  await page.getByRole('heading',{name:'Ma soirée',exact:true}).waitFor();
  await guideButton('Les dernières astuces');await waitStep('finish');
  await guideButton('Choisir mes notifications');
  await page.getByRole('dialog',{name:'Mes notifications',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__onboardingPermissionRequests),0);
  assert.equal(await page.evaluate(()=>window.__onboardingSubscriptions),0);
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#notifications-dialog').open);
  await guideButton('J’ai mes repères');
  await page.waitForFunction(()=>document.querySelector('#onboarding-coach')?.hidden!==false);
  assert.equal(member.onboarding.status,'completed');assert.ok(member.onboarding.completedAt);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bonjour Alex',exact:true}).waitFor();
  assert.equal(await welcome().evaluate(dialog=>dialog.open),false);

  // The replay remains voluntary and Escape never converts a finished tour into a new one.
  await go('Plus');
  await page.getByRole('button',{name:'Guide de démarrage',exact:false}).click();
  await welcome().waitFor();
  assert.equal(member.onboarding.status,'completed','opening replay does not reset saved progress');
  await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!document.querySelector('#onboarding-dialog').open);
  assert.equal(member.onboarding.status,'completed');
  await page.getByRole('button',{name:'Guide de démarrage',exact:false}).click();
  await beginWelcome();assert.equal(member.onboarding.status,'active');
  await logout();

  // Existing accounts keep their workspace and can explicitly request the same guide.
  await page.context().addCookies([{name:'agenda_session',value:f.cookies.camille.split('=')[1],url:f.root}]);
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bonjour Camille',exact:true}).waitFor();
  assert.equal(await welcome().evaluate(dialog=>dialog.open),false);
  assert.equal(await coach().isVisible(),false);
  assert.equal(legacy.onboarding,undefined,'a legacy login does not create tutorial state');
  await go('Plus');await page.getByRole('button',{name:'Guide de démarrage',exact:false}).click();
  await beginWelcome();await guideButton('Continuer');await waitStep('home');
  const selectedBefore=await page.locator('#home-programme [aria-pressed="true"]').getAttribute('data-home-day');
  await guideButton('Essayer Aujourd’hui / Demain');
  const selectedAfter=await page.locator('#home-programme [aria-pressed="true"]').getAttribute('data-home-day');
  assert.notEqual(selectedAfter,selectedBefore,'the exercise toggles the real home day');
  await page.setViewportSize({width:1440,height:1050});await shot('onboarding-context-desktop');
  await logout();

  // A connected ENT does not make the user repeat authentication: the real feed route is used.
  await page.context().addCookies([{name:'agenda_session',value:f.cookies.nina.split('=')[1],url:f.root}]);
  await page.reload({waitUntil:'domcontentloaded'});await beginWelcome();
  await guideButton('Afficher mes cours');
  await page.waitForFunction(()=>state.user?.feedURL&&!state.user?.syncing);
  assert.ok(connected.feedKey);assert.equal(connected.enabled,true);assert.ok(f.calls.ent.includes('nina'));
  await guideButton('Continuer');await waitStep('home');
  assert.equal(member.onboarding.step,'connect','another account cannot change the first account’s progress');
  assert.equal(await page.evaluate(()=>window.__onboardingPermissionRequests),0);
  assert.equal(await page.evaluate(()=>window.__onboardingSubscriptions),0);
  await logout();

  assert.equal(f.calls.mail.length,0);assert.deepEqual(externalRequests,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,publicRegistration:true,newAccountWelcome:true,voluntaryLegacyReplay:true,keyboardDialog:true,postpone:true,escape:true,pauseAndReload:true,progressPerAccount:true,realAgendaExercise:true,realDayExercise:true,realWorkForm:true,draftPreserved:true,noImplicitHomework:true,realENTFeedCreation:true,optionalNotifications:true,automaticPermissionRequests:0,realEmailsSent:0,mobileWidths:[320,390],desktop:true,dark:true,reducedMotion:true,logoutPrivacy:true}));
}catch(error){
  console.error(JSON.stringify({browserErrors:errors,externalRequests}));
  await page?.screenshot({path:'test-results/onboarding-failure.png',fullPage:true,animations:'allow',caret:'initial',timeout:60000}).catch(()=>{});
  throw error;
}finally{await browser?.close();if(tlsServer)await new Promise(resolve=>tlsServer.close(resolve));await f.close();if(tlsDir)fs.rmSync(tlsDir,{recursive:true,force:true});}
