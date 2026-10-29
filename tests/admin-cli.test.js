import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {controlFixture} from './control-fixture.js';
import {listenAdminSocket} from '../src/admin-socket.js';

async function cli(socket,args){return new Promise(resolve=>{const child=spawn(process.execPath,['scripts/admin-cli.mjs','--socket',socket,'--json',...args],{cwd:path.resolve('.'),stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',part=>stdout+=part);child.stderr.on('data',part=>stderr+=part);child.on('close',code=>resolve({code,rows:stdout.trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)),stderr}));});}
test('local administration uses a private socket and the same preview, confirmation and audit as the web',async()=>{
  const f=await controlFixture({autoSchedule:true});let socket;try{
    socket=await listenAdminSocket(f.control);assert.equal(fs.statSync(socket.socketPath).mode&0o777,0o600);
    const status=await cli(socket.socketPath,['status']);assert.equal(status.code,0);assert.equal(status.rows[0].data.counts.accounts,4);
    const prepared=await cli(socket.socketPath,['user','suspend','camille']);assert.equal(prepared.code,0);assert.equal(f.store.user('camille').suspendedAt,undefined);const plan=prepared.rows[0].data;
    const refused=await cli(socket.socketPath,['apply',plan.id]);assert.equal(refused.code,1);assert.equal(f.store.user('camille').suspendedAt,undefined);
    const applied=await cli(socket.socketPath,['apply',plan.id,'--confirm',plan.confirmation,'--watch']);assert.equal(applied.code,0);assert.ok(f.store.user('camille').suspendedAt);
    const row=f.audit.query({limit:100}).rows.find(row=>row.event==='admin.command.applied');assert.equal(row.actorId,'local-admin');assert.equal(row.meta.mode,'account.suspend');
    await assert.rejects(listenAdminSocket(f.control),/ADMIN_SOCKET_IN_USE/);
  }finally{await socket?.close();await f.close();}
});
test('local arguments containing shell syntax remain plain encrypted note text',async()=>{
  const f=await controlFixture({autoSchedule:true});let socket;try{
    socket=await listenAdminSocket(f.control);const sentinel=path.join(f.dir,'not-created'),note='$(touch '+sentinel+')';
    const result=await cli(socket.socketPath,['user','note','camille','--message',note,'--execute','--watch']);assert.equal(result.code,0);assert.equal(fs.existsSync(sentinel),false);assert.equal(f.store.open(f.store.user('camille').adminNote),note);assert.ok(!fs.readFileSync(f.store.file,'utf8').includes(note));
  }finally{await socket?.close();await f.close();}
});
test('a regular file at the socket path is never overwritten',async()=>{
  const f=await controlFixture();try{const target=path.join(f.dir,'admin.sock');fs.writeFileSync(target,'keep this file',{mode:0o600});await assert.rejects(listenAdminSocket(f.control),/ADMIN_SOCKET_UNSAFE/);assert.equal(fs.readFileSync(target,'utf8'),'keep this file');}finally{await f.close();}
});
