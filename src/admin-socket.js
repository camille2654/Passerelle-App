import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import {PublicError} from './sync.js';

export async function listenAdminSocket(control,{socketPath=path.join(control.store.dir,'admin.sock')}={}){
  if(fs.existsSync(socketPath)){
    const stat=fs.lstatSync(socketPath);
    if(!stat.isSocket()||typeof process.getuid==='function'&&stat.uid!==process.getuid())throw new Error('ADMIN_SOCKET_UNSAFE');
    const active=await new Promise(resolve=>{const client=net.connect(socketPath);client.once('connect',()=>{client.destroy();resolve(true);});client.once('error',error=>resolve(error.code!=='ECONNREFUSED'&&error.code!=='ENOENT'));});
    if(active)throw new Error('ADMIN_SOCKET_IN_USE');fs.unlinkSync(socketPath);
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');
    try{
      if(req.method!=='POST')throw new PublicError('Commande locale invalide.',405);
      req.setEncoding('utf8');let bytes=0,body='';for await(const chunk of req){bytes+=Buffer.byteLength(chunk);if(bytes>64000)throw new PublicError('Commande trop volumineuse.',413);body+=chunk.toString('utf8');}
      let input;try{input=JSON.parse(body);}catch{throw new PublicError('Commande JSON invalide.');}
      const principal={kind:'local'};let value;
      if(req.url==='/v1/command')value=control.read(principal,String(input.line||''));
      else if(req.url==='/v1/prepare')value=control.prepare(principal,input);
      else if(req.url==='/v1/apply')value=control.apply(principal,input);
      else if(req.url==='/v1/secret')value=control.reveal(principal,String(input.id||''));
      else if(req.url==='/v1/plan')value=control.publicPlan(control.getPlan(principal,String(input.id||'')),principal);
      else throw new PublicError('Commande locale inconnue.',404);
      res.end(JSON.stringify(value));
    }catch(error){res.statusCode=error instanceof PublicError?error.status:400;res.end(JSON.stringify({error:error instanceof PublicError?error.message:'La commande locale a échoué.',code:error.code||'ADMIN_LOCAL_FAILED'}));}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(socketPath,resolve);});fs.chmodSync(socketPath,0o600);
  return {server,socketPath,async close(){await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();});try{if(fs.lstatSync(socketPath).isSocket())fs.unlinkSync(socketPath);}catch{}}};
}
