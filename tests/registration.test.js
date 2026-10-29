import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { digest, random } from '../src/store.js';
import { LoginBrowsers } from '../src/skolengo.js';

async function fixture(dir) {
  const context = createApp({ dataDir: dir, baseURL: 'http://127.0.0.1:8021/agenda', bootstrap: false });
  const server = context.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const root = 'http://127.0.0.1:' + server.address().port + '/agenda';
  return { ...context, async request(url, body, { cookie = '', ip = '198.51.100.1', origin = 'http://127.0.0.1:8021' } = {}) {
    const response = await fetch(root + '/api/' + url, { ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }), headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Forwarded-For': ip, ...(cookie ? { Cookie: cookie } : {}) } });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] || '', headers: response.headers };
  }, async close() { await context.browsers.close(); await new Promise(resolve => server.close(resolve)); } };
}
const signup = (login, other = {}) => ({ name: 'Camille', login, password: 'a-long-temporary-password', ...other });

test('public signup needs no invitation, never grants admin and keeps accounts isolated', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-registration-')), f = await fixture(dir);
  try {
    const status = await f.request('status'); assert.equal(status.body.registrationOpen, true); assert.equal(status.body.billingEnabled, false);
    const a = await f.request('register', signup('member-a', { admin: true, enabled: true, skolengo: 'injected' }));
    assert.equal(a.status, 200); assert.ok(a.cookie); assert.match(a.headers.get('set-cookie'), /HttpOnly/); assert.match(a.headers.get('set-cookie'), /SameSite=Lax/);
    const first = f.store.state.users[0]; assert.equal(first.admin, false); assert.equal(first.enabled, false); assert.equal(first.skolengo, undefined); assert.equal(first.registrationSource, 'public');
    assert.ok(!fs.readFileSync(f.store.file, 'utf8').includes('a-long-temporary-password'));
    const privateToken = random(); f.store.update(first.id, { feedKey: f.store.seal(privateToken), skolengo: f.store.seal({ secret: 'private-source-fixture' }) });
    const b = await f.request('register', signup('member-b'), { ip: '198.51.100.2' }); assert.equal(b.status, 200);
    const own = await f.request('status', undefined, { cookie: b.cookie }); assert.equal(own.body.user.login, 'member-b'); assert.equal(own.body.user.admin, false); assert.equal(own.body.user.feedURL, null); assert.equal(own.body.user.skolengoConnected, false);
    assert.ok(!JSON.stringify(own.body).includes(privateToken)); assert.equal(own.body.user.password, undefined); assert.equal(own.body.user.skolengo, undefined);
    for (const [route, body] of [['admin/users', undefined], ['admin/registration', { enabled: false }], ['admin/invitations', {}]]) assert.equal((await f.request(route, body, { cookie: b.cookie })).status, 403);
    const audit = f.audit.query({ q: 'security.registered' }); assert.equal(audit.total, 2); assert.ok(audit.rows.every(row => row.meta.mode === 'public'));
  } finally { await f.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('only an administrator can close signup, settings survive restart and invitations still work', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-registration-setting-')); let f = await fixture(dir);
  try {
    f.store.state.invites.push({ hash: digest('fixture-admin-invite'), admin: true, expires: Date.now() + 60000 }); f.store.save();
    const admin = await f.request('register', signup('owner', { token: 'fixture-admin-invite' })); assert.equal(admin.status, 200);
    assert.equal((await f.request('admin/registration', { enabled: 'false' }, { cookie: admin.cookie })).status, 400);
    assert.equal((await f.request('admin/registration', { enabled: false }, { cookie: admin.cookie })).body.registrationOpen, false);
    assert.equal((await f.request('register', signup('closed-member'))).status, 403);
    const invitation = await f.request('admin/invitations', {}, { cookie: admin.cookie }); const token = new URLSearchParams(new URL(invitation.body.url).hash.slice(1)).get('invitation');
    await f.close(); f = await fixture(dir);
    assert.equal((await f.request('status')).body.registrationOpen, false);
    const invited = await f.request('register', signup('invited-member', { token })); assert.equal(invited.status, 200); assert.equal(f.store.state.users.at(-1).admin, false);
    assert.equal((await f.request('register', signup('replayed-member', { token }))).status, 404);
    assert.equal((await f.request('register', signup('expired-member', { token: 'invalid-invitation' }))).status, 404);
    const login = await f.request('login', { login: 'owner', password: 'a-long-temporary-password' });
    assert.equal((await f.request('admin/registration', { enabled: true }, { cookie: login.cookie })).body.registrationOpen, true);
    assert.equal((await f.request('register', signup('new-member'))).status, 200); assert.equal(f.audit.verify().ok, true);
  } finally { await f.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('public signup rejects cross-origin posts, weak credentials, duplicates and bot trap submissions', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-registration-validation-')), f = await fixture(dir);
  try {
    assert.equal((await f.request('register', signup('wrong-origin'), { origin: 'https://other.example' })).status, 403);
    assert.equal((await f.request('register', signup('weak', { password: 'short' }))).status, 400);
    assert.equal((await f.request('register', signup('bad identifier'))).status, 400);
    assert.equal((await f.request('register', signup('bot', { companyWebsite: 'https://example.invalid' }))).status, 400);
    assert.equal(f.store.state.users.length, 0);
    assert.equal((await f.request('register', signup('Public-User', { companyWebsite: '' }))).status, 200);
    assert.equal((await f.request('register', signup('public-user'))).status, 409); assert.equal(f.store.state.users.length, 1);
  } finally { await f.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('signup throttles repeated attempts per address without blocking other visitors', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-registration-limit-')), f = await fixture(dir);
  try {
    for (let n = 0; n < 10; n++) assert.equal((await f.request('register', signup('limited', { password: 'short' }))).status, 400);
    assert.equal((await f.request('register', signup('limited'))).status, 429);
    assert.equal((await f.request('register', signup('another'), { ip: '198.51.100.8' })).status, 200);
  } finally { await f.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

test('public ENT starts reserve capacity before awaiting and release it on failure', async () => {
  const browsers = new LoginBrowsers({}), user = { id: 'fixture' };
  let release, closes = 0;
  browsers.browser = { close: async () => { closes++; } };
  browsers.open = async () => { await new Promise(resolve => { release = resolve; }); return { status: 'login' }; };
  const first = browsers.start(user, {});
  await assert.rejects(browsers.start({ id: 'another' }, {}), /BROWSER_BUSY/);
  await browsers.stop('unrelated'); assert.equal(closes, 0, 'a concurrent stop must not close a browser being prepared');
  release(); assert.equal((await first).status, 'login'); assert.equal(browsers.starting, false); assert.equal(closes, 1);
  browsers.open = async () => { throw new Error('ENT_UNAVAILABLE'); };
  await assert.rejects(browsers.start(user, {}), /ENT_UNAVAILABLE/); assert.equal(browsers.starting, false);
  browsers.open = async () => ({ status: 'login' }); assert.equal((await browsers.start(user, {})).status, 'login');
});
