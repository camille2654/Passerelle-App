import {assertPreviewOwner,sendDocumentPreview} from './document-preview.js';
import {MAX_DOCUMENT_BYTES,MAX_FAVORITE_BYTES} from './upload-limits.js';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import {randomUUID,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {digest} from './store.js';
import {PublicError} from './sync.js';
import {accountActive} from './operational-state.js';

const MAX_FILE=MAX_DOCUMENT_BYTES,MAX_TOTAL=MAX_FAVORITE_BYTES,MAX_COUNT=20;
const cleanName=value=>path.posix.basename(String(value||'Document').replaceAll('\\','/')).replace(/[\u0000-\u001f\u007f]/g,'').slice(0,200)||'Document';
export class Favorites{
  constructor(store,school,{clock=()=>Date.now(),audit=null}={}){Object.assign(this,{store,school,clock,audit});this.dir=path.join(store.dir,'favorites');fs.mkdirSync(this.dir,{recursive:true,mode:0o700});}
  scope(user){let school='local';if(user.skolengo)try{school=this.store.open(user.skolengo).school?.id||'local';}catch{}return digest(user.id+':'+(user.studentId||'local')+':'+school);}
  metadata(row){const value=this.store.open(row.metadata);return {id:row.id,name:value.name,size:row.size,source:row.source,createdAt:row.createdAt};}
  list(user){return {accountId:user.id,items:(user.favoriteDocuments||[]).filter(row=>row.scope===this.scope(user)).map(row=>this.metadata(row)).sort((a,b)=>b.createdAt-a.createdAt),usedBytes:(user.favoriteDocuments||[]).reduce((total,row)=>total+row.size,0),maxBytes:MAX_TOTAL,maxCount:MAX_COUNT,maxFileBytes:MAX_FILE};}
  file(user,id){return path.join(this.dir,digest(user.id),id+'.enc');}
  aad(user,row){return Buffer.from('passerelle:favorite:'+user.id+':'+row.scope+':'+row.id);}
  save(user,bytes,name,source,scope=this.scope(user)){
    if(!accountActive(user)||scope!==this.scope(user))throw new PublicError('L’élève ou le compte a changé. Relancez l’ajout.',409);
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_FILE)throw new PublicError('Choisissez un document de moins de 30 Mo.',413);
    const contentHash=digest(bytes),previous=(user.favoriteDocuments||[]).find(row=>row.scope===scope&&row.contentHash===contentHash);if(previous)return {item:this.metadata(previous),alreadySaved:true,...this.list(user)};
    const rows=user.favoriteDocuments||[];if(rows.length>=MAX_COUNT||rows.reduce((total,row)=>total+row.size,0)+bytes.length>MAX_TOTAL)throw new PublicError('Vos favoris sont pleins. Retirez un document pour en ajouter un autre.',409);
    const disk=fs.statfsSync(this.dir);if(Number(disk.bavail)*Number(disk.bsize)<bytes.length+200*1024*1024)throw new PublicError('Le stockage est temporairement indisponible.',503);
    const row={id:randomUUID(),scope,source,size:bytes.length,createdAt:this.clock(),contentHash,metadata:this.store.seal({name:cleanName(name)})},iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.store.key,iv);cipher.setAAD(this.aad(user,row));
    const body=Buffer.concat([cipher.update(bytes),cipher.final()]),encoded=Buffer.concat([Buffer.from('PFL1'),iv,cipher.getAuthTag(),body]),file=this.file(user,row.id);
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,encoded,{mode:0o600,flag:'wx'});
    try{user.favoriteDocuments=[...rows,row];this.store.save();}catch(error){user.favoriteDocuments=rows;fs.rmSync(file,{force:true});throw error;}
    this.audit?.record('favorite.added',{source:'personal',userId:user.id,meta:{jobId:row.id,mode:source,count:1}});return {item:this.metadata(row),alreadySaved:false,...this.list(user)};
  }
  async fromENT(req,ref){const user=req.user,scope=this.scope(user);this.school.lookup(user,String(ref||''),'file');const file=await this.school.download(user,String(ref||''));if(!this.store.state.sessions.some(session=>session.hash===req.session.hash&&session.userId===user.id&&session.expires>Date.now()))throw new PublicError('La connexion a changé. Relancez l’ajout.',409);return this.save(user,file.bytes,file.name,'ENT',scope);}
  find(user,id){const row=(user.favoriteDocuments||[]).find(row=>row.id===id&&row.scope===this.scope(user));if(!row)throw new PublicError('Document favori introuvable.',404);return row;}
  download(user,id){const row=this.find(user,id);try{const input=fs.readFileSync(this.file(user,row.id));if(input.subarray(0,4).toString()!=='PFL1')throw new Error();const cipher=createDecipheriv('aes-256-gcm',this.store.key,input.subarray(4,16));cipher.setAAD(this.aad(user,row));cipher.setAuthTag(input.subarray(16,32));const bytes=Buffer.concat([cipher.update(input.subarray(32)),cipher.final()]);if(bytes.length!==row.size)throw new Error();this.audit?.record('favorite.downloaded',{source:'personal',userId:user.id,meta:{jobId:id}});return {bytes,name:this.metadata(row).name};}catch{throw new PublicError('La copie enregistrée ne peut pas être ouverte. Ajoutez-la à nouveau.',502);}}
  remove(user,id){const row=this.find(user,id),previous=user.favoriteDocuments;user.favoriteDocuments=previous.filter(item=>item.id!==id);try{this.store.save();}catch(error){user.favoriteDocuments=previous;throw error;}fs.rmSync(this.file(user,row.id),{force:true});this.audit?.record('favorite.removed',{source:'personal',userId:user.id,meta:{jobId:id}});return this.list(user);}
}
export function installFavoriteRoutes(router,{store,school,auth,rateLimit,clock,audit,...options}){
  const favorites=new Favorites(store,school,{clock,audit,...options});
  const same=(req,res,next)=>{if(req.body?.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);next();};
  router.get('/api/favorites',auth,(req,res)=>res.json(favorites.list(req.user)));
  router.post('/api/favorites/from-ent',auth,same,async(req,res)=>{rateLimit(req,'favorite-add:'+req.user.id,20,15*60000);res.json(await favorites.fromENT(req,req.body.ref));});
  router.post('/api/favorites/:id/remove',auth,same,(req,res)=>res.json(favorites.remove(req.user,req.params.id)));
  router.get('/api/favorites/:id/download',auth,(req,res)=>{rateLimit(req,'favorite-read:'+req.user.id,80,15*60000);const file=favorites.download(req.user,req.params.id);res.attachment(file.name).type('application/octet-stream').send(file.bytes);});
  router.get('/api/favorites/:id/preview',auth,(req,res)=>{assertPreviewOwner(req);rateLimit(req,'favorite-read:'+req.user.id,80,15*60000);sendDocumentPreview(res,favorites.download(req.user,req.params.id));});
  const raw=express.raw({type:'application/octet-stream',limit:MAX_FILE});
  router.post('/api/favorites/upload',auth,(req,res,next)=>{if(req.get('x-passerelle-account')!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);req.favoriteScope=favorites.scope(req.user);rateLimit(req,'favorite-upload:'+req.user.id,10,15*60000);raw(req,res,error=>error?next(new PublicError('Choisissez un document de moins de 30 Mo.',413)):next());},(req,res)=>{let name;try{name=decodeURIComponent(req.get('x-file-name')||'Document');}catch{throw new PublicError('Le nom du fichier est invalide.');}if(!store.state.sessions.some(session=>session.hash===req.session.hash&&session.userId===req.user.id&&session.expires>Date.now()))throw new PublicError('La connexion a changé. Relancez l’ajout.',409);res.json(favorites.save(req.user,req.body,name,'Personnel',req.favoriteScope));});
  return favorites;
}
