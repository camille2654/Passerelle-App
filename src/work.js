import { compile } from 'html-to-text';
import {mergeSourceWork, linkedPronote} from './sources.js';
import { digest } from './store.js';
import { normalizeLabel, subjectFor } from './subjects.js';

const parisDateFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
export const parisDate = date => parisDateFormatter.format(date);
export function shiftDate(day, days) { const date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
const convertHTML = compile({ wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }, { selector: 'img', format: 'skip' }, { selector: 'script', format: 'skip' }, { selector: 'style', format: 'skip' }] });
export function plainText(html) {
  return convertHTML(String(html || '').slice(0, 60000)).trim().slice(0, 8000);
}
export async function fetchAssignments(client, user, window, lastCourseDate = null) {
  const days = new Map(), seen = new Set();
  for (let start = window.start; start <= window.end && (!lastCourseDate || start <= lastCourseDate); start = shiftDate(start, 28)) {
    const end = [shiftDate(start, 27), window.end].sort()[0]; let complete = false;
    for (let offset = 0; offset < 2000; offset += 20) {
      let page;
      try { page = await client.getHomeworkAssignments(user.studentId, start, end, 20, offset, undefined, ['subject']); }
      catch (error) {
        // This ENT returns 400 instead of an empty last page for exact multiples.
        if (offset > 0 && Number(error.status || error.response?.status) === 400 && /page offset out of range.*beyond data\s?set/i.test(String(error.detail || error.message || ''))) { complete = true; break; }
        throw error;
      }
      if (!Array.isArray(page)) throw new Error('Homework response is incomplete');
      for (const work of page) {
        const due = typeof work.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(work.dueDate) ? work.dueDate : Number.isFinite(Date.parse(work.dueDateTime)) ? parisDate(new Date(work.dueDateTime)) : null;
        if (!due || due < start || due > end || seen.has(work.id)) throw new Error('Homework pagination is inconsistent');
        seen.add(work.id);
        if (!days.has(due)) days.set(due, { date: due, homeworkAssignments: [] });
        days.get(due).homeworkAssignments.push(work);
      }
      if (page.length < 20) { complete = true; break; }
    }
    if (!complete) throw new Error('Homework pagination exceeded its limit');
  }
  const result = normalizeAssignments([...days.values()], user, window);
  return { ...result, available: true };
}
export function isAssessment(title, details) {
  return /\b(controles?|evaluations?|interrogations?|interros?|examens?|devoirs? surveilles?|bac blancs?|qcm|ds|tests?)\b/.test(normalizeLabel(title + ' ' + details));
}
export function normalizeAssignments(days, user, window) {
  const found = new Map(); let available = false;
  for (const day of days) {
    if (day.homeworkAssignments === undefined) continue;
    if (!Array.isArray(day.homeworkAssignments)) throw new Error('Homework payload is incomplete');
    available = true;
    for (const work of day.homeworkAssignments) {
      if (!work || typeof work.id !== 'string' || !work.id) throw new Error('Homework identifier missing');
      const due = typeof work.dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(work.dueDate) ? work.dueDate : Number.isFinite(Date.parse(work.dueDateTime)) ? parisDate(new Date(work.dueDateTime)) : day.date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || !Number.isFinite(Date.parse(due)) || due < window.start || due > window.end) throw new Error('Homework date invalid');
      const details = plainText(work.html);
      const title = plainText(work.title || details || 'Travail à faire').split('\n')[0].slice(0, 300);
      const id = digest(user.id + ':' + user.studentId + ':homework:' + work.id);
      const item = { id, sourceId: work.id, title, details, due, subjectLabel: String(work.subject?.label || 'Autre matière').slice(0, 120), done: work.done === true, detectedExam: isAssessment(title, details), source: 'skolengo' };
      if (found.has(id) && JSON.stringify(found.get(id)) !== JSON.stringify(item)) throw new Error('Homework data conflict');
      found.set(id, item);
    }
  }
  return { assignments: [...found.values()], available };
}
export function userWork(user) {
  return [...mergeSourceWork(user), ...(user.manualWork || [])].map(item => {
    const override = {...user.workOverrides?.[item.pronoteId], ...user.workOverrides?.[item.id]};
    const subject = subjectFor({ label: item.subjectLabel }, undefined, user.subjectStyles);
    return { ...item, subject, kind: override.kind || item.kind || (item.detectedExam ? 'exam' : 'homework'), done: override.done ?? item.done ?? false, doneAt: override.doneAt || null };
  }).sort((a, b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}
export function subjectList(user) {
  const subjects = new Map();
  for (const event of Object.values(user.calendarEvents || {})) {
    const subject = subjectFor({ label: event.subject?.label || event.rawTitle || event.title }, undefined, user.subjectStyles);
    subjects.set(subject.key, subject);
  }
  for (const item of userWork(user)) subjects.set(item.subject.key, item.subject);
  return [...subjects.values()].sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}
export function taskEvents(user, previous = {}, now = Date.now()) {
  const result = {}, cutoff = now - 90 * 86400000;
  for (const item of userWork(user)) {
    const prev = previous[item.id];
    const subject = item.subject;
    const event = {
      id: item.id, date: item.due, allDay: true, start: item.due, end: shiftDate(item.due, 1),
      title: `${subject.emoji} ${item.kind === 'exam' ? 'Contrôle' : 'Devoir'} · ${subject.label} — ${item.title}`,
      rawTitle: item.title, subject, kind: item.kind, location: '',
      description: [item.details, item.sources?.length > 1 ? 'Travail à faire publié dans l’ENT et Pronote.' : item.source === 'pronote' ? 'Travail à faire publié sur Pronote.' : item.source === 'skolengo' ? (item.kind === 'exam' && item.detectedExam ? 'Contrôle repéré dans le travail à faire publié sur Skolengo.' : 'Travail à faire publié sur Skolengo.') : 'Ajout personnel dans Passerelle.'].filter(Boolean).join('\n\n'),
      cancelled: item.done
    };
    const hash = digest(JSON.stringify(event));
    const changed = prev?.hash !== hash || prev?.cancelled !== event.cancelled;
    result[item.id] = { ...event, hash, created: prev?.created ?? now, modified: changed ? now : prev.modified, sequence: (prev?.sequence ?? -1) + (changed ? 1 : 0) };
  }
  for (const [id, prev] of Object.entries(previous)) if (!result[id] && Date.parse(prev.end) >= cutoff) result[id] = { ...prev, cancelled: true, modified: prev.cancelled ? prev.modified : now, sequence: prev.sequence + (prev.cancelled ? 0 : 1) };
  return result;
}
export function buildBrief(user, now = new Date()) {
  const today = parisDate(now), tomorrow = shiftDate(today, 1), horizon = shiftDate(tomorrow, 6);
  const courses = Object.values(user.calendarEvents || {}).filter(e => !e.cancelled && e.date === tomorrow).sort((a, b) => a.start.localeCompare(b.start));
  const work = userWork(user).filter(w => !w.done);
  return {
    date: tomorrow, name: user.name, courses,
    homework: work.filter(w => w.kind !== 'exam' && w.due === tomorrow),
    exams: work.filter(w => w.kind === 'exam' && w.due >= tomorrow && w.due <= horizon),
    changes: (user.changes || []).filter(c => c.at >= Date.parse(today + 'T00:00:00Z') - 2 * 3600000 && c.date === tomorrow).slice(0, 15),
    lastSync: user.lastSync || null, workLastSync: user.workLastSync || null,
    warning: user.lastError || user.homeworkWarning || (linkedPronote(user) ? user.pronoteError : null) || null
  };
}
