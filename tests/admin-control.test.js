import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {controlFixture,controlPassword} from './control-fixture.js';
import {AdminControl} from '../src/admin-control.js';
import {parseAdminCommand} from '../src/admin-commands.js';
import {pronoteBinding} from '../src/sources.js';
import {digest,random,passwordMatches} from '../src/store.js';

test('new administrator endpoints reject members, anonymous users and cross-origin commands',async()=>{
  const f=await controlFixture();try{
    for(const route of ['overview','incidents','jobs','catalogue','invites']){assert.equal((await f.request('admin/control/'+route,undefined,'camille')).status,403);assert.equal((await f.request('admin/control/'+route,undefined,'anonymous')).status,401);}
    assert.equal((await f.request('admin/control/prepare',{command:'site.registration',params:{enabled:false}},'owner','https://other.invalid')).status,403);
    assert.equal((await f.request('admin/control/reauth',{password:'incorrect'})).status,403);
    assert.equal((await f.request('admin/control/console',{line:'status'},'camille')).status,403);
  }finally{await f.close();}
});
test('sensitive changes require an owned, fresh preview, explicit confirmation and administrator password',async()=>{
  const f=await controlFixture();try{
    const p=(await f.prepare('account.suspend',{ids:['camille']})).body;
    assert.equal(f.store.user('camille').suspendedAt,undefined);
    assert.equal((await f.request('admin/control/apply',{planId:p.id,confirmation:p.confirmation})).body.code,'ADMIN_REAUTH_REQUIRED');
    await f.elevate();assert.equal((await f.request('admin/control/apply',{planId:p.id,confirmation:'OUI'})).body.code,'ADMIN_CONFIRMATION_REQUIRED');
    await f.elevate('coadmin');assert.equal((await f.request('admin/control/apply',{planId:p.id,confirmation:p.confirmation},'coadmin')).status,409);
    const approved=await f.request('admin/control/apply',{planId:p.id,confirmation:p.confirmation});assert.equal(approved.status,200);await f.control.runQueue();assert.ok(f.store.user('camille').suspendedAt);
    assert.equal((await f.request('admin/control/apply',{planId:p.id,confirmation:p.confirmation})).status,409);
    const stale=(await f.prepare('account.resume',{ids:['camille']})).body;f.setNow(f.now()+6*60000);assert.equal((await f.request('admin/control/apply',{planId:stale.id,confirmation:stale.confirmation})).body.code,'ADMIN_PLAN_EXPIRED');
  }finally{await f.close();}
});
test('last active administrator and the current web administrator cannot be locked out',async()=>{
  const f=await controlFixture();try{
    assert.equal((await f.prepare('account.archive',{ids:['owner']})).body.code,'ADMIN_SELF_PROTECTED');
    assert.throws(()=>f.control.prepare(f.local,{command:'account.suspend',selection:{ids:['owner','coadmin']}}),error=>error.code==='ADMIN_LAST_PROTECTED');
    f.store.user('coadmin').suspendedAt=f.now();
    assert.throws(()=>f.control.prepare(f.local,{command:'account.role',selection:{ids:['owner']},params:{role:'member'}}),error=>error.code==='ADMIN_LAST_PROTECTED');
    assert.equal((await f.prepare('account.role',{ids:['coadmin']},{role:'admin'})).status,409);
  }finally{await f.close();}
});
test('a suspended or archived account loses sessions, feed access, source jobs and mail without losing its consent or secrets',async()=>{
  const f=await controlFixture();try{
    const owner=f.store.user('camille'),secret=owner.skolengo,feed=owner.feedKey,consent=JSON.stringify(owner.emailConfig);
    const job=await f.execute('account.suspend',{ids:['camille']});assert.equal(job.state,'completed');
    assert.equal((await f.request('status',undefined,'camille')).body.user,null);assert.equal((await fetch(f.root+'/calendars/'+f.feedTokens.camille+'.ics')).status,404);
    assert.equal((await f.request('login',{login:'camille',password:controlPassword},'anonymous')).status,403);
    await assert.rejects(f.engine.run('camille'),/pas actif/);await assert.rejects(f.mailer.sendBrief(owner),/suspendu/);
    assert.equal(owner.skolengo,secret);assert.equal(owner.feedKey,feed);assert.equal(JSON.stringify(owner.emailConfig),consent);
    await f.execute('account.resume',{ids:['camille']});assert.equal((await f.request('login',{login:'camille',password:controlPassword},'anonymous')).status,200);
    assert.equal((await fetch(f.root+'/calendars/'+f.feedTokens.camille+'.ics')).status,200);
    await f.execute('account.archive',{ids:['camille']});assert.equal((await f.request('admin/control/users',{})).body.users.some(user=>user.id==='camille'),false);
    assert.equal((await f.request('admin/control/users',{state:'archived'})).body.users[0].id,'camille');await f.execute('account.restore',{ids:['camille']});assert.equal(owner.archivedAt,null);assert.equal(owner.feedKey,feed);
  }finally{await f.close();}
});
test('role changes revoke old sessions and an operation prepared before an account changes is rejected',async()=>{
  const f=await controlFixture();try{
    const p=(await f.prepare('feed.rotate',{ids:['camille']})).body;
    await f.execute('account.profile',{ids:['camille']},{name:'Camille corrigé',tags:['Bêta']});
    assert.equal((await f.request('admin/control/apply',{planId:p.id,confirmation:p.confirmation})).body.code,'ADMIN_PLAN_STALE');
    const result=await f.execute('account.role',{ids:['camille']},{role:'admin'});assert.equal(result.state,'completed');assert.equal(f.store.user('camille').admin,true);
    assert.equal((await f.request('admin/control/overview',undefined,'camille')).status,401);
    assert.equal((await f.request('login',{login:'camille',password:controlPassword},'anonymous')).status,200);
  }finally{await f.close();}
});
test('session revocation preserves the current session when requested and never exposes authentication hashes',async()=>{
  const f=await controlFixture();try{
    const other=random();f.store.state.sessions.push({hash:digest(other),userId:'owner',expires:Date.now()+3600000});f.store.save();
    const detail=(await f.request('admin/control/users/owner')).body;assert.equal(detail.sessions.length,2);assert.ok(!JSON.stringify(detail).includes(f.store.state.sessions[0].hash));
    await f.execute('account.sessions',{ids:['owner']},{keepCurrent:true});assert.equal(f.store.state.sessions.filter(item=>item.userId==='owner').length,1);assert.equal((await f.request('admin/control/overview')).status,200);
  }finally{await f.close();}
});
test('password reset links are encrypted, displayed once to the creator and consumed once without changing ICS keys',async()=>{
  const f=await controlFixture();try{
    const key=f.store.user('camille').feedKey,job=await f.execute('account.reset',{ids:['camille']});
    const visible=(await f.request('admin/control/jobs/'+job.id)).body;assert.equal(visible.hasSecret,true);assert.ok(!JSON.stringify(visible).includes('reset-password='));
    await f.elevate('coadmin');assert.equal((await f.request('admin/control/jobs/'+job.id+'/secret',{},'coadmin')).status,410);
    const secret=(await f.request('admin/control/jobs/'+job.id+'/secret',{})).body,token=new URL(secret.url).hash.split('=')[1];
    assert.ok(!fs.readFileSync(f.store.file,'utf8').includes(token));assert.equal((await f.request('admin/control/jobs/'+job.id+'/secret',{})).status,410);
    const password='a-new-private-password';assert.equal((await f.request('password/reset',{token,password},'anonymous')).status,200);assert.equal(passwordMatches(password,f.store.user('camille').password),true);
    assert.equal((await f.request('password/reset',{token,password},'anonymous')).status,400);assert.equal((await f.request('status',undefined,'camille')).body.user,null);assert.equal(f.store.user('camille').feedKey,key);assert.equal(f.calls.mail.length,0);
    assert.ok(!f.audit.query({limit:200}).rows.some(row=>JSON.stringify(row).includes(token)));
  }finally{await f.close();}
});
test('batch jobs report partial failures and retry only failed targets; cancellation leaves queued targets untouched',async()=>{
  const f=await controlFixture();try{
    f.calls.failed.add('nina');let job=await f.execute('sync.run',{ids:['camille','nina']},{source:'ent'});assert.equal(job.state,'partial');assert.equal(job.counts.succeeded,1);assert.equal(job.counts.failed,1);
    const plan=(await f.request('admin/control/jobs/'+job.id+'/retry',{})).body;assert.deepEqual(plan.targets.map(item=>item.id),['nina']);f.calls.failed.clear();const approved=await f.request('admin/control/apply',{planId:plan.id});await f.control.runQueue();assert.equal(f.control.job(approved.body.id).state,'completed');assert.deepEqual(f.calls.ent,['camille','nina','nina']);
    const p=(await f.prepare('sync.pause',{ids:['camille','nina']},{source:'ent'})).body;f.store.user('camille').enabled=true;f.store.user('nina').enabled=true;
    // Prepare against the new flags and cancel before starting.
    const fresh=(await f.prepare('sync.pause',{ids:['camille','nina']},{source:'ent'})).body;
    const queued=await f.request('admin/control/apply',{planId:fresh.id});await f.request('admin/control/jobs/'+queued.body.id+'/cancel',{});await f.control.runQueue();assert.equal(f.store.user('camille').enabled,true);assert.equal(f.control.job(queued.body.id).state,'cancelled');
  }finally{await f.close();}
});
test('maintenance and source pauses expire correctly and never enable additional email consent',async()=>{
  const f=await controlFixture();try{
    const before=JSON.stringify(f.store.user('camille').emailConfig);f.store.user('camille').enabled=true;f.store.user('camille').lastAttempt=null;
    await f.execute('site.maintenance',{}, {enabled:true,minutes:15,message:'Maintenance de démonstration'});
    assert.equal((await f.request('status',undefined,'anonymous')).body.registrationOpen,false);await f.engine.tick();assert.equal(f.calls.ent.length,0);assert.equal(JSON.stringify(f.store.user('camille').emailConfig),before);
    f.setNow(f.now()+16*60000);assert.equal((await f.request('status',undefined,'anonymous')).body.registrationOpen,true);
    await f.execute('site.automation',{}, {paused:true,source:'ent'});await f.engine.tick();assert.equal(f.calls.ent.length,0);
    await f.execute('site.automation',{}, {paused:false,source:'ent'});await f.engine.tick();assert.deepEqual(f.calls.ent,['camille']);
  }finally{await f.close();}
});
test('diagnostics and exports omit secrets; account notes remain encrypted and CSV cells cannot become formulas',async()=>{
  const f=await controlFixture();try{
    await f.execute('account.note',{ids:['camille']},{note:'Une note interne de démonstration.'});assert.ok(!fs.readFileSync(f.store.file,'utf8').includes('Une note interne'));
    assert.equal((await f.request('admin/control/users/camille')).body.internalNote,'Une note interne de démonstration.');
    f.store.user('camille').name='=HYPERLINK("https://example.invalid")';
    const csv=await f.request('admin/control/export',{});assert.equal(csv.status,200);assert.ok(csv.body.includes("\"'=HYPERLINK"));assert.ok(!csv.body.includes('fixture-private-ent-token'));
    const report=f.control.diagnostic();assert.ok(!JSON.stringify(report).includes('@example.invalid'));assert.ok(!JSON.stringify(report).includes(f.feedTokens.camille));assert.ok(!JSON.stringify(report).includes('cachedICS'));
    assert.equal(f.calls.mail.length,0);
  }finally{await f.close();}
});
test('a service restart interrupts pending operations instead of replaying role or link changes',async()=>{
  const f=await controlFixture();try{
    await f.elevate();const p=(await f.prepare('feed.rotate',{ids:['camille']})).body;const approved=await f.request('admin/control/apply',{planId:p.id,confirmation:p.confirmation});const old=f.store.user('camille').feedKey;
    f.control.close();const next=new AdminControl(f.store,{engine:f.engine,mailer:f.mailer,browsers:f.browsers,school:f.school,menu:f.menu,pronote:f.pronote,audit:f.audit,baseURL:f.root,clock:f.now});
    assert.equal(next.job(approved.body.id).state,'interrupted');await next.runQueue();assert.equal(f.store.user('camille').feedKey,old);assert.equal(next.publicJob(next.job(approved.body.id)).canRetry,false);
  }finally{await f.close();}
});
test('command parsing never executes shell syntax and refuses unknown or duplicate options',()=>{
  assert.equal(parseAdminCommand('user note camille --message "$(touch /tmp/not-executed)"').params.note,'$(touch /tmp/not-executed)');
  assert.equal(parseAdminCommand('sync run --source all --all').selection.all,true);
  assert.throws(()=>parseAdminCommand('sync run --source ent --source pronote --all'));
  assert.throws(()=>parseAdminCommand('status; rm -rf /'));
  assert.throws(()=>parseAdminCommand('site maintenance on --minutes'));
  assert.throws(()=>parseAdminCommand('user note camille --message "unfinished'));
  assert.throws(()=>parseAdminCommand('sync run ignored --all'));
  assert.throws(()=>parseAdminCommand('jobs list ignored'));
  assert.equal(parseAdminCommand('jobs list --offset 25 --limit 25').filters.offset,'25');
});

test('jobs added during a source read run afterwards and cancellation skips remaining targets',async()=>{
  const f=await controlFixture();let release;
  try{
    await f.elevate();f.calls.gate=new Promise(resolve=>{release=resolve;});
    const first=(await f.prepare('sync.run',{ids:['camille','nina']},{source:'ent'})).body;
    const firstJob=(await f.request('admin/control/apply',{planId:first.id})).body;
    const running=f.control.runQueue();
    const next=(await f.prepare('account.note',{ids:['nina']},{note:'Queued during read'})).body;
    const second=(await f.request('admin/control/apply',{planId:next.id})).body;
    await f.request('admin/control/jobs/'+firstJob.id+'/cancel',{});release();await running;
    assert.equal(f.control.job(firstJob.id).state,'cancelled');assert.deepEqual(f.calls.ent,['camille']);
    assert.equal(f.control.job(second.id).state,'completed');assert.equal(f.store.open(f.store.user('nina').adminNote),'Queued during read');
  }finally{release?.();await f.close();}
});

test('a partial ENT failure still attempts Pronote and reports the partial result',async()=>{
  const f=await controlFixture();try{
    const user=f.store.user('camille');user.pronote=f.store.seal({});user.pronoteBinding=pronoteBinding(user);let reads=0;
    f.pronote.sync=async()=>{reads++;};f.calls.failed.add('camille');
    const job=await f.execute('sync.run',{ids:['camille']},{source:'all'});
    assert.equal(reads,1);assert.equal(job.state,'partial');assert.equal(job.items[0].code,'SOURCE_PARTIAL');assert.match(job.items[0].message,/Pronote : actualisé/);
  }finally{await f.close();}
});

test('obsolete or expired private links cannot be revealed and settings previews detect intervening changes',async()=>{
  const f=await controlFixture();try{
    const old=await f.execute('account.reset',{ids:['camille']}),fresh=await f.execute('account.reset',{ids:['camille']});
    assert.equal(f.control.publicJob(f.control.job(old.id)).hasSecret,false);
    assert.equal((await f.request('admin/control/jobs/'+old.id+'/secret',{})).status,410);
    const invitation=await f.execute('invite.create',{}, {role:'member',hours:1});assert.equal(invitation.hasSecret,true);
    f.setNow(f.now()+61*60000);assert.equal(f.control.publicJob(f.control.job(fresh.id)).hasSecret,false);assert.equal(f.control.publicJob(f.control.job(invitation.id)).hasSecret,false);
    const preview=(await f.prepare('site.registration',{}, {enabled:false})).body;await f.elevate();f.store.state.settings.publicRegistration=false;
    assert.equal((await f.request('admin/control/apply',{planId:preview.id,confirmation:preview.confirmation})).body.code,'ADMIN_PLAN_STALE');
  }finally{await f.close();}
});

test('a global pause during an automatic sync prevents reads for the next account',async()=>{
  const f=await controlFixture();let release;
  try{
    f.store.user('camille').enabled=true;f.store.user('nina').enabled=true;
    f.calls.gate=new Promise(resolve=>{release=resolve;});const running=f.engine.tick();
    f.store.state.settings.automationPaused={ent:true};release();await running;
    assert.deepEqual(f.calls.ent,['camille']);
  }finally{release?.();await f.close();}
});
