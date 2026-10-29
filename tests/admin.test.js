import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, digest, random } from '../src/store.js';
import { AuditLog } from '../src/audit.js';
import { MailEngine, detectSMTP } from '../src/mail.js';
import { createApp } from '../src/server.js';

test('private audit survives restart, filters events and rejects changed or truncated files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-audit-'));
  try {
    const store = new Store(dir), audit = new AuditLog(store);
    const secret = random();
    audit.record('sync.completed', { source: 'sync', userId: 'alice', meta: { durationMs: 87, count: 12, password: secret, token: secret, route: '/calendars/' + secret + '.ics', errorCode: 'person@example.invalid' } });
    audit.record('mail.failed', { source: 'mail', userId: 'bob', level: 'error', meta: { errorCode: 'SMTP_SEND_FAILED' } });
    assert.equal(audit.query({ level: 'error', userId: 'bob' }).total, 1);
    assert.equal(audit.query({ source: 'sync', q: 'terminée' }).total, 1);
    assert.equal(audit.query({ userId: 'bob', source: 'sync' }).total, 0);
    const file = path.join(audit.dir, audit.files()[0]), saved = fs.readFileSync(file, 'utf8');
    assert.ok(!saved.includes(secret)); assert.ok(!saved.includes('person@example.invalid')); assert.ok(!saved.includes('password'));
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal(new AuditLog(new Store(dir)).verify().ok, true);
    fs.writeFileSync(file, saved.replace('SMTP_SEND_FAILED', 'SMTP_CHANGED'));
    assert.equal(audit.verify().ok, false);
    fs.writeFileSync(file, saved.split('\n').slice(0, 1).join('\n') + '\n');
    const restarted = new AuditLog(new Store(dir)); assert.equal(restarted.integrity.ok, false);
    assert.equal(restarted.record('system.started'), null, 'a failed integrity check cannot silently replace the checkpoint');
    fs.writeFileSync(file, saved); assert.equal(audit.verify().ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('audit rotates files, limits memory and expires old records without breaking retained chain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-audit-rotation-'));
  try {
    let now = Date.parse('2026-10-01T12:00:00Z');
    const store = new Store(dir), audit = new AuditLog(store, { clock: () => now, maxBytes: 1, maxFiles: 3, maxRows: 2, retentionDays: 2 });
    for (let i = 0; i < 6; i++) audit.record('system.started');
    assert.ok(audit.files().length <= 3); assert.equal(audit.query().retained, 2); assert.equal(audit.verify().ok, true);
    now += 4 * 86400000; audit.record('system.started');
    assert.equal(audit.files().length, 1); assert.equal(audit.query().retained, 1); assert.equal(audit.verify().ok, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('admin can draft account-email links and only the latest confirmed address gets briefs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-admin-mail-')), sent = [];
  try {
    const store = new Store(dir), user = { id: 'friend', name: 'Camille' }; store.state.users.push(user); store.save();
    const audit = new AuditLog(store), mailer = new MailEngine(store, 'https://portal.example/agenda', { audit, transportFactory: () => ({ verify: async () => {}, close() {}, sendMail: async content => { sent.push(content); return { accepted: [content.to] }; } }) });
    await mailer.assignAddress(user, { address: 'first@example.invalid', time: '19:30', enabled: true }, 'admin');
    assert.equal(sent.length, 0); assert.equal(user.emailConfig.enabled, false); assert.equal(mailer.publicSettings(user).draft, true);
    await assert.rejects(mailer.requestVerification(user), /expéditeur/);
    await mailer.configure({ fromEmail: 'sender@gmail.com', password: 'secret-app-password' });
    assert.equal(mailer.publicSMTP().host, 'smtp.gmail.com'); assert.equal(mailer.publicSMTP().port, 465);
    await mailer.requestVerification(user, 'admin');
    const first = sent[0].text.match(/#verify-email=([A-Za-z0-9_-]+)/)[1];
    await mailer.assignAddress(user, { address: 'second@example.invalid', time: '20:00', enabled: true }, 'admin');
    assert.throws(() => mailer.verifyAddress(first));
    await assert.rejects(mailer.sendBrief(user), /Confirmez/);
    await mailer.requestVerification(user, 'admin');
    mailer.verifyAddress(sent[1].text.match(/#verify-email=([A-Za-z0-9_-]+)/)[1]);
    await mailer.sendBrief(user, true); assert.equal(sent.at(-1).to, 'second@example.invalid');
    mailer.unsubscribe(sent.at(-1).text.match(/#unsubscribe=([A-Za-z0-9_-]+)/)[1]);
    await mailer.assignAddress(user, { address: 'second@example.invalid', time: '19:00', enabled: true }, 'admin');
    assert.equal(user.emailConfig.enabled, false, 'admin cannot override recipient opt-out');
    assert.equal(user.emailConfig.time, '19:00');
    const all = fs.readFileSync(store.file, 'utf8') + audit.files().map(f => fs.readFileSync(path.join(audit.dir, f), 'utf8')).join('');
    assert.ok(!all.includes('second@example.invalid')); assert.ok(!all.includes('secret-app-password')); assert.ok(!all.includes(first));
    assert.equal(audit.query({ source: 'mail', q: 'mail.sent' }).total, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('sender environment auto-configuration verifies access and does not replace an existing sender', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-env-mail-')); let checked = 0;
  try {
    const mailer = new MailEngine(new Store(dir), 'https://portal.example', { transportFactory: () => ({ verify: async () => { checked++; }, close() {} }) });
    assert.equal(await mailer.configureEnvironment({}), false);
    assert.equal(await mailer.configureEnvironment({ AGENDA_SMTP_FROM: 'sender@gmail.com', AGENDA_SMTP_PASSWORD: 'app-password' }), true);
    assert.equal(checked, 1); assert.equal(await mailer.configureEnvironment({ AGENDA_SMTP_FROM: 'another@gmail.com', AGENDA_SMTP_PASSWORD: 'other-password' }), false);
    assert.equal(mailer.publicSMTP().fromEmail, 'sender@gmail.com');
    assert.equal(detectSMTP('custom@example.invalid').host, '');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('admin endpoints reject members, enforce origin, expose redacted logs and persist associations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agenda-admin-http-'));
  const { app, store, browsers, audit } = createApp({ dataDir: dir, baseURL: 'http://127.0.0.1:8021/agenda', bootstrap: false });
  const admin = { id: 'admin', name: 'Admin', admin: true }, friend = { id: 'friend', name: 'Friend' };
  const adminToken = random(), memberToken = random();
  store.state.users.push(admin, friend); store.state.sessions.push({ hash: digest(adminToken), userId: 'admin', expires: Date.now() + 60000 }, { hash: digest(memberToken), userId: 'friend', expires: Date.now() + 60000 }); store.save();
  const server = app.listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r));
  const root = 'http://127.0.0.1:' + server.address().port + '/agenda';
  const request = (url, body, token = adminToken, origin = 'http://127.0.0.1:8021') => fetch(root + '/api/' + url, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: 'agenda_session=' + token, Origin: origin, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    for (const url of ['admin/users', 'admin/logs', 'admin/overview', 'admin/logs/export']) assert.equal((await request(url, undefined, memberToken)).status, 403);
    assert.equal((await request('admin/users/friend/email', { address: 'friend@example.invalid' }, memberToken)).status, 403);
    assert.equal((await request('admin/users/friend/email', { address: 'friend@example.invalid' }, adminToken, 'https://wrong.example')).status, 403);
    assert.equal((await request('admin/users/friend/email', { address: 'friend@example.invalid', time: '20:15', enabled: true, sendConfirmation: false })).status, 200);
    const people = await (await request('admin/users')).json();
    assert.equal(people.users.find(u => u.id === 'friend').email.address, 'friend@example.invalid');
    assert.equal((await (await request('status', undefined, memberToken)).json()).user.email.address, 'friend@example.invalid');
    const query = await (await request('admin/logs?source=admin&userId=friend')).json();
    assert.ok(query.rows.some(row => row.event === 'mail.assigned')); assert.ok(!JSON.stringify(query).includes('friend@example.invalid'));
    const exported = await request('admin/logs/export'); assert.match(exported.headers.get('content-disposition'), /attachment/);
    assert.ok(!(await exported.text()).includes(adminToken));
    assert.equal((await (await request('admin/logs/verify', {})).json()).ok, true);
    assert.equal(audit.query({ source: 'security' }).total, 6);
    assert.ok(!fs.readFileSync(store.file, 'utf8').includes('friend@example.invalid'));
  } finally { await browsers.close(); await new Promise(r => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); }
});
