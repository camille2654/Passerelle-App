import {openArea,openTool,openMailNotifications} from './simple-navigation.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import { passwordHash } from '../src/store.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-public-browser-')), baseURL = 'http://127.0.0.1:8021/agenda', errors = [];
const { app, store, browsers } = createApp({ dataDir: dir, baseURL, bootstrap: false });
store.state.users.push({ id: 'public-owner-fixture', name: 'Camille', login: 'owner-fixture', admin: true, password: passwordHash('temporary-browser-password'), enabled: false }); store.save();
const server = app.listen(8021, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
let browser, page;
const shot = async name => { await page.evaluate(() => { window.scrollTo({ top: 0 }); return document.fonts.ready; }); await page.screenshot({ path: 'test-results/' + name + '.png', fullPage: true, animations: 'disabled', timeout: 60000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name); };
async function login(username) { await page.getByLabel('Identifiant du portail', { exact: true }).fill(username); await page.getByLabel('Mot de passe du portail', { exact: true }).fill('temporary-browser-password'); await page.getByRole('button', { name: 'Se connecter', exact: false }).click(); await page.getByRole('heading', { name: /^Bonjour /, exact: true }).waitFor(); }
try {
  browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=1'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' }); page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error' && message.text().includes('Content Security Policy')) errors.push(message.text()); });
  fs.mkdirSync('test-results', { recursive: true });
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Créer un compte gratuit', exact: true }).click(); await page.getByLabel('Votre prénom', { exact: true }).waitFor();
  await shot('public-signup-desktop'); await page.setViewportSize({ width: 390, height: 844 }); await shot('public-signup-mobile');
  await page.getByLabel('Votre prénom', { exact: true }).fill('Alex'); await page.getByLabel('Identifiant du portail', { exact: true }).fill('alex-public'); await page.getByLabel('Mot de passe du portail', { exact: true }).fill('temporary-browser-password');
  await page.getByRole('button', { name: 'Afficher le mot de passe', exact: true }).click(); assert.equal(await page.locator('#password').getAttribute('type'), 'text'); await page.getByRole('button', { name: 'Masquer le mot de passe', exact: true }).click();
  await page.getByRole('button', { name: 'Créer mon espace', exact: false }).click(); await page.getByRole('heading', { name: /^Bonjour /, exact: true }).waitFor();
  await page.locator('#onboarding-dialog[open]').waitFor(); await page.locator('#onboarding-dialog').getByRole('button',{name:'Plus tard',exact:true}).click(); await page.waitForFunction(()=>!document.querySelector('#onboarding-dialog').open);
  assert.equal(await page.evaluate(() => scrollY), 0, 'registration opens the workspace from the top');
  const member = store.state.users.find(user => user.login === 'alex-public'); assert.equal(member.admin, false); assert.equal(member.registrationSource, 'public');
  assert.equal(await page.getByRole('button', { name: 'Comptes & notifications', exact: true }).count(), 0); await shot('public-first-steps-mobile');
  await page.getByRole('button', { name: 'Connecter mon ENT', exact: true }).click(); await page.getByLabel('Nom ou ville de l’établissement', { exact: true }).waitFor();
  await openArea(page,'Mon espace'); await openTool(page,'Devoirs & contrôles'); await page.locator('#page-work:not([hidden])').waitFor();
  await page.getByText('＋ Ajouter un devoir ou un contrôle', { exact: true }).click(); await page.getByLabel('Matière', { exact: true }).fill('Mathématiques'); await page.getByLabel('Titre', { exact: true }).fill('Mon premier contrôle'); await page.getByRole('button', { name: 'Ajouter', exact: true }).click(); await page.locator('#panel-work').getByText('Mon premier contrôle', { exact: true }).waitFor();
  const navigation=page.getByRole('navigation',{name:'Navigation principale',exact:true});await navigation.getByRole('button',{name:'Accueil',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'AgendaAgenda');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'DevoirsDevoirs');
  await openMailNotifications(page); assert.equal(await page.locator('#notifications-dialog').evaluate(dialog => dialog.open), true);
  await page.getByLabel('Votre adresse mail', { exact: true }).fill('draft@example.invalid'); await page.evaluate(() => refresh()); assert.equal(await page.getByLabel('Votre adresse mail', { exact: true }).inputValue(), 'draft@example.invalid');
  await shot('minimal-notifications-mobile'); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#notifications-dialog').open); assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Mes notifications');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('button', { name: 'Mes notifications', exact: true }).click(); assert.equal(await page.evaluate(() => document.getAnimations().length), 0); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#notifications-dialog').open);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click(); await login('alex-public');
  for (const name of ['Préparer mon sac', 'Mes révisions']) { await openTool(page,name==='Préparer mon sac'?'Mon sac':'Révisions'); await page.locator('#organizer-panel').waitFor(); await openArea(page,'Mon espace'); }
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click(); await login('owner-fixture'); await openArea(page,'Comptes & notifications');
  await page.getByText('Inscriptions publiques',{exact:true}).click();const form = page.locator('#registration-form'); await form.getByRole('checkbox', { name: 'Autoriser les inscriptions publiques' }).uncheck(); await form.getByRole('button', { name: 'Enregistrer l’ouverture', exact: true }).click(); await page.getByText('Sur invitation', { exact: true }).waitFor(); assert.equal(store.state.settings.publicRegistration, false);
  await page.setViewportSize({ width: 1440, height: 1050 }); await shot('public-registration-admin');
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } }); await visitor.goto(baseURL + '/#signup', { waitUntil: 'domcontentloaded' }); await visitor.getByText('Les nouvelles inscriptions sont momentanément fermées.', { exact: false }).waitFor(); assert.equal(await visitor.getByRole('button', { name: 'Créer un compte gratuit', exact: true }).count(), 0); await visitor.close();
  await form.getByRole('checkbox', { name: 'Autoriser les inscriptions publiques' }).check(); await form.getByRole('button', { name: 'Enregistrer l’ouverture', exact: true }).click(); await page.getByText('Inscriptions ouvertes', { exact: true }).waitFor(); assert.equal(store.state.settings.publicRegistration, true);
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click(); await page.goto(baseURL + '/#signup', { waitUntil: 'domcontentloaded' }); await page.getByLabel('Votre prénom', { exact: true }).waitFor();
  await page.getByLabel('Thème d’affichage', { exact: true }).selectOption('dark'); await shot('public-signup-dark');
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, publicSignup: true, noAdminEscalation: true, onboarding: true, quickActions: true, manualHomework: true, login: true, adminGate: true, directSignupLink: true, desktop: true, mobile: true, dark: true, keyboardTabs: true, notificationDrawer: true, notificationDraftPreserved: true, reducedMotion: true, realEmailsSent: 0 }));
} catch (error) { await page?.screenshot({ path: 'test-results/public-failure.png', fullPage: false, animations: 'disabled', timeout: 60000 }).catch(() => {}); throw error; }
finally { await browsers.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
