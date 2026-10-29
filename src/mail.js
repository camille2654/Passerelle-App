import {accountActive,automationAllowed} from './operational-state.js';
import nodemailer from 'nodemailer';
import { readFileSync } from 'node:fs';
import { mailDocument } from './brand.js';
import { random, digest } from './store.js';
import { buildBrief, parisDate } from './work.js';
import { changeAlertMessage } from './change-alerts.js';
import {vacationPaused,returnBrief} from './personal.js';

export class MailError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
export function emailAddress(value) {
  const email = String(value || '').trim().toLowerCase();
  const [local, domain] = email.split('@');
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email) || local.startsWith('.') || local.endsWith('.') || local.includes('..') || !domain.split('.').every(part => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(part))) throw new MailError('Saisissez une adresse mail valide.');
  return email;
}
export function detectSMTP(address) {
  const email = emailAddress(address), domain = email.split('@')[1];
  if (['gmail.com', 'googlemail.com'].includes(domain)) return { host: 'smtp.gmail.com', port: 465, username: email, fromEmail: email, provider: 'Gmail', hint: 'Utilisez un mot de passe d’application Google, avec la validation en deux étapes activée.', helpURL: 'https://support.google.com/accounts/answer/185833?hl=fr' };
  return { host: '', port: 587, username: email, fromEmail: email, provider: null, hint: 'Indiquez le serveur SMTP et les accès fournis par votre messagerie. La connexion sécurisée sera vérifiée avant activation.' };
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hour = value => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
const fullDate = value => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(value + 'T12:00:00Z'));
export function briefMessage(user, brief, baseURL, unsubscribeURL) {
  const courseLines = brief.courses.map(c => `${hour(c.start)}–${hour(c.end)} · ${c.title}${c.location ? ' · ' + c.location : ''}`);
  const homeworkLines = brief.homework.map(w => `${brief.returning ? fullDate(w.due) + ' · ' : ''}${w.subject.emoji} ${w.subject.label} · ${w.title}${w.details && w.details !== w.title ? '\n' + w.details.slice(0, 1400) : ''}`);
  const examLines = brief.exams.map(w => `${w.due === brief.date ? 'Demain' : fullDate(w.due)} · ${w.subject.emoji} ${w.subject.label} · ${w.title}${w.details && w.details !== w.title ? '\n' + w.details.slice(0, 1400) : ''}`);
  const changeLines = brief.changes.map(c => `${c.title} : ${c.type === 'cancelled' ? 'annulé' : c.type === 'restored' ? 'rétabli' : c.type === 'added' ? 'ajouté' : 'modifié'}`);
  const sections = [ [brief.returning?'Votre journée de reprise':'Votre journée de demain', courseLines.length ? courseLines : ['Aucun cours publié pour demain.']], [brief.returning?'Devoirs à prévoir · 7 jours':'Devoirs pour demain', homeworkLines.length ? homeworkLines : ['Aucun devoir à faire transmis pour demain.']], ['Contrôles à préparer · 7 prochains jours', examLines.length ? examLines : ['Aucun contrôle renseigné pour cette période.']] ];
  if (changeLines.length) sections.push(['Changements pour demain', changeLines]);
  const subject = `📚 ${brief.returning?'Préparer la reprise':'Votre journée de demain'} · ${fullDate(brief.date)}`;
  const freshness = brief.lastSync ? 'Emploi du temps récupéré le ' + new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' }).format(new Date(brief.lastSync)) + '.' : 'Aucune récupération de l’ENT n’a encore réussi.';
  const warning = brief.warning || (!brief.workLastSync ? 'Les devoirs Skolengo ne sont pas encore disponibles. Les contrôles ajoutés dans le portail sont inclus.' : null);
  const text = [`Bonjour ${user.name},`, `Voici votre récapitulatif ${brief.returning?'de reprise ':''}pour ${fullDate(brief.date)}.`, ...(warning ? ['Attention : ' + warning] : []), ...sections.map(([title, lines]) => title + '\n' + lines.map(l => '• ' + l).join('\n')), freshness, 'Gérer votre espace : ' + baseURL + '/', 'Arrêter les briefs : ' + unsubscribeURL].join('\n\n');
  const blocks = sections.map(([title, lines]) => `<h2 style="font-size:17px;margin:26px 0 12px;color:#153d38">${escape(title)}</h2><ul style="padding-left:20px;color:#546a58;line-height:1.7">${lines.map(l => `<li style="margin-bottom:9px;white-space:pre-line">${escape(l)}</li>`).join('')}</ul>`).join('');
  const html = mailDocument({ title: brief.returning?'Votre reprise · Passerelle':'Votre journée de demain · Passerelle', baseURL,
    content: `<p style="font-size:10px;font-weight:bold;letter-spacing:1.5px;color:#63754e;margin:0 0 14px">VOTRE BRIEF</p><h1 style="font-size:26px;line-height:1.3;color:#153d38;margin:0 0 18px">${brief.returning?'Reprise':'Demain'}, ${escape(fullDate(brief.date))}</h1><p>Bonjour ${escape(user.name)}, voici les informations disponibles pour préparer votre journée.</p>${warning ? `<p style="background:#fff2e6;padding:14px;border-radius:8px">${escape(warning)}</p>` : ''}${blocks}<p style="font-size:11px;color:#63716a;line-height:1.7">${escape(freshness)} Les contrôles repérés dans les devoirs restent à vérifier avec les consignes de l’enseignant.</p><p style="margin:26px 0 0"><a href="${escape(baseURL + '/')}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#153d38;color:#f6f5ef;font-weight:bold;text-decoration:none">Ouvrir mon portail</a></p>`,
    footer: `Vous avez activé ce brief quotidien. <a href="${escape(unsubscribeURL)}" style="color:#205c50">Arrêter les envois</a>.`
  });
  return { subject, text, html };
}
export class MailEngine {
  constructor(store, baseURL, { clock = () => Date.now(), transportFactory = config => nodemailer.createTransport(config), syncUser = null, audit = null } = {}) {
    this.store = store; this.baseURL = baseURL; this.clock = clock; this.transportFactory = transportFactory; this.syncUser = syncUser; this.running = new Set(); this.audit = audit;
  }
  get ready() { return !!this.store.state.settings.smtp; }
  publicSettings(user) {
    const config = user.emailConfig;
    return config ? { address: this.store.open(config.address), verified: !!config.verified, enabled: !!config.enabled, wantedEnabled: !!config.wantedEnabled, alertsEnabled: !!config.alertsEnabled, wantedAlertsEnabled: !!config.wantedAlertsEnabled, time: config.time || '20:00', pending: !!user.emailVerification && user.emailVerification.expires > this.clock(), draft: !config.verified && !user.emailVerification, expires: user.emailVerification?.expires || null, lastDelivery: user.lastBrief || null, lastChangeAlert: user.lastChangeAlert || null } : { address: '', verified: false, enabled: false, alertsEnabled: false, time: '20:00', pending: false, lastDelivery: null };
  }
  publicSMTP() {
    if (!this.ready) return null;
    const { host, port, username, fromEmail, fromName } = this.store.open(this.store.state.settings.smtp);
    return { host, port, username, fromEmail, fromName };
  }
  transport(config) {
    return this.transportFactory({ host: config.host, port: config.port, secure: config.port === 465, requireTLS: config.port !== 465, auth: { user: config.username, pass: config.password }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 20000, dnsTimeout: 8000, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true });
  }
  async configure(input) {
    const previous = this.ready ? this.store.open(this.store.state.settings.smtp) : {};
    const detected = detectSMTP(input.fromEmail);
    const config = { host: String(input.host || detected.host).trim(), port: Number(input.port || detected.port), username: String(input.username || detected.username).trim(), fromEmail: emailAddress(input.fromEmail), fromName: String(input.fromName || 'Passerelle').replace(/[\r\n]/g, '').slice(0, 80), password: String(input.password || '') };
    if (!config.password && previous.host === config.host && previous.username === config.username) config.password = previous.password;
    if (config.host === 'smtp.gmail.com') config.password = config.password.replace(/\s+/g, '');
    if (!/^[a-z0-9.-]{1,253}$/i.test(config.host) || ![465, 587].includes(config.port) || !config.username || config.username.length > 320 || !config.password || config.password.length > 2000) throw new MailError('Renseignez le serveur SMTP, le port 465 ou 587, l’identifiant et le mot de passe.');
    const transport = this.transport(config);
    try { await transport.verify(); }
    catch { this.audit?.record('mail.configuration_failed', { source: 'mail', level: 'error', meta: { errorCode: 'SMTP_VERIFY_FAILED' } }); throw new MailError('La connexion SMTP a échoué. Vérifiez le serveur, le port et les identifiants.', 502); }
    finally { transport.close?.(); }
    this.store.state.settings.smtp = this.store.seal(config); this.store.save();
    this.audit?.record('mail.configured', { source: 'mail' });
  }
  async configureEnvironment(env = process.env) {
    if (this.ready || !env.AGENDA_SMTP_PASSWORD || !env.AGENDA_SMTP_FROM) return false;
    await this.configure({ host: env.AGENDA_SMTP_HOST, port: env.AGENDA_SMTP_PORT, username: env.AGENDA_SMTP_USER, password: env.AGENDA_SMTP_PASSWORD, fromEmail: env.AGENDA_SMTP_FROM, fromName: env.AGENDA_SMTP_NAME }); return true;
  }
  async send(user, content, messageKey) {
    if(!accountActive(user))throw new MailError('Ce compte est suspendu ou archivé.',409);
    if (!this.ready) throw new MailError('L’administrateur doit configurer l’envoi des mails dans le portail.', 409);
    const settings = this.store.open(this.store.state.settings.smtp), transport = this.transport(settings);
    const domain = settings.fromEmail.split('@')[1];
    try {
      const info = await transport.sendMail({ from: { name: settings.fromName, address: settings.fromEmail }, to: this.store.open(user.emailConfig.address), subject: content.subject, text: content.text, html: content.html, attachments: content.html?.includes('cid:passerelle-mark') ? [{ filename: 'passerelle.png', content: readFileSync(new URL('../public/icons/app-192.png', import.meta.url)), cid: 'passerelle-mark', contentType: 'image/png', contentDisposition: 'inline' }] : undefined, messageId: `<${digest(user.id + ':' + messageKey)}@${domain}>`, disableFileAccess: true, disableUrlAccess: true });
      if (!info.accepted?.length) throw new Error('No accepted recipient');
      return info;
    } catch { throw new MailError('Le mail n’a pas pu être envoyé. Vérifiez les réglages d’envoi et réessayez.', 502); }
    finally { transport.close?.(); }
  }
  async savePreferences(user, input) {
    const email = emailAddress(input.address), time = String(input.time || '20:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new MailError('Choisissez une heure valide.');
    if (!this.ready) throw new MailError('L’envoi des mails doit d’abord être configuré par l’administrateur.', 409);
    const same = user.emailConfig?.addressHash === digest(email);
    if (same && user.emailConfig.verified) {
      const alerts = input.alertsEnabled === undefined ? !!user.emailConfig.alertsEnabled : input.alertsEnabled === true;
      this.store.update(user.id, { emailConfig: { ...user.emailConfig, enabled: input.enabled === true, wantedEnabled: input.enabled === true, alertsEnabled: alerts, wantedAlertsEnabled: alerts, alertsSince: alerts && user.emailConfig.alertsEnabled ? user.emailConfig.alertsSince : this.clock(), time }, ...(!alerts || !user.emailConfig.alertsEnabled ? { emailAlertQueue: [] } : {}) }); return { needsVerification: false };
    }
    await this.assignAddress(user, input);
    this.store.update(user.id, { emailConfig: { ...user.emailConfig, wantedAlertsEnabled: input.alertsEnabled === true } });
    await this.requestVerification(user);
    return { needsVerification: true };
  }
  async assignAddress(user, input, actorId = null) {
    const email = emailAddress(input.address), time = String(input.time || '20:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new MailError('Choisissez une heure valide.');
    if (user.emailConfig?.addressHash === digest(email) && user.emailConfig.verified) {
      // An admin cannot silently reverse a recipient's opt-out.
      this.store.update(user.id, { emailConfig: { ...user.emailConfig, time } });
    } else {
      const unsubscribe = random();
      this.store.update(user.id, { emailConfig: { address: this.store.seal(email), addressHash: digest(email), verified: false, enabled: false, wantedEnabled: input.enabled === true, alertsEnabled: false, wantedAlertsEnabled: false, time, unsubscribeKey: this.store.seal(unsubscribe), unsubscribeHash: digest(unsubscribe) }, emailVerification: null, emailAlertQueue: [] });
    }
    this.audit?.record('mail.assigned', { source: actorId ? 'admin' : 'mail', actorId, userId: user.id, meta: { verified: !!user.emailConfig.verified } });
  }
  async requestVerification(user, actorId = null) {
    if (!this.ready) throw new MailError('Configurez l’expéditeur avant d’envoyer la confirmation.', 409);
    if (!user.emailConfig) throw new MailError('Associez une adresse à ce compte.', 409);
    if (user.emailConfig.verified) return { needsVerification: false };
    const verification = random();
    this.store.update(user.id, {
      emailVerification: { hash: digest(verification), addressHash: user.emailConfig.addressHash, expires: this.clock() + 24 * 3600000 }
    });
    const link = this.baseURL + '/#verify-email=' + verification;
    const intro = 'Une adresse a été associée à votre espace Passerelle. En confirmant, vous acceptez les notifications que vous avez choisies pour cet espace : brief quotidien et/ou alertes de changement. Vous pourrez vous désabonner à tout moment.';
    try { await this.send(user, { subject: 'Confirmez votre adresse mail · Passerelle', text: `${intro}\n\nConfirmez votre adresse en ouvrant ce lien (valable 24 heures) :\n\n${link}\n\nSi cette demande ne vous concerne pas, ignorez ce message.`, html: mailDocument({ title: 'Confirmez votre adresse · Passerelle', baseURL: this.baseURL, content: `<h1 style="color:#153d38;font-size:25px;line-height:1.3">Un dernier pas pour recevoir vos notifications.</h1><p>${intro}</p><p><a href="${escape(link)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#153d38;color:#f6f5ef;font-weight:bold;text-decoration:none">Confirmer mon adresse et mon abonnement</a></p><p style="font-size:12px;color:#63716a">Ce lien est valable 24 heures.</p>`, footer: 'Si cette demande ne vous concerne pas, ignorez ce message.' }) }, 'verify:' + verification); }
    catch (error) { this.store.update(user.id, { emailVerification: null }); this.audit?.record('mail.failed', { source: 'mail', level: 'error', userId: user.id, actorId, meta: { mode: 'verification', errorCode: 'SMTP_SEND_FAILED' } }); throw error; }
    this.audit?.record('mail.verification_sent', { source: 'mail', userId: user.id, actorId });
    return { needsVerification: true };
  }
  verifyAddress(token) {
    const hash = digest(String(token || ''));
    const user = this.store.state.users.find(u => u.emailVerification?.hash === hash && u.emailVerification.expires > this.clock() && u.emailConfig?.addressHash === u.emailVerification.addressHash);
    if (!user) throw new MailError('Ce lien de confirmation a expiré ou a déjà été utilisé.', 404);
    this.store.update(user.id, { emailVerification: null, emailConfig: { ...user.emailConfig, verified: true, verifiedAt: this.clock(), enabled: user.emailConfig.wantedEnabled, alertsEnabled: !!user.emailConfig.wantedAlertsEnabled, alertsSince: this.clock() } });
    this.audit?.record('mail.verified', { source: 'mail', userId: user.id });
  }
  unsubscribe(token) {
    const hash = digest(String(token || ''));
    const user = this.store.state.users.find(u => u.emailConfig?.unsubscribeHash === hash);
    if (!user) throw new MailError('Ce lien de désabonnement n’est plus valide.', 404);
    this.store.update(user.id, { emailConfig: { ...user.emailConfig, enabled: false, wantedEnabled: false, alertsEnabled: false, wantedAlertsEnabled: false }, emailAlertQueue: [] });
    this.audit?.record('mail.unsubscribed', { source: 'mail', userId: user.id });
  }
  async sendBrief(user, manual = false) {
    if(!accountActive(user))throw new MailError('Ce compte est suspendu ou archivé.',409);
    if(!manual&&!automationAllowed(this.store.state.settings,'mail',this.clock()))return;
    if (!user.emailConfig?.verified) throw new MailError('Confirmez votre adresse mail avant de recevoir un brief.', 409);
    if (!manual && !user.emailConfig.enabled) return;
    if(!manual&&vacationPaused(user,new Date(this.clock())))return;
    if (this.running.has(user.id)) throw new MailError('Un envoi est déjà en cours.', 409);
    this.running.add(user.id);
    const now = this.clock(), date = parisDate(new Date(now)), jobId = random().slice(0, 16);
    try {
      if (!manual && user.lastBrief?.date === date) return;
      this.audit?.record('mail.started', { source: 'mail', userId: user.id, meta: { mode: manual ? 'preview' : 'daily', jobId } });
      if (!manual) this.store.update(user.id, { lastBrief: { date, at: now, status: 'sending' } });
      const brief = {...buildBrief(user, new Date(now)),...returnBrief(user,new Date(now))};
      const url = this.baseURL + '/#unsubscribe=' + this.store.open(user.emailConfig.unsubscribeKey);
      await this.send(user, briefMessage(user, brief, this.baseURL, url), manual ? 'preview:' + random() : 'daily:' + date);
      if (!manual) this.store.update(user.id, { lastBrief: { date, at: this.clock(), status: 'sent' } });
      this.audit?.record('mail.sent', { source: 'mail', userId: user.id, meta: { mode: manual ? 'preview' : 'daily', jobId, durationMs: this.clock() - now } });
    } catch (error) {
      if (!manual) this.store.update(user.id, { lastBrief: { date, at: this.clock(), status: 'failed', message: 'Le brief n’a pas pu être envoyé. Vérifiez les réglages d’envoi.' } });
      this.audit?.record('mail.failed', { source: 'mail', level: 'error', userId: user.id, meta: { mode: manual ? 'preview' : 'daily', jobId, durationMs: this.clock() - now, errorCode: 'SMTP_SEND_FAILED' } });
      throw error;
    } finally { this.running.delete(user.id); }
  }
  async sendChangeAlerts(user) {
    if (!accountActive(user) || !user.emailConfig?.verified || !user.emailConfig.alertsEnabled || this.running.has(user.id)) return;
    const now = this.clock(), today = parisDate(new Date(now)), pending = (user.emailAlertQueue || []).filter(item => item.status === 'pending' && item.queuedAt > now - 86400000 && item.change.date >= today);
    if (!pending.length) return;
    const ids = new Set(pending.map(item => item.id)), changes = [...new Map(pending.map(item => [item.change.eventId, item.change])).values()];
    const jobId = digest(pending.map(item => item.id).join(':')).slice(0, 16);
    this.running.add(user.id);
    const update = status => this.store.update(user.id, { emailAlertQueue: (user.emailAlertQueue || []).map(item => ids.has(item.id) ? { ...item, status, attemptedAt: now } : item), lastChangeAlert: { at: this.clock(), status, count: changes.length } });
    try {
      update('sending'); this.audit?.record('mail.started', { source: 'mail', userId: user.id, meta: { mode: 'changes', jobId, count: changes.length } });
      const unsubscribe = this.baseURL + '/#unsubscribe=' + this.store.open(user.emailConfig.unsubscribeKey);
      await this.send(user, changeAlertMessage(user, changes, this.baseURL, unsubscribe), 'changes:' + jobId);
      update('sent'); this.audit?.record('mail.sent', { source: 'mail', userId: user.id, meta: { mode: 'changes', jobId, count: changes.length, durationMs: this.clock() - now } });
    } catch {
      update('failed'); this.audit?.record('mail.failed', { source: 'mail', level: 'error', userId: user.id, meta: { mode: 'changes', jobId, errorCode: 'SMTP_SEND_FAILED', durationMs: this.clock() - now } });
    } finally { this.running.delete(user.id); }
  }
  async tick() {
    if (!this.ready || !automationAllowed(this.store.state.settings,'mail',this.clock())) return;
    const now = this.clock(), date = parisDate(new Date(now));
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(now));
    for (const user of this.store.state.users) {
      if(!automationAllowed(this.store.state.settings,'mail',this.clock())||!accountActive(user))continue;
      await this.sendChangeAlerts(user);
      if(vacationPaused(user,new Date(now)))continue;
      if (!user.emailConfig?.verified || !user.emailConfig.enabled || time < user.emailConfig.time || user.lastBrief?.date === date || this.running.has(user.id)) continue;
      if (this.syncUser && now - (user.lastSync || 0) > 15 * 60000 && user.skolengo) {
        try { await this.syncUser(user.id); } catch (error) { if (error.status === 409) continue; }
      }
      await this.sendBrief(user).catch(() => {});
    }
  }
}
