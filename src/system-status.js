import {maintenanceState,automationAllowed} from './operational-state.js';
import {renderCalendar} from './ical.js';

const PULSE_TTL=90000;
const labels={operational:'Opérationnel',degraded:'À vérifier',paused:'En pause',disabled:'Non activé',unknown:'Non vérifié',unavailable:'Indisponible'};
const descriptions={
  ent:'Le moteur de mise à jour des emplois du temps est actif.',
  mail:'Le traitement des notifications par mail est actif. La livraison finale dépend du service d’envoi.',
  push:'Le traitement des notifications de l’application est actif. La réception dépend aussi de chaque appareil.',
  managed:'Le connecteur Passerelle pour Lapsus est actif. Le site Lapsus n’est pas testé ici.'
};

// Runtime observations only: this class never reads account rows, sends messages,
// contacts an ENT or changes private state. A configured service is not a probe.
export class SystemStatus {
  constructor({settings=()=>({}),mailReady=()=>false,pushReady=()=>false,clock=()=>Date.now(),version,calendarCheck=()=>renderCalendar([])}={}){
    Object.assign(this,{settings,mailReady,pushReady,clock,version,calendarCheck});
    this.startedAt=clock();this.workers=new Map();this.events=[];this.previous=new Map();
  }
  track(id,task){
    let worker=this.workers.get(id);
    if(!worker){worker={pulseAt:null,startedAt:null,completedAt:null,failed:false,promise:null};this.workers.set(id,worker);}
    worker.pulseAt=this.clock();
    if(worker.promise)return worker.promise;
    worker.startedAt=this.clock();
    worker.promise=Promise.resolve().then(task).then(value=>{worker.completedAt=this.clock();worker.failed=false;return value;},error=>{worker.completedAt=this.clock();worker.failed=true;throw error;}).finally(()=>{worker.promise=null;});
    return worker.promise;
  }
  worker(id,{enabled=true,paused=false}={}){
    const row=this.workers.get(id),at=this.clock();
    if(!enabled)return {state:'disabled',description:'Ce service n’est pas activé sur cette installation.',observedAt:null};
    if(paused)return {state:'paused',description:'Les automatismes de ce service sont suspendus par l’administration.',observedAt:at};
    if(!row||row.pulseAt===null)return {state:'unknown',description:'En attente du premier passage du traitement automatique.',observedAt:null};
    if(row.pulseAt>at||at-row.pulseAt>PULSE_TTL)return {state:'unknown',description:'Le dernier signal est trop ancien. Le fonctionnement actuel ne peut pas être confirmé.',observedAt:row.pulseAt};
    if(row.failed)return {state:'degraded',description:'Le dernier passage du traitement a échoué. Une nouvelle tentative est prévue.',observedAt:row.completedAt};
    return {state:'operational',description:descriptions[id],observedAt:row.pulseAt};
  }
  snapshot(){
    const at=this.clock(),settings=this.settings(),maintenance=maintenanceState(settings,at);
    const service=(id,name,icon,state,description,observedAt=at)=>({id,name,icon,state,label:labels[state],description,observedAt});
    let calendarOK=false;try{const result=this.calendarCheck();calendarOK=typeof result==='string'&&result.startsWith('BEGIN:VCALENDAR\r\n')&&result.endsWith('END:VCALENDAR\r\n');}catch{}
    const components=[
      service('portal','Portail et API','home','operational','Le serveur Passerelle répond à cette vérification.'),
      {id:'ent',name:'Synchronisation des cours',icon:'sync',...this.worker('ent',{paused:!automationAllowed(settings,'ent',at)})},
      service('calendars','Agendas ICS','calendar',calendarOK?'operational':'unavailable',calendarOK?'La génération d’un calendrier de contrôle fonctionne.':'La génération des calendriers ne peut pas être confirmée.'),
      {id:'mail',name:'Notifications par mail',icon:'mail',...this.worker('mail',{enabled:this.mailReady(),paused:!automationAllowed(settings,'mail',at)})},
      {id:'push',name:'Notifications de l’app',icon:'bell',...this.worker('push',{enabled:this.pushReady(),paused:!automationAllowed(settings,'push',at)})},
      {id:'managed',name:'Connecteur Lapsus',icon:'sources',...this.worker('managed',{enabled:settings.managedENTLapsus?.enabled===true&&!!settings.managedENTLapsus?.keyHash,paused:!automationAllowed(settings,'ent',at)})}
    ].map(row=>({...row,label:row.state==='operational'?({portal:'Joignable',calendars:'Génération vérifiée',ent:'Moteur actif',managed:'Connecteur actif'}[row.id]||'Traitement actif'):labels[row.state]}));
    // Keep only public, generic transitions, bounded to this process lifetime.
    for(const row of components){
      const old=this.previous.get(row.id);
      if(old&&old!==row.state)this.events.unshift({at,component:row.name,state:row.state,label:row.label});
      this.previous.set(row.id,row.state);
    }
    this.events=this.events.slice(0,24);
    const states=components.map(row=>row.state);
    const state=maintenance.enabled?'maintenance':states.some(value=>['unavailable','degraded','paused'].includes(value))?'degraded':states.includes('unknown')?'unknown':'operational';
    return {schemaVersion:1,version:this.version,checkedAt:at,monitoringSince:this.startedAt,refreshAfterSeconds:30,state,
      title:{operational:'Les services suivis fonctionnent',degraded:'Certains services demandent une vérification',unknown:'Certaines vérifications sont en attente',maintenance:'Une maintenance est en cours'}[state],
      maintenance:maintenance.enabled?{enabled:true,until:maintenance.until}: {enabled:false,until:null},components,events:this.events.map(row=>({...row})),
      scope:'Ce suivi vérifie Passerelle. Les connexions de chaque compte, les établissements, la réception des notifications et les agendas externes ont leur propre état.'};
  }
}
export function installSystemStatusRoutes(router,{store,mailer,push,clock,version,rateLimit}){
  const status=new SystemStatus({settings:()=>store.state.settings,mailReady:()=>mailer.ready,pushReady:()=>push.ready,clock,version});
  router.get('/api/system-status',(req,res)=>{rateLimit(req,'system-status',120,60000);res.set('Cache-Control','no-store');res.json(status.snapshot());});
  return status;
}
