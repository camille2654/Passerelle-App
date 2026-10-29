import { digest } from './store.js';
import {newsPatch} from './activity.js';
import { skolengoClient, withSkolengo } from './skolengo.js';
import { plainText, parisDate, shiftDate } from './work.js';
import { subjectFor } from './subjects.js';
import { PublicError } from './sync.js';
import {declaredCapabilities,emptyCapabilities,featureLabels,unsupportedSource} from './capabilities.js';

const LIMIT = 20, TTL = 5 * 60000, MAX_FILE = 15 * 1024 * 1024;
const sections = new Set(['grades', 'reports', 'attendance', 'messages', 'news', 'notebook', 'profile']);
const text = (value, length = 1000) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, length);
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const list = value => { if (!Array.isArray(value)) throw new Error('INVALID_SOURCE_DATA'); return value; };
const person = value => text([value?.title, value?.firstName, value?.lastName].filter(Boolean).join(' '), 200);
const sender = value => person(value?.person) || text(value?.technicalUser?.label || value?.label || 'Établissement', 200);
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 250 && !/[\u0000-\u001f]/.test(value);
const safeURL = value => { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; } };
export function attachmentURL(value, school = {}) {
  const url = safeURL(value); if (!url) return null;
  const parsed = new URL(url);
  const api = parsed.origin === 'https://api.skolengo.com' && parsed.pathname.startsWith('/api/v1/');
  const auraGateway = school.emsCode === 'rra' && school.emsOIDCWellKnownUrl === 'https://sso.ent.auvergnerhonealpes.fr/oidc/.well-known' && parsed.hostname.endsWith('.ent.auvergnerhonealpes.fr') && !parsed.port && parsed.pathname === '/lectureFichiergw.do';
  return api || auraGateway ? url : null;
}
function offsetOf(value) {
  const offset = value === undefined || value === '' ? 0 : Number(value);
  if (!Number.isInteger(offset) || offset < 0 || offset > 10000 || offset % LIMIT) throw new PublicError('Page invalide.');
  return offset;
}
function dayOf(value, now) {
  const date = value || parisDate(new Date(now));
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) throw new PublicError('Date invalide.');
  if (Math.abs(Date.parse(date) - now) > 550 * 86400000) throw new PublicError('Choisissez une date de l’année scolaire.');
  return date;
}

export class SchoolService {
  constructor(store, { clientFactory = skolengoClient, clock = () => Date.now(), audit = null } = {}) {
    this.store = store; this.clientFactory = clientFactory; this.clock = clock; this.audit = audit; this.contexts = new Map(); this.running = new Map();
  }
  busy(id) { return (this.running.get(id) || 0) > 0; }
  async capabilities(user,force=false){
    if(!user.skolengo||!user.studentId)return {features:emptyCapabilities(),connected:false,checkedAt:null};
    const context=this.context(user);
    if(!force&&context.capabilities&&this.clock()-context.capabilities.checkedAt<30*60000)return context.capabilities;
    if(context.capabilityPending)return context.capabilityPending;
    context.capabilityPending=this.operate(user,'capabilities',async client=>{
      const previous=context.capabilities?.features||{},features=emptyCapabilities();let warning=null,info;
      try{if(typeof client.getUserInfo==='function')info=await client.getUserInfo(user.studentId);}
      catch(error){if(unsupportedSource(error)){features.profile.state='unavailable';}else return {features:Object.keys(previous).length?previous:features,connected:true,checkedAt:this.clock(),warning:'La disponibilité des services n’a pas pu être actualisée. Réessayez plus tard.'};}
      if(info){Object.assign(features,declaredCapabilities(info,context.school?.id));features.profile.state='available';}
      const check=async(key,read)=>{
        if(features[key]?.state==='unavailable')return null;
        try{const value=await read();features[key]={state:'available',label:featureLabels[key]};return value;}
        catch(error){if(unsupportedSource(error))features[key]={state:'unavailable',label:featureLabels[key]};else{if(previous[key])features[key]=previous[key];warning='Certains services ne répondent pas actuellement. Leur disponibilité n’est pas remise en cause.';}return null;}
      };
      const settings=typeof client.getEvaluationSettings==='function'?await check('grades',()=>client.getEvaluationSettings(user.studentId,20,0)):null;
      if(Array.isArray(settings)&&settings.length){if(settings.every(value=>value.periodicReportsEnabled===false))features.reports.state='unavailable';if(settings.every(value=>value.evaluationsDetailsAvailable===false))features.evaluationDetails.state='unavailable';}
      if(typeof client.getPeriodicReportsFiles==='function')await check('reports',()=>client.getPeriodicReportsFiles(user.studentId,20,0));
      if(typeof client.getAbsenceFiles==='function')await check('attendance',()=>client.getAbsenceFiles(user.studentId,20,0));
      if(typeof client.getUsersMailSettings==='function')await check('messages',()=>client.getUsersMailSettings(undefined,undefined,['folders']));
      if(typeof client.getAgenda==='function'&&features.notebook.state!=='unavailable'&&features.lessonDetails.state!=='unavailable'){
        const start=parisDate(new Date(this.clock()));
        try{const days=await client.getAgenda(user.studentId,start,shiftDate(start,13),100,0,undefined,['lessons']);const first=Array.isArray(days)&&days.flatMap(day=>day.lessons||[])[0];if(first&&typeof client.getLesson==='function')await check('lessonDetails',()=>client.getLesson(user.studentId,first.id));}catch(error){if(unsupportedSource(error))features.notebook.state='unavailable';}
      }
      if(typeof client.getHomeworkAssignments==='function'&&features.homework.state!=='unavailable'){
        const start=parisDate(new Date(this.clock()));
        const rows=await check('homework',()=>client.getHomeworkAssignments(user.studentId,start,shiftDate(start,13),20,0,undefined,['subject']));
        if(Array.isArray(rows)&&rows[0]&&typeof client.getHomeworkAssignment==='function')await check('homeworkDetails',()=>client.getHomeworkAssignment(user.studentId,rows[0].id));
      }
      return {features,connected:true,checkedAt:this.clock(),warning};
    }).then(result=>{context.capabilities=result;return result;}).finally(()=>{delete context.capabilityPending;});
    return context.capabilityPending;
  }
  context(user) {
    if (!user.skolengo || !user.studentId) throw new PublicError('Connectez votre ENT pour consulter cette rubrique.', 409);
    const school = this.store.open(user.skolengo).school;
    const scope = digest(user.id + ':' + user.studentId + ':' + school?.id + ':' + (user.skolengoConnectionId || 'initial'));
    let context = this.contexts.get(user.id);
    if (!context || context.scope !== scope || this.clock() - context.usedAt > 30 * 60000) {
      if (!context && this.contexts.size >= 50) {
        const victim = [...this.contexts.keys()].find(id => !this.busy(id));
        if (!victim) throw new PublicError('Plusieurs consultations sont en cours. Réessayez dans un instant.', 429);
        this.contexts.delete(victim);
      }
      context = { scope, school, cache: new Map(), refs: new Map(), usedAt: this.clock() }; this.contexts.set(user.id, context);
    }
    context.usedAt = this.clock(); return context;
  }
  reference(context, kind, raw, data = {}) {
    if (!identifier(raw)) return null;
    const ref = digest(context.scope + ':' + kind + ':' + raw);
    context.refs.delete(ref); context.refs.set(ref, { kind, raw, data, at: this.clock() });
    while (context.refs.size > 600) context.refs.delete(context.refs.keys().next().value);
    return ref;
  }
  files(context, files = []) {
    return (Array.isArray(files) ? files : []).slice(0, 50).map(file => {
      const url = Number(file.size) > MAX_FILE ? null : attachmentURL(file.url, context.school);
      const ref = url ? this.reference(context, 'file', text(file.id || digest(url)), { url, name: text(file.name || 'Document', 200) }) : null;
      return { ref, name: text(file.name || 'Document', 200), size: number(file.size), mimeType: text(file.mimeType, 100), period: text(file.period?.label, 150) };
    });
  }
  grade(value, context) {
    return { ref: context.capabilities?.features.evaluationDetails?.state === 'unavailable' ? null : this.reference(context, 'evaluation', value.id), title: text(value.title || value.topic || 'Évaluation'), date: text(value.dateTime, 40), coefficient: number(value.coefficient), scale: number(value.scale), classAverage: number(value.average), min: number(value.min), max: number(value.max), mark: number(value.evaluationResult?.mark), reason: text(value.evaluationResult?.nonEvaluationReason, 200), comment: plainText(value.evaluationResult?.comment), skills: (value.evaluationResult?.subSkillsEvaluationResults || []).slice(0, 100).map(skill => ({ label: text(skill.subSkill?.shortLabel || skill.subSkill?.label, 300), level: text(skill.level, 100) })) };
  }
  work(value, context) {
    return { ref: context.capabilities?.features.homeworkDetails?.state === 'unavailable' ? null : this.reference(context, 'homework', value.id), title: text(value.title || 'Travail à faire'), details: plainText(value.html), due: text(value.dueDateTime || value.dueDate, 40), subject: subjectFor(value.subject, value.title), teacher: person(value.teacher?.person || value.teacher), done: value.done === true, files: this.files(context, value.attachments), deliveryURL: safeURL(value.onlineDeliveryUrl) };
  }
  absence(value, context) {
    const state = value.currentState || {};
    return { ref: context.capabilities?.features.absenceDetails?.state === 'unavailable' ? null : this.reference(context, 'absence', value.id), start: text(state.absenceStartDateTime, 40), end: text(state.absenceEndDateTime, 40), type: text(state.absenceType, 80), status: text(state.absenceFileStatus, 80), reason: text(state.absenceReason?.longLabel, 500), comment: plainText(state.comment) };
  }
  async operate(user, mode, operation) {
    if ([...this.running.values()].reduce((sum, value) => sum + value, 0) >= 8) throw new PublicError('Plusieurs consultations sont en cours. Réessayez dans un instant.', 429);
    if ((this.running.get(user.id) || 0) >= 3) throw new PublicError('Une consultation est déjà en cours. Réessayez dans un instant.', 429);
    this.running.set(user.id, (this.running.get(user.id) || 0) + 1);
    const started = this.clock();
    try {
      const result = await withSkolengo(this.store, user, operation, this.clientFactory);
      this.audit?.record('school.loaded', { source: 'sync', userId: user.id, meta: { mode, durationMs: this.clock() - started } }); return result;
    } catch (error) {
      if (error instanceof PublicError) throw error;
      const status = Number(error.status || error.response?.status);
      const code = status === 401 || ['invalid_grant', 'invalid_token'].includes(error.error) ? 'ENT_AUTH_EXPIRED' : [403, 404, 405].includes(status) || error.message === 'UNSUPPORTED' ? 'ENT_SERVICE_UNAVAILABLE' : error.message === 'SOURCE_CHANGED' ? 'ENT_SOURCE_CHANGED' : 'ENT_UNAVAILABLE';
      this.audit?.record('school.failed', { source: 'sync', level: 'warn', userId: user.id, meta: { mode, durationMs: this.clock() - started, errorCode: code } });
      throw new PublicError(code === 'ENT_AUTH_EXPIRED' ? 'La connexion ENT a expiré. Reconnectez Skolengo dans Mon abonnement ICS.' : code === 'ENT_SOURCE_CHANGED' ? 'La connexion ou l’élève a changé. Actualisez cette rubrique.' : code === 'ENT_SERVICE_UNAVAILABLE' ? 'Cette rubrique n’est pas accessible avec votre compte dans cet établissement.' : 'L’ENT ne répond pas pour cette rubrique. Réessayez dans un instant.', code === 'ENT_AUTH_EXPIRED' ? 409 : 503);
    } finally { const count = this.running.get(user.id) - 1; if (count) this.running.set(user.id, count); else this.running.delete(user.id); }
  }
  async load(user, section, query = {}) {
    if (!sections.has(section)) throw new PublicError('Rubrique inconnue.', 404);
    const context = this.context(user), offset = offsetOf(query.offset), workOffset = offsetOf(query.workOffset), date = section === 'notebook' ? dayOf(query.date, this.clock()) : '';
    for (const key of ['period', 'folder']) if (query[key] && !identifier(query[key])) throw new PublicError('Sélection invalide.');
    const cacheKey = JSON.stringify([section, offset, workOffset, date, query.period || '', query.folder || '']);
    if(context.capabilities?.features[section]?.state==='unavailable')throw new PublicError('Cette rubrique n’est pas fournie par votre établissement.',409);
    const cached = context.cache.get(cacheKey);
    if (query.refresh !== '1' && cached && this.clock() - cached.fetchedAt < TTL) return cached;
    return this.operate(user, section, async client => {
      const call = async (name, ...args) => {
        if (typeof client[name] !== 'function') throw new Error('UNSUPPORTED');
        try { return await client[name](...args); }
        catch (error) {
          const paged = ['getEvaluation', 'getPeriodicReportsFiles', 'getAbsenceFiles', 'getCommunicationsFolder', 'getSchoolInfos', 'getAgenda', 'getHomeworkAssignments'].includes(name);
          const pageOffset = name === 'getHomeworkAssignments' ? workOffset : offset;
          if (paged && pageOffset > 0 && Number(error.status || error.response?.status) === 400 && /page offset out of range.*beyond data\s?set/i.test(String(error.detail || error.message || ''))) return [];
          throw error;
        }
      };
      let data = {};
      if (section === 'grades') {
        const settings = list(await call('getEvaluationSettings', user.studentId, LIMIT, 0));
        const periods = [...new Map(settings.flatMap(item => item.periods || []).filter(period => identifier(period.id)).map(period => [period.id, { id: period.id, label: text(period.label), start: text(period.startDate, 40), end: text(period.endDate, 40) }])).values()].sort((a, b) => b.start.localeCompare(a.start));
        const today = parisDate(new Date(this.clock()));
        const period = query.period ? periods.find(value => value.id === query.period) : periods.find(value => value.start.slice(0, 10) <= today && value.end.slice(0, 10) >= today) || periods[0];
        if (query.period && !period) throw new PublicError('Cette période n’est pas associée à votre élève.');
        const rows = period ? list(await call('getEvaluation', user.studentId, period.id, LIMIT, offset)) : [];
        data = { periods, period: period?.id || '', skills: settings.flatMap(value => value.skillsSetting?.skillAcquisitionLevels || []).slice(0, 50).map(value => ({ level: text(value.level), label: text(value.label) })), items: rows.map(value => ({ subject: subjectFor(value.subject, value.subject?.label), coefficient: number(value.coefficient), average: number(value.studentAverage), scale: number(value.scale), classAverage: number(value.average), teachers: (value.teachers || []).map(person), grades: (value.evaluations || []).slice(0, 200).map(grade => this.grade(grade, context)) })), hasMore: rows.length === LIMIT };
      }
      if (section === 'reports') { const rows = list(await call('getPeriodicReportsFiles', user.studentId, LIMIT, offset)); data = { items: this.files(context, rows), hasMore: rows.length === LIMIT }; }
      if (section === 'attendance') { const rows = list(await call('getAbsenceFiles', user.studentId, LIMIT, offset)); data = { items: rows.map(value => this.absence(value, context)), hasMore: rows.length === LIMIT }; }
      if (section === 'messages') {
        const settings = await call('getUsersMailSettings', undefined, undefined, ['folders']);
        const folders = list(settings.folders).filter(folder => identifier(folder.id)).map(folder => ({ id: folder.id, label: text(folder.name), type: text(folder.type, 50) }));
        const folder = query.folder ? folders.find(value => value.id === query.folder) : folders.find(value => value.type === 'INBOX') || folders[0];
        if (query.folder && !folder) throw new PublicError('Ce dossier n’est pas associé à votre messagerie.');
        const rows = folder ? list(await call('getCommunicationsFolder', folder.id, LIMIT, offset)) : [];
        data = { folders, folder: folder?.id || '', items: rows.map(value => ({ ref: this.reference(context, 'message', value.id, { title: text(value.subject) }), title: text(value.subject || 'Sans objet'), date: text(value.lastParticipation?.dateTime, 40), sender: sender(value.lastParticipation?.sender), read: value.read === true, preview: plainText(value.lastParticipation?.contentWithoutHtml || value.firstParticipationContent).slice(0, 250), count: number(value.participationsNumber) })), hasMore: rows.length === LIMIT };
      }
      if (section === 'news') {
        const rows = list(await call('getSchoolInfos', { page: { limit: LIMIT, offset } }));
        this.store.update(user.id, newsPatch(user, rows.map(value => ({id: value.id, title: text(value.title), text: plainText(value.shortContent || value.content).slice(0, 2000), date: text(value.publicationDateTime, 40), author: sender(value.author)})), this.clock()));
        data = { items: rows.map(value => ({ ref: this.reference(context, 'news', value.id), title: text(value.title), date: text(value.publicationDateTime, 40), author: sender(value.author), preview: plainText(value.shortContent || value.content).slice(0, 350) })), hasMore: rows.length === LIMIT };
      }
      if (section === 'notebook') {
        const end = shiftDate(date, 6), days = list(await call('getAgenda', user.studentId, date, end, LIMIT, offset, undefined, ['lessons', 'lessons.subject', 'lessons.teachers']));
        const lessons = days.flatMap(day => list(day.lessons).map(value => ({ ref: context.capabilities?.features.lessonDetails?.state === 'unavailable' ? null : this.reference(context, 'lesson', value.id), title: text(value.title || value.subject?.label || 'Cours'), subject: subjectFor(value.subject, value.title), date: text(day.date, 10), start: text(value.startDateTime, 40), end: text(value.endDateTime, 40), location: text(value.location, 200), teachers: (value.teachers || []).map(person), hasContent: value.anyContent === true, cancelled: value.canceled === true })));
        let work = [], workWarning = null;
        try { work = list(await call('getHomeworkAssignments', user.studentId, date, end, LIMIT, workOffset, undefined, ['subject'])).map(value => this.work(value, context)); }
        catch { workWarning = 'Les détails des devoirs ne sont pas disponibles pour cette semaine.'; }
        data = { date, end, items: lessons, work, workOffset, workWarning, hasMore: days.length === LIMIT, workHasMore: work.length === LIMIT };
      }
      if (section === 'profile') {
        const value = await call('getUserInfo', user.studentId);
        data = { name: person(value), className: text(value.className, 150), regime: text(value.regime, 150), course: text(value.mef?.label, 250), emails: [...new Set([value.internalMail, value.externalMail, value.importedMail].filter(Boolean).map(value => text(value, 250)))], phone: text(value.mobilePhone, 100), school: { name: text(value.school?.name || context.school.name), city: text(value.school?.city || context.school.city, 150), address: [context.school.addressLine1, context.school.addressLine2, context.school.addressLine3, context.school.zipCode].filter(Boolean).map(value => text(value, 250)).join(', ') }, services: (value.school?.subscribedServices || []).slice(0, 50).map(value => text(value, 50)) };
      }
      const result = { section, ...data, offset, fetchedAt: this.clock() };
      context.cache.delete(cacheKey); context.cache.set(cacheKey, result);
      while (context.cache.size > 24) context.cache.delete(context.cache.keys().next().value);
      return result;
    });
  }
  lookup(user, ref, kind = null) {
    const context = this.context(user), item = context.refs.get(ref);
    if (!item || (kind && item.kind !== kind) || this.clock() - item.at > 30 * 60000) throw new PublicError('Ce contenu a expiré. Actualisez la liste puis ouvrez-le à nouveau.', 410);
    return { context, item };
  }
  async detail(user, ref) {
    const { context, item } = this.lookup(user, ref);
    if (!['message', 'evaluation', 'news', 'absence', 'lesson', 'homework'].includes(item.kind)) throw new PublicError('Contenu inconnu.', 404);
    return this.operate(user, item.kind, async client => {
      let data;
      if (item.kind === 'message') {
        const rows = list(await client.getCommunicationParticipations(item.raw, { page: { limit: 100, offset: 0 } }));
        data = { title: item.data.title, items: rows.map(value => ({ author: sender(value.sender), date: text(value.dateTime, 40), text: plainText(value.contentWithoutHtml || value.content), files: this.files(context, value.attachments) })), truncated: rows.length === 100 };
        for (const cached of context.cache.values()) if (cached.section === 'messages') { const message = cached.items.find(value => value.ref === ref); if (message) message.read = true; }
      }
      if (item.kind === 'evaluation') { const value = await client.getEvaluationDetail(user.studentId, item.raw); data = this.grade(value, context); }
      if (item.kind === 'absence') {
        const value = await client.getAbsenceFile(item.raw); data = { ...this.absence(value, context), history: (value.history || []).slice(0, 100).map(state => ({ date: text(state.creationDateTime, 40), status: text(state.absenceFileStatus, 80), comment: plainText(state.comment), reason: text(state.absenceReason?.longLabel) })) };
      }
      if (item.kind === 'news') { const value = await client.getSchoolInfo(item.raw); data = { title: text(value.title), date: text(value.publicationDateTime, 40), author: sender(value.author), text: plainText(value.content || value.shortContent), files: this.files(context, value.attachments), url: safeURL(value.linkedWebSiteUrl || value.linkedInfoUrl || value.url) }; }
      if (item.kind === 'lesson') {
        const value = await client.getLesson(user.studentId, item.raw);
        data = { title: text(value.title), teachers: (value.teachers || []).map(person), location: text(value.location, 200), start: text(value.startDateTime, 40), cancelled: value.canceled === true, contents: (value.contents || []).slice(0, 50).map(content => ({ title: text(content.title), text: plainText(content.html), url: safeURL(content.url), files: this.files(context, content.attachments) })), before: (value.toDoForTheLesson || []).slice(0, 100).map(value => this.work(value, context)), after: (value.toDoAfterTheLesson || []).slice(0, 100).map(value => this.work(value, context)) };
      }
      if (item.kind === 'homework') {
        const value = await client.getHomeworkAssignment(user.studentId, item.raw);
        data = { ...this.work(value, context), corrections: [value.individualCorrectedWork, value.commonCorrectedWork].filter(Boolean).map(value => ({ title: text(value.title || 'Correction'), text: plainText(value.html || value.content), files: this.files(context, value.attachments) })) };
      }
      return { kind: item.kind, ...data, fetchedAt: this.clock() };
    });
  }
  async download(user, ref) {
    const { context, item } = this.lookup(user, ref, 'file');
    if (!attachmentURL(item.data.url, context.school)) throw new PublicError('Ce document doit être ouvert dans l’ENT.', 409);
    return this.operate(user, 'download', async client => {
      const response = await client.request({ url: item.data.url, responseType: 'arraybuffer', maxRedirects: 0, maxContentLength: MAX_FILE, timeout: 30000 });
      const bytes = Buffer.from(response.data); if (bytes.length > MAX_FILE) throw new PublicError('Ce fichier dépasse 15 Mo. Ouvrez-le dans l’ENT.', 413);
      return { bytes, name: item.data.name };
    });
  }
}

export function installSchoolRoutes(router, { auth, store, rateLimit, audit, clock, complement = null, ...options }) {
  const service = new SchoolService(store, { audit, clock, ...options });
  const limit = req => rateLimit(req, 'school:' + req.user.id, 80, 15 * 60000);
  router.get('/api/capabilities',auth,async(req,res)=>{
    rateLimit(req,'capabilities:'+req.user.id,20,15*60000);
    const data = structuredClone(await service.capabilities(req.user,req.query.refresh==='1'));
    for (const key of ['grades','reports','attendance']) if(complement?.canServe(req.user,key)) data.features[key] = {...data.features[key],state:'available',...(data.features[key]?.state === 'unavailable' ? {source:'Pronote',sources:['Pronote']} : {sources:['ENT','Pronote']})};
    res.json(data);
  });
  router.get('/api/school/:section', auth, async (req, res) => {
    limit(req); const key = req.params.section;
    if (['grades','reports','attendance'].includes(key) && complement?.canServe(req.user,key)) {
      const capabilities = await service.capabilities(req.user);
      if (capabilities.features[key]?.state === 'unavailable' || req.query.source === 'pronote') return res.json(complement.section(req.user,key,req.query));
    }
    res.json({...await service.load(req.user,key,req.query),source:'ENT'});
  });
  // Opening a message can mark it read in the source, so details use an explicit POST.
  router.post('/api/school/open', auth, async (req, res) => { limit(req); res.json(await service.detail(req.user, req.body.ref)); });
  router.get('/api/school/files/:ref', auth, async (req, res) => { limit(req); const file = await service.download(req.user, req.params.ref); res.type('application/octet-stream').attachment(file.name.replace(/[\r\n]/g, '')).send(file.bytes); });
  return service;
}
