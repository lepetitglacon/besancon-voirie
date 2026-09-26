# Architecture

> Document de référence technique. Le contexte, les phases et la méthode sont dans le
> [README](../README.md). Ce document décrit **comment** le projet est construit. La
> configuration d'un carrefour (branches, voies, lignes de feux, programme) est détaillée
> dans [CONFIGURATION.md](CONFIGURATION.md).

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Stack](#2-stack)
3. [Organisation du monorepo](#3-organisation-du-monorepo)
4. [Base de données](#4-base-de-données)
5. [Import OpenStreetMap et composition des carrefours](#5-import-openstreetmap-et-composition-des-carrefours)
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
| Fond de carte | OpenFreeMap, style `liberty` (attribution OSM incluse), et bouton « Photo aérienne » : IGN BD ORTHO (Géoplateforme, sans clé, zoom 19 max), glissée sous les noms de rues | — |
| Diagrammes | SVG + `d3-scale` / `d3-axis` | — |
| Données côté front | TanStack Query | 5.x |
| Validation / types partagés | zod + `ZodValidationPipe` maison côté Nest | zod 4 |
| API | NestJS (ESM, gabarit du CLI officiel) | 12.x |
| ORM | Drizzle ORM (+ SQL brut pour les requêtes spatiales) | 0.45 / drizzle-kit 0.31 |
| Base | `pgrouting/pgrouting:17-3.5-4.0.1` | PG 17.5, PostGIS 3.5.2, pgRouting 4.0.1 |
| File de jobs | pg-boss | à ajouter (phase 2) |
| Import OSM | Overpass API + `apps/api/scripts/osm.ts` (osm2pgrouting envisagé pour la topologie) | en place |
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
  nature        nature_carrefour NOT NULL DEFAULT 'carrefour', -- ou traversee_pietonne
  pres_tram     boolean NOT NULL DEFAULT false, -- recalculé à chaque composition
  cree_le       timestamptz NOT NULL DEFAULT now(),
  modifie_le    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON carrefour USING gist (geom);

-- Un feu physique (importé d'OSM, ou ajouté à la main : osm_id nul). Les carrefours se
-- composent À LA MAIN en rattachant des feux ; l'import ne modifie jamais carrefour_id.
CREATE TABLE feu (
  id            uuid PRIMARY KEY,
  osm_id        bigint UNIQUE,
  type          type_feu NOT NULL,                -- vehicule | pieton
  tags          jsonb NOT NULL DEFAULT '{}',
  geom          geometry(Point, 4326) NOT NULL,
  present_osm   boolean NOT NULL DEFAULT true,   -- false : disparu d'OSM au dernier import
  carrefour_id  uuid REFERENCES carrefour ON DELETE SET NULL
);

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
  etapes        jsonb,                          -- [{lignes:["F1","P2"], duree_s:34, appel?:"P1", hors_cycle?:true}, …]
  degagements   jsonb NOT NULL DEFAULT '{}',    -- rouges saisis à la main {"F1>F2": 4}
  arcs          jsonb NOT NULL DEFAULT '[]',    -- graphe des étapes [{de:0, vers:4, demande:"T1", anticipe:true}]
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

Les schémas Drizzle (`apps/api/src/db/schema.ts`) reflètent ces tables. Drizzle gère
`geometry(point)` nativement. Pour `LineString`, on passe par un `customType` qui lit et
écrit du GeoJSON (`ST_AsGeoJSON` / `ST_GeomFromGeoJSON`).

### 4.3 Tables OSM (régénérables)

| Table | Contenu | Usage |
|---|---|---|
| `osm_signal` | Nœuds `highway=traffic_signals`, `crossing=traffic_signals` + tags | Synchronisation de la table `feu` |
| `osm_way` | Voies `highway=*` : `lanes`, `maxspeed`, `oneway`, `name` | Branches, affichage, export SUMO |
| `osm_tram` | `railway=tram` | Drapeau `pres_tram` |
| `osm_route_edge` / `osm_route_vertex` | Réseau découpé aux intersections, topologie pgRouting | Distances de corridor |

---

## 5. Import OpenStreetMap et composition des carrefours

Implémentation : `apps/api/scripts/osm.ts` (Node 24, sans binaire externe). Tests :
`scripts/osm.spec.ts` (unitaires) et `test/osm.e2e-spec.ts` (jeu OSM synthétique sur la base de test).

```bash
pnpm osm:import            # relit le cache data/osm/besancon.json, ou télécharge s'il manque
pnpm osm:import --refresh  # retélécharge depuis Overpass
```

### 5.1 Import (Overpass)

Une seule requête Overpass sur l'emprise de Besançon récupère :
- la relation de la commune (`ref:INSEE=25056`), reconstituée en polygone par `ST_Polygonize` ;
- les nœuds `highway=traffic_signals` et `crossing=traffic_signals` ;
- les voies `highway=*`, de `motorway` à `service` (avec leurs `_link`), et les voies `railway=tram`.

Plusieurs serveurs Overpass sont essayés dans l'ordre (overpass-api.de, private.coffee,
mail.ru), et la réponse est mise en cache dans `data/osm/` (non versionné). Les tables
`osm_meta`, `osm_commune`, `osm_signal`, `osm_way` (avec la liste de ses nœuds) et `osm_tram`
sont **supprimées puis recréées** à chaque import, dans une transaction.

On a choisi Overpass plutôt qu'osm2pgsql : aucun binaire à installer, et un volume ciblé
(~900 feux, ~13 700 voies). La **topologie routable** nécessaire aux corridors (phase 1 bis)
reste à construire. Deux pistes : découper `osm_way` en SQL aux nœuds partagés puis
`pgr_extractVertices`, ou passer à `osm2pgrouting` si le SQL devient trop lourd.

### 5.2 Synchronisation de la table `feu`

Chaque feu OSM **situé dans la commune** devient une ligne de `feu` : type `vehicule` si
`highway=traffic_signals`, sinon `pieton` (`crossing=traffic_signals`, avec ou sans
`highway`). La synchronisation se fait dans la transaction de l'import (`ON CONFLICT (osm_id)`) :
- feu nouveau → ajouté, libre (`carrefour_id` nul) ;
- feu existant → position, type et balises mis à jour, **rattachement conservé** ;
- feu disparu d'OSM → `present_osm = false`, jamais supprimé.

### 5.3 Composition manuelle des carrefours

**Pas de regroupement automatique.** Un critère de distance ne sait pas quels feux partagent
un même contrôleur, donc une même programmation. Les carrefours se composent donc à la main,
sur la carte :

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/feux?bbox=` | Feux de l'emprise (type, carrefour, présence OSM) |
| GET | `/api/carrefours/suggestion-nom?feux=<uuid>,…&nature=` | Nom proposé d'après les rues proches |
| POST | `/api/carrefours` `{ feux, nature?, nom? }` | Crée un carrefour à partir de feux **libres** (409 sinon) |
| PATCH | `/api/carrefours/:id` `{ feux?, nature?, nom? }` | Recompose (les feux retirés redeviennent libres), renomme ; le slug ne change pas |
| DELETE | `/api/carrefours/:id` | Libère les feux ; 409 si le carrefour a des relevés ou des plans de feux |

Les routes d'écriture passent par `EditionGuard`, qui n'autorise l'écriture que si
`EDITION_LOCALE=true` (développement local), en attendant l'authentification admin (§12).
À chaque composition, la position du carrefour (centre de ses feux) et `pres_tram` (voie
de tram à moins de 25 m) sont recalculés. Le nom proposé (`proposerNom`, `@voirie/engine`)
reprend les voies nommées à moins de 20 m des feux, par importance puis distance : trois
noms au plus, joints par « × », en ignorant les variantes d'articles.

Import du 26/09/2026 (données OSM de 11h34) : **860 feux** dans la commune (359 véhicule,
501 piéton), aucun carrefour composé.

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
| `JobsModule` | pg-boss : publication des jobs (recalculs, simulations) |
| `FeuxModule` | Feux de l'emprise de la carte |
| Scripts (`apps/api/scripts`) | `prepare-db.ts`, `osm.ts import` (Node 24, sans Nest) |

### 7.2 Endpoints

Public :

| Méthode | Route | Réponse |
|---|---|---|
| GET | `/api/carrefours?bbox=minLon,minLat,maxLon,maxLat` | GeoJSON FeatureCollection léger (id, nom, statut, nature, pres_tram, nb_feux) |
| GET | `/api/feux?bbox=…` | GeoJSON des feux (type, carrefour_id, present_osm) |
| GET | `/api/carrefours/suggestion-nom?feux=…` | Nom proposé pour un groupe de feux |
| GET | `/api/carrefours/:id/branches` | Branches, voies et mouvements calculés ([CONFIGURATION.md](CONFIGURATION.md) §3) |
| GET | `/api/carrefours/:id/branches/detection` | Proposition de branches depuis OSM, non enregistrée |
| GET | `/api/carrefours/:id/lignes` | Lignes de feux, matrice des conflits, mouvements non commandés ([CONFIGURATION.md](CONFIGURATION.md) §4) |
| GET | `/api/carrefours/:id/programme` | Plans de feux par étapes, rouges de dégagement calculés ([CONFIGURATION.md](CONFIGURATION.md) §5) |
| GET | `/api/carrefours/:slug` | Carrefour complet : branches, lignes, plans, synthèse des relevés validés |
| GET | `/api/corridors` | Liste + géométrie |
| GET | `/api/corridors/:slug` | Corridor, carrefours ordonnés, distances, plans, décalages actuels |
| POST | `/api/releves` | 202 : relevé enregistré `en_attente` |
| GET | `/api/time` | `{ now: <ms epoch> }` |
| GET | `/api/exports/carrefours.geojson` | Export ODbL |
| GET | `/api/exports/carrefours.gpkg?srid=2154` | Export Lambert 93 |

Admin (cookie de session, un seul compte) :

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/admin/releves?statut=en_attente` | File de modération |
| POST | `/api/admin/releves/:id/valider` | Crée ou met à jour `plan_feux`, recalcule le statut du carrefour |
| POST | `/api/admin/releves/:id/rejeter` | Avec motif |
| PUT | `/api/admin/carrefours/:id` | Édition (nom, branches, lignes, contrôleur) |
| POST / PATCH / DELETE | `/api/carrefours[/:id]` | Composition manuelle des carrefours (§5.3). Pour l'instant protégée par `EDITION_LOCALE` |
| PUT | `/api/carrefours/:id/branches` | Remplace branches et voies (`EDITION_LOCALE`) |
| PUT | `/api/carrefours/:id/lignes` | Remplace lignes de feux, feux physiques et conflits admis (`EDITION_LOCALE`) |
| PUT | `/api/carrefours/:id/programme` | Remplace les plans ; cycle et diagramme calculés depuis les étapes (`EDITION_LOCALE`) |
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

---

## 9. Flux principaux

### 9.1 Import et composition

```text
Overpass (cache data/osm/) ─▶ pnpm osm:import ─▶ tables osm_* + synchronisation de `feu`
Carte, mode « Composer » : clic sur les feux d'une même programmation ─▶ POST /api/carrefours
                                                                      ─▶ nom proposé, position, pres_tram
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
| `apps/api` | Vitest + supertest contre la vraie base PostGIS + pgRouting (`voirie_test`, migrations appliquées par `test/global-setup.ts`) : import OSM et synchronisation des feux, composition des carrefours, puis distances de corridor et modération | Haute |
| `apps/web` | Vitest + Testing Library sur le chrono et les diagrammes | Moyenne |
| Bout en bout | Playwright : relevé → modération → fiche mise à jour | Plus tard |

---

## 14. Décisions d'architecture

| # | Décision | Alternatives écartées | Raison |
|---|---|---|---|
| 001 | **PostgreSQL + PostGIS + pgRouting** | MongoDB | Requêtes par emprise et proximité (feux, tram, nommage), distances le long du réseau (`pgr_dijkstra`), orientation des branches (`ST_Azimuth`), jointures de proximité (tram), import `osm2pgsql`, reprojection Lambert 93, tuiles `ST_AsMVT` / Martin : tout est natif. Mongo n'offre que des requêtes de proximité en WGS84, le reste serait à recoder en application. La souplesse documentaire est conservée avec `jsonb`. |
| 002 | Programmation stockée **par ligne de feux** (intervalles de vert), en `jsonb` | Stockage par phases ; tables relationnelles `intervalle` | Correspond à l'observation terrain et au diagramme papier. Les phases se déduisent (`engine.plan`), et le format se lit et se valide facilement. |
| 003 | **Calcul métier dans un package TS partagé** | Calcul uniquement côté serveur | L'onde verte doit réagir instantanément aux curseurs. Le même code valide côté API. |
| 004 | **Contributions anonymes + modération** | Comptes utilisateurs ; contributions par PR GitHub | Pas de données personnelles à gérer, et contribuer ne demande pas de compte GitHub. |
| 005 | **pg-boss** pour les jobs | BullMQ + Redis | Un service de moins, et une charge faible. |
| 006 | **Drizzle** + SQL brut pour le spatial | Prisma (PostGIS mal géré), TypeORM | Proche du SQL, typé, géométrie point native. Le spatial s'écrit de toute façon en SQL. Limite connue : SRID à corriger dans les migrations. |
| 007 | Géométries en **4326**, calculs en `geography` ou 2154 | Tout stocker en 2154 | MapLibre et GeoJSON sont en WGS84. Lambert 93 seulement pour les calculs métriques et l'export. |
| 008 | **Horloge corrigée par `GET /time`** dans le chrono | Faire confiance à l'horloge du téléphone | Les décalages entre carrefours reposent sur des `t0` comparables à mieux que ~0,5 s. |
| 009 | **Carrefours composés à la main** à partir des feux (`feu.carrefour_id`) | Regroupement automatique par distance (`ST_ClusterDBSCAN`, essayé puis abandonné) | Un carrefour = un contrôleur = une programmation, ce qu'une distance ne peut pas deviner. L'import ne fait que proposer des feux, jamais des regroupements. |

---

## 15. Correspondance avec les phases

| Phase | Composants livrés |
|---|---|
| **1 — Inventaire des feux** | Import OSM, table `feu`, composition manuelle des carrefours, `carrefour` / `branche` / `ligne_feux` / `plan_feux` / `releve`, carte, fiche + diagramme de feux, chrono PWA, modération, `engine.plan` / `coherence` / `capacite` / `releve` |
| **1 bis — Onde verte** | Topologie pgRouting, `corridor` / `corridor_carrefour`, `engine.decalage` / `ondeVerte` / `optimisation`, écran corridor (espace-temps) |
| **2 — SUMO** | `apps/worker`, pg-boss, `engine.sumo`, table de correspondance lignes ↔ liens, `simulation`, affichage des résultats |
| Transverse | Exports (GeoJSON, GPKG 2154), sauvegardes, publication open data, Martin si besoin |
