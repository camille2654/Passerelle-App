import {accountActive,automationAllowed} from './operational-state.js';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {digest} from './store.js';
import {PublicError, dateWindow} from './sync.js';
import {plainText, isAssessment, parisDate, shiftDate} from './work.js';
import {subjectFor, normalizeLabel} from './subjects.js';
import {rebuildCalendar} from './calendar.js';
import {pronoteBinding, linkedPronote} from './sources.js';
import {activityPatch, assignmentChanges} from './activity.js';

const workerPath = fileURLToPath(new URL('./pronote-worker.py', import.meta.url));
const DEFAULT_PYTHON = path.resolve(path.dirname(workerPath), '../../agenda-bridge-pronote-venv/bin/python');
const messages = {AUTH_EXPIRED: 'La connexion Pronote a expiré. Générez un nouveau QR code dans Pronote.', INVALID_QR: 'Le QR code ou son code à 4 chiffres est incorrect ou expiré. Générez-en un nouveau.', MFA_REQUIRED: 'Pronote demande le code de sécurité de votre compte. Renseignez-le puis générez un nouveau QR code.', SOURCE_UNAVAILABLE: 'Pronote ne répond pas. Les dernières informations reçues sont conservées.', UNSUPPORTED: 'Cette fonction n’est pas fournie par ce serveur Pronote.', SOURCE_CHANGED: 'L’élève ou la connexion a changé. Relancez la connexion Pronote.'};
export function validatePronoteURL(input) {
  let url;
  try { url = new URL(String(input)); } catch { throw new PublicError('Le QR code ne contient pas une adresse Pronote valide.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z0-9-]+\.index-education\.net$/i.test(url.hostname) || !/^\/pronote\/(?:mobile\.)?eleve\.html$/.test(url.pathname) || url.hash) throw new PublicError('Utilisez le QR code de votre espace Élève Pronote hébergé sur index-education.net. Pour une installation propre à votre lycée, contactez l’administration de Passerelle.');
  return url;
}
export function runPronoteWorker(payload, onCredentials, {python = process.env.AGENDA_PRONOTE_PYTHON || DEFAULT_PYTHON, timeout = 180000} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['-B', workerPath], {stdio: ['pipe', 'pipe', 'ignore'], env: {...process.env, PYTHONUNBUFFERED: '1'}});
    let buffer = '', bytes = 0, snapshot = null, failure = null, settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('SOURCE_UNAVAILABLE')); }, timeout); timer.unref();
    child.on('error', () => finish(new Error('SOURCE_UNAVAILABLE')));
    child.stdin.on('error', () => {});
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if(settled)return;
      bytes += Buffer.byteLength(chunk); if (bytes > 8 * 1024 * 1024) { child.kill('SIGKILL'); finish(new Error('SOURCE_UNAVAILABLE')); return; }
      buffer += chunk.toString('utf8');
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        try {
          const value = JSON.parse(line);
          if (value.kind === 'credentials') {onCredentials(value.credentials); child.stdin.write(JSON.stringify({ack:'credentials'}) + '\n');}
          if (value.kind === 'snapshot') snapshot = value.snapshot;
          if (value.kind === 'error') failure = value.code;
        } catch { child.kill('SIGKILL'); finish(new Error('SOURCE_UNAVAILABLE')); }
      }
    });
    child.on('close', code => finish(code || failure || !snapshot ? new Error(messages[failure] ? failure : 'SOURCE_UNAVAILABLE') : null, snapshot));
    child.stdin.write(JSON.stringify(payload) + '\n');
  });
}
const text = (value, max = 1000) => String(value || '').slice(0, max);
const numeric = value => { if (value === null || value === undefined || String(value).trim() === '') return null; const number = Number(String(value).replace(',', '.')); return Number.isFinite(number) ? number : null; };
function mergeSnapshot(previous, incoming, now) {
  if (!incoming?.identity?.id || !incoming.identity.name || !Array.isArray(incoming.periods) || !incoming.sections) throw new Error('SOURCE_UNAVAILABLE');
  // PRONOTE references belong to a session. The UI must not reuse them after login.
  const periodIds = new Map(incoming.periods.map(item => [item.id, digest([item.label, item.start?.slice(0, 10), item.end?.slice(0, 10)].join(':')).slice(0, 32)]));
  const periods = incoming.periods.slice(0, 12).map(item => ({...item, id: periodIds.get(item.id)}));
  const sections = {};
  for (const key of ['grades', 'reports', 'attendance', 'homework', 'courses']) {
    const item = incoming.sections[key];
    if (item?.state === 'available' && Array.isArray(item.data)) sections[key] = {state: 'available', data: ['grades','reports'].includes(key) ? item.data.map(row => ({...row,period:periodIds.get(row.period)||row.period})) : item.data, fetchedAt: now, warning: null};
    else if (previous?.sections?.[key]?.state === 'available' && item?.state !== 'unavailable') sections[key] = {...previous.sections[key], warning: 'La dernière version disponible est affichée ; cette rubrique ne répond pas actuellement.'};
    else sections[key] = {state: item?.state === 'unavailable' ? 'unavailable' : 'error', data: [], fetchedAt: now, warning: 'Cette rubrique n’a pas pu être lue.'};
  }
  return {identity: {id: text(incoming.identity.id, 100), name: text(incoming.identity.name, 200), className: text(incoming.identity.className, 120), school: text(incoming.identity.school, 200)}, periods, window: incoming.window, sections, fetchedAt: now};
}
export function normalizePronoteAssignments(user, snapshot, origin) {
  const scopeKey = digest([user.id,user.studentId,origin,normalizeLabel(snapshot.identity.name),snapshot.window.start].join(':'));
  const previous = user.pronoteScope === scopeKey ? user.pronoteAssignments || [] : [];
  const incoming = (snapshot.sections.homework?.data || []).map(item => {
    const details = plainText(item.details), title = details.split('\n')[0].slice(0, 300) || 'Travail à faire';
    return {sourceId: text(item.id, 100), title, details, due: text(item.date, 10), subjectLabel: text(item.subject, 120), done: item.done === true, detectedExam: isAssessment(title, details), source: 'pronote'};
  }).filter(item => /^\d{4}-\d{2}-\d{2}$/.test(item.due) && Number.isFinite(Date.parse(item.due)));
  const content = item => normalizeLabel(item.subjectLabel) + '|' + normalizeLabel(item.details || item.title);
  const fingerprint = item => item.due + '|' + content(item);
  const keys = new Map([...previous,...incoming].map(item => [item,{subject:normalizeLabel(item.subjectLabel),content:content(item),exact:fingerprint(item),edited:[item.due,normalizeLabel(item.subjectLabel),normalizeLabel(item.title)].join('|'),raw:item.sourceId}]));
  const index = (items,key) => {const result=new Map();for(const item of items){const value=keys.get(item)[key];if(!result.has(value))result.set(value,[]);result.get(value).push(item);}return result;};
  const oldExact=index(previous,'exact'),oldRaw=index(previous,'raw'),oldContent=index(previous,'content'),oldEdited=index(previous,'edited'),newExact=index(incoming,'exact'),newContent=index(incoming,'content'),newEdited=index(incoming,'edited');
  const used = new Set();
  const result = incoming.map(item => {
    const key=keys.get(item),unique = rows => rows?.length === 1 && !used.has(rows[0].id) ? rows[0] : null;
    const rawCandidate=unique(oldRaw.get(item.sourceId)),raw=rawCandidate && keys.get(rawCandidate).subject===key.subject && (rawCandidate.due===item.due || keys.get(rawCandidate).content===key.content) ? rawCandidate : null;
    const old = newExact.get(key.exact).length === 1 ? unique(oldExact.get(key.exact)) || raw || (newContent.get(key.content).length===1 ? unique(oldContent.get(key.content)) : null) || (newEdited.get(key.edited).length===1 ? unique(oldEdited.get(key.edited)) : null) : null;
    const id = old?.id || digest(scopeKey + ':work:' + key.exact + (newExact.get(key.exact).length > 1 ? ':' + item.sourceId : ''));
    if (old) used.add(old.id);
    return {...item,id};
  });
  return {assignments:result,scopeKey};
}
export class PronoteService {
  constructor(store, {clock = () => Date.now(), audit = null, worker = runPronoteWorker} = {}) { this.store = store; this.clock = clock; this.audit = audit; this.worker = worker; this.running = new Set(); this.queue = Promise.resolve(); this.waiting = 0; }
  get ready() { return this.worker !== runPronoteWorker || fs.existsSync(process.env.AGENDA_PRONOTE_PYTHON || DEFAULT_PYTHON); }
  pendingPreview(user) {
    const snapshot = user.pendingPronoteSnapshot;
    if(!snapshot || !user.pendingPronoteId || !user.pendingPronote || user.pendingPronoteBinding !== pronoteBinding(user) || this.clock()-user.pendingPronoteAt>10*60000)return null;
    return {candidate:user.pendingPronoteId,identity:{name:snapshot.identity.name,className:snapshot.identity.className,school:snapshot.identity.school},entStudent:user.students?.find(item=>item.id===user.studentId)?.name||user.name,entSchool:user.schoolName};
  }
  publicSettings(user) {
    const linked = linkedPronote(user), snapshot = linked ? user.pronoteSnapshot : null;
    return {ready: this.ready, connected: !!user.pronote, linked, needsConfirmation: !!this.pendingPreview(user), pending: this.pendingPreview(user), enabled: user.pronoteSyncEnabled !== false, needsReconnect: !!user.pronoteNeedsReconnect, syncing: this.running.has(user.id), identity: snapshot?.identity ? {name: snapshot.identity.name, className: snapshot.identity.className, school: snapshot.identity.school} : null, lastSync: linked ? user.pronoteLastSync || null : null, lastError: user.pronoteError || null, sections: Object.fromEntries(Object.entries(snapshot?.sections || {}).map(([key, value]) => [key, {state: value.state, fetchedAt: value.fetchedAt, warning: value.warning}]))};
  }
  async operate(user, read) {
    if (this.running.has(user.id)) throw new PublicError('Une consultation Pronote est déjà en cours.', 409);
    if (this.waiting >= 1) throw new PublicError('Une lecture Pronote est en cours sur le serveur. Réessayez dans quelques instants.', 429);
    this.running.add(user.id); this.waiting++;
    const previous = this.queue; let release;
    this.queue = new Promise(resolve => { release = resolve; });
    try { await previous; return await read(); } finally { this.waiting--; this.running.delete(user.id); release(); }
  }
  async connect(user, body) {
    if (!this.ready) throw new PublicError('Le connecteur Pronote doit être installé par l’administration.', 503);
    if (!user.skolengo || !user.studentId) throw new PublicError('Connectez d’abord votre ENT et choisissez votre élève avant d’associer Pronote.', 409);
    let qr;
    try { qr = typeof body.qr === 'string' ? JSON.parse(body.qr) : body.qr; } catch { throw new PublicError('Le contenu du QR code est invalide.'); }
    const url = validatePronoteURL(qr?.url);
    if (!/^[0-9a-f]{16,8192}$/i.test(qr?.login || '') || !/^[0-9a-f]{16,8192}$/i.test(qr?.jeton || '') || qr.login.length%32 || qr.jeton.length%32 || !/^\d{4}$/.test(String(body.pin || '')) || String(body.accountPin || '').length > 128) throw new PublicError('Choisissez un QR code Pronote récent et son code à 4 chiffres.');
    qr = {url:url.href,login:qr.login,jeton:qr.jeton};
    const binding = pronoteBinding(user), id = randomUUID(), started = this.clock();
    return this.operate(user, async () => {
      this.store.update(user.id, {pendingPronoteId: id, pendingPronote: null, pendingPronoteSnapshot: null, pendingPronoteBinding: binding, pendingPronoteAt: started});
      try {
        const snapshot = await this.worker({mode: 'qr', qr, pin: String(body.pin), accountPin: String(body.accountPin || ''), uuid: randomUUID(), today: parisDate(new Date(this.clock())), window: dateWindow(new Date(this.clock()))}, credentials => {
          if (this.store.user(user.id)?.pendingPronoteId !== id) throw new Error('SOURCE_CHANGED');
          if(validatePronoteURL(credentials.pronote_url).origin !== url.origin)throw new Error('SOURCE_CHANGED'); this.store.update(user.id, {pendingPronote: this.store.seal(credentials)});
        });
        if (pronoteBinding(user) !== binding || !user.skolengo || !user.pendingPronote) throw new Error('SOURCE_CHANGED');
        const clean = mergeSnapshot(null, snapshot, this.clock());
        this.store.update(user.id, {pendingPronoteSnapshot: clean});
        this.audit?.record('pronote.connected', {source: 'sync', userId: user.id, meta: {durationMs: this.clock() - started}});
        const student = user.students?.find(item => item.id === user.studentId);
        return {candidate: id, identity: {name: clean.identity.name, className: clean.identity.className, school: clean.identity.school}, entStudent: student?.name || user.name, entSchool: user.schoolName, sections: Object.fromEntries(Object.entries(clean.sections).map(([key, value]) => [key, value.state]))};
      } catch (error) {
        this.store.update(user.id, {pendingPronoteId: null, pendingPronote: null, pendingPronoteSnapshot: null});
        const code = messages[error.message] ? error.message : 'SOURCE_UNAVAILABLE';
        this.audit?.record('pronote.failed', {source: 'sync', level: 'warn', userId: user.id, meta: {errorCode: code}});
        throw new PublicError(messages[code], 502);
      }
    });
  }
  confirm(user, body) {
    if (this.running.has(user.id)) throw new PublicError('Attendez la fin de la connexion Pronote.', 409);
    if (body.confirm !== true || body.candidate !== user.pendingPronoteId || !user.pendingPronote || !user.pendingPronoteSnapshot || user.pendingPronoteBinding !== pronoteBinding(user) || this.clock() - user.pendingPronoteAt > 10 * 60000) throw new PublicError('Cette association a expiré ou l’élève a changé. Recommencez la connexion.', 409);
    const snapshot = user.pendingPronoteSnapshot;
    const origin = new URL(this.store.open(user.pendingPronote).pronote_url).origin, normalized = normalizePronoteAssignments(user,snapshot,origin);
    this.store.update(user.id, {pronote: user.pendingPronote, pronoteConnectionId: randomUUID(), pronoteBinding: pronoteBinding(user), pronoteSnapshot: snapshot, pronoteInstance:origin, pronoteScope:normalized.scopeKey, pronoteAssignments: normalized.assignments, pronoteLastSync: this.clock(), pronoteLastAttempt: this.clock(), pronoteSyncEnabled: true, pronoteNeedsReconnect: false, pronoteError: null, pendingPronoteId: null, pendingPronote: null, pendingPronoteSnapshot: null, personalVersion: this.clock()});
    if (user.cachedICS) rebuildCalendar(this.store, user.id, this.clock());
    this.audit?.record('pronote.confirmed', {source: 'sync', userId: user.id});
    return this.publicSettings(user);
  }
  async sync(user) {
    if(!accountActive(user))throw new PublicError('Ce compte n’est pas actif.',409);
    if (!linkedPronote(user)) throw new PublicError('Associez Pronote à l’élève actuellement sélectionné.', 409);
    return this.operate(user, async () => {
      const id = user.pronoteConnectionId, binding = pronoteBinding(user), now = this.clock(), credentials = this.store.open(user.pronote), origin = new URL(credentials.pronote_url).origin;
      try {
        const incoming = await this.worker({mode: 'token', credentials, today: parisDate(new Date(now)), window: dateWindow(new Date(now))}, credentials => {
          if (user.pronoteConnectionId !== id || !user.pronote || pronoteBinding(user) !== binding) throw new Error('SOURCE_CHANGED');
          if(validatePronoteURL(credentials.pronote_url).origin !== origin)throw new Error('SOURCE_CHANGED'); this.store.update(user.id, {pronote: this.store.seal(credentials)});
        });
        if (!linkedPronote(user) || user.pronoteConnectionId !== id) throw new Error('SOURCE_CHANGED');
        if (normalizeLabel(incoming.identity?.name) !== normalizeLabel(user.pronoteSnapshot?.identity.name) || incoming.identity?.school && user.pronoteSnapshot?.identity.school && normalizeLabel(incoming.identity.school) !== normalizeLabel(user.pronoteSnapshot.identity.school)) throw new Error('SOURCE_CHANGED');
        const snapshot = mergeSnapshot(user.pronoteSnapshot, incoming, now), normalized = normalizePronoteAssignments(user,snapshot,origin), work = normalized.assignments;
        this.store.update(user.id, {...activityPatch(user, assignmentChanges(user.pronoteAssignments, work, now, 'Pronote'), now), pronoteAssignments: work, pronoteScope:normalized.scopeKey, pronoteInstance:origin, pronoteSnapshot: snapshot, pronoteLastAttempt: now, pronoteLastSync: now, pronoteError: null, pronoteNeedsReconnect: false, personalVersion: now});
        if (user.cachedICS) rebuildCalendar(this.store, user.id, now);
        this.audit?.record('pronote.synced', {source: 'sync', userId: user.id, meta: {durationMs: this.clock() - now, count: work.length}});
        return this.publicSettings(user);
      } catch (error) {
        const code = messages[error.message] ? error.message : 'SOURCE_UNAVAILABLE';
        this.store.update(user.id, {pronoteLastAttempt: now, pronoteError: messages[code], pronoteNeedsReconnect: ['AUTH_EXPIRED', 'MFA_REQUIRED', 'SOURCE_CHANGED'].includes(code)});
        this.audit?.record('pronote.failed', {source: 'sync', level: 'warn', userId: user.id, meta: {errorCode: code}}); throw new PublicError(messages[code], 502);
      }
    });
  }
  async tick() { for(const user of this.store.state.users) if(user.pendingPronoteId && this.clock()-user.pendingPronoteAt>10*60000 && !this.running.has(user.id))this.store.update(user.id,{pendingPronote:null,pendingPronoteId:null,pendingPronoteSnapshot:null}); if(!automationAllowed(this.store.state.settings,'pronote',this.clock()))return; for (const user of this.store.state.users) if (automationAllowed(this.store.state.settings,'pronote',this.clock()) && accountActive(user) && linkedPronote(user) && user.pronoteSyncEnabled !== false && !user.pronoteNeedsReconnect && !this.running.has(user.id) && this.clock() - (user.pronoteLastAttempt || 0) >= 10 * 60000) await this.sync(user).catch(() => {}); }
  canServe(user, section) { return linkedPronote(user) && user.pronoteSnapshot?.sections?.[section]?.state === 'available'; }
  section(user, section, query = {}) {
    if (!this.canServe(user, section)) throw new PublicError('Cette rubrique n’est pas fournie par votre connexion Pronote.', 409);
    const snapshot = user.pronoteSnapshot, source = snapshot.sections[section], base = {section, source: 'Pronote', fetchedAt: source.fetchedAt, warning: user.pronoteError || source.warning || null, offset: 0, hasMore: false};
    if (section === 'grades') {
      const today = parisDate(new Date(this.clock())), periods = snapshot.periods, period = query.period ? periods.find(item => item.id === query.period) : periods.find(item => item.start?.slice(0, 10) <= today && item.end?.slice(0, 10) >= today) || periods[0];
      if (query.period && !period) throw new PublicError('Cette période n’appartient pas à votre élève.');
      const data = source.data.find(item => item.period === period?.id), subjects = new Map();
      for (const grade of data?.grades || []) { const key = normalizeLabel(grade.subject); if (!subjects.has(key)) subjects.set(key, {subject: subjectFor({label: grade.subject}, undefined, user.subjectStyles), average: null, classAverage: null, scale: 20, teachers: [], grades: []}); subjects.get(key).grades.push({ref: null, title: text(grade.title), date: grade.date, mark: numeric(grade.mark), scale: numeric(grade.scale), coefficient: numeric(grade.coefficient), classAverage: numeric(grade.classAverage), reason: numeric(grade.mark) === null ? grade.mark : '', comment: '', skills: []}); }
      for (const average of data?.averages || []) { const item = subjects.get(normalizeLabel(average.subject)); if (item) Object.assign(item, {average: numeric(average.mark), classAverage: numeric(average.classAverage), scale: numeric(average.scale)}); }
      return {...base, periods, period: period?.id || '', skills: [], items: [...subjects.values()]};
    }
    if (section === 'reports') return {...base, items: [], reports: source.data};
    if (section === 'attendance') return {...base, items: source.data.map(item => ({ref: null, start: item.start, end: item.end, type: item.type, status: item.justified ? 'JUSTIFIED' : 'NOT_JUSTIFIED', reason: item.reasons?.join(' · ') || '', comment: item.minutes ? item.minutes + ' min' : ''}))};
    return {...base, items: source.data};
  }
  data(user, query = {}) {
    if (!linkedPronote(user)) return {settings: this.publicSettings(user), courses: [], conflicts: []};
    const start = String(query.date || parisDate(new Date(this.clock()))), end = /^\d{4}-\d{2}-\d{2}$/.test(start) && Number.isFinite(Date.parse(start)) ? shiftDate(start, 6) : '';
    if(!end || new Date(start+'T12:00:00Z').toISOString().slice(0,10)!==start || Math.abs(Date.parse(start)-this.clock())>550*86400000)throw new PublicError('Choisissez une semaine valide.');
    const allRows = user.pronoteSnapshot?.sections.courses?.data || [];
    const rows = allRows.filter(item => Number.isFinite(Date.parse(item.start)) && parisDate(new Date(item.start)) >= start && parisDate(new Date(item.start)) <= end), courses = rows.map(item => ({id: digest(user.id + ':pr-course:' + item.id), title: text(item.subject, 120), start: item.start, end: item.end, date: item.start && parisDate(new Date(item.start)), location: text(item.location, 200), cancelled: item.cancelled === true, memo: plainText(item.memo), test: item.test === true, subject: subjectFor({label: item.subject}, undefined, user.subjectStyles)}));
    const conflicts = [];
    for (const item of courses) {
      const matches = Object.values(user.calendarEvents || {}).filter(ent => ent.date === item.date && normalizeLabel(ent.subject?.label || ent.rawTitle) === normalizeLabel(item.title));
      const exact = matches.find(ent => Date.parse(ent.start) === Date.parse(item.start) && Date.parse(ent.end) === Date.parse(item.end));
      if (exact && (normalizeLabel(exact.location) !== normalizeLabel(item.location) || exact.cancelled !== item.cancelled)) conflicts.push({date: item.date, title: item.title, ent: {start: exact.start, location: exact.location, cancelled: exact.cancelled}, pronote: {start: item.start, location: item.location, cancelled: item.cancelled}});
      else if (!exact && matches.length === 1) conflicts.push({date: item.date, title: item.title, ent: {start: matches[0].start, location: matches[0].location, cancelled: matches[0].cancelled}, pronote: {start: item.start, location: item.location, cancelled: item.cancelled}, uncertainMatch: true});
    }
    return {settings: this.publicSettings(user), courses: courses.sort((a, b) => a.start.localeCompare(b.start)), conflicts: conflicts.slice(0, 50), window: user.pronoteSnapshot?.window, agendaSource: 'ENT', viewStart: start, viewEnd: end, publishedCourses: allRows.length};
  }
}
export function installPronoteRoutes(router, {auth, store, audit, clock, rateLimit, ...options}) {
  const service = new PronoteService(store, {audit, clock, ...options});
  router.get('/api/pronote', auth, (req, res) => res.json(service.publicSettings(req.user)));
  router.get('/api/pronote/data', auth, (req, res) => res.json(service.data(req.user, req.query)));
  router.post('/api/pronote/connect', auth, async (req, res) => { rateLimit(req, 'pronote-connect:' + req.user.id, 6, 15 * 60000); res.json(await service.connect(req.user, req.body)); });
  router.post('/api/pronote/cancel', auth, (req, res) => { if(service.running.has(req.user.id)) throw new PublicError('Attendez la fin de la connexion Pronote.',409); store.update(req.user.id,{pendingPronote:null,pendingPronoteId:null,pendingPronoteSnapshot:null}); res.json({ok:true}); });
  router.post('/api/pronote/confirm', auth, (req, res) => res.json({settings: service.confirm(req.user, req.body)}));
  router.post('/api/pronote/sync', auth, async (req, res) => { rateLimit(req, 'pronote-sync:' + req.user.id, 12, 3600000); res.json(await service.sync(req.user)); });
  router.post('/api/pronote/settings', auth, (req, res) => { if (typeof req.body.enabled !== 'boolean') throw new PublicError('Choisissez l’état de la synchronisation Pronote.'); store.update(req.user.id, {pronoteSyncEnabled: req.body.enabled}); res.json(service.publicSettings(req.user)); });
  router.post('/api/pronote/disconnect', auth, (req, res) => {
    if (service.running.has(req.user.id)) throw new PublicError('Attendez la fin de la consultation Pronote.', 409);
    store.update(req.user.id, {pronote: null, pronoteConnectionId: null, pronoteBinding: null, pronoteSnapshot: null, pronoteAssignments: [], pronoteError: null, pendingPronote: null, pendingPronoteId: null, pendingPronoteSnapshot: null, personalVersion: clock()});
    if (req.user.cachedICS) rebuildCalendar(store, req.user.id, clock()); audit?.record('pronote.disconnected', {source: 'security', userId: req.user.id}); res.json({ok: true});
  });
  return service;
}
