# Collecte de données

Les scripts sont prévus pour Node.js 20 ou plus récent et PostgreSQL 14 ou plus récent.
Le mode par défaut est `--dry-run` : il appelle les sources et affiche un résumé, sans
ouvrir de connexion PostgreSQL. Seule l'option explicite `--apply` autorise les écritures.
Il faut d'abord créer les 17 tables à partir du schéma validé, puis appliquer
`database/seed.sql` une fois. Le seed ne crée aucun article ni aucune observation.

## Initialisation

Depuis la racine du dépôt, initialiser les métadonnées avec un client PostgreSQL :

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d sango_ya_mbongo -v ON_ERROR_STOP=1 -f .\database\seed.sql
```

Le seed ajoute quatre sources, huit catégories éditoriales, le pays COD, l'indicateur
Global Findex retenu et son mapping World Bank. L'indicateur `FX.OWN.TOTL.ZS` a été
retenu parce que sa définition World Bank couvre explicitement la détention d'un compte
financier ou l'usage d'un service de monnaie mobile. Sa fréquence est irrégulière
(enquêtes Global Findex), et non annuelle. Les mappings ARPTC ne sont créés qu'à partir
des codes qui figurent dans un manifeste de rapport importé.

Le script SQL est transactionnel et réexécutable. Les conflits sur les codes/slugs
existants sont ignorés : le seed ne réactive pas les sources, catégories ou indicateurs
désactivés et ne remplace pas leurs métadonnées. Il ne supprime aucun article, document,
observation ou journal. Si le mapping existant `world_bank/FX.OWN.TOTL.ZS` pointe vers
un autre indicateur, le seed lève une erreur et sa transaction est annulée.

Après le seed, vérifier les quatre sources, huit catégories, le pays COD, l'indicateur
et l'association World Bank avec cette requête en lecture seule :

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d sango_ya_mbongo -v ON_ERROR_STOP=1 -f .\database\verify-seed.sql
```

Le rapport affiche une ligne par entité attendue. `is_present` doit être vrai partout;
`matches_expected` doit être vrai, notamment pour le niveau et l'absence de parent de
COD, la fréquence de l'indicateur, et l'association du mapping au bon code d'indicateur.
Les colonnes `is_enabled` et `is_active` sont informatives : leurs valeurs existantes
ne sont pas modifiées par le seed.

## Actualités

Tester les deux sources, sans écriture :

```powershell
npm.cmd --prefix backend run collect:news -- --dry-run
```

Tester une source indépendamment :

```powershell
npm.cmd --prefix backend run collect:news -- --source gdelt_doc --dry-run
npm.cmd --prefix backend run collect:news -- --source payments_afrika --dry-run
```

Écriture explicite après examen du résultat :

```powershell
npm.cmd --prefix backend run collect:news -- --source payments_afrika --apply
```

Cette commande importe uniquement Payments Afrika. Pour compter les articles liés à
chaque source par statut, sans modifier la base :

```powershell
psql -h 127.0.0.1 -p 5432 -U postgres -d sango_ya_mbongo -v ON_ERROR_STOP=1 -f .\database\verify-news-collection.sql
```

Le flux RSS utilisé est `https://paymentsafrika.com/feed/`. Les éléments sans URL,
titre ou date de publication présente mais invalide sont ignorés : aucune date n'est
inférée. Si une source ne fournit pas de date de publication, `published_at` reste NULL.
GDELT expose une date `seendate` correspondant à sa propre observation de l'article,
pas nécessairement à sa publication. Le collecteur ne la copie donc pas dans
`published_at`. La table actuelle ne possède pas de champ dédié pour archiver cette
date de découverte fournie par GDELT; les métadonnées conservées sont le lien original,
la source, la langue disponible et la catégorie/source-country lorsqu'elle est fournie.
Le collecteur conserve les articles en `pending_review` et `unclassified`; ils ne
deviennent visibles sur la route publique des articles qu'après décision éditoriale.
Les URL normalisées éliminent les paramètres de suivi courants et les fragments, mais
conservent le schéma, l'hôte, le chemin et les paramètres fonctionnels. Une URL existant
déjà est associée à sa source sans créer un second article.

Le résultat distingue les éléments ignorés (`ignored`) des échecs d'enregistrement
(`failed`). Chaque échec inclut le titre ou l'URL source, un code et un message sûr;
les valeurs sensibles des URL et les détails techniques bruts ne sont pas affichés.
Un échec d'article n'annule pas les autres transactions, mais fait terminer le script
avec un code de sortie non nul. Le journal global reste limité aux compteurs existants
et au code/résumé du dernier échec, car le schéma ne stocke pas de détail par article.

GDELT est limité à une requête au moins toutes les cinq secondes. Le verrou et l'heure
de dernière requête sont conservés dans le répertoire temporaire du système pour
coordonner plusieurs processus sur la même machine. Les nouvelles tentatives respectent
également l'intervalle et le `Retry-After` communiqué par le serveur. Le service distant
peut néanmoins répondre `429`; dans ce cas le script le signale et Payments Afrika est
quand même essayé.

## Indicateurs World Bank

Test sans écriture :

```powershell
npm.cmd --prefix backend run collect:world-bank -- --dry-run
```

Écriture explicite :

```powershell
npm.cmd --prefix backend run collect:world-bank -- --apply
```

L'adaptateur interroge le pays `COD` et le code `FX.OWN.TOTL.ZS`, suit les pages de
l'API, ignore les valeurs `null`, et conserve les valeurs numériques reçues. La règle
`identity` renseigne une unité explicite identique dans les champs brut et normalisé :
aucune conversion d'unité n'est faite. Les observations sont uniques par mapping,
géographie, période et dimensions. Une collecte identique actualise `collected_at` sans
créer de révision; une modification de valeur ou de provenance suit le déclencheur du
schéma et archive l'état précédent.

## Rapports ARPTC

Aucune API ARPTC n'est supposée. Un rapport fourni par l'équipe peut être enregistré
avec ses métadonnées et ses observations au moyen d'un fichier JSON local. Le manifeste
doit contenir :

- `document` : `title`, `originalUrl`, et éventuellement `documentCode`, `documentDate`,
  `language`, `mimeType`, `pageCount`, `fileChecksum`, `storageUri`.
- `observations` : tableau de lignes comprenant `indicatorCode`, `externalCode`,
  `geographyCodeSystem`, `geographyCode`, `periodStart`, `periodEnd`, `valueRaw`, et les
  champs facultatifs `unitRaw`, `valueNormalized`, `unitNormalized`,
  `normalizationRuleCode`, `normalizationVersion`, `dimensions`, `sourceRecordKey`,
  `pageStart`, `pageEnd`, `tableReference`, `sectionReference`.

Les observations non normalisées sont marquées `pending`; une valeur normalisée exige
simultanément sa valeur, son unité, son code de règle et sa version. Le document source
est enregistré avant les observations dans la même transaction, et chaque observation
référence ce document. Le mapping vers un indicateur et la géographie doivent être
résolus; aucun indicateur ou résultat statistique n'est inventé.

Valider un manifeste local sans écriture :

```powershell
npm.cmd --prefix backend run import:arptc -- --file chemin\vers\rapport.json --dry-run
```

Écrire explicitement :

```powershell
npm.cmd --prefix backend run import:arptc -- --file chemin\vers\rapport.json --apply
```

Le collecteur n'effectue pas le téléchargement des fichiers ARPTC. Vérifier les droits
d'utilisation, l'authenticité du document, les unités et les géographies avant import.

## Journaux, erreurs et tests

Le mode `--apply` écrit dans `collection_logs`. Les erreurs réseau réessayables sont
limitées à trois tentatives avec délais progressifs; les deadlocks et erreurs de
sérialisation SQL ont également un nombre limité de tentatives. Chaque article ou
observation est validé indépendamment pour les collectes automatisées; les erreurs
isolées sont comptées comme ignorées et entraînent un statut `partial`. L'import manuel
d'un rapport est atomique : une erreur annule ses insertions et conserve un journal
d'échec lorsque PostgreSQL reste disponible.

Concrètement, chaque article (article, alias URL et association à sa source) est validé
dans sa propre transaction, et chaque observation World Bank est validée séparément.
Un échec sur un élément n'annule donc pas les éléments précédemment validés; la collecte
continue et son journal indique `partial` si des éléments sont ignorés. Une erreur
globale du fournisseur est journalisée comme échec/partiel selon les éléments déjà
traités. Ce comportement partiel est intentionnel et n'est pas une transaction globale
de toute la collecte.

Exécuter les tests automatisés :

```powershell
npm.cmd --prefix backend test
```

Les tests automatisés ne contactent pas les fournisseurs et n'écrivent pas dans la base.
Le nombre d'éléments réel obtenu lors d'un test dépend de l'accessibilité et du contenu
des sources au moment de la collecte.

Pour une collecte périodique, planifier séparément les deux commandes `--apply` avec le
Planificateur de tâches Windows (ou le planificateur du serveur). Une fréquence de
plusieurs heures est appropriée pour cette V1; empêcher le chevauchement d'une même
tâche. GDELT reste protégé par le verrou local, même si deux processus de collecte
d'actualités sont lancés sur la même machine. Aucun planificateur n'est démarré par le
serveur Express.
