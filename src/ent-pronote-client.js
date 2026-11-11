import {linkedPronote} from './sources.js';
const unsupported=()=>{throw Object.assign(new Error('SERVICE_NOT_AVAILABLE'),{code:'SERVICE_NOT_AVAILABLE',status:501});};
/* Adapt the existing normalized PRONOTE snapshot to the timetable reader.
 * Unsupported ENT services fail explicitly rather than returning invented data. */
export function entPronoteClient(user) {
 if(!linkedPronote(user)||user.pronoteNeedsReconnect)throw Object.assign(new Error('invalid_grant'),{error:'invalid_grant'});
 const snapshot=user.pronoteSnapshot;
 const section=key=>{const row=snapshot?.sections?.[key];if(row?.state!=='available')throw new Error('SOURCE_UNAVAILABLE');return row.data;};
 const client={
  async getUserInfo(){return {passerelleProvider:'ent-pronote',id:user.studentId,firstName:snapshot.identity.name,lastName:'',className:snapshot.identity.className,permissions:snapshot.sections.homework?.state==='available'?[{service:'TAF',permittedOperations:['READ_HOMEWORK_ASSIGNMENTS']}]:[],school:{id:'ent-pronote',name:snapshot.identity.school,subscribedServices:[]}};},
  async getAgenda(student,start,end,limit=20,offset=0){
   if(student!==user.studentId)unsupported();
   const byDate=new Map();for(const l of section('courses')){const date=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Paris'}).format(new Date(l.start));if(date<start||date>end)continue;if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push({id:l.id,title:l.subject,subject:{label:l.subject},startDateTime:l.start,endDateTime:l.end,location:l.location,canceled:l.cancelled,teachers:(l.teachers||[]).map(name=>({firstName:name,lastName:''}))});}
   return [...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,lessons])=>({date,lessons})).slice(offset,offset+limit);
  },
  async getHomeworkAssignments(student,start,end,limit=20,offset=0){if(student!==user.studentId)unsupported();section('homework');return (user.pronoteAssignments||[]).filter(w=>w.due>=start&&w.due<=end).map(w=>({id:w.id,title:w.title,html:w.details.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('\n','<br>'),dueDate:w.due,subject:{label:w.subjectLabel},done:w.done})).slice(offset,offset+limit);}
 };
 return new Proxy(client,{get(target,key){if(key==='then')return undefined;return target[key]||unsupported;}});
}
