# Connecteur ENT géré pour Lapsus

Version 4.20.0. Passerelle reste un portail indépendant : comptes, fonctions personnelles, abonnements ICS et partage OAuth existant restent disponibles. Le nouveau connecteur utilise des profils techniques séparés dans `managedENTConnections`, sans mot de passe ni session de compte Passerelle. Un profil technique n’apparaît pas dans la liste des comptes du portail.

## Activation

Le connecteur est désactivé et sans clé par défaut. Dans **Plus → Réglages → Mon compte → Applications connectées → Configurer Lapsus · Administration**, le bloc **Connexion ENT directement depuis Lapsus** permet de créer une clé serveur, la copier une seule fois, activer le connecteur ou le désactiver. La clé n’est conservée que sous forme de hash par Passerelle ; la perdre demande une rotation.

Le projet Lapsus préparé contient la fonction Cloudflare, son interface et un guide `docs/PASSERELLE_ENT.md`. Son propriétaire configure trois variables Cloudflare : `PASSERELLE_MANAGED_KEY` dans les secrets, `LAPSUS_SUPABASE_URL` et `LAPSUS_SUPABASE_PUBLISHABLE_KEY` pour le même projet que Lapsus. Aucune modification de table Supabase ni clé de service administrateur n’est nécessaire. Le code fourni doit être déployé dans le projet Lapsus ; la présence du backend Passerelle ne déploie pas ce site distant.

## Parcours

L’utilisateur connecté à Lapsus choisit **Connecter mon ENT**. Cloudflare vérifie sa session auprès de Supabase Auth, puis demande une session technique à Passerelle avec une clé serveur. Le parcours Passerelle demande seulement le lycée, la connexion ENT et, si nécessaire, le choix d’un élève. Il explique que les cours, devoirs, contrôles, mails et actualités demandés seront utilisés dans Lapsus ; il ne demande pas d’inscription Passerelle ni de seconde confirmation OAuth Passerelle. L’ENT peut imposer sa propre authentification.

La demande dure douze minutes et est liée au partenaire, au compte Lapsus et au navigateur par des cookies HttpOnly. Le retour utilise l’URL exacte `https://mon-ent.pages.dev/passerelle/ent/callback`, un état et un code PKCE utilisable une seule fois pendant deux minutes. Cloudflare garde état, vérificateur et compte dans un cookie chiffré. Un retour dans un autre compte est refusé. Les tokens ENT restent chiffrés sur la VM et ne passent jamais par Cloudflare ni par Lapsus.

L’API serveur exige la clé partenaire et le sujet vérifié dans `X-Lapsus-User`. Elle impose l’appartenance de chaque connexion et les permissions `courses`, `homework`, `exams`, `messages`, `news`. Les routes de données sont indisponibles avant l’échange final du code. Le navigateur Lapsus ne peut pas choisir librement un sujet : sa fonction Cloudflare construit ce champ à partir du résultat de Supabase Auth. Les clés ne doivent pas être envoyées dans une URL ou des logs.

## Données et fraîcheur

Le parcours de connexion destiné à Lapsus conserve les couleurs et Manrope de Passerelle, avec les cartes, les boutons et quatre icônes issues de Lapsus. Le logo Lapsus identifie l’application destinataire. Les styles du connecteur restent isolés du portail. La signature est « Powered by PSRL ». Le portail ENT interactif garde sa propre présentation. L’aperçu public `/integrations/lapsus-managed/preview.html` ne fait aucun appel API ou ENT et ne demande pas d’identifiants.

Les routes REST de statut, agenda et travail à faire lisent les derniers instantanés normalisés. Une lecture ne déclenche pas de scan ENT. Les métadonnées indiquent la dernière récupération, la dernière vérification annuelle, la plage relue, les erreurs et la prochaine vérification prévue. `sourceVersion` est opaque et permet à Lapsus d’effacer son cache après un changement d’élève ou une reconnexion sur un autre appareil.

La suppression d’une connexion retire ses données techniques et bloque ses lectures ; la révocation auprès de l’ENT est tentée dans le verrou source. `DELETE /api/managed-ent/connection` retire les profils du sujet authentifié sans exiger un identifiant conservé sur l’appareil. Lapsus l’appelle avant la suppression du compte ; un échec de nettoyage interrompt la suppression. La désactivation bloque les lectures et les nouvelles connexions, mais les deux routes DELETE restent accessibles avec une clé valide et le sujet vérifié pour permettre ce nettoyage. La clé renouvelée invalide immédiatement l’ancienne clé et les parcours inachevés. Aucun de ces gestes ne modifie les comptes et calendriers personnels du portail Passerelle.

## Nouvelle cadence

Les vérifications rapprochées portent sur une fenêtre allant de deux jours avant aujourd’hui à quatorze jours après, bornée par l’année scolaire. Les cours et devoirs hors de cette plage sont conservés. Le balayage de toute l’année reste quotidien, avec un décalage par connexion pour répartir les appels.

La cible est de deux minutes pendant l’utilisation récente, cinq minutes en journée au repos, trente minutes la nuit, à l’heure de Paris. Un réveil du worker vérifie régulièrement les échéances ; les opérations sont mises en file et ces délais restent dépendants de la disponibilité de l’ENT et de la charge. Le portail et le connecteur ont chacun une file de synchronisation : au plus deux synchronisations simultanées avec les deux services. Les connexions interactives partagent un seul navigateur et deux contextes maximum, libérés après succès ou échec pour le connecteur.

Une erreur temporaire allonge progressivement le délai, jusqu’à une heure ; les indications `Retry-After` sont prises en compte dans cette limite. Une erreur d’authentification demande une reconnexion. Les opérations d’une même source sont sérialisées pour éviter une double rotation de refresh token. Un token proche de son expiration est renouvelé avant l’opération ; la durée des tokens est décidée par l’ENT et n’est pas allongée par le timer de la VM.

Le connecteur existant est limité aux établissements compatibles de l’ENT Auvergne-Rhône-Alpes. La prise en charge de tous les ENT et le fonctionnement à grande échelle ne sont pas annoncés par cette livraison.

## Vérifier le contrat entre les projets

```sh
node scripts/verify-lapsus-contract.mjs /chemin/vers/mon-ent
```

Ce script démarre temporairement la véritable API Passerelle, appelle la véritable fonction Cloudflare locale et remplace seulement Supabase Auth et l’ENT par des sources synthétiques. Il vérifie le parcours PKCE, les données normalisées, l’isolation des comptes et la préservation des comptes/sessions du portail. Il ne lit pas les données de production et ne contacte pas les services réels.

## Mails et actualités de l’ENT

Deux permissions explicites, `messages` et `news`, sont proposées par la nouvelle connexion Lapsus. Une connexion existante conserve ses permissions : il faut la reconnecter pour les ajouter. La page hébergée indique les données demandées sans nouvelle inscription Passerelle. Les boîtes personnelles Gmail/Outlook du portail ne sont pas exportées.

Les routes `GET /api/managed-ent/connections/:id/school/messages` et `/school/news` retournent les listes normalisées. `offset` avance par vingt éléments ; les messages acceptent aussi un `folder` fourni par leur propre liste. `refresh=1` relit explicitement la rubrique. Les lectures normales réutilisent un cache privé de cinq minutes ; contrairement aux instantanés agenda/devoirs, ces rubriques sont chargées à la demande et ne sont pas balayées par le worker de l’emploi du temps.

`GET /detail/:ref` ouvre une conversation ou une actualité de cette connexion. `GET /files/:ref` sert uniquement une pièce jointe qui a été référencée par un contenu autorisé, avec une limite de 15 Mo. Les références sont opaques, limitées au compte technique, à sa version de source, à la permission d’origine et à trente minutes. Elles doivent être renouvelées depuis la liste après expiration ou redémarrage. Les URLs privées et tokens source ne quittent pas Passerelle ; les téléchargements sont servis sans cache et en pièce jointe. Les accès disparaissent lors d’un changement d’élève ou d’une suppression.

Une rubrique non fournie est signalée par `available:false`. Une panne temporaire reste une erreur et conserve la dernière copie côté Lapsus. Les détails sont du texte normalisé, sans HTML actif ni images de suivi. Lapsus affiche ses listes existantes, un contenu intégral à l’ouverture, les documents et la pagination. Ces contenus restent en mémoire côté client et sont purgés au changement de profil ou à la déconnexion ; aucune nouvelle table Supabase n’est créée.


## Correctif Cloudflare du 7 novembre 2026

La fonction Cloudflare préparée utilisait `redirect: 'error'`, refusé par le moteur `workerd` avant tout appel réseau. Elle utilise désormais `manual` et refuse explicitement les 3xx. Cette incompatibilité a été reproduite avec le véritable moteur Cloudflare ; les 15 tests Node et l’essai natif avec services synthétiques passent. Les erreurs serveur distinguent Auth de la liaison Passerelle et produisent une référence avec un journal limité aux champs techniques fixes, sans secret.

Le kit complet et son patch sont corrigés. Pour une intégration déjà installée, le [correctif minimal](../public/integrations/lapsus-managed/lapsus-cloudflare-fix.zip) remplace la seule fonction de connexion ; voir [les étapes et vérifications](../public/integrations/lapsus-managed/CLOUDFLARE_FIX.md). La publication de ces fichiers sur la VM ne redéploie pas le compte Cloudflare du propriétaire de Lapsus. Le dépôt public consulté le 7 novembre n’a plus cette fonction dans `main` et l’accès GitHub disponible est en lecture : le correctif doit être intégré au projet qui déploie réellement le connecteur.
