import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {chromium} from 'playwright';
import {controlFixture, controlPassword} from './control-fixture.js';
import {rebuildCalendar} from '../src/calendar.js';

// Isolated accounts and intercepted partner pages only; no production requests.
const fixture = await controlFixture({port:8021,baseURL:'http://127.0.0.1:8021/agenda'});
const externalOrigin = 'https://mon-ent.pages.dev', callback = externalOrigin + '/passerelle/callback';
for (const id of ['camille','owner']) {
  const user = fixture.store.user(id);
  user.calendarEvents = {demo:{id:'demo',date:'2026-11-05',title:'Cours de démonstration',rawTitle:'Cours de démonstration',start:'2026-11-05T07:00:00.000Z',end:'2026-11-05T08:00:00.000Z',location:'Salle fictive',created:fixture.now(),modified:fixture.now(),sequence:0,kind:'course',subject:{label:'Mathématiques',color:'royalblue'}}};
  rebuildCalendar(fixture.store,id,fixture.now());
}
const incomplete = fixture.store.user('nina');
Object.assign(incomplete,{feedKey:null,feedHash:null,skolengo:null});
fixture.store.save();
fixture.menu.get = async (_user, query) => ({date:query.date,status:'not_found',next:null,days:[]});
let browser, page, context;
const errors = [], outgoing = [], failedRequests = [], pending = new Set();
const rand = () => randomBytes(32).toString('base64url');
async function loginCookie(id) {
  await context.addCookies([{name:'agenda_session',value:fixture.cookies[id].split('=')[1],url:fixture.root+'/'}]);
}
async function authorize(scopes = ['calendar:courses','calendar:homework','calendar:exams'], redirectURI = callback) {
  const verifier = rand(), state = rand(), challenge = createHash('sha256').update(verifier).digest('base64url');
  const url = new URL(fixture.root + '/oauth/authorize');
  for (const [name,value] of Object.entries({response_type:'code',client_id:'lapsus',redirect_uri:redirectURI,state,scope:scopes.join(' '),code_challenge:challenge,code_challenge_method:'S256'})) url.searchParams.set(name,value);
  await page.goto(url.href,{waitUntil:'domcontentloaded'});
  return {verifier,state,redirectURI};
}
async function exchange(authorization) {
  const url = new URL(page.url());
  assert.equal(url.origin + url.pathname,authorization.redirectURI);
  assert.equal(url.searchParams.get('state'),authorization.state);
  assert.equal(url.searchParams.get('iss'),fixture.root);
  const code = url.searchParams.get('code');
  assert.match(code,/^[A-Za-z0-9_-]{43}$/);
  const response = await fetch(fixture.root+'/oauth/token',{method:'POST',headers:{origin:externalOrigin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:'lapsus',redirect_uri:authorization.redirectURI,code,code_verifier:authorization.verifier})});
  assert.equal(response.status,200);
  const token = await response.json();
  const calendars = await fetch(fixture.root+'/api/partner/calendars',{headers:{origin:externalOrigin,Authorization:'Bearer '+token.access_token}});
  assert.equal(calendars.status,200);
  const value = await calendars.json();
  return value.calendars;
}
async function settings() {
  await page.getByRole('navigation',{name:'Navigation principale',exact:true}).getByRole('button',{name:'Plus',exact:true}).click();
  await page.locator('#page-more [data-portal="navigate"][data-page="settings"]').click();
  await page.locator('#page-settings [data-partners="open"]').click();
  await page.getByRole('heading',{name:'Applications connectées',exact:true}).waitFor();
  await page.locator('#partners-content').getByText(/Chaque connexion possède/).waitFor();
}
async function screenshot(name, dialog = false) {
  await page.evaluate(()=>document.fonts.ready);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' page overflow');
  if (dialog) assert.equal(await page.locator('#partners-dialog').evaluate(node=>node.scrollWidth>node.clientWidth+1),false,name+' dialog overflow');
  await page.screenshot({path:'test-results/'+name+'.png',animations:'disabled',fullPage:false});
}
try {
  fs.mkdirSync('test-results',{recursive:true});
  browser = await chromium.launch({headless:true,args:['--renderer-process-limit=1']});
  context = await browser.newContext({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris',serviceWorkers:'block'});
  await context.route(externalOrigin+'/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<!doctype html><html lang="fr"><title>Lapsus · Test</title><main><h1>Retour à Lapsus</h1></main></html>'}));
  page = await context.newPage(); page.setDefaultTimeout(60000); page.setDefaultNavigationTimeout(60000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>pending.add(new URL(request.url()).pathname));
  page.on('requestfinished',request=>pending.delete(new URL(request.url()).pathname));
  page.on('requestfailed',request=>{pending.delete(new URL(request.url()).pathname);if(request.failure()?.errorText!=='net::ERR_ABORTED')failedRequests.push({path:new URL(request.url()).pathname,error:request.failure()?.errorText});});
  page.on('console',message=>{if(message.type()==='error'&&message.text().includes('Content Security Policy'))errors.push(message.text());});
  page.on('request',request=>{const url = new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==new URL(fixture.root).origin&&url.origin!==externalOrigin)outgoing.push(url.origin);});

  // Begin while signed out: normal login resumes the same consent automatically.
  const first = await authorize();
  await page.getByRole('link',{name:'Se connecter à Passerelle',exact:true}).click();
  await page.locator('#login').fill('camille'); await page.locator('#password').fill(controlPassword);
  await page.getByRole('button',{name:'Se connecter',exact:true}).click();
  await page.getByRole('heading',{name:'Connecter votre agenda à Lapsus.',exact:true}).waitFor();
  assert.ok(page.url().includes('/oauth/consent?request='));
  assert.equal(await page.getByRole('checkbox',{name:/Emploi du temps/}).isChecked(),true);
  assert.equal(await page.getByRole('checkbox',{name:/Devoirs/}).isChecked(),false);
  assert.equal(await page.getByRole('checkbox',{name:/Contrôles/}).isChecked(),false);
  assert.equal(await page.locator('input[type=password]').count(),0);
  await screenshot('partner-consent-mobile');
  await page.setViewportSize({width:320,height:740}); await page.evaluate(()=>appearance.set('dark')); await page.emulateMedia({reducedMotion:'reduce'});
  await screenshot('partner-consent-small-dark');
  assert.equal(await page.locator('.partner-connect-card').evaluate(node=>getComputedStyle(node).animationName),'none');
  await page.getByRole('checkbox',{name:/Emploi du temps/}).uncheck();
  await page.getByRole('button',{name:'Autoriser le partage',exact:true}).click();
  await page.getByRole('alert').getByText(/Choisissez au moins un agenda/).waitFor();
  await page.getByRole('checkbox',{name:/Emploi du temps/}).check();
  await page.getByRole('checkbox',{name:/Devoirs/}).check();
  await page.getByRole('button',{name:'Autoriser le partage',exact:true}).click();
  await page.getByRole('heading',{name:'Retour à Lapsus',exact:true}).waitFor();
  const calendars = await exchange(first);
  assert.deepEqual(calendars.map(row=>row.id),['courses','homework']);
  assert.ok(calendars.every(row=>new URL(row.url).pathname.includes('/partner-calendars/')));
  assert.ok(calendars.every(row=>!row.url.includes(fixture.feedTokens.camille)));
  const feed = await fetch(calendars[0].url); assert.equal(feed.status,200); assert.ok((await feed.text()).includes('Cours de démonstration'));
  // Existing subscriptions stay independent when the partner grant is withdrawn.
  await page.goto(fixture.root+'/',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bonjour Camille',exact:true}).waitFor();
  await settings(); await page.locator('#partners-content .partners-connection').getByRole('heading',{name:'Lapsus',exact:true}).waitFor();
  await screenshot('partner-connections-small-dark',true);
  await page.evaluate(()=>refresh());
  assert.equal(await page.locator('#partners-dialog').evaluate(node=>node.open),true);
  await page.locator('#partners-content').getByRole('button',{name:'Retirer l’accès',exact:true}).click();
  await page.locator('#partners-content').getByRole('button',{name:'Annuler',exact:true}).click();
  assert.equal((await fetch(calendars[0].url)).status,200);
  await page.locator('#partners-content').getByRole('button',{name:'Retirer l’accès',exact:true}).click();
  await page.locator('#partners-content').getByRole('button',{name:'Confirmer le retrait',exact:true}).click();
  await page.locator('#partners-content').getByRole('heading',{name:'Vos agendas restent chez vous.',exact:true}).waitFor();
  assert.equal((await fetch(calendars[0].url)).status,404);
  assert.equal((await fetch(fixture.root+'/calendars/'+fixture.feedTokens.camille+'.ics')).status,200);
  await page.keyboard.press('Escape');

  // Refusal returns only an OAuth error and never creates an authorization.
  const refused = await authorize(['calendar:courses']);
  await page.getByRole('button',{name:'Refuser',exact:true}).click();
  await page.getByRole('heading',{name:'Retour à Lapsus',exact:true}).waitFor();
  const refusedURL = new URL(page.url());
  assert.equal(refusedURL.searchParams.get('error'),'access_denied'); assert.equal(refusedURL.searchParams.get('state'),refused.state);
  assert.equal(refusedURL.searchParams.has('code'),false); assert.equal(fixture.store.user('camille').partnerGrants.filter(row=>!row.revokedAt).length,0);

  // An incomplete account stays on setup instead of looping through consent.
  await loginCookie('nina'); await authorize();
  await page.getByRole('link',{name:'Préparer mon agenda dans Passerelle',exact:true}).click();
  await page.getByRole('heading',{name:'Bonjour Nina',exact:true}).waitFor();
  await page.locator('#partners-setup-notice').getByText('Préparez votre agenda pour Lapsus',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/agenda/');
  await page.evaluate(()=>refresh());
  assert.equal(new URL(page.url()).pathname,'/agenda/');
  await page.getByRole('button',{name:'Annuler cette connexion',exact:true}).click();
  assert.equal(await page.locator('#partners-setup-notice').count(),0); assert.equal(new URL(page.url()).searchParams.has('connect'),false);

  // Admin changes exact callback and enabled state via the actual protected API.
  await loginCookie('owner'); await page.goto(fixture.root+'/',{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Bonjour Administrateur',exact:true}).waitFor();
  await settings(); await page.locator('#partners-content').getByRole('button',{name:'Configurer Lapsus · Administration',exact:true}).click();
  await page.locator('#partners-callback').waitFor();
  assert.equal(await page.locator('#partners-callback').inputValue(),callback);
  await page.locator('#partners-callback').fill('https://invalid.example/callback');
  await page.locator('#partners-content').getByRole('button',{name:'Enregistrer',exact:true}).click();
  await page.locator('#partners-error').getByText(/doit appartenir/).waitFor();
  const customCallback = externalOrigin+'/oauth/passerelle';
  await page.locator('#partners-callback').fill(customCallback);
  await page.locator('#partners-content').getByRole('button',{name:'Enregistrer',exact:true}).click();
  await page.locator('#partners-content').getByRole('status').getByText('Les réglages de Lapsus sont enregistrés.',{exact:true}).waitFor();
  assert.equal(fixture.partners.configuration().client.redirectURI,customCallback);
  await page.locator('#partners-content').getByRole('checkbox',{name:'Autoriser les connexions à Lapsus',exact:true}).uncheck();
  await page.locator('#partners-content').getByRole('button',{name:'Enregistrer',exact:true}).click();
  await page.locator('#partners-content').getByText('Désactivée',{exact:true}).waitFor();
  assert.equal(fixture.partners.configuration().client.enabled,false);
  await page.locator('#partners-content').getByRole('checkbox',{name:'Autoriser les connexions à Lapsus',exact:true}).check();
  await page.locator('#partners-callback').fill(callback);
  await page.locator('#partners-content').getByRole('button',{name:'Enregistrer',exact:true}).click();
  await page.locator('#partners-content').getByText('Activée',{exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1050}); await page.evaluate(()=>appearance.set('light')); await screenshot('partner-admin-desktop',true);
  await page.evaluate(async()=>{await api('logout',{});await refresh();});
  await page.getByRole('button',{name:'Se connecter',exact:true}).waitFor();
  assert.equal(await page.locator('#partners-dialog').count(),0); assert.equal(await page.locator('#partners-callback').count(),0);
  assert.equal(fixture.calls.mail.length,0); assert.equal(fixture.calls.ent.length,0); assert.deepEqual(errors,[]); assert.deepEqual(outgoing,[]);
  console.log(JSON.stringify({ok:true,signedOutLoginResumesConsent:true,scopeChoice:true,scopeMinimization:true,emptyChoiceBlocked:true,isolatedPartnerLinks:true,revoke:true,personalFeedPreserved:true,refusal:true,incompleteAccountSetup:true,adminCallbackAndEnabled:true,logoutPrivacy:true,widths:[320,390,1440],dark:true,reducedMotion:true,realEmails:0,realENTCalls:0,unmockedExternalRequests:0}));
} catch (error) {
  console.error(JSON.stringify({stage:'browser-failure',pathname:page?new URL(page.url()).pathname:null,title:await page?.title().catch(()=>''),body:(await page?.locator('body').innerText().catch(()=>''))?.slice(0,1200),errors,failedRequests,pending:[...pending]}));
  throw error;
} finally {
  await browser?.close();fixture.server.closeAllConnections();await fixture.close();
}
