import {SchoolService} from './school.js';
import {PublicError} from './sync.js';
import {digest} from './store.js';

const scope=user=>digest(JSON.stringify([user.id,user.studentId,user.skolengoConnectionId]));
const refPattern=/^[a-f0-9]{64}$/;
const kinds={messages:'message',news:'news'};
const invalid=()=>{throw new PublicError('Cette rubrique n’est pas autorisée pour cette connexion.',403);};

// Reuse normalized ENT readers, with grants for each returned reference.
// Portal accounts and Lapsus technical profiles have separate SchoolService caches.
export class ManagedSchoolService{
  constructor(managed,{clientFactory}={}){
    this.managed=managed;this.clock=managed.clock;
    this.school=new SchoolService(managed.store,{clock:managed.clock,audit:managed.audit,...(clientFactory?{clientFactory}:{})});
    this.grants=new Map();this.unavailable=new Map();
  }
  authorize(req,section){const user=this.managed.dataConnection(req);if(!Object.hasOwn(kinds,section)||!user.scopes?.includes(section))invalid();return user;}
  current(req,user,version,keyVersion,section){
    this.managed.available();
    if(this.managed.dataConnection(req)!==user||scope(user)!==version||this.managed.settings().keyVersion!==keyVersion||!user.scopes?.includes(section))throw new PublicError('La connexion ENT a changé. Relancez la lecture depuis Lapsus.',409);
  }
  grant(user,section,value){
    const visit=item=>{if(!item||typeof item!=='object')return;if(Array.isArray(item)){item.forEach(visit);return;}
      if(typeof item.ref==='string'&&refPattern.test(item.ref)){
        const {item:source}=this.school.lookup(user,item.ref);
        this.grants.set(user.id+':'+item.ref,{section,kind:source.kind,version:scope(user),at:this.clock()});
      }
      Object.values(item).forEach(visit);
    };visit(value);
    for(const [key,row]of this.grants)if(this.clock()-row.at>30*60000)this.grants.delete(key);
    while(this.grants.size>10000)this.grants.delete(this.grants.keys().next().value);
  }
  async load(req){
    const section=req.params.section,user=this.authorize(req,section),allowed=section==='messages'?['offset','folder','refresh']:['offset','refresh'];
    if(Object.keys(req.query).some(key=>!allowed.includes(key))||Object.values(req.query).some(value=>typeof value!=='string')||req.query.refresh!==undefined&&req.query.refresh!=='1')throw new PublicError('Les paramètres de consultation sont invalides.');
    const version=scope(user),keyVersion=this.managed.settings().keyVersion,key=version+':'+section,cached=this.unavailable.get(key);
    if(cached&&this.clock()-cached.fetchedAt<5*60000&&req.query.refresh!=='1')return {...this.managed.status(user),...cached};
    try{
      const value=await this.school.load(user,section,req.query);this.current(req,user,version,keyVersion,section);
      this.unavailable.delete(key);this.grant(user,section,value);
      return {...this.managed.status(user),...value,available:true};
    }catch(error){
      this.current(req,user,version,keyVersion,section);
      if(error.code!=='ENT_SERVICE_UNAVAILABLE'&&!(error instanceof PublicError&&error.status===409&&error.message.includes('pas fournie')))throw error;
      const value={section,available:false,items:[],hasMore:false,fetchedAt:this.clock(),warning:section==='messages'?'La messagerie n’est pas fournie par cet ENT pour votre compte.':'Les actualités ne sont pas fournies par cet ENT pour votre compte.'};
      this.unavailable.set(key,value);while(this.unavailable.size>100)this.unavailable.delete(this.unavailable.keys().next().value);
      return {...this.managed.status(user),...value};
    }
  }
  lookup(req,file=false){
    const user=this.managed.dataConnection(req),ref=req.params.ref,grant=refPattern.test(ref||'')?this.grants.get(user.id+':'+ref):null;
    if(!grant||grant.version!==scope(user)||this.clock()-grant.at>30*60000)throw new PublicError('Ce contenu a expiré. Actualisez sa liste dans Lapsus.',410);
    if(!user.scopes?.includes(grant.section)||(file?grant.kind!=='file':!Object.values(kinds).includes(grant.kind)))invalid();
    return {user,ref,section:grant.section,version:scope(user),keyVersion:this.managed.settings().keyVersion};
  }
  async detail(req){
    if(Object.keys(req.query).length)throw new PublicError('Les paramètres de consultation sont invalides.');
    const context=this.lookup(req),value=await this.school.detail(context.user,context.ref);
    this.current(req,context.user,context.version,context.keyVersion,context.section);this.grant(context.user,context.section,value);
    return {...this.managed.status(context.user),...value,available:true};
  }
  async download(req){
    if(Object.keys(req.query).length)throw new PublicError('Les paramètres de consultation sont invalides.');
    const context=this.lookup(req,true),value=await this.school.download(context.user,context.ref);
    this.current(req,context.user,context.version,context.keyVersion,context.section);return value;
  }
  forget(id){this.school.contexts.delete(id);for(const key of this.grants.keys())if(key.startsWith(id+':'))this.grants.delete(key);}
  close(){this.school.contexts.clear();this.grants.clear();this.unavailable.clear();}
}
