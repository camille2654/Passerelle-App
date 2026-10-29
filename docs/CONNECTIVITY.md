# Connexions personnelles · 4.15.0

Chaque compte configure ses propres documents, calendriers, clés et trajets. Ces fonctions ne dépendent pas du lycée des Horizons. Elles restent dans Plus, dans les devoirs et dans les réglages ; les quatre entrées principales restent identiques.

## Envoyer à Passerelle

Plus → Importer un document permet d’envoyer une photo, un PDF, du texte ou un lien. Le fichier est limité à 30 Mo. L’aperçu propose un nouveau devoir/contrôle, un devoir existant, les documents favoris ou une note de matière pour le texte seul. Une note de matière n’est pas une notification programmée.

Le manifeste PWA expose une cible de partage POST multipart pour les navigateurs qui prennent en charge Web Share Target, après installation. Sur iPhone, cette API ne fournit pas l’intégration à la feuille de partage : ouvrir le guide Raccourcis dans l’importateur. Il explique comment envoyer l’entrée à l’adresse `https://repere.84.235.226.127.sslip.io/agenda/share`, récupérer `openURL` puis l’ouvrir dans Safari. Le raccourci n’est pas signé ou installé automatiquement depuis le serveur Linux.

Le stockage des favoris autorise 150 Mo par compte, avec vingt fichiers maximum. Le point d’entrée public `/share` accepte `title`, `text`, `url` et un seul champ fichier `file`. Il prépare un brouillon opaque pendant dix minutes en mémoire, avec un plafond global de 60 Mo, deux cents brouillons et un seul envoi simultané. Aucun compte n’est modifié à ce stade. La réponse normale redirige vers un fragment privé ; `Accept: application/json` retourne `openURL` pour Raccourcis. Un navigateur qui transmet un partage vide reçoit une explication et l’import manuel reste disponible. Les API de validation restent protégées par la session, l’origine, le compte et le profil scolaire. Une validation répétée ne duplique pas le devoir. Les fichiers confirmés utilisent le stockage chiffré des favoris ; ils sont téléchargés comme pièces jointes, jamais exécutés ou affichés en HTML.

## Documents dans les devoirs

Dans un devoir, le bouton Documents permet de coller un lien Drive, Google Docs, OneDrive ou SharePoint, d’envoyer une copie privée ou de choisir un favori existant. Les liens ouvrent le fichier à sa source et donc sa version actuelle ; les droits de partage restent gérés chez son propriétaire. Les liens sont chiffrés dans le stockage et ne sont pas livrés dans les listes publiques de métadonnées. Quand un devoir disparaît, ses documents restent accessibles dans la bibliothèque personnelle. Les favoris retirés restent signalés comme indisponibles dans les devoirs auxquels ils étaient liés.

Les sélecteurs Google Drive et OneDrive sont implémentés mais demandent une application OAuth réellement configurée. Ils réutilisent les identifiants d’application Google/Microsoft saisis dans l’administration des messageries personnelles ; l’autorisation de sélection de fichiers est distincte de la lecture des mails.

Ajouter également aux URL de retour autorisées :

- Google : `https://repere.84.235.226.127.sslip.io/agenda/api/cloud-documents/oauth/gmail/callback`
- Microsoft : `https://repere.84.235.226.127.sslip.io/agenda/api/cloud-documents/oauth/outlook/callback`

Google utilise le sélecteur de redirection OnePick avec le seul scope `drive.file`, PKCE et `trigger_onepick=true`. Microsoft utilise le scope délégué `Files.Read` et un sélecteur local des métadonnées Graph. Aucun jeton de fichiers n’est conservé à long terme. Les sélections sont temporaires, liées à la session et au profil ; aucun document n’est rangé sans confirmation. Le sélecteur OneDrive montre cent éléments par dossier ; les sous-dossiers et le collage d’un lien permettent de retrouver les autres fichiers. Les boutons restent indisponibles quand les identifiants ne sont pas configurés. La vraie connexion doit encore être validée par le propriétaire après configuration des applications et de leurs autorisations publiques.

## Calendriers personnels

Plus → Réglages → Mes calendriers personnels accepte jusqu’à trois calendriers. Un fichier ICS (1 Mo maximum) est une copie ; un lien d’abonnement compatible est actualisé toutes les trente minutes. Les liens Google Calendar, Outlook et iCloud autorisés sont téléchargés avec des limites et des protections contre les adresses privées et les redirections. Pour un autre fournisseur, utiliser son fichier ICS. Le lien privé reste chiffré, jamais renvoyé dans les réglages.

L’agenda affiche les événements personnels et les conflits avec les cours. Le planificateur de révisions réserve des créneaux hors cours et rendez-vous occupés, selon les données importées. Un calendrier manquant ou périmé doit être vérifié avant de se fier aux disponibilités. Les calendriers sont en lecture seule et propres au profil scolaire choisi. Le contenu personnel n’est ni exporté dans le lien ICS scolaire ni révélé dans la fonction Entre amis. L’analyse des récurrences se déroule dans un processus de travail limité en mémoire, temps et nombre d’occurrences.

## Trajets de tous les utilisateurs

Plus → Réglages → Mon trajet : chacun renseigne ses lieux de départ/arrivée, son temps de transport aller et retour, sa marge et ses jours de circulation. Les horaires renseignés sont ceux de l’utilisateur. Le départ proposé se calcule à partir du premier cours non annulé ; le retour utilise le dernier. Un agenda périmé ne fournit pas d’heure de départ présentée comme fiable. Les estimations restent identifiées comme telles.

Le direct nécessite les données publiques réelles du réseau concerné. L’administrateur peut configurer des sources SIRI Lite HTTPS institutionnelles dans la gestion des trajets. Une source réutilisable peut accepter les arrêts et la ligne de chaque utilisateur, avec un paramètre `{stopRef}` encodé dans son URL. Les sources, arrêts et lignes séparent les caches. Aucun réseau, horaire temps réel ou abonnement d’API n’est inventé ou activé par défaut. Un compte sans source compatible peut toujours utiliser la durée habituelle et ses horaires personnels.

## Clés d’accès

Plus → Réglages → Clés d’accès : confirmer le mot de passe du compte avant d’ajouter ou retirer une clé. Le navigateur propose le mécanisme disponible sur l’appareil : Face ID, Touch ID, code ou clé de sécurité. Passerelle conserve la clé publique et ses métadonnées chiffrées ; les données biométriques ne lui sont pas transmises. Le mot de passe et sa récupération restent disponibles.

WebAuthn nécessite un contexte HTTPS valide et le même domaine ; une adresse IP brute n’est pas un identifiant RP accepté. Les défis sont courts, à usage unique et liés à la session ou au cookie d’authentification. L’authentification exige la vérification de l’utilisateur et vérifie la signature, l’origine et le compteur. Une clé supprimée ou un compte suspendu ne peut plus terminer la connexion. La connexion par clé ne remplace pas la confirmation exigée par la console administrateur pour les opérations sensibles.
