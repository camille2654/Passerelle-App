# Gmail et Outlook : configuration du propriétaire de Passerelle

La configuration OAuth se fait une fois pour Passerelle. Ensuite, chaque utilisateur autorise sa propre boîte et choisit les messages à analyser. Elle est indépendante du **serveur SMTP qui envoie les briefs** : une adresse d’expédition ou un mot de passe d’application SMTP ne remplace pas un client OAuth.

Saisir les identifiants d’application uniquement dans les réglages administrateur des boîtes personnelles. **Ne jamais transmettre de secret dans le chat**, une capture ou un journal. Les utilisateurs se connectent sur les pages Google ou Microsoft ; Passerelle ne leur demande pas leur mot de passe mail.

## 1. Adresses de retour à enregistrer

Pour le déploiement actuel, copier exactement l’adresse correspondant au fournisseur, sans ajouter de barre finale ni de paramètre :

Gmail :

```text
https://repere.84.235.226.127.sslip.io/agenda/api/personal-mail/oauth/gmail/callback
```

Outlook :

```text
https://repere.84.235.226.127.sslip.io/agenda/api/personal-mail/oauth/outlook/callback
```

Si l’application change de domaine, mettre à jour son URL publique configurée et ces adresses dans les deux consoles. Le retour demandé par l’application doit correspondre à l’adresse autorisée. [Google : client Web](https://developers.google.com/workspace/guides/create-credentials), [Microsoft : adresses de retour](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).

## 2. Google Cloud : Gmail

1. Dans [Google Cloud Console](https://console.cloud.google.com/), sélectionner ou créer un projet dédié à Passerelle. Dans **API et services → Bibliothèque**, activer **Gmail API**. [Activation de l’API](https://developers.google.com/workspace/gmail/api/quickstart/nodejs).
2. Ouvrir **Google Auth platform → Branding**. Renseigner le nom Passerelle, le contact d’assistance et les coordonnées du développeur. Dans **Audience**, choisir **External** pour accepter des utilisateurs de plusieurs établissements. Pendant le pilote, garder **Testing** et ajouter les adresses autorisées dans **Test users**. [Consentement et utilisateurs de test](https://developers.google.com/workspace/guides/configure-oauth-consent).
3. Dans **Data Access**, ajouter uniquement le scope Gmail nécessaire : `https://www.googleapis.com/auth/gmail.readonly`. Il permet de lire le contenu ; `gmail.metadata` ne donne pas accès au corps. Aucun droit d’envoi ou de modification n’est nécessaire. [Scopes Gmail](https://developers.google.com/workspace/gmail/api/auth/scopes).
4. Dans **Clients → Create client**, choisir **Web application**. Ajouter l’adresse Gmail ci-dessus dans **Authorized redirect URIs**, puis créer le client. Les origines JavaScript ne remplacent pas cette adresse de retour. [Création du client Web](https://developers.google.com/workspace/guides/create-credentials).
5. Reporter le **Client ID** et le **Client secret** dans les réglages administrateur Gmail de Passerelle. Activer le fournisseur lorsque ces deux valeurs et l’adresse de retour sont correctes.
6. Essayer avec un compte inscrit dans les utilisateurs de test : connexion, choix des expéditeurs et activation de la lecture, puis vérification d’un message contenant une date connue.

En mode externe **Testing**, les refresh tokens donnant accès à Gmail expirent au bout de **sept jours** : une reconnexion peut être nécessaire. Ce mode sert au pilote, pas à garantir une connexion durable au grand public. [Durée des jetons Google](https://developers.google.com/identity/protocols/oauth2).

### Avant une ouverture commerciale de Gmail

`gmail.readonly` est un scope **restricted**. Une application publique traitant ces données via un serveur doit prévoir la vérification Google et l’évaluation de sécurité applicable, renouvelée au moins annuellement. Des exceptions existent notamment pour certains usages personnels, internes ou de test ; elles ne doivent pas être présumées pour un produit commercial ouvert. Ne pas promettre la gratuité de ces démarches. [Vérification des scopes restreints et exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).

Préparer un **domaine possédé et vérifiable**, une page d’accueil publique et une politique de confidentialité décrivant l’accès, l’usage, la conservation et l’effacement des données Gmail. L’adresse actuelle utilise le domaine partagé `sslip.io` : la remplacer par le domaine commercial contrôlé par le propriétaire et actualiser les callbacks avant la publication. Google demande la vérification des domaines associés dans Search Console ; la présence d’un certificat HTTPS ne prouve pas leur propriété. [Domaines et pages publiques](https://developers.google.com/identity/verification/authentication-policy-compliance).

## 3. Microsoft Entra : Outlook, Hotmail et Microsoft 365

1. Dans [Microsoft Entra](https://entra.microsoft.com/), ouvrir **App registrations → New registration** et nommer l’application Passerelle.
2. Sélectionner **Accounts in any organizational directory and personal Microsoft accounts** pour accueillir les comptes d’établissements et Outlook/Hotmail personnels. [Types de comptes et inscription](https://learn.microsoft.com/en-us/entra/identity-platform/quickstart-register-app).
3. Dans **Authentication → Add a platform → Web**, ajouter l’adresse Outlook ci-dessus. Utiliser la plateforme **Web** du serveur ; aucune query string ne doit être ajoutée au callback pour les comptes personnels. [Configuration du retour](https://learn.microsoft.com/en-us/entra/identity-platform/how-to-add-redirect-uri), [restrictions des adresses](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url).
4. Dans **API permissions → Add a permission → Microsoft Graph → Delegated permissions**, ajouter `Mail.Read` et `User.Read`. Le parcours demande aussi `offline_access` pour renouveler les jetons. `Mail.ReadBasic` ne donne pas le corps nécessaire à la détection. Ne pas ajouter de permission d’application sur toutes les boîtes. [Permissions Graph](https://learn.microsoft.com/graph/permissions-reference), [accès hors connexion](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow).
5. Dans **Certificates & secrets**, créer un secret client et noter son expiration. Reporter dans Passerelle l’**Application (client) ID** et la **Value** du secret, pas son **Secret ID**. Le secret reste côté serveur. [Identifiants du client Web](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow#redeem-a-code-for-an-access-token).
6. Tester une boîte autorisée. Une organisation peut imposer ses règles de consentement ou une validation administrateur, même si une boîte Outlook personnelle fonctionne.

## 4. Vérifier le parcours et arrêter un accès

Après connexion, choisir les messages autorisés dans Passerelle. Avec un message de test, vérifier la source, la proposition de date, le maintien du statut non lu et l’absence d’ajout avant confirmation. Contrôler ensuite le rendez-vous dans l’agenda et le flux ICS. Une connexion réussie ne vaut pas consentement à analyser toute une boîte.

**Déconnecter dans Passerelle** arrête son utilisation locale des identifiants. Pour retirer aussi l’autorisation chez le fournisseur, utiliser :

- Google : [applications associées](https://myaccount.google.com/connections), sélectionner Passerelle et supprimer son accès. [Aide officielle](https://support.google.com/accounts/answer/13533235?hl=fr).
- Compte Microsoft personnel : [applications et services autorisés](https://account.live.com/consent/Manage). Pour une organisation, suivre la gestion des applications de son compte ou son administrateur. Ces liens de retrait figurent dans les [conditions des API Microsoft, section 5](https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use).

Une révocation ne supprime pas à elle seule les données déjà copiées : traiter aussi l’effacement dans Passerelle selon sa politique de conservation. La révocation OAuth Google peut affecter tous les scopes accordés au même projet pour cet utilisateur ; utiliser un projet dédié évite de coupler les boîtes personnelles à d’autres intégrations. [Révocation Google](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke).
