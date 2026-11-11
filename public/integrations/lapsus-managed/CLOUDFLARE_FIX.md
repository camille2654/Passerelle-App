# Correctif du connecteur ENT Cloudflare · 7 novembre 2026

## Installation sur Lapsus

Pour une installation qui contient déjà le connecteur ENT, remplacer le fichier `functions/api/passerelle/[[path]].js` par celui de ce correctif, puis redéployer les **Cloudflare Pages Functions** du projet Lapsus. L’interface et les réglages d’authentification restent compatibles. Les trois variables existantes sont conservées ; aucune nouvelle clé, inscription ou modification Supabase n’est nécessaire pour ce correctif.

Le correctif et son patch ciblent la fonction du connecteur préparée en version 4.20. L’archive complète d’intégration reste basée sur le commit `25cda54685debbbd9aac5fa3329be94cb94c0949` : intégrer ses changements dans la version actuelle de Lapsus. Le dépôt public consulté le 7 novembre ne contient plus cette fonction dans `main` ; appliquer le correctif dans le projet qui déploie effectivement le connecteur.

## Cause reproduite et changement

La fonction utilisait `redirect: "error"` dans ses appels à Supabase Auth et à Passerelle. Le moteur Cloudflare `workerd` refuse cette option et lève une `TypeError` avant tout appel réseau. Le gestionnaire global renvoyait ensuite « Le service ENT est momentanément indisponible ». Les tests sous Node acceptaient cette option et n’exécutaient pas le moteur Cloudflare.

La fonction utilise désormais `redirect: "manual"` et refuse explicitement les réponses 3xx. Les clés et jetons restent envoyés uniquement aux deux services attendus ; aucune destination de redirection n’est suivie.

Les pannes de transport distinguent la vérification du compte Lapsus de la liaison Passerelle. Les erreurs serveur reçoivent une `reference`, également présente dans une entrée structurée des logs Cloudflare. Ces logs contiennent uniquement `event`, `reference`, `phase`, `code`, `status` ; aucun en-tête, jeton, identifiant de compte, contenu de message, URL privée ou erreur brute n’est journalisé.

Codes utiles : `LAPSUS_AUTH_UNAVAILABLE`, `LAPSUS_AUTH_REDIRECT`, `PASSERELLE_UNAVAILABLE`, `PASSERELLE_REDIRECT`, `ENT_CONNECTOR_FAILURE`. Les erreurs normales de session restent des 401. Un service qui n’a jamais été configuré conserve son code distinct `ENT_CONNECTOR_UNCONFIGURED`.

## Vérifications fournies

Les 15 tests Node du connecteur et du client passent. Le test natif sous `workerd@1.20261106.1` reproduit le refus de l’ancienne option et valide les appels corrigés, les 401, le refus des redirections, PKCE, le cookie chiffré, les erreurs réseau et les diagnostics sans secrets.

Les services Auth et Passerelle de ces essais sont synthétiques et confinés dans le moteur ; son accès Internet est refusé. Aucun compte réel, aucun ENT ni mail réel n’est utilisé.

```sh
node --test tests/cloudflare-passerelle.test.mjs
npm install --prefix /tmp/lapsus-workerd --save-exact --no-audit --no-fund workerd@1.20261106.1
WORKERD_BINARY=/tmp/lapsus-workerd/node_modules/.bin/workerd node tests/cloudflare-workerd.smoke.mjs
```

## Après le redéploiement par le propriétaire

Sans session, `/api/passerelle/connection` doit renvoyer 401. Une session expirée doit aussi être refusée, puis un utilisateur connecté doit pouvoir choisir « Connecter mon ENT ». Terminer ce parcours avec un compte de test du propriétaire pour vérifier l’accès réel à son lycée. Ce dernier essai nécessite son authentification et n’est pas présumé réalisé par la publication de l’archive.

Si une erreur 5xx subsiste, rapprocher la `reference` de la réponse de celle des logs Cloudflare. Vérifier la configuration du service indiqué par `phase` et `code`.

Référence : [API Request de Cloudflare](https://developers.cloudflare.com/workers/runtime-apis/request/).
