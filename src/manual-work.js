import {randomUUID} from 'node:crypto';
import {digest} from './store.js';
import {PublicError,dateWindow} from './sync.js';
import {rebuildCalendar} from './calendar.js';

export function validateManualWork(user,input,now=Date.now()) {
  if((user.manualWork||[]).length>=200)throw new PublicError('Vous pouvez conserver au maximum 200 ajouts personnels.');
  const title=String(input.title||'').trim(),details=String(input.details||'').trim(),subjectLabel=String(input.subjectLabel||'').trim(),due=String(input.due||''),kind=input.kind,window=dateWindow(new Date(now));
  if(!title||title.length>300||details.length>8000||!subjectLabel||subjectLabel.length>120||!['exam','homework'].includes(kind)||!/^\d{4}-\d{2}-\d{2}$/.test(due)||!Number.isFinite(Date.parse(due))||new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due||due<window.start||due>window.end)throw new PublicError('Indiquez un titre, une matière et une date valide dans l’année scolaire en cours.');
  return {title,details,subjectLabel,due,kind,source:'manual',done:false};
}
export function addManualWork(store,user,input,now=Date.now()) {
  const item=validateManualWork(user,input,now),id=digest(user.id+':manual:'+randomUUID());
  store.update(user.id,{manualWork:[...(user.manualWork||[]),{id,...item}]});rebuildCalendar(store,user.id,now);return id;
}
