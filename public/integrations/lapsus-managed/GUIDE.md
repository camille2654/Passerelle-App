# Connexion ENT via Passerelle

Cette branche ajoute un connecteur ENT à Lapsus. Passerelle conserve son application, ses comptes et ses abonnements existants. Les connexions techniques de Lapsus sont stockées séparément côté Passerelle ; aucun compte Passerelle n’est demandé à l’utilisateur Lapsus.

## Correctif Cloudflare du 7 novembre 2026

La fonction fournie corrige une incompatibilité du moteur Cloudflare : les appels utilisent le mode `manual` et refusent les redirections au lieu d’utiliser l’option non prise en charge `error`. Les erreurs serveur distinguent Auth de Passerelle et produisent une référence avec un journal sans secrets. Pour une intégration déjà installée, voir [le correctif minimal et sa validation sous workerd](CLOUDFLARE_FIX.md).

## Installation

Le patch est préparé sur le commit Lapsus `25cda54685debbbd9aac5fa3329be94cb94c0949`. Si le dépôt a évolué, intégrer les modifications dans sa version actuelle plutôt que remplacer les fichiers sans fusion.

1. Fusionner les fichiers préparés dans le dépôt Lapsus : dossier `functions/`, module `passerelle-ent.js`, modifications `app.js`, `index.html`, styles et règles de routage. Les imports ICS manuels restent disponibles.
2. Dans l’administration Passerelle, ouvrir **Plus → Réglages → Applications connectées → Configurer Lapsus → Connexion ENT depuis Lapsus**. Créer une clé serveur, la copier puis activer le connecteur. La clé n’est affichée qu’une fois. En cas de perte, la renouveler et mettre à jour Cloudflare.
3. Configurer ces variables pour le projet Cloudflare Pages Lapsus :

   | Variable | Valeur |
   | --- | --- |
   | `PASSERELLE_MANAGED_KEY` | **Secret** : clé générée dans Passerelle |
   | `LAPSUS_SUPABASE_URL` | URL du même projet Supabase que Lapsus |
   | `LAPSUS_SUPABASE_PUBLISHABLE_KEY` | Clé publique publishable du même projet, ou clé legacy `anon` existante |

   La clé Supabase doit être publique : ne pas utiliser une clé `service_role` ou `sb_secret_`. La fonction n’a besoin d’aucun accès administrateur à la base de données et ne crée aucune table. L’URL et la clé publique du projet actuel sont déjà utilisées dans `CONFIG` du code Lapsus.
4. Déployer le projet avec prise en charge des **Cloudflare Pages Functions**. Le dossier `functions/api/passerelle/` doit être compilé et déployé côté serveur ; copier seulement les fichiers statiques ne suffit pas. Le routage `_routes.json` limite les fonctions à `/api/passerelle/*` ; `_redirects` sert la callback depuis l’application existante.
5. Se connecter à un compte Lapsus de test, ouvrir **Réglages → Connexion → ENT**, puis **Connecter mon ENT**. Choisir le lycée compatible, se connecter à l’ENT et choisir l’élève si nécessaire. Passerelle revient à Lapsus après synchronisation. Il n’y a ni inscription Passerelle ni seconde page « Autoriser Passerelle ».

Le connecteur actuel concerne les établissements compatibles de l’ENT Auvergne-Rhône-Alpes. Les autres ENT ne sont pas annoncés comme pris en charge. L’ENT peut imposer sa propre authentification ou une reconnexion ; la VM ne peut pas en prolonger arbitrairement la durée.

## Identité visuelle

Le parcours hébergé conserve les couleurs et la police Manrope de Passerelle, avec les cartes, boutons et icônes de lycée, connexion, agenda et validation inspirés de Lapsus. Le logo Lapsus identifie l’application destinataire ; la signature du fournisseur reste **Powered by PSRL**, avec un lien vers Passerelle. Les informations à synchroniser restent indiquées. Le portail ENT affiché pendant l’authentification conserve son identité propre.

La carte ENT dans les réglages Lapsus reprend la même signature discrète. L’application Passerelle garde sa propre identité. L’[aperçu public du connecteur](https://repere.84.235.226.127.sslip.io/agenda/integrations/lapsus-managed/preview.html) est purement visuel : il ne contacte aucun ENT, ne récupère aucune donnée et ne remplace pas le déploiement de Lapsus.

## Fonctionnement

Le navigateur Lapsus transmet son access token Supabase à sa propre fonction Cloudflare. Cette fonction demande le compte courant à Supabase Auth (`GET /auth/v1/user`) et utilise exclusivement l’identifiant validé par ce serveur. Un identifiant ou une permission fournie dans `user_metadata` ne sert jamais à autoriser des données.

Cloudflare appelle ensuite l’API Passerelle avec sa clé secrète et l’identifiant du compte vérifié. La demande de connexion est protégée par PKCE. État, vérificateur et compte sont conservés pendant douze minutes dans un cookie chiffré, HttpOnly, Secure et SameSite=Lax. Le retour est exactement `https://mon-ent.pages.dev/passerelle/ent/callback` ; issuer, état, compte et échéance sont vérifiés avant l’échange d’un code utilisable une seule fois.

Lapsus reçoit les cours, devoirs, contrôles, mails et actualités autorisés sous forme JSON normalisée. Les tokens ENT restent chiffrés sur la VM et ne sont transmis ni au navigateur Lapsus ni à Cloudflare. Les lectures REST utilisent le dernier instantané : elles ne lancent pas de requête ENT à chaque affichage.

Une origine de preview ou localhost ne peut pas utiliser le parcours de production tel quel : la callback et les origines sont enregistrées exactement. Les tests locaux utilisent des services simulés.

## API utilisée par le navigateur

Toutes les routes demandent `Authorization: Bearer <access-token-Supabase>` et n’autorisent que l’origine Lapsus. Les mutations utilisent aussi l’origine de la page ; aucun cookie seul ne suffit à consulter un compte.

| Route relative | Méthode | Usage |
| --- | --- | --- |
| `/api/passerelle/connect` | POST `{scopes}` | Créer le parcours ENT et recevoir `launchURL` |
| `/api/passerelle/exchange` | POST `{code,state,iss}` | Terminer la connexion sur le même compte Lapsus |
| `/api/passerelle/connection` | GET | Retrouver la connexion du compte sur cet appareil |
| `/api/passerelle/connection` | DELETE | Retirer les connexions techniques du compte avant sa suppression, même sans cache local |
| `/api/passerelle/connections/:id/status` | GET | État, fraîcheur et prochaine vérification |
| `/api/passerelle/connections/:id/agenda?from=...&to=...` | GET | Cours actifs sur une plage de 93 jours maximum |
| `/api/passerelle/connections/:id/homework?from=...&to=...` | GET | Devoirs et contrôles de la plage |
| `/api/passerelle/connections/:id/school/messages?offset=0` | GET | Liste des mails ENT ; pagination par vingt, dossier facultatif |
| `/api/passerelle/connections/:id/school/news?offset=0` | GET | Actualités du lycée et pagination |
| `/api/passerelle/connections/:id/detail/:ref` | GET | Texte intégral d’un mail ou d’une actualité référencée |
| `/api/passerelle/connections/:id/files/:ref` | GET | Pièce jointe autorisée, jusqu’à 15 Mo |
| `/api/passerelle/connections/:id/activity` | POST `{}` | Signaler une utilisation pour adapter la cadence |
| `/api/passerelle/connections/:id/sync` | POST `{}` | Demander une vérification, bornée et respectant le recul après erreur |
| `/api/passerelle/connections/:id` | DELETE | Retirer cette connexion technique et ses données source |

Permissions possibles : `courses`, `homework`, `exams`, `messages`, `news`. Une connexion déjà créée conserve ses droits : la reconnecter pour ajouter les mails et actualités. Lapsus réutilise ses propres cartes et états de devoirs ; les identifiants des éléments restent stables lorsqu’une date change. Les instantanés d’une plage remplacent uniquement cette plage. Un cours annulé ou supprimé disparaît de la source REST plutôt que créer un événement supplémentaire barré. Les options manuelles ICS et les autres données Lapsus sont conservées.

La clé serveur donne accès aux connexions gérées pour ce partenaire : elle doit rester dans les secrets Cloudflare, jamais dans `app.js`, le stockage navigateur ou un dépôt Git. La fonction construit l’identifiant externe à partir de Supabase Auth et ignore les en-têtes d’identité envoyés par le navigateur.

La suppression d’un compte Lapsus retire d’abord sa connexion ENT avant d’appeler `delete_my_account`. Ce nettoyage reste possible lorsque le connecteur est désactivé dans Passerelle, avec la clé serveur valide. Une panne ou une erreur de suppression empêche d’afficher une réussite. Seul un connecteur sans clé configurée, sans connexion connue sur l’appareil, permet de continuer sans appel Passerelle ; après une mise en service, conserver la clé Cloudflare tant que des profils techniques existent. Une suppression effectuée directement depuis l’administration Supabase doit aussi retirer la connexion technique côté Passerelle avant de supprimer l’identité : le parcours fourni couvre le bouton de suppression de Lapsus.

## Synchronisation et tokens

- Prochains jours : vérification environ toutes les deux minutes pendant l’utilisation, cinq minutes en journée au repos, trente minutes la nuit.
- Toute l’année scolaire : balayage quotidien, réparti entre les connexions. Une lecture récente ne signifie pas que toutes les dates éloignées ont été vérifiées au même instant ; les métadonnées distinguent la dernière lecture et le dernier balayage annuel.
- Les pannes et limitations de l’ENT allongent les délais ; une connexion expirée demande une reconnexion. Les dernières données valides sont conservées pendant une panne.
- Les renouvellements des tokens sont sérialisés et anticipés près de leur expiration ; leur durée est décidée par l’ENT. La clé Cloudflare et les tokens ENT sont des éléments distincts.

## Vérification après installation réelle

Les essais fournis utilisent uniquement des données synthétiques. Après configuration par le propriétaire, vérifier sur son compte de test : connexion ENT, retour dans le même compte Lapsus, lecture de l’agenda, devoirs/contrôles lorsqu’ils sont fournis, actualisation, déconnexion puis reconnexion, et absence de données d’un autre compte. Un test d’authentification réel n’est pas présumé effectué par la simple présence de ce code.

Références : [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/), [secrets et bindings](https://developers.cloudflare.com/pages/functions/bindings/), [vérification Supabase Auth](https://supabase.com/docs/reference/javascript/auth-getuser), [PKCE](https://www.rfc-editor.org/rfc/rfc7636.html).

## Extension mails et actualités · 4.20

La nouvelle connexion demande aussi `messages` et `news`, indiqués dans la carte ENT et dans le parcours hébergé. Les boîtes personnelles du portail Passerelle ne sont pas partagées. Les anciennes connexions ne reçoivent aucun droit supplémentaire sans reconnexion. Aucun changement de schéma ou de politique Supabase n’est nécessaire. La vérification Auth existante par la fonction Cloudflare reste obligatoire et inchangée.

Mon lycée, Mails et Actualités utilisent leurs vues Lapsus existantes. Les listes et leurs pages sont chargées via la fonction, le texte complet s’ouvre dans une fenêtre de lecture et les pièces jointes passent par la même authentification. Les contenus ENT de ces deux rubriques ne sont pas écrits dans les tables `school_mails`/`school_news` et ne sont pas persistés dans le cache navigateur ; ils restent en mémoire et sont effacés au changement de compte, de source ou à la déconnexion. Les données déjà présentes dans Lapsus restent séparées.

Une lecture de liste réutilise normalement le cache privé Passerelle pendant cinq minutes ; `refresh=1` demande une relecture de la rubrique. Cette partie fonctionne à la demande, indépendamment de la synchronisation automatique des cours. `available:false` signifie que la rubrique n’est pas fournie pour ce compte ; une erreur temporaire garde la dernière copie et affiche une explication. Les permissions sont imposées côté Passerelle, pas seulement masquées dans les écrans.

Les références de contenu et de document sont privées et temporaires, liées à la connexion et à sa version de source. Un code 410 demande de relire la liste et de rouvrir le contenu ; un redémarrage du serveur invalide ces références en mémoire. Les noms et métadonnées des fichiers sont affichés sans URL ENT privée. La limite de téléchargement est de 15 Mo. Aucune URL choisie par le navigateur ne peut être téléchargée par le connecteur.

Les tests du kit couvrent la fonction Cloudflare, les listes, le contenu intégral, les documents, les pages supplémentaires, l’isolation des comptes, le nettoyage du profil, le texte échappé et le parcours existant agenda/devoirs/contrôles. Le script de contrat Passerelle exerce les deux services réels localement en simulant uniquement Auth et l’ENT.

Le patch téléchargeable est vérifié sur la base Git `25cda54685debbbd9aac5fa3329be94cb94c0949`. Les fichiers modifiés doivent être intégrés au projet actuel avant déploiement ; le guide et le paquet contiennent la même source testée.
