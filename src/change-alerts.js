import { mailDocument } from './brand.js';
import { digest } from './store.js';
import { parisDate } from './work.js';

export function changeAlertQueue(user, changes, now = Date.now()) {
  if (!user.lastSync || !user.emailConfig?.verified || !user.emailConfig.alertsEnabled) return [];
  const today = parisDate(new Date(now));
  const previous = (user.emailAlertQueue || []).filter(item => item.queuedAt > now - 7 * 86400000);
  const ids = new Set(previous.map(item => item.id));
  const incoming = changes.filter(change => change.date >= today && change.at >= (user.emailConfig.alertsSince || now) && (['cancelled', 'restored'].includes(change.type) || change.type === 'updated' && ['start', 'end', 'location'].some(key => change.before?.[key] !== change.after?.[key]))).map(change => ({ id: digest(user.id + ':' + change.id), change, queuedAt: now, status: 'pending' })).filter(item => !ids.has(item.id));
  return [...previous, ...incoming].slice(-200);
}
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hour = iso => iso ? new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : 'non précisé';
const date = day => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(day + 'T12:00:00Z'));
export function changeAlertMessage(user, changes, baseURL, unsubscribeURL) {
  const lines = changes.slice(0, 80).map(change => {
    const label = change.type === 'cancelled' ? 'Cours annulé' : change.type === 'restored' ? 'Cours rétabli' : 'Cours modifié';
    const details = [];
    if (change.type === 'updated' && (change.before?.start !== change.after?.start || change.before?.end !== change.after?.end)) {
      const beforeDay = change.before?.start && parisDate(new Date(change.before.start)), afterDay = change.after?.start && parisDate(new Date(change.after.start));
      details.push(beforeDay && afterDay && beforeDay !== afterDay
        ? `Déplacement : ${date(beforeDay)} à ${hour(change.before.start)}–${hour(change.before.end)} → ${date(afterDay)} à ${hour(change.after.start)}–${hour(change.after.end)}`
        : `Horaire : ${hour(change.before?.start)}–${hour(change.before?.end)} → ${hour(change.after?.start)}–${hour(change.after?.end)}`);
    }
    if (change.type === 'updated' && change.before?.location !== change.after?.location) details.push(`Salle : ${change.before?.location || 'non précisée'} → ${change.after?.location || 'non précisée'}`);
    return `${label} · ${change.title}\n${date(change.date)} · ${hour(change.after?.start || change.before?.start)}${details.length ? '\n' + details.join('\n') : ''}`;
  });
  if (changes.length > 80) lines.push(`${changes.length - 80} autres changements sont à consulter dans le portail.`);
  const subject = `🔔 ${changes.length === 1 ? 'Un changement dans votre emploi du temps' : changes.length + ' changements dans votre emploi du temps'}`;
  const text = [`Bonjour ${user.name},`, 'Ces changements viennent d’être repérés dans les cours publiés par votre ENT.', ...lines, 'Ouvrir votre portail : ' + baseURL + '/', 'Arrêter les notifications : ' + unsubscribeURL].join('\n\n');
  const html = mailDocument({ title: 'Votre emploi du temps a changé · Passerelle', baseURL,
    content: `<p style="font-size:10px;font-weight:bold;letter-spacing:1.5px;color:#63754e;margin:0 0 14px">UN CHANGEMENT À CONNAÎTRE</p><h1 style="font-size:25px;line-height:1.3;color:#153d38">Votre emploi du temps a changé</h1><p>Bonjour ${escape(user.name)}, ces changements viennent d’être repérés dans votre ENT.</p>${lines.map(line => `<p style="white-space:pre-line;background:#f0f4e5;border:1px solid #dfe6d2;border-radius:10px;padding:14px;line-height:1.7">${escape(line)}</p>`).join('')}<p><a href="${escape(baseURL + '/')}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#153d38;color:#f6f5ef;font-weight:bold;text-decoration:none">Ouvrir mon portail</a></p>`,
    footer: `Vous avez activé les alertes de changement. <a href="${escape(unsubscribeURL)}" style="color:#205c50">Arrêter les notifications</a>.`
  });
  return { subject, text, html };
}
