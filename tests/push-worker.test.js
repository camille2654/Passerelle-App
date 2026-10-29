import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function worker(windows=[]){
 const listeners={},shown=[],opened=[],posts=[];
 const self={location:{href:'https://portal.example/agenda/sw.js'},addEventListener:(type,fn)=>{listeners[type]=fn;},registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>windows,openWindow:async url=>opened.push(url)}};
 vm.runInNewContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),{self,URL});
 return {shown,opened,posts,async event(type,fields){let pending;listeners[type]({...fields,waitUntil:promise=>{pending=promise;}});await pending;}};
}

test('push payloads cannot display school details or supply an external notification target',async()=>{
 const w=worker();await w.event('push',{data:{json(){throw new Error('malformed');}}});await w.event('push',{data:{json:()=>({version:1,kind:'unknown'})}});assert.equal(w.shown.length,0);
 await w.event('push',{data:{json:()=>({version:1,kind:'brief',title:'PRIVATE STUDENT',body:'PRIVATE MARK',url:'https://outside.example/'})}});
 assert.equal(w.shown.length,1);assert.equal(w.shown[0].title,'Votre brief de demain');assert.ok(!JSON.stringify(w.shown).includes('PRIVATE'));assert.equal(w.shown[0].options.data.url,'https://portal.example/agenda/#push=tomorrow');
});

test('notification clicks stay inside Passerelle and route an existing app window safely',async()=>{
 let closed=0;const w=worker();for(const url of ['https://outside.example/agenda/#push=changes','javascript:alert(1)','https://portal.example/admin/#push=home','https://portal.example/agenda/#verify-email=untrusted'])await w.event('notificationclick',{notification:{data:{url},close(){closed++;}}});
 assert.equal(closed,4);assert.ok(w.opened.every(url=>url==='https://portal.example/agenda/'));
 const posts=[];let focused=0;const existing=worker([{url:'https://portal.example/agenda/',focus:async()=>{focused++;},postMessage:message=>posts.push(message)}]);
 await existing.event('notificationclick',{notification:{data:{url:'https://portal.example/agenda/#push=changes'},close(){}}});assert.equal(focused,1);assert.equal(existing.opened.length,0);assert.equal(posts[0].type,'passerelle:notification');assert.equal(posts[0].target,'changes');
});


test('event proposal notifications use fixed safe copy and route to the review dialog',async()=>{
 const w=worker();await w.event('push',{data:{json:()=>({version:1,kind:'events',title:'PRIVATE MAIL SUBJECT',body:'PRIVATE ARTICLE CONTENT',target:'https://outside.example/'})}});
 assert.equal(w.shown.length,1);assert.ok(!JSON.stringify(w.shown).includes('PRIVATE'));assert.equal(w.shown[0].options.data.url,'https://portal.example/agenda/#push=events');
 const posts=[],existing=worker([{url:'https://portal.example/agenda/',focus:async()=>{},postMessage:value=>posts.push(value)}]);await existing.event('notificationclick',{notification:{data:{url:'https://portal.example/agenda/#push=events'},close(){}}});assert.equal(posts[0].target,'events');
});
