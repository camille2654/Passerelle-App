## 4.26.4 — 8 novembre 2026 · première requête des nouveaux onglets

- Le journal réel montre une navigation PRONOTE suivie de l’échec de capture,
  sans démarrage d’import. Le serveur public PRONOTE répond bien depuis le
  client HTTP employé par Playwright (302 élève, 200 initialisation mobile).
- Reproduction exacte du message « Le portail ENT ne répond pas » avec le code
  4.26.3 : vrai Chromium, serveur HTTP local, lien ouvert dans un nouvel onglet.
  Le cadre de la première requête n’existe pas encore et son accès lève une erreur.
- Le correctif passe les douze scénarios Chromium, dont nouvel onglet direct,
  nouvel onglet après 302 et formulaire POST 307 dans un nouvel onglet. Les neuf
  scénarios précédents (méthodes, boucles, destinations) restent couverts.
- Dix tests Node ciblés : parseur, capture avant création du cadre, rôles, délais,
  redirections et formulaires ; diagnostic limité à une étape et un code, sans
  exception brute ni champ sensible. Les échanges de ces tests sont synthétiques.
- Le formulaire complet passe en navigateur : bouton/Entrée, import visible,
  confirmation, conservation de l’élève/source/ICS et récupération d’erreurs.
- Après publication, un contexte anonyme séparé atteint la vraie page de
  connexion CAS du lycée, puis y revient aussi après ouverture de PRONOTE dans
  un nouvel onglet. Aucun identifiant saisi, aucune donnée scolaire consultée,
  aucun compte de production créé. Ce contrôle public ne valide pas l’import
  authentifié. HTTPS, les API privées et les 668 fichiers de l’archive sont vérifiés.
- La confirmation de l’import authentifié sur le compte réel reste nécessaire.

## 4.26.3 — 8 novembre 2026 · redirections de connexion

- La seconde session réelle est authentifiée, et son HTML est reconnu par le
  lecteur installé, mais aucun import n’a été lancé. Diagnostic de forme seul,
  sans retour du HTML, des valeurs SSO ou des données scolaires.
- Le défaut est reproduit dans un vrai Chromium avec une redirection HTTP 302
  locale : le gestionnaire ne voit pas la destination et le navigateur consomme
  le bootstrap. Aucun appel ENT réel pendant cette reproduction.
- 29 tests Node ciblés passent : analyse, transfert, rôle, délais, domaines,
  redirections, formulaires POST préservés, sources et abonnements existants.
- Neuf scénarios de redirection passent dans Chromium avec le correctif :
  GET 302/307/308, POST 302/303/307/308, boucle et domaine interdit. La capture
  arrive une seule fois ; aucun bootstrap n’est consommé par le navigateur.
- Le protocole d’échange authentifié et l’import sur le compte du lycée restent
  à confirmer après une nouvelle connexion ; ces tests sont locaux et synthétiques.

## 4.26.2 — 8 novembre 2026 · reprise SSO PRONOTE

- Diagnostic autorisé de la fenêtre réelle : espace Élève authentifié, bootstrap
  présent avec champs SSO, mais état Passerelle encore `login`. Seule la forme
  technique a été retournée ; aucun contenu scolaire ni secret n’a été affiché.
  L’inspection locale a été refermée et son port de boucle locale est fermé.
- Défaut 4.26.1 reproduit sur un POST à la racine : navigation poursuivie sans
  transfert, état `login`. Avec le correctif, capture unique et confirmation.
- 26 tests Node ciblés : formats encodés et JSON, parseur sans exécution de code,
  GET/POST et racines, rôle Élève, délai sans transfert, captures interrompues,
  normalisation, élève/ICS conservés et rotations de sources.
- Quatre tests Python hors réseau : transfert et vérification mobile, cookies
  PRONOTE uniquement avec échéances, maintien de l’identifiant et migration de
  l’ancienne adresse mobile, refus des destinations non autorisées.
- La vraie page publique mobile du serveur indiqué par la capture répond avec
  le sélecteur natif ; sans lui elle redirige vers le CAS. Le parseur de la
  bibliothèque installée accepte son bootstrap. Aucune authentification réelle
  ni lecture des données d’un compte pendant cette vérification publique.
- `pronote-form-browser.smoke.mjs` : formulaire réel, POST SSO à la racine,
  étape d’import visible, clavier/image masqués pendant l’import, récupération
  après requête d’image annulée, erreurs persistantes, lien collé, absence de
  navigation native, reprise d’URL et élève/source/ICS conservés ; mobile,
  ordinateur, sombre, mouvement réduit ; aucune erreur JS/CSP.
- `multi-ent-browser.smoke.mjs` : recherche nationale et source principale
  ENT→PRONOTE toujours valides aux quatre largeurs. Serveurs et comptes simulés.
- L’import complet sur le lycée réel nécessite une nouvelle connexion avec le
  correctif : la fenêtre observée a expiré après le diagnostic de forme.

## 4.26.1 — 8 novembre 2026 · formulaire PRONOTE

- Défaut 4.26.0 reproduit en Chromium : le vrai formulaire navigue vers l’accueil
  et n’appelle pas l’API ENT. Aucune connexion ENT réelle pendant la reproduction.
- 16 tests Node ciblés passent (PRONOTE et multi-ENT), dont la sélection de l’ENT
  connecté, les liens PRONOTE directs nettoyés, les origines et espaces refusés,
  l’association explicite des élèves et la conservation des données.
- Le nouveau parcours `pronote-form-browser.smoke.mjs` utilise le vrai formulaire,
  son API et un menu ENT synthétique. Bouton et Entrée, ENT automatique, clic
  PRONOTE, confirmation, lien copié, aucune navigation native, erreur en place,
  nettoyage des anciennes URL sans envoi des champs, source/élève/ICS conservés.
  Mobile, ordinateur, sombre et mouvement réduit ; aucune erreur JS/CSP.
- Le parcours national et la connexion ENT→PRONOTE comme source principale restent
  vérifiés par `multi-ent-browser.smoke.mjs`, avec quatre largeurs.
- `npm run check` : syntaxe des modules. Aucun mail ni compte de test en production.
- Les échanges ENT/PRONOTE des tests sont simulés. L’ouverture réelle du SSO du
  lycée doit être confirmée par son utilisateur dans la fenêtre de connexion.

## 4.26.0 — 8 novembre 2026 · ENT de plusieurs régions

- `npm run check` : syntaxe des modules existants et nouveaux connecteurs.
- 46 tests Node ciblés : core, PRONOTE, rotations Skolengo, connecteur Lapsus,
  catalogue et parcours ENT→PRONOTE. Deux tests Python de contrat hors réseau.
- `multi-ent-browser.smoke.mjs` : recherche nationale et filtre, portail inconnu,
  connexion ENT simulée, confirmation de l’élève, notes, création ICS comme
  source principale, services absents masqués, isolation et déconnexion.
  Largeurs 320/390/820/1440, thème sombre, mouvement réduit, aucune erreur JS/CSP.
- `hub-browser.smoke.mjs` : recherche, rattrapage, fiches, bilan, connexion PRONOTE
  complémentaire, notes/bulletins, assistance utilisateur/admin, brouillons,
  mobile/sombre/mouvement réduit et confidentialité à la déconnexion.
- Les cours annulés gardent leur identifiant lors d’un renouvellement de référence ;
  les devoirs terminés avant création de l’ICS gardent leur état après import.
- Aucun appel ENT réel, aucun mail et aucun compte de test en production.
  La compatibilité des nouveaux SSO doit être confirmée avec des utilisateurs réels.
  Couverture et limites : [MULTI_ENT.md](docs/MULTI_ENT.md).

## Travail, cours et documents · 4.25.0

Les 28 tests ciblés passent : favoris et documents liés, découverte, nouvel aperçu et regroupement des échéances. L’aperçu refuse les comptes et élèves incorrects, les copies d’un autre profil et les formats non pris en charge ; les liens externes ne sont pas suivis. Les réponses binaires ont les bons types et restent privées, sans cache. Les tests de dates couvrent les changements de mois et d’année et une transition d’heure de Paris, sans mutation des objets reçus. Un ENT ne fournissant pas les devoirs propose l’ajout manuel. Le contrôle de syntaxe complet passe, complété par celui de la dernière adaptation de texte.

Le nouveau parcours Chromium termine avec une sortie 0 : quatre groupes d’échéance, ordre des travaux, groupe des terminés, suivi et annulation réelle, formulaire court, détails facultatifs et brouillon conservé. Les fiches passent au cours précédent/suivant de la journée, conservent les brouillons par matière et enregistrent une note personnelle. Le lecteur dessine effectivement des pixels de texte d’un PDF de test valide, change de page, agrandit le rendu et télécharge l’original. Une photo est décodée et un format non pris en charge conserve le téléchargement. Les copies liées aux devoirs s’ouvrent dans le même lecteur. Une réponse retardée ne peut pas repeindre un document après le changement de compte. Les nouveaux états vides conduisent à une action utile.

Les largeurs 320, 390, 820 et 1440 px ne débordent pas ; le thème sombre et la réduction du mouvement sont exercés. Les captures des devoirs, de la fiche et du lecteur sont inspectées. Aucune erreur JavaScript/CSP, aucun appel ENT réel, aucun mail réel : seules des données et des comptes fictifs sont utilisés.

Les parcours complets existants de l’agenda et de la recherche/matières terminent aussi avec une sortie 0. Ils conservent les annulations, regroupements, changements depuis la visite, notes, suivi des devoirs, dates, pauses, glissement, défilement et nettoyage. Le parcours de recherche est adapté à l’ouverture réelle du lecteur avant le téléchargement ; il valide également la distribution minifiée de PDF.js. Les filtres, rattachements de documents, brouillons, fiches de révision, réponses tardives et changements de compte restent vérifiés. Aucun essai sur iPhone physique ni déploiement Lapsus n’est affirmé.

Les fichiers PDF.js et leurs licences viennent du paquet officiel pdfjs-dist 6.5.438, dont l’intégrité SHA-512 a été vérifiée avant extraction. Aucun paquet n’a été installé dans les dépendances de production et aucun CDN n’est appelé au rendu.

## Plus simplifié et animations · 4.24.0

Le parcours Chromium dédié termine avec une sortie 0. Il vérifie les quatre raccourcis et les six liens d’action immédiatement visibles, les groupes repliés, l’accès aux outils regroupés et à l’administration. Il mesure un rendu intermédiaire réel du repère de navigation, du dépliage et de la fiche de cours : leurs positions et hauteurs passent effectivement entre l’état initial et l’état final. Les quatre cartes sont animées progressivement. Le clavier, l’inversion rapide de l’ouverture des groupes, la fermeture des fiches, le recalage du repère après changement de largeur et le nettoyage à la déconnexion sont vérifiés.

Les largeurs 320, 390, 820 et 1440 px ne débordent pas. Le thème sombre et la réduction du mouvement sont contrôlés. Avec la réduction activée, les groupes restent utilisables immédiatement et aucune animation ne reste active. Les captures mobile et ordinateur sont inspectées. Aucune erreur JavaScript/CSP, aucun appel ENT réel et aucun mail réel.

Le parcours existant de l’expérience termine également avec une sortie 0 : réglages, applications connectées, connexion, erreurs et reprise, agenda, date et défilement conservés, suivi et annulation réelle des devoirs, refus d’écriture, brouillon de note et changement de profil. Les données et comptes sont fictifs. Les contrôles de syntaxe des fichiers modifiés passent.

Une vérification isolée du script d’administration confirme que sa minuterie et son raccourci restent inactifs tant que le script principal n’a pas défini son état. Ce contrôle couvre la course au démarrage relevée pendant une navigation du navigateur de test. Aucun essai sur iPhone physique ni déploiement Lapsus n’est affirmé.

## Parcours et présentation · 4.23.0

Les 25 tests ciblés passent : agenda, actions de devoir, fiches matières et démarrage. La vérification de syntaxe initiale complète passe ; les fichiers modifiés ensuite sont vérifiés à nouveau individuellement.

Le nouveau parcours Chromium termine avec une sortie 0 : réglages en quatre groupes, applications connectées accessibles, connexion en trois étapes avant et après récupération, recherche d’établissement conservée après erreur, échec d’ouverture de l’ENT, reconnexion, source indisponible et interruption réseau. Le retour dans l’agenda rétablit la date et le défilement après le chargement ; la fermeture d’un cours retrouve le bouton recréé après actualisation. Les cases et annulations écrivent réellement dans le stockage temporaire. Les annulations refusées sont signalées dans la fiche ou la confirmation, sans effacer le statut sauvegardé. Le brouillon de note reste présent. L’annulation fonctionne également dans Devoirs et Mes matières. Les changements de compte effacent les actions et positions du profil précédent.

Les largeurs 320, 390, 820 et 1440 px sont vérifiées sans débordement horizontal, ainsi que le thème sombre et la réduction du mouvement. L’ouverture de fiche est également exercée sans réduction du mouvement. Les captures sont inspectées sur mobile. Aucune erreur JavaScript/CSP, aucun appel ENT réel, aucun mail réel : les comptes et données sont fictifs.

Le parcours complet existant de l’agenda termine aussi avec une sortie 0 : vues, regroupement, cours actuel, changements depuis la visite, fiche, suivi des devoirs, refus d’écriture, notes, glissement, horaires, récréations/déjeuner, annulations, événements et nettoyage à la déconnexion. Ces contrôles concernent Passerelle ; aucun déploiement Cloudflare de Lapsus ni essai sur iPhone physique n’est affirmé.

## Correctif du connecteur Cloudflare externe · 7 novembre 2026

Les 15 tests ciblés du connecteur et de son client passent, dont les redirections 300/301/302/303/304/307/308 d’Auth et de Passerelle, l’absence de suivi avec des identifiants, les pannes réseau, la corrélation des diagnostics sans secrets et la résistance à une panne du journal. Les parcours existants de session, PKCE, cookie chiffré, compte propriétaire, chemins autorisés, suppression de compte, mails et actualités restent couverts.

Le véritable moteur `workerd@1.20261106.1` reproduit le refus de l’ancienne option `redirect: 'error'` puis valide la fonction corrigée : Auth et Passerelle synthétiques, 401 de session expirée, redirections refusées, erreurs de transport distinguées, PKCE et cookie chiffré. Le moteur ne dispose d’aucun accès Internet ; aucun compte réel, ENT ou mail réel n’est utilisé. Les deux patches s’appliquent à leur base attendue, le ZIP complet est identique au résultat du patch et l’aperçu visuel reste identique. La syntaxe est vérifiée.

Les archives et guides sont publiés sur Passerelle pour le propriétaire de Lapsus. Aucun déploiement Cloudflare ni écriture GitHub distant n’est effectué ; la connexion réelle d’un utilisateur reste à vérifier après le redéploiement par ce propriétaire. L’application Passerelle, ses services et sa version 4.22.0 restent inchangés par la publication de ces ressources.

## Recherche et fiches matières · 4.22.0

Les 44 tests ciblés passent : recherche avec accents, catégories avant limitation, compteurs, catalogue par élève, cours actifs/annulés, travail à faire et terminé, documents et associations, refus des comptes et profils étrangers, données locales sans appel ENT, absence de contenu de fichier dans l’index, favoris supprimés et documents dont la matière a disparu. Les notes refusent un ancien compte ou élève avant toute écriture. Les régressions des documents, ressources, agenda, outils personnels et statut restent couvertes. La vérification de syntaxe complète passe ; les fichiers modifiés ensuite ont leur syntaxe revérifiée.

Le nouveau parcours Chromium termine avec une sortie 0 : recherche depuis l’en-tête et au clavier, filtres, téléchargement privé, fiches matières, devoir fait puis remis à faire, note et contenu échappé, association d’un favori, accès aux révisions, brouillon conservé lors d’un rafraîchissement ou d’une panne, réponse tardive ignorée et changement de compte pendant une saisie. Les largeurs 320, 390, 820 et 1440 px sont contrôlées, ainsi que le thème sombre, le mouvement réduit et l’en-tête administrateur sur 320 px. Aucun débordement ni erreur JavaScript/CSP ; aucun ENT ni mail réel utilisé.

Les parcours existants des outils et de l’agenda passent également : Pronote simulé, recherche, fiches de révision, support membre/administrateur, navigation de semaine et de journée, annulations, changements, notes, devoirs et retour arrière. Un accès au compte avant l’initialisation du script a été signalé par un premier parcours ; le nouveau raccourci vérifie désormais l’initialisation avant toute lecture, et le parcours relancé termine sans erreur avec collecte des piles. Les fichiers de test et les données restent isolés de la production.

## Graphiques du statut et suivi indépendant · 4.21.1

Les 16 tests ciblés passent : six tests Python du moniteur et dix tests Node du statut et des graphiques. Ils vérifient l’absence de données privées, l’écriture atomique et les droits du fichier public, la conservation après redémarrage, la rétention, les données invalides/futures/dupliquées, les réponses HTTP invalides ou anciennes, les échecs sans latence artificielle et le refus d’une URL externe. Les calculs de médiane, compteurs, points isolés, interruptions de courbe et périodes sans mesure sont contrôlés.

Le nouveau parcours Chromium termine avec une sortie 0 : graphiques filtrables sur 1/6/24 h, compteurs exacts sur les seules observations reçues, consultation au clavier et au toucher, table accessible, point unique, absence de données, réponse invalide, mesures anciennes et fichier d’historique accessible quand l’API courante est en panne. Les détails des services restent ouverts au rafraîchissement. Les largeurs 320, 390, 820 et 1440 px ne débordent pas, en clair/sombre et mouvement réduit, sans erreur JavaScript/CSP. Les observations fictives du test restent isolées ; elles ne sont pas publiées.

Le parcours précédent de la page de statut passe également : absence de cookie, maintenance, pause, panne, réponse invalide, retrait du vert, reprise, historique récent et lien depuis le portail. Un essai HTTP local réel confirme trois observations successives : backend actif, arrêté, puis rétabli ; l’historique survit et l’échec conserve `responseMs: null` au lieu d’une mesure de zéro milliseconde, sans donnée de compte. Les contrôles de syntaxe et la validation de l’unité systemd passent. Aucun ENT ni mail réel n’est utilisé par les essais.

Après publication, HTTPS confirme la version 4.21.1, les sept ressources statiques et l’historique JSON issu de vrais contrôles. Les graphiques, leurs ressources et les mesures restent accessibles pendant l’arrêt du backend ; le processus du moniteur conserve le même identifiant pendant le redémarrage de Passerelle. Les deux services sont actifs sans redémarrage sur erreur. La modification Nginx ajoute seulement l’emplacement du JSON public et conserve les autres routes.

Le parcours Chromium public termine avec une sortie 0 : vraies observations chargées, graphiques et six frises, filtres 1/6/24 h, clavier, modes sombre et mouvement réduit, largeurs 320/390/820/1440 px sans débordement ni erreur JavaScript/CSP. Seuls les deux points publics du suivi sont consultés ; les APIs privées restent protégées. Aucun compte de test n’a été créé en production. Les huit comptes, cinq liens ICS, réglages mail/push, configuration du connecteur et clé de chiffrement sont conservés.

## Page de statut publique · 4.21.0

Les 33 tests ciblés passent : suivi des services, configuration distincte des observations, déduplication des passages, échec/reprise sans erreur brute publiée, signaux anciens ou futurs, pauses/maintenance, auto-contrôle ICS, historique borné et isolation des réponses publiques. La réponse est identique avec une session membre, administrateur ou sans session ; les comptes, adresses, tokens et liens ICS restent absents et les fichiers privés inchangés. Les parcours existants d’administration, comptes, calendrier et authentification restent couverts. La vérification de syntaxe complète passe.

Le parcours Chromium de la nouvelle page termine avec une sortie 0 : six services, récupération sans cookie, services non activés distincts, maintenance, pause, historique, erreur HTTP, réponse invalide, retrait des états verts après vieillissement et reprise. Les largeurs 320, 390, 820 et 1440 px ne débordent pas ; modes clair/sombre et mouvement réduit sont vérifiés. Le lien de pied de page reste accessible depuis l’application sur petit écran. Aucune erreur JavaScript/CSP, aucun appel ENT et aucun mail réel.

Un démarrage réel de `src/server.js` sur un répertoire temporaire confirme les signaux des minuteries de synchronisation et de push après leur premier passage. Cette instance ne contient aucun compte et ne réalise aucun appel ENT ni envoi de mail. Les observations ne sont pas déclenchées artificiellement par la page et aucun statut configuré n’est assimilé à une vérification réussie.

Après publication, HTTPS confirme la page, ses six ressources publiques, l’API 4.21.0 et ses six composants. La page et toutes ses ressources sont vérifiées pendant l’arrêt du service Node, tandis que l’API est indisponible. Les deux emplacements Nginx ajoutés sont les seuls changements de configuration ; les routes existantes sont identiques. Le rechargement gracieux est suivi d’une vérification des nouvelles routes avant l’arrêt du backend.

Le parcours Chromium public en production termine avec une sortie 0 aux quatre largeurs, en sombre et mouvement réduit, sans erreur JavaScript/CSP et avec seulement l’API publique de statut consultée. L’icône Apple reste identique et les APIs privées refusent l’accès anonyme. Aucun compte de test n’a été créé en production. Les huit comptes, cinq liens ICS, réglages mail/push, connecteur et clé de chiffrement sont conservés ; le service est actif sans redémarrage sur erreur.

## Icônes de matières dans l’agenda · 4.20.4

Les 15 tests ciblés passent : heures de Paris, chevauchements, annulations, regroupement, pauses et bilan des horaires. Le contrôle de présentation vérifie les pictogrammes de maths, langue et matière inconnue, les titres lisibles sans préfixe emoji dans les vues journée et semaine, les sigles et la conservation exacte des objets source.

Le parcours complet Chromium de l’agenda termine avec une sortie 0 : les quatre blocs de cours de la journée de référence contiennent chacun un SVG visible et aucun texte emoji dans le pictogramme. Les titres restent lisibles aux largeurs 320, 390, 820 et 1440 px, sans débordement horizontal. Les vues semaine/journée, thèmes clair/sombre, mouvement réduit, détail de cours, devoirs faits/remis à faire, refus d’enregistrement, brouillon de note, pauses/récréations, dates, glissement et déconnexion restent vérifiés. Aucune erreur JavaScript/CSP, aucun appel ENT ou mail réel ; seules des données temporaires sont utilisées. Les contrôles de syntaxe passent.

HTTPS confirme la version 4.20.4, les trois ressources d’agenda publiées et leurs nouveaux marqueurs de cache. Les octets correspondent aux fichiers testés. L’API semaine reste privée et l’icône Apple reste identique. Les huit comptes, cinq liens ICS, réglages privés, connecteur et clé de chiffrement sont conservés. Aucun compte de test n’a été créé en production ; le service est actif sans redémarrage sur erreur.

## Récréations et pauses déjeuner · 4.20.3

Les 15 tests ciblés de l’agenda et du bilan des horaires passent. Les assertions de pauses vérifient deux récréations de quinze minutes, le déjeuner de 12:10 à 13:05, les plages de 11 h à 13 h et de 13 h à 14 h, ainsi que les interruptions en dehors de cette fenêtre. Une interruption de quinze minutes reste une récréation à midi. Les rendez-vous personnels, annulations, chevauchements et cours adjacents conservent leur traitement ; les objets source restent identiques.

Le parcours visuel ciblé termine avec une sortie 0 en Chromium aux largeurs 320, 390, 820 et 1440 px : deux libellés Récréation et un libellé Pause déjeuner visibles, durée et horaires réels conservés, en-tête compact sur une ligne et date persistante au défilement. Le thème sombre reste lisible. Aucun débordement de page ni erreur JavaScript/CSP. Les contrôles de syntaxe passent. Ces vérifications utilisent des données et comptes fictifs, sans appel ENT ou mail réel.

HTTPS confirme la version 4.20.3 et les fichiers testés. L’API semaine reste privée et l’icône Apple est inchangée. Les huit comptes, cinq liens ICS, réglages privés, connecteur et clé de chiffrement sont conservés. Aucun compte de test n’est créé en production ; le service reste actif sans redémarrage sur erreur.

## Agenda compact, date persistante et pauses · 4.20.2

Les 15 tests ciblés passent : présentation de l’agenda, heures de Paris, chevauchements, séances regroupées, préservation des sources et bilan des horaires. Les cas ajoutés vérifient les pauses de quinze et cinquante-cinq minutes, l’absence de pause artificielle entre cours adjacents, les événements personnels et les annulations. Aucun repas ni disponibilité personnelle n’est déduit d’un créneau.

Le parcours Chromium complet de l’agenda termine avec une sortie 0 : bandeau au défilement et au-dessus des cartes, flèches de jour, retour à aujourd’hui sans requête de semaine supplémentaire, passage dimanche/lundi dans les deux sens, navigation des semaines et date native. Les actions existantes restent vérifiées : devoir fait/remis à faire, cohérence avec Devoirs, refus d’enregistrement, brouillon conservé, note personnelle, glissement, annulations, événements et nettoyage à la déconnexion. Aucun débordement horizontal aux largeurs 320, 390, 820 et 1440 px ; thèmes clair/sombre et mouvement réduit conservés, aucune erreur JavaScript/CSP.

Le contrôle visuel complémentaire vérifie l’en-tête compact sur une ligne aux quatre largeurs, le bandeau persistant et le thème sombre. Les vérifications utilisent uniquement des comptes et données temporaires ; aucun appel ENT ni mail réel. La vérification de syntaxe passe. Aucun essai sur un iPhone physique n’est affirmé.

Le contrôle HTTPS confirme la version 4.20.2 et les fichiers publiés. L’API semaine reste privée, l’icône Apple est identique et le kit Lapsus reste disponible. Le parcours public instrumenté final termine avec une sortie 0, sans débordement aux quatre largeurs et sans erreur JavaScript/CSP. Un premier passage avait relevé « state is not defined » sans pile ; cette erreur ne s’est pas reproduite lors du contrôle instrumenté. Aucun compte de test n’a été créé en production. Les huit comptes, cinq liens ICS, réglages privés et clé de chiffrement sont conservés ; le service est actif sans redémarrage sur erreur.

## Bilan des horaires et validation des devoirs depuis un cours · 4.20.1

Les 54 tests ciblés passent : calcul des conséquences des changements, action de devoir réversible et réservée au propriétaire, vue de semaine, calcul d’agenda existant, historique/repère de consultation, authentification et flux ICS, synchronisation rapprochée et organisation personnelle. Le test API de l’action vérifie aussi le signal de modification commun aux autres vues.

Les calculs comparent les limites réelles des cours actifs de la journée : annulation du premier cours, modification du dernier, absence d’effet d’une annulation intérieure, changements successifs et rétablissement, cours déplacé entre dates, journée sans cours et nouveaux cours. Un historique incomplet, un ancien état d’annulation inconnu ou des horaires invalides ne donnent pas lieu à une annonce déduite. La fusion des consultations en cours garde le premier repère et efface les effets annulés par un rétablissement. Le calcul ne modifie aucun événement source.

Le parcours Chromium de l’agenda termine avec une sortie 0 : résumé concret, cours regroupés, progression, détail de cours, coche et remise à faire, état conservé à la réouverture, cohérence de la page Devoirs, restauration de la case après refus et conservation du brouillon de note. Les parcours existants de navigation, annulations, événements personnels, devoirs, notes et déconnexion restent couverts. Thèmes clair/sombre, mouvement réduit et largeurs 320, 390, 820 et 1440 px sans débordement ni erreur JavaScript/CSP. Les données sont fictives ; aucun ENT ni mail réel n’est utilisé.

Le parcours navigateur des outils termine également avec une sortie 0 : historique depuis la dernière consultation, recherche, rattrapage, fiches, bilan, assistance et confidentialité à la déconnexion. Les données de préparation du test indiquent que les nouveautés de la version précédente ont déjà été consultées ; le parcours de ces nouveautés reste indépendant.

Après publication, HTTPS confirme la version 4.20.1 et les ressources testées. L’API semaine reste privée, l’icône Apple garde les mêmes octets et le kit Lapsus existant reste servi. Le parcours public Chromium termine avec une sortie 0 aux quatre largeurs, sans erreur JavaScript/CSP ni compte de test créé en production. Les huit comptes, cinq liens ICS, réglages mail/push, configuration du connecteur et clé de chiffrement sont conservés. Le service est actif sans redémarrage sur erreur.

## Agenda interactif et mails/actualités Lapsus · 4.20.0

Les 329 tests de la suite complète Passerelle passent sans échec. Ils comprennent le regroupement visuel des séances adjacentes sans modifier les sources, les plages de Paris et changements d’heure, les annulations, le repère de dernière visite et les fonctions existantes. Les nouveaux essais du connecteur couvrent les permissions séparées des mails/actualités, les listes privées mises en cache, les contenus intégraux, les documents bornés, les références liées au compte et à sa source, le refus de références d’un autre compte, les rubriques non fournies et les erreurs temporaires. Un changement d’élève pendant une actualité en cours de chargement rejette la réponse et ne transfère pas son contenu au nouveau profil.

Les douze tests de la fonction Cloudflare et du client Lapsus passent. Le contrat entre les deux services réels locaux passe avec Auth et ENT simulés : PKCE, agenda/devoirs, mails, actualités, contenu intégral, téléchargement et isolation, avec conservation exacte des comptes/sessions du portail. Les tokens ENT et la clé serveur ne sont pas transmis dans les réponses publiques.

Le parcours Chromium de l’agenda vérifie les créneaux regroupés, le cours actuel et sa progression, les indications de changement de salle depuis la dernière visite, le panneau de cours, un ajout de note par l’API, le glissement des jours, le nettoyage du dialogue à la déconnexion, la navigation des semaines, les annulations et les sources complémentaires. Les largeurs 320, 390, 820 et 1440 px restent sans débordement. Les thèmes clair/sombre et le mouvement réduit sont vérifiés, sans erreur JavaScript/CSP.

Le parcours Chromium Lapsus vérifie les mails et actualités dans les écrans existants, le texte intégral échappé, une pièce jointe téléchargée et les pages de messages précédents. Il couvre aussi les modifications/suppressions de cours, la conservation des imports et devoirs personnels, les changements de source, les réponses tardives, la déconnexion et la suppression du compte. Il termine avec une sortie 0, aux largeurs 320, 390 et 1440 px en clair/sombre. Aucun ENT, compte Supabase ou mail réel n’est utilisé par ces essais.

Le parcours global de navigation Passerelle et le parcours de connexion ENT gérée terminent également avec une sortie 0 : rubriques, réglages, administration, déconnexion, choix d’élève, saisie distante, PKCE et affichage des nouveaux types de données. Le patch Lapsus est appliqué sur sa base Git de référence puis comparé au ZIP et aux fichiers testés.

Le kit Lapsus est préparé pour son propriétaire ; les variables Cloudflare et le déploiement distant restent nécessaires avant un essai ENT réel. Aucun déploiement Lapsus ni essai sur un iPhone physique n’est affirmé.

Après publication, HTTPS confirme la version 4.20.0, les fichiers livrés, le kit Lapsus et son aperçu avec mails/actualités. Les APIs privées refusent l’accès anonyme. Le parcours public Chromium termine avec une sortie 0, sans erreur JavaScript/CSP, sans débordement aux quatre largeurs et sans appel API depuis l’aperçu. L’icône Apple reste identique. Les huit comptes, cinq liens ICS, réglages SMTP/push, configuration du connecteur et clé de chiffrement sont conservés. Le service reste actif sans redémarrage sur erreur et aucun compte de test n’est créé en production.

## Vue journée : cartes compactes après retour sur capture

Les six tests unitaires de présentation passent : les contrôles existants sont conservés et complétés par les libellés ENT, les emojis sans doublon, les sigles LV2, les noms personnalisés, les durées et la conservation exacte des objets source. Les intervalles tiennent compte de la fin des activités chevauchantes et ne sont pas bloqués par les cours annulés.

Le parcours Chromium dédié vérifie aussi une journée fictive reproduisant la structure de la capture reçue : cinq cours, dont deux créneaux consécutifs d’histoire-géographie, les intitulés en majuscules, les salles et l’intervalle de midi. À 390 px, les cinq cartes et leur intervalle occupent moins de 520 px ; les titres complets restent visibles à 320, 390, 820 et 1440 px. Les emojis ont leur taille dédiée et la sélection du dimanche reste visible. Les thèmes clair/sombre, les annulations, les vues journée/semaine, les chevauchements, les devoirs, les événements personnels et du lycée, les transports et les commandes de navigation sont conservés. Aucun appel ENT, aucun envoi de mail et aucun compte de production ne sont utilisés par ce parcours.

Après publication, les fichiers servis en HTTPS correspondent aux sources testées et le parcours public termine avec une sortie 0 : aucun débordement aux quatre largeurs, aucune erreur JavaScript/CSP, API semaine réservée aux comptes connectés et icône Apple préservée. Les huit comptes, cinq liens ICS, réglages mail/push et clé de chiffrement sont conservés. Le backend reste identique et le service est actif sans redémarrage sur erreur. Aucun essai sur un iPhone physique n’est affirmé.

## Agenda : grille horaire et vue journée

Quatre tests unitaires passent sur la présentation : heures de Paris en été et hiver, changement d’heure avec heure répétée, découpage à minuit, gestion des chevauchements, éléments sur une journée entière et horaires incomplets, annulations, devoirs et contrôles, données échappées et date des transports.

Le parcours Chromium dédié termine avec une sortie 0. Il vérifie la grille des sept jours, les titres visibles, les chevauchements, les vues Semaine et Journée, la sélection des jours et son défilement, les cours annulés, les devoirs et contrôles, les rendez-vous personnels et du lycée, les transports, les semaines vides, les flèches et le choix de date. La préférence de vue reste après rechargement. Les changements de vue et de jour ne provoquent pas de nouvelle lecture de semaine. Aucun débordement de page à 320, 390, 820 et 1440 px ; thèmes clair/sombre et animations réduites contrôlés, sans erreur JavaScript ou CSP. Seuls des comptes temporaires et données fictives sont utilisés.

Les assertions du parcours global de navigation passent également (quatre rubriques, devoirs, réglages, notifications, administration et déconnexion). Cette exécution a ensuite été terminée pendant la fermeture de son processus ; le parcours dédié à l’agenda a confirmé sa propre fermeture normale. Aucun appel ENT ou envoi de message réel n’a été effectué par les essais.

Après publication, HTTPS confirme le nouvel index, les fichiers livrés et le chargement du composant avant son intégration. Le parcours public Chromium ne relève aucune erreur JavaScript/CSP et les quatre largeurs restent sans débordement. L’API semaine refuse l’accès anonyme ; l’icône Apple inline garde les mêmes octets. Les huit comptes, cinq liens ICS, réglages mail/push et clé de chiffrement sont conservés. Les fichiers du backend restent identiques et le service est actif sans redémarrage sur erreur. Aucun compte de test n’a été créé en production.

## Présentation de l’application Passerelle inspirée de Lapsus

L’application principale utilise des cartes arrondies, une navigation compacte, des icônes issues de Lapsus et des textes plus lisibles. Le logo, Manrope et les couleurs claire/sombre de Passerelle sont conservés. Les formulaires publics, l’accueil, l’agenda, les devoirs, les outils et les réglages partagent cet habillage.

La revue Chromium utilise uniquement des comptes et données synthétiques. Les cinq vues principales sont contrôlées à 320, 390, 820 et 1440 pixels, sans débordement horizontal. L’en-tête et la navigation mobile restent visibles. L’ordre personnalisé des blocs est enregistré par l’API puis vérifié à l’écran. Le mode sombre, les animations réduites, la connexion et l’inscription sur petit écran sont également contrôlés. Aucun compte réel ni envoi réel n’est utilisé pour ces vérifications.

Les parcours existants vérifient les quatre destinations, les premiers pas, le choix aujourd’hui/demain, les annulations, les devoirs et leurs états, les réglages et notifications, l’administration, la console et le nettoyage à la déconnexion. Le parcours scolaire couvre les matières, les rappels, les contrôles personnels, les changements de salle et les mails via un transport simulé. Les fixtures de test ferment leurs connexions HTTP et suivent les dialogues de bienvenue et de nouveautés avant d’accéder aux outils.

Après publication, HTTPS sert les fichiers validés et le nouvel index. Le parcours Chromium public vérifie connexion, inscription, thème sombre et absence de débordement aux quatre largeurs, sans créer de compte réel. L’icône Apple inline correspond exactement au PNG existant. Les huit comptes, cinq abonnements ICS, réglages mail/push et clé de chiffrement sont conservés ; les fichiers du backend restent identiques. Le service est actif sans redémarrage sur erreur. Aucun essai sur un iPhone physique n’est affirmé.

## Habillage du connecteur ENT pour Lapsus

Les pages de connexion utilisent les couleurs et Manrope de Passerelle, les cartes et contrôles inspirés de Lapsus, ainsi que ses icônes de lycée, clé, agenda et validation. Le logo Lapsus identifie la destination. La police et les icônes sont servies localement. La signature fournisseur se limite à « Powered by PSRL ». Les styles ne chargent plus ceux du portail Passerelle et restent isolés de son interface.

Le parcours Chromium du connecteur passe sur des sources synthétiques : établissement, saisie et clavier mobile, choix d’élève, synchronisation, retour PKCE, annulation et administration. Les couleurs et la police de Passerelle, les icônes Lapsus et la signature discrète sont contrôlées. Le parcours Lapsus vérifie aussi sa carte ENT, les données, les modifications et suppressions, l’isolation et la suppression de compte. Aucun appel ENT, Supabase ou message réel n’est effectué.

L’aperçu public est contrôlé avec Chromium en 320, 390, 768 et 1440 px, en clair et sombre avec animations réduites. Aucun débordement horizontal, aucune erreur JavaScript ou CSP, aucun appel API ni aucune ressource de police distante. Les captures publiées montrent uniquement l’écran initial, sans compte ni établissement réel. Le kit Lapsus est actualisé ; son site distant n’est pas déployé par cette modification.

Après publication, les ressources HTTPS correspondent aux fichiers validés. L’aperçu Chromium en ligne passe : logo Lapsus, couleurs et police Passerelle, icônes Lapsus, signature PSRL, interaction de démonstration et absence d’appel API ou d’erreur. Les huit comptes et cinq liens ICS, les réglages privés et la clé de chiffrement sont conservés. Les ressources de l’application Passerelle et son backend restent identiques ; aucun redémarrage du service n’a été nécessaire. Le patch Lapsus a été appliqué à sa base Git de référence et comparé aux fichiers testés.

## Connecteur ENT géré et synchronisation adaptative · version 4.19.0

318 tests de la suite complète Passerelle passent, aucun échec. Ils incluent les fenêtres proches et la conservation de l’année complète, les devoirs hors plage, les changements de source pendant attente et la suspension pendant réponse, le recul après erreur, la cadence Paris, les profils techniques isolés, les permissions REST, le code PKCE unique, la révocation et le renouvellement préventif des tokens. Après le correctif de suppression de compte, les 13 tests du connecteur ont été relancés avec succès, dont un cas supplémentaire : retrait sans cache local, connecteur désactivé, clé et sujet toujours obligatoires, isolation, purge et révocation. Les contextes de connexion ENT gérés sont libérés après succès et échec ; les parcours du portail restent compatibles.

Le parcours Chromium Passerelle géré a terminé avec une sortie 0 : lycée, saisie et clavier mobile, plusieurs élèves, synchronisation, retour PKCE, annulation, administration et clé affichée une fois, masquage à la fermeture, désactivation et déconnexion. Aucun compte Passerelle n’est demandé dans ce parcours. Largeurs 320, 390 et 1440 px, sombre et animations réduites contrôlés, sans appel ENT ni mail réel.

Dans le dépôt Lapsus préparé, 10 tests unitaires passent : fonction Cloudflare, vérification Auth côté serveur, cookie chiffré, scopes, routes, retour lié au compte, nettoyage de l’URL avant Supabase, instantanés limités à leur plage, identifiants stables et retrait de la connexion avant suppression. Son scénario Chromium termine avec une sortie 0 : cours/devoirs/contrôles REST, changements et suppressions sans fantômes, préservation des imports et devoirs manuels, cache de source invalidé, réponse tardive après déconnexion, autre compte et mobile/sombre. Le parcours de suppression vérifie aussi l’arrêt avant RPC si le nettoyage échoue, l’affichage d’un échec RPC, le nettoyage distant sans cache local et l’effacement du cache du compte malgré la déconnexion. Supabase, API et ENT y sont simulés.

Le script `scripts/verify-lapsus-contract.mjs` appelle ensemble la véritable fonction Cloudflare locale et la véritable API Passerelle locale, en simulant seulement Supabase Auth et l’ENT. Le contrat PKCE, les JSON normalisés, l’isolation de deux sujets Lapsus, le nettoyage idempotent lorsque le connecteur est désactivé, l’absence de tokens source dans les réponses et la préservation exacte des comptes/sessions du portail sont vérifiés. Aucun appel Supabase ou ENT réel ni aucun message réel par ces essais.

La clé du connecteur n’est pas préconfigurée en production. Le propriétaire de Lapsus doit intégrer les fichiers préparés et renseigner les variables Cloudflare avant un test de connexion réel. L’accès GitHub disponible est en lecture seule ; aucune branche distante ni déploiement Lapsus n’est modifié. Le paquet ZIP et le patch correspondent aux fichiers testés, sans .env, données privées, journaux ou dépendances. Aucun test sur un iPhone physique ni sur un véritable compte ENT/Lapsus n’est affirmé.

Contrôle après publication : HTTPS confirme la version 4.19.0, les ressources livrées et les deux kits Lapsus (ICS existant et nouveau connecteur REST). Les 8 comptes et les 5 abonnements existants sont conservés, ainsi que leurs identifiants, SMTP, VAPID, appareils push, prise en main et clé de chiffrement. Les 2 804 événements actifs sont lisibles et aucun événement annulé n’est publié. Doctor, OCR et systemd sont sains. Le contrôle Chromium public confirme l’icône Apple inline, les nouveaux scripts et l’absence d’erreur JavaScript. Les routes de données sont fermées tant que le connecteur n’est pas configuré ; le retrait par DELETE exige toujours sa clé serveur. Aucun profil de test ni clé partenaire réelle n’a été créé en production. Le ZIP Lapsus correspond aux fichiers testés et le patch a été appliqué puis comparé au code testé sur sa base Git d’origine.

## Connexion partenaire Lapsus · version 4.18.0

Validation sur données synthétiques : 284 tests de la suite complète et 3 tests du module Lapsus passent (287 distincts, aucun échec). Les 14 tests OAuth vérifient les callbacks exactes, le consentement lié au navigateur et au compte, PKCE S256, le refus et le sous-ensemble de permissions, le code unique et sa révocation après rejeu, les durées de vie, CORS, le chiffrement, les droits ICS imposés côté serveur, les modifications/annulations, la révocation indépendante, le changement d’élève/source/lien et la suspension, les réglages administrateur et le redémarrage. Les trois tests du module fourni à Lapsus couvrent un échange réel avec le backend local, la liaison au compte Lapsus, les retours invalides ou périmés, le nettoyage de l’URL, ETag et le refus de liens étrangers. Aucun service distant n’est appelé par ces tests.

Le parcours Chromium local a terminé avec une sortie 0 : arrivée sans session, connexion puis reprise du consentement, choix minimal des agendas, refus, échange de code et lecture ICS, retrait d’accès sans modifier le flux maître, accompagnement d’un compte sans ENT, administration de la callback et de l’activation, et nettoyage à la déconnexion. Rendu contrôlé en 320, 390 et 1440 px, en sombre et avec animations réduites ; pas de débordement ni d’erreur JavaScript/CSP. Aucun mail, push ou appel ENT réel. Une première exécution ralentie avait terminé ses assertions avant une terminaison du shell ; l’exécution finale sans suite concurrente a confirmé la sortie 0.

Contrôle après publication : HTTPS confirme la version 4.18.0 et les fichiers livrés. Les APIs privées refusent l’accès anonyme ; la prévalidation CORS accepte uniquement l’origine prévue et ne partage pas les cookies. Les 8 comptes, leurs identifiants et les 5 abonnements existants sont préservés, de même que SMTP, VAPID, appareils push, prise en main et clé de chiffrement. Les 2 807 événements actifs gardent leurs UID et leurs ETag ; aucun événement annulé n’est publié. Doctor, OCR et systemd sont sains, sans redémarrage sur erreur. Le contrôle Chromium anonyme du site public passe avec les nouveaux scripts et l’icône Apple inline conservée. Aucun compte de test de production n’a été créé, aucun code Lapsus n’a été modifié et aucun message réel n’a été envoyé par les vérifications.

Le kit est livré avec un adaptateur volontairement à compléter. Le site Lapsus n’a pas été modifié : son développeur doit créer le bouton, servir la callback et brancher le stockage privé du compte connecté. Aucun essai sur un véritable compte Lapsus ni un iPhone physique n’est affirmé. La tâche transports reste en pause, sans changement de fournisseur ni de configuration existante.

# Validation Passerelle 3.1.0

## Sources réelles et continuité

Les deux comptes existants disposent d’un lien ICS privé inchangé. La période annuelle couvre le 1er septembre 2026 au 31 août 2027, avec 693 cours publiés par compte et des cours jusqu’au 2 juillet 2027. Les récupérations réelles des devoirs ont produit respectivement 41 et 44 travaux, sans avertissement du service de devoirs.

Le connecteur conserve la séparation entre cours (agenda par tranches de 14 jours) et devoirs (service dédié par tranches de 28 jours). Une réponse 400 n’est traitée comme une fin de pagination qu’après une page pleine et avec le message explicite de dépassement. Les périodes de devoirs qui commencent après le dernier cours publié ne sont pas demandées, car le service ENT les refuse pendant l’été. Les erreurs facultatives de devoirs ne rendent pas le lien de cours indisponible.

## Vérifications automatisées

26 tests passent : stockage et chiffrage, mots de passe, changements d’heure et année scolaire complète, stabilité des UID et SEQUENCE, déplacements et annulations, historique, lecture RFC 5545 indépendante, rejet de sources partielles, publication sans cookie, cache conditionnel 304, séparation des comptes, maintien du dernier agenda en panne, renouvellement et révocation, normalisation des matières, conversion des devoirs, détection des contrôles, récapitulatif de demain, agendas filtrés et rappels.

Les tests d’envoi vérifient la confirmation à usage unique, l’invalidation lors d’un changement d’adresse, le refus d’un destinataire non confirmé, l’heure de Paris, l’absence de doublon après redémarrage, le désabonnement et les erreurs de transport. L’association administrative peut être préparée sans expéditeur ; elle ne réactive pas un destinataire désabonné. La configuration Gmail est détectée et vérifiée, y compris l’import facultatif des variables du service.

Les tests du journal couvrent les secrets masqués, les droits privés, la persistance, la recherche et les filtres, la rotation, la conservation, les altérations et la troncature finale. Une intégrité en échec empêche l’écrasement silencieux du point de contrôle. Les API admin refusent les membres et les origines étrangères. Les exports ne contiennent ni les adresses mail ni les jetons.

Commandes : `npm run check`, `npm test`, `node tests/features-browser.smoke.mjs`, `node tests/admin-browser.smoke.mjs`. Les transports SMTP de test sont simulés ; aucun mail réel n’est envoyé. La réception réelle reste à vérifier après authentification d’un expéditeur par le propriétaire.

## Parcours navigateur

Le parcours utilise des comptes temporaires et un serveur isolé. Il contrôle les matières, les rappels, les devoirs, les contrôles personnels, les changements de salle, la configuration du transport, la confirmation, l’aperçu et le désabonnement. La nouvelle navigation est vérifiée sur ordinateur et téléphone. Les captures de validation ne montrent que des données fictives.

L’expéditeur réel n’est pas configuré par défaut : l’administration propose un formulaire gratuit Gmail (adresse et mot de passe d’application), ainsi qu’un formulaire SMTP complet. L’authentification du compte Google doit être effectuée par son propriétaire.

Le parcours admin dédié réussit : association sans expéditeur, configuration automatique Gmail simulée, confirmation du destinataire, suspension des briefs, filtres, contrôle d’intégrité et téléchargement du journal sans secrets. Aucun débordement horizontal à 390 px, aucune erreur JavaScript ou CSP. Les dépendances de production ont été auditées : aucune vulnérabilité signalée. La VM a confirmé la connexion réseau à smtp.gmail.com sur 465 (TLS) et 587, sans authentification ni envoi.


## Contrôle après déploiement

La version HTTPS 3.1.0, les nouvelles ressources et l’année 2026–2027 ont été confirmées. Les deux flux existants ont été téléchargés sans session et lus avec le parseur iCalendar indépendant. Leurs UID de cours correspondent aux identifiants persistés ; les lectures conditionnelles renvoient 304. Les journaux d’administration sont refusés sans connexion. Les deux parcours navigateur séparés (scolarité et administration) réussissent sur leur version finale. Le service systemd est actif. Les liens ICS existants ont été conservés et aucun expéditeur réel n’a été configuré sans ses accès.


## Refonte visuelle du 27 octobre 2026

Contrôle syntaxique réussi et parcours navigateurs scolaire et administration réussis avec la nouvelle présentation : matières, devoirs, contrôles, rappels, connexion du transport simulé, confirmations et désabonnement, association administrative, filtres et export des logs. Aucun envoi réel pendant les essais.

Contrôle visuel sur 1440, 820, 390 et 360 pixels avec six cours de démonstration, plusieurs matières et des titres longs : aucun débordement de page, aucune erreur JavaScript, police Manrope chargée. La connexion a également été contrôlée sur ordinateur et mobile. Les jeux de démonstration sont isolés et ne sont pas déployés.

Le déploiement remplace uniquement les ressources publiques et leur documentation. Il ne redémarre pas le service et ne modifie pas les données privées.


## Organisation personnelle · version 4.0.0

35 tests automatisés passent. Les neuf nouveaux tests couvrent la semaine complète et les annulations, les listes de matériel selon les cours et les dates, la répartition exacte des révisions avant le contrôle et la conservation des séances faites, les chevauchements de cours et l’heure de Paris, l’absence de disponibilité affirmée avec une source périmée, le consentement réciproque et la révocation, la séparation des écritures entre comptes, l’activation explicite des alertes et l’absence de doublon après redémarrage ou erreur SMTP. Le sac du 1er septembre est accessible dès le 31 août sans ouvrir les vues d’emploi du temps à une année non récupérée. Les alertes incluent les cours à venir de l’année, y compris en juillet ; les déplacements de jour mentionnent les deux dates.

Les parcours navigateur scolaire, admin et organisation réussissent. Le nouveau parcours vérifie la navigation hebdomadaire, la persistance du sac, les objectifs et séances terminées, le thème conservé après rechargement et le mode système, une alerte de salle envoyée une fois par transport simulé, l’ouverture d’une invitation avant connexion et son acceptation explicite après connexion, les créneaux communs sans divulgation des cours et l’arrêt du partage. La suspension admin arrête aussi les alertes. Le manifeste et ses icônes sont servis ; le service worker n’a conservé aucune API ni calendrier et le rechargement hors connexion affiche une page publique sans nom d’utilisateur ni emploi du temps. Aucun mail réel envoyé.

Vérification visuelle sur 1440, 820, 390 et 360 pixels : aucun débordement de page, aucune erreur JavaScript ou CSP. Les captures utilisent des données fictives. L’installation effective sur un appareil reste une action de son utilisateur dans le navigateur.


## Contrôle après publication de la version 4

HTTPS confirme la version 4.0.0, l’année 2026–2027 et la disponibilité de l’expéditeur déjà configuré. Les trois comptes et les deux flux ICS existants ont été préservés ; les deux flux ont été lus sans session par un parseur iCalendar indépendant. Les nouvelles API semaine, sac, révisions et amis refusent les demandes sans connexion. Les ressources nouvelles servies correspondent aux fichiers vérifiés, y compris les icônes, le manifeste et le service worker. Le service systemd est actif sans redémarrage sur erreur.

Le contrôle navigateur de la page publique HTTPS sur téléphone confirme le choix du thème, un manifeste sans erreur, le service worker prêt et l’absence d’erreur JavaScript ou de débordement horizontal. Aucun message réel n’a été envoyé par les vérifications.

## Identité visuelle · version 4.1.0

Les 35 tests fonctionnels existants passent. Le parcours navigateur d’organisation vérifie à nouveau semaine, sac, révisions, préférences de notification, envoi SMTP simulé sans doublon, consentements et révocations entre amis, thèmes, manifeste et page hors connexion sans donnée privée.

Une revue sur données fictives couvre la connexion, l’accueil, la semaine, les abonnements ICS, les comptes et le journal d’activité, en clair et en sombre. Les largeurs 360, 390, 820 et 1440 px ont été contrôlées pour les débordements ; aucun problème JavaScript ou CSP n’a été relevé. Le logo, le guide, le PDF de sept pages et le kit graphique sont accessibles sans connexion et ne contiennent aucune donnée de compte. Les liens de téléchargement répondent en HTTP 200. Les captures sont dans `test-results/brand-*.png` dans la copie de travail, sans donnée réelle.

Les modèles de brief, de confirmation d’adresse et d’alerte de changement utilisent la même enveloppe de marque, avec les données variables échappées. Les tests utilisent exclusivement des destinataires fictifs ; aucun mail réel n’est envoyé pour valider le design.

Le parcours navigateur scolaire existant passe également : personnalisation emoji/couleur, devoir manuel, rappels ICS, modification de salle, configuration SMTP simulée, confirmation d’adresse, aperçu et désabonnement. Aucun mail réel n’a été envoyé. Les modèles de mail ont été rendus pour inspection avec des données fictives.

Le logo des mails est intégré en pièce MIME inline CID plutôt que chargé depuis le portail. Un envoi vers le transport mémoire de Nodemailer confirme la présence du Content-ID et de la pièce PNG ; aucun réseau SMTP réel n’est utilisé.

Après déploiement, HTTPS confirme la version 4.1.0. Les onze ressources publiques contrôlées correspondent aux fichiers validés ; les trois comptes et les deux flux ICS existants sont préservés et les flux ont été relus par un parseur indépendant. L’expéditeur existant reste configuré. Un dernier parcours mobile sur le site public confirme logo, thème sombre, manifeste installable, service worker et accès à la charte, sans erreur JavaScript ni débordement horizontal.


## Inscriptions publiques et expérience quotidienne · version 4.2.0

Les 40 tests automatisés sont validés. Les cinq nouveaux cas couvrent la création sans invitation, l’impossibilité de s’attribuer des droits administrateur, l’isolation entre membres, la protection d’origine, les identifiants dupliqués, le champ piège, la limite de tentatives par IP, la fermeture/réouverture réservée à l’admin et la réservation concurrente des ouvertures ENT. Une fermeture persiste après redémarrage ; les invitations valides restent utilisables et les invitations consommées restent refusées. Les secrets de source, mots de passe et liens privés restent exclus des réponses destinées aux autres comptes.

Le parcours navigateur public crée un membre sans invitation, vérifie l’absence des commandes admin, ouvre la recherche ENT depuis les premiers pas, ajoute un travail personnel, se reconnecte et utilise les raccourcis d’organisation. Le parcours admin ferme puis rouvre les inscriptions ; un autre visiteur voit la fermeture, et le lien direct `#signup` fonctionne après réouverture. Des captures couvrent inscription, premiers pas, contrôle admin, mode sombre et formats mobile/ordinateur. Aucun mail réel ni compte réel n’est utilisé pour ces tests.

Une revue visuelle et fonctionnelle couvre également l’accueil avec des cours fictifs, les abonnements ICS, la semaine, les comptes et le journal, en clair et sombre. Aucun débordement horizontal aux largeurs vérifiées (360, 390, 820 et 1440 px), aucune erreur JavaScript ou CSP n’a été détecté. Les ressources de marque et les téléchargements existants restent accessibles.

Après mise en ligne, HTTPS confirme la version 4.2.0, les inscriptions ouvertes et la facturation désactivée. Les trois comptes et les deux flux ICS existants ont été préservés ; les deux flux ont été relus sans session avec un parseur indépendant. Les douze ressources publiques contrôlées correspondent aux fichiers validés. L’expéditeur existant reste configuré. La validation finale du formulaire public sur le site réel reste sans création de compte de test en production.


## Interface épurée · version 4.3.0

La revue visuelle couvre la connexion, l’accueil, la semaine, les abonnements ICS, les comptes et le journal, en clair et sombre, sur mobile et ordinateur. Les contrôles de largeur incluent 360, 390, 820 et 1440 px. Les SVG de la famille d’icônes sont valides et les ressources restent locales. Les couleurs de texte secondaire ont été ajustées pour renforcer leur contraste.

Les parcours navigateur scolaires et d’organisation passent avec les nouvelles icônes et le panneau de notifications : personnalisation des matières, devoirs manuels, rappels, modifications de salle, préférences de mail, confirmation, aperçu, désabonnement, sac, révisions et consentements entre amis. Tous les envois de test utilisent un transport fictif. Aucun mail réel n’est envoyé.

Les 40 tests automatisés passent. Le parcours public confirme le panneau modal, la conservation d’une adresse en cours de saisie lors d’une actualisation, la fermeture avec Échap et le retour du focus, la navigation des onglets par les flèches et Début/Fin, ainsi que l’absence d’animations actives lorsque le mouvement réduit est demandé. Les contrôles couvrent aussi l’inscription publique, la fermeture/réouverture par l’admin et les modes clair/sombre, sans création de compte réel ni envoi de mail réel.

Après mise en ligne, HTTPS confirme la version 4.3.0, les inscriptions ouvertes et la facturation désactivée. Les quatre comptes et les trois flux existants ont été préservés ; les trois flux ont été relus par un parseur iCalendar indépendant. Les quatorze ressources publiques contrôlées correspondent aux fichiers validés, y compris les icônes originales, la feuille commune et le script de mouvement. La vérification publique du formulaire reste sans création de compte de test en production.

## Chargements animés · version 4.4.0

Un nouveau parcours navigateur ralentit volontairement les réponses locales pour vérifier le chargement initial, les placeholders, la barre d’activité pendant une requête et les boutons occupés. Il valide leur retrait à la réponse, l’arrêt après erreur, la nouvelle tentative après échec de démarrage et la restauration des commandes. Le sac conserve son compteur accessible et son remplissage correspond au nombre d’objets cochés.

La galerie et ses quatre mouvements sont contrôlés sur ordinateur et mobile. En mouvement réduit, les indicateurs restent présents pendant l’attente et aucune animation ne demeure active. Les confirmations et erreurs restent lisibles ; les messages HTML potentiels sont affichés comme texte. Tous les comptes, cours et transports utilisés par ces tests sont fictifs ; aucun mail réel n’est envoyé.

Les 40 tests automatisés passent. Les trois parcours navigateur existants (scolarité, organisation et inscription publique) passent également : les nouvelles animations conservent les tâches, les préférences de mail, la confirmation des adresses, les consentements et l’accès administrateur. Le contrôle du mouvement réduit et du clavier reste valide. Les vérifications ne créent aucun compte de test en production.

Après déploiement, HTTPS confirme la version 4.4.0. Les quatre comptes et les trois flux ICS existants ont été préservés et les trois flux ont été relus par un parseur indépendant. Les quinze ressources contrôlées correspondent aux fichiers validés. Les inscriptions restent ouvertes, la facturation désactivée et l’expéditeur configuré. Le contrôle navigateur du site public couvre l’ouverture animée, l’aperçu mobile, le mouvement réduit et le manifeste installable, sans compte de test créé en production.

## Animation à chaque ouverture · version 4.4.1

Le symbole d’ouverture reste visible au moins 1,6 seconde, puis disparaît en fondu. La récupération du statut commence immédiatement en parallèle. Une réponse lente ne rajoute pas un second délai ; le changement d’onglet et le sondage de fond ne rejouent pas l’introduction. Les erreurs conservent leur bouton de nouvelle tentative et le mouvement réduit garde un symbole fixe.

La vérification syntaxique et le parcours navigateur des animations passent : ouverture, erreur et nouvelle tentative, placeholders, actions occupées, galerie mobile, progression du sac et mouvement réduit. Aucun mail réel n’est envoyé.

Après mise en ligne, la vérification HTTPS confirme la version 4.4.1 et les quinze ressources contrôlées. Les quatre comptes et les trois flux ICS valides sont préservés. Le contrôle navigateur public confirme la durée minimale avec une réponse immédiate, après rechargement et avec le mouvement réduit, ainsi que l’absence de second délai complet après une réponse lente. Le changement de mode de connexion ne rejoue pas l’introduction. Aucun compte de test n’a été créé en production et aucune erreur JavaScript n’a été relevée.

## Consultation ENT · version 4.5.0

Les 48 tests automatisés couvrent les nouveaux accès authentifiés, l’isolation des comptes/élèves, les périodes et dossiers autorisés, les notes à zéro, les moyennes de la source, les compétences, les détails des cours/devoirs/corrections, les actualités et l’historique d’absence. La liste des messages ne marque rien comme lu ; seule l’ouverture explicite d’un fil effectue la lecture côté ENT. Les contenus HTML et images de suivi sont retirés. Les tests contrôlent les références privées des documents, l’interdiction des URL arbitraires et redirections, le téléchargement borné, la conservation du cache après une panne et la sérialisation des accès au connecteur. Les données sensibles n’apparaissent pas dans le journal.

Le nouveau parcours navigateur valide les sept rubriques, le téléchargement d’un document, les appréciations, les corrections, les dossiers de vie scolaire et les fils de messagerie, sur ordinateur et mobile. Les onglets restent accessibles au clavier ; les modes sombre et mouvement réduit fonctionnent. Une actualisation du portail conserve la rubrique ouverte et la dernière consultation. La déconnexion retire les contenus ENT de l’interface.

Les trois parcours existants (scolarité et mails, organisation, inscription publique) passent aussi. Ils préservent les cours, devoirs, notifications et consentements, le sac, les révisions, les disponibilités partagées, les réglages de l’admin, le mode sombre, le clavier et la confidentialité hors connexion. Tous les nouveaux parcours utilisent des données fictives, sans envoi réel ni accès aux messages ou notes des utilisateurs en production. La disponibilité effective de chaque service reste conditionnée aux droits accordés par l’établissement. Les démarches et écritures restent dans l’ENT.

Après déploiement, HTTPS confirme la version 4.5.0. Les quatre comptes, les trois flux ICS valides, les inscriptions ouvertes et la configuration d’expédition sont préservés. Les dix-sept ressources publiques contrôlées correspondent aux fichiers validés. Le navigateur public charge le nouveau module sans erreur JavaScript, maintient l’animation d’ouverture, le mouvement réduit et la PWA, et confirme qu’une session est requise pour les rubriques ENT. Aucun compte de test n’est créé en production.

## Menus du lycée sur l’accueil · version 4.6.0

Les 56 tests automatisés passent. Les nouveaux tests couvrent les dates françaises, les changements de mois et d’année, les journées disposées en lignes ou en colonnes, les jours absents, les données ambiguës, les pieds de page, les PDF avec couche texte et les PDF scannés, la génération de l’extrait original, les caches, les pannes partielles et l’accès privé aux fichiers. La passerelle AURA réelle est autorisée uniquement pour un établissement AURA vérifié ; les autres domaines, protocoles, chemins et identifiants intégrés à l’URL sont refusés.

Le parcours navigateur du menu valide l’affichage sur l’accueil, la sélection du mardi sans conserver les plats du lundi, l’absence de menu le mercredi, l’accès au prochain jour publié, les liens privés vers le PDF et l’extrait, le dernier menu de la date conservé après panne, le mode sombre, le mouvement réduit et le retrait des menus à la déconnexion. Les captures sur ordinateur et mobile ont été contrôlées sans débordement horizontal.

Une vérification en lecture seule sur la vraie source du lycée des Horizons a trouvé l’article « Menus du 2 au 6 novembre 2026 » et son PDF de 245 638 octets. Le document est scanné : l’OCR a reconnu quatre journées. Le lundi contient cinq lignes de plats, distinctes des cinq lignes du mardi ; le mercredi reste absent et le prochain menu est celui du jeudi 5 novembre. L’extrait original et le document complet restent accessibles par une référence personnelle. Cette vérification n’a modifié aucun compte, mot de passe, jeton ou fichier d’état de production et n’a envoyé aucun mail.

Après mise en ligne, HTTPS confirme la version 4.6.0 et les dix-neuf ressources publiques contrôlées. Les quatre comptes, les trois flux ICS valides et la configuration d’expédition sont préservés ; le service fonctionne sans redémarrage inattendu. Le contrôle navigateur public charge le module du menu sans erreur, confirme la nécessité d’une session et conserve les animations, le mouvement réduit et la PWA. Aucun compte de test n’a été créé en production. Les quatre parcours navigateur existants (ENT, scolarité/mails, organisation et inscription) passent également.

## Organisation personnelle et rubriques ENT adaptées · version 4.7.0

Les 65 tests automatisés passent avec une exécution séquentielle adaptée aux ressources de la VM. Les nouveaux cas couvrent les priorités et estimations de la soirée, la répartition avant les échéances sans changer les dates de l’ENT, les rappels du prochain cours non annulé, l’isolation entre comptes et profils, les préférences et leur persistance, les écritures protégées par l’origine, le minuteur réel avec pause/reprise et la pause de cinq minutes, ainsi que l’absence de validation implicite d’un devoir. Le mode vacances n’active aucun consentement ; il suspend les briefs automatiques et prépare un seul récapitulatif de reprise à l’heure configurée, avec un transport fictif.

Le contrôle en lecture seule de la vraie connexion du lycée des Horizons confirme l’erreur explicite `NO_SCHOOLING_SOLUTION_CONFIGURED` pour notes, bulletins et absences. Ces rubriques sont désactivées pour ce profil ; l’historique d’absence n’est pas autorisé non plus. Messages, actualités, profil, cahier de textes, contenus de séances et détails des devoirs restent disponibles. Cette vérification n’a affiché aucun contenu privé, modifié aucun compte/jeton/fichier d’état de production ni envoyé de mail. Les droits sont propres à chaque connexion : les rubriques peuvent être revérifiées et réactivées si l’établissement les fournit ultérieurement. Une indisponibilité temporaire conserve l’état précédent.

Les six parcours navigateur passent : organisation personnelle, consultation ENT, menu PDF, scolarité et notifications, organisation existante, inscription publique. Le nouveau parcours vérifie les durées modifiables, la restauration du minuteur après rechargement, la pause et la pause de cinq minutes, les rappels du prochain cours, l’échappement des notes, la persistance des blocs masqués et ordonnés, leur accès par les raccourcis, la répartition des travaux, les vacances sans nouvel abonnement mail, le filtrage des rubriques non fournies et leur conservation lors d’une panne temporaire. Les champs en cours d’édition ne sont pas remplacés par les actualisations en arrière-plan. Les vues sur ordinateur et mobile, le thème sombre, le mouvement réduit et la confidentialité à la déconnexion sont vérifiés. Aucun mail réel ni compte de test en production n’a été utilisé.

Après mise en ligne, HTTPS confirme la version 4.7.0 et les vingt et une ressources contrôlées. Les quatre comptes, les trois flux ICS valides, la configuration d’expédition, les inscriptions ouvertes et la facturation désactivée sont préservés. Le navigateur public charge les nouveaux modules sans erreur, vérifie les accès authentifiés et conserve l’ouverture animée, le mouvement réduit et la PWA. Le service fonctionne sans redémarrage inattendu. L’archive source a été actualisée sans données privées.


## Outils personnels, suivi des visites, assistance et Pronote · version 4.8.0

Les 83 tests automatisés passent séquentiellement, sans cas ignoré. Les nouveaux cas vérifient les curseurs de consultation signés et liés au compte/élève, les changements concurrents et horodatages identiques, les historiques tronqués, la recherche privée, les fiches espacées et leur double validation, le temps de concentration réellement effectué, les pauses et les passages de minuit à Paris, ainsi que les signalements chiffrés, leur isolement, leurs réponses et les compteurs de lecture. Les requêtes de recherche utilisent un corps POST pour ne pas placer les mots recherchés dans l’URL.

Le connecteur Pronote est vérifié contre les URL arbitraires et les autres hôtes, les écritures sans origine autorisée, les confirmations d’un autre compte et les changements d’élève. Les tests contrôlent le renouvellement du jeton sauvegardé immédiatement, l’accusé exigé avant la suite des lectures, la conservation des dernières données après une panne, le masquage des rubriques absentes et l’attribution de leur source. Les références de session changeantes ne déconnectent plus la même identité : les travaux et périodes gardent leurs identifiants personnels et les validations locales. Un véritable changement d’identité est refusé. Le périmètre des travaux inclut compte, élève, instance et année scolaire.

Les huit parcours navigateur passent : organisation existante, organisation personnelle, nouveaux outils/Pronote/assistance, menu, inscriptions publiques, consultation ENT, scolarité et mails, animations. Le nouveau parcours décode une image QR synthétique avec le décodeur local, exige la confirmation du même élève avant le croisement, réactive les notes et bulletins fournis par Pronote et teste la recherche, le rattrapage, les fiches, le bilan, le bouton Tout voir et le suivi administrateur. Il vérifie les brouillons, les vues ordinateur et mobile (390 px), les thèmes sombres y compris les rubriques Pronote, le mouvement réduit et l’effacement à la déconnexion. Les requêtes et boîtes d’envoi de test utilisent uniquement des comptes temporaires et des transports fictifs ; aucun mail réel n’a été envoyé.

Des lectures en ligne de l’instance publique de démonstration ont parcouru toute l’année du 1er septembre 2026 au 31 août 2027 : huit périodes de notes, onze entrées d’assiduité, 118 devoirs et 1 143 cours, sans bulletin publié. Deux connexions séparées confirment que les références sources changent alors que le contenu reste identique ; les six travaux de la fenêtre comparée conservent leurs identifiants Passerelle. Ces contrôles utilisent la connexion publique de démonstration du SDK, sans enregistrement dans la production. Ils ne constituent pas une validation du QR mobile d’un compte réel ; chaque utilisateur doit connecter et confirmer son propre espace Élève.

Après mise en ligne, HTTPS confirme la version 4.8.0. Les 25 ressources publiques contrôlées correspondent aux fichiers déployés. Les quatre comptes, leurs rôles et identifiants, les trois clés de flux et les trois ICS relus avec un parseur indépendant sont préservés. L’expéditeur reste configuré, les inscriptions sont ouvertes et la facturation désactivée. Les nouvelles API privées refusent une consultation anonyme. Le service est actif, sans redémarrage inattendu ; le répertoire privé reste en mode 0700, les fichiers d’état et de clé en 0600.

Le contrôle navigateur HTTPS final charge les modules des nouveaux outils et le décodeur QR, conserve les modules précédents, vérifie l’absence de débordement sur mobile, les animations et le mouvement réduit, la validité de la PWA et l’absence d’erreur JavaScript. Aucun compte de test n’a été créé en production. L’archive source a été actualisée avec les instructions et dépendances du connecteur, sans données privées, dépendances installées ni captures de test.


## Administration et consoles communes · version 4.9.0

Les 102 tests automatisés passent séquentiellement, sans cas ignoré. Les 19 nouveaux cas de contrôle web/local couvrent les droits administrateur, l’origine des écritures, les prévisualisations sans effet avant approbation, leur liaison à la session, l’expiration, le mot de passe, la confirmation explicite, les changements concurrents, la protection du dernier administrateur et l’interdiction de se bloquer soi-même depuis le site. Ils vérifient la suspension/restauration sans perte de clés ni de consentements, les sessions révoquées après changement de rôle, la conservation de la session courante lorsqu’elle est demandée, les liens de réinitialisation chiffrés à usage unique, les liens remplacés ou expirés et l’absence de secrets dans l’audit et les exports.

La file est vérifiée avec des échecs partiels, une reprise des seuls éléments échoués, une opération ajoutée pendant une lecture en cours, l’annulation des comptes encore en attente et un redémarrage qui interrompt sans rejouer les opérations. Une panne ENT n’empêche pas de tenter Pronote ; une réussite d’une seule source est signalée comme partielle. Les tests valident également les pauses automatiques appliquées entre deux comptes, les échéances de maintenance, les notes internes chiffrées, les diagnostics et l’échappement des formules CSV.

Le terminal est exercé dans un vrai processus Node contre le socket Unix temporaire : permissions 0600, refus de remplacer un fichier ordinaire ou un socket en service, prévisualisation, confirmation, application, suivi et acteur local dans le journal commun. Les syntaxes de shell restent du texte et ne créent aucun fichier. Aucun port d’administration TCP n’est ajouté.

Le nouveau parcours navigateur valide le pilotage, Ctrl K, la prévisualisation d’une sélection groupée, la suspension et réactivation d’un compte et de son flux ICS, les notes et brouillons, l’échappement HTML, la réinitialisation complète suivie d’une reconnexion avec le nouveau mot de passe, le refus d’accès administrateur à un membre, les annonces publiques, la prise en charge des incidents et l’effacement à la déconnexion. Les vues ordinateur et mobile 390 px, le mode sombre et le mouvement réduit passent. Un débordement d’une étiquette accessible dans le tableau mobile a été corrigé en donnant son propre conteneur de positionnement à la zone défilante. Les boîtes d’envoi restent fictives : aucun mail réel n’a été envoyé.


Dix parcours navigateur ont été validés : le nouveau pilotage, l’administration existante des mails et journaux, l’organisation, l’organisation personnelle, Mes outils/Pronote/assistance, les menus, les inscriptions, Mon ENT, les devoirs/notifications et les animations. Ils utilisent uniquement des comptes temporaires et des transports fictifs. Aucun compte de test n’est créé en production.


Après déploiement, HTTPS confirme la version 4.9.0 et la correspondance exacte des 27 ressources publiques contrôlées. Les quatre comptes, leurs identifiants/rôles/mots de passe, les trois clés de flux et les trois ICS relus avec un parseur indépendant sont conservés. SMTP reste configuré, les inscriptions ouvertes et la facturation désactivée. Les nouvelles API d’administration refusent les visiteurs anonymes. Le service est actif, sans redémarrage inattendu ; le répertoire privé reste 0700 et le socket admin 0600. Le raccourci `/usr/local/bin/passerelle-admin`, mode 0755, est installé ; `status` et `doctor` réussissent contre le vrai service. Le diagnostic confirme les permissions, le journal, la présence d’un administrateur actif et le stockage disponible. Aucune commande de modification d’un compte réel, aucune invitation et aucune annonce de test n’a été appliquée en production.

Le navigateur HTTPS final charge le nouveau module administrateur et les modules existants sans erreur JavaScript, masque la console aux visiteurs et vérifie le mobile, le mouvement réduit, les animations et la PWA. Aucun compte de test n’a été créé en production. L’archive source inclut la documentation et les commandes, sans données privées, dépendances installées ni captures de test.


## Navigation et accueil simplifiés · version 4.10.0

Les 103 tests automatisés passent séquentiellement. Le nouveau cas valide la journée à la date de Paris autour du changement d’heure, l’ordre des cours, les annulations conservées, la séparation d’aujourd’hui et demain, l’isolation des comptes et l’absence de nouvelle lecture ENT ou d’envoi de mail pour construire cet aperçu.

Le nouveau parcours navigateur valide les quatre destinations permanentes, l’absence des listes et formulaires répétés sur l’accueil, la sélection Aujourd’hui/Demain, les cours annulés, l’agenda sans barre d’outils secondaires, les devoirs et leur validation persistante, les outils repliés à la demande, les réglages centralisés, les options ICS, les notifications, les brouillons et l’aide. Le premier démarrage est vérifié avant et après connexion ENT : un seul bouton utile, sans blocs de journée ou de priorités vides ; Afficher mes cours prépare le flux et active les actualisations. Les membres n’accèdent pas à l’administration et celle-ci reste accessible depuis Plus sur mobile. Ordinateur, téléphone 390 px, thème sombre, mouvement réduit et effacement à la déconnexion sont contrôlés avec des comptes temporaires.

Les anciens parcours ont été adaptés pour suivre les boutons visibles de la nouvelle navigation. Les anciens onglets remplacés ne sont pas simulés : les outils s’ouvrent par Plus, les réglages par leur page dédiée et l’accessibilité clavier est vérifiée sur les quatre destinations. La reconnexion d’un même compte revient sur l’accueil et les filtres de devoirs sont remis à zéro à la déconnexion. Les options de menu ouvertes restent ouvertes pendant un changement de date ; une date choisie sans menu conserve les commandes pour revenir à aujourd’hui.


Les onze parcours navigateur passent avec la nouvelle navigation : accueil simplifié et premier démarrage, pilotage administrateur, inscriptions, administration des mails et journaux, scolarité ENT, menus PDF, devoirs/matières/notifications, organisation et partages, organisation personnelle, outils/Pronote/assistance, animations. Les contrôles utilisent uniquement des comptes temporaires et des transports fictifs. Une course entre l’actualisation du journal et l’application d’un nouveau filtre a été corrigée : la dernière demande est traitée et une réponse ancienne ne remplace pas les nouveaux filtres. Les choix de thème sont exercés depuis les réglages visibles ; la cloche de notifications reste disponible dans l’en-tête sur ordinateur et téléphone.


Après mise en ligne, HTTPS confirme la version 4.10.0 et les 28 ressources publiques contrôlées, dont la feuille de style de simplification. Les quatre comptes, leurs rôles et mots de passe, les trois clés de flux et les trois ICS relus par un parseur indépendant sont conservés. Les inscriptions restent ouvertes, SMTP configuré et la facturation désactivée. Le service est actif sans redémarrage inattendu. Le diagnostic local vérifie les permissions, l’administrateur actif, le stockage et l’intégrité du journal. La console et les outils d’administration restent protégés ; aucun compte ou contenu de test n’a été créé en production.

Le navigateur HTTPS final charge les modules et la nouvelle feuille de style sans erreur, vérifie l’affichage mobile, l’absence de console administrateur anonyme, le mouvement réduit, les animations et la PWA. Le code source et sa documentation sont archivés sans données privées, dépendances installées ni captures de test.


## Préparation et notifications · version 4.11.0

Les nouveaux essais serveur couvrent le contexte de l’accueil selon l’heure de Paris et les annulations, la validation des abonnements et des clés, le stockage chiffré, le consentement par catégorie, la liaison à la session, les heures calmes, le regroupement sans doublon, le brief unique, les vacances, les reprises et la suppression des autorisations expirées. Les API sont protégées par authentification, contrôle d’origine et contrôle du compte actif. Les essais documents couvrent les copies chiffrées privées, les profils, les quotas, l’altération d’un fichier, les liens ENT expirés, la lecture de photos sans création automatique et la concurrence limitée.

Le nouveau parcours notifications utilise Chromium complet avec sa permission native et son véritable service worker. Le transport réseau push est simulé, puis un événement push est injecté par le protocole navigateur : l’affichage natif est observé. Le parcours vérifie aussi l’autorisation sur geste explicite, les préférences, les heures calmes, la conservation d’un brouillon invalide, le retrait à la déconnexion, les indications iPhone, le mobile et le mouvement réduit. Aucun abonnement de téléphone réel n’est activé par les essais ; la réception réelle dépendra de l’autorisation de son propriétaire.

Le parcours documents utilise une image imprimée synthétique et le véritable processus OCR isolé de la VM. Il valide le texte reconnu, sa correction avant ajout, la conservation du brouillon, la note depuis un cours, un fichier personnel, une copie ENT, le chiffrement sur disque, l’isolation entre comptes, l’accès après expiration de référence, la suppression, le thème sombre et le téléphone. Les captures contiennent uniquement des données fictives. Aucun mail ni aucune notification externe n’est envoyé.

Les 120 tests serveur existants et ajoutés, ainsi que les deux nouveaux tests de sécurité du service worker, passent. Les onze parcours navigateur précédents passent après adaptation au sélecteur Application/Par mail ; les parcours supplémentaires notifications et documents sont également validés. Les deux dépendances directes ajoutées sont verrouillées (web-push 3.6.7, image-size 2.0.4) ; les versions existantes restent inchangées et l’audit de production ne signale aucune vulnérabilité. Les unités du processus OCR passent systemd-analyze verify.

Le contrôle HTTPS après déploiement confirme la version 4.11.0 et la correspondance des 32 ressources publiques vérifiées. Les quatre comptes, leurs mots de passe et rôles, la clé de stockage et les trois liens ICS ont été préservés ; les trois flux sont relus sans cookie par le parseur iCalendar indépendant. La configuration SMTP reste identique, les inscriptions sont ouvertes et la facturation reste désactivée. Les API push, photo et favoris refusent les accès anonymes ; deux envois anonymes de 256 Ko atteignent le contrôle d’authentification, ce qui vérifie la nouvelle limite nginx sans lire une photo ni conserver un document de production.

Le service principal reste actif, sans redémarrage automatique. Les cinq contrôles du diagnostic administrateur passent. Le processus OCR répond sur son socket 0600, ses fichiers installés correspondent aux sources et le répertoire de favoris est privé (0700). La paire VAPID a été initialisée chiffrée ; aucun appareil réel n’est abonné. Les trois fournisseurs push ont répondu à des requêtes HTTPS sans abonnement ni message. L’incident ENT de devoirs déjà connu reste indépendant de cette mise à jour. Aucun compte de test n’a été créé en production.


Le parcours public du site déployé confirme le chargement des modules push et favoris, le manifeste PWA, le formulaire d’inscription, la confidentialité de la console admin, l’affichage mobile, les animations et le mouvement réduit, sans erreur JavaScript ni création de compte réel. L’archive source a été renouvelée sans stockage privé ni dépendances installées.


## Icône iPhone · version 4.11.1

Le signalement d’une lettre P sur iPhone a été comparé aux fichiers réels : les anciennes icônes renvoyaient déjà un PNG valide en HTTPS, mais l’icône de l’application n’était pas présente à `/agenda/apple-touch-icon.png`. Le diagnostic d’un raccourci conservé par iOS reste une hypothèse, sans observation du téléphone. La correction fournit cette adresse distincte, déclare explicitement 180 × 180 et image/png, fixe le nom court Apple, et sert des adresses absolues propres au portail pour les métadonnées d’installation. Les URLs sont construites depuis la configuration et non depuis Host. Le manifeste garde son identité, son démarrage et sa portée ; ses deux icônes utilisent des URLs simples. Le logo existant est réutilisé sans modification graphique. L’export du kit entretient aussi l’alias Apple.

Le parcours ciblé vérifie sans cookie : le téléchargement PNG, la correspondance exacte au logo existant, le décodage 180 × 180 et l’opacité complète, le manifeste et ses deux images, les adresses canoniques malgré un Host différent, les deux accès accueil/index.html, la redirection du sous-chemin, les instructions d’installation et le rendu mobile sans erreur JavaScript. Le navigateur est Chromium avec une présentation iPhone, et non un iPhone physique ; la sélection et le cache de l’icône sur l’écran d’accueil ne sont donc pas observables dans cet essai.

Les 17 tests ciblés de stockage, calendrier privé, authentification, inscriptions et vue du jour passent. La vérification en HTTPS confirme la version 4.11.1, le lien Apple absolu et le PNG exact, ainsi que le manifeste, les images et la vue mobile sans erreur JavaScript. Les quatre comptes, les trois liens ICS, les mots de passe, rôles, clés de stockage et de notifications, les appareils push et le SMTP ont été préservés. Les trois flux sont relus par un parseur iCalendar indépendant. Le diagnostic administrateur passe et les API privées restent protégées. Les inscriptions restent ouvertes et la facturation désactivée. L’archive source a été renouvelée sans données privées. La vérification finale du logo dans l’aperçu d’ajout et sur l’écran d’accueil nécessite le téléphone de l’utilisateur.


## Icône iPhone intégrée · version 4.11.2

La capture reçue depuis Safari directement confirme que la correction 4.11.1 n’a pas suffi : le panneau natif affiche encore le monogramme P. Le logo PNG était déjà valide et accessible. La cause exacte du refus dans le chargeur natif n’a donc pas été établie et le cache du raccourci ne constitue pas une explication confirmée.

La nouvelle déclaration Apple contient directement les octets PNG du logo existant. Le navigateur n’a pas à faire une autre requête pour obtenir l’image. Le test décode cette image avec les requêtes HTTP d’icônes bloquées, vérifie 180 × 180, l’opacité et la correspondance au fichier source. Les images publiques avaient aussi reçu no-store de la règle globale ; seules cinq images fixes d’icône bénéficient maintenant d’un cache public d’un jour, de CORP cross-origin et de CORS anonyme. Les pages et données privées restent en no-store. Une copie de document privée est ajoutée dans une fixture isolée pour vérifier que son contenu garde no-store, CORP same-origin et aucun CORS public.

Les 17 tests ciblés de stockage, calendrier, authentification, inscriptions et vue du jour passent. Les parcours Chromium et WebKit passent, y compris le décodage du logo intégré avec les requêtes PNG bloquées. Le parcours WebKit vérifie aussi les en-têtes du document privé authentifié. Le test HTTP local a mis en évidence une remontée forcée en HTTPS par WebKit : la directive upgrade-insecure-requests est désormais réservée à la configuration HTTPS, où elle demeure activée. Les deux tests supplémentaires d’en-têtes passent : les cinq PNG publics sont conservables, les pages et contenus privés restent sans cache et sans CORS public, et la directive HTTPS demeure active en production. La vérification du site déployé avec WebKit passe également en HTTPS, sans erreur JavaScript. Les quatre comptes, les trois liens ICS, les mots de passe, rôles, SMTP, clé de stockage, paire VAPID et appareils push ont été préservés ; les flux privés sont relus par un parseur indépendant. Le service est actif sans redémarrage automatique ; le diagnostic et le processus OCR répondent correctement. La feuille native d’ajout iPhone n’est pas disponible dans Playwright : sa validation finale dépend d’un nouvel essai sur le téléphone.

Références techniques : [monogramme de repli et priorité des icônes, WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [chargeur d’icônes WebKit](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/loader/icon/IconLoader.cpp). Ces sources décrivent le mécanisme général ; elles ne confirment pas la cause propre au téléphone signalé.


**Retour sur le téléphone après déploiement 4.11.2 :** l’utilisateur confirme « Le logo apparaît » dans l’aperçu natif Sur l’écran d’accueil de Safari ouvert directement, après ouverture du lien de vérification. Cela valide le point qui échouait en 4.11.1. Le fait d’appuyer ensuite sur Ajouter et l’icône installée ne sont pas observés à distance. L’amélioration combine une image intégrée et des en-têtes d’icônes corrigés ; la cause initiale exacte ne peut pas être attribuée avec certitude à une seule de ces deux modifications.


## Prise en main accompagnée · 4.12.0

Les 131 tests serveur passent séquentiellement. Les sept nouveaux cas couvrent la projection publique bornée sans écriture pour les anciens comptes, l’initialisation après inscription publique et invitation, l’authentification, l’origine, les corps invalides et les champs injectés, la limitation des requêtes, l’isolation entre comptes, la reprise sur deux sessions et après redémarrage, le retour arrière, les mises en pause et la fin explicite. Aucune préférence ENT, mail ou push n’est modifiée par la progression.

Le nouveau parcours Chromium passe de la véritable inscription au guide terminé, avec des comptes temporaires et des transports simulés. Il vérifie le clavier et le focus de bienvenue, Plus tard et Échap, la reprise après rechargement, l’avancement des vraies semaines, le choix du jour, le vrai formulaire de devoir sans création implicite, le brouillon conservé par refresh(false), les notifications sans demande d’autorisation automatique, la relance volontaire, les comptes existants sans fenêtre automatique, l’ENT déjà connecté avec et sans flux, l’isolation et le nettoyage à la déconnexion. Les largeurs 320/390 px, l’ordinateur, le sombre et le mouvement réduit sont couverts.

La revue a corrigé les contrôles de guide restés désactivés, la conservation du focus et du bandeau de reprise pendant les actualisations, la navigation vers une semaine déjà chargée et le positionnement du panneau sous la barre supérieure. Les notifications et l’installation restent facultatives. Aucun mail ou abonnement push réel n’a été déclenché.

Le parcours WebKit complet a été exploré avec HTTP et HTTPS locaux, avec et sans interception réseau, et avec le service worker neutralisé dans la fixture. Plusieurs passages ont exercé l’inscription, la mise en pause, la reprise, les jours, les semaines et le formulaire réel ; des rechargements locaux ont aussi annulé la navigation ou laissé le navigateur de test sur l’ouverture, et WebKit a émis des avertissements de feuilles de style pendant l’automatisation. Ce parcours intégral n’est donc pas compté parmi les parcours validés et ne constitue pas une vérification sur iPhone physique. La politique CSP de production n’a pas été affaiblie.

Les régressions navigateur d’inscription publique et de navigation simplifiée passent : inscription et connexion, ajout manuel, séparation de l’administration, préférences, brouillons mail, mode sombre et clavier. Le contrôle WebKit des icônes d’installation passe aussi. Le parcours guidé intégral validé reste Chromium ; le parcours WebKit exploratoire est distingué ci-dessus.

Le contrôle HTTPS après déploiement confirme la version 4.12.0, les cinq ressources modifiées, le refus401 de l’API de progression sans session et la conservation de l’icône Apple intégrée. Les trois agendas privés se relisent sans cookie avec un parseur iCalendar indépendant. Les identités de comptes, mots de passe, clés de flux, paramètres SMTP, clés et appareils push et clé de stockage sont inchangés. Le service reste actif sans redémarrage automatique, le diagnostic administrateur passe et le processus OCR est sain. Les inscriptions restent ouvertes, la facturation désactivée et le film public accessible. Aucun compte de test n’a été créé en production.


## Événements du lycée à confirmer · 4.13.0

Le parcours relie l’activation volontaire des sources aux réponses ENT synthétiques, à l’extraction locale bornée, à une proposition privée, à la confirmation, à l’agenda de la semaine et au même abonnement ICS. L’ouverture complète d’un message est explicite. Les boîtes personnelles, les pièces jointes et les images restent hors de ce périmètre.

Les 159 tests Node passent séquentiellement (environ 116 s). Ils incluent huit tests de dates françaises, d’ambiguïtés, d’année de publication, de bornage et de conversion Paris (heures DST inexistantes ou doubles refusées), dix-sept scénarios serveur de propositions et trois nouvelles régressions push/worker. Les scénarios couvrent les sources désactivées par défaut, les origines et sessions, les données JSON invalides, les révisions périmées ou absentes, la séparation des comptes et élèves, la préservation du non-lu, la lecture explicite, la confirmation des dates modifiées, les journées entières à fin exclusive, les retraits annulés, la conservation des événements acceptés parmi de nombreuses propositions, le redémarrage, les erreurs et services non fournis, les fins de pagination, les modifications concurrentes et le retrait du consentement. Le calendrier est relu avec un parseur iCalendar indépendant.

Le parcours Chromium synthétique valide les choix des sources, trois propositions, la lecture explicite sans scripts ni images distantes, l’absence de durée inventée, le brouillon et le focus conservés pendant une actualisation et une relecture de la source, la confirmation vers la semaine et le flux, le retrait, l’ignorance persistée, la catégorie de notification décochée et le rejet d’une réponse tardive après déconnexion. Captures inspectées à 320 et 390 px et sur bureau 1440 px, avec thème sombre, clavier et mouvement réduit. Aucune requête externe, permission de notification ou envoi réel. Le passage final termine avec le résultat ok, le nettoyage complet et un code de sortie 0.

Les contrôles finaux ciblés passent également : 25 tests après les derniers ajustements du journal et du formulaire. Le contrôle de syntaxe complet passe. La collecte limite son temps et évite de rejoindre une synchronisation ENT déjà occupée. Le formulaire conserve sa révision pendant une relecture. Une journée entière confirmée est indiquée comme telle ; une réponse de source reçue après la fermeture du dialogue est ignorée. Le stockage privé reste sans migration automatique et les comptes existants ne sont pas inscrits aux nouvelles lectures ou notifications.


Le contrôle HTTPS après déploiement confirme la version 4.13.0, huit ressources identiques aux fichiers locaux, les API de propositions refusées sans session et sans cache, les inscriptions ouvertes et la facturation désactivée. Les trois liens ICS privés sont relus sans cookie avec un parseur indépendant. Les six comptes, identités, mots de passe, rôles, clés de flux, progression du guide, réglages SMTP, clés et appareils push et clé de stockage sont conservés. Le diagnostic administrateur et la santé OCR passent ; le service est actif avec zéro redémarrage automatique. L’icône Apple intégrée et le film public restent disponibles. Aucun compte de test n’a été créé en production et aucun abonnement aux nouvelles sources n’a été activé pour un utilisateur par ces contrôles.


## Mails personnels sélectionnés · 4.14.0

Le parcours ajoute des connexions Gmail et Outlook par utilisateur et des réglages OAuth administrateur, puis relie les messages autorisés aux propositions existantes, à leur confirmation, à l’agenda et au flux ICS. La lecture demande les scopes Gmail readonly et Microsoft Mail.Read/User.Read avec offline_access. Aucun compte externe, jeton réel ou boîte personnelle n’a été utilisé pour ces validations. Les fournisseurs ne sont pas configurés en production et restent désactivés ; la création des applications, leurs secrets et une validation réelle sont encore nécessaires.

Treize tests du service OAuth passent : accès et origine, administration et absence de secret dans les réponses, permissions, PKCE et état à usage unique liés à la session, expirations, absence de refresh token, annulation et reconnexion, conservation d’identité, rotation de jetons sérialisée, rejet d’un ancien renouvellement après un nouveau grant, filtres d’expéditeurs et dates, suppression de HTML/traceurs, limites des messages, conservation du non-lu, déconnexion et pauses. Huit tests d’intégration passent : les trois consentements, Gmail et Outlook vers propositions puis ICS, source privée, déconnexion avec événements confirmés conservés, choix modifiés pendant une lecture, identité remplacée en cours et compatibilité des anciens réglages. Les 33 tests ciblés OAuth/événements/worker passent également après intégration. Le contrôle de syntaxe passe.

Le proxy Nginx existant garde access_log off pour /agenda/ ; les journaux applicatifs enregistrent les chemins des routes et des événements génériques, sans query OAuth ni contenu des messages. Le callback redirige vers un fragment de statut fixe et porte no-referrer. Les réponses privées et paramètres sont sans cache. Les règles CSP existantes et les données privées hors de ce changement sont conservées.


La suite complète passe : **180 tests Node**, zéro échec, environ 144 s, puis contrôle de syntaxe complet. Le parcours Chromium personnel se termine avec code 0 et nettoyage complet : configuration administrateur, secret chiffré et jamais prérempli, authentification simulée via le vrai callback local, consommation du fragment de retour, expéditeurs et source choisis explicitement, lecture de la source, ajout à la semaine et au flux, déconnexion après modification des paramètres, conservation des rendez-vous déjà confirmés, brouillons et focus préservés et réponse tardive rejetée après déconnexion. Les captures ont été inspectées en 320, 390 et 1440 px, avec sombre et mouvement réduit. Aucun trafic navigateur externe, permission de notification ou envoi réel. Une régression du retour par fragment lorsque la session venait de changer a été corrigée : le statut attend désormais le profil serveur confirmé avant d’ouvrir l’écran des mails.

Le parcours Chromium ENT existant passe aussi sans modification fonctionnelle : actualités et extraits, source explicite, brouillon, agenda hebdomadaire, flux ICS, journées entières, retrait annulé, notification facultative et déconnexion. Code de sortie 0 et nettoyage terminé ; aucune requête externe.


Après déploiement, le contrôle HTTPS confirme la version 4.14.0, les nouvelles ressources identiques aux fichiers locaux, les endpoints personnels et administrateur refusés sans session, l’icône Apple intégrée, le film public, les inscriptions ouvertes et la facturation désactivée. Les trois abonnements privés se relisent sans cookie avec un parseur indépendant. Les identités des sept comptes présents au déploiement, leurs mots de passe, rôles, liens de flux, progression du guide, réglages SMTP, clés et appareils push et clé de stockage sont conservés. Le diagnostic administrateur, le processus OCR et le service passent ; zéro redémarrage automatique. Aucun compte de test n’a été créé en production. Aucune application OAuth n’est configurée et aucune boîte personnelle n’a été reliée : les validations de connexion Google/Microsoft réelles restent à effectuer après configuration par le propriétaire.

## Connexions personnelles · 4.15.0

La suite Node complète passe : **234 tests, zéro échec**. Elle couvre les fonctions existantes ainsi que les clés d’accès, les imports et abonnements ICS privés, les récurrences et changements d’heure, les créneaux de révision privés, les trajets, les documents liés, les sélecteurs OAuth simulés et les partages avec validation explicite. L’analyse npm ne signale aucune vulnérabilité dans les 169 paquets audités.

Les vrais parcours Chromium réalisés avec des comptes et données temporaires vérifient les trajets (durées et horaires renseignés, annulations de cours, agenda périmé), l’import privé ICS (conflits, journées transparentes, révisions à heures précises), le partage PDF vers un devoir, la copie chiffrée, les liens Drive/OneDrive, la bibliothèque et les notes de matière. Un partage reçu sans session survit à l’écran de connexion et demande encore confirmation. Les formulaires et leur focus sont conservés lors de l’actualisation en arrière-plan. Les parcours couvrent 320, 390 et 1440 pixels selon le module, le thème sombre et la préférence de mouvement réduit, sans débordement ni erreur JavaScript. Aucun appel cloud ou message réel n’a été envoyé par les tests. Les fichiers aux noms accentués sont vérifiés avec un vrai envoi HTTP multipart.

Le test WebAuthn utilise une vraie cérémonie cryptographique avec un authentificateur CTAP2 virtuel Chromium : clé résidente avec vérification utilisateur, enregistrement protégé par le mot de passe, stockage chiffré, connexion, mauvaise signature et rejeu refusés, révocation et connexion par mot de passe conservées. Le test n’est pas une validation matérielle de Face ID/Touch ID sur un appareil Apple.

Les limites restent explicites : aucune application OAuth publique n’est provisionnée par ce travail, les sélecteurs ne sont donc pas présentés comme connectés sans configuration ; les liens et copies de documents fonctionnent séparément. Les trajets sont personnels et utilisables avec des durées/horaires renseignés pour tous les comptes, mais les départs en direct exigent une vraie source publique du réseau. Le partage natif dépend du navigateur ; sur iPhone, le guide explique la création du raccourci, qui n’est pas installé automatiquement. L’import ICS est borné à 1 Mo, une analyse à la fois et 96 Mo de tas avec un délai de dix secondes ; ce délai permet le démarrage du worker sur la petite VM sans rejeter un fichier valide sous charge. Les rendez-vous personnels restent hors des ICS scolaires et des disponibilités partagées avec les amis.

Après déploiement, le contrôle HTTPS confirme la version 4.15.0, les dix-sept ressources publiques vérifiées par empreinte, le manifeste de partage, le refus des nouvelles API sans session, l’icône Apple intégrée et le film public. Les trois abonnements ICS privés existants se relisent avec un parseur indépendant. Les identités, mots de passe et rôles des sept comptes, leurs clés de flux, leur guide de démarrage, les réglages SMTP, les clés et appareils push et la clé de stockage sont conservés. Le diagnostic administrateur et l’OCR passent, le service est actif sans redémarrage automatique. Aucun compte de test n’a été créé en production et aucune application OAuth n’y est configurée. Le code et les dépendances précédents sont sauvegardés séparément pour le retour arrière.

## Suppressions des événements abonnés · 4.15.1

Le flux ICS publie un instantané des événements actifs. Les cours annulés, devoirs terminés, tâches supprimées et rendez-vous retirés ne sont plus exportés avec `STATUS:CANCELLED`, qui les faisait apparaître barrés dans Apple Calendrier. Le marqueur `METHOD:PUBLISH` est retiré de cet instantané. Les traces internes sont conservées pour l’historique et les rétablissements ; les UID existants, les séquences et les dates de modification des événements inchangés restent stables. Une disparition de cours reste confirmée par deux lectures ENT complètes avant suppression ; une panne de source conserve le dernier agenda valide.

Une migration de format reconstruit les caches au démarrage, y compris les flux dont l’actualisation est en pause. Elle met à jour leurs ETag et dates de publication et ne recommence pas aux démarrages suivants. Les filtres par type et matière appliquent la même règle. Un abonnement par matière continue de renvoyer un calendrier vide valide quand son dernier élément disparaît, même après expiration de l’ancienne trace, afin que le lecteur puisse vider l’abonnement.

La suite complète passe : **238 tests, zéro échec**. Les cinq tests de publication passent également après l’ajout du dernier cas de matière vide : modification d’horaires, salle et titre sous un UID unique ; annulation explicite ; disparition après deux lectures ; rétablissement sous le même UID ; devoir/contrôle sur une journée terminé, supprimé, déplacé et rétabli ; filtres de flux ; mise à jour des ETag avec réponses 200 puis 304 ; migration HTTP d’un flux en pause ; conservation des traces, secrets et révisions ; migration idempotente. Les vérifications de syntaxe passent. Les essais utilisent des comptes temporaires et un parseur ICS indépendant, sans accès ENT ni envoi de message réel.

La simulation en mémoire sur les données existantes, sans écriture en production, retire 77 éléments annulés des trois caches et conserve exactement les 1 407 événements actifs et leurs UID. L’affichage après actualisation n’a pas été vérifié sur un iPhone physique ; le serveur ne peut ni imposer le délai de rafraîchissement d’Apple ni mettre à jour une copie importée une seule fois.

Contrôle après mise en ligne : version 4.15.1, trois flux complets et neuf variantes filtrées relus en HTTPS sans cookie. Les 77 éléments annulés ont disparu, les 1 407 événements actifs conservent exactement leurs UID, les ETag ont changé et les requêtes conditionnelles suivantes renvoient 304. L’icône Apple est conservée. Les sept comptes, leurs mots de passe et rôles, les trois secrets de flux, les réglages SMTP, les clés/appareils push, le guide de démarrage et la clé de stockage sont préservés. Le diagnostic administrateur, l’OCR et le service passent, sans redémarrage automatique. Aucun compte de test n’a été créé en production. L’abonnement du téléphone doit encore être rafraîchi par son application pour refléter la publication corrigée.


## Imports de documents de 30 Mo · 4.15.2

Les partages multipart, les imports directs et les copies chiffrées des favoris utilisent une limite commune de 30 Mio par fichier (affichée 30 Mo), avec 150 Mio de stockage par compte et vingt documents maximum. Les textes de l’interface et les contrôles client sont cohérents avec ces valeurs. Nginx autorise 32 Mio pour la seule application /agenda/ afin d’inclure l’enveloppe multipart ; la limite de Repère reste inchangée. Les limites distinctes OCR et import de calendriers sont conservées.

Les erreurs multipart ne fusionnent plus toutes les causes en une erreur 413 : fichier trop volumineux, plusieurs fichiers, champ fichier envoyé comme texte, texte trop long et formulaire malformé produisent des messages et codes spécifiques. Le journal conserve le code de rejet sans nom, contenu ou URL privée. L’import garde un seul fichier par partage. Un seul envoi public est traité à la fois, les brouillons restent limités à 60 Mio en mémoire, et le tampon du fichier n’est plus dupliqué lors de sa préparation.

Quinze tests ciblés de partage et favoris passent. Après vérification de la borne exacte, les neuf scénarios de partage passent de nouveau : un fichier multipart de 30 Mio est accepté, confirmé, chiffré et téléchargé avec une empreinte SHA-256 identique. L’import direct de 11 Mio passe aussi et les quotas annoncés sont vérifiés à 30/150 Mio. Les tests distinguent le refus avant allocation au-delà de la taille maximale, les fichiers multiples et le champ file envoyé en texte, y compris au-delà de la limite des champs texte. Les huit tests des documents liés passent, ainsi que les vérifications de syntaxe. Les essais utilisent uniquement des comptes et fichiers synthétiques temporaires, sans messages ni appels aux établissements.


Après mise en ligne : la version HTTPS 4.15.2 et les ressources publiques sont vérifiées ; un fichier synthétique de 13 Mio traverse Nginx et l’application et produit un brouillon temporaire valide, sans compte de test ni document enregistré en production. Un champ file envoyé en texte renvoie bien le code précis SHARE_FILE_FIELD. Les trois flux ICS restent accessibles sans événement annulé publié. Les sept comptes, les secrets de flux, les réglages SMTP, les clés et appareils push et la clé de stockage sont préservés. Le diagnostic et l’OCR passent ; le service est actif sans redémarrage automatique. La configuration Nginx est validée avant rechargement, avec 32m pour Passerelle et 26m conservés pour Repère. Le modèle de déploiement Nginx est mis à jour avec la même valeur.


## Envoi direct depuis Raccourcis · 4.15.3

Le même point d’entrée POST /share accepte désormais le corps brut « Fichier » de Raccourcis, avec Entrée du raccourci, sans dépendre de l’enveloppe multipart. Les photos et PDF reçoivent un nom adapté à leur signature ou à leur type ; un nom facultatif encodé reste borné et nettoyé. Les types JSON et URL-encodés sont refusés explicitement. Les autres API gardent leur parseur JSON et leur protection d’origine ; le partage multipart existant reste compatible. Les limites restent à un fichier de 30 Mio, un envoi public simultané et 60 Mio de brouillons pendant dix minutes.

Les cinq premiers nouveaux tests passent : photos JPEG, PDF et données binaires, noms Unicode, isolation compte/session/élève, confirmation explicite, idempotence, absence d’écriture implicite et aller-retour d’un fichier brut de exactement 30 Mio par les favoris chiffrés avec empreinte identique. Le vrai serveur est vérifié pour le refus JSON, le fichier sans Content-Type et l’accès authentifié obligatoire à la confirmation. Les quinze scénarios existants de partage et favoris passent également, ainsi que vingt-quatre tests de documents liés, inscription et fonctions centrales. Le contrôle syntaxique complet passe. Les essais utilisent des comptes et fichiers synthétiques temporaires, sans établissement ni message réel.

Le raccourci de l’utilisateur ne peut pas être modifié à distance : son corps doit encore être remplacé par Fichier et lié à Entrée du raccourci. Le fonctionnement sur un iPhone physique restera à confirmer après ce réglage.

Un sixième test confirme le rejet à 413 d’un fichier de 31 Mio transmis en morceaux sans Content-Length, puis d’un multipart tronqué avec le code SHARE_MULTIPART_INVALID. Un nouvel envoi direct valide reste possible immédiatement après ces erreurs. Au total, 45 tests ciblés distincts passent, sans échec.

Après déploiement : HTTPS confirme la version 4.15.3 et les ressources servies. Un fichier brut synthétique de 13 Mio traverse le proxy et produit son URL de brouillon ; un PDF multipart reste accepté, un formulaire tronqué donne les nouvelles instructions et un contenu JSON est refusé explicitement. Aucun compte de test ni document conservé n’est créé en production. Les sept comptes, trois flux, leurs 1 407 événements actifs, UID et ETag, les réglages SMTP, les clés/appareils push et la clé de stockage sont préservés. Le diagnostic administrateur et l’OCR passent ; le service reste actif avec zéro redémarrage automatique. La configuration Nginx et les dépendances sont inchangées.


## Le studio et les annonces majeures · 4.16.0

Une illustration originale a été créée avec image_gen, puis composée avec le logo existant et Manrope. La campagne fournit 24 PNG aux dimensions natives et 24 SVG éditables : cinq bannières (principale, LinkedIn, X, Facebook, YouTube avec zone centrale), avatar, quatre publications, carrousel cinq pages, trois stories et six couvertures à la une. La galerie, les légendes, les textes alternatifs et le guide sont publics. Les dimensions PNG et le XML des sources sont vérifiés. Les archives sociale, icônes et créative sont relues sans erreur et n’incluent aucun contenu de compte. Les exemples scolaires sont fictifs. Aucun contenu n’est publié sur un réseau social.

La famille Repères contient 56 icônes SVG originales, avec manifeste FR, sprite, galerie et générateur. Les 29 identifiants de l’interface précédente sont conservés dans le nouveau sprite. Le logo et les PNG d’installation restent inchangés. Les sources SVG sont XML valides et leur régénération déterministe a été vérifiée.

Le panneau de nouveautés monte depuis le bas, présente la bannière et trois points forts et reste accessible dans Plus → Nouveautés de Passerelle. Chaque annonce majeure possède son propre identifiant ; les correctifs mineurs ne réinitialisent pas la lecture. La fermeture explicite est enregistrée pour le compte, sans migration globale, ni mail ni push. Le guide, les autres dialogues et les champs de saisie ont priorité. Les changements de cours conservent une entrée distincte dans Plus.

Vingt tests Node ciblés passent, couvrant annonces, prise en main, inscriptions et publication ICS. Les trois nouveaux tests vérifient confidentialité, lecture sans écriture implicite, authentification et origine, paramètres stricts, isolation des comptes, idempotence et persistance après redémarrage complet. Le contrôle syntaxique complet et les sources des générateurs passent.

Le parcours Chromium des annonces passe avec de vrais appels au serveur temporaire : apparition unique, acquittement persistant, rechargement sans réapparition, réouverture volontaire, clavier/Échap et retour du focus, retrait à la déconnexion, comptes isolés, report pendant un autre dialogue ou une saisie, priorité à la bienvenue et au guide, apparition après pause ou fin. Les captures inspectées couvrent 320, 390 et 1440 px, clair, sombre et mouvement réduit, sans débordement ni erreur JavaScript/CSP. Un bouclage explicite de Tab empêche de sortir des commandes du panneau. Aucun appel externe, mail réel, permission de notification ou abonnement push n’est demandé. La bannière légère est chargée dans le panneau. Les essais restent distincts d’une validation sur iPhone physique.

Le parcours navigateur existant de prise en main passe aussi : inscription publique, accueil des nouveaux comptes, pause/reprise, exercices dans l’agenda et les devoirs, progression par compte, préservation des brouillons et déconnexion. Le parcours des icônes iPhone confirme les octets PNG d’origine, leur opacité, le manifeste et son identité, la déclaration Apple intégrée, le cache des seules icônes publiques et l’absence de cache des API/documents privés. Aucun iPhone physique n’a été utilisé pour ces contrôles.

Après déploiement, HTTPS confirme la version 4.16.0, treize ressources publiques principales identiques aux fichiers validés, les 48 exports PNG/SVG, les 56 SVG individuels et les trois archives téléchargées sans altération. L’acquittement anonyme est refusé. Les sept comptes, mots de passe, rôles et clés de flux, SMTP, clés/appareils push, progression du guide et clé de stockage sont préservés. Les trois flux conservent leurs 1 407 événements actifs, UID et ETag ; aucun événement annulé n’est republié. Le diagnostic, l’OCR et le service passent avec zéro redémarrage automatique. Aucun compte de test ni envoi réel n’a été effectué en production.

Le dernier parcours public HTTPS confirme les galeries Studio et Repères à 320 et 1440 px, les 24 visuels et 56 icônes, Manrope chargé, des glyphes SVG non vides, aucun débordement horizontal, aucune erreur de ressource/JavaScript et aucun appel tiers. Les contrôles restent anonymes, sans création de compte en production.


## Mon trajet et temps réservé · 4.17.0

Le nouveau parcours utilise l’adresse de l’établissement déjà présent dans la connexion ENT, un géocodage IGN/BAN avec vérification des correspondances et un départ choisi par GPS ou recherche. La géolocalisation est appelée une fois après clic, sans suivi continu ni sauvegarde implicite. La mémorisation et l’oubli sont explicites. Les liens Plans/Google Maps sont construits pour les points choisis et inversés au retour. Le connecteur Navitia demande une arrivée avant le premier cours ou un départ après le dernier ; il présente la fraîcheur réellement fournie, et non celle seulement demandée. Le calcul intégré reste désactivé en production sans jeton.

L’ajout d’un bloc de trajet est confirmé par un jeton temporaire lié au compte, à la session et au contexte scolaire. Le même jour et le même sens modifient un événement stable. La semaine privée et les créneaux de révision tiennent compte du trajet ; l’export ICS est volontaire, générique et sans adresse/GPS. Les positions ponctuelles et les adresses des extrémités ne sont pas conservées lors de la confirmation, même dans le détail chiffré. Les cours modifiés ou annulés mettent les trajets à revoir et retirent leurs exports reconstruits. La reconnexion ENT reconstruit un flux conservé pour retirer les trajets de l’ancien contexte. Les disponibilités entre amis gardent leur périmètre scolaire.

Quarante-neuf tests Node ciblés distincts passent : onze du service/calcul et de ses API, sept nouveaux du calendrier de transport, quatorze de transport existant, cinq de publication ICS, neuf de planning et trois d’annonces majeures. Ils couvrent authentification, origine, profils, paramètres stricts, retours inversés, dates et changement d’heure, refus des propositions périmées, chiffrement, oubli, absence de coordonnées même après déchiffrement d’un trajet ponctuel, secrets admin masqués, changements de connexion, UID, reprises, retrait des exports et conservation des anciens comportements. Le contrôle syntaxique complet passe.

Le parcours Chromium réel du serveur temporaire passe : lycée depuis l’ENT, aucun appel GPS à l’ouverture, position au clic, refus et recherche d’adresse, brouillon conservé lors d’une actualisation, mémorisation/oubli, proposition manuelle, confirmation dans la semaine, option ICS décochée au départ, modification sans doublon, retrait, configuration administrateur avec clé chiffrée non réaffichée, test de couverture et trajet du fournisseur simulé. Les captures 320/390/1440 px couvrent clair, sombre et mouvement réduit sans débordement ni erreur JavaScript/CSP. Les données, comptes, positions et jetons sont fictifs ; aucun mail, abonnement push ou appel de transport réel n’est effectué par le navigateur.

Un appel indépendant avec le vrai code HTTP atteint le service IGN avec une adresse publique de l’IGN et retourne un point valide. Aucun compte existant ni position personnelle n’est utilisé. Aucun jeton Navitia, compte fournisseur, paiement ou couverture TCL/STAS réelle n’est provisionné ou validé par ces tests. La localisation native et l’ouverture effective de Plans sur iPhone physique restent à confirmer sur l’appareil de l’utilisateur.

La suite Node complète passe dans sa version finale : **270 tests, zéro échec**, environ 247 secondes. Elle inclut les anciennes fonctions, les parcours de stockage et publication, ainsi que les nouveaux trajets. Aucun fournisseur payant ni donnée personnelle de production n’est utilisé pour cette validation.

Un contrôle ciblé supplémentaire couvre le cas où l’ENT ne fournit qu’une ville ou où le géocodeur renvoie le centre d’une commune : ces réponses ne sont jamais présentées comme une localisation précise du lycée. Elles demandent un choix explicite. Le test de résolution d’établissement passe après cet ajout.

Contrôle final en production : HTTPS confirme 4.17.0 et les ressources publiques identiques aux fichiers validés. Les API de trajet et de connexion fournisseur sont refusées sans session et sans cache. Aucun réglage Navitia n’a été créé automatiquement ; le calcul intégré est toujours désactivé. Les huit comptes, les cinq liens d’agenda, leurs 2 809 événements actifs, UID et ETag, les réglages SMTP, les clés/appareils push, le guide de démarrage et la clé de stockage sont préservés. Le diagnostic administrateur, l’OCR et le service passent avec zéro redémarrage automatique. Le parcours public Chromium vérifie aussi le chargement sans erreur JavaScript, l’icône Apple intégrée d’origine et le manifeste inchangé. Aucun compte de test, position réelle ou appel de calcul de transport n’est créé en production. Les onze tests du nouveau service passent encore après le renforcement du cas des villes seules.
