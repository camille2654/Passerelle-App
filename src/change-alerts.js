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
  const rows = changes.slice(0, 80).map(change => {
    const label = change.type === 'cancelled' ? 'Cours annulé' : change.type === 'restored' ? 'Cours rétabli' : 'Cours modifié';
    const details = [];
    if (change.type === 'updated' && (change.before?.start !== change.after?.start || change.before?.end !== change.after?.end)) {
      const beforeDay = change.before?.start && parisDate(new Date(change.before.start)), afterDay = change.after?.start && parisDate(new Date(change.after.start));
      details.push(beforeDay && afterDay && beforeDay !== afterDay
        ? `Déplacement : ${date(beforeDay)} à ${hour(change.before.start)}–${hour(change.before.end)} → ${date(afterDay)} à ${hour(change.after.start)}–${hour(change.after.end)}`
        : `Horaire : ${hour(change.before?.start)}–${hour(change.before?.end)} → ${hour(change.after?.start)}–${hour(change.after?.end)}`);
    }
    if (change.type === 'updated' && change.before?.location !== change.after?.location) details.push(`Salle : ${change.before?.location || 'non précisée'} → ${change.after?.location || 'non précisée'}`);
    const summary = `${date(change.date)} · ${hour(change.after?.start || change.before?.start)}`;
    return { label, title: change.title, details: [summary, ...details], accent: change.type === 'cancelled' ? '#b65d55' : change.type === 'restored' ? '#59836b' : '#b27c3d', kind: change.type === 'cancelled' ? 'ANNULATION' : change.type === 'restored' ? 'COURS RÉTABLI' : 'MISE À JOUR' };
  });
  const lines = rows.map(row => `${row.label} · ${row.title}\n${row.details.join('\n')}`);
  if (changes.length > 80) lines.push(`${changes.length - 80} autres changements sont à consulter dans le portail.`);
  const subject = `🔔 ${changes.length === 1 ? 'Un changement dans votre emploi du temps' : changes.length + ' changements dans votre emploi du temps'}`;
  const text = [`Bonjour ${user.name},`, 'Ces changements viennent d’être repérés dans les cours publiés par votre ENT.', ...lines, 'Ouvrir votre portail : ' + baseURL + '/', 'Arrêter les notifications : ' + unsubscribeURL].join('\n\n');
  const heading = changes.length === 1 ? 'Un cours a changé' : `${changes.length} changements à connaître`;
  const cards = rows.map(row => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 10px;border:1px solid #e2e8df;border-collapse:separate;border-spacing:0;border-radius:9px;background:#fbfcf8"><tr><td width="4" bgcolor="${row.accent}" style="width:4px;background:${row.accent};font-size:0;line-height:0">&nbsp;</td><td style="padding:13px 15px"><p style="margin:0 0 5px;font-size:10px;line-height:1.4;font-weight:bold;letter-spacing:.5px;color:${row.accent}">${row.kind}</p><strong style="display:block;font-size:13px;line-height:1.5;color:#26352e">${escape(row.title)}</strong><p style="margin:5px 0 0;font-size:11px;line-height:1.65;color:#687463;white-space:pre-line">${escape(row.details.join('\n'))}</p></td></tr></table>`).join('') + (changes.length > 80 ? `<p style="margin:0 0 10px;padding:12px 14px;border:1px solid #e2e8df;border-radius:8px;background:#f8faf5;font-size:11px;line-height:1.65;color:#687463">${changes.length - 80} autres changements sont à consulter dans votre agenda.</p>` : '');
  const html = mailDocument({ title: changes.length === 1 ? 'Un cours a changé · Passerelle' : 'Votre emploi du temps a changé · Passerelle', baseURL,
    content: `<p style="margin:0 0 9px;font-size:10px;line-height:1.5;font-weight:bold;letter-spacing:1.4px;color:#60774c">ALERTE AGENDA</p><h1 style="margin:0 0 12px;font-size:25px;line-height:1.3;letter-spacing:-.4px;color:#153d38">${heading}</h1><p style="margin:0 0 18px;font-size:13px;line-height:1.7;color:#59675d">Bonjour ${escape(user.name)}, Passerelle a repéré ces changements dans les cours publiés par votre ENT.</p><p style="margin:0 0 10px;font-size:10px;font-weight:bold;letter-spacing:.6px;color:#687463">${changes.length} ${changes.length === 1 ? 'COURS CONCERNÉ' : 'COURS CONCERNÉS'}</p>${cards}<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 0;border-collapse:separate"><tr><td align="center" bgcolor="#153d38" style="border-radius:7px;background:#153d38"><a href="${escape(baseURL + '/')}" style="display:inline-block;padding:13px 19px;border:1px solid #153d38;border-radius:7px;background:#153d38;color:#ffffff;font-size:13px;line-height:1.4;font-weight:bold;text-decoration:none">Voir mon agenda</a></td></tr></table>`,
    footer: `Vous avez activé les alertes de changement. <a href="${escape(unsubscribeURL)}" style="color:#205c50">Arrêter les notifications</a>.`
  });
  return { subject, text, html };
}
