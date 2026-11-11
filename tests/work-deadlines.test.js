import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const source=fs.readFileSync(new URL('../public/features.js',import.meta.url),'utf8');
function render(today,work,extra={}){
 const user={today:{date:today},brief:{date:today},work,skolengoConnected:true,subjects:[],...extra};
 const context=vm.createContext({user,state:{schoolYear:{start:'2026-09-01',end:'2027-08-31'}},document:{addEventListener:()=>{}},icon:()=>'',escape:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')});
 vm.runInContext(source,context);return vm.runInContext('features.render(user)',context);
}
const row=(id,due)=>({id,title:id,due,done:false,kind:'homework',subject:{color:'royalblue',label:'Mathématiques'}});
test('deadline groups cross month, year and DST boundaries using the server Paris date',()=>{
 for(const [today,tomorrow,later]of[['2026-12-31','2027-01-01','2027-01-02'],['2027-01-31','2027-02-01','2027-02-02'],['2026-10-25','2026-10-26','2026-10-27']]){
  const work=[row('Future',later),row('Tomorrow',tomorrow),row('Today',today),row('Late','2026-09-02')],before=JSON.stringify(work),html=render(today,work);
  assert.deepEqual([...html.matchAll(/data-work-deadline="([^"]+)"/g)].map(m=>m[1]),['late','today','tomorrow','later']);
  const start=html.indexOf('data-work-deadline="tomorrow"'),end=html.indexOf('data-work-deadline="later"');assert.ok(html.slice(start,end).includes('>Tomorrow</strong>'));assert.ok(!html.slice(start,end).includes('>Future</strong>'));assert.equal(JSON.stringify(work),before);
 }
});
test('default deadlines exclude completed work and keep nearest future dates first',()=>{
 const html=render('2026-11-08',[row('Second','2026-11-12'),{...row('Finished','2026-11-07'),done:true},row('First','2026-11-10')]);
 assert.ok(!html.includes('>Finished</strong>'));assert.ok(html.indexOf('>First</strong>')<html.indexOf('>Second</strong>'));
});

test("an ENT without homework offers manual entry instead of implying data will arrive",()=>{const html=render("2026-11-08",[],{homeworkAvailable:false});assert.ok(html.includes("Votre ENT ne transmet pas les devoirs"));assert.ok(html.includes("data-work-add"));assert.ok(!html.includes("data-home-connect"));});
