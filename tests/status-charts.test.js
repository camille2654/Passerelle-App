import test from 'node:test';import assert from 'node:assert/strict';
import '../public/status/charts.js';
const {normalize,stats,segments,runs}=globalThis.PasserelleStatusMath;
const at=1793966400000,ids=['portal','ent','calendars','mail','push','managed'];
const row=(offset,responseMs=10,state='operational')=>({at:at+offset,responseMs,state,components:Object.fromEntries(ids.map(id=>[id,state==='unavailable'?'unknown':state==='maintenance'?'paused':state]))});
const data=samples=>({schemaVersion:1,intervalSeconds:60,retentionHours:24,startedAt:at,generatedAt:samples.at(-1)?.at||at,samples});
test('only valid public observations are accepted, ordered and copied',()=>{
 const input=data([row(0),row(60000,0)]),before=structuredClone(input),valid=normalize(input);assert.deepEqual(valid,input);valid.samples[0].components.portal='unknown';assert.deepEqual(input,before);
 for(const change of [value=>{value.samples[0].responseMs=-1;},value=>{value.samples[0].responseMs=Infinity;},value=>{value.samples[0].components.portal='injected';},value=>{value.samples.push(row(1));},value=>{value.samples[0].at=at+999999;},value=>{value.intervalSeconds=1;}]){const invalid=structuredClone(input);change(invalid);assert.equal(normalize(invalid),null);}
});
test('summary counts actual observations and uses valid latency samples only',()=>{
 assert.deepEqual(stats([]),{count:0,healthy:0,validResponses:0,last:null,median:null});
 assert.deepEqual(stats([row(0,0),row(60000,20),row(120000,null,'unavailable')]),{count:3,healthy:2,validResponses:2,last:null,median:10});
 assert.equal(stats([row(0,2),row(60000,100),row(120000,6)]).median,6);
});
test('latency lines break at failed checks and unsampled gaps; singleton points are retained',()=>{
 const rows=[row(0,2),row(60000,3),row(120000,null,'unavailable'),row(180000,8),row(600000,7)];
 assert.deepEqual(segments(rows,{start:at,end:at+700000}).map(group=>group.length),[2,1,1]);
 assert.deepEqual(segments(rows,{start:at+130000,end:at+190000}).map(group=>group[0].responseMs),[8]);
});
test('service bands merge regular observations but never cover long gaps or the whole empty period',()=>{
 const rows=[row(0),row(60000),row(600000),row(660000,null,'unavailable')],view={start:at-3600000,end:at+720000};
 assert.deepEqual(runs(rows,'portal',view),[{from:at,to:at+120000,state:'operational'},{from:at+600000,to:at+660000,state:'operational'},{from:at+660000,to:at+720000,state:'unknown'}]);
 assert.deepEqual(runs([], 'portal',view),[]);
 assert.equal(runs(rows,'portal',{start:at+700000,end:at+800000}).length,0);
});
