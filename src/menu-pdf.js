import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { shiftDate } from './work.js';

const execute = promisify(execFile);
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, ' ').replace(/\s+/g, ' ').trim();
const validDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
export function menuPeriod(title, publishedAt = '') {
  const months = MONTHS.join('|');
  const match = normalize(title).match(new RegExp('\\bdu\\s+(\\d{1,2})(?:er)?(?:\\s+(' + months + '))?\\s+(?:au|a|-)\\s+(\\d{1,2})(?:er)?\\s+(' + months + ')(?:\\s+(\\d{4}))?\\b'));
  if (!match) return null;
  const startDay = Number(match[1]), endDay = Number(match[3]), endMonth = MONTHS.indexOf(match[4]) + 1;
  let startMonth = match[2] ? MONTHS.indexOf(match[2]) + 1 : endMonth;
  if (!match[2] && startDay > endDay) startMonth = endMonth === 1 ? 12 : endMonth - 1;
  const published = Date.parse(publishedAt), year = Number(match[5]) || (Number.isFinite(published) ? new Date(published).getUTCFullYear() : null);
  if (!year || year < 2000 || year > 2100) return null;
  const years = match[5] ? [year] : [year - 1, year, year + 1];
  const candidates = years.map(endYear => {
    const startYear = startMonth > endMonth ? endYear - 1 : endYear;
    const day = (y, m, d) => y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
    return { start: day(startYear, startMonth, startDay), end: day(endYear, endMonth, endDay) };
  }).filter(value => validDay(value.start) && validDay(value.end) && Date.parse(value.end) >= Date.parse(value.start) && Date.parse(value.end) - Date.parse(value.start) <= 14 * 86400000);
  return candidates.sort((a,b) => Math.abs(Date.parse(a.start) - published) - Math.abs(Date.parse(b.start) - published))[0] || null;
}
const entities = value => value.replace(/&#(x[\da-f]+|\d+);/gi, (match, code) => { const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1),16) : Number(code); return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : ''; }).replace(/&(amp|lt|gt|quot|apos);/g, (_, code) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[code]));
export function parseBBox(xml) {
  return [...xml.matchAll(/<page\s+width="([\d.]+)"\s+height="([\d.]+)"[^>]*>([\s\S]*?)<\/page>/g)].slice(0, 4).map((page, index) => ({ index: index + 1, width: Number(page[1]), height: Number(page[2]), ocr: false, words: [...page[3].matchAll(/<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"[^>]*>([\s\S]*?)<\/word>/g)].slice(0, 15000).map(word => ({ x: Number(word[1]), y: Number(word[2]), w: Number(word[3]) - Number(word[1]), h: Number(word[4]) - Number(word[2]), text: entities(word[5]), confidence: 100 })) }));
}
export function parseTSV(tsv, index = 1) {
  let width = 0, height = 0;
  const words = [];
  for (const line of tsv.split('\n').slice(1, 18000)) {
    const cols = line.split('\t');
    if (cols[0] === '1') { width = Number(cols[8]); height = Number(cols[9]); }
    if (cols[0] !== '5' || !cols[11]?.trim()) continue;
    const [x,y,w,h,confidence] = cols.slice(6,11).map(Number);
    if ([x,y,w,h,confidence].every(Number.isFinite) && confidence >= 20 && w > 0 && h > 0) words.push({ x,y,w,h,confidence,text: cols.slice(11).join('\t').trim() });
  }
  return { index, width, height, ocr: true, words };
}
function lines(words) {
  const rows = [];
  for (const word of [...words].sort((a,b) => a.y+a.h/2-b.y-b.h/2 || a.x-b.x)) {
    const center = word.y + word.h/2;
    const row = rows.find(value => Math.abs(value.center-center) <= Math.max(3, Math.min(value.h, word.h)*.6));
    if (row) { row.words.push(word); row.center = row.words.reduce((sum,value) => sum+value.y+value.h/2,0)/row.words.length; row.h = Math.min(row.h,word.h); }
    else rows.push({center,h:word.h,words:[word]});
  }
  return rows.sort((a,b) => a.center-b.center).map(row => ({ y: Math.min(...row.words.map(word=>word.y)), bottom: Math.max(...row.words.map(word=>word.y+word.h)), words: row.words.sort((a,b)=>a.x-b.x), text: row.words.sort((a,b)=>a.x-b.x).map(word=>word.text).join(' ') }));
}
const footer = value => /^(produits subventionnes|ces menus peuvent|legende\b|le proviseur\b|la secretaire\b|le chef de cuisine\b)/.test(normalize(value));
function cleanLine(value) {
  return value.replace(/[©®@£€¤]/g,' ').replace(/\bL\*?(?=\s|$)/g,' ').replace(/(?:^|\s)[^\p{L}\p{N}]+(?=\s|$)/gu,' ').replace(/\s+/g,' ').replace(/^[\s:;,.-]+|[\s:;,.-]+$/g,'').trim();
}
export function extractDayBlocks(pages, period) {
  if (!period) return {};
  const dates = [];
  for (let date = period.start; date <= period.end; date = shiftDate(date,1)) dates.push(date);
  const days = {}, duplicates = new Set();
  for (const page of pages) {
    if (!(page.width > 0 && page.height > 0)) continue;
    const anchors = page.words.filter(word => DAYS.includes(normalize(word.text).replace(/[^a-z]/g,'')) && word.y < page.height*.88).map(word=>({...word,day:normalize(word.text).replace(/[^a-z]/g,'')}));
    if (anchors.length < 2 || anchors.length > 7 || new Set(anchors.map(a=>a.day)).size !== anchors.length) continue;
    const rows = lines(page.words);
    const bottom = rows.find(row => row.y > Math.min(...anchors.map(a=>a.y)) && footer(row.text))?.y || page.height*.9;
    for (const anchor of anchors) {
      const sameRow = anchors.filter(other=>Math.abs(other.y-anchor.y) < Math.max(anchor.h,other.h)*1.5).sort((a,b)=>a.x-b.x);
      const columns = sameRow.length >= 2;
      const position = sameRow.indexOf(anchor), center = a=>a.x+a.w/2;
      const left = columns && position > 0 ? (center(sameRow[position-1])+center(anchor))/2 : 0;
      const right = columns && position < sameRow.length-1 ? (center(anchor)+center(sameRow[position+1]))/2 : page.width;
      const lower = columns ? bottom : Math.min(bottom, ...anchors.filter(other=>other.y>anchor.y+anchor.h).map(other=>other.y-3));
      const y = anchor.y+anchor.h+2;
      const words = page.words.filter(word=>word.y+word.h/2>y && word.y+word.h/2<lower && word.x+word.w/2>=left && word.x+word.w/2<right);
      const body = lines(words).map(row=>cleanLine(row.text)).filter(value=>value.length>2 && /\p{L}{2}/u.test(value) && !footer(value) && !/^(bio|[a-z]?\d+)[).]?$/i.test(value));
      if (body.length < 2 || body.length > 35) continue;
      const matching = dates.filter(date=>DAYS[new Date(date+'T12:00:00Z').getUTCDay()]===anchor.day);
      if (matching.length !== 1) continue;
      const date = matching[0];
      if (days[date]) { duplicates.add(date); continue; }
      const items = [];
      for (const line of body) {
        if (items.length && (/\bou$/i.test(items.at(-1)) || /^ou\s/i.test(line))) items[items.length-1] += ' ' + line;
        else items.push(line);
      }
      const confidence = words.reduce((sum,word)=>sum+word.confidence,0)/Math.max(words.length,1);
      if (page.ocr && confidence < 65) continue;
      days[date] = { date, items, ocr: page.ocr, confidence: Math.round(confidence), crop: {page:page.index,x:left,y:Math.max(0,anchor.y-5),width:right-left,height:Math.max(1,lower-anchor.y+5),pageWidth:page.width,pageHeight:page.height} };
    }
  }
  for (const date of duplicates) delete days[date];
  return days;
}

let queue = Promise.resolve();
export async function extractMenuPDF(bytes, period) {
  const previous = queue; let release; queue = new Promise(resolve=>{release=resolve;}); await previous;
  let dir;
  const run = (file,args, timeout=25000) => execute(file,args,{timeout,maxBuffer:8*1024*1024,env:{...process.env,OMP_THREAD_LIMIT:'1'},killSignal:'SIGKILL'});
  try {
    if (bytes.length > 8*1024*1024 || !bytes.subarray(0,1024).includes(Buffer.from('%PDF-'))) throw new Error('INVALID_MENU_PDF');
    dir = await fs.mkdtemp(path.join(os.tmpdir(),'passerelle-menu-')); await fs.chmod(dir,0o700);
    const input = path.join(dir,'menu.pdf'); await fs.writeFile(input,bytes,{mode:0o600});
    const {stdout:xml} = await run('pdftotext',['-f','1','-l','4','-bbox-layout','-enc','UTF-8',input,'-']);
    let pages = parseBBox(xml), usedOCR = false;
    if (pages.reduce((sum,page)=>sum+page.words.length,0) < 12 || Object.keys(extractDayBlocks(pages,period)).length < 2) {
      usedOCR = true; const results = [];
      for (let index=1; index<=Math.min(pages.length || 1,4);index++) {
        const prefix=path.join(dir,'page-'+index);
        await run('pdftoppm',['-f',String(index),'-l',String(index),'-scale-to','2200','-singlefile','-png',input,prefix]);
        const {stdout:tsv} = await run('tesseract',[prefix+'.png','stdout','-l','fra+eng','--psm','11','tsv']);
        results.push(parseTSV(tsv,index));
      }
      pages = results;
    }
    const days = extractDayBlocks(pages,period);
    for (const value of Object.values(days)) {
      const crop=value.crop, factor=1800/Math.max(crop.pageWidth,crop.pageHeight), prefix=path.join(dir,'crop-'+value.date);
      try {
        await run('pdftoppm',['-f',String(crop.page),'-l',String(crop.page),'-singlefile','-scale-to','1800','-x',String(Math.floor(crop.x*factor)),'-y',String(Math.floor(crop.y*factor)),'-W',String(Math.max(1,Math.ceil(crop.width*factor))),'-H',String(Math.max(1,Math.ceil(crop.height*factor))),'-jpeg','-jpegopt','quality=90',input,prefix]);
        const image=await fs.readFile(prefix+'.jpg'); if(image.length<=500000)value.image=image;
      } catch { /* The text and the original PDF remain usable if preview rendering fails. */ }
      delete value.crop;
    }
    return { period, days, ocr: usedOCR };
  } finally { if(dir) await fs.rm(dir,{recursive:true,force:true}); release(); }
}
