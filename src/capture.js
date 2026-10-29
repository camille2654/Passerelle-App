import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import {imageSize} from 'image-size';
import {PublicError} from './sync.js';
import {accountActive} from './operational-state.js';

const MAX_IMAGE=8*1024*1024;
export function imageInfo(bytes){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAX_IMAGE)throw new PublicError('Choisissez une photo de moins de 8 Mo.',413);
  let info;try{info=imageSize(bytes);}catch{throw new PublicError('La photo ne peut pas être lue. Choisissez un fichier JPG, PNG ou WebP.',422);}
  if(!['jpg','png','webp'].includes(info.type)||!info.width||!info.height||info.width>6000||info.height>6000||info.width*info.height>16000000)throw new PublicError('Choisissez une photo JPG, PNG ou WebP de taille raisonnable.',413);
  return info;
}
export function workerOCR(bytes,socketPath='/run/passerelle-ocr.sock'){
  return new Promise((resolve,reject)=>{
    const request=http.request({socketPath,path:'/recognize',method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':bytes.length},signal:AbortSignal.timeout(26000)},response=>{
      let size=0;const chunks=[];response.on('data',chunk=>{size+=chunk.length;if(size>64000){request.destroy();reject(new Error('OCR_RESPONSE_TOO_LARGE'));}else chunks.push(chunk);});
      response.on('end',()=>{try{if(response.statusCode!==200)throw new Error('OCR_REJECTED');resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch{reject(new Error('OCR_FAILED'));}});
    });request.on('error',reject);request.end(bytes);
  });
}
export class CaptureEngine{
  constructor(store,{clock=()=>Date.now(),audit=null,socketPath='/run/passerelle-ocr.sock',recognize=null}={}){Object.assign(this,{store,clock,audit,socketPath});this.recognize=recognize||((bytes)=>workerOCR(bytes,socketPath));this.mock=!!recognize;this.busy=false;}
  available(){return this.mock||fs.existsSync(this.socketPath);}
  async read(req){
    if(!this.available())throw new PublicError('La lecture des photos n’est pas disponible pour le moment.',503);
    if(this.busy)throw new PublicError('Une photo est déjà en cours de lecture. Réessayez dans un instant.',429);
    imageInfo(req.body);const user=req.user,profile=user.studentId||null;this.busy=true;
    try{
      const result=await this.recognize(req.body);
      if(!accountActive(user)||(user.studentId||null)!==profile||!this.store.state.sessions.some(session=>session.hash===req.session.hash&&session.userId===user.id&&session.expires>Date.now()))throw new PublicError('Le compte ou l’élève a changé. Relancez la lecture.',409);
      const text=String(result.text||'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').trim().slice(0,8000);
      if(!text)throw new PublicError('Aucun texte n’a été reconnu. Essayez une photo plus nette ou saisissez le devoir.',422);
      this.audit?.record('capture.read',{source:'personal',userId:user.id,meta:{count:1}});
      return {accountId:user.id,text,title:text.split(/\r?\n/).find(line=>line.trim())?.slice(0,300)||'Devoir à vérifier',truncated:!!result.truncated||String(result.text||'').length>8000};
    }catch(error){if(error instanceof PublicError)throw error;this.audit?.record('capture.failed',{source:'personal',level:'warn',userId:user.id,meta:{errorCode:'OCR_FAILED'}});throw new PublicError('La photo n’a pas pu être lue. Essayez un texte net et bien éclairé.',422);}finally{this.busy=false;}
  }
}
export function installCaptureRoutes(router,{store,auth,rateLimit,clock,audit,...options}){
  const capture=new CaptureEngine(store,{clock,audit,...options});
  router.get('/api/capture',auth,(req,res)=>res.json({ready:capture.available(),maxBytes:MAX_IMAGE}));
  const raw=express.raw({type:['image/jpeg','image/png','image/webp'],limit:MAX_IMAGE});
  router.post('/api/capture',auth,(req,res,next)=>{if(req.get('x-passerelle-account')!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);rateLimit(req,'capture:'+req.user.id,5,15*60000);raw(req,res,error=>error?next(new PublicError('Choisissez une photo de moins de 8 Mo.',413)):next());},async(req,res)=>res.json(await capture.read(req)));
  return capture;
}
