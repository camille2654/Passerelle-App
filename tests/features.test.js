import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ICAL from 'ical.js';
import { Store } from '../src/store.js';
import { subjectFor } from '../src/subjects.js';
import { normalizeAssignments, fetchAssignments, userWork, buildBrief, plainText } from '../src/work.js';
import { MailEngine, emailAddress, briefMessage } from '../src/mail.js';
import { createApp } from '../src/server.js';
import { dateWindow, normalizeLessons, reconcileSnapshot, fetchSnapshot } from '../src/sync.js';
import { renderCalendar } from '../src/ical.js';

const now = Date.parse('2026-10-26T19:05:00Z');
const window = dateWindow(new Date(now));
const student = { id: 'student-user', studentId: 'student-id', name: 'Alice', subjectStyles: {} };
const lesson = { id: 'lesson-one', title: 'Mathématiques', startDateTime: '2026-10-27T08:00:00+01:00', endDateTime: '2026-10-27T09:00:00+01:00', canceled: false, location: 'B204', teachers: [], subject: { id: 'math', label: 'Mathématiques' } };
const days = [{ date: '2026-10-27', lessons: [lesson], homeworkAssignments: [
  { id: 'h1', title: 'Exercices 1 et 2', html: '<p>Page <b>42</b>.</p><script>alert(1)</script>', dueDateTime: '2026-10-27T08:00:00+01:00', done: false, subject: { label: 'Mathématiques' } },
  { id: 'h2', title: 'Contrôle sur les fonctions', html: '<p>Revoir le chapitre 2.</p>', dueDateTime: '2026-10-27T08:00:00+01:00', done: false, subject: { label: 'Mathématiques' } }
] }];
function fixtureStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-feature-'));
  const store = new Store(dir);
  const courses = reconcileSnapshot(normalizeLessons(days, student, window), {}, window, now).calendar;
  const user = { ...student, calendarEvents: courses, assignments: normalizeAssignments(days, student, window).assignments, manualWork: [], lastSync: now, workLastSync: now };
  store.state.users.push(user); store.save(); return { dir, store, user };
}
test('subject emojis and colors are stable, customizable and safe', () => {
  const math = subjectFor({ label: 'Mathématiques' }), english = subjectFor({ label: 'Anglais LV1' });
  assert.equal(math.emoji, '📐'); assert.equal(math.color, 'royalblue'); assert.equal(english.emoji, '🇬🇧'); assert.notEqual(math.color, english.color);
  const custom = subjectFor({ label: 'Mathématiques' }, '', { [math.key]: { emoji: '🧪', color: 'crimson' } });
  assert.equal(custom.emoji, '🧪'); assert.equal(custom.color, 'crimson');
  assert.equal(subjectFor({ label: 'Mathématiques' }, '', { [math.key]: { emoji: '<script>', color: 'url(evil)' } }).color, 'royalblue');
});
test('homework is plain text and assessments are identified without creating grades', () => {
  const result = normalizeAssignments(days, student, window);
  assert.equal(result.available, true); assert.equal(result.assignments.length, 2);
  assert.equal(result.assignments[0].due, '2026-10-27'); assert.ok(!result.assignments[0].details.includes('alert'));
  const work = userWork({ ...student, assignments: result.assignments });
  assert.equal(work.filter(w => w.kind === 'exam').length, 1);
  assert.ok(!plainText('<img src="https://example.invalid/track">Bonjour').includes('example.invalid'));
  const other = normalizeAssignments(days, { ...student, id: 'another-user' }, window);
  assert.notEqual(result.assignments[0].id, other.assignments[0].id);
  const plural = normalizeAssignments([{ date: '2026-10-27', homeworkAssignments: [{ ...days[0].homeworkAssignments[0], title: 'Évaluations de fin de chapitre' }] }], student, window);
  assert.equal(plural.assignments[0].detectedExam, true);
});
test('schedule remains available when the optional homework service is refused', async () => {
  const snapshot = await fetchSnapshot({ getHomeworkAssignments: async () => { const error = new Error('Forbidden'); error.status = '403'; throw error; }, getAgenda: async (id, start, end, limit, offset, params, include) => {
    assert.ok(!include.includes('homeworkAssignments'));
    return days.filter(d => d.date >= start && d.date <= end).map(({ homeworkAssignments, ...day }) => day);
  } }, student, window);
  assert.equal(snapshot.size, 1); assert.equal(snapshot.work.available, false);
});
test('dedicated homework endpoint is paginated and covers the school year', async () => {
  const tasks = Array.from({ length: 25 }, (_, i) => ({ id: 'work-' + i, title: 'Exercice ' + i, html: '<p>Consigne</p>', dueDateTime: '2026-10-27T08:00:00+01:00', done: false, subject: { label: 'Mathématiques' } }));
  tasks.push({ ...tasks[0], id: 'summer-work', dueDateTime: '2027-06-15T08:00:00+02:00' });
  const calls = [];
  const result = await fetchAssignments({ getHomeworkAssignments: async (studentId, start, end, limit, offset, params, include) => {
    assert.deepEqual(include, ['subject']); calls.push({ start, end, offset });
    return tasks.filter(t => t.dueDateTime.slice(0, 10) >= start && t.dueDateTime.slice(0, 10) <= end).slice(offset, offset + limit);
  } }, student, window);
  assert.equal(result.available, true); assert.equal(result.assignments.length, 26);
  assert.ok(calls.some(c => c.offset === 20)); assert.equal(calls.at(-1).end, '2027-08-31');
  assert.equal(result.assignments.find(t => t.sourceId === 'summer-work').due, '2027-06-15');
});
test('ENT end-of-pagination 400 is accepted only after a full page', async () => {
  const tasks = Array.from({ length: 20 }, (_, i) => ({ id: 'exact-' + i, title: 'Exercice', dueDateTime: '2026-10-27T08:00:00+01:00', done: false, subject: { label: 'Mathématiques' } }));
  const error = () => Object.assign(new Error('page offset out of range, cannot move beyond data set'), { status: '400' });
  const result = await fetchAssignments({ getHomeworkAssignments: async (student, start, end, limit, offset) => {
    const matching = tasks.filter(t => t.dueDateTime.slice(0, 10) >= start && t.dueDateTime.slice(0, 10) <= end);
    if (offset && offset >= matching.length) throw error();
    return matching.slice(offset, offset + limit);
  } }, student, window);
  assert.equal(result.assignments.length, 20); assert.equal(result.available, true);
  await assert.rejects(fetchAssignments({ getHomeworkAssignments: async () => { throw error(); } }, student, window));
});
test('homework requests stop after the last published course period', async () => {
  const calls = [];
  const snapshot = await fetchSnapshot({
    getAgenda: async (id, start, end) => days.filter(d => d.date >= start && d.date <= end),
    getHomeworkAssignments: async (id, start, end, limit, offset) => {
      assert.ok(start <= '2026-10-27'); calls.push({ start, end });
      return days.filter(d => d.date >= start && d.date <= end).flatMap(d => d.homeworkAssignments).slice(offset, offset + limit);
    }
  }, student, window);
  assert.equal(snapshot.work.available, true); assert.equal(snapshot.work.assignments.length, 2);
  assert.ok(calls.at(-1).end >= '2026-10-27');
});
test('tomorrow brief includes only tomorrow courses, pending homework and nearby exams', () => {
  const { dir, user } = fixtureStore();
  try {
    const brief = buildBrief(user, new Date(now));
    assert.equal(brief.date, '2026-10-27'); assert.equal(brief.courses.length, 1); assert.equal(brief.homework.length, 1); assert.equal(brief.exams.length, 1);
    const later = { ...user, manualWork: [{ id: 'later', due: '2026-11-03', title: 'Hors des sept prochains jours', kind: 'exam', subjectLabel: 'Mathématiques' }] };
    assert.equal(buildBrief(later, new Date(now)).exams.length, 1);
    const done = { ...user, workOverrides: { [user.assignments[0].id]: { done: true } } };
    assert.equal(buildBrief(done, new Date(now)).homework.length, 0);
    const message = briefMessage({ ...user, name: '<script>alert(1)</script>' }, brief, 'https://portal.example', 'https://portal.example/#unsubscribe=token');
    assert.ok(message.html.includes('&lt;script&gt;')); assert.ok(!message.html.includes('<script>'));
    assert.ok(message.text.includes('B204')); assert.ok(message.text.includes('Exercices 1 et 2'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('mail requires verified ownership and is sent once a day in Paris, with unsubscribe', async () => {
  const { dir, store, user } = fixtureStore(); let clock = now - 3600000;
  const sent = [];
  const transportFactory = () => ({ verify: async () => true, close: () => {}, sendMail: async content => { sent.push(content); return { accepted: [content.to] }; } });
  const mailer = new MailEngine(store, 'https://portal.example/agenda', { clock: () => clock, transportFactory });
  try {
    await assert.rejects(mailer.savePreferences(user, { address: 'alice@example.invalid', time: '20:00', enabled: true }), /configur/);
    await mailer.configure({ host: 'smtp.example.invalid', port: 587, username: 'sender', password: 'a-private-smtp-password', fromEmail: 'sender@example.invalid' });
    assert.equal(mailer.publicSMTP().password, undefined);
    assert.ok(!fs.readFileSync(store.file, 'utf8').includes('a-private-smtp-password'));
    await mailer.savePreferences(user, { address: 'alice@example.invalid', time: '20:00', enabled: true });
    assert.equal(sent.length, 1); assert.equal(user.emailConfig.enabled, false);
    assert.ok(!fs.readFileSync(store.file, 'utf8').includes('alice@example.invalid'));
    await assert.rejects(mailer.sendBrief(user), /Confirmez/);
    const token = sent[0].text.match(/#verify-email=([A-Za-z0-9_-]+)/)[1];
    mailer.verifyAddress(token); assert.equal(user.emailConfig.enabled, true);
    assert.throws(() => mailer.verifyAddress(token));
    await mailer.tick(); assert.equal(sent.length, 1, 'before the chosen hour');
    clock = now;
    await Promise.all([mailer.tick(), mailer.tick()]); assert.equal(sent.length, 2);
    assert.equal(user.lastBrief.status, 'sent'); assert.equal(user.lastBrief.date, '2026-10-26');
    const restarted = new MailEngine(new Store(dir), 'https://portal.example/agenda', { clock: () => clock, transportFactory });
    await restarted.tick(); assert.equal(sent.length, 2, 'no duplicate after restart');
    const unsubscribe = sent[1].text.match(/#unsubscribe=([A-Za-z0-9_-]+)/)[1];
    mailer.unsubscribe(unsubscribe); assert.equal(user.emailConfig.enabled, false);
    clock += 86400000; await mailer.tick(); assert.equal(sent.length, 2);
    await mailer.savePreferences(user, { address: 'alice@example.invalid', time: '20:00', enabled: true });
    await mailer.sendBrief(user, true); assert.equal(sent.length, 3);
    assert.equal(user.lastBrief.date, '2026-10-26', 'manual preview does not overwrite scheduled delivery');
    assert.throws(() => emailAddress('person@example.invalid\r\nBcc: other@example.invalid'));
    assert.throws(() => emailAddress('alice,bob@example.invalid'));
    assert.throws(() => emailAddress('alice;bob@example.invalid'));
    assert.throws(() => emailAddress('alice@example..invalid'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('failed daily sends do not loop or claim successful delivery', async () => {
  const { dir, store, user } = fixtureStore(); let fail = false, calls = 0;
  const mailer = new MailEngine(store, 'https://portal.example/agenda', { clock: () => now, transportFactory: () => ({ verify: async () => {}, close: () => {}, sendMail: async () => { calls++; if (fail) throw new Error('SMTP timeout'); return { accepted: ['alice@example.invalid'] }; } }) });
  try {
    await mailer.configure({ host: 'smtp.example.invalid', port: 465, username: 'sender', password: 'password', fromEmail: 'sender@example.invalid' });
    await mailer.savePreferences(user, { address: 'alice@example.invalid', time: '20:00', enabled: true });
    // Verify using the stored hash through a fresh verification call captured in a fake transport.
    user.emailConfig.verified = true; user.emailConfig.enabled = true; store.save(); fail = true;
    await mailer.tick(); assert.equal(user.lastBrief.status, 'failed');
    await mailer.tick(); assert.equal(calls, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('personal tasks, subject settings, alarms and filtered feeds remain isolated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-feature-http-'));
  const { app, store, browsers } = createApp({ dataDir: dir, baseURL: 'http://127.0.0.1:8021/agenda', clock: () => now, syncOptions: { clock: () => now, clientFactory: async () => ({ getAgenda: async (id, start, end) => days.filter(d => d.date >= start && d.date <= end) }) } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const root = 'http://127.0.0.1:' + server.address().port + '/agenda'; let cookie = '';
  const request = async (url, body) => {
    const response = await fetch(root + url, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { Origin: 'http://127.0.0.1:8021', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  try {
    const invite = fs.readFileSync(path.join(dir, 'admin-invitation.txt'), 'utf8').trim();
    const token = new URLSearchParams(new URL(invite).hash.slice(1)).get('invitation');
    cookie = (await request('/api/register', { token, name: 'Alice', login: 'alice', password: 'temporary-password-123' })).cookie;
    const user = store.state.users[0]; store.update(user.id, { skolengo: store.seal({ fixture: true }), studentId: 'student-id' });
    const feed = (await request('/api/feed/create', {})).body.user.feedURL;
    const getFeed = query => fetch(root + new URL(feed).pathname.replace('/agenda', '') + query).then(r => r.text());
    const homework = new ICAL.Component(ICAL.parse(await getFeed('?type=homework'))).getAllSubcomponents('vevent');
    assert.equal(homework.length, 1); assert.equal(homework[0].getFirstPropertyValue('dtstart').isDate, true);
    assert.equal(homework[0].getFirstPropertyValue('dtstart').toString(), '2026-10-27');
    const uid = new ICAL.Component(ICAL.parse(await getFeed('?type=course'))).getFirstSubcomponent('vevent').getFirstPropertyValue('uid');
    const subject = (await request('/api/status')).body.user.subjects.find(s => s.label === 'Mathématiques');
    assert.equal((await request('/api/subjects/' + subject.key, { emoji: '🧪', color: 'crimson' })).status, 200);
    let course = new ICAL.Component(ICAL.parse(await getFeed('?type=course'))).getFirstSubcomponent('vevent');
    assert.equal(course.getFirstPropertyValue('color'), 'crimson'); assert.ok(course.getFirstPropertyValue('summary').startsWith('🧪')); assert.equal(course.getFirstPropertyValue('uid'), uid);
    assert.equal((await request('/api/preferences', { reminderMinutes: 10 })).status, 200);
    course = new ICAL.Component(ICAL.parse(await getFeed('?type=course'))).getFirstSubcomponent('vevent');
    assert.equal(course.getFirstSubcomponent('valarm').getFirstPropertyValue('trigger').toString(), '-PT10M');
    const added = await request('/api/work', { kind: 'exam', title: 'Contrôle personnel', due: '2026-11-02', subjectLabel: 'Mathématiques', details: 'Chapitre 3' });
    assert.equal(added.status, 200);
    assert.equal((await request('/api/work/' + added.body.id, { done: true })).status, 200);
    const exams = new ICAL.Component(ICAL.parse(await getFeed('?type=exam'))).getAllSubcomponents('vevent');
    assert.equal(exams.length, 1); assert.ok(exams.every(e => e.getFirstPropertyValue('status') === 'CONFIRMED'));
    assert.ok(!exams.some(e => e.getFirstPropertyValue('uid') === added.body.id + '@passerelle.invalid'));
    assert.equal((await request('/api/work/not-owned', { done: true })).status, 404);
    assert.equal((await request('/api/subjects/not-owned', { emoji: '🧪', color: 'crimson' })).status, 404);
    assert.equal((await request('/api/email/preferences', { address: 'alice@example.invalid', enabled: true, time: '20:00' })).status, 409);
    assert.equal((await request('/api/brief')).body.brief.homework.length, 1);
    assert.equal((await request('/api/work/' + added.body.id + '/remove', {})).status, 200);
  } finally { await browsers.close(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
