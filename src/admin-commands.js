import {PublicError} from './sync.js';

// Both the browser and the local CLI resolve to this closed catalogue.
export const COMMANDS = [
  ['account.suspend','Suspendre les comptes','Bloque les connexions, les sessions, les liens ICS et les nouveaux traitements jusqu’à réactivation.',true],
  ['account.resume','Réactiver les comptes','Rétablit l’accès et reprend les automatisations déjà autorisées par chaque titulaire.',true],
  ['account.archive','Archiver les comptes','Place les comptes dans les archives et bloque leur accès. Les données sont conservées pour une restauration.',true],
  ['account.restore','Restaurer les comptes archivés','Retire les comptes des archives sans modifier une éventuelle suspension distincte.',true],
  ['account.role','Modifier le rôle','Attribue ou retire l’administration et invalide les sessions du compte concerné.',true],
  ['account.sessions','Fermer les sessions','Déconnecte les appareils choisis sans changer les mots de passe.',true],
  ['account.reset','Créer un lien de réinitialisation','Produit un lien à usage unique valable 30 minutes. Aucun mail n’est envoyé.',true],
  ['account.profile','Modifier la fiche du compte','Modifie le prénom, l’identifiant ou les étiquettes du compte.',true],
  ['account.note','Enregistrer une note interne','Conserve une note chiffrée visible uniquement par les administrateurs.',false],
  ['sync.run','Actualiser les connexions','Place les lectures ENT ou Pronote dans une file suivie compte par compte.',false],
  ['sync.pause','Suspendre les actualisations','Conserve les liens ICS et les dernières données disponibles.',false],
  ['sync.resume','Reprendre les actualisations','Réactive uniquement les connexions déjà configurées et encore valides.',false],
  ['feed.rebuild','Reconstruire les flux ICS','Recalcule les flux depuis les données enregistrées sans modifier leurs liens.',false],
  ['feed.rotate','Renouveler les liens ICS','Invalide les anciens liens. Les titulaires devront ajouter les nouveaux abonnements.',true],
  ['feed.revoke','Désactiver les liens ICS','Invalide les liens d’abonnement sans supprimer les données scolaires.',true],
  ['mail.pause','Suspendre les notifications','Désactive les briefs et les alertes sélectionnés, sans envoyer de message.',false],
  ['cache.clear','Actualiser les caches ENT','Vide uniquement les consultations temporaires ; les données enregistrées sont conservées.',false],
  ['site.registration','Ouvrir ou fermer les inscriptions','Modifie l’ouverture des inscriptions publiques. Les invitations restent utilisables.',false],
  ['site.maintenance','Activer ou arrêter la maintenance','Suspend les automatismes et les inscriptions pendant une durée bornée. Les données restent consultables.',true],
  ['site.automation','Suspendre ou reprendre les automatismes','Contrôle séparément les tâches ENT, Pronote et mails.',false],
  ['site.announcement','Publier ou retirer une annonce','Affiche un message public jusqu’à son échéance, y compris avant la connexion.',true],
  ['invite.create','Créer une invitation','Génère un accès à usage unique avec le rôle et la durée sélectionnés.',true],
  ['invite.revoke','Révoquer les invitations','Invalide les invitations non utilisées sélectionnées.',true],
  ['incident.ack','Prendre en charge les incidents','Marque les incidents comme pris en charge sans masquer la cause technique.',false],
  ['diagnose.run','Lancer un diagnostic','Vérifie les états techniques et l’intégrité du journal, sans envoyer de mail.',false]
].map(([id,label,description,sensitive])=>({id,label,description,sensitive,target:id.startsWith('site.')||id==='invite.create'||id==='diagnose.run'?'site':id==='incident.ack'?'incident':id==='invite.revoke'?'invite':'user'}));
export const commandById = id => COMMANDS.find(command => command.id === id);
export const COMMAND_HELP = [
  'status', 'doctor', 'users list [--state active|suspended|archived] [--role admin|member] [--search texte]',
  'user inspect IDENTIFIANT', 'user suspend|resume|archive|restore IDENTIFIANT',
  'user role IDENTIFIANT admin|member', 'user sessions IDENTIFIANT [--include-current]',
  'user reset-password IDENTIFIANT', 'user note IDENTIFIANT --message "Note interne"',
  'sync run|pause|resume --source ent|pronote|all --user IDENTIFIANT',
  'sync run|pause|resume --source ent|pronote|all --all',
  'feed rebuild|rotate|revoke --user IDENTIFIANT', 'mail pause --user IDENTIFIANT',
  'cache clear --user IDENTIFIANT', 'jobs list', 'jobs show|cancel|retry ID',
  'incidents list', 'incident ack ID', 'invites list', 'invite create --role member|admin --hours 24',
  'invite revoke ID', 'site registration open|close',
  'site maintenance on --minutes 30 --message "Maintenance"', 'site maintenance off',
  'site automation pause|resume --source ent|pronote|mail|push|all',
  'site announce --title "Information" --message "Texte public" --minutes 60', 'site announce off',
  'secret ID · affiche une seule fois le lien privé de votre opération', 'logs tail [--level error|warn|info] [--user IDENTIFIANT] [--limit 30]', 'apply ID', 'help'
];
export function tokenizeCommand(line) {
  if(typeof line!=='string'||line.length>4000||/[\u0000-\u001f]/.test(line))throw new PublicError('Saisissez une commande sur une seule ligne (4 000 caractères maximum).');
  const result=[];let word='',quote=null,started=false;
  for(let i=0;i<line.length;i++){
    const char=line[i];
    if(quote){if(char===quote)quote=null;else if(char==='\\'&&line[i+1]===quote)word+=line[++i];else word+=char;started=true;}
    else if(char==='"'||char==="'"){quote=char;started=true;}
    else if(/\s/.test(char)){if(started){result.push(word);word='';started=false;}}
    else{word+=char;started=true;}
  }
  if(quote)throw new PublicError('Fermez les guillemets de votre commande.');if(started)result.push(word);
  return result;
}
export function parseAdminCommand(line) {
  const words=tokenizeCommand(line),args=[],flags={};
  for(let i=0;i<words.length;i++){
    if(words[i].startsWith('--')){const name=words[i].slice(2);if(!/^[a-z][a-z-]*$/.test(name)||Object.hasOwn(flags,name))throw new PublicError('Option de commande invalide ou répétée.');flags[name]=['all','include-current'].includes(name)?true:words[++i];if(flags[name]===undefined||typeof flags[name]==='string'&&flags[name].startsWith('--'))throw new PublicError('Indiquez une valeur pour --'+name+'.');}
    else args.push(words[i]);
  }
  const allowed=names=>{for(const key of Object.keys(flags))if(!names.includes(key))throw new PublicError('Option inconnue : --'+key+'.');};
  const target=()=>{if(flags.all&&flags.user)throw new PublicError('Choisissez --all ou --user.');if(!flags.all&&!flags.user)throw new PublicError('Précisez --user IDENTIFIANT ou --all.');return flags.all?{all:true}:{refs:[flags.user]};};
  const write=(command,selection={},params={})=>({type:'prepare',command,selection,params});
  const [group,verb,ref,extra]=args;
  if(['users','sync','feed','mail','cache','logs','incidents','invites'].includes(group)&&args.length!==2)throw new PublicError('Nombre d’arguments invalide. Consultez help.');
  if(group==='jobs'&&args.length!==(verb==='list'?2:3))throw new PublicError('Indiquez un identifiant d’opération.');
  if(group==='site'&&args.length!==((verb==='announce'&&!ref)?2:3))throw new PublicError('Nombre d’arguments invalide. Consultez help.');
  if(group==='help'&&args.length!==1)throw new PublicError('La commande help n’accepte pas d’argument.');
  if(!group||group==='help'){allowed([]);return {type:'help',help:COMMAND_HELP};}
  if(group==='status'||group==='doctor'){allowed([]);if(args.length!==1)throw new PublicError('Cette commande n’accepte pas d’argument.');return {type:group==='status'?'overview':'diagnostic'};}
  if(group==='users'&&verb==='list'){allowed(['state','role','search','limit','offset']);return {type:'users',filters:{state:flags.state,role:flags.role,q:flags.search,limit:flags.limit,offset:flags.offset}};}
  if(group==='user'){
    allowed(verb==='note'?['message']:verb==='sessions'?['include-current']:[]);
    if(!ref||args.length>(verb==='role'?4:3))throw new PublicError('Indiquez un seul identifiant de compte.');
    if(verb==='inspect')return {type:'user',ref};
    if(['suspend','resume','archive','restore'].includes(verb))return write('account.'+verb,{refs:[ref]});
    if(verb==='role')return write('account.role',{refs:[ref]},{role:extra});
    if(verb==='sessions')return write('account.sessions',{refs:[ref]},{keepCurrent:!flags['include-current']});
    if(verb==='reset-password')return write('account.reset',{refs:[ref]});
    if(verb==='note')return write('account.note',{refs:[ref]},{note:flags.message});
  }
  if(group==='sync'&&['run','pause','resume'].includes(verb)){allowed(['source','user','all']);return write('sync.'+verb,target(),{source:flags.source||'ent'});}
  if(group==='feed'&&['rebuild','rotate','revoke'].includes(verb)){allowed(['user','all']);return write('feed.'+verb,target());}
  if(group==='mail'&&verb==='pause'||group==='cache'&&verb==='clear'){allowed(['user','all']);return write(group+'.'+verb,target());}
  if(group==='jobs'){allowed(verb==='list'?['limit','offset']:[]);if(verb==='list')return {type:'jobs',filters:{limit:flags.limit,offset:flags.offset}};if(['show','cancel','retry'].includes(verb)&&ref)return {type:'job.'+verb,id:ref};}
  if(group==='incidents'&&verb==='list'){allowed([]);return {type:'incidents'};}
  if(group==='incident'&&verb==='ack'&&ref){allowed([]);return write('incident.ack',{ids:[ref]});}
  if(group==='invites'&&verb==='list'){allowed([]);return {type:'invites'};}
  if(group==='invite'&&verb==='create'){allowed(['role','hours']);return write('invite.create',{}, {role:flags.role||'member',hours:Number(flags.hours||24)});}
  if(group==='invite'&&verb==='revoke'&&ref){allowed([]);return write('invite.revoke',{ids:[ref]});}
  if(group==='site'){
    if(verb==='registration'&&['open','close'].includes(ref)){allowed([]);return write('site.registration',{}, {enabled:ref==='open'});}
    if(verb==='maintenance'&&['on','off'].includes(ref)){allowed(['minutes','message']);return write('site.maintenance',{}, {enabled:ref==='on',minutes:Number(flags.minutes||30),message:flags.message||''});}
    if(verb==='automation'&&['pause','resume'].includes(ref)){allowed(['source']);return write('site.automation',{}, {paused:ref==='pause',source:flags.source||'all'});}
    if(verb==='announce'){allowed(['title','message','minutes']);return write('site.announcement',{}, ref==='off'?{enabled:false}:{enabled:true,title:flags.title,message:flags.message,minutes:Number(flags.minutes||60)});}
  }
  if(group==='logs'&&verb==='tail'){allowed(['level','user','limit']);return {type:'logs',filters:{level:flags.level,user:flags.user,limit:flags.limit||30}};}
  if(group==='secret'&&verb&&args.length===2){allowed([]);return {type:'job.secret',id:verb};}
  if(group==='apply'&&verb&&args.length===2){allowed([]);return {type:'apply',id:verb};}
  throw new PublicError('Commande inconnue. Utilisez « help » pour afficher les commandes disponibles.');
}
