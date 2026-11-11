import {accountActive,automationAllowed} from './operational-state.js';
import { digest } from './store.js';
import { skolengoClient, withSkolengo } from './skolengo.js';
import { subjectFor, styledTitle } from './subjects.js';
import { normalizeAssignments, fetchAssignments, parisDate } from './work.js';
import { courseHash, rebuildCalendar } from './calendar.js';
import { changeAlertQueue } from './change-alerts.js';
import {activityPatch, assignmentChanges} from './activity.js';
import {schoolWindow as dateWindow,recentWindow,syncPolicy,nextSyncAt,retryDelay,mergeRangeAssignments} from './sync-policy.js';

export {dateWindow};

export const INTERVAL = 10 * 60000;
export class PublicError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function normalizeLessons(days, user, window) {
  const result = new Map();
  for (const day of days) {
    if (!day || typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) || !Array.isArray(day.lessons)) throw new PublicError('L’ENT a renvoyé un emploi du temps incomplet. Le dernier agenda valide est conservé.', 502);
    if (day.date < window.start || day.date > window.end) throw new PublicError('Les dates reçues de l’ENT sont inattendues.', 502);
    for (const l of day.lessons) {
      if (!l || typeof l.id !== 'string' || !l.id || !Number.isFinite(Date.parse(l.startDateTime)) || !Number.isFinite(Date.parse(l.endDateTime)) || !/(Z|[+-]\d\d:\d\d)$/.test(l.startDateTime) || !/(Z|[+-]\d\d:\d\d)$/.test(l.endDateTime) || Date.parse(l.endDateTime) <= Date.parse(l.startDateTime) || typeof l.canceled !== 'boolean' || (l.teachers != null && !Array.isArray(l.teachers))) throw new PublicError('Un cours reçu de l’ENT est invalide. Le dernier agenda valide est conservé.', 502);
      const lessonDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(l.startDateTime));
      if (lessonDate !== day.date) throw new PublicError('Les horaires d’un cours ne correspondent pas à sa journée.', 502);
      const id = digest(user.id + ':' + user.studentId + ':' + l.id);
      const rawTitle = String(l.title || l.subject?.label || 'Cours').slice(0, 1000);
      const subject = subjectFor(l.subject, rawTitle, user.subjectStyles);
      const event = {
        id, date: day.date,
        title: styledTitle(rawTitle, subject), rawTitle, subject, kind: 'course',
        location: [l.location, l.locationComplement].filter(Boolean).join(' · ').slice(0, 1000),
        description: [user.entSourceDescription||'Synchronisé depuis Skolengo · ENT Auvergne-Rhône-Alpes', ...(l.teachers || []).map(t => [t.title, t.firstName, t.lastName].filter(Boolean).join(' '))].join('\n').slice(0, 4000),
        start: new Date(l.startDateTime).toISOString(), end: new Date(l.endDateTime).toISOString(), cancelled: l.canceled
      };
      const value = { ...event, hash: courseHash(event) };
      if (result.has(id) && result.get(id).hash !== value.hash) throw new PublicError('L’ENT a renvoyé des cours contradictoires.', 502);
      result.set(id, value);
    }
  }
  return result;
}
export async function fetchSnapshot(client, user, window) {
  const days = [], seen = new Set();
  const shiftDate = (date, count) => {
    const value = new Date(date + 'T12:00:00Z');
    value.setUTCDate(value.getUTCDate() + count);
    return value.toISOString().slice(0, 10);
  };
  for (let start = window.start; start <= window.end; start = shiftDate(start, 14)) {
    const end = [shiftDate(start, 13), window.end].sort()[0];
    let complete = false;
    for (let offset = 0; offset < 2000; offset += 100) {
      const page = await client.getAgenda(user.studentId, start, end, 100, offset, undefined, ['lessons', 'lessons.subject', 'lessons.teachers']);
      if (!Array.isArray(page)) throw new PublicError('Réponse ENT invalide.', 502);
      for (const day of page) {
        if (typeof day?.date !== 'string' || day.date < start || day.date > end) throw new PublicError('Les dates reçues de l’ENT sont inattendues.', 502);
        if (seen.has(day.date)) throw new PublicError('La pagination de l’ENT est incohérente.', 502);
        seen.add(day.date); days.push(day);
      }
      if (page.length < 100) { complete = true; break; }
    }
    if (!complete) throw new PublicError('L’emploi du temps dépasse la limite de lecture. Le dernier agenda valide est conservé.', 502);
  }
  const snapshot = normalizeLessons(days, user, window);
  const lastCourseDate = [...snapshot.values()].map(event => event.date).sort().at(-1);
  try { snapshot.work = typeof client.getHomeworkAssignments === 'function' ? await fetchAssignments(client, user, window, lastCourseDate) : normalizeAssignments(days, user, window); }
  catch(error) {
    const status=Number(error.status||error.response?.status);
    if(status===401||['invalid_grant','invalid_token'].includes(error.error||error.response?.data?.error))throw error;
    const headers=error.response?.headers,raw=typeof headers?.get==='function'?headers.get('retry-after'):headers?.['retry-after'];
    snapshot.work = { available: false, error: 'Les devoirs reçus de l’ENT sont incomplets. La dernière version disponible est conservée.',...((status===429||status>=500)?{retry:{status,retryAfter:typeof raw==='string'?raw.slice(0,100):typeof raw==='number'?String(raw):''}}:{}) };
  }
  return snapshot;
}
export function reconcileSnapshot(snapshot, previous, window, now = Date.now(), {retentionStart=window.start}={}) {
  const calendar = structuredClone(previous || {});
  const counts = { added: 0, updated: 0, deleted: 0, unchanged: 0 };
  const changes = [];
  const cutoff = now - 90 * 86400000;
  for (const [id, old] of Object.entries(calendar)) if (old.date < retentionStart && Date.parse(old.end) < cutoff) delete calendar[id];
  for (const [id, item] of snapshot) {
    const prev = calendar[id];
    const changed = !prev || prev.hash !== item.hash || prev.cancelled !== item.cancelled;
    calendar[id] = { ...item, created: prev?.created ?? now, modified: changed ? now : prev.modified, sequence: (prev?.sequence ?? -1) + (changed ? 1 : 0), missingCount: 0 };
    if (!prev && !item.cancelled) counts.added++;
    else if (prev && !prev.cancelled && item.cancelled) counts.deleted++;
    else if (prev && changed && !item.cancelled) counts.updated++;
    else counts.unchanged++;
    if (prev && (prev.start !== item.start || prev.end !== item.end || prev.location !== item.location || prev.cancelled !== item.cancelled || (prev.rawTitle || prev.title) !== item.rawTitle)) changes.push({ id: digest(id + ':' + now), eventId: id, at: now, date: item.date, title: item.title, type: item.cancelled ? 'cancelled' : prev.cancelled ? 'restored' : 'updated', before: { start: prev.start, end: prev.end, location: prev.location, cancelled: !!prev.cancelled }, after: { start: item.start, end: item.end, location: item.location, cancelled: !!item.cancelled } });
    else if (!prev) changes.push({ id: digest(id + ':' + now), eventId: id, at: now, date: item.date, title: item.title, type: 'added', after: { start: item.start, end: item.end, location: item.location, cancelled: !!item.cancelled } });
  }
  for (const [id, event] of Object.entries(calendar)) {
    if (snapshot.has(id) || event.cancelled || event.date < window.start || event.date > window.end) continue;
    event.missingCount = (event.missingCount || 0) + 1;
    if (event.missingCount >= 2) { event.cancelled = true; event.modified = now; event.sequence++; counts.deleted++; changes.push({ id: digest(id + ':' + now), eventId: id, at: now, date: event.date, title: event.title, type: 'cancelled', before: { start: event.start, end: event.end, location: event.location, cancelled: false } }); }
  }
  return { calendar, counts, changes };
}
export class SyncEngine {
  constructor(store, { clientFactory = skolengoClient, clock = () => Date.now(), onError = () => {}, audit = null } = {}) {
    this.store = store; this.running = new Set(); this.clientFactory = clientFactory; this.clock = clock; this.onError = onError; this.audit = audit;
    this.slot=Promise.resolve();this.tickPromise=null;
  }
  async run(id,{mode='full'}={}) {
    if(!['full','near'].includes(mode))throw new PublicError('Mode de synchronisation invalide.');
    if (this.running.has(id)) throw new PublicError('Une synchronisation est déjà en cours.', 409);
    const user = this.store.user(id);
    if(!accountActive(user))throw new PublicError('Ce compte n’est pas actif.',409);
    if (!user?.skolengo || !user.studentId) throw new PublicError('Connectez votre ENT avant de préparer votre agenda.', 409);
    const source={studentId:user.studentId,connection:user.skolengoConnectionId};
    const previous=this.slot;let release;this.slot=new Promise(resolve=>{release=resolve;});
    this.running.add(id);
    try{
      await previous;
      if(!this.current(user,source))throw new PublicError('Le compte ou l’élève a changé. Relancez la synchronisation.',409);
      return await this.execute(user,mode,source);
    }finally{this.running.delete(id);release();}
  }
  current(user,source){return this.store.user(user.id)===user&&accountActive(user)&&!!user.skolengo&&user.studentId===source.studentId&&user.skolengoConnectionId===source.connection;}
  async execute(user,mode,source){
    const id=user.id,startedAt=this.clock(),at=startedAt,window=dateWindow(new Date(at));
    // An account without annual coverage must build its first complete snapshot.
    if(mode==='near'&&syncPolicy(user,at).fullSyncDueAt===0)mode='full';
    const readWindow=mode==='near'?recentWindow(at,window):window;
    const priorFullSync=user.lastFullSync||user.lastSync||null;
    const jobId=digest(id+':'+at).slice(0,16);
    this.audit?.record('sync.started', { source: 'sync', userId: id, meta: { jobId,mode } });
    try {
      const config=this.store.open(user.skolengo),entSourceDescription=config.provider==='ent-pronote'?'Synchronisé depuis PRONOTE · '+String(user.schoolName||'Votre établissement').slice(0,200):config.school?.emsCode==='rra'?'Synchronisé depuis Skolengo · ENT Auvergne-Rhône-Alpes':'Synchronisé depuis Skolengo · '+String(user.schoolName||'Votre établissement').slice(0,200);
      const snapshot = await withSkolengo(this.store, user, client => fetchSnapshot(client,{...user,entSourceDescription},readWindow),this.clientFactory);
      if(!this.current(user,source))throw new PublicError('Le compte ou l’élève a changé. Relancez la synchronisation.',409);
      const { calendar, counts, changes } = reconcileSnapshot(snapshot, user.calendarEvents, readWindow, at,{retentionStart:window.start});
      const assignments=snapshot.work?.available?(mode==='near'?mergeRangeAssignments(user.assignments,snapshot.work.assignments,readWindow):snapshot.work.assignments):null;
      const partialRetry=snapshot.work?.retry,streak=partialRetry?Math.min(20,(user.syncErrorStreak||0)+1):0;
      const emailAlertQueue = changeAlertQueue(user, changes, at);
      this.store.update(id, {
        emailAlertQueue,
        ...activityPatch(user, user.lastSync ? [...changes.filter(c => c.date >= parisDate(new Date(at))).map(c => ({...c, entity:'course',source:config.provider==='ent-pronote'?'Pronote':'ENT'})), ...(config.provider!=='ent-pronote' && snapshot.work?.available && user.workLastSync ? assignmentChanges(user.assignments, assignments, at) : [])] : [], at),
        calendarEvents: calendar, lastSync: at, lastAttempt: at, lastError: null, skolengoError: null, dataVersion: 3, lastAttemptVersion: 3,
        lastFullSync:mode==='full'?at:priorFullSync,lastRecentSync:at,lastSyncMode:mode,lastSyncRange:{start:readWindow.start,end:readWindow.end},syncErrorStreak:streak,syncRetryAt:partialRetry?at+retryDelay({response:{headers:{'retry-after':partialRetry.retryAfter}}},streak,at):null,
        changes: [...(user.lastSync ? changes.filter(c => c.date >= parisDate(new Date(at))) : []), ...(user.changes || [])].slice(0, 100),
        ...(snapshot.work?.available ? { assignments, workLastSync: at, homeworkWarning: null, homeworkAvailable: true } : { homeworkWarning: snapshot.work?.error || 'Aucun travail à faire n’est transmis par cet ENT pour le moment.', homeworkAvailable: false }),
        calendarWindow: { start: window.start, end: window.end, label: window.label },
        lastAttemptWindow: { start: window.start, end: window.end },
        history: [{ at, ok: true, ...counts }, ...(user.history || [])].slice(0, 30),
        total: Object.values(calendar).filter(e => !e.cancelled && e.date >= window.start && e.date <= window.end).length
      });
      rebuildCalendar(this.store, id, at);
      this.audit?.record('sync.completed', { source: 'sync', userId: id, level: snapshot.work?.available ? 'info' : 'warn', meta: { jobId,mode, durationMs: this.clock() - at, ...counts, count: user.total, homework: user.assignments?.length || 0, ...(!snapshot.work?.available ? { errorCode: 'HOMEWORK_UNAVAILABLE' } : {}) } });
      return counts;
    } catch (e) {
      this.onError(e);
      if(!this.current(user,source))throw new PublicError('Le compte ou l’élève a changé. Relancez la synchronisation.',409);
      const authFailure = Number(e.status || e.response?.status) === 401 || ['invalid_grant', 'invalid_token'].includes(e.error || e.response?.data?.error);
      const message = e instanceof PublicError ? e.message : authFailure ? 'Votre connexion ENT a expiré. Reconnectez votre ENT pour reprendre les mises à jour.' : 'L’ENT est indisponible. Le dernier agenda valide reste accessible ; la prochaine vérification réessaiera.';
      const at = this.clock();
      const streak=Math.min(20,(user.syncErrorStreak||0)+1);
      this.store.update(id, { lastAttempt: at, lastAttemptVersion: 3, lastAttemptWindow: { start: window.start, end: window.end },lastAttemptRange:{start:readWindow.start,end:readWindow.end},syncErrorStreak:streak,syncRetryAt:authFailure?null:at+retryDelay(e,streak,at), lastError: message, ...(authFailure ? { skolengoError: message, enabled: false } : {}), history: [{ at, ok: false, message }, ...(user.history || [])].slice(0, 30) });
      this.audit?.record('sync.failed', { source: 'sync', level: 'error', userId: id, meta: { jobId, durationMs: this.clock() - startedAt, errorCode: authFailure ? 'ENT_AUTH_EXPIRED' : 'ENT_UNAVAILABLE' } });
      throw new PublicError(message, 502);
    }
  }
  tick(){
    if(this.tickPromise)return this.tickPromise;
    this.tickPromise=this.tickOnce().finally(()=>{this.tickPromise=null;});return this.tickPromise;
  }
  async tickOnce() {
    this.store.prune();
    if(!automationAllowed(this.store.state.settings,'ent',this.clock()))return;
    const users=[...this.store.state.users].sort((a,b)=>(nextSyncAt(a,this.clock())??Infinity)-(nextSyncAt(b,this.clock())??Infinity));
    for(const user of users){
      const now=this.clock(),due=nextSyncAt(user,now);
      if(automationAllowed(this.store.state.settings,'ent',now)&&due!==null&&due<=now&&!this.running.has(user.id))await this.run(user.id,{mode:syncPolicy(user,now).mode}).catch(()=>{});
    }
  }
}
