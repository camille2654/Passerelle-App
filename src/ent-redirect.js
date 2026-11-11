import {randomBytes} from 'node:crypto';
import {allowedEntURL} from './ent-providers.js';
import {PublicError} from './sync.js';

const escape=value=>String(value).replace(/[&<>"'\r\n]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','\r':'&#13;','\n':'&#10;'}[c]));
const failure=(message,code)=>Object.assign(new PublicError(message,502),{code});

// Chromium/Playwright routing only sees the first request of an HTTP redirect
// chain. Turn each navigation redirect into a fresh browser navigation, so the
// PRONOTE response is intercepted before Start consumes its one-time session.
// Cookies stay in the same ephemeral browser context. No target or body is logged.
export function entRedirectDocument(request,status,headers,provider){
 if(![301,302,303,307,308].includes(status)||!headers.location)return null;
 let target;try{target=new URL(headers.location,request.url());}catch{throw failure('Le portail ENT a renvoyé une adresse de connexion invalide.','SSO_REDIRECT_INVALID');}
 if(target.href.length>16000||!allowedEntURL(target.href,provider))throw failure('Le portail ENT redirige vers un service qui n’est pas autorisé pour cette connexion.','SSO_REDIRECT_BLOCKED');
 const method=request.method().toUpperCase();
 let body,nonce;
 if(method==='POST'&&[307,308].includes(status)){
  // Preserve SAML/CAS POST redirects without changing them into GET requests.
  // Only browser form bodies can be replayed faithfully by a browser form.
  const type=request.headers()['content-type']||'',data=request.postDataBuffer();
  if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(type)||!data||data.length>1024*1024)throw failure('Le format de redirection de ce portail ENT n’est pas encore pris en charge. Signalez ce problème à l’assistance.','SSO_REDIRECT_POST_UNSUPPORTED');
  let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{throw failure('Le formulaire de redirection ENT est invalide.','SSO_REDIRECT_INVALID');}
  const fields=[...new URLSearchParams(source)];if(fields.length>200)throw failure('Le formulaire de redirection ENT est trop volumineux.','SSO_REDIRECT_INVALID');
  nonce=randomBytes(18).toString('base64');
  body='<form id="ent-handoff" method="post" accept-charset="UTF-8" action="'+escape(target.href)+'">'+fields.map(([key,value])=>'<input type="hidden" name="'+escape(key)+'" value="'+escape(value)+'">').join('')+'</form><script nonce="'+nonce+'">HTMLFormElement.prototype.submit.call(document.getElementById("ent-handoff"));</script>';
 }else body='<meta http-equiv="refresh" content="0;url='+escape(target.href)+'">';
 const clean={...headers};for(const key of ['location','content-length','content-encoding','refresh','content-security-policy','content-security-policy-report-only'])delete clean[key];
 Object.assign(clean,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; base-uri 'none'; form-action "+target.origin+"; script-src "+(nonce?"'nonce-"+nonce+"'":"'none'")});
 return {headers:clean,body:'<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Connexion au lycée</title></head><body>'+body+'<p>Connexion en cours…</p></body></html>'};
}
