import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { Store, random, digest } from '../src/store.js';
import { withSkolengo } from '../src/skolengo.js';
import { attachmentURL } from '../src/school.js';
import { schoolClient } from './school-fixture.js';

async function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-school-')), control = { students: [] };
  const source = createApp({ dataDir: dir, baseURL: 'http://127.0.0.1/agenda', bootstrap: false, schoolOptions: { clientFactory: async (store, user) => schoolClient(user, control) } });
  const cookies = {};
  for (const id of ['a', 'b', 'offline']) {
    source.store.state.users.push({ id, name: 'Fixture', login: id, admin: id === 'a', studentId: 'student-' + id, ...(id !== 'offline' ? { skolengo: source.store.seal({ school: { id: 'school', name: 'Lycée des Tilleuls' } }) } : {}) });
    const token = random(); cookies[id] = 'agenda_session=' + token; source.store.state.sessions.push({ hash: digest(token), userId: id, expires: Date.now() + 60000 });
  }
  source.store.save(); const server = source.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return { ...source, control, async request(route, data, user = 'a', origin = 'http://127.0.0.1') {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/agenda/api/' + route, { headers: { cookie: cookies[user] || '', origin, ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(data !== undefined ? { method: 'POST', body: JSON.stringify(data) } : {}) });
    const body = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    return { status: response.status, body, headers: response.headers };
  }, async close() { await source.browsers.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('school routes require the personal session and the connected source; detail writes require same origin', async () => {
  const f = await fixture(); try {
    assert.equal((await f.request('school/grades', undefined, 'anonymous')).status, 401);
    assert.equal((await f.request('school/grades', undefined, 'offline')).status, 409);
    assert.equal((await f.request('school/open', { ref: 'unknown' }, 'a', 'https://other.invalid')).status, 403);
    assert.equal((await f.request('school/no-such-section')).status, 404);
    assert.equal((await f.request('school/attendance?offset=-1')).status, 400);
    assert.equal((await f.request('school/notebook?date=2026-02-31')).status, 400);
  } finally { await f.close(); }
});
test('grades keep source averages, zero marks, coefficients and skills; periods are scoped to the student', async () => {
  const f = await fixture(); try {
    const result = await f.request('school/grades'); assert.equal(result.status, 200);
    assert.equal(result.body.items[0].average, 13.75); assert.equal(result.body.items[0].grades[0].mark, 0);
    assert.equal(result.body.items[0].grades[0].coefficient, 2); assert.equal(result.body.skills[0].label, 'Maîtrise satisfaisante');
    assert.deepEqual(f.control.students, ['student-a']);
    assert.equal((await f.request('school/grades?period=period-b')).status, 400);
    const ref = result.body.items[0].grades[0].ref;
    assert.equal((await f.request('school/open', { ref }, 'b')).status, 410);
    const detail = await f.request('school/open', { ref }); assert.equal(detail.body.mark, 0); assert.equal(detail.body.comment, 'Des progrès réguliers.');
  } finally { await f.close(); }
});
test('mail listing has no read side effect; explicit opening marks read and strips HTML and tracking images', async () => {
  const f = await fixture(); try {
    const result = await f.request('school/messages'); assert.equal(result.status, 200); assert.equal(f.control.opened || 0, 0);
    assert.equal((await f.request('school/messages?folder=inbox-b')).status, 400);
    const detail = await f.request('school/open', { ref: result.body.items[0].ref }); assert.equal(detail.status, 200); assert.equal(f.control.opened, 1);
    assert.ok(detail.body.items[0].text.includes('Rendez-vous à 9 heures.')); assert.ok(!JSON.stringify(detail.body).includes('attacker.invalid')); assert.ok(!JSON.stringify(detail.body).includes('sourceAttack'));
    assert.equal((await f.request('school/messages')).body.items[0].read, true);
    assert.equal((await f.request('school/open')).status, 404);
  } finally { await f.close(); }
});
test('private attachments use scoped references and bounded downloads without redirects or client-supplied URLs', async () => {
  const f = await fixture(); try {
    const reports = (await f.request('school/reports')).body;
    assert.equal(reports.items[1].ref, null); assert.ok(!JSON.stringify(reports).includes('https://'));
    const ref = reports.items[0].ref;
    assert.equal((await f.request('school/files/' + ref, undefined, 'b')).status, 410);
    const file = await f.request('school/files/' + ref); assert.equal(file.status, 200); assert.equal(file.body, '%PDF-fixture'); assert.ok(file.headers.get('content-disposition').startsWith('attachment;'));
    assert.equal(f.control.downloadOptions.maxRedirects, 0); assert.equal(f.control.downloadOptions.maxContentLength, 15 * 1024 * 1024);
    for (const value of ['http://api.skolengo.com/api/v1/files', 'https://api.skolengo.com.attacker.invalid/api/v1/files', 'https://user:password@api.skolengo.com/api/v1/files', 'https://api.skolengo.com/login', 'file:///etc/passwd']) assert.equal(attachmentURL(value), null);
  } finally { await f.close(); }
});
test('an unavailable service retains the last valid cache and does not reveal source errors or alter the calendar', async () => {
  const f = await fixture(); try {
    f.store.user('a').cachedICS = 'existing-calendar';
    const first = await f.request('school/reports'); f.control.failReports = true;
    const failure = await f.request('school/reports?refresh=1'); assert.equal(failure.status, 503); assert.ok(!JSON.stringify(failure.body).includes('PRIVATE'));
    assert.deepEqual((await f.request('school/reports')).body, first.body); assert.equal(f.store.user('a').cachedICS, 'existing-calendar');
    f.store.update('a', { studentId: 'another-student' });
    assert.equal((await f.request('school/files/' + first.body.items[0].ref)).status, 410);
  } finally { await f.close(); }
});
test('an exact last page returned as an ENT out-of-range error is an empty completed page', async () => {
  const f = await fixture(); try {
    f.control.exactPage = true;
    const page = await f.request('school/reports?offset=20'); assert.equal(page.status, 200); assert.deepEqual(page.body.items, []); assert.equal(page.body.hasMore, false);
    f.control.failReports = true; assert.equal((await f.request('school/reports?offset=40')).status, 503);
  } finally { await f.close(); }
});
test('notebook, homework corrections, absence history, news and profile use the source contents', async () => {
  const f = await fixture(); try {
    const notebook = (await f.request('school/notebook')).body; const lesson = (await f.request('school/open', { ref: notebook.items[0].ref })).body;
    assert.equal(lesson.contents[0].text, 'Étudier les variations.'); assert.equal(lesson.before[0].title, 'Exercices de calcul');
    const work = (await f.request('school/open', { ref: notebook.work[0].ref })).body; assert.equal(work.corrections[0].text, 'Correction disponible.');
    const absence = (await f.request('school/attendance')).body.items[0]; assert.equal(absence.type, 'LATENESS');
    assert.equal((await f.request('school/open', { ref: absence.ref })).body.history[0].comment, 'Dossier traité');
    const news = (await f.request('school/news')).body.items[0]; assert.equal((await f.request('school/open', { ref: news.ref })).body.url, null);
    assert.equal((await f.request('school/profile')).body.className, 'Première 2');
    const log = JSON.stringify(f.audit.query()); for (const value of ['camille@example.invalid', 'Sortie de classe', 'Calcul littéral', 'Transport']) assert.ok(!log.includes(value));
  } finally { await f.close(); }
});
test('source operations serialize per account and reject a source replacement while waiting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-source-queue-'));
  try {
    const store = new Store(dir); store.state.users.push({ id: 'owner', studentId: 'student', skolengo: store.seal({}) }); store.save();
    const user = store.user('owner'), sequence = []; let release;
    const held = new Promise(resolve => { release = resolve; });
    const first = withSkolengo(store, user, async () => { sequence.push('start-first'); await held; sequence.push('end-first'); }, async () => ({}));
    const second = withSkolengo(store, user, async () => { sequence.push('start-second'); }, async () => ({}));
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(sequence, ['start-first']); release(); await Promise.all([first, second]); assert.deepEqual(sequence, ['start-first', 'end-first', 'start-second']);
    let replace; const barrier = new Promise(resolve => { replace = resolve; });
    const changed = withSkolengo(store, user, async () => { await barrier; }, async () => ({}));
    await new Promise(resolve => setImmediate(resolve)); user.skolengoConnectionId = 'replacement'; replace(); await assert.rejects(changed, /SOURCE_CHANGED/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
