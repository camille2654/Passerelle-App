import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {controlFixture} from './control-fixture.js';
const run=promisify(execFile),dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-history-runtime-')),file=path.join(dir,'history.json');
let f=await controlFixture(),closed=false,second;
const once=async url=>{await run('python3',['-B','scripts/status-monitor.py','--url',url,'--history',file,'--once'],{cwd:process.cwd()});return JSON.parse(fs.readFileSync(file,'utf8'));};
try{
 await f.systemStatus.track('ent',async()=>{});await f.systemStatus.track('push',async()=>{});
 const url=f.root+'/api/system-status',port=f.server.address().port,initial=await once(url);assert.equal(initial.samples.length,1);assert.equal(initial.samples[0].state,'operational');assert.ok(initial.samples[0].responseMs>=0);
 await f.close();closed=true;
 const outage=await once(url);assert.equal(outage.samples.length,2);assert.equal(outage.samples[1].state,'unavailable');assert.equal(outage.samples[1].responseMs,null);
 second=await controlFixture({port});await second.systemStatus.track('ent',async()=>{});await second.systemStatus.track('push',async()=>{});
 const recovered=await once(url);assert.equal(recovered.samples.length,3);assert.equal(recovered.samples[2].state,'operational');assert.equal(recovered.startedAt,initial.startedAt);
 const serialized=JSON.stringify(recovered);for(const privateText of ['fixture-private-ent-token','@example.invalid','student-camille','feedKey','users'])assert.ok(!serialized.includes(privateText));
 console.log(JSON.stringify({ok:true,realLocalHTTP:true,backendStopObserved:true,historyPersists:true,backendRecovery:true,nullOnFailure:true,privateFieldsAbsent:true,realENTCalls:0,realEmailsSent:0}));
}finally{if(!closed)await f.close();await second?.close();fs.rmSync(dir,{recursive:true,force:true});}
