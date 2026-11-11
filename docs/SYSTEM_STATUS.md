# Statut du système · 4.21.1

La page publique est disponible sous `/agenda/status/`, depuis le pied de page de l’application et la vue d’ensemble de l’administration. Elle reprend Manrope, le logo, les couleurs et les icônes de Passerelle ; elle dispose de modes clair et sombre et respecte le mouvement réduit.

## Ce que le suivi mesure

L’API `/agenda/api/system-status` renvoie une liste fixe de six composants : portail/API, moteur de synchronisation, génération ICS, traitement des mails, notifications push et connecteur Lapsus. La réponse est la même avec ou sans session. Elle ne contient aucun compte, établissement, adresse, token, lien ICS, erreur brute, mémoire ou taille du stockage.

Le portail est observé à la réception de la réponse. La génération ICS est vérifiée sur un calendrier de contrôle vide. Les automatismes sont observés par les passages réels des boucles existantes : le suivi n’en déclenche aucune supplémentaire. Une configuration seule ne vaut pas une vérification. Sans premier passage ou avec un signal âgé de plus de 90 secondes, le traitement est « Non vérifié ». Un passage en échec est « À vérifier ». Les pauses administratives, maintenances et services non activés ont leurs états propres.

Le moteur de synchronisation signale son fonctionnement, pas la réussite de chaque connexion ENT. De même, les traitements de mails/push ne prouvent pas la livraison finale. Le connecteur Lapsus ne sonde pas le site tiers. Ces limites sont indiquées sur la page ; les incidents et informations par compte restent dans l’administration existante.

La page vérifie l’état toutes les trente secondes lorsqu’elle est visible, sans envoyer de cookie de session. Une erreur réseau, réponse invalide ou attente excessive retire les indicateurs verts et rappelle la date du dernier contrôle réussi. Au retour d’un onglet, une observation de plus de 75 secondes est marquée comme ancienne avant une nouvelle vérification.

Les transitions publiques sont gardées en mémoire, au maximum 24 événements, depuis le dernier démarrage. Le processus fait aussi une observation toutes les trente secondes. Aucun pourcentage de disponibilité ou historique de plusieurs jours n’est inventé. Les observations sont des libellés génériques, sans texte privé de journal ou de compte.

## Disponibilité de la page en cas de panne

`deploy/nginx-status.conf` sert uniquement les fichiers de `public/status` depuis `/var/www/passerelle-status`. La copie publique et ses ressources restent accessibles lorsque le seul service Node de Passerelle est arrêté. L’API passe alors en erreur et la page le signale. Une panne de la VM, du réseau ou de Nginx nécessite un suivi externe ; cette page hébergée sur la même VM ne peut pas y survivre.

Le répertoire privé de l’application garde ses droits existants. La racine du site Repère et le proxy habituel `/agenda/` sont conservés. Le répertoire de statut contient seulement HTML, JavaScript, CSS, logo, police et sprite public ; aucun accès aux répertoires privés n’est ajouté.

## Graphiques et mesures conservées · 4.21.1

Le service indépendant `passerelle-status-monitor.service` sonde l’API anonyme locale toutes les minutes. Il mesure la durée HTTP depuis la VM avec une horloge monotone. Ce temps de réponse inclut la requête locale et la réponse du backend ; il ne mesure pas la connexion Internet de l’utilisateur ni la latence des ENT. Aucun cookie, clé d’API ou compte n’est utilisé.

Seuls l’horodatage, le temps de réponse valide, l’état global et les six états de composants sont conservés. Les noms, textes, erreurs, adresses et champs supplémentaires de l’API sont exclus. Le fichier `/var/lib/passerelle-status/history.json` est remplacé atomiquement, conservé sur 24 heures et borné à 2880 observations. Il survit au redémarrage du backend et du moniteur. Les périodes pendant lesquelles aucun contrôle n’a été réalisé ne sont pas reconstituées. Nginx expose uniquement ce fichier JSON, indépendamment de Node.

La courbe de réponse et les six frises sont filtrables sur 1 h, 6 h et 24 h. Les lignes s’interrompent en cas de contrôle en échec ou d’intervalle supérieur à 90 secondes ; les périodes sans mesure restent grises. Les frises décrivent des observations à une minute environ, sans garantir un état continu entre deux contrôles. Le dernier signal n’est pas prolongé au-delà d’une minute sans nouvelle mesure. Les pauses, incidents, indisponibilités, périodes non vérifiées et services non activés ont des représentations distinctes.

Les indicateurs comptent les observations reçues, les réponses HTTP valides, leur médiane et les contrôles au statut global opérationnel. Un échec n’est jamais converti en réponse de zéro milliseconde. « Contrôles au vert » est un rapport sur les contrôles enregistrés, pas une promesse de disponibilité continue ou un pourcentage couvrant les périodes absentes. Le suivi débute à la première vraie mesure ; aucune donnée d’exemple n’est publiée.

Les graphiques se consultent au clic/toucher et au clavier avec les flèches, Début et Fin. Une table donne les 60 dernières observations de la période. Les détails d’un service restent ouverts lors des rafraîchissements. Un fichier de mesures invalide ou âgé de plus de 150 secondes marque le suivi comme non actualisé et masque l’indicateur de dernière réponse actuelle, tout en laissant les observations historiques consultables.

L’arrêt du backend peut être observé tant que la VM, Nginx et le moniteur fonctionnent. Une panne de la VM entière laisse une période sans mesure, qu’un suivi extérieur serait nécessaire pour qualifier.
