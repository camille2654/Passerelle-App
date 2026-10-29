import {digest} from './store.js';
import {parisDate} from './work.js';

const RETENTION = 90 * 86400000;
export const studentScope = user => user.studentId || null;
export function activityState(user) {
  if (user.activityScope !== undefined && user.activityScope !== studentScope(user)) return {items: [], cursor: 0, visit: null};
  const items = user.activityLog || [...(user.changes || [])].reverse().map((item, index) => ({...item, seq: index + 1, entity: 'course', source: 'ENT'}));
  return {items, cursor: user.activitySeq ?? items.length, visit: user.lastAgendaVisit || null};
}
export function activityPatch(user, incoming, now) {
  const current = activityState(user), known = new Set(current.items.map(item => item.id));
  let cursor = current.cursor;
  const additions = incoming.filter(item => {if(known.has(item.id)) return false;known.add(item.id);return true;}).map(item => ({...item, seq: ++cursor}));
  return {activityScope: studentScope(user), activitySeq: cursor, activityLog: [...current.items, ...additions].filter(item => item.at >= now - RETENTION).slice(-1000)};
}
export function assignmentChanges(before, after, now, source = 'ENT') {
  const previous = new Map((before || []).map(item => [item.id, item]));
  return (after || []).flatMap(item => {
    const old = previous.get(item.id);
    if (old && ['title', 'details', 'due', 'subjectLabel'].every(key => old[key] === item[key])) return [];
    return [{id: digest(source + ':work:' + item.id + ':' + now), eventId: item.id, at: now, date: item.due, title: item.title, text: item.details?.slice(0, 500) || '', entity: 'work', source, type: old ? 'updated' : 'added', ...(old ? {before: {date: old.due}} : {}), after: {date: item.due}}];
  });
}
export function changeView(store, user, now) {
  const state = activityState(user), previous = state.visit?.cursor ?? null;
  const unread = previous === null ? [] : state.items.filter(item => item.seq > previous);
  const oldest = state.items[0]?.seq || state.cursor + 1;
  return {
    firstVisit: previous === null, previousVisit: state.visit?.at || null, asOf: now,
    cursor: state.cursor, afterCursor: previous ?? 0, count: unread.length, items: unread.slice(-100).reverse(),
    truncated: unread.length > 100 || previous !== null && oldest > previous + 1 && state.cursor > previous,
    retentionDays: 90,
    token: store.seal({userId: user.id, scope: studentScope(user), cursor: state.cursor, at: now})
  };
}
export function acknowledgeVisit(store, user, token, now) {
  let value;
  try { value = store.open(String(token)); } catch { return false; }
  const state = activityState(user);
  if (value.userId !== user.id || value.scope !== studentScope(user) || !Number.isInteger(value.cursor) || value.cursor < 0 || value.cursor > state.cursor || now - value.at > 10 * 60000 || value.at > now) return false;
  const previous = state.visit;
  if (previous && value.cursor < previous.cursor) return true;
  store.update(user.id, {...activityPatch(user, [], now), lastAgendaVisit: {cursor: value.cursor, at: Math.max(value.at, previous?.at || 0)}});
  return true;
}
export function newsPatch(user, rows, now) {
  const same = user.searchNewsScope === studentScope(user), previous = same ? user.searchNews || [] : [];
  const known = new Map(previous.map(item => [item.id, item]));
  const incoming = rows.map(item => ({id: item.id, title: item.title, text: item.text, date: item.date, author: item.author}));
  const incomingIds = new Set(incoming.map(item => item.id));
  const recent = [...incoming, ...previous.filter(item => !incomingIds.has(item.id))].slice(0, 100);
  const additions = user.searchNewsInitialized && same ? incoming.filter(item => !known.has(item.id)).map(item => ({id: digest('news:' + item.id), eventId: item.id, entity: 'news', source: 'ENT', type: 'added', title: item.title, text: item.text.slice(0, 500), date: item.date?.slice(0, 10) || parisDate(new Date(now)), at: now})) : [];
  return {...activityPatch(user, additions, now), searchNewsScope: studentScope(user), searchNewsInitialized: true, searchNews: recent};
}
