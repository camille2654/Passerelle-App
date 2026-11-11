import {createHmac,createHash,randomUUID,timingSafeEqual} from 'node:crypto';
import {Skolengo} from 'scolengo-api';
import {random,digest} from './store.js';
import {PublicError,SyncEngine} from './sync.js';
import {publicProvider} from './ent-providers.js';
import {searchSchools,withSkolengoLock} from './skolengo.js';
import {userWork} from './work.js';
import {syncPolicy} from './sync-policy.js';
import {ManagedSchoolService} from './managed-school.js';

const CALLBACK='https://mon-ent.pages.dev/passerelle/ent/callback';
const COOKIE='passerelle_managed_ent',TTL=12*60000,CODE_TTL=2*60000,TOKEN=/^[A-Za-z0-9_-]{43}$/;
const SCOPES=['courses','homework','exams','messages','news'];
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const fail=(text,status=400)=>{throw new PublicError(text,status);};
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookie=req=>(req.headers.cookie||'').split(';').map(part=>part.trim().split('=')).find(([name])=>name===COOKIE)?.[1];
const subject=value=>typeof value==='string'&&/^[A-Za-z0-9:@._+-]{1,200}$/.test(value);
const sourceScope=user=>digest(JSON.stringify([user.id,user.studentId,user.skolengoConnectionId]));
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;

// Technical connections are deliberately absent from state.users and portal sessions.
class ManagedStore{
  constructor(parent){this.parent=parent;this.key=parent.key;this.dir=parent.dir;}
  get state(){return {users:this.parent.state.managedENTConnections||[],settings:this.parent.state.settings};}
  user(id){return this.state.users.find(row=>row.id===id);}
  update(id,input){const user=this.user(id);if(!user)throw new Error('SOURCE_CHANGED');Object.assign(user,input);this.save();return user;}
  save(){this.parent.save();}
  prune(){}
  seal(value){return this.parent.seal(value);}
  open(value){return this.parent.open(value);}
}

export class ManagedENTService{
  constructor(parent,{browsers,baseURL,clock=()=>Date.now(),audit,schoolSearch=searchSchools,clientFactory,schedule=fn=>queueMicrotask(()=>void fn()),revokeSource=async config=>{const client=await Skolengo.getOIDClient(config.school);await client.revoke(config.tokenSet.refresh_token);}}={}){
    this.parent=parent;this.store=new ManagedStore(parent);this.browsers=browsers;this.baseURL=baseURL;this.clock=clock;this.audit=audit;this.schoolSearch=schoolSearch;this.schedule=schedule;this.revokeSource=revokeSource;
    this.engine=new SyncEngine(this.store,{clock,audit,...(clientFactory?{clientFactory}:{})});this.schoolData=new ManagedSchoolService(this,{clientFactory});this.sessions=new Map();this.codes=new Map();this.closed=false;this.queued=new Set();
    this.timer=setInterval(()=>this.prune(),60000);this.timer.unref();
  }
  settings(){return this.parent.state.settings.managedENTLapsus||{};}
  configuration(){const config=this.settings();return {enabled:config.enabled===true,configured:!!config.keyHash,callbackURL:CALLBACK,keyCreatedAt:config.keyCreatedAt||null};}
  configure(input,actor){if(!keys(input,['enabled'])||typeof input.enabled!=='boolean')fail('Choisissez l’activation du connecteur Lapsus.');this.parent.state.settings.managedENTLapsus={...this.settings(),enabled:input.enabled};this.parent.save();if(!input.enabled)this.clearSessions();this.audit?.record('managed.configured',{source:'admin',actorId:actor.id,meta:{enabled:input.enabled}});return this.configuration();}
  issueKey(actor){const key=random(),config=this.settings();this.clearSessions();this.parent.state.settings.managedENTLapsus={...config,keyHash:digest(key),keyCreatedAt:this.clock(),keyVersion:(config.keyVersion||0)+1};this.parent.save();this.audit?.record('managed.key.created',{source:'admin',actorId:actor.id});return {key,...this.configuration()};}
  available(){if(this.closed||!this.settings().enabled||!this.settings().keyHash)fail('La connexion ENT via Lapsus n’est pas activée.',503);}
  authenticate(req,{cleanup=false}={}){if(!cleanup)this.available();else if(this.closed)fail('Le connecteur ENT est momentanément indisponible.',503);const match=/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(req.get('authorization')||'');if(!match||!equal(digest(match[1]),this.settings().keyHash))fail('Clé d’accès partenaire invalide.',401);const origin=req.get('origin');if(origin&&origin!==new URL(this.baseURL).origin)fail('Utilisez cette API depuis le serveur Lapsus.',403);}
  externalHash(value){if(!subject(value))fail('Identifiant du compte Lapsus invalide.');return createHmac('sha256',this.parent.key).update('managed-ent:lapsus:'+value).digest('hex');}
  external(req){const value=req.get('x-lapsus-user');if(!subject(value))fail('Le compte Lapsus authentifié est requis.',401);return {value,hash:this.externalHash(value)};}
  connection(req){const owner=this.external(req),row=this.store.user(req.params.id);if(!row||row.tenantId!=='lapsus'||row.externalUserHash!==owner.hash||row.archivedAt)fail('Connexion ENT introuvable.',404);return row;}
  dataConnection(req){const user=this.connection(req);if(!user.establishedAt)fail('Terminez la connexion ENT avant de consulter ses données.',409);return user;}
  createSession(req){
    this.prune();const input=req.body,owner=this.external(req);
    if(!keys(input,['externalUserId','scopes','state','codeChallenge'])||input.externalUserId!==owner.value||typeof input.state!=='string'||!TOKEN.test(input.state)||typeof input.codeChallenge!=='string'||!TOKEN.test(input.codeChallenge)||!Array.isArray(input.scopes)||!input.scopes.length||input.scopes.length>SCOPES.length||new Set(input.scopes).size!==input.scopes.length||input.scopes.some(value=>!SCOPES.includes(value)))fail('La demande de connexion ENT est invalide.');
    if(this.sessions.size>=50)fail('Les connexions ENT sont occupées. Réessayez dans quelques minutes.',429);
    let connection=this.store.state.users.find(row=>row.tenantId==='lapsus'&&row.externalUserHash===owner.hash&&!row.archivedAt);
    if(!connection){if(this.store.state.users.length>=1000)fail('La capacité du connecteur est atteinte.',429);connection={id:'ment-'+randomUUID(),tenantId:'lapsus',externalUserHash:owner.hash,externalUser:this.store.seal(owner.value),name:'Connexion Lapsus',createdAt:this.clock(),enabled:false,scopes:[]};(this.parent.state.managedENTConnections??=[]).push(connection);this.parent.save();}
    for(const [id,row]of this.sessions)if(row.connectionId===connection.id){this.sessions.delete(id);void this.browsers.stop(connection.id);}
    const session=random(),sessionId=digest(session),row={connectionId:connection.id,externalUserHash:owner.hash,state:input.state,challenge:input.codeChallenge,scopes:[...input.scopes],keyVersion:this.settings().keyVersion,expiresAt:this.clock()+TTL,status:'school',schools:new Map(),browserHash:null};this.sessions.set(sessionId,row);
    return {sessionId:session,connectionId:connection.id,launchURL:this.baseURL+'/ent-connect?session='+session,expiresAt:row.expiresAt};
  }
  launch(req,res){this.available();this.prune();const token=req.query.session,row=typeof token==='string'&&TOKEN.test(token)?this.sessions.get(digest(token)):null;if(!row||row.keyVersion!==this.settings().keyVersion)fail('Cette connexion a expiré. Relancez-la depuis Lapsus.',410);let browser=cookie(req);if(row.browserHash){if(!TOKEN.test(browser||'')||!equal(digest(browser),row.browserHash))fail('Cette demande a déjà été ouverte.',410);}else{browser=random();row.browserHash=digest(browser);}res.cookie(COOKIE,browser,{httpOnly:true,secure:new URL(this.baseURL).protocol==='https:',sameSite:'lax',path:new URL(this.baseURL).pathname||'/',maxAge:Math.max(1,row.expiresAt-this.clock())});res.redirect(302,this.baseURL+'/ent-connect/');}
  browserSession(req){this.available();this.prune();const token=cookie(req);if(!TOKEN.test(token||''))fail('Relancez la connexion depuis Lapsus.',401);const hash=digest(token),row=[...this.sessions.values()].find(item=>item.browserHash===hash&&item.keyVersion===this.settings().keyVersion);if(!row||!this.store.user(row.connectionId))fail('Cette demande a expiré. Relancez la connexion depuis Lapsus.',410);return row;}
  browserStatus(req){const row=this.browserSession(req),user=this.store.user(row.connectionId),remote=this.browsers.status(user.id);let status=row.status;if(['loading','login','processing'].includes(remote.status)&&row.status==='login')status='login';if(remote.status==='error'&&row.status==='login')status='error';if(row.status==='syncing'){if(user.lastSync)status='ready';else if(user.lastError)status='error';}return {status,schoolName:user.schoolName||'',students:row.status==='student'?(user.students||[]).map(student=>({id:student.id,name:student.name,className:student.className})):[],studentId:user.studentId||null,expiresAt:row.expiresAt,host:remote.host||'',error:status==='error'?(row.error||user.lastError||remote.error||'La connexion ENT n’a pas abouti. Réessayez.'):undefined,scopes:row.scopes};}
  async schools(req){const row=this.browserSession(req);if(!keys(req.body,['q'])||typeof req.body.q!=='string'||req.body.q.trim().length<3||req.body.q.length>100)fail('Indiquez au moins trois caractères pour rechercher votre établissement.');if(row.status!=='school')fail('La recherche n’est plus disponible pour cette demande.',409);const results=await this.schoolSearch(req.body.q.trim());if(this.browserSession(req)!==row)fail('Cette demande a expiré.',410);row.schools=new Map(results.slice(0,50).map(school=>[school.id,school]));return {schools:[...row.schools.values()].map(school=>({id:school.id,name:school.name,city:school.city||'',provider:publicProvider(school)}))};}
  async start(req){const row=this.browserSession(req);if(!keys(req.body,['schoolId'])||typeof req.body.schoolId!=='string'||!row.schools.has(req.body.schoolId)||row.status!=='school')fail('Recherchez et choisissez votre établissement.');const user=this.store.user(row.connectionId),school=row.schools.get(req.body.schoolId);row.status='login';try{await this.browsers.start(user,school,{store:this.store,releaseOnConnected:true,onError:async()=>{if(![...this.sessions.values()].includes(row))return;row.status='error';row.error='La connexion ENT a échoué. Annulez puis relancez-la depuis Lapsus.';},onConnected:async connected=>{if(this.closed||![...this.sessions.values()].includes(row)||row.expiresAt<=this.clock()||!this.settings().enabled)throw new Error('SOURCE_CHANGED');this.store.update(connected.id,{scopes:[...row.scopes],managedLastActiveAt:this.clock(),enabled:false,connectedAt:this.clock(),establishedAt:null,calendarEvents:{},taskCalendar:{},assignments:[],cachedICS:null,lastSync:null,lastAttempt:null,lastFullSync:null,lastRecentSync:null,lastSyncRange:null,syncRetryAt:null,syncErrorStreak:0,lastError:null,homeworkWarning:null,homeworkAvailable:false,calendarWindow:null});if(connected.students?.length>1){row.status='student';return;}row.status='syncing';this.store.update(connected.id,{enabled:true});this.queue(connected.id,'full');}});}catch(error){row.status='school';throw error;}return this.browserStatus(req);}
  student(req){const row=this.browserSession(req),user=this.store.user(row.connectionId);if(row.status!=='student'||!keys(req.body,['studentId'])||!user.students?.some(student=>student.id===req.body.studentId))fail('Choisissez un élève associé à cette connexion.');this.store.update(user.id,{studentId:req.body.studentId,enabled:true,lastSync:null,calendarEvents:{},taskCalendar:{},assignments:[]});row.status='syncing';this.queue(user.id,'full');return this.browserStatus(req);}
  queue(id,mode='full'){if(this.closed||this.queued.has(id))return;this.queued.add(id);this.schedule(async()=>{try{if(this.settings().enabled&&this.store.user(id)?.enabled)await this.engine.run(id,{mode});}catch{}finally{this.queued.delete(id);}});}
  finish(req){const row=this.browserSession(req),user=this.store.user(row.connectionId);if(!keys(req.body,[]))fail('Demande de retour invalide.');if(!user.lastSync||row.status!=='syncing'||user.skolengoError)fail('Attendez la fin de la première synchronisation.',409);if(row.finished)fail('Cette connexion a déjà été terminée.',410);const code=random(),url=new URL(CALLBACK);url.searchParams.set('code',code);url.searchParams.set('state',row.state);url.searchParams.set('iss',this.baseURL);this.codes.set(digest(code),{connectionId:user.id,externalUserHash:row.externalUserHash,context:sourceScope(user),challenge:row.challenge,keyVersion:row.keyVersion,expiresAt:this.clock()+CODE_TTL});row.finished=true;return {redirectURL:url.href};}
  exchange(req){this.prune();const owner=this.external(req),input=req.body;if(!keys(input,['code','codeVerifier'])||!TOKEN.test(input.code||'')||typeof input.codeVerifier!=='string'||!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier))fail('Code de connexion invalide.');const hash=digest(input.code),row=this.codes.get(hash);if(!row||row.externalUserHash!==owner.hash||row.keyVersion!==this.settings().keyVersion||!equal(row.challenge,createHash('sha256').update(input.codeVerifier).digest('base64url')))fail('Code de connexion invalide ou expiré.');const user=this.store.user(row.connectionId);if(!user||sourceScope(user)!==row.context||!user.lastSync)fail('La connexion ENT a changé. Relancez-la depuis Lapsus.',409);this.codes.delete(hash);this.store.update(user.id,{establishedAt:this.clock()});return {connectionId:user.id,...this.status(user)};}
  status(user){const policy=syncPolicy(user,this.clock()),interval=policy.intervalMs;return {connectionId:user.id,sourceVersion:sourceScope(user),status:user.skolengoError?'reauth_required':!user.skolengo?'not_connected':user.lastSync?'ready':'syncing',scopes:user.scopes||[],schoolName:user.schoolName||'',student:user.studentId?{name:user.students?.find(student=>student.id===user.studentId)?.name||'',className:user.students?.find(student=>student.id===user.studentId)?.className||''}:null,lastSync:user.lastSync||null,lastFullSync:user.lastFullSync||null,lastSyncMode:user.lastSyncMode||null,lastSyncRange:user.lastSyncRange?{start:user.lastSyncRange.start,end:user.lastSyncRange.end}:null,lastAttempt:user.lastAttempt||null,lastError:user.lastError||null,stale:!user.lastSync||this.clock()-user.lastSync>interval*2,nextSyncAt:policy.nextSyncAt};}
  range(query){if(!keys(query,['from','to'])||!date(query.from)||!date(query.to)||query.from>query.to||Date.parse(query.to)-Date.parse(query.from)>93*86400000)fail('Choisissez une période valide de 93 jours maximum.');return query;}
  agenda(req){const user=this.dataConnection(req),range=this.range(req.query);if(!user.scopes?.includes('courses'))fail('L’accès aux cours n’a pas été demandé.',403);return {...this.status(user),events:Object.values(user.calendarEvents||{}).filter(event=>!event.cancelled&&event.date>=range.from&&event.date<=range.to).map(event=>({id:event.id,title:event.rawTitle||event.title,start:event.start,end:event.end,location:event.location||'',subject:event.subject?.label||'',sequence:event.sequence||0,modifiedAt:event.modified||null}))};}
  homework(req){const user=this.dataConnection(req),range=this.range(req.query);if(!user.scopes?.some(scope=>['homework','exams'].includes(scope)))fail('L’accès au travail à faire n’a pas été demandé.',403);return {...this.status(user),available:user.homeworkAvailable===true,warning:user.homeworkWarning||null,items:userWork(user).filter(item=>item.due>=range.from&&item.due<=range.to&&user.scopes.includes(item.kind==='exam'?'exams':'homework')).map(item=>({id:item.id,title:item.title,details:item.details||'',due:item.due,subject:item.subject?.label||item.subjectLabel||'',kind:item.kind,done:!!item.done}))};}
  activity(req,refresh=false){const user=this.connection(req);if(!keys(req.body,[]))fail('Demande d’actualisation invalide.');const now=this.clock();this.store.update(user.id,{managedLastActiveAt:now,...(refresh?{syncRequestedAt:now}:{})});return {...this.status(user),scheduled:refresh};}
  async remove(user){this.schoolData.forget(user.id);this.cancelConnection(user.id);let config;try{if(user.skolengo)config=this.store.open(user.skolengo);}catch{}this.parent.state.managedENTConnections=this.store.state.users.filter(row=>row.id!==user.id);this.parent.save();if(config)this.schedule(async()=>{try{await withSkolengoLock(this.store,user.id,()=>this.revokeSource(config));}catch{}});this.audit?.record('managed.removed',{source:'security',meta:{mode:'lapsus'}});return {ok:true};}
  cancelConnection(id){for(const [key,row]of this.sessions)if(row.connectionId===id)this.sessions.delete(key);for(const [key,row]of this.codes)if(row.connectionId===id)this.codes.delete(key);void this.browsers.stop(id);}
  clearSessions(){for(const id of new Set([...this.sessions.values()].map(row=>row.connectionId))){const user=this.store.user(id);if(user&&!user.establishedAt){this.parent.state.managedENTConnections=this.store.state.users.filter(item=>item.id!==id);this.parent.save();}void this.browsers.stop(id);}this.sessions.clear();this.codes.clear();}
  prune(){const now=this.clock();for(const [key,row]of this.sessions)if(row.expiresAt<=now){this.sessions.delete(key);void this.browsers.stop(row.connectionId);const user=this.store.user(row.connectionId);if(user&&!user.establishedAt){this.parent.state.managedENTConnections=this.store.state.users.filter(item=>item.id!==user.id);this.parent.save();}}for(const [key,row]of this.codes)if(row.expiresAt<=now)this.codes.delete(key);const active=new Set([...this.sessions.values()].map(row=>row.connectionId));for(const user of [...this.store.state.users])if(!user.establishedAt&&!active.has(user.id)&&(user.connectedAt||user.createdAt||0)+TTL<=now)void this.remove(user);}
  async tick(){if(this.closed||!this.settings().enabled||!this.settings().keyHash)return;this.prune();await this.engine.tick();}
  close(){this.schoolData.close();this.closed=true;clearInterval(this.timer);this.sessions.clear();this.codes.clear();for(const user of this.store.state.users)void this.browsers.stop(user.id);}
}

export function installManagedENTRoutes(router,{store,browsers,auth,admin,rateLimit,audit,baseURL,clock,...options}){
 const service=new ManagedENTService(store,{browsers,baseURL,clock,audit,...options});
 const gate=(req,_res,next)=>{service.authenticate(req);rateLimit(req,'managed-api',180,60000);next();};
 const cleanup=(req,_res,next)=>{service.authenticate(req,{cleanup:true});rateLimit(req,'managed-api',180,60000);next();};
 const own=(req,res,next)=>{service.browserSession(req);rateLimit(req,'managed-browser',180,60000);next();};
 router.get('/api/admin/managed-ent/lapsus',auth,admin,(_req,res)=>res.json(service.configuration()));
 router.post('/api/admin/managed-ent/lapsus',auth,admin,(req,res)=>res.json(service.configure(req.body,req.user)));
 router.post('/api/admin/managed-ent/lapsus/key',auth,admin,(req,res)=>{if(!keys(req.body,[]))fail('Demande de clé invalide.');rateLimit(req,'managed-key',10,3600000);res.json(service.issueKey(req.user));});
 router.post('/api/managed-ent/sessions',gate,(req,res)=>{rateLimit(req,'managed-session',20,15*60000);res.json(service.createSession(req));});
 router.post('/api/managed-ent/exchange',gate,(req,res)=>res.json(service.exchange(req)));
 router.get('/api/managed-ent/connection',gate,(req,res)=>{const owner=service.external(req),connection=service.store.state.users.find(row=>row.externalUserHash===owner.hash&&!row.archivedAt);res.json(connection?service.status(connection):{connectionId:null});});
 router.delete('/api/managed-ent/connection',cleanup,async(req,res)=>{const owner=service.external(req);for(const row of [...service.store.state.users])if(row.tenantId==='lapsus'&&row.externalUserHash===owner.hash)await service.remove(row);res.json({ok:true});});
 router.get('/api/managed-ent/connections/:id/status',gate,(req,res)=>res.json(service.status(service.connection(req))));
 router.get('/api/managed-ent/connections/:id/agenda',gate,(req,res)=>res.json(service.agenda(req)));
 router.get('/api/managed-ent/connections/:id/homework',gate,(req,res)=>res.json(service.homework(req)));
 router.get('/api/managed-ent/connections/:id/school/:section',gate,async(req,res)=>res.json(await service.schoolData.load(req)));
 router.get('/api/managed-ent/connections/:id/detail/:ref',gate,async(req,res)=>res.json(await service.schoolData.detail(req)));
 router.get('/api/managed-ent/connections/:id/files/:ref',gate,async(req,res)=>{const file=await service.schoolData.download(req);res.set('Content-Type','application/octet-stream');res.set('Content-Disposition',"attachment; filename*=UTF-8''"+encodeURIComponent(file.name));res.send(file.bytes);});
 router.post('/api/managed-ent/connections/:id/activity',gate,(req,res)=>res.json(service.activity(req)));
 router.post('/api/managed-ent/connections/:id/sync',gate,(req,res)=>res.json(service.activity(req,true)));
 router.delete('/api/managed-ent/connections/:id',cleanup,async(req,res)=>res.json(await service.remove(service.connection(req))));
 router.get('/ent-connect',(req,res,next)=>{if(!Object.hasOwn(req.query,'session'))return next();rateLimit(req,'managed-launch',30,15*60000);service.launch(req,res);});
 router.get('/api/ent-connect/status',own,(req,res)=>res.json(service.browserStatus(req)));
 router.post('/api/ent-connect/schools',own,async(req,res)=>{rateLimit(req,'managed-schools',20,60000);res.json(await service.schools(req));});
 router.post('/api/ent-connect/start',own,async(req,res)=>{rateLimit(req,'managed-start',8,60000);res.json(await service.start(req));});
 router.get('/api/ent-connect/frame',own,async(req,res)=>{const row=service.browserSession(req),frame=await browsers.frame(row.connectionId);if(!frame)return res.status(204).end();res.type('jpeg').send(frame);});
 router.post('/api/ent-connect/input',own,async(req,res)=>{const row=service.browserSession(req);if(row.status!=='login')fail('Cette fenêtre de connexion est fermée.',409);await browsers.input(row.connectionId,req.body);res.json({ok:true});});
 router.post('/api/ent-connect/student',own,(req,res)=>res.json(service.student(req)));
 router.post('/api/ent-connect/finish',own,(req,res)=>res.json(service.finish(req)));
 router.post('/api/ent-connect/cancel',own,async(req,res)=>{if(!keys(req.body,[]))fail('Demande d’annulation invalide.');const row=service.browserSession(req),user=service.store.user(row.connectionId);if(user&&!user.establishedAt)await service.remove(user);else service.cancelConnection(row.connectionId);res.json({ok:true});});
 return service;
}
