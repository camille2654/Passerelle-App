import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { menuPeriod, parseBBox, parseTSV, extractDayBlocks, extractMenuPDF } from '../src/menu-pdf.js';
import { attachmentURL } from '../src/school.js';
import { menuClient,menuParser } from './menu-fixture.js';
import { createApp } from '../src/server.js';
import { random, digest } from '../src/store.js';

const period={start:'2026-11-02',end:'2026-11-06'}, clock=()=>Date.parse('2026-11-02T11:00:00Z');
const schoolConfig={id:'school',name:'Lycée des Horizons',emsCode:'rra',emsOIDCWellKnownUrl:'https://sso.ent.auvergnerhonealpes.fr/oidc/.well-known'};
const w=(text,x,y)=>({text,x,y,w:Math.max(20,text.length*5),h:10,confidence:95});
test('French weekly menu ranges cover month/year boundaries without guessing an absent year',()=>{
  assert.deepEqual(menuPeriod('Menus du 2 au 6 novembre 2026'),period);
  assert.deepEqual(menuPeriod('menus du 2 au 6 novembre.pdf','2026-10-16T12:00:00Z'),period);
  assert.deepEqual(menuPeriod('Menus du 28 décembre au 1er janvier 2027'),{start:'2026-12-28',end:'2027-01-01'});
  assert.deepEqual(menuPeriod('Menus du 28 au 1 janvier','2026-12-20T12:00:00Z'),{start:'2026-12-28',end:'2027-01-01'});
  assert.equal(menuPeriod('Menus du 2 au 6 novembre'),null);assert.equal(menuPeriod('Menus du 31 au 32 novembre 2026'),null);assert.equal(menuPeriod('Menus de novembre 2026'),null);
});
test('vertical days stay separate, absent Wednesday is never filled, and signatures/footers are excluded',()=>{
  const page={index:1,width:600,height:800,ocr:true,words:[w('LUNDI',40,100),w('Salade',40,125),w('Pates',40,145),w('MARDI',450,230),w('Poisson',40,260),w('Legumes',40,280),w('JEUDI',40,360),w('Poulet',40,390),w('Riz',40,410),w('VENDREDI',440,500),w('Soupe',40,530),w('Fruits',40,550),w('Produits subventionnés',40,600),w('NOM DU SIGNATAIRE',40,650)]};
  const days=extractDayBlocks([page],period);assert.deepEqual(Object.keys(days),['2026-11-02','2026-11-03','2026-11-05','2026-11-06']);
  assert.deepEqual(days['2026-11-02'].items,['Salade','Pates']);assert.ok(!JSON.stringify(days).includes('SIGNATAIRE'));assert.ok(!JSON.stringify(days['2026-11-02'].items).includes('Poisson'));
});
test('columns are separated geometrically and duplicated/ambiguous weekdays are rejected',()=>{
  const page={index:1,width:600,height:800,words:[w('Lundi',120,100),w('Mardi',420,100),w('Salade',50,150),w('Pates',50,180),w('Poisson',350,150),w('Riz',350,180)]};
  const days=extractDayBlocks([page],period);assert.deepEqual(days['2026-11-02'].items,['Salade','Pates']);assert.deepEqual(days['2026-11-03'].items,['Poisson','Riz']);
  assert.deepEqual(extractDayBlocks([page,{...page,index:2}],period),{});
  assert.deepEqual(extractDayBlocks([{...page,words:page.words.map(word=>({...word,confidence:25})),ocr:true}],period),{});
});
test('bounded PDF and OCR coordinate readers keep real positions and reject missing/invalid PDF data',async()=>{
  const pages=parseBBox('<page width="600" height="800"><word xMin="10" yMin="20" xMax="50" yMax="30">Pâtes &amp; riz</word></page>');assert.equal(pages[0].words[0].text,'Pâtes & riz');
  const tsv='level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n1\t1\t0\t0\t0\t0\t0\t0\t600\t800\t-1\t\n5\t1\t1\t1\t1\t1\t10\t20\t50\t10\t95\tLUNDI';assert.equal(parseTSV(tsv).words[0].y,20);
  await assert.rejects(extractMenuPDF(Buffer.from('not a pdf'),period),/INVALID_MENU_PDF/);
});
function pdf(objects){let content=Buffer.from('%PDF-1.4\n'),offsets=[0];objects.forEach((object,index)=>{offsets.push(content.length);content=Buffer.concat([content,Buffer.from((index+1)+' 0 obj\n'),Buffer.isBuffer(object)?object:Buffer.from(object),Buffer.from('\nendobj\n')]);});const start=content.length;return Buffer.concat([content,Buffer.from('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n'+offsets.slice(1).map(value=>String(value).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF')]);}
function testPDF(){const stream='BT /F1 16 Tf 50 730 Td (LUNDI) Tj 0 -30 Td (Salade du jardin) Tj 0 -30 Td (Pates au fromage) Tj 0 -30 Td (Fruits de saison) Tj 0 -120 Td (MARDI) Tj 0 -30 Td (Poisson du jour) Tj 0 -30 Td (Riz et legumes) Tj 0 -30 Td (Yaourt nature) Tj ET';return pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream']);}
test('native PDFs and scanned PDFs both produce the correct day plus a private source excerpt',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'menu-pdf-test-'));
  try {
    const source=testPDF();const native=await extractMenuPDF(source,period);assert.equal(native.ocr,false);assert.ok(native.days['2026-11-02'].items.join(' ').includes('Pates'));assert.ok(native.days['2026-11-02'].image.length>1000);
    fs.writeFileSync(path.join(dir,'source.pdf'),source);execFileSync('pdftoppm',['-f','1','-singlefile','-scale-to','1800','-jpeg',path.join(dir,'source.pdf'),path.join(dir,'scan')]);const jpg=fs.readFileSync(path.join(dir,'scan.jpg'));
    const dimensions=execFileSync('pdfinfo',[path.join(dir,'source.pdf')],{encoding:'utf8'});assert.ok(dimensions.includes('595'));
    // pdftoppm scales the longest side to 1800: 595/842*1800 rounds to 1272.
    const stream='q 595 0 0 842 0 0 cm /Im0 Do Q';
    const image=Buffer.concat([Buffer.from('<< /Type /XObject /Subtype /Image /Width 1272 /Height 1800 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+jpg.length+' >>\nstream\n'),jpg,Buffer.from('\nendstream')]);
    const scanned=pdf(['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',image,'<< /Length '+stream.length+' >>\nstream\n'+stream+'\nendstream']);
    const result=await extractMenuPDF(scanned,period);assert.equal(result.ocr,true);assert.ok(result.days['2026-11-03'].items.join(' ').includes('Poisson'));assert.equal(result.days['2026-11-04'],undefined);
  } finally{fs.rmSync(dir,{recursive:true,force:true});}
});

async function fixture(){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'passerelle-menu-test-')),control={};const source=createApp({dataDir:dir,baseURL:'http://127.0.0.1/agenda',bootstrap:false,clock,schoolOptions:{clientFactory:async(store,user)=>menuClient(user,control)},menuOptions:{parser:menuParser}});const cookies={};for(const id of ['a','b','offline']){source.store.state.users.push({id,name:'Fixture',login:id,studentId:'student-'+id,...(id!=='offline'?{skolengo:source.store.seal({school:schoolConfig})}:{})});const token=random();cookies[id]='agenda_session='+token;source.store.state.sessions.push({hash:digest(token),userId:id,expires:Date.now()+60000});}source.store.save();const server=source.app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));return {...source,control,async request(route,user='a'){const response=await fetch('http://127.0.0.1:'+server.address().port+'/agenda/api/'+route,{headers:{cookie:cookies[user]||''}});return {status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer()),headers:response.headers};},async close(){await source.browsers.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}};}
test('menu responses select the requested Paris date, preserve missing days and share no private refs across accounts',async()=>{
  const f=await fixture();try{
    assert.equal((await f.request('menu','anonymous')).status,401);assert.equal((await f.request('menu','offline')).body.status,'not_connected');assert.equal((await f.request('menu?date=2026-02-31')).status,400);
    const monday=(await f.request('menu')).body;assert.equal(monday.date,'2026-11-02');assert.equal(monday.items[0],'Salade du jardin');assert.ok(!JSON.stringify(monday).includes('fixture=private'));assert.equal((await f.request('menu?date=2026-11-03')).body.items[0],'Poisson et riz');
    const missing=(await f.request('menu?date=2026-11-04')).body;assert.equal(missing.status,'not_published');assert.deepEqual(missing.items,[]);assert.equal(missing.next.date,'2026-11-05');
    assert.equal((await f.request('menu/image/'+monday.imageRef)).status,200);assert.equal((await f.request('menu/image/'+monday.imageRef,'b')).status,410);assert.equal((await f.request('menu/image/'+monday.imageRef,'anonymous')).status,401);assert.equal((await f.request('school/files/'+monday.source.fileRef,'b')).status,410);
    assert.equal(f.control.options.maxRedirects,0);assert.equal(f.control.options.maxContentLength,8*1024*1024);
  }finally{await f.close();}
});
test('weekly discovery is cached and an ENT outage preserves only the menu for the exact requested day',async()=>{
  const f=await fixture();try{await f.request('menu');const count=f.control.discoveries;await f.request('menu');assert.equal(f.control.discoveries,count);f.control.fail=true;const old=(await f.request('menu?refresh=1')).body;assert.equal(old.status,'available');assert.ok(old.warning);assert.ok(!old.warning.includes('private'));const missing=(await f.request('menu?date=2026-11-04&refresh=1')).body;assert.equal(missing.status,'not_published');assert.deepEqual(missing.items,[]);}finally{await f.close();}
});
test('only the official regional file gateway is allowed for a verified AURA school context',()=>{
  const valid='https://horizons.ent.auvergnerhonealpes.fr/lectureFichiergw.do?fixture=private';assert.equal(attachmentURL(valid,schoolConfig),valid);assert.equal(attachmentURL(valid),null);
  for(const value of ['https://horizons.ent.auvergnerhonealpes.fr.attacker.invalid/lectureFichiergw.do','https://horizons.ent.auvergnerhonealpes.fr/redirect','http://horizons.ent.auvergnerhonealpes.fr/lectureFichiergw.do','https://secret@horizons.ent.auvergnerhonealpes.fr/lectureFichiergw.do'])assert.equal(attachmentURL(value,schoolConfig),null);
});
