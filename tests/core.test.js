import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ICAL from 'ical.js';
import { Store, passwordHash, passwordMatches } from '../src/store.js';
import { dateWindow, normalizeLessons, fetchSnapshot, reconcileSnapshot } from '../src/sync.js';
import { renderCalendar } from '../src/ical.js';
import { createApp } from '../src/server.js';

const user = { id: 'owner-1', studentId: 'student-1' };
const window = { start: '2026-10-26', end: '2026-12-07' };
const at = Date.parse('2026-10-26T12:00:00Z');
const lesson = { id: 'lesson-1', startDateTime: '2026-10-27T08:00:00+01:00', endDateTime: '2026-10-27T09:00:00+01:00', title: 'Mathématiques', location: 'B204', canceled: false, teachers: [] };
const snapshot = l => normalizeLessons([{ date: '2026-10-27', lessons: [l] }], user, window);
const parse = ics => new ICAL.Component(ICAL.parse(ics));
test('encrypted tokens survive restart and private files contain no plaintext', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-store-'));
  try {
    const s = new Store(dir); s.state.users.push({ id: 'u', skolengo: s.seal({ refresh_token: 'a-private-test-token' }) }); s.save();
    assert.ok(!fs.readFileSync(s.file, 'utf8').includes('a-private-test-token'));
    assert.equal(new Store(dir).open(s.user('u').skolengo).refresh_token, 'a-private-test-token');
    assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
    const encrypted = Buffer.from(s.user('u').skolengo, 'base64'); encrypted[30] ^= 1;
    assert.throws(() => s.open(encrypted.toString('base64')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('password verification and salts', () => {
  const a = passwordHash('phrase-of-at-least-12-chars'), b = passwordHash('phrase-of-at-least-12-chars');
  assert.notEqual(a, b); assert.ok(passwordMatches('phrase-of-at-least-12-chars', a)); assert.ok(!passwordMatches('wrong', a));
});
test('the complete school year follows September boundaries in Paris', () => {
  const current = dateWindow(new Date('2026-10-26T12:00:00Z'));
  assert.equal(current.start, '2026-09-01'); assert.equal(current.end, '2027-08-31'); assert.equal(current.label, '2026–2027');
  assert.equal(current.timeMin, '2026-08-31T22:00:00.000Z'); assert.equal(current.timeMax, '2027-08-31T22:00:00.000Z');
  assert.equal(dateWindow(new Date('2027-06-15T12:00:00Z')).end, '2027-08-31');
  assert.equal(dateWindow(new Date('2026-08-31T21:59:59Z')).start, '2025-09-01');
  assert.equal(dateWindow(new Date('2026-08-31T22:00:00Z')).start, '2026-09-01');
  assert.equal(dateWindow(new Date('2028-02-29T12:00:00Z')).end, '2028-08-31');
});
test('bounded requests cover the whole year and include January, June and August courses', async () => {
  const fullYear = dateWindow(new Date(at)), calls = [];
  const dates = ['2026-09-15', '2027-01-08', '2027-06-15', '2027-08-31'];
  const source = dates.map(date => ({ date, lessons: [{ ...lesson, id: date, startDateTime: date + 'T09:00:00Z', endDateTime: date + 'T10:00:00Z' }] }));
  const result = await fetchSnapshot({ getAgenda: async (student, start, end) => {
    calls.push({ start, end });
    return source.filter(d => d.date >= start && d.date <= end);
  } }, user, fullYear);
  assert.equal(result.size, 4);
  assert.equal(calls[0].start, fullYear.start); assert.equal(calls.at(-1).end, fullYear.end);
  for (let i = 0; i < calls.length; i++) {
    assert.ok(Date.parse(calls[i].end) - Date.parse(calls[i].start) <= 13 * 86400000);
    if (i) assert.equal(Date.parse(calls[i].start) - Date.parse(calls[i - 1].end), 86400000);
  }
  const calendar = reconcileSnapshot(result, {}, fullYear, at).calendar;
  const parsed = parse(renderCalendar(Object.values(calendar))).getAllSubcomponents('vevent');
  assert.equal(parsed.length, 4);
  assert.equal(parsed.at(-1).getFirstPropertyValue('dtstart').toJSDate().toISOString(), '2027-08-31T09:00:00.000Z');
});
test('moving a course preserves its UID, increments SEQUENCE and changes UTC time', () => {
  const first = reconcileSnapshot(snapshot(lesson), {}, window, at);
  const id = Object.keys(first.calendar)[0];
  assert.equal(first.counts.added, 1); assert.equal(first.calendar[id].sequence, 0);
  const same = reconcileSnapshot(snapshot(lesson), first.calendar, window, at + 600000);
  assert.equal(renderCalendar(Object.values(first.calendar)), renderCalendar(Object.values(same.calendar)));
  const moved = reconcileSnapshot(snapshot({ ...lesson, startDateTime: '2026-10-27T10:00:00+01:00', endDateTime: '2026-10-27T11:00:00+01:00', location: 'C105' }), same.calendar, window, at + 1200000);
  assert.equal(Object.keys(moved.calendar).length, 1); assert.equal(moved.calendar[id].sequence, 1); assert.equal(moved.counts.updated, 1);
  const event = parse(renderCalendar(Object.values(moved.calendar))).getFirstSubcomponent('vevent');
  assert.equal(event.getFirstPropertyValue('uid'), id + '@passerelle.invalid');
  assert.equal(event.getFirstPropertyValue('dtstart').toJSDate().toISOString(), '2026-10-27T09:00:00.000Z');
});
test('explicit cancellations, repeated disappearances and restorations keep one UID', () => {
  const first = reconcileSnapshot(snapshot(lesson), {}, window, at), id = Object.keys(first.calendar)[0];
  const cancelled = reconcileSnapshot(snapshot({ ...lesson, canceled: true }), first.calendar, window, at + 1);
  assert.equal(cancelled.counts.deleted, 1);
  assert.equal(parse(renderCalendar(Object.values(cancelled.calendar))).getAllSubcomponents('vevent').length, 0);
  assert.equal(cancelled.calendar[id].cancelled, true);
  const restored = reconcileSnapshot(snapshot(lesson), cancelled.calendar, window, at + 2);
  assert.equal(restored.calendar[id].cancelled, false); assert.equal(restored.calendar[id].sequence, 2);
  const missing = reconcileSnapshot(new Map(), restored.calendar, window, at + 3);
  assert.equal(missing.calendar[id].cancelled, false);
  const gone = reconcileSnapshot(new Map(), missing.calendar, window, at + 4);
  assert.equal(gone.calendar[id].cancelled, true); assert.equal(gone.counts.deleted, 1);
  const back = reconcileSnapshot(snapshot(lesson), gone.calendar, window, at + 5);
  assert.equal(back.calendar[id].cancelled, false); assert.equal(back.calendar[id].sequence, 4);
});
test('past courses are retained without cancellation and old history expires after 90 days', () => {
  const oldWindow = { start: '2026-10-26', end: '2026-12-07' };
  const first = reconcileSnapshot(snapshot(lesson), {}, oldWindow, at);
  const next = reconcileSnapshot(new Map(), first.calendar, { start: '2026-10-28', end: '2026-12-09' }, at + 2 * 86400000);
  const id = Object.keys(next.calendar)[0]; assert.equal(next.calendar[id].cancelled, false);
  const expired = reconcileSnapshot(new Map(), next.calendar, { start: '2027-02-01', end: '2027-03-15' }, at + 100 * 86400000);
  assert.equal(Object.keys(expired.calendar).length, 0);
});
test('past courses from this school year retain their original timestamps and sequence', () => {
  const first = reconcileSnapshot(snapshot(lesson), {}, window, at);
  const fullYear = dateWindow(new Date('2027-07-01T12:00:00Z'));
  const oldId = Object.keys(first.calendar)[0];
  const refreshed = reconcileSnapshot(snapshot(lesson), first.calendar, fullYear, Date.parse('2027-07-01T12:00:00Z'));
  assert.equal(refreshed.calendar[oldId].created, first.calendar[oldId].created);
  assert.equal(refreshed.calendar[oldId].modified, first.calendar[oldId].modified);
  assert.equal(refreshed.calendar[oldId].sequence, 0);
});
test('RFC 5545 round-trips Unicode and escaped content without injecting events', () => {
  const title = 'Économie, spécialité; \\ ' + 'Été 📚'.repeat(35) + '\r\nBEGIN:VEVENT\r\nSUMMARY:injection';
  const calendar = reconcileSnapshot(snapshot({ ...lesson, title }), {}, window, at).calendar;
  const ics = renderCalendar(Object.values(calendar));
  assert.ok(ics.endsWith('\r\n')); assert.ok(!ics.replace(/\r\n/g, '').includes('\n'));
  for (const line of ics.split('\r\n')) assert.ok(Buffer.byteLength(line, 'utf8') <= 75);
  const components = parse(ics).getAllSubcomponents('vevent');
  assert.equal(components.length, 1);
  assert.equal(components[0].getFirstPropertyValue('summary'), '📊 ' + title.replace(/\r\n/g, '\n'));
  assert.equal(components[0].getFirstPropertyValue('dtend').toJSDate().toISOString(), '2026-10-27T08:00:00.000Z');
});
test('incomplete, contradictory and out-of-range source data is rejected', async () => {
  assert.throws(() => normalizeLessons([{ date: '2026-10-27' }], user, window));
  assert.throws(() => snapshot({ ...lesson, endDateTime: 'nonsense' }));
  assert.throws(() => snapshot({ ...lesson, startDateTime: '2026-10-27T08:00:00' }));
  assert.throws(() => normalizeLessons([{ date: '2026-10-27', lessons: [lesson, { ...lesson, canceled: true }] }], user, window));
  assert.throws(() => normalizeLessons([{ date: '2026-10-28', lessons: [lesson] }], user, window));
  await assert.rejects(fetchSnapshot({ getAgenda: async () => { throw new Error('HTTP 503'); } }, user, window));
  await assert.rejects(fetchSnapshot({ getAgenda: async () => null }, user, window));
});
test('portal authentication and ICS publication: cookies, isolation, caching, outages, rotation and revocation', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-http-'));
  let now = at, source = [{ date: '2026-10-27', lessons: [lesson] }], outage = false, reads = 0, agendaCalls=0;
  const { app, store, browsers, engine } = createApp({ dataDir: dir, baseURL: 'http://127.0.0.1:8021/agenda', syncOptions: { clock: () => now, clientFactory: async (s, u) => ({ getAgenda: async (studentId, start, end) => {
    agendaCalls++;
    if (start === dateWindow(new Date(now)).start) reads++;
    if (outage) throw new Error('HTTP 503');
    const days = studentId === 'student-admin' ? [{ date: '2026-10-27', lessons: [{ ...lesson, title: 'Cours privé admin' }] }] : source;
    return days.filter(d => d.date >= start && d.date <= end);
  } }) } });
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const root = 'http://127.0.0.1:' + server.address().port + '/agenda';
  let cookie = '';
  const request = async (url, body, headers = {}) => {
    const response = await fetch(root + url, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { Origin: 'http://127.0.0.1:8021', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, redirect: 'manual' });
    return { response, body: await response.json() };
  };
  const getFeed = (url, headers) => fetch(root + new URL(url).pathname.replace('/agenda', ''), { headers });
  try {
    const invitationURL = fs.readFileSync(path.join(dir, 'admin-invitation.txt'), 'utf8').trim();
    const token = new URLSearchParams(new URL(invitationURL).hash.slice(1)).get('invitation');
    assert.equal((await request('/api/status')).body.user, null);
    assert.equal((await request('/api/admin/users')).response.status, 401);
    assert.equal((await request('/api/register', { token, name: 'Admin', login: 'admin', password: 'long-test-password' }, { Origin: 'https://evil.example' })).response.status, 403);
    const registered = await request('/api/register', { token, name: 'Admin', login: 'admin', password: 'long-test-password' });
    assert.equal(registered.response.status, 200); cookie = registered.response.headers.get('set-cookie').split(';')[0];
    const adminUser = (await request('/api/status')).body.user;
    assert.equal(adminUser.admin, true);
    assert.equal((await request('/api/register', { token, name: 'Replay', login: 'replay', password: 'long-test-password' })).response.status, 404);
    store.update(adminUser.id, { skolengo: store.seal({ testFixture: true }), studentId: 'student-admin' });
    const adminFeed = (await request('/api/feed/create', {})).body.user.feedURL;
    const friendInvite = (await request('/api/admin/invitations', {})).body.url;
    await request('/api/logout', {}); cookie = '';
    const friendToken = new URLSearchParams(new URL(friendInvite).hash.slice(1)).get('invitation');
    const friend = await request('/api/register', { token: friendToken, name: 'Ami', login: 'friend', password: 'a-friend-password' });
    cookie = friend.response.headers.get('set-cookie').split(';')[0];
    let status = (await request('/api/status')).body;
    const friendId = status.user.id;
    assert.equal(status.user.name, 'Ami'); assert.equal(status.user.admin, false); assert.equal(status.user.password, undefined); assert.equal(status.user.skolengo, undefined);
    assert.equal(status.googleConfigured, undefined); assert.equal(status.callbackURL, undefined);
    assert.equal((await request('/api/admin/users')).response.status, 403);
    assert.equal((await request('/api/feed/create', {})).response.status, 409);
    assert.equal((await request('/api/student', { studentId: 'someone-else' })).response.status, 400);
    assert.equal((await request('/api/google/start', {})).response.status, 404);
    store.update(friendId, { skolengo: store.seal({ testFixture: true }), studentId: 'student-1' });
    const created = await request('/api/feed/create', { userId: adminUser.id });
    assert.equal(created.response.status, 200);
    const feed = created.body.user.feedURL;
    assert.ok(feed.endsWith('.ics')); assert.notEqual(feed, adminFeed);
    assert.ok(!fs.readFileSync(store.file, 'utf8').includes(new URL(feed).pathname.split('/').at(-1).replace('.ics', '')));
    const first = await getFeed(feed), firstText = await first.text();
    assert.equal(first.status, 200); assert.match(first.headers.get('content-type'), /^text\/calendar/);
    assert.equal(first.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive');
    assert.ok(!firstText.includes('Cours privé admin'));
    const firstEvent = parse(firstText).getFirstSubcomponent('vevent'), uid = firstEvent.getFirstPropertyValue('uid');
    const adminText = await (await getFeed(adminFeed)).text(); assert.ok(adminText.includes('Cours privé admin')); assert.ok(!adminText.includes(uid));
    const etag = first.headers.get('etag'), modified = first.headers.get('last-modified');
    assert.equal((await getFeed(feed, { 'If-None-Match': etag })).status, 304);
    assert.equal((await getFeed(feed, { 'If-Modified-Since': modified })).status, 304);
    assert.equal((await getFeed(feed, { 'If-None-Match': '"wrong"', 'If-Modified-Since': modified })).status, 200);
    assert.equal((await getFeed(feed.replace(/[^/]+\.ics$/, 'A'.repeat(43) + '.ics'))).status, 404);
    now += 600000;
    source = [{ date: '2026-10-27', lessons: [{ ...lesson, location: 'C105' }] }];
    await request('/api/sync', {});
    const changed = await getFeed(feed); assert.notEqual(changed.headers.get('etag'), etag);
    const changedText = await changed.text(), event = parse(changedText).getFirstSubcomponent('vevent');
    assert.equal(event.getFirstPropertyValue('uid'), uid); assert.equal(event.getFirstPropertyValue('location'), 'C105'); assert.equal(event.getFirstPropertyValue('sequence'), 1);
    const cachedETag = changed.headers.get('etag');
    now += 600000; await request('/api/sync', {});
    assert.equal((await getFeed(feed)).headers.get('etag'), cachedETag);
    const lastSync = store.user(friendId).lastSync;
    outage = true; now += 600000;
    assert.equal((await request('/api/sync', {})).response.status, 502);
    assert.equal(await (await getFeed(feed)).text(), changedText); assert.equal(store.user(friendId).lastSync, lastSync);
    outage = false;
    store.update(adminUser.id, { enabled: false });
    const before = reads,beforeCalls=agendaCalls; now += 299999; await engine.tick(); assert.equal(agendaCalls,beforeCalls);
    now += 1; await engine.tick(); assert.equal(agendaCalls,beforeCalls+2);assert.equal(reads,before,'automatic refresh reads the recent seventeen days rather than the whole year');assert.equal(store.user(friendId).lastSyncMode,'near');
    const rotated = (await request('/api/feed/rotate', {})).body.user.feedURL;
    assert.notEqual(rotated, feed); assert.equal((await getFeed(feed)).status, 404); assert.equal((await getFeed(rotated)).status, 200);
    assert.equal(new Store(dir).open(store.user(friendId).feedKey), store.open(store.user(friendId).feedKey));
    await request('/api/feed/revoke', {});
    assert.equal((await getFeed(rotated)).status, 404); assert.equal(store.user(friendId).enabled, false);
    await request('/api/logout', {});
    assert.equal((await request('/api/status')).body.user, null);
    assert.equal((await request('/api/login', { login: 'friend', password: 'wrong' })).response.status, 401);
    assert.equal((await request('/api/login', { login: 'friend', password: 'a-friend-password' })).response.status, 200);
  } finally { await browsers.close(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
