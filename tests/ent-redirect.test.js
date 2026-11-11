import test from 'node:test';
import assert from 'node:assert/strict';
import {entRedirectDocument} from '../src/ent-redirect.js';
import {portalForURL} from '../src/ent-providers.js';
const provider=portalForURL('https://test.ent.auvergnerhonealpes.fr/').provider;
const request=(method='GET',type='',body='')=>({url:()=> 'https://test.ent.auvergnerhonealpes.fr/cas/login',method:()=>method,headers:()=>({'content-type':type}),postDataBuffer:()=>Buffer.from(body)});
test('navigation redirects become fresh navigations with private cookies and no inherited content restrictions',()=>{
 for(const code of [301,302,303,307,308]){
  const r=entRedirectDocument(request(),code,{location:'https://demo.index-education.net/pronote/eleve.html?ticket=synthetic&x=1','set-cookie':'session=synthetic','content-length':'12','content-encoding':'gzip','content-security-policy':"default-src 'self'"},provider);
  assert.match(r.body,/http-equiv="refresh"/);assert.match(r.body,/ticket=synthetic&amp;x=1/);assert.equal(r.headers['set-cookie'],'session=synthetic');assert.equal(r.headers['content-length'],undefined);assert.equal(r.headers['content-encoding'],undefined);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers.location,undefined);
 }
 assert.equal(entRedirectDocument(request(),200,{},provider),null);
});
test('POST 302 and 303 switch to GET, while 307 and 308 retain form fields under a nonce',()=>{
 for(const code of [302,303])assert.match(entRedirectDocument(request('POST'),code,{location:'/next'},provider).body,/http-equiv="refresh"/);
 for(const code of [307,308]){
  const r=entRedirectDocument(request('POST','application/x-www-form-urlencoded','SAMLResponse=synthetic%2B%3C%22&submit=safe&repeat=1&repeat=2'),code,{location:'https://demo.index-education.net/pronote/eleve.html'},provider);
  assert.match(r.body,/method="post"/);assert.match(r.body,/synthetic\+&lt;&quot;/);assert.equal((r.body.match(/name="repeat"/g)||[]).length,2);assert.match(r.body,/HTMLFormElement.prototype.submit/);assert.match(r.headers['content-security-policy'],/script-src 'nonce-/);
 }
});
test('redirect validation rejects untrusted hosts, unsafe URLs and unsupported POST bodies',()=>{
 for(const location of ['http://demo.index-education.net/pronote/eleve.html','https://untrusted.invalid/','https://demo.index-education.net.evil.invalid/','https://user:secret@demo.index-education.net/'])assert.throws(()=>entRedirectDocument(request(),302,{location},provider),e=>e.code==='SSO_REDIRECT_BLOCKED');
 assert.throws(()=>entRedirectDocument(request('POST','application/json','{}'),307,{location:'/next'},provider),e=>e.code==='SSO_REDIRECT_POST_UNSUPPORTED');
 assert.throws(()=>entRedirectDocument(request('POST','application/x-www-form-urlencoded','x'.repeat(1048577)),307,{location:'/next'},provider),e=>e.code==='SSO_REDIRECT_POST_UNSUPPORTED');
});
