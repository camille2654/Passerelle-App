import { createHash } from 'node:crypto';

export const PALETTE = [
  { value: 'royalblue', label: 'Bleu', hex: '#4169e1' },
  { value: 'seagreen', label: 'Vert', hex: '#2e8b57' },
  { value: 'darkorange', label: 'Orange', hex: '#ff8c00' },
  { value: 'crimson', label: 'Rouge', hex: '#dc143c' },
  { value: 'slateblue', label: 'Violet', hex: '#6a5acd' },
  { value: 'teal', label: 'Turquoise', hex: '#008080' },
  { value: 'mediumvioletred', label: 'Rose', hex: '#c71585' },
  { value: 'darkgoldenrod', label: 'Ocre', hex: '#b8860b' },
  { value: 'forestgreen', label: 'Forêt', hex: '#228b22' },
  { value: 'dodgerblue', label: 'Ciel', hex: '#1e90ff' },
  { value: 'orangered', label: 'Corail', hex: '#ff4500' },
  { value: 'slategray', label: 'Ardoise', hex: '#708090' }
];
export const EMOJIS = ['📐', '📚', '🗺️', '🇬🇧', '🇪🇸', '🇩🇪', '🇮🇹', '🧪', '🌿', '⚗️', '⚽', '💻', '🧠', '📊', '🎨', '🎵', '⚙️', '📖', '🔬', '🌍', '📝'];
const rules = [
  [/math/, '📐', 'royalblue'], [/francais|litterature/, '📚', 'crimson'], [/histoire|geograph|enseignement moral|\bemc\b/, '🗺️', 'darkorange'],
  [/anglais|english|\bangl?\b/, '🇬🇧', 'seagreen'], [/espagn|\besp\b/, '🇪🇸', 'orangered'], [/allemand|\ball\b/, '🇩🇪', 'darkgoldenrod'], [/italien/, '🇮🇹', 'forestgreen'],
  [/physique|chimie/, '⚗️', 'slateblue'], [/\bsvt\b|vie.*terre|biolog/, '🌿', 'forestgreen'], [/sport|\beps\b|education physique/, '⚽', 'darkorange'],
  [/informati|numerique|\bsnt\b|\bnsi\b/, '💻', 'teal'], [/philosoph/, '🧠', 'slateblue'], [/econom|\bses\b|gestion/, '📊', 'darkgoldenrod'],
  [/art|plastique/, '🎨', 'mediumvioletred'], [/musique/, '🎵', 'dodgerblue'], [/technolog|ingenieur/, '⚙️', 'slategray'], [/science/, '🧪', 'seagreen']
];
export const normalizeLabel = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const subjectKey = label => createHash('sha256').update(normalizeLabel(label)).digest('hex').slice(0, 20);
export function subjectFor(subject, fallback = 'Autre matière', styles = {}) {
  const label = String(subject?.label || fallback || 'Autre matière').trim().slice(0, 120);
  const key = subjectKey(label), normalized = normalizeLabel(label);
  const rule = rules.find(([pattern]) => pattern.test(normalized));
  const seed = parseInt(key.slice(0, 8), 16);
  const defaults = { emoji: rule?.[1] || '📖', color: rule?.[2] || PALETTE[seed % PALETTE.length].value };
  const custom = styles[key] || {};
  const color = PALETTE.some(c => c.value === custom.color) ? custom.color : defaults.color;
  const emoji = EMOJIS.includes(custom.emoji) ? custom.emoji : defaults.emoji;
  return { key, label, emoji, color, hex: PALETTE.find(c => c.value === color).hex };
}
export function styledTitle(title, subject) {
  return String(title || '').startsWith(subject.emoji) ? String(title) : subject.emoji + ' ' + title;
}
