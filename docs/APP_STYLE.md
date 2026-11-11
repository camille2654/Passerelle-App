# Présentation de l’application Passerelle

L’application reprend la sobriété des composants Lapsus : navigation compacte, cartes arrondies, contrôles simples et icônes de maison, calendrier, devoirs, lycée et réglages. Elle conserve le logo Passerelle, Manrope et sa palette claire et sombre. Le connecteur partenaire reste un parcours distinct.

L’habillage commun est dans `public/app-style.css`, chargé en dernier dans la page principale. Les quatre destinations restent Accueil, Agenda, Devoirs et Plus. L’en-tête présente le logo et les actions privées ; la navigation devient une barre de bas d’écran sur téléphone. Les pages de connexion et d’inscription gardent leurs formulaires et l’information sur les ENT compatibles dans une présentation plus compacte.

Les blocs de l’accueil utilisent l’ordre enregistré dans les préférences. Les priorités et le menu occupent la colonne voisine de la journée sur grand écran ; le trajet passe après ces blocs. Les matières conservent leurs couleurs et leurs emojis. Le thème, les réglages, l’administration, les dialogues et les parcours de prise en main restent disponibles.

Les changements JavaScript se limitent aux icônes de navigation, à la présentation du titre d’accueil public et à l’application de l’ordre visuel des blocs. Le backend, les sources scolaires, les comptes, les tokens, les notifications et la génération des flux ICS ne sont pas modifiés.
