# Configuration d'un carrefour

> Comment décrire un carrefour et sa programmation, « à la TM:PE » (Traffic Manager:
> President Edition, Cities: Skylines). On dessine d'abord la géométrie sur la photo aérienne
> (branches, voies, passages piétons) et on relie les voies entre elles comme avec le
> « lane connector » ; puis les lignes de feux ; puis le programme par étapes. Les diagrammes en
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
 1. Branches      rues qui arrivent au carrefour, voies calées sur la photo IGN, passages piétons
 2. Connexions    glisser d'une voie entrante vers une voie sortante (« lane connector »)
        │         ⇒ flèches et mouvements déduits : « S → O, tourne-à-gauche, voie 1 »
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
| Rang d'une voie | 0 = voie la plus à **gauche** dans son sens de circulation (ordre de `turn:lanes` dans OSM). |
| Position des voies | Vues du centre vers la branche : entrantes à gauche de l'axe, sortantes à droite (circulation à droite). |
| Géométrie d'une voie | Segment [bout côté carrefour, bout éloigné]. Les connexions partent du bout côté carrefour d'une entrante et arrivent au bout côté carrefour d'une sortante. |
| Clé d'une voie | `branche:e<rang>` (entrante) ou `branche:s<rang>` (sortante), par exemple `S:e0`, `O:s1`. |
| Flèches d'une voie | `gauche`, `tout_droit`, `droite`, `demi_tour` : **déduites des connexions**, jamais saisies. |
| Direction d'un mouvement | Angle de braquage t = azimut de sortie − (azimut d'entrée + 180°), ramené dans ]−180°, 180°]. \|t\| ≤ 35° : `tout_droit` ; t > 35° : `droite` ; t < −35° : `gauche` ; même branche : `demi_tour`. |
| Mouvement | branche d'origine → branche de destination, avec la direction et les voies qui le permettent. Déduit des connexions. |

## 3. Étape 1 — Branches, voies et connexions

### Modèle

```sql
-- branche : code, nom, azimut, axe (geom), sens déduit des voies, passage piéton (traversee)
ALTER TABLE branche ADD COLUMN traversee geometry(LineString, 4326);

CREATE TABLE voie (
  id          uuid PRIMARY KEY,
  branche_id  uuid NOT NULL REFERENCES branche ON DELETE CASCADE,
  sens        sens_voie NOT NULL,                      -- entrante | sortante
  rang        smallint NOT NULL,                       -- 0 = la plus à gauche dans son sens
  type        type_voie NOT NULL DEFAULT 'generale',   -- generale | bus | velo | tram
  geom        geometry(LineString, 4326) NOT NULL,     -- [bout côté carrefour, bout éloigné]
  UNIQUE (branche_id, sens, rang)
);

CREATE TABLE connexion (                               -- « lane connector »
  id              uuid PRIMARY KEY,
  carrefour_id    uuid NOT NULL REFERENCES carrefour ON DELETE CASCADE,
  voie_entree_id  uuid NOT NULL REFERENCES voie ON DELETE CASCADE,
  voie_sortie_id  uuid NOT NULL REFERENCES voie ON DELETE CASCADE,
  UNIQUE (voie_entree_id, voie_sortie_id)
);
```

Les **flèches** et les **mouvements** ne sont pas stockés : `@voirie/engine` les déduit des
connexions (`flechesParVoie`, `mouvementsDepuisConnexions`), côté API comme côté navigateur.

### Détection depuis OSM (proposition)

1. Cercle autour du carrefour : rayon = distance du feu le plus éloigné + 15 m (entre 20 et 80 m).
2. Chaque voie OSM circulable (`motorway` → `living_street`, `busway`, `road`) qui **traverse ce
   cercle** donne un point de passage. Son azimut, et le sens de parcours de la voie OSM à cet
   endroit, donnent le sens de la branche avec `oneway`. Les voies `service` (parkings, accès
   riverains) sont écartées.
3. Les deux chaussées d'un boulevard (même nom, moins de 30° d'écart) forment une seule branche.
4. Nombre de voies et flèches : `lanes:forward` / `lanes:backward` (ou `lanes`), `turn:lanes*`
   (`none` lu comme « tout droit ») ; à défaut, voie unique = toutes directions, sinon gauche +
   tout droit à gauche, tout droit au milieu, tout droit + droite à droite.
5. **Voies générées** (`genererVoies`) parallèles à l'axe : 3,25 m de large, ligne d'arrêt à
   15 m du centre, 25 m de long ; passage piéton 3 m en avant de la ligne d'arrêt, d'un
   trottoir à l'autre (1,5 m de débord).
6. **Connexions proposées** (`proposerConnexions`) à partir des flèches : tourne-à-gauche vers
   la voie sortante la plus à gauche, tourne-à-droite vers la plus à droite, tout droit voie
   par voie. Le badge indique si elles viennent d'OSM ou des règles par défaut.

### API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/carrefours/:id/branches` | Centre, branches (voies, passages piétons), connexions, mouvements, flèches, alertes |
| GET | `/api/carrefours/:id/branches/detection` | Proposition depuis OSM, **non enregistrée** |
| PUT | `/api/carrefours/:id/branches` | `{ branches, connexions }` : remplace tout (`EditionGuard`) |

Validation : codes de branche uniques, rangs consécutifs depuis 0 dans chaque sens, une
connexion part d'une voie entrante existante vers une voie sortante existante, sans doublon.

### Interface (onglet « 1. Branches »)

L'éditeur est un **calque SVG** posé sur la carte (`apps/web/src/configuration/calque/`) : chaque
voie, passage piéton, connexion et poignée est un composant React, avec ses états en classes CSS
(survol, voies liées, cible possible, cible, « à retirer »…) et des événements pointeur natifs.
Le calque suit la carte à chaque déplacement (projection lon/lat → pixels recalculée une fois
par image). Son fond laisse passer les gestes vers la carte. La vue d'ensemble de la ville
(feux, carrefours) reste en couches MapLibre, plus efficaces pour des centaines d'éléments.

Sur la **photo aérienne** (bouton « Photo aérienne »), l'éditeur dessine :
- les voies à leur largeur réelle, en couleur pour les entrantes (une couleur par voie,
  comme TM:PE) et en gris pour les sortantes ;
- les passages piétons en violet ;
- les connexions en courbes de Bézier, de la couleur de leur voie de départ ;
- les flèches déduites et le code de chaque branche.

- **✥ Ajuster les voies** : faire glisser les extrémités des voies et des passages piétons pour
  les caler sur le marquage de la photo.
- **⤳ Connecter** : glisser du point coloré d'une voie entrante vers le point blanc d'une voie
  sortante. Pendant le geste, les voies sortantes s'allument et la plus proche est accrochée
  (élastique vert). Refaire le même geste, ou cliquer sur une courbe, retire la connexion.
- Survoler une voie met en avant ses connexions. Pendant un ajustement, les voies et courbes
  suivent le pointeur en direct.
- Dans l'onglet des lignes, les connexions de la ligne active sont mises en avant.
- Dans le panneau, par branche : code (renommer met à jour les connexions), nom, voies
  entrantes et sortantes (+ / −, une voie ajoutée se place à côté de la dernière sans
  déplacer les voies déjà calées), type de chaque voie, flèches déduites, passage piéton,
  « Replacer » (revenir à la position proposée). Puis la liste des connexions, les mouvements
  déduits et les voies entrantes sans connexion.

Premier essai, Léon Blum × Chopin : 4 branches, 12 connexions et 10 mouvements proposés.
Les flèches déduites correspondent au marquage OSM (SO : tourne-à-gauche et deux tout droit).
Les voies générées tombent près des chaussées mais doivent être recalées à la main. C'est le
rôle du mode « Ajuster ».

## 4. Étape 2 — Lignes de feux et conflits

### Modèle

```sql
-- ligne_feux : code (F1, P1, V1, T1…), signal (R11v, R12, R13c, R17, R18),
--              mouvements text[] (clés « S>O »), traverse (branche traversée, piétons)
CREATE TABLE ligne_feux_feu (            -- feux physiques qui affichent une ligne
  ligne_feux_id uuid REFERENCES ligne_feux ON DELETE CASCADE,
  feu_id        uuid REFERENCES feu ON DELETE CASCADE,
  PRIMARY KEY (ligne_feux_id, feu_id)
);
ALTER TABLE carrefour ADD COLUMN conflits_admis jsonb NOT NULL DEFAULT '[]';  -- [["F1","P1"], …]
```

Règles (validées par l'API) : une ligne piétonne (R12) emprunte le passage piéton d'une branche et ne commande
aucun mouvement ; les autres commandent au moins un mouvement ; un mouvement n'est commandé
que par une seule ligne ; les mouvements, branches et feux doivent appartenir au carrefour.

### Calcul des conflits (`@voirie/engine`, `conflits.ts`)

Les conflits se calculent sur la **géométrie réelle** : chaque connexion est une courbe de
Bézier du bout de sa voie entrante au bout de sa voie sortante, dans un repère local en mètres.

| Cas | Résultat |
|---|---|
| Deux trajectoires issues de la même voie entrante | compatibles |
| Deux trajectoires qui arrivent sur la même voie sortante | `convergence` |
| Deux courbes qui se coupent | `croisement` |
| Tout-droit opposés, tourne-à-gauche opposés | compatibles (les courbes ne se coupent pas) |
| Tourne-à-gauche contre tout-droit d'en face | `croisement` |
| Deux voies qui rejoignent des voies de sortie différentes d'une même rue | compatibles |
| Passage piéton coupé par une trajectoire | `pieton` |

Deux lignes sont en conflit si l'un de leurs mouvements l'est. Un conflit peut être **admis**
à la main : les deux lignes pourront être au vert ensemble. Exemples : tourne-à-droite avec
les piétons, tourne-à-gauche qui cède le passage au tout-droit d'en face. L'étape 3
refusera toute étape qui met au vert deux lignes en conflit non admis.

### API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/carrefours/:id/lignes` | Lignes, conflits admis, matrice des conflits, mouvements non commandés, références cassées |
| PUT | `/api/carrefours/:id/lignes` | Remplace lignes, feux physiques et conflits admis (`EditionGuard`) |

### Interface (onglet « 2. Lignes de feux »)

- Boutons « + Véhicules », « + Piétons », « + Vélos », « + Tram/bus », et « Proposer une ligne
  par branche entrante » (point de départ à ajuster).
- Par ligne : code, type de signal, mouvements à cocher (grisés s'ils appartiennent déjà à
  une autre ligne) ou branche traversée pour les piétons, puis « Choisir les feux sur la
  carte » : un clic sur un feu du carrefour l'ajoute à la ligne ou l'en retire (feux en bleu).
- Mouvements sans ligne signalés. **Matrice des conflits** en direct : ✕ croisement,
  ⋎ même sortie, P piétons ; un clic sur une case admet le conflit (✓) ou annule l'admission.
- Les lignes s'appuient sur les **branches enregistrées**. Si les branches changent ensuite,
  les références devenues invalides sont signalées.

Premier essai (Léon Blum × Chopin) : la proposition donne 4 lignes, une par arrivée, toutes
en croisement deux à deux. C'est attendu, puisque chaque ligne mêle tourne-à-gauche et
tout-droit. Il faut ensuite séparer les tourne-à-gauche ou admettre les conflits
correspondants, selon ce qu'on observe sur place.

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
| `config-branches` | Étape 1, première version : branches et flèches par voie (remplacée par `config-lignes`) |
| `config-lignes` | Étape 1 refondue (voies sur la photo, connexions, passages piétons) et étape 2 : lignes de feux, feux physiques, conflits géométriques |
| `config-programme` | Étape 3 : éditeur d'étapes, jaune et dégagement, conversion en diagramme |
| `config-graphes` | Étape 4 : chronogramme, graphe des étapes, comparaison avec les relevés terrain |
