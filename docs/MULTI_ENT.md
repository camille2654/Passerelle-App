# Passerelle 4.26 — plusieurs ENT, connexion PRONOTE depuis l’ENT

## Correction 4.26.4 — première navigation d’un nouvel onglet

La tentative réelle 4.26.3 atteint une navigation PRONOTE puis une erreur de
capture avant tout import. Le message générique est reproduit hors réseau
externe en ouvrant le lien dans un nouvel onglet : Playwright reçoit sa première
requête avant que son cadre existe et `request.frame()` lève une exception.
La requête et le serveur peuvent pourtant être valides. Le code employait cette
méthode pour compter et réinitialiser les redirections.

Le choix du cadre de comptage gère maintenant cette absence temporaire et utilise
le cadre initial comme repli ; la réponse et les paramètres SSO continuent d’être
interceptés. Cela ne change ni les domaines autorisés ni la limite de boucles.
Les tests Chromium couvrent en plus une arrivée directe en nouvel onglet, un
nouvel onglet avec HTTP 302 et un formulaire avec POST 307 dans un nouvel onglet.
Les douze scénarios de redirection sont locaux, avec données synthétiques.

En cas d’erreur inattendue, le message décrit un échec de récupération par
Passerelle plutôt qu’une indisponibilité supposée de l’ENT. L’audit conserve
uniquement une étape prédéfinie (`policy`, `navigation-fetch`,
`navigation-response`, `bootstrap`, `handoff`, `asset`) et un code fixe.
Aucune exception brute, URL, valeur de cookie ou champ d’authentification n’est
ajouté au journal. Le test d’échec vérifie explicitement cette absence.

## Correction 4.26.3 — chaîne de redirection CAS/PRONOTE

Le second diagnostic de la session réelle constate un espace Élève connecté,
un HTML reconnu par le lecteur 4.26.2 et des champs SSO présents, mais aucun
transfert lancé. Il ne retourne ni leur valeur ni les données de l’élève.
Le défaut est ensuite reproduit hors réseau externe dans Chromium : après une
réponse HTTP 302, la destination n’est pas passée au gestionnaire de routes et
son script consomme la connexion avant Passerelle. Les tests précédents avec
routes simulées ne reproduisaient pas ce comportement du navigateur.

Les navigations de connexion sont désormais lues avec zéro redirection suivie
automatiquement. Chaque destination est validée avant d’être ouverte comme une
nouvelle navigation : le HTML PRONOTE peut ainsi être capturé avant `Start`.
Les codes 301/302/303 et les GET 307/308 utilisent une actualisation HTML, sans
script. Les POST 307/308 de type formulaire URL-encodé sont reproduits par un
formulaire éphémère, avec valeurs échappées, champs répétés et nonce CSP. Ils
restent POST. Les autres corps POST sont refusés avec une explication ; cette
version ne prétend pas prendre en charge un POST multipart ou JSON redirigé.

Les cookies restent dans le même contexte temporaire. L’intermédiaire est sans
cache, n’exécute aucun script du portail et ne conserve aucun formulaire ni
ticket dans les journaux. Chaque chaîne est limitée à vingt redirections par
cadre. La destination doit respecter la politique HTTPS et les domaines déjà
autorisés. Un événement de navigation PRONOTE lance aussi la limite de transfert
de quatre-vingt-dix secondes, indépendamment du résultat de l’interception.

Le test `tests/pronote-redirect-browser.smoke.mjs` utilise un vrai Chromium et
un vrai serveur HTTP local, avec adaptation des domaines au seul transport.
Il couvre neuf scénarios : GET 302/307/308, POST 302/303/307/308, destination
interdite et boucle. Il vérifie la conservation du POST, un seul chargement du
bootstrap et zéro exécution de sa connexion dans le navigateur. Aucun ENT ou
compte réel n’est contacté par ce test. La confirmation sur le compte du lycée
reste nécessaire pour valider aussi l’échange de jeton et la lecture des données.

Référence : [limite des routes lors des redirections dans Playwright](https://playwright.dev/docs/api/class-page#page-route).

## Correction 4.26.2 — reprise de la session PRONOTE

Le lecteur de bootstrap reconnaît les objets JSON dans les scripts de tête et
les anciens attributs `onload`, y compris leurs entités HTML, virgules et
accolades dans les chaînes. Il analyse des littéraux bornés sans exécuter du
JavaScript et ne transmet au processus Python que les paramètres scalaires du
protocole. L’espace Élève (`a=3`) et la session sont vérifiés avant transfert.

Le navigateur reconnaît GET et POST sur `/pronote/`, `/pronote/eleve.html` et
`/pronote/mobile.eleve.html`. Une arrivée à la racine est normalisée vers l’espace
Élève pour le lecteur API ; les tickets de l’URL ne sont pas conservés. Les
redirections passent toujours par la politique de domaines. Le bootstrap est
intercepté avant que le navigateur consomme sa session de connexion.

La reconnexion conserve aussi les paramètres publics de sélection mobile
`fd`, `bydlg` et `login`, utilisés par la bibliothèque installée. Sans le sélecteur
mobile, le serveur de ce lycée redirige vers le CAS de l’ENT. La page publique
d’initialisation mobile de ce serveur a été vérifiée avec le sélecteur, et son
format est accepté par le parseur installé ; cela ne constitue pas un test
d’authentification sur un compte. Les anciens jetons reçoivent l’adresse corrigée
à leur prochaine lecture sans modifier leurs identifiants.

Le jeton mobile et les cookies **PRONOTE uniquement** sont conservés ensemble
sous le chiffrement existant. Certains serveurs exigent encore cette session
pour ouvrir une nouvelle page mobile. Le processus privé réinjecte ces cookies
uniquement vers la même origine PRONOTE, refuse les cookies d’un ENT ou d’une
autre instance, conserve les rotations et écarte les expirations. Les cookies
de session sans échéance fournie sont bornés à douze heures côté client ; la
validité reste décidée par le serveur. Une expiration ou redirection vers l’ENT
rend la reconnexion explicite et suspend les essais automatiques concernés.
Les cookies et mots de passe ENT ne sont pas persistés.

Le dialogue passe à **Étape 3 sur 3 · Importation depuis PRONOTE** dès la réception
de la connexion. Il masque alors le clavier et l’ancien écran, affiche l’import
puis demande de confirmer l’élève. Les interruptions normales d’une capture
pendant une navigation retournent 204. Une coupure de la requête d’image est
présentée en français, sans message JavaScript brut, et disparaît après reprise.
Les réponses arrivées après fermeture/changement de tentative sont ignorées.
Une erreur terminale reste affichée avec une action de retour. Si une page
PRONOTE n’a transmis aucun bootstrap après 90 secondes, l’attente se termine
avec une explication. Les pages Parent/Personnel ne lancent aucun import.

Le journal d’administration enregistre uniquement des codes d’étape, méthode
HTTP et nombre de cookies. Il ne reçoit aucun HTML, cookie, ticket ou identifiant
du bootstrap. Les erreurs du processus indiquent une phase prédéfinie, sans
exception brute. La fenêtre autorisée pendant ce diagnostic a confirmé un
espace Élève connecté et la présence des champs SSO ; aucune donnée de cours,
note, identité ou secret n’a été retournée par le diagnostic de forme.

Tests : défaut GET-seulement reproduit sur un POST à la racine, analyse sûre de
bootstraps, bornes et rôles, délais de transfert, capture annulée, reprise du
formulaire réel avec POST à la racine, étape d’import visible et récupération
d’une requête d’image interrompue. Le protocole est simulé dans les tests ;
la validation complète du transfert sur le lycée réel nécessite la reconnexion
avec cette version. Une page PRONOTE ouverte dans la fenêtre ne constitue pas,
à elle seule, une association réussie : la confirmation de l’élève doit apparaître.

## Correction 4.26.1 — formulaire PRONOTE et lien direct

Le formulaire PRONOTE utilise son véritable identifiant dans le gestionnaire de
soumission. Le bouton et la touche Entrée appellent POST `/api/pronote/ent/start`
sans naviguer vers l’accueil. `method="post"` évite aussi le retour à une URL
contenant les champs si le gestionnaire du formulaire venait à manquer.

L’ENT déjà connecté est choisi par défaut. L’utilisateur ouvre sa rubrique
PRONOTE dans la fenêtre ENT ; aucun QR ni code supplémentaire n’est requis par
le formulaire. Les options d’adresse et de sécurité sont regroupées et repliées.
Le code de sécurité reste facultatif, seulement pour un compte qui le demande.
Les champs de sécurité sont vidés après la tentative.

Un lien PRONOTE hébergé peut être collé dans les options si le compte possède un
ENT connu. L’origine et l’espace Élève sont vérifiés ; `/pronote/` devient
`/pronote/eleve.html`. Les anciens paramètres (tickets, `login=true`, fragment)
sont retirés avant d’ouvrir le lien, pour laisser le parcours SSO de l’ENT se faire.
Le navigateur reste limité à la famille ENT déjà identifiée et aux domaines
éducatifs/PRONOTE autorisés. Un lien direct seul sans ENT reconnu est refusé
avec une explication. Les liens d’un espace Parent ou Personnel restent exclus.

Les paramètres `portalURL` et `accountPin` des anciennes navigations natives
sont retirés de l’adresse affichée au démarrage. Passerelle revient sur la rubrique
PRONOTE sans soumettre ces anciens champs. Les autres paramètres utiles restent
intacts. Aucune modification des connexions ou abonnements n’est effectuée par
cette récupération d’écran.

Le défaut initial est reproduit en Chromium avec le script 4.26.0 : navigation
native vers l’accueil et absence d’appel API. Le nouveau test navigateur utilise
le formulaire réel, son API privée et une rubrique ENT synthétique jusqu’à la
confirmation. Il couvre bouton/Entrée, ENT automatique, lien PRONOTE copié,
erreur d’adresse dans le formulaire, nettoyage d’une ancienne URL sans envoi,
isolation des élèves et conservation de la source et du lien ICS. Le serveur ENT
et son authentification sont simulés : le SSO du lycée doit toujours être validé
par son utilisateur dans la fenêtre de connexion.

## Parcours

Dans **Plus → Réglages → Mon lycée → ENT et abonnement agenda**, la recherche
nationale trouve les établissements du catalogue Skolengo. Un filtre ENT facultatif
permet de préciser la recherche. Le nom du réseau accompagne chaque résultat.
Le serveur vérifie le couple code ENT / adresse OIDC, au début de la connexion.
Les 19 configurations sont dans `src/ent-providers.js` : Auvergne-Rhône-Alpes,
Mon Bureau Numérique, Occitanie, Éclat-BFC, les réseaux départementaux, Skolengo,
AEFE et Ostbelgien. La recherche renvoie au maximum 100 résultats avant filtrage ;
préciser le nom ou la ville si nécessaire.

Le volet **Mon établissement utilise un autre ENT** accepte l’adresse HTTPS
habituelle des familles proposées : Monlycée.net (également ent.iledefrance.fr),
Lycée Connecté, Atrium, Hauts-de-France, L’Éduc de Normandie, Toutatice,
NET O’Centre, e-lyco et Wilapa. Il ouvre un navigateur privé temporaire dans
la même fenêtre de connexion que Skolengo. L’utilisateur se connecte puis ouvre
PRONOTE depuis les services de son ENT. Les noms listés désignent les familles
admises par la politique réseau : ils ne constituent pas une certification de
chaque établissement ou de chaque chaîne de connexion.

Dans **Réglages → Mon lycée → Pronote**, le même parcours complète un ENT
Skolengo déjà connecté. Sans ENT existant, ou pour une connexion ENT→PRONOTE,
PRONOTE peut devenir la source principale des cours et devoirs. La vérification
du nom, de la classe et de l’établissement est obligatoire avant l’association.
Un changement d’élève/d’établissement désactive l’ancien lien ICS et vide ses
caches scolaires ; une reconnexion du même profil conserve son lien.

Le formulaire, le décodage et la route de connexion QR ont été retirés. L’ancienne
route POST `/api/pronote/connect` répond 410 avec une invitation à passer par
l’ENT. Les anciens jetons déjà connectés continuent de se renouveler.

## PRONOTE et services réellement fournis

Le navigateur intercepte le bootstrap HTML SSO d’un espace Élève PRONOTE
hébergé sur `*.index-education.net`, avant son exécution. Il transmet en mémoire
le HTML et les cookies PRONOTE au processus Python par stdin. Le processus
réutilise une seule fois ce bootstrap, demande un jeton mobile avec le protocole
ENT PRONOTE, sauvegarde chaque rotation avant la requête suivante, puis vérifie
une reconnexion avec ce jeton avant de renvoyer les données. Aucun QR n’est créé,
lu ou demandé à l’utilisateur. Le nom interne `qr_code` dans pronotepy active
la demande de jeton mobile lors du protocole initial ; ce n’est pas un parcours QR.

HTML, cookies ENT et mot de passe ENT ne sont jamais persistés. Les
identifiants du jeton mobile et les seuls cookies PRONOTE sont stockés sous le
chiffrement existant, avec leurs échéances (voir 4.26.2).
L’adresse persistée ne conserve pas le ticket SSO : elle devient
`/pronote/mobile.eleve.html?fd=1&bydlg=…&login=true`. Un code de sécurité PRONOTE facultatif,
si activé sur le compte, est transmis uniquement au processus de connexion.

La source principale PRONOTE adapte les snapshots normalisés au lecteur existant
(cours, devoirs, agenda ICS, annulations, notifications). Les références de séances
peuvent changer à la reconnexion : le rapprochement conserve les identifiants
sur une correspondance unique de matière/horaire, référence ou matière/jour.
Les rapprochements ambigus ne sont pas fusionnés. Les devoirs utilisent les
identifiants stabilisés existants et conservent leur état terminé, y compris
lorsqu’ils ont été terminés avant la création de l’ICS. Une source principale
PRONOTE conserve une seule provenance PRONOTE et ne double pas les changements
de devoirs avec ceux de son adaptateur d’agenda.

Notes, bulletins et absences sont proposés si PRONOTE les transmet. Mails,
actualités et détails de séances ENT ne sont pas fournis par ce parcours et ne
sont pas annoncés disponibles. Les connecteurs Skolengo conservent leurs
capacités habituelles, selon les droits du compte et de l’établissement.

## Réseau, isolation et limites

Les entrées ENT viennent d’une liste de domaines institutionnels. HTTP, ports
personnalisés, identifiants dans une URL, domaines arbitraires, adresses locales
et domaines ressemblants sont refusés. Chaque requête du navigateur est filtrée
sur la famille choisie, les hôtes académiques, les services d’authentification
éducatifs et PRONOTE. Les redirections de la capture ne sont jamais suivies
par `route.fetch` : la navigation suivante repasse par la politique de domaines.
Le processus Python reste limité à l’origine PRONOTE et à `/pronote/`, sans
redirection HTTP, avec délais et taille de réponse bornés.

Le pool partagé garde deux connexions et une seule ouverture simultanée, avec
expiration après 12 minutes. Les captures suivent la session de navigateur,
le compte et le profil. Déconnexion, expiration ou changement de session annulent
l’association ; le candidat expire après dix minutes. Cookies/HTML ne sont pas
renvoyés au client, aux logs ni à l’API partenaire.

La couverture n’est **pas universelle**. Un ENT absent du catalogue, un domaine
SSO externe non admis, une protection anti-automatisation, un serveur PRONOTE
hébergé par le lycée ou un espace Parent/Personnel nécessite un connecteur ou
une adaptation supplémentaire. Le parcours ENT→PRONOTE vise l’espace Élève.
Il ne contourne ni MFA, ni CAPTCHA, ni restriction du fournisseur. Une erreur
conserve les dernières données ; une rubrique manquante n’efface pas le dernier
agenda déjà publié.

Lapsus utilise désormais la recherche nationale Skolengo et les étiquettes ENT.
Le parcours technique Lapsus géré reste Skolengo : l’ouverture générique
ENT→PRONOTE n’y est pas annoncée. Aucun code Cloudflare n’est déployé chez le
propriétaire de Lapsus et aucune clé partenaire n’est changée.

## Vérification

Les tests de contrat exercent les couples OIDC, les domaines/redirections, le
retrait QR, l’association et l’isolation des élèves, l’ENT→PRONOTE comme source
principale, les jetons chiffrés, l’agenda ICS, les annulations sans doublons, les
références renouvelées et la conservation des données après panne. Un test Python
hors réseau vérifie la consommation du bootstrap, l’export du jeton et la
reconnexion ; le client protocolaire PRONOTE y est synthétique.

Le parcours Chromium vérifie la recherche et le filtre, le portail inconnu,
la connexion simulée jusqu’à l’ICS, l’affichage des notes, les services masqués,
l’isolation et la déconnexion, quatre largeurs, le thème sombre et le mouvement
réduit. Aucune connexion ENT réelle, aucun mail ni compte de test en production.
La compatibilité réelle d’une chaîne SSO se confirme avec un utilisateur de cet ENT.

## Sources techniques

- Catalogue et client utilisés : https://github.com/maelgangloff/scolengo-api
- Protocole/implémentation ENT et jetons : https://github.com/bain3/pronotepy/blob/master/pronotepy/clients.py
- Intégration ENT PRONOTE : https://doc.index-education.com/fr/pronote/pronote/PRONOTE/E/ENT.htm
- Portails : https://monlycee.net/ ; https://jeunes.nouvelle-aquitaine.fr/formation/au-lycee/lycee-connecte ; https://www.l-educdenormandie.fr/ ; https://www.toutatice.fr/portail/ ; https://ent.netocentre.fr/cerbere2/ ; https://enthdf.fr/auth/saml/wayf
