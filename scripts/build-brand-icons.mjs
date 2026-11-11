import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Original Passerelle geometry. 24-unit grid, 1.65-unit round strokes,
// small openings and occasional seed dots echo the bridge brand mark.
export const ICON_STROKE = 1.65;
export const categories = {navigation:'Se repérer',actions:'Agir',organisation:'S’organiser',scolarite:'Au lycée',documents:'Documents et échanges',compte:'Espace personnel',transport:'Se déplacer',matieres:'Matières'};
export const icons = [
  {
    "name": "arrow",
    "label": "Continuer",
    "category": "navigation",
    "markup": "<path d=\"M4.5 12h13M13 6.5l5.5 5.5-5.5 5.5\"/><circle cx=\"4.5\" cy=\"12\" r=\".7\" fill=\"currentColor\" stroke=\"none\"/>"
  },
  {
    "name": "sync",
    "label": "Synchroniser",
    "category": "actions",
    "markup": "<path d=\"M18.5 8A7.3 7.3 0 0 0 6 6.5L3.5 9m0-5v5h5M5.5 16A7.3 7.3 0 0 0 18 17.5L20.5 15m0 5v-5h-5\"/>"
  },
  {
    "name": "check",
    "label": "Valider",
    "category": "actions",
    "markup": "<path d=\"M4.5 12.5 9.5 17 19.5 6.5\"/>"
  },
  {
    "name": "lock",
    "label": "Confidentialité",
    "category": "compte",
    "markup": "<path d=\"M7 10V7.5a5 5 0 0 1 10 0V10M5.5 10h13v8a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3Z\"/><path d=\"M12 14v2.5\"/>"
  },
  {
    "name": "clock",
    "label": "Horaires",
    "category": "organisation",
    "markup": "<path d=\"M9 3.5a8.8 8.8 0 1 0 6 0M12 3v9l4 2.5\"/><circle cx=\"12\" cy=\"3\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/>"
  },
  {
    "name": "calendar",
    "label": "Agenda",
    "category": "organisation",
    "markup": "<path d=\"M7.5 3v5m9-5v5M5 5.5h14a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8m0-3v-1a1 1 0 0 1 1-1M3 11h18M8 15.5h3m3 0h2\"/>"
  },
  {
    "name": "copy",
    "label": "Copier",
    "category": "actions",
    "markup": "<path d=\"M8 7h10a3 3 0 0 1 3 3v11H11a3 3 0 0 1-3-3Zm7-3H6a3 3 0 0 0-3 3v9\"/>"
  },
  {
    "name": "out",
    "label": "Lien externe",
    "category": "navigation",
    "markup": "<path d=\"M13.5 4H20v6.5M20 4 9.5 14.5M9 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-3\"/>"
  },
  {
    "name": "close",
    "label": "Fermer",
    "category": "navigation",
    "markup": "<path d=\"m6 6 12 12M6 18 18 6\"/>"
  },
  {
    "name": "users",
    "label": "Amis et groupe",
    "category": "compte",
    "markup": "<path d=\"M3 20v-2a5 5 0 0 1 5-5h3a5 5 0 0 1 5 5v2m1-7a4 4 0 0 1 4 4v3M18 4.5a3 3 0 0 1 0 6\"/><circle cx=\"9.5\" cy=\"6\" r=\"3.5\"/>"
  },
  {
    "name": "activity",
    "label": "Bilan et activité",
    "category": "organisation",
    "markup": "<path d=\"M4 5v15h16M8 15v-4m4 4V7m4 8v-2\"/><circle cx=\"19.5\" cy=\"4\" r=\"1.2\" fill=\"currentColor\" stroke=\"none\"/>"
  },
  {
    "name": "pin",
    "label": "Lieu",
    "category": "transport",
    "markup": "<path d=\"M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 2.2.8 4.4 2.5 6.8\"/><circle cx=\"12\" cy=\"9\" r=\"2.5\"/>"
  },
  {
    "name": "mail",
    "label": "Messagerie",
    "category": "documents",
    "markup": "<path d=\"M3 7.5 12 14l9-6.5M6 5h12a3 3 0 0 1 3 3v11H6a3 3 0 0 1-3-3v-4\"/>"
  },
  {
    "name": "book",
    "label": "Cours",
    "category": "scolarite",
    "markup": "<path d=\"M12 6v15M12 6C9.5 4 6 3.5 3 4v14c3-.5 6.5 0 9 3 2.5-3 6-3.5 9-3V4c-2-.4-4-.2-6 .6M6 8l3 .8m-3 3 3 .8\"/>"
  },
  {
    "name": "bag",
    "label": "Mon sac",
    "category": "scolarite",
    "markup": "<path d=\"M8 7V5a4 4 0 0 1 8 0v2M7 7h10a3 3 0 0 1 3 3v11H4V10a3 3 0 0 1 3-3Zm1 7h8v4H8m0-8v2m8-2v2\"/>"
  },
  {
    "name": "study",
    "label": "Révisions",
    "category": "scolarite",
    "markup": "<path d=\"m3 9 9-5 9 5-9 5-9-5Zm4 3v5c3 3 7 3 10 0v-5m4-3v8\"/><circle cx=\"21\" cy=\"19\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/>"
  },
  {
    "name": "phone",
    "label": "Application mobile",
    "category": "compte",
    "markup": "<path d=\"M16 2.5H8a3 3 0 0 0-3 3v16h11a3 3 0 0 0 3-3v-13a3 3 0 0 0-3-3M10 6h4m-3 12h2\"/>"
  },
  {
    "name": "sun",
    "label": "Ma journée",
    "category": "organisation",
    "markup": "<path d=\"M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5\"/><circle cx=\"12\" cy=\"12\" r=\"4.5\"/>"
  },
  {
    "name": "bell",
    "label": "Notifications",
    "category": "compte",
    "markup": "<path d=\"M5 16.5h14l-2-3V9a5 5 0 0 0-10 0v4.5l-2 3Zm5 3a2 2 0 0 0 4 0M12 2v2\"/>"
  },
  {
    "name": "palette",
    "label": "Personnalisation",
    "category": "compte",
    "markup": "<path d=\"M13 21h-1a9 9 0 1 1 8.3-5.5c-.5 1-2 1-3.1.5-1.9-.9-3.4 1-2.4 2.5.7 1.1-.4 2.5-1.8 2.5Z\"/><path d=\"M7 10h.1M10 6.5h.1M15 7h.1\" stroke-width=\"2.8\"/>"
  },
  {
    "name": "exit",
    "label": "Déconnexion",
    "category": "compte",
    "markup": "<path d=\"M10 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h4m4-14 5 5-5 5m-6-5h11\"/>"
  },
  {
    "name": "cutlery",
    "label": "Menu du lycée",
    "category": "scolarite",
    "markup": "<path d=\"M6 3v6m-3-6v4a3 3 0 0 0 6 0V3M6 10v11M18 3c-3 2-4 5-4 9h4m0-9v18\"/>"
  },
  {
    "name": "plus",
    "label": "Ajouter",
    "category": "actions",
    "markup": "<path d=\"M12 4v16M4 12h16\"/>"
  },
  {
    "name": "search",
    "label": "Rechercher",
    "category": "navigation",
    "markup": "<path d=\"M16 16l5 5M12 5a5 5 0 0 1 5 5\"/><circle cx=\"10.5\" cy=\"10.5\" r=\"7.5\"/><circle cx=\"21\" cy=\"21\" r=\".7\" fill=\"currentColor\" stroke=\"none\"/>"
  },
  {
    "name": "cards",
    "label": "Mes outils",
    "category": "navigation",
    "markup": "<path d=\"M5 3h12a3 3 0 0 1 3 3v12M3 7h12a3 3 0 0 1 3 3v11H6a3 3 0 0 1-3-3V7Zm4 5h6m-6 4h4\"/>"
  },
  {
    "name": "support",
    "label": "Aide et assistance",
    "category": "compte",
    "markup": "<path d=\"M4 20v-5a8 8 0 1 1 8 5H4Zm5-9a3 3 0 0 1 6 0m-6 0v2m6-2v2m-5 3h4\"/>"
  },
  {
    "name": "sources",
    "label": "Connexions",
    "category": "compte",
    "markup": "<path d=\"M5 18V9a5 5 0 0 1 10 0v9m-6-3V6a5 5 0 0 1 10 0v12M3 21h18\"/><circle cx=\"5\" cy=\"18\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/>"
  },
  {
    "name": "terminal",
    "label": "Console administrateur",
    "category": "compte",
    "markup": "<path d=\"M3 5h15a3 3 0 0 1 3 3v13H6a3 3 0 0 1-3-3V5Zm4 4 3 3-3 3m6 0h4\"/><circle cx=\"4\" cy=\"3\" r=\"1\" fill=\"currentColor\" stroke=\"none\"/>"
  },
  {
    "name": "settings",
    "label": "Réglages",
    "category": "compte",
    "markup": "<path d=\"M3.5 6h2.2m4.6 0h10.2M3.5 12h10.2m4.6 0h2.2M3.5 18h4.2m4.6 0h8.2\"/><circle cx=\"8\" cy=\"6\" r=\"2.3\"/><circle cx=\"16\" cy=\"12\" r=\"2.3\"/><circle cx=\"10\" cy=\"18\" r=\"2.3\"/>"
  }
];

const extra = [
 ['home','Accueil','navigation','<path d="m3 10 9-7 9 7v10H6a3 3 0 0 1-3-3v-3m6 6v-7h6v7"/><circle cx="3" cy="10" r=".75" fill="currentColor" stroke="none"/>'],
 ['homework','Devoirs','scolarite','<path d="M8 4h9a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V4m4 0V2.5m8 1.5V2.5M8 9h8m-8 4h4m-4 4 1.5 1.5L13 15"/><circle cx="4" cy="4" r=".75" fill="currentColor" stroke="none"/>'],
 ['exam','Contrôles','scolarite','<path d="M5 5h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V9m4-6h8v4H8V3Zm0 8h3m-3 4h2m3-2 2 2 3-4"/><circle cx="4" cy="5" r=".75" fill="currentColor" stroke="none"/>'],
 ['note','Notes de cours','scolarite','<path d="M12 4H7a3 3 0 0 0-3 3v13h10a3 3 0 0 0 3-3v-3M8 10h3m-3 4h2m3-5 5.7-5.7a1.4 1.4 0 0 1 2 2L15 11l-3 1 1-3Zm3.7-3.7 2 2"/>'],
 ['focus','Concentration','organisation','<path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4M9 9h2v6H9V9Zm4 0h2v6h-2V9Z"/><circle cx="12" cy="3" r=".75" fill="currentColor" stroke="none"/>'],
 ['document','Document','documents','<path d="M14 3H7a3 3 0 0 0-3 3v15h13a3 3 0 0 0 3-3v-9l-6-6Zm0 0v6h6M8 13h8m-8 4h5"/>'],
 ['folder','Dossier','documents','<path d="M3 9V5h6l3 3h6a3 3 0 0 1 3 3v9H6a3 3 0 0 1-3-3v-4m5-1h8"/><circle cx="3" cy="9" r=".75" fill="currentColor" stroke="none"/>'],
 ['star','Favoris','documents','<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9"/><circle cx="12" cy="3" r=".75" fill="currentColor" stroke="none"/>'],
 ['share','Partager','documents','<path d="m8 8 7-3m-7 7 7 5"/><circle cx="5" cy="10" r="3"/><circle cx="18" cy="4" r="2.5"/><circle cx="18" cy="19" r="2.5"/>'],
 ['download','Télécharger','actions','<path d="M12 3v11m-4-4 4 4 4-4M4 15v5h16v-5"/><circle cx="12" cy="3" r=".75" fill="currentColor" stroke="none"/>'],
 ['upload','Importer','actions','<path d="M12 15V4m-4 4 4-4 4 4M4 15v5h16v-5"/><circle cx="12" cy="15" r=".75" fill="currentColor" stroke="none"/>'],
 ['bus','Bus','transport','<path d="M5 18V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v11H5Zm0 0v3m14-3v3M5 10h14M9 3h6M8 14h1m6 0h1"/><circle cx="5" cy="18" r=".75" fill="currentColor" stroke="none"/>'],
 ['train','Train','transport','<path d="M5 14V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Zm0-4h14m-7-7v7m-4 4h1m6 0h1M9 18l-4 4m10-4 4 4m-12-2h10"/>'],
 ['tram','Tramway','transport','<path d="M7 3h10m-5 0v3M5 16V9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v7l-3 3H8l-3-3Zm0-5h14m-7-5v5M9 19l-2 3m8-3 2 3m-9-6h1m6 0h1"/>'],
 ['route','Itinéraire','transport','<path d="M6 18V7a3 3 0 0 1 6 0v10a3 3 0 0 0 6 0V8m-3 3 3-3 3 3"/><circle cx="6" cy="20" r="2"/>'],
 ['walk','À pied','transport','<circle cx="14" cy="4" r="2"/><path d="m6 11 5-3 3 1 2 4h4M11 8l-2 7-4 5m4-5 5 2 1 4M9 15l4-5"/>'],
 ['news','Actualités','documents','<path d="M4 5h12a3 3 0 0 1 3 3v13H6a3 3 0 0 1-3-3V9m16 1h2v8a3 3 0 0 1-3 3M7 9h7m-7 4h3m-3 4h3m4-4h1m-1 4h1"/><circle cx="3" cy="5" r=".75" fill="currentColor" stroke="none"/>'],
 ['moon','Ma soirée','organisation','<path d="M20.5 14.3A9 9 0 0 1 9.7 3.5a9 9 0 1 0 10.8 10.8Z"/><circle cx="19" cy="5" r="1" fill="currentColor" stroke="none"/>'],
 ['key','Clé d’accès','compte','<path d="m12 12 8-8m-3 3 3 3m-1-5 2 2"/><circle cx="7.5" cy="16.5" r="5"/><circle cx="6" cy="18" r=".75" fill="currentColor" stroke="none"/>'],
 ['image','Photo','documents','<path d="M4 5h13a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3v-8m0 7 5-5 4 4 3-3 4 4"/><circle cx="15" cy="9" r="1.5"/><circle cx="4" cy="5" r=".75" fill="currentColor" stroke="none"/>'],
 ['globe','Monde et géographie','matieres','<path d="M12 3c-5 4.5-5 13.5 0 18m0-18c5 4.5 5 13.5 0 18M3.5 9h17m-17 6h17"/><circle cx="12" cy="12" r="9"/>'],
 ['math','Mathématiques','matieres','<path d="M5 4h12a3 3 0 0 1 3 3v13H7a3 3 0 0 1-3-3V9m3-1h10m-9 4v5m-2-2.5h4m4-1.5h3m-3 3h3"/><circle cx="4" cy="4" r=".75" fill="currentColor" stroke="none"/>'],
 ['science','Sciences','matieres','<path d="M9 3h6m-5 0v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7 15h10"/><circle cx="10" cy="18" r=".8" fill="currentColor" stroke="none"/>'],
 ['languages','Langues','matieres','<path d="M3 5h11M8.5 3v2m-3 0c.3 5 2.3 7.8 6 10m0-10c-.7 5.8-3 9.3-7.5 12M13 21l4-10 4 10m-6.5-3h5"/>'],
 ['sport','Sport','matieres','<path d="M7 5h10v6a5 5 0 0 1-10 0V5Zm0 2H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 2v5m-4 0h8"/><circle cx="12" cy="3" r=".75" fill="currentColor" stroke="none"/>'],
 ['art','Arts','matieres','<path d="m5 16 9-9 3 3-9 9-3-3Zm9-9 3-3a2.1 2.1 0 0 1 3 3l-3 3M5 16c-2 0-3 1-3 4 3 0 4-1 4-3"/><circle cx="19" cy="16" r="1" fill="currentColor" stroke="none"/>'],
 ['shield','Compte protégé','compte','<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Zm-4 9 3 3 5-6"/>']
];
for (const [name,label,category,markup] of extra) icons.push({name,label,category,markup});

const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const findIcon = name => {const icon=icons.find(row=>row.name===name);if(!icon)throw new Error('Unknown Passerelle icon: '+name);return icon;};
export function iconMarkup(name) {return findIcon(name).markup;}
export function iconSymbol(name,{prefix='i-'}={}) {return `<symbol id="${escape(prefix+name)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round">${iconMarkup(name)}</symbol>`;}
export function iconSVG(name,{size=24,color='#153D38',label=null}={}) {const icon=findIcon(name);return `<svg xmlns="http://www.w3.org/2000/svg" width="${Number(size)}" height="${Number(size)}" viewBox="0 0 24 24" fill="none" color="${escape(color)}" stroke="currentColor" stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round"${label===null?' role="img"':label===''?' aria-hidden="true"':' role="img"'}>${label!==''?`<title>${escape(label??icon.label)}</title>`:''}${icon.markup}</svg>`;}

export function buildIconPack(destination) {
 fs.mkdirSync(destination,{recursive:true});
 for(const icon of icons)fs.writeFileSync(path.join(destination,icon.name+'.svg'),iconSVG(icon.name)+'\n');
 fs.writeFileSync(path.join(destination,'sprite.svg'),`<svg xmlns="http://www.w3.org/2000/svg"><defs>${icons.map(icon=>iconSymbol(icon.name)).join('')}</defs></svg>\n`);
 fs.writeFileSync(path.join(destination,'manifest.json'),JSON.stringify({name:'Passerelle · Repères',version:'2.0',grid:24,stroke:ICON_STROKE,license:'GPL-3.0-or-later',categories,icons:icons.map(({name,label,category})=>({name,label,category,file:name+'.svg',symbol:'i-'+name}))},null,2)+'\n');
 const groups=Object.entries(categories).map(([id,title])=>`<section aria-labelledby="group-${id}"><div class="section-heading"><h2 id="group-${id}">${escape(title)}</h2><span>${icons.filter(icon=>icon.category===id).length} icônes</span></div><div class="grid">${icons.filter(icon=>icon.category===id).map(icon=>`<a class="tile" href="${icon.name}.svg" download><span class="glyph">${iconSVG(icon.name,{size:36,label:''})}</span><strong>${escape(icon.label)}</strong><small>${escape(icon.name)} · SVG</small></a>`).join('')}</div></section>`).join('');
 fs.writeFileSync(path.join(destination,'preview.html'),`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Repères — Les icônes de Passerelle</title><link rel="stylesheet" href="preview.css"></head><body><header class="masthead"><a href="../" class="brand"><img src="../symbol.png" width="36" height="36" alt="">passerelle</a><a class="return" href="../">L’espace de marque ↗</a></header><main><div class="hero"><p class="eyebrow">LA FAMILLE REPÈRES / ÉDITION 02</p><h1>De petits signes.<br>De grands repères.</h1><p class="intro">${icons.length} icônes dessinées pour Passerelle. Un trait souple, de petites ouvertures et un point qui fait le lien avec notre symbole.</p><div class="specs"><span>Grille 24 × 24</span><span>Trait 1,65</span><span>SVG modifiables</span></div></div><nav class="category-nav" aria-label="Catégories d’icônes">${Object.entries(categories).map(([id,title])=>`<a href="#group-${id}">${escape(title)}</a>`).join('')}</nav>${groups}<section class="usage"><p class="eyebrow">POUR LES UTILISER</p><h2>Un fichier, un repère.</h2><p>Touchez une icône pour télécharger son SVG. Les contours restent nets à toutes les tailles. Le sprite regroupe toute la famille et le manifeste donne les noms et catégories.</p><div class="downloads"><a href="passerelle-icons.zip" download>Toutes les icônes (ZIP)</a><a href="sprite.svg" download>Télécharger le sprite</a><a href="manifest.json" download>Manifeste JSON</a><a href="README.md">Guide d’utilisation</a></div></section></main><footer><span>Passerelle · Ta journée prend forme.</span><span>Créations originales · GPL-3.0-or-later</span></footer></body></html>\n`);
 fs.writeFileSync(path.join(destination,'preview.css'),`@font-face{font-family:Manrope;src:url('../../fonts/manrope-variable.ttf') format('truetype');font-weight:200 800;font-display:swap}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:28px}body{margin:0;background:#f6f5ef;color:#153d38;font-family:Manrope,system-ui,sans-serif;line-height:1.6}.masthead,main,footer{max-width:1160px;margin:auto;padding-left:40px;padding-right:40px}.masthead{display:flex;justify-content:space-between;align-items:center;padding-top:32px;padding-bottom:24px}.brand{display:flex;align-items:center;gap:9px;color:inherit;text-decoration:none;font-size:23px;font-weight:800;letter-spacing:-1px}.return{color:#456454;font-size:12px}.hero{padding:65px 0 42px;border-bottom:1px solid #cfd7c9}.eyebrow{font-size:10px;letter-spacing:2px;font-weight:750;margin:0 0 19px}h1{font-size:clamp(42px,6.5vw,78px);line-height:1.06;letter-spacing:-3px;max-width:800px;margin:0 0 24px}.intro{max-width:560px;color:#4d6457;font-size:16px}.specs{display:flex;flex-wrap:wrap;gap:9px;margin-top:27px}.specs span{font-size:11px;padding:7px 13px;border:1px solid #cbd4bd;border-radius:20px;background:#eaf0d9}.category-nav{display:flex;gap:8px;flex-wrap:wrap;padding:28px 0}.category-nav a{font-size:12px;padding:6px 11px;text-decoration:none;color:inherit;border-radius:18px;border:1px solid #d7dece}.category-nav a:hover{background:#d9ef78}.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:35px;margin-bottom:20px}.section-heading h2{font-size:22px;letter-spacing:-.7px;margin:0}.section-heading span{font-size:11px;color:#63716a}.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.tile{min-height:160px;display:flex;align-items:center;flex-direction:column;text-decoration:none;color:inherit;padding:25px 8px 17px;border:1px solid #dfe4d8;background:#fffefa;border-radius:15px;text-align:center;transition:background .18s,border-color .18s,transform .18s}.tile:hover{background:#eaf1d9;border-color:#b7ca8d;transform:translateY(-3px)}.glyph{display:grid;place-items:center;width:54px;height:54px;margin-bottom:15px;border-radius:16px;background:#edf2e5}.tile:nth-child(3n+2) .glyph{background:#f8e9e0}.tile:nth-child(3n) .glyph{background:#e8edf8}.glyph svg{display:block;color:#153d38}.tile strong{font-size:11px;font-weight:750;line-height:1.4}.tile small{font-size:9px;color:#63716a;margin-top:5px}.usage{margin-top:70px;padding:32px;background:#153d38;border-radius:22px;color:#f6f5ef}.usage .eyebrow{color:#d9ef78}.usage h2{font-size:28px;letter-spacing:-1px;margin:0}.usage p:not(.eyebrow){color:#cfdbcd;max-width:650px;font-size:14px}.downloads{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.downloads a{background:#d9ef78;color:#153d38;border-radius:10px;padding:10px 15px;font-size:12px;font-weight:750;text-decoration:none}footer{display:flex;justify-content:space-between;gap:20px;font-size:10px;color:#63716a;padding-top:35px;padding-bottom:35px}a:focus-visible{outline:3px solid #a2b853;outline-offset:4px}@media(max-width:850px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(max-width:560px){.masthead,main,footer{padding-left:20px;padding-right:20px}.masthead{padding-top:21px}.brand{font-size:21px}.return{font-size:10px}.hero{padding-top:35px}h1{font-size:46px;letter-spacing:-2px}.intro{font-size:14px}.grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.tile{padding:18px 5px 15px;min-height:145px}.tile strong{font-size:10px}.tile small{font-size:8px}.glyph{width:48px;height:48px}.usage{padding:23px}footer{flex-direction:column;gap:4px}}@media(prefers-color-scheme:dark){body{background:#101f1c;color:#e5eddf}.hero{border-color:#35483b}.intro,.return,.section-heading span,.tile small,footer{color:#b1c0b0}.specs span{background:#293e30;border-color:#465e36}.category-nav a{border-color:#35483b}.category-nav a:hover{background:#354e30}.tile{background:#1b2e27;border-color:#35483b}.tile:hover{background:#2a4230;border-color:#769450}.glyph,.tile:nth-child(3n+2) .glyph,.tile:nth-child(3n) .glyph{background:#d9ef78}.usage{border:1px solid #35483b}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.tile{transition:none}.tile:hover{transform:none}}\n`);
 fs.writeFileSync(path.join(destination,'README.md'),`# Passerelle · Repères\n\n${icons.length} icônes originales pour Passerelle, édition 2. Grille 24 × 24, trait 1,65 unité, extrémités et angles arrondis. Les petites ouvertures et les points reprennent le langage graphique du symbole Passerelle.\n\n## Fichiers\n\n- Un SVG autonome par icône ; la couleur par défaut est le vert forêt #153D38.\n- sprite.svg : symboles préfixés i- pour l’application.\n- manifest.json : nom technique, libellé français et catégorie.\n- preview.html et preview.css : galerie responsive accessible sans JavaScript.\n\n## Intégration\n\nDocument externe : <svg aria-hidden="true" viewBox="0 0 24 24"><use href="sprite.svg#i-calendar"/></svg>. Donner au contrôle un libellé accessible. Pour une icône porteuse de sens seule, ajouter role="img" et aria-label au SVG.\n\nSVG inline : conserver viewBox, fill, stroke et les attributs d’arrondi ; adapter la propriété CSS color. Les fichiers autonomes contiennent un title descriptif. Pour une icône décorative, retirer ce title et ajouter aria-hidden="true". Ne pas appliquer de remplissage global aux contours.\n\nTailles conseillées : 20, 24, 32 ou 48 px. Préserver la grille carrée, la largeur du trait et les espaces internes. Pour un fond, utiliser un aplat de la palette Passerelle ; ne pas ajouter d’ombre au pictogramme.\n\n## Régénération\n\nnode scripts/build-brand-icons.mjs\n\nLa source exporte icons, categories, iconMarkup, iconSymbol et iconSVG pour les compositions de marque.\n\n## Droits\n\nDessins originaux réalisés pour le projet Passerelle ; aucune bibliothèque tierce d’icônes. Distribués avec le projet sous GPL-3.0-or-later. La présence des formes de bus, train et tram ne signifie pas qu’un réseau de transport est connecté.\n`);
 return {count:icons.length,destination};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 console.log(JSON.stringify(buildIconPack(path.join(root,'public/brand/icons-v2'))));
}
