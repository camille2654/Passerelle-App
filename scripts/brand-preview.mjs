import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.js';
import { passwordHash, random, digest } from '../src/store.js';
import { parisDate, shiftDate } from '../src/work.js';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'passerelle-brand-'));
const baseURL = 'http://127.0.0.1:8022/agenda', tomorrow = shiftDate(parisDate(new Date()), 1);
const subjects = ['Mathématiques', 'Anglais', 'Histoire-géographie'];
const source = [{ date: tomorrow, lessons: subjects.map((label, i) => ({ id: 'fixture-'+i, title: label, subject: {label}, startDateTime: tomorrow+`T${String(8+i*2).padStart(2,'0')}:00:00Z`, endDateTime: tomorrow+`T${String(9+i*2).padStart(2,'0')}:00:00Z`, location: ['B204','A102','C108'][i], canceled:false, teachers:[] })), homeworkAssignments:[{id:'fixture-work',title:'Exercices sur les fonctions',html:'<p>Terminer les exercices 3 et 4 du chapitre.</p>',dueDateTime:tomorrow+'T08:00:00Z',subject:{label:'Mathématiques'},done:false},{id:'fixture-exam',title:'Contrôle de vocabulaire',html:'<p>Réviser les mots du chapitre 2.</p>',dueDateTime:shiftDate(tomorrow,2)+'T09:00:00Z',subject:{label:'Anglais'},done:false}]}];
const {app,store,engine,browsers} = createApp({dataDir,baseURL,bootstrap:false,syncOptions:{clientFactory:async()=>({getAgenda:async(id,start,end)=>source.filter(d=>d.date>=start&&d.date<=end)})},mailOptions:{transportFactory:()=>({verify:async()=>{},close(){},sendMail:async()=>{throw Error('No mail in brand preview')}})}});
store.state.users.push({id:'brand-fixture',name:'Camille',login:'brand-fixture',admin:true,password:passwordHash('temporary-brand-password'),studentId:'fixture',skolengo:store.seal({fixture:true}),enabled:true});store.save();await engine.run('brand-fixture'); const token = random(); store.update('brand-fixture', { feedKey: store.seal(token), feedHash: digest(token) });
const server=app.listen(8022,'127.0.0.1');
server.on('listening',()=>console.log('Brand preview ready on port 8022 with synthetic data'));
async function stop(){await browsers.close();await new Promise(r=>server.close(r));fs.rmSync(dataDir,{recursive:true,force:true});process.exit(0)}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
