# Parcours et présentation · 4.23.0

La connexion à l’ENT présente trois étapes : lycée, authentification, récupération des cours. La fin repose sur une connexion valide, un flux créé et une synchronisation terminée ; les quantités affichées proviennent du statut actuel. Un emploi du temps vide peut être correctement synchronisé. Les travaux disponibles peuvent inclure les ajouts personnels. Aucun pourcentage d’avancement n’est inventé.

Les erreurs distinguent la reconnexion ENT, l’échec temporaire de synchronisation, le délai réseau et une réponse illisible. Le détail existant reste accessible ; les boutons renvoient vers la connexion, une nouvelle vérification ou l’assistance. Une recherche d’établissement échouée conserve la saisie. Une erreur pendant l’ouverture de l’ENT reste sur la page de connexion. Les interruptions de lecture de l’écran distant sont signalées pendant la reprise automatique existante.

**Plus → Réglages** comporte quatre groupes : Mon lycée, Agenda, Notifications, Mon compte. Les applications connectées sont dans Mon compte ; l’administration reste dans son espace séparé. Les groupes ouverts sont conservés pendant les actualisations, pour le profil courant seulement.

La vue journée emploie des surfaces neutres, des icônes au trait, un repère de matière et une salle visible. Le cours en cours et les changements gardent leurs indications spécifiques. Les données, couleurs choisies et calendriers ICS ne sont pas modifiés.

La date choisie reste dans l’agenda. La position verticale et le défilement horizontal de la grille sont conservés en mémoire par rubrique. Un retour se rétablit aussi après le chargement, mais un geste de défilement volontaire annule cette reprise. Une actualisation capture la position avant de reconstruire l’interface. La fermeture d’un cours retrouve le bouton même s’il a été recréé entre-temps. La mémoire de navigation est effacée à la déconnexion ou au changement de profil scolaire.

Le suivi des devoirs propose **Annuler** dans Devoirs, les fiches matières et les fiches de cours. Il réutilise l’API authentifiée existante : il effectue réellement une nouvelle écriture, puis actualise les vues. Un refus serveur est présenté sans annoncer de réussite. Les actions sont liées au profil et remplacées par la prochaine action de suivi ; elles sont effacées lors d’un changement de compte. Dans une fiche de cours, le bouton reste dans le dialogue pour être utilisable au clavier. Les confirmations globales avec action restent douze secondes et leur disparition est suspendue pendant le survol ou le focus clavier.

Les animations existantes restent brèves et respectent la réduction du mouvement. Les fiches de cours montent depuis le bas sur téléphone. Aucun nouveau temps de chargement artificiel n’est ajouté.

Cette version concerne l’application Passerelle. Elle ne redéploie pas le service Cloudflare de Lapsus et ne modifie pas l’authentification ENT côté serveur. Aucun identifiant scolaire réel n’est nécessaire aux essais du parcours.
