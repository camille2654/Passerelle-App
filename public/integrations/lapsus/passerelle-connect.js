// Passerelle → Lapsus. Public client: no client secret belongs in browser code.
const issuer='https://repere.84.235.226.127.sslip.io/agenda';
const clientId='lapsus';
const redirectURI='https://mon-ent.pages.dev/passerelle/callback';
const storageKey='lapsus.passerelle.authorization.v1';
const allowedScopes=['calendar:courses','calendar:homework','calendar:exams'];
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const nonce=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
function ensureOrigin(){if(location.origin!=='https://mon-ent.pages.dev')throw new Error('Cette connexion est réservée à mon-ent.pages.dev.');}
const validAccount=value=>typeof value==='string'&&value.length>0&&value.length<=200;

export async function connectPasserelle(scopes=['calendar:courses'],{accountKey}={}){
  ensureOrigin();
  if(!validAccount(accountKey))throw new Error('Connectez-vous à votre compte Lapsus avant de relier Passerelle.');
  if(!Array.isArray(scopes)||!scopes.length||scopes.length>3||new Set(scopes).size!==scopes.length||scopes.some(scope=>!allowedScopes.includes(scope)))throw new Error('Choisissez les agendas à demander.');
  const state=nonce(),verifier=nonce();
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  sessionStorage.setItem(storageKey,JSON.stringify({state,verifier,at:Date.now(),scopes,accountKey}));
  const url=new URL(issuer+'/oauth/authorize');
  for(const [key,value]of Object.entries({client_id:clientId,response_type:'code',redirect_uri:redirectURI,scope:scopes.join(' '),state,code_challenge:challenge,code_challenge_method:'S256'}))url.searchParams.set(key,value);
  location.assign(url.href);
}

export async function finishPasserelleConnection({accountKey,getAccountKey}={}){
  ensureOrigin();
  if(location.origin+location.pathname!==redirectURI)throw new Error('Adresse de retour Passerelle incorrecte.');
  const params=new URLSearchParams(location.search);
  // Consume immediately, including error paths; never leave authorization codes in history.
  const raw=sessionStorage.getItem(storageKey);sessionStorage.removeItem(storageKey);
  history.replaceState(null,'',location.pathname);
  let saved;try{saved=JSON.parse(raw||'null');}catch{}
  if(!saved||typeof saved.at!=='number'||Date.now()-saved.at>10*60000||Date.now()<saved.at||!params.get('state')||params.get('state')!==saved.state||params.get('iss')!==issuer)throw new Error('Cette connexion a expiré ou ne provient pas de Passerelle. Relancez-la depuis Lapsus.');
  if(params.get('error')==='access_denied')throw new Error('Le partage de l’agenda a été refusé.');
  const resolvedAccountKey=typeof getAccountKey==='function'?await getAccountKey():accountKey;
  if(!validAccount(resolvedAccountKey)||saved.accountKey!==resolvedAccountKey)throw new Error('Le compte Lapsus a changé. Relancez la connexion depuis le bon compte.');
  const code=params.get('code');if(!/^[A-Za-z0-9_-]{43}$/.test(code||''))throw new Error('Le code de connexion est absent ou invalide.');
  const response=await fetch(issuer+'/oauth/token',{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',client_id:clientId,redirect_uri:redirectURI,code,code_verifier:saved.verifier}),signal:AbortSignal.timeout(20000)});
  const token=await response.json();
  if(!response.ok)throw new Error(token.error_description||'La connexion Passerelle n’a pas abouti. Relancez-la.');
  const result=await fetch(issuer+'/api/partner/calendars',{credentials:'omit',cache:'no-store',headers:{Authorization:'Bearer '+token.access_token},signal:AbortSignal.timeout(20000)});
  const value=await result.json();
  if(!result.ok)throw new Error(value.error_description||'Impossible de récupérer les agendas autorisés.');
  if(!Array.isArray(value.calendars)||!value.calendars.length||value.calendars.some(row=>!allowedScopes.includes(row.scope)||!saved.scopes.includes(row.scope)||!validCalendarURL(row.url)))throw new Error('La réponse Passerelle est inattendue.');
  // Return to the caller. No tokens or ICS links are stored by this helper.
  return value.calendars;
}

export async function readPasserelleCalendar(calendar,{etag,signal}={}){
  if(!validCalendarURL(calendar.url))throw new Error('Lien d’agenda Passerelle invalide.');
  const url=new URL(calendar.url);
  const response=await fetch(url,{credentials:'omit',cache:'no-store',headers:etag?{'If-None-Match':etag}:{},signal:signal||AbortSignal.timeout(20000)});
  if(response.status===304)return {unchanged:true,etag};
  if(response.status===404)throw Object.assign(new Error('Cet accès a été retiré ou l’agenda a changé. Reconnectez Passerelle.'),{code:'PASSERELLE_DISCONNECTED'});
  if(!response.ok)throw new Error('L’agenda est momentanément indisponible.');
  const ics=await response.text();
  if(!/^text\/calendar\b/i.test(response.headers.get('Content-Type')||'')||!ics.replace(/^\uFEFF/,'').startsWith('BEGIN:VCALENDAR'))throw new Error('La réponse reçue n’est pas un agenda ICS. La dernière copie doit être conservée.');
  return {unchanged:false,ics,etag:response.headers.get('ETag')};
}
function validCalendarURL(value){try{const url=new URL(value);return url.origin===new URL(issuer).origin&&!url.username&&!url.password&&/^\/agenda\/partner-calendars\/[A-Za-z0-9_-]{43}\.ics$/.test(url.pathname)&&!url.search&&!url.hash;}catch{return false;}}
