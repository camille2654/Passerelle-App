# Recherche et fiches matières · 4.22.0

La loupe dans l’en-tête ouvre la recherche depuis toutes les pages du compte. Le raccourci Ctrl/⌘ K fait de même lorsqu’aucun dialogue n’est ouvert. L’entrée existante **Plus → Rechercher** est conservée.

La recherche couvre les matières, les cours, les devoirs et contrôles, les noms de documents favoris et liens associés, les notes personnelles, les fiches de révision et les actualités déjà reçues. Elle ignore les accents. Les filtres affichent les comptes réels avant la limite de 60 résultats par catégorie. Le contenu des fichiers et les messageries ne sont pas indexés. Une actualisation des actualités reste une action explicite dans les options ; la recherche ordinaire ne contacte pas l’ENT.

**Plus → Mes matières** donne accès aux cours à venir, au travail à faire et terminé, aux notes, aux fiches de révision et aux documents de chaque matière. Le détail d’un cours dans l’agenda propose aussi d’ouvrir sa matière. Les matières identifiées uniquement par des notes ou fiches de l’élève sont incluses ; des libellés différents ne sont pas fusionnés par supposition.

Les documents liés à un devoir suivent sa matière. Les autres favoris peuvent être associés explicitement depuis une fiche, puis dissociés. Cette association ne déplace pas le fichier, ne change pas son chiffrement et ne modifie pas le lien ICS. Les liens externes sont ouverts par la route privée existante avec ses règles d’origine et de propriétaire.

Les cases de devoir utilisent la commande existante, y compris son actualisation ICS habituelle. Les notes utilisent les notes personnelles existantes et peuvent aussi être retrouvées dans leurs autres vues. Les données du compte sont rechargées après modification pour que les autres pages retrouvent le même état.

Les lectures sont locales et authentifiées. Les API n’acceptent aucun identifiant de compte à consulter. Les documents restent filtrés par compte, élève et établissement ; les associations exigent le compte et l’empreinte du profil courant. Un favori d’un autre profil ou un devoir étranger est refusé. Aucun token, URL ENT ou lien ICS n’est ajouté aux réponses. Les données ne sont pas conservées dans le stockage du navigateur. Les réponses tardives sont écartées après changement d’identité ou de matière ; la déconnexion vide les vues privées.

La vue montre les informations déjà reçues et leur date, sans inventer les cours manquants. Les limites sont explicites : 12 prochains cours, 40 travaux à faire avec accès à la liste complète, 10 travaux terminés et 40 notes dans la fiche. Les favoris déjà retirés restent indisponibles dans leurs anciens liens de travail.
