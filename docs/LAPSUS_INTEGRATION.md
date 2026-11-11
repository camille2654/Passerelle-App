# Connecter un agenda Passerelle dans Lapsus

Version 4.18.0 — connexion d’agendas en lecture seule. Cette intégration autorise un partage ; elle ne remplace pas la connexion au compte Lapsus et ne fournit pas d’identité OpenID Connect.

## Configuration enregistrée

| Élément | Valeur |
| --- | --- |
| Application | Lapsus |
| Origine autorisée | `https://mon-ent.pages.dev` |
| `client_id` | `lapsus` |
| Type de client | Public, sans secret |
| URL de retour exacte | `https://mon-ent.pages.dev/passerelle/callback` |
| Serveur / issuer | `https://repere.84.235.226.127.sslip.io/agenda` |
| Autorisation | `https://repere.84.235.226.127.sslip.io/agenda/oauth/authorize` |
| Échange du code | `https://repere.84.235.226.127.sslip.io/agenda/oauth/token` |
| Liste des liens autorisés | `https://repere.84.235.226.127.sslip.io/agenda/api/partner/calendars` |

Les endpoints sont configurés explicitement. Les métadonnées publiques sont consultables dans `/agenda/api/partner/configuration` ; aucune découverte automatique RFC8414 ou OpenID Connect n’est annoncée.

## À ajouter dans Lapsus

1. Copier `passerelle-connect.js` dans `/passerelle/` du site.
2. Ajouter un bouton « Connecter mon agenda Passerelle » qui appelle `connectPasserelle()` dans ce module. Le compte Lapsus doit déjà être connecté avant le départ.
3. Servir `callback.html` exactement à `/passerelle/callback` (configuration de routage Cloudflare Pages ou route de votre SPA ; fusionner la règle fournie dans `_redirects.example` avant votre éventuelle règle de repli) ; copier `callback.js` dans `/passerelle/`.
4. Implémenter `/passerelle/lapsus-adapter.js` à partir de `lapsus-adapter.example.js`. Sa fonction `getCurrentAccountKey()` retourne l’identifiant stable du compte Lapsus connecté. `savePasserelleCalendars(calendars, {expectedAccountKey})` vérifie encore cette identité au moment de la sauvegarde et doit conserver les liens dans le compte Lapsus actuellement connecté, avec un contrôle d’accès empêchant les autres comptes de les lire. L’exemple refuse volontairement de prétendre enregistrer des données.
5. Importer les événements ICS avec un parseur ICS, puis relire les abonnements environ toutes les 10 minutes lorsque le service en a besoin. Le module expose `readPasserelleCalendar(calendar, {etag})`. Un service serveur peut gérer le rafraîchissement lorsque l’application est fermée ; un navigateur fermé ne le garantit pas.

Exemple pour le bouton, dans un script module de Lapsus :

```js
import {connectPasserelle} from '/passerelle/passerelle-connect.js';
import {getCurrentAccountKey} from '/passerelle/lapsus-adapter.js';
document.querySelector('#connect-passerelle').addEventListener('click', async () => {
  try {
    const accountKey = await getCurrentAccountKey();
    await connectPasserelle(['calendar:courses', 'calendar:homework', 'calendar:exams'], {accountKey});
  } catch (error) {
    document.querySelector('#connection-error').textContent = error.message;
  }
});
```

L’utilisateur choisit ensuite les agendas qu’il autorise réellement dans Passerelle. Un agenda non demandé ne peut pas être ajouté lors du consentement. Le module ne conserve ni liens ICS ni jetons d’accès : l’adaptateur de Lapsus gère uniquement les liens autorisés.

## Données reçues

```json
{
  "calendars": [
    {
      "id": "courses",
      "name": "Emploi du temps",
      "scope": "calendar:courses",
      "url": "https://repere.84.235.226.127.sslip.io/agenda/partner-calendars/<jeton-prive>.ics",
      "refreshMinutes": 10
    }
  ]
}
```

Permissions : `calendar:courses`, `calendar:homework`, `calendar:exams`. Chaque lien est limité à son type. Les paramètres `?type=all`, `?type=homework`, `?subject=...` ne permettent pas d’élargir son accès et sont rejetés. Les cours contiennent les horaires, salles et descriptions ; les devoirs et contrôles peuvent contenir leurs consignes. Les mails, actualités, notes privées, positions GPS et identifiants ENT ne sont pas partagés.

Les liens sont privés : ne pas les afficher dans des logs, outils analytiques, pages publiques ou messages d’erreur. Ils ne prouvent pas l’identité du titulaire d’un compte Lapsus et ne doivent jamais servir à connecter quelqu’un à ce compte. Associer et vérifier côté Lapsus le compte qui a commencé le parcours avant de conserver les liens au retour ; demander une confirmation si la session Lapsus a changé pendant la connexion.

## Parcours technique

- Autorisation : `response_type=code`, `client_id=lapsus`, URL de retour exacte, `state` aléatoire, `scope`, `code_challenge` SHA256 en base64url, `code_challenge_method=S256`.
- Passerelle conserve la demande pendant 10 minutes et la lie à un cookie HttpOnly puis à sa session et son profil. Un utilisateur sans compte peut s’inscrire et préparer son agenda avant de revenir au consentement. Le contexte doit être relancé s’il expire.
- Le retour contient seulement `code`, `state`, `iss`. Un refus renvoie `error=access_denied`, `state`, `iss`. Le module vérifie état et issuer puis nettoie l’URL avant tout autre appel.
- Le code expire après 2 minutes et s’échange une seule fois avec `grant_type=authorization_code`, `client_id`, `redirect_uri`, `code`, `code_verifier`. JSON et formulaire URL-encodé sont acceptés. Les jetons ne passent jamais dans les paramètres d’une URL d’API.
- L’échange renvoie `access_token`, `token_type=Bearer`, `expires_in=3600`, `scope`. Le jeton sert à obtenir les liens via `Authorization: Bearer ...`. Il n’y a pas de refresh token dans cette version.
- Le jeton court peut être oublié après récupération des liens. Les abonnements ICS continuent à fonctionner jusqu’au retrait de l’autorisation ou à son invalidation. Pas besoin de reconnecter chaque heure pour relire un lien déjà reçu.
- Un rejeu valide du même code révoque les accès qui en étaient issus. En cas d’échange interrompu, relancer une nouvelle autorisation plutôt que rejouer le code.

Le JavaScript fourni utilise `sessionStorage` seulement pour `state`, le vérificateur PKCE, les permissions demandées, l’identifiant du compte Lapsus et l’heure de départ. Il navigue dans le même onglet. Ne pas copier ce vérificateur dans une URL ni dans des logs. Si l’API de stockage du navigateur est bloquée, la connexion doit échouer avec un message exploitable plutôt que désactiver PKCE.

## Abonnements et modifications

Passerelle conserve les UID des cours lorsqu’ils changent. Un flux est une photographie complète, sans événements `CANCELLED`. Lapsus doit remplacer les événements de cet abonnement par la nouvelle photographie, en conservant les autres agendas. Un événement absent de la nouvelle photographie doit être retiré. Une nouvelle connexion remplace l’ancienne autorisation Lapsus et ses liens : remplacer les sources de l’utilisateur plutôt que les accumuler.

Respecter `ETag` / `If-None-Match` : `304` signifie inchangé. `404` sur un flux signifie accès retiré ou contexte modifié : arrêter ses relances automatiques et proposer « Reconnecter Passerelle ». Une erreur réseau ou `5xx` signifie temporairement indisponible : garder la dernière copie et réessayer avec un délai croissant. Ne pas effacer un agenda en raison d’une erreur ou d’une réponse non ICS.

## Retrait et administration

Dans Passerelle : Plus → Réglages → Mon compte → Applications connectées → Retirer l’accès. Cela bloque les lectures futures pour Lapsus, sans modifier l’abonnement personnel à Apple/Google Calendar. Une révocation ne supprime pas à distance les événements déjà copiés dans Lapsus : proposer aussi une suppression locale de cet abonnement et de son cache.

Un changement d’élève, de connexion ENT, de lien maître, une suspension ou un archivage invalide les liens partenaires. Revenir ensuite à l’ancien profil ne les réactive pas. Une déconnexion de la session Passerelle annule les demandes inachevées mais ne retire pas une autorisation déjà accordée.

Les administrateurs disposent d’un réglage Lapsus dans le même écran. Désactiver le partenaire ou modifier sa callback invalide ses accès existants. Seule une callback HTTPS exacte sur `mon-ent.pages.dev`, sans identifiants, paramètres ni fragment, est acceptée. Aucune origine de preview ou `localhost` n’est autorisée en production.

## CORS et transport

Les endpoints d’échange et de lecture des agendas autorisent l’origine exacte Lapsus. Les requêtes utilisent `credentials: 'omit'`. Les cookies Passerelle restent réservés aux pages de consentement de Passerelle et ne permettent pas de lire l’API partenaire à eux seuls. Les autres APIs conservent leur protection d’origine.

Si Lapsus définit une CSP, ajouter l’origine Passerelle à `connect-src`. L’intégration ne modifie pas le code ni le déploiement de Lapsus : le développeur doit ajouter la callback, le bouton et son adaptateur de compte. L’existence de ces routes chez Lapsus n’est pas présumée.

Références : [OAuth 2.0](https://www.rfc-editor.org/rfc/rfc6749.html), [PKCE](https://www.rfc-editor.org/rfc/rfc7636.html), [pratiques de sécurité OAuth](https://www.rfc-editor.org/rfc/rfc9700.html).
