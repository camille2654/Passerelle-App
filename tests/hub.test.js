import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {activityPatch, acknowledgeVisit, changeView, assignmentChanges} from '../src/activity.js';
import {weeklySummary} from '../src/insights.js';
import {searchOwn} from '../src/hub.js';
import {hubFixture, fixtureNow} from './hub-fixture.js';

test('agenda visits acknowledge only the displayed cursor; concurrent sync, time equality and other accounts remain isolated', async () => {
  const f = await hubFixture(); try {
    const user = f.store.user('a'), first = (await f.request('activity')).body;
    assert.equal(first.firstVisit, true); assert.equal((await f.request('activity/visit', {token: first.token}, 'b')).status, 409);
    assert.equal((await f.request('activity/visit', {token: first.token}, 'a', 'https://other.invalid')).status, 403);
    assert.equal((await f.request('activity/visit', {token: first.token})).status, 200);
    f.store.update('a', activityPatch(user, [{id: 'one', at: fixtureNow, title: 'Salle déplacée', date: '2026-11-03', entity: 'course', type: 'updated'}], fixtureNow));
    const displayed = (await f.request('activity')).body; assert.equal(displayed.count, 1);
    f.store.update('a', activityPatch(user, [{id: 'two', at: fixtureNow, title: 'Nouveau devoir', date: '2026-11-03', entity: 'work', type: 'added'}], fixtureNow));
    await f.request('activity/visit', {token: displayed.token}); const after = (await f.request('activity')).body;
    assert.equal(after.count, 1); assert.equal(after.items[0].id, 'two');
    await f.request('status'); assert.equal((await f.request('activity')).body.count, 1);
    await f.request('activity/visit', {token: first.token}); assert.equal((await f.request('activity')).body.count, 1);
    assert.equal((await f.request('activity', undefined, 'b')).body.count, 0);
  } finally {await f.close();}
});
test('history distinguishes first visit, bounded history gaps and an expired or wrong-student acknowledgement', async () => {
  const f = await hubFixture(); try {
    const user = f.store.user('a'), first = changeView(f.store, user, fixtureNow); acknowledgeVisit(f.store, user, first.token, fixtureNow);
    const rows = Array.from({length: 1005}, (_, index) => ({id: 'change-' + index, title: 'Cours', at: fixtureNow, date: '2026-11-03'}));
    f.store.update('a', activityPatch(user, rows, fixtureNow)); const view = changeView(f.store, user, fixtureNow);
    assert.equal(view.truncated, true); assert.equal(view.items.length, 100); assert.equal(view.count, 1000);
    assert.equal(acknowledgeVisit(f.store, user, view.token, fixtureNow + 11 * 60000), false);
    user.studentId = 'another-student'; assert.equal(acknowledgeVisit(f.store, user, view.token, fixtureNow), false); assert.equal(changeView(f.store, user, fixtureNow).firstVisit, true);
  } finally {await f.close();}
});
test('new and edited homework generate changes while completion-only source updates do not', () => {
  const work = {id: 'work', title: 'Chapitre', details: 'Exercices', due: '2026-11-03', subjectLabel: 'Maths', done: false};
  assert.equal(assignmentChanges([work], [{...work, done: true}], fixtureNow).length, 0);
  assert.equal(assignmentChanges([work], [{...work, due: '2026-11-04'}], fixtureNow)[0].type, 'updated');
  assert.equal(assignmentChanges([], [work], fixtureNow)[0].type, 'added');
});
test('search uses accents, private local notes, cards and cached news without exposing another student', async () => {
  const f = await hubFixture(); try {
    const user = f.store.user('a'); user.courseNotes = [{id: 'note', studentId: user.studentId, subjectLabel: 'Français', text: 'Réviser la poésie'}, {id: 'secret', studentId: 'other', subjectLabel: 'Français', text: 'secret-other-student'}];
    user.flashcards = [{id: 'card', studentId: user.studentId, question: 'Définition de poésie', answer: 'Une forme littéraire', subjectLabel: 'Français'}];
    assert.equal(searchOwn(user, 'reviser poesie').total, 1); assert.equal(searchOwn(user, 'poesie').total, 2); assert.equal(searchOwn(user, 'secret-other').total, 0);
    assert.equal((await f.request('search', {q:'fonctions'}, 'b')).body.items[0].id, 'work-b');
    assert.equal((await f.request('search/news/open', {id: 'foreign-id'})).status, 404);
  } finally {await f.close();}
});
test('flashcards persist, space correct answers, repeat difficult ones, reject duplicate reviews and stay private', async () => {
  const f = await hubFixture(); try {
    const created = await f.request('cards', {subjectLabel: 'Mathématiques', question: '<img src=x onerror=alert(1)> Une fonction affine ?', answer: 'f(x) = ax + b'});
    assert.equal(created.status, 200); const id = created.body.id;
    assert.equal((await f.request('cards/' + id + '/review', {rating: 'good', revision: 0}, 'b')).status, 404);
    const reviewed = await f.request('cards/' + id + '/review', {rating: 'good', revision: 0}); assert.equal(reviewed.body.dueAt, fixtureNow + 86400000);
    assert.equal((await f.request('cards/' + id + '/review', {rating: 'good', revision: 0})).status, 409);
    assert.equal((await f.request('cards/' + id + '/review', {rating: 'again', revision: 1})).body.dueAt, fixtureNow + 600000);
    assert.equal((await f.request('cards', undefined, 'b')).body.cards.length, 0);
    assert.equal(JSON.parse(fs.readFileSync(f.store.file)).users[0].flashcards.length, 1);
    f.store.user('a').studentId = 'other'; assert.equal((await f.request('cards')).body.cards.length, 0);
  } finally {await f.close();}
});
test('weekly focus counts active time, excludes pauses and early-stop remainder, without inventing earlier completions', async () => {
  const f = await hubFixture(); try {
    await f.request('personal/focus', {action: 'start', key: 'work:work-a', minutes: 25});
    f.setNow(fixtureNow + 2 * 60000); await f.request('personal/focus', {action: 'pause'});
    f.setNow(fixtureNow + 12 * 60000); await f.request('personal/focus', {action: 'resume'});
    f.setNow(fixtureNow + 15 * 60000); await f.request('personal/focus', {action: 'stop'});
    let summary = (await f.request('weekly?date=2026-11-02')).body;
    assert.equal(summary.totals.focusMinutes, 5); assert.equal(summary.totals.completed, 0);
    await f.request('work/work-a', {done: true}); summary = (await f.request('weekly?date=2026-11-02')).body; assert.equal(summary.totals.completed, 1);
    await f.request('work/work-a', {done: false}); assert.equal((await f.request('weekly?date=2026-11-02')).body.totals.completed, 0);
    const old = weeklySummary({...f.store.user('a'), workOverrides: {'work-a': {done: true}}}, '2026-11-02', f.now()); assert.equal(old.totals.completed, 0);
    assert.equal((await f.request('weekly?date=2026-02-30')).status, 400);
  } finally {await f.close();}
});
test('focus time crossing Paris midnight is assigned to the correct day down to the second', () => {
  const start = Date.parse('2026-11-02T22:59:30Z'), end = start + 120000;
  const view = weeklySummary({id: 'a', studentId: 'student-a', focusHistory: [{id: 'segment', studentId: 'student-a', start, end}]}, '2026-11-02', end);
  assert.equal(view.days[0].focusSeconds, 30); assert.equal(view.days[1].focusSeconds, 90); assert.equal(view.totals.focusMinutes, 2);
});
test('support routes encrypted reports to administrators, redacts secrets, isolates students and returns replies', async () => {
  const f = await hubFixture(); try {
    const created = await f.request('support', {category: 'pronote', message: 'Impossible de connecter Pronote. Lien https://example.invalid/calendars/private.ics et token=fixture-secret contact fixture@example.invalid', page: 'hub'});
    assert.equal(created.status, 200); const id = created.body.id;
    assert.equal((await f.request('admin/support')).status, 403); assert.equal((await f.request('support', undefined, 'b')).body.tickets.length, 0);
    let ticket = (await f.request('admin/support', undefined, 'admin')).body.tickets[0];
    assert.equal(ticket.userId, 'a'); assert.ok(ticket.message.includes('[lien masqué]')); assert.ok(!ticket.message.includes('fixture-secret')); assert.ok(!JSON.stringify(ticket.diagnostics).includes('fonctions'));
    assert.ok(!fs.readFileSync(f.store.file, 'utf8').includes('Impossible de connecter'));
    assert.equal((await f.request('admin/support/' + id, {status: 'in_progress', reply: 'Nous examinons votre connexion.'}, 'admin')).status, 200);
    ticket = (await f.request('support')).body.tickets[0]; assert.equal(ticket.status, 'in_progress'); assert.equal(ticket.replies[0].text, 'Nous examinons votre connexion.');
    assert.equal((await f.request('status')).body.user.support.unread, 1);
    await f.request('support/read', {at: f.now()}); assert.equal((await f.request('status')).body.user.support.unread, 0);
    assert.equal((await f.request('admin/support/' + id, {status: 'resolved'}, 'b')).status, 403);
    await f.request('admin/support/' + id, {status: 'resolved'}, 'admin'); assert.equal((await f.request('admin/support', undefined, 'admin')).body.open, 0);
  } finally {await f.close();}
});
