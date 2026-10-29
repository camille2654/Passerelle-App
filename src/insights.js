import {parisDate, shiftDate, userWork} from './work.js';
import {studentScope} from './activity.js';

export function focusHistoryPatch(user, now) {
  const history = (user.focusHistory || []).filter(item => item.end >= now - 120 * 86400000).slice(-2000);
  const session = user.focusSession;
  if (session?.phase !== 'work' || session.studentId !== studentScope(user) || session.state !== 'running') return {focusHistory: history};
  const start = session.runningSince ?? session.startedAt, end = Math.min(now, session.endsAt);
  const id = session.id + ':' + start;
  if (end > start && !history.some(item => item.id === id)) history.push({id, studentId: studentScope(user), start, end});
  return {focusHistory: history.slice(-2000)};
}
export function weekStart(day) {
  const weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  return shiftDate(day, -(weekday === 0 ? 6 : weekday - 1));
}
export function weeklySummary(user, day, now) {
  const start = weekStart(day), end = shiftDate(start, 6), scope = studentScope(user);
  const lower = Date.parse(start + 'T00:00:00Z') - 3*3600000, upper = Date.parse(shiftDate(end, 1) + 'T00:00:00Z') + 3600000;
  const history = focusHistoryPatch(user, now).focusHistory.filter(item => item.studentId === scope && item.end > lower && item.start < upper);
  const work = userWork(user), days = Array.from({length: 7}, (_, index) => ({date: shiftDate(start, index), focusSeconds: 0, completed: 0, revisions: 0, cards: 0, courseMinutes: 0}));
  const byDay = new Map(days.map(value => [value.date, value]));
  for (const segment of history) {
    // Minute boundaries also split midnight and daylight-saving transitions correctly.
    for (let at = segment.start; at < segment.end;) {
      const next = Math.min(segment.end, (Math.floor(at / 60000) + 1) * 60000);
      const value = byDay.get(parisDate(new Date(at)));
      if (value) value.focusSeconds += (next - at) / 1000;
      at = next;
    }
  }
  for (const item of work) {
    const completedAt = item.doneAt;
    if (item.done && completedAt) { const value = byDay.get(parisDate(new Date(completedAt))); if (value) value.completed++; }
  }
  for (const item of user.studySessions || []) if (item.done && item.doneAt) { const value = byDay.get(parisDate(new Date(item.doneAt))); if (value) value.revisions++; }
  for (const item of user.cardReviews || []) if (item.studentId === scope) { const value = byDay.get(parisDate(new Date(item.at))); if (value) value.cards++; }
  for (const item of Object.values(user.calendarEvents || {})) if (!item.cancelled && byDay.has(item.date)) byDay.get(item.date).courseMinutes += Math.max(0, (Date.parse(item.end) - Date.parse(item.start)) / 60000);
  const total = key => Math.round(days.reduce((sum, item) => sum + item[key], 0));
  const today = parisDate(new Date(now));
  return {start, end, days, totals: {completed: total('completed'), focusMinutes: Math.floor(total('focusSeconds') / 60), revisions: total('revisions'), cards: total('cards'), scheduledCourseMinutes: total('courseMinutes')}, upcoming: work.filter(item => !item.done && item.due >= today && item.due <= shiftDate(today, 7)).slice(0, 50), trackingSince: user.insightsSince || null};
}
