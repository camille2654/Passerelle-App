import {MAX_DOCUMENT_BYTES,MAX_SHARE_MEMORY_BYTES} from './upload-limits.js';
import multer from 'multer';
import express from 'express';
import {randomUUID} from 'node:crypto';
import {random,digest} from './store.js';
import {PublicError} from './sync.js';
import {accountActive} from './operational-state.js';
import {addManualWork,validateManualWork} from './manual-work.js';

const MAX_FILE=MAX_DOCUMENT_BYTES,MAX_MEMORY=MAX_SHARE_MEMORY_BYTES,TTL=10*60000;
const clean=(value,max)=>typeof value==='string'?value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trim().slice(0,max):'';
// Multipart filenames without filename* are decoded as Latin-1 by Busboy.
function fileName(value){let name=typeof value==='string'?value:'Document';if([...name].every(char=>char.codePointAt(0)<=255))try{name=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(name,'latin1'));}catch{}return clean(name,200).replaceAll('\\','/').split('/').at(-1)||'Document';}
function shareError(message,status,code){return Object.assign(new PublicError(message,status),{code});}
function multipartError(error){
 const fileField='Le champ « file » doit être de type Fichier et contenir la variable « Entrée du raccourci ». Recréez ce champ dans Raccourcis en choisissant Fichier.';
 if(error.code==='LIMIT_FILE_SIZE')return shareError('Choisissez un document de 30 Mo maximum.',413,'SHARE_FILE_TOO_LARGE');
 if(error.code==='LIMIT_FILE_COUNT'||error.code==='LIMIT_UNEXPECTED_FILE'&&error.field==='file')return shareError('Envoyez un seul fichier à la fois. Dans Photos, sélectionnez une seule photo.',413,'SHARE_SINGLE_FILE');
 if(error.code==='LIMIT_UNEXPECTED_FILE'||error.code==='LIMIT_FIELD_VALUE'&&error.field==='file')return shareError(fileField,400,'SHARE_FILE_FIELD');
 if(error.code==='LIMIT_FIELD_VALUE')return shareError('Le texte partagé est trop long. Envoyez-le dans un fichier de 30 Mo maximum.',400,'SHARE_TEXT_TOO_LONG');
 if(['LIMIT_FIELD_COUNT','LIMIT_PART_COUNT','LIMIT_FIELD_KEY'].includes(error.code))return shareError('Le formulaire contient trop de champs. Utilisez un seul champ « file » de type Fichier.',400,'SHARE_TOO_MANY_FIELDS');
 return shareError('Le formulaire envoyé est incomplet ou invalide. Dans Raccourcis, choisissez Fichier comme corps de la requête avec la variable Entrée du raccourci, puis renvoyez le document.',400,'SHARE_MULTIPART_INVALID');
}
const rawNames=new Map([['application/octet-stream','document.bin'],['application/pdf','document.pdf'],['text/plain','texte.txt'],['application/zip','document.zip'],['application/msword','document.doc'],['application/vnd.ms-excel','document.xls'],['application/vnd.ms-powerpoint','document.ppt'],['application/vnd.openxmlformats-officedocument.wordprocessingml.document','document.docx'],['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','document.xlsx'],['application/vnd.openxmlformats-officedocument.presentationml.presentation','document.pptx']]);
function rawFileName(req,bytes,type){
 const supplied=req.get('x-file-name');if(supplied!==undefined){if(supplied.length>600)throw shareError('Le nom du fichier est trop long.',400,'SHARE_FILE_NAME');let decoded;try{decoded=decodeURIComponent(supplied);}catch{throw shareError('Le nom du fichier est invalide.',400,'SHARE_FILE_NAME');}if(!decoded.trim()||/[\u0000-\u001f\u007f]/.test(decoded))throw shareError('Le nom du fichier est invalide.',400,'SHARE_FILE_NAME');return fileName(decoded);}
 const prefix=bytes.subarray(0,32);
 if(prefix.subarray(0,5).toString()==='%PDF-')return 'document.pdf';
 if(prefix.length>=3&&prefix[0]===255&&prefix[1]===216&&prefix[2]===255)return 'photo.jpg';
 if(prefix.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'photo.png';
 if(['GIF87a','GIF89a'].includes(prefix.subarray(0,6).toString()))return 'photo.gif';
 if(prefix.subarray(0,4).toString()==='RIFF'&&prefix.subarray(8,12).toString()==='WEBP')return 'photo.webp';
 if(prefix.subarray(4,8).toString()==='ftyp'){const brand=prefix.subarray(8,12).toString();if(['heic','heix','hevc','hevx','mif1','msf1'].includes(brand))return 'photo.heic';if(['avif','avis'].includes(brand))return 'photo.avif';}
 const images={'image/jpeg':'photo.jpg','image/png':'photo.png','image/webp':'photo.webp','image/gif':'photo.gif','image/heic':'photo.heic','image/heif':'photo.heif','image/avif':'photo.avif','image/tiff':'photo.tiff'};
 return images[type]||rawNames.get(type)||'document.bin';
}
function multipartCategory(error){const message=String(error.message||'').toLowerCase();return message.includes('boundary')?'boundary':message.includes('unexpected end')?'truncated':message.includes('header')?'header':'other';}
const active=(store,req)=>accountActive(req.user)&&store.user(req.user.id)===req.user&&store.state.sessions.some(s=>s.hash===req.session?.hash&&s.userId===req.user.id&&s.expires>Date.now());
export class IncomingService {
 constructor(store,favorites,resources,{clock=()=>Date.now(),baseURL,audit=null}={}){Object.assign(this,{store,favorites,resources,clock,baseURL,audit});this.drafts=new Map();this.closed=false;this.timer=setInterval(()=>this.prune(),60000);this.timer.unref();}
 prune(){for(const [key,row] of this.drafts)if(row.expiresAt<=this.clock())this.drafts.delete(key);}
 create({title='',text='',url='',file=null,links=[],workId=null},req=null){
  this.prune();if(this.closed)throw new PublicError('Le partage est temporairement indisponible.',503);
  title=clean(title,200);text=clean(text,10000);url=clean(url,4000);
  if(url){let parsed;try{parsed=new URL(url);}catch{}if(!parsed||!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password)throw new PublicError('Le lien partagé est invalide.');text=[text,url].filter(Boolean).join('\n').slice(0,10000);}
  if(file&&(!Buffer.isBuffer(file.buffer)||!file.buffer.length||file.buffer.length>MAX_FILE))throw shareError('Choisissez un document de 30 Mo maximum.',413,'SHARE_FILE_TOO_LARGE');
  if(!title&&!text&&!file&&!links.length)throw new PublicError('Le téléphone n’a transmis aucun contenu. Ouvrez Passerelle et utilisez « Importer un document ».',400);
  if(this.drafts.size>=200||[...this.drafts.values()].reduce((n,d)=>n+(d.file?.buffer.length||0),0)+(file?.buffer.length||0)>MAX_MEMORY)throw new PublicError('Plusieurs partages sont en cours. Réessayez dans quelques minutes.',429);
  const token=random(),row={title,text,file:file?{buffer:file.buffer,name:fileName(file.originalname||file.name)}:null,links,workId,expiresAt:this.clock()+TTL,binding:null,result:null};
  if(req?.user){if(!active(this.store,req))throw new PublicError('La connexion a changé. Recommencez.',409);row.binding=this.binding(req);}
  this.drafts.set(digest(token),row);return {token,openURL:this.baseURL+'/#shared='+encodeURIComponent(token),expiresAt:row.expiresAt};
 }
 binding(req){return {userId:req.user.id,session:req.session.hash,scope:this.favorites.scope(req.user)};}
 fromCloud(req,links,workId=null){if(!Array.isArray(links)||!links.length||links.length>5)throw new PublicError('Choisissez entre un et cinq documents.');this.resources.assertWork(req.user,workId);return this.create({title:links.length===1?links[0].title:'Documents sélectionnés',links,workId},req);}
 find(req,token,{claim=false}={}){
  this.prune();if(this.closed||!active(this.store,req))throw new PublicError('La connexion a changé. Reconnectez-vous.',409);
  const row=typeof token==='string'&&token.length<=200&&this.drafts.get(digest(token));if(!row)throw new PublicError('Ce partage a expiré. Envoyez-le à nouveau.',410);
  const binding=this.binding(req);if(!row.binding&&claim)row.binding=binding;
  if(!row.binding||Object.keys(binding).some(key=>row.binding[key]!==binding[key]))throw new PublicError('Ce partage n’appartient pas à cette session. Envoyez-le à nouveau depuis le bon compte.',409);
  return row;
 }
 preview(req,token){const row=this.find(req,token,{claim:true});return {accountId:req.user.id,title:row.title,text:row.text,file:row.file?{name:row.file.name,size:row.file.buffer.length}:null,links:row.links.map(link=>({title:link.title})),workId:row.workId,expiresAt:row.expiresAt,result:row.result};}
 commit(req,input){
  const row=this.find(req,input.token);if(row.result)return {...row.result,alreadySaved:true};
  if(!['homework','attach','library','note'].includes(input.action))throw new PublicError('Choisissez où conserver ce contenu.');
  const user=req.user,now=this.clock(),noteText=clean(input.noteText||row.text||row.title,2000),subjectLabel=clean(input.subjectLabel,120);
  let workId=null,workInput=null;
  if(input.action==='homework'){workInput=validateManualWork(user,{title:input.title||row.title||row.file?.name,details:input.details??row.text,subjectLabel:input.subjectLabel,due:input.due,kind:input.kind||'homework'},now);}
  if(input.action==='attach'){workId=input.workId;this.resources.assertWork(user,workId);if(!workId)throw new PublicError('Choisissez un devoir.');}
  if(input.action==='note'&&(!noteText||!subjectLabel||(user.courseNotes||[]).length>=100))throw new PublicError('Indiquez une matière et une note. Vous pouvez conserver 100 notes.');
  if(input.action==='note'&&(row.file||row.links.length))throw new PublicError('Conservez le document dans vos favoris ou dans un devoir.');
  const savesFile=!!row.file||(!row.links.length&&!!row.text&&['library','attach'].includes(input.action));
  const file=row.file||(savesFile?{buffer:Buffer.from(row.text,'utf8'),name:(row.title||'Texte partagé').replace(/[/.]/g,'-')+'.txt'}:null);
  // Validate all limits before the synchronous commit. No remote content is fetched.
  if(file){const list=this.favorites.list(user),duplicate=(user.favoriteDocuments||[]).some(value=>value.scope===this.favorites.scope(user)&&value.contentHash===digest(file.buffer));if(!duplicate&&((user.favoriteDocuments||[]).length>=list.maxCount||list.usedBytes+file.buffer.length>list.maxBytes))throw new PublicError('Vos favoris sont pleins. Retirez un document avant de continuer.',409);}
  const resourceCount=row.links.length+(file?1:0),rows=this.resources.rows(user);if(rows.length+resourceCount>300||['attach','homework'].includes(input.action)&&resourceCount+(workId?rows.filter(value=>value.workId===workId).length:0)>10||input.action==='library'&&rows.filter(value=>!value.workId).length+resourceCount>100)throw new PublicError('La limite de documents est atteinte.',409);
  if(!file&&!row.links.length&&!['homework','note'].includes(input.action))throw new PublicError('Aucun document à conserver. Choisissez « Note liée à un cours ».');
  const previous=structuredClone(user),priorFiles=new Set((user.favoriteDocuments||[]).map(value=>value.id));
  try{
   if(workInput)workId=addManualWork(this.store,user,workInput,now);
   let favoriteId=null;if(file)favoriteId=this.favorites.save(user,file.buffer,file.name,'Partage').item.id;
   if(input.action==='note'){const note={id:randomUUID(),studentId:user.studentId||null,subjectLabel,text:noteText,done:false,createdAt:now};this.store.update(user.id,{courseNotes:[note,...(user.courseNotes||[])],personalVersion:now});}
   else {for(const link of row.links)this.resources.add(user,{workId,title:link.title,url:link.url});if(favoriteId)this.resources.add(user,{workId,title:file.name,favoriteId});}
   user.personalVersion=now;this.store.save();
   this.audit?.record('incoming.saved',{source:'personal',userId:user.id,meta:{mode:input.action,count:resourceCount}});row.result={ok:true,action:input.action,workId};row.file=null;row.text='';row.links=[];return row.result;
  }catch(error){for(const added of user.favoriteDocuments||[])if(!priorFiles.has(added.id)){try{this.favorites.remove(user,added.id);}catch{}}
   for(const key of Object.keys(user))delete user[key];Object.assign(user,previous);this.store.save();throw error;
  }
 }
 discard(req,token){this.find(req,token);this.drafts.delete(digest(token));return {ok:true};}
 detach(sessionHash){for(const [key,row] of this.drafts)if(row.binding?.session===sessionHash)this.drafts.delete(key);}
 close(){this.closed=true;clearInterval(this.timer);this.drafts.clear();}
}
export function installIncomingRoutes(router,{store,favorites,resources,auth,rateLimit,baseURL,clock,audit,...options}){
 const incoming=new IncomingService(store,favorites,resources,{baseURL,clock,audit,...options});
 let uploads=0;
 const reserve=(req,res,next)=>{if(uploads>=1)return next(new PublicError('Un document est déjà en cours d’envoi. Réessayez dans un instant.',429));if(Number(req.get('content-length'))>MAX_FILE+64000)return next(shareError('Choisissez un document de 30 Mo maximum.',413,'SHARE_FILE_TOO_LARGE'));uploads++;let released=false;const release=()=>{if(!released){released=true;uploads--;}};res.once('finish',release);res.once('close',release);req.once('aborted',release);next();};
 const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_FILE+1,files:1,fields:3,fieldSize:12000,parts:4}}).single('file');
 const raw=express.raw({type:()=>true,limit:MAX_FILE});
 const receive=(req,res,next)=>{
  try{
   rateLimit(req,'incoming-share:'+(req.user?.id||'public'),req.user?30:60,900000);
   if(req.is('multipart/form-data'))return upload(req,res,error=>{if(!error)return next();const failure=multipartError(error);audit?.record('incoming.failed',{source:'personal',level:'warn',meta:{route:'/share',status:failure.status,errorCode:failure.code,mode:multipartCategory(error)}});next(failure);});
   const type=String(req.get('content-type')||'').split(';')[0].trim().toLowerCase();
   if(type&&!/^image\/[a-z0-9.+-]+$/.test(type)&&!rawNames.has(type))throw shareError('Ce format d’envoi n’est pas pris en charge. Dans Raccourcis, choisissez Fichier comme corps de la requête avec Entrée du raccourci.',415,'SHARE_FILE_TYPE');
   raw(req,res,error=>{
    if(error)return next(shareError(error.type==='entity.too.large'?'Choisissez un document de 30 Mo maximum.':'L’envoi du fichier a été interrompu. Réessayez depuis son application.',error.type==='entity.too.large'?413:400,error.type==='entity.too.large'?'SHARE_FILE_TOO_LARGE':'SHARE_FILE_INCOMPLETE'));
    try{const bytes=req.body;if(!Buffer.isBuffer(bytes)||!bytes.length)throw shareError('Aucun fichier reçu. Choisissez Entrée du raccourci comme fichier à envoyer.',400,'SHARE_EMPTY_FILE');req.file={buffer:bytes,originalname:rawFileName(req,bytes,type)};req.body={};next();}catch(failure){next(failure);}
   });
  }catch(error){next(error);}
 };
 router.post('/share',reserve,receive,(req,res)=>{
  if(Object.hasOwn(req.body||{},'file'))throw shareError('Le champ « file » est envoyé comme du texte. Dans Raccourcis, choisissez Fichier comme corps de la requête avec la variable Entrée du raccourci.',400,'SHARE_FILE_FIELD');
  if(Object.keys(req.body||{}).some(key=>!['title','text','url'].includes(key))||Object.values(req.body||{}).some(value=>typeof value!=='string'))throw new PublicError('Le partage est invalide.');
  const result=incoming.create({...req.body,file:req.file});res.set('Referrer-Policy','no-referrer');if(req.get('accept')?.includes('application/json'))return res.json(result);res.redirect(303,result.openURL);
 });
 const check=(req,keys)=>{if(req.body?.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['accountId','token',...keys].includes(key)))throw new PublicError('Paramètres invalides.');};
 router.post('/api/incoming/claim',auth,(req,res)=>{rateLimit(req,'incoming-claim:'+req.user.id,60,900000);check(req,[]);res.json(incoming.preview(req,req.body.token));});
 router.post('/api/incoming/commit',auth,(req,res)=>{rateLimit(req,'incoming-commit:'+req.user.id,30,900000);check(req,['action','title','details','subjectLabel','due','kind','workId','noteText']);res.json(incoming.commit(req,req.body));});
 router.post('/api/incoming/discard',auth,(req,res)=>{check(req,[]);res.json(incoming.discard(req,req.body.token));});
 return incoming;
}
