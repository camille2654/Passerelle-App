// Deliberately bounded, local extraction. A suggestion still requires the user
// to check the source and confirm its date; publication dates are never events.
const DAY = 86400000;
const MAX_MENTIONS = 128;
const calendarFormat = new Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'});
const instantFormat = new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'});
const weekdays = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const months = {janvier: 1, janv: 1, fevrier: 2, fevr: 2, fev: 2, mars: 3, avril: 4, avr: 4, mai: 5, juin: 6, juillet: 7, juil: 7, aout: 8, septembre: 9, sept: 9, octobre: 10, oct: 10, novembre: 11, nov: 11, decembre: 12, dec: 12};
const monthPattern = Object.keys(months).sort((a, b) => b.length - a.length).join('|');
const fold = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const parts = (format, value) => Object.fromEntries(format.formatToParts(new Date(value)).filter(item => item.type !== 'literal').map(item => [item.type, item.value]));
const localDay = value => { const valueParts = parts(calendarFormat, value); return `${valueParts.year}-${valueParts.month}-${valueParts.day}`; };
function validDay(year, month, day) {
  if (![year, month, day].every(Number.isInteger) || year < 1900 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === day ? value.toISOString().slice(0, 10) : null;
}
function dayInput(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return validDay(...value.split('-').map(Number));
}
function epoch(value) { const result = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : NaN; return Number.isFinite(result) ? result : null; }

/** A unique Europe/Paris instant, or null for an invalid/nonexistent/ambiguous local time. */
export function parisEventInstant(date, time) {
  if (!dayInput(date) || typeof time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const [year, month, day] = date.split('-').map(Number), [hour, minute] = time.split(':').map(Number);
  const naive = Date.UTC(year, month - 1, day, hour, minute), offsets = new Set();
  // Both sides of a clock change are considered. Refusing a duplicate local
  // hour avoids silently choosing one of the two possible event times.
  for (const delta of [-DAY, 0, DAY]) {
    const sample = naive + delta, value = parts(instantFormat, sample);
    offsets.add(Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day), Number(value.hour), Number(value.minute)) - sample);
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(value => {
    const actual = parts(instantFormat, value);
    return `${actual.year}-${actual.month}-${actual.day}` === date && `${actual.hour}:${actual.minute}` === time;
  });
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
}

function dateMentions(value, publication, anchorYear) {
  const mentions = [];
  const written = new RegExp(`\\b(?:(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\\s+)?([0-3]?\\d)(?:er)?\\s+(${monthPattern})(?:\\.)?(?=\\s|[,.!?;:]|$)(?:[ \\t]+(\\d{4})(?!\\d))?`, 'g');
  const numeric = /(?<![\d/])([0-3]?\d)\/([01]?\d)(?:\/(\d{4}))?(?![\d/])/g;
  for (const match of value.matchAll(written)) {
    const date = validDay(Number(match[4] || anchorYear), months[match[3]], Number(match[2]));
    if (date) mentions.push({date, index: match.index, end: match.index + match[0].length, weekdayMismatch: Boolean(match[1] && weekdays[new Date(date + 'T12:00:00Z').getUTCDay()] !== match[1])});
  }
  for (const match of value.matchAll(numeric)) {
    const date = validDay(Number(match[3] || anchorYear), Number(match[2]), Number(match[1]));
    if (date) mentions.push({date, index: match.index, end: match.index + match[0].length, weekdayMismatch: false});
  }
  // Relative wording is tied to the message's actual publication day, never to
  // the day on which a delayed background scan happens to run.
  if (publication !== null) {
    const origin = localDay(publication), tomorrow = new Date(Date.parse(origin + 'T12:00:00Z') + DAY).toISOString().slice(0, 10);
    for (const match of value.matchAll(/\b(demain|aujourd['’]hui)\b/g)) mentions.push({date: match[1] === 'demain' ? tomorrow : origin, index: match.index, end: match.index + match[0].length, weekdayMismatch: false});
  }
  return mentions.sort((a, b) => a.index - b.index).filter((item, index, rows) => index === 0 || item.index >= rows[index - 1].end).slice(0, MAX_MENTIONS);
}
function timeMentions(value) {
  const result = [];
  const pattern = /(?<![\p{L}\p{N}:/])([01]?\d|2[0-3])\s*(?:h(?:eures?)?\s*([0-5]\d)?|:\s*([0-5]\d))(?![\p{L}\p{N}:])/gu;
  for (const match of value.matchAll(pattern)) {
    const before = value.slice(Math.max(0, match.index - 35), match.index);
    if (/\b(?:duree(?: de)?|durera|pendant|durant)\s*:?\s*$/.test(before)) continue;
    result.push({time: `${match[1].padStart(2, '0')}:${match[2] || match[3] || '00'}`, index: match.index, end: match.index + match[0].length});
  }
  return result;
}
function clauseAt(boundaries, mention, length) {
  // A paragraph, line or sentence is a hard boundary. This intentionally misses
  // some split-line schedules rather than borrowing hours from a signature.
  const firstAtLeast = target => {
    let lower = 0, upper = boundaries.length;
    while (lower < upper) { const middle = Math.floor((lower + upper) / 2); if (boundaries[middle] < target) lower = middle + 1; else upper = middle; }
    return lower;
  };
  return {start: (boundaries[firstAtLeast(mention.index) - 1] ?? -1) + 1, end: boundaries[firstAtLeast(mention.end)] ?? length};
}

/**
 * Returns at most five future/today date suggestions. Null hours mean the
 * source did not provide a safely attributable time, never a guessed duration.
 */
export function extractEventDates({title = '', text = '', publishedAt, now = Date.now()} = {}) {
  const current = epoch(now); if (current === null) return [];
  const publication = epoch(publishedAt), today = localDay(current), latest = new Date(Date.parse(today + 'T12:00:00Z') + 366 * DAY).toISOString().slice(0, 10);
  const display = (String(title).slice(0, 1000) + '\n' + String(text).slice(0, 30000)).normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\u00a0/g, ' ').slice(0, 30000);
  const value = fold(display).replace(/https?:\/\/[^\s]+/g, match => ' '.repeat(match.length));
  const boundaries = [...value.matchAll(/[\n!?;]|\.(?=\s|$)/g)].map(match => match.index);
  const mentions = dateMentions(value, publication, Number(localDay(publication ?? current).slice(0, 4))), candidates = [];
  for (let index = 0; index < mentions.length; index++) {
    const mention = mentions[index];
    if (mention.date < today || mention.date > latest) continue;
    const clause = clauseAt(boundaries, mention, value.length), previous = mentions[index - 1], next = mentions[index + 1];
    const before = value.slice(clause.start, mention.index);
    // Metadata is not an event date. Headers such as "Publié le" and email
    // "Envoyé le" must not create an appointment on the publication day.
    if (/\b(?:publie(?:e)?|publication|envoye(?:e)?|mis(?:e)? a jour|ne(?:e)?)\s*(?:le|:)?\s*$/.test(before)) continue;
    const previousSameClause = previous && previous.end >= clause.start;
    const nextSameClause = next && next.index < clause.end;
    const sharedPrevious = previousSameClause && /^\s*(?:et|ou|au|a|[-–—,])\s*$/.test(value.slice(previous.end, mention.index));
    const sharedNext = nextSameClause && /^\s*(?:et|ou|au|a|[-–—,])\s*$/.test(value.slice(mention.end, next.index));
    const shorthand = /\b\d{1,2}\s*(?:et|ou|au|a|[-–—,])\s*$/.test(before);
    let ambiguous = Boolean(mention.weekdayMismatch || sharedPrevious || sharedNext || shorthand), startTime = null, endTime = null;
    let after = value.slice(mention.end, Math.min(clause.end, nextSameClause ? next.index : clause.end, mention.end + 180));
    const signature = after.search(/\b(?:cordialement|bien a vous|secretariat|telephone|signature|horaires d['’]ouverture)\b/);
    if (signature >= 0) after = after.slice(0, signature);
    let times = timeMentions(after), timedValue = after;
    // "À 18h le 5 novembre" is supported only for the first date of a clause
    // and an immediately adjacent hour, not an unrelated earlier statement.
    if (!times.length && !previousSameClause) {
      const prefix = before.slice(-70), earlier = timeMentions(prefix);
      if (earlier.length === 1 && /^\s*,?\s*(?:le|ce)?\s*$/.test(prefix.slice(earlier[0].end))) { times = earlier; timedValue = prefix; }
    }
    if (!sharedPrevious && !sharedNext && !shorthand) {
      if (times.length === 1) startTime = times[0].time;
      else if (times.length === 2 && /^\s*(?:a|[-–—]|jusqu['’]?\s*a)\s*$/.test(timedValue.slice(times[0].end, times[1].index)) && times[1].time > times[0].time) { startTime = times[0].time; endTime = times[1].time; }
      else if (times.length > 1) ambiguous = true;
    }
    if (!times.length && /\b\d{1,2}\s*(?:h\s*\d*|:\s*\d+)/.test(after)) ambiguous = true;
    if (startTime && !parisEventInstant(mention.date, startTime) || endTime && !parisEventInstant(mention.date, endTime)) { startTime = null; endTime = null; ambiguous = true; }
    const excerptStart = Math.max(clause.start, mention.index - 65), excerptEnd = Math.min(clause.end, Math.max(mention.end, mention.index + 230));
    const excerpt = display.slice(excerptStart, excerptEnd).replace(/\s+/g, ' ').trim().slice(0, 300);
    candidates.push({date: mention.date, startTime, endTime, excerpt, ambiguous});
  }
  // A repeated date in a headline does not create a second date-only event
  // when the article body provides a more useful, explicit time.
  const timedDates = new Set(candidates.filter(item => item.startTime).map(item => item.date)), unique = new Map();
  for (const item of candidates) {
    if (!item.startTime && timedDates.has(item.date)) continue;
    const key = `${item.date}:${item.startTime || ''}:${item.endTime || ''}`, previous = unique.get(key);
    if (!previous || item.excerpt.length > previous.excerpt.length) unique.set(key, {...item, ambiguous: item.ambiguous || previous?.ambiguous || false});
    else previous.ambiguous ||= item.ambiguous;
  }
  const results = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime || '').localeCompare(b.startTime || ''));
  for (const item of results) if (results.some(other => other !== item && other.date === item.date)) item.ambiguous = true;
  return results.slice(0, 5);
}
