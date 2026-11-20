# CAHIER DES CHARGES
## Projet : SANGO YA MBONGO

**Slogan :** Comprendre aujourd'hui les paiements de demain.

**Domaine :** Mobile money et paiements numériques en République démocratique du Congo.

**Cadre académique :** Travail pratique de Développement Web Avancé – Master 2 Communication Numérique.

**Établissement :** Université Don Bosco de Lubumbashi.

**Responsable du projet :** Sarah KABEDI.

---

## 1. Présentation du projet

Sango Ya Mbongo est une plateforme web professionnelle de veille technologique consacrée au mobile money et aux paiements numériques en République démocratique du Congo.

La plateforme a pour vocation de collecter, centraliser, organiser et présenter des informations pertinentes sur les évolutions technologiques, économiques et réglementaires du secteur.

Elle permettra aux utilisateurs de suivre les actualités, de consulter des analyses, de découvrir les innovations et de comprendre les transformations du marché des paiements numériques en RDC.

## 2. Problématique

Le secteur du mobile money évolue rapidement en RDC. Les informations relatives aux opérateurs, aux innovations, aux transactions numériques, à la sécurité et aux nouvelles réglementations sont dispersées sur différentes plateformes.

Il devient donc nécessaire de disposer d'un espace centralisé permettant de collecter, filtrer, consulter et analyser ces informations.

## 3. Objectif général

Concevoir et développer une plateforme web automatisée de veille technologique sur le mobile money et les paiements numériques en RDC.

## 4. Objectifs spécifiques

- Automatiser la collecte d'informations provenant de plusieurs sources.
- Centraliser les actualités dans une base de données.
- Faciliter la recherche et le filtrage des informations.
- Présenter les tendances du secteur à travers des indicateurs et des graphiques.
- Permettre aux utilisateurs de créer un compte.
- Permettre l'enregistrement et la consultation d'articles favoris.
- Garantir une expérience utilisateur responsive et accessible.

## 5. Public cible

- Entrepreneurs et responsables de PME.
- Professionnels de la communication et du marketing.
- Acteurs du secteur financier et technologique.
- Étudiants et chercheurs intéressés par la fintech.
- Toute personne souhaitant suivre l'évolution des paiements numériques en RDC.

## 6. Périmètre éditorial

La plateforme couvrira les thématiques suivantes :

1. Mobile money et portefeuilles numériques.
2. Paiements marchands.
3. Interopérabilité des systèmes de paiement.
4. Sécurité numérique et lutte contre la fraude.
5. Réglementation et politiques financières.
6. Banques, opérateurs télécoms et fintechs.
7. Innovations et tendances technologiques.
8. Communication digitale et éducation financière.

## 7. Fonctionnalités attendues

### 7.1. Page d'accueil

- Présentation de Sango Ya Mbongo.
- Affichage des actualités récentes.
- Mise en avant des informations importantes.
- Accès aux principales catégories.
- Barre de recherche.
- Navigation vers les autres sections.

### 7.2. Actualités

- Affichage des actualités collectées.
- Présentation du titre, de l'extrait, de la date et de la source.
- Identification de la catégorie.
- Accès à l'article original.
- Consultation d'une fiche détaillée.

### 7.3. Recherche et filtres

- Recherche par mots-clés.
- Filtrage par source.
- Filtrage par date.
- Filtrage par catégorie.
- Gestion des résultats inexistants.

### 7.4. Tableau de bord

- Nombre d'articles collectés.
- Répartition des articles par catégorie.
- Répartition des articles par source.
- Évolution des publications dans le temps.
- Au moins un graphique pertinent.
- Date et heure de la dernière mise à jour.

Les indicateurs devront être calculés à partir des données réellement collectées. Aucune statistique fictive ne devra être présentée comme réelle.

### 7.5. Comptes utilisateurs

- Inscription.
- Connexion.
- Déconnexion.
- Gestion sécurisée des sessions.
- Enregistrement des articles favoris.
- Consultation des favoris.

### 7.6. Collecte automatisée

La plateforme devra intégrer au minimum trois sources distinctes, dont au moins deux API.

Sources envisageables :

- GDELT DOC 2.0.
- GNews ou NewsData.io.
- API de la Banque mondiale.
- Flux RSS spécialisés dans la fintech africaine.

L'agent devra vérifier la disponibilité, les conditions d'utilisation, les limites et la pertinence de chaque source avant son intégration.

La collecte devra être périodique et automatisée.

Les doublons devront être évités.

La panne d'une source ne devra pas interrompre le fonctionnement des autres sources.

Chaque information devra conserver sa provenance et son lien vers la source originale.

## 8. Identité visuelle

**Nom :** Sango Ya Mbongo.

**Slogan :** Comprendre aujourd'hui les paiements de demain.

**Positionnement :** institutionnel, professionnel, financier et technologique.

**Palette chromatique :**

- Vert forêt : #14532D.
- Vert institutionnel : #166534.
- Vert clair : #F0FDF4.
- Or : #D4A72C.
- Noir charbon : #17211B.
- Blanc cassé : #F8FAF7.

**Principes graphiques :**

- Interface sobre et professionnelle.
- Navigation claire.
- Hiérarchie visuelle cohérente.
- Cartes d'actualités lisibles.
- Graphiques sobres.
- Responsive design mobile-first.
- Accessibilité des contenus.

## 9. Architecture technique

L'application devra être organisée en trois parties :

**Frontend :**
- Structure HTML.
- Mise en forme CSS.
- Interactions JavaScript.

**Backend :**
- Gestion des API externes.
- Collecte et traitement des données.
- Authentification des utilisateurs.
- Gestion des favoris.
- Communication avec la base de données.

**Base de données :**
- Utilisateurs.
- Articles.
- Sources.
- Catégories.
- Favoris.
- Historique des collectes, si nécessaire.

L'agent IA devra proposer une architecture technique simple, cohérente et justifiée avant de choisir les technologies définitives.

## 10. Exigences de sécurité

- Les clés API ne doivent jamais être exposées dans le frontend.
- Les secrets doivent être conservés dans des variables d'environnement.
- Les mots de passe doivent être hachés.
- Les entrées utilisateurs doivent être validées.
- Les accès aux données doivent être sécurisés.
- Les fichiers sensibles doivent être exclus du dépôt GitHub.

## 11. Exigences de qualité

- Interface responsive sur smartphone, tablette et ordinateur.
- Navigation cohérente.
- Accessibilité des formulaires.
- Contrastes suffisants.
- Structure HTML sémantique.
- Gestion des erreurs et des chargements.
- Code organisé et documenté.
- Historique Git régulier.
- Sources et informations traçables.

## 12. Livrables

- Dépôt GitHub public.
- Code source complet.
- Site web fonctionnel et déployé.
- Fichier README documenté.
- Rapport technique PDF de cinq pages maximum.
- Compte de démonstration.
- Démonstration fonctionnelle lors de la soutenance.

## 13. Critères de réussite

Le projet sera considéré comme fonctionnel lorsque :

- Les trois sources minimum seront intégrées, dont deux API minimum.
- Les actualités seront collectées automatiquement.
- Les doublons seront contrôlés.
- Les recherches et filtres fonctionneront.
- Les fiches détaillées seront accessibles.
- Les indicateurs et graphiques seront alimentés par les données réelles.
- L'inscription et la connexion fonctionneront.
- Les favoris seront enregistrés et retrouvables.
- Le site sera responsive.
- Le dépôt GitHub et le déploiement seront accessibles.

**Principe fondamental :** chaque fonctionnalité développée devra être testable, documentée et compréhensible par moi.