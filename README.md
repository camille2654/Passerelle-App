## 4.26.4 — ouverture PRONOTE dans un nouvel onglet

L’interception accepte maintenant la première requête d’un nouvel onglet avant
la création de son cadre navigateur. Ce cas produisait à tort « Le portail ENT
ne répond pas ». Les essais Chromium couvrent aussi les ouvertures en nouvel
onglet, avec arrivée directe ou redirection CAS/SAML. Les échecs de capture
indiquent leur étape dans le journal, sans erreur brute ni secret.
La confirmation d’un import sur le compte réel reste nécessaire.

## 4.26.3 — redirections ENT vers PRONOTE

Le passage automatique de l’ENT à PRONOTE est désormais intercepté à chaque
redirection. La session est récupérée avant son utilisation par le navigateur,
y compris après un formulaire CAS/SAML. Les domaines restent contrôlés et les
boucles de connexion sont arrêtées. Le défaut et son correctif sont vérifiés
avec de vraies redirections HTTP dans Chromium, sur des serveurs locaux.
L’import sur un compte réel reste à confirmer. [Détails](docs/MULTI_ENT.md).

## 4.26.2 — reprise de connexion PRONOTE

La reprise SSO couvre désormais les POST et les arrivées à la racine de PRONOTE,
ainsi que les formats JSON et `onload` encodés. Le jeton et la session PRONOTE
restent chiffrés pour la reconnexion. Le dialogue affiche une vraie étape d’import,
récupère les captures interrompues et rend les échecs explicites au lieu de rester
en attente. [Parcours, confidentialité et limites](docs/MULTI_ENT.md).

## 4.26.1 — correction du bouton PRONOTE

Le formulaire PRONOTE ouvre maintenant la connexion ENT au lieu de naviguer vers
l’accueil. Il choisit l’ENT déjà connecté et accepte aussi un lien PRONOTE hébergé
comme point d’entrée SSO, lié à cet ENT. Les options facultatives sont repliées.
Les anciens paramètres de formulaire sont effacés de l’adresse sans être renvoyés.
Voir [le parcours et les limites](docs/MULTI_ENT.md).

## 4.26.0 — ENT de plusieurs régions et PRONOTE depuis l’ENT

La recherche d’établissement couvre les 19 configurations Skolengo du catalogue,
avec filtre et nom du réseau. Un parcours ENT → PRONOTE, en bêta, peut aussi servir
de source principale pour les cours, devoirs, notes et ICS des espaces Élève
hébergés sur index-education.net. La connexion QR est retirée ; les connexions
existantes restent utilisables. Les services absents (notamment mails/actualités
pour le parcours PRONOTE) sont masqués. La couverture reste dépendante du portail
et du SSO de l’établissement, et ne prétend pas couvrir tous les ENT.
Voir [les parcours, limites et sources](docs/MULTI_ENT.md).

# Passerelle · Skolengo → lien ICS privé

L’interface de Passerelle reprend des composants sobres inspirés de Lapsus tout en gardant son logo, Manrope et ses couleurs. Voir [la présentation de l’application](docs/APP_STYLE.md).
L’agenda possède une vue semaine avec grille horaire et une vue journée adaptée au téléphone. Voir [la présentation de l’agenda](docs/AGENDA.md).

Portail : https://repere.84.235.226.127.sslip.io/agenda/

## Travail, cours et documents · version 4.25.0

Les devoirs sont regroupés par échéance. Les photos et PDF privés se consultent dans Passerelle, avec zoom, pages et téléchargement. Les fiches permettent de passer au cours suivant en gardant les notes en cours de saisie ; les formulaires et états vides sont plus directs. Voir [le fonctionnement et les limites](docs/DAILY_TOOLS.md).

## Menu Plus et animations · version 4.24.0

Plus présente une recherche, quatre raccourcis et deux groupes : Pour travailler, Suivi et aide. La navigation, les cartes, les groupes et les fiches disposent d’animations natives qui respectent la réduction du mouvement. Voir [le fonctionnement et les limites](docs/MORE_MOTION.md).

## Parcours et présentation · version 4.23.0

Connexion en trois étapes, erreurs avec reprise, réglages regroupés et agenda plus sobre. Le retour à une rubrique conserve sa position ; le suivi des devoirs propose une annulation réelle. Voir [le fonctionnement et les limites](docs/EXPERIENCE.md).

## Recherche et fiches matières · version 4.22.0

La loupe de l’en-tête et Ctrl/⌘ K ouvrent la recherche. Des filtres regroupent les matières, cours, devoirs et contrôles, noms de documents, notes, fiches et actualités déjà reçues. **Plus → Mes matières** réunit le travail à préparer, les prochains cours, les notes et les documents associés. Les favoris peuvent être rattachés explicitement à une matière. Voir [le fonctionnement et les limites](docs/DISCOVERY.md).

## Connexion ENT directe pour Lapsus · version 4.19.0

Lapsus peut utiliser le connecteur ENT et des données REST sans imposer une inscription Passerelle. Les profils techniques sont isolés des comptes du portail ; la fonction Cloudflare de Lapsus vérifie son utilisateur Supabase avant chaque appel. Le connecteur est préparé avec un réglage administrateur et une clé serveur, désactivé par défaut tant que son propriétaire ne l’a pas configuré. Voir [le fonctionnement et l’activation](docs/MANAGED_ENT.md).

Les vérifications automatiques proches deviennent adaptatives : deux minutes pendant l’utilisation, cinq minutes en journée au repos, trente minutes la nuit. Le balayage annuel est quotidien et les données hors de la fenêtre proche sont conservées. Les tokens sont renouvelés près de leur expiration, dans le verrou de la source ; leur durée reste imposée par l’ENT.

## Connexion des agendas à Lapsus · version 4.18.0

Le service `https://mon-ent.pages.dev` peut demander à un utilisateur de partager ses cours, devoirs ou contrôles avec son accord. Passerelle propose une page de consentement, un échange OAuth avec PKCE S256 et des liens ICS dédiés, révocables depuis **Plus → Réglages → Mon compte → Applications connectées**. Les abonnements personnels restent indépendants. Les administrateurs peuvent désactiver Lapsus ou modifier sa callback dans le même écran.

**Le développeur de Lapsus doit ajouter son bouton, la page de retour et l’adaptateur de compte.** Le [guide](docs/LAPSUS_INTEGRATION.md) et le pack public `/agenda/integrations/lapsus/` fournissent les fichiers et le contrat. Aucun code ni déploiement de Lapsus n’est modifié par cette livraison. Il s’agit d’un partage d’agendas, pas d’un fournisseur OpenID Connect. La tâche transports reste en pause.

## Mon trajet, du lycée à l’agenda · version 4.17.0

L’adresse de l’établissement prépare la destination, avec une recherche IGN/BAN et une correction possible. L’utilisateur choisit sa position au clic ou une adresse de départ ; la mémorisation est explicite et chiffrée. Plans et Google Maps ouvrent le trajet, et une durée connue peut être confirmée pour réserver le temps de transport dans la semaine et, volontairement, l’abonnement ICS. Les modifications gardent un identifiant stable ; les cours modifiés mettent les anciens trajets à revoir.

Un connecteur Navitia et ses réglages administrateur sont prêts. **Aucun jeton fournisseur n’est configuré par cette livraison : le calcul intégré reste désactivé**, tandis que les liens et la réservation de temps restent utilisables. La couverture et le temps réel doivent être vérifiés avec le véritable accès du propriétaire. Aucun abonnement payant n’est souscrit. Voir [les usages, l’administration et les limites](docs/SMART_TRAVEL.md).

## Le studio et les nouveautés · version 4.16.0

Une bannière originale décline le passage vert et citron en papier découpé. Le studio public `/agenda/brand/campaign/` propose 24 visuels pour les réseaux sociaux en PNG, leurs SVG éditables, les légendes et les textes alternatifs. La famille Repères regroupe 56 icônes SVG, disponibles dans `/agenda/brand/icons-v2/preview.html` et intégrées dans les repères de l’application. Le logo et les icônes d’installation existants sont conservés.

Les mises à jour majeures disposent d’un panneau animé depuis le bas, avec bannière et points forts. Il s’affiche après connexion, laisse la priorité à la prise en main, aux dialogues et à la saisie, puis sa fermeture est retenue par compte sur tous les appareils. Il reste accessible dans **Plus → Nouveautés de Passerelle**. Les changements de l’agenda ont leur propre entrée. Les correctifs mineurs ne réinitialisent pas l’annonce. Voir [le guide de publication](docs/MAJOR_RELEASES.md).

## Partage iPhone par envoi direct · version 4.15.3

Pour envoyer une photo ou un PDF depuis Raccourcis, conserver la méthode **POST** vers `https://repere.84.235.226.127.sslip.io/agenda/share` et l’en-tête **Accept: application/json**. Remplacer le corps **Formulaire** par **Fichier**, puis choisir **Entrée du raccourci** comme fichier à transmettre. Récupérer ensuite la clé **openURL** de la réponse et ouvrir cette URL. Le fichier est envoyé directement, sans champ multipart à configurer. L’envoi reste limité à un fichier de 30 Mo ; son enregistrement demande toujours une confirmation dans Passerelle. Le partage multipart du site reste compatible.

## Suppressions dans les agendas abonnés · version 4.15.1

Le flux ICS représente les événements actifs : un cours annulé, un devoir terminé ou un élément supprimé n’est plus envoyé comme un événement barré. Les modifications conservent leur UID ; les traces d’annulation restent dans Passerelle pour l’historique et les rétablissements. Les calendriers déjà enregistrés sont reconstruits au démarrage, même si la synchronisation est en pause, sans changer leur lien ni les identifiants des événements actifs. Les agendas filtrés suivent la même règle. La disparition sur le téléphone nécessite le rafraîchissement de son abonnement ; une copie importée une seule fois ne reçoit pas ces mises à jour.

## Connexions personnelles · version 4.15.0

Partage de photos/PDF/textes avec aperçu à confirmer, documents liés aux devoirs, calendriers personnels en lecture seule, trajets réglés par chaque utilisateur et connexion par clé d’accès. Les parcours restent dans Plus, Réglages et les devoirs. Les liens Drive/OneDrive et les imports fonctionnent sans application OAuth ; les sélecteurs cloud demandent la configuration réelle du propriétaire. Le trajet manuel fonctionne pour chaque compte ; les départs en direct dépendent des sources du réseau configurées. Voir [les usages, limites et réglages](docs/CONNECTIVITY.md).

## Mails personnels sélectionnés · version 4.14.0

**État de livraison :** les connecteurs Gmail et Outlook sont implémentés et testés avec de faux fournisseurs. Les boutons de connexion restent indisponibles tant que le propriétaire n’a pas créé et renseigné ses applications OAuth. Aucun identifiant d’application n’est inventé, aucun compte Google/Microsoft n’est ouvert et aucune boîte existante n’est reliée automatiquement. L’expéditeur SMTP des briefs ne donne pas accès aux boîtes des utilisateurs.

Dans **Plus → Réglages → Mails personnels**, chaque utilisateur peut relier sa propre boîte. Après le retour Google/Microsoft, il choisit jusqu’à dix adresses d’expédition exactes et autorise leur lecture. Il active aussi **Les mails personnels sélectionnés** parmi les sources des événements repérés. La lecture se limite aux messages reçus de ces adresses dans la boîte de réception, sur les trente derniers jours : vingt identifiants au maximum et dix messages détaillés par fournisseur et par passage, avec un budget de temps. Les pièces jointes et images ne sont pas traitées. La détection s’effectue dans le contexte du profil scolaire actuellement connecté ; changer d’élève ou déconnecter l’ENT remet les propositions de cet agenda à zéro, comme les autres données de son calendrier.

Les propositions personnelles utilisent le même parcours de vérification que les actualités et messages ENT : source texte sur demande, correction des dates et heures, confirmation, puis agenda et abonnement ICS. Aucun événement n’est ajouté automatiquement. La catégorie de notifications existante peut signaler les nouvelles propositions et conserve un texte générique. Les anciens choix ENT et les onglets déjà ouverts restent compatibles ; la nouvelle source personnelle est désactivée au départ.

Les connexions utilisent OAuth avec code, PKCE et un état lié à la session, au fournisseur et aux réglages, à usage unique pendant dix minutes. Les jetons, les adresses et les expéditeurs sont chiffrés. Les renouvellements sont sérialisés ; une reconnexion à la même identité garde les références, tandis qu’un changement de boîte retire les propositions de l’ancienne. La lecture ne marque pas les messages lus et ne demande aucun droit d’envoi ou de modification. La pause administrateur des automatismes mail et la maintenance suspendent la collecte ; l’ouverture explicite d’une source reste possible.

**Déconnecter cette boîte** retire les jetons et les propositions non confirmées liées à la connexion. Les événements déjà confirmés restent dans l’agenda ; leur extrait et leur référence au mail sont effacés. L’utilisateur peut également retirer l’autorisation dans les réglages Google/Microsoft grâce aux liens proposés. Passerelle ne révoque pas toutes les sessions Microsoft ni les autres autorisations Google du projet.

L’administration des applications se trouve dans **Mails personnels → Configurer les connexions · Administration** : callbacks copiables, identifiant client, secret jamais réaffiché et activation indépendante de chaque fournisseur. Pour la création des applications, les limites du mode test et les exigences Google avant ouverture publique, suivre [le guide du propriétaire](docs/PERSONAL_MAIL_SETUP.md). La configuration initiale et une validation réelle auprès des fournisseurs restent nécessaires avant d’annoncer ces connexions comme opérationnelles pour le public.

## Événements repérés dans le lycée · version 4.13.0

Ouvrir **Plus → Mon lycée → Événements repérés**, puis choisir les actualités, les extraits de la messagerie ENT, ou les deux. Les sources sont désactivées au départ. Une vérification volontaire permet de commencer ; les comptes ayant activé une source sont ensuite vérifiés environ toutes les dix minutes, lorsque l’ENT est disponible. La pause ENT et la maintenance administrateur suspendent ces lectures. La fonction respecte le compte, l’élève et l’établissement sélectionnés.

Les propositions montrent le titre, la date, les heures effectivement repérées et un extrait. **Lire l’actualité / le message** ouvre la source sur demande. Le formulaire permet de vérifier et corriger titre, date, heures et lieu, ou de choisir explicitement une journée entière. Aucun rendez-vous n’est ajouté sans confirmation. Les rendez-vous confirmés apparaissent dans la semaine de l’agenda et dans le flux ICS existant ; leur retrait les enlève du flux ICS et conserve la trace interne avec le même identifiant. Cet ajout personnel ne vaut pas inscription auprès du lycée.

La détection des messages utilise uniquement les extraits déjà disponibles dans la boîte de réception, sans appel à la lecture des participations : les messages restent non lus. Une lecture complète peut les marquer lus, uniquement après le clic de l’utilisateur. Gmail et Outlook personnels, les pièces jointes PDF et les images ne sont pas analysés par cette fonction. Les dates implicites utilisent l’année de publication ; les dates relatives utilisent le jour de publication. Les associations incertaines et les horaires absents sont signalés ou laissés à compléter ; aucune durée n’est inventée. La lecture est limitée aux quarante dernières actualités et quarante derniers fils, avec six détails d’articles au maximum par passage. Certaines informations peuvent donc ne pas être repérées.

Si une source est modifiée après confirmation, l’agenda conserve la version validée et propose une vérification. Les propositions ignorées et les identifiants des occurrences survivent aux vérifications et aux redémarrages ; les événements acceptés restent accessibles pour pouvoir être retirés. Les extraits et les identifiants de source sont chiffrés dans le stockage. Les journaux ne conservent ni le contenu des messages ni celui des articles.

Dans **Notifications → Application**, la nouvelle catégorie **Les événements repérés dans les actualités et la messagerie ENT** est facultative et décochée au départ. Elle concerne les nouvelles propositions après activation, avec regroupement, heures calmes, reprises et séparation par appareil/session. La notification affiche un texte générique et ouvre les propositions après connexion ; elle n’ajoute aucun événement. L’autorisation du navigateur n’est jamais demandée automatiquement.

## Prise en main accompagnée · version 4.12.0

Après une inscription publique ou par invitation, une courte bienvenue propose une visite volontaire. Le guide accompagne l’utilisateur dans les vrais écrans : connexion du lycée, accueil et choix Aujourd’hui/Demain, agenda et semaines, devoirs et formulaire d’ajout, outils dans Plus, installation et préférences de notification. Les exercices ouvrent les commandes existantes ; aucun devoir fictif n’est enregistré et aucune autorisation de notification n’est demandée automatiquement. Les fonctions dépendent toujours des données publiées par l’établissement.

La visite propose une découverte sans connexion immédiate à l’ENT. Un ENT déjà connecté est reconnu : il suffit de récupérer les cours ou de continuer. La progression est enregistrée sur le compte et peut être mise en pause puis reprise, y compris après rechargement ou sur un autre appareil. Les comptes déjà créés ne reçoivent pas de nouvelle fenêtre automatique ; tous peuvent ouvrir **Plus → Guide de démarrage**. La visite reste disponible après sa fin.

Le guide utilise un panneau dans la page, laisse les commandes de l’application accessibles et conserve les brouillons pendant les actualisations. La bienvenue accepte le clavier et Échap ; le guide respecte les petits écrans, le thème sombre et le mouvement réduit. La déconnexion ferme le dialogue et retire les indications du compte précédent. L’API de progression est authentifiée, contrôlée par origine, limitée et propre à chaque compte.

## Icône iPhone intégrée · version 4.11.2

Le retour sur téléphone a confirmé que la version 4.11.1 affichait encore une lettre dans l’aperçu d’ajout depuis Safari. L’image 180 × 180 existante est maintenant intégrée directement dans la déclaration Apple du HTML, sous forme de données PNG. Son contenu est lu depuis le fichier de marque au démarrage : aucune image ni aucun logo divergent n’est généré. La déclaration ne demande donc aucun téléchargement d’icône supplémentaire. La politique de contenu autorise déjà les images data:.

Les cinq fichiers PNG publics d’icône disposent désormais d’un cache public d’un jour et peuvent être lus par les services d’icônes sans cookie. Les pages, API et contenus privés conservent no-store ; le fichier privé de favoris n’est pas concerné. Le fichier `/agenda/apple-touch-icon.png` et le manifeste restent disponibles en complément. L’identité du manifeste, les comptes et les abonnements ne changent pas. Le logo a été confirmé par l’utilisateur dans l’aperçu natif Sur l’écran d’accueil de Safari sur son iPhone après cette mise à jour.

## Icône iPhone · version 4.11.1

L’icône Apple reprend le logo Passerelle existant, dans un PNG opaque de 180 × 180 pixels, à l’adresse propre à l’application `/agenda/apple-touch-icon.png`. L’accueil sert des adresses absolues pour cette icône, le favicon et le manifeste, construites depuis l’URL configurée du portail, sans dépendre du domaine reçu dans un en-tête de requête. Le nom court Apple est Passerelle. Le manifeste garde le même identifiant, le même démarrage et la même portée ; les anciens fichiers restent disponibles.

Si une installation affiche encore une lettre P, ouvrir le portail dans Safari puis Partager → Sur l’écran d’accueil. Vérifier le logo dans l’aperçu avant de remplacer l’ancienne installation. L’icône d’une installation déjà présente peut rester conservée par iOS ; une mise à jour du site ne garantit pas sa réécriture sur le téléphone. Les données du compte et les liens ICS restent sur le serveur. Si la nouvelle installation redemande la connexion ou les notifications, les activer dans celle-ci.

## Préparer sa journée et notifications · version 4.11.0

Les quatre destinations **Accueil, Agenda, Devoirs, Plus** restent les repères principaux. Les ajouts se placent dans les écrans existants :

- **Accueil adaptatif** : le matin, la journée et le prochain cours ; après le dernier cours non annulé, les priorités pour demain passent en premier et le programme montre demain. Sans cours publié ce jour, la bascule se fait à 17 h, heure de Paris. Un choix manuel Aujourd’hui/Demain reste prioritaire jusqu’au lendemain. Les ordres de blocs personnalisés sont respectés.
- **Rappel depuis un cours** : ouvrir les trois points du cours dans l’accueil, puis Ajouter un rappel. L’éditeur de notes s’ouvre avec la matière préremplie ; l’utilisateur saisit et enregistre sa note, retrouvée au prochain cours de cette matière.
- **Devoir depuis une photo** : dans Devoirs → Ajouter un devoir ou un contrôle → Importer une photo. Le texte reconnu reste modifiable. Utiliser ce texte préremplit le formulaire ; vérifier la matière, la date et les consignes, puis Ajouter. Aucun devoir n’est créé automatiquement. La lecture fonctionne mieux sur du texte imprimé net ; l’écriture manuscrite et les photos floues peuvent être mal reconnues.
- **Documents favoris** : Plus → Documents favoris. Ajouter un fichier personnel ou toucher Garder sur une pièce jointe du lycée. Il s’agit d’une copie datée qui reste disponible lorsque le lien ENT expire, sans mise à jour automatique. Limites : 20 fichiers par compte, 30 Mo par fichier, 150 Mo au total. Les fichiers sont chiffrés et séparés par compte, élève et établissement ; un document se télécharge comme pièce jointe.
- **Notifications et heures calmes** : la cloche ou Plus → Réglages → Notifications ouvre les onglets Application et Par mail. L’onglet Application propose les changements importants de cours, les nouveautés des devoirs et un brief du soir. Chaque appareil demande une activation volontaire, et les deux dernières catégories sont décochées au départ. Les heures calmes sont activées par défaut de 22 h à 7 h, heure de Paris ; le brief doit être réglé en dehors de cette plage. Les changements encore utiles sont regroupés après cette plage. Les préférences mail existantes restent dans Par mail.

### Notifications PWA

L’accès HTTPS de la VM est prêt ; la paire VAPID est créée automatiquement une seule fois et chiffrée dans les réglages privés. Aucun service payant ni compte Apple développeur n’est nécessaire. Sur iPhone/iPad, utiliser une version compatible avec Web Push (iOS/iPadOS 16.4 ou ultérieur), ajouter Passerelle à l’écran d’accueil, ouvrir cette application, puis Activer sur cet appareil. Le navigateur et le système doivent autoriser les notifications. Sur les autres navigateurs compatibles, le bouton permet de demander l’autorisation directement. Aucune autorisation n’est demandée au chargement.

Au maximum cinq appareils sont associés à un compte. Une déconnexion détache les notifications de cette session et ferme les notifications locales ; une suspension, une session révoquée ou expirée empêche les nouveaux envois. La liste Mes appareils permet de retirer un ancien appareil. L’activation commence à partir des changements futurs ; elle ne renvoie pas l’historique. Un changement d’élève repart de son contexte propre. Les notifications visibles sur l’écran verrouillé restent génériques et renvoient vers les informations privées après connexion.

Les changements de salle, d’horaire et les annulations/restaurations de cours sont éligibles lorsqu’ils concernent une journée actuelle ou future. Les nouveautés ne sont pas renvoyées à chaque synchronisation. Le brief est envoyé une fois par jour, dans les 90 minutes suivant l’heure choisie, uniquement si des cours ou travaux pour demain sont disponibles ; le mode vacances suspend ce brief. Les abonnements expirés sont retirés et les pannes temporaires sont réessayées avec un délai croissant. Le bouton de test indique que le service du navigateur a accepté l’envoi, sans promettre sa réception sur le téléphone.

L’administration peut suspendre l’automatisme push et filtrer le journal sur Notifications de l’app ou Outils personnels. Aucun contenu de photo, de fichier ou de cours n’est écrit dans ces événements.

Référence de compatibilité iPhone/iPad : [Web Push sur iOS et iPadOS, WebKit](https://webkit.org/blog/13878/).

### Service de lecture des photos sur cette VM

Dépendances système : `python3-pil`, `tesseract-ocr`, `tesseract-ocr-fra` et `tesseract-ocr-eng`. Le processus de lecture utilise un utilisateur système dynamique, sans réseau ni accès au stockage ou aux comptes de Passerelle. Les photos temporaires privées sont supprimées après lecture ; elles ne sont ni ajoutées au flux ICS ni conservées comme pièces jointes. Les formats JPG, PNG et WebP sont acceptés, jusqu’à 8 Mo et 16 mégapixels (6 000 pixels par côté maximum). Une lecture à la fois, au plus cinq essais en quinze minutes par compte.

```sh
sudo install -d -m 0755 /usr/local/lib/passerelle
sudo install -m 0755 deploy/ocr-worker.py /usr/local/lib/passerelle/ocr-worker.py
sudo install -m 0644 deploy/passerelle-ocr.service /etc/systemd/system/passerelle-ocr.service
sudo install -m 0644 deploy/passerelle-ocr.socket /etc/systemd/system/passerelle-ocr.socket
sudo systemctl daemon-reload
sudo systemctl enable --now passerelle-ocr.socket
```

Le socket Unix `/run/passerelle-ocr.sock` est réservé au compte système ubuntu (0600). Adapter `SocketUser` si le service principal utilise un autre utilisateur. Le processus OCR ne reçoit que les octets de l’image. La limite du proxy nginx pour `/agenda/` est de 32 Mio pour les documents de 30 Mio et leur enveloppe ; les routes applicatives conservent leurs limites propres, et le JSON reste limité à 128 Ko. Les favoris chiffrés vivent dans `data/favorites` et doivent être sauvegardés avec `data/state.json` et `data/master.key` ; ne jamais distribuer ce répertoire dans une archive du code.

## Navigation simplifiée · version 4.10.0

L’espace élève dispose de **quatre destinations permanentes** : **Accueil**, **Agenda**, **Devoirs**, **Plus**. Le même repère est utilisé sur ordinateur et dans la barre inférieure du téléphone. Les outils restent accessibles ; les anciennes barres de neuf et sept onglets ont été remplacées par une seule vue à la fois, avec un retour explicite vers Plus.

- **Accueil** : la journée d’aujourd’hui ou de demain, jusqu’à trois travaux prioritaires, le menu publié et les rappels de cours repliés. Les nouveautés occupent une ligne uniquement lorsqu’il y en a. Le programme complet des devoirs, les réglages et les textes techniques ne sont plus répétés sur l’accueil.
- **Agenda** : directement la semaine, avec ses dates et ses cours.
- **Devoirs** : une liste dédiée, ses filtres et l’action Marquer fait. Le classement et la suppression se trouvent dans Options ; le formulaire d’ajout est replié.
- **Plus** : Mon lycée, recherche, nouveautés, aide, réglages et un groupe Pour travailler qui s’ouvre à la demande (soirée, sac, révisions, notes, charge, amis, fiches, rattrapage, bilan).

**Plus → Réglages** rassemble ENT/ICS, Pronote, mails, matières, accueil/vacances et apparence/installation. Les options avancées d’abonnement ICS sont repliées. L’affichage du thème se règle à cet endroit. Pour le menu, les plats restent lisibles directement ; les autres dates, la provenance et les documents sont dans Autres jours et document original. Les menus absents ne créent pas un grand bloc vide sur l’accueil. Un menu déjà publié reste consultable avec son avertissement après une panne.

Au premier démarrage, un compte sans ENT voit un seul bouton **Connecter mon ENT**. Une fois connecté, **Afficher mes cours** déclenche la récupération et prépare le flux existant sans imposer la compréhension d’ICS. Le lien facultatif vers une application d’agenda reste disponible dans les réglages. Les journées et priorités vides ne doublent pas l’étape de démarrage.

La vue du jour lit les cours déjà enregistrés, utilise la date de Paris, conserve les annulations et n’effectue pas de nouvelle connexion à l’ENT. Le suivi depuis la dernière consultation reste lié aux vues d’agenda effectivement montrées. Les choix de blocs, les ordres personnalisés et les données personnelles sont conservés ; l’ordre initial est présenté avec la journée en premier. Masquer la journée dans les préférences ne masque jamais l’écran Devoirs.

**Administration** reste séparée de la navigation élève : une entrée réservée sur ordinateur et dans Plus sur téléphone ouvre Pilotage, Comptes et mails, Journal et Assistance. Les commandes, protections, journaux et opérations de la version 4.9 sont conservés.

## Administration et consoles · version 4.9.0

Le nouvel espace **Administration → Pilotage** rassemble six vues : vue d’ensemble, comptes, incidents, opérations, commandes et portail. Il affiche la santé des sources, les demandes de support, l’activité des connexions, la mémoire, l’espace disque et l’intégrité du journal. Les rubriques existantes Comptes & notifications, Journal et Assistance restent accessibles.

Les comptes se recherchent par prénom, identifiant, établissement, adresse de notification ou étiquette. Filtres, pagination, export CSV et sélection de 100 comptes maximum permettent de suspendre/reprendre les sources, reconstruire les flux, fermer les sessions ou suspendre les notifications. Chaque fiche propose les rôles, la suspension, l’archivage réversible, la restauration, des étiquettes, une note interne chiffrée et un lien de réinitialisation du mot de passe. Les données scolaires privées et les jetons ne figurent pas dans la fiche administrative. Un renouvellement ICS invalide bien l’ancien abonnement ; la reconstruction conserve son lien.

La suspension et l’archivage révoquent les sessions et bloquent les connexions, les flux privés et les nouveaux traitements automatiques. Les données et consentements restent conservés. La réactivation reprend seulement ce qui avait été autorisé. Un administrateur web ne peut pas se bloquer lui-même ; le dernier administrateur actif est protégé, y compris dans une sélection groupée et depuis le terminal. Un changement de rôle révoque les anciennes sessions.

Les commandes suivent le même catalogue fermé depuis le site et la VM. **Ctrl/Cmd K** ouvre la console web. Une modification produit d’abord une prévisualisation nominative, liée à sa session, valable cinq minutes ; les changements sensibles exigent le mot de passe administrateur (validation dix minutes) et la saisie de `CONFIRMER N`. Un compte ou réglage modifié entre-temps exige une nouvelle prévisualisation. Les opérations approuvées persistent dans une file avec progression, résultat par cible, annulation des éléments encore en attente et reprise des seules lectures/reconstructions en échec. Une lecture en cours termine la sauvegarde de son jeton avant l’annulation. Après redémarrage, les opérations inachevées sont marquées interrompues et ne sont jamais rejouées automatiquement. L’historique garde au plus 200 opérations pendant trente jours.

Les incidents couvrent les connexions expirées, les lectures interrompues, les agendas en retard, les notifications en échec et le journal. Leur prise en charge ne masque pas leur cause ; ils sont résolus lorsque celle-ci disparaît. Les notes internes et paramètres des opérations sont chiffrés. L’audit commun identifie l’acteur web ou `local-admin`, la commande, son résultat et la cible, sans mot de passe, jeton ou lien privé. Les liens de réinitialisation (30 minutes) et d’invitation (1 à 168 heures) sont chiffrés, affichables une fois par leur créateur et utilisables une seule fois ; un nouveau lien de réinitialisation invalide le précédent. Aucun mail n’est déclenché par ces commandes. Le titulaire choisit un mot de passe de douze caractères minimum. Les exports et diagnostics excluent les mots de passe, jetons, liens ICS et contenus scolaires ; les cellules CSV susceptibles d’être interprétées comme formules sont échappées.

L’onglet Portail contrôle les inscriptions publiques, une maintenance de 5 à 180 minutes, les automatismes ENT/Pronote/mail séparément, les invitations et une annonce publique à durée limitée. La maintenance suspend les nouveaux automatismes et les inscriptions publiques, tout en laissant consulter les données enregistrées ; les invitations restent utilisables. Les annonces et pauses sont visibles par les utilisateurs. Aucune configuration n’est activée automatiquement par la mise à jour, et aucun consentement mail n’est ajouté.

### Commande sur la VM

Le service ouvre uniquement un socket Unix `data/admin.sock`, mode 0600 dans le répertoire privé 0700. Seuls le propriétaire du service et root peuvent l’utiliser ; il n’y a aucun port TCP d’administration supplémentaire. Le terminal ne lance ni shell ni code arbitraire. Le paquet ne stocke pas les saisies dans un historique de console.

Installation du raccourci sur cette VM (effectuée au déploiement) :

```sh
sudo install -m 0755 deploy/passerelle-admin /usr/local/bin/passerelle-admin
passerelle-admin status
passerelle-admin help
passerelle-admin doctor
passerelle-admin users list --state active
```

Exemples à adapter à un identifiant réel :

```sh
# Prévisualiser ; rien n’est modifié.
passerelle-admin sync run --source all --user identifiant
# Approuver l’aperçu renvoyé et suivre le résultat.
passerelle-admin apply ID_APERCU --watch
# Une action sensible exige aussi la confirmation exacte affichée.
passerelle-admin user suspend identifiant
passerelle-admin apply ID_APERCU --confirm 'CONFIRMER 1' --watch
# Consultation et suivi.
passerelle-admin jobs list --offset 0 --limit 25
passerelle-admin jobs show ID_OPERATION
passerelle-admin incidents list
passerelle-admin logs tail --level warn
```

Sans argument dans un terminal interactif, la commande ouvre une console. `--json` fournit une sortie structurée, `--execute` approuve explicitement la commande préparée et `--watch` attend le résultat ; les opérations sensibles gardent leur confirmation. `secret ID_OPERATION` affiche un lien privé une seule fois. Ces sorties peuvent contenir des informations administratives : elles restent dans le terminal autorisé. Pour une installation différente, adapter `deploy/passerelle-admin`, utiliser `npm run admin -- status` à la racine du projet, ou définir `PASSERELLE_ADMIN_SOCKET` / `--socket`. Le service doit être démarré.

## Mes outils et croisement ENT–Pronote · version 4.8.0

**Mes outils** regroupe une recherche privée, le rattrapage d’une journée, des fiches question/réponse avec révisions espacées, le suivi depuis la dernière consultation, un bilan hebdomadaire et l’assistance. Les fonctions déjà disponibles dans Mon organisation et le menu de la cantine sont conservées.

Chaque compte peut connecter **son propre Pronote**, dans **Mes outils → Pronote**. Depuis son espace Élève accessible par l’ENT, l’utilisateur génère un QR code de configuration, importe sa capture et saisit son code éphémère. L’image est décodée localement avec jsQR ; elle n’est pas envoyée au serveur. Un collage du contenu JSON reste possible. Passerelle présente ensuite les deux identités ENT et Pronote et exige une confirmation explicite du même élève. Une confirmation en attente peut être reprise après rechargement pendant dix minutes. Les comptes, établissements et profils sont isolés ; un changement d’élève désactive l’association en attendant une nouvelle connexion.

Les espaces Élève hébergés en HTTPS sur les sous-domaines `index-education.net` sont pris en charge individuellement. Les espaces Parents, les installations sur un serveur propre à un établissement et les autres ENT ne sont pas annoncés comme compatibles. Le portail permet à chaque lycéen d’utiliser son établissement ; aucune adresse du lycée des Horizons n’est imposée au connecteur. Le QR code évite de stocker le mot de passe de l’ENT. Les lectures de notes, bulletins structurés, absences/retards, devoirs et planning dépendent des droits et publications du compte source. Aucune note, moyenne ou appréciation n’est inventée ou recalculée. Un bulletin structuré n’est pas présenté comme un PDF téléchargé.

Les notes, bulletins et absences indisponibles dans l’ENT sont réactivés **uniquement lorsqu’une lecture Pronote de cette rubrique a réussi**, avec la mention de la source. Si les deux sources fournissent une rubrique, un sélecteur permet de choisir ENT ou Pronote. Les rubriques réellement absentes restent masquées ; une panne temporaire conserve la dernière version avec un avertissement. Le planning Pronote et ses différences avec l’ENT se consultent semaine par semaine sur l’année scolaire. Le planning ENT demeure la source des cours ICS : un rapprochement incertain ne modifie jamais automatiquement un horaire ou une salle. Les devoirs sont croisés dans le programme, les briefs et les flux ICS : seuls une date, une matière et un texte de consigne strictement identiques permettent de regrouper deux éléments. Les différences et doublons possibles restent visibles. Le suivi personnel « fait / à faire » reste local et conserve les validations lors d’un regroupement ultérieur. Les références techniques Pronote changent entre les sessions : les identifiants personnels sont stabilisés par compte, élève, instance et année scolaire, puis rapprochés uniquement lorsque les données permettent une correspondance non ambiguë. Une référence de session différente ne déconnecte pas un élève dont l’identité confirmée reste la même. Les sélections de période sont également stabilisées.

Les jetons mobiles Pronote sont chiffrés dans le stockage existant. Le connecteur s’exécute dans un processus Python borné, lit ses entrées sur un tube et exige l’accusé de sauvegarde de chaque jeton renouvelé avant de continuer. Aucun secret ne passe dans une ligne de commande, un fichier temporaire ou le journal. Chaque requête réseau reste en HTTPS sur l’instance validée ; les redirections et les autres hôtes sont refusés. Les réponses, la durée et la concurrence sont limitées pour la VM. Les synchronisations automatiques restent espacées de dix minutes et peuvent être suspendues par le titulaire. Une panne conserve les dernières données, une authentification expirée demande un nouveau QR code. Déconnecter Pronote retire son jeton et ses données de l’espace et reconstruit les travaux ICS sans modifier le lien personnel.

Installation du connecteur, déjà réalisée sur cette VM :

```sh
python3 -m venv /home/ubuntu/apps/agenda-bridge-pronote-venv
/home/ubuntu/apps/agenda-bridge-pronote-venv/bin/pip install -r deploy/pronote-requirements.txt
```

Le chemin se remplace avec `AGENDA_PRONOTE_PYTHON`. Les versions Python sont figées dans `deploy/pronote-requirements.txt`, avec pronotepy 2.15.7. Ce connecteur utilise une bibliothèque non officielle : [projet et documentation de pronotepy](https://github.com/bain3/pronotepy), [configuration de l’application dans l’aide officielle Pronote](https://doc.index-education.com/fr/pronote/eleves/Accueil.htm). Le décodeur jsQR 1.4.0 et sa licence sont fournis localement dans `public/vendor/`.

Le suivi **Depuis votre dernière visite** utilise un journal personnel borné à 1 000 événements / 90 jours et un curseur monotone. Les nouveautés de cours et devoirs sont enregistrées après le premier import ; les actualités sont indexées après leur consultation ou leur actualisation explicite dans la recherche. La première consultation établit un repère sans présenter tout l’emploi du temps comme nouveau. Le repère avance uniquement après affichage d’une vue de l’agenda dans Passerelle ou marquage explicite. Les synchronisations, les lectures HTTP d’un flux ICS et un onglet en arrière-plan ne comptent pas comme une visite. L’ouverture d’un agenda externe sur téléphone n’est pas observable. Un jeton de vue lie l’accusé au compte, à l’élève et au dernier événement effectivement chargé : un changement concurrent reste à voir. Un historique tronqué est signalé. Le bouton Tout voir conserve les changements montrés dans la consultation courante.

La recherche porte sur les informations du compte courant : cours synchronisés, devoirs, notes personnelles, fiches et dernières actualités indexées. Elle peut actualiser explicitement la liste d’actualités, sans ouvrir ni marquer des messages comme lus. Le rattrapage lit le cahier de textes disponible pour une date et conserve les données déjà synchronisées en cas de panne ; les contenus et documents sont accessibles uniquement avec les références privées validées. Aucune absence n’est créée par cette vue.

Les fiches personnelles, limitées à 500 par compte, proposent une réponse masquée puis « Je savais » ou « À revoir ». Les rappels sont espacés jusqu’à quatorze jours ; une difficulté fait revenir la fiche après dix minutes. Les révisions sont protégées contre une double validation de la même version. Le bilan compte les validations enregistrées à partir de l’activation du suivi, les séances de révision, les fiches et les segments de concentration réellement effectués. Les pauses et le temps restant d’un minuteur arrêté ne sont pas comptés ; minuit à Paris et les profils sont respectés. Aucun historique antérieur n’est reconstitué.

**Assistance utilisateurs**, réservée aux administrateurs, reçoit les signalements de tous les comptes dans une boîte commune avec états À traiter / En cours / Résolu, filtres, pagination et réponses. Le titulaire voit uniquement ses propres demandes et réponses dans Mes outils → Assistance. Des badges indiquent les demandes à traiter et les nouvelles réponses. Le texte des demandes et réponses est chiffré ; adresses, liens et secrets reconnaissables sont masqués. Le diagnostic automatique comprend la version, la rubrique, des états de connexion et au plus trois références d’erreurs récentes du compte. Il n’inclut ni calendrier, note scolaire, consigne, mot de passe, jeton ou adresse mail. L’audit ne reçoit que l’identifiant du ticket et son état. Aucun mail supplémentaire ni prestataire payant n’est activé par ces fonctions. Les inscriptions et la facturation conservent leurs réglages existants.

Les nouveaux parcours se vérifient avec `node tests/hub-browser.smoke.mjs`. La fixture QR est synthétique. Les tests unitaires du protocole de sauvegarde Python simulent le SDK et ne contactent aucun compte réel. Les essais de démonstration publique vérifient la lecture du SDK ; la connexion mobile réelle de chaque compte nécessite son propre QR code. Une réussite sur l’instance de démonstration ne garantit pas la disponibilité de toutes les rubriques dans tous les lycées.

Créez votre compte gratuitement depuis le portail (ou avec une invitation), connectez votre ENT Auvergne-Rhône-Alpes, puis cliquez sur **Créer mon lien ICS**. Ajoutez ce lien comme **abonnement** dans votre application d’agenda. Une importation unique du fichier ne reçoit pas les mises à jour.

La VM vérifie Skolengo toutes les 10 minutes. La fréquence de lecture du lien par l’application d’agenda dépend de cette application. Le lien est personnel et permet de consulter l’emploi du temps sans se connecter au portail. Vous pouvez le renouveler ou le désactiver depuis votre espace. Les inscriptions publiques créent des comptes personnels sans accès administrateur. L’administrateur peut fermer les inscriptions ; les invitations à usage unique restent alors utilisables.

Les identifiants de cours restent stables lors des changements. Les événements annulés sont retirés du flux publié ; une disparition de cours doit être confirmée par deux lectures réussies avant son retrait. La dernière version valide reste accessible en cas de panne ENT. Toute l’année scolaire en cours est récupérée, du 1er septembre au 31 août (2026–2027 actuellement), en périodes de 14 jours. Les cours passés de cette année restent disponibles jusqu’à la fin de l’année ; les cours des années précédentes sont conservés pendant 90 jours. Seuls les cours publiés par Skolengo peuvent être affichés. Les jetons ENT et les secrets des liens sont chiffrés en AES-256-GCM ; mots de passe scrypt. Cookies privés, protection d’origine et invitations à usage unique. Les connexions ENT utilisent des navigateurs temporaires isolés ; les mots de passe ne sont pas enregistrés.

Le service systemd `agenda-bridge` écoute sur 127.0.0.1:8020 derrière Nginx HTTPS. Les données et la clé sont dans `data/` (privé). Sauvegardez ensemble `state.json` et `master.key`, service arrêté. Un seul processus doit utiliser ce répertoire.

Le lien administrateur initial est dans `data/admin-invitation.txt` jusqu’à la création du compte. Il expire après 7 jours. Aucun accès Google ni client OAuth Google n’est requis.

Vérification : `npm run check`, `npm test`, puis `node tests/browser.smoke.mjs` pour le portail et la page ENT. Les tests utilisent des comptes temporaires et un parseur iCalendar indépendant. Les deux agendas existants ont également été contrôlés sur toute l’année scolaire ; les essais navigateur utilisent des comptes temporaires.

Le connecteur non officiel [scolengo-api](https://github.com/maelgangloff/scolengo-api) dépend de l’API mobile de Skolengo. Format du flux : [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545). Le service reprend automatiquement au redémarrage de la VM.


## Matières, devoirs et contrôles · version 3

Les matières reçoivent automatiquement un emoji et une couleur. L’onglet **Matières** permet de les personnaliser. Le flux principal garde les mêmes identifiants et le même lien ; il contient désormais cours, devoirs et contrôles. Les liens supplémentaires `?type=course`, `?type=homework`, `?type=exam` et `?subject=<clé>` filtrent le même agenda privé. Les liens par matière sont disponibles dans le portail.

Le portail affiche les couleurs. Les applications d’agenda décident de leur prise en charge dans ICS : le champ COLOR suit RFC 7986 et les rappels utilisent VALARM. Les réglages de rappels proposent 0, 5, 10, 15 ou 30 minutes avant les cours. Un rappel désactivé reste désactivé par défaut.

Les devoirs sont lus sur le service dédié Skolengo par périodes de 28 jours, en complément des cours. Les lectures cessent après la dernière période de cours publiée pour éviter les erreurs du service pendant l’été. Une fin de pagination 400 n’est acceptée que lorsque le service indique explicitement que la page suivante est hors des résultats. Le contenu HTML est converti en texte sans charger de ressources distantes. Les contrôles repérés par les mots des devoirs sont signalés comme tels et peuvent être reclassés ; ils ne représentent pas des notes ni une liste officielle garantie des évaluations. Les utilisateurs peuvent ajouter leurs propres devoirs ou contrôles et les marquer faits. Ce suivi personnel ne modifie pas l’ENT. Les tâches sont publiées comme événements sur une journée, avec les mêmes UID lors des modifications ; ils sont retirés du flux lorsqu’ils sont terminés ou supprimés.

L’onglet **Demain** montre les cours et salles du lendemain, les devoirs encore à faire pour cette date et les contrôles des sept prochains jours. **Changements** détaille les déplacements, changements de salle et annulations des cours.

## Préparer l’envoi des briefs

Aucun transport d’envoi n’est préconfiguré. Le service reste fonctionnel sans SMTP, avec l’aperçu du brief dans le portail.

Dans **Administration · Envoi des mails**, renseigner le serveur SMTP de l’expéditeur, le port sécurisé 465 (TLS) ou 587 (STARTTLS), l’identifiant, le mot de passe et l’adresse d’expédition autorisée. La connexion est vérifiée avant enregistrement. Les accès sont chiffrés et le mot de passe n’est jamais renvoyé par l’API. TLS reste vérifié ; les journaux SMTP détaillés sont désactivés.

Chaque utilisateur renseigne ensuite son adresse, choisit une heure (20 h par défaut, Europe/Paris) et demande le brief. Un mail de confirmation, valable 24 heures et à usage unique, est nécessaire avant activation. L’adresse est chiffrée en base. Il est possible d’envoyer un aperçu uniquement à sa propre adresse confirmée, de désactiver les briefs, de retirer son adresse ou de se désabonner depuis le lien de chaque mail.

Le planificateur vérifie l’heure toutes les 15 secondes. Il prépare un récapitulatif déterministe à partir des données réellement récupérées, sans modèle de génération et sans inventer de devoirs. Les données périmées ou indisponibles sont signalées. Il tente de rafraîchir l’ENT avant un brief si les données sont anciennes. Une tentative quotidienne est enregistrée avant l’envoi pour limiter les doublons après redémarrage. Les erreurs SMTP sont signalées ; un envoi dont l’issue est incertaine n’est pas répété automatiquement le même jour. L’aperçu manuel reste disponible. L’acceptation SMTP ne garantit pas l’arrivée dans la boîte principale du destinataire.

## Vérifications supplémentaires

`npm test` vérifie les modules et les API. `node tests/features-browser.smoke.mjs` vérifie le parcours complet dans un serveur isolé avec de faux comptes et un transport mail simulé : matières, rappels, tâches, changements, configuration SMTP, confirmation, aperçu et désabonnement. Aucun mail réel n’est envoyé par ces tests.

Références : [COLOR iCalendar, RFC 7986](https://www.rfc-editor.org/rfc/rfc7986), [transport SMTP Nodemailer](https://nodemailer.com/smtp).


## Administration et nouveau tableau de bord · version 3.1

La navigation distingue l’espace scolaire, l’abonnement ICS, les comptes et notifications, et le journal d’activité. L’interface s’adapte au téléphone. Les cours du lendemain, les devoirs et les contrôles des sept prochains jours sont prioritaires dans l’accueil.

**Envoi gratuit avec Gmail** : ouvrir **Comptes & notifications → Administration · Envoi des mails**. Utiliser une adresse Gmail personnelle, activer la validation en deux étapes, puis créer un mot de passe d’application nommé Passerelle. Le formulaire simple demande uniquement cette adresse et le mot de passe d’application. Il choisit automatiquement smtp.gmail.com, TLS sur le port 465, l’adresse comme identifiant et Passerelle comme nom affiché. Le mot de passe habituel Google ne convient pas. Les comptes scolaires ou protégés peuvent interdire les mots de passe d’application ; les limites du compte Google s’appliquent. Aucun abonnement payant ni nom de domaine n’est requis pour cette configuration. Le portail n’ouvre pas de compte Google à la place du propriétaire.

Les réglages SMTP complets restent disponibles pour un autre serveur. Si le service dispose déjà de variables `AGENDA_SMTP_FROM` et `AGENDA_SMTP_PASSWORD`, il vérifie et importe automatiquement la configuration au démarrage, uniquement si aucun expéditeur n’est enregistré. Les variables facultatives sont `AGENDA_SMTP_HOST`, `AGENDA_SMTP_PORT`, `AGENDA_SMTP_USER` et `AGENDA_SMTP_NAME`. Ne pas publier leurs valeurs.

L’admin voit les comptes et peut associer une adresse et une heure à chacun, même avant la configuration de l’expéditeur. Il peut transmettre ou renouveler une confirmation, suspendre les briefs, retirer l’adresse et relancer une synchronisation ENT. Seule la confirmation par le destinataire active l’abonnement. Une modification d’adresse invalide les anciennes confirmations. Un admin ne réactive pas silencieusement un destinataire désabonné. Les accès ENT, liens ICS et travaux restent privés au compte.

### Journal d’activité

Les synchronisations, confirmations, envois, lectures ICS, connexions, actions administrateur et requêtes en erreur sont enregistrés dans `data/logs/`. Les événements portent un niveau, une source, une date, les identifiants du compte et de l’acteur, un identifiant de requête ou de tâche, une durée, les compteurs utiles et un code d’erreur fixe. Les identifiants de connexion IP sont pseudonymisés et changent chaque jour ; aucune adresse IP brute, adresse mail, consigne, mot de passe ou URL privée n’est enregistrée. Les simples consultations de statut et de logs réussies ne polluent pas le journal.

Le journal admin propose filtres de source, compte, dates et gravité, recherche, pagination, actualisation toutes les 15 secondes (suspendue pendant la saisie et la lecture des détails), indicateurs sur 24 heures et export JSONL jusqu’à 5 000 lignes. La recherche et les indicateurs portent sur les 10 000 derniers événements chargés en mémoire. Les fichiers sont conservés 30 jours avec rotation à 5 Mio et un maximum de 60 fichiers. Ils restent privés (répertoire 0700, fichiers 0600).

Chaque ligne est liée à la précédente par HMAC-SHA256 et un point de contrôle signé détecte aussi une troncature finale. Le contrôle intégral est exécuté au démarrage et peut être relancé depuis l’admin. Une anomalie arrête l’écriture du journal et est signalée sans arrêter le portail. Ce contrôle ne protège pas d’un administrateur système possédant la clé ; ce n’est pas une preuve notariale externe. Sauvegarder également les logs si l’historique est nécessaire.

Références : [mots de passe d’application Google](https://support.google.com/accounts/answer/185833?hl=fr), [SMTP Gmail](https://developers.google.com/workspace/gmail/imap/imap-smtp).


## Interface du 27 octobre 2026

Navigation latérale sombre sur ordinateur, navigation fixe en bas sur téléphone, typographie Manrope auto-hébergée, cartes de programme plus lisibles et affichage compact de la journée suivante. Les quatre onglets scolaires restent visibles sur mobile. Les cartes de cours affichent horaires, couleur de matière et salle ; les paramètres, comptes et journaux suivent la même présentation. La page de connexion reprend cette identité.

La police Manrope est distribuée sous SIL Open Font License 1.1 ; le fichier de licence est fourni dans `public/fonts/OFL-Manrope.txt`. Les ressources utilisent le marqueur de cache `3.2.0`. Le serveur et les API restent en version 3.1.0, sans changement du fonctionnement des comptes, des mails ni des flux ICS.


## Organisation personnelle · version 4.0.0

**Mon organisation** regroupe cinq onglets :

- **Semaine** : navigation sur toute l’année scolaire, cours publiés et annulés, devoirs, contrôles et séances de révision. Les horaires sont affichés en heure de Paris.
- **Mon sac** : une liste générale et des listes par matière, à personnaliser une fois. Le matériel proposé suit les cours non annulés de la date choisie. Chaque date dispose de ses propres cases cochées, conservées sur le compte. Le sac peut être préparé pour les premiers jours de septembre même avant le basculement d’année scolaire.
- **Révisions** : objectif de 15 à 600 minutes pour un contrôle à venir, séances de 10 à 60 minutes, répartition sur les 28 jours précédant le contrôle, jusqu’à deux heures de révisions par jour en tenant compte des séances existantes. Replanifier conserve les séances déjà faites de ce contrôle et remplace celles à faire. Le total déjà réalisé est déduit de l’objectif. Les séances apparaissent dans la vue semaine du portail. Les contrôles repérés dans les consignes restent à vérifier avec l’enseignant.
- **Entre amis** : lien de partage à usage unique valable sept jours, séparé des invitations de création de compte. Le créateur accepte le partage avant de créer le lien ; le destinataire doit se connecter et accepter explicitement le partage réciproque. Seuls les créneaux libres communs sont renvoyés, sans matière, salle, devoir, adresse mail ni lien ICS. Chaque partie peut révoquer immédiatement le partage. Recherche sur une semaine, de 30 minutes à trois heures minimum, avec une plage horaire personnalisable. Un agenda indisponible, trop ancien (30 minutes) ou ne couvrant pas la date ne produit aucun créneau réputé libre. Les autres engagements personnels doivent être vérifiés par les participants.
- **Application** : aide à l’installation et apparence. Le manifeste et les icônes permettent l’installation depuis un navigateur compatible. Le bouton propose le dialogue natif lorsqu’il est disponible, sinon les instructions du navigateur. La navigation reste limitée au chemin `/agenda/`. Le service worker ne conserve que la page publique hors connexion, son CSS et le favicon ; les API, flux ICS, captures ENT et vues personnelles restent sur le réseau. Une connexion Internet est nécessaire pour consulter l’espace à jour.

Le thème clair, sombre ou automatique se choisit en haut du portail ou dans l’onglet Application. Il est enregistré localement sur l’appareil et suit les changements du thème système en mode automatique.

### Alertes de changement par mail

Dans **Mon espace → Demain → Mes notifications**, le destinataire confirmé peut activer les alertes indépendamment du brief quotidien. Les changements d’horaires, de jour, de salle, les annulations et les rétablissements des cours à venir de l’année scolaire sont regroupés après chaque synchronisation réussie. Le premier import, les personnalisations d’emoji/couleur, les changements de titre seuls et les cours nouvellement ajoutés ne déclenchent pas de message.

Une file privée bornée conserve les changements. Chaque groupe est déclaré en cours avant l’appel SMTP. Un redémarrage ou une issue SMTP incertaine ne déclenche pas de répétition automatique ; l’état de la dernière alerte est disponible et les événements d’envoi portent `mode=changes` dans le journal. Les changements déjà passés ou restés en attente plus de 24 heures ne sont pas envoyés. Le désabonnement et la suspension admin arrêtent à la fois le brief et les alertes et vident les changements en attente. Modifier l’adresse invalide les confirmations et les alertes en attente de l’ancienne adresse. Aucun compte existant n’est inscrit automatiquement aux nouvelles alertes.

### Vérification

`npm run check`, `npm test`, `node tests/features-browser.smoke.mjs`, `node tests/admin-browser.smoke.mjs`, `node tests/organizer-browser.smoke.mjs`.

Le dernier parcours navigateur couvre la semaine, le matériel conservé après rechargement, les révisions, les alertes par transport simulé, le partage réciproque et sa révocation, les thèmes, le manifeste et l’absence de données personnelles dans la page hors connexion. Les essais utilisent uniquement des comptes fictifs et n’envoient aucun mail réel.

Références : [installation des applications web, MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [service workers, MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).

## Identité visuelle · 4.1.0

Passerelle adopte la direction « Carnet contemporain » et la signature « Ta journée prend forme. ». Un emblème original (arche et point citron), Manrope en local et une palette vert profond / papier / citron forment une identité commune aux pages de connexion, aux écrans personnels et administrateurs, aux modes clair et sombre, à l’installation mobile et aux trois types de mail. Les couleurs personnalisées des matières restent indépendantes de la marque.

La charte est disponible sur `/agenda/brand/` ; elle contient un PDF de sept pages, les références de couleurs et un kit ZIP avec les logos PNG transparents, variantes, icônes et police accompagnée de sa licence. Les fichiers sont publics et contiennent uniquement les éléments graphiques, sans donnée de compte. Le prompt de l’emblème et sa méthode de création sont documentés dans `public/brand/README.md`.

Les styles de marque sont regroupés dans `public/brand.css` et les tokens exportables dans `public/brand/palette.json`. Le cadre HTML commun aux mails est dans `src/brand.js`, avec une icône intégrée en pièce MIME inline (CID), sans chargement d’image distante ; le texte brut, la vérification des destinataires et la planification des envois restent assurés par les moteurs existants. La page hors connexion est neutre ; le service worker ne met toujours aucune donnée personnelle en cache.

Pour régénérer les supports depuis une copie de développement : `node scripts/brand-preview.mjs` lance un portail avec des données fictives et aucun envoi réel ; `node scripts/export-brand.mjs` exporte icônes, signatures et charte PDF avec le navigateur déjà installé. `node scripts/review-brand.mjs` parcourt et capture les principaux écrans. Arrêter le premier processus à la fin ; son stockage temporaire est supprimé à l’arrêt.


## Ouverture publique et nouvelle vue d’ensemble · 4.2.0

Les inscriptions sont ouvertes par défaut et peuvent être activées ou suspendues depuis **Comptes & notifications → Le portail s’ouvre**. Le lien direct est `/agenda/#signup`. Sans invitation, un nouvel inscrit devient toujours membre, même si sa requête tente de préciser un rôle administrateur. Une invitation valide reste obligatoire pour un compte administrateur initial. Les liens expirés ou déjà utilisés ne deviennent pas des inscriptions publiques par repli.

Le formulaire public demande prénom, identifiant et mot de passe de 12 caractères minimum. Il ne collecte ni données de paiement ni identifiants ENT. Aucun mail n’est envoyé à l’inscription ; les notifications gardent leur confirmation d’adresse et leur choix explicite séparés. L’inscription applique une limite par IP, une protection d’origine et un champ piège ; les compteurs ont une taille bornée. L’ouverture simultanée de fenêtres ENT réserve sa place avant les appels asynchrones et conserve au plus deux sessions de connexion. Les sessions, mots de passe et droits utilisent les mécanismes existants.

L’ouverture est stockée dans `settings.publicRegistration` (absence = ouvert). `GET /api/status` expose `registrationOpen` et `billingEnabled: false` ; seul un administrateur authentifié peut modifier l’ouverture avec `POST /api/admin/registration` et `{ "enabled": true|false }`. Le journal enregistre le mode public/invitation et les changements d’ouverture sans identifiant de connexion ni adresse mail. Fermer les inscriptions n’interrompt pas les comptes existants.

Le nouveau tableau de bord présente une introduction compacte, des accès directs à la semaine, aux devoirs, au sac et aux révisions, puis un résumé de la journée. Les cours, les travaux et les réglages de notifications s’organisent en trois colonnes sur grand écran et se réordonnent sur mobile. Les nouveaux comptes disposent d’un parcours de démarrage. La page de connexion/inscription reprend l’identité Passerelle avec des formulaires distincts et un contrôle d’affichage du mot de passe.

Le service reste en **bêta gratuite**, avec tous les usages existants accessibles. Aucun achat, abonnement, produit de paiement, renouvellement automatique ou restriction premium n’est activé dans cette version. La réflexion tarifaire reste une proposition à valider. La connexion aux cours concerne toujours les établissements compatibles de l’ENT Auvergne-Rhône-Alpes ; ouvrir un compte ne rend pas d’autres ENT compatibles.


## Interface épurée et mouvement · 4.3.0

L’interface quotidienne adopte une navigation claire, des vues en lignes et des séparations fines. Les gros panneaux de couleur, compteurs en cartes et emojis de navigation sont remplacés ; les emojis/couleurs personnalisés des matières restent disponibles. Les réglages de mail sont dans le panneau « Mes notifications », ouvert depuis la cloche sur mobile ou la navigation latérale sur ordinateur, quel que soit l’écran courant. Le panneau est modal, se ferme avec Échap et rend le focus à sa commande d’ouverture. Les champs non enregistrés restent présents pendant une actualisation de la vue si la configuration de mail n’a pas changé.

Les 22 icônes SVG originales sont définies dans `public/index.html` et exportées dans `public/icons/passerelle.svg`, également dans le kit graphique. `public/interface.css` constitue la couche visuelle commune claire/sombre ; elle remplace le chargement des trois variantes précédentes `brand.css`, `experience.css` et `dark.css`. `public/motion.js` fournit les transitions natives (opacité/translation) des vues, onglets et notifications, sans dépendance externe. Les effets ne sont pas relancés à chaque rafraîchissement périodique. La préférence système `prefers-reduced-motion` désactive le mouvement. Les onglets prennent en charge les flèches et les touches Début/Fin.

La page de connexion/inscription et la page hors connexion suivent le même style sobre. L’inscription publique et la bêta gratuite restent disponibles ; la facturation reste désactivée. Les données, sources et moteurs de synchronisation/envoi ne sont pas modifiés par ce changement d’interface.

## Chargements et retours animés · 4.4.0

L’ouverture présente un symbole Passerelle animé pendant la récupération initiale. Depuis la version 4.4.1, il reste visible au moins 1,6 seconde à chaque ouverture ou rechargement, même si la réponse est immédiate, puis disparaît en fondu. Les données sont récupérées en parallèle ; une réponse plus lente n’ajoute pas ce délai une seconde fois. Les changements d’onglet et les actualisations de fond n’affichent pas cet écran. Une erreur de démarrage remplace le chargement par un bouton de nouvelle tentative. Les vues d’organisation utilisent des placeholders pendant leur premier chargement et un indicateur discret lorsqu’elles possèdent déjà des données.

Les appels API hors sondage de statut pilotent un indicateur global indéterminé, affiché après 140 ms pour éviter les clignotements sur les réponses rapides. Un compteur gère les requêtes simultanées ; succès, erreurs et interruptions terminent leur indicateur. Les boutons sont désactivés et marqués `aria-busy` pendant leur opération, puis restaurés. Le suivi du sac possède une progression SVG liée au nombre réel d’objets cochés, accompagnée d’un élément `progress` accessible.

Les confirmations affichent une coche tracée et un témoin du temps restant avant fermeture du message. Les messages restent échappés avant insertion. Les lignes des vues apparaissent avec un léger décalage uniquement lors des navigations explicites ; les actualisations de fond ne rejouent pas ce mouvement. Les formulaires invalides, fenêtres d’aide et tâches terminées partagent la même famille de mouvements courts.

Un aperçu est disponible dans **Mon organisation → Application → Aperçu des animations**. Il présente le chargement, la confirmation, l’apparition des lignes et la progression, sans action sur les données. La préférence système de mouvement réduit désactive les animations et conserve les indications de chargement. Les règles sont dans `public/animations.css` ; leur orchestration reste dans `public/motion.js`, sans bibliothèque ajoutée.

## Mon ENT · 4.5.0

Un nouvel espace rassemble les rubriques de consultation disponibles dans le connecteur Skolengo : notes par période avec moyennes transmises par l’établissement, coefficients, compétences et appréciations ; bulletins ; absences/retards et historique ; dossiers de messagerie et fils de discussion ; actualités ; cahier de textes par semaine avec contenus de séances, devoirs, corrections et pièces jointes ; profil de l’élève et établissement.

Les rubriques se chargent à la demande avec la session ENT existante, indépendamment de la création du lien ICS. Chaque liste dispose d’une actualisation explicite et les listes paginées de commandes de navigation. Les données sont gardées cinq minutes en mémoire du serveur, dans des contextes bornés par compte/élève/établissement/connexion, sans nouvelle copie persistante dans le stockage. Le navigateur vide sa vue ENT à la déconnexion. Une rubrique indisponible affiche son erreur et conserve la dernière consultation réussie ; elle ne bloque pas l’agenda, les devoirs ni les notifications.

L’ouverture explicite d’un message utilise un POST protégé par le contrôle d’origine : Skolengo peut alors le marquer comme lu. Les listes et actualisations ne lisent pas les fils. Aucun envoi, réponse, suppression ou justification d’absence n’est implémenté. Les contenus sont convertis en texte et échappés ; les images et ressources HTML distantes ne sont pas chargées. Les téléchargements sont authentifiés et utilisent des références locales liées au compte ; le client ne fournit jamais une URL à télécharger. Seuls les fichiers du domaine de l’API Skolengo sont téléchargés avec le jeton, sans redirection et avec une limite de 15 Mo. Les autres fichiers se consultent dans l’ENT. Un fil de plus de 100 participations renvoie vers l’ENT pour la suite.

Les accès au connecteur sont sérialisés par compte avec la synchronisation de l’agenda, afin de protéger la rotation des jetons. Les requêtes sont limitées et les caches/références bornés. Les journaux contiennent la rubrique et le résultat, jamais les notes, le texte des messages, les noms de fichiers, les coordonnées ou les URL privées. Les rubriques accessibles dépendent des droits du compte et des services de l’établissement ; les démarches, paiements, restauration et fonctions non exposées par le connecteur continuent de s’utiliser dans Skolengo. Passerelle reste une interface indépendante.

Validation locale : `node --test tests/school.test.js` pour l’isolation des comptes, les droits, les téléchargements, les pannes partielles et la sérialisation du connecteur ; `node tests/school-browser.smoke.mjs` pour les sept rubriques sur ordinateur et mobile, les téléchargements, le clavier, le mode sombre, le mouvement réduit et la déconnexion. Ces parcours utilisent uniquement des données fictives et n’envoient aucun mail réel.

## Menu de la cantine sur l’accueil · 4.6.0

Le bloc « À la cantine » cherche automatiquement les actualités intitulées « Menu(s) du … au … », récupère leur PDF et affiche la journée sélectionnée, par défaut aujourd’hui en Europe/Paris. Les articles sont vérifiés toutes les dix minutes lorsque l’accueil est utilisé. Un sélecteur de date et un accès au prochain jour publié permettent de consulter les autres menus ; un jour absent reste absent et n’est jamais rempli avec celui d’un autre jour.

L’extraction reste locale : Poppler lit la couche texte et les coordonnées des mots ; pour un document scanné, Tesseract reconnaît le français et l’anglais. Les journées sont séparées par leur position dans le document, en lignes ou colonnes, et rattachées à la semaine explicite de l’article. Les dates ambiguës, en-têtes répétés et lectures peu fiables ne produisent pas de faux menu. Les signatures et pieds de page sont exclus. Le texte reconnu peut contenir des erreurs ; le lien vers l’extrait original de la journée et le PDF complet restent disponibles. Aucun label alimentaire ou allergène n’est déduit du texte.

Le PDF du lycée des Horizons « Menus du 2 au 6 novembre 2026 » a été récupéré et testé : c’est une page scannée, avec les menus du lundi, mardi, jeudi et vendredi ; le mercredi n’est pas inventé. Cette vérification a utilisé un accès en lecture seule à l’actualité et à son PDF, sans rotation des jetons ni modification du stockage de production. Les fichiers de travail réels ne sont pas inclus dans le code ou l’archive source.

Les fichiers de l’ENT AURA servis par `/lectureFichiergw.do` sont désormais reconnus pour un établissement AURA vérifié. Le serveur ne transmet le jeton qu’à l’API Skolengo ou à cette passerelle HTTPS officielle, sans redirection ni URL fournie par le navigateur. Les menus, PDF et extraits restent accessibles uniquement avec la session personnelle. Les réponses, extraits et données de l’accueil ne sont pas conservés par le service worker. Une panne de l’ENT conserve seulement le dernier menu valide de la date demandée, avec une indication explicite.

Les documents de 8 Mo maximum sont analysés sur les quatre premières pages, avec des délais de traitement bornés, un seul traitement OCR à la fois et nettoyage des fichiers temporaires. Le cache de documents décodés est limité à huit éléments en mémoire ; aucun PDF supplémentaire n’est conservé dans `state.json`. Aucune API payante ou externe d’analyse n’est utilisée. Dépendances système : `poppler-utils`, `tesseract-ocr`, `tesseract-ocr-fra` et les modèles anglais fournis par le paquet Tesseract.

Installation Ubuntu : `sudo apt-get install poppler-utils tesseract-ocr tesseract-ocr-fra`.
Documentation de référence : [Poppler/pdftotext](https://manpages.ubuntu.com/manpages/noble/man1/pdftotext.1.html), [sortie TSV de Tesseract](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html).

## Organisation personnelle et services disponibles · 4.7.0

« Ma soirée » réunit les devoirs urgents et les séances de révision, avec des durées modifiables. Les estimations par défaut (25 min pour un devoir, 45 min pour un contrôle sans séances déjà prévues) sont indiquées comme telles. L’objectif quotidien est réglable. La vue de charge porte sur les sept prochains jours ; « Répartir mes devoirs » change uniquement les jours de travail personnels, en conservant les dates limites de l’ENT et les séances de révision. Les journées trop chargées restent signalées.

Le minuteur de concentration est enregistré côté serveur : échéance réelle, pause, reprise, arrêt et pause de cinq minutes. Il se retrouve après rechargement, calcule le temps restant au lieu de décrémenter un compteur dépendant de l’onglet, et ne termine jamais automatiquement un devoir. Il peut être fermé une fois la séance terminée. Les rappels de cours sont personnels, liés à une matière et au profil d’élève courant ; ils apparaissent pour son prochain cours non annulé. Ils restent disponibles dans « Notes de cours » jusqu’à leur traitement ou suppression. Les notes créées avant la première connexion ENT sont rattachées à son premier profil.

Les préférences permettent de masquer et ordonner les blocs de l’accueil. Un raccourci « Personnaliser mon accueil » reste présent pour rétablir les blocs. Les outils, notes, préférences et minuteurs sont propres à chaque compte, sans copie dans le service worker. Le mode vacances suspend les briefs quotidiens entre le premier jour et la veille du dernier jour choisi. Le dernier soir, à l’heure habituelle, un récapitulatif prépare le retour et les échéances des sept jours suivants. L’envoi nécessite toujours l’adresse confirmée et l’activation préalable du brief ; aucune préférence de consentement n’est activée par ce réglage. Les alertes de changement gardent leur préférence distincte et les aperçus manuels restent possibles.

« Mon ENT » vérifie les droits et la disponibilité des services avec la connexion existante. Les refus explicites et l’erreur Skolengo `NO_SCHOOLING_SOLUTION_CONFIGURED` désactivent seulement les rubriques concernées. Une panne temporaire, une expiration de connexion ou une liste vide ne suffit pas à supprimer une rubrique. Les contrôles ne lisent pas les fils de messagerie et ne les marquent pas comme lus. Les états sont privés, bornés et conservés trente minutes en mémoire par compte/élève/connexion ; un bouton permet de revérifier et réactiver les services redevenus disponibles. Les détails non autorisés (historique d’absence, appréciations non publiées, etc.) ne proposent pas de bouton actif.

La vraie connexion du lycée des Horizons confirme : notes, bulletins et absences renvoient « aucune solution de vie scolaire configurée » et sont masqués ; messages, actualités, profil, contenus des séances et détails des devoirs restent disponibles. Les outils personnels continuent de fonctionner indépendamment de ces rubriques. La vérification n’a affiché aucun contenu privé, modifié aucun état de production ou jeton, ni envoyé de mail.

### Agenda et connexion Lapsus · 4.20

L’agenda regroupe visuellement les séances adjacentes identiques, indique le cours actuel et les changements depuis la dernière consultation, ouvre les cours avec leurs devoirs de la semaine et notes personnelles, et se parcourt par glissement sur mobile. Les icônes de lecture, horaire, note, salle, mail et actualité utilisent le même tracé. Les objets source et UID ICS sont conservés. Voir [la présentation de l’agenda](docs/AGENDA.md).

Le connecteur Lapsus géré peut recevoir la messagerie et les actualités de l’ENT en plus des cours, devoirs et contrôles. Les permissions sont explicites, les anciens droits ne sont pas élargis automatiquement et les références privées restent liées à la connexion. Le kit Cloudflare comprend les listes, lectures intégrales, pièces jointes et pagination, sans nouveau schéma Supabase. Voir [le connecteur ENT](docs/MANAGED_ENT.md). Le déploiement du kit sur le projet Lapsus et ses secrets restent à effectuer par son propriétaire.

La version 4.20.1 ajoute le bilan concret des horaires depuis la dernière consultation et les cases de validation des devoirs dans le panneau de cours. Les états restent réversibles et communs avec la page Devoirs.

La version 4.20.2 simplifie l’agenda : date persistante au défilement, flèches adaptées à la vue journée/semaine, retour à aujourd’hui, cartes hiérarchisées et pauses courtes entre les cours. Voir [la présentation de l’agenda](docs/AGENDA.md).

La version 4.20.3 distingue les récréations de quinze minutes et les pauses déjeuner entre 11 h et 14 h, en conservant les horaires réels et les rendez-vous personnels.

La version 4.20.4 remplace les emojis des matières par des pictogrammes au trait dans les vues journée/semaine et les détails de cours, en conservant les couleurs et les données source.

## Statut du système

La page `/agenda/status/` présente l’état public des services, avec actualisation toutes les trente secondes et distinction des signaux observés, pauses, maintenance et services non activés. Elle est accessible depuis le pied de page et l’administration. Les données de compte restent privées. Le déploiement Nginx dédié lui permet de signaler un arrêt du seul service Passerelle ; voir [le suivi du système](docs/SYSTEM_STATUS.md).

La version 4.21.1 enrichit la page de statut avec des graphiques de réponse et d’états sur 1/6/24 h, une médiane et des compteurs de contrôles. Le suivi indépendant conserve uniquement des mesures publiques pendant 24 h, y compris lors d’un arrêt du backend ; aucun historique antérieur n’est inventé.
