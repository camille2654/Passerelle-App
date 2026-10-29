import {randomUUID} from 'node:crypto';
import axios from 'axios';
import {digest,random} from './store.js';
import {userWork} from './work.js';
import {PublicError} from './sync.js';
import {accountActive} from './operational-state.js';

const clean=(value,max=200)=>String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const allowedURL=value=>{
  try{const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.port||url.href.length>4000)return null;
    const h=url.hostname.toLowerCase();if(!['drive.google.com','docs.google.com','onedrive.live.com','1drv.ms'].includes(h)&&!h.endsWith('.sharepoint.com'))return null;
    return url.href;
  }catch{return null;}
};
const providerURL=url=>new URL(url).hostname.endsWith('google.com')?'Google Drive':'OneDrive';
const sessionActive=(store,req)=>accountActive(req.user)&&store.state.sessions.some(s=>s.userId===req.user.id&&s.hash===req.session?.hash&&s.expires>Date.now());
const configHash=value=>value?digest(JSON.stringify([value.clientId,value.clientSecret,value.enabled])):null;
const validMessageId=value=>typeof value==='string'&&value.length>0&&value.length<=1000&&!/[\u0000-\u001f\u007f]/.test(value);
const validToken=value=>typeof value==='string'&&value.length>0&&value.length<=20000&&!/[\u0000-\u0020\u007f]/.test(value);
async function remote({url,method='GET',headers={},body}){
  const value=new URL(url);if(value.protocol!=='https:'||!['www.googleapis.com','oauth2.googleapis.com','graph.microsoft.com','login.microsoftonline.com'].includes(value.hostname)||value.username||value.password||value.port)throw new PublicError('Ce service de documents n’est pas accessible.',502);
  return (await axios.request({url,method,headers,data:body,timeout:15000,maxRedirects:0,maxContentLength:512*1024,maxBodyLength:64000,responseType:'json'})).data;
}

export class WorkResources {
  constructor(store,favorites,{clock=()=>Date.now(),audit=null}={}){Object.assign(this,{store,favorites,clock,audit});}
  scope(user){return this.favorites.scope(user);}
  rows(user){try{const value=user.workResourcesData&&this.store.open(user.workResourcesData);if(value?.scope!==this.scope(user)||!Array.isArray(value.items))return [];const ids=new Set(userWork(user).map(item=>item.id));return value.items.map(row=>row.workId!==null&&!ids.has(row.workId)?{...row,workId:null}:row);}catch{return [];}}
  publicRow(user,row){return {id:row.id,workId:row.workId,title:row.title,kind:row.kind,provider:row.provider,createdAt:row.createdAt,available:row.kind!=='favorite'||(user.favoriteDocuments||[]).some(file=>file.id===row.favoriteId&&file.scope===this.scope(user))};}
  list(user){return {accountId:user.id,items:this.rows(user).map(row=>this.publicRow(user,row)),maxItems:300};}
  forWork(user,id){return this.rows(user).filter(row=>row.workId===id).map(row=>this.publicRow(user,row));}
  assertWork(user,id){if(id!==null&&!userWork(user).some(work=>work.id===id))throw new PublicError('Ce devoir n’appartient pas à votre profil.',404);}
  add(user,{workId=null,title,url,favoriteId}){
    if(workId!==null&&(!validMessageId(workId))||title!=null&&typeof title!=='string'||url!=null&&typeof url!=='string'||favoriteId!=null&&typeof favoriteId!=='string'||!!url===!!favoriteId)throw new PublicError('Choisissez un document ou un lien valide.');
    this.assertWork(user,workId);if(!accountActive(user))throw new PublicError('Ce compte n’est pas actif.',401);
    const items=this.rows(user);if(items.length>=300||items.filter(row=>row.workId===workId).length>= (workId?10:100))throw new PublicError('Retirez un ancien document avant d’en ajouter un autre.',409);
    let row;
    if(favoriteId){const favorite=this.favorites.find(user,favoriteId);row={kind:'favorite',favoriteId:favorite.id,title:clean(title)||this.favorites.metadata(favorite).name,provider:'Copie privée'};}
    else{const href=allowedURL(url);if(!href)throw new PublicError('Collez un lien HTTPS Google Drive, Google Docs, OneDrive ou SharePoint valide.');row={kind:'link',url:href,title:clean(title)||'Document '+providerURL(href),provider:providerURL(href)};}
    const duplicate=items.find(item=>item.workId===workId&&item.kind===row.kind&&(row.kind==='link'?item.url===row.url:item.favoriteId===row.favoriteId));if(duplicate)return {item:this.publicRow(user,duplicate),alreadySaved:true,...this.list(user)};
    row={id:randomUUID(),workId,createdAt:this.clock(),...row};this.store.update(user.id,{workResourcesData:this.store.seal({scope:this.scope(user),items:[...items,row]}),personalVersion:this.clock()});
    this.audit?.record('resource.added',{source:'personal',userId:user.id,meta:{mode:row.kind,count:1}});return {item:this.publicRow(user,row),...this.list(user)};
  }
  find(user,id){const row=this.rows(user).find(value=>value.id===id);if(!row)throw new PublicError('Ce document n’est pas disponible dans votre profil.',404);this.assertWork(user,row.workId);return row;}
  remove(user,id){this.find(user,id);this.store.update(user.id,{workResourcesData:this.store.seal({scope:this.scope(user),items:this.rows(user).filter(row=>row.id!==id)}),personalVersion:this.clock()});return this.list(user);}
}

export class CloudDocumentPicker {
  constructor(store,resources,personalMail,{baseURL,clock=()=>Date.now(),request=remote,incoming=()=>null}={}){Object.assign(this,{store,resources,personalMail,baseURL,clock,request,incoming});this.pending=new Map();this.selections=new Map();this.closed=false;}
  providers(user){return {accountId:user.id,providers:['gmail','outlook'].map(provider=>({provider,name:provider==='gmail'?'Google Drive':'OneDrive',ready:this.personalMail.ready(provider),...(user.admin?{redirectURI:this.baseURL+'/api/cloud-documents/oauth/'+provider+'/callback'}:{})}))};}
  prune(){for(const map of [this.pending,this.selections])for(const [key,value]of map)if(value.expiresAt<=this.clock())map.delete(key);}
  start(req,provider,workId){
    if(this.closed||!['gmail','outlook'].includes(provider)||!sessionActive(this.store,req))throw new PublicError('Reconnectez-vous pour choisir un document.',401);
    if(workId!==null&&!validMessageId(workId))throw new PublicError('Devoir invalide.');this.resources.assertWork(req.user,workId);if(!this.personalMail.ready(provider))throw new PublicError('Les identifiants d’application doivent être configurés par l’administrateur.',409);
    this.prune();if(this.pending.size>=200)throw new PublicError('Plusieurs sélections sont en cours. Réessayez.',429);
    const state=random(),verifier=random(),config=this.personalMail.config(provider),scope=this.resources.scope(req.user),challenge=Buffer.from(digest(verifier),'hex').toString('base64url');
    this.pending.set(digest(state),{userId:req.user.id,session:req.session.hash,scope,workId,provider,expiresAt:this.clock()+600000,sealed:this.store.seal({verifier,configHash:configHash(config)})});
    const url=new URL(provider==='gmail'?'https://accounts.google.com/o/oauth2/v2/auth':'https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    const params={client_id:config.clientId,redirect_uri:this.baseURL+'/api/cloud-documents/oauth/'+provider+'/callback',response_type:'code',scope:provider==='gmail'?'https://www.googleapis.com/auth/drive.file':'https://graph.microsoft.com/Files.Read',state,code_challenge:challenge,code_challenge_method:'S256',prompt:provider==='gmail'?'consent':'select_account',...(provider==='gmail'?{trigger_onepick:'true',allow_multiple:'true',include_granted_scopes:'false'}:{response_mode:'query'})};
    for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);return {authorizationURL:url.href};
  }
  async callback(req,provider,query){
    this.prune();const flow=typeof query.state==='string'&&this.pending.get(digest(query.state));if(typeof query.state==='string')this.pending.delete(digest(query.state));
    if(!flow||flow.provider!==provider||!sessionActive(this.store,req)||flow.userId!==req.user.id||flow.session!==req.session.hash||flow.scope!==this.resources.scope(req.user)||query.error||!validMessageId(query.code))throw new PublicError('Cette sélection a expiré. Recommencez.',409);
    const proof=this.store.open(flow.sealed),config=this.personalMail.config(provider),valid=()=>!this.closed&&sessionActive(this.store,req)&&this.personalMail.ready(provider)&&configHash(this.personalMail.config(provider))===proof.configHash&&this.resources.scope(req.user)===flow.scope;
    if(!valid())throw new PublicError('Les réglages de connexion ont changé.',409);
    const tokens=await this.request({url:provider==='gmail'?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token',method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.clientSecret,grant_type:'authorization_code',code:query.code,code_verifier:proof.verifier,redirect_uri:this.baseURL+'/api/cloud-documents/oauth/'+provider+'/callback'}).toString()});
    if(!valid()||!validToken(tokens?.access_token)||tokens.token_type&&String(tokens.token_type).toLowerCase()!=='bearer')throw new PublicError('La sélection de documents a échoué.',502);
    const scopes=typeof tokens.scope==='string'?tokens.scope.trim().split(/\s+/):[];const allowed=provider==='gmail'?['https://www.googleapis.com/auth/drive.file']:['https://graph.microsoft.com/Files.Read','Files.Read'];if(typeof tokens.scope==='string'&&(!scopes.length||scopes.some(scope=>!allowed.includes(scope))))throw new PublicError('Les permissions de fichiers ne correspondent pas à la demande.',409);
    if(provider==='gmail'){
      const ids=typeof query.picked_file_ids==='string'?query.picked_file_ids.split(','):[];if(!ids.length||ids.length>5||ids.some(id=>! /^[a-zA-Z0-9_-]{5,250}$/.test(id)))throw new PublicError('Aucun fichier valide n’a été choisi.');
      const links=[];for(const id of [...new Set(ids)]){const file=await this.request({url:'https://www.googleapis.com/drive/v3/files/'+encodeURIComponent(id)+'?fields=id,name,webViewLink,mimeType',headers:{Authorization:'Bearer '+tokens.access_token}});if(!valid())throw new PublicError('La session a changé.',409);const url=allowedURL(file.webViewLink||'https://drive.google.com/file/d/'+id+'/view');if(!url)throw new PublicError('Le document choisi n’est pas accessible.');links.push({title:clean(file.name)||'Document Google Drive',url});}
      return {kind:'incoming',...this.incoming().fromCloud(req,links,flow.workId)};
    }
    if(this.selections.size>=100)throw new PublicError('Plusieurs sélections sont en cours.',429);
    const token=random();this.selections.set(digest(token),{...flow,expiresAt:this.clock()+600000,sealed:this.store.seal({accessToken:tokens.access_token,configHash:proof.configHash})});return {kind:'picker',token};
  }
  selection(req,token){this.prune();const value=typeof token==='string'&&this.selections.get(digest(token));if(this.closed||!value||value.provider!=='outlook'||!sessionActive(this.store,req)||value.userId!==req.user.id||value.session!==req.session.hash||value.scope!==this.resources.scope(req.user))throw new PublicError('Cette sélection a expiré. Recommencez.',410);const secret=this.store.open(value.sealed);if(!this.personalMail.ready('outlook')||secret.configHash!==configHash(this.personalMail.config('outlook')))throw new PublicError('Cette connexion doit être relancée.',409);return {value,secret};}
  async files(req,token,folderId){const {secret}=this.selection(req,token);if(folderId!=null&&!validMessageId(folderId))throw new PublicError('Dossier invalide.');const path=folderId?'items/'+encodeURIComponent(folderId):'root';const data=await this.request({url:'https://graph.microsoft.com/v1.0/me/drive/'+path+'/children?'+new URLSearchParams({'$select':'id,name,folder,file,webUrl','$top':'100'}),headers:{Authorization:'Bearer '+secret.accessToken}});this.selection(req,token);if(!Array.isArray(data.value))throw new PublicError('Les fichiers ne peuvent pas être consultés.',502);return {items:data.value.slice(0,100).filter(item=>validMessageId(item.id)).map(item=>({id:item.id,name:clean(item.name),folder:!!item.folder})),truncated:!!data['@odata.nextLink']};}
  async choose(req,token,id){const {value,secret}=this.selection(req,token);if(!validMessageId(id))throw new PublicError('Document invalide.');const file=await this.request({url:'https://graph.microsoft.com/v1.0/me/drive/items/'+encodeURIComponent(id)+'?$select=id,name,webUrl,file',headers:{Authorization:'Bearer '+secret.accessToken}});this.selection(req,token);const url=allowedURL(file.webUrl);if(!url||!file.file)throw new PublicError('Choisissez un document.');this.selections.delete(digest(token));return this.incoming().fromCloud(req,[{title:clean(file.name)||'Document OneDrive',url}],value.workId);}
  close(){this.closed=true;this.pending.clear();this.selections.clear();}
}

export function installResourceRoutes(router,{store,favorites,personalMail,auth,rateLimit,clock,audit,baseURL,incoming,...options}){
  const resources=new WorkResources(store,favorites,{clock,audit}),cloud=new CloudDocumentPicker(store,resources,personalMail,{clock,baseURL,incoming,...options});
  const check=(req,keys=[])=>{if(req.body?.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['accountId',...keys].includes(key)))throw new PublicError('Paramètres invalides.');};
  router.get('/api/work-resources',auth,(req,res)=>res.json(resources.list(req.user)));
  router.post('/api/work-resources/add',auth,(req,res)=>{rateLimit(req,'resource-add:'+req.user.id,50,900000);check(req,['workId','title','url','favoriteId']);if(typeof req.body.title!=='string'||req.body.title.length>200||req.body.workId!=null&&!validMessageId(req.body.workId)||req.body.url!=null&&typeof req.body.url!=='string'||req.body.favoriteId!=null&&!validMessageId(req.body.favoriteId)||!!req.body.url===!!req.body.favoriteId)throw new PublicError('Choisissez un document ou un lien.');res.json(resources.add(req.user,req.body));});
  router.post('/api/work-resources/:id/remove',auth,(req,res)=>{check(req);res.json(resources.remove(req.user,req.params.id));});
  router.get('/api/work-resources/:id/open',auth,(req,res)=>{rateLimit(req,'resource-read:'+req.user.id,80,900000);const row=resources.find(req.user,req.params.id);res.set('Referrer-Policy','no-referrer');if(row.kind==='link')return res.redirect(303,row.url);const file=favorites.download(req.user,row.favoriteId);res.attachment(file.name).type('application/octet-stream').send(file.bytes);});
  router.get('/api/cloud-documents/providers',auth,(req,res)=>res.json(cloud.providers(req.user)));
  router.post('/api/cloud-documents/:provider/start',auth,(req,res)=>{rateLimit(req,'cloud-select:'+req.user.id,15,900000);check(req,['workId']);res.json(cloud.start(req,req.params.provider,req.body.workId??null));});
  router.get('/api/cloud-documents/oauth/:provider/callback',async(req,res)=>{res.set('Referrer-Policy','no-referrer');try{rateLimit(req,'cloud-callback',60,900000);const result=await cloud.callback(req,req.params.provider,req.query);res.redirect(303,baseURL+'/#'+(result.kind==='incoming'?'shared='+encodeURIComponent(result.token):'cloud-picker='+encodeURIComponent(result.token)));}catch{res.redirect(303,baseURL+'/#cloud-picker=error');}});
  router.post('/api/cloud-documents/files',auth,async(req,res)=>{check(req,['token','folderId']);rateLimit(req,'cloud-files:'+req.user.id,80,900000);res.json(await cloud.files(req,req.body.token,req.body.folderId));});
  router.post('/api/cloud-documents/choose',auth,async(req,res)=>{check(req,['token','id']);rateLimit(req,'cloud-files:'+req.user.id,80,900000);res.json(await cloud.choose(req,req.body.token,req.body.id));});
  return {resources,cloud};
}
