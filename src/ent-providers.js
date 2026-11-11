/* Trusted portal families. OIDC discovery URLs must match the catalogue exactly.
 * Sources and the distinction between Skolengo and ENT→PRONOTE are in docs/MULTI_ENT.md. */
const rows = [
 ['rra','ENT Auvergne-Rhône-Alpes','Auvergne-Rhône-Alpes','ent.auvergnerhonealpes.fr'],
 ['gdest','Mon Bureau Numérique','Grand Est','monbureaunumerique.fr'],
 ['entmip','Mon ENT Occitanie','Occitanie','mon-ent-occitanie.fr'],
 ['bfc','Éclat-BFC','Bourgogne-Franche-Comté','eclat-bfc.fr'],
 ['cg76','Arsène 76','Seine-Maritime','arsene76.fr'],
 ['cg27','ENT27','Eure','ent27.fr'],
 ['cg23','ENT Creuse','Creuse','entcreuse.fr'],
 ['cg06','Agora 06','Alpes-Maritimes','agora06.fr'],
 ['cg42','Cybercollèges 42','Loire','cybercolleges42.fr'],
 ['cg31','eCollège 31','Haute-Garonne','ecollege.haute-garonne.fr'],
 ['cg95','Mon collège en Val d’Oise','Val-d’Oise','moncollege.valdoise.fr'],
 ['cg93','Webcollège','Seine-Saint-Denis','webcollege.seinesaintdenis.fr'],
 ['cg84','@ucollège84','Vaucluse','aucollege84.vaucluse.fr'],
 ['cg94','Mon collège en Val-de-Marne','Val-de-Marne','moncollege.valdemarne.fr'],
 ['metab1d','Skolengo · écoles','Plusieurs régions','skolengo.com'],
 ['mpdl','Skolengo · collèges et lycées','Plusieurs régions','pdl.kosmoseducation.com'],
 ['metab','AEFE','International','skolengo.com','sso1.skolengo.com'],
 ['metabam','AEFE Amérique-Pacifique','International','skolengo.com','sso2.skolengo.com'],
 ['cgb','Schulportal Ostbelgien','Belgique','schulen.be']
];
export const ENT_PROVIDERS = Object.freeze(rows.map(([id,label,region,domain,sso])=>Object.freeze({id,label,region,domain,family:'skolengo',discovery:`https://${sso || 'sso.'+domain}/oidc/.well-known`})));
const additional = [
 {id:'monlycee',label:'Monlycée.net',region:'Île-de-France',domain:'monlycee.net',aliases:['ent.iledefrance.fr']},
 {id:'lyceeconnecte',label:'Lycée Connecté',region:'Nouvelle-Aquitaine',domain:'lyceeconnecte.fr',aliases:['jeunes.nouvelle-aquitaine.fr']},
 {id:'atrium',label:'Atrium',region:'Provence-Alpes-Côte d’Azur',domain:'atrium-sud.fr'},
 {id:'hdf',label:'ENT Hauts-de-France',region:'Hauts-de-France',domain:'enthdf.fr'},
 {id:'normandie',label:'L’Éduc de Normandie',region:'Normandie',domain:'l-educdenormandie.fr'},
 {id:'toutatice',label:'Toutatice',region:'Bretagne',domain:'toutatice.fr'},
 {id:'netocentre',label:'NET O’Centre',region:'Centre-Val de Loire',domain:'netocentre.fr'},
 {id:'elyco',label:'e-lyco',region:'Pays de la Loire',domain:'e-lyco.fr'},
 {id:'wilapa',label:'Wilapa',region:'Guyane',domain:'wilapa.fr'}
].map(item=>Object.freeze({...item,family:'ent-pronote'}));
export const PORTAL_PROVIDERS = Object.freeze([...ENT_PROVIDERS,...additional]);
export const trustedSchool = school => ENT_PROVIDERS.find(p=>p.id===school?.emsCode && p.discovery===school.emsOIDCWellKnownUrl) || null;
const inDomain=(host,root)=>host===root||host.endsWith('.'+root);
export function portalForURL(input, preferred) {
 let url;try{url=new URL(String(input));}catch{return null;}
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash||String(input).length>1500)return null;
 // URLs are login entry points, never arbitrary local hosts or custom OIDC issuers.
 const provider=(preferred?PORTAL_PROVIDERS.filter(p=>p.id===preferred):PORTAL_PROVIDERS).find(p=>[p.domain,...(p.aliases||[])].some(root=>inDomain(url.hostname,root)));
 return provider?{provider,url:url.href}:null;
}
const AUTH_DOMAINS=['education.gouv.fr','educagri.fr','skolengo.com','kosmoseducation.com','gstatic.com','google.com','googleapis.com','index-education.net'];
export function allowedEntURL(input,provider) {
 try{const u=new URL(input);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&([provider.domain,...(provider.aliases||[]),...AUTH_DOMAINS].some(root=>inDomain(u.hostname,root))||/^(?:[a-z0-9-]+\.)*ac-[a-z0-9-]+\.fr$/.test(u.hostname));}catch{return false;}
}
export function publicProvider(school) {const p=trustedSchool(school);return p?{id:p.id,label:p.label,region:p.region,family:p.family}:null;}
export const publicProviders=()=>PORTAL_PROVIDERS.map(({id,label,region,family})=>({id,label,region,family}));
