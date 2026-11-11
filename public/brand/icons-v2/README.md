# Passerelle · Repères

56 icônes originales pour Passerelle, édition 2. Grille 24 × 24, trait 1,65 unité, extrémités et angles arrondis. Les petites ouvertures et les points reprennent le langage graphique du symbole Passerelle.

## Fichiers

- Un SVG autonome par icône ; la couleur par défaut est le vert forêt #153D38.
- sprite.svg : symboles préfixés i- pour l’application.
- manifest.json : nom technique, libellé français et catégorie.
- preview.html et preview.css : galerie responsive accessible sans JavaScript.

## Intégration

Document externe : <svg aria-hidden="true" viewBox="0 0 24 24"><use href="sprite.svg#i-calendar"/></svg>. Donner au contrôle un libellé accessible. Pour une icône porteuse de sens seule, ajouter role="img" et aria-label au SVG.

SVG inline : conserver viewBox, fill, stroke et les attributs d’arrondi ; adapter la propriété CSS color. Les fichiers autonomes contiennent un title descriptif. Pour une icône décorative, retirer ce title et ajouter aria-hidden="true". Ne pas appliquer de remplissage global aux contours.

Tailles conseillées : 20, 24, 32 ou 48 px. Préserver la grille carrée, la largeur du trait et les espaces internes. Pour un fond, utiliser un aplat de la palette Passerelle ; ne pas ajouter d’ombre au pictogramme.

## Régénération

node scripts/build-brand-icons.mjs

La source exporte icons, categories, iconMarkup, iconSymbol et iconSVG pour les compositions de marque.

## Droits

Dessins originaux réalisés pour le projet Passerelle ; aucune bibliothèque tierce d’icônes. Distribués avec le projet sous GPL-3.0-or-later. La présence des formes de bus, train et tram ne signifie pas qu’un réseau de transport est connecté.
