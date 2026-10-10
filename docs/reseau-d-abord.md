# Réseau d'abord : modèle cible et jeu de données de référence

> **Objectif** : passer de « les carrefours d'abord, les rues raccordées autour » à un graphe de
> toute la ville à la TM:PE, semé une fois depuis OSM puis corrigé sur la photo IGN, où un
> carrefour est un groupe de nœuds qu'on configure.
> **Statut** : en cours (étapes 1 à 6 et 8 faites sur `reseau-voies` ; 3, 7 et 9 à faire)
> **Dernière mise à jour** : 2026-09-27

## Contexte

Avant ce chantier, deux modèles coexistaient :

- **`main` : le carrefour d'abord.** Un carrefour, composé à la main à partir de ses feux, avait
  des branches et des voies dessinées sur la photo (`branche`, `voie`, `connexion`) ; entre deux
  carrefours, rien que `osm_way` brut. Les giratoires étaient une boucle de nœuds rangée dans le
  carrefour (`carrefour.anneau`, branches générées `R1`, `R2`…).
- **`reseau-voies` : un réseau raccordé à des boîtes noires.** `noeud` / `troncon` générés depuis
  OSM, et chaque carrefour réduit à un nœud en son centre, les rues coupées sur un cercle et
  « raccordées » à ses branches.

Désormais le graphe est la base : routes, pistes cyclables, feux et passages piétons sont semés
depuis OSM ; on compose un carrefour comme avant, en choisissant ses feux, et il prend les nœuds
qui se trouvent parmi eux ; tout se corrige sur la photo IGN, à la TM:PE. Le détail est dans
[RESEAU.md](RESEAU.md).

Hors périmètre : programme des feux dans SUMO (`versTlLogic`), demande de trafic.

## Décisions

| # | Décision | Alternative écartée | Raison |
|---|---|---|---|
| R1 | Le **réseau est la base** ; un carrefour est un **groupe de nœuds** du réseau, avec ses feux, ses lignes et son programme | Carrefour en boîte noire raccordée sur un cercle | Un seul modèle voie à voie de bout en bout ; chaussées séparées et giratoires sont naturellement plusieurs nœuds. C'est le modèle d'OSM, de TM:PE (feux temporisés sur plusieurs nœuds) et de SUMO (feux joints). |
| R2 | Réseau **semé une fois** depuis un instantané OSM, puis **propriété du projet** ; une nouvelle version d'OSM passera par une **réconciliation** relue | Régénérer à chaque import en gardant les tronçons marqués `modifie` | Liaisons, lignes de feux et carrefours pointent vers des identifiants, qui doivent rester stables. |
| R3 | Les voies d'un tronçon sont **déduites** de son axe ; le détail d'un carrefour s'obtient en **coupant** les tronçons : la **ligne d'arrêt est un nœud à feux**, le début d'une présélection un nœud entre deux tronçons de voies différentes | Géométrie libre par voie ; recul réglable au bout de chaque tronçon | Comme TM:PE et SUMO. Le feu véhicule OSM est déjà sur la voie pour 254 feux sur 359 : la ligne d'arrêt vient avec le semis. |
| R4 | `branche` / `voie` / `connexion` restent, **écrites par le serveur** d'après le graphe (vue calculée), pour un carrefour qui a des nœuds | Réécrire d'un coup moteur, lignes, programme, temps réel et IA | Lignes de feux, conflits, programme et temps réel marchent sans changement. Un carrefour sans nœud garde ses branches saisies à la main (tests, réseau non semé). |
| R5 | Le semis prend les **routes, pistes cyclables, feux et passages piétons** ; la **composition** reste le choix des feux, et le carrefour prend les **nœuds parmi eux** (enveloppe des feux + 8 m, tout l'anneau d'un giratoire), ajustables à la main | Détection automatique des carrefours | Décision 009 : un carrefour = un contrôleur, ce qu'aucune distance ne devine. |
| R6 | Feu véhicule (`highway=traffic_signals`) = **ligne d'arrêt** ; feu piéton (`crossing=traffic_signals`) = **passage piéton à feux** | Tout feu OSM est une ligne d'arrêt | Sur les vrais carrefours, le passage piéton à feux est entre la ligne d'arrêt et l'intersection : le traiter en ligne d'arrêt coupait chaque approche en deux branches. |
| R7 | Vu de l'éditeur, un carrefour est une **boîte noire** : ses **connexions vont d'une voie entrante à une voie sortante** (outil Liaison de son calque, comme un carrefour dessiné à la main), **proposées** d'après les liaisons de ses nœuds, puis **saisies** et gardées quand le réseau change ; son cœur (nœuds et tronçons entre les lignes d'arrêt) n'est ni dessiné voie par voie ni relié nœud par nœud | Connexions déduites des liaisons de chaque nœud du groupe, dessinées selon leur tracé à travers les nœuds | Sur un carrefour de 10 à 20 nœuds, les liaisons nœud par nœud étaient illisibles et régler un mouvement demandait de retoucher plusieurs nœuds. C'est aussi ce que fait SUMO avec des nœuds joints. |

## Correspondances

| TM:PE | SUMO | OSM | Ici |
|---|---|---|---|
| Segment | `edge` | way, entre deux intersections | tronçon |
| Node | `junction` | nœud partagé, feu, passage | nœud |
| Lane | `lane` | `lanes`, `lanes:forward`, `cycleway*` | voie d'un tronçon (sens, rang, type) |
| Lane connector | `connection` | `turn:lanes` (indirectement) | liaison au nœud |
| Junction restrictions | `prohibition` | `restriction=*` | liaison absente |
| Timed traffic lights (plusieurs nœuds) | `tlLogic` sur des jonctions jointes | `highway=traffic_signals` | carrefour : nœuds + feux + lignes + programme |

## Jeu de données stable : les couches

```text
 1. Instantané OSM daté     osm_* (brut, régénérable)          data/osm/besancon.json, osm_meta.timestamp_osm_base
        │  semis, une seule fois (pnpm reseau:semer)
        ▼
 2. Réseau de référence     noeud, troncon + provenance OSM    corrigé à la main, identifiants stables
        │                        ▲
        │                        └── réconciliation relue, à chaque nouvel instantané OSM (à faire)
        ▼
 3. Configuration           carrefour (nœuds + feux), ligne_feux, plan_feux, top_synchro…
        │
        ▼
 4. Dérivés                 vue carrefour (branche, voie, connexion, écrites par le serveur), export SUMO
```

- **Provenance** : chaque tronçon garde `osm_way_id`, `osm_de`, `osm_vers` et les tags lus au
  semis (`osm_tags`), chaque nœud son `osm_node_id`.
- **Instantané** : celui du semis actuel date du 2026-09-27 à 16:52 UTC (import `--refresh` fait
  pour les pistes cyclables et les passages piétons).
- **Sauvegarde** :

  > ❓ **À confirmer** : versionner un export du jeu de référence dans git, ou se contenter de
  > sauvegardes `pg_dump` datées ? Hypothèse retenue : `pg_dump` daté dans `data/sauvegardes/`
  > (non versionné) avant chaque réconciliation et chaque fusion dans `main`.

## Prérequis

- [ ] Copie automatique de `voirie` dans les worktrees commitée sur `main` (`apps/api/scripts/prepare-db.ts`)

## Étapes

### Étape 1 — Fusionner `main` dans `reseau-voies` en retirant le raccordement au cercle ✅

Fait (`4fb7b34`) : configuration des carrefours reprise de `main`, raccordement retiré, une seule
migration du réseau datée après celles de `main`.

### Étape 2 — Semer le réseau une seule fois ✅

Fait (`174b7b8`) : `pnpm reseau:semer` (refus d'un second semis, `--reinitialiser`), import OSM
étendu aux pistes cyclables et aux passages piétons, découpe aux feux et aux passages, voies
vélo et bus typées, provenance OSM.

```bash
pnpm osm:import --refresh && pnpm reseau:semer
```

**Résultat attendu** : `{ noeuds: 11313, troncons: 13036, feux: 360, pieton: 3309, cyclables: 978 }`
à l'instantané du 27/09/2026 ; un second lancement renvoie 409.

### Étape 3 — Écrire la réconciliation OSM ⏳

`pnpm reseau:reconcilier` compare `osm_way` au réseau : il applique les cas automatiques et
remplit une liste « Changements OSM » à relire sur la carte. D'abord une version qui liste sans
rien écrire (`--simulation`).

| Cas | Traitement |
|---|---|
| Tags changés (`lanes`, `maxspeed`, `oneway`, `name`, `cycleway*`), tronçon jamais corrigé et hors carrefour | appliqué automatiquement |
| Tags changés sur un tronçon corrigé ou dans un carrefour | proposé dans la liste |
| Voie OSM disparue | tronçon signalé, jamais supprimé automatiquement |
| Nouvelle voie OSM | proposée comme tronçon à ajouter, avec ses raccords |
| Voie recoupée ou retracée dans OSM (nœuds changés) | appariée par la géométrie (moins de 5 m d'écart), sinon signalée |

**Résultat attendu** : sur l'instantané qui a servi au semis, 0 changement.

### Étape 4 — Faire du carrefour un groupe de nœuds ✅

Fait (`174b7b8`) : `noeud.carrefour_id` non unique ; à la composition, nœuds libres parmi les
feux (et tout l'anneau d'un giratoire) ; outil Nœuds et popup du nœud pour ajuster.

### Étape 5 — Lignes d'arrêt et voies d'approche ✅

Fait (`174b7b8`, `5ac6df7`) autrement que prévu (R3) : la ligne d'arrêt est un nœud à feux,
proposé par OSM, déplaçable, et l'outil Couper en pose un (ou le début d'une présélection) ;
types de voies par tronçon ; passage piéton par nœud.

### Étape 6 — Calculer la vue carrefour pour le moteur ✅

Fait (`174b7b8`) : `vueCarrefour`, écrite dans `branche` / `voie` / `connexion` à chaque
modification du réseau autour. Les tables restent (R4). Depuis R7, les connexions sont proposées
d'après les liaisons des nœuds tant qu'elles n'ont pas été saisies (`carrefour.connexions_saisies`),
et dessinées en courbe d'une voie à l'autre.

**Résultat attendu** : Boulevard Léon Blum × Rue Frédéric Chopin (chaussées séparées, 18 nœuds)
donne 9 branches, 43 connexions, et les conflits de ses lignes proposées.

### Étape 7 — Réorienter la proposition IA vers le graphe ⏳

Aujourd'hui l'IA (et la détection OSM, et l'import JSON) ne servent qu'aux carrefours sans nœud.
La consigne doit envoyer les tronçons d'approche et les nœuds du carrefour ; la réponse donner,
par tronçon, les voies, leurs types, la ligne d'arrêt et le début de présélection, et par nœud
les liaisons ; le serveur l'applique comme une saisie à la main (coupes, types, liaisons).

### Étape 8 — Exporter les carrefours en feux joints vers SUMO ✅

Fait (`4fb7b34`) : tous les nœuds d'un carrefour partagent `tl="c<carrefour>"`. Reste
`versTlLogic` (programme relevé → `tlLogic`), prévu en phase 2.

```bash
pnpm reseau:sumo && cd data/sumo && netconvert -c reseau.netccfg
```

### Étape 9 — Joindre les nœuds d'un carrefour dans l'export SUMO ✅ (à vérifier avec netconvert)

Fait sur `pipeline-donnees` autrement que prévu : pas de `<join>`, mais une jonction
`c<carrefour>` écrite par l'export à la place des nœuds du **cœur** (au-delà des lignes
d'arrêt) ; les approches restent des arêtes, ses connexions deviennent les liens de la jonction,
son programme un `<tlLogic>` (`reseau.tll.xml`, [RESEAU.md §5](RESEAU.md#5-export-sumo)).
L'identifiant du feu est connu d'avance, sans dépendre du `cluster_…` de netconvert.

Plan d'origine, pour mémoire :

- `nod.xml` : `<join nodes="…"/>` des nœuds de chaque carrefour (netconvert en fait une seule
  jonction et retire les tronçons du cœur) ;
- `con.xml` : chaque connexion, de l'arête qui arrive à la branche (le tronçon de la ligne
  d'arrêt, suivi vers l'extérieur jusqu'au bord du carrefour) à celle qui en repart ; les
  branches internes (R1…) se composent (O → R1 puis R1 → E donne O → E).

**Résultat attendu** : netconvert construit une jonction par carrefour, avec exactement les
liaisons vues dans son calque. netconvert n'est pas installé sur le poste : à vérifier avant de
s'appuyer sur `<join>` (identifiant `cluster_…`, feu gardé).

## Vérification finale

- [x] Aucune trace de `raccordement`, `horsDuCercle`, `liens_de` dans le code
- [x] `pnpm reseau:semer` refuse un second semis
- [ ] `pnpm reseau:reconcilier --simulation` : 0 changement sur l'instantané du semis
- [x] Un carrefour à chaussées séparées configuré sur le réseau (branches, lignes proposées, conflits)
- [ ] Un giratoire et une traversée piétonne configurés de bout en bout, programme compris
- [ ] Tests lancés une fois à la fin, puis `pnpm db:verifier voirie` avant le merge dans `main`

## Pièges & précisions

- Si un carrefour a des branches en trop (R1, R2… inattendues) → une intersection de degré 3
  (accès riverain) est dans le carrefour entre le bord et la ligne d'arrêt : la ligne d'arrêt
  devient interne → retirer ce nœud du carrefour (outil Nœuds), si l'accès ne compte pas.
- Si une branche porte un code inattendu (N2, S2) → une rue entre deux fois dans le groupe de
  nœuds (un nœud manque au milieu) → ajouter le nœud manquant avec l'outil Nœuds.
- Si une liaison disparaît sans message → `liaisonsRetenues` ignore les liaisons vers un tronçon
  absent ou une voie retirée → couper et fusionner gardent les liaisons saisies ; supprimer un
  tronçon, non.
- Si la carte n'affiche qu'une partie des rues à petit zoom → `GET /api/reseau` s'arrête à 6 000
  tronçons (`tronque`) → zoomer, ou passer en tuiles vectorielles (`ST_AsMVT`) plus tard.
- Si un clic ne trouve pas la rue à petit zoom → la couche MapLibre ne connaît que l'axe ; au
  zoom 16 et plus, on clique la voie dessinée.

> ❓ **À confirmer** : un carrefour sans feux (stop, cédez-le-passage, priorité à droite) est-il un
> objet `carrefour` ? Hypothèse retenue : non. C'est un nœud seul, avec ses liaisons ; les
> priorités par bout de tronçon restent à ajouter.

## Rollback

- `pnpm reseau:semer --reinitialiser` efface tout le réseau et le sème de nouveau : les
  carrefours retrouvent leurs nœuds d'après leurs feux (corrections et liaisons perdues).
- Branche : `git reset --hard origin/reseau-voies` (`e17b66d`) dans le worktree revient avant la fusion, tant que rien n'est poussé.

## Références

- [RESEAU.md](RESEAU.md) : le réseau tel qu'il existe
- [CONFIGURATION.md](CONFIGURATION.md) : lignes de feux, programme, giratoires
- [ARCHITECTURE.md §14](ARCHITECTURE.md#14-décisions-darchitecture) : décision 009 (carrefours composés à la main)
- [vueCarrefour.ts](../packages/engine/src/vueCarrefour.ts), [carrefours.ts](../apps/api/src/reseau/carrefours.ts), [generation.ts](../apps/api/src/reseau/generation.ts)

## Journal

- 2026-09-27 — création : modèle cible, couches de données, inventaire avant fusion, plan en 8 étapes
- 2026-09-27 — décisions R5 (semis : routes, pistes cyclables, feux, passages ; composition par les feux) et R6 (feu véhicule = ligne d'arrêt) ; étapes 1, 2, 4, 5, 6 et 8 faites, R3 et R4 révisées
- 2026-09-27 — décision R7 (carrefour en boîte noire, connexions d'une voie à l'autre, saisies et gardées) ; étape 6 révisée, étape 9 ajoutée (export SUMO des nœuds joints)
