import {digest} from './store.js';
import {plainText,parisDate,shiftDate} from './work.js';
import {PublicError} from './sync.js';
import {rebuildCalendar} from './calendar.js';
import {eventScope} from './event-scope.js';
import {extractEventDates,parisEventInstant} from './event-dates.js';
import {accountActive,automationAllowed} from './operational-state.js';
import {unsupportedSource} from './capabilities.js';

const INTERVAL=10*60000, MAX_ITEMS=150;
const clean=(value,max=200)=>plainText(String(value??'').slice(0,30000)).replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,max);
const validId=value=>typeof value==='string'&&value.length>0&&value.length<=250&&!/[\u0000-\u001f]/.test(value);
const defaults=()=>({settings:{news:false,messages:false,personal:false},items:[],seen:[],sources:{news:{state:'unknown'},messages:{state:'unknown'},personal:{state:'unknown'}},checkedAt:null,warning:null});
const sourceSetting=kind=>kind==='personal-mail'?'personal':kind==='message'?'messages':'news';
const useful=item=>item.status==='pending'||item.status==='accepted'&&item.changed;
const retainedDate=item=>item.status==='accepted'?item.confirmed?.date||item.date:item.date;
const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;

export class EventSuggestionService {
  constructor(store,school,{clock=()=>Date.now(),audit=null,sourceBusy=()=>false,personalMail=null}={}) {Object.assign(this,{store,school,clock,audit,sourceBusy,personalMail});this.running=new Map();this.closed=false;}
  state(user) {
    if(user.eventSuggestionsScope!==eventScope(user)||!user.eventSuggestionsState)return defaults();
    try{const value=this.store.open(user.eventSuggestionsState),base=defaults();return {...base,...value,settings:{...base.settings,...value.settings},sources:{...base.sources,...value.sources}};}catch{return {...defaults(),warning:'Les propositions enregistrées ne peuvent pas être ouvertes. Contactez l’assistance.'};}
  }
  summary(user) {
    if(!user?.skolengo||!user.studentId)return {pending:0,version:user?.eventSuggestionsSeq||0};
    const state=this.state(user),today=parisDate(new Date(this.clock()));
    return {pending:state.items.filter(item=>useful(item)&&state.settings[sourceSetting(item.source.kind)]&&retainedDate(item)>=today).length,version:user.eventSuggestionsSeq||0};
  }
  public(user) {
    const state=this.state(user),today=parisDate(new Date(this.clock()));
    return {accountId:user.id,settings:state.settings,connected:!!user.skolengo&&!!user.studentId,checkedAt:state.checkedAt,warning:state.warning,sources:state.sources,
      items:state.items.filter(item=>retainedDate(item)>=shiftDate(today,-7)&&(item.status==='accepted'||state.settings[sourceSetting(item.source.kind)])).map(({raw,sourceKey,sourceHash,acceptedRevision,seq,...item})=>item).sort((a,b)=>a.date.localeCompare(b.date)||a.title.localeCompare(b.title)),
      events:user.eventSuggestionsScope===eventScope(user)?Object.values(user.schoolEventCalendar||{}).filter(item=>!item.cancelled&&item.date>=today).map(({id,date,title,start,end,allDay,location})=>({id,date,title,start,end,allDay,location})):[]};
  }
  save(user,state,{changed=false,notices=[]}={}) {
    const scope=eventScope(user),same=user.eventSuggestionsScope===scope;
    let seq=same?(user.eventSuggestionsSeq||0):0;
    const today=parisDate(new Date(this.clock()));
    const retained=state.items.filter(item=>retainedDate(item)>=shiftDate(today,-90));
    state.items=[...retained.filter(item=>item.status==='accepted'),...retained.filter(item=>item.status!=='accepted').slice(-MAX_ITEMS)];
    state.seen=state.seen.slice(-120);
    if(changed)seq++;
    const existing=same?user.eventNoticeQueue||[]:[];
    const queue=[...existing.filter(entry=>entry.at>this.clock()-86400000&&!notices.includes(entry.id)),...notices.map(id=>({id,seq,at:this.clock(),date:state.items.find(item=>item.id===id)?.date}))].filter(entry=>{
      const item=state.items.find(item=>item.id===entry.id);
      return item&&useful(item)&&state.settings[sourceSetting(item.source.kind)]&&item.date>=today;
    }).slice(-150);
    this.store.update(user.id,{eventSuggestionsScope:scope,eventSuggestionsSeq:seq,eventSuggestionsState:this.store.seal(state),eventNoticeQueue:queue,...(!same?{schoolEventCalendar:{}}:{})});
  }
  settings(user,input) {
    if(typeof input.news!=='boolean'||typeof input.messages!=='boolean')throw new PublicError('Choisissez les sources à consulter.');
    const state=this.state(user);if(input.personal!==undefined&&typeof input.personal!=='boolean')throw new PublicError('Choisissez les sources à consulter.');const settings={news:input.news,messages:input.messages,personal:input.personal??state.settings.personal};
    if(JSON.stringify(settings)!==JSON.stringify(state.settings)){state.settings=settings;state.checkedAt=null;state.warning=null;this.save(user,state,{changed:true});this.store.update(user.id,{eventSuggestionsConsentVersion:(user.eventSuggestionsConsentVersion||0)+1});}
    return this.public(user);
  }
  ingest(user,state,source,now) {
    const key=digest(source.kind+':'+source.raw),hash=digest(JSON.stringify([source.title,source.text]));
    const candidates=extractEventDates({title:source.title,text:source.text,publishedAt:source.date,now});
    const notices=[],matched=new Set(),today=parisDate(new Date(now));
    const existing=state.items.filter(item=>item.sourceKey===key&&item.date>=today);
    for(const candidate of candidates) {
      // Match the actual occurrence first; the candidate list shrinks as dates
      // pass and its array index is therefore never an occurrence identity.
      let old=existing.find(item=>!matched.has(item.id)&&item.date===candidate.date&&item.startTime===(candidate.startTime||null));
      if(!old){const sameDay=existing.filter(item=>!matched.has(item.id)&&item.date===candidate.date);if(sameDay.length===1&&candidates.filter(value=>value.date===candidate.date).length===1)old=sameDay[0];}
      if(!old&&existing.length===1&&candidates.length===1&&existing[0].sourceHash!==hash)old=existing[0];
      const id=old?.id||digest(eventScope(user)+':'+key+':'+candidate.date+':'+(candidate.startTime||''));
      matched.add(id);
      const revision=digest(hash+':'+JSON.stringify(candidate));
      if(old?.revision===revision)continue;
      const sameOccurrence=old&&old.date===candidate.date&&old.startTime===(candidate.startTime||null)&&old.endTime===(candidate.endTime||null);
      const status=old?.status==='accepted'?'accepted':old?.status==='dismissed'&&sameOccurrence?'dismissed':'pending';
      const item={id,revision,raw:source.raw,sourceKey:key,sourceHash:hash,title:source.title||'Événement du lycée',date:candidate.date,startTime:candidate.startTime||null,endTime:candidate.endTime||null,allDay:!candidate.startTime,location:'',excerpt:clean(candidate.excerpt,500),ambiguous:!!candidate.ambiguous,source:{kind:source.kind,title:source.title,date:source.date,...(source.provider?{provider:source.provider}:{})},status,changed:status==='accepted'&&old.acceptedRevision!==revision,acceptedRevision:old?.acceptedRevision||null,...(old?.confirmed?{confirmed:old.confirmed}:{})};
      state.items=state.items.filter(value=>value.id!==id);state.items.push(item);
      if(useful(item))notices.push(id);
    }
    // Source edits never silently move or delete an event already accepted.
    for(const item of state.items.filter(item=>item.sourceKey===key&&item.date>=today&&!matched.has(item.id))){
      if(item.status==='accepted'&&!item.changed){item.changed=true;item.revision=digest(hash+':withdrawn:'+item.id);notices.push(item.id);}
      else if(item.status==='pending')item.status='dismissed';
    }
    state.seen=state.seen.filter(value=>value.key!==key);state.seen.push({key,hash,full:source.full,at:now});
    return notices;
  }
  async collect(user,context,state) {
    return this.school.operate(user,'event-suggestions',async client=>{
      const incoming=[],sources={...state.sources},deadline=performance.now()+18000;let warning=null;
      const read=operation=>{if(performance.now()>deadline)throw new PublicError('La vérification se poursuivra lors du prochain passage.',503);return operation();};
      const page=async(operation,offset=0)=>{let rows;try{rows=await read(operation);}catch(error){if(offset>0&&Number(error.status||error.response?.status)===400&&/page offset out of range.*beyond data\s?set/i.test(String(error.detail||error.message||'')))return [];throw error;}if(!Array.isArray(rows))throw new Error('INVALID_SOURCE_DATA');return rows.slice(0,20);};
      if(state.settings.news){
        if(context.capabilities?.features.news?.state==='unavailable')sources.news={state:'unavailable'};
        else try {
          const rows=[],ids=new Set();
          for(let offset=0;offset<40;offset+=20){const batch=await page(()=>client.getSchoolInfos({page:{limit:20,offset}}),offset);for(const value of batch)if(validId(value?.id)&&!ids.has(value.id)&&(!value.school?.id||value.school.id===context.school.id)){rows.push(value);ids.add(value.id);}if(batch.length<20)break;}
          rows.sort((a,b)=>{const first=state.seen.find(value=>value.key===digest('news:'+a.id)),second=state.seen.find(value=>value.key===digest('news:'+b.id));return Number(!!first?.full)-Number(!!second?.full)||(first?.at||0)-(second?.at||0);});
          let details=0;
          for(const row of rows){
            const title=clean(row.title,200);if(/\bmenus?\b/i.test(title))continue;
            const key=digest('news:'+row.id),previous=state.seen.find(value=>value.key===key),preview=plainText(String(row.content||row.shortContent||'').slice(0,30000));
            let value=row,full=!!row.content;
            // Refresh details so an edited article with an unchanged preview is detected too.
            if(typeof client.getSchoolInfo==='function'&&details<6&&(!previous?.full||this.clock()-previous.at>=3600000)){
              details++;try{value={...row,...await read(()=>client.getSchoolInfo(row.id))};full=true;}catch{warning='Certains articles n’ont pas pu être ouverts. Les dernières propositions sont conservées.';if(previous?.full)continue;}
            }else if(previous?.full&&!row.content)continue;
            if(value.school?.id&&value.school.id!==context.school.id)continue;
            incoming.push({kind:'news',raw:row.id,title:clean(value.title||title,200),text:plainText(String(value.content||value.shortContent||preview).slice(0,30000)),date:clean(value.publicationDateTime||row.publicationDateTime,40),full});
          }
          sources.news={state:'available'};
        }catch(error){sources.news={state:unsupportedSource(error)?'unavailable':'error'};if(!unsupportedSource(error))warning='Les actualités ne répondent pas actuellement. Les dernières propositions sont conservées.';}
      }
      if(state.settings.messages){
        if(context.capabilities?.features.messages?.state==='unavailable')sources.messages={state:'unavailable'};
        else try {
          const settings=await read(()=>client.getUsersMailSettings(undefined,undefined,['folders']));
          const folder=Array.isArray(settings?.folders)&&settings.folders.find(value=>value.type==='INBOX'&&validId(value.id));
          if(!folder)throw Object.assign(new Error('NO_INBOX'),{status:403});
          const ids=new Set();
          for(let offset=0;offset<40;offset+=20){
            const rows=await page(()=>client.getCommunicationsFolder(folder.id,20,offset),offset);
            for(const row of rows){
              if(!validId(row?.id)||ids.has(row.id))continue;ids.add(row.id);
              // getCommunicationParticipations marks a thread as read: never call it here.
              const last=row.lastParticipation;
              const body=last?.contentWithoutHtml||last?.content||((row.participationsNumber||1)===1?row.firstParticipationContent:'');
              incoming.push({kind:'message',raw:row.id,title:clean(row.subject||'Message du lycée',200),text:plainText(String(body||'').slice(0,30000)),date:clean(last?.dateTime||row.creationDateTime,40),full:false});
            }
            if(rows.length<20)break;
          }
          sources.messages={state:'available',partial:true};
        }catch(error){sources.messages={state:unsupportedSource(error)?'unavailable':'error'};if(!unsupportedSource(error))warning='La messagerie ne répond pas actuellement. Les dernières propositions sont conservées.';}
      }
      return {incoming,sources,warning};
    });
  }
  async scan(user) {
    if(this.closed)throw new PublicError('La vérification est interrompue.',503);
    if(this.running.has(user.id))return this.running.get(user.id);
    if(this.sourceBusy(user.id))throw new PublicError('Une consultation ENT est déjà en cours. Réessayez dans un instant.',409);
    if(this.running.size>=2)throw new PublicError('Deux vérifications sont déjà en cours. Réessayez dans un instant.',429);
    if(!accountActive(user)||!user.skolengo||!user.studentId)throw new PublicError('Connectez votre ENT pour repérer ses événements.',409);
    if(!automationAllowed(this.store.state.settings,'ent',this.clock()))throw new PublicError('La consultation de l’ENT est momentanément en pause.',409);
    const state=this.state(user);
    if(!state.settings.news&&!state.settings.messages&&!state.settings.personal)return this.public(user);
    const context=this.school.context(user),scope=context.scope,settings=JSON.stringify(state.settings),consent=user.eventSuggestionsConsentVersion||0,began=this.clock();
    const task=(async()=>{
      try {
        let result=state.settings.news||state.settings.messages?await this.collect(user,context,state):{incoming:[],sources:state.sources,warning:null};
        if(state.settings.personal&&this.personalMail){const version=user.personalMailVersion||0;try{const personal=await this.personalMail.collect(user);if((user.personalMailVersion||0)===version)result={incoming:[...result.incoming,...personal.incoming],sources:{...result.sources,...personal.sources},warning:[result.warning,personal.warning].filter(Boolean).join(' ')||null};}catch{result={...result,sources:{...result.sources,personal:{state:'error'}},warning:[result.warning,'Les mails personnels ne peuvent pas être vérifiés actuellement.'].filter(Boolean).join(' ')};}}
        if(this.closed||!accountActive(user)||!user.skolengo||this.school.context(user).scope!==scope)throw new PublicError('La connexion ou l’élève a changé. Actualisez cette rubrique.',409);
        // Re-read after I/O: accepting a proposal while a scan runs must remain accepted.
        const current=this.state(user);
        if(JSON.stringify(current.settings)!==settings||(user.eventSuggestionsConsentVersion||0)!==consent)return this.public(user);
        const notices=result.incoming.flatMap(source=>this.ingest(user,current,source,this.clock()));
        Object.assign(current,{sources:result.sources,warning:result.warning,checkedAt:this.clock()});
        this.save(user,current,{changed:notices.length>0,notices});
        this.audit?.record('events.scanned',{source:'sync',userId:user.id,meta:{count:notices.length,durationMs:this.clock()-began}});
        return this.public(user);
      }catch(error){
        if(!this.closed&&accountActive(user)&&user.skolengo&&this.school.context(user).scope===scope&&JSON.stringify(this.state(user).settings)===settings&&(user.eventSuggestionsConsentVersion||0)===consent){const current=this.state(user);current.checkedAt=this.clock();current.warning='La vérification ENT n’a pas abouti. Les dernières propositions sont conservées.';this.save(user,current);}
        this.audit?.record('events.failed',{source:'sync',level:'warn',userId:user.id,meta:{errorCode:'EVENT_SOURCE_UNAVAILABLE',durationMs:this.clock()-began}});
        throw error instanceof PublicError?error:new PublicError('La vérification ENT n’a pas abouti. Réessayez plus tard.',503);
      }finally{this.running.delete(user.id);}
    })();this.running.set(user.id,task);return task;
  }
  lookup(user,id,revision) {
    if(!/^[a-f0-9]{64}$/.test(id||''))throw new PublicError('Cette proposition n’est pas disponible.',404);
    const state=this.state(user),item=state.items.find(value=>value.id===id);
    if(!item)throw new PublicError('Cette proposition n’est plus disponible pour ce compte.',404);
    if(revision!==undefined&&revision!==item.revision)throw new PublicError('Cette proposition a changé. Actualisez-la avant de confirmer.',409);
    return {state,item};
  }
  accept(user,id,input) {
    if(!/^[a-f0-9]{64}$/.test(input.revision||''))throw new PublicError('Actualisez la proposition avant de confirmer.');
    const {state,item}=this.lookup(user,id,input.revision),today=parisDate(new Date(this.clock()));
    if(!validDate(input.date)||input.date<today||input.date>shiftDate(today,366))throw new PublicError('Choisissez une date à venir, dans les douze prochains mois.');
    if(typeof input.title!=='string'||!clean(input.title,200)||input.title.length>200||typeof input.location!=='string'||input.location.length>200||typeof input.allDay!=='boolean')throw new PublicError('Vérifiez le titre, le lieu et le type d’horaire.');
    let start,end;
    if(input.allDay){start=input.date;end=shiftDate(input.date,1);}
    else {start=parisEventInstant(input.date,input.startTime);end=parisEventInstant(input.date,input.endTime);if(!start||!end||Date.parse(end)<=Date.parse(start)||Date.parse(end)<=this.clock())throw new PublicError('Vérifiez les heures de début et de fin pour cette date, en heure de Paris.');}
    const old=user.schoolEventCalendar?.[id],event={id,date:input.date,title:clean(input.title,200),kind:'event',location:clean(input.location,200),description:'Ajouté après confirmation depuis '+(item.source.kind==='personal-mail'?'un mail personnel':item.source.kind==='message'?'la messagerie de votre ENT':'une actualité de votre lycée')+'.\nSource : '+item.source.title,start,end,allDay:input.allDay,cancelled:false};
    if(Object.values(user.schoolEventCalendar||{}).some(value=>value.id!==id&&!value.cancelled&&value.start===start&&value.end===end&&value.title.toLocaleLowerCase('fr')===event.title.toLocaleLowerCase('fr')))throw new PublicError('Cet événement est déjà dans votre agenda.',409);
    const hash=digest(JSON.stringify(event));
    if(old?.hash===hash&&item.status==='accepted'&&!item.changed)return this.public(user);
    const calendar=Object.fromEntries(Object.entries(user.schoolEventCalendar||{}).filter(([,value])=>value.date>=shiftDate(today,-90)));
    if(!calendar[id]&&Object.keys(calendar).length>=200)throw new PublicError('Deux cents événements sont déjà enregistrés. Retirez un ancien événement.',409);
    calendar[id]={...event,hash,created:old?.created??this.clock(),modified:this.clock(),sequence:(old?.sequence??-1)+1};
    Object.assign(item,{status:'accepted',changed:false,acceptedRevision:item.revision,confirmed:{date:input.date,title:event.title,startTime:input.allDay?null:input.startTime,endTime:input.allDay?null:input.endTime,allDay:input.allDay,location:event.location}});
    this.save(user,state,{changed:true});this.store.update(user.id,{schoolEventCalendar:calendar});rebuildCalendar(this.store,user.id,this.clock());
    this.audit?.record('events.accepted',{source:'personal',userId:user.id,meta:{count:1}});return this.public(user);
  }
  dismiss(user,id,revision,remove=false) {
    if(!/^[a-f0-9]{64}$/.test(revision||''))throw new PublicError('Actualisez la proposition avant de confirmer.');
    const {state,item}=this.lookup(user,id,revision),old=user.schoolEventCalendar?.[id];
    if(item.status==='accepted'&&!remove)throw new PublicError('Retirez cet événement de l’agenda pour l’ignorer.',409);
    if(item.status==='dismissed')return this.public(user);
    item.status='dismissed';item.changed=false;this.save(user,state,{changed:true});
    if(remove&&old&&!old.cancelled){this.store.update(user.id,{schoolEventCalendar:{...user.schoolEventCalendar,[id]:{...old,cancelled:true,modified:this.clock(),sequence:old.sequence+1}}});rebuildCalendar(this.store,user.id,this.clock());}
    return this.public(user);
  }
  purgePersonal(user,{connectionId}) {
    if(user.eventSuggestionsScope!==eventScope(user))return;
    const state=this.state(user);let changed=false;
    state.items=state.items.filter(item=>{
      if(item.source.kind!=='personal-mail')return true;
      let raw;try{raw=JSON.parse(item.raw);}catch{return true;}
      if(raw.connectionId!==connectionId)return true;
      changed=true;
      if(item.status!=='accepted')return false;
      item.raw=null;item.excerpt='';item.changed=false;item.revision=digest(item.revision+':disconnected');item.source={...item.source,title:'Mail personnel déconnecté'};return true;
    });
    if(changed)this.save(user,state,{changed:true});
  }
  async source(user,id) {
    const {item}=this.lookup(user,id);if(item.source.kind==='personal-mail'){if(!item.raw||!this.personalMail)throw new PublicError('La boîte mail liée à cet événement a été déconnectée.',410);return this.personalMail.source(user,item.raw);}const context=this.school.context(user);
    const ref=this.school.reference(context,item.source.kind,item.raw,{title:item.source.title});
    return this.school.detail(user,ref);
  }
  async tick() {
    if(this.closed||!automationAllowed(this.store.state.settings,'ent',this.clock()))return;
    const now=this.clock(),candidate=this.store.state.users.filter(user=>accountActive(user)&&user.skolengo&&user.studentId&&!this.running.has(user.id)&&!this.sourceBusy(user.id)).map(user=>({user,state:this.state(user)})).filter(({state})=>(state.settings.news||state.settings.messages||state.settings.personal)&&now-(state.checkedAt||0)>=INTERVAL).sort((a,b)=>(a.state.checkedAt||0)-(b.state.checkedAt||0))[0];
    if(candidate)await this.scan(candidate.user).catch(()=>{});
  }
  close(){this.closed=true;}
}

export function installEventSuggestionRoutes(router,{store,school,auth,rateLimit,clock,audit,...options}) {
  const events=new EventSuggestionService(store,school,{clock,audit,...options});
  const validate=(req,allowed)=>{if(req.body?.accountId!==req.user.id)throw new PublicError('Le compte a changé. Rechargez Passerelle.',409);if(!req.body||typeof req.body!=='object'||Array.isArray(req.body)||Object.keys(req.body).some(key=>!['accountId',...allowed].includes(key)))throw new PublicError('La requête contient des champs invalides.');};
  router.get('/api/event-suggestions',auth,(req,res)=>{rateLimit(req,'events-read:'+req.user.id,120,15*60000);res.json(events.public(req.user));});
  router.post('/api/event-suggestions/settings',auth,async(req,res)=>{rateLimit(req,'events-settings:'+req.user.id,20,15*60000);validate(req,['news','messages','personal']);events.settings(req.user,req.body);if((req.body.news||req.body.messages||req.body.personal)&&req.user.skolengo&&automationAllowed(store.state.settings,'ent',clock()))await events.scan(req.user).catch(()=>{});res.json(events.public(req.user));});
  router.post('/api/event-suggestions/scan',auth,async(req,res)=>{rateLimit(req,'events-scan:'+req.user.id,8,15*60000);validate(req,[]);res.json(await events.scan(req.user));});
  router.post('/api/event-suggestions/:id/accept',auth,(req,res)=>{rateLimit(req,'events-write:'+req.user.id,40,15*60000);validate(req,['revision','title','date','startTime','endTime','allDay','location']);res.json(events.accept(req.user,req.params.id,req.body));});
  for(const action of ['dismiss','remove'])router.post('/api/event-suggestions/:id/'+action,auth,(req,res)=>{rateLimit(req,'events-write:'+req.user.id,40,15*60000);validate(req,['revision']);res.json(events.dismiss(req.user,req.params.id,req.body.revision,action==='remove'));});
  router.post('/api/event-suggestions/:id/source',auth,async(req,res)=>{rateLimit(req,'events-source:'+req.user.id,40,15*60000);validate(req,[]);res.json(await events.source(req.user,req.params.id));});
  return events;
}
