import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store, random, digest } from '../src/store.js';
import { createApp } from '../src/server.js';
import { dateWindow, SyncEngine, normalizeLessons, reconcileSnapshot } from '../src/sync.js';
import { subjectFor } from '../src/subjects.js';
import { weekView, bagView, revisionPlan, commonSlots, availabilityView, validDate } from '../src/planner.js';
import { MailEngine } from '../src/mail.js';
import { changeAlertQueue, changeAlertMessage } from '../src/change-alerts.js';

const now = Date.parse('2026-10-27T11:00:00Z'), window = dateWindow(new Date(now)), math = subjectFor({ label: 'Mathématiques' });
const course = { id: 'private-course-id', date: '2026-10-28', title: '📐 MATIÈRE PRIVÉE', rawTitle: 'Mathématiques', subject: math, start: '2026-10-28T08:00:00Z', end: '2026-10-28T10:00:00Z', location: 'SALLE PRIVÉE', cancelled: false };
const fixture = id => ({ id, name: id === 'alice' ? 'Alice' : 'Bob', login: id + '-private-login', studentId: id, skolengo: 'encrypted-source', lastSync: now, calendarWindow: { start: window.start, end: window.end }, calendarEvents: { one: { ...course, id: id + '-course' } }, manualWork: [{ id: id + '-exam', title: 'Contrôle à préparer', due: '2026-10-31', subjectLabel: 'Mathématiques', kind: 'exam', createdAt: now }] });

test('weekly view includes seven real dates, cancellations, homework and private revision sessions', () => {
  const user = fixture('alice'); user.calendarEvents.cancelled = { ...course, id: 'cancelled', cancelled: true };
  user.studySessions = [{ id: 'session', day: '2026-10-28', minutes: 25, title: 'Révision', done: false }];
  const week = weekView(user, '2026-10-28', now);
  assert.equal(week.start, '2026-10-26'); assert.equal(week.end, '2026-11-01'); assert.equal(week.days.length, 7);
  assert.equal(week.days.find(day => day.date === '2026-10-28').courses.length, 2);
  assert.equal(week.days.find(day => day.date === '2026-10-28').study.length, 1);
  assert.equal(week.days.find(day => day.date === '2026-10-31').work.length, 1);
  assert.equal(weekView({ ...user, lastSync: null }, '2026-10-28', now).warning.includes('Connectez'), true);
  for (const value of ['2026-02-30', '2026-13-01', '2026-10-99', '<script>']) assert.throws(() => validDate(value));
});
test('bag follows the selected date and active subjects, and checked items do not carry to another day', () => {
  const user = fixture('alice'); user.bagKit = { daily: [{ id: 'daily', label: 'Clés' }], [math.key]: [{ id: 'calculator', label: 'Calculatrice' }] }; user.bagChecks = { '2026-10-28': { calculator: true } };
  assert.equal(bagView(user, '2026-10-28').items.length, 2);
  assert.equal(bagView(user, '2026-10-28').items.find(item => item.id === 'calculator').checked, true);
  assert.equal(bagView(user, '2026-10-29').items.length, 1);
  assert.equal(bagView(user, '2026-10-29').items[0].checked, false);
  user.calendarEvents.one.cancelled = true; assert.equal(bagView(user, '2026-10-28').items.length, 1);
});
test('revision plans finish before the assessment, preserve completed sessions and reject impossible workload', () => {
  const user = fixture('alice'), plan = revisionPlan(user, { examId: 'alice-exam', totalMinutes: 90, sessionMinutes: 25 }, now);
  assert.equal(plan.minutes, 90); assert.equal(plan.planned, 4);
  assert.ok(plan.sessions.every(session => session.day >= '2026-10-27' && session.day < '2026-10-31'));
  assert.equal(new Set(plan.sessions.map(session => session.day)).size, 4);
  user.studySessions = plan.sessions.map((session, i) => ({ ...session, done: i === 0 }));
  const next = revisionPlan(user, { examId: 'alice-exam', totalMinutes: 90, sessionMinutes: 25 }, now);
  assert.equal(next.sessions.filter(session => session.done).length, 1); assert.equal(next.minutes, 65);
  assert.equal(next.sessions.reduce((sum, session) => sum + session.minutes, 0), 90);
  assert.throws(() => revisionPlan(user, { examId: 'bob-exam', totalMinutes: 90 }, now), /disponible/);
  user.manualWork[0].due = '2026-10-28'; assert.throws(() => revisionPlan(user, { examId: 'alice-exam', totalMinutes: 600 }, now), /insuffisant/);
  user.manualWork[0].due = '2026-10-27'; assert.throws(() => revisionPlan(user, { examId: 'alice-exam', totalMinutes: 60 }, now), /aujourd/);
});
test('common free slots merge overlapping courses, ignore cancellations and respect Paris time and overnight courses', () => {
  const alice = fixture('alice'), bob = fixture('bob');
  bob.calendarEvents.one = { ...course, start: '2026-10-28T09:00:00Z', end: '2026-10-28T11:00:00Z' };
  bob.calendarEvents.cancelled = { ...course, cancelled: true, start: '2026-10-28T14:00:00Z', end: '2026-10-28T15:00:00Z' };
  assert.deepEqual(commonSlots([alice, bob], '2026-10-28', { start: 480, end: 1080, duration: 60 }), [{ start: 480, end: 540 }, { start: 720, end: 1080 }]);
  const overnight = { calendarEvents: { lesson: { ...course, start: '2026-10-27T22:00:00Z', end: '2026-10-28T01:00:00Z' } } };
  assert.deepEqual(commonSlots([overnight], '2026-10-28', { start: 0, end: 360, duration: 60 }), [{ start: 120, end: 360 }]);
  const summer = { calendarEvents: { lesson: { ...course, start: '2027-06-03T08:00:00Z', end: '2027-06-03T09:00:00Z' } } };
  assert.deepEqual(commonSlots([summer], '2027-06-03', { start: 540, end: 720, duration: 30 }), [{ start: 540, end: 600 }, { start: 660, end: 720 }]);
});
test('unknown or stale calendars never become an apparently free day', () => {
  const alice = fixture('alice'), bob = fixture('bob'); bob.lastSync = now - 31 * 60000;
  const view = availabilityView([alice, bob], '2026-10-28', {}, now);
  assert.ok(view.days.every(day => !day.complete && day.slots.length === 0));
  bob.lastSync = now; bob.lastError = 'ENT indisponible'; assert.equal(availabilityView([alice, bob], '2026-10-28', {}, now).days[2].complete, false);
  bob.lastError = null; const fresh = availabilityView([alice, bob], '2026-10-28', {}, now);
  assert.equal(fresh.days[2].complete, true); assert.ok(fresh.days[2].slots.length > 0);
  assert.ok(!JSON.stringify(fresh).includes('MATIÈRE PRIVÉE')); assert.ok(!JSON.stringify(fresh).includes('SALLE PRIVÉE')); assert.ok(!JSON.stringify(fresh).includes('private-login'));
});
test('friend links require two consents, stay separate from portal invites and are immediately revocable', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-friend-http-'));
  const { app, store, browsers } = createApp({ dataDir: dir, baseURL: 'http://127.0.0.1:8021/agenda', bootstrap: false, plannerOptions: { clock: () => now } });
  const tokens = Object.fromEntries(['alice', 'bob', 'charlie'].map(id => [id, random()]));
  for (const id of Object.keys(tokens)) { store.state.users.push(fixture(id)); store.state.sessions.push({ hash: digest(tokens[id]), userId: id, expires: Date.now() + 60000 }); } store.save();
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const root = 'http://127.0.0.1:' + server.address().port + '/agenda/api/';
  const request = async (id, url, body) => { const response = await fetch(root + url, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'http://127.0.0.1:8021', Cookie: 'agenda_session=' + (tokens[id] || ''), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; };
  try {
    assert.equal((await request('alice', 'friends/invite', {})).status, 400);
    const result = await request('alice', 'friends/invite', { shareAvailability: true }); assert.equal(result.status, 200);
    const token = new URLSearchParams(new URL(result.body.url).hash.slice(1)).get('friend');
    assert.ok(token); assert.equal(store.state.invites.length, 0); assert.ok(!fs.readFileSync(store.file, 'utf8').includes(token));
    assert.equal((await request('none', 'friends/preview', { token })).status, 401);
    assert.equal((await request('alice', 'friends/preview', { token })).status, 400);
    assert.equal((await request('bob', 'friends/preview', { token })).body.name, 'Alice');
    assert.equal((await request('bob', 'friends/accept', { token })).status, 400);
    assert.equal((await request('bob', 'friends/accept', { token, shareAvailability: true })).status, 200);
    assert.equal((await request('bob', 'friends/accept', { token, shareAvailability: true })).status, 404);
    const friends = (await request('alice', 'friends')).body.friends; assert.equal(friends.length, 1); assert.equal(friends[0].name, 'Bob');
    const relation = friends[0].id, query = 'friends/availability?date=2026-10-28&duration=60&friends=' + relation;
    const slots = await request('alice', query); assert.equal(slots.status, 200); assert.ok(slots.body.days[2].slots.length);
    assert.ok(!JSON.stringify(slots.body).includes('MATIÈRE PRIVÉE')); assert.ok(!JSON.stringify(slots.body).includes('SALLE PRIVÉE'));
    assert.equal((await request('charlie', query)).status, 404);
    assert.equal((await request('charlie', 'friends/' + relation + '/remove', {})).status, 404);
    assert.equal((await request('bob', 'friends/' + relation + '/remove', {})).status, 200);
    assert.equal((await request('alice', query)).status, 404);
    assert.equal((await request('alice', 'friends')).body.friends.length, 0);
    const logs = fs.readdirSync(path.join(dir, 'logs')).filter(name => name.endsWith('.jsonl')).map(name => fs.readFileSync(path.join(dir, 'logs', name), 'utf8')).join(''); assert.ok(!logs.includes(token));
  } finally { await browsers.close(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('bag and revision HTTP writes remain owner-scoped and persist on restart', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-planner-http-'));
  let plannerTime = now;
  const { app, store, browsers } = createApp({ dataDir: dir, baseURL: 'http://127.0.0.1:8021/agenda', bootstrap: false, plannerOptions: { clock: () => plannerTime } });
  const tokens = { alice: random(), bob: random() };
  for (const id of Object.keys(tokens)) { store.state.users.push(fixture(id)); store.state.sessions.push({ hash: digest(tokens[id]), userId: id, expires: Date.now() + 60000 }); } store.save();
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const root = 'http://127.0.0.1:' + server.address().port + '/agenda/api/';
  const request = async (id, url, body) => { const response = await fetch(root + url, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'http://127.0.0.1:8021', Cookie: 'agenda_session=' + tokens[id], 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return { status: response.status, body: await response.json() }; };
  try {
    assert.equal((await request('alice', 'bag/kit', { subjectKey: math.key, items: ['Calculatrice', 'calculatrice'] })).status, 200);
    const bag = (await request('alice', 'bag?date=2026-10-28')).body; assert.equal(bag.items.length, 1);
    assert.equal((await request('alice', 'bag/check', { date: '2026-10-28', id: bag.items[0].id, checked: true })).status, 200);
    assert.equal((await request('bob', 'bag/check', { date: '2026-10-28', id: bag.items[0].id, checked: true })).status, 404);
    assert.equal((await request('alice', 'bag/kit', { subjectKey: 'unknown', items: ['Livre'] })).status, 404);
    assert.equal((await request('alice', 'week?date=2026-02-30')).status, 400);
    assert.equal((await request('alice', 'study/plan', { examId: 'bob-exam', totalMinutes: 60 })).status, 404);
    assert.equal((await request('alice', 'study/plan', { examId: 'alice-exam', totalMinutes: 90, sessionMinutes: 25 })).body.planned, 4);
    const sessions = (await request('alice', 'study')).body.sessions;
    assert.equal((await request('bob', 'study/' + sessions[0].id, { done: true })).status, 404);
    assert.equal((await request('alice', 'study/' + sessions[0].id, { done: true })).status, 200);
    const persisted = JSON.parse(fs.readFileSync(store.file, 'utf8')).users.find(user => user.id === 'alice');
    assert.equal(persisted.studySessions[0].done, true); assert.equal(persisted.bagChecks['2026-10-28'][bag.items[0].id], true);
    assert.equal((await request('alice', 'week?date=2026-10-28')).body.days.reduce((sum, day) => sum + day.study.length, 0), 4);
    plannerTime = Date.parse('2027-08-31T12:00:00Z');
    assert.equal((await request('alice', 'bag')).body.date, '2027-09-01');
    assert.equal((await request('alice', 'bag?date=2027-09-08')).status, 400);
    assert.equal((await request('alice', 'week?date=2027-09-01')).status, 400);
  } finally { await browsers.close(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
test('change alerts require explicit opt-in, cover upcoming school-year courses and ignore cosmetic or past changes', () => {
  const user = fixture('alice'), change = { id: 'change', eventId: 'event', date: '2026-10-28', at: now, type: 'updated', before: { start: course.start, end: course.end, location: 'B204' }, after: { start: course.start, end: course.end, location: 'C105' } };
  assert.equal(changeAlertQueue(user, [change], now).length, 0);
  user.emailConfig = { verified: true, alertsEnabled: true, alertsSince: now - 1 };
  assert.equal(changeAlertQueue({ ...user, lastSync: null }, [change], now).length, 0);
  const queue = changeAlertQueue(user, [change], now); assert.equal(queue.length, 1);
  assert.equal(changeAlertQueue({ ...user, emailAlertQueue: queue }, [change], now).length, 1);
  assert.equal(changeAlertQueue(user, [{ ...change, before: change.after }], now).length, 0);
  assert.equal(changeAlertQueue(user, [{ ...change, date: '2027-07-01' }], now).length, 1);
  assert.equal(changeAlertQueue(user, [{ ...change, date: '2026-10-26' }], now).length, 0);
  assert.equal(changeAlertQueue(user, [{ ...change, type: 'added' }], now).length, 0);
  const moved = { ...change, title: '<script>titre</script>', date: '2026-10-29', after: { ...change.after, start: '2026-10-29T08:00:00Z', end: '2026-10-29T10:00:00Z' } };
  const message = changeAlertMessage(user, [moved], 'https://portal.example', 'https://portal.example/#unsubscribe=token');
  assert.ok(message.text.includes('mercredi')); assert.ok(message.text.includes('jeudi')); assert.ok(message.text.includes('Déplacement :'));
  assert.ok(!message.html.includes('<script>')); assert.ok(message.html.includes('&lt;script&gt;'));
});
test('detected room changes are mailed once, survive restart without duplicate and stop on unsubscribe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-change-mail-')); let clock = now, room = 'B204', fail = false; const sent = [];
  const store = new Store(dir), user = { ...fixture('alice'), calendarEvents: {}, lastSync: null }; store.state.users.push(user); store.save();
  const transportFactory = () => ({ verify: async () => {}, close() {}, sendMail: async message => { sent.push(message); if (fail) throw new Error('uncertain outcome'); return { accepted: [message.to] }; } });
  const mailer = new MailEngine(store, 'https://portal.example/agenda', { clock: () => clock, transportFactory });
  const engine = new SyncEngine(store, { clock: () => clock, clientFactory: async () => ({ getAgenda: async (id, start, end) => '2026-10-28' >= start && '2026-10-28' <= end ? [{ date: '2026-10-28', lessons: [{ id: 'one', title: 'Mathématiques', startDateTime: course.start, endDateTime: course.end, location: room, canceled: false, subject: { label: 'Mathématiques' }, teachers: [] }] }] : [] }) });
  try {
    await mailer.configure({ fromEmail: 'sender@gmail.com', password: 'app-password' });
    await mailer.savePreferences(user, { address: 'alice@example.invalid', enabled: false, alertsEnabled: true, time: '20:00' });
    mailer.verifyAddress(sent[0].text.match(/#verify-email=([A-Za-z0-9_-]+)/)[1]);
    assert.equal(user.emailConfig.enabled, false); assert.equal(user.emailConfig.alertsEnabled, true);
    await engine.run(user.id); await mailer.tick(); assert.equal(sent.length, 1, 'no first-import flood');
    clock += 600000; room = 'C105'; await engine.run(user.id); assert.equal(user.emailAlertQueue.filter(item => item.status === 'pending').length, 1);
    await Promise.all([mailer.tick(), mailer.tick()]); assert.equal(sent.length, 2); assert.equal(user.lastChangeAlert.status, 'sent'); assert.ok(sent[1].text.includes('B204 → C105'));
    await mailer.tick(); const restarted = new MailEngine(new Store(dir), 'https://portal.example/agenda', { clock: () => clock, transportFactory }); await restarted.tick(); assert.equal(sent.length, 2);
    clock += 600000; room = 'D301'; fail = true; await engine.run(user.id); await mailer.tick(); assert.equal(user.lastChangeAlert.status, 'failed'); assert.equal(sent.length, 3);
    await mailer.tick(); assert.equal(sent.length, 3, 'uncertain delivery is not automatically repeated');
    mailer.unsubscribe(sent[1].text.match(/#unsubscribe=([A-Za-z0-9_-]+)/)[1]); assert.equal(user.emailConfig.alertsEnabled, false); assert.equal(user.emailAlertQueue.length, 0);
    clock += 600000; room = 'E105'; await engine.run(user.id); await mailer.tick(); assert.equal(sent.length, 3);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
