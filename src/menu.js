import { digest } from './store.js';
import { attachmentURL } from './school.js';
import { PublicError } from './sync.js';
import { parisDate } from './work.js';
import { extractMenuPDF, menuPeriod, normalize } from './menu-pdf.js';

const TTL = 10*60000;
export class MenuService {
  constructor(school, { clock = () => Date.now(), parser = extractMenuPDF } = {}) { this.school=school; this.clock=clock; this.parser=parser; this.parsed=new Map(); this.pending=new Map(); }
  remember(hash, parsed) {
    this.parsed.delete(hash); this.parsed.set(hash,parsed);
    while(this.parsed.size>8) this.parsed.delete(this.parsed.keys().next().value);
  }
  async discover(user, context, date) {
    return this.school.operate(user,'menu',async client=>{
      const news=[], seen=new Set();
      for(let offset=0;offset<60;offset+=20) {
        let rows;
        try { rows=await client.getSchoolInfos({page:{limit:20,offset}}); }
        catch(error) { if(offset>0 && Number(error.status||error.response?.status)===400 && /page offset out of range.*beyond data\s?set/i.test(String(error.detail||error.message||''))) break; throw error; }
        if(!Array.isArray(rows)) throw new Error('INVALID_SOURCE_DATA');
        const fresh=rows.filter(value=>value?.id&&!seen.has(value.id)); fresh.forEach(value=>seen.add(value.id)); news.push(...fresh.filter(value=>/\bmenus?\b/.test(normalize(value.title))&&(!value.school?.id||value.school.id===context.school.id)));
        if(rows.length!==20||fresh.length!==rows.length) break;
      }
      const candidates=news.map(article=>({...article,period:menuPeriod(article.title,article.publicationDateTime)})).filter(article=>article.period).sort((a,b)=>{
        const rank=value=>date>=value.period.start&&date<=value.period.end?0:Math.min(Math.abs(Date.parse(value.period.start)-Date.parse(date)),Math.abs(Date.parse(value.period.end)-Date.parse(date)));
        return rank(a)-rank(b)||Date.parse(b.publicationDateTime)-Date.parse(a.publicationDateTime);
      }).slice(0,3);
      const documents=[], weeks=new Set(); let unreadable=false;
      for(const article of candidates) {
        const weekKey=article.period.start+':'+article.period.end;if(weeks.has(weekKey))continue;weeks.add(weekKey);
        const full=await client.getSchoolInfo(article.id);
        if(full.school?.id&&full.school.id!==context.school.id)continue;
        const period=menuPeriod(full.title||article.title,full.publicationDateTime||article.publicationDateTime)||article.period;
        const files=(full.attachments||[]).filter(file=>(file.mimeType==='application/pdf'||/\.pdf$/i.test(file.name||''))&&Number(file.size||0)<=8*1024*1024).sort((a,b)=>Number(/menu/i.test(b.name||''))-Number(/menu/i.test(a.name||''))).slice(0,2);
        for(const file of files) {
          const local=this.school.files(context,[file])[0];
          const base={period,title:String(full.title||article.title).slice(0,500),name:local.name,fileRef:local.ref,articleRef:this.school.reference(context,'news',article.id),publishedAt:full.publicationDateTime||article.publicationDateTime};
          if(!local.ref||!attachmentURL(file.url,context.school)) {documents.push({...base,hash:null});unreadable=true;continue;}
          try {
            const response=await client.request({url:attachmentURL(file.url,context.school),responseType:'arraybuffer',maxRedirects:0,maxContentLength:8*1024*1024,timeout:30000});
            const bytes=Buffer.from(response.data); if(bytes.length>8*1024*1024) throw new Error('MENU_TOO_LARGE');
            const hash=digest(digest(bytes)+':menu-parser-1:'+period.start+':'+period.end);
            let parsed=this.parsed.get(hash);
            if(!parsed) {parsed=await this.parser(bytes,period);this.remember(hash,parsed);}
            if(!Object.keys(parsed.days).length) unreadable=true;
            documents.push({...base,hash});
            if(Object.keys(parsed.days).length) break;
          } catch {documents.push({...base,hash:null});unreadable=true;}
        }
      }
      return {at:this.clock(),documents,unreadable,requestedDate:date};
    });
  }
  present(user,context,date,warning=null) {
    const state=context.menu, documents=state?.documents||[], current=documents.find(doc=>doc.period.start<=date&&doc.period.end>=date&&this.parsed.get(doc.hash)?.days[date])||documents.find(doc=>doc.period.start<=date&&doc.period.end>=date);
    const day=current&&this.parsed.get(current.hash)?.days[date];
    const next=documents.flatMap(doc=>Object.keys(this.parsed.get(doc.hash)?.days||{}).filter(value=>value>date).map(value=>({date:value,title:doc.title}))).sort((a,b)=>a.date.localeCompare(b.date))[0]||null;
    const source=current||documents.find(doc=>doc.period.end>=date)||documents[0];
    const imageRef=day?.image?this.school.reference(context,'menu-image',current.hash+':'+date,{hash:current.hash,date}):null;
    return {date,status:day?'available':current&&!Object.keys(this.parsed.get(current.hash)?.days||{}).length?'unreadable':'not_published',items:day?.items||[],ocr:day?.ocr||false,imageRef,next,source:source?{title:source.title,name:source.name,fileRef:source.fileRef,period:source.period}:null,checkedAt:state?.at||null,warning};
  }
  async get(user, query={}) {
    const date=query.date||parisDate(new Date(this.clock()));
    if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date+'T12:00:00Z').toISOString().slice(0,10)!==date||Math.abs(Date.parse(date)-this.clock())>400*86400000)throw new PublicError('Date du menu invalide.');
    if(!user.skolengo||!user.studentId)return {date,status:'not_connected',items:[],source:null,checkedAt:null};
    const context=this.school.context(user), pendingKey=context.scope;
    const expired=!context.menu||this.clock()-context.menu.at>=TTL||context.menu.documents.some(doc=>doc.hash&&!this.parsed.has(doc.hash))||context.menu.requestedDate!==date&&!context.menu.documents.some(doc=>doc.period.start<=date&&doc.period.end>=date);
    if(query.refresh==='1'||expired) {
      if(!this.pending.has(pendingKey)) {
        if(this.pending.size>=2) return this.present(user,context,date,'Les menus sont en cours de préparation. Réessayez dans un instant.');
        const task=this.discover(user,context,date).then(value=>{context.menu=value;}).finally(()=>{this.pending.delete(pendingKey);});this.pending.set(pendingKey,task);
      }
      try {await this.pending.get(pendingKey);}
      catch(error){return this.present(user,context,date,error instanceof PublicError?error.message:'Les menus ne sont pas accessibles pour le moment. Réessayez dans un instant.');}
    }
    return this.present(user,context,date);
  }
  image(user,ref) {
    const {item}=this.school.lookup(user,ref,'menu-image'), day=this.parsed.get(item.data.hash)?.days[item.data.date];
    if(!day?.image) throw new PublicError('Cet extrait a expiré. Actualisez le menu.',410);
    return day.image;
  }
}
export function installMenuRoutes(router,{auth,school,rateLimit,clock,...options}) {
  const menu=new MenuService(school,{clock,...options});
  router.get('/api/menu',auth,async(req,res)=>{rateLimit(req,'menu:'+req.user.id,35,15*60000);res.json(await menu.get(req.user,req.query));});
  router.get('/api/menu/image/:ref',auth,(req,res)=>{rateLimit(req,'menu-image:'+req.user.id,80,15*60000);res.type('jpeg').send(menu.image(req.user,req.params.ref));});
  return menu;
}
