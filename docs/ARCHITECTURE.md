# Architecture

> Document de référence technique. Le contexte, les phases et la méthode sont dans le
> [README](../README.md). Ce document décrit **comment** le projet est construit.

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack](#2-stack)
3. [Organisation du monorepo](#3-organisation-du-monorepo)
4. [Base de données](#4-base-de-données)
5. [Import OpenStreetMap et amorce des carrefours](#5-import-openstreetmap-et-amorce-des-carrefours)
6. [Moteur de calcul (`packages/engine`)](#6-moteur-de-calcul-packagesengine)
7. [API NestJS](#7-api-nestjs)
8. [Front web](#8-front-web)
9. [Flux principaux](#9-flux-principaux)
10. [Simulation SUMO (phase 2)](#10-simulation-sumo-phase-2)
11. [Déploiement](#11-déploiement)
12. [Sécurité, contributions et cadre légal](#12-sécurité-contributions-et-cadre-légal)
13. [Tests](#13-tests)
14. [Décisions d'architecture](#14-décisions-darchitecture)
15. [Correspondance avec les phases](#15-correspondance-avec-les-phases)

---

## 1. Vue d'ensemble

```text
                         ┌───────────────────────────── Navigateur ─────────────────────────────┐
                         │  apps/web (React + MapLibre)                                         │
                         │   ├─ Carte des carrefours           ├─ Fiche carrefour (diagramme)   │
                         │   ├─ Chrono de feux (PWA, offline)  ├─ Corridor : espace-temps       │
                         │   └─ Admin (modération)             └─ packages/engine (calcul live) │
                         └───────────────┬───────────────────────────────┬──────────────────────┘
                                         │ /api (JSON, GeoJSON)          │ /tiles (MVT, plus tard)
                                   ┌─────▼──────┐                  ┌─────▼──────┐
                                   │   Caddy    │ TLS, statique,   │   Martin   │
                                   │            │ reverse proxy    │ (tuiles)   │
                                   └─────┬──────┘                  └─────┬──────┘
                                         │                               │
                          ┌──────────────▼──────────────┐                │
                          │ apps/api (NestJS)           │                │
                          │  carrefours · relevés ·     │                │
                          │  corridors · admin · export │                │
                          │  packages/engine (validation│                │
                          │  et calculs côté serveur)   │                │
                          └──────┬───────────────┬──────┘                │
                                 │ Drizzle + SQL │ pg-boss (jobs)        │
                          ┌──────▼───────────────▼───────────────────────▼──────┐
                          │ PostgreSQL 17 + PostGIS + pgRouting                 │
                          │  données du projet · réseau OSM · file de jobs      │
                          └──────▲──────────────────────────────▲───────────────┘
                                 │ osm2pgsql / osm2pgrouting    │ jobs
                          ┌──────┴──────┐                ┌──────┴───────────────┐
                          │ tools/osm   │                │ apps/worker          │
                          │ (ponctuel)  │                │ (Nest standalone +   │
                          └─────────────┘                │  SUMO, phase 2)      │
                                                         └──────────────────────┘
```

Principes :
- **Un seul langage applicatif** (TypeScript) du navigateur au serveur. Python n'intervient que
  dans le conteneur SUMO (phase 2).
- **Le calcul métier vit dans `packages/engine`**, du TypeScript pur sans dépendance au DOM ni à
  Nest. Il est exécuté dans le navigateur (curseurs en direct) et dans l'API (validation,
  précalculs).
- **Une seule base**, PostgreSQL, qui porte aussi la file de jobs (pg-boss) : pas de Redis.
- **Le géographique est traité par PostGIS**, pas par l'application.

---

## 2. Stack

| Couche | Choix | Version en place |
|---|---|---|
| Langage | TypeScript (strict), modules ES partout | 6.0 |
| Gestion du monorepo | pnpm workspaces | pnpm 11 |
| Front | React + Vite | React 19, Vite 8 |
| Carte | MapLibre GL JS via `react-map-gl/maplibre` | MapLibre **5.x** (voir note) |
| Fond de carte | OpenFreeMap, style `liberty` (attribution OSM incluse) | — |
| Diagrammes | SVG + `d3-scale` / `d3-axis` | — |
| Données côté front | TanStack Query | 5.x |
| Validation / types partagés | zod + `ZodValidationPipe` maison côté Nest | zod 4 |
| API | NestJS (ESM, gabarit du CLI officiel) | 12.x |
| ORM | Drizzle ORM (+ SQL brut pour les requêtes spatiales) | 0.45 / drizzle-kit 0.31 |
| Base | `pgrouting/pgrouting:17-3.5-4.0.1` | PG 17.5, PostGIS 3.5.2, pgRouting 4.0.1 |
| File de jobs | pg-boss | à ajouter (phase 2) |
| Import OSM | osm2pgsql (style flex Lua) et/ou osm2pgrouting | à ajouter |
| Tuiles vectorielles (optionnel) | Martin (`ghcr.io/maplibre/martin`) | à ajouter si besoin |
| Simulation (phase 2) | Eclipse SUMO (`pip install eclipse-sumo`) | 1.27+ |
| Tests | Vitest partout ; e2e API contre la base `voirie_test` du docker compose | Vitest 4 |
| Lint | oxlint (gabarits Nest et Vite) | — |
| Reverse proxy / TLS | Caddy | 2.x |
| Déploiement | Docker Compose sur un VPS | — |

Notes de mise en place (26/09/2026) :
- **MapLibre 6** n'est pas retenu pour l'instant. Son worker est un fichier séparé, résolu
  par `import.meta.url`, et Vite le déplace en pré-empaquetant la dépendance (« Worker failed
  to load »). react-map-gl 8.1 est prévu pour MapLibre 5, qui embarque son worker.
- **nestjs-zod** ne supporte pas encore Nest 12 : un `ZodValidationPipe` de quelques lignes
  (`apps/api/src/common/`) le remplace.
- **drizzle-kit 0.31 ignore l'option `srid`** des colonnes `geometry` : la migration générée
  est corrigée à la main en `geometry(Point, 4326)`. À vérifier après chaque `db:generate`.

---

## 3. Organisation du monorepo

```text
besancon-voirie/
├── README.md
├── LICENSE                         # AGPL-3.0 (code)
├── DATA_LICENSE.md                 # ODbL (données dérivées d'OSM)
├── docs/
│   └── ARCHITECTURE.md
├── pnpm-workspace.yaml
├── docker-compose.yml              # dev : db (+ martin)
├── docker-compose.prod.yml         # prod : db, api, worker, caddy, martin
├── apps/
│   ├── web/                        # React + MapLibre
│   │   └── src/
│   │       ├── map/                # carte, couches, popups
│   │       ├── carrefour/          # fiche + diagramme de feux
│   │       ├── chrono/             # relevé terrain (PWA)
│   │       ├── corridor/           # diagramme espace-temps + optimisation
│   │       └── admin/              # modération
│   ├── api/                        # NestJS
│   │   └── src/
│   │       ├── db/                 # schéma Drizzle, migrations, requêtes SQL spatiales
│   │       ├── carrefours/
│   │       ├── releves/
│   │       ├── corridors/
│   │       ├── admin/
│   │       ├── exports/
│   │       ├── time/               # GET /time (synchro horloge du chrono)
│   │       └── commands/           # nest-commander : seed OSM, recalculs
│   └── worker/                     # Nest standalone : jobs pg-boss (SUMO en phase 2)
├── packages/
│   ├── schema/                     # zod : Carrefour, LigneFeux, PlanFeux, Releve, Corridor
│   └── engine/                     # calcul pur : phases, capacité, décalages, bande verte
├── tools/
│   └── osm/                        # styles Lua osm2pgsql, scripts d'import, requêtes Overpass
└── sumo/                           # phase 2 : gabarits, conversion, scripts Python
```

Règles de dépendance :

```text
web ──▶ engine ──▶ schema
api ──▶ engine ──▶ schema
worker ─▶ engine, schema (+ accès db via le module db de l'api, extrait en package si besoin)
engine : aucune dépendance à React, Nest, Drizzle ou au DOM
```

---

## 4. Base de données

### 4.1 Conventions

- Géométries stockées en **WGS84 (SRID 4326)**. Les calculs métriques se font en
  `::geography` ou via `ST_Transform(geom, 2154)` (Lambert 93).
- Données structurées mais imbriquées (programmation d'un plan, relevé brut) en **`jsonb`**,
  validées par les schémas zod de `packages/schema` avant écriture.
- Tables issues d'OSM préfixées **`osm_`**. Elles sont régénérables à tout moment et ne sont
  jamais modifiées à la main.
- Identifiants : `uuid` (v7) pour les tables du projet, `bigint` pour les identifiants OSM.

### 4.2 Schéma (tables du projet)

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgrouting;

CREATE TYPE statut_carrefour AS ENUM ('a_confirmer', 'non_releve', 'estime', 'mesure', 'verifie');
CREATE TYPE statut_moderation AS ENUM ('en_attente', 'valide', 'rejete');

CREATE TABLE carrefour (
  id            uuid PRIMARY KEY,
  slug          text UNIQUE NOT NULL,
  nom           text NOT NULL,
  geom          geometry(Point, 4326) NOT NULL,
  statut        statut_carrefour NOT NULL DEFAULT 'non_releve',
  controleur    jsonb NOT NULL DEFAULT '{}',   -- mode, priorite_tc, appel_pieton, feu_recompense
  osm_nodes     bigint[] NOT NULL DEFAULT '{}',
  pres_tram     boolean NOT NULL DEFAULT false, -- calculé à l'import
  cree_le       timestamptz NOT NULL DEFAULT now(),
  modifie_le    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON carrefour USING gist (geom);

CREATE TABLE branche (
  id            uuid PRIMARY KEY,
  carrefour_id  uuid NOT NULL REFERENCES carrefour ON DELETE CASCADE,
  code          text NOT NULL,                  -- N, S, E, O…
  nom           text,
  osm_way_id    bigint,
  azimut_deg    real,                           -- ST_Azimuth, pour dessiner et ordonner
  UNIQUE (carrefour_id, code)
);

CREATE TABLE ligne_feux (
  id            uuid PRIMARY KEY,
  carrefour_id  uuid NOT NULL REFERENCES carrefour ON DELETE CASCADE,
  code          text NOT NULL,                  -- F1, F2, P1…
  signal        text NOT NULL,                  -- R11v | R12 | R13c | R17 | R18
  branche_code  text,
  mouvements    text[] NOT NULL DEFAULT '{}',   -- tout_droit, droite, gauche
  voies         smallint,
  traverse      text,                           -- piétons : branche traversée
  geom          geometry(Point, 4326),          -- position de la ligne d'arrêt (optionnelle)
  UNIQUE (carrefour_id, code)
);

CREATE TABLE plan_feux (
  id            uuid PRIMARY KEY,
  carrefour_id  uuid NOT NULL REFERENCES carrefour ON DELETE CASCADE,
  code          text NOT NULL,                  -- jour, nuit, hpm…
  mode          text NOT NULL DEFAULT 'cycle',  -- cycle | jaune_clignotant | eteint
  plages        jsonb NOT NULL,                 -- [{jours:[…], de:"06:30", a:"20:30"}]
  cycle_s       numeric(5,1),
  jaune_s       numeric(3,1),
  reference     jsonb,                          -- {ligne:"F1", t0:"2026-10-07T08:02:17.400+02:00"}
  lignes        jsonb,                          -- {"F1":[[0,34]], "F3":[[40,74]], …}
  source_releve uuid,                           -- relevé validé qui a produit ce plan
  UNIQUE (carrefour_id, code)
);

CREATE TABLE releve (
  id                 uuid PRIMARY KEY,
  carrefour_id       uuid NOT NULL REFERENCES carrefour ON DELETE CASCADE,
  pseudo             text,                      -- facultatif, libre, jamais d'email
  brut               jsonb NOT NULL,            -- événements horodatés du chrono
  synthese           jsonb NOT NULL,            -- sortie de engine.analyserReleve()
  cycles_observes    smallint NOT NULL,
  ecart_type_cycle_s real,
  observe_le         timestamptz NOT NULL,
  statut             statut_moderation NOT NULL DEFAULT 'en_attente',
  motif_rejet        text,
  cree_le            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON releve (statut, cree_le);

CREATE TABLE corridor (
  id               uuid PRIMARY KEY,
  slug             text UNIQUE NOT NULL,
  nom              text NOT NULL,
  vitesse_kmh      real NOT NULL DEFAULT 30,
  plan_code        text NOT NULL DEFAULT 'jour',
  geom             geometry(LineString, 4326)   -- itinéraire calculé (pgRouting)
);

CREATE TABLE corridor_carrefour (
  corridor_id      uuid REFERENCES corridor ON DELETE CASCADE,
  ordre            smallint NOT NULL,
  carrefour_id     uuid NOT NULL REFERENCES carrefour,
  ligne_aller      text NOT NULL,
  ligne_retour     text,
  distance_m       real,                        -- depuis le carrefour précédent, le long du réseau
  distance_forcee  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (corridor_id, ordre)
);

-- Phase 2
CREATE TABLE simulation (
  id            uuid PRIMARY KEY,
  corridor_id   uuid REFERENCES corridor,
  scenario      jsonb NOT NULL,                 -- décalages, cycle, vitesse, demande…
  statut        text NOT NULL,                  -- en_file | en_cours | ok | erreur
  resultats     jsonb,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  fini_le       timestamptz
);
```

Historique du tram (§8.2) :

```sql
CREATE TABLE tram_passage (             -- une rame est passée à un arrêt
  jour            date NOT NULL,        -- jour de service de la course
  course          text NOT NULL,        -- trip_id GTFS
  sequence        smallint NOT NULL,
  vehicule        text,                 -- numéro SAE de la rame
  parcours        text NOT NULL,        -- route_id-direction_id
  arret           text NOT NULL,
  arret_precedent text,
  heure_prevue    timestamptz NOT NULL, -- dernière prévision avant disparition = heure de passage
  detecte_a       timestamptz NOT NULL, -- disparition de l'arrêt dans le flux
  heure_theorique timestamptz,          -- horaire GTFS
  previsions      jsonb NOT NULL,       -- { "30": epoch, "60": …, "600": … } : prévision à chaque horizon
  PRIMARY KEY (jour, course, sequence)
);
-- Vue tram_troncon_observe : durée de chaque tronçon (passage − passage à l'arrêt précédent
-- de la même course), avec l'heure locale et le type de jour (semaine / samedi / dimanche).
```

Les schémas Drizzle (`apps/api/src/db/schema.ts`) reflètent ces tables. Drizzle gère
`geometry(point)` nativement. Pour `LineString`, on passe par un `customType` qui lit et
écrit du GeoJSON (`ST_AsGeoJSON` / `ST_GeomFromGeoJSON`).

### 4.3 Tables OSM (régénérables)

| Table | Contenu | Usage |
|---|---|---|
| `osm_signal` | Nœuds `highway=traffic_signals`, `crossing=traffic_signals` + tags | Amorce, rattachement des feux aux carrefours |
| `osm_way` | Voies `highway=*` : `lanes`, `maxspeed`, `oneway`, `name` | Branches, affichage, export SUMO |
| `osm_tram` | `railway=tram` | Drapeau `pres_tram` |
| `osm_route_edge` / `osm_route_vertex` | Réseau découpé aux intersections, topologie pgRouting | Distances de corridor |

---

## 5. Import OpenStreetMap et amorce des carrefours

### 5.1 Import

1. Télécharger un extrait couvrant Besançon (Geofabrik, région, ou un extrait BBBike ciblé).
2. `osm2pgsql --output=flex --style tools/osm/besancon.lua`, qui alimente `osm_signal`,
   `osm_way` et `osm_tram`.
3. Topologie routable. Deux options, à trancher lors de l'implémentation :
   - **A. `osm2pgrouting`** : clé en main, produit directement arêtes et sommets (entrée `.osm`
     XML : convertir le `.pbf` avec `osmium cat`). À utiliser pour démarrer.
   - **B.** Garder dans `osm_way` la liste des nœuds de chaque voie (style flex), découper
     en SQL aux nœuds partagés, puis `pgr_extractVertices`. Un seul outil d'import, mais plus de SQL.
4. Commande Nest : `pnpm api cmd osm:import` enchaîne le tout et journalise les volumes.

### 5.2 Amorce des carrefours

Regroupement des feux proches (DBSCAN, 50 m) en Lambert 93 pour travailler en mètres :

```sql
WITH clusters AS (
  SELECT osm_id, geom,
         ST_ClusterDBSCAN(ST_Transform(geom, 2154), eps := 50, minpoints := 1) OVER () AS cid
  FROM osm_signal
  WHERE tags->>'highway' = 'traffic_signals'
)
SELECT cid,
       array_agg(osm_id)              AS osm_nodes,
       ST_Centroid(ST_Collect(geom))  AS geom
FROM clusters
GROUP BY cid;
```

Puis, pour chaque groupe :
- **Nom** : noms distincts des voies `osm_way` à moins de 15 m du centroïde, joints par « × ».
- **Branches** : voies qui touchent les nœuds du groupe, avec `ST_Azimuth` pour l'orientation
  et un code N/S/E/O proposé.
- **`pres_tram`** : `EXISTS (SELECT 1 FROM osm_tram t WHERE ST_DWithin(c.geom::geography, t.geom::geography, 25))`.

**Réimport sans écraser le travail validé** : un nœud OSM déjà présent dans un
`carrefour.osm_nodes` n'est jamais réaffecté. Les nouveaux nœuds forment des carrefours au
statut `a_confirmer`, que l'admin valide ou fusionne. Les nœuds disparus d'OSM sont signalés
et jamais supprimés automatiquement.

Volume attendu (Overpass, 26/09/2026) : 387 feux, ~130–180 carrefours.

---

## 6. Moteur de calcul (`packages/engine`)

TypeScript pur, **sans effet de bord**, testé unitairement. Toutes les durées en secondes
(nombres), tous les instants absolus en millisecondes epoch.

| Module | Fonctions principales | Utilisé par |
|---|---|---|
| `plan` | `normaliserIntervalles`, `phasesDepuisLignes(plan)` → phases (instants de changement + ensemble des lignes au vert), `rougesDeDegagement` | fiche, SUMO |
| `coherence` | `verifierPlan(carrefour, plan)` : antagonistes verts simultanés, vert piéton < longueur/1 m/s, cycle > 130 s, vert < 6 s | API (validation), admin |
| `capacite` | `capaciteLigne(voies, vertUtile, cycle, saturation = 1800)` ; `reserveCapacite(…)` ; `cycleWebster(L, Y)` — paramètres CERTU/DiagFeux | fiche, phase 2 |
| `releve` | `analyserReleve(evenements)` → cycle (médiane, écart-type), intervalles de vert moyens par ligne, `t0` de référence, diagnostic « fixe / actué » | chrono, API |
| `decalage` | `decalage(planA, planB)` = `(t0B − t0A) mod C` ; `cyclesCompatibles(C1, C2)` (égaux, double, moitié) | corridor |
| `ondeVerte` | `bandePassante(corridor, sens, decalages, v)` ; `diagrammeEspaceTemps(…)` (segments et bandes à tracer) | corridor |
| `optimisation` | `optimiserExhaustif(corridor, pas = 1)` (≤ 5 carrefours) ; `optimiserDescente(corridor)` ; fonction objectif `bAller + k·bRetour` avec contraintes (verts piétons) | corridor |
| `sumo` (phase 2) | `versTlLogic(plan, associationLiens)` → phases `G/y/r` + `offset` | worker |

Calcul de la bande passante d'un sens (cœur de la phase 1 bis) :

```text
Pour chaque carrefour i du corridor (position x_i, décalage o_i, vert [a_i, b_i] dans le cycle C) :
  temps de parcours depuis le 1er carrefour : τ_i = x_i / v
  un départ à t passe au vert en i  ⇔  (t + τ_i − o_i) mod C ∈ [a_i, b_i]
  ⇔  t ∈ [o_i + a_i − τ_i , o_i + b_i − τ_i]  (mod C)
Bande passante = mesure de l'intersection, sur le cercle [0, C), de ces intervalles pour tous les i.
```

---

## 7. API NestJS

### 7.1 Modules

| Module | Rôle |
|---|---|
| `DbModule` | Client Drizzle (pool `pg`), migrations, helpers SQL spatiaux |
| `CarrefoursModule` | Lecture carte et fiche, recherche |
| `RelevesModule` | Réception anonyme des relevés (limite de débit + champ piège anti-robot) |
| `CorridorsModule` | Lecture des corridors, calcul des distances (pgRouting), décalages actuels |
| `AdminModule` | Authentification admin, modération, édition des carrefours et corridors |
| `ExportsModule` | GeoJSON, GeoPackage Lambert 93 (`ogr2ogr` sur la base), CSV |
| `TimeModule` | `GET /time`, pour la synchronisation d'horloge du chrono |
| `TramModule` | Tram en temps réel : GTFS et GTFS-RT Ginko, mis en cache (§8.1) ; collecte des passages et historique (§8.2) |
| `JobsModule` | pg-boss : publication des jobs (recalculs, simulations) |
| `CommandsModule` | nest-commander : `osm:import`, `carrefours:seed`, `corridors:recalculer` |

### 7.2 Endpoints

Public :

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/api/carrefours?bbox=minLon,minLat,maxLon,maxLat` | GeoJSON FeatureCollection léger (id, nom, statut, pres_tram) |
| GET | `/api/carrefours/:slug` | Carrefour complet : branches, lignes, plans, synthèse des relevés validés |
| GET | `/api/corridors` | Liste + géométrie |
| GET | `/api/corridors/:slug` | Corridor, carrefours ordonnés, distances, plans, décalages actuels |
| POST | `/api/releves` | 202 : relevé enregistré `en_attente` |
| GET | `/api/time` | `{ now: <ms epoch> }` |
| GET | `/api/tram/reseau` | Parcours tram (tracé, arrêts et leur distance le long du tracé) |
| GET | `/api/tram/temps-reel` | Par rame : tronçon en cours, durée prévue, arrivée prévue à l'arrêt suivant |
| GET | `/api/tram/historique/troncons?typeJour=semaine&heure=8&jours=28` | Durées observées par tronçon (n, p10, p50, p90, référence) |
| GET | `/api/tram/historique/etat` | Nombre de passages enregistrés, premier et dernier, collecte active ou non |
| GET | `/api/exports/carrefours.geojson` | Export ODbL |
| GET | `/api/exports/carrefours.gpkg?srid=2154` | Export Lambert 93 |

Admin (cookie de session, un seul compte) :

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/admin/releves?statut=en_attente` | File de modération |
| POST | `/api/admin/releves/:id/valider` | Crée ou met à jour `plan_feux`, recalcule le statut du carrefour |
| POST | `/api/admin/releves/:id/rejeter` | Avec motif |
| PUT | `/api/admin/carrefours/:id` | Édition (nom, branches, lignes, contrôleur) |
| POST | `/api/admin/carrefours/:id/fusionner` | Fusion de deux groupes OSM |
| PUT | `/api/admin/corridors/:id` | Création/édition, recalcul des distances |
| POST | `/api/admin/simulations` | Phase 2 : met un job en file |

Validation : chaque corps de requête est un schéma zod de `packages/schema`. Les
invariants métier (`engine.coherence`) sont vérifiés en plus avant toute écriture de `plan_feux`.

### 7.3 Requêtes spatiales types

```sql
-- Carrefours dans la vue de la carte
SELECT id, slug, nom, statut, pres_tram, ST_AsGeoJSON(geom)::json AS geometry
FROM carrefour
WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326);

-- Distance le long du réseau entre deux carrefours consécutifs d'un corridor
SELECT sum(ST_Length(e.geom::geography)) AS distance_m, ST_LineMerge(ST_Collect(e.geom)) AS geom
FROM pgr_dijkstra(
  'SELECT id, source, target, cost, reverse_cost FROM osm_route_edge',
  $sommet_a, $sommet_b, directed := true
) r
JOIN osm_route_edge e ON e.id = r.edge;
```

---

## 8. Front web

| Écran | Route | Contenu |
|---|---|---|
| Carte | `/` | MapLibre, carrefours colorés par statut (gris non relevé, orange estimé, bleu mesuré, vert vérifié, violet actué/tram), corridors, filtres |
| Fiche carrefour | `/carrefours/:slug` | Mini-carte, branches, **diagramme de feux** (barres par ligne sur un cycle, par plan horaire), capacités, historique des relevés, bouton « relever ce carrefour » |
| Chrono de feux | `/chrono/:slug` | PWA mobile : boutons par ligne, compteur de cycles, synthèse en direct (`engine.analyserReleve`), envoi |
| Corridor | `/corridors/:slug` | **Diagramme espace-temps** interactif, curseurs de décalage et de vitesse, bande passante par sens, bouton « optimiser », comparaison actuel/optimisé |
| Admin | `/admin` | File de modération, édition, fusion de carrefours, gestion des corridors |

### Chrono de feux : points d'attention

- **Hors-ligne d'abord** : les événements sont écrits dans IndexedDB au fil de l'eau, puis envoyés
  quand le réseau revient (Service Worker + file d'envoi).
- **Horloge** : au démarrage, plusieurs appels à `GET /api/time` estiment l'écart entre
  l'horloge du téléphone et celle du serveur (demi-temps aller-retour, médiane). Tous les
  horodatages sont corrigés, ce qui garantit des `t0` comparables entre relevés faits par
  des personnes différentes.
- Gros boutons, mode sombre, écran maintenu allumé (Wake Lock API), retour haptique.
- Aucun accès caméra, micro ni géolocalisation continue. La position ne sert qu'à proposer le carrefour le plus proche, et n'est pas envoyée.

### 8.1 Tram en temps réel

Ginko ne publie pas la position GPS des rames, mais son flux GTFS-RT `tripUpdates` donne,
pour chaque course, le numéro de la rame et l'heure prévue (à la seconde) à chacun des arrêts
restants. Clé API dans `GINKO_API_KEY` ; GTFS statique public, licence ODbL.

- **API** (`apps/api/src/tram/`) : le GTFS est lu une fois par jour. On n'en garde que le tram,
  avec un parcours par ligne et par sens, et les arrêts projetés le long du tracé (`shapes.txt`).
  Le flux temps réel est relu au plus toutes les 10 s. Pour chaque rame, on retient la course
  en cours (un arrêt déjà desservi) : son tronçon va de l'arrêt précédent (GTFS statique) à
  l'arrêt suivant (premier arrêt restant du flux). La durée d'un tronçon est la médiane des
  écarts entre arrêts consécutifs dans les prévisions de toutes les courses du flux. À défaut,
  on prend les horaires théoriques, arrondis à la minute.
- **Moteur** (`estimerPositionTram`) : la rame roule à la vitesse moyenne du tronçon, arrêt en
  station exclu, et se trouve à `temps restant × vitesse` avant l'arrêt suivant.
- **Arrêt en station** : Ginko ne publie aucune durée d'arrêt. L'arrivée et le départ sont
  identiques dans le flux comme dans le GTFS, et SIRI n'est pas ouvert à notre clé. Le moteur
  applique donc un temps fixe (`PARAMETRES_TRAM.tempsArret`, 15 s), compté après l'heure prévue
  à l'arrêt : la rame reste à quai en début de tronçon. Une fois l'arrivée prévue passée, elle
  attend aussi à l'arrêt suivant jusqu'à la prochaine prévision. Mesure du 26/09/2026 (22 arrêts) :
  un arrêt disparaît du flux en médiane 8 s après son heure prévue (de -3 à 12 s, 33 s pour un
  départ de terminus). C'est cohérent avec une heure prévue qui marque l'arrivée à quai. La zone probable
  applique une marge sur le temps restant (plancher, part du temps restant, âge de la donnée) et
  une marge sur la vitesse. Elle reste bornée au tronçon. Les paramètres (`PARAMETRES_TRAM`)
  sont indicatifs, à recaler en comparant les prévisions successives aux passages réels.
- **Front** : le flux est relu toutes les 15 s. La position est recalculée à chaque image
  (`requestAnimationFrame`), hors de React : les sources MapLibre reçoivent directement les
  nouvelles données. Quand une nouvelle prévision déplace l'estimation, `lisserDistance` fait
  glisser la rame le long de la voie (~1 s) au lieu de la faire sauter. Si l'estimation recule
  un peu, la rame attend sur place : elle ne recule jamais. Un clic sur une rame ouvre le détail
  (tronçon, arrivée prévue, vitesse moyenne, longueur de la zone).

### 8.2 Historique du tram

Sans mémoire, on ne connaît que les prévisions de Ginko à l'instant : ni où les rames perdent
du temps, ni la fiabilité réelle des estimations. L'API enregistre donc chaque passage.

- **Collecte** (`CollecteTramService`, activée par `TRAM_COLLECTE=true`) : le flux est lu
  toutes les 10 s, même sans personne sur la carte. `DetecteurPassages` compare deux lectures
  successives. Un arrêt qui disparaît de la liste d'une course est un passage, daté par sa
  dernière heure prévue. Un arrêt retiré plus de 2 min avant son heure est écarté (arrêt
  sauté, régulation). Le terminus est enregistré quand la course disparaît près de son heure.
  Pour chaque passage, on garde aussi la prévision faite 30 s, 1, 2, 5 et 10 min avant. Un
  passage pèse environ 150 octets hors index. Avec ~350 courses tram par jour de semaine,
  ça fait ~9 000 passages par jour, soit de l'ordre du gigaoctet par an index compris. La collecte tourne dans l'API en attendant `apps/worker`, et seulement tant que l'API
  tourne : un redémarrage perd les passages en cours de détection.
- **Durées des tronçons** : médiane (p50) et dispersion (p10, p90) sur les 28 derniers jours,
  pour le type de jour et l'heure en cours. Il faut au moins 5 passages, sinon on prend la
  journée entière. En dessous, on retombe sur les prévisions du flux, puis sur les horaires
  théoriques. `sourceDuree` indique la source retenue.
- **Estimation** : la durée médiane donne la vitesse, et les p10 et p90 bornent la vitesse de
  la zone probable (à la place de `ecartVitesse`). La calibration (80e centile de l'erreur des
  prévisions Ginko par horizon, 20 passages minimum) remplace la marge fixe sur le temps
  restant. Premières mesures du 26/09/2026 : 7 s à 30 s, 13 s à 1 min, 31 s à 2 min.
- **Pertes de temps** : pas montrées dans la vue grand public, l'historique sert d'abord aux
  prédictions. On les trouve dans le mode « Données brutes » (§8.3), qui colore chaque tronçon
  par la durée médiane du créneau moins la référence, c'est-à-dire le p10 toutes heures
  confondues (le tronçon quand ça roule bien). C'est le temps perdu habituel : feux,
  carrefours, montées et descentes. Les tronçons à moins de 5 passages sont estompés. Prochaine étape : croiser avec les carrefours à feux traversés
  (priorité tram).
- Limites : pas de GPS, donc la perte est connue par tronçon, pas au mètre près. Le temps à
  quai n'est pas séparable du roulage (Ginko ne publie pas de départ distinct). Les fériés et
  les vacances scolaires ne sont pas distingués.


### 8.3 Modes d'affichage et fond de carte

- **Carte** : la vue grand public (carrefours, trams en temps réel).
- **Données brutes** : toutes les couches, activables une par une (carrefours, lignes, arrêts,
  rames, zones probables, temps perdu par tronçon avec son créneau), plus le volume de
  l'historique. Le mode et les couches sont mémorisés dans le navigateur (`localStorage`).
- **Fond de carte** : satellite par défaut, avec les orthophotos IGN de la Géoplateforme
  (Licence Ouverte, sans clé, ~20 cm/pixel). On garde par-dessus les libellés du plan OpenFreeMap,
  et on masque ses surfaces et ses routes. Le plan seul reste disponible.
- **Carte graphique** : les bâtiments sont masqués par défaut, et la 3D (bâtiments en relief,
  carte inclinable) est désactivée par défaut. Sans 3D, les bâtiments restent à plat et
  l'inclinaison est bloquée. La boucle d'animation des rames n'envoie de données à MapLibre
  (donc ne fait redessiner la carte) que si une rame a bougé d'au moins un demi-pixel à
  l'écran, et au moins une fois par seconde. Mesure du 26/09/2026 : 3 à 4 mises à jour par
  seconde en vue d'ensemble (zoom 12,5 à 13,5) et ~14 au zoom 16, au lieu d'une par image.
---

## 9. Flux principaux

### 9.1 Amorce (une fois, puis à chaque réimport)

```text
tools/osm (extrait .pbf) ─▶ osm2pgsql / osm2pgrouting ─▶ tables osm_*
                         ─▶ cmd carrefours:seed (DBSCAN, noms, branches, tram) ─▶ carrefour / branche
```

### 9.2 Relevé → plan validé

```text
Chrono (téléphone)                API                              Admin
──────────────────                ───                              ─────
événements horodatés ──POST──▶ zod + limite de débit + piège
                               engine.analyserReleve()
                               INSERT releve (en_attente) ──────▶ file de modération
                                                                   compare au plan existant
                                                          ◀─────── valider
                               engine.coherence.verifierPlan()
                               UPSERT plan_feux
                               statut carrefour : mesure → verifie si ≥ 2 relevés concordants
```

### 9.3 Onde verte

```text
Admin crée le corridor (carrefours ordonnés + lignes aller/retour)
  └─▶ API : pgRouting → distances + géométrie ; décalages actuels via engine.decalage
Visiteur ouvre /corridors/:slug
  └─▶ front : engine.ondeVerte / engine.optimisation en direct (aucun appel serveur)
```

---

## 10. Simulation SUMO (phase 2)

```text
POST /api/admin/simulations ─▶ pg-boss « simulation » ─▶ apps/worker
  1. Extraire la zone du corridor depuis osm_way (ST_Buffer de corridor.geom) → .osm
  2. netconvert → réseau SUMO (.net.xml)
  3. Associer les lignes de feux aux liens du tlLogic (branche + mouvement → indices de lien),
     avec une table de correspondance stockée et corrigeable dans l'admin
  4. engine.sumo.versTlLogic() pour chaque plan → programmes + offsets + WAUT
  5. Demande : randomTrips / routeSampler selon les comptages disponibles
  6. sumo (sans interface), 10 graines → tripinfo, edgeData, E2, ssm
  7. Agrégation → simulation.resultats (jsonb)
```

- Le worker est une application Nest *standalone*. Son image Docker contient Node et Python
  avec `eclipse-sumo`, et il appelle les binaires SUMO par `child_process`.
- Délai maximal par job, un seul job à la fois (VPS modeste), fichiers de travail dans un
  répertoire temporaire supprimé à la fin.

---

## 11. Déploiement

`docker-compose.prod.yml` :

| Service | Image | Rôle |
|---|---|---|
| `db` | `pgrouting/pgrouting` (PostgreSQL + PostGIS + pgRouting ; tag à figer) | Données, file pg-boss |
| `api` | build `apps/api` | API |
| `worker` | build `apps/worker` (Node + Python + SUMO) | Jobs |
| `martin` | `ghcr.io/maplibre/martin` | Tuiles vectorielles (optionnel) |
| `caddy` | `caddy:2` | TLS automatique, sert `apps/web/dist`, proxy `/api` et `/tiles` |

- **Hébergement** : un VPS de 2 vCPU / 4 Go suffit pour les phases 1 et 1 bis (~5–10 €/mois).
  Monter en gamme pour la phase 2 si les simulations deviennent lourdes.
- **Sauvegardes** : `pg_dump` quotidien, copié hors du serveur (rclone vers un stockage objet).
- **Données ouvertes** : export hebdomadaire GeoJSON + GeoPackage publié (release GitHub
  ou fichier statique) sous ODbL. C'est la garantie que les données survivent au projet.
- **Développement local** : `pnpm db:up`, `pnpm db:prepare`, puis `pnpm dev` (packages en watch,
  API et web en parallèle). Ports lus dans `API_PORT` / `WEB_PORT`.
- **Worktrees (Nevven Worktree Manager)** : projet `besancon-voirie`, target unique `app`.
  Conteneur PostgreSQL partagé (nom de projet Compose `besancon-voirie`, sans montage relatif),
  bases séparées par worktree (`voirie_wt_<worktree>`, créées et écrites dans le `.env` du
  worktree par `apps/api/scripts/prepare-db.ts` quand `VOIRIE_WORKTREE_SANDBOX` est défini).
  `node_modules` non partagé : chaque worktree fait son `pnpm install`.

---

## 12. Sécurité, contributions et cadre légal

- **Pas de comptes publics.** Les contributions sont anonymes, avec un pseudo libre facultatif et
  jamais d'email. Aucune donnée personnelle n'est collectée volontairement.
- **Anti-abus** : `@nestjs/throttler` sur `POST /api/releves`, champ piège anti-robot, taille
  de corps limitée, modération obligatoire avant publication.
- **Journaux** : pas de conservation des IP au-delà de ce que le throttler garde en mémoire.
  Journaux Caddy sans IP, ou avec rotation courte.
- **Admin** : un compte unique, mot de passe haché (argon2) en variable d'environnement,
  cookie de session `HttpOnly` / `Secure` / `SameSite=Strict`. Ce cookie est strictement
  nécessaire, donc pas de bandeau.
- **Pas d'analytics, pas de traceurs**, pas de polices ni de scripts tiers chargés à l'exécution.
- **Mentions légales** (LCEN, éditeur non professionnel) : identité de l'hébergeur du VPS.
- **Licences** : code sous AGPL-3.0, données sous ODbL, attribution OSM sur la carte et dans les exports.
- **Avertissement** sur toutes les pages : outil citoyen indépendant, données indicatives.

---

## 13. Tests

| Cible | Outil | Priorité |
|---|---|---|
| `packages/engine` | Vitest, cas construits à la main + tests de propriétés (fast-check) : bande passante ∈ [0, min(verts)], invariance par rotation du cycle | **Haute** : c'est le cœur métier |
| `packages/schema` | Vitest : exemples valides/invalides | Moyenne |
| `apps/api` | Vitest + supertest contre la vraie base PostGIS + pgRouting (`voirie_test`, migrations appliquées par `test/global-setup.ts`) : amorce DBSCAN, distances de corridor, modération | Haute |
| `apps/web` | Vitest + Testing Library sur le chrono et les diagrammes | Moyenne |
| Bout en bout | Playwright : relevé → modération → fiche mise à jour | Plus tard |

---

## 14. Décisions d'architecture

| # | Décision | Alternatives écartées | Raison |
|---|---|---|---|
| 001 | **PostgreSQL + PostGIS + pgRouting** | MongoDB | Regroupement (`ST_ClusterDBSCAN`), distances le long du réseau (`pgr_dijkstra`), orientation des branches (`ST_Azimuth`), jointures de proximité (tram), import `osm2pgsql`, reprojection Lambert 93, tuiles `ST_AsMVT` / Martin : tout est natif. Mongo n'offre que des requêtes de proximité en WGS84, le reste serait à recoder en application. La souplesse documentaire est conservée avec `jsonb`. |
| 002 | Programmation stockée **par ligne de feux** (intervalles de vert), en `jsonb` | Stockage par phases ; tables relationnelles `intervalle` | Correspond à l'observation terrain et au diagramme papier. Les phases se déduisent (`engine.plan`), et le format se lit et se valide facilement. |
| 003 | **Calcul métier dans un package TS partagé** | Calcul uniquement côté serveur | L'onde verte doit réagir instantanément aux curseurs. Le même code valide côté API. |
| 004 | **Contributions anonymes + modération** | Comptes utilisateurs ; contributions par PR GitHub | Pas de données personnelles à gérer, et contribuer ne demande pas de compte GitHub. |
| 005 | **pg-boss** pour les jobs | BullMQ + Redis | Un service de moins, et une charge faible. |
| 006 | **Drizzle** + SQL brut pour le spatial | Prisma (PostGIS mal géré), TypeORM | Proche du SQL, typé, géométrie point native. Le spatial s'écrit de toute façon en SQL. Limite connue : SRID à corriger dans les migrations. |
| 007 | Géométries en **4326**, calculs en `geography` ou 2154 | Tout stocker en 2154 | MapLibre et GeoJSON sont en WGS84. Lambert 93 seulement pour les calculs métriques et l'export. |
| 008 | **Horloge corrigée par `GET /time`** dans le chrono | Faire confiance à l'horloge du téléphone | Les décalages entre carrefours reposent sur des `t0` comparables à mieux que ~0,5 s. |

---

## 15. Correspondance avec les phases

| Phase | Composants livrés |
|---|---|
| **1 — Inventaire des feux** | Import OSM, amorce, `carrefour` / `branche` / `ligne_feux` / `plan_feux` / `releve`, carte, fiche + diagramme de feux, chrono PWA, modération, `engine.plan` / `coherence` / `capacite` / `releve` |
| **1 bis — Onde verte** | Topologie pgRouting, `corridor` / `corridor_carrefour`, `engine.decalage` / `ondeVerte` / `optimisation`, écran corridor (espace-temps) |
| **2 — SUMO** | `apps/worker`, pg-boss, `engine.sumo`, table de correspondance lignes ↔ liens, `simulation`, affichage des résultats |
| Transverse | Exports (GeoJSON, GPKG 2154), sauvegardes, publication open data, Martin si besoin |
