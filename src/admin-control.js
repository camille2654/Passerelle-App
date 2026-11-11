import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PublicError} from './sync.js';
import {random,digest,passwordHash,passwordMatches} from './store.js';
import {normalizeLabel} from './subjects.js';
import {rebuildCalendar} from './calendar.js';
import {accountActive,maintenanceState,publicOperations} from './operational-state.js';
import {linkedPronote} from './sources.js';
import {COMMANDS,COMMAND_HELP,commandById,parseAdminCommand} from './admin-commands.js';

const FINAL=new Set(['completed','partial','failed','cancelled','interrupted']);
const RETRYABLE=new Set(['sync.run','feed.rebuild','cache.clear','diagnose.run']);
const redact=value=>String(value||'').replace(/https?:\/\/[^\s<>]+/gi,'[lien masqué]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[adresse masquée]').replace(/[A-Za-z0-9_-]{40,}/g,'[secret masqué]').slice(0,1000);
const failure=(message,status=400,code='ADMIN_INVALID')=>Object.assign(new PublicError(message,status),{code});
const pageNumber=(value,fallback,max)=>{const number=value===undefined?fallback:Number(value);if(!Number.isInteger(number)||number<0||number>max)throw failure('Pagination invalide.');return number;};
const userState=user=>user.archivedAt?'archived':user.suspendedAt?'suspended':'active';
const safeOptions=params=>Object.fromEntries(Object.entries(params).filter(([key])=>['source','role','enabled','paused','minutes','hours','keepCurrent'].includes(key)));

export class AdminControl {
  constructor(store,{engine,mailer,browsers,school,menu,pronote,audit,baseURL,clock=()=>Date.now(),version='4.17.0',schedule=fn=>setTimeout(fn,0)}={}){
    Object.assign(this,{store,engine,mailer,browsers,school,menu,pronote,audit,baseURL,clock,version,schedule});
    this.plans=new Map();this.running=false;this.closed=false;this.lastIncidentScan=0;
    let changed=false;
    for(const job of store.state.adminJobs||[])if(!FINAL.has(job.state)){
      job.state='interrupted';job.finishedAt=clock();
      for(const item of job.items)if(['queued','running'].includes(item.state))Object.assign(item,{state:'interrupted',code:'SERVICE_RESTARTED',message:'Le service a redémarré. Vérifiez le résultat avant de relancer.'});
      changed=true;
    }
    if(changed)store.save();
  }
  principal(req){return {kind:'web',userId:req.user.id,sessionHash:req.session.hash};}
  actorId(principal){return principal.kind==='local'?'local-admin':principal.userId;}
  authorize(principal){
    if(principal?.kind==='local')return true;
    const user=this.store.user(principal?.userId);
    if(!accountActive(user)||!user.admin)throw failure('Cet accès administrateur n’est plus actif.',403,'ADMIN_ACCESS_CHANGED');
    return true;
  }
  elevated(principal){
    if(principal.kind==='local')return true;
    const session=this.store.state.sessions.find(item=>item.hash===principal.sessionHash&&item.userId===principal.userId&&item.expires>Date.now());
    return !!session&&session.adminElevatedUntil>this.clock();
  }
  reauthenticate(req,password){
    if(typeof password!=='string'||password.length>256||!req.user.password||!passwordMatches(password,req.user.password))throw failure('Le mot de passe administrateur est incorrect.',403,'ADMIN_PASSWORD_INVALID');
    req.session.adminElevatedUntil=this.clock()+10*60000;this.store.save();
    this.audit.record('admin.elevated',{source:'security',actorId:req.user.id});return {elevatedUntil:req.session.adminElevatedUntil};
  }
  touch(){this.store.state.settings.adminVersion=(this.store.state.settings.adminVersion||0)+1;this.store.save();}
  resolve(ref){const value=String(ref||'').trim();const user=this.store.user(value)||this.store.state.users.find(item=>String(item.login||'').toLowerCase()===value.toLowerCase());if(!user)throw failure('Compte introuvable.',404,'ADMIN_USER_NOT_FOUND');return user;}
  compact(user){
    const sessions=this.store.state.sessions.filter(item=>item.userId===user.id&&item.expires>Date.now());
    return {id:user.id,name:user.name||'Compte',login:user.login||'',admin:!!user.admin,state:userState(user),createdAt:user.createdAt||null,lastSeen:user.lastSeenAt||null,schoolName:user.schoolName||'',tags:user.adminTags||[],suspendedAt:user.suspendedAt||null,archivedAt:user.archivedAt||null,sessions:sessions.length,ent:{connected:!!user.skolengo,enabled:!!user.enabled,lastSync:user.lastSync||null,lastAttempt:user.lastAttempt||null,error:user.lastError||user.skolengoError||null,authExpired:!!user.skolengoError,busy:this.engine.running.has(user.id)||this.school.busy(user.id)},pronote:{connected:!!user.pronote,linked:linkedPronote(user),enabled:user.pronoteSyncEnabled!==false,lastSync:user.pronoteLastSync||null,error:user.pronoteError||null,authExpired:!!user.pronoteNeedsReconnect,busy:this.pronote.running.has(user.id)},feed:{active:!!user.feedKey,ready:!!user.cachedICS,lastModified:user.feedModifiedAt||null,courses:user.total||0},email:this.mailer.publicSettings(user)};
  }
  users(input={}){
    const q=normalizeLabel(String(input.q||'').slice(0,100)),state=input.state||'current',role=input.role||'all',source=input.source||'all',sort=input.sort||'name';
    if(!['current','all','active','suspended','archived'].includes(state)||!['all','admin','member'].includes(role)||!['all','ent','pronote','issues','no-source','feed','mail'].includes(source)||!['name','recent','sync','created'].includes(sort))throw failure('Filtre de comptes invalide.');
    let rows=this.store.state.users.map(user=>this.compact(user)).filter(user=>(state==='all'||state==='current'&&user.state!=='archived'||user.state===state)&&(role==='all'||(role==='admin')===user.admin)&&(!q||normalizeLabel([user.name,user.login,user.schoolName,user.tags.join(' '),user.email.address].join(' ')).includes(q)));
    rows=rows.filter(user=>source==='all'||source==='ent'&&user.ent.connected||source==='pronote'&&user.pronote.connected||source==='issues'&&!!(user.ent.error||user.pronote.error||user.email.lastDelivery?.status==='failed')||source==='no-source'&&!user.ent.connected&&!user.pronote.connected||source==='feed'&&user.feed.active||source==='mail'&&(user.email.enabled||user.email.alertsEnabled));
    rows.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'fr'):sort==='recent'?(b.lastSeen||0)-(a.lastSeen||0):sort==='sync'?(b.ent.lastSync||0)-(a.ent.lastSync||0):(b.createdAt||0)-(a.createdAt||0));
    const offset=pageNumber(input.offset,0,100000),limit=Math.max(1,pageNumber(input.limit,25,100));
    return {users:rows.slice(offset,offset+limit),total:rows.length,offset,limit,ids:rows.slice(0,100).map(user=>user.id),selectionLimit:100};
  }
  detail(ref){
    const user=this.resolve(ref),current=this.compact(user);
    const sessions=this.store.state.sessions.filter(item=>item.userId===user.id&&item.expires>Date.now()).map(item=>({id:digest(user.id+':session:'+item.hash).slice(0,24),createdAt:item.createdAt||null,lastSeen:item.lastSeenAt||null,expires:item.expires,device:['mobile','desktop'].includes(item.device)?item.device:'unknown'}));
    return {...current,sessions,internalNote:user.adminNote?this.store.open(user.adminNote):'',noteUpdatedAt:user.adminNoteUpdatedAt||null,history:this.audit.query({userId:user.id,limit:30}).rows,incidents:this.incidents().items.filter(item=>item.userId===user.id),support:(this.store.state.supportTickets||[]).filter(item=>item.userId===user.id).map(item=>({id:item.id,status:item.status,createdAt:item.createdAt,updatedAt:item.updatedAt})).slice(-20).reverse()};
  }
  scanIncidents(force=false){
    const now=this.clock();if(!force&&now-this.lastIncidentScan<10000)return;this.lastIncidentScan=now;
    const candidates=[];const add=(key,userId,title,source,severity,code)=>candidates.push({key,userId,title,source,severity,code});
    for(const user of this.store.state.users.filter(accountActive)){
      if(user.skolengoError)add(user.id+':ent-auth',user.id,'Connexion ENT à renouveler','ent','error','ENT_AUTH_EXPIRED');
      else if(user.lastError)add(user.id+':ent-failure',user.id,'Actualisation ENT interrompue','ent','error','ENT_UNAVAILABLE');
      else if(user.enabled&&now-(user.lastSync||0)>30*60000)add(user.id+':ent-stale',user.id,'Agenda en attente de mise à jour','ent','warn','ENT_STALE');
      if(user.pronoteError)add(user.id+':pronote',user.id,user.pronoteNeedsReconnect?'Connexion Pronote à renouveler':'Lecture Pronote interrompue','pronote','error',user.pronoteNeedsReconnect?'PRONOTE_AUTH_EXPIRED':'PRONOTE_UNAVAILABLE');
      if(user.homeworkWarning&&user.enabled)add(user.id+':homework',user.id,'Travail à faire incomplet','ent','warn','HOMEWORK_UNAVAILABLE');
      if(user.lastBrief?.status==='failed'||user.lastChangeAlert?.status==='failed')add(user.id+':mail',user.id,'Dernier envoi de notification en échec','mail','warn','MAIL_DELIVERY_FAILED');
      if(user.feedKey&&!user.cachedICS)add(user.id+':feed',user.id,'Flux ICS en attente de contenu','feed','warn','FEED_NOT_READY');
    }
    if(!this.audit.integrity.ok||this.audit.writeError)add('system:audit',null,'Intégrité ou écriture du journal à vérifier','system','error','AUDIT_INTEGRITY');
    const all=this.store.state.adminIncidents||[],byKey=new Map(all.filter(item=>item.state!=='resolved').map(item=>[item.key,item])),observed=new Set();let changed=false;
    for(const candidate of candidates){observed.add(candidate.key);let item=byKey.get(candidate.key);if(!item){item={...candidate,id:randomUUID(),state:'open',firstSeen:now,lastSeen:now};all.push(item);changed=true;}else if(item.code!==candidate.code){Object.assign(item,candidate,{state:'open',acknowledgedAt:null,lastSeen:now});changed=true;}}
    for(const item of all)if(item.state!=='resolved'&&!observed.has(item.key)){item.state='resolved';item.resolvedAt=now;changed=true;}
    if(changed){this.store.state.adminIncidents=all.filter(item=>item.state!=='resolved'||item.resolvedAt>now-30*86400000).slice(-2000);this.touch();}
  }
  incidents(input={}){this.scanIncidents();const rows=(this.store.state.adminIncidents||[]).filter(item=>input.state==='all'||input.state==='resolved'?input.state==='all'||item.state==='resolved':item.state!=='resolved').sort((a,b)=>b.firstSeen-a.firstSeen);return {items:rows.map(item=>({...item,name:this.store.user(item.userId)?.name||'Service'})),open:rows.filter(item=>item.state==='open').length,acknowledged:rows.filter(item=>item.state==='acknowledged').length};}
  overview(){
    const now=this.clock(),users=this.store.state.users,active=users.filter(accountActive),incidents=this.incidents(),jobs=this.jobs(),memory=process.memoryUsage();let storage=null;
    try{const disk=fs.statfsSync(this.store.dir);storage={availableBytes:Number(disk.bavail)*Number(disk.bsize),totalBytes:Number(disk.blocks)*Number(disk.bsize)};}catch{}
    return {version:this.version,at:now,uptimeSeconds:Math.floor(process.uptime()),memoryBytes:memory.rss,storage,counts:{accounts:users.length,active:active.length,admins:active.filter(user=>user.admin).length,suspended:users.filter(user=>user.suspendedAt&&!user.archivedAt).length,archived:users.filter(user=>user.archivedAt).length,online:active.filter(user=>now-(user.lastSeenAt||0)<15*60000).length,ent:active.filter(user=>user.skolengo).length,pronote:active.filter(user=>user.pronote).length,feeds:active.filter(user=>user.feedKey).length,incidents:incidents.items.filter(item=>item.state!=='resolved').length,support:(this.store.state.supportTickets||[]).filter(item=>item.status!=='resolved').length,jobs:(this.store.state.adminJobs||[]).filter(item=>!FINAL.has(item.state)).length},services:{entBusy:this.engine.running.size,pronoteBusy:this.pronote.running.size,pronoteReady:this.pronote.ready,mailReady:this.mailer.ready,audit:this.audit.integrity.ok&&!this.audit.writeError},operations:{...publicOperations(this.store.state.settings,now),automationPaused:this.store.state.settings.automationPaused||{},registrationOpen:this.store.state.settings.publicRegistration!==false&&!maintenanceState(this.store.state.settings,now).enabled},incidents:incidents.items.filter(item=>item.state!=='resolved').slice(0,6),jobs:jobs.items.slice(0,6),audit:this.audit.overview()};
  }
  diagnostic(){
    const overview=this.overview(),checks=[];const check=(id,label,ok)=>checks.push({id,label,ok:!!ok});
    check('private-directory','Stockage privé en mode 0700',(fs.statSync(this.store.dir).mode&0o777)===0o700);
    check('private-state','Fichier d’état en mode 0600',(fs.statSync(this.store.file).mode&0o777)===0o600);
    const integrity=this.audit.verify();this.audit.integrity=integrity;check('audit','Chaîne du journal vérifiée',integrity.ok&&!this.audit.writeError);
    check('administrator','Au moins un administrateur actif',overview.counts.admins>0);check('storage','Plus de 100 Mo disponibles',overview.storage?.availableBytes>100*1024*1024);
    return {version:this.version,at:this.clock(),ok:checks.every(item=>item.ok),checks,services:overview.services,counts:overview.counts,accounts:this.store.state.users.map(user=>({id:user.id,state:userState(user),ent:!!user.skolengo,pronote:!!user.pronote,feed:!!user.feedKey,feedReady:!!user.cachedICS,lastSync:user.lastSync||null,authExpired:!!user.skolengoError||!!user.pronoteNeedsReconnect}))};
  }
  invitations(){return {items:this.store.state.invites.filter(item=>item.expires>Date.now()).map(item=>({id:item.id||digest(item.hash).slice(0,24),role:item.admin?'admin':'member',createdAt:item.createdAt||null,expires:item.expires}))};}
  siteFingerprint(){const s=this.store.state.settings;return digest(JSON.stringify([s.publicRegistration,s.maintenance,s.automationPaused,s.announcement]));}
  fingerprint(user){return digest(JSON.stringify([user.id,user.admin,user.suspendedAt,user.archivedAt,user.login,user.name,user.passwordReset?.hash,user.adminNote,user.feedHash,user.enabled,user.pronoteSyncEnabled,user.skolengoConnectionId,user.pronoteConnectionId,user.adminNoteUpdatedAt,user.adminTags]));}
  validateParams(command,input={}){
    const params={};
    if(command.startsWith('sync.')){if(!['ent','pronote','all'].includes(input.source||'ent'))throw failure('Choisissez la source ENT, Pronote ou les deux.');params.source=input.source||'ent';}
    if(command==='account.role'){if(!['admin','member'].includes(input.role))throw failure('Choisissez le rôle membre ou administrateur.');params.role=input.role;}
    if(command==='account.sessions')params.keepCurrent=input.keepCurrent!==false;
    if(command==='account.profile'){
      if(input.name!==undefined){const name=String(input.name).trim();if(!name||name.length>80)throw failure('Indiquez un prénom de 80 caractères maximum.');params.name=name;}
      if(input.login!==undefined){const login=String(input.login).trim().toLowerCase();if(!/^[a-z0-9._@+-]{3,100}$/.test(login))throw failure('Identifiant de compte invalide.');params.login=login;}
      if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.length>10)throw failure('Utilisez au maximum dix étiquettes.');params.tags=[...new Set(input.tags.map(item=>String(item).trim()).filter(Boolean))];if(params.tags.some(item=>item.length>30))throw failure('Une étiquette ne peut pas dépasser 30 caractères.');}
      if(!Object.keys(params).length)throw failure('Choisissez au moins un champ à modifier.');
    }
    if(command==='account.note'){if(typeof input.note!=='string'||input.note.length>3000)throw failure('La note interne ne doit pas dépasser 3 000 caractères.');params.note=input.note.trim();}
    if(command==='site.registration'){if(typeof input.enabled!=='boolean')throw failure('Choisissez l’ouverture des inscriptions.');params.enabled=input.enabled;}
    if(command==='site.automation'){if(typeof input.paused!=='boolean'||!['ent','pronote','mail','push','all'].includes(input.source))throw failure('Choisissez les automatismes à suspendre ou reprendre.');Object.assign(params,{paused:input.paused,source:input.source});}
    if(command==='site.maintenance'){if(typeof input.enabled!=='boolean')throw failure('Choisissez le mode maintenance.');params.enabled=input.enabled;if(input.enabled){const minutes=Number(input.minutes);if(!Number.isInteger(minutes)||minutes<5||minutes>180)throw failure('Choisissez une maintenance de 5 à 180 minutes.');Object.assign(params,{minutes,message:String(input.message||'Une maintenance est en cours. Vos données restent consultables.').trim().slice(0,600)});}}
    if(command==='site.announcement'){if(typeof input.enabled!=='boolean')throw failure('Choisissez l’état de l’annonce.');params.enabled=input.enabled;if(input.enabled){const minutes=Number(input.minutes),title=String(input.title||'').trim(),message=String(input.message||'').trim();if(!title||title.length>100||!message||message.length>1500||!Number.isInteger(minutes)||minutes<5||minutes>10080)throw failure('Indiquez un titre, un texte et une durée de 5 minutes à sept jours.');Object.assign(params,{title,message,minutes,tone:['info','warning'].includes(input.tone)?input.tone:'info'});}}
    if(command==='invite.create'){const hours=Number(input.hours||24);if(!['admin','member'].includes(input.role)||!Number.isInteger(hours)||hours<1||hours>168)throw failure('Choisissez le rôle et une durée de 1 à 168 heures.');Object.assign(params,{role:input.role,hours});}
    return params;
  }
  ensureTargets(command,users,params,principal){
    if(!users.length||users.length>100)throw failure('Sélectionnez entre un et cent comptes.');
    if(['account.reset','account.profile'].includes(command)&&users.length!==1)throw failure('Cette action concerne un seul compte à la fois.');
    const dangerous=['account.suspend','account.archive','account.role'];
    if(dangerous.includes(command)){
      if(users.some(user=>principal.kind==='web'&&user.id===principal.userId&&(command!=='account.role'||params.role==='member')))throw failure('Utilisez un autre administrateur pour retirer votre propre accès.',409,'ADMIN_SELF_PROTECTED');
      const remove=new Set(users.filter(user=>command!=='account.role'||params.role==='member').map(user=>user.id));
      if(!this.store.state.users.some(user=>user.admin&&accountActive(user)&&!remove.has(user.id)))throw failure('Le dernier administrateur actif doit conserver son accès.',409,'ADMIN_LAST_PROTECTED');
    }
    if(command==='account.role'&&users.some(user=>!accountActive(user)))throw failure('Réactivez ou restaurez le compte avant de modifier son rôle.',409);
    if(command==='account.profile'&&params.login&&this.store.state.users.some(user=>user.id!==users[0].id&&user.login===params.login))throw failure('Cet identifiant est déjà utilisé.',409);
    if(command==='account.sessions'&&params.keepCurrent===false&&users.length>1&&users.some(user=>user.id===principal.userId))throw failure('Fermez votre session séparément des autres comptes.');
  }
  prepare(principal,{command,selection={},params:input={}}){
    this.authorize(principal);const spec=commandById(command);if(!spec)throw failure('Commande administrative inconnue.');
    const params=this.validateParams(command,input);let targets=[],fingerprints={};
    if(spec.target==='user'){
      let users;
      if(selection.all===true){const result=this.users({...selection.filters,limit:100});if(result.total>100)throw failure('Affinez la sélection : une opération peut concerner cent comptes au maximum.');users=result.users.map(user=>this.store.user(user.id));}
      else{const refs=selection.ids||selection.refs;if(!Array.isArray(refs)||refs.length>100)throw failure('Sélection de comptes invalide.');users=[...new Set(refs.map(ref=>this.resolve(ref).id))].map(id=>this.store.user(id));}
      this.ensureTargets(command,users,params,principal);targets=users.map(user=>({id:user.id,name:user.name||'Compte',login:user.login||'',state:userState(user),admin:!!user.admin}));fingerprints=Object.fromEntries(users.map(user=>[user.id,this.fingerprint(user)]));
    }else if(spec.target==='incident'){
      this.scanIncidents(true);const ids=selection.ids;if(!Array.isArray(ids)||!ids.length||ids.length>100)throw failure('Sélectionnez les incidents à prendre en charge.');targets=ids.map(id=>{const item=this.store.state.adminIncidents?.find(item=>item.id===id&&item.state!=='resolved');if(!item)throw failure('Cet incident n’est plus actif.',409);return {id:item.id,name:item.title,userId:item.userId};});
    }else if(spec.target==='invite'){
      const ids=selection.ids;if(!Array.isArray(ids)||!ids.length||ids.length>100)throw failure('Sélectionnez les invitations.');targets=ids.map(id=>{const item=this.invitations().items.find(item=>item.id===id);if(!item)throw failure('Cette invitation n’est plus disponible.',409);return {id,name:item.role==='admin'?'Invitation administrateur':'Invitation membre'};});
    }else targets=[{id:'site',name:'Passerelle'}];
    const now=this.clock();for(const [id,plan]of this.plans)if(plan.expiresAt<=now)this.plans.delete(id);
    if(this.plans.size>=200)throw failure('Trop de prévisualisations sont ouvertes. Réessayez dans quelques minutes.',429);
    const plan={id:randomUUID(),command,label:spec.label,description:spec.description,sensitive:spec.sensitive,target:spec.target,params,targets,fingerprints,principal:{...principal},createdAt:now,expiresAt:now+5*60000,confirmation:spec.sensitive?'CONFIRMER '+targets.length:'',version:this.store.state.settings.siteVersion||0,siteFingerprint:this.siteFingerprint()};this.plans.set(plan.id,plan);
    return this.publicPlan(plan,principal);
  }
  publicPlan(plan,principal){return {id:plan.id,command:plan.command,label:plan.label,description:plan.description,sensitive:plan.sensitive,requiresPassword:plan.sensitive&&!this.elevated(principal),confirmation:plan.confirmation,targets:plan.targets,count:plan.targets.length,params:plan.params,expiresAt:plan.expiresAt};}
  getPlan(principal,id){const plan=this.plans.get(id);if(!plan||plan.expiresAt<=this.clock()||plan.principal.kind!==principal.kind||plan.principal.userId!==principal.userId||plan.principal.sessionHash!==principal.sessionHash)throw failure('Cette prévisualisation a expiré ou appartient à une autre session.',409,'ADMIN_PLAN_EXPIRED');return plan;}
  apply(principal,{planId,confirmation}){
    this.authorize(principal);if(this.closed)throw failure('Le service s’arrête. Réessayez après son redémarrage.',503);
    const plan=this.getPlan(principal,planId);
    if(plan.command!=='diagnose.run'&&(!this.audit.integrity.ok||this.audit.writeError))throw failure('Vérifiez le journal avant d’appliquer des modifications.',409,'ADMIN_AUDIT_UNAVAILABLE');
    if(plan.sensitive&&!this.elevated(principal))throw failure('Vérifiez votre mot de passe administrateur pour continuer.',403,'ADMIN_REAUTH_REQUIRED');
    if(plan.sensitive&&confirmation!==plan.confirmation)throw failure('Recopiez la confirmation indiquée.',400,'ADMIN_CONFIRMATION_REQUIRED');
    if(plan.command.startsWith('site.') && plan.siteFingerprint!==this.siteFingerprint())throw failure('Les réglages ont changé depuis la prévisualisation.',409,'ADMIN_PLAN_STALE');
    if(plan.target==='user'){const users=plan.targets.map(item=>this.resolve(item.id));this.ensureTargets(plan.command,users,plan.params,principal);if(users.some(user=>this.fingerprint(user)!==plan.fingerprints[user.id]))throw failure('Un compte a changé depuis la prévisualisation. Préparez une nouvelle commande.',409,'ADMIN_PLAN_STALE');}
    const recent=(this.store.state.adminJobs||[]).filter(job=>job.createdAt>this.clock()-30*86400000);
    if(recent.filter(job=>!FINAL.has(job.state)).length>=20)throw failure('La file contient déjà vingt opérations. Attendez ou annulez les opérations en attente.',429);
    const job={id:randomUUID(),command:plan.command,label:plan.label,params:this.store.seal(plan.params),target:plan.target,creator:{kind:principal.kind,userId:principal.userId||null},createdAt:this.clock(),state:'queued',cancelRequested:false,fingerprints:plan.fingerprints,siteVersion:plan.version,siteFingerprint:plan.siteFingerprint,items:plan.targets.map(item=>({...item,state:'queued',attempts:0})),version:1,keepSessionId:principal.kind==='web'?digest(principal.userId+':session:'+principal.sessionHash).slice(0,24):null};
    this.store.state.adminJobs=[...recent.slice(-199),job];this.plans.delete(plan.id);this.touch();this.audit.record('admin.job.created',{source:'admin',actorId:this.actorId(principal),meta:{jobId:job.id,mode:job.command,count:job.items.length}});this.schedule(()=>void this.runQueue().catch(()=>{this.closed=true;}));return this.publicJob(job);
  }
  publicJob(job){return {id:job.id,command:job.command,label:job.label,state:job.state,createdAt:job.createdAt,startedAt:job.startedAt||null,finishedAt:job.finishedAt||null,cancelRequested:job.cancelRequested,creator:job.creator,version:job.version,counts:{total:job.items.length,succeeded:job.items.filter(item=>item.state==='succeeded').length,failed:job.items.filter(item=>['failed','interrupted'].includes(item.state)).length,done:job.items.filter(item=>!['queued','running'].includes(item.state)).length},items:job.items.map(item=>({id:item.id,name:item.name,login:item.login||'',state:item.state,code:item.code||null,message:item.message||'',attempts:item.attempts,durationMs:item.durationMs||null})),hasSecret:this.secretAvailable(job),canRetry:RETRYABLE.has(job.command)&&job.items.some(item=>['failed','interrupted','cancelled'].includes(item.state)),result:job.result||null};}
  jobs(input={}){const rows=(this.store.state.adminJobs||[]).slice().reverse(),offset=pageNumber(input.offset,0,10000),limit=Math.max(1,pageNumber(input.limit,25,100));return {items:rows.slice(offset,offset+limit).map(job=>{const value=this.publicJob(job);return {...value,items:[],result:null,hasReport:!!value.result};}),total:rows.length,offset,limit};}
  job(id){const job=this.store.state.adminJobs?.find(item=>item.id===id);if(!job)throw failure('Opération introuvable.',404);return job;}
  cancel(principal,id){this.authorize(principal);const job=this.job(id);if(FINAL.has(job.state))return this.publicJob(job);if(job.state==='queued'){job.state='cancelled';job.finishedAt=this.clock();for(const item of job.items)Object.assign(item,{state:'cancelled',code:'ADMIN_CANCELLED',message:'Annulé avant son démarrage.'});}job.cancelRequested=true;job.version++;this.touch();this.audit.record('admin.job.cancelled',{source:'admin',actorId:this.actorId(principal),meta:{jobId:id,mode:job.command}});if(job.state==='queued')this.schedule(()=>void this.runQueue().catch(()=>{this.closed=true;}));return this.publicJob(job);}
  retry(principal,id){this.authorize(principal);const job=this.job(id);if(!RETRYABLE.has(job.command)||!FINAL.has(job.state))throw failure('Cette opération ne peut pas être relancée automatiquement.',409);const ids=job.items.filter(item=>['failed','interrupted','cancelled'].includes(item.state)).map(item=>item.id);if(!ids.length)throw failure('Aucun élément à relancer.');return this.prepare(principal,{command:job.command,params:this.store.open(job.params),selection:job.target==='site'?{}:{ids}});}
  secretAvailable(job){if(!job.secret||job.secretReadAt)return false;try{const value=this.store.open(job.secret);if(value.expires<=this.clock())return false;const token=new URLSearchParams(new URL(value.url).hash.slice(1));if(job.command==='account.reset')return this.store.user(job.items[0].id)?.passwordReset?.hash===digest(token.get('reset-password')||'');if(job.command==='invite.create')return this.store.state.invites.some(invite=>invite.hash===digest(token.get('invitation')||'')&&invite.expires>this.clock());return false;}catch{return false;}}
  reveal(principal,id){this.authorize(principal);const job=this.job(id);if(!this.elevated(principal))throw failure('Vérifiez votre accès administrateur.',403,'ADMIN_REAUTH_REQUIRED');if(job.creator.kind!==principal.kind||principal.kind==='web'&&job.creator.userId!==principal.userId||!this.secretAvailable(job))throw failure('Ce lien privé a déjà été affiché ou appartient à un autre administrateur.',410);const value=this.store.open(job.secret);job.secretReadAt=this.clock();job.secret=null;this.touch();this.audit.record('admin.secret.revealed',{source:'admin',actorId:this.actorId(principal),meta:{jobId:id,mode:job.command}});return value;}
  async runQueue(){
    if(this.running||this.closed)return;this.running=true;
    try{for(let job;(job=(this.store.state.adminJobs||[]).find(item=>item.state==='queued'));){
      if(this.closed)break;job.state='running';job.startedAt=this.clock();job.version++;this.touch();
      for(const item of job.items){
        if(this.closed)break;
        if(job.cancelRequested){Object.assign(item,{state:'cancelled',code:'ADMIN_CANCELLED',message:'Annulé avant son démarrage.'});continue;}
        const principal=job.creator.kind==='local'?{kind:'local'}:{kind:'web',userId:job.creator.userId};
        const started=this.clock();item.state='running';item.attempts++;job.version++;this.touch();
        try{
          this.authorize(principal);const params=this.store.open(job.params);
          if(job.target==='user'){const user=this.resolve(item.id);this.ensureTargets(job.command,[user],params,principal);if(this.fingerprint(user)!==job.fingerprints[user.id])throw failure('Le compte a changé depuis l’approbation.',409,'ADMIN_PLAN_STALE');}
          if(job.command.startsWith('site.')&&job.siteFingerprint!==this.siteFingerprint())throw failure('Les réglages ont changé depuis l’approbation.',409,'ADMIN_PLAN_STALE');
          const result=await this.perform(job,item,params,principal);Object.assign(item,{state:'succeeded',code:'OK',message:result?.message||'Opération terminée.'});
          if(result?.secret)job.secret=this.store.seal(result.secret);if(result?.result)job.result=result.result;
          this.audit.record('admin.command.applied',{source:'admin',actorId:this.actorId(principal),userId:job.target==='user'?item.id:null,meta:{jobId:job.id,mode:job.command,status:200,durationMs:this.clock()-started}});
        }catch(error){Object.assign(item,{state:'failed',code:/^[A-Z_]{1,50}$/.test(error.code||'')?error.code:'ADMIN_ACTION_FAILED',message:error instanceof PublicError?redact(error.message):'Cette opération n’a pas pu être terminée.'});this.audit.record('admin.command.failed',{source:'admin',level:'warn',actorId:this.actorId(principal),userId:job.target==='user'?item.id:null,meta:{jobId:job.id,mode:job.command,errorCode:item.code}});}
        item.durationMs=Math.max(0,this.clock()-started);job.version++;this.touch();
      }
      if(this.closed)break;
      const succeeded=job.items.filter(item=>item.state==='succeeded').length,failed=job.items.some(item=>item.state==='failed');job.state=job.cancelRequested?'cancelled':failed?(succeeded||job.items.some(item=>item.code==='SOURCE_PARTIAL'))?'partial':'failed':'completed';job.finishedAt=this.clock();job.version++;this.touch();
      this.audit.record('admin.job.completed',{source:'admin',actorId:job.creator.kind==='local'?'local-admin':job.creator.userId,meta:{jobId:job.id,mode:job.command,count:succeeded,status:failed?409:200}});
    }}finally{this.running=false;}
  }
  async perform(job,item,params,principal){
    const now=this.clock(),command=job.command,user=job.target==='user'?this.resolve(item.id):null;
    if(command==='account.suspend'){this.store.state.sessions=this.store.state.sessions.filter(session=>session.userId!==user.id);this.store.update(user.id,{suspendedAt:now,suspendedBy:this.actorId(principal)});await this.browsers.stop(user.id);}
    if(command==='account.resume')this.store.update(user.id,{suspendedAt:null,suspendedBy:null});
    if(command==='account.archive'){this.store.state.sessions=this.store.state.sessions.filter(session=>session.userId!==user.id);this.store.update(user.id,{archivedAt:now,archivedBy:this.actorId(principal)});await this.browsers.stop(user.id);}
    if(command==='account.restore')this.store.update(user.id,{archivedAt:null,archivedBy:null});
    if(command==='account.role'){this.store.state.sessions=this.store.state.sessions.filter(session=>session.userId!==user.id);this.store.update(user.id,{admin:params.role==='admin'});}
    if(command==='account.sessions')this.store.state.sessions=this.store.state.sessions.filter(session=>session.userId!==user.id||params.keepCurrent&&principal.kind==='web'&&digest(user.id+':session:'+session.hash).slice(0,24)===job.keepSessionId);
    if(command==='account.profile')this.store.update(user.id,{...(params.name?{name:params.name}:{}),...(params.login?{login:params.login}:{}),...(params.tags?{adminTags:params.tags}:{})});
    if(command==='account.note')this.store.update(user.id,{adminNote:params.note?this.store.seal(params.note):null,adminNoteUpdatedAt:now,adminNoteBy:this.actorId(principal)});
    if(command==='account.reset'){
      const token=random();this.store.update(user.id,{passwordReset:{hash:digest(token),expires:now+30*60000,createdAt:now}});return {secret:{url:this.baseURL+'/#reset-password='+token,expires:now+30*60000,label:'Réinitialisation · '+user.name}};
    }
    if(command==='sync.run'){
      if(!accountActive(user))throw failure('Le compte est suspendu ou archivé.',409,'ACCOUNT_DISABLED');
      const reads=[];
      if(['ent','all'].includes(params.source)&&user.skolengo)reads.push(['ENT',()=>this.engine.run(user.id)]);
      if(['pronote','all'].includes(params.source)&&linkedPronote(user))reads.push(['Pronote',()=>this.pronote.sync(user)]);
      if(!reads.length)throw failure('Aucune connexion correspondante n’est configurée.',409,'SOURCE_NOT_CONNECTED');
      const results=[];for(const [source,run]of reads)try{await run();results.push({source,ok:true});}catch{results.push({source,ok:false});}
      if(results.some(result=>!result.ok))throw failure(results.map(result=>result.source+' : '+(result.ok?'actualisé':'lecture interrompue')).join(' · '),502,results.some(result=>result.ok)?'SOURCE_PARTIAL':'SOURCE_UNAVAILABLE');
    }
    if(command==='sync.pause')this.store.update(user.id,{...(['ent','all'].includes(params.source)?{enabled:false}:{}),...(['pronote','all'].includes(params.source)?{pronoteSyncEnabled:false}:{})});
    if(command==='sync.resume'){
      if(!accountActive(user))throw failure('Réactivez le compte avant de reprendre ses actualisations.',409);
      const values={};if(['ent','all'].includes(params.source)){if(params.source==='ent'&&(!user.skolengo||!user.feedKey||user.skolengoError))throw failure('Reconnectez l’ENT et préparez son lien ICS.',409);if(user.skolengo&&user.feedKey&&!user.skolengoError)Object.assign(values,{enabled:true,lastAttempt:null});}
      if(['pronote','all'].includes(params.source)){if(params.source==='pronote'&&(!linkedPronote(user)||user.pronoteNeedsReconnect))throw failure('Le titulaire doit reconnecter Pronote.',409);if(linkedPronote(user)&&!user.pronoteNeedsReconnect)Object.assign(values,{pronoteSyncEnabled:true,pronoteLastAttempt:null});}
      if(!Object.keys(values).length)throw failure('Aucune connexion prête à reprendre.',409);this.store.update(user.id,values);
    }
    if(command==='feed.rebuild'){if(!user.lastSync)throw failure('Aucun agenda n’a encore été synchronisé.',409);rebuildCalendar(this.store,user.id,now);}
    if(command==='feed.rotate'){if(!user.feedKey)throw failure('Ce compte ne dispose pas de lien ICS.',409);const key=random();this.store.update(user.id,{feedKey:this.store.seal(key),feedHash:digest(key)});}
    if(command==='feed.revoke')this.store.update(user.id,{feedKey:null,feedHash:null,enabled:false});
    if(command==='mail.pause')this.store.update(user.id,{...(user.emailConfig?{emailConfig:{...user.emailConfig,enabled:false,wantedEnabled:false,alertsEnabled:false,wantedAlertsEnabled:false}}:{}),emailAlertQueue:[]});
    if(command==='cache.clear'){if(this.school.busy(user.id)||this.engine.running.has(user.id))throw failure('Une consultation est en cours pour ce compte.',409,'SOURCE_BUSY');this.school.contexts.delete(user.id);this.menu?.contexts?.delete?.(user.id);}
    if(command==='site.registration'){this.store.state.settings.publicRegistration=params.enabled;this.store.state.settings.siteVersion=(this.store.state.settings.siteVersion||0)+1;}
    if(command==='site.maintenance'){this.store.state.settings.maintenance=params.enabled?{enabled:true,since:now,until:now+params.minutes*60000,message:params.message}:null;this.store.state.settings.siteVersion=(this.store.state.settings.siteVersion||0)+1;}
    if(command==='site.automation'){const sources=params.source==='all'?['ent','pronote','mail','push']:[params.source];this.store.state.settings.automationPaused={...this.store.state.settings.automationPaused,...Object.fromEntries(sources.map(source=>[source,params.paused]))};this.store.state.settings.siteVersion=(this.store.state.settings.siteVersion||0)+1;}
    if(command==='site.announcement'){this.store.state.settings.announcement=params.enabled?{id:randomUUID(),title:params.title,message:params.message,tone:params.tone,startsAt:now,until:now+params.minutes*60000}:null;this.store.state.settings.siteVersion=(this.store.state.settings.siteVersion||0)+1;}
    if(command==='invite.create'){const token=random(),expires=now+params.hours*3600000;this.store.state.invites.push({id:randomUUID(),hash:digest(token),admin:params.role==='admin',expires,createdAt:now,createdBy:this.actorId(principal)});return {secret:{url:this.baseURL+'/#invitation='+token,expires,label:params.role==='admin'?'Invitation administrateur':'Invitation membre'}};}
    if(command==='invite.revoke')this.store.state.invites=this.store.state.invites.filter(invite=>(invite.id||digest(invite.hash).slice(0,24))!==item.id);
    if(command==='incident.ack'){const incident=this.store.state.adminIncidents?.find(incident=>incident.id===item.id);if(!incident||incident.state==='resolved')throw failure('Cet incident est déjà résolu.',409);Object.assign(incident,{state:'acknowledged',acknowledgedAt:now,acknowledgedBy:this.actorId(principal)});}
    if(command==='diagnose.run')return {result:this.diagnostic(),message:'Diagnostic terminé. Aucun mail envoyé.'};
    return {message:'Opération terminée.'};
  }
  read(principal,request){
    this.authorize(principal);
    const action=typeof request==='string'?parseAdminCommand(request):request;
    if(action.type==='help')return {type:'help',help:COMMAND_HELP,commands:COMMANDS};
    if(action.type==='overview')return {type:'overview',data:this.overview()};
    if(action.type==='diagnostic')return {type:'diagnostic',data:this.diagnostic()};
    if(action.type==='users')return {type:'users',data:this.users(action.filters)};
    if(action.type==='user')return {type:'user',data:this.detail(action.ref)};
    if(action.type==='jobs')return {type:'jobs',data:this.jobs(action.filters)};
    if(action.type==='job.secret')return {type:'secret',data:this.reveal(principal,action.id)};
    if(action.type==='job.show')return {type:'job',data:this.publicJob(this.job(action.id))};
    if(action.type==='job.cancel')return {type:'job',data:this.cancel(principal,action.id)};
    if(action.type==='job.retry')return {type:'plan',data:this.retry(principal,action.id)};
    if(action.type==='incidents')return {type:'incidents',data:this.incidents()};
    if(action.type==='invites')return {type:'invites',data:this.invitations()};
    if(action.type==='logs'){const filters={...action.filters};if(filters.user)filters.userId=this.resolve(filters.user).id;return {type:'logs',data:this.audit.query(filters)};}
    if(action.type==='prepare')return {type:'plan',data:this.prepare(principal,action)};
    if(action.type==='apply')return {type:'plan',data:this.publicPlan(this.getPlan(principal,action.id),principal)};
    throw failure('Commande inconnue.');
  }
  close(){this.closed=true;}
}

export function installAdminControl(router,options){
  const {auth,admin,store,rateLimit,clock}=options,control=new AdminControl(store,options);
  const principal=req=>control.principal(req),limit=req=>rateLimit(req,'admin-control:'+req.user.id,180,15*60000);
  router.get('/api/admin/control/overview',auth,admin,(req,res)=>res.json(control.overview()));
  router.post('/api/admin/control/users',auth,admin,(req,res)=>{limit(req);res.json(control.users(req.body));});
  router.get('/api/admin/control/users/:id',auth,admin,(req,res)=>{limit(req);res.json(control.detail(req.params.id));});
  router.get('/api/admin/control/incidents',auth,admin,(req,res)=>res.json(control.incidents(req.query)));
  router.get('/api/admin/control/jobs',auth,admin,(req,res)=>res.json(control.jobs(req.query)));
  router.get('/api/admin/control/jobs/:id',auth,admin,(req,res)=>res.json(control.publicJob(control.job(req.params.id))));
  router.get('/api/admin/control/invites',auth,admin,(req,res)=>res.json(control.invitations()));
  router.get('/api/admin/control/catalogue',auth,admin,(req,res)=>res.json({commands:COMMANDS,help:COMMAND_HELP}));
  router.post('/api/admin/control/reauth',auth,admin,(req,res)=>{rateLimit(req,'admin-reauth:'+req.user.id,6,15*60000);res.json(control.reauthenticate(req,req.body.password));});
  router.post('/api/admin/control/prepare',auth,admin,(req,res)=>{limit(req);res.json(control.prepare(principal(req),req.body));});
  router.post('/api/admin/control/apply',auth,admin,(req,res)=>{limit(req);res.json(control.apply(principal(req),req.body));});
  router.post('/api/admin/control/console',auth,admin,(req,res)=>{limit(req);res.json(control.read(principal(req),String(req.body.line||'')));});
  router.post('/api/admin/control/jobs/:id/cancel',auth,admin,(req,res)=>res.json(control.cancel(principal(req),req.params.id)));
  router.post('/api/admin/control/jobs/:id/retry',auth,admin,(req,res)=>res.json(control.retry(principal(req),req.params.id)));
  router.post('/api/admin/control/jobs/:id/secret',auth,admin,(req,res)=>res.json(control.reveal(principal(req),req.params.id)));
  router.post('/api/admin/control/export',auth,admin,(req,res)=>{
    limit(req);const rows=[];for(let offset=0;offset<5000;offset+=100){const page=control.users({...req.body,offset,limit:100});rows.push(...page.users);if(rows.length>=page.total)break;}
    const csv=value=>'"'+String(value??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';
    const table=[['Identifiant','Prénom','Rôle','État','Établissement','ENT','Pronote','Lien ICS','Dernière synchro','Étiquettes'],...rows.map(user=>[user.login,user.name,user.admin?'admin':'membre',user.state,user.schoolName,user.ent.connected?'oui':'non',user.pronote.connected?'oui':'non',user.feed.active?'oui':'non',user.ent.lastSync?new Date(user.ent.lastSync).toISOString():'',user.tags.join(' | ')])];
    control.audit.record('admin.exported',{source:'admin',actorId:req.user.id,meta:{count:rows.length,mode:'accounts'}});res.type('text/csv; charset=utf-8').attachment('passerelle-comptes.csv').send('\uFEFF'+table.map(row=>row.map(csv).join(',')).join('\r\n')+'\r\n');
  });
  router.post('/api/password/reset',(req,res)=>{
    rateLimit(req,'password-reset',10,15*60000);const token=String(req.body.token||''),password=String(req.body.password||'');
    const user=store.state.users.find(user=>user.passwordReset?.hash===digest(token)&&user.passwordReset.expires>clock());
    if(!user||!accountActive(user)||!token)throw failure('Ce lien a expiré ou a déjà été utilisé.',400,'RESET_EXPIRED');
    if(password.length<12||password.length>256)throw failure('Utilisez un mot de passe de 12 à 256 caractères.');
    store.update(user.id,{password:passwordHash(password),passwordReset:null});store.state.sessions=store.state.sessions.filter(session=>session.userId!==user.id);store.save();control.audit.record('security.password_reset',{source:'security',userId:user.id});res.json({ok:true});
  });
  return control;
}
