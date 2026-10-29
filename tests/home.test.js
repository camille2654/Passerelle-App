import test from 'node:test';
import assert from 'node:assert/strict';
import {homeContext} from '../src/home.js';
const date='2026-11-03',lesson=(id,start,end,cancelled=false)=>({id,date,start:date+'T'+start+':00+01:00',end:date+'T'+end+':00+01:00',title:id,location:'B204',cancelled}),user={calendarEvents:{morning:lesson('Maths','08:00','09:00'),next:lesson('Sciences','10:00','11:00'),cancelled:lesson('Anglais','17:00','18:00',true)}};
test('the home follows the actual non-cancelled school day and tomorrow after the final class',()=>{
 const before=homeContext(user,Date.parse(date+'T07:45:00+01:00'));assert.equal(before.phase,'before_class');assert.equal(before.defaultDay,'today');assert.equal(before.next.minutesUntil,15);
 const during=homeContext(user,Date.parse(date+'T08:30:00+01:00'));assert.equal(during.phase,'in_class');assert.equal(during.next.title,'Maths');assert.equal(during.next.inProgress,true);
 const after=homeContext(user,Date.parse(date+'T11:00:00+01:00'));assert.equal(after.phase,'evening');assert.equal(after.defaultDay,'tomorrow');assert.equal(after.primary,'preparation');assert.equal(after.next,null);
});
test('Paris dates and a free day remain consistent around midnight and daylight-saving changes',()=>{
 assert.equal(homeContext({},Date.parse('2026-10-25T23:30:00Z')).date,'2026-10-26');assert.equal(homeContext({},Date.parse('2026-03-29T01:30:00Z')).phase,'free');assert.equal(homeContext({},Date.parse('2026-11-03T17:00:00+01:00')).defaultDay,'tomorrow');assert.equal(homeContext({},Date.parse('2026-11-03T12:00:00+01:00')).defaultDay,'today');
});
