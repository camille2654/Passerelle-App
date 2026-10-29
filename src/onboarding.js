import {PublicError} from './sync.js';

const steps=new Set(['welcome','connect','home','agenda','work','more','finish']);
const statuses=new Set(['available','new','active','paused','completed']);
const actions=new Set(['start','step','pause','complete']);
const timestamp=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const available=()=>({version:1,status:'available',step:'welcome',updatedAt:0,startedAt:null,completedAt:null});

export function initializeOnboarding(now=Date.now()){
  return {...available(),status:'new',updatedAt:timestamp(now)??0};
}

export function publicOnboarding(user){
  const value=user?.onboarding;
  if(!value||value.version!==1||!statuses.has(value.status)||!steps.has(value.step))return available();
  return {version:1,status:value.status,step:value.step,updatedAt:timestamp(value.updatedAt)??0,startedAt:timestamp(value.startedAt),completedAt:timestamp(value.completedAt)};
}

function validatedAction(body){
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['action','step'].includes(key))||!actions.has(body.action))throw new PublicError('Choisissez une action valide pour la découverte.');
  if(Object.hasOwn(body,'step')&&!steps.has(body.step))throw new PublicError('Cette étape de découverte est inconnue.');
  if(body.action==='step'&&!Object.hasOwn(body,'step'))throw new PublicError('Choisissez une étape de découverte.');
  if(body.action!=='step'&&Object.hasOwn(body,'step'))throw new PublicError('Cette action ne permet pas de choisir une étape.');
  return body;
}

export function installOnboardingRoutes(router,{auth,store,rateLimit,clock=()=>Date.now()}){
  router.post('/api/onboarding',auth,(req,res)=>{
    rateLimit(req,'onboarding:'+req.user.id,90,15*60000);
    const {action,step}=validatedAction(req.body),current=publicOnboarding(req.user),now=timestamp(clock())??Date.now();
    let next;
    if(action==='start'){
      next=current.status==='completed'?{...current,status:'active',step:'welcome',startedAt:now,completedAt:null}:{...current,status:'active',startedAt:current.startedAt??now,completedAt:null};
    }else if(action==='step'){
      if(current.startedAt===null||!['active','paused'].includes(current.status))throw new PublicError('Commencez la découverte avant de choisir une étape.',409);
      next={...current,status:'active',step};
    }else if(action==='pause'){
      next=current.status==='completed'?current:{...current,status:'paused'};
    }else{
      if(current.status==='completed')next=current;
      else{
        if(current.startedAt===null)throw new PublicError('Commencez la découverte avant de la terminer.',409);
        next={...current,status:'completed',step:'finish',completedAt:now};
      }
    }
    // Repeated refreshes or the same action from another device do not reset progress.
    if(next.status!==current.status||next.step!==current.step||next.startedAt!==current.startedAt||next.completedAt!==current.completedAt){
      next={...next,updatedAt:now};
      store.update(req.user.id,{onboarding:next});
    }
    res.json({onboarding:publicOnboarding(req.user)});
  });
}
