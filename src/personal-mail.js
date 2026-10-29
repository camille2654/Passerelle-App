import axios from 'axios';
import {randomUUID} from 'node:crypto';
import {random,digest} from './store.js';
import {PublicError} from './sync.js';
import {plainText} from './work.js';
import {accountActive,automationAllowed} from './operational-state.js';

const PROVIDERS=['gmail','outlook'];
const GMAIL_SCOPE='https://www.googleapis.com/auth/gmail.readonly';
const GRAPH_SCOPE='https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read offline_access';
const allowedHost=new Set(['accounts.google.com','oauth2.googleapis.com','gmail.googleapis.com','login.microsoftonline.com','graph.microsoft.com']);
const email=value=>typeof value==='string'&&value.length<=254&&/^[a-z0-9][a-z0-9._+%-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/i.test(value);
const text=(value,max=30000)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').slice(0,max);
const isObject=value=>value&&typeof value==='object'&&!Array.isArray(value);
const senderAddress=value=>{const input=text(value,500).trim(),address=(input.match(/<([^<>]+)>/)?.[1]||input).trim().toLowerCase();return email(address)?address:null;};
const sourceReference=(provider,connectionId,messageId)=>JSON.stringify({provider,connectionId,messageId});
const publicFailure=()=>new PublicError('La connexion à cette messagerie n’a pas abouti. Réessayez ou reconnectez la boîte.',502);
const fingerprint=config=>config?digest(JSON.stringify([config.clientId,config.clientSecret])):null;
const tokenString=value=>typeof value==='string'&&value.length>0&&value.length<=20000&&!/[\r\n\u0000]/.test(value);
const messageId=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!/[\u0000-\u001f]/.test(value);
const dateISO=value=>Number.isFinite(Date.parse(value))?new Date(value).toISOString():null;

async function defaultRequest({url,method='GET',headers={},body}) {
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||!allowedHost.has(parsed.hostname)||parsed.username||parsed.password||parsed.port)throw publicFailure();
  const response=await axios.request({url,method,headers,data:body,maxRedirects:0,timeout:20000,maxContentLength:512*1024,maxBodyLength:64*1024,responseType:'json'});
  return response.data;
}

function mimeBody(payload) {
  const plain=[],html=[];let seen=0;
  const visit=(part,depth)=>{
    if(!part||depth>8||++seen>32||part.filename)return;
    if(typeof part.body?.data==='string'&&part.body.data.length<=90000){
      const bytes=Buffer.from(part.body.data,'base64url');
      let body;try{const header=(part.headers||[]).find(value=>String(value.name).toLowerCase()==='content-type')?.value||'';const charset=header.match(/charset\s*=\s*["']?([a-z0-9_-]+)/i)?.[1]||'utf-8';body=new TextDecoder(charset).decode(bytes);}catch{body=bytes.toString('utf8');}
      if(String(part.mimeType).toLowerCase()==='text/plain')plain.push(body);
      else if(String(part.mimeType).toLowerCase()==='text/html')html.push(plainText(body));
    }
    for(const child of (Array.isArray(part.parts)?part.parts:[]).slice(0,32))visit(child,depth+1);
  };
  visit(payload,0);return text((plain.length?plain:html).join('\n'),30000);
}
function gmailMessage(value) {
  if(!isObject(value)||!messageId(value.id))throw publicFailure();
  const headers=Array.isArray(value.payload?.headers)?value.payload.headers:[],header=name=>headers.find(item=>String(item.name).toLowerCase()===name)?.value||'';
  const milliseconds=Number(value.internalDate),date=Number.isFinite(milliseconds)&&milliseconds>946684800000?new Date(milliseconds).toISOString():dateISO(header('date'));
  return {id:value.id,title:text(header('subject')||'Message personnel',200),text:mimeBody(value.payload),date,sender:senderAddress(header('from'))};
}
function graphMessage(value) {
  if(!isObject(value)||!messageId(value.id))throw publicFailure();
  const body=value.body?.content??value.bodyPreview??'';
  return {id:value.id,title:text(value.subject||'Message personnel',200),text:String(value.body?.contentType).toLowerCase()==='html'?plainText(text(body)):text(body),date:dateISO(value.receivedDateTime),sender:senderAddress(value.from?.emailAddress?.address)};
}

export class PersonalMailService {
  constructor(store,baseURL,{clock=()=>Date.now(),audit=null,onDisconnect=()=>{},request=defaultRequest}={}) {
    Object.assign(this,{store,baseURL:baseURL.replace(/\/$/,''),clock,audit,onDisconnect,request});
    this.pending=new Map();this.locks=new Map();this.closed=false;
  }
  provider(value){if(!PROVIDERS.includes(value))throw new PublicError('Cette messagerie n’est pas proposée.',404);return value;}
  configs(){try{return this.store.state.settings.personalMailOAuth?this.store.open(this.store.state.settings.personalMailOAuth):{};}catch{return {};}}
  config(provider){return this.configs()[this.provider(provider)]||null;}
  redirectURI(provider){return this.baseURL+'/api/personal-mail/oauth/'+this.provider(provider)+'/callback';}
  ready(provider){const config=this.config(provider),url=new URL(this.baseURL);return !!(config?.enabled&&config.clientId&&config.clientSecret&&(url.protocol==='https:'||['127.0.0.1','localhost'].includes(url.hostname)));}
  connection(user,provider){return (user.personalMailConnections||[]).find(value=>value.provider===provider)||null;}
  open(connection){try{return connection?this.store.open(connection.sealed):null;}catch{return null;}}
  publicSettings(user) {
    const providers=PROVIDERS.map(provider=>{
      const connection=this.connection(user,provider),value=this.open(connection),config=this.config(provider),matches=value&&value.configFingerprint===fingerprint(config),connected=!!(matches&&!value.needsReconnect);
      return {provider,ready:this.ready(provider),connected,connectionId:connection?.id||null,address:value?.address||'',enabled:!!value?.enabled,senders:value?.senders||[],lastScan:value?.lastScan||null,warning:value&&!matches?'Cette connexion doit être renouvelée après la modification des réglages.':value?.warning||null};
    });
    return {accountId:user.id,version:user.personalMailVersion||0,providers,setupRequired:providers.every(value=>!value.ready)};
  }
  adminSettings(){return {providers:PROVIDERS.map(provider=>{const config=this.config(provider);return {provider,clientId:config?.clientId||'',hasSecret:!!config?.clientSecret,enabled:!!config?.enabled,ready:this.ready(provider),redirectURI:this.redirectURI(provider)};})};}
  configure(provider,input) {
    this.provider(provider);
    if(!isObject(input)||Object.keys(input).some(key=>!['clientId','clientSecret','enabled'].includes(key))||typeof input.clientId!=='string'||typeof input.clientSecret!=='string'||typeof input.enabled!=='boolean')throw new PublicError('Vérifiez les paramètres de l’application.');
    const clientId=input.clientId.trim(),secret=input.clientSecret;
    if(!/^[A-Za-z0-9._-]{3,300}$/.test(clientId)||secret.length>4096||/[\r\n\u0000]/.test(secret))throw new PublicError('Identifiant ou secret d’application invalide.');
    if(provider==='outlook'&&!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(clientId))throw new PublicError('L’identifiant Microsoft doit être celui de l’application inscrite.');
    const configs=this.configs(),previous=configs[provider],clientSecret=secret||((previous?.clientId===clientId)?previous.clientSecret:'');
    if(input.enabled&&!clientSecret)throw new PublicError('Renseignez le secret de l’application avant d’activer la connexion.');
    configs[provider]={clientId,clientSecret,enabled:input.enabled,updatedAt:this.clock()};
    this.store.state.settings.personalMailOAuth=this.store.seal(configs);this.store.state.settings.personalMailOAuthVersion=(this.store.state.settings.personalMailOAuthVersion||0)+1;this.store.save();
    return this.adminSettings();
  }
  activeSession(req) {return !!(req.user&&accountActive(req.user)&&req.session?.hash&&this.store.state.sessions.some(value=>value.hash===req.session.hash&&value.userId===req.user.id&&value.expires>Date.now()));}
  prune(){for(const [key,value]of this.pending)if(value.expiresAt<=this.clock())this.pending.delete(key);}
  start(req,provider) {
    this.provider(provider);if(this.closed||!this.activeSession(req))throw new PublicError('Reconnectez-vous à Passerelle avant de relier une boîte.',401);
    if(!this.ready(provider))throw new PublicError('La connexion à cette messagerie doit d’abord être configurée par l’administrateur.',409);
    this.prune();if(this.pending.size>=500)throw new PublicError('Plusieurs connexions sont en cours. Réessayez plus tard.',429);
    const state=random(),verifier=random(),config=this.config(provider),user=req.user;
    for(const [key,flow]of this.pending)if(flow.userId===user.id&&flow.provider===provider)this.pending.delete(key);
    const generation=(user.personalMailOAuthGeneration?.[provider]||0)+1;
    this.store.update(user.id,{personalMailOAuthGeneration:{...user.personalMailOAuthGeneration,[provider]:generation}});
    this.pending.set(digest(state),{userId:user.id,provider,sessionHash:req.session.hash,expiresAt:this.clock()+10*60000,sealed:this.store.seal({verifier,configFingerprint:fingerprint(config),generation})});
    const url=new URL(provider==='gmail'?'https://accounts.google.com/o/oauth2/v2/auth':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    const query={client_id:config.clientId,redirect_uri:this.redirectURI(provider),response_type:'code',scope:provider==='gmail'?GMAIL_SCOPE:GRAPH_SCOPE,state,code_challenge:digestChallenge(verifier),code_challenge_method:'S256',...(provider==='gmail'?{access_type:'offline',prompt:'consent select_account'}:{response_mode:'query',prompt:'select_account'})};
    for(const [key,value]of Object.entries(query))url.searchParams.set(key,value);
    return {authorizationURL:url.href};
  }
  validateScopes(provider,response) {
    if(response.scope===undefined)return;
    if(typeof response.scope!=='string'||response.scope.length>4000)throw publicFailure();
    const scopes=response.scope.split(/\s+/).filter(Boolean).map(value=>provider==='outlook'?value.replace(/^https:\/\/graph\.microsoft\.com\//,''):value);
    const allowed=provider==='gmail'?[GMAIL_SCOPE]:['Mail.Read','User.Read','offline_access'];
    if(!scopes.includes(provider==='gmail'?GMAIL_SCOPE:'Mail.Read')||scopes.some(scope=>!allowed.includes(scope)))throw new PublicError('Les autorisations reçues ne correspondent pas à la lecture seule demandée.',409);
  }
  token(provider,response,old=null) {
    if(!isObject(response)||!tokenString(response.access_token))throw publicFailure();this.validateScopes(provider,response);
    const expires=Number(response.expires_in);
    if(!Number.isFinite(expires)||expires<10||expires>86400)throw publicFailure();
    const refresh=response.refresh_token??old?.refreshToken;
    if(!tokenString(refresh))throw new PublicError('L’autorisation de lecture doit être renouvelée pour permettre les prochaines vérifications.',409);
    return {accessToken:response.access_token,refreshToken:refresh,expiresAt:this.clock()+expires*1000};
  }
  async callback(req,provider,query) {
    this.provider(provider);this.prune();
    if(!isObject(query)||typeof query.state!=='string'||query.state.length>200)throw new PublicError('Cette connexion a expiré. Recommencez depuis Passerelle.',409);
    const key=digest(query.state),flow=this.pending.get(key);this.pending.delete(key);
    if(!flow||flow.provider!==provider||!this.activeSession(req)||flow.userId!==req.user.id||flow.sessionHash!==req.session.hash||flow.expiresAt<=this.clock())throw new PublicError('Cette connexion a expiré. Recommencez depuis Passerelle.',409);
    const proof=this.store.open(flow.sealed),config=this.config(provider);
    const valid=()=>!this.closed&&this.activeSession(req)&&this.ready(provider)&&fingerprint(this.config(provider))===proof.configFingerprint&&(req.user.personalMailOAuthGeneration?.[provider]||0)===proof.generation;
    if(!valid()||query.error||typeof query.code!=='string'||!query.code||query.code.length>10000)throw new PublicError('La connexion à la messagerie n’a pas été autorisée.',409);
    try {
      const response=await this.request({url:tokenURL(provider),method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'authorization_code',code:query.code,redirect_uri:this.redirectURI(provider),code_verifier:proof.verifier}).toString()});
      if(!valid()||!tokenString(response?.access_token))throw publicFailure();this.validateScopes(provider,response);
      const identity=await this.request({url:provider==='gmail'?'https://gmail.googleapis.com/gmail/v1/users/me/profile':'https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName',headers:{Authorization:'Bearer '+response.access_token}});
      if(!valid())throw new PublicError('Le compte ou la session a changé. Recommencez la connexion.',409);
      const address=String(provider==='gmail'?identity?.emailAddress:identity?.mail||identity?.userPrincipalName||'').toLowerCase();
      if(!email(address))throw publicFailure();
      const previous=this.connection(req.user,provider),old=this.open(previous),subject=text(identity.id||address,300),sameIdentity=old?.address===address&&old.subject===subject,sameConfig=sameIdentity&&old.configFingerprint===proof.configFingerprint;
      const tokens=this.token(provider,response,sameConfig?old:null),connection={id:sameIdentity?previous.id:randomUUID(),provider,sealed:this.store.seal({...tokens,address,subject,authEpoch:random(),configFingerprint:proof.configFingerprint,enabled:sameIdentity?!!old.enabled:false,senders:sameIdentity?old.senders||[]:[],lastScan:sameIdentity?old.lastScan:null,scanCursor:sameIdentity?old.scanCursor||0:0,warning:null,needsReconnect:false})};
      this.store.update(req.user.id,{personalMailConnections:[...(req.user.personalMailConnections||[]).filter(value=>value.provider!==provider),connection],personalMailVersion:(req.user.personalMailVersion||0)+1});
      if(previous&&!sameIdentity)await this.onDisconnect(req.user,{provider,connectionId:previous.id});
      this.audit?.record('personal.mail.connected',{source:'personal',userId:req.user.id,meta:{mode:provider}});
      return this.publicSettings(req.user);
    }catch(error){if(error instanceof PublicError)throw error;throw publicFailure();}
  }
  preferences(user,provider,input) {
    this.provider(provider);
    if(!isObject(input)||typeof input.enabled!=='boolean'||!Array.isArray(input.senders)||input.senders.length>10||input.senders.some(value=>typeof value!=='string'||!email(value.trim())))throw new PublicError('Choisissez au maximum dix adresses d’expédition valides.');
    const connection=this.connection(user,provider),value=this.open(connection);
    if(!connection||!value)throw new PublicError('Reliez cette boîte avant de choisir les messages à analyser.',409);
    const senders=[...new Set(input.senders.map(value=>value.trim().toLowerCase()))];
    if(input.enabled&&!senders.length)throw new PublicError('Choisissez au moins un expéditeur avant de lancer l’analyse.');
    if(input.enabled&&(!this.ready(provider)||value.configFingerprint!==fingerprint(this.config(provider))||value.needsReconnect))throw new PublicError('Renouvelez cette connexion avant de lancer l’analyse.',409);
    connection.sealed=this.store.seal({...value,enabled:input.enabled,senders});this.store.update(user.id,{personalMailVersion:(user.personalMailVersion||0)+1});return this.publicSettings(user);
  }
  async disconnect(user,provider) {
    this.provider(provider);const previous=this.connection(user,provider);
    this.store.update(user.id,{personalMailConnections:(user.personalMailConnections||[]).filter(value=>value.provider!==provider),personalMailVersion:(user.personalMailVersion||0)+1,personalMailOAuthGeneration:{...user.personalMailOAuthGeneration,[provider]:(user.personalMailOAuthGeneration?.[provider]||0)+1}});
    for(const [key,flow]of this.pending)if(flow.userId===user.id&&flow.provider===provider)this.pending.delete(key);
    if(previous)await this.onDisconnect(user,{provider,connectionId:previous.id});
    this.audit?.record('personal.mail.disconnected',{source:'personal',userId:user.id,meta:{mode:provider}});return this.publicSettings(user);
  }
  current(user,connection,{requireEnabled=false}={}) {
    const actual=this.connection(user,connection.provider),value=this.open(actual);
    if(this.closed||!accountActive(user)||!actual||actual.id!==connection.id||!value||!this.ready(connection.provider)||value.configFingerprint!==fingerprint(this.config(connection.provider))||value.needsReconnect||requireEnabled&&(!value.enabled||!value.senders.length))throw new PublicError('La connexion ou les choix de lecture ont changé. Actualisez les réglages.',409);
    return {connection:actual,value};
  }
  async locked(user,connection,operation) {
    const key=user.id+':'+connection.id,previous=this.locks.get(key)||Promise.resolve();let release;const waiting=new Promise(resolve=>{release=resolve;});this.locks.set(key,waiting);
    try{await previous;return await operation();}finally{release();if(this.locks.get(key)===waiting)this.locks.delete(key);}
  }
  async access(user,connection,{requireEnabled=false}={}) {
    let {value}=this.current(user,connection,{requireEnabled});
    if(value.expiresAt>this.clock()+60000)return value.accessToken;
    const config=this.config(connection.provider);
    try{
      const response=await this.request({url:tokenURL(connection.provider),method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'refresh_token',refresh_token:value.refreshToken,...(connection.provider==='outlook'?{scope:GRAPH_SCOPE}:{})}).toString()});
      const latest=this.current(user,connection,{requireEnabled});
      if(latest.value.authEpoch!==value.authEpoch)return latest.value.accessToken;
      const tokens=this.token(connection.provider,response,latest.value);
      latest.connection.sealed=this.store.seal({...latest.value,...tokens,warning:null});this.store.save();return tokens.accessToken;
    }catch(error){
      const latest=this.connection(user,connection.provider),current=latest?.id===connection.id?this.open(latest):null;
      if(current){const expired=Number(error.response?.status)===401||error.response?.data?.error==='invalid_grant';latest.sealed=this.store.seal({...current,warning:'La messagerie ne répond pas. Reconnectez-la si le problème persiste.',...(expired?{needsReconnect:true}:{})});this.store.save();}
      throw error instanceof PublicError?error:publicFailure();
    }
  }
  async read(user,connection,id,{requireEnabled=false}={}) {
    if(!messageId(id))throw new PublicError('Ce message n’est pas disponible.',404);
    const token=await this.access(user,connection,{requireEnabled}),provider=connection.provider;
    const url=provider==='gmail'?'https://gmail.googleapis.com/gmail/v1/users/me/messages/'+encodeURIComponent(id)+'?format=full':'https://graph.microsoft.com/v1.0/me/messages/'+encodeURIComponent(id)+'?$select=id,subject,from,receivedDateTime,body,bodyPreview';
    let response;try{response=await this.request({url,headers:{Authorization:'Bearer '+token,...(provider==='outlook'?{Prefer:'outlook.body-content-type="text", IdType="ImmutableId"'}:{})}});}catch(error){if(Number(error.response?.status)===401){const latest=this.connection(user,provider),value=latest?.id===connection.id?this.open(latest):null;if(value){latest.sealed=this.store.seal({...value,needsReconnect:true,warning:'L’autorisation de cette boîte a expiré. Reconnectez-la pour reprendre les lectures.'});this.store.save();}throw new PublicError('Reconnectez cette boîte pour reprendre les lectures.',409);}throw error;}
    this.current(user,connection,{requireEnabled});return provider==='gmail'?gmailMessage(response):graphMessage(response);
  }
  async collect(user) {
    if(this.closed||!accountActive(user))return {incoming:[],warning:null,sources:{personal:{state:'unknown'}}};
    if(!automationAllowed(this.store.state.settings,'mail',this.clock()))return {incoming:[],warning:'La vérification automatique des mails personnels est momentanément en pause.',sources:{personal:{state:'paused'}}};
    const version=user.personalMailVersion||0,incoming=[],deadline=performance.now()+20000;let warning=null,checked=0;
    for(const provider of PROVIDERS){
      const connection=this.connection(user,provider),value=this.open(connection);
      if(!connection||!value?.enabled||!value.senders?.length||!this.ready(provider)||value.configFingerprint!==fingerprint(this.config(provider))||value.needsReconnect)continue;
      if(performance.now()>deadline)break;
      try{await this.locked(user,connection,async()=>{
        const current=this.current(user,connection,{requireEnabled:true}),token=await this.access(user,connection,{requireEnabled:true});
        if((user.personalMailVersion||0)!==version)return;
        const since=new Date(this.clock()-30*86400000).toISOString();let url;
        if(provider==='gmail'){
          const query=new URLSearchParams({maxResults:'20',labelIds:'INBOX',q:'newer_than:30d {'+current.value.senders.map(value=>'from:'+value).join(' ')+'}'});url='https://gmail.googleapis.com/gmail/v1/users/me/messages?'+query;
        }else{
          const filter="receivedDateTime ge "+since+" and ("+current.value.senders.map(value=>"from/emailAddress/address eq '"+value.replaceAll("'","''")+"'").join(' or ')+")";
          url='https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?'+new URLSearchParams({'$top':'20','$orderby':'receivedDateTime desc','$select':'id,subject,from,receivedDateTime,bodyPreview','$filter':filter});
        }
        const rows=await this.request({url,headers:{Authorization:'Bearer '+token,...(provider==='outlook'?{Prefer:'IdType="ImmutableId"'}:{})}});
        this.current(user,connection,{requireEnabled:true});if((user.personalMailVersion||0)!==version)return;
        const list=provider==='gmail'?rows?.messages||[]:rows?.value;
        if(!Array.isArray(list))throw publicFailure();const ids=[...new Set(list.slice(0,20).map(item=>item?.id).filter(messageId))];
        const cursor=ids.length?(current.value.scanCursor||0)%ids.length:0,ordered=[...ids.slice(cursor),...ids.slice(0,cursor)].slice(0,10);
        for(const id of ordered){
          if(performance.now()>deadline||(user.personalMailVersion||0)!==version)break;
          const message=await this.read(user,connection,id,{requireEnabled:true}),latest=this.current(user,connection,{requireEnabled:true});
          if(!message.date||!message.sender||!latest.value.senders.includes(message.sender)||Date.parse(message.date)<this.clock()-30*86400000||Date.parse(message.date)>this.clock()+86400000)continue;
          incoming.push({kind:'personal-mail',raw:sourceReference(provider,connection.id,id),title:message.title,text:message.text,date:message.date,full:true,provider});
        }
        const latest=this.current(user,connection,{requireEnabled:true});
        latest.connection.sealed=this.store.seal({...latest.value,lastScan:this.clock(),scanCursor:ids.length?(cursor+ordered.length)%ids.length:0,warning:null});this.store.save();checked++;
      });}catch{warning='Certains messages personnels n’ont pas pu être vérifiés. Les dernières propositions sont conservées.';}
    }
    return {incoming:!this.closed&&(user.personalMailVersion||0)===version?incoming:[],warning,sources:{personal:{state:warning?'error':checked?'available':'unknown'}}};
  }
  async source(user,raw) {
    let reference;try{reference=typeof raw==='string'&&raw.length<2000?JSON.parse(raw):null;}catch{}
    if(!isObject(reference)||!PROVIDERS.includes(reference.provider)||typeof reference.connectionId!=='string'||!messageId(reference.messageId))throw new PublicError('Ce message n’est plus disponible.',410);
    const connection=this.connection(user,reference.provider);
    if(!connection||connection.id!==reference.connectionId)throw new PublicError('Cette boîte a été déconnectée. Le message n’est plus accessible ici.',410);
    try{return await this.locked(user,connection,async()=>{const message=await this.read(user,connection,reference.messageId);return {kind:'message',title:message.title,items:[{author:message.sender||'Expéditeur',date:message.date||'',text:message.text,files:[]}],fetchedAt:this.clock()};});}
    catch(error){if(error instanceof PublicError)throw error;throw publicFailure();}
  }
  close(){this.closed=true;this.pending.clear();}
}

const tokenURL=provider=>provider==='gmail'?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token';
// SHA-256 hash encoded in base64url, not its hexadecimal representation.
const digestChallenge=verifier=>Buffer.from(digest(verifier),'hex').toString('base64url');

export function installPersonalMailRoutes(router,{store,auth,admin,rateLimit,baseURL,clock=()=>Date.now(),audit,...options}) {
  const service=new PersonalMailService(store,baseURL,{clock,audit,...options});
  const validate=(req,allowed=[])=>{if(req.body?.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);if(!isObject(req.body)||Object.keys(req.body).some(key=>!['accountId',...allowed].includes(key)))throw new PublicError('La requête contient des champs invalides.');};
  router.get('/api/personal-mail',auth,(req,res)=>{rateLimit(req,'personal-mail-read:'+req.user.id,90,15*60000);res.json(service.publicSettings(req.user));});
  router.get('/api/admin/personal-mail',auth,admin,(req,res)=>res.json(service.adminSettings()));
  router.post('/api/admin/personal-mail/:provider',auth,admin,(req,res)=>{rateLimit(req,'personal-mail-setup:'+req.user.id,12,3600000);const result=service.configure(req.params.provider,req.body);audit?.record('personal.mail.configured',{source:'admin',actorId:req.user.id,meta:{mode:req.params.provider}});res.json(result);});
  router.post('/api/personal-mail/:provider/connect',auth,(req,res)=>{rateLimit(req,'personal-mail-connect:'+req.user.id,12,15*60000);validate(req);res.json(service.start(req,req.params.provider));});
  router.get('/api/personal-mail/oauth/:provider/callback',async(req,res)=>{
    res.set('Referrer-Policy','no-referrer');
    try{rateLimit(req,'personal-mail-callback',60,15*60000);await service.callback(req,req.params.provider,req.query);res.redirect(303,service.baseURL+'/#personal-mail=connected');}
    catch{audit?.record('personal.mail.failed',{source:'security',userId:req.user?.id,meta:{errorCode:'PERSONAL_MAIL_AUTH_FAILED'}});res.redirect(303,service.baseURL+'/#personal-mail=error');}
  });
  router.post('/api/personal-mail/:provider/preferences',auth,(req,res)=>{rateLimit(req,'personal-mail-preferences:'+req.user.id,30,15*60000);validate(req,['enabled','senders']);res.json(service.preferences(req.user,req.params.provider,req.body));});
  router.post('/api/personal-mail/:provider/disconnect',auth,async(req,res)=>{rateLimit(req,'personal-mail-disconnect:'+req.user.id,20,15*60000);validate(req);res.json(await service.disconnect(req.user,req.params.provider));});
  return service;
}
