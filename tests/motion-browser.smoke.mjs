import {openArea,openTool} from './simple-navigation.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createApp } from '../src/server.js';
import { random, digest, passwordHash } from '../src/store.js';
import { parisDate, shiftDate } from '../src/work.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-motion-')), baseURL = 'http://127.0.0.1:8021/agenda', tomorrow = shiftDate(parisDate(new Date()), 1), errors = [];
const { app, store, engine, browsers } = createApp({ dataDir: dir, baseURL, bootstrap: false, syncOptions: { clientFactory: async () => ({ getAgenda: async (id, start, end) => tomorrow >= start && tomorrow <= end ? [{ date: tomorrow, lessons: [{ id: 'motion-course', title: 'Mathématiques', subject: { label: 'Mathématiques' }, startDateTime: tomorrow + 'T08:00:00Z', endDateTime: tomorrow + 'T09:00:00Z', location: 'B204', canceled: false, teachers: [] }], homeworkAssignments: [] }] : [] }) } });
store.state.users.push({ id: 'motion-user', name: 'Camille', login: 'motion-user', password: passwordHash('temporary-motion-password'), admin: false, studentId: 'fixture', skolengo: store.seal({ fixture: true }), enabled: true });
const cookie = random(); store.state.sessions.push({ hash: digest(cookie), userId: 'motion-user', expires: Date.now() + 3600000 }); store.save(); await engine.run('motion-user');
const server = app.listen(8021, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
let browser, page, release;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const watch = target => { target.setDefaultTimeout(45000); target.setDefaultNavigationTimeout(60000); target.on('pageerror', e => errors.push(e.message)); target.on('console', m => { if (m.type() === 'error' && m.text().includes('Content Security Policy')) errors.push(m.text()); }); };
try {
  browser = await chromium.launch({ headless: true, args: ['--renderer-process-limit=1'] });
  page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, locale: 'fr-FR', timezoneId: 'Europe/Paris' }); watch(page); fs.mkdirSync('test-results', { recursive: true });
  await page.context().addCookies([{ name: 'agenda_session', value: cookie, domain: '127.0.0.1', path: '/agenda' }]);
  let held = new Promise(resolve => { release = resolve; });
  await page.route('**/api/status', async route => { await held; await route.continue(); });
  await page.goto(baseURL + '/', { waitUntil: 'domcontentloaded' }); await page.locator('.boot-loader .loading-mark').waitFor();
  assert.ok(await page.locator('.boot-loader').evaluate(node => node.getAnimations({ subtree: true }).length > 0));
  await page.screenshot({ path: 'test-results/motion-boot.png', animations: 'allow' }); release(); await page.unrouteAll({ behavior: 'wait' }); await page.getByRole('heading', { name: /^Bonjour /, exact: true }).waitFor(); assert.equal(await page.locator('.boot-loader').count(), 0); assert.equal(await page.locator('#app').getAttribute('aria-busy'), 'false');
  held = new Promise(resolve => { release = resolve; }); await page.route('**/api/week?*', async route => { await held; await route.continue(); });
  await openTool(page,'Semaine'); await page.locator('.skeleton-week').waitFor(); await page.locator('#request-progress').waitFor(); assert.equal(await page.locator('#organizer-panel').getAttribute('aria-busy'), 'true');
  await page.screenshot({ path: 'test-results/motion-week-loading.png', animations: 'allow' }); release(); await page.unrouteAll({ behavior: 'wait' }); await page.locator('.week-course').waitFor(); await page.waitForFunction(() => document.querySelector('#request-progress').hidden); assert.equal(await page.locator('.loading-placeholder').count(), 0);
  await openTool(page,'Application'); await page.getByRole('button', { name: 'Aperçu des animations', exact: true }).click(); await page.getByRole('dialog', { name: 'Animations', exact: true }).waitFor();
  for (const label of ['Rejouer la confirmation', 'Rejouer l’apparition', 'Rejouer la progression']) await page.getByRole('button', { name: label, exact: true }).click();
  await page.screenshot({ path: 'test-results/motion-gallery.png', animations: 'allow' }); await page.setViewportSize({ width: 390, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: 'test-results/motion-gallery-mobile.png', fullPage: false, animations: 'allow' });
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.waitForFunction(() => document.getAnimations().length === 0); await page.getByRole('button', { name: 'Rejouer la progression', exact: true }).click(); assert.equal(await page.evaluate(() => document.getAnimations().length), 0); await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('#motion-preview').open);
  // A slow reduced-motion load still communicates progress without movement.
  held = new Promise(resolve => { release = resolve; }); await page.route('**/api/bag?*', async route => { await held; await route.continue(); });
  await openTool(page,'Mon sac'); await page.locator('.loading-placeholder').waitFor(); await page.locator('#request-progress').waitFor(); assert.equal(await page.evaluate(() => document.getAnimations().length), 0); release(); await page.unrouteAll({ behavior: 'wait' }); await page.locator('#bag-kit-form').waitFor(); await page.waitForFunction(() => document.querySelector('#request-progress').hidden);
  await page.getByLabel('Matériel · un objet par ligne', { exact: true }).fill('Cahier\nStylo'); await page.getByRole('button', { name: 'Enregistrer ma liste', exact: true }).click(); await page.getByRole('checkbox', { name: 'Cahier Tous les jours', exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: 'no-preference' }); await page.getByRole('checkbox', { name: 'Cahier Tous les jours', exact: true }).check(); await page.waitForFunction(() => document.querySelector('.bag-progress [data-progress-value]')?.dataset.progressValue === '50'); assert.equal(await page.locator('progress[aria-label="Préparation du sac"]').getAttribute('value'), '1');
  await openArea(page,'Mon espace'); await openTool(page,'Devoirs & contrôles'); await page.getByText('＋ Ajouter un devoir ou un contrôle', { exact: true }).click();
  await page.getByLabel('Matière', { exact: true }).fill('Mathématiques'); await page.getByLabel('Titre', { exact: true }).fill('Un travail enregistré');
  held = new Promise(resolve => { release = resolve; }); await page.route('**/api/work', async route => { await held; await route.continue(); });
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click(); const busy = page.locator('#work-form button[aria-busy=true]'); await busy.waitFor(); assert.equal(await busy.isDisabled(), true); await busy.locator('.button-loading').waitFor(); release(); await page.unrouteAll({ behavior: 'wait' }); await page.locator('#panel-work').getByText('Un travail enregistré', { exact: true }).waitFor();
  await page.locator('#toast .confirmation-stroke').waitFor(); assert.equal(await page.locator('#toast .toast-lifetime').count(), 1);
  await page.evaluate(() => toast('<img src=x onerror=alert(1)>')); assert.equal(await page.locator('#toast img').count(), 0); assert.ok((await page.locator('#toast').textContent()).includes('<img'));
  // Failed requests stop their activity indicator and leave the controls usable.
  await page.route('**/api/sync', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Indisponible pour ce test.' }) })); await openArea(page,'Mon organisation');await page.getByRole('button', { name: 'Actualiser l’agenda', exact: true }).click(); await page.locator('#toast.error').waitFor(); await page.waitForFunction(() => document.querySelector('#request-progress').hidden); assert.equal(await page.getByRole('button', { name: 'Actualiser l’agenda', exact: true }).isDisabled(), false);
  const visitor = await browser.newPage({ viewport: { width: 390, height: 844 } }); watch(visitor); let fails = true;
  await visitor.route('**/api/status', async route => fails ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unavailable' }) }) : route.continue());
  await visitor.goto(baseURL + '/', { waitUntil: 'domcontentloaded' }); await visitor.getByRole('button', { name: 'Réessayer', exact: true }).waitFor(); assert.equal(await visitor.locator('.boot-loader').count(), 0); fails = false; await visitor.getByRole('button', { name: 'Réessayer', exact: true }).click(); await visitor.getByRole('button', { name: 'Créer un compte gratuit', exact: true }).waitFor(); await visitor.close();
  assert.deepEqual(errors, []); console.log(JSON.stringify({ ok: true, bootLoader: true, skeletons: true, realRequestProgress: true, busyButtons: true, successAndFailure: true, escapedMessages: true, bagProgress: true, gallery: true, reducedMotion: true, bootRetry: true, mobile: true, realEmailsSent: 0 }));
} catch (error) { release?.(); await page?.screenshot({ path: 'test-results/motion-failure.png', animations: 'disabled', timeout: 60000 }).catch(() => {}); throw error; }
finally { release?.(); await page?.unrouteAll({ behavior: 'wait' }).catch(() => {}); await browsers.close(); await browser?.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); }
