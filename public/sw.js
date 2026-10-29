// Private API responses, calendars and ENT images are deliberately network-only.
const VERSION = 'passerelle-public-v4.15.2';
const BASE = new URL('./', self.location.href);
const OFFLINE = new URL('offline.html', BASE).pathname;
const PUBLIC_FILES = ['offline.html', 'offline.css', 'icons/favicon-64.png'].map(name => new URL(name, BASE).pathname);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(PUBLIC_FILES.map(url => new Request(url, { cache: 'reload' })))));
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('passerelle-public-') && key !== VERSION).map(key => caches.delete(key)))), self.clients.claim()]));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== BASE.origin || !url.pathname.startsWith(BASE.pathname)) return;
  if (PUBLIC_FILES.includes(url.pathname)) { event.respondWith(fetch(event.request).catch(() => caches.match(url.pathname))); return; }
  // An offline navigation shows a neutral public page, never the last user's dashboard.
  if (event.request.mode === 'navigate' && !url.pathname.startsWith(BASE.pathname + 'api/') && !url.pathname.startsWith(BASE.pathname + 'calendars/')) {
    event.respondWith(fetch(event.request).catch(async () => await caches.match(OFFLINE) || new Response('Connexion Internet nécessaire.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })));
  }
});

// Push messages contain only generic text. School data remains behind sign-in.
self.addEventListener('push',event=>{
  event.waitUntil((async()=>{
    let payload;try{payload=event.data?.json();}catch{payload=null;}
    if(!payload||payload.version!==1||!['changes','brief','test','events'].includes(payload.kind))return;
    const title=payload.kind==='events'?'Un rendez-vous à vérifier':payload.kind==='brief'?'Votre brief de demain':payload.kind==='changes'?'Votre agenda a changé':'Passerelle · Notifications activées';
    const body=payload.kind==='events'?'Une proposition est à consulter dans votre espace Passerelle.':payload.kind==='brief'?'Consultez vos cours, devoirs et contrôles pour demain dans Passerelle.':payload.kind==='changes'?'Des nouveautés sont à consulter dans Passerelle.':'Les notifications fonctionnent sur cet appareil.';
    const target=payload.kind==='events'?'events':payload.kind==='changes'?'changes':payload.kind==='brief'?'tomorrow':'home';
    await self.registration.showNotification(title,{body,tag:'passerelle-'+payload.kind,icon:new URL('icons/app-192.png',BASE).href,badge:new URL('icons/favicon-64.png',BASE).href,data:{url:new URL('./#push='+target,BASE).href},renotify:false});
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    let destination;try{destination=new URL(event.notification.data?.url||'./',BASE);}catch{destination=new URL('./',BASE);}
    if(destination.origin!==BASE.origin||destination.pathname!==BASE.pathname||!/^#push=(?:changes|tomorrow|home|events)$/.test(destination.hash))destination=new URL('./',BASE);
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client=windows.find(window=>{try{const url=new URL(window.url);return url.origin===BASE.origin&&url.pathname===BASE.pathname;}catch{return false;}});
    if(client){await client.focus();client.postMessage({type:'passerelle:notification',target:destination.hash.slice(6)||'home'});}
    else await self.clients.openWindow(destination.href);
  })());
});
self.addEventListener('message',event=>{
  if(event.data?.type==='passerelle:close-notifications')event.waitUntil(self.registration.getNotifications().then(items=>{for(const item of items)item.close();}));
});
