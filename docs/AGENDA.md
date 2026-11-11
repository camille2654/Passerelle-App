# Présentation de l’agenda

L’agenda propose une grille horaire de la semaine sur grand écran et une vue journée par défaut sur les écrans plus petits. Les deux vues sont accessibles depuis les boutons Semaine et Journée. Le choix est mémorisé sur l’appareil ; cette préférence ne contient aucune donnée scolaire. Une rangée compacte de sept jours permet de consulter rapidement une autre journée. Les flèches, le retour à aujourd’hui et le choix de date gardent la navigation sur l’année scolaire.

Les heures sont affichées à Paris. Les cours, rendez-vous personnels, événements du lycée et transports occupent leurs créneaux ; les chevauchements sont disposés côte à côte. Les éléments sur une journée entière et les horaires incomplets restent à part. Les devoirs, contrôles et séances de révision sont conservés dans la rubrique À préparer. Les annulations restent identifiées et les rendez-vous personnels restent réservés à leur propriétaire.

`public/agenda-view.js` normalise seulement la présentation des instantanés déjà autorisés par l’API existante, calcule les positions et produit le contenu. `public/agenda.css` utilise les couleurs et Manrope de Passerelle. Les positions passent par les propriétés CSS du DOM pour respecter la CSP, sans styles inline dans les chaînes HTML. Le changement de vue ou de jour ne relance pas une lecture ENT. Les comptes, tokens, moteurs de synchronisation et flux ICS ne sont pas modifiés.

Les tests du calcul vérifient heures de Paris, changement d’heure et rendez-vous nocturnes, créneaux chevauchants et adjacents, éléments sur une journée entière, horaires incomplets, annulations et texte échappé. Le parcours navigateur utilise un serveur isolé et des données fictives : semaine, journée, navigation, sélection des jours, petit écran, thème sombre, événements de plusieurs types et préférence mémorisée.

La vue journée donne la priorité au contenu des cours : cartes ajustées à leur texte, icône de matière séparée, couleur discrète, salle et durée regroupées. Les libellés ENT en majuscules sont rendus lisibles à l’écran, sans modifier les sources ni les titres ICS ; les sigles courants et noms personnalisés sont conservés. Les intervalles d’au moins cinq minutes entre les activités horaires affichées sont indiqués ; les activités chevauchantes comptent jusqu’à leur fin et les cours annulés ne bloquent pas cet intervalle. Cette indication décrit les éléments affichés, elle ne confirme pas une disponibilité. Les jours sans cours, devoirs, rendez-vous, transports et annulations restent accessibles.

## Interactions de la version 4.20

Les cours strictement identiques et adjacents (matière, intitulé, salle et style) partagent un bloc visuel, marqué du nombre de séances. Les objets ENT et les UID ICS restent séparés. Les annulations et les cours ayant changé depuis la dernière visite ne sont pas regroupés. Le repère de consultation existant du compte alimente les indications de salle et d’horaire modifiés.

Le cours actuel dispose d’un repère et d’une progression fondés sur ses horaires réels. Le prochain cours est indiqué dans la vue d’aujourd’hui ; les cours annulés sont exclus. Ce repère s’actualise toutes les trente secondes lorsque l’agenda est visible et au retour dans l’application, sans requête ENT supplémentaire.

Chaque cours ouvre un dialogue accessible : informations disponibles, travail de la matière dans la semaine affichée et notes personnelles. L’ajout de note utilise le contrôle d’appartenance existant et reste lié à l’élève. Le dialogue et son contenu sont nettoyés au changement de compte et à la déconnexion. Sur mobile, le panneau vient du bas ; les mouvements réduits sont respectés. Un glissement horizontal passe au jour voisin, y compris entre deux semaines, tout en préservant le défilement vertical. Les jours restent disponibles par boutons et au clavier.

## Changements utiles et devoirs cochables · 4.20.1

Le résumé des changements compare la première et la dernière heure des cours actifs avec la dernière consultation du compte. Il affiche l’horaire actuel et l’écart, par exemple « Demain, vous commencez à 10:20 · 2 h 05 plus tard ». Une annulation au milieu de la journée ne produit pas de faux décalage de début/fin. Les changements successifs sont ramenés au bilan final ; un cours modifié puis rétabli ne laisse pas un gain de temps fictif. Le résumé apparaît dans l’agenda et dans le bloc de changements de l’accueil.

Le calcul utilise les états antérieurs conservés par l’historique et les cours actuellement publiés, sur le compte et l’élève concernés. Les nouvelles entrées d’historique gardent aussi l’ancien état d’annulation. Un historique tronqué, un ancien état d’annulation indéterminé ou des horaires invalides suspendent la comparaison concernée. Les rendez-vous personnels et transports restent séparés de ce bilan scolaire.

Le panneau d’un cours permet de cocher les devoirs et contrôles de sa matière dans la semaine affichée. Un travail fait reste visible dans le panneau pour pouvoir le remettre à faire ; la rubrique « À préparer » de l’agenda retire les travaux terminés. L’action utilise le même statut personnel que la page Devoirs et les abonnements agenda. Elle n’envoie aucune déclaration de travail fait à l’ENT. Les consignes et le brouillon de note restent lisibles pendant l’enregistrement ; un refus de synchronisation remet la case à son état précédent.

## Navigation compacte et pauses · 4.20.2

Le bandeau de date reste sous l’en-tête de Passerelle lorsque l’agenda défile. Il réunit les flèches, le choix de date natif et le retour à aujourd’hui. En vue Journée, les flèches changent de jour ; en vue Semaine, elles changent de semaine. Un déplacement dans la semaine déjà chargée réutilise son instantané, sans nouvelle requête scolaire. Les boutons et la saisie de date restent bornés par l’année scolaire. La date sélectionnée n’est plus répétée dans un grand titre au-dessus des cartes.

Les cartes de journée distinguent la matière, l’emplacement et la durée par la taille et le contraste du texte. Les couleurs et modes clair/sombre de Passerelle sont conservés. Les actions ont un repère de focus visible et les nouvelles transitions respectent le mouvement réduit.

Une pause d’au moins cinq minutes entre deux cours est indiquée avec sa durée et ses horaires. Les événements personnels et transports occupent leurs créneaux ; lorsqu’une borne appartient à une autre activité, le libellé reste « Intervalle ». Les cours chevauchants sont pris jusqu’à leur fin la plus tardive et les annulations ne bloquent pas l’intervalle. La distinction des pauses est précisée ci-dessous à partir de la version 4.20.3. Ces indications décrivent uniquement les activités affichées, sans confirmer une disponibilité personnelle ni créer d’événement ICS.

## Récréations et pause déjeuner · 4.20.3

Entre deux cours, un intervalle de quinze minutes est nommé « Récréation ». Un intervalle d’au moins trente minutes entièrement compris entre 11 h et 14 h est nommé « Pause déjeuner ». Les horaires et la durée affichés restent ceux de l’intervalle réellement présent : par exemple 12:10–13:05, 11:00–13:00 ou 13:00–14:00. Les autres interruptions restent des pauses. Les heures sont calculées à Paris, comme les cours. Ces libellés sont des conventions de présentation et ne créent aucun événement scolaire ou ICS.

Un rendez-vous personnel ou un trajet reste pris en compte pour calculer l’intervalle. Lorsqu’il en constitue une borne, le libellé « Intervalle » est conservé : il n’est pas transformé en récréation ou repas. Le traitement des annulations, chevauchements et séances adjacentes reste inchangé.

## Icônes des matières · 4.20.4

Les vues Journée, Semaine et le panneau de détail utilisent des pictogrammes au trait pour identifier les matières. Les icônes existantes de Passerelle sont réutilisées : calculatrice pour les mathématiques, livre pour le français, globe pour l’histoire-géographie, langues, fiole pour les sciences, sport, arts, graphique pour l’économie et terminal pour l’informatique. Quatre dessins complémentaires, sur la même grille 24 × 24 à trait arrondi, représentent la biologie, la musique, la philosophie et la technologie. Une matière non reconnue utilise le livre.

Le choix repose sur le nom de matière, indépendamment de son ancien emoji personnalisé. Les anciens pictogrammes Unicode en préfixe sont retirés des titres affichés et de leurs infobulles. Les objets source, réglages personnels de matière et exports ICS restent identiques. Les noms complets et couleurs sont conservés ; les SVG sont décoratifs et les noms restent accessibles sous forme de texte. Les icônes ne demandent aucune police ou ressource externe.
