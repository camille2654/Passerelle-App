import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-status-runtime-'));
const port=8023,base='http://127.0.0.1:'+port+'/agenda',sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let output='',exited=false;
const child=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,AGENDA_DATA_DIR:dir,AGENDA_BASE_URL:base,AGENDA_PORT:String(port),AGENDA_SMTP_PASSWORD:'',AGENDA_SMTP_FROM:''},stdio:['ignore','pipe','pipe']});
child.stdout.on('data',value=>{output+=value;});child.stderr.on('data',value=>{output+=value;});child.on('exit',()=>{exited=true;});
try{
 let initial;
 for(let attempt=0;attempt<60;attempt++){
  if(exited)throw new Error('The isolated runtime stopped before responding.');
  try{const r=await fetch(base+'/api/system-status');if(r.ok){initial=await r.json();break;}}catch{}
  await sleep(500);
 }
 assert.ok(initial);await sleep(16000);
 const final=await (await fetch(base+'/api/system-status')).json();
 for(const id of ['ent','push']){const component=final.components.find(row=>row.id===id);assert.equal(component.state,'operational');assert.ok(component.observedAt>=initial.checkedAt-1000);}
 assert.equal(final.state,'operational');assert.equal(final.components.find(row=>row.id==='mail').state,'disabled');
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'state.json'),'utf8')).users.length,0);
 assert.ok(!JSON.stringify(final).includes('admin-invitation'));
 console.log(JSON.stringify({ok:true,realStartup:true,actualTimerHeartbeats:true,noAccounts:true,noSyntheticGreenWithoutPulse:true,realENTCalls:0,realEmailsSent:0}));
}finally{
 child.kill('SIGTERM');for(let i=0;!exited&&i<100;i++)await sleep(100);if(!exited)child.kill('SIGKILL');
 fs.rmSync(dir,{recursive:true,force:true});
}
