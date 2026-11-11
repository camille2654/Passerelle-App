import {schoolEvents} from './event-scope.js';
import { digest } from './store.js';
import { subjectFor, styledTitle } from './subjects.js';
import { taskEvents } from './work.js';
import { renderCalendar } from './ical.js';
import {travelCalendarEvents} from './travel-calendar.js';

export const CALENDAR_FORMAT_VERSION = 2;

export function courseHash(event) {
  const { id, date, title, rawTitle, subject, kind, location, description, start, end, cancelled } = event;
  return digest(JSON.stringify({ id, date, title, rawTitle, subject, kind, location, description, start, end, cancelled }));
}
export function combinedEvents(user, filter = {}) {
  return [...Object.values(user.calendarEvents || {}), ...Object.values(user.taskCalendar || {}), ...schoolEvents(user),...travelCalendarEvents(user)].filter(e => (!filter.type || filter.type === 'all' || (e.kind || 'course') === filter.type) && (!filter.subject || e.subject?.key === filter.subject));
}
export function rebuildCalendar(store, id, now = Date.now()) {
  const user = store.user(id), courses = structuredClone(user.calendarEvents || {});
  for (const event of Object.values(courses)) {
    const subject = subjectFor({ label: event.subject?.label || event.rawTitle || event.title }, undefined, user.subjectStyles);
    const rawTitle = event.rawTitle || event.title;
    const title = styledTitle(rawTitle, subject);
    if (event.title !== title || JSON.stringify(event.subject) !== JSON.stringify(subject)) {
      Object.assign(event, { title, rawTitle, subject, kind: 'course', modified: now, sequence: (event.sequence || 0) + 1 });
      event.hash = courseHash(event);
    }
  }
  const taskCalendar = taskEvents(user, user.taskCalendar, now);
  const next = { ...user, calendarEvents: courses, taskCalendar };
  const ics = renderCalendar(combinedEvents(next), { reminder: user.reminderMinutes || 0 });
  const events = Object.values(courses).filter(e => !e.cancelled && Date.parse(e.end) > now).sort((a, b) => a.start.localeCompare(b.start)).slice(0, 80).map(e => ({ title: e.title, location: e.location, start: e.start, end: e.end, subject: e.subject }));
  store.update(id, { calendarFormatVersion:CALENDAR_FORMAT_VERSION, calendarEvents: courses, taskCalendar, cachedICS: ics, feedETag: '"' + digest(ics) + '"', feedModifiedAt: ics !== user.cachedICS ? now : user.feedModifiedAt, events });
}

// Refresh cached feeds as well as future synchronizations, including paused accounts.
export function upgradeCalendarFeeds(store, now = Date.now()) {
  let upgraded = 0;
  for (const user of store.state.users) {
    if (!(user.cachedICS || user.feedKey) || user.calendarFormatVersion === CALENDAR_FORMAT_VERSION) continue;
    rebuildCalendar(store, user.id, now);
    upgraded++;
  }
  return upgraded;
}
