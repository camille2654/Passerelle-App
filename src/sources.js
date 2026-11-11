import {normalizeLabel} from './subjects.js';

export const pronoteBinding = user => String(user.studentId || '') + ':' + String(user.schoolName || '');
export const linkedPronote = user => !!user.pronote && !!user.studentId && user.pronoteBinding === pronoteBinding(user);
export function mergeSourceWork(user) {
  if(user.entConnectionKind==='pronote')return linkedPronote(user)?(user.pronoteAssignments||[]).map(item=>({...item,sources:['Pronote']})):[];
  const ent = (user.assignments || []).map(item => ({...item, sources: ['ENT']}));
  if (!linkedPronote(user)) return ent;
  const fingerprint = item => [item.due, normalizeLabel(item.subjectLabel), normalizeLabel(item.details || item.title)].join('|');
  const byFingerprint = new Map();
  for (const item of ent) { const key = fingerprint(item); byFingerprint.set(key, byFingerprint.has(key) ? null : item); }
  const possibleTitles=new Map();for(const item of ent){const key=item.due+'|'+normalizeLabel(item.subjectLabel);if(!possibleTitles.has(key))possibleTitles.set(key,[]);possibleTitles.get(key).push(normalizeLabel(item.title));}
  const possible=item=>{const title=normalizeLabel(item.title);return (possibleTitles.get(item.due+'|'+normalizeLabel(item.subjectLabel))||[]).some(old=>Math.min(old.length,title.length)>=8&&(old.startsWith(title)||title.startsWith(old)));};
  const output = [...ent], matched = new Set();
  for (const item of user.pronoteAssignments || []) {
    const same = byFingerprint.get(fingerprint(item));
    if (same && !matched.has(same.id)) { same.sources = ['ENT', 'Pronote']; same.pronoteId = item.id; matched.add(same.id); }
    else output.push({...item, sources: ['Pronote'], possibleDuplicate: possible(item)});
  }
  return output;
}
