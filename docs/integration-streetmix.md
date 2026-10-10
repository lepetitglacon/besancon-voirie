# Intégration Streetmix

> **Objectif** : dessiner le profil en travers théorique d'un tronçon dans l'éditeur Streetmix,
> depuis l'appli, puis le garder (données + PNG) pour le comparer au réel et l'envoyer à SUMO.
> **Statut** : réalisé côté projet (worktree `streetmix`), fork Streetmix en cours ; rien n'est
> encore vérifié de bout en bout
> **Dernière mise à jour** : 2026-10-10

## Contexte

Sur un tronçon, un bouton « Profil Streetmix » ouvre un encart contenant l'éditeur Streetmix,
pré-rempli avec le profil actuel du tronçon. À l'enregistrement, l'appli récupère la liste des
segments (type, variante, largeur) et une image PNG du profil, et les rattache au tronçon.

- Le modèle `troncon` n'existe que sur les branches `reseau-voies` / `pipeline-donnees` (pas
  encore dans `main`). Tout ce document s'appuie dessus.
- Streetmix (<https://github.com/streetmix/streetmix>) : code AGPL-3.0-or-later, illustrations
  CC-BY-SA-4.0. Pas d'API d'intégration : aucun mode embed ni `postMessage` dans le client.
- La comparaison théorique / estimé (emprise par mode) et la variante « théorique » de
  l'export SUMO sont faites. La simulation de la ville, elle, passe toujours par `netconvert`
  directement depuis OSM : le réseau théorique n'existe qu'en export plain XML.

## Décisions

| # | Décision | Alternative écartée, et pourquoi |
|---|----------|----------------------------------|
| D1 | **Héberger un fork de Streetmix à côté** (serveur Node complet) et l'afficher dans une iframe, avec un petit pont `postMessage` ajouté au client. | *Utiliser streetmix.net* : chaque profil deviendrait une rue publique anonyme chez eux, l'iframe est refusée depuis `http://localhost` (CSP `frame-ancestors 'self' https:`), et ça contredit la règle « pas de service tiers à l'exécution » (`docs/ARCHITECTURE.md` §12). |
| D2 | Ne pas embarquer le code client de Streetmix dans notre front. | *Importer le client dans React* : un store Redux global, des écouteurs clavier et fenêtre globaux, `history.replaceState`, du CSS global. Irréaliste. *Servir seulement le client sous `/streetmix/` en émulant l'API dans Nest* : environ 15 chemins absolus à patcher, plus 6 routes dont le comportement n'est pas documenté (redirection 307, écho d'en-tête, migration de schéma côté serveur, remix au premier changement). Plus de travail pour économiser un seul process. |
| D3 | **Notre base est la source de vérité.** La base de l'instance Streetmix n'est qu'un brouillon jetable : à chaque ouverture, l'appli pousse la rue dans l'éditeur, puis la relit à l'enregistrement. | Stocker l'id de la rue Streetmix et la relire par son API : couplage à une base qu'on ne maîtrise pas, et remix anonyme qui change l'id. |
| D4 | **Le PNG est produit dans l'iframe** par le moteur de rendu du client (`getStreetImage`), puis transmis en `Blob`. | *Rendu serveur `packages/export-image`* : expérimental et incomplet (les segments ne sont pas dessinés, un cône de test apparaît sur chaque image). |
| D5 | L'éditeur ne sert qu'en **local**. En vitrine, le profil et le PNG restent visibles en lecture seule. | Déployer Streetmix en production : inutile tant que l'édition est réservée au local (`EditionGuard`, `EDITION_LOCALE=true`). |
| D6 | **Un profil peut servir à plusieurs tronçons** (relation N:1, avec un drapeau `inverse` par tronçon). | *Un profil par tronçon* : une avenue est coupée à chaque carrefour, feu ou passage piéton, ce qui obligerait à ressaisir dix fois le même profil. Et « ✂ Couper ici » devrait dupliquer le profil. |
| D7 | **Streetmix devient un service Docker Compose du projet**, `streetmix`, à côté de `db`. Son image est construite depuis le fork (URL git dans `build.context`). Il utilise sa propre base `streetmix`, dans le même conteneur Postgres ; l'image la crée et la migre elle-même au démarrage. Pas de second projet à faire tourner : `pnpm streetmix:up` suffit. Le clone local du fork ne sert qu'à modifier le pont. | *Paquet du workspace pnpm* : Streetmix est un monorepo npm avec son propre `package-lock` et ses outils (Parcel, Cypress, Docusaurus). Chaque `pnpm install`, dans chaque worktree, l'installerait. Les versions de React et d'autres dépendances entreraient en conflit, et l'arborescence stricte de pnpm casse les chemins `node_modules` que Streetmix suppose. *Sous-module git `vendor/streetmix`* : à initialiser et installer dans chaque worktree, pour une instance qui doit rester unique. *Subtree* : environ 1 900 fichiers importés dans notre historique. *Node lancé à la main depuis un clone voisin* : un second projet à installer, configurer et démarrer soi-même. |
| D8 | **Développer dans un worktree `streetmix` créé depuis la branche `pipeline-donnees`**, qui porte `noeud`, `troncon` et `exporterSumo`. | *Attendre la fusion de `pipeline-donnees` dans `main`* : bloque la feature sans raison, puisque le worktree récupérera la fusion plus tard. |

## Conception

### Parcours

1. Sur la carte (outil Sélection), clic sur un tronçon. La section **Profil en travers** de
   `PopupTroncon` montre la vignette du profil théorique, l'emprise par mode (théorique, estimée,
   écart) et le bouton **Dessiner dans Streetmix** (ou **Modifier dans Streetmix**).
2. Un encart (`Dialog` Chakra, taille `cover`) s'ouvre sur l'éditeur. L'en-tête rappelle le sens
   de lecture : « vu depuis le début du tronçon, dans le sens du tracé (>) », les chevrons de la
   carte donnant ce sens.
3. L'éditeur affiche le profil théorique s'il existe (retourné si le tronçon le lit depuis l'autre
   bout). Sinon, il affiche le profil estimé à partir du tronçon (voies, types, emprises, tags OSM
   de trottoirs et de stationnement).
4. L'utilisateur modifie le profil. **Enregistrer** est actif dès que l'éditeur est chargé : on
   peut garder tel quel le profil estimé comme théorique.
5. Enregistrer :
   - l'appli demande l'export à l'iframe et reçoit la rue et le PNG ;
   - si le tronçon lit le profil depuis l'autre bout, la rue est retournée dans le sens de
     référence, rechargée, et son PNG redessiné dans ce sens ;
   - l'appli envoie le tout à l'API ;
   - le tronçon (et, si la case est cochée, les tronçons voisins de la même rue) pointe sur le
     profil ;
   - la popup affiche la vignette.
6. Fermer avec des changements non enregistrés demande une confirmation.
7. **Détacher** : le tronçon ne suit plus le profil ; un profil que plus aucun tronçon ne suit
   est supprimé, avec son PNG.

### Architecture

```
Navigateur ─────────────────────────────────────────────────────────────────────────
 appli (localhost:5173)
   PopupTroncon ──[Profil Streetmix]──▶ EditeurStreetmix (Dialog)
                                          iframe localhost:8000 (fork Streetmix)
                          load ────────▶    embed_bridge.ts ─▶ store Redux du client
                          ◀──────── ready / changed / exported {street, PNG}
   Enregistrer ──▶ POST|PUT /api/profils   (multipart : rue JSON + image PNG)
────────────────────────────────────────────────────────────────────────────────────
 API Nest     ─▶ table profil, troncon.profil_theorique_id ; PNG dans data/profils/<id>.png
 engine       ─▶ tronconVersRue (profil estimé), miroirRue, rueVersVoies, appliquerProfils,
                 repartitionParMode (packages/engine/src/streetmix.ts)
 docker compose (projet besancon-voirie, partagé par tous les checkouts)
   db         ─▶ voirie, voirie_wt_*, et streetmix (brouillon, créée par le service streetmix)
   streetmix  ─▶ image construite depuis le fork, port 8000
```

- `localhost:5173` et `localhost:8000` sont *same-site* (le port ne compte pas). Le client
  Streetmix garde donc l'accès à son `localStorage` dans l'iframe. En production, il faudrait
  un sous-domaine du même site, mais ce n'est pas prévu (D5).
- Worktrees : le projet Compose a un nom fixe, donc un seul conteneur Streetmix sert `main` et
  tous les worktrees, comme le conteneur Postgres. Aucune installation n'est faite par worktree.
  L'instance ne garde rien d'utile, donc le partage ne pose pas de problème. Les origines
  `http://localhost:<port>` varient selon le worktree : le pont les accepte par motif.
- `pnpm db:up` ne démarre que `db` (le service est nommé dans la commande). Streetmix n'est
  utile que pour éditer un profil : on le démarre à part, avec `pnpm streetmix:up`.

### Protocole appli ↔ éditeur

Tous les messages ont la forme `{ channel: 'streetmix-embed', version: 1, type, … }`, en
anglais pour pouvoir proposer le pont à Streetmix. Chaque côté vérifie `event.origin` :
- le pont accepte un motif fourni à la compilation (`EMBED_ALLOWED_ORIGINS`, par défaut
  `^http://localhost:\d+$`) ;
- l'appli n'accepte que l'origine de `VITE_STREETMIX_URL`.

| Sens | `type` | Contenu | Effet |
|------|--------|---------|-------|
| éditeur → appli | `ready` | `{ schemaVersion }` | l'appli envoie `load` ; « version incompatible » si `schemaVersion` ≠ 35 |
| appli → éditeur | `load` | `{ street, name, locale: 'fr' }` | remplace la rue affichée, en gardant l'id de la rue brouillon |
| éditeur → appli | `loaded` | — | rue dessinée ; l'appli lève son voile de chargement |
| éditeur → appli | `changed` | `{ dirty }` | arme (ou désarme) la confirmation de fermeture |
| appli → éditeur | `export` | `{ requestId, labels: true, streetName: true, watermark: true, dpi: 2 }` | — |
| éditeur → appli | `exported` | `{ requestId, street, name, width, image: Blob }` | l'appli envoie le tout à l'API |
| éditeur → appli | `error` | `{ requestId?, message }` | rejette la demande en cours, notification |

Côté appli : [protocole.ts](../apps/web/src/reseau/streetmix/protocole.ts) et
[useEditeurStreetmix.ts](../apps/web/src/reseau/streetmix/useEditeurStreetmix.ts). Sans `ready`
dans les 20 s, Streetmix est tenu pour non lancé et l'encart affiche `pnpm streetmix:up` ; une
demande (`load`, `export`) sans réponse échoue au bout de 30 s.

### Convention d'orientation

Le profil se lit **depuis `noeud_de`, en regardant vers `noeud_vers`**, c'est-à-dire dans le
sens du tracé. Si `troncon.profil_inverse` est vrai, on le lit depuis `noeud_vers`.

```
                 noeud_vers
                     ▲
     arrière         │         avant
  (inbound : vient   │   (outbound : s'éloigne
   vers l'observateur)│    de l'observateur)
                     │
        observateur sur noeud_de

segments[] de gauche à droite :
  trottoir G │ arrière[n-1] … arrière[0] ║ avant[0] … avant[n-1] │ trottoir D
```

Le rang 0 de `types_avant` / `types_arriere` désigne la voie la plus à gauche dans son sens de
circulation, donc la plus proche de l'axe. Cela correspond bien à la circulation à droite, qui
est aussi la convention par défaut de Streetmix.

> ❓ **À confirmer** : `inbound` = vers l'observateur. Déduit du dessin des flèches, pas vérifié
> en lançant l'éditeur. Hypothèse retenue : oui. À contrôler à l'étape 2, sur une rue à sens unique.

### Modèle de données

```
profil
  id            uuid pk
  nom           text            -- « Av. Fontaine-Argent : projet 2027 »
  rue           jsonb not null  -- data.street Streetmix complet (schemaVersion 35), relu tel quel par `load`
  largeur_m     real  not null  -- somme des segments (affichage, filtres)
  image_le      timestamptz     -- date du PNG courant (null : pas d'image) ; sert à invalider le cache
  cree_le, modifie_le

troncon (+)
  profil_theorique_id  uuid null references profil(id) on delete set null
  profil_inverse       boolean not null default false
```

- On stocke la rue Streetmix entière, pas seulement les segments. Ainsi, rouvrir l'éditeur
  redonne exactement le même dessin (bâtiments, ciel, libellés). Le schéma zod ne valide que
  ce qu'on exploite : `schemaVersion`, `width` et, pour chaque segment, `type`, `variantString`,
  `width`, `elevation`. Le reste passe tel quel (`z.looseObject`).
- Le PNG est stocké sur disque (`data/profils/<id>.png`, réglage `PROFILS_DOSSIER`), comme les
  photos de l'IA. On n'utilise ni `bytea` ni S3.
- Le « réel » n'est pas stocké pour l'instant : il se calcule depuis le tronçon (§ Profil
  estimé). Si on relève un jour des profils sur le terrain, on ajoutera `troncon.profil_reel_id`.

### API (module `apps/api/src/profils/`)

| Route | Garde | Rôle |
|-------|-------|------|
| `GET /api/profils/troncon/:id` | — | profil théorique du tronçon (ou null) et son `inverse`, profil `estime`, `voisins` de la même rue (orientés par rapport au tronçon), `repartition` par mode (théorique, estimée) |
| `GET /api/profils/:id` | — | profil (rue, nom, largeur, URL de l'image, nombre de tronçons) |
| `GET /api/profils/:id/image?v=<image_le>` | — | le PNG (`StreamableFile`, cache d'un an grâce à `v`) |
| `POST /api/profils` | `EditionGuard` | multipart : `profil` (JSON : nom, rue, `troncons: [{ id, inverse }]`) et `image` (PNG, 8 Mo au plus) |
| `PUT /api/profils/:id` | `EditionGuard` | multipart ; remplace la rue et l'image, rattache en plus les `troncons` donnés |
| `DELETE /api/profils/:id/troncons/:troncon` | `EditionGuard` | détache le tronçon ; supprime le profil et son PNG si plus aucun tronçon ne le suit |

On passe par du multipart (`FileInterceptor`) parce que Nest limite les corps JSON à 100 kB, ce
qui exclut un PNG en base64. Le PNG est vérifié (type et signature). Le rattachement des
tronçons passe par ces routes, pas par le `PATCH` des tronçons : il n'entre pas dans
l'historique d'annulation de l'éditeur des voies. Schémas : [profil.ts](../packages/schema/src/profil.ts) ;
module : [apps/api/src/profils](../apps/api/src/profils).

**Voisins de la même rue** : depuis chaque bout du tronçon, on avance tant qu'un seul tronçon de
même `nom` prolonge le dernier (200 au plus) ; un embranchement ou une boucle arrête la marche.

### Profil estimé depuis un tronçon (`tronconVersRue`, `packages/engine`)

Cette fonction pure produit une rue Streetmix v35 à partir d'un tronçon. Elle sert au
pré-remplissage, puis de « réel » pour la comparaison.

| Source (tronçon) | Segment Streetmix | Largeur par défaut |
|------------------|-------------------|--------------------|
| voie `generale` | `drive-lane` `outbound\|car` (`inbound\|car` côté arrière) | emprise, sinon 3,0 m |
| voie `bus` | `bus-lane` `outbound\|colored\|typical` | emprise, sinon 3,5 m |
| voie `velo` | `bike-lane` `outbound\|regular\|road` | emprise, sinon 1,5 m |
| voie `tram` | `light-rail` `outbound\|regular` | emprise, sinon 3,0 m |
| tag `sidewalk=both\|left\|right\|separate\|yes` (ou `sidewalk:left\|right\|both`) | `sidewalk` `normal`, hauteur 0,15 m | `sidewalk:*:width`, sinon 1,8 m |
| aucun tag `sidewalk*`, rue de ville (`primary` → `unclassified`, `residential`) | trottoir des deux côtés | 1,8 m |
| tags `parking:left\|right\|both` = `lane`, `street_side`, `on_kerb`, `half_on_kerb`, `shoulder` (ou l'ancien `parking:lane:*`) | `parking-lane` : en long `inbound\|left` / `outbound\|right` (sens de la voie voisine), en bataille `sideways\|…`, en épi `angled-front-…` | 2,0 m (épi, bataille : 3,0 m) |

- Les côtés gauche et droite des tags OSM se lisent dans le sens de la voie OSM. Le tronçon est
  dans le même sens si, sur la géométrie de `osm_way`, son point de départ se projette avant son
  point d'arrivée (`ST_LineLocatePoint`) ; sinon, gauche et droite s'échangent. Sans table
  `osm_way`, même sens supposé.
- Bordures : `residential`, 3 étages. Le catalogue complet des segments est dans
  `packages/parts/data/segment-lookup.yaml` (dépôt Streetmix).

### Conversion vers SUMO (`rueVersVoies`, `appliquerProfils`, `packages/engine`)

`rueVersVoies(rue, inverse)` lit `segments[]` de gauche à droite (après `miroirRue` si le tronçon
lit le profil depuis l'autre bout) et range chaque segment de circulation dans le sens avant
(`outbound`) ou arrière (`inbound`), rang 0 = la voie la plus à gauche pour qui y circule :
l'ordre gauche → droite pour l'avant, droite → gauche pour l'arrière. Les rangs suivent ainsi la
convention des tronçons, et l'export existant les numérote pour SUMO (index = n − 1 − rang).

`appliquerProfils` remplace, pour chaque tronçon profilé, `voies_avant` / `voies_arriere`, leurs
types et leurs largeurs (prioritaires sur les emprises) ; `exporterSumo(reseau, { variante:
'theorique' })` l'appelle avant d'écrire. Les liaisons et les jonctions des carrefours
fonctionnent alors sans changement sur les nouvelles voies.

| Streetmix | Type de voie → SUMO |
|-----------|---------------------|
| `drive-lane` (toutes variantes), `turn-lane` | `generale` → voie sans `allow` |
| `bus-lane`, `brt-lane` | `bus` → `allow="bus"` (comme l'export réel) |
| `streetcar`, `light-rail`, `train` | `tram` → `allow="tram"` |
| `bike-lane` (inbound / outbound), `scooter` | `velo` → `allow="bicycle"` |
| `bike-lane` `twoway-*` | une voie vélo de demi-largeur dans chaque sens, avec une alerte dans l'export |
| `sidewalk`, `sidewalk-*`, `street-vendor`, `outdoor-dining`, `bikeshare`, `utilities`, `parklet` | pas une voie : largeur de la zone piétonne de chaque côté de la chaussée, en `<param key="voirie.trottoir">` |
| `parking-lane`, `flex-zone` le long de la chaussée | pas une voie : `<param key="voirie.stationnement" value="true">` |
| `divider`, `transit-shelter`, `brt-station`, mobilier, végétation | pas une voie |

- Les `<param>` vont sur le côté droit de chaque sens (à droite du profil pour l'arête avant, à
  gauche pour l'arête arrière), avec `voirie.profil`. Les piétons ne sont simulés dans aucune
  des deux variantes : les trottoirs n'y sont que notés.
- Un profil sans voie de circulation laisse au tronçon ses voies réelles (alerte).
- Aux nœuds dont un tronçon change de voies, les liaisons saisies laissent place aux proposées.
- Accès : `GET /api/reseau/sumo/:fichier?variante=theorique`, `pnpm reseau:sumo --theorique`,
  et la case « Voies théoriques (profils Streetmix) » sous les liens d'export du mode réseau.
- Piste possible : les flèches des `turn-lane` (gauche, tout droit…) pourraient proposer les
  liaisons voie à voie par défaut aux nœuds.

> ❓ **À confirmer** : couloirs bus ouverts aux taxis et aux vélos ? Hypothèse retenue : comme
> l'export réel, bus seuls (`allow="bus"`).

### Comparaison théorique / estimé

- La popup compare la **répartition de l'emprise par mode** (`repartitionParMode`) : piétons,
  vélos, voitures, bus, tram, stationnement, végétal, autre, en mètres, avec l'écart. Contrairement
  à un diff segment par segment, cette mesure ne dépend pas de l'ordre des segments. L'espace
  laissé libre entre façades n'est pas compté.
- Pas encore fait : le rendu côte à côte du profil estimé (il faudrait le dessiner par l'iframe,
  avec `load` puis `export`), et un profil réel relevé sur le terrain (`troncon.profil_reel_id`).

## Prérequis

- [ ] Un worktree `streetmix` créé depuis la branche `pipeline-donnees` (D8), avec l'outil
  `create_worktree` du Nevven Worktree Manager, jamais `git worktree` à la main. Sa base
  `voirie_wt_streetmix` est créée par `pnpm db:prepare` au démarrage du worktree.
- [ ] Un fork GitHub de `streetmix/streetmix` (action à faire soi-même sur GitHub). Il doit rester
  public : l'AGPL impose de publier le code modifié.
- [ ] Docker, déjà requis pour `db`. Node ≥ 24.10 seulement pour lancer le fork hors Docker
  pendant qu'on écrit le pont : le projet exige déjà Node ≥ 24 (`v24.13.1` installé).

## Étapes

### Étape 1 — Forker et cloner Streetmix

Le fork vit sur GitHub, dans une branche dédiée. En usage normal, le projet le récupère par son
URL git (étape 4) : rien à cloner. Le clone local ne sert qu'à modifier le pont ; on le place
hors du monorepo, pour qu'aucun worktree ne l'installe.

**État** : clone fait dans `~/PhpstormProjects/streetmix`, depuis le dépôt d'origine de Streetmix
(`origin` = `streetmix/streetmix`), branche `integration-voirie`. Reste à créer le fork sur GitHub
(bouton *Fork* de <https://github.com/streetmix/streetmix>), puis à y pousser la branche :

```bash
git -C ~/PhpstormProjects/streetmix remote rename origin upstream
```

```bash
git -C ~/PhpstormProjects/streetmix remote add origin git@github.com:lepetitglacon/streetmix.git
```

```bash
git -C ~/PhpstormProjects/streetmix push -u origin integration-voirie
```

**Résultat attendu** : `https://github.com/lepetitglacon/streetmix/tree/integration-voirie`
existe ; sans `STREETMIX_SRC`, `pnpm streetmix:build` construit depuis cette URL.

### Étape 2 — Écrire le pont d'intégration dans le fork

**État** : fait, commit `2dd9ea2` du clone. Non vérifié : l'agent qui l'a écrit a été arrêté
avant de rendre son rapport, et rien n'a été testé depuis.

Le patch reste petit, pour se réappliquer facilement à chaque mise à jour de Streetmix :
- nouveau fichier `client/src/integrations/embed_bridge.ts` (environ 120 lignes), qui implémente
  le protocole ci-dessus :
  - `load` : `updateStreetData` puis `updateEverything(true)` ;
  - `changed` : relaie l'évènement `stmx:save_street` ;
  - `export` : `packServerStreetDataRaw()` et `getStreetImage(…)` puis `canvas.toBlob` ;
- un appel depuis `onEverythingLoaded` (`client/src/app/initialization.js`, vers la ligne 102),
  actif seulement dans une iframe et si `EMBED_ALLOWED_ORIGINS` est défini ;
- l'ajout des origines autorisées à `frameAncestors` (`app.ts`), lues dans `FRAME_ANCESTORS`
  (sources CSP séparées par des espaces) ; pas d'`upgrade-insecure-requests` quand
  `APP_PROTOCOL=http` ; `PGSSLMODE=disable` pour une base sans SSL en production
  (`app/db/config/config.ts`) ;
- en mode intégré : jamais de remix au premier changement (`client/src/streets/remix.ts`), et
  les segments réservés aux comptes (piste bidirectionnelle, `brt-lane`…) débloqués dans la
  palette et les variantes (`PaletteItem.tsx`, `VariantButton.tsx`).

Pour itérer, on lance le fork directement depuis le clone (`CYPRESS_INSTALL_BINARY=0 npm install`
puis `npm start`), le service Compose étant arrêté. Ce clone se branche sur la base `streetmix`
créée par le service : `DATABASE_URL=postgres://voirie:voirie@localhost:5433/streetmix` dans le
`.env` du clone.

**Résultat attendu** : dans une page de test contenant l'iframe, `load` affiche la rue envoyée
et `export` renvoie un PNG lisible.

### Étape 3 — Ajouter l'image Docker au fork

**État** : fait (commit `2dd9ea2`). L'image s'est construite depuis le clone
(`streetmix-voirie:local`, 1,76 Go). Le conteneur n'a pas été vérifié.

Streetmix n'a ni Dockerfile ni docker-compose (seulement Heroku). Le fork ajoute :

- `Dockerfile`, en deux étapes, sur `node:24-bookworm-slim` :
  - `npm ci` (sans Cypress ni Husky) ;
  - compilation des paquets `types`, `utils`, `i18n`, `parts` (YAML → JSON) et `export-image` ;
  - compilation du client par `parcel build`, sans le `postbuild` Sentry qui échoue sans jeton ;
    `OFFLINE_MODE`, `EMBED_ALLOWED_ORIGINS` et `PARCEL_WORKERS` passés en `ARG`, car Parcel les
    inscrit dans le bundle ;
  - suppression des espaces `client` et `docs` et des dépendances de développement.
- Valeurs de l'image :
  - `NODE_ENV=production`, pour que la CSP et donc `FRAME_ANCESTORS` s'appliquent ;
  - `PORT=8000`, `APP_DOMAIN=localhost:8000`, `PROTOCOL=APP_PROTOCOL=http`,
    `FRAME_ANCESTORS=http://localhost:*`, `PGSSLMODE=disable` ;
  - `AUTH0_*` factices : le client Auth0 est construit dès l'import, la connexion reste
    indisponible.
  - Elle tourne sous l'utilisateur `node`, avec un `HEALTHCHECK` HTTP en Node.
- `docker/entrypoint.sh`, idempotent, à chaque démarrage :
  1. attend la base de `DATABASE_URL` (jusqu'à `DB_WAIT_TIMEOUT=60` s) ;
  2. la crée si elle n'existe pas, par la base de maintenance `postgres` ;
  3. applique les migrations Sequelize (dont l'extension PostGIS) ;
  4. démarre le serveur (`node index.ts`).

**Résultat attendu** : le conteneur lancé seul affiche l'éditeur sur `/new?type=empty`.

### Étape 4 — Déclarer le service `streetmix` dans le projet

**État** : fait, pas lancé.

Dans [docker-compose.yml](../docker-compose.yml), on ajoute un service à côté de `db`. Son
contexte de compilation est une URL git ou un chemin absolu, jamais un chemin relatif (même
contrainte que pour `db`) :

```yaml
  streetmix:
    build:
      context: ${STREETMIX_SRC:-https://github.com/lepetitglacon/streetmix.git#integration-voirie}
      args:
        OFFLINE_MODE: "true"
        EMBED_ALLOWED_ORIGINS: '^http://localhost:\d+$$'
    image: besancon-voirie-streetmix
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-voirie}:${POSTGRES_PASSWORD:-voirie}@db:5432/streetmix
      FRAME_ANCESTORS: http://localhost:*
    ports:
      - "${STREETMIX_PORT:-8000}:8000"
```

Le `HEALTHCHECK` de l'image suffit à `--wait`. Le `.env` du worktree `streetmix` contient
`STREETMIX_SRC=/home/esteban/PhpstormProjects/streetmix`, tant que le fork n'est pas poussé.

Scripts racine dans `package.json` :
- `streetmix:up` : `docker compose up -d --wait streetmix` ;
- `streetmix:build` : `docker compose build --pull streetmix`, après une mise à jour du fork ;
- `streetmix:purge` : supprime les rues brouillons de plus de 7 jours.

Dans `.env.example`, on ajoute `VITE_STREETMIX_URL=http://localhost:8000`, et `STREETMIX_SRC`
en commentaire. Ce réglage pointe sur le clone local, pour tester une image construite depuis
du code non poussé.

**Résultat attendu** : depuis un checkout neuf, `pnpm streetmix:up` construit l'image, crée la
base et sert l'éditeur sur `http://localhost:8000/new?type=empty`, sans menu connexion ni
partage. Depuis un worktree, la même commande réutilise le conteneur existant.

### Étape 5 — Créer la table `profil` et les colonnes du tronçon

**État** : fait. Schéma Drizzle selon § Modèle de données, migration
`20261010142857_profils_streetmix.sql` (pas de colonne géométrique, donc pas de SRID à corriger),
appliquée sur `voirie_wt_streetmix`.

```bash
pnpm db:verifier
```

**Résultat attendu** : « 0 en attente », journal cohérent.

### Étape 6 — Écrire les schémas zod du profil

**État** : fait. [profil.ts](../packages/schema/src/profil.ts) : `RueStreetmix`, `NouveauProfil`,
`ModificationProfil`, `Profil`, `ProfilTroncon` ; `TronconResume` gagne `profil_theorique_id` et
`profil_inverse` ; `VarianteSumo` dans [reseau.ts](../packages/schema/src/reseau.ts).

### Étape 7 — Écrire le moteur des profils dans `packages/engine`

**État** : fait, tests écrits, pas encore lancés. [streetmix.ts](../packages/engine/src/streetmix.ts) :
`tronconVersRue`, `miroirRue`, `rueVersVoies`, `repartitionParMode`, `largeurRue` ;
[streetmix.spec.ts](../packages/engine/src/streetmix.spec.ts) : double sens avec bus et vélo, tags
de trottoir et de stationnement dans les deux sens OSM, emprise, miroir (dont le tourne-à-gauche),
voies et trottoirs d'un profil, répartition, export théorique.

### Étape 8 — Exposer l’API `profils`

**État** : fait. Selon § API ; dans [reseau.service.ts](../apps/api/src/reseau/reseau.service.ts),
la coupe copie le profil sur la seconde moitié, l'inversion bascule `profil_inverse`, la fusion
de deux tronçons garde le profil du tronçon conservé (sinon celui de l'autre), réorienté.

### Étape 9 — Ajouter l’encart Streetmix au front

**État** : fait, pas encore vérifié avec l'éditeur. Dans
[apps/web/src/reseau/streetmix](../apps/web/src/reseau/streetmix) :
- `protocole.ts` (messages, `URL_STREETMIX` lue dans `VITE_STREETMIX_URL`) et
  `useEditeurStreetmix.ts` (attente de `ready`, `charger`, `exporter`, suivi de `changed`) ;
- `EditeurStreetmix.tsx` : le `Dialog`, le nom du profil, la case « appliquer aux voisins » ;
- `SectionProfil.tsx` : la section de `PopupTroncon` (vignette, emprise par mode, boutons).

À côté :
- `api.ts` envoie le multipart ;
- `vite.config.ts` lit les `VITE_*` dans le `.env` de la racine (`envDir`) ;
- les raccourcis de la carte se taisent quand le focus est dans une fenêtre modale
  ([clavier.ts](../apps/web/src/configuration/clavier.ts)) ;
- le corps des popups de carte défile au-delà de 62 % de la hauteur d'écran
  ([recettes-projet.ts](../apps/web/src/theme/recettes-projet.ts)), pour garder le pied
  d'actions visible.

**Résultat attendu** : le parcours § Parcours fonctionne de bout en bout sur un tronçon réel.

### Étape 10 — Propager le profil lors des coupes et inversions

**État** : fait (étape 8 pour l'API, case « Appliquer aussi aux N tronçon(s) voisin(s) » dans
l'encart, cochée par défaut pour un nouveau profil).

### Étape 11 — Écrire la variante théorique de l'export SUMO

**État** : fait, sans `netconvert` lancé dessus. Selon § Conversion vers SUMO. La simulation de
la ville passe toujours par `netconvert` directement depuis OSM : la variante théorique n'existe
qu'en export plain XML, en attendant que l'export du réseau serve à la simulation.

**Résultat attendu** : `netconvert -c reseau.netccfg` accepte le réseau théorique, et les voies
d'un tronçon profilé correspondent au tableau.

### Étape 12 — Comparer théorique et estimé

**État** : fait pour l'emprise par mode (§ Comparaison) ; le rendu côte à côte reste à faire.

## Vérification finale

- [ ] Sur un tronçon sans profil, l'éditeur s'ouvre sur le profil estimé, orienté dans le sens
  des chevrons de la carte.
- [ ] Enregistrer crée le profil, et la vignette s'affiche. Rouvrir redonne exactement la même rue.
- [ ] Les deux moitiés d'un tronçon coupé partagent le profil. Un tronçon inversé se lit toujours
  dans le bon sens.
- [ ] Sans `VITE_STREETMIX_URL`, le bouton n'apparaît pas. En vitrine, la vignette est visible
  mais l'édition est absente.
- [ ] Streetmix arrêté : l'encart l'indique au bout de 20 s, sans planter.
- [ ] Tests lancés une fois, à la fin : `pnpm test` (dont `streetmix.spec.ts`).

## Pièges & précisions

- Si l'éditeur part sur une rue « (remix) » au premier changement → c'est le cas d'une rue
  anonyme qui n'a pas été créée dans la session → toujours ouvrir l'iframe sur
  `/new?type=empty`, puis envoyer `load`.
- Si on met à jour le fork et que `schemaVersion` passe à 36 → `load` ne migre rien : seul le
  serveur Streetmix migre (`app/lib/street_schema_update.js`) → migrer les `profil.rue` stockés
  avec ce module avant d'ouvrir l'éditeur. Le message `ready` signale l'écart.
- Si le profil théorique change le nombre de voies d'un tronçon → les `noeud.liaisons` saisies
  aux nœuds voisins peuvent viser des voies qui n'existent pas → en variante théorique, revenir
  aux liaisons par défaut pour ces nœuds.
- Si la base `streetmix` grossit → chaque ouverture crée une rue brouillon → purge périodique
  avec `pnpm streetmix:purge` (`DELETE FROM "Streets" WHERE created_at < now() - interval '7 days'`).
- Si `pipeline-donnees` reçoit une nouvelle migration après celle de `profil` → au merge,
  `drizzle-kit migrate` ignore sans message la migration la plus ancienne → avant chaque merge,
  fusionner la branche cible dans le worktree, puis `pnpm db:verifier voirie`, et re-dater la
  migration `profil` si besoin (procédure de `CLAUDE.md` et de [worktrees.md](worktrees.md)).
- Si l'iframe perd son stockage ou reste blanche → l'appli et l'éditeur ne sont plus same-site
  (domaines différents) → garder `localhost` des deux côtés.
- Si l'envoi échoue avec une erreur 413 → PNG envoyé en JSON → passer par le multipart.
- Si le réseau est ressemé (« Réinitialiser depuis OSM ») → les tronçons sont recréés sans
  profil → les profils restent en base sans tronçon ; les rattacher de nouveau depuis l'encart.
- Si le bouton de l'éditeur est grisé → `VITE_STREETMIX_URL` absent du `.env` de la racine, ou
  le serveur web lancé avant de l'ajouter → l'ajouter, puis relancer le serveur web.
- Licences : le fork modifié doit rester public (AGPL, ce qui est déjà le cas avec un fork
  GitHub). Les PNG contiennent des illustrations CC-BY-SA : garder le filigrane « Made with
  Streetmix », ou créditer Streetmix à côté de l'image.

## Références

- Streetmix (dépôt, commit `b7a00ed` du 2026-10-05) :
  - `client/src/app/initialization.js` : démarrage, `onEverythingLoaded`
  - `client/src/streets/xhr.ts` : sauvegarde automatique, `remixOnFirstEdit` (l. 309-319)
  - `client/src/streets/image.ts` : `getStreetImage` ; `client/src/streets/thumbnail.ts` : dessin
  - `client/src/app/page_url.ts` : forme des URL (`/new?type=…`, `/-/<n>`)
  - `app.ts` : CSP et `frameAncestors` (l. 128) ; `.env.example` : réglages
  - `packages/types/src/index.ts` : `StreetJson`, segments ; `packages/parts/data/segment-lookup.yaml` : catalogue
- Besançon Voirie (worktree `streetmix`) :
  - [schema.ts](../apps/api/src/db/schema.ts) : `noeud`, `troncon`, `profil`
  - [streetmix.ts](../packages/engine/src/streetmix.ts) : profil estimé, miroir, voies, répartition
  - [sumo.ts](../packages/engine/src/sumo.ts) : `exporterSumo`, `appliquerProfils`
  - [apps/api/src/profils](../apps/api/src/profils) : API des profils
  - [apps/web/src/reseau/streetmix](../apps/web/src/reseau/streetmix) : encart, section de popup, protocole
  - [RESEAU.md](RESEAU.md) : semis OSM, export SUMO, routes
- [docs/poc-sumo.md](poc-sumo.md) : réseau SUMO de la ville (décision S7)

## Journal

- 2026-10-10 — création (conception : architecture, protocole, modèle, conversion SUMO, plan en 11 étapes)
- 2026-10-10 — D7 : Streetmix en service Docker Compose construit depuis le fork (ni workspace pnpm, ni sous-module) ; étapes 3 (image Docker) et 4 (service Compose) ajoutées, plan renuméroté en 12 étapes
- 2026-10-10 — profil partagé entre tronçons confirmé (D6) ; D8 : worktree `streetmix` créé depuis `pipeline-donnees` ; piège sur l’ordre des migrations au merge
- 2026-10-10 — réalisation côté projet (étapes 5 à 12) : table `profil`, moteur, API, encart, section de popup, variante théorique de l'export ; protocole complété (`loaded`, `requestId`) ; conversion SUMO alignée sur les types de voie de l'export ; rien de vérifié de bout en bout
- 2026-10-10 — fork : pont, serveur et image Docker faits (commit `2dd9ea2`, image construite), étapes 1 à 4 complétées ; fork GitHub et push restent à faire ; purge corrigée (table `"Streets"`)
