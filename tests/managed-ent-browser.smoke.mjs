import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {createApp} from '../src/server.js';
import {digest,random,passwordHash} from '../src/store.js';
import {DISCOVERY} from '../src/skolengo.js';
import {CURRENT_RELEASE} from '../src/releases.js';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-managed-browser-'));
const baseURL='http://127.0.0.1:8021/agenda',origin=new URL(baseURL).origin;
const partner='https://mon-ent.pages.dev',callback=partner+'/passerelle/ent/callback';
const calls={source:0,input:0,remote:0},browserRows=new Map();
const school={id:'fixture-school',name:'Lycée de démonstration',city:'Ville de test',emsCode:'rra',emsOIDCWellKnownUrl:DISCOVERY};
let studentCount=2,browser,context,page,source,server;
const errors=[],outgoing=[];
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6J8AAAAASUVORK5CYII=','base64');
const rand=()=>randomBytes(32).toString('base64url');
const version='4.20.0';
async function post(route,body,{cookie,key,external}={}){
 const response=await fetch(baseURL+route,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(key?{Authorization:'Bearer '+key}:{}),...(external?{'X-Lapsus-User':external}:{})},body:JSON.stringify(body)});
 const data=await response.json();assert.equal(response.status,200,'synthetic API operation failed');return data;
}
async function launch(external){
 const verifier=rand(),state=rand();
 const flow=await post('/api/managed-ent/sessions',{externalUserId:external,scopes:['courses','homework','exams','messages','news'],state,codeChallenge:createHash('sha256').update(verifier).digest('base64url')},{key,external});
 await page.goto(flow.launchURL,{waitUntil:'domcontentloaded'});return {...flow,verifier,state,external};
}
async function chooseSchool(){
 await page.getByLabel('Nom du lycée ou ville',{exact:true}).fill('démonstration');
 await page.getByRole('button',{name:'Rechercher',exact:true}).click();
 await page.getByRole('button',{name:/Lycée de démonstration/}).click();
 await page.getByRole('heading',{name:'Connectez-vous à votre ENT.',exact:true}).waitFor();
 await page.locator('#managed-frame').waitFor({state:'visible'});
}
async function screenshot(name){
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' page overflow');
 await page.screenshot({path:'test-results/'+name+'.png',animations:'disabled'});
}
let key,adminCookie;
try{
 source=createApp({dataDir:dir,baseURL,bootstrap:false,managedOptions:{schoolSearch:async()=>[school],revokeSource:async()=>{},clientFactory:async()=>({getAgenda:async(_id,from,to)=>{calls.source++;const date=new Date().toISOString().slice(0,10);return from<=date&&to>=date?[{date,lessons:[{id:'fixture-lesson',title:'Mathématiques',subject:{label:'Mathématiques'},startDateTime:date+'T10:00:00Z',endDateTime:date+'T11:00:00Z',canceled:false,teachers:[],location:'Salle fixture'}]}]:[];},getHomeworkAssignments:async()=>[]})}});
 const admin=random();adminCookie='agenda_session='+admin;
 source.store.state.users.push({id:'fixture-owner',name:'Administrateur de test',login:'fixture-owner',password:passwordHash('fixture-browser-password'),admin:true,seenRelease:CURRENT_RELEASE.id,createdAt:Date.now()});
 source.store.state.sessions.push({hash:digest(admin),userId:'fixture-owner',expires:Date.now()+3600000,createdAt:Date.now(),lastSeenAt:Date.now(),lastSeenAtReal:Date.now()});source.store.save();
 source.browsers.start=async(user,selected,{store,onConnected}={})=>{browserRows.set(user.id,{user,school:selected,store,onConnected,status:'login'});return {status:'login'};};
 source.browsers.status=id=>{const row=browserRows.get(id);return row?{status:row.status,host:'sso.ent.auvergnerhonealpes.fr'}:{status:'closed'};};
 source.browsers.frame=async id=>browserRows.has(id)?pixel:null;
 source.browsers.input=async(id,action)=>{calls.input++;const row=browserRows.get(id);assert.ok(row);if(action.type==='key'&&action.key==='Enter'){
  const students=Array.from({length:studentCount},(_,i)=>({id:'fixture-pupil-'+i,name:'Élève de test '+(i+1),className:'Classe fixture'}));
  row.store.update(id,{skolengo:row.store.seal({school:row.school,tokenSet:{access_token:'synthetic-token',refresh_token:'synthetic-refresh'}}),skolengoConnectionId:rand(),schoolName:row.school.name,students,studentId:students[0].id,skolengoError:null,enabled:false});
  row.status='connected';await row.onConnected(row.store.user(id));
 }};
 source.browsers.stop=async id=>{browserRows.delete(id);};source.browsers.close=async()=>browserRows.clear();
 server=source.app.listen(8021,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 key=(await post('/api/admin/managed-ent/lapsus/key',{}, {cookie:adminCookie})).key;
 await post('/api/admin/managed-ent/lapsus',{enabled:true},{cookie:adminCookie});
 fs.mkdirSync('test-results',{recursive:true});browser=await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
 context=await browser.newContext({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});
 await context.route(partner+'/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><title>Lapsus · Test</title><h1>Retour dans Lapsus</h1>'}));
 page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(45000);
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Content Security Policy'))errors.push(message.text());});
 page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&![origin,partner].includes(url.origin))outgoing.push(url.origin);});
 const flow=await launch('fixture-lapsus-a');
 await page.getByRole('heading',{name:'Quel est votre lycée ?',exact:true}).waitFor();assert.equal(new URL(page.url()).search,'');
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.title(),'Connexion ENT · Lapsus');assert.equal(await page.locator('.managed-ent-steps use').count(),3);
 assert.equal(await page.locator('.managed-ent-brand').innerText(),'Lapsus');
 assert.equal(await page.locator('.managed-ent-powered a').innerText(),'Powered by PSRL');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(251, 252, 248)');
 assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#managed-title')).fontFamily.split(',')[0].replaceAll('"','')),'Manrope');
 assert.equal(await page.evaluate(()=>document.fonts.check('500 14px Manrope')),true);
 assert.equal((await page.locator('body').innerText()).includes('Passerelle'),false,'provider branding stays in the small PSRL footer');
 assert.equal(await page.locator('#auth-form').count(),0);assert.equal(await page.getByRole('button',{name:'Autoriser le partage',exact:true}).count(),0);
 await page.locator('#managed-data-types').getByText('Mails de l’ENT',{exact:true}).waitFor();await page.locator('#managed-data-types').getByText('Actualités',{exact:true}).waitFor();await screenshot('managed-ent-school-mobile');await chooseSchool();
 await page.locator('#managed-frame').click({position:{x:30,y:30}});
 await page.locator('#managed-text').fill('synthetic-user');await page.getByRole('button',{name:'Envoyer le texte',exact:true}).click();
 assert.equal(await page.locator('#managed-text').inputValue(),'');
 await page.setViewportSize({width:320,height:740});await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.emulateMedia({reducedMotion:'reduce'});await screenshot('managed-ent-login-small-dark');
 await page.getByRole('button',{name:'Valider ↵',exact:true}).click();
 await page.getByRole('heading',{name:'Quel emploi du temps souhaitez-vous retrouver ?',exact:true}).waitFor();
 await page.getByRole('radio',{name:/Élève de test 2/}).check();await page.getByRole('button',{name:'Continuer',exact:true}).click();
 await page.getByRole('heading',{name:'Votre agenda est prêt.',exact:true}).waitFor();
 await page.setViewportSize({width:1440,height:1000});await screenshot('managed-ent-ready-desktop');
 await page.getByRole('button',{name:'Revenir à Lapsus',exact:true}).click();await page.getByRole('heading',{name:'Retour dans Lapsus',exact:true}).waitFor();
 const returned=new URL(page.url());assert.equal(returned.origin+returned.pathname,callback);assert.equal(returned.searchParams.get('state'),flow.state);assert.equal(returned.searchParams.get('iss'),baseURL);
 const exchanged=await post('/api/managed-ent/exchange',{code:returned.searchParams.get('code'),codeVerifier:flow.verifier},{key,external:flow.external});assert.equal(exchanged.connectionId,flow.connectionId);
 assert.equal(source.store.state.users.length,1,'managed flow does not add a portal account');assert.equal(source.store.state.sessions.length,1,'managed flow does not add a portal session');
 const cancelFlow=await launch('fixture-lapsus-cancel');await page.getByRole('heading',{name:'Quel est votre lycée ?',exact:true}).waitFor();await page.getByRole('button',{name:'Annuler la connexion',exact:true}).click();await page.getByRole('heading',{name:'Connexion annulée.',exact:true}).waitFor();assert.equal(source.managedENT.store.user(cancelFlow.connectionId),undefined);
 await context.addCookies([{name:'agenda_session',value:admin,url:baseURL+'/'}]);await page.goto(baseURL+'/',{waitUntil:'domcontentloaded'});
 await page.getByRole('heading',{name:'Bonjour Administrateur de test',exact:true}).waitFor();
 await page.evaluate(()=>partnersPortal.open());await page.getByRole('button',{name:'Configurer Lapsus · Administration',exact:true}).click();
 await page.getByRole('heading',{name:'Connexion ENT directement depuis Lapsus',exact:true}).waitFor();
 await page.getByRole('button',{name:'Renouveler la clé serveur',exact:true}).click();await page.getByRole('button',{name:'Confirmer le renouvellement',exact:true}).click();
 await page.locator('#managed-server-key').waitFor();assert.ok((await page.locator('#managed-server-key').inputValue()).length>=32);
 await page.getByRole('button',{name:'Masquer la clé',exact:true}).click();assert.equal(await page.locator('#managed-server-key').count(),0);
 await page.getByRole('checkbox',{name:'Activer le connecteur ENT Lapsus',exact:true}).uncheck();await page.getByRole('button',{name:'Enregistrer le connecteur',exact:true}).click();
 await page.getByRole('status').getByText('Les réglages du connecteur ENT sont enregistrés.',{exact:true}).waitFor();assert.equal(source.managedENT.configuration().enabled,false);
 await page.keyboard.press('Escape');await page.evaluate(async()=>{await api('logout',{});await refresh();});await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();assert.equal(await page.locator('#managed-server-key').count(),0);
 assert.deepEqual(errors,[]);assert.deepEqual(outgoing,[]);assert.ok(calls.input>=3);assert.ok(calls.source>0);
 console.log(JSON.stringify({ok:true,version,schoolSearch:true,remoteInput:true,multipleStudents:true,PKCEReturn:true,noPortalAccount:true,noSecondConsent:true,cancel:true,adminKeyOnce:true,adminEnabled:true,logoutPrivacy:true,widths:[320,390,1440],dark:true,reducedMotion:true,realENTCalls:0,realEmails:0}));
}finally{
 await browser?.close();if(source){source.managedENT.close();for(const key of ['partners','control','push','passkeys','cloud','incoming','personalCalendars','travel','smartTravel','personalMail','eventSuggestions'])source[key]?.close();await source.browsers.close();}
 if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}fs.rmSync(dir,{recursive:true,force:true});
}
