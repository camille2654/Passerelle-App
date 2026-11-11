import {schoolEvents} from './event-scope.js';
import { digest } from './store.js';
import { subjectFor, styledTitle } from './subjects.js';
import { taskEvents } from './work.js';
import { renderCalendar } from './ical.js';
import {travelCalendarEvents} from './travel-calendar.js';

export const CALENDAR_FORMAT_VERSION = 3;

export function courseHash(event) {
  const { id, date, title, rawTitle, subject, kind, location, description, start, end, cancelled } = event;
  return digest(JSON.stringify({ id, date, title, rawTitle, subject, kind, location, description, start, end, cancelled }));
}
function groupedCourses(user) {
  const rows=Object.values(user.calendarEvents||{}).sort((a,b)=>a.start.localeCompare(b.start)||a.end.localeCompare(b.end)||a.id.localeCompare(b.id)),groups=[];
  for(const row of rows){
    const previous=groups.at(-1),members=previous?._courseMembers,last=members?.at(-1);
    const merge=last&&(!row.kind||row.kind==='course')&&(!last.kind||last.kind==='course')&&!row.cancelled&&!last.cancelled&&!row.allDay&&!last.allDay
      &&row.date===last.date&&row.title===last.title&&(row.location||'')===(last.location||'')
      &&JSON.stringify(row.subject||{})===JSON.stringify(last.subject||{})
      &&Number.isFinite(Date.parse(last.end))&&Date.parse(last.end)===Date.parse(row.start);
    if(!merge){groups.push({...row,_courseMembers:[row]});continue;}
    members.push(row);
    const created=members.map(item=>item.created).filter(Number.isFinite),modified=members.map(item=>item.modified).filter(Number.isFinite);
    previous.end=row.end;
    previous.id='course-group-'+digest(members.map(item=>item.id).join('\n'));
    previous.created=created.length?Math.min(...created):previous.created;
    previous.modified=modified.length?Math.max(...modified):previous.modified;
    previous.sequence=members.reduce((total,item)=>total+(Number.isInteger(item.sequence)?Math.max(0,item.sequence):0),0);
    previous.description=[...new Set(members.map(item=>item.description).filter(Boolean))].join('\n\n');
  }
  return groups.map(({_courseMembers,...event})=>event);
}
export function combinedEvents(user, filter = {}) {
  return [...groupedCourses(user), ...Object.values(user.taskCalendar || {}), ...schoolEvents(user),...travelCalendarEvents(user)].filter(e => (!filter.type || filter.type === 'all' || (e.kind || 'course') === filter.type) && (!filter.subject || e.subject?.key === filter.subject));
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
