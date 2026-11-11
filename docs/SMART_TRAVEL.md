# Mon trajet · 4.17

L’accueil et **Plus → Réglages → Mon trajet** ouvrent un parcours en trois étapes : lycée, départ et trajet. Chaque compte utilise son propre établissement. Aucun réseau ni établissement unique n’est imposé aux autres utilisateurs.

## Le lycée et le départ

L’adresse postale vient de l’objet établissement déjà conservé dans la connexion ENT. À l’ouverture volontaire du trajet, elle est recherchée auprès du géocodeur IGN/BAN (`https://data.geopf.fr/geocodage/search`). Une correspondance suffisamment précise avec le bon code postal prépare la destination ; les cas incertains proposent des lieux à choisir. Une adresse absente ou une entrée de lycée différente peut être corrigée manuellement.

**Utiliser ma position** appelle une seule fois la géolocalisation du navigateur après le clic, avec un délai de douze secondes. Aucun suivi continu n’est lancé. Le refus, une panne ou l’absence de cette API laisse la recherche d’adresse disponible. Le départ temporaire reste dans la fenêtre ; il n’est pas automatiquement écrit dans le compte. Les propositions côté serveur expirent après dix minutes et sont purgées périodiquement.

**Mémoriser ce départ** conserve explicitement le lieu dans les préférences chiffrées du profil scolaire. **Effacer le départ mémorisé** l’en retire. Une fermeture, une déconnexion ou un changement de profil efface les brouillons et ignore les réponses tardives. Les journaux ne contiennent ni adresse ni coordonnées ni clé de fournisseur.

## Calcul et informations disponibles

Les liens documentés Plans et Google Maps ouvrent un trajet en transports en commun à partir des points choisis. Ils fonctionnent séparément de l’API intégrée ; Maps URLs ne nécessite pas de clé. Le lien ne retourne pas à Passerelle la durée affichée dans l’autre application et l’utilisateur y vérifie l’heure d’arrivée.

Le connecteur intégré utilise **Navitia**. L’aller est demandé pour arriver avant le premier cours actif, avec la marge choisie ; le retour part après le dernier cours actif et sa marge. Les coordonnées sont inversées pour le retour. L’agenda doit être récent et couvrir la date demandée. Les heures de départ déjà passées ne sont pas proposées comme réalisables.

Une demande de données temps réel n’est pas une preuve de disponibilité : la mention de temps réel dépend de `data_freshness` dans les sections de transport effectivement retournées. Des horaires théoriques restent présentés comme prévus. Les trajets annulés, les dates invalides, les incohérences temporelles et les fuseaux non gérés sont rejetés. Les requêtes sont bornées, avec deux recherches simultanées, trois propositions et une limite de réponse de 1 Mio.

**État initial en production :** aucun jeton de calcul d’itinéraire n’a été configuré par cette livraison. Le calcul détaillé intégré reste désactivé et l’interface l’explique. Les liens Plans/Google Maps, le géocodage, la durée renseignée et l’agenda sont utilisables séparément. Aucun compte fournisseur, abonnement ni facturation n’est ouvert par ce travail.

## Connexion par l’administration

Dans Mon trajet, **Configurer le calcul · Administration** permet de saisir un jeton Navitia, une couverture facultative et l’activation. Le jeton est chiffré et n’est jamais renvoyé ou prérempli. Le test appelle la liste des couvertures avec la clé du propriétaire ; il n’envoie aucune position d’utilisateur. Il permet de vérifier les zones et dates réellement accessibles. Une modification invalide les propositions en cours.

Obtenir auprès du fournisseur ou de l’autorité organisatrice un accès adapté à l’usage prévu, puis vérifier de vrais trajets dans chaque zone cible. La documentation actuelle ne permet pas d’affirmer une offre gratuite commerciale universelle. La présence de GTFS/GTFS-RT pour TCL, STAS ou un autre réseau ne suffit pas à fournir un calcul d’itinéraire hébergé. Aucune couverture TCL/STAS ou nationale n’est annoncée comme validée sans un accès et un trajet réels.

L’API publique Transitous n’est pas utilisée : sa politique actuelle exclut l’usage commercial, auquel Passerelle se prépare. Le système est prêt pour une connexion autorisée plutôt qu’un jeton de démonstration proposant des données fictives.

## Réserver le transport dans l’agenda

Un calcul prépare un aperçu ; il ne crée aucun événement. L’utilisateur confirme une proposition, ou utilise **Prévoir mon temps de trajet** avec une durée qu’il connaît. Ce dernier cas reste indiqué comme durée renseignée, sans revendication de temps réel.

La confirmation réserve un bloc avant le premier cours ou après le dernier dans la semaine de Passerelle. L’option **Ajouter aussi à mon abonnement agenda** est volontaire et décochée au départ. Le même jour et le même sens conservent un identifiant stable lors d’une modification ; les reprises ne dupliquent pas le trajet. Le retrait enlève le bloc et son export.

Les détails retenus sont chiffrés. Les coordonnées précises et les libellés d’adresse aux extrémités des étapes ne sont pas conservés lors de la confirmation d’une position ponctuelle, même dans le détail chiffré. Le flux ICS ne contient qu’un titre générique, les horaires et un mode de trajet ; aucune adresse ou position. Les créneaux de révision privés tiennent compte du temps réservé. Le partage de disponibilités entre amis conserve sa limite aux données scolaires.

Un changement du premier ou du dernier cours rend le bloc **à revoir** et le retire des exports reconstruits jusqu’à confirmation. La confirmation d’une ancienne proposition est refusée. Une reconnexion ENT reconstruisant un lien conservé retire les trajets de l’ancien contexte. Le délai de rafraîchissement du calendrier externe dépend de son lecteur.

## Sources et vérifications

- [Géocodage officiel IGN](https://ignf.github.io/cartes.gouv.fr-documentation/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/).
- [Documentation Navitia : authentification, couvertures, trajets et fraîcheur](https://doc.navitia.io/).
- [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).
- [Maps URLs Apple](https://developer.apple.com/documentation/mapkit/unified-map-urls).
- [Politique d’utilisation Transitous](https://transitous.org/api/).

Tests : `tests/smart-travel.test.js`, `tests/travel-calendar.test.js`, `tests/smart-travel-browser.smoke.mjs`. Les comptes, jetons, positions et réponses de transport sont fictifs et isolés. Le géocodeur a aussi été vérifié avec une adresse publique de l’IGN, sans compte utilisateur réel. Aucun test de trajet Navitia réel n’est possible sans l’accès correspondant.
