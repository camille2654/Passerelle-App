import {publicProviders,publicProvider} from './ent-providers.js';
import {startEntPronote,resolveEntConnection} from './ent-pronote-browser.js';
import {isEntPronote} from './ent-profile.js';
import {installSystemStatusRoutes} from './system-status.js';
import {addManualWork} from './manual-work.js';
import {installIncomingRoutes} from './incoming.js';
import {installResourceRoutes} from './work-resources.js';
import {installTravelRoutes} from './travel.js';
import {installSmartTravelRoutes} from './smart-travel.js';
import {installPartnerOAuthRoutes} from './partner-oauth.js';
import {installManagedENTRoutes} from './managed-ent.js';
import {syncPolicy,syncInterval} from './sync-policy.js';
import {installPersonalCalendarRoutes} from './personal-calendar.js';
import {installPasskeyRoutes} from './passkeys.js';
import {installPersonalMailRoutes} from './personal-mail.js';
import {installEventSuggestionRoutes} from './event-suggestions.js';
import express from 'express';
import {homeContext} from './home.js';
import {initializeOnboarding,publicOnboarding,installOnboardingRoutes} from './onboarding.js';
import {publicRelease,installReleaseRoutes} from './releases.js';
import {installCaptureRoutes} from './capture.js';
import {installFavoriteRoutes} from './favorites.js';
import {installPushRoutes,detachPushSession} from './push.js';
import {installAdminControl} from './admin-control.js';
import {listenAdminSocket} from './admin-socket.js';
import {accountActive,maintenanceState,publicOperations} from './operational-state.js';
import {installHubRoutes} from './hub.js';
import {installDiscoveryRoutes} from './discovery.js';
import {installPronoteRoutes} from './pronote.js';
import helmet from 'helmet';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Store, random, digest, passwordHash, passwordMatches } from './store.js';
import { PublicError, SyncEngine, INTERVAL, dateWindow } from './sync.js';
import { LoginBrowsers, searchSchools } from './skolengo.js';
import { Skolengo } from 'scolengo-api';
import { PALETTE, EMOJIS } from './subjects.js';
import { userWork, subjectList, buildBrief, shiftDate, parisDate } from './work.js';
import { rebuildCalendar, combinedEvents, upgradeCalendarFeeds } from './calendar.js';
import { renderCalendar } from './ical.js';
import { MailEngine, MailError, detectSMTP } from './mail.js';
import { AuditLog } from './audit.js';
import { installPlannerRoutes } from './planner.js';
import { installSchoolRoutes } from './school.js';
import { installMenuRoutes } from './menu.js';
import {installPersonalRoutes,personalSettings} from './personal.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '4.26.6';
export function createApp({ dataDir = process.env.AGENDA_DATA_DIR || path.join(root, 'data'), baseURL = process.env.AGENDA_BASE_URL || 'http://127.0.0.1:8020/agenda', bootstrap = true, clock = () => Date.now(), syncOptions = {}, mailOptions = {}, auditOptions = {}, plannerOptions = {}, schoolOptions = {}, menuOptions = {}, pronoteOptions = {}, controlOptions = {}, pushOptions = {}, captureOptions = {}, favoriteOptions = {}, personalMailOptions = {}, passkeyOptions = {}, personalCalendarOptions = {}, travelOptions = {}, smartTravelOptions = {}, managedOptions = {}, resourceOptions = {}, incomingOptions = {} } = {}) {
  baseURL = baseURL.replace(/\/$/, '');
  const parsed = new URL(baseURL), basePath = parsed.pathname.replace(/\/$/, '');
  const secure = parsed.protocol === 'https:';
  const store = new Store(dataDir), audit = new AuditLog(store, { clock, ...auditOptions }), engine = new SyncEngine(store, { clock, audit, ...syncOptions }), browsers = new LoginBrowsers(store);
  browsers.onDiagnostic=(user,meta)=>audit.record('pronote.login.step',{source:'security',userId:user.id,meta:{errorCode:meta.code,method:meta.method,...(Number.isInteger(meta.count)?{count:meta.count}:{}),...(['policy','navigation-fetch','navigation-response','bootstrap','handoff','asset'].includes(meta.stage)?{mode:meta.stage}:{})}});
  upgradeCalendarFeeds(store,clock());
  const mailer = new MailEngine(store, baseURL, { clock, audit, syncUser: id => engine.run(id), ...mailOptions });
  const app = express(), router = express.Router(), attempts = new Map(), schools = new Map();
  app.disable('x-powered-by'); app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    const started = performance.now(); req.requestId = randomUUID(); res.set('X-Request-ID', req.requestId);
    res.on('finish', () => {
      const route = typeof req.route?.path === 'string' ? req.route.path : '/unknown';
      if (req.method === 'GET' && res.statusCode < 400 && ['/api/admin/users', '/api/admin/overview', '/api/admin/logs', '/api/admin/mail'].includes(route)) return;
      if (res.statusCode < 400 && (['/health', '/api/status', '/api/system-status', '/api/skolengo/frame', '/api/skolengo/status'].includes(route) || (!route.startsWith('/api/') && !route.startsWith('/calendars/')))) return;
      const feed = route === '/calendars/:token.ics';
      audit.record(feed ? 'feed.read' : 'http.request', { source: feed ? 'feed' : res.statusCode === 401 || res.statusCode === 403 || res.statusCode === 429 ? 'security' : route.startsWith('/api/admin/') ? 'admin' : 'http', level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info', actorId: req.user?.id, userId: req.auditUserId || req.user?.id, meta: { requestId: req.requestId, method: req.method, route, status: res.statusCode, durationMs: Math.round(performance.now() - started), peer: audit.peer(req.ip || 'unknown') } });
    });
    next();
  });
  app.use(helmet({ contentSecurityPolicy: { directives: { upgradeInsecureRequests: secure ? [] : null, defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], imgSrc: ["'self'", 'blob:', 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'blob:', 'data:'], workerSrc:["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"] } }, hsts: secure ? undefined : false }));
  const json=express.json({limit:'128kb'});
  app.use((req,res,next)=>req.method==='POST'&&req.path===basePath+'/share'?next():json(req,res,next));
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use((req, res, next) => {
    if (['POST', 'PATCH', 'DELETE', 'PUT'].includes(req.method) && !req.path.startsWith('/api/managed-ent/') && !(req.method==='POST'&&['/share','/oauth/token'].includes(req.path)) && req.get('origin') !== parsed.origin) return res.status(403).json({ error: 'Origine de la requête refusée.' });
    const cookies = (req.headers.cookie || '').split(';').map(c => c.trim().split('='));
    const token = cookies.find(c => c[0] === 'agenda_session')?.[1];
    const session = token && store.state.sessions.find(s => s.hash === digest(token) && s.expires > Date.now());
    req.user = session ? store.user(session.userId) : null;
    if(req.user && !accountActive(req.user))req.user=null;
    req.session = session;
    if(req.user && Date.now()-(session.lastSeenAtReal||0)>5*60000){session.lastSeenAt=clock();session.lastSeenAtReal=Date.now();session.device=/mobile|android|iphone/i.test(req.get('user-agent')||'')?'mobile':'desktop';req.user.lastSeenAt=clock();store.save();}
    next();
  });
  const auth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'Connectez-vous pour continuer.' });
  const admin = (req, res, next) => req.user?.admin ? next() : res.status(403).json({ error: 'Accès administrateur requis.' });
  let school, pronote, eventSuggestions, personalMail, passkeys, resources, cloud, incoming, personalCalendars, travel, smartTravel;
  const idle = (req, res, next) => engine.running.has(req.user.id) || school?.busy(req.user.id) || pronote?.running.has(req.user.id) ? res.status(409).json({ error: 'Attendez la fin de la consultation de votre établissement.' }) : next();
  function rateLimit(req, key, limit, period) {
    const now = Date.now(), id = key + ':' + req.ip;
    if (!attempts.has(id) && attempts.size >= 5000) {
      for (const [entry, times] of attempts) if (times.at(-1) < now - 86400000) attempts.delete(entry);
      if (attempts.size >= 5000) throw new PublicError('Le portail reçoit beaucoup de demandes. Réessayez dans quelques minutes.', 429);
    }
    const items = (attempts.get(id) || []).filter(t => t > now - period).slice(-limit);
    items.push(now); attempts.set(id, items);
    if (items.length > limit) throw new PublicError('Trop de tentatives. Réessayez dans quelques minutes.', 429);
  }
  function login(res, user) {
    const token = random();
    store.state.sessions.push({ hash: digest(token), userId: user.id, createdAt:clock(), lastSeenAt:clock(), expires: Date.now() + 7 * 86400000 }); store.save();
    res.cookie('agenda_session', token, { httpOnly: true, secure, sameSite: 'lax', path: basePath || '/', maxAge: 7 * 86400000 });
  }
  function safeUser(u) {
    if (!u) return null;
    const resourceRows=resources?.list(u).items||[];
    const keys = ['id', 'name', 'login', 'admin', 'schoolName', 'students', 'studentId', 'enabled', 'lastSync', 'lastAttempt', 'lastError', 'skolengoError', 'history', 'events', 'total', 'calendarWindow', 'homeworkWarning', 'homeworkAvailable', 'workLastSync', 'changes', 'reminderMinutes', 'friendshipVersion','personalVersion'];
    return { ...Object.fromEntries(keys.map(k => [k, u[k]])), entProvider:u.skolengo?(isEntPronote(store,u)?{id:store.open(u.skolengo).school.emsCode,label:'ENT → PRONOTE',family:'ent-pronote'}:publicProvider(store.open(u.skolengo).school)):null,syncPolicy:syncPolicy(u,clock()),release:publicRelease(u),smartTravel:smartTravel?.summary(u,travel?.settings(u).enabled),personalMailVersion:u.personalMailVersion||0,eventSuggestions:eventSuggestions?.summary(u),onboarding:publicOnboarding(u),home:homeContext(u,clock()),personalSettings:personalSettings(u), pronote: pronote?.publicSettings(u), support: u.admin ? {pending: (store.state.supportTickets || []).filter(t => t.status !== 'resolved').length} : {unread: (store.state.supportTickets || []).filter(t => t.userId === u.id && t.replies.some(r => r.at > (u.supportReadAt || 0))).length}, skolengoConnected: !!u.skolengo, syncing: engine.running.has(u.id), feedURL: u.feedKey ? baseURL + "/calendars/" + store.open(u.feedKey) + ".ics" : null, subjects: subjectList(u), work: userWork(u).filter(w => w.due >= shiftDate(parisDate(new Date(clock())), -14)).slice(0, 200).map(w=>({...w,resources:resourceRows.filter(row=>row.workId===w.id)})), email: mailer.publicSettings(u), today: {date:parisDate(new Date(clock())),courses:Object.values(u.calendarEvents||{}).filter(event=>event.date===parisDate(new Date(clock()))).sort((a,b)=>a.start.localeCompare(b.start))}, brief: buildBrief(u, new Date(clock())) };
  }
  function addInvite(admin = false) {
    const token = random();
    store.state.invites.push({ hash: digest(token), admin, expires: Date.now() + 7 * 86400000 }); store.save();
    return baseURL + '/#invitation=' + token;
  }
  if (bootstrap && !store.state.users.some(u => u.admin) && !store.state.invites.some(i => i.admin && i.expires > Date.now())) {
    fs.writeFileSync(path.join(dataDir, 'admin-invitation.txt'), addInvite(true) + '\n', { mode: 0o600 });
  }
  const registrationOpen = () => store.state.settings.publicRegistration !== false && !maintenanceState(store.state.settings,clock()).enabled;
  router.get('/api/status', (req, res) => res.json({ user: safeUser(req.user), baseURL, interval: req.user?syncInterval(req.user,clock()):INTERVAL, version: VERSION, schoolYear: dateWindow(new Date(clock())), palette: PALETTE, emojis: EMOJIS, mailReady: mailer.ready, registrationOpen: registrationOpen(), billingEnabled: false, operations:publicOperations(store.state.settings,clock()),adminSession:req.user?.admin?{elevatedUntil:req.session.adminElevatedUntil||0,version:store.state.settings.adminVersion||0}:null }));
  router.post('/api/invitation/check', (req, res) => {
    rateLimit(req, 'invite', 30, 60000);
    const token = String(req.body.token || '');
    const invitation = store.state.invites.find(i => i.hash === digest(token) && i.expires > Date.now());
    if (!invitation) throw new PublicError('Cette invitation a expiré ou a déjà été utilisée.', 404);
    res.json({ valid: true, admin: invitation.admin });
  });
  router.post('/api/register', (req, res) => {
    rateLimit(req, 'register', 10, 15 * 60000);
    const token = String(req.body.token || '');
    const invitation = token ? store.state.invites.find(i => i.hash === digest(token) && i.expires > Date.now()) : null;
    if (token && !invitation) throw new PublicError('Cette invitation a expiré ou a déjà été utilisée.', 404);
    if (!invitation && !registrationOpen()) throw new PublicError('Les inscriptions publiques sont momentanément fermées. Vous pouvez utiliser une invitation ou vous connecter à votre compte.', 403);
    if (req.body.companyWebsite) throw new PublicError('L’inscription n’a pas pu être validée. Réessayez sans remplir le champ de vérification.');
    const name = String(req.body.name || '').trim().slice(0, 80), username = String(req.body.login || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    if (!name || !/^[a-z0-9._@+-]{3,100}$/.test(username) || password.length < 12 || password.length > 256) throw new PublicError('Indiquez un prénom, un identifiant valide et un mot de passe de 12 caractères minimum.');
    if (store.state.users.some(u => u.login === username)) throw new PublicError('Cet identifiant est déjà utilisé.', 409);
    const user = { id: randomUUID(), name, login: username, password: passwordHash(password), admin: invitation?.admin === true, enabled: false, history: [], createdAt: Date.now(), registrationSource: invitation ? 'invitation' : 'public', onboarding:initializeOnboarding(clock()) };
    store.state.users.push(user); store.state.invites = store.state.invites.filter(i => i !== invitation); store.save();
    if (user.admin) fs.rmSync(path.join(dataDir, 'admin-invitation.txt'), { force: true });
    login(res, user); req.auditUserId = user.id; audit.record('security.registered', { source: 'security', userId: user.id, meta: { mode: user.registrationSource } }); res.json({ ok: true });
  });
  router.post('/api/login', (req, res) => {
    rateLimit(req, 'login', 12, 15 * 60000);
    const username = String(req.body.login || '').trim().toLowerCase(), password = String(req.body.password || '');
    if (password.length > 256) throw new PublicError('Identifiant ou mot de passe incorrect.', 401);
    const user = store.state.users.find(u => u.login === username);
    // Run the same expensive hash for unknown accounts.
    const match = passwordMatches(password, user?.password || dummyHash);
    if (!user || !match) throw new PublicError('Identifiant ou mot de passe incorrect.', 401);
    if(!accountActive(user))throw new PublicError('Ce compte est suspendu ou archivé. Contactez l’administration de Passerelle.',403);
    login(res, user); req.auditUserId = user.id; audit.record('security.login', { source: 'security', userId: user.id }); res.json({ ok: true });
  });
  router.post('/api/logout', auth, async (req, res) => {
    detachPushSession(store,req.user,req.session.hash);incoming?.detach(req.session.hash);
    store.state.sessions = store.state.sessions.filter(s => s !== req.session);
    store.save();
    audit.record('security.logout', { source: 'security', userId: req.user.id });
    await browsers.stop(req.user.id);
    res.clearCookie('agenda_session', { path: basePath || '/', secure, httpOnly: true, sameSite: 'lax' }); res.json({ ok: true });
  });
  router.post('/api/admin/invitations', auth, admin, (req, res) => { const url = addInvite(); audit.record('admin.invited', { source: 'admin', actorId: req.user.id }); res.json({ url }); });
  router.post('/api/admin/registration', auth, admin, (req, res) => {
    if (typeof req.body.enabled !== 'boolean') throw new PublicError('Choisissez si les inscriptions doivent être ouvertes.');
    store.state.settings.publicRegistration = req.body.enabled; store.save();
    audit.record('admin.registration', { source: 'admin', actorId: req.user.id, meta: { enabled: req.body.enabled } });
    res.json({ registrationOpen: registrationOpen() });
  });
  router.get('/api/admin/users', auth, admin, (req, res) => res.json({ users: store.state.users.map(u => ({ id: u.id, name: u.name, login: u.login, enabled: !!u.enabled, feedActive: !!u.feedKey, personalSettings:personalSettings(u), skolengoConnected: !!u.skolengo, pronoteConnected: !!u.pronote, pronoteError: u.pronoteError || null, lastSync: u.lastSync, lastError: u.lastError, homeworkWarning: u.homeworkWarning, email: mailer.publicSettings(u) })) }));
  const targetUser = req => { const user = store.user(req.params.id); if (!user) throw new PublicError('Compte introuvable.', 404); req.auditUserId = user.id; return user; };
  router.post('/api/admin/users/:id/email', auth, admin, async (req, res) => {
    rateLimit(req, 'admin-email-assignment', 30, 3600000); const user = targetUser(req);
    await mailer.assignAddress(user, req.body, req.user.id);
    const confirmationSent = req.body.sendConfirmation === true ? (await mailer.requestVerification(user, req.user.id)).needsVerification : false;
    res.json({ ok: true, confirmationSent, email: mailer.publicSettings(user) });
  });
  router.post('/api/admin/users/:id/email/confirm', auth, admin, async (req, res) => {
    rateLimit(req, 'admin-email-confirmation', 15, 3600000); const user = targetUser(req);
    res.json(await mailer.requestVerification(user, req.user.id));
  });
  router.post('/api/admin/users/:id/email/pause', auth, admin, (req, res) => {
    const user = targetUser(req); if (!user.emailConfig) throw new PublicError('Aucune adresse associée.', 409);
    store.update(user.id, { emailConfig: { ...user.emailConfig, enabled: false, wantedEnabled: false, alertsEnabled: false, wantedAlertsEnabled: false }, emailAlertQueue: [] });
    audit.record('mail.unsubscribed', { source: 'admin', actorId: req.user.id, userId: user.id }); res.json({ ok: true });
  });
  router.post('/api/admin/users/:id/email/remove', auth, admin, (req, res) => {
    const user = targetUser(req); store.update(user.id, { emailConfig: null, emailVerification: null, emailAlertQueue: [] });
    audit.record('mail.removed', { source: 'admin', actorId: req.user.id, userId: user.id }); res.json({ ok: true });
  });
  router.post('/api/admin/users/:id/sync', auth, admin, async (req, res) => {
    rateLimit(req, 'admin-sync', 12, 600000); res.json(await engine.run(targetUser(req).id));
  });
  router.get('/api/admin/overview', auth, admin, (req, res) => res.json({ ...audit.overview(), mailReady: mailer.ready, users: store.state.users.length, active: store.state.users.filter(u => u.enabled).length, verifiedEmails: store.state.users.filter(u => u.emailConfig?.verified).length, subscribers: store.state.users.filter(u => u.emailConfig?.enabled).length, issues: store.state.users.filter(u => u.lastError || u.homeworkWarning || u.pronoteError || (u.enabled && Date.now() - (u.lastSync || 0) > 30 * 60000)).length }));
  router.get('/api/admin/logs', auth, admin, (req, res) => res.json(audit.query(req.query)));
  router.post('/api/admin/logs/verify', auth, admin, (req, res) => {
    rateLimit(req, 'audit-verify', 12, 3600000); audit.integrity = audit.verify();
    audit.record('admin.integrity', { source: 'admin', actorId: req.user.id, level: audit.integrity.ok ? 'info' : 'error', meta: { verified: audit.integrity.ok, count: audit.integrity.count } }); res.json(audit.integrity);
  });
  router.get('/api/admin/logs/export', auth, admin, (req, res) => {
    rateLimit(req, 'audit-export', 12, 3600000); const rows = [];
    for (let offset = 0; offset < 5000; offset += 200) { const page = audit.query({ ...req.query, offset, limit: 200 }); rows.push(...page.rows); if (rows.length >= page.total) break; }
    audit.record('admin.exported', { source: 'admin', actorId: req.user.id, meta: { count: rows.length } });
    res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Content-Disposition': 'attachment; filename="passerelle-journal.jsonl"' }).send(rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  });
  router.get('/api/ent/providers',auth,(_req,res)=>res.json({providers:publicProviders(),coverage:'skolengo-national-and-ent-pronote',pronoteHostedOnly:true}));
  router.get('/api/skolengo/schools', auth, async (req, res) => {
    rateLimit(req, 'school-search', 25, 60000);
    const q = String(req.query.q || '').trim();
    if (q.length < 3 || q.length > 100) throw new PublicError('Saisissez au moins 3 caractères pour rechercher un établissement.');
    const provider=String(req.query.provider||'');
    if(provider&&!publicProviders().some(p=>p.id===provider&&p.family==='skolengo'))throw new PublicError('Choisissez un ENT proposé.');
    const results = await searchSchools(q,provider);
    for (const s of results) schools.set(s.id, { school: s, expires: Date.now() + 15 * 60000 });
    res.json({ schools: results.map(s => ({ id: s.id, name: s.name, city: s.city, zipCode: s.zipCode,provider:publicProvider(s) })) });
  });
  router.post('/api/skolengo/start', auth, idle, async (req, res) => {
    rateLimit(req, 'school-login', 8, 60000);
    const item = schools.get(String(req.body.schoolId));
    if (!item || item.expires < Date.now()) throw new PublicError('Recherchez à nouveau votre établissement.');
    store.update(req.user.id, { enabled: false });
    res.json(await browsers.start(req.user, item.school));
  });
  async function startWebENT(req, res, complement=false) {
    rateLimit(req,'ent-web-login:'+req.user.id,6,15*60000);
    if(engine.running.has(req.user.id)||pronote.running.has(req.user.id))throw new PublicError('Attendez la fin de la synchronisation avant de vous connecter.',409);
    if(!req.body||typeof req.body!=='object'||Array.isArray(req.body))throw new PublicError('Rechargez Passerelle puis utilisez son formulaire de connexion ENT.');
    if(req.body.accountPin!==undefined&&(typeof req.body.accountPin!=='string'||req.body.accountPin.length>128))throw new PublicError('Le code de sécurité PRONOTE est invalide.');
    const accountPin=req.body.accountPin||'';
    const config=req.user.skolengo?store.open(req.user.skolengo):null;
    const {portal:selected,entryURL}=resolveEntConnection(req.body.portalURL,config?.school);
    const portalURL=selected.url;
    const primary=!complement||!req.user.skolengo||isEntPronote(store,req.user);
    res.json(await startEntPronote(browsers,req.user,portalURL,{preferred:selected.provider.id,entryURL,onCapture:async(capture,portal)=>{
      const isCurrent=()=>browsers.items.get(req.user.id)?.context===context&&store.user(req.user.id)===req.user&&accountActive(req.user)&&store.state.sessions.some(s=>s.hash===req.session.hash&&s.expires>Date.now());
      const context=browsers.items.get(req.user.id)?.context;
      if(!isCurrent())throw new PublicError('Cette connexion a expiré.',409);
      await pronote.connectENT(req.user,capture,portal,{primary,isCurrent,accountPin});
    }}));
  }
  router.post('/api/ent/start',auth,idle,(req,res)=>startWebENT(req,res));
  router.post('/api/pronote/ent/start',auth,idle,(req,res)=>startWebENT(req,res,true));
  router.get('/api/skolengo/status', auth, (req, res) => res.json(browsers.status(req.user.id)));
  router.get('/api/skolengo/frame', auth, async (req, res) => {
    const frame = await browsers.frame(req.user.id);
    if (!frame) return res.status(204).end();
    res.type('jpeg').send(frame);
  });
  router.post('/api/skolengo/input', auth, async (req, res) => { await browsers.input(req.user.id, req.body); res.json({ ok: true }); });
  router.post('/api/skolengo/stop', auth, async (req, res) => { await browsers.stop(req.user.id); res.json({ ok: true }); });
  const clearFeed = { eventSuggestionsState:null,eventSuggestionsScope:null,eventSuggestionsSeq:0,eventNoticeQueue:[],schoolEventCalendar:{}, feedKey: null, feedHash: null, cachedICS: null, feedETag: null, feedModifiedAt: null, calendarEvents: {}, taskCalendar: {}, assignments: [], manualWork: [], workOverrides: {}, changes: [], activityLog: [], activitySeq: 0, lastAgendaVisit: null, searchNews: [], searchNewsInitialized: false, homeworkWarning: null, workLastSync: null, events: [], total: 0, lastSync: null, bagChecks: {}, studySessions: [], emailAlertQueue: [] };
  function issueFeed(user) {
    const token = random();
    store.update(user.id, { feedKey: store.seal(token), feedHash: digest(token) });
  }
  router.post('/api/student', auth, idle, (req, res) => {
    if (!req.user.students?.some(s => s.id === req.body.studentId)) throw new PublicError('Cet élève n’est pas associé à votre compte.');
    if (req.user.studentId !== req.body.studentId) store.update(req.user.id, { ...clearFeed, studentId: req.body.studentId, enabled: false, lastAttempt: null, lastError: null });
    res.json({ ok: true });
  });
  router.post('/api/sync', auth, idle, async (req, res) => res.json(await engine.run(req.user.id)));
  router.post('/api/feed/create', auth, idle, async (req, res) => {
    if (!req.user.skolengo || req.user.skolengoError) throw new PublicError('Connectez votre ENT avant de créer votre lien ICS.', 409);
    await engine.run(req.user.id);
    if (!req.user.feedKey) issueFeed(req.user);
    store.update(req.user.id, { enabled: true });
    audit.record('feed.created', { source: 'feed', userId: req.user.id });
    res.json({ user: safeUser(req.user) });
  });
  router.post('/api/feed/rotate', auth, idle, (req, res) => {
    if (!req.user.feedKey) throw new PublicError('Créez d’abord votre lien ICS.', 409);
    issueFeed(req.user);
    audit.record('feed.rotated', { source: 'feed', userId: req.user.id });
    res.json({ user: safeUser(req.user) });
  });
  router.post('/api/feed/revoke', auth, idle, (req, res) => {
    store.update(req.user.id, { feedKey: null, feedHash: null, enabled: false });
    audit.record('feed.revoked', { source: 'feed', userId: req.user.id });
    res.json({ ok: true });
  });
  router.post('/api/sync/toggle', auth, idle, async (req, res) => {
    const enabled = req.body.enabled === true;
    if (enabled && (!req.user.skolengo || req.user.skolengoError || !req.user.feedKey)) throw new PublicError('Connectez votre ENT et créez votre lien ICS avant d’activer les mises à jour.', 409);
    store.update(req.user.id, { enabled });
    if (enabled) return res.json({ enabled, result: await engine.run(req.user.id) });
    res.json({ enabled });
  });
  router.post('/api/disconnect/skolengo', auth, idle, async (req, res) => {
    await browsers.stop(req.user.id);
    if (req.user.skolengo) {
      const config = store.open(req.user.skolengo);
      try { if(config.provider!=='ent-pronote'){const client = await Skolengo.getOIDClient(config.school); await client.revoke(config.tokenSet.refresh_token);} }
      catch { throw new PublicError('L’ENT n’a pas confirmé la révocation. Réessayez dans un instant.', 502); }
    }
    store.update(req.user.id, { ...clearFeed,...(isEntPronote(store,req.user)?{pronote:null,pronoteConnectionId:null,pronoteBinding:null,pronoteSnapshot:null,pronoteAssignments:[],pronoteError:null}:{}),pendingPronote:null,pendingPronoteId:null,pendingPronoteSnapshot:null,pendingEntPrimary:null,entConnectionKind:null,skolengoConnectionId:null,skolengo: null, schoolName: null, students: [], studentId: null, skolengoError: null, enabled: false, lastError: null });
    res.json({ ok: true });
  });
  router.get('/api/brief', auth, (req, res) => res.json({ brief: buildBrief(req.user, new Date(clock())) }));
  router.post('/api/preferences', auth, idle, (req, res) => {
    const reminder = Number(req.body.reminderMinutes);
    if (![0, 5, 10, 15, 30].includes(reminder)) throw new PublicError('Choisissez un rappel valide.');
    if ((req.user.reminderMinutes || 0) !== reminder) { const now = Date.now(); const calendarEvents = Object.fromEntries(Object.entries(req.user.calendarEvents || {}).map(([id, event]) => [id, event.cancelled ? event : { ...event, modified: now, sequence: event.sequence + 1 }])); store.update(req.user.id, { reminderMinutes: reminder, calendarEvents }); } rebuildCalendar(store, req.user.id);
    res.json({ ok: true });
  });
  router.post('/api/subjects/:key', auth, idle, (req, res) => {
    if (!subjectList(req.user).some(subject => subject.key === req.params.key)) throw new PublicError('Matière introuvable.', 404);
    if (!PALETTE.some(c => c.value === req.body.color) || !EMOJIS.includes(req.body.emoji)) throw new PublicError('Choisissez une couleur et un emoji proposés.');
    store.update(req.user.id, { subjectStyles: { ...(req.user.subjectStyles || {}), [req.params.key]: { color: req.body.color, emoji: req.body.emoji } } });
    rebuildCalendar(store, req.user.id); res.json({ ok: true });
  });
  router.post('/api/work', auth, idle, (req, res) => {
    const id=addManualWork(store,req.user,req.body,clock());res.json({ok:true,id});
  });
  router.post('/api/work/:id', auth, idle, (req, res) => {
    const item = userWork(req.user).find(w => w.id === req.params.id);
    if (!item) throw new PublicError('Ce devoir ou contrôle est introuvable.', 404);
    const values = {};
    if (typeof req.body.done === 'boolean') { values.done = req.body.done; values.doneAt = req.body.done ? (item.done && req.user.workOverrides?.[item.id]?.doneAt || clock()) : null; }
    if (['exam', 'homework'].includes(req.body.kind)) values.kind = req.body.kind;
    if (!Object.keys(values).length) throw new PublicError('Modification invalide.');
    store.update(req.user.id, { personalVersion: clock(), insightsSince: req.user.insightsSince || clock(), workOverrides: { ...(req.user.workOverrides || {}), [item.id]: { ...(req.user.workOverrides?.[item.id] || {}), ...values } } });
    rebuildCalendar(store, req.user.id); res.json({ ok: true });
  });
  router.post('/api/work/:id/remove', auth, idle, (req, res) => {
    if (!req.user.manualWork?.some(w => w.id === req.params.id)) throw new PublicError('Seuls les ajouts personnels peuvent être supprimés.', 404);
    store.update(req.user.id, { manualWork: req.user.manualWork.filter(w => w.id !== req.params.id) });
    rebuildCalendar(store, req.user.id); res.json({ ok: true });
  });
  router.get('/api/admin/mail', auth, admin, (req, res) => res.json({ settings: mailer.publicSMTP() }));
  router.post('/api/admin/mail', auth, admin, async (req, res) => {
    rateLimit(req, 'smtp-config', 8, 3600000); await mailer.configure(req.body); res.json({ ok: true });
  });
  router.post('/api/admin/mail/detect', auth, admin, (req, res) => res.json(detectSMTP(req.body.fromEmail)));
  router.post('/api/email/preferences', auth, async (req, res) => {
    rateLimit(req, 'email-preferences', 10, 3600000);
    res.json(await mailer.savePreferences(req.user, req.body));
  });
  router.post('/api/email/verify', (req, res) => {
    rateLimit(req, 'email-verify', 30, 60000); mailer.verifyAddress(req.body.token); res.json({ ok: true });
  });
  router.post('/api/email/unsubscribe', (req, res) => {
    rateLimit(req, 'email-unsubscribe', 30, 60000); mailer.unsubscribe(req.body.token); res.json({ ok: true });
  });
  router.post('/api/email/remove', auth, (req, res) => {
    store.update(req.user.id, { emailConfig: null, emailVerification: null, emailAlertQueue: [] }); audit.record('mail.removed', { source: 'mail', userId: req.user.id, actorId: req.user.id }); res.json({ ok: true });
  });
  router.post('/api/email/test', auth, async (req, res) => {
    rateLimit(req, 'email-test', 5, 3600000); await mailer.sendBrief(req.user, true); res.json({ ok: true });
  });
  // Subscription clients present the private link itself; they do not use a portal cookie.
  router.get('/calendars/:token.ics', (req, res) => {
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return res.status(404).end();
    const hash = digest(token);
    const user = store.state.users.find(u => u.feedHash === hash);
    if (!accountActive(user)) return res.status(404).end();
    req.auditUserId = user.id;
    if (!user.cachedICS || !user.lastSync) return res.status(503).set('Retry-After', '600').end();
    const type = String(req.query.type || 'all'), subjectKey = req.query.subject && String(req.query.subject);
    if (!['all', 'course', 'homework', 'exam'].includes(type)) throw new PublicError('Type d’agenda invalide.');
    if (subjectKey && !/^[a-f0-9]{20}$/.test(subjectKey)) return res.status(404).end();
    // A removed subject still needs a valid empty snapshot to clear its subscription.
    const subject = subjectKey && (subjectList(user).find(s => s.key === subjectKey) || combinedEvents(user).find(e => e.subject?.key === subjectKey)?.subject);
    const filtered = type !== 'all' || subjectKey;
    const name = subject ? subject.emoji + ' ' + subject.label : subjectKey ? 'Matière · Passerelle' : type === 'homework' ? 'Devoirs · Passerelle' : type === 'exam' ? 'Contrôles · Passerelle' : 'Cours · Passerelle';
    const content = filtered ? renderCalendar(combinedEvents(user, { type, subject: subjectKey }), { name, color: subject?.color || (type === 'exam' ? 'crimson' : 'royalblue'), reminder: user.reminderMinutes || 0 }) : user.cachedICS;
    const etag = filtered ? '"' + digest(content) + '"' : user.feedETag;
    res.set({
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="emploi-du-temps.ics"',
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'ETag': etag,
      'Last-Modified': new Date(user.feedModifiedAt).toUTCString(),
      'X-Robots-Tag': 'noindex, nofollow, noarchive'
    });
    const etags = req.get('if-none-match');
    if (etags && etags.split(',').some(v => { const tag = v.trim().startsWith('W/') ? v.trim().slice(2) : v.trim(); return tag === '*' || tag === etag; })) return res.status(304).end();
    if (!etags && req.get('if-modified-since') && Date.parse(req.get('if-modified-since')) >= Math.floor(user.feedModifiedAt / 1000) * 1000) return res.status(304).end();
    res.send(content);
  });
  router.get('/health', (req, res) => res.json({ ok: true }));
  const partners=installPartnerOAuthRoutes(router,{store,auth,admin,rateLimit,baseURL,clock,audit});
  const managedENT=installManagedENTRoutes(router,{store,browsers,auth,admin,rateLimit,baseURL,clock,audit,...managedOptions});
  router.get('/ent-connect/',(_req,res)=>res.type('html').send(fs.readFileSync(path.join(root,'public/managed-ent.html'),'utf8')));
  personalCalendars=installPersonalCalendarRoutes(router,{store,auth,rateLimit,clock,audit,...personalCalendarOptions});
  travel=installTravelRoutes(router,{store,auth,admin,rateLimit,clock,audit,...travelOptions});
  smartTravel=installSmartTravelRoutes(router,{store,auth,admin,rateLimit,clock,audit,...smartTravelOptions});
  installPlannerRoutes(router, { auth, store, rateLimit, baseURL, audit, clock, personalCalendars, ...plannerOptions });
  passkeys=installPasskeyRoutes(router,{store,auth,rateLimit,baseURL,clock,audit,login,...passkeyOptions});
  installOnboardingRoutes(router,{auth,store,rateLimit,clock});
  installReleaseRoutes(router,{auth,store,rateLimit,clock});
  installPersonalRoutes(router,{auth,store,rateLimit,audit,clock});
  pronote = installPronoteRoutes(router, {auth, store, audit, clock, rateLimit, ...pronoteOptions});
  school = installSchoolRoutes(router, { auth, store, rateLimit, audit, clock, complement: pronote, ...(syncOptions.clientFactory ? { clientFactory: syncOptions.clientFactory } : {}), ...schoolOptions });
  personalMail=installPersonalMailRoutes(router,{store,auth,admin,rateLimit,baseURL,clock,audit,onDisconnect:(user,connection)=>eventSuggestions?.purgePersonal(user,connection),...personalMailOptions});
  eventSuggestions=installEventSuggestionRoutes(router,{store,school,auth,rateLimit,clock,audit,personalMail,sourceBusy:id=>engine.running.has(id)||school.busy(id)});
  const menu = installMenuRoutes(router, { auth, school, rateLimit, clock, ...menuOptions });
  const capture=installCaptureRoutes(router,{store,auth,rateLimit,clock,audit,...captureOptions});
  const favorites=installFavoriteRoutes(router,{store,school,auth,rateLimit,clock,audit,...favoriteOptions});
  ({resources,cloud}=installResourceRoutes(router,{store,favorites,personalMail,auth,rateLimit,clock,audit,baseURL,incoming:()=>incoming,...resourceOptions}));
  const discovery=installDiscoveryRoutes(router,{auth,store,favorites,resources,rateLimit,clock});
  installHubRoutes(router,{auth,admin,store,school,rateLimit,audit,clock,version:VERSION,discovery});
  incoming=installIncomingRoutes(router,{store,favorites,resources,auth,rateLimit,baseURL,clock,audit,...incomingOptions});
  const push=installPushRoutes(router,{store,auth,rateLimit,baseURL,audit,clock,...pushOptions});
  const control=installAdminControl(router,{auth,admin,store,engine,mailer,browsers,school,menu,pronote,audit,baseURL,rateLimit,clock,version:VERSION,...controlOptions});
  const systemStatus=installSystemStatusRoutes(router,{store,mailer,push,clock,version:VERSION,rateLimit});
  router.get('/status',(req,res,next)=>req.path.endsWith('/')?next():res.redirect(308,basePath+'/status/'));
  // Installation metadata must point at this app, even on a shared origin.
  const documentBase = parsed.origin + basePath + '/';
  const indexHTML = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8').replace(/(<link\b[^>]*\brel="(?:manifest|apple-touch-icon|icon)"[^>]*\bhref=")\.\/([^"]+)(")/g,
    (_match, before, resource, after) => before + new URL(resource, documentBase).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;') + after);
  const appleIcon = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'public/apple-touch-icon.png')).toString('base64');
  const installHTML = indexHTML.replace(/(<link\b[^>]*\brel="apple-touch-icon"[^>]*\bhref=")[^"]+(")/, (_match, before, after) => before + appleIcon + after);
  router.get(['/', '/index.html'], (_req, res) => res.type('html').send(installHTML));
  const publicIconFiles = new Set(['apple-touch-icon.png', 'icons/apple-180.png', 'icons/app-192.png', 'icons/app-512.png', 'icons/favicon-64.png']);
  router.use(express.static(path.join(root, 'public'), { index: 'index.html', cacheControl: false, etag: false, setHeaders(res, file) {
    // These files are identical for everyone; personal responses keep no-store.
    if (publicIconFiles.has(path.relative(path.join(root, 'public'), file).split(path.sep).join('/'))) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
    }
  } }));
  router.use((req, res) => res.status(404).json({ error: 'Page introuvable.', code: 'ROUTE_NOT_FOUND', version: VERSION }));
  app.get(basePath || '/', (req, res, next) => basePath && !req.path.endsWith('/') ? res.redirect(308, basePath + '/') : next());
  app.use(basePath || '/', router);
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const known = { BROWSER_BUSY: 'Une connexion ENT est en cours d’ouverture ou les deux places sont occupées. Réessayez dans un instant.', ENT_UNAVAILABLE: 'Le portail ENT n’est pas disponible pour le moment.', LOGIN_CLOSED: 'Cette fenêtre de connexion a expiré. Relancez la connexion.', INVALID_INPUT: 'Commande invalide.' };
    const message = error instanceof PublicError || error instanceof MailError ? error.message : known[error.message] || (error.type === 'entity.parse.failed' ? 'La requête est invalide.' : 'Cette opération a échoué. Réessayez dans un instant.');
    res.status(error instanceof PublicError || error instanceof MailError ? error.status : 400).json({ error: message, ...(error instanceof PublicError && /^[A-Z_]{1,50}$/.test(error.code||'')?{code:error.code}:{}) });
  });
  return { app, store, engine, browsers, mailer, audit, school, menu, pronote, capture, favorites, push, eventSuggestions, personalMail, passkeys, resources, cloud, incoming, personalCalendars, travel, smartTravel, partners, managedENT, control, systemStatus, baseURL };
}
const dummyHash = passwordHash('invalid-account-password');
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.umask(0o077);
  const { app, engine, browsers, mailer, audit, pronote, push, eventSuggestions, personalMail, passkeys, resources, cloud, incoming, personalCalendars, travel, smartTravel, partners, managedENT, control, systemStatus, baseURL } = createApp();
  await mailer.configureEnvironment().catch(() => {});
  const adminSocket=await listenAdminSocket(control);
  audit.record('system.started', { meta: { mailReady: mailer.ready } });
  const server = app.listen(Number(process.env.AGENDA_PORT || 8020), '127.0.0.1', () => console.log('Agenda Bridge disponible : ' + baseURL + '/'));
  const timer = setInterval(() => { void systemStatus.track('ent',()=>engine.tick()).catch(() => {}); }, 15000);
  timer.unref();
  void systemStatus.track('ent',()=>engine.tick()).catch(() => {});
  const pronoteTimer = setInterval(() => { void systemStatus.track('pronote',()=>pronote.tick()).catch(() => {}); }, 15000); pronoteTimer.unref();
  const mailTimer = setInterval(() => { void systemStatus.track('mail',()=>mailer.tick()).catch(() => {}); }, 15000); mailTimer.unref();
  const eventTimer=setInterval(()=>void eventSuggestions.tick().catch(()=>{}),15000);eventTimer.unref();
  const calendarTimer=setInterval(()=>void personalCalendars.tick().catch(()=>{}),60000);calendarTimer.unref();
  const pushTimer=setInterval(()=>void systemStatus.track('push',()=>push.tick()).catch(()=>{}),15000);pushTimer.unref();
  const cleanup = setInterval(() => {
    // Active sessions and login windows are kept only as long as needed.
    engine.store.prune();
  }, 60000); cleanup.unref();
  const managedTimer=setInterval(()=>void systemStatus.track('managed',()=>managedENT.tick()).catch(()=>{}),15000);managedTimer.unref();
  const statusTimer=setInterval(()=>systemStatus.snapshot(),30000);statusTimer.unref();systemStatus.snapshot();
  for (const signal of ['SIGTERM','SIGINT']) process.on(signal,()=>{clearInterval(statusTimer);partners.close();managedENT.close();clearInterval(managedTimer);});
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { audit.record('system.stopped'); control.close(); push.close(); eventSuggestions.close(); personalMail.close(); passkeys.close(); cloud.close();incoming.close();personalCalendars.close();travel.close();smartTravel.close();clearInterval(calendarTimer); await adminSocket.close(); clearInterval(timer); clearInterval(cleanup); clearInterval(mailTimer); clearInterval(pronoteTimer); clearInterval(pushTimer); clearInterval(eventTimer); await browsers.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 8000).unref(); });
}
