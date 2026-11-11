import {PublicError} from './sync.js';

// Publish only major, user-facing changes here. Change the ID for the next
// announcement; patch releases must not reset the acknowledgement.
export const CURRENT_RELEASE=Object.freeze({
 id:'2026-11-trajets',
 version:'4.17.0',
 title:'Votre journée commence avant le premier cours',
 subtitle:'Votre lycée, votre départ, et le temps à prévoir.',
 banner:'./brand/campaign/banner-app.webp',
 features:Object.freeze([
  Object.freeze({icon:'study',title:'Votre lycée déjà repéré',description:'L’adresse publiée dans l’ENT prépare votre destination. Vous pouvez la vérifier ou la modifier.'}),
  Object.freeze({icon:'pin',title:'Un départ à votre choix',description:'Utilisez votre position au clic ou recherchez une adresse. Mémoriser ce départ reste votre choix.'}),
  Object.freeze({icon:'bus',title:'Du temps dans votre agenda',description:'Confirmez votre temps de transport avant ou après les cours. Retrouvez le trajet dans votre semaine et, si vous le choisissez, votre abonnement agenda.'})
 ])
});

export function publicRelease(user){
 if(!user)return null;
 return {...CURRENT_RELEASE,features:CURRENT_RELEASE.features.map(feature=>({...feature})),pending:user.seenRelease!==CURRENT_RELEASE.id};
}

export function installReleaseRoutes(router,{auth,store,rateLimit,clock=()=>Date.now()}){
 router.post('/api/releases/seen',auth,(req,res)=>{
  rateLimit(req,'releases-seen:'+req.user.id,60,15*60000);
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!Object.hasOwn(body,'releaseId')||body.releaseId!==CURRENT_RELEASE.id)throw new PublicError('Cette présentation des nouveautés est inconnue. Rechargez Passerelle.');
  // Acknowledgements follow the signed-in account, never a client-supplied ID.
  // Repeated dismissals (including another device) preserve the first date.
  if(req.user.seenRelease!==CURRENT_RELEASE.id){
   const now=clock();
   store.update(req.user.id,{seenRelease:CURRENT_RELEASE.id,seenReleaseAt:Number.isSafeInteger(now)&&now>=0?now:Date.now()});
  }
  res.json({release:publicRelease(req.user)});
 });
}
