# Présenter une nouveauté majeure

L’annonce se configure dans `src/releases.js`, dans `CURRENT_RELEASE`. Elle possède un identifiant stable, une version lisible, un titre, un sous-titre, une bannière publique et une liste de points forts. Les textes décrivent uniquement des fonctions effectivement disponibles. Les icônes doivent exister dans `public/brand/icons-v2/manifest.json`.

Pour publier une annonce majeure, choisir un **nouvel identifiant** et modifier le contenu, puis vérifier le parcours et déployer. Une correction mineure conserve l’identifiant : elle ne déclenche pas une nouvelle présentation. Une annonce n’est ni un mail ni une notification push.

À l’ouverture de l’espace connecté, le panneau monte depuis le bas. Le guide de démarrage, une fenêtre déjà ouverte et une saisie en cours ont priorité. Le panneau reste disponible dans **Plus → Nouveautés de Passerelle**, même après fermeture.

Le compte est marqué comme ayant vu cette annonce seulement après une fermeture explicite : bouton, croix, Échap, arrière-plan ou geste vers le bas depuis la poignée. La fermeture est enregistrée sur le serveur et vaut pour ses autres appareils. Une consultation du statut ne modifie pas ce choix. En cas d’échec réseau, le panneau est fermé pour la visite et peut réapparaître à la prochaine ; une information explique que la fermeture n’a pas été enregistrée.

L’API `POST /api/releases/seen` reçoit seulement `{ "releaseId": "identifiant-courant" }`. Elle exige la session et l’origine du site, ne peut modifier que le compte connecté et refuse un identifiant futur ou inconnu. Le premier acquittement est conservé lors des demandes répétées. Aucune migration ne marque tous les utilisateurs comme ayant vu l’annonce.

La bannière applicative légère se trouve dans `public/brand/campaign/banner-app.webp`. L’illustration source, les compositions et les exports sociaux sont dans le même dossier. Les anciens logos et icônes d’installation restent conservés.

Vérifications : `node --test tests/releases.test.js`, `node tests/releases-browser.smoke.mjs`, puis `npm run check`. Les tests navigateur utilisent exclusivement des comptes et des transports temporaires, sans mail ni accès ENT réel.
