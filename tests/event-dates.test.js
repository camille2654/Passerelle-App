import test from 'node:test';
import assert from 'node:assert/strict';
import {extractEventDates, parisEventInstant} from '../src/event-dates.js';

const now = Date.parse('2026-10-29T12:00:00Z');
const extract = (text, extra = {}) => extractEventDates({text, publishedAt: '2026-10-28T18:00:00+01:00', now, ...extra});

test('French written dates and times become suggestions without invented duration', () => {
  const [range] = extract('La réunion parents-professeurs aura lieu jeudi 5 novembre 2026 de 18 h 30 à 20h00.');
  assert.deepEqual({date: range.date, startTime: range.startTime, endTime: range.endTime, ambiguous: range.ambiguous}, {date: '2026-11-05', startTime: '18:30', endTime: '20:00', ambiguous: false});
  const [single] = extract('Rendez-vous le 12 novembre à 9 heures.');
  assert.equal(single.startTime, '09:00'); assert.equal(single.endTime, null);
  const [numeric] = extract('Visite le 06/11/2026 à 09:30.');
  assert.equal(numeric.date, '2026-11-06'); assert.equal(numeric.startTime, '09:30');
  const [before] = extract('La rencontre se déroule à 18h le 5 novembre.');
  assert.equal(before.startTime, '18:00');
});

test('a date alone stays a date alone; dates do not acquire signature or neighboring sentence hours', () => {
  for (const text of ['Sortie le 5 novembre. Accueil du secrétariat de 8h à 17h.', 'Sortie le 5 novembre\nCordialement, secrétariat ouvert à 9h.', 'Sortie le 5 novembre ; départ à 9h.', 'Sortie le 5 novembre, durée de 2h.']) {
    const [item] = extract(text); assert.equal(item.startTime, null, text); assert.equal(item.endTime, null, text);
  }
  const [item] = extract('Conférence le 5 novembre à 18h.\nCordialement, le secrétariat.');
  assert.equal(item.startTime, '18:00');
});

test('multiple date and time associations remain conservative', () => {
  const independent = extract('Le 5 novembre à 9h et le 6 novembre à 10h.');
  assert.deepEqual(independent.map(item => [item.date, item.startTime]), [['2026-11-05', '09:00'], ['2026-11-06', '10:00']]);
  for (const text of ['Les 5 novembre et 6 novembre de 9h à 11h.', 'Du 5 novembre au 6 novembre de 9h à 11h.', 'Les 4 et 5 novembre à 9h.']) {
    const items = extract(text); assert.ok(items.length); assert.ok(items.every(item => item.ambiguous && item.startTime === null && item.endTime === null), text);
  }
  const [conflict] = extract('Le 5 novembre à 9h, un autre accueil à 14h.');
  assert.equal(conflict.ambiguous, true); assert.equal(conflict.startTime, null);
  const [overnight] = extract('Le 5 novembre de 22h à 2h.');
  assert.equal(overnight.ambiguous, true); assert.equal(overnight.startTime, null);
});

test('invalid, old or out-of-horizon dates and publication metadata are not events', () => {
  for (const text of ['Réunion le 31 novembre 2026 à 9h.', 'Réunion le 29 février 2027 à 9h.', 'Réunion le 5 septembre à 9h.', 'Réunion le 5 novembre 2028 à 9h.', 'Publié le 29 octobre 2026 à 9h.', 'Envoyé le 29/10/2026 à 9h.', 'Voir https://example.invalid/05/11/2026 à 9h.', 'Réunion le 5/11/26 à 9h.']) assert.deepEqual(extract(text), [], text);
  const [invalidTime] = extract('Réunion le 5 novembre à 18h75.');
  assert.equal(invalidTime.startTime, null); assert.equal(invalidTime.ambiguous, true);
  const [wrongWeekday] = extract('Vendredi 5 novembre 2026 à 9h.');
  assert.equal(wrongWeekday.ambiguous, true);
});

test('implicit years and relative dates use publication rather than scan year or delayed scan date', () => {
  assert.deepEqual(extractEventDates({text: 'Réunion le 5 janvier à 9h.', publishedAt: '2026-12-20T12:00:00Z', now: Date.parse('2027-01-01T12:00:00Z')}), []);
  assert.equal(extractEventDates({text: 'Réunion le 5 janvier 2027 à 9h.', publishedAt: '2026-12-20T12:00:00Z', now: Date.parse('2027-01-01T12:00:00Z')})[0].date, '2027-01-05');
  assert.equal(extract('Réunion demain à 9h.')[0].date, '2026-10-29');
  assert.deepEqual(extract('Réunion demain à 9h.', {publishedAt: '2026-10-20T12:00:00Z'}), []);
  assert.deepEqual(extract('Réunion demain à 9h.', {publishedAt: undefined}), []);
});

test('headline dates deduplicate against precise body dates and extraction is bounded', () => {
  const items = extract('Rencontre le 5 novembre à 18h.', {title: 'Rencontre le 5 novembre'});
  assert.equal(items.length, 1); assert.equal(items[0].startTime, '18:00');
  const many = extract(Array.from({length: 20}, (_, index) => `Rencontre le ${index + 1} décembre à 9h.`).join('\n'));
  assert.equal(many.length, 5); assert.equal(many[0].date, '2026-12-01');
  assert.deepEqual(extract('x'.repeat(31000) + ' le 5 novembre à 18h.'), []);
  const [accent] = extract('Café citoyen le 1er décembre à 9 h 30.');
  assert.equal(accent.date, '2026-12-01'); assert.ok(accent.excerpt.includes('Café'));
});

test('date-dense source text stays bounded before per-date context and timezone work', {timeout: 5000}, () => {
  const repeated = extract('Réunion le 5 novembre à 9h.\n'.repeat(2000));
  assert.equal(repeated.length, 1); assert.equal(repeated[0].date, '2026-11-05');
  // Beyond 128 mentions a source is treated as a long archive, rather than
  // spending unbounded work looking for one final future date among old ones.
  assert.deepEqual(extract('Archives le 1 octobre.\n'.repeat(128) + 'Prochaine réunion le 5 novembre à 9h.'), []);
});

test('Europe/Paris conversion validates dates and refuses nonexistent and duplicate DST hours', () => {
  assert.equal(parisEventInstant('2026-11-05', '18:30'), '2026-11-05T17:30:00.000Z');
  assert.equal(parisEventInstant('2026-06-05', '18:30'), '2026-06-05T16:30:00.000Z');
  assert.equal(parisEventInstant('2026-03-29', '02:30'), null);
  assert.equal(parisEventInstant('2026-10-25', '02:30'), null);
  assert.equal(parisEventInstant('2026-10-25', '03:30'), '2026-10-25T02:30:00.000Z');
  for (const [date, time] of [['2026-02-30', '09:00'], ['2026-11-05', '24:00'], ['2026-11-05', '9:00'], ['2026-11-05', '09:60'], ['invalid', '09:00']]) assert.equal(parisEventInstant(date, time), null);
});
