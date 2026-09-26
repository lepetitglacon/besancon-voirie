# Configuration d'un carrefour

> Comment décrire un carrefour et sa programmation, « à la TM:PE » (Traffic Manager:
> President Edition, Cities: Skylines). On décrit d'abord la géométrie (branches, voies,
> flèches), puis les lignes de feux, puis le programme par étapes. Les diagrammes en
> découlent. Complète [ARCHITECTURE.md](ARCHITECTURE.md) ; le vocabulaire des feux est
> dans le [README](../README.md#2-vocabulaire-des-feux).

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Conventions](#2-conventions)
3. [Étape 1 — Branches et voies](#3-étape-1--branches-et-voies)
4. [Étape 2 — Lignes de feux et conflits](#4-étape-2--lignes-de-feux-et-conflits)
5. [Étape 3 — Programme par étapes](#5-étape-3--programme-par-étapes)
6. [Étape 4 — Graphes](#6-étape-4--graphes)
7. [Ce qu'OSM fournit déjà](#7-ce-quosm-fournit-déjà)
8. [Découpage en worktrees](#8-découpage-en-worktrees)

---

## 1. Vue d'ensemble

```text
 Carrefour composé à la main (feux regroupés)
        │
 1. Branches      rues qui arrivent au carrefour : nom, sens, nombre de voies
 2. Voies         flèches par voie entrante (← ↑ →), comme les « lane arrows » de TM:PE
        │         ⇒ mouvements déduits : « S → O, tourne-à-gauche, voie 1 »
 3. Lignes        groupes de feux : quels mouvements, quels feux physiques
        │         ⇒ matrice des conflits calculée (qui croise qui)
 4. Programme     étapes à la TM:PE : lignes au vert + durée ; jaune et dégagement ajoutés
        │         ⇒ contrôle : jamais deux lignes en conflit au vert ensemble
 5. Graphes       diagramme de feux (chronogramme) et graphe des étapes (feux actués, tram)
```

Même règle que pour la composition des carrefours : **rien n'est enregistré sans validation
manuelle**. Les détections depuis OSM ne sont que des propositions que l'on corrige.

## 2. Conventions

| Notion | Convention |
|---|---|
| Azimut d'une branche | Degrés, sens horaire depuis le nord, **du centre du carrefour vers la branche**. N = 0, E = 90, S = 180, O = 270. |
| Code d'une branche | Point cardinal de l'azimut (N, NE, E, SE, S, SO, O, NO), suffixé si deux branches tombent dans le même secteur (N, N2). Modifiable. |
| Sens d'une branche | `entrant` (on arrive au carrefour), `sortant` (on en repart) ou `double`. |
| Rang d'une voie | 0 = voie la plus à **gauche** dans le sens d'arrivée (ordre de `turn:lanes` dans OSM). |
| Flèches d'une voie | `gauche`, `tout_droit`, `droite`, `demi_tour` (plusieurs possibles). |
| Direction d'un mouvement | Angle de braquage t = azimut de sortie − (azimut d'entrée + 180°), ramené dans ]−180°, 180°]. \|t\| ≤ 35° : `tout_droit` ; t > 35° : `droite` ; t < −35° : `gauche` ; même branche : `demi_tour`. |
| Mouvement | branche d'origine → branche de destination, avec la direction et les voies qui le permettent. Déduit des flèches, jamais saisi. |

Une flèche « gauche » alimente **toutes** les sorties classées à gauche (carrefour à 5
branches, par exemple). Une flèche sans sortie correspondante est signalée.

## 3. Étape 1 — Branches et voies

### Modèle

```sql
CREATE TYPE sens_branche AS ENUM ('entrant', 'sortant', 'double');
CREATE TYPE type_voie AS ENUM ('generale', 'bus', 'velo', 'tram');

ALTER TABLE branche
  ADD COLUMN sens sens_branche NOT NULL DEFAULT 'double',
  ADD COLUMN voies_sortantes smallint NOT NULL DEFAULT 1,
  ADD COLUMN geom geometry(LineString, 4326);   -- du centre du carrefour vers la branche

CREATE TABLE voie (
  id          uuid PRIMARY KEY,
  branche_id  uuid NOT NULL REFERENCES branche ON DELETE CASCADE,
  rang        smallint NOT NULL,                -- 0 = la plus à gauche en arrivant
  mouvements  text[] NOT NULL,                  -- gauche | tout_droit | droite | demi_tour
  type        type_voie NOT NULL DEFAULT 'generale',
  UNIQUE (branche_id, rang)
);
```

Les **mouvements** ne sont pas stockés : `@voirie/engine` les calcule à partir des branches
et des voies (`calculerMouvements()`), côté API comme côté navigateur.

### Détection depuis OSM (proposition)

1. Cercle autour du carrefour : rayon = distance du feu le plus éloigné + 15 m (entre 20 et 80 m).
2. Chaque voie OSM circulable (`motorway` → `living_street`, `busway`, `road`) qui **traverse ce cercle**
   donne un point de passage. Son azimut, et le sens de parcours de la voie OSM à cet endroit
   (elle entre ou sort du cercle), donnent le sens de la branche avec `oneway`.
   Les voies `service` (parkings, accès riverains) sont écartées : sur le premier carrefour
   testé, elles faisaient passer la proposition de 4 à 8 branches.
3. Les deux chaussées d'un boulevard (deux voies OSM de même nom, à moins de 30° d'écart)
   sont fusionnées en une seule branche.
4. Voies entrantes : `lanes:forward` / `lanes:backward` (ou `lanes`) et flèches
   `turn:lanes[:forward|:backward]` (une voie `none` est lue comme « tout droit »). Sans
   flèches : voie unique = toutes directions ; sinon
   gauche + tout droit à gauche, tout droit au milieu, tout droit + droite à droite. La
   source (`osm` ou `defaut`) est affichée pour savoir quoi vérifier.

### API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/carrefours/:id/branches` | Branches enregistrées, leurs voies et les mouvements calculés |
| GET | `/api/carrefours/:id/branches/detection` | Proposition depuis OSM, **non enregistrée** |
| PUT | `/api/carrefours/:id/branches` | Remplace branches et voies (écriture : `EditionGuard`) |

Implémentation : `apps/api/src/branches/` (`detection.ts` pour la logique pure, testée à
part ; `branches.service.ts` pour la requête PostGIS des points de passage).

### Interface

Bouton « Configurer » dans la bulle d'un carrefour. La carte zoome sur le carrefour et
dessine les branches (lignes, code à l'extrémité, pointillés pour une branche sortante).
Le panneau liste les branches : code, nom, sens, voies entrantes sous forme de cases à
flèches cliquables (↶ ← ↑ →), boutons + / − voie, nombre de voies sortantes, et un badge
« flèches OSM » ou « flèches par défaut, à vérifier ». Les mouvements déduits et les
flèches sans sortie s'affichent en direct. Rien n'est enregistré avant « Enregistrer ».

Premier essai, boulevard Léon Blum × rue Frédéric Chopin : 4 branches proposées (Léon Blum
E et SO, Chopin SE et NO), flèches OSM lues sur les deux approches du boulevard (SO :
tourne-à-gauche + deux voies de tout droit), 10 mouvements, aucune alerte.

Limite actuelle : on ne peut pas encore **ajouter** une branche à la main (seulement corriger
ou supprimer celles proposées). À faire si une rue manque dans OSM.

## 4. Étape 2 — Lignes de feux et conflits

- `ligne_feux` (existe) reçoit la liste des **mouvements** qu'elle commande (`N>E`…), et les
  **feux physiques** (table `feu`) qui l'affichent. Types : véhicules (R11v), piétons (R12,
  traversée d'une branche), vélos (R13c), transports en commun (R17/R18).
- **Matrice des conflits** calculée par le moteur. Deux mouvements se croisent si leurs
  cordes se coupent dans l'ordre circulaire des branches ; deux mouvements vers la même
  sortie convergent. Une traversée piétonne d'une branche est en conflit avec tout mouvement
  qui entre ou sort par cette branche. On peut forcer une compatibilité à la main (tourne-à-
  droite autorisé avec piétons, par exemple). C'est l'équivalent de l'écran
  « antagonismes » de DiagFeux.

## 5. Étape 3 — Programme par étapes

Saisie comme les feux temporisés de TM:PE :

```yaml
etapes:
  - { lignes: [F1, F3, P2], duree_s: 34 }
  - { lignes: [F2, F4, P1], duree_s: 26 }
jaune_s: 3
```

- Entre deux étapes, le moteur insère le **jaune** (3 s en agglomération) puis le **rouge
  de dégagement** entre lignes en conflit (valeur par défaut 2 s, puis calcul CERTU à
  partir des trajectoires et vitesses de dégagement).
- Contrôles : aucune paire de lignes en conflit au vert dans une même étape, vert minimal
  6 s, vert piéton ≥ longueur de traversée / 1 m/s, cycle ≤ 120 s.
- Le programme par étapes est **converti** en diagramme par ligne (`plan_feux.lignes`,
  intervalles de vert). Le relevé terrain au chronomètre produit l'inverse (diagramme par
  ligne) : le moteur sait reconstruire les étapes à partir des instants de changement.

## 6. Étape 4 — Graphes

**Diagramme de feux** (chronogramme) : une ligne par ligne de feux, sur un cycle. C'est la
forme enregistrée, comparée au terrain et envoyée à SUMO.

```text
      0s        20        40        60        80s
F1  ██████████████████▒░░░░░░░░░░░░░░░░░░░░░░░
F3  ░░░░░░░░░░░░░░░░░░░░░██████████████████▒░░
P1  ██████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
    █ vert  ▒ jaune  ░ rouge
```

**Graphe des étapes** : nœuds = étapes, arcs = transitions et leurs conditions. Indispensable
pour les feux actués (bouton piéton, détection) et la **priorité tram** (48 carrefours à
moins de 25 m d'une voie de tram), qu'un chronogramme seul ne décrit pas.

```text
[É1 : axe 34 s] ──> [É2 : transversale 20 s] ──> [É1]
      │ tram détecté
      └──> [É-tram : tram seul 12 s] ──> reprise en É2
```

## 7. Ce qu'OSM fournit déjà

Mesuré le 26/09/2026 autour des 359 feux véhicules (voies circulables à moins de 15 m) :

| Donnée OSM | Couverture |
|---|---|
| Voies concernées | 685 |
| `lanes` (nombre de voies) | 378 (55 %) |
| `turn:lanes*` (flèches par voie) | 85 (12 %) |
| `oneway` | 448 (65 %) |
| `maxspeed` | 539 (79 %) |
| Feux avec `traffic_signals:direction` | 163 / 359 |

Les flèches sont donc **surtout à saisir à la main** : la détection propose, on corrige.

## 8. Découpage en worktrees

| Worktree | Contenu |
|---|---|
| `config-branches` | Étape 1 : branches, voies, flèches, mouvements ; détection OSM ; éditeur |
| `config-lignes` | Étape 2 : lignes de feux, rattachement des feux physiques, matrice des conflits |
| `config-programme` | Étape 3 : éditeur d'étapes, jaune et dégagement, conversion en diagramme |
| `config-graphes` | Étape 4 : chronogramme, graphe des étapes, comparaison avec les relevés terrain |
