/* Agenda presentation only: no source requests or changes to school data. */
(function(root){
  'use strict';
  const ZONE='Europe/Paris';
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const icon=name=>`<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const dateLabel=(date,options)=>new Intl.DateTimeFormat('fr-FR',{timeZone:ZONE,...options}).format(new Date(date+'T12:00:00Z'));
  const clock=minute=>String(Math.floor(minute/60)).padStart(2,'0')+':'+String(Math.floor(minute%60)).padStart(2,'0');
  function instant(value){if(!value||!Number.isFinite(Date.parse(value)))return null;const p=Object.fromEntries(parts.formatToParts(new Date(value)).map(item=>[item.type,item.value]));return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};}
  function period(start,end){if(!start||!end)return 'Votre semaine';const year=start.slice(0,4)!==end.slice(0,4);return dateLabel(start,{day:'numeric',...(start.slice(0,7)===end.slice(0,7)?{}:{month:'short'}),...(year?{year:'numeric'}:{})})+' – '+dateLabel(end,{day:'numeric',month:'long',year:'numeric'});}
  function entries(day){
    const rows=[...(day.courses||[]).map(raw=>({kind:'course',raw})),...(day.personalEvents||[]).map(raw=>({kind:'personal',raw})),...(day.events||[]).filter(raw=>!raw.cancelled).map(raw=>({kind:'event',raw})),...(day.travelEvents||[]).map(raw=>({kind:'travel',raw}))];
    return rows.map(row=>{
      const {raw}=row,start=instant(raw.start),end=instant(raw.end),valid=!!start&&!!end&&Date.parse(raw.end)>Date.parse(raw.start);
      const from=start?(start.date<day.date?0:start.date>day.date?1440:start.minute):0,to=end?(end.date>day.date?1440:end.date<day.date?0:end.minute):0;
      const overlapsDate=valid&&start.date<=day.date&&(end.date>day.date||end.date===day.date&&end.minute>0);
      // A repeated clock hour cannot be represented by a simple hourly column.
      // Keep that appointment in the notes and day view instead of dropping it.
      const ambiguous=overlapsDate&&to<=from;
      return {...row,date:day.date,title:raw.title||(row.kind==='course'?'Cours':'Rendez-vous'),allDay:raw.allDay===true,valid,from,to,ambiguous,overlapsDate,timed:valid&&raw.allDay!==true&&to>from};
    }).filter(row=>row.allDay||!row.valid||row.overlapsDate).sort((a,b)=>Number(b.allDay)-Number(a.allDay)||a.from-b.from||a.to-b.to);
  }
  function range(days){const rows=days.flatMap(entries).filter(row=>row.timed);if(!rows.length)return {start:480,end:1020,height:0};const start=Math.max(0,Math.floor(Math.min(...rows.map(row=>row.from))/60)*60),end=Math.min(1440,Math.max(start+240,Math.ceil(Math.max(...rows.map(row=>row.to))/60)*60));return {start,end,height:end-start};}
  function groupCourses(rows,changes=[]){
    const decorated=rows.map(row=>({...row,members:[row.raw],changes:changes.filter(change=>change.entity==='course'&&change.eventId===row.raw.id).sort((a,b)=>(b.seq||b.at)-(a.seq||a.at))}));
    const removed=new Set();
    for(let index=0;index<decorated.length;index++){
      const row=decorated[index];if(removed.has(row)||row.kind!=='course'||!row.timed||row.raw.cancelled||row.changes.length)continue;
      for(let next=index+1;next<decorated.length;next++){
        const other=decorated[next];if(other.kind!=='course'||!other.timed||other.raw.cancelled||other.changes.length||removed.has(other))continue;
        const same=row.title===other.title&&(row.raw.location||'')===(other.raw.location||'')&&JSON.stringify(row.raw.subject||{})===JSON.stringify(other.raw.subject||{});
        if(!same||Date.parse(row.raw.end)!==Date.parse(other.raw.start))continue;
        row.raw={...row.raw,end:other.raw.end};row.to=other.to;row.members.push(...other.members);removed.add(other);
      }
    }
    return decorated.filter(row=>!removed.has(row));
  }
  function changeInfo(row){
    const change=row.changes?.[0];if(!change)return '';
    const room=change.type==='updated'&&change.before?.location!==change.after?.location;
    const hours=change.type==='updated'&&['start','end'].some(key=>change.before?.[key]!==change.after?.[key]);
    const label={added:'Nouveau cours',cancelled:'Cours annulé',restored:'Cours rétabli'}[change.type]||(room&&hours?'Salle et horaire modifiés':room?'Salle modifiée':hours?'Horaire modifié':'Cours modifié');
    const oldRoom=room&&change.before?.location?`<del>${esc(change.before.location)}</del> → `:'';
    const old=hours&&instant(change.before?.start)?`${instant(change.before.start).date!==row.date?dateLabel(instant(change.before.start).date,{day:'numeric',month:'short'})+' · ':''}${clock(instant(change.before.start).minute)}${instant(change.before.end)?'–'+clock(instant(change.before.end).minute):''}`:'';
    return `<span class="agenda-course-change">${icon('sync')}<span><strong>${label}</strong>${oldRoom?`<span>${oldRoom}${esc(row.raw.location||'Salle non précisée')}</span>`:''}${old?`<span>Avant : <del>${esc(old)}</del></span>`:''}</span></span>`;
  }
  function layout(rows,window){
    const sorted=rows.filter(row=>row.timed).map(row=>({...row,from:Math.max(window.start,row.from),to:Math.min(window.end,row.to)})).filter(row=>row.to>row.from).sort((a,b)=>a.from-b.from||a.to-b.to);
    const groups=[];let group=[],until=-1;
    for(const row of sorted){if(group.length&&row.from>=until){groups.push(group);group=[];until=-1;}group.push(row);until=Math.max(until,row.to);}if(group.length)groups.push(group);
    return groups.flatMap(items=>{const lanes=[];for(const row of items){let lane=lanes.findIndex(end=>end<=row.from);if(lane<0)lane=lanes.length;lanes[lane]=row.to;row.lane=lane;}return items.map(row=>({...row,lanes:lanes.length,top:row.from-window.start,height:row.to-row.from}));});
  }
  function metadata(row){const {raw,kind}=row;if(kind==='course')return raw.location||'Salle non précisée';if(kind==='personal')return 'Personnel · '+(raw.calendarTitle||'Mon calendrier');if(kind==='travel')return raw.needsReview?'Horaires à revoir':'Temps de transport';return raw.location||'Événement du lycée';}
  const duration=minutes=>minutes<60?minutes+' min':Math.floor(minutes/60)+' h'+(minutes%60?' '+String(minutes%60).padStart(2,'0'):'');
  function mergeImpact(previous,incoming){
    if(!previous)return incoming;
    if(!incoming)return previous;
    if(!previous.complete||!incoming.complete)return {complete:false,days:[]};
    const days=new Map((previous.days||[]).map(day=>[day.date,day]));
    for(const day of incoming.days||[]){const old=days.get(day.date);days.set(day.date,old?{...day,before:old.before,complete:old.complete&&day.complete}:day);}
    return {complete:true,days:[...days.values()].sort((a,b)=>a.date.localeCompare(b.date))};
  }
  function impactRows(view,today){
    if(!view?.complete)return [];
    const rows=[];
    const tomorrow=new Date(today+'T12:00:00Z');tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
    const nextDate=tomorrow.toISOString().slice(0,10);
    for(const day of view.days||[]){
      if(!day.complete||day.date<today)continue;
      const prefix=day.date===today?'Aujourd’hui':day.date===nextDate?'Demain':'Le '+dateLabel(day.date,{weekday:'long',day:'numeric',month:'long'}),before=day.before,after=day.after;
      if(before&&!after){rows.push({date:day.date,title:prefix+', aucun cours prévu',detail:'Les cours auparavant prévus ne figurent plus dans les cours actifs.'});continue;}
      if(!before&&after){rows.push({date:day.date,title:prefix+', des cours à partir de '+clock(after.start),detail:'Fin des cours à '+clock(after.end)+'.'});continue;}
      if(!before||!after)continue;
      for(const [key,verb]of [['start','commencez'],['end','finissez']]){
        const delta=after[key]-before[key];if(!delta)continue;
        rows.push({date:day.date,title:prefix+', vous '+verb+' à '+clock(after[key]),detail:duration(Math.abs(delta))+' plus '+(delta>0?'tard':'tôt')+' · auparavant '+clock(before[key])});
      }
    }
    return rows;
  }
  function impactHTML(view,dates,today){
    const rows=impactRows(view,today).filter(row=>dates.includes(row.date));if(!rows.length)return '';
    const content=`<ul>${rows.map(row=>`<li>${icon('clock')}<span><strong>${esc(row.title)}</strong><small>${esc(row.detail)}</small></span></li>`).join('')}</ul>`;
    return rows.length>3?`<details class="agenda-impacts"><summary>${rows.length} changements d’horaires à retenir</summary>${content}</details>`:`<aside class="agenda-impacts" aria-label="Conséquences des changements d’emploi du temps"><p>Depuis votre dernière consultation</p>${content}</aside>`;
  }
  function courseLabel(row){
    const emoji=row.raw.subject?.emoji||'',title=(emoji&&row.title.startsWith(emoji)?row.title.slice(emoji.length):row.title).replace(/^[\s\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D]+/u,'').trim()||'Cours';
    // ENT titles often arrive in capitals. Only their displayed label changes.
    if(title!==title.toLocaleUpperCase('fr-FR')||title===title.toLocaleLowerCase('fr-FR'))return title;
    const key=title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const names={'mathematiques':'Mathématiques','francais':'Français','histoire geographie':'Histoire-géographie','sc econo sociales':'Sc. écono. & sociales','sciences economiques et sociales':'Sciences économiques et sociales','physique chimie':'Physique-chimie'};
    if(names[key])return names[key];
    const acronyms=new Set(['svt','eps','ses','emc','snt','nsi','lv1','lv2','lv3','llce','hlp','amc','stmg','sti2d','bts','ap']);
    if(!title.includes(' ')&&title.length<=5)return title;
    return title.toLocaleLowerCase('fr-FR').replace(/\b[a-z0-9]+\b/g,word=>acronyms.has(word)?word.toUpperCase():word).replace(/^\p{L}/u,letter=>letter.toLocaleUpperCase('fr-FR'));
  }
  // Decorative subject marks use the existing Passerelle outlines. These four
  // additional drawings share the same 24px grid, rounded strokes and currentColor.
  const subjectDrawings={
    biology:'<path d="M20 4c-8-1-15 2-15 9a6 6 0 0 0 7 6c6-1 8-8 8-15ZM4 21 16 9m-7 7v-4m3 1h4"/>',
    music:'<path d="M9 18V6l11-2v12M9 9l11-2"/><ellipse cx="6.5" cy="18" rx="2.5" ry="2"/><ellipse cx="17.5" cy="16" rx="2.5" ry="2"/>',
    philosophy:'<path d="M5 4h12a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-7l-6 4v-5a4 4 0 0 1-2-3V8a4 4 0 0 1 3-4Z"/><circle cx="8" cy="10.5" r=".75" fill="currentColor" stroke="none"/><circle cx="12" cy="10.5" r=".75" fill="currentColor" stroke="none"/><circle cx="16" cy="10.5" r=".75" fill="currentColor" stroke="none"/>',
    technology:'<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4m4-4v4m-4 10v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4M10 10h4v4h-4Z"/>'
  };
  const subjectRules=[
    [/math/,'math'],[/sport|\beps\b|education physique/,'sport'],
    [/histoire|geograph|\bhg\b|\bhggsp\b|enseignement moral|\bemc\b/,'globe'],
    [/francais|litterature|\bfr\b|\bhlp\b/,'book'],
    [/langue|anglais|english|\bangl?\b|espagn|\besp\b|allemand|\ball\b|italien|latin|grec|chinois|arabe|portug|russe|japon|\blv[123]\b|\bllce\b|\bamc\b/,'languages'],
    [/econom|econo|\bses\b|gestion|management|mercatique|\bstmg\b/,'activity'],
    [/\bsvt\b|vie.*terre|biolog/,'biology'],
    [/informati|numerique|\bsnt\b|\bnsi\b/,'terminal'],
    [/philosoph/,'philosophy'],[/musiqu|musical/,'music'],
    [/\barts?\b|plastique|dessin|design/,'art'],
    [/technolog|ingenieur|\bsti2d\b/,'technology'],[/physique|chimie|science/,'science']
  ];
  function subjectIcon(row){
    const label=String(row.raw.subject?.label||courseLabel(row)).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ');
    const name=subjectRules.find(([pattern])=>pattern.test(label))?.[1]||'book';
    return `<svg class="icon agenda-subject-icon" data-subject-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${subjectDrawings[name]||'<use href="#i-'+name+'"/>'}</svg>`;
  }
  function eventCard(row,{grid=false,daily=false}={}){
    const {raw,kind}=row,symbol={course:'pin',personal:'lock',travel:'bus',event:'calendar'}[kind],meta=metadata(row),hours=row.allDay?'Journée entière':row.valid?clock(row.from)+'–'+clock(row.to):'Horaire à vérifier';
    const theme=/^[a-z-]+$/.test(raw.subject?.color||'')?raw.subject.color:'royalblue';
    const classes=['agenda-entry',kind==='course'?'week-course theme-'+theme:kind==='personal'?'week-personal-event':kind==='travel'?'week-travel-event':'week-lycee-event',grid?'agenda-grid-entry':'',daily?'agenda-list-entry':'',raw.cancelled?'is-cancelled':'',raw.conflict?'has-conflict':'',raw.needsReview?'needs-review':'',grid&&row.height<48?'agenda-short':'',grid&&row.height<40?'agenda-tiny':'',grid&&row.height>=48&&row.height<80?'agenda-hour':'',row.allDay?'agenda-entire-day':''].filter(Boolean).join(' ');
    const tag=kind==='course'&&!raw.id?'article':'button',action=kind==='course'&&raw.id?' data-agenda-course="'+esc(raw.id)+'" data-course-date="'+esc(row.date)+'"':kind==='personal'?' data-personal-calendar="open"':kind==='travel'?' data-smart-travel="open" data-smart-travel-date="'+esc(row.date)+'"':kind==='event'?' data-events="open"':'';
    const placed=grid?` data-agenda-placement data-top="${row.top}" data-height="${row.height}" data-lane="${row.lane}" data-lanes="${row.lanes}"`:'';
    const status=raw.cancelled?'Annulé':row.ambiguous?'Changement d’heure':raw.conflict?'Chevauchement':raw.needsReview?'À revoir':'';
    const badge=status?`<span class="agenda-entry-status">${status}</span>`:'';
    const length=kind==='course'&&row.timed?duration(Math.round((Date.parse(raw.end)-Date.parse(raw.start))/60000)):'';
    const grouped=row.members?.length>1?`<span class="agenda-entry-sessions">${row.members.length} séances</span>`:'';
    const live=kind==='course'&&row.timed&&!raw.cancelled?` data-course-start="${Date.parse(raw.start)}" data-course-end="${Date.parse(raw.end)}" data-course-title="${esc(courseLabel(row))}" data-course-location="${esc(raw.location||'')}"`:'';
    const liveBadge=live?'<span class="agenda-current-badge" hidden>En cours</span>':'';
    const progress=live?'<span class="agenda-course-progress" aria-hidden="true" hidden><span></span></span>':'';
    const content=daily?`<span class="agenda-entry-glyph" aria-hidden="true">${kind==='course'?subjectIcon(row):icon(symbol)}</span><span class="agenda-entry-body"><strong class="agenda-entry-title">${esc(kind==='course'?courseLabel(row):row.title)}</strong><span class="agenda-entry-meta"><span class="agenda-entry-location">${icon(symbol)}${esc(meta)}</span>${length?`<span class="agenda-entry-duration">${esc(length)}</span>`:''}${grouped}</span>${liveBadge}${badge}${changeInfo(row)}</span>${progress}`:`<time>${esc(hours)}</time><strong${kind==='course'?' class="agenda-grid-title"':''}>${kind==='course'?subjectIcon(row)+'<span>'+esc(courseLabel(row))+'</span>':esc(row.title)}</strong><span class="agenda-entry-meta">${icon(symbol)}${esc(meta)}</span>${badge}${liveBadge}${row.changes?.length?'<span class="agenda-grid-change" title="Changement depuis votre dernière visite">'+icon('sync')+' Modifié</span>':''}${progress}`;
    return `<${tag}${tag==='button'?' type="button"':''} class="${classes}"${action}${placed}${live} title="${esc((kind==='course'?courseLabel(row):row.title)+' · '+hours+' · '+meta+(raw.cancelled?' · Annulé':''))}">${content}</${tag}>`;
  }
  function notes(day){
    const work=day.work||[],study=day.study||[];
    return work.length||study.length?`<div class="agenda-day-notes"><h4>À préparer</h4>${work.map(row=>`<button type="button" class="week-task agenda-note" data-extra="go-work"><span>${icon(row.kind==='exam'?'study':'homework')}${row.kind==='exam'?'Contrôle':'Devoir'}</span><strong>${esc(row.title)}</strong></button>`).join('')}${study.map(row=>`<button type="button" class="week-task study-task agenda-note ${row.done?'is-done':''}" data-extra="open" data-tab="study"><span>${icon('study')}Révisions · ${esc(row.minutes)} min${row.start?' · '+esc((instant(row.start)||{}).minute===undefined?'Horaire à vérifier':clock(instant(row.start).minute)):''}${row.done?' · fait':''}</span><strong>${esc(row.title)}</strong></button>`).join('')}</div>`:'';
  }
  const courseCount=day=>(day.courses||[]).filter(row=>!row.cancelled).length;
  function daySelector(view,selected){return `<div class="agenda-day-selector" role="group" aria-label="Choisir un jour">${view.days.map(day=>`<button type="button" data-extra="agenda-day" data-date="${esc(day.date)}" aria-pressed="${day.date===selected}" aria-label="${esc(dateLabel(day.date,{weekday:'long',day:'numeric',month:'long'})+' · '+courseCount(day)+' cours')}"><span>${esc(dateLabel(day.date,{weekday:'short'}))}</span><strong>${Number(day.date.slice(-2))}</strong></button>`).join('')}</div>`;}
  function dayList(rows){
    let until=null,previous=null;
    return rows.map(row=>{
      let interval='';
      if(row.timed&&!row.raw.cancelled){
        if(until!==null&&row.from-until>=5){
          const length=row.from-until,betweenCourses=previous?.kind==='course'&&row.kind==='course';
          const label=!betweenCourses?'Intervalle':length===15?'Récréation':length>=30&&until>=11*60&&row.from<=14*60?'Pause déjeuner':'Pause';
          interval=`<li class="agenda-interval" aria-label="${label} : ${esc(duration(length))}, ${clock(until)} à ${clock(row.from)}"><span class="agenda-interval-line" aria-hidden="true"></span><p><span>${label}</span><strong>${esc(duration(length))}</strong><small>${clock(until)} – ${clock(row.from)}</small></p></li>`;
        }
        if(until===null||row.to>until){until=row.to;previous=row;}
      }
      return interval+`<li class="agenda-list-item"><div class="agenda-list-hour">${row.timed?`<time>${esc(clock(row.from))}</time><small>${esc(clock(row.to))}</small>`:`<span>${row.allDay?'Journée entière':'À vérifier'}</span>`}</div>${eventCard(row,{daily:true})}</li>`;
    }).join('');
  }
  function daily(view,selected,today,changes){const day=view.days.find(row=>row.date===selected)||view.days[0];if(!day)return '';const rows=groupCourses(entries(day),changes),courses=rows.filter(row=>row.kind==='course'&&!row.raw.cancelled&&row.timed);return `${daySelector(view,day.date)}<section class="agenda-day-view week-day" aria-label="${esc(dateLabel(day.date,{weekday:'long',day:'numeric',month:'long'}))}"><header class="agenda-selected-heading"><h3>Votre journée<span class="sr-only"> du ${esc(dateLabel(day.date,{day:'numeric',month:'long'}))}</span></h3><span class="badge">${courseCount(day)} cours</span></header>${courses.length?`<p class="agenda-day-summary">${icon('clock')}${esc(clock(Math.min(...courses.map(row=>row.from))))} <span aria-hidden="true">—</span> ${esc(clock(Math.max(...courses.map(row=>row.to))))}</p>`:''}<div class="agenda-live-slot" data-agenda-live-slot="${esc(day.date)}" hidden></div>${rows.length?`<ol class="agenda-day-list">${dayList(rows)}</ol>`:`<p class="agenda-empty-day">${icon('calendar')}<strong>${day.inSchoolYear===false?'Hors de cette année scolaire':'Aucun cours publié pour cette journée'}</strong><span>Les devoirs et rendez-vous disponibles restent indiqués ici.</span></p>`}${notes(day)}</section>`;}
  function weekly(view,today,now,changes){
    const window=range(view.days),nowParts=instant(new Date(now).toISOString());
    const hours=Array.from({length:window.height?Math.ceil(window.height/60)+1:0},(_,index)=>window.start+index*60).filter(minute=>minute<=window.end);
    return `<p class="agenda-week-hint">Balayez pour parcourir la semaine. Touchez un jour pour voir le détail.</p><div class="agenda-week-board" role="region" aria-label="Emploi du temps de la semaine" tabindex="0"><div class="week-grid agenda-week-grid"><div class="agenda-hours" aria-hidden="true"><div class="agenda-hours-head">Heure</div><div class="agenda-hour-track" data-agenda-track="${window.height}">${hours.map(minute=>`<span data-agenda-hour="${minute-window.start}">${clock(minute)}</span>`).join('')}</div></div>${view.days.map(day=>{const rows=groupCourses(entries(day),changes),allDay=rows.filter(row=>!row.timed),placed=layout(rows,window);return `<section class="week-day agenda-grid-day ${day.date===today?'is-today':''} ${day.inSchoolYear===false?'outside-year':''}"><header><button type="button" data-extra="agenda-day" data-date="${esc(day.date)}" aria-label="Voir la journée du ${esc(dateLabel(day.date,{weekday:'long',day:'numeric',month:'long'}))}"><span>${esc(dateLabel(day.date,{weekday:'short'}))}</span><strong>${Number(day.date.slice(-2))}</strong><small>${courseCount(day)} cours</small></button></header><div class="agenda-day-track ${window.height?'':'is-empty'}" data-agenda-track="${window.height}">${placed.map(row=>eventCard(row,{grid:true})).join('')}${window.height&&day.date===today&&nowParts?`<div class="agenda-now" data-agenda-now="${nowParts.minute-window.start}" data-agenda-now-date="${day.date}" data-agenda-window-start="${window.start}" data-agenda-window-end="${window.end}" aria-label="Il est ${clock(nowParts.minute)}" ${nowParts.minute<window.start||nowParts.minute>window.end?'hidden':''}><span></span></div>`:''}${!window.height?'<p class="week-empty">Aucun cours publié</p>':''}</div>${allDay.length?`<div class="agenda-all-day"><h4>À noter</h4>${allDay.map(row=>eventCard(row)).join('')}</div>`:''}${notes(day)}</section>`;}).join('')}</div></div>`;
  }
  function render(view,{mode='week',selectedDay,today,changes,now=Date.now()}={}){if(!view?.days?.length)return '<p class="empty-copy">Aucune journée disponible sur cette période.</p>';const selected=view.days.some(day=>day.date===selectedDay)?selectedDay:view.days.some(day=>day.date===today)?today:view.days[0].date;return `<div class="agenda-presentation" data-agenda-mode="${mode==='day'?'day':'week'}">${impactHTML(changes?.scheduleImpact,mode==='day'?[selected]:view.days.map(day=>day.date),today||instant(new Date(now).toISOString()).date)}${mode==='day'?daily(view,selected,today,changes?.items||[]):weekly(view,today,now,changes?.items||[])}</div>`;}
  function refreshLive(root,now=Date.now()){
    const currentTime=instant(new Date(now).toISOString()),currentDate=currentTime.date;
    root.querySelectorAll('[data-agenda-now-date]').forEach(node=>{node.hidden=node.dataset.agendaNowDate!==currentDate||currentTime.minute<Number(node.dataset.agendaWindowStart)||currentTime.minute>Number(node.dataset.agendaWindowEnd);node.dataset.agendaNow=String(currentTime.minute-Number(node.dataset.agendaWindowStart));node.style.top=node.dataset.agendaNow+'px';node.setAttribute('aria-label','Il est '+clock(currentTime.minute));});
    const nodes=[...root.querySelectorAll('[data-course-start]')];
    for(const node of nodes){
      const start=Number(node.dataset.courseStart),end=Number(node.dataset.courseEnd),current=start<=now&&now<end;
      node.classList.toggle('is-current',current);
      const badge=node.querySelector('.agenda-current-badge'),track=node.querySelector('.agenda-course-progress');
      if(badge)badge.hidden=!current;if(track){track.hidden=!current;track.firstElementChild.style.width=Math.max(0,Math.min(100,(now-start)*100/(end-start)))+'%';}
    }
    const slot=root.querySelector('[data-agenda-live-slot]');
    if(slot){
      slot.hidden=slot.dataset.agendaLiveSlot!==currentDate;
      if(!slot.hidden){
        const today=nodes.filter(node=>node.dataset.courseDate===currentDate),current=today.find(node=>Number(node.dataset.courseStart)<=now&&now<Number(node.dataset.courseEnd)),next=today.filter(node=>Number(node.dataset.courseStart)>now).sort((a,b)=>Number(a.dataset.courseStart)-Number(b.dataset.courseStart))[0];
        const label=current?'Encore '+duration(Math.max(1,Math.ceil((Number(current.dataset.courseEnd)-now)/60000))):next?'Prochain cours dans '+duration(Math.max(1,Math.ceil((Number(next.dataset.courseStart)-now)/60000))):'';
        slot.hidden=!label;
        slot.innerHTML=label?`${icon('clock')}<span><strong>${label}</strong>${next?`<small>${esc(next.dataset.courseTitle)} · ${clock(instant(new Date(Number(next.dataset.courseStart)).toISOString()).minute)}${next.dataset.courseLocation?' · '+esc(next.dataset.courseLocation):''}</small>`:''}</span>`:'';
      }
    }
  }
  function place(root){
    refreshLive(root);
    const strip=root.querySelector('.agenda-day-selector'),selected=strip?.querySelector('[aria-pressed=true]');
    if(strip&&selected){const box=strip.getBoundingClientRect(),item=selected.getBoundingClientRect();if(item.left<box.left||item.right>box.right)strip.scrollLeft+=item.left-box.left-(box.width-item.width)/2;}
    root.querySelectorAll('[data-agenda-track]').forEach(node=>{node.style.height=Number(node.dataset.agendaTrack)+'px';});
    root.querySelectorAll('[data-agenda-hour]').forEach(node=>{node.style.top=Number(node.dataset.agendaHour)+'px';});
    root.querySelectorAll('[data-agenda-now]').forEach(node=>{node.style.top=Number(node.dataset.agendaNow)+'px';});
    root.querySelectorAll('[data-agenda-placement]').forEach(node=>{const lanes=Number(node.dataset.lanes),lane=Number(node.dataset.lane),height=Number(node.dataset.height),gap=height<8?0:2;node.style.top=(Number(node.dataset.top)+gap)+'px';node.style.height=Math.max(1,height-gap*2)+'px';node.style.left=`calc(${lane*100/lanes}% + 3px)`;node.style.width=`calc(${100/lanes}% - 6px)`;});
  }
  root.PasserelleAgenda={entries,groupCourses,courseLabel,subjectIcon,range,layout,period,render,place,refreshLive,mergeImpact,impactRows};
})(globalThis);
