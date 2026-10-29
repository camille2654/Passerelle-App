// RFC 5545: UTF-8, CRLF, escaped TEXT and content lines of at most 75 octets.
export function escapeText(value) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
export function foldLine(line) {
  const parts = []; let current = '', length = 0;
  for (const char of line) {
    const bytes = Buffer.byteLength(char, 'utf8');
    if (length + bytes > 75) { parts.push(current); current = ' '; length = 1; }
    current += char; length += bytes;
  }
  parts.push(current); return parts.join('\r\n');
}
const stamp = value => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export function renderCalendar(events, options = {}) {
  const name = escapeText(options.name || 'Emploi du temps · Skolengo');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Passerelle//Emploi du temps//FR', 'CALSCALE:GREGORIAN', 'NAME:' + name, 'X-WR-CALNAME:' + name, 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT10M', 'X-PUBLISHED-TTL:PT10M'];
  if (options.color && /^[a-z]+$/.test(options.color)) lines.push('COLOR:' + options.color);
  // A subscription is the current calendar snapshot. Tombstones stay internal;
  // publishing STATUS:CANCELLED keeps a struck-out event visible in clients.
  for (const event of events.filter(event => !event.cancelled).sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id))) {
    lines.push('BEGIN:VEVENT', 'UID:' + event.id + '@passerelle.invalid', 'DTSTAMP:' + stamp(event.modified), 'CREATED:' + stamp(event.created), 'LAST-MODIFIED:' + stamp(event.modified), 'SEQUENCE:' + event.sequence);
    if (event.allDay) lines.push('DTSTART;VALUE=DATE:' + event.start.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + event.end.replace(/-/g, ''));
    else lines.push('DTSTART:' + stamp(event.start), 'DTEND:' + stamp(event.end));
    lines.push('SUMMARY:' + escapeText(event.title), 'LOCATION:' + escapeText(event.location), 'DESCRIPTION:' + escapeText(event.description), 'STATUS:CONFIRMED', 'TRANSP:' + (event.allDay ? 'TRANSPARENT' : 'OPAQUE'));
    if (event.subject?.color && /^[a-z]+$/.test(event.subject.color)) lines.push('COLOR:' + event.subject.color, 'CATEGORIES:' + escapeText(event.subject.label));
    if (!event.allDay && [5, 10, 15, 30].includes(options.reminder)) lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT' + options.reminder + 'M', 'DESCRIPTION:' + escapeText(event.title), 'END:VALARM');
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
