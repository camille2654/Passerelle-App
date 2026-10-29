import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';

export const AUDIT_LABELS = {
  'incoming.failed':'Partage interrompu','incoming.saved':'Contenu partagé conservé',
  'personal.mail.connected':'Messagerie personnelle reliée','personal.mail.disconnected':'Messagerie personnelle déconnectée','personal.mail.configured':'Applications des messageries configurées','personal.mail.failed':'Connexion à une messagerie interrompue',
  'events.scanned':'Événements du lycée vérifiés','events.failed':'Vérification des événements interrompue','events.accepted':'Événement confirmé dans l’agenda',
  'capture.read':'Photo de devoir lue','capture.failed':'Photo de devoir illisible','favorite.added':'Document ajouté aux favoris','favorite.downloaded':'Document favori téléchargé','favorite.removed':'Document retiré des favoris',
  'push.subscribed':'Notifications de l’app activées','push.removed':'Notifications de l’app désactivées','push.preferences':'Préférences de l’app enregistrées','push.accepted':'Notification acceptée par le service','push.failed':'Envoi de notification interrompu',
  'admin.elevated':'Accès administrateur vérifié', 'admin.job.created':'Opération administrateur préparée', 'admin.job.cancelled':'Annulation administrateur demandée', 'admin.job.completed':'Opération administrateur terminée', 'admin.command.applied':'Commande administrateur appliquée', 'admin.command.failed':'Commande administrateur interrompue', 'admin.secret.revealed':'Lien privé administrateur affiché', 'security.password_reset':'Mot de passe réinitialisé',
  'support.created': 'Signalement créé', 'support.updated': 'Signalement traité', 'pronote.connected': 'Pronote connecté', 'pronote.confirmed': 'Élève Pronote associé', 'pronote.synced': 'Pronote actualisé', 'pronote.failed': 'Pronote indisponible', 'pronote.disconnected': 'Pronote déconnecté',
  'personal.focus':'Minuteur personnel modifié',
  'school.loaded': 'Rubrique ENT consultée', 'school.failed': 'Rubrique ENT indisponible',
  'bag.updated': 'Matériel du sac mis à jour', 'study.planned': 'Révisions planifiées', 'friends.invited': 'Lien de disponibilités créé', 'friends.accepted': 'Partage réciproque de créneaux accepté', 'friends.removed': 'Partage de créneaux retiré',
  'system.started': 'Portail démarré', 'system.stopped': 'Portail arrêté',
  'security.registered': 'Compte créé', 'security.login': 'Connexion au portail', 'security.logout': 'Déconnexion du portail', 'admin.invited': 'Invitation créée', 'admin.registration': 'Inscriptions publiques modifiées',
  'feed.created': 'Abonnement ICS créé', 'feed.rotated': 'Lien ICS renouvelé', 'feed.revoked': 'Abonnement ICS désactivé',
  'http.request': 'Requête du portail', 'feed.read': 'Lecture d’un abonnement ICS',
  'sync.started': 'Synchronisation démarrée', 'sync.completed': 'Synchronisation terminée', 'sync.failed': 'Synchronisation interrompue',
  'mail.configured': 'Expéditeur configuré', 'mail.configuration_failed': 'Échec de connexion à l’expéditeur',
  'mail.assigned': 'Adresse associée à un compte', 'mail.verification_sent': 'Confirmation transmise à l’adresse associée',
  'mail.verified': 'Adresse confirmée', 'mail.unsubscribed': 'Notifications désactivées', 'mail.removed': 'Adresse retirée',
  'mail.started': 'Envoi du brief démarré', 'mail.sent': 'Brief accepté par le serveur d’envoi', 'mail.failed': 'Échec d’envoi du brief',
  'admin.exported': 'Journal exporté', 'admin.integrity': 'Intégrité du journal vérifiée'
};
const fields = new Set(['status', 'durationMs', 'method', 'route', 'added', 'updated', 'deleted', 'count', 'homework', 'mode', 'errorCode', 'requestId', 'jobId', 'peer', 'changes', 'verified', 'enabled', 'mailReady']);
const safe = value => String(value).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[adresse masquée]').replace(/[A-Za-z0-9_\-]{40,}/g, '[secret masqué]').replace(/[\r\n\t]/g, ' ').slice(0, 180);

// Append-only, keyed hash chain. This detects modification and truncation against
// the separately signed head; it cannot protect against an administrator who has
// access to both the server key and the log files.
export class AuditLog {
  constructor(store, { clock = () => Date.now(), maxRows = 10000, maxBytes = 5 * 1024 * 1024, retentionDays = 30, maxFiles = 60 } = {}) {
    this.dir = path.join(store.dir, 'logs'); this.clock = clock; this.maxRows = maxRows; this.maxBytes = maxBytes; this.retentionDays = retentionDays; this.maxFiles = maxFiles;
    this.key = createHmac('sha256', store.key).update('passerelle-audit-v1').digest();
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.headFile = path.join(this.dir, 'head.json'); this.rows = []; this.head = '0'; this.writeError = false;
    this.maintenance();
    this.integrity = this.verify();
    for (const name of this.files()) {
      for (const line of fs.readFileSync(path.join(this.dir, name), 'utf8').split('\n').filter(Boolean)) {
        try { const row = JSON.parse(line); this.head = row.hash; this.rows.push(row); } catch { /* Reported by verify(). */ }
      }
      if (this.rows.length > this.maxRows) this.rows = this.rows.slice(-this.maxRows);
    }
  }
  files() { return fs.readdirSync(this.dir).filter(name => /^\d{4}-\d{2}-\d{2}-\d{6}\.jsonl$/.test(name)).sort(); }
  sign(value) { return createHmac('sha256', this.key).update(JSON.stringify(value)).digest('hex'); }
  peer(ip) { return createHmac('sha256', this.key).update(new Date(this.clock()).toISOString().slice(0, 10) + ':' + ip).digest('hex').slice(0, 16); }
  maintenance() {
    const cutoff = new Date(this.clock() - this.retentionDays * 86400000).toISOString().slice(0, 10);
    const names = this.files();
    for (let i = 0; i < names.length; i++) if (names[i].slice(0, 10) < cutoff || i < names.length - this.maxFiles) fs.rmSync(path.join(this.dir, names[i]));
    if (this.rows) this.rows = this.rows.filter(row => row.at >= this.clock() - this.retentionDays * 86400000);
  }
  record(event, { level = 'info', source = 'system', actorId = null, userId = null, meta = {} } = {}) {
    if (this.integrity && !this.integrity.ok) { this.writeError = true; return null; }
    try {
      const at = this.clock(), day = new Date(at).toISOString().slice(0, 10);
      if (this.day !== day) { this.maintenance(); this.day = day; }
      const clean = Object.fromEntries(Object.entries(meta).filter(([key]) => fields.has(key)).map(([key, value]) => [key, typeof value === 'number' || typeof value === 'boolean' ? value : safe(value)]));
      const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
      const payload = { id: randomUUID(), at, level: ['info', 'warn', 'error'].includes(level) ? level : 'info', source: ['system', 'http', 'security', 'sync', 'mail', 'admin', 'feed', 'push', 'personal'].includes(source) ? source : 'system', event: Object.hasOwn(AUDIT_LABELS, event) ? event : 'http.request', actorId: id(actorId), userId: id(userId), meta: clean, previous: this.head };
      const row = { ...payload, hash: this.sign(payload) };
      let names = this.files().filter(name => name.startsWith(day));
      let name = names.at(-1) || day + '-000001.jsonl';
      if (fs.existsSync(path.join(this.dir, name)) && fs.statSync(path.join(this.dir, name)).size >= this.maxBytes) name = day + '-' + String(Number(name.slice(11, 17)) + 1).padStart(6, '0') + '.jsonl';
      fs.appendFileSync(path.join(this.dir, name), JSON.stringify(row) + '\n', { mode: 0o600 });
      if (!names.includes(name)) this.maintenance();
      const head = { hash: row.hash, file: name }; const checkpoint = { ...head, signature: this.sign(head) };
      fs.writeFileSync(this.headFile + '.tmp', JSON.stringify(checkpoint), { mode: 0o600 }); fs.renameSync(this.headFile + '.tmp', this.headFile);
      this.head = row.hash; this.rows.push(row); if (this.rows.length > this.maxRows) this.rows.shift(); this.writeError = false;
      return row.id;
    } catch { this.writeError = true; return null; }
  }
  verify() {
    let previous = null, count = 0, lastFile = null;
    try {
      for (const name of this.files()) {
        lastFile = name;
        for (const line of fs.readFileSync(path.join(this.dir, name), 'utf8').split('\n').filter(Boolean)) {
          const { hash, ...payload } = JSON.parse(line);
          if (this.sign(payload) !== hash || (previous && payload.previous !== previous)) throw new Error('chain');
          previous = hash; count++;
        }
      }
      if (fs.existsSync(this.headFile)) {
        const { signature, ...head } = JSON.parse(fs.readFileSync(this.headFile, 'utf8'));
        if (this.sign(head) !== signature || (previous && (head.hash !== previous || head.file !== lastFile)) || (!previous && head.file.slice(0, 10) >= new Date(this.clock() - this.retentionDays * 86400000).toISOString().slice(0, 10))) throw new Error('head');
      } else if (previous) throw new Error('checkpoint');
      return { ok: true, checkedAt: this.clock(), count };
    } catch { return { ok: false, checkedAt: this.clock(), count }; }
  }
  query(input = {}) {
    const from = input.from ? Date.parse(String(input.from)) : 0, until = input.to ? Date.parse(String(input.to) + (String(input.to).length === 10 ? 'T23:59:59.999Z' : '')) : Infinity;
    const search = String(input.q || '').slice(0, 100).toLowerCase();
    const matches = this.rows.filter(row => row.at >= from && row.at <= until && (!input.level || row.level === input.level) && (!input.source || row.source === input.source) && (!input.userId || row.userId === input.userId || row.actorId === input.userId) && (!search || (AUDIT_LABELS[row.event] + ' ' + row.event + ' ' + row.id + ' ' + JSON.stringify(row.meta)).toLowerCase().includes(search))).reverse();
    const offset = Math.max(0, Math.min(10000, Number(input.offset) || 0)), limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
    return { rows: matches.slice(offset, offset + limit).map(row => ({ ...row, label: AUDIT_LABELS[row.event] })), total: matches.length, offset, limit, retained: this.rows.length, retentionDays: this.retentionDays, windowLimit: this.maxRows, integrity: { ...this.integrity, writeError: this.writeError } };
  }
  overview() {
    const since = this.clock() - 86400000, recent = this.rows.filter(row => row.at >= since);
    const completed = recent.filter(row => row.event === 'sync.completed');
    return { events: recent.length, errors: recent.filter(row => row.level === 'error').length, warnings: recent.filter(row => row.level === 'warn').length, syncs: completed.length, sent: recent.filter(row => row.event === 'mail.sent').length, averageSyncMs: completed.length ? Math.round(completed.reduce((n, row) => n + (row.meta.durationMs || 0), 0) / completed.length) : null, since, integrity: { ...this.integrity, writeError: this.writeError } };
  }
}
