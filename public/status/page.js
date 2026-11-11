(()=>{
  'use strict';
  const $=selector=>document.querySelector(selector),endpoint=new URL('../api/system-status',location.href);
  const definitions=[['portal','Portail et API','home'],['ent','Synchronisation des cours','sync'],['calendars','Agendas ICS','calendar'],['mail','Notifications par mail','mail'],['push','Notifications de l’app','bell'],['managed','Connecteur Lapsus','sources']];
  const labels={operational:'Opérationnel',degraded:'À vérifier',paused:'En pause',disabled:'Non activé',unknown:'Non vérifié',unavailable:'Indisponible'};
  const date=value=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value));
  const text=(selector,value)=>{const node=$(selector);if(node.textContent!==value)node.textContent=value;};
  let pending=false,last=null,receivedAt=null,currentState='unknown';
  const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),use=document.createElementNS(svg.namespaceURI,'use');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');use.setAttribute('href','./icons.svg#i-'+name);svg.append(use);return svg;};
  const element=(tag,className,value)=>{const node=document.createElement(tag);if(className)node.className=className;if(value!==undefined)node.textContent=value;return node;};
  function announce(state,message){if(state!==currentState){currentState=state;text('#announcement',message);}}
  function cards(rows){
    const expanded=new Set([...document.querySelectorAll('.component-details[open]')].map(node=>node.dataset.component));
    const fragment=document.createDocumentFragment();
    for(const [id,name,symbol] of definitions){
      const row=rows.find(item=>item.id===id)||{state:'unknown',description:'Aucune observation reçue pour ce service.',observedAt:null};
      const item=element('li','component');item.dataset.state=row.state;
      const mark=element('span','component-icon');mark.append(icon(symbol));
      const body=element('div'),heading=element('div','component-heading');heading.append(element('h3','',name),element('span','badge',row.state==='operational'?({portal:'Joignable',calendars:'Génération vérifiée',ent:'Moteur actif',managed:'Connecteur actif'}[id]||'Traitement actif'):labels[row.state]));
      const details=element('details','component-details');details.dataset.component=id;details.open=expanded.has(id);details.append(element('summary','','Détails'),element('p','',row.description));
      if(row.observedAt)details.append(element('small','','Signal reçu le '+date(row.observedAt)));
      body.append(heading,details);
      item.append(mark,body);fragment.append(item);
    }
    $('#components').replaceChildren(fragment);$('#components').setAttribute('aria-busy','false');
  }
  function unavailable(detail){
    const title=navigator.onLine===false?'Votre appareil semble hors ligne':'Impossible de joindre Passerelle';
    $('#summary').dataset.state='unavailable';$('#summary-symbol').setAttribute('href','./icons.svg#i-activity');
    text('#status-title',title);text('#status-detail',detail);text('#live-label','Vérification impossible');text('#services-caption','État actuel non confirmé');
    text('#checked-at',last?'Dernier contrôle réussi : '+date(last.checkedAt):'Aucun contrôle réussi pour le moment.');
    $('#maintenance').hidden=true;
    cards(definitions.map(([id])=>({id,state:id==='portal'?'unavailable':'unknown',description:id==='portal'?'La vérification ne reçoit pas de réponse exploitable.':'Le service ne peut pas être vérifié pour le moment.',observedAt:null})));
    announce('unavailable',title);
  }
  function show(data){
    rootCharts()?.setServerTime(data.checkedAt);
    $('#summary').dataset.state=data.state;$('#summary-symbol').setAttribute('href','./icons.svg#i-'+(data.state==='operational'?'check':data.state==='maintenance'?'settings':'activity'));
    text('#status-title',data.title);text('#live-label',data.state==='operational'?'Vérifié maintenant':data.state==='maintenance'?'Maintenance':'Suivi en cours');
    text('#status-detail',data.state==='operational'?'Le portail et les automatismes suivis répondent aux vérifications.':data.state==='maintenance'?'Certains automatismes sont temporairement suspendus.':'Consultez les services ci-dessous pour connaître leur état.');
    text('#checked-at','Dernier contrôle : '+date(data.checkedAt));text('#services-caption','État observé par Passerelle');text('#version','Version '+data.version);text('#scope',data.scope);
    $('#maintenance').hidden=!data.maintenance.enabled;
    if(data.maintenance.enabled)text('#maintenance-detail','Fin prévue le '+date(data.maintenance.until)+'. Les agendas déjà récupérés restent consultables.');
    cards(data.components);text('#monitoring-since','Observations depuis le '+date(data.monitoringSince)+'.');
    const events=document.createDocumentFragment();for(const row of data.events){const li=element('li'),time=element('time','',date(row.at));time.dateTime=new Date(row.at).toISOString();li.append(element('span','',row.component+' · '+labels[row.state]),time);events.append(li);}
    $('#events').replaceChildren(events);$('#history-empty').hidden=data.events.length>0;
    text('#history-empty','Aucun changement d’état observé depuis le début de ce suivi.');announce(data.state,data.title);
  }
  function valid(data){
    const stamp=value=>Number.isFinite(value)&&value>0,allowed=state=>Object.hasOwn(labels,state);
    return data?.schemaVersion===1&&['operational','degraded','unknown','maintenance'].includes(data.state)&&typeof data.title==='string'&&typeof data.scope==='string'&&typeof data.version==='string'&&stamp(data.checkedAt)&&stamp(data.monitoringSince)&&typeof data.maintenance?.enabled==='boolean'&&(!data.maintenance.enabled||stamp(data.maintenance.until))&&Array.isArray(data.components)&&data.components.length===definitions.length&&definitions.every(([id])=>data.components.filter(row=>row.id===id&&allowed(row.state)&&typeof row.description==='string'&&(row.observedAt===null||stamp(row.observedAt))).length===1)&&Array.isArray(data.events)&&data.events.length<=24&&data.events.every(row=>stamp(row.at)&&allowed(row.state)&&typeof row.component==='string');
  }
  async function check(){
    if(pending||document.hidden)return;pending=true;$('#refresh').disabled=true;$('#refresh').setAttribute('aria-busy','true');
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(endpoint,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('STATUS_UNAVAILABLE');
      const body=await response.text();if(body.length>65536)throw new Error('STATUS_INVALID');const data=JSON.parse(body);if(!valid(data))throw new Error('STATUS_INVALID');
      last=data;receivedAt=performance.now();show(data);
    }catch{unavailable(navigator.onLine===false?'Reconnectez votre appareil pour connaître l’état actuel du service.':'Réessayez dans quelques instants. Les états précédents ne sont pas présentés comme actuels.');}
    finally{clearTimeout(timeout);pending=false;$('#refresh').disabled=false;$('#refresh').removeAttribute('aria-busy');}
  }
  function theme(value){const dark=value==='dark'||value!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches;document.documentElement.dataset.theme=dark?'dark':'light';$('#theme').setAttribute('aria-pressed',String(dark));$('#theme').setAttribute('aria-label',dark?'Activer le thème clair':'Activer le thème sombre');}
  let preference='system';try{preference=localStorage.getItem('passerelle.theme')||'system';}catch{}theme(preference);
  $('#theme').addEventListener('click',()=>{preference=document.documentElement.dataset.theme==='dark'?'light':'dark';theme(preference);try{localStorage.setItem('passerelle.theme',preference);}catch{}});
  matchMedia('(prefers-color-scheme:dark)').addEventListener('change',()=>theme(preference));
  const rootCharts=()=>globalThis.PasserelleStatusCharts;
  $('#refresh').addEventListener('click',()=>{void check();void rootCharts()?.refresh();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(receivedAt!==null&&performance.now()-receivedAt>75000)unavailable('La dernière observation est ancienne. Une nouvelle vérification est en cours.');void check();}});
  window.addEventListener('offline',()=>unavailable('Reconnectez votre appareil pour connaître l’état actuel du service.'));
  window.addEventListener('online',()=>void check());
  setInterval(()=>{if(document.hidden)return;if(receivedAt!==null&&performance.now()-receivedAt>75000)unavailable('La dernière observation est ancienne. Une nouvelle vérification est en cours.');void check();},30000);
  cards([]);void check();
})();
