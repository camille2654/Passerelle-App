/* Public status measurements only. No account data, storage or external library. */
(function(root){
 'use strict';
 const IDS=['portal','ent','calendars','mail','push','managed'],STATES=['operational','degraded','paused','disabled','unknown','unavailable'],OVERALL=['operational','degraded','unknown','maintenance','unavailable'];
 const stamp=value=>Number.isFinite(value)&&value>0;
 function normalize(data){
  if(data?.schemaVersion!==1||data.intervalSeconds!==60||data.retentionHours!==24||!stamp(data.startedAt)||!stamp(data.generatedAt)||data.startedAt>data.generatedAt||!Array.isArray(data.samples)||data.samples.length>2880)return null;
  let prior=0;const samples=[];
  for(const row of data.samples){
   if(!stamp(row?.at)||row.at<=prior||row.at>data.generatedAt||!OVERALL.includes(row.state)||!(row.responseMs===null||Number.isFinite(row.responseMs)&&row.responseMs>=0&&row.responseMs<=10000)||!row.components||IDS.some(id=>!STATES.includes(row.components[id])))return null;
   prior=row.at;samples.push({at:row.at,responseMs:row.responseMs,state:row.state,components:Object.fromEntries(IDS.map(id=>[id,row.components[id]]))});
  }
  return {schemaVersion:1,intervalSeconds:60,retentionHours:24,startedAt:data.startedAt,generatedAt:data.generatedAt,samples};
 }
 function stats(samples){const times=samples.map(row=>row.responseMs).filter(value=>value!==null).sort((a,b)=>a-b),middle=Math.floor(times.length/2);return {count:samples.length,healthy:samples.filter(row=>row.state==='operational').length,validResponses:times.length,last:samples.at(-1)?.responseMs??null,median:times.length?(times.length%2?times[middle]:(times[middle-1]+times[middle])/2):null};}
 function segments(samples,{start,end,gap=90000}){const groups=[];let current=[],previous=null;for(const row of samples){if(row.at<start||row.at>end)continue;if(row.responseMs===null||previous!==null&&row.at-previous>gap){if(current.length)groups.push(current);current=[];}if(row.responseMs!==null)current.push(row);previous=row.at;}if(current.length)groups.push(current);return groups;}
 function runs(samples,id,{start,end,cadence=60000}){const result=[];for(let index=0;index<samples.length;index++){const row=samples[index];if(row.at<start||row.at>end)continue;const next=samples[index+1],to=Math.min(end,next&&next.at-row.at<=cadence*1.5?next.at:row.at+cadence);if(to<=row.at)continue;const state=row.components[id],last=result.at(-1);if(last&&last.state===state&&last.to===row.at)last.to=to;else result.push({from:row.at,to,state});}return result;}
 root.PasserelleStatusMath={normalize,stats,segments,runs};
 if(typeof document==='undefined')return;
 const $=selector=>document.querySelector(selector),NS='http://www.w3.org/2000/svg',names={portal:'Portail et API',ent:'Synchronisation',calendars:'Agendas ICS',mail:'Mails',push:'Notifications',managed:'Lapsus'},labels={operational:'Opérationnel',degraded:'À vérifier',paused:'En pause',disabled:'Non activé',unknown:'Non vérifié',unavailable:'Indisponible',maintenance:'Maintenance'};
 const time=value=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit'}).format(new Date(value)),date=value=>new Intl.DateTimeFormat('fr-FR',{timeZone:'Europe/Paris',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(new Date(value)),format=value=>value===null?'—':new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(value)+' ms';
 const text=(selector,value)=>{const node=$(selector);if(node&&node.textContent!==value)node.textContent=value;};
 const el=(tag,cls,value)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(value!==undefined)node.textContent=value;return node;};
 const svg=(tag,attrs={})=>{const node=document.createElementNS(NS,tag);for(const [name,value]of Object.entries(attrs))node.setAttribute(name,String(value));return node;};
 let data=null,hours=1,pending=false,failed=false,receivedAt=null,serverReference=null,serverReceivedAt=0,selectedAt=null,currentComponent='portal';
 const now=()=>serverReference===null?Date.now():serverReference+performance.now()-serverReceivedAt;
 function setServerTime(value){if(stamp(value)){serverReference=serverReference===null?value:Math.max(value,now());serverReceivedAt=performance.now();}}
 const windowData=()=>{const end=now(),start=end-hours*3600000;return {start,end,rows:(data?.samples||[]).filter(row=>row.at>=start&&row.at<=end)};};
 function axes(window){for(const node of document.querySelectorAll('[data-chart-start]'))node.textContent=time(window.start);for(const node of document.querySelectorAll('[data-chart-end]'))node.textContent=time(window.end);}
 function select(row,id=currentComponent){
  if(!row)return;selectedAt=row.at;currentComponent=id;
  text('#latency-readout',date(row.at)+' · '+(row.responseMs===null?'Aucune réponse valide':format(row.responseMs))+' · '+labels[row.state]);
  text('#timeline-readout',date(row.at)+' · '+names[id]+' : '+labels[row.components[id]]);
  const window=windowData(),x=(row.at-window.start)*800/(window.end-window.start);
  for(const line of document.querySelectorAll('[data-chart-cursor]')){line.setAttribute('x1',x);line.setAttribute('x2',x);line.hidden=false;line.removeAttribute('hidden');}
 }
 function latency(window){
  const node=$('#latency-plot'),groups=segments(window.rows,window),times=window.rows.map(row=>row.responseMs).filter(value=>value!==null),largest=times.length?Math.max(...times):0,scale=Math.max(10,Math.ceil(largest/(largest>100?100:10))*(largest>100?100:10));
  node.replaceChildren();for(const y of [5,95,185])node.append(svg('line',{x1:0,x2:800,y1:y,y2:y,class:'chart-grid-line'}));
  text('#latency-max',format(scale));text('#latency-mid',format(scale/2));
  const x=row=>(row.at-window.start)*800/(window.end-window.start),y=row=>185-row.responseMs*180/scale;
  for(const rows of groups){
   if(rows.length>1)node.append(svg('polyline',{points:rows.map(row=>x(row)+','+y(row)).join(' '),class:'response-line','vector-effect':'non-scaling-stroke'}));
   if(rows.length<=30)for(const row of rows)node.append(svg('circle',{cx:x(row),cy:y(row),r:3,class:'response-dot','vector-effect':'non-scaling-stroke'}));
  }
  node.append(svg('line',{x1:0,x2:0,y1:0,y2:190,class:'chart-cursor','data-chart-cursor':'',hidden:''}));
  const empty=$('#latency-empty');empty.hidden=times.length>0;empty.textContent=window.rows.length?'Aucune réponse valide sur cette période.':'Les premières mesures apparaîtront ici.';
 }
 function timeline(window){
  const root=$('#service-timeline');root.replaceChildren();
  for(const id of IDS){
   const row=el('div','timeline-row'),label=el('span','timeline-name',names[id]),plot=svg('svg',{viewBox:'0 0 800 18',preserveAspectRatio:'none','aria-hidden':'true'});
   row.dataset.timeline=id;row.tabIndex=0;row.setAttribute('role','group');row.setAttribute('aria-label',names[id]+'. Touchez un créneau ou utilisez les flèches pour consulter une mesure.');
   plot.append(svg('rect',{x:0,y:0,width:800,height:18,rx:3,class:'state-unknown'}));
   for(const run of runs(data?.samples||[],id,window))plot.append(svg('rect',{x:(run.from-window.start)*800/(window.end-window.start),y:0,width:(run.to-run.from)*800/(window.end-window.start),height:18,class:'state-'+run.state}));
   plot.append(svg('line',{x1:0,x2:0,y1:0,y2:18,class:'chart-cursor','data-chart-cursor':'',hidden:''}));row.append(label,plot);root.append(row);
  }
 }
 function table(rows){const body=$('#measurements-body');body.replaceChildren();for(const row of rows.slice(-60).reverse()){const tr=el('tr');tr.append(el('td','',date(row.at)),el('td','',labels[row.state]),el('td','',format(row.responseMs)));body.append(tr);}text('#table-count',rows.length>60?'Les 60 dernières mesures de la période.':rows.length+' mesure'+(rows.length>1?'s':'')+' sur cette période.');}
 function render(){
  const window=windowData(),summary=stats(window.rows),age=data?Math.max(0,now()-data.generatedAt):null,stale=failed||age!==null&&age>150000;
  $('#status-charts').dataset.stale=String(stale);
  text('#metric-last',stale?'—':format(summary.last));text('#metric-last-note',stale?'Mesures non actualisées':window.rows.length?'Contrôle du '+time(window.rows.at(-1).at):'En attente du premier contrôle');
  text('#metric-median',format(summary.median));text('#metric-median-note',summary.validResponses+' réponse'+(summary.validResponses>1?'s':'')+' valide'+(summary.validResponses>1?'s':''));
  text('#metric-green',summary.healthy+' / '+summary.count);text('#metric-count',String(summary.count));
  text('#charts-freshness',data?(stale?'Suivi non actualisé · dernier enregistrement : ':'Dernier enregistrement : ')+date(data.generatedAt):failed?'Le suivi des mesures est momentanément indisponible.':'Les premières mesures sont en cours de collecte.');
  text('#charts-since',data?'Données conservées sur 24 h · suivi démarré le '+date(data.startedAt)+'.':'Un contrôle par minute. Les périodes sans mesure restent grises.');
  axes(window);latency(window);timeline(window);table(window.rows);
  const selected=window.rows.find(row=>row.at===selectedAt)||window.rows.at(-1);
  if(selected)select(selected);else{text('#latency-readout','Aucune mesure à sélectionner sur cette période.');text('#timeline-readout','Gris : aucun contrôle reçu sur ce créneau.');}
 }
 function choose(event){
  const row=event.target.closest('[data-timeline]'),plot=row?.querySelector('svg')||event.target.closest('#latency-plot');if(!plot)return;
  const window=windowData();if(!window.rows.length)return;
  const box=plot.getBoundingClientRect(),target=window.start+Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*(window.end-window.start);
  const point=window.rows.reduce((best,item)=>Math.abs(item.at-target)<Math.abs(best.at-target)?item:best,window.rows[0]);if(Math.abs(point.at-target)>90000){selectedAt=null;text('#latency-readout',date(target)+' · Aucun contrôle reçu autour de cet instant.');text('#timeline-readout','Période sans mesure : aucun état n’est déduit.');for(const line of document.querySelectorAll('[data-chart-cursor]')){const x=(target-window.start)*800/(window.end-window.start);line.setAttribute('x1',x);line.setAttribute('x2',x);line.removeAttribute('hidden');}}else select(point,row?.dataset.timeline||currentComponent);
 }
 document.addEventListener('pointerup',event=>{if(event.target.closest('#latency-plot,[data-timeline] svg'))choose(event);});
 document.addEventListener('keydown',event=>{
  const plot=event.target.closest('#latency-chart,[data-timeline]');if(!plot||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const rows=windowData().rows;if(!rows.length)return;event.preventDefault();let index=rows.findIndex(row=>row.at===selectedAt);if(index<0)index=rows.length-1;
  index=event.key==='Home'?0:event.key==='End'?rows.length-1:Math.max(0,Math.min(rows.length-1,index+(event.key==='ArrowLeft'?-1:1)));select(rows[index],plot.dataset.timeline||currentComponent);
 });
 document.addEventListener('click',event=>{const button=event.target.closest('[data-chart-hours]');if(!button)return;const selected=Number(button.dataset.chartHours);if(![1,6,24].includes(selected))return;hours=selected;for(const item of document.querySelectorAll('[data-chart-hours]'))item.setAttribute('aria-pressed',String(item===button));render();});
 async function refresh(){
  if(pending||document.hidden)return;pending=true;$('#status-charts').setAttribute('aria-busy','true');
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetch(new URL('./history.json',location.href),{credentials:'omit',cache:'no-store',redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('HISTORY_UNAVAILABLE');const body=await response.text();if(body.length>2097152)throw new Error('HISTORY_TOO_LARGE');const next=normalize(JSON.parse(body));if(!next)throw new Error('HISTORY_INVALID');
   const headerTime=Date.parse(response.headers.get('date'));if(Number.isFinite(headerTime))setServerTime(Math.max(headerTime,next.generatedAt));data=next;receivedAt=performance.now();failed=false;
  }catch{failed=true;}
  finally{clearTimeout(timeout);pending=false;render();$('#status-charts').setAttribute('aria-busy','false');}
 }
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){if(receivedAt!==null&&performance.now()-receivedAt>90000){failed=true;render();}void refresh();}});
 setInterval(()=>{if(document.hidden)return;if(receivedAt!==null&&performance.now()-receivedAt>90000){failed=true;render();}void refresh();},30000);
 root.PasserelleStatusCharts={refresh,setServerTime};render();void refresh();
})(globalThis);
