import {focusHistoryPatch} from './insights.js';
import {randomUUID} from 'node:crypto';
import {PublicError} from './sync.js';
import {userWork,subjectList,parisDate,shiftDate} from './work.js';
import {subjectFor} from './subjects.js';
import {validDate} from './planner.js';

export const HOME_BLOCKS=['evening','notes','menu','programme'];
export function personalSettings(user){const value=user.personalSettings||{};return {dailyBudget:value.dailyBudget||90,homeOrder:value.homeOrder||HOME_BLOCKS,hiddenBlocks:value.hiddenBlocks||[],vacation:value.vacation||null};}
export function vacationPaused(user,now=new Date()){const v=personalSettings(user).vacation,date=parisDate(now);return !!(v&&date>=v.start&&date<v.end);}
export function returnBrief(user,now=new Date()){
  const v=personalSettings(user).vacation;if(!v||v.end!==parisDate(now))return null;
  const start=shiftDate(v.end,1),end=shiftDate(start,6),work=userWork(user).filter(w=>!w.done);
  return {returning:true,homework:work.filter(w=>w.kind!=='exam'&&w.due>=v.start&&w.due<=end),exams:work.filter(w=>w.kind==='exam'&&w.due>=start&&w.due<=end)};
}
const scope=user=>user.studentId||null;
export function personalSubjects(user){return [...new Map([...subjectList(user),...(user.courseNotes||[]).filter(n=>n.studentId===scope(user)).map(n=>subjectFor({label:n.subjectLabel},undefined,user.subjectStyles))].map(s=>[s.key,s])).values()].sort((a,b)=>a.label.localeCompare(b.label,'fr'));}
export function courseNotes(user,now=Date.now()){
  return (user.courseNotes||[]).filter(n=>n.studentId===scope(user)).map(note=>{const subject=subjectFor({label:note.subjectLabel},undefined,user.subjectStyles);const next=Object.values(user.calendarEvents||{}).filter(e=>!e.cancelled&&Date.parse(e.end)>now&&e.subject?.key===subject.key).sort((a,b)=>a.start.localeCompare(b.start))[0];return {...note,subject,nextCourse:next?{title:next.title,start:next.start,date:next.date,location:next.location}:null};}).sort((a,b)=>Number(a.done)-Number(b.done)||(a.nextCourse?.start||'z').localeCompare(b.nextCourse?.start||'z')||b.createdAt-a.createdAt);
}
export function personalTasks(user,now=Date.now()){
  const today=parisDate(new Date(now)),work=userWork(user).filter(w=>!w.done),sessions=(user.studySessions||[]).filter(s=>!s.done);
  const tasks=work.filter(w=>w.kind!=='exam'||!sessions.some(s=>s.examId===w.id||s.examId===w.pronoteId)).map(item=>{const meta=user.personalTasks?.[item.id]||user.personalTasks?.[item.pronoteId]||{},minutes=meta.minutes||(item.kind==='exam'?45:25);const planned=meta.plannedDate||[today,shiftDate(item.due,-1)].sort().at(-1);return {key:'work:'+item.id,id:item.id,type:'work',title:item.title,details:item.details||'',subject:item.subject,due:item.due,day:planned,minutes,estimated:!meta.minutes,kind:item.kind,overdue:item.due<today};});
  return [...tasks,...sessions.map(s=>({key:'study:'+s.id,id:s.id,type:'study',title:s.title,subject:subjectFor({label:s.subjectLabel},undefined,user.subjectStyles),due:work.find(w=>w.id===s.examId||w.pronoteId===s.examId)?.due||s.day,day:s.day,minutes:s.minutes,estimated:false,kind:'revision',overdue:s.day<today}))].sort((a,b)=>a.due.localeCompare(b.due)||a.day.localeCompare(b.day)||a.title.localeCompare(b.title));
}
export function focusState(user,now=Date.now()){
  const value=user.focusSession;if(!value||value.studentId!==scope(user))return null;
  const remaining=value.state==='running'?Math.max(0,value.endsAt-now):value.remaining;
  return {...value,remaining,state:remaining<=0?'finished':value.state};
}
export function personalView(user,now=Date.now()){
  const today=parisDate(new Date(now)),tomorrow=shiftDate(today,1),tasks=personalTasks(user,now),settings=personalSettings(user),pending=tasks.filter(t=>t.day<=today||t.due<=tomorrow);
  let total=0;const evening=pending.slice(0,100).map(item=>{total+=item.minutes;return {...item,recommended:total<=settings.dailyBudget};});
  const week=Array.from({length:7},(_,i)=>{const date=shiftDate(today,i),items=tasks.filter(t=>t.day===date||i===0&&t.day<today),minutes=items.reduce((sum,t)=>sum+t.minutes,0);return {date,minutes,overBudget:minutes>settings.dailyBudget,estimated:items.some(t=>t.estimated),tasks:items.slice(0,100),deadlines:userWork(user).filter(w=>!w.done&&w.due===date).length};});
  return {date:today,serverNow:now,settings,subjects:personalSubjects(user),notes:courseNotes(user,now),evening:{items:evening,totalMinutes:pending.reduce((sum,t)=>sum+t.minutes,0),count:pending.length,budget:settings.dailyBudget},week,focus:focusState(user,now)};
}
function boundedDate(value,now){const date=validDate(value);if(Math.abs(Date.parse(date)-now)>400*86400000)throw new PublicError('Choisissez une date dans les douze prochains mois.');return date;}
export function saveSettings(user,input,now=Date.now()){
  const settings=personalSettings(user),value={...settings};
  if(input.dailyBudget!==undefined){const minutes=Number(input.dailyBudget);if(!Number.isInteger(minutes)||minutes<15||minutes>360)throw new PublicError('Prévoyez entre 15 et 360 minutes par jour.');value.dailyBudget=minutes;}
  if(input.homeOrder!==undefined){if(!Array.isArray(input.homeOrder)||input.homeOrder.length!==HOME_BLOCKS.length||new Set(input.homeOrder).size!==HOME_BLOCKS.length||input.homeOrder.some(key=>!HOME_BLOCKS.includes(key)))throw new PublicError('L’ordre des blocs est invalide.');value.homeOrder=input.homeOrder;}
  if(input.hiddenBlocks!==undefined){if(!Array.isArray(input.hiddenBlocks)||input.hiddenBlocks.some(key=>!HOME_BLOCKS.includes(key)))throw new PublicError('Choisissez des blocs valides.');value.hiddenBlocks=[...new Set(input.hiddenBlocks)];}
  if(input.vacation!==undefined){if(input.vacation===null)value.vacation=null;else{const start=boundedDate(input.vacation.start,now),end=boundedDate(input.vacation.end,now);if(end<start||Date.parse(end)-Date.parse(start)>120*86400000)throw new PublicError('Choisissez une période de vacances de 120 jours maximum.');value.vacation={start,end};}}
  return value;
}
export function rebalance(user,now=Date.now()){
  const today=parisDate(new Date(now)),end=shiftDate(today,6),budget=personalSettings(user).dailyBudget,meta={...(user.personalTasks||{})},load={};
  for(let day=today;day<=end;day=shiftDate(day,1))load[day]=(user.studySessions||[]).filter(s=>!s.done&&s.day===day).reduce((sum,s)=>sum+s.minutes,0);
  const tasks=personalTasks(user,now).filter(t=>t.type==='work'&&t.due<=shiftDate(end,1));
  for(const task of tasks){const last=task.due>today?[shiftDate(task.due,-1),end].sort()[0]:today,candidates=Object.keys(load).filter(day=>day<=last);const day=candidates.sort((a,b)=>load[a]-load[b]||a.localeCompare(b))[0]||today;meta[task.id]={...(meta[task.id]||{}),plannedDate:day};load[day]+=task.minutes;}
  return {meta,count:tasks.length,overloadedDays:Object.values(load).filter(value=>value>budget).length};
}
export function installPersonalRoutes(router,{auth,store,rateLimit,audit,clock=()=>Date.now()}){
  router.get('/api/personal',auth,(req,res)=>res.json(personalView(req.user,clock())));
  router.post('/api/personal/settings',auth,(req,res)=>{rateLimit(req,'personal-settings',60,3600000);store.update(req.user.id,{personalVersion:clock(),personalSettings:saveSettings(req.user,req.body,clock()),personalVersion:clock()});res.json({ok:true,settings:personalSettings(req.user)});});
  router.post('/api/personal/task',auth,(req,res)=>{
    rateLimit(req,'personal-task',120,3600000);const task=userWork(req.user).find(w=>w.id===req.body.id);if(!task)throw new PublicError('Ce travail n’appartient pas à votre espace.',404);
    const meta={...(req.user.personalTasks?.[task.id]||{})};
    if(req.body.minutes!==undefined){const minutes=Number(req.body.minutes);if(!Number.isInteger(minutes)||minutes<5||minutes>240)throw new PublicError('Choisissez une durée de 5 à 240 minutes.');meta.minutes=minutes;}
    if(req.body.plannedDate!==undefined){const date=boundedDate(req.body.plannedDate,clock()),today=parisDate(new Date(clock()));if(date<today||task.due>=today&&date>task.due)throw new PublicError('Planifiez ce travail entre aujourd’hui et son échéance.');meta.plannedDate=date;}
    const allowed=new Set(userWork(req.user).map(w=>w.id)),values=Object.fromEntries(Object.entries({...req.user.personalTasks,[task.id]:meta}).filter(([id])=>allowed.has(id)).slice(-600));
    store.update(req.user.id,{personalVersion:clock(),personalTasks:values});res.json({ok:true});
  });
  router.post('/api/personal/balance',auth,(req,res)=>{rateLimit(req,'personal-balance',20,3600000);const plan=rebalance(req.user,clock());store.update(req.user.id,{personalVersion:clock(),personalTasks:plan.meta});res.json({ok:true,count:plan.count,overloadedDays:plan.overloadedDays});});
  router.post('/api/personal/notes',auth,(req,res)=>{
    rateLimit(req,'course-notes',100,3600000);const content=String(req.body.text||'').trim(),subject=personalSubjects(req.user).find(s=>s.key===req.body.subjectKey)||subjectFor({label:String(req.body.subjectLabel||'').trim()});
    if(!content||content.length>2000||!subject.label||subject.label.length>120||!req.body.subjectKey&&!String(req.body.subjectLabel||'').trim())throw new PublicError('Indiquez une matière et une note de 2 000 caractères maximum.');
    if(req.body.subjectKey&&!personalSubjects(req.user).some(s=>s.key===req.body.subjectKey))throw new PublicError('Cette matière n’appartient pas à votre espace.',404);
    if((req.user.courseNotes||[]).length>=100)throw new PublicError('Vous pouvez conserver 100 notes. Supprimez les anciennes pour en ajouter.');
    const note={id:randomUUID(),studentId:scope(req.user),subjectLabel:subject.label,text:content,done:false,createdAt:clock()};store.update(req.user.id,{personalVersion:clock(),courseNotes:[note,...(req.user.courseNotes||[])]});res.json({ok:true,id:note.id});
  });
  router.post('/api/personal/notes/:id',auth,(req,res)=>{
    const note=req.user.courseNotes?.find(n=>n.id===req.params.id&&n.studentId===scope(req.user));if(!note)throw new PublicError('Cette note n’appartient pas à votre espace.',404);
    if(req.body.remove===true){store.update(req.user.id,{personalVersion:clock(),courseNotes:req.user.courseNotes.filter(n=>n!==note)});return res.json({ok:true});}
    const patch={};if(typeof req.body.done==='boolean')patch.done=req.body.done;
    if(req.body.text!==undefined){const content=String(req.body.text).trim();if(!content||content.length>2000)throw new PublicError('Saisissez une note de 2 000 caractères maximum.');patch.text=content;}
    if(!Object.keys(patch).length)throw new PublicError('Modification de note invalide.');store.update(req.user.id,{personalVersion:clock(),courseNotes:req.user.courseNotes.map(n=>n===note?{...n,...patch}:n)});res.json({ok:true});
  });
  router.post('/api/personal/focus',auth,(req,res)=>{
    rateLimit(req,'personal-focus',180,3600000);const now=clock(),action=req.body.action,current=focusState(req.user,now);let session;
    if(action==='dismiss'){if(current&&current.state!=='finished')throw new PublicError('Terminez le minuteur avant de le fermer.',409);store.update(req.user.id,{...focusHistoryPatch(req.user,now),focusSession:null,personalVersion:now});return res.json({focus:null,serverNow:now});}
    if(action==='start'||action==='break'){
      if(current&&current.state!=='finished'&&current.remaining>0)throw new PublicError('Terminez le minuteur en cours avant d’en démarrer un autre.',409);
      const task=req.body.key?personalTasks(req.user,now).find(t=>t.key===req.body.key):null;if(req.body.key&&!task)throw new PublicError('Ce travail n’est plus disponible dans votre espace.',404);
      const minutes=action==='break'?5:Number(req.body.minutes||25);if(!Number.isInteger(minutes)||minutes<5||minutes>90)throw new PublicError('Choisissez une séance de 5 à 90 minutes.');
      session={id:randomUUID(),studentId:scope(req.user),key:task?.key||null,title:action==='break'?'Pause':task?.title||'Travail personnel',phase:action==='break'?'break':'work',state:'running',duration:minutes*60000,remaining:minutes*60000,endsAt:now+minutes*60000,startedAt:now,runningSince:now};
    }else{
      if(!current)throw new PublicError('Aucun minuteur en cours.',404);
      if(action==='pause'&&current.state==='running')session={...current,state:'paused',endsAt:null,runningSince:null};
      else if(action==='resume'&&current.state==='paused')session={...current,state:'running',endsAt:now+current.remaining,runningSince:now};
      else if(action==='stop')session={...current,state:'finished',remaining:0,endsAt:now};
      else throw new PublicError('Cette commande n’est pas disponible pour ce minuteur.',409);
    }
    store.update(req.user.id,{...focusHistoryPatch(req.user,now),insightsSince:req.user.insightsSince||now,personalVersion:clock(),focusSession:session});audit?.record('personal.focus',{source:'http',userId:req.user.id,meta:{mode:action}});res.json({focus:focusState(req.user,now),serverNow:now});
  });
}
