import {parisDate} from './work.js';

const clock=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Paris',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function homeContext(user,now=Date.now()){
  const date=parisDate(new Date(now)),today=Object.values(user.calendarEvents||{}).filter(course=>course.date===date&&!course.cancelled).sort((a,b)=>a.start.localeCompare(b.start));
  const current=today.find(course=>Date.parse(course.start)<=now&&Date.parse(course.end)>now),next=today.find(course=>Date.parse(course.start)>now),lastEnd=today.length?Math.max(...today.map(course=>Date.parse(course.end))):null;
  const [h,m]=clock.format(new Date(now)).split(':').map(Number),minutes=h*60+m;
  const evening=lastEnd!==null?now>=lastEnd:minutes>=17*60,phase=evening?'evening':current?'in_class':next?'before_class':'free';
  return {date,phase,defaultDay:evening?'tomorrow':'today',primary:evening?'preparation':'day',label:evening?'Préparer demain':current?'En ce moment':next?'Votre prochain cours':'Votre journée',next:current||next?{id:(current||next).id,start:(current||next).start,end:(current||next).end,title:(current||next).title,location:(current||next).location||'',inProgress:!!current,minutesUntil:current?0:Math.max(0,Math.ceil((Date.parse(next.start)-now)/60000))}:null,serverNow:now};
}
