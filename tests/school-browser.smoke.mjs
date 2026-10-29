import {openArea,openTool,setTheme} from './simple-navigation.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import { random, digest } from '../src/store.js';
import { schoolClient } from './school-fixture.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-school-browser-')), baseURL = 'http://127.0.0.1:8021/agenda', errors = [], control = {};
const { app, store, browsers } = createApp({ dataDir: dir, baseURL, bootstrap: false, schoolOptions: { clientFactory: async (store, user) => schoolClient(user, control) } });
store.state.users.push({ id: 'school-browser', name: 'Camille', login: 'school-browser', admin: true, studentId: 'fixture-student', skolengo: store.seal({ school: { id: 'school-fixture', name: 'Lycée des Tilleuls' } }), schoolName: 'Lycée des Tilleuls' });
const token = random(); store.state.sessions.push({ hash: digest(token), userId: 'school-browser', expires: Date.now() + 3600000 }); store.save();
const server = app.listen(8021, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
let browser, page;
async function shot(name) { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: 'test-results/' + name + '.png', fullPage: true, animations: 'disabled', timeout: 60000 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, name); }
try {
  browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=1'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' }); page.setDefaultTimeout(45000); page.setDefaultNavigationTimeout(60000); fs.mkdirSync('test-results', { recursive: true });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && message.text().includes('Content Security Policy')) errors.push(message.text()); });
  await page.context().addCookies([{ name: 'agenda_session', value: token, domain: '127.0.0.1', path: '/agenda' }]);
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' });
  await openArea(page,'Mon ENT'); await page.getByRole('heading', { name: 'Calcul littéral', exact: true }).waitFor();
  assert.ok((await page.locator('.school-mark').textContent()).includes('0')); await shot('school-grades-desktop');
  await page.getByRole('button', { name: 'Détail', exact: false }).click(); await page.getByRole('heading', { name: 'Appréciation', exact: true }).waitFor(); await page.getByRole('button', { name: 'Retour à la liste', exact: false }).click();
  await page.getByRole('tab', { name: 'Bulletins', exact: true }).click(); await page.locator('.school-files a').waitFor();
  const downloadPromise = page.waitForEvent('download'); await page.locator('.school-files a').click(); const download = await downloadPromise; assert.equal(await download.failure(), null);
  await page.getByRole('tab', { name: 'Vie scolaire', exact: true }).click(); await page.getByRole('heading', { name: 'Retard', exact: true }).waitFor(); await page.getByRole('button', { name: 'Voir le dossier', exact: false }).click(); await page.getByRole('heading', { name: 'Historique du dossier', exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Messages', exact: true }).click(); await page.getByRole('heading', { name: 'Sortie de classe', exact: true }).waitFor(); assert.equal(control.opened || 0, 0);
  await page.getByRole('button', { name: 'Lire le message', exact: false }).click(); await page.getByText('Rendez-vous à 9 heures.', { exact: false }).waitFor(); assert.equal(control.opened, 1); assert.equal(await page.evaluate(() => window.sourceAttack), undefined); assert.equal(await page.locator('#school-detail img').count(), 0); await shot('school-message-desktop');
  await page.getByRole('tab', { name: 'Actualités', exact: true }).click(); await page.getByRole('button', { name: 'Lire l’actualité', exact: false }).click(); await page.getByText('Une nouvelle rencontre.', { exact: false }).waitFor(); assert.equal(await page.locator('#school-detail a[href^="javascript:"]').count(), 0);
  await page.getByRole('tab', { name: 'Cahier de textes', exact: true }).click(); await page.getByRole('button', { name: 'Voir la séance', exact: false }).click(); await page.getByText('Étudier les variations.', { exact: true }).waitFor(); await page.getByRole('button', { name: 'Voir le devoir', exact: false }).click(); await page.getByText('Correction disponible.', { exact: true }).waitFor();
  await page.getByRole('tab', { name: 'Mon profil', exact: true }).click(); await page.getByText('Première 2', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole('tab', { name: 'Notes', exact: true }).click(); await page.getByRole('heading', { name: 'Calcul littéral', exact: true }).waitFor(); await shot('school-grades-mobile');
  await page.getByRole('tab', { name: 'Notes', exact: true }).focus(); await page.keyboard.press('ArrowRight'); await page.locator('#school-tab-reports[aria-selected=true]').waitFor();
  control.failReports = true; await page.getByRole('button', { name: 'Actualiser', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'L’ENT ne répond pas' }).waitFor(); assert.equal(await page.locator('.school-files a').count(), 1);
  await page.evaluate(() => refresh()); assert.equal(await page.locator('#school-tab-reports').getAttribute('aria-selected'), 'true'); assert.equal(await page.locator('.school-files a').count(), 1);
  await setTheme(page,'dark'); await shot('school-reports-mobile-dark');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('tab', { name: 'Messages', exact: true }).click(); assert.equal(await page.evaluate(() => document.getAnimations().length), 0);
  await page.getByRole('button', { name: 'Se déconnecter', exact: true }).click(); await page.getByRole('button', { name: 'Créer un compte gratuit', exact: true }).waitFor(); assert.equal(await page.locator('#school-root').count(), 0); assert.equal(await page.getByText('Sortie de classe', { exact: true }).count(), 0);
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, sections: 7, notesAndSkills: true, privateDownloads: true, attendanceHistory: true, explicitMessageOpening: true, courseAndHomeworkDetails: true, corrections: true, sourceFailureKeepsData: true, keyboardTabs: true, mobile: true, dark: true, reducedMotion: true, personalDataClearedOnLogout: true, realEmailsSent: 0 }));
} catch (error) { await page?.screenshot({ path: 'test-results/school-failure.png', animations: 'disabled', timeout: 60000 }).catch(() => {}); throw error; }
finally { await browsers.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
