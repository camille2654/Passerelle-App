# Menu Plus et interactions · 4.24.0

L’écran Plus affiche une recherche, quatre raccourcis (Mon lycée, Mes matières, Documents favoris, Importer un document), deux groupes repliés et les réglages. Pour travailler réunit les outils d’organisation et de révision existants. Suivi et aide réunit les changements depuis la visite, les nouveautés, le guide et l’assistance ; une réponse en attente est signalée dans son sous-titre. L’administration reste accessible en bas pour les seuls administrateurs. Les outils et leurs API restent les mêmes.

Les cartes sont plus compactes et les icônes au trait utilisent les couleurs Passerelle. Les groupes sont de vrais éléments details/summary, accessibles au clavier. Une activation choisit l’état cible ; une nouvelle activation pendant le mouvement inverse cette cible. La fermeture remet le focus sur l’en-tête si nécessaire. Les réglages bénéficient du même dépliage.

Le repère de navigation glisse entre les destinations et se recale sans animation au changement de taille. Il reste décoratif (aria-hidden) ; aria-current reste porté par le bouton. Il est masqué dans les rubriques d’administration qui n’ont pas de destination dans la barre principale.

L’entrée dans Plus combine l’arrivée de l’écran et celle des cartes avec un léger décalage. Les boutons réagissent à l’appui et à l’activation au clavier. Sur téléphone, les fiches de cours et de contenu montent entièrement depuis le bas ; les notifications conservent leur ouverture latérale. Le fond apparaît et disparaît progressivement. Ces effets utilisent les API natives et les styles existants, sans nouvelle bibliothèque ni attente réseau supplémentaire.

La préférence système de réduction du mouvement désactive les effets. Une modification de cette préférence interrompt les animations en cours et termine l’état demandé des groupes. Les actions, le contenu et les libellés restent accessibles.

La version concerne Passerelle. Elle ne change ni les données ENT/ICS, ni les connexions Lapsus, ni les réglages de compte. Aucun suivi individuel n’est ajouté pour les animations.
