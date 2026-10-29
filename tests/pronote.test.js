import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validatePronoteURL,normalizePronoteAssignments} from '../src/pronote.js';
import {userWork} from '../src/work.js';
import {hubFixture, fixtureNow, qrFixture, pronoteSnapshot} from './hub-fixture.js';

test('Pronote accepts individual hosted student instances and rejects arbitrary servers, parents, credentials and redirect-shaped URLs', () => {
  for (const host of ['1234567a', 'another-school', 'demo']) assert.equal(validatePronoteURL('https://' + host + '.index-education.net/pronote/mobile.eleve.html').hostname, host + '.index-education.net');
  for (const url of ['http://demo.index-education.net/pronote/eleve.html', 'https://127.0.0.1/pronote/eleve.html', 'https://demo.index-education.net.evil.invalid/pronote/eleve.html', 'https://demo.index-education.net:8020/pronote/eleve.html', 'https://user:pass@demo.index-education.net/pronote/eleve.html', 'https://demo.index-education.net/pronote/parent.html', 'https://demo.index-education.net/other/eleve.html']) assert.throws(() => validatePronoteURL(url));
});
async function connect(f) { const start = await f.request('pronote/connect', {qr: qrFixture, pin: '1234'}); assert.equal(start.status, 200); assert.equal((await f.request('pronote/confirm', {candidate: start.body.candidate, confirm: true})).status, 200); return start.body; }
test('Pronote requires explicit same-student confirmation and protects credentials, imported records and source provenance', async () => {
  const f = await hubFixture(); try {
    assert.equal((await f.request('pronote/connect', {qr: {...qrFixture, url: 'https://localhost/pronote/eleve.html'}, pin: '1234'})).status, 400);
    const start = await f.request('pronote/connect', {qr: JSON.stringify(qrFixture), pin: '1234'}); assert.equal(start.status, 200); assert.equal(start.body.entStudent, 'Camille ENT');
    assert.equal((await f.request('pronote')).body.linked, false); assert.equal(userWork(f.store.user('a')).length, 1);
    assert.equal((await f.request('pronote/confirm', {candidate: start.body.candidate, confirm: true}, 'b')).status, 409);
    assert.equal((await f.request('pronote/confirm', {candidate: start.body.candidate, confirm: false})).status, 409);
    assert.equal((await f.request('pronote/confirm', {candidate: start.body.candidate, confirm: true})).status, 200);
    const work = userWork(f.store.user('a')); assert.equal(work.length, 1); assert.deepEqual(work[0].sources, ['ENT', 'Pronote']);
    const status = (await f.request('status')).body; assert.ok(!JSON.stringify(status).includes('private-mobile-token')); assert.ok(!fs.readFileSync(f.store.file, 'utf8').includes('private-mobile-token'));
    assert.equal((await f.request('pronote', undefined, 'b')).body.connected, false);
    assert.equal((await f.request('pronote/data')).body.conflicts.length, 1);
  } finally {await f.close();}
});
test('Pronote restores missing ENT grades, attendance and structured reports with source attribution, without fake detail controls', async () => {
  const f = await hubFixture(); try {
    assert.equal((await f.request('capabilities')).body.features.grades.state, 'unavailable'); await connect(f);
    assert.equal((await f.request('capabilities')).body.features.grades.source, 'Pronote');
    const grades = (await f.request('school/grades')).body; assert.equal(grades.source, 'Pronote'); assert.equal(grades.items[0].grades[0].mark, 16.5); assert.equal(grades.items[0].grades[0].ref, null);
    assert.equal((await f.request('school/reports')).body.reports[0].subjects[0].mark, '15,5');
    assert.equal((await f.request('school/attendance')).body.items[0].status, 'JUSTIFIED');
    assert.equal((await f.request('school/grades?period=foreign')).status, 400);
    await f.request('pronote/disconnect', {}); assert.equal((await f.request('capabilities')).body.features.grades.state, 'unavailable');
  } finally {await f.close();}
});
test('source failures preserve the last snapshot and each immediately rotated token; a changed student disables association', async () => {
  const f = await hubFixture(); try {
    await connect(f); f.controls.failAfterRotation = true; f.setNow(fixtureNow + 600000);
    const failed = await f.request('pronote/sync', {}); assert.equal(failed.status, 502);
    assert.equal(f.store.open(f.store.user('a').pronote).password, 'private-mobile-token-2');
    assert.equal((await f.request('school/grades')).body.items[0].grades[0].mark, 16.5); assert.ok((await f.request('school/grades')).body.warning);
    f.store.user('a').studentId = 'sibling'; assert.equal((await f.request('pronote')).body.linked, false); assert.equal((await f.request('pronote/data')).body.courses.length, 0); assert.equal((await f.request('pronote/sync', {})).status, 409);
  } finally {await f.close();}
});
test('ambiguous homework is retained and partial unsupported sections do not advertise nonexistent data', async () => {
  const f = await hubFixture(); try {
    f.controls.snapshot = pronoteSnapshot(); f.controls.snapshot.sections.homework.data[0].details = 'Exercices sur les fonctions\nQuestion supplémentaire'; f.controls.snapshot.sections.reports = {state: 'unavailable'};
    await connect(f); const work = userWork(f.store.user('a')); assert.equal(work.length, 2); assert.equal(work.find(item => item.source === 'pronote').possibleDuplicate, true);
    assert.equal((await f.request('capabilities')).body.features.reports.state, 'unavailable');
  } finally {await f.close();}
});
test('pending confirmation survives reload and each user can consult a distant published week of their own school year', async () => {
  const f = await hubFixture(); try {
    f.controls.snapshot.sections.courses.data.push({id: 'future-course', subject: 'Français', start: '2027-04-06T07:00:00Z', end: '2027-04-06T08:00:00Z', location: 'C105', cancelled: false});
    const start = await f.request('pronote/connect', {qr: qrFixture, pin: '1234'});
    const pending = (await f.request('pronote')).body.pending; assert.equal(pending.candidate, start.body.candidate); assert.equal((await f.request('pronote', undefined, 'b')).body.pending, null);
    await f.request('pronote/confirm', {candidate: pending.candidate, confirm: true});
    assert.ok(!(await f.request('pronote/data')).body.courses.some(item => item.title === 'Français'));
    assert.equal((await f.request('pronote/data?date=2027-04-05')).body.courses[0].title, 'Français');
    assert.equal((await f.request('pronote/data?date=2027-02-30')).status, 400);
  } finally {await f.close();}
});
test('session references can rotate without disconnecting the student, losing completion or creating new homework changes', async () => {
  const f = await hubFixture(); try {
    const owner=f.store.user('a');owner.assignments=[];await connect(f);
    const id=userWork(owner)[0].id,period=(await f.request('school/grades')).body.period;
    await f.request('work/'+id,{done:true});
    f.controls.snapshot.identity.id='volatile-student-reference';
    f.controls.snapshot.periods[0].id='volatile-period-reference';
    f.controls.snapshot.sections.grades.data[0].period='volatile-period-reference';
    f.controls.snapshot.sections.homework.data[0].id='volatile-homework-reference';
    f.setNow(fixtureNow+600000);assert.equal((await f.request('pronote/sync',{})).status,200);
    assert.equal(userWork(owner)[0].id,id);assert.equal(userWork(owner)[0].done,true);
    assert.equal((await f.request('school/grades')).body.period,period);
    assert.equal((owner.activityLog||[]).filter(item=>item.entity==='work').length,0);
    f.controls.snapshot.sections.homework.data[0].id='another-volatile-reference';
    f.controls.snapshot.sections.homework.data[0].date='2026-11-04';
    f.setNow(fixtureNow+1200000);await f.request('pronote/sync',{});
    assert.equal(userWork(owner)[0].id,id);assert.equal(userWork(owner)[0].due,'2026-11-04');
    assert.equal(owner.activityLog.at(-1).type,'updated');
    f.controls.snapshot.identity.name='Une autre personne';assert.equal((await f.request('pronote/sync',{})).status,502);
    assert.equal(owner.pronoteNeedsReconnect,true);assert.equal(owner.pronoteSnapshot.identity.name,'Camille Fixture');
  } finally {await f.close();}
});
test('personal homework identifiers are isolated by student, instance and academic year',()=>{
  const snapshot=pronoteSnapshot(),user={id:'a',studentId:'student-a'};
  const first=normalizePronoteAssignments(user,snapshot,'https://school-one.index-education.net');
  const second=normalizePronoteAssignments(user,snapshot,'https://school-two.index-education.net');
  const next=normalizePronoteAssignments(user,{...snapshot,window:{start:'2027-09-01',end:'2028-08-31'}},'https://school-one.index-education.net');
  assert.notEqual(first.assignments[0].id,second.assignments[0].id);assert.notEqual(first.assignments[0].id,next.assignments[0].id);
});
