import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hubFixture,fixtureNow} from './hub-fixture.js';
import {subjectFor} from '../src/subjects.js';
import {discoverySubjects,searchDiscovery,subjectDetail} from '../src/discovery.js';

const maths=subjectFor({label:'Mathématiques'}), french=subjectFor({label:'Français'});
test('global search filters before limiting results, reports real facet counts and ignores accents',()=>{
  const user={calendarEvents:Object.fromEntries(Array.from({length:70},(_,i)=>[i,{id:'c'+i,title:'Mathématiques',subject:maths,location:'A101',date:'2026-11-03'}]))};
  const documents=[{id:'doc',title:'Mathématiques — fonctions.pdf',provider:'Copie privée',type:'favorite',available:true,subjectKey:maths.key,subjectLabel:maths.label}];
  const all=searchDiscovery(user,'mathematiques',{documents});assert.equal(all.total,72);assert.equal(all.items.length,60);assert.equal(all.items[0].kind,'subject');assert.equal(all.counts.document,1);assert.equal(all.counts.course,70);
  const only=searchDiscovery(user,'mathematiques',{documents,kind:'document'});assert.equal(only.items.length,1);assert.equal(only.total,1);assert.equal(only.allTotal,72);assert.equal(only.items[0].id,'doc');assert.equal(only.items[0].target.type,'favorite');
  assert.equal(searchDiscovery(user,{q:'math'}).total,0);assert.equal(searchDiscovery(user,' ').total,0);assert.equal(searchDiscovery(user,'x').total,0);
});
test('subject catalogue includes only current student notes and cards and keeps distinct subjects',()=>{
  const user={studentId:'current',courseNotes:[{studentId:'current',subjectLabel:'Français'},{studentId:'other',subjectLabel:'Secret étranger'}],flashcards:[{studentId:'current',subjectLabel:'Philosophie'},{studentId:'other',subjectLabel:'Privé'}],assignments:[{id:'one',title:'Exercice',due:'2026-11-04',subjectLabel:'Mathématiques expertes'}],calendarEvents:{one:{subject:maths}}};
  assert.deepEqual(discoverySubjects(user).map(row=>row.label),['Français','Mathématiques','Mathématiques expertes','Philosophie']);
  assert.equal(searchDiscovery(user,'secret').total,0);assert.equal(searchDiscovery(user,'privé').total,0);
});
test('subject view selects current and future active lessons, marks cancellations and isolates work and notes',()=>{
  const now=Date.parse('2026-11-03T08:30:00Z');
  const course=(id,start,end,cancelled=false)=>({id,title:'Mathématiques',subject:maths,date:'2026-11-03',start:'2026-11-03T'+start+':00Z',end:'2026-11-03T'+end+':00Z',cancelled});
  const user={studentId:'a',calendarEvents:{past:course('past','06:00','07:00'),active:course('active','08:00','09:00'),cancelled:course('cancelled','10:00','11:00',true)},assignments:[{id:'test',title:'Évaluation',due:'2026-11-04',subjectLabel:maths.label,detectedExam:true},{id:'done',title:'Terminé',due:'2026-11-03',subjectLabel:maths.label,done:true},{id:'french',title:'Poésie',due:'2026-11-03',subjectLabel:french.label}],courseNotes:[{id:'n',studentId:'a',subjectLabel:maths.label,text:'Manuel'},{id:'other',studentId:'b',subjectLabel:maths.label,text:'private-other'},{id:'done',studentId:'a',subjectLabel:maths.label,text:'private-done',done:true}],flashcards:[{studentId:'a',subjectLabel:maths.label,dueAt:now-1},{studentId:'b',subjectLabel:maths.label,dueAt:now-1}]};
  const view=subjectDetail(user,maths.key,[{id:'d',subjectKey:maths.key},{id:'foreign',subjectKey:french.key}],now);
  assert.equal(view.nextCourse.id,'active');assert.deepEqual(view.courses.map(row=>row.id),['active','cancelled']);assert.equal(view.courseCount,2);assert.equal(view.workCount,1);assert.equal(view.work[0].kind,'exam');assert.equal(view.completedCount,1);assert.deepEqual(view.notes,[{id:'n',text:'Manuel'}]);assert.equal(view.cards.total,1);assert.equal(view.cards.due,1);assert.equal(view.documents.length,1);assert.ok(!JSON.stringify(view).includes('private-other'));assert.throws(()=>subjectDetail(user,'foreign',[],now),/profil/);
});
test('search and subject snapshots stay local, do not save state or expose credentials, and reject anonymous callers',async()=>{
  const f=await hubFixture();try{
    let calls=0;f.school.load=async()=>{calls++;throw new Error('Network must not be used');};await f.request('status');await f.request('status',undefined,'b');const before=fs.readFileSync(f.store.file);
    const result=await f.request('search',{q:'fonctions'});assert.equal(result.status,200);assert.equal(result.body.items[0].id,'work-a');
    const directory=await f.request('library/subjects');assert.equal(directory.status,200);assert.equal(directory.body.subjects[0].subject.label,maths.label);
    assert.equal((await f.request('library/work/work-a',undefined,'b')).status,404);assert.equal((await f.request('library/work/work-a')).body.id,'work-a');
    const detail=await f.request('library/subjects/'+maths.key);assert.equal(detail.status,200);assert.equal(detail.body.work[0].id,'work-a');
    assert.equal(calls,0);assert.deepEqual(fs.readFileSync(f.store.file),before);
    for(const secret of ['skolengo','password','feedKey','sourceId','private-mobile-token'])assert.ok(!JSON.stringify(detail.body).includes('"'+secret+'"'));
    for(const route of ['library/subjects','library/subjects/'+maths.key])assert.equal((await f.request(route,undefined,'anonymous')).status,401);
    assert.equal((await f.request('search',{q:'abc',kind:'invalid'})).status,400);
    assert.equal((await f.request('library/subjects/'+'f'.repeat(20))).status,404);
  }finally{await f.close();}
});
test('document associations require the current account and school scope and survive a process-independent read',async()=>{
  const f=await hubFixture();try{
    const user=f.store.user('a'),saved=f.favorites.save(user,Buffer.from('unsearchable-secret-content'),'Fonctions privées.pdf','Personnel').item;
    const profile=(await f.request('library/subjects/'+maths.key)).body,route='library/documents/'+saved.id+'/subject';
    const payload={accountId:'a',scope:profile.scope,subjectKey:maths.key};
    assert.equal((await f.request(route,{...payload,accountId:'b'})).status,409);
    assert.equal((await f.request(route,payload,'b')).status,409);
    assert.equal((await f.request(route,{...payload,scope:'old-profile'})).status,409);
    assert.equal((await f.request(route,{...payload,subjectKey:'f'.repeat(20)})).status,404);
    assert.equal((await f.request(route,payload,'a','https://foreign.invalid')).status,403);
    assert.equal((await f.request(route,payload)).status,200);
    let view=(await f.request('library/subjects/'+maths.key)).body;assert.equal(view.documents[0].title,saved.name);assert.equal(view.unassignedDocuments.length,0);
    assert.equal(JSON.parse(fs.readFileSync(f.store.file)).users.find(row=>row.id==='a').subjectDocumentLinks[0].favoriteId,saved.id);
    assert.equal((await f.request('search',{q:'fonctions',kind:'document'})).body.total,1);
    assert.equal((await f.request('search',{q:'unsearchable-secret-content'})).body.total,0);
    assert.equal((await f.request('search',{q:'privées',kind:'document'},'b')).body.total,0);
    user.studentId='new-student';assert.equal((await f.request('search',{q:'privées',kind:'document'})).body.total,0);assert.equal((await f.request(route,payload)).status,409);user.studentId='student-a';
    assert.equal((await f.request(route,{...payload,subjectKey:null})).status,200);
    view=(await f.request('library/subjects/'+maths.key)).body;assert.equal(view.documents.length,0);assert.equal(view.unassignedDocuments.length,1);
  }finally{await f.close();}
});
test('work document links follow merged work subjects and removed documents do not become downloadable',async()=>{
  const f=await hubFixture();try{
    const user=f.store.user('a'),saved=f.favorites.save(user,Buffer.from('document'),'Cours fonctions.pdf','Personnel').item;
    const row=f.resources.add(user,{title:'Chapitre fonctions',favoriteId:saved.id,workId:'work-a'}).item;
    let view=(await f.request('library/subjects/'+maths.key)).body;assert.equal(view.documents[0].id,row.id);assert.equal(view.documents[0].type,'resource');assert.equal(view.documents[0].available,true);
    f.favorites.remove(user,saved.id);view=(await f.request('library/subjects/'+maths.key)).body;assert.equal(view.documents[0].available,false);
    const result=(await f.request('search',{q:'chapitre',kind:'document'})).body;assert.equal(result.items[0].available,false);assert.equal((await f.request('work-resources/'+row.id+'/open')).status,404);
  }finally{await f.close();}
});

test('a document whose former subject disappeared can be associated again without exposing old profiles',async()=>{
 const f=await hubFixture();try{
  const user=f.store.user('a'),saved=f.favorites.save(user,Buffer.from('unique orphan file'),'Ancien cours.pdf','Personnel').item;
  user.subjectDocumentLinks=[{scope:f.favorites.scope(user),favoriteId:saved.id,subjectLabel:'Matière retirée'}];
  const view=(await f.request('library/subjects/'+maths.key)).body;assert.equal(view.unassignedDocuments[0].id,saved.id);
  assert.equal((await f.request('library/documents/'+saved.id+'/subject',{accountId:'a',scope:view.scope,subjectKey:maths.key})).status,200);
  assert.equal(user.subjectDocumentLinks.length,1);assert.equal(user.subjectDocumentLinks[0].subjectLabel,maths.label);
 }finally{await f.close();}
});

test('a note submitted from an old account or student is rejected before any write',async()=>{
 const f=await hubFixture();try{
  const body={text:'Note privée liée au profil',subjectLabel:maths.label,accountId:'a',studentId:'student-a'};
  assert.equal((await f.request('personal/notes',body,'b')).status,409);
  assert.equal((await f.request('personal/notes',{...body,studentId:'previous-student'})).status,409);
  assert.equal(f.store.user('a').courseNotes,undefined);assert.equal(f.store.user('b').courseNotes,undefined);
  assert.equal((await f.request('personal/notes',body)).status,200);assert.equal(f.store.user('a').courseNotes[0].studentId,'student-a');
 }finally{await f.close();}
});
