import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createApp} from '../src/server.js';
import {random, digest} from '../src/store.js';
import {skolengoClient} from '../src/skolengo.js';
import {portalForURL} from '../src/ent-providers.js';
import {subjectFor} from '../src/subjects.js';
import {schoolClient} from './school-fixture.js';

export const fixtureNow = Date.parse('2026-11-02T17:00:00Z');
export const qrFixture = {url: 'https://1234567a.index-education.net/pronote/mobile.eleve.html', login: 'ab'.repeat(32), jeton: 'cd'.repeat(32)};
export const credentialFixture = {pronote_url: qrFixture.url + '?login=true', username: 'private-pronote-identity', password: 'private-mobile-token', uuid: 'fixture-app', client_identifier: 'private-client-identifier'};
export function pronoteSnapshot() {
  return {identity: {id: 'pronote-student', name: 'Camille Fixture', className: 'Première', school: 'Établissement de démonstration'}, periods: [{id: 'period-one', label: 'Premier trimestre', start: '2026-09-01', end: '2026-12-20'}], window: {start: '2026-09-01', end: '2027-08-31'}, sections: {
    grades: {state: 'available', data: [{period: 'period-one', grades: [{id: 'grade-one', subject: 'Mathématiques', mark: '16,5', scale: '20', date: '2026-11-02', title: 'Fonctions affines', coefficient: '2', classAverage: '12,25'}], averages: [{subject: 'Mathématiques', mark: '15,5', scale: '20', classAverage: '13'}]}]},
    reports: {state: 'available', data: [{period: 'period-one', label: 'Premier trimestre', comments: ['Un trimestre régulier.'], subjects: [{name: 'Mathématiques', mark: '15,5', comments: ['Bon travail.'], teachers: ['Enseignant fixture']}]}]},
    attendance: {state: 'available', data: [{id: 'absence-one', start: '2026-10-12T06:00:00Z', end: '2026-10-12T07:00:00Z', type: 'ABSENCE', justified: true, reasons: ['Motif connu']}]},
    homework: {state: 'available', data: [{id: 'pr-work', subject: 'Mathématiques', details: 'Exercices sur les fonctions', date: '2026-11-03', done: false}]},
    courses: {state: 'available', data: [{id: 'pr-course', subject: 'Mathématiques', start: '2026-11-03T08:00:00Z', end: '2026-11-03T09:00:00Z', location: 'B203', cancelled: false, teachers: [], memo: 'Prévoir le manuel', test: false}]}
  }};
}
export async function hubFixture(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-hub-')); let now = options.now || fixtureNow;
  const controls = {outage: false, rotations: 0, snapshot: pronoteSnapshot(), failAfterRotation: false};
  const baseURL = options.baseURL || 'http://127.0.0.1/agenda';
  const source = createApp({dataDir: dir, baseURL, bootstrap: false, clock: () => now,
    schoolOptions: {clientFactory: async (_store, user) => {if(user.skolengo&&_store.open(user.skolengo).provider==='ent-pronote')return skolengoClient(_store,user);const c = schoolClient(user); for (const method of ['getEvaluationSettings', 'getPeriodicReportsFiles', 'getAbsenceFiles']) c[method] = async () => {throw Object.assign(new Error('not configured'), {name: 'NO_SCHOOLING_SOLUTION_CONFIGURED'});}; return c;}},
    pronoteOptions: {worker: async (_payload, save) => {controls.rotations++; save({...credentialFixture, password: 'private-mobile-token-' + controls.rotations}); if (controls.failAfterRotation) throw new Error('SOURCE_UNAVAILABLE'); if (controls.outage) throw new Error('AUTH_EXPIRED'); return structuredClone(controls.snapshot);}}
  });
  const subject = subjectFor({label: 'Mathématiques'});
  for (const [id, admin] of [['a', false], ['b', false], ['admin', true]]) source.store.state.users.push({id, admin, name: id === 'a' ? 'Camille' : id === 'admin' ? 'Administration' : 'Autre élève', login: id, studentId: 'student-' + id, students: [{id: 'student-' + id, name: id === 'a' ? 'Camille ENT' : 'Autre élève'}], schoolName: 'Lycée fixture', skolengo: source.store.seal({school: {id: 'school', name: 'Lycée fixture'}}), assignments: [{id: 'work-' + id, title: 'Exercices sur les fonctions', details: 'Exercices sur les fonctions', due: '2026-11-03', subjectLabel: 'Mathématiques', source: 'skolengo'}], calendarEvents: {['course-' + id]: {id: 'course-' + id, title: 'Mathématiques', rawTitle: 'Mathématiques', date: '2026-11-03', start: '2026-11-03T08:00:00Z', end: '2026-11-03T09:00:00Z', location: 'A101', subject, cancelled: false}}, lastSync: now, workLastSync: now, changes: []});
  const cookies = {};
  for (const id of ['a', 'b', 'admin']) {const token = random(); cookies[id] = 'agenda_session=' + token; source.store.state.sessions.push({hash: digest(token), userId: id, expires: Date.now() + 3600000});}
  source.store.save(); const server = source.app.listen(options.port || 0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  return {...source, dir, controls, cookies, server, async captureENT(who='a',overrides={},options={}){try{return {status:200,body:await source.pronote.connectENT(source.store.user(who),{url:qrFixture.url,html:'<html><body onload="Start({a:3,e:\'synthetic-ent-user\',f:\'synthetic-ent-secret\',h:1})"></body></html>',cookies:[],...overrides},portalForURL('https://ent.monlycee.net/'),options)}}catch(error){return {status:error.status||500,body:{error:error.message}}}}, setNow: value => {now = value;}, now: () => now, async request(route, body, who = 'a', origin = new URL(baseURL).origin) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/agenda/api/' + route, {headers: {cookie: cookies[who] || '', origin, ...(body !== undefined ? {'Content-Type': 'application/json'} : {})}, ...(body !== undefined ? {method: 'POST', body: JSON.stringify(body)} : {})});
    return {status: response.status, body: await response.json()};
  }, async close() {await source.browsers.close(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, {recursive: true, force: true});}};
}
