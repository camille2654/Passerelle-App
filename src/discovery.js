import {subjectFor, normalizeLabel} from './subjects.js';
import {subjectList, userWork, parisDate} from './work.js';
import {studentScope} from './activity.js';
import {PublicError} from './sync.js';

export const SEARCH_KINDS = ['subject', 'course', 'work', 'document', 'note', 'card', 'news'];
const ofSubject = (user, label) => subjectFor({label}, undefined, user.subjectStyles);
const courseSubject = (user, row) => ofSubject(user, row.subject?.label || row.rawTitle || row.title);
const cleanCourse = row => ({id:row.id, title:row.title, date:row.date, start:row.start, end:row.end, location:row.location || '', cancelled:!!row.cancelled});

export function discoverySubjects(user) {
  const scope = studentScope(user), found = new Map(subjectList(user).map(row => [row.key, row]));
  for (const row of [...(user.courseNotes || []), ...(user.flashcards || [])]) {
    if (row.studentId !== scope || !row.subjectLabel) continue;
    const subject = ofSubject(user, row.subjectLabel); found.set(subject.key, subject);
  }
  return [...found.values()].sort((a,b) => a.label.localeCompare(b.label, 'fr'));
}

// Only metadata from the existing, owner-scoped services enters the index.
export function discoveryDocuments(user, favorites, resources) {
  const scope = favorites.scope(user), work = new Map(userWork(user).map(row => [row.id, row]));
  const links = (user.subjectDocumentLinks || []).filter(row => row.scope === scope), subjects = new Set(discoverySubjects(user).map(row=>row.key));
  return [
    ...favorites.list(user).items.map(row => {
      const link = links.find(value => value.favoriteId === row.id), tagged = link && ofSubject(user, link.subjectLabel), subject = tagged && subjects.has(tagged.key) ? tagged : null;
      return {id:row.id, title:row.name, provider:'Copie privée', type:'favorite', available:true, subjectKey:subject?.key || null, subjectLabel:subject?.label || '', createdAt:row.createdAt};
    }),
    ...resources.list(user).items.map(row => {
      const item = work.get(row.workId), subject = item && ofSubject(user, item.subjectLabel);
      return {id:row.id, title:row.title, provider:row.provider, type:'resource', resourceKind:row.kind, available:row.available, workId:row.workId, subjectKey:subject?.key || null, subjectLabel:subject?.label || '', createdAt:row.createdAt};
    })
  ];
}

export function searchDiscovery(user, query, {documents = [], kind = 'all'} = {}) {
  const q = typeof query === 'string' ? query.trim().slice(0,100) : '', normalized = normalizeLabel(q);
  const words = normalized.split(/\s+/).filter(Boolean), counts = Object.fromEntries(SEARCH_KINDS.map(id => [id,0]));
  if (q.length < 2 || !words.length) return {query:q, items:[], total:0, allTotal:0, counts, kind};
  const scope = studentScope(user), rows = [];
  for (const subject of discoverySubjects(user)) rows.push({id:subject.key, kind:'subject', title:subject.label, subject:subject.label, subjectKey:subject.key, text:'Cours, devoirs et documents de cette matière', target:{type:'subject', id:subject.key}});
  for (const item of Object.values(user.calendarEvents || {})) {const subject = courseSubject(user,item); rows.push({id:item.id,kind:'course',title:item.title,text:[item.location,item.description].filter(Boolean).join(' · '),date:item.date,subject:subject.label,subjectKey:subject.key,cancelled:!!item.cancelled,target:{type:'course',date:item.date}});}
  for (const item of userWork(user)) rows.push({id:item.id,kind:'work',workKind:item.kind,title:item.title,text:item.details,date:item.due,subject:item.subjectLabel,subjectKey:item.subject.key,done:item.done,target:{type:'work',id:item.id}});
  for (const item of documents) rows.push({id:item.id,kind:'document',title:item.title,text:item.provider,subject:item.subjectLabel,subjectKey:item.subjectKey,available:item.available,target:{type:item.type,id:item.id,...(item.resourceKind?{resourceKind:item.resourceKind}:{})}});
  for (const item of user.courseNotes || []) if (item.studentId === scope) {const subject = ofSubject(user,item.subjectLabel); rows.push({id:item.id,kind:'note',title:item.subjectLabel,text:item.text,subject:item.subjectLabel,subjectKey:subject.key,target:{type:'note',id:item.id}});}
  for (const item of user.flashcards || []) if (item.studentId === scope) {const subject = ofSubject(user,item.subjectLabel);rows.push({id:item.id,kind:'card',title:item.question,text:item.answer,subject:item.subjectLabel,subjectKey:subject.key,target:{type:'card',id:item.id}});}
  if (user.searchNewsScope === scope) for (const item of user.searchNews || []) rows.push({id:item.id,kind:'news',title:item.title,text:item.text,date:item.date?.slice(0,10),target:{type:'news',id:item.id}});
  const matches = rows.filter(row => words.every(word => normalizeLabel([row.title,row.text,row.subject].filter(Boolean).join(' ')).includes(word)));
  for (const row of matches) counts[row.kind]++;
  const filtered = matches.filter(row => kind === 'all' || row.kind === kind);
  filtered.sort((a,b) => Number(b.kind === 'subject') - Number(a.kind === 'subject') || Number(normalizeLabel(b.title).includes(normalized)) - Number(normalizeLabel(a.title).includes(normalized)) || (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title,'fr'));
  return {query:q,items:filtered.slice(0,60).map(row => ({...row,text:(row.text || '').slice(0,600)})),total:filtered.length,allTotal:matches.length,counts,kind};
}

export function subjectDetail(user, key, documents, now) {
  const subject = discoverySubjects(user).find(row => row.key === key);
  if (!subject) throw new PublicError('Cette matière n’appartient pas à votre profil.',404);
  const scope = studentScope(user), today = parisDate(new Date(now));
  const courses = Object.values(user.calendarEvents || {}).filter(row => courseSubject(user,row).key === key && row.date >= today).sort((a,b) => a.start.localeCompare(b.start));
  const work = userWork(user).filter(row => row.subject.key === key);
  const notes = (user.courseNotes || []).filter(row => row.studentId === scope && !row.done && ofSubject(user,row.subjectLabel).key === key).map(row => ({id:row.id,text:row.text}));
  const cards = (user.flashcards || []).filter(row => row.studentId === scope && ofSubject(user,row.subjectLabel).key === key);
  const pending = work.filter(row => !row.done), completed = work.filter(row => row.done);
  const related = documents.filter(row => row.subjectKey === key);
  return {subject,nextCourse:cleanMaybe(courses.find(row => !row.cancelled && Date.parse(row.end) > now)),courses:courses.filter(row => Date.parse(row.end)>now).slice(0,12).map(cleanCourse),courseCount:courses.filter(row=>Date.parse(row.end)>now).length,work:pending.slice(0,40).map(cleanWork),workCount:pending.length,completed:completed.slice(-10).reverse().map(cleanWork),completedCount:completed.length,notes:notes.slice(0,40),noteCount:notes.length,cards:{total:cards.length,due:cards.filter(row => row.dueAt <= now).length},documents:related,unassignedDocuments:documents.filter(row=>row.type==='favorite'&&!row.subjectKey),lastSync:user.lastSync||null,workLastSync:user.workLastSync||null,warning:user.lastError||user.homeworkWarning||null,serverNow:now};
}
const cleanMaybe = row => row ? cleanCourse(row) : null;
const cleanWork = row => ({id:row.id,title:row.title,details:row.details||'',due:row.due,kind:row.kind,done:row.done});

export function installDiscoveryRoutes(router,{auth,store,favorites,resources,rateLimit,clock}) {
  const documents = user => discoveryDocuments(user,favorites,resources);
  router.get('/api/library/work/:id',auth,(req,res)=>{const row=userWork(req.user).find(row=>row.id===req.params.id);if(!row)throw new PublicError('Ce travail n’appartient pas à votre profil.',404);res.json({...cleanWork(row),subject:row.subject});});
  router.get('/api/library/subjects',auth,(req,res) => {
    const docs=documents(req.user), now=clock(), work=userWork(req.user), courses=Object.values(req.user.calendarEvents||{});
    res.json({accountId:req.user.id,scope:favorites.scope(req.user),subjects:discoverySubjects(req.user).map(subject=>({subject,pending:work.filter(row=>!row.done&&row.subject.key===subject.key).length,documents:docs.filter(row=>row.subjectKey===subject.key).length,nextCourse:cleanMaybe(courses.filter(row=>!row.cancelled&&Date.parse(row.end)>now&&courseSubject(req.user,row).key===subject.key).sort((a,b)=>a.start.localeCompare(b.start))[0])})),lastSync:req.user.lastSync||null,serverNow:now});
  });
  router.get('/api/library/subjects/:key',auth,(req,res) => res.json({accountId:req.user.id,scope:favorites.scope(req.user),...subjectDetail(req.user,req.params.key,documents(req.user),clock())}));
  router.post('/api/library/documents/:id/subject',auth,(req,res) => {
    rateLimit(req,'library-document:'+req.user.id,100,3600000);
    const body=req.body,scope=favorites.scope(req.user);
    if(!body||Object.keys(body).some(key=>!['accountId','scope','subjectKey'].includes(key))||body.accountId!==req.user.id||body.scope!==scope)throw new PublicError('Le compte ou le lycée a changé. Rouvrez cette matière.',409);
    favorites.find(req.user,req.params.id);
    const subject=body.subjectKey===null?null:discoverySubjects(req.user).find(row=>row.key===body.subjectKey);
    if(body.subjectKey!==null&&!subject)throw new PublicError('Matière introuvable.',404);
    const known = new Set((req.user.favoriteDocuments||[]).map(row=>row.id));
    const links=(req.user.subjectDocumentLinks||[]).filter(row=>known.has(row.favoriteId)&&!(row.scope===scope&&row.favoriteId===req.params.id));
    if(subject)links.push({favoriteId:req.params.id,scope,subjectLabel:subject.label});
    store.update(req.user.id,{subjectDocumentLinks:links,personalVersion:clock()});res.json({ok:true});
  });
  return {search:(user,q,options={})=>searchDiscovery(user,q,{documents:documents(user),...options})};
}
