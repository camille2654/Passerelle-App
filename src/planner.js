import {schoolEvents} from './event-scope.js';
import { randomUUID } from 'node:crypto';
import { random, digest } from './store.js';
import { PublicError, dateWindow } from './sync.js';
import { parisDate, shiftDate, userWork, subjectList } from './work.js';
import {calendarAtMinute} from './personal-calendar-worker.js';

export function validDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T12:00:00Z')) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date) throw new PublicError('Choisissez une date valide.');
  return date;
}
function schoolDate(value, now = new Date()) {
  const date = validDate(value), window = dateWindow(now);
  if (date < window.start || date > window.end) throw new PublicError('Choisissez une date de l’année scolaire en cours.');
  return date;
}
export function monday(date) { const weekday = new Date(validDate(date) + 'T12:00:00Z').getUTCDay(); return shiftDate(date, -((weekday + 6) % 7)); }
export function weekView(user, date, now = Date.now(), personalCalendars = null) {
  const start = monday(date), work = userWork(user), window = dateWindow(new Date(now));
  let personal = {events:[],conflicts:[],complete:true,warning:null};
  if(personalCalendars)try{personal=personalCalendars.view(user,start,shiftDate(start,6));}catch{personal={events:[],conflicts:[],complete:false,warning:'Les rendez-vous personnels ne sont pas disponibles pour cette période.'};}
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = shiftDate(start, i);
    const courses = Object.values(user.calendarEvents || {}).filter(e => e.date === day).sort((a, b) => a.start.localeCompare(b.start)).map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, location: e.location, cancelled: e.cancelled, subject: e.subject }));
    const lower=Date.parse(calendarAtMinute(day,0)),upper=Date.parse(calendarAtMinute(shiftDate(day,1),0));
    const personalEvents=personal.events.filter(event=>Date.parse(event.start)<upper&&Date.parse(event.end)>lower).map(event=>({...event,conflict:personal.conflicts.some(conflict=>conflict.eventId===event.id&&conflict.date===day)}));
    return { date: day, personalEvents, events: schoolEvents(user).filter(e=>e.date===day&&!e.cancelled).map(({id,title,start,end,allDay,location,cancelled})=>({id,title,start,end,allDay,location,cancelled})), inSchoolYear: day >= window.start && day <= window.end, courses, work: work.filter(w => w.due === day && !w.done), study: (user.studySessions || []).filter(s => s.day === day) };
  });
  return { start, end: shiftDate(start, 6), days, personalCalendarWarning:personal.warning, personalCalendarComplete:personal.complete, lastSync: user.lastSync || null, warning: user.lastError || (!user.lastSync ? 'Connectez votre ENT pour afficher les cours publiés.' : now - user.lastSync > 30 * 60000 ? 'Le dernier emploi du temps date de plus de 30 minutes. Vérifiez votre connexion ENT.' : null) };
}
export function bagView(user, date) {
  const subjects = subjectList(user), keys = new Set(Object.values(user.calendarEvents || {}).filter(e => !e.cancelled && e.date === date).map(e => e.subject?.key).filter(Boolean));
  const materials = user.bagKit || {}, checks = user.bagChecks?.[date] || {};
  const items = ['daily', ...keys].flatMap(key => (materials[key] || []).map(item => ({ ...item, subject: subjects.find(s => s.key === key) || null, checked: checks[item.id] === true })));
  return { date, subjects, courseSubjects: [...keys], kit: materials, items, hasCourses: keys.size > 0, lastSync: user.lastSync || null };
}
export function revisionPlan(user, input, now = Date.now(), personalCalendars = null) {
  const today = parisDate(new Date(now)), exam = userWork(user).find(w => w.id === input.examId && w.kind === 'exam' && !w.done);
  if (!exam) throw new PublicError('Ce contrôle n’est pas disponible dans votre espace.', 404);
  const total = Number(input.totalMinutes), size = Number(input.sessionMinutes || 25);
  if (!Number.isInteger(total) || total < 15 || total > 600 || !Number.isInteger(size) || size < 10 || size > 60) throw new PublicError('Prévoyez entre 15 et 600 minutes, par séances de 10 à 60 minutes.');
  if (exam.due <= today) throw new PublicError('Ce contrôle est aujourd’hui ou passé. Choisissez un contrôle à venir.');
  const start = [today, shiftDate(exam.due, -28)].sort().at(-1), days = [];
  for (let day = start; day < exam.due; day = shiftDate(day, 1)) days.push(day);
  const retained = (user.studySessions || []).filter(s => s.examId !== exam.id || s.done);
  const doneMinutes = retained.filter(s => s.examId === exam.id && s.done).reduce((sum, s) => sum + s.minutes, 0);
  const load = Object.fromEntries(days.map(day => [day, retained.filter(s => s.day === day && !s.done).reduce((sum, s) => sum + s.minutes, 0)]));
  // Only the owner’s planner uses personal appointments. The reciprocal friend
  // availability below keeps its existing school-only consent boundary.
  let calendarWarning=null;
  const personal=personalCalendars?personalCalendars.view(user,start,shiftDate(exam.due,-1)):{events:[],complete:true};
  if(!personal.complete)throw new PublicError('Actualisez vos calendriers personnels avant de planifier les révisions : leurs disponibilités ne peuvent pas être confirmées.',409);
  calendarWarning=personal.warning||null;
  const blocks=[...Object.values(user.calendarEvents||{}).filter(event=>!event.cancelled),...schoolEvents(user).filter(event=>!event.cancelled),...personal.events.filter(event=>event.busy),...retained.filter(session=>!session.done&&session.start&&session.end)];
  const free=Object.fromEntries(days.map(day=>{
    const lower=Math.max(Date.parse(calendarAtMinute(day,8*60)),day===today?Math.ceil(now/60000)*60000:0),upper=Date.parse(calendarAtMinute(day,21*60));
    const busy=blocks.map(event=>[Math.max(lower,Date.parse(event.start)),Math.min(upper,Date.parse(event.end))]).filter(([a,b])=>Number.isFinite(a)&&Number.isFinite(b)&&b>a).sort((a,b)=>a[0]-b[0]);
    let cursor=lower;const intervals=[];
    for(const [a,b]of busy){if(a>cursor)intervals.push([cursor,a]);cursor=Math.max(cursor,b);}if(cursor<upper)intervals.push([cursor,upper]);
    // Older sessions have no fixed time. Reserve their duration rather than
    // silently making that already planned work disappear from the day’s load.
    let unscheduled=retained.filter(session=>session.day===day&&!session.done&&(!session.start||!session.end)).reduce((sum,session)=>sum+session.minutes*60000,0);
    while(unscheduled>0&&intervals.length){const first=intervals[0],take=Math.min(unscheduled,first[1]-first[0]);first[0]+=take;unscheduled-=take;if(first[0]>=first[1])intervals.shift();}
    return [day,intervals];
  }));
  const planned = []; let remaining = Math.max(0, total - doneMinutes);
  while (remaining > 0) {
    const minutes = Math.min(size, remaining), day = [...days].filter(d => load[d] + minutes <= 120&&free[d].some(([a,b])=>b-a>=minutes*60000)).sort((a, b) => load[a] - load[b] || a.localeCompare(b))[0];
    if (!day) throw new PublicError('Le temps disponible avant ce contrôle est insuffisant pour répartir les révisions entre 8 h et 21 h, sans conflit connu ni plus de deux heures par jour. Réduisez votre objectif.');
    const slot=free[day].find(([a,b])=>b-a>=minutes*60000),sessionStart=slot[0];slot[0]+=minutes*60000;
    planned.push({ id: randomUUID(), examId: exam.id, title: exam.title, subjectLabel: exam.subject.label, day, start:new Date(sessionStart).toISOString(),end:new Date(slot[0]).toISOString(), minutes, done: false, createdAt: now });
    load[day] += minutes; remaining -= minutes;
  }
  if (retained.length + planned.length > 300) throw new PublicError('Votre planning contient déjà trop de séances. Retirez les anciennes séances.');
  return { sessions: [...retained, ...planned].sort((a, b) => a.day.localeCompare(b.day) || a.createdAt - b.createdAt), planned: planned.length, minutes: planned.reduce((sum, s) => sum + s.minutes, 0),warning:calendarWarning };
}
const hourFormatter = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const minute = iso => {
  const parts = hourFormatter.format(new Date(iso)).split(':').map(Number);
  return parts[0] * 60 + parts[1];
};
export function commonSlots(users, day, { start = 8 * 60, end = 20 * 60, duration = 60 } = {}) {
  const lower = shiftDate(day, -1), upper = shiftDate(day, 1);
  const busy = users.flatMap(user => Object.values(user.calendarEvents || {}).filter(e => !e.cancelled && e.start.slice(0, 10) <= upper && e.end.slice(0, 10) >= lower).filter(e => parisDate(new Date(e.start)) <= day && parisDate(new Date(e.end)) >= day).map(e => [Math.max(start, parisDate(new Date(e.start)) < day ? 0 : minute(e.start)), Math.min(end, parisDate(new Date(e.end)) > day ? 1440 : minute(e.end))])).filter(([a, b]) => b > a).sort((a, b) => a[0] - b[0]);
  let cursor = start; const slots = [];
  for (const [a, b] of busy) { if (a - cursor >= duration) slots.push({ start: cursor, end: a }); cursor = Math.max(cursor, b); }
  if (end - cursor >= duration) slots.push({ start: cursor, end });
  return slots;
}
export function availabilityView(users, date, options = {}, now = Date.now()) {
  const start = monday(date);
  return { start, end: shiftDate(start, 6), duration: options.duration || 60, days: Array.from({ length: 7 }, (_, i) => {
    const day = shiftDate(start, i);
    const unknown = users.filter(u => !u.skolengo || u.skolengoError || u.lastError || !u.lastSync || now - u.lastSync > 30 * 60000 || !u.calendarWindow || day < u.calendarWindow.start || day > u.calendarWindow.end);
    return { date: day, complete: unknown.length === 0, unavailable: unknown.map(u => u.name), slots: unknown.length ? [] : commonSlots(users, day, options) };
  }) };
}

export function installPlannerRoutes(router, { auth, store, rateLimit, baseURL, audit, personalCalendars = null, clock = () => Date.now() }) {
  const today = () => parisDate(new Date(clock()));
  const date = value => schoolDate(value || today(), new Date(clock()));
  const bagDate = value => {
    const day = validDate(value || shiftDate(today(), 1)), window = dateWindow(new Date(clock()));
    if (day < window.start || day > shiftDate(window.end, 7)) throw new PublicError('Choisissez une date de cette année scolaire ou des sept jours suivants.');
    return day;
  };
  const relationships = id => (store.state.friendships || []).filter(f => f.a === id || f.b === id);
  const ownFriend = (ownerId, relationId) => {
    const link = relationships(ownerId).find(f => f.id === relationId);
    if (!link) throw new PublicError('Ce partage n’est pas disponible.', 404);
    const friend = store.user(link.a === ownerId ? link.b : link.a);
    if (!friend) throw new PublicError('Ce compte n’existe plus.', 404);
    return { link, friend };
  };
  router.get('/api/week', auth, (req, res) => res.json(weekView(req.user, date(req.query.date), clock(),personalCalendars)));
  router.get('/api/bag', auth, (req, res) => res.json(bagView(req.user, bagDate(req.query.date))));
  router.post('/api/bag/kit', auth, (req, res) => {
    const key = String(req.body.subjectKey || 'daily');
    if (key !== 'daily' && !subjectList(req.user).some(s => s.key === key)) throw new PublicError('Cette matière n’appartient pas à votre espace.', 404);
    if (!Array.isArray(req.body.items) || req.body.items.length > 20 || req.body.items.some(item => typeof item !== 'string' || item.trim().length > 100)) throw new PublicError('Ajoutez au maximum 20 objets, avec un nom de 100 caractères maximum.');
    const labels = [...new Map(req.body.items.map(s => s.trim()).filter(Boolean).map(label => [label.toLocaleLowerCase('fr-FR'), label])).values()];
    const previous = req.user.bagKit?.[key] || [];
    const kit = { ...(req.user.bagKit || {}), [key]: labels.map(label => ({ id: previous.find(item => item.label.toLowerCase() === label.toLowerCase())?.id || randomUUID(), label })) };
    store.update(req.user.id, { bagKit: kit }); audit.record('bag.updated', { source: 'http', userId: req.user.id, meta: { count: labels.length } }); res.json({ ok: true });
  });
  router.post('/api/bag/check', auth, (req, res) => {
    const day = bagDate(req.body.date), bag = bagView(req.user, day);
    if (!bag.items.some(item => item.id === req.body.id)) throw new PublicError('Cet objet ne figure pas dans votre sac pour cette date.', 404);
    if (typeof req.body.checked !== 'boolean') throw new PublicError('Choisissez un état valide.');
    const checks = { ...(req.user.bagChecks || {}), [day]: { ...(req.user.bagChecks?.[day] || {}), [req.body.id]: req.body.checked } };
    const recent = Object.fromEntries(Object.entries(checks).sort(([a], [b]) => b.localeCompare(a)).slice(0, 40));
    store.update(req.user.id, { bagChecks: recent }); res.json({ ok: true });
  });
  router.get('/api/study', auth, (req, res) => res.json({ sessions: req.user.studySessions || [], exams: userWork(req.user).filter(w => w.kind === 'exam' && !w.done && w.due >= today()) }));
  router.post('/api/study/plan', auth, (req, res) => {
    rateLimit(req, 'study-plan', 30, 3600000); const plan = revisionPlan(req.user, req.body, clock(),personalCalendars);
    store.update(req.user.id, { studySessions: plan.sessions }); audit.record('study.planned', { source: 'http', userId: req.user.id, meta: { count: plan.planned } }); res.json({ ok: true, planned: plan.planned, minutes: plan.minutes,warning:plan.warning });
  });
  router.post('/api/study/:id', auth, (req, res) => {
    const session = req.user.studySessions?.find(s => s.id === req.params.id);
    if (!session) throw new PublicError('Cette séance n’appartient pas à votre espace.', 404);
    if (typeof req.body.done !== 'boolean') throw new PublicError('Choisissez un état valide.');
    store.update(req.user.id, { studySessions: req.user.studySessions.map(s => s === session ? { ...s, done: req.body.done, doneAt: req.body.done ? (s.done && s.doneAt || clock()) : null } : s) }); res.json({ ok: true });
  });
  router.post('/api/study/:id/remove', auth, (req, res) => {
    if (!req.user.studySessions?.some(s => s.id === req.params.id)) throw new PublicError('Cette séance n’appartient pas à votre espace.', 404);
    store.update(req.user.id, { studySessions: req.user.studySessions.filter(s => s.id !== req.params.id) }); res.json({ ok: true });
  });
  router.get('/api/friends', auth, (req, res) => res.json({ friends: relationships(req.user.id).map(link => ({ id: link.id, name: store.user(link.a === req.user.id ? link.b : link.a)?.name || 'Compte supprimé', since: link.createdAt })) }));
  router.post('/api/friends/invite', auth, (req, res) => {
    rateLimit(req, 'friend-invite', 12, 3600000);
    if (req.body.shareAvailability !== true) throw new PublicError('Confirmez le partage de vos créneaux libres.');
    if (relationships(req.user.id).length >= 20) throw new PublicError('Vous partagez déjà vos créneaux avec 20 personnes.');
    const token = random(), now = clock();
    const invites = (store.state.friendInvites || []).filter(i => i.expires > now);
    if (invites.filter(i => i.creatorId === req.user.id).length >= 5) throw new PublicError('Vous avez déjà cinq invitations actives. Révoquez-les avant d’en créer une nouvelle.');
    store.state.friendInvites = [...invites, { hash: digest(token), creatorId: req.user.id, expires: now + 7 * 86400000 }]; store.save();
    audit.record('friends.invited', { source: 'http', userId: req.user.id }); res.json({ url: baseURL + '/#friend=' + token });
  });
  router.post('/api/friends/invites/revoke', auth, (req, res) => {
    store.state.friendInvites = (store.state.friendInvites || []).filter(i => i.creatorId !== req.user.id); store.save(); res.json({ ok: true });
  });
  const invitation = req => {
    const token = String(req.body.token || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PublicError('Ce lien de partage n’est plus valide.', 404);
    const invite = (store.state.friendInvites || []).find(i => i.hash === digest(token) && i.expires > clock());
    if (!invite || !store.user(invite.creatorId)) throw new PublicError('Ce lien de partage a expiré ou a déjà été utilisé.', 404);
    if (invite.creatorId === req.user.id) throw new PublicError('Ce lien est destiné à votre ami.');
    return invite;
  };
  router.post('/api/friends/preview', auth, (req, res) => {
    rateLimit(req, 'friend-preview', 30, 60000); const invite = invitation(req); res.json({ name: store.user(invite.creatorId).name, expires: invite.expires });
  });
  router.post('/api/friends/accept', auth, (req, res) => {
    rateLimit(req, 'friend-accept', 12, 3600000); const invite = invitation(req);
    if (req.body.shareAvailability !== true) throw new PublicError('Confirmez le partage réciproque de vos créneaux libres.');
    if ([req.user.id, invite.creatorId].some(id => relationships(id).length >= 20)) throw new PublicError('La limite de 20 partages est atteinte pour l’un des comptes.');
    const existing = relationships(req.user.id).find(f => f.a === invite.creatorId || f.b === invite.creatorId);
    if (!existing) store.state.friendships = [...(store.state.friendships || []), { id: randomUUID(), a: invite.creatorId, b: req.user.id, createdAt: clock() }];
    for (const id of [req.user.id, invite.creatorId]) store.user(id).friendshipVersion = clock();
    store.state.friendInvites = store.state.friendInvites.filter(i => i !== invite); store.save();
    audit.record('friends.accepted', { source: 'http', userId: req.user.id }); res.json({ ok: true });
  });
  router.post('/api/friends/:id/remove', auth, (req, res) => {
    const { friend } = ownFriend(req.user.id, req.params.id);
    for (const user of [req.user, friend]) user.friendshipVersion = clock();
    store.state.friendships = store.state.friendships.filter(f => f.id !== req.params.id); store.save(); audit.record('friends.removed', { source: 'http', userId: req.user.id }); res.json({ ok: true });
  });
  router.get('/api/friends/availability', auth, (req, res) => {
    rateLimit(req, 'friend-availability', 80, 60000);
    const selected = [...new Set(String(req.query.friends || '').split(',').filter(Boolean))];
    if (!selected.length || selected.length > 8) throw new PublicError('Choisissez entre un et huit amis.');
    const friends = selected.map(id => ownFriend(req.user.id, id).friend);
    const duration = Number(req.query.duration || 60), parseTime = (value, fallback) => {
      if (!value) return fallback;
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) throw new PublicError('Choisissez des horaires valides.');
      return String(value).split(':').map(Number).reduce((h, m) => h * 60 + m);
    };
    const start = parseTime(req.query.start, 8 * 60), end = parseTime(req.query.end, 20 * 60);
    if (![30, 45, 60, 90, 120, 180].includes(duration) || end <= start || end - start < duration) throw new PublicError('La plage horaire doit être plus longue que la durée recherchée.');
    res.json(availabilityView([req.user, ...friends], date(req.query.date), { start, end, duration }, clock()));
  });
}
