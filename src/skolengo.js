import { Skolengo } from 'scolengo-api';
import { generators, custom } from 'openid-client';
import { chromium } from 'playwright';
import axios from 'axios';

custom.setHttpOptionsDefaults({ timeout: 20000 });
export const DISCOVERY = 'https://sso.ent.auvergnerhonealpes.fr/oidc/.well-known';
export const CALLBACK = 'skoapp-prod://sign-in-callback';
const HTTP = () => axios.create({ baseURL: 'https://api.skolengo.com/api/v1/bff-sko-app', timeout: 25000 });
const sourceQueues = new WeakMap();
// A single source operation per account also serializes refresh-token rotation.
export async function withSkolengo(store, user, operation, factory = skolengoClient) {
  let queues = sourceQueues.get(store); if (!queues) { queues = new Map(); sourceQueues.set(store, queues); }
  const previous = queues.get(user.id) || Promise.resolve();
  let release; const next = new Promise(resolve => { release = resolve; }); queues.set(user.id, next);
  const student = user.studentId, connection = user.skolengoConnectionId;
  try {
    await previous;
    const current = store.user(user.id);
    if (!current?.skolengo || current.studentId !== student || current.skolengoConnectionId !== connection) throw new Error('SOURCE_CHANGED');
    const result = await operation(await factory(store, current));
    if (!current.skolengo || current.studentId !== student || current.skolengoConnectionId !== connection) throw new Error('SOURCE_CHANGED');
    return result;
  } finally { release(); if (queues.get(user.id) === next) queues.delete(user.id); }
}
export async function searchSchools(text) {
  const schools = await Skolengo.searchSchool({ text }, 100, 0, { timeout: 20000 });
  return schools.filter(s => s.emsCode === 'rra' && s.emsOIDCWellKnownUrl === DISCOVERY);
}
export async function skolengoClient(store, user) {
  const config = store.open(user.skolengo);
  const connection = user.skolengoConnectionId;
  return Skolengo.fromConfigObject(config, { httpClient: HTTP(), onTokenRefresh: tokenSet => {
    const latest = store.user(user.id);
    if (!latest?.skolengo || latest.skolengoConnectionId !== connection) return;
    const value = store.open(latest.skolengo);
    value.tokenSet = { ...value.tokenSet, ...tokenSet };
    store.update(user.id, { skolengo: store.seal(value) });
  }});
}
export async function identify(client) {
  const info = await client.getUserInfo();
  const students = info.students?.length ? info.students : [info];
  return students.map(s => ({ id: s.id, name: [s.firstName, s.lastName].filter(Boolean).join(' '), className: s.className || '' }));
}

function allowed(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return ['ent.auvergnerhonealpes.fr', 'education.gouv.fr', 'educagri.fr', 'skolengo.com', 'kosmoseducation.com', 'gstatic.com', 'google.com', 'googleapis.com'].some(h => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch { return false; }
}

export class LoginBrowsers {
  constructor(store) { this.store = store; this.items = new Map(); this.browser = null; this.launching = null; this.starting = false; }
  async getBrowser() {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.launching) this.launching = chromium.launch({ headless: true, args: ['--disable-dev-shm-usage', '--disable-background-networking'] }).then(browser => {
      this.browser = browser; return browser;
    }).finally(() => { this.launching = null; });
    return this.launching;
  }
  async stop(id) {
    const item = this.items.get(id);
    this.items.delete(id);
    if (item) { clearTimeout(item.timer); await item.context.close().catch(() => {}); }
    if (!this.items.size && !this.starting && this.browser) { const b = this.browser; this.browser = null; await b.close().catch(() => {}); }
  }
  async start(user, school) {
    // Reserve startup before any await: simultaneous public requests must not all
    // pass the capacity check while the first browser is still launching.
    if (this.starting) throw new Error('BROWSER_BUSY');
    this.starting = true;
    try { return await this.open(user, school); }
    finally {
      this.starting = false;
      if (!this.items.size && this.browser) { const browser = this.browser; this.browser = null; await browser.close().catch(() => {}); }
    }
  }
  async open(user, school) {
    await this.stop(user.id);
    if (this.items.size >= 2) throw new Error('BROWSER_BUSY');
    if (school.emsOIDCWellKnownUrl !== DISCOVERY || school.emsCode !== 'rra') throw new Error('INVALID_SCHOOL');
    const client = await Skolengo.getOIDClient(school);
    const state = generators.state(), nonce = generators.nonce(), verifier = generators.codeVerifier();
    const browser = await this.getBrowser();
    const context = await browser.newContext({ viewport: { width: 1000, height: 740 }, locale: 'fr-FR', acceptDownloads: false, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const item = { context, page, status: 'loading', busy: false, expires: Date.now() + 12 * 60000 };
    this.items.set(user.id, item);
    item.timer = setTimeout(() => { void this.stop(user.id); }, 12 * 60000);
    item.timer.unref();
    const complete = async url => {
      if (!url?.startsWith(CALLBACK) || item.status === 'processing' || item.status === 'connected' || item.status === 'error') return;
      item.status = 'processing';
      try {
        const params = client.callbackParams(url);
        const tokenSet = await client.callback(CALLBACK, params, { state, nonce, code_verifier: verifier });
        if (!tokenSet.refresh_token) throw new Error('Missing refresh token');
        const sko = new Skolengo(client, school, tokenSet, { httpClient: HTTP() });
        const students = await identify(sko);
        if (!students.length) throw new Error('No student');
        const latest = this.store.user(user.id);
        const studentId = students.some(s => s.id === latest.studentId) ? latest.studentId : students[0].id;
        const previousSchool = latest.skolengo && this.store.open(latest.skolengo).school.id;
        const changed = latest.studentId && (latest.studentId !== studentId || previousSchool !== school.id);
        const personalLink = !latest.studentId ? { ...(latest.focusHistory ? {focusHistory:latest.focusHistory.map(item=>item.studentId==null?{...item,studentId}:item)} : {}), ...(latest.cardReviews ? {cardReviews:latest.cardReviews.map(item=>item.studentId==null?{...item,studentId}:item)} : {}), ...(latest.flashcards ? {flashcards:latest.flashcards.map(card=>card.studentId==null?{...card,studentId}:card)} : {}), ...(latest.courseNotes ? {courseNotes:latest.courseNotes.map(note=>note.studentId==null?{...note,studentId}:note)} : {}), ...(latest.focusSession?.studentId===null ? {focusSession:{...latest.focusSession,studentId}} : {}) } : {};
        this.store.update(user.id, { ...personalLink, skolengo: this.store.seal({ school, tokenSet }), skolengoConnectionId: generators.state(), schoolName: school.name, students, studentId, skolengoError: null, lastError: null, enabled: false, ...(changed ? { eventSuggestionsState:null,eventSuggestionsScope:null,eventSuggestionsSeq:0,eventNoticeQueue:[],schoolEventCalendar:{}, feedKey: null, feedHash: null, cachedICS: null, calendarEvents: {}, taskCalendar: {}, assignments: [], manualWork: [], workOverrides: {}, changes: [], activityLog: [], activitySeq: 0, lastAgendaVisit: null, searchNews: [], searchNewsInitialized: false, homeworkWarning: null, workLastSync: null, feedETag: null, feedModifiedAt: null, lastSync: null, events: [], total: 0 } : {}) });
        item.status = 'connected';
        await context.close();
      } catch { item.status = 'error'; item.error = 'La connexion ENT a échoué. Fermez cette fenêtre puis réessayez.'; await context.close().catch(() => {}); }
    };
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(CALLBACK)) { void complete(url); return route.abort(); }
      if (!allowed(url)) return route.abort();
      return route.continue();
    });
    context.on('page', p => { if (p !== page) void p.close(); });
    page.on('response', response => { void response.headerValue('location').then(location => complete(location)).catch(() => {}); });
    // Redirect headers are observed before Chromium dispatches a custom protocol.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    cdp.on('Network.responseReceivedExtraInfo', e => { const headers = e.headers || {}; void complete(headers.location || headers.Location); });
    cdp.on('Network.requestWillBeSent', e => { void complete(e.request?.url); void complete(e.redirectResponse?.headers?.location || e.redirectResponse?.headers?.Location); });
    page.on('dialog', d => { void d.dismiss(); });
    try {
      await page.goto(client.authorizationUrl({ scope: 'openid', state, nonce, code_challenge: generators.codeChallenge(verifier), code_challenge_method: 'S256' }), { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (item.status === 'loading') item.status = 'login';
    } catch {
      if (item.status === 'loading') { await this.stop(user.id); throw new Error('ENT_UNAVAILABLE'); }
    }
    return { status: item.status };
  }
  status(id) {
    const i = this.items.get(id);
    if (!i) return { status: 'closed' };
    let host = ''; try { host = new URL(i.page.url()).hostname; } catch { /* no current URL */ }
    return { status: i.status, error: i.error, host, expires: i.expires };
  }
  async frame(id) {
    const i = this.items.get(id);
    if (!i || !['login', 'loading'].includes(i.status) || i.busy) return null;
    i.busy = true;
    try { return await i.page.screenshot({ type: 'jpeg', quality: 75, timeout: 8000 }); }
    finally { i.busy = false; }
  }
  async input(id, action) {
    const i = this.items.get(id);
    if (!i || i.status !== 'login') throw new Error('LOGIN_CLOSED');
    if (action.type === 'click' && Number.isFinite(action.x) && Number.isFinite(action.y)) {
      await i.page.mouse.click(Math.max(0, Math.min(999, action.x)), Math.max(0, Math.min(739, action.y)));
    } else if (action.type === 'text' && typeof action.text === 'string' && action.text.length <= 1000) {
      await i.page.keyboard.insertText(action.text);
    } else if (action.type === 'key' && typeof action.key === 'string' && /^(Tab|Shift\+Tab|Enter|Backspace|Delete|Escape|Arrow(Left|Right|Up|Down)|Home|End|Control\+a|Meta\+a|Space)$/.test(action.key)) {
      await i.page.keyboard.press(action.key);
    } else if (action.type === 'scroll' && Number.isFinite(action.y)) {
      await i.page.mouse.wheel(0, Math.max(-700, Math.min(700, action.y)));
    } else throw new Error('INVALID_INPUT');
  }
  async close() { for (const id of [...this.items.keys()]) await this.stop(id); }
}
