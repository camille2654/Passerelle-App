import {randomUUID} from 'node:crypto';
import {PublicError} from './sync.js';
import {normalizeLabel, subjectFor} from './subjects.js';
import {parisDate, userWork} from './work.js';
import {activityState, changeView, acknowledgeVisit, studentScope} from './activity.js';
import {weeklySummary} from './insights.js';

const validDate = (input, now) => {
  const date = String(input || parisDate(new Date(now)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date + 'T12:00:00Z').toISOString().slice(0, 10) !== date || Math.abs(Date.parse(date) - now) > 550 * 86400000) throw new PublicError('Choisissez une date valide dans l’année scolaire.');
  return date;
};
export function searchOwn(user, query) {
  const q = String(query || '').trim().slice(0, 100), words = normalizeLabel(q).split(/\s+/).filter(Boolean);
  if (q.length < 2) return {query: q, items: [], total: 0};
  const scope = studentScope(user), rows = [];
  for (const item of Object.values(user.calendarEvents || {})) rows.push({id: item.id, kind: 'course', title: item.title, text: [item.location, item.description].filter(Boolean).join(' · '), date: item.date, subject: item.subject?.label || item.rawTitle, cancelled: item.cancelled, target: {type: 'course', date: item.date}});
  for (const item of userWork(user)) rows.push({id: item.id, kind: 'work', title: item.title, text: item.details, date: item.due, subject: item.subjectLabel, done: item.done, target: {type: 'work', id: item.id}});
  for (const item of user.courseNotes || []) if (item.studentId === scope) rows.push({id: item.id, kind: 'note', title: item.subjectLabel, text: item.text, subject: item.subjectLabel, target: {type: 'note', id: item.id}});
  for (const item of user.flashcards || []) if (item.studentId === scope) rows.push({id: item.id, kind: 'card', title: item.question, text: item.answer, subject: item.subjectLabel, target: {type: 'card', id: item.id}});
  if (user.searchNewsScope === scope) for (const item of user.searchNews || []) rows.push({id: item.id, kind: 'news', title: item.title, text: item.text, date: item.date?.slice(0, 10), target: {type: 'news', id: item.id}});
  const matches = rows.filter(item => words.every(word => normalizeLabel(item.title + ' ' + (item.text || '') + ' ' + (item.subject || '')).includes(word)));
  matches.sort((a, b) => Number(normalizeLabel(b.title).includes(normalizeLabel(q))) - Number(normalizeLabel(a.title).includes(normalizeLabel(q))) || (b.date || '').localeCompare(a.date || ''));
  return {query: q, items: matches.slice(0, 60).map(item => ({...item, text: (item.text || '').slice(0, 600)})), total: matches.length};
}
export function cardsView(user, now) {
  const cards = (user.flashcards || []).filter(item => item.studentId === studentScope(user)).map(item => ({...item, subject: subjectFor({label: item.subjectLabel}, undefined, user.subjectStyles)})).sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
  return {cards, due: cards.filter(item => item.dueAt <= now).length, serverNow: now};
}
const redact = input => String(input || '').replace(/https?:\/\/[^\s<>]+/gi, '[lien masqué]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[adresse masquée]').replace(/\b(?:password|mot de passe|jeton|token|secret)\s*[:=]\s*[^\s,;]+/gi, '[secret masqué]').replace(/[a-zA-Z0-9_-]{40,}/g, '[secret masqué]');
const statusValues = new Set(['open', 'in_progress', 'resolved']);
export function installHubRoutes(router, {auth, admin, store, school, rateLimit, audit, clock, version}) {
  const touch = (user, patch) => store.update(user.id, {...patch, personalVersion: clock()});
  router.get('/api/activity', auth, (req, res) => res.json(changeView(store, req.user, clock())));
  router.post('/api/activity/visit', auth, (req, res) => {
    rateLimit(req, 'agenda-visit:' + req.user.id, 180, 3600000);
    if (!acknowledgeVisit(store, req.user, req.body.token, clock())) throw new PublicError('Cette consultation a expiré. Actualisez les changements.', 409);
    res.json({ok: true});
  });
  router.post('/api/search', auth, async (req, res) => {
    rateLimit(req, 'search:' + req.user.id, 120, 15 * 60000);
    let warning = null;
    if (req.body.refreshNews === true && req.user.skolengo) try { await school.load(req.user, 'news', {}); } catch { warning = 'Les actualités n’ont pas pu être actualisées. Les informations déjà reçues restent recherchables.'; }
    res.json({...searchOwn(req.user, req.body.q), warning, newsIndexed: req.user.searchNewsScope === studentScope(req.user) && !!req.user.searchNewsInitialized});
  });
  router.post('/api/search/news/open', auth, async (req, res) => {
    rateLimit(req, 'search-news:' + req.user.id, 60, 15 * 60000);
    const row = req.user.searchNewsScope === studentScope(req.user) && req.user.searchNews?.find(item => item.id === req.body.id);
    if (!row) throw new PublicError('Cette actualité n’appartient pas à votre espace.', 404);
    const context = school.context(req.user), ref = school.reference(context, 'news', row.id);
    res.json(await school.detail(req.user, ref));
  });
  router.get('/api/catchup', auth, async (req, res) => {
    rateLimit(req, 'catchup:' + req.user.id, 60, 15 * 60000);
    const date = validDate(req.query.date, clock()), scope = studentScope(req.user);
    let notebook = null, warning = null;
    if (req.user.skolengo && scope) try { notebook = await school.load(req.user, 'notebook', {date}); } catch { warning = 'Le cahier de textes ne répond pas. Les cours et devoirs déjà synchronisés sont affichés.'; }
    if (studentScope(req.user) !== scope) throw new PublicError('L’élève a changé. Relancez cette journée.', 409);
    const courses = notebook ? notebook.items.filter(item => item.date === date) : Object.values(req.user.calendarEvents || {}).filter(item => item.date === date).map(item => ({...item, ref: null}));
    res.json({date, courses, work: userWork(req.user).filter(item => item.due === date), assignments: (notebook?.work || []).filter(item => item.due?.slice(0, 10) === date), warning, fetchedAt: notebook?.fetchedAt || req.user.lastSync || null});
  });
  router.get('/api/cards', auth, (req, res) => res.json(cardsView(req.user, clock())));
  router.post('/api/cards', auth, (req, res) => {
    rateLimit(req, 'cards:' + req.user.id, 120, 3600000);
    const question = String(req.body.question || '').trim(), answer = String(req.body.answer || '').trim(), subjectLabel = String(req.body.subjectLabel || '').trim();
    if (!question || question.length > 300 || !answer || answer.length > 4000 || !subjectLabel || subjectLabel.length > 120) throw new PublicError('Indiquez une matière, une question (300 caractères maximum) et une réponse (4 000 caractères maximum).');
    if ((req.user.flashcards || []).length >= 500) throw new PublicError('Vous pouvez conserver 500 fiches. Supprimez les anciennes pour en ajouter.');
    const card = {id: randomUUID(), studentId: studentScope(req.user), subjectLabel, question, answer, box: 0, dueAt: clock(), createdAt: clock(), revision: 0};
    touch(req.user, {flashcards: [card, ...(req.user.flashcards || [])]}); res.json({ok: true, id: card.id});
  });
  router.post('/api/cards/:id', auth, (req, res) => {
    const card = req.user.flashcards?.find(item => item.id === req.params.id && item.studentId === studentScope(req.user));
    if (!card) throw new PublicError('Cette fiche n’appartient pas à votre espace.', 404);
    if (req.body.remove !== true) throw new PublicError('Commande de fiche invalide.');
    touch(req.user, {flashcards: req.user.flashcards.filter(item => item !== card)}); res.json({ok: true});
  });
  router.post('/api/cards/:id/review', auth, (req, res) => {
    rateLimit(req, 'card-review:' + req.user.id, 300, 3600000);
    const card = req.user.flashcards?.find(item => item.id === req.params.id && item.studentId === studentScope(req.user));
    if (!card) throw new PublicError('Cette fiche n’appartient pas à votre espace.', 404);
    if (!['again', 'good'].includes(req.body.rating) || req.body.revision !== card.revision) throw new PublicError('Cette fiche a déjà été révisée. Actualisez votre séance.', 409);
    const now = clock(), box = req.body.rating === 'again' ? 0 : Math.min(5, card.box + 1), dueAt = now + (req.body.rating === 'again' ? 10 * 60000 : [1, 1, 2, 4, 7, 14][box] * 86400000);
    const updated = {...card, box, dueAt, revision: card.revision + 1, lastReviewedAt: now};
    touch(req.user, {flashcards: req.user.flashcards.map(item => item === card ? updated : item), cardReviews: [...(req.user.cardReviews || []).filter(item => item.at > now - 120 * 86400000), {id: randomUUID(), studentId: studentScope(req.user), at: now, cardId: card.id, rating: req.body.rating}].slice(-5000), insightsSince: req.user.insightsSince || now});
    res.json({ok: true, dueAt});
  });
  router.get('/api/weekly', auth, (req, res) => res.json(weeklySummary(req.user, validDate(req.query.date, clock()), clock())));
  const publicTicket = (ticket, isAdmin = false) => ({id: ticket.id, category: ticket.category, status: ticket.status, createdAt: ticket.createdAt, updatedAt: ticket.updatedAt, message: store.open(ticket.content), replies: ticket.replies.map(reply => ({at: reply.at, text: store.open(reply.content)})), diagnostics: ticket.diagnostics, ...(isAdmin ? {userId: ticket.userId, name: store.user(ticket.userId)?.name || 'Compte supprimé'} : {})});
  router.post('/api/support/read', auth, (req, res) => { const at = Number(req.body.at); if(!Number.isFinite(at) || at > clock() || at < clock()-10*60000) throw new PublicError('Actualisez vos demandes avant de les marquer comme lues.',409); store.update(req.user.id,{supportReadAt:Math.max(at,req.user.supportReadAt||0)});res.json({ok:true}); });
  router.get('/api/support', auth, (req, res) => res.json({asOf:clock(), tickets: (store.state.supportTickets || []).filter(item => item.userId === req.user.id).slice(-30).reverse().map(item => publicTicket(item))}));
  router.post('/api/support', auth, (req, res) => {
    rateLimit(req, 'support:' + req.user.id, 5, 3600000);
    const message = redact(req.body.message).trim().slice(0, 3000), category = req.body.category;
    if (message.length < 10 || !['sync', 'pronote', 'calendar', 'notifications', 'other'].includes(category)) throw new PublicError('Choisissez une catégorie et décrivez le problème en au moins 10 caractères.');
    const all = (store.state.supportTickets || []).filter(item => item.status !== 'resolved' || item.updatedAt > clock() - 90 * 86400000);
    if (all.filter(item => item.userId === req.user.id && item.status !== 'resolved').length >= 20 || all.length >= 5000) throw new PublicError('Le nombre de signalements en attente est atteint. Consultez vos demandes existantes.', 429);
    const recent = audit.rows.filter(item => item.userId === req.user.id && item.at > clock() - 10 * 60000 && item.level !== 'info').slice(-3);
    const page = ['school', 'ent', 'planner', 'calendar', 'hub'].includes(req.body.page) ? req.body.page : 'unknown';
    const ticket = {id: randomUUID(), userId: req.user.id, category, status: 'open', content: store.seal(message), createdAt: clock(), updatedAt: clock(), replies: [], diagnostics: {version, page, entConnected: !!req.user.skolengo, pronoteConnected: !!req.user.pronote, syncState: req.user.skolengoError ? 'authentication' : req.user.lastError ? 'unavailable' : req.user.lastSync ? 'ok' : 'not_synced', recent: recent.map(item => ({requestId: item.meta.requestId || null, errorCode: item.meta.errorCode || null, at: item.at}))}};
    store.state.supportTickets = [...all, ticket]; store.save(); audit.record('support.created', {source: 'http', userId: req.user.id, meta: {jobId: ticket.id, mode: category}});
    res.json({ok: true, id: ticket.id});
  });
  router.get('/api/admin/support', auth, admin, (req, res) => {
    const status = statusValues.has(req.query.status) ? req.query.status : null, rows = (store.state.supportTickets || []).filter(item => !status || item.status === status).sort((a, b) => b.updatedAt - a.updatedAt), offset = Math.max(0, Math.min(rows.length, Number(req.query.offset) || 0));
    res.json({tickets: rows.slice(offset, offset + 50).map(item => publicTicket(item, true)), total: rows.length, offset, open: (store.state.supportTickets || []).filter(item => item.status !== 'resolved').length});
  });
  router.post('/api/admin/support/:id', auth, admin, (req, res) => {
    rateLimit(req, 'support-admin:' + req.user.id, 100, 3600000);
    const ticket = store.state.supportTickets?.find(item => item.id === req.params.id);
    if (!ticket) throw new PublicError('Signalement introuvable.', 404);
    if (!statusValues.has(req.body.status)) throw new PublicError('Choisissez un état valide.');
    const reply = redact(req.body.reply).trim(); if (reply.length > 3000 || ticket.replies.length >= 30 && reply) throw new PublicError('Cette réponse dépasse les limites du signalement.');
    ticket.status = req.body.status; ticket.updatedAt = clock(); if (reply) ticket.replies.push({at: clock(), adminId: req.user.id, content: store.seal(reply)});
    store.save(); audit.record('support.updated', {source: 'admin', actorId: req.user.id, userId: ticket.userId, meta: {jobId: ticket.id, mode: ticket.status}}); res.json({ok: true});
  });
  return {activity: user => activityState(user)};
}
