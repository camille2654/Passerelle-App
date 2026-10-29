import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';
import {random,digest,passwordMatches as checkPassword} from './store.js';
import {PublicError} from './sync.js';
import {accountActive} from './operational-state.js';

const TTL=5*60000,COOKIE='passerelle_passkey_challenge',MAX_KEYS=8;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const b64=value=>typeof value==='string'&&value.length>0&&value.length<=3000&&/^[A-Za-z0-9_-]+$/.test(value);
const cleanLabel=value=>String(value||'Ma clé d’accès').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,80)||'Ma clé d’accès';
const invalid=()=>new PublicError('La clé d’accès n’a pas pu être vérifiée. Recommencez ou utilisez votre mot de passe.',401);
const library={generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse};

export class PasskeyService {
  constructor(store,baseURL,{clock=()=>Date.now(),audit=null,login,passwordMatches=checkPassword,webauthn=library}={}) {
    const url=new URL(baseURL);Object.assign(this,{store,clock,audit,login,passwordMatches,webauthn,origin:url.origin,rpID:url.hostname,path:(url.pathname.replace(/\/$/,'')||'')+'/'});
    this.available=!isIP(url.hostname.replace(/^\[|\]$/g,''))&&(url.protocol==='https:'||url.hostname==='localhost'||url.hostname.endsWith('.localhost'));this.secure=url.protocol==='https:';this.pending=new Map();this.closed=false;
  }
  public(user){return {accountId:user.id,available:this.available,items:(user.passkeys||[]).map(({id,label,createdAt,lastUsedAt})=>({id,label,createdAt,lastUsedAt:lastUsedAt||null})),maxKeys:MAX_KEYS};}
  active(req){return accountActive(req.user)&&req.session?.hash&&this.store.state.sessions.some(item=>item.userId===req.user.id&&item.hash===req.session.hash&&item.expires>Date.now());}
  requirePassword(req,password){if(!this.active(req))throw new PublicError('Reconnectez-vous avant de modifier vos clés d’accès.',401);if(typeof password!=='string'||password.length>256||!req.user.password||!this.passwordMatches(password,req.user.password))throw new PublicError('Vérifiez votre mot de passe Passerelle.',401);}
  prune(){for(const [key,value]of this.pending)if(value.expires<=this.clock())this.pending.delete(key);}
  capacity(){if(this.closed||!this.available)throw new PublicError('Les clés d’accès nécessitent une connexion sécurisée et un appareil compatible.',409);this.prune();if(this.pending.size>=1000)throw new PublicError('Plusieurs connexions sont en cours. Réessayez dans un instant.',429);}
  open(row){try{return this.store.open(row.sealed);}catch{throw invalid();}}
  userHandle(user){if(!user.passkeyUserID)this.store.update(user.id,{passkeyUserID:this.store.seal(random())});try{return this.store.open(user.passkeyUserID);}catch{throw new PublicError('Vos clés d’accès ne peuvent pas être ouvertes. Utilisez votre mot de passe et contactez l’assistance.',409);}}
  async registrationOptions(req,input){
    this.capacity();this.requirePassword(req,input.password);if(input.label!==undefined&&(typeof input.label!=='string'||input.label.length>80))throw new PublicError('Choisissez un nom de clé de moins de 80 caractères.');if((req.user.passkeys||[]).length>=MAX_KEYS)throw new PublicError('Huit clés sont déjà enregistrées. Retirez une ancienne clé pour continuer.',409);
    const passwordVersion=digest(req.user.password),handle=this.userHandle(req.user),options=await this.webauthn.generateRegistrationOptions({rpName:'Passerelle',rpID:this.rpID,userName:'Passerelle · '+req.user.name,userDisplayName:'Passerelle · '+req.user.name,userID:Buffer.from(handle,'base64url'),attestationType:'none',authenticatorSelection:{residentKey:'required',userVerification:'required'},excludeCredentials:(req.user.passkeys||[]).map(row=>{const key=this.open(row);return {id:key.id,transports:key.transports};}),timeout:TTL,supportedAlgorithmIDs:[-7,-257]});
    if(!this.active(req)||this.closed||digest(req.user.password)!==passwordVersion)throw invalid();
    const key='register:'+req.user.id+':'+req.session.hash;
    this.pending.set(key,{kind:'register',challenge:options.challenge,userId:req.user.id,session:req.session.hash,password:passwordVersion,handle,label:cleanLabel(input.label),expires:this.clock()+TTL});
    return {options};
  }
  async registrationVerify(req,response){
    const key='register:'+req.user.id+':'+req.session.hash,flow=this.pending.get(key);this.pending.delete(key);
    if(this.closed||!flow||flow.expires<=this.clock()||!this.active(req)||flow.password!==digest(req.user.password))throw invalid();
    let result;try{result=await this.webauthn.verifyRegistrationResponse({response,expectedChallenge:flow.challenge,expectedOrigin:this.origin,expectedRPID:this.rpID,requireUserVerification:true});}catch{throw invalid();}
    if(!result?.verified||!result.registrationInfo?.credential||!this.active(req)||this.closed||flow.password!==digest(req.user.password))throw invalid();
    const info=result.registrationInfo,credential=info.credential;if(!b64(credential.id)||!(credential.publicKey instanceof Uint8Array)||!Number.isSafeInteger(credential.counter)||credential.counter<0)throw invalid();
    if(this.store.state.users.some(user=>(user.passkeys||[]).some(row=>row.credentialHash===digest(credential.id))))throw new PublicError('Cette clé est déjà enregistrée dans Passerelle.',409);
    if((req.user.passkeys||[]).length>=MAX_KEYS)throw new PublicError('Huit clés sont déjà enregistrées.',409);
    const row={id:randomUUID(),credentialHash:digest(credential.id),label:flow.label,createdAt:this.clock(),lastUsedAt:null,sealed:this.store.seal({id:credential.id,publicKey:Buffer.from(credential.publicKey).toString('base64url'),counter:credential.counter,transports:(Array.isArray(credential.transports)?credential.transports:[]).filter(value=>['usb','nfc','ble','internal','hybrid','smart-card'].includes(value)),userHandle:flow.handle,rpID:this.rpID,origin:this.origin,deviceType:info.credentialDeviceType,backedUp:!!info.credentialBackedUp})};
    this.store.update(req.user.id,{passkeys:[...(req.user.passkeys||[]),row]});this.audit?.record('passkey.registered',{source:'security',userId:req.user.id,meta:{count:req.user.passkeys.length}});return this.public(req.user);
  }
  remove(req,id,password){this.requirePassword(req,password);const row=(req.user.passkeys||[]).find(item=>item.id===id);if(!row)throw new PublicError('Cette clé n’est pas associée à votre compte.',404);this.store.update(req.user.id,{passkeys:req.user.passkeys.filter(item=>item.id!==id)});this.audit?.record('passkey.removed',{source:'security',userId:req.user.id,meta:{count:req.user.passkeys.length}});return this.public(req.user);}
  cookie(req){const value=(req.headers.cookie||'').split(';').map(item=>item.trim()).find(item=>item.startsWith(COOKIE+'='));return value?.slice(COOKIE.length+1)||'';}
  clearCookie(res){res.clearCookie(COOKIE,{httpOnly:true,secure:this.secure,sameSite:'lax',path:this.path});}
  async authenticationOptions(req,res){
    this.capacity();if(req.user)throw new PublicError('Déconnectez-vous pour ouvrir un autre compte.',409);
    const previous=this.cookie(req);if(previous)this.pending.delete('authenticate:'+digest(previous));
    const options=await this.webauthn.generateAuthenticationOptions({rpID:this.rpID,userVerification:'required',timeout:TTL});
    if(this.closed)throw invalid();const token=random();this.pending.set('authenticate:'+digest(token),{kind:'authenticate',challenge:options.challenge,expires:this.clock()+TTL});res.cookie(COOKIE,token,{httpOnly:true,secure:this.secure,sameSite:'lax',path:this.path,maxAge:TTL});return {options};
  }
  async authenticationVerify(req,res,response){
    const token=this.cookie(req),key='authenticate:'+digest(token),flow=this.pending.get(key);this.pending.delete(key);this.clearCookie(res);
    if(this.closed||req.user||!token||!flow||flow.expires<=this.clock()||!object(response)||!b64(response.id)||!b64(response.response?.userHandle))throw invalid();
    const owner=this.store.state.users.find(user=>(user.passkeys||[]).some(row=>row.credentialHash===digest(response.id))),row=owner?.passkeys.find(item=>item.credentialHash===digest(response.id));
    if(!accountActive(owner)||!row)throw invalid();const saved=this.open(row);
    if(saved.id!==response.id||saved.rpID!==this.rpID||saved.origin!==this.origin||saved.userHandle!==response.response.userHandle)throw invalid();
    let result;try{result=await this.webauthn.verifyAuthenticationResponse({response,expectedChallenge:flow.challenge,expectedOrigin:this.origin,expectedRPID:this.rpID,requireUserVerification:true,credential:{id:saved.id,publicKey:Uint8Array.from(Buffer.from(saved.publicKey,'base64url')),counter:saved.counter,transports:saved.transports}});}catch{throw invalid();}
    const actual=(owner.passkeys||[]).find(item=>item.id===row.id);if(!result?.verified||this.closed||!accountActive(owner)||!actual)throw invalid();const current=this.open(actual),counter=result.authenticationInfo?.newCounter;
    if(!Number.isSafeInteger(counter)||counter<0||(current.counter>0||counter>0)&&counter<=current.counter||current.publicKey!==saved.publicKey)throw invalid();
    actual.sealed=this.store.seal({...current,counter});actual.lastUsedAt=this.clock();this.store.save();this.login(res,owner);this.audit?.record('passkey.authenticated',{source:'security',userId:owner.id});return {ok:true};
  }
  close(){this.closed=true;this.pending.clear();}
}

export function installPasskeyRoutes(router,{store,auth,rateLimit,baseURL,clock,audit,login,...options}){
  const service=new PasskeyService(store,baseURL,{clock,audit,login,...options});
  const body=(req,allowed)=>{if(!object(req.body)||Object.keys(req.body).some(key=>!allowed.includes(key)))throw new PublicError('La requête de clé d’accès est invalide.');};
  const account=req=>{if(req.body.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);};
  router.get('/api/passkeys',auth,(req,res)=>res.json(service.public(req.user)));
  router.post('/api/passkeys/register/options',auth,async(req,res)=>{rateLimit(req,'passkey-register:'+req.user.id,6,15*60000);body(req,['accountId','password','label']);account(req);res.json(await service.registrationOptions(req,req.body));});
  router.post('/api/passkeys/register/verify',auth,async(req,res)=>{rateLimit(req,'passkey-register-verify:'+req.user.id,12,15*60000);body(req,['accountId','response']);account(req);res.json(await service.registrationVerify(req,req.body.response));});
  router.post('/api/passkeys/:id/remove',auth,(req,res)=>{rateLimit(req,'passkey-remove:'+req.user.id,6,15*60000);body(req,['accountId','password']);account(req);res.json(service.remove(req,req.params.id,req.body.password));});
  router.post('/api/passkeys/authenticate/options',async(req,res)=>{rateLimit(req,'passkey-auth-start',30,5*60000);body(req,[]);res.json(await service.authenticationOptions(req,res));});
  router.post('/api/passkeys/authenticate/verify',async(req,res)=>{rateLimit(req,'passkey-auth-verify',30,5*60000);body(req,['response']);res.json(await service.authenticationVerify(req,res,req.body.response));});
  return service;
}
