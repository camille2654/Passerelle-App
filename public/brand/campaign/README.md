# Passerelle · Le studio

Édition 2026 · Identité « Carnet contemporain » · Version 4.16.0.

24 visuels prêts à publier, aux dimensions natives, et leurs 24 sources SVG éditables :

- Bannière principale : 1920 × 640.
- Couvertures LinkedIn 1584 × 396, X 1500 × 500, Facebook 1640 × 624 et YouTube 2560 × 1440.
- Avatar carré : 1080 × 1080.
- Quatre publications Instagram / Facebook : 1080 × 1350.
- Un carrousel de cinq pages, à publier dans l’ordre 01 → 05 : 1080 × 1350.
- Trois stories : 1080 × 1920, avec de l’espace pour l’interface de la plateforme.
- Six couvertures « à la une » : 1080 × 1080.

Le fichier `assets-manifest.json` donne les dimensions, le groupe et le texte alternatif de chaque visuel. `legendes.md` propose les textes d’accompagnement. Aucun visuel n’est publié automatiquement sur un réseau social.

## Utilisation

Importer les fichiers PNG sans les étirer ni les rogner. Les couvertures demandent parfois un réglage de cadrage propre à la plateforme : vérifier l’aperçu avant publication, surtout sur téléphone. Sur YouTube, la signature est dans une zone centrale compatible avec le cadre mobile de 1546 × 423 ; le fond déborde pour la télévision.

L’avatar et les couvertures à la une préservent le centre pour le recadrage circulaire. Les stories conservent les zones haute et basse pour les commandes. Ajouter le sticker de lien directement dans Instagram ; le texte de la première story indique sa position.

Le carrousel se publie dans l’ordre des fichiers. Les exemples d’emploi du temps et de devoirs sont fictifs et signalés comme tels. Ils ne représentent pas les données d’un utilisateur réel.

## Modifier les sources

Les SVG conservent les textes, les formes et la mise en page. Pour garder les images et la police liées, préserver l’arborescence du pack :

```
fonts/manrope-variable.ttf
fonts/OFL-Manrope.txt
brand/symbol.png
brand/campaign/artwork.png
brand/campaign/exports/*.svg
```

Installer Manrope depuis le fichier fourni avant de modifier les textes dans un logiciel qui ne lit pas les polices web des SVG. Le nom de marque et le logo existants restent inchangés. Ne pas utiliser l’illustration comme nouveau logo.

Le générateur se trouve dans `scripts/build-social-pack.mjs`. Il écrit d’abord les SVG et la galerie. `node scripts/build-social-pack.mjs --sources-only` ne lance aucun navigateur. La commande sans option produit les PNG avec un navigateur Chromium local, sans appel à une plateforme sociale ou à un service tiers.

## Palette et voix

Vert passage #153D38 · Citron du matin #D9EF78 · Papier #F6F5EF · Corail #F2A38C · Bleu cahier #C8D7F0. Typographie Manrope, libre sous licence SIL OFL 1.1.

La signature emploie « ta » ; l’interface utilise le vouvoiement. Parler de fonctions disponibles, sans promettre une compatibilité avec tous les ENT ou des transports en direct. La bêta gratuite peut évoluer : adapter la légende si l’offre change. Les options de messagerie personnelle nécessitent leur configuration réelle et ne font pas partie des promesses de ce pack.

## Origine et droits

Mises en page, textes et pictogrammes composés pour Passerelle à partir de son identité existante. Le logo original est conservé. L’illustration `artwork.png` a été créée avec l’outil de génération d’images intégré ; son prompt et son origine sont documentés par le propriétaire du projet. Les sources du projet restent sous la licence indiquée à sa racine ; Manrope conserve sa licence OFL fournie. Les marques des plateformes servent uniquement à indiquer les formats d’export : aucune affiliation n’est revendiquée.
