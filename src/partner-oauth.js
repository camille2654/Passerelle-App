import express from 'express';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID, timingSafeEqual, createHash} from 'node:crypto';
import {random,digest} from './store.js';
import {PublicError} from './sync.js';
import {accountActive} from './operational-state.js';
import {combinedEvents} from './calendar.js';
import {renderCalendar} from './ical.js';

const ORIGIN='https://mon-ent.pages.dev';
const CALLBACK=ORIGIN+'/passerelle/callback';
const COOKIE='passerelle_oauth', TTL=10*60000, CODE_TTL=2*60000, ACCESS_TTL=3600000;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
export const PARTNER_SCOPES=Object.freeze([
  {id:'calendar:courses',label:'Emploi du temps',description:'Les cours, leurs horaires et leurs salles.',type:'course',key:'courses'},
  {id:'calendar:homework',label:'Devoirs',description:'Les devoirs et leurs consignes présentes dans l’agenda.',type:'homework',key:'homework'},
  {id:'calendar:exams',label:'Contrôles',description:'Les évaluations et leurs consignes présentes dans l’agenda.',type:'exam',key:'exams'}
]);
const objects=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value,allowed)=>objects(value)&&Object.keys(value).every(key=>allowed.includes(key));
const scopeRows=ids=>PARTNER_SCOPES.filter(row=>ids.includes(row.id)).map(({id,label,description})=>({id,label,description}));
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookieValue=req=>(req.headers.cookie||'').split(';').map(part=>part.trim().split('=')).find(([name])=>name===COOKIE)?.[1];
const context=user=>digest(JSON.stringify([user.id,user.studentId,user.schoolName,user.skolengoConnectionId,user.feedHash,user.partnerEpoch||0]));
const ready=user=>accountActive(user)&&!!(user.skolengo&&!user.skolengoError&&user.studentId&&user.feedKey&&user.feedHash&&user.cachedICS&&user.lastSync);
const fail=(message,status=400)=>{throw new PublicError(message,status);};
class OAuthError extends Error{constructor(error,description,status=400){super(description);this.error=error;this.status=status;}}
const oauthFail=(error,description,status=400)=>{throw new OAuthError(error,description,status);};
const configOf=store=>({id:'lapsus',name:'Lapsus',origin:ORIGIN,redirectURI:CALLBACK,enabled:true,version:0,...store.state.settings.partnerLapsus});

export class PartnerOAuthService{
  constructor(store,{baseURL,clock=()=>Date.now(),audit}={}){
    this.store=store;this.baseURL=baseURL;this.clock=clock;this.audit=audit;
    this.pending=new Map();this.codes=new Map();this.closed=false;
    this.timer=setInterval(()=>this.prune(),60000);this.timer.unref();
  }
  close(){clearInterval(this.timer);this.closed=true;this.pending.clear();this.codes.clear();}
  prune(){const now=this.clock();for(const map of [this.pending,this.codes])for(const [key,row]of map)if(row.expires<=now)map.delete(key);}
  configuration(){const {version,...client}=configOf(this.store);return {client,authorizeURL:this.baseURL+'/oauth/authorize',tokenURL:this.baseURL+'/oauth/token',calendarsURL:this.baseURL+'/api/partner/calendars'};}
  configure(input,actor){
    if(!exactKeys(input,['enabled','redirectURI'])||typeof input.enabled!=='boolean'||typeof input.redirectURI!=='string')fail('Indiquez une adresse de retour et l’état de la connexion.');
    let url;try{url=new URL(input.redirectURI);}catch{fail('L’adresse de retour doit être une URL HTTPS de Lapsus.');}
    if(url.origin!==ORIGIN||url.username||url.password||url.search||url.hash||url.href!==input.redirectURI||url.pathname==='/'||url.href.length>300)fail('Choisissez une adresse HTTPS exacte sur mon-ent.pages.dev, sans paramètres.');
    const previous=configOf(this.store);
    if(previous.enabled===input.enabled&&previous.redirectURI===input.redirectURI)return this.configuration();
    this.store.state.settings.partnerLapsus={enabled:input.enabled,redirectURI:input.redirectURI,version:previous.version+1};
    for(const user of this.store.state.users)for(const grant of user.partnerGrants||[])if(grant.clientId==='lapsus'&&!grant.revokedAt){grant.invalidatedAt=this.clock();grant.accessHash=null;grant.links=[];}
    this.store.save();this.pending.clear();this.codes.clear();
    this.audit?.record('partner.configured',{source:'admin',actorId:actor.id,meta:{mode:'lapsus',enabled:input.enabled}});
    return this.configuration();
  }
  active(user,grant){const config=configOf(this.store);return !this.closed&&ready(user)&&!!grant&&!grant.revokedAt&&!grant.invalidatedAt&&grant.clientId==='lapsus'&&config.enabled&&grant.configVersion===config.version&&grant.context===context(user);}
  session(user,id){return accountActive(user)&&this.store.user(user.id)===user&&this.store.state.sessions.some(row=>row.hash===id&&row.userId===user.id&&row.expires>Date.now());}
  authorize(req,res){
    this.prune();const query=req.query,config=configOf(this.store);
    if(!exactKeys(query,['response_type','client_id','redirect_uri','state','scope','code_challenge','code_challenge_method']))fail('La demande de connexion contient des paramètres invalides.');
    if(!config.enabled||query.client_id!=='lapsus'||query.redirect_uri!==config.redirectURI)fail('Cette application ou son adresse de retour n’est pas autorisée.');
    if(query.response_type!=='code'||query.code_challenge_method!=='S256'||typeof query.code_challenge!=='string'||!TOKEN.test(query.code_challenge))fail('Cette connexion exige un code d’autorisation protégé par PKCE S256.');
    if(typeof query.state!=='string'||!/^[\x21-\x7e]{16,512}$/.test(query.state))fail('La demande doit contenir un état de connexion aléatoire.');
    const scopes=typeof query.scope==='string'?query.scope.split(' '):['calendar:courses'];
    if(!scopes.length||scopes.length>3||new Set(scopes).size!==scopes.length||scopes.some(id=>!PARTNER_SCOPES.some(row=>row.id===id)))fail('Les agendas demandés ne sont pas disponibles.');
    if(this.pending.size>=200||this.codes.size>=200)fail('Beaucoup de connexions sont en cours. Réessayez dans quelques minutes.',429);
    let browser=cookieValue(req);if(!TOKEN.test(browser||''))browser=random();
    const browserHash=digest(browser);
    const own=[...this.pending.entries()].filter(([,row])=>row.browserHash===browserHash);
    if(own.length>=5)this.pending.delete(own[0][0]);
    const request=random();this.pending.set(digest(request),{browserHash,clientId:'lapsus',configVersion:config.version,redirectURI:config.redirectURI,state:query.state,challenge:query.code_challenge,scopes,expires:this.clock()+TTL,userId:req.user?.id||null,sessionHash:req.user?req.session.hash:null,context:req.user&&ready(req.user)?context(req.user):null});
    res.cookie(COOKIE,browser,{httpOnly:true,secure:new URL(this.baseURL).protocol==='https:',sameSite:'lax',path:new URL(this.baseURL).pathname||'/',maxAge:TTL});
    res.redirect(302,this.baseURL+'/oauth/consent?request='+request);
  }
  transaction(req,id){
    this.prune();const row=typeof id==='string'&&TOKEN.test(id)?this.pending.get(digest(id)):null,browser=cookieValue(req),config=configOf(this.store);
    if(!row||!TOKEN.test(browser||'')||!equal(row.browserHash,digest(browser))||!config.enabled||row.configVersion!==config.version)fail('Cette demande a expiré. Relancez la connexion depuis Lapsus.',410);
    if(!this.session(req.user,req.session?.hash))fail('Connectez-vous pour continuer.',401);
    if(row.userId&&(row.userId!==req.user.id||row.sessionHash!==req.session.hash||row.context&&row.context!==context(req.user))){this.pending.delete(digest(id));fail('Le compte ou l’élève a changé. Relancez la connexion depuis Lapsus.',409);}
    if(!row.userId){row.userId=req.user.id;row.sessionHash=req.session.hash;}
    if(!row.context&&ready(req.user))row.context=context(req.user);
    return row;
  }
  consent(req){
    const row=this.transaction(req,req.query.request),config=configOf(this.store);
    return {request:req.query.request,client:{id:config.id,name:config.name,origin:config.origin},requestedScopes:scopeRows(row.scopes),available:ready(req.user),reason:ready(req.user)?undefined:'Connectez votre ENT et créez votre lien ICS dans Passerelle avant de partager votre agenda.',account:{id:req.user.id,displayName:req.user.name||'Mon compte'},expiresAt:row.expires};
  }
  approve(req){
    const input=req.body;
    if(!exactKeys(input,['request','accountId','allow','scopes'])||input.accountId!==req.user.id||typeof input.allow!=='boolean'||!Array.isArray(input.scopes))fail('La demande de partage est invalide.');
    const row=this.transaction(req,input.request),url=new URL(row.redirectURI);
    url.searchParams.set('state',row.state);url.searchParams.set('iss',this.baseURL);
    if(!input.allow){url.searchParams.set('error','access_denied');this.pending.delete(digest(input.request));return {redirectURL:url.href};}
    if(!ready(req.user))fail('Préparez votre agenda dans Passerelle avant d’autoriser le partage.',409);
    if(!input.scopes.length||input.scopes.length>3||new Set(input.scopes).size!==input.scopes.length||input.scopes.some(scope=>typeof scope!=='string'||!row.scopes.includes(scope)))fail('Choisissez au moins un des agendas demandés.');
    if(this.codes.size>=200)fail('Beaucoup de connexions sont en cours. Réessayez dans quelques minutes.',429);
    const code=random();this.codes.set(digest(code),{...row,scopes:[...input.scopes],expires:this.clock()+CODE_TTL,used:false});
    this.pending.delete(digest(input.request));url.searchParams.set('code',code);return {redirectURL:url.href};
  }
  exchange(req){
    this.prune();const input=req.body,config=configOf(this.store);
    if(!exactKeys(input,['grant_type','client_id','redirect_uri','code','code_verifier']))oauthFail('invalid_request','Les paramètres d’échange sont invalides.');
    if(input.grant_type!=='authorization_code')oauthFail('unsupported_grant_type','Seul le code d’autorisation est accepté.');
    if(input.client_id!=='lapsus'||!config.enabled)oauthFail('invalid_client','Cette application n’est pas autorisée.');
    const row=typeof input.code==='string'&&TOKEN.test(input.code)?this.codes.get(digest(input.code)):null;
    const verifier=input.code_verifier,challenge=typeof verifier==='string'&&/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)?createHash('sha256').update(verifier).digest('base64url'):null;
    if(!row||row.configVersion!==config.version||row.redirectURI!==input.redirect_uri||!challenge||!equal(row.challenge,challenge))oauthFail('invalid_grant','Le code de connexion est invalide ou a expiré.');
    const user=this.store.user(row.userId);
    if(row.used){const grant=user?.partnerGrants?.find(item=>item.id===row.grantId);if(grant&&!grant.revokedAt){grant.revokedAt=this.clock();grant.accessHash=null;grant.links=[];this.store.save();}oauthFail('invalid_grant','Ce code a déjà été utilisé. Relancez la connexion.');}
    if(!this.session(user,row.sessionHash)||!ready(user)||row.context!==context(user))oauthFail('invalid_grant','Le compte ou l’agenda a changé. Relancez la connexion.');
    const access=random(),now=this.clock(),grant={id:randomUUID(),clientId:'lapsus',configVersion:config.version,context:row.context,scopes:row.scopes,createdAt:now,lastUsedAt:null,accessHash:digest(access),accessExpires:now+ACCESS_TTL,links:row.scopes.map(scope=>{const key=random();return {scope,hash:digest(key),key:this.store.seal(key)};})};
    // One current authorization per application. A new consent replaces its old links.
    const retained=(user.partnerGrants||[]).filter(item=>item.clientId!=='lapsus').slice(-9);
    user.partnerGrants=[...retained,grant];this.store.save();row.used=true;row.grantId=grant.id;
    this.audit?.record('partner.connected',{source:'security',userId:user.id,meta:{mode:'lapsus',count:row.scopes.length}});
    return {access_token:access,token_type:'Bearer',expires_in:ACCESS_TTL/1000,scope:row.scopes.join(' ')};
  }
  locate(predicate){for(const user of this.store.state.users)for(const grant of user.partnerGrants||[])if(predicate(grant))return {user,grant};return {};}
  used(user,grant){if(!grant.lastUsedAt||this.clock()-grant.lastUsedAt>=5*60000){grant.lastUsedAt=this.clock();this.store.save();}}
  calendars(req){
    const bearer=req.get('authorization')||'',match=/^Bearer ([A-Za-z0-9_-]{43})$/i.exec(bearer);
    if(!match)oauthFail('invalid_token','Un jeton d’accès Bearer est nécessaire.',401);
    const hash=digest(match[1]),{user,grant}=this.locate(row=>row.accessHash===hash);
    if(!this.active(user,grant)||grant.accessExpires<=this.clock())oauthFail('invalid_token','L’accès a expiré ou a été retiré.',401);
    this.used(user,grant);
    return {calendars:grant.links.map(link=>{const row=PARTNER_SCOPES.find(item=>item.id===link.scope);return {id:row.key,name:row.label,scope:row.id,url:this.baseURL+'/partner-calendars/'+this.store.open(link.key)+'.ics',refreshMinutes:10};})};
  }
  connections(user){return {connections:(user.partnerGrants||[]).filter(grant=>!grant.revokedAt).map(grant=>({id:grant.id,client:{id:'lapsus',name:'Lapsus',origin:ORIGIN},scopes:scopeRows(grant.scopes),createdAt:grant.createdAt,lastUsedAt:grant.lastUsedAt,status:this.active(user,grant)?'active':'invalid'}))};}
  revoke(user,id){const grant=user.partnerGrants?.find(item=>item.id===id&&!item.revokedAt);if(!grant)fail('Cette connexion n’existe plus.',404);grant.revokedAt=this.clock();grant.accessHash=null;grant.links=[];this.store.save();this.audit?.record('partner.revoked',{source:'security',userId:user.id,meta:{mode:'lapsus'}});return {ok:true,...this.connections(user)};}
  feed(req,res){
    if(!TOKEN.test(req.params.token))return res.status(404).end();
    const hash=digest(req.params.token),{user,grant}=this.locate(row=>row.links?.some(link=>link.hash===hash));
    if(!this.active(user,grant))return res.status(404).end();
    if(Object.keys(req.query).length)fail('Ce lien partage uniquement l’agenda autorisé. Ses filtres ne peuvent pas être modifiés.');
    const link=grant.links.find(item=>item.hash===hash),scope=PARTNER_SCOPES.find(item=>item.id===link.scope);
    const content=renderCalendar(combinedEvents(user,{type:scope.type}),{name:scope.label+' · Passerelle',color:scope.type==='exam'?'crimson':'royalblue',reminder:user.reminderMinutes||0});
    req.auditUserId=user.id;this.used(user,grant);
    const etag='"'+digest(content)+'"';res.set({'Content-Type':'text/calendar; charset=utf-8','Content-Disposition':'inline; filename="passerelle-'+scope.key+'.ics"','Cache-Control':'private, max-age=0, must-revalidate','ETag':etag,'X-Robots-Tag':'noindex, nofollow, noarchive'});
    if((req.get('if-none-match')||'').split(',').some(tag=>tag.trim().replace(/^W\//,'')===etag||tag.trim()==='*'))return res.status(304).end();
    res.send(content);
  }
}

export function installPartnerOAuthRoutes(router,{store,auth,admin,rateLimit,baseURL,clock,audit,...options}){
  const service=new PartnerOAuthService(store,{baseURL,clock,audit,...options});
  const origin=new URL(baseURL).origin;
  const cors=(req,res,next)=>{
    const remote=req.get('origin');
    if(remote&&remote!==ORIGIN&&remote!==origin)return res.status(403).json({error:'invalid_request',error_description:'Origine de la requête refusée.'});
    res.vary('Origin');res.set('Cross-Origin-Resource-Policy','cross-origin');
    if(remote){res.set('Access-Control-Allow-Origin',remote);res.set('Access-Control-Expose-Headers','ETag');}
    if(req.method==='OPTIONS'){
      if(!remote||!['GET','POST'].includes(req.get('access-control-request-method')))return res.status(403).end();
      const headers=(req.get('access-control-request-headers')||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);
      if(headers.some(value=>!['authorization','content-type','if-none-match'].includes(value)))return res.status(403).end();
      return res.set({'Access-Control-Allow-Methods':req.path==='/oauth/token'?'POST, OPTIONS':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type, If-None-Match','Access-Control-Max-Age':'600'}).status(204).end();
    }
    next();
  };
  const wrapped=fn=>(req,res,next)=>{try{return fn(req,res);}catch(error){if(error instanceof OAuthError){if(error.status===401)res.set('WWW-Authenticate','Bearer realm="Passerelle", error="invalid_token"');return res.status(error.status).json({error:error.error,error_description:error.message});}next(error);}};
  router.get('/oauth/authorize',(req,res)=>{rateLimit(req,'partner-authorize',30,15*60000);service.authorize(req,res);});
  router.get('/oauth/consent',(_req,res)=>res.type('html').send(fs.readFileSync(fileURLToPath(new URL('../public/partner-connect.html',import.meta.url)),'utf8')));
  router.get('/api/oauth/consent',auth,(req,res)=>res.json(service.consent(req)));
  router.post('/api/oauth/consent',auth,(req,res)=>{rateLimit(req,'partner-consent:'+req.user.id,30,15*60000);res.json(service.approve(req));});
  router.options(['/oauth/token','/api/partner/calendars','/partner-calendars/:token.ics'],cors);
  router.post('/oauth/token',cors,express.urlencoded({extended:false,limit:'8kb',parameterLimit:10}),wrapped((req,res)=>{rateLimit(req,'partner-token',40,15*60000);res.set('Pragma','no-cache').json(service.exchange(req));}));
  router.get('/api/partner/calendars',cors,wrapped((req,res)=>{rateLimit(req,'partner-calendars',120,10*60000);res.json(service.calendars(req));}));
  router.get('/partner-calendars/:token.ics',cors,(req,res)=>{rateLimit(req,'partner-feed',600,10*60000);return service.feed(req,res);});
  router.get('/api/partners',auth,(req,res)=>res.json(service.connections(req.user)));
  router.post('/api/partners/:id/revoke',auth,(req,res)=>{if(!exactKeys(req.body,['accountId'])||req.body.accountId!==req.user.id)fail('Le compte a changé. Rechargez Passerelle.',409);res.json(service.revoke(req.user,req.params.id));});
  router.get('/api/admin/partners/lapsus',auth,admin,(_req,res)=>res.json(service.configuration()));
  router.post('/api/admin/partners/lapsus',auth,admin,(req,res)=>{rateLimit(req,'partner-config',20,3600000);res.json(service.configure(req.body,req.user));});
  router.get('/api/partner/configuration',(_req,res)=>res.json({issuer:baseURL,authorization_endpoint:baseURL+'/oauth/authorize',token_endpoint:baseURL+'/oauth/token',response_types_supported:['code'],grant_types_supported:['authorization_code'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:PARTNER_SCOPES.map(row=>row.id)}));
  return service;
}
