import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/agenda-view.js';
const {entries,range,layout,render}=globalThis.PasserelleAgenda;
const date='2026-11-05',course=(id,start,end,extra={})=>({id,title:id,start:date+'T'+start+':00Z',end:date+'T'+end+':00Z',subject:{color:'royalblue'},...extra});
const day=(courses=[],extra={})=>({date,inSchoolYear:true,courses,work:[],study:[],...extra});

test('timetable uses Paris hours and handles the summer/winter change and midnight clipping',()=>{
 assert.equal(entries(day([course('winter','08:00','09:00')]))[0].from,540);
 assert.equal(entries({...day(),date:'2026-09-05',courses:[{...course('summer','08:00','09:00'),start:'2026-09-05T08:00:00Z',end:'2026-09-05T09:00:00Z'}]})[0].from,600);
 const clipped=entries(day([],{personalEvents:[{title:'Nuit',start:'2026-11-04T22:00:00Z',end:'2026-11-05T01:00:00Z'}]}))[0];assert.equal(clipped.from,0);assert.equal(clipped.to,120);
 assert.equal(entries(day([course('other','08:00','09:00',{start:'2026-11-06T08:00:00Z',end:'2026-11-06T09:00:00Z'})])).length,0);
 const repeated={...day(),date:'2026-10-25',personalEvents:[{title:'Heure répétée',start:'2026-10-25T00:30:00Z',end:'2026-10-25T01:30:00Z'}]};assert.equal(entries(repeated).length,1);assert.equal(entries(repeated)[0].timed,false);assert.ok(render({days:[repeated]},{mode:'day'}).includes('Changement d’heure'));
});

test('overlapping appointments get separate lanes; adjacent appointments use the full column',()=>{
 const rows=entries(day([course('a','08:00','10:00'),course('b','09:00','11:00'),course('c','11:00','12:00')])),window=range([day(rows.map(row=>row.raw))]),placed=layout(rows,window);
 assert.deepEqual(placed.map(row=>[row.title,row.lane,row.lanes]),[['a',0,2],['b',1,2],['c',0,1]]);
 assert.equal(placed[0].top,0);assert.equal(placed[0].height,120);
});

test('all-day and invalid entries do not stretch the hourly grid; empty weeks stay compact',()=>{
 const source=day([course('lesson','08:00','09:00')],{personalEvents:[{title:'Toute la journée',allDay:true,start:date+'T00:00:00Z',end:'2026-11-06T00:00:00Z'},{title:'Incomplet',start:'bad',end:'bad'}]});
 assert.equal(range([source]).start,540);assert.equal(range([source]).height,240);assert.equal(range([day()]).height,0);
 const html=render({days:[source]},{mode:'week',today:date});assert.ok(html.includes('Journée entière'));assert.ok(html.includes('Horaire à vérifier'));assert.ok(html.includes('agenda-all-day'));
});

test('daily view keeps cancellation, homework and private events; text is escaped and transport keeps its selected date',()=>{
 const source=day([course('<img onerror=alert(1)>','08:00','09:00',{cancelled:true})],{work:[{kind:'exam',title:'Contrôle de français'}],personalEvents:[{title:'Rendez-vous personnel',calendarTitle:'Perso',start:date+'T10:00:00Z',end:date+'T11:00:00Z'}],travelEvents:[{title:'Bus',start:date+'T07:00:00Z',end:date+'T07:30:00Z'}]});
 const html=render({days:[source]},{mode:'day',selectedDay:date,today:date});assert.ok(html.includes('0 cours'));assert.ok(html.includes('Annulé'));assert.ok(html.includes('Contrôle de français'));assert.ok(html.includes('Rendez-vous personnel'));assert.ok(html.includes('data-smart-travel-date="'+date+'"'));assert.ok(html.includes('&lt;img onerror=alert(1)&gt;'));assert.ok(!html.includes('<img onerror'));assert.ok(!html.includes(' style='));
});

test('subject outlines replace displayed emoji while keeping acronyms and source data intact',()=>{
 const source=day([course('math','07:15','09:05',{title:'📐 MATHEMATIQUES',subject:{emoji:'📐',color:'royalblue'}}),course('language','09:20','10:15',{title:'ALLEMAND LV2',subject:{emoji:'🇩🇪',color:'darkgoldenrod'}}),course('custom','10:15','11:10',{title:'Atelier Jean-Moulin',subject:{emoji:'📚',color:'crimson'}})]);
 const original=structuredClone(source),html=render({days:[source]},{mode:'day',today:date});
 assert.ok(html.includes('class="agenda-entry-title">Mathématiques</strong>'));
 assert.ok(html.includes('class="agenda-entry-title">Allemand LV2</strong>'));
 assert.ok(html.includes('class="agenda-entry-title">Atelier Jean-Moulin</strong>'));
 assert.ok(!html.includes('class="agenda-entry-title">📐'));
 assert.ok(html.includes('agenda-entry-duration">1 h 50'));
 assert.ok(html.includes('data-subject-icon="math"'));
 assert.ok(html.includes('data-subject-icon="languages"'));
 assert.ok(html.includes('data-subject-icon="book"'));
 for(const mode of ['day','week']){const shown=render({days:[source]},{mode,today:date});assert.ok(!/[📐🇩🇪📚]/u.test(shown));}
 assert.deepEqual(source,original);
});

test('daily intervals use the end of overlapping activities and ignore cancelled courses',()=>{
 const source=day([course('long','07:00','10:00'),course('overlap','08:00','09:00'),course('next','11:00','12:00'),course('cancelled','10:00','11:00',{cancelled:true})]);
 const html=render({days:[source]},{mode:'day'});
 assert.equal((html.match(/class="agenda-interval"/g)||[]).length,1);
 assert.ok(html.includes('11:00 – 12:00'));
 assert.ok(html.includes('>1 h</strong>'));
 assert.ok(html.includes('Annulé'));
});

test('visual grouping joins only identical adjacent active courses and retains every source session',()=>{
 const a=course('a','08:00','09:00',{title:'HISTOIRE',location:'P7'}),b=course('b','09:00','10:00',{title:'HISTOIRE',location:'P7'}),c=course('c','10:00','11:00',{title:'HISTOIRE',location:'P8'});
 const source=day([a,b,c]),original=structuredClone(source),rows=globalThis.PasserelleAgenda.groupCourses(entries(source));
 assert.equal(rows.length,2);assert.deepEqual(rows[0].members.map(row=>row.id),['a','b']);assert.equal(rows[0].raw.end,b.end);assert.deepEqual(source,original);
 const changed=globalThis.PasserelleAgenda.groupCourses(entries(source),[{entity:'course',eventId:'b',type:'updated',at:1,before:{location:'P8'},after:{location:'P7'}}]);assert.equal(changed.length,3);
 assert.equal(globalThis.PasserelleAgenda.groupCourses(entries(day([a,{...b,cancelled:true}]))).length,2);
});


test('daily breaks distinguish recess and lunch using Paris hours without creating gaps around adjacent courses',()=>{
 const source=day([course('morning','07:15','09:05'),course('before-lunch','09:20','11:10'),course('afternoon','12:05','13:55'),course('last','14:10','16:00')]);
 const before=structuredClone(source),html=render({days:[source]},{mode:'day'});
 assert.equal((html.match(/class="agenda-interval"/g)||[]).length,3);
 assert.equal((html.match(/<span>Récréation<\/span>/g)||[]).length,2);
 assert.equal((html.match(/<span>Pause déjeuner<\/span>/g)||[]).length,1);
 assert.equal((html.match(/>15 min<\/strong>/g)||[]).length,2);
 assert.ok(html.includes('>55 min</strong>'));
 for(const [end,start,label] of [['10:00','12:00','Pause déjeuner'],['12:00','13:00','Pause déjeuner'],['09:30','10:30','Pause'],['13:00','14:00','Pause'],['11:00','11:15','Récréation']]){
  const gap=render({days:[day([course('before','06:00',end),course('after',start,'17:00')])]},{mode:'day'});
  assert.ok(gap.includes('<span>'+label+'</span>'),end+' → '+start+' in UTC');
 }
 assert.deepEqual(source,before);
 const adjacent=render({days:[day([course('a','07:00','08:00'),course('b','08:00','09:00'),course('c','09:03','10:00')])]},{mode:'day'});
 assert.ok(!adjacent.includes('class="agenda-interval"'));
});

test('breaks follow the last occupied activity even with overlaps, private events and cancelled lessons',()=>{
 const source=day([course('long','07:00','10:00'),course('nested','08:00','09:00'),course('cancelled','10:00','11:00',{cancelled:true}),course('next','11:00','12:00')],{personalEvents:[{title:'Rendez-vous',start:date+'T09:30:00Z',end:date+'T10:45:00Z'}]});
 const html=render({days:[source]},{mode:'day'});
 assert.equal((html.match(/class="agenda-interval"/g)||[]).length,1);
 assert.ok(html.includes('<span>Intervalle</span><strong>15 min</strong>'));
 assert.ok(html.includes('11:45 – 12:00'));
 assert.ok(!html.includes('<span>Pause déjeuner</span>'));
 assert.ok(!html.includes('<span>Récréation</span>'));
});
