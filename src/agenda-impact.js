// Compare the published school day with the owner's last consultation.
// Unknown historical states suppress a comparison, rather than guess a free slot.
const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function instant(value){if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))return null;const p=Object.fromEntries(parts.formatToParts(new Date(value)).map(item=>[item.type,item.value]));return {date:p.year+'-'+p.month+'-'+p.day,minute:Number(p.hour)*60+Number(p.minute)};}
function span(row){const start=instant(row?.start),end=instant(row?.end);return start&&end&&start.date===end.date&&end.minute>start.minute?{date:start.date,start:start.minute,end:end.minute}:null;}
function boundaries(rows,uncertain,dates){
  const result=new Map();
  for(const row of rows.values()){
    if(row.cancelled===true||row.date&&!dates.has(row.date))continue;
    const value=span(row);
    if(!value){const date=instant(row.start)?.date||row.date;if(date)uncertain.add(date);continue;}
    const previous=result.get(value.date)||{start:1440,end:0,count:0};
    result.set(value.date,{start:Math.min(previous.start,value.start),end:Math.max(previous.end,value.end),count:previous.count+1});
  }
  return result;
}
export function agendaImpactDays(calendar,changes,{complete=true}={}){
  if(!complete)return {complete:false,days:[]};
  const relevant=changes.filter(item=>item.entity==='course'),dates=new Set(),uncertain=new Set();
  if(!relevant.length)return {complete:true,days:[]};
  const current=new Map(Object.entries(calendar||{}).map(([id,row])=>[row.id||id,{start:row.start,end:row.end,date:row.date,cancelled:!!row.cancelled}]));
  const previous=new Map([...current].map(([id,row])=>[id,{...row}]));
  const mark=value=>{const date=instant(value)?.date;if(date)dates.add(date);return date;};
  for(const change of [...relevant].sort((a,b)=>(b.seq??b.at??0)-(a.seq??a.at??0))){
    const present=previous.get(change.eventId);
    const affected=[mark(change.before?.start),mark(change.after?.start),mark(present?.start)].filter(Boolean);
    if(change.date)dates.add(change.date);
    if(!change.eventId){affected.forEach(date=>uncertain.add(date));if(change.date)uncertain.add(change.date);continue;}
    if(change.type==='added'){previous.delete(change.eventId);continue;}
    if(!['updated','cancelled','restored'].includes(change.type)||!span(change.before)) {affected.forEach(date=>uncertain.add(date));if(change.date)uncertain.add(change.date);continue;}
    let cancelled=change.before.cancelled;
    if(typeof cancelled!=='boolean'){
      if(change.type==='updated')cancelled=false;
      else if(change.type==='restored')cancelled=true;
      else {affected.forEach(date=>uncertain.add(date));continue;}
    }
    previous.set(change.eventId,{start:change.before.start,end:change.before.end,date:span(change.before).date,cancelled});
  }
  const before=boundaries(previous,uncertain,dates),after=boundaries(current,uncertain,dates);
  return {complete:true,days:[...dates].sort().map(date=>({date,complete:!uncertain.has(date),before:before.get(date)||null,after:after.get(date)||null}))};
}
