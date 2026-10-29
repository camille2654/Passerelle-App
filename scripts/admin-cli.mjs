#!/usr/bin/env node
import http from 'node:http';
import readline from 'node:readline/promises';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const all=process.argv.slice(2);let json=all.includes('--json'),execute=all.includes('--execute'),watch=all.includes('--watch'),confirmation='';
const socketIndex=all.indexOf('--socket'),confirmIndex=all.indexOf('--confirm');
const socketPath=socketIndex>=0?all[socketIndex+1]:process.env.PASSERELLE_ADMIN_SOCKET||path.join(root,'data/admin.sock');
if(confirmIndex>=0)confirmation=all[confirmIndex+1]||'';
const omitted=new Set(['--json','--execute','--watch']);
const args=all.filter((value,index)=>!omitted.has(value)&&![socketIndex,socketIndex>=0?socketIndex+1:-1,confirmIndex,confirmIndex>=0?confirmIndex+1:-1].includes(index));
const quote=word=>/\s|["']/.test(word)?'"'+word.replaceAll('"','\\"')+'"':word;
async function request(route,input){
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify(input),req=http.request({socketPath,path:'/v1/'+route,method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},timeout:30000},res=>{let text='',bytes=0;res.setEncoding('utf8');res.on('data',part=>{bytes+=Buffer.byteLength(part);if(bytes>4*1024*1024){req.destroy();reject(new Error('Réponse locale trop volumineuse.'));return;}text+=part;});res.on('end',()=>{try{const value=JSON.parse(text);if(res.statusCode>=400)reject(new Error(value.error||'Commande refusée.'));else resolve(value);}catch{reject(new Error('Réponse locale invalide.'));}});});
    req.once('error',error=>reject(new Error(['ENOENT','ECONNREFUSED'].includes(error.code)?'Passerelle est arrêté ou son canal administrateur est inaccessible. Vérifiez le service et le chemin du socket.':error.message)));
    req.once('timeout',()=>req.destroy(new Error('Le serveur local ne répond pas.')));req.end(body);
  });
}
function print(value){
  if(json){process.stdout.write(JSON.stringify(value)+'\n');return;}
  const data=value.data||value;
  if(value.type==='help'){process.stdout.write('Passerelle · Administration\n\n'+value.help.map(line=>'  '+line).join('\n')+'\n\nUne modification produit d’abord un aperçu. Utilisez « apply ID » pour l’approuver.\nOptions : --json, --execute, --confirm TEXTE, --watch, --socket CHEMIN.\n');return;}
  if(value.type==='overview'){const c=data.counts;process.stdout.write(`Passerelle ${data.version} · ${c.active} comptes actifs · ${c.incidents} incidents · ${c.jobs} opérations en attente\nENT : ${c.ent} · Pronote : ${c.pronote} · ICS : ${c.feeds} · Support : ${c.support}\nJournal : ${data.services.audit?'OK':'À vérifier'} · SMTP : ${data.services.mailReady?'Configuré':'À configurer'}\n`);return;}
  if(value.type==='users'){console.table(data.users.map(user=>({id:user.id,identifiant:user.login,nom:user.name,rôle:user.admin?'admin':'membre',état:user.state,ENT:user.ent.connected,Pronote:user.pronote.connected,ICS:user.feed.active})));process.stdout.write(`${data.total} résultats · ${data.offset+1}–${Math.min(data.offset+data.limit,data.total)}\n`);return;}
  if(value.type==='plan'||data.targets){process.stdout.write(`\n${data.label}\n${data.description}\n${data.count} cible(s) · aperçu ${data.id}\n`);for(const item of data.targets)process.stdout.write('  '+(item.login||item.name)+'\n');if(data.confirmation)process.stdout.write('Confirmation demandée : '+data.confirmation+'\n');process.stdout.write('Pour approuver : passerelle-admin apply '+data.id+'\n');return;}
  if(value.type==='jobs'||value.type==='incidents'||value.type==='invites'){console.table(data.items);return;}
  if(data.counts&&data.items&&data.command){process.stdout.write(`${data.label} · ${data.state} · ${data.counts.done}/${data.counts.total}\n`);for(const item of data.items)process.stdout.write('  '+(item.login||item.name)+' · '+item.state+(item.message?' · '+item.message:'')+'\n');if(data.hasSecret)process.stdout.write('Lien privé disponible : '+data.id+' (affichage unique).\n');return;}
  process.stdout.write(JSON.stringify(data,null,2)+'\n');
}
async function approve(plan,rl){
  if(plan.sensitive){
    if(!confirmation&&process.stdin.isTTY&&!json)confirmation=await rl.question(`Recopiez « ${plan.confirmation} » : `);
    if(confirmation!==plan.confirmation)throw new Error('Confirmation manquante. Ajoutez --confirm "'+plan.confirmation+'" après avoir vérifié l’aperçu.');
  }else if(!execute&&process.stdin.isTTY&&!json){if((await rl.question('Appliquer cette commande ? [oui/non] ')).trim().toLowerCase()!=='oui')return;}
  let job=await request('apply',{planId:plan.id,confirmation});print({type:'job',data:job});
  if(watch||process.stdin.isTTY&&!json){
    while(['queued','running'].includes(job.state)){await new Promise(resolve=>setTimeout(resolve,500));job=(await request('command',{line:'jobs show '+job.id})).data;if(json)print({type:'job',data:job});}
    if(!json)print({type:'job',data:job});
    if(job.hasSecret){const secret=await request('secret',{id:job.id});print({type:'secret',data:secret});}
    if(['failed','partial','interrupted'].includes(job.state))process.exitCode=2;
  }
}
async function run(line,rl){
  if(line.startsWith('secret ')){print({type:'secret',data:await request('secret',{id:line.slice(7).trim()})});return;}
  if(line.startsWith('apply ')){const plan=await request('plan',{id:line.slice(6).trim()});print({type:'plan',data:plan});await approve(plan,rl);return;}
  const value=await request('command',{line});print(value);if(execute&&value.type==='plan')await approve(value.data,rl);
}
let rl;
try{
  if(!socketPath)throw new Error('Indiquez un chemin de socket valide.');
  rl=readline.createInterface({input:process.stdin,output:process.stdout,terminal:!!process.stdin.isTTY});
  if(args.length)await run(args.map(quote).join(' '),rl);
  else if(process.stdin.isTTY&&!json){process.stdout.write('Passerelle · Console administrateur\nSaisissez help pour les commandes, exit pour quitter.\n');for(;;){const line=(await rl.question('passerelle> ')).trim();if(['exit','quit'].includes(line))break;if(!line)continue;try{await run(line,rl);}catch(error){process.stderr.write(error.message+'\n');}confirmation='';}}
  else await run('help',rl);
}catch(error){process.stderr.write((json?JSON.stringify({error:error.message}):error.message)+'\n');process.exitCode=1;}finally{rl?.close();}
