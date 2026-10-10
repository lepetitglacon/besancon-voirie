# Réseau routier

> Toute la ville en graphe, à la TM:PE (Traffic Manager: President Edition, Cities: Skylines) :
> des **tronçons** voie par voie relient des **nœuds** (intersections, feux, passages piétons),
> et les voies se relient à chaque nœud par des **liaisons** (« lane connector »). Le réseau est
> semé une fois depuis OSM, puis corrigé sur la photo IGN. Un **carrefour** est un groupe de
> nœuds : ses branches, voies et connexions s'en déduisent. Le réseau s'exporte au format SUMO
> (phase 2). Complète [ARCHITECTURE.md](ARCHITECTURE.md) ; lignes de feux et programme :
> [CONFIGURATION.md](CONFIGURATION.md) ; choix du modèle : [reseau-d-abord.md](reseau-d-abord.md).

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Modèle](#2-modèle)
3. [Semis depuis OSM](#3-semis-depuis-osm)
4. [Carrefours bâtis sur le réseau](#4-carrefours-bâtis-sur-le-réseau)
5. [Export SUMO](#5-export-sumo)
6. [API](#6-api)
7. [Éditeur des voies](#7-éditeur-des-voies)

---

## 1. Vue d'ensemble

```text
 osm_way, osm_signal, osm_passage (pnpm osm:import)
    │  semis, une seule fois : découpe aux intersections, aux feux et aux passages piétons
    ▼
 nœuds ──── tronçons ──── nœuds       ← corrigés sur la photo : déplacer, couper, tracer,
    │   voies par sens, typées           voies et types, feux, passages, liaisons
    │   (générale, bus, vélo, tram)
    ▼
 carrefour = groupe de nœuds (pris parmi ses feux, complété à la main)
    │  vueCarrefour : branches, voies, passages, connexions et leur tracé
    ▼
 branche / voie / connexion  ──▶  lignes de feux, conflits, programme, temps réel
    │
 reseau.nod.xml / .edg.xml / .con.xml  ──netconvert──▶  reseau.net.xml (SUMO)
```

Le réseau est une donnée de référence : semé une fois, il ne se régénère pas. Ses identifiants
restent stables, car les liaisons, les carrefours et les lignes de feux y renvoient. Une nouvelle
version d'OSM passera par une réconciliation relue ([reseau-d-abord.md](reseau-d-abord.md), étape 3).

## 2. Modèle

```sql
CREATE TYPE source_reseau AS ENUM ('osm', 'manuel');
CREATE TYPE traversee_pieton AS ENUM ('feux', 'marquee', 'non_marquee');

CREATE TABLE noeud (
  id            uuid PRIMARY KEY,
  osm_node_id   bigint UNIQUE,                        -- nœud OSM d'origine
  carrefour_id  uuid REFERENCES carrefour ON DELETE SET NULL,  -- plusieurs nœuds par carrefour
  geom          geometry(Point, 4326) NOT NULL,
  liaisons      jsonb,              -- liaisons saisies [{de, voie_de, vers, voie_vers}] ; null : proposées
  placements_voies jsonb,           -- places visuelles des bouts de voies {"<tronçon>:avant:0": {recul, decalage}} ; null : automatiques
  feux          boolean NOT NULL DEFAULT false,   -- ligne d'arrêt à feux des véhicules
  pieton        traversee_pieton                  -- passage piéton sur le nœud
);

CREATE TABLE troncon (
  id             uuid PRIMARY KEY,
  noeud_de       uuid NOT NULL REFERENCES noeud ON DELETE CASCADE,
  noeud_vers     uuid NOT NULL REFERENCES noeud ON DELETE CASCADE,
  geom           geometry(LineString, 4326) NOT NULL,   -- de noeud_de vers noeud_vers
  osm_way_id     bigint, osm_de bigint, osm_vers bigint, osm_tags jsonb,  -- provenance OSM
  nom text, highway text,
  voies_avant    smallint NOT NULL,   -- dans le sens de tracé (0 : sens interdit)
  voies_arriere  smallint NOT NULL,   -- dans l'autre sens
  types_avant    jsonb, types_arriere jsonb,  -- type de chaque voie, rang 0 à gauche ; null : générales
  vitesse_kmh    smallint,            -- null : vitesse par défaut du type de voie
  source         source_reseau NOT NULL,
  modifie        boolean NOT NULL DEFAULT false,  -- tronçon OSM corrigé à la main
  supprime       boolean NOT NULL DEFAULT false,  -- tronçon OSM supprimé : masqué, gardé
  branche_de text, branche_vers text,             -- code de la branche que forme ce bout (N, S…)
  CHECK (voies_avant + voies_arriere > 0), CHECK (noeud_de <> noeud_vers)
);

ALTER TABLE connexion ADD COLUMN trace geometry(LineString, 4326);  -- chemin à travers le carrefour
```

| Notion | Convention |
|---|---|
| Sens d'un tronçon | `avant` : de `noeud_de` vers `noeud_vers`, dans le sens de la géométrie. « Inverser » retourne la géométrie et échange tout (nœuds, voies, types, codes de branche). |
| Rang d'une voie | 0 = la plus à gauche dans son sens de circulation. Une voie vélo le long de la chaussée est la dernière (la plus à droite), sauf à gauche d'un sens unique. |
| Types de voies | `generale`, `bus`, `velo`, `tram`. `types_avant` null : toutes générales ; une liste plus courte est complétée par des voies générales. |
| Voies d'une rue | `voiesTroncon` : tout du long de l'axe, `avant` à droite de l'axe et `arriere` à gauche (rang 0 contre l'axe), un sens unique centré. Reculées aux intersections (`retraitAuNoeud` : 3 m entre deux tronçons, 4 m + 0,6 voie par voie au-delà) pour laisser la place aux liaisons. |
| Place visuelle d'un bout de voie | Au nœud, le bout d'une voie peut être posé à la main sur la photo (docs/voies-position-visuelle.md) : `recul` le long de la voie, `decalage` de côté (positif à droite du sens de circulation). Le bloc de 40 m du bout glisse d'un tenant, et pivote si `decalage_loin` diffère de `decalage`, puis la voie rejoint sa place sur 10 m (`placerBoutVoie`). Dans un carrefour, chaque voie de branche garde `geom` (place automatique : mouvements, conflits) et reçoit `trace` (la voie dessinée, pour le calque). **Seul le dessin le suit** (rues, liaisons, calque du carrefour) : ni le graphe, ni les connexions, ni l'export SUMO. |
| Liaisons d'un nœud | D'une voie qui arrive (`de`, `voie_de`) vers une voie qui repart (`vers`, `voie_vers`). Proposées par `liaisonsParDefaut` : tout droit voie à voie, tourne-à-gauche de gauche à gauche, tourne-à-droite de droite à droite, pas de demi-tour (braquage ≥ 150°, même vers l'autre chaussée d'un boulevard) ; deux tronçons seuls se prolongent voie à voie (`liensParDefaut` : 1 → 3 élargit, 3 → 1 rejoint). Les voies vélo se relient entre elles ; sans voie vélo en face, un vélo rejoint la voie de droite (de gauche pour tourner à gauche) ; une piste cyclable part de la voie de droite d'une rue sans voie vélo ; une voiture n'est jamais envoyée sur une voie vélo. Des liaisons saisies devenues impossibles sont ignorées. |
| Ligne d'arrêt | Un nœud `feux` : feu véhicule OSM (`highway=traffic_signals`) posé sur la voie, ou saisi. Un feu piéton (`crossing=traffic_signals`) est un passage piéton `pieton = feux`. |

## 3. Semis depuis OSM

```bash
pnpm osm:import --refresh   # une fois : l'import ramène aussi pistes cyclables et passages piétons
pnpm reseau:semer           # client de l'API (pnpm dev doit tourner) : POST /api/reseau/semer
```

1. Voies de `osm_way` : circulables (`motorway` → `living_street`, `busway`, `road`, leurs `_link` ;
   sans `service`, sans `area=yes`, sans `access=no` ni `motor_vehicle=no`), et pistes
   cyclables (`highway=cycleway`, ou `path` + `bicycle=designated`).
2. **Découpe** (`decouperVoies`, [osm.ts](../apps/api/src/reseau/osm.ts)) : un nœud OSM partagé
   par deux voies coupe la voie, ainsi que chaque feu (`osm_signal`) et chaque passage piéton
   (`osm_passage`) de la voie. Une boucle est coupée à mi-parcours (SUMO refuse une arête d'un
   nœud vers lui-même).
3. **Voies par sens** (`voiesParSens`) : `lanes:forward` / `lanes:backward`, sinon `lanes`,
   `oneway` (`-1` : sens inverse), giratoires en sens unique. Puis les voies vélo le long de la
   chaussée : `cycleway`, `cycleway:right|left|both` = `lane` ou `track` (double sens : la voie
   vélo de droite pour le sens avant, celle de gauche pour l'autre), `opposite_lane` et
   `cycleway:left:oneway=-1` (contresens cyclable). Piste cyclable : une voie vélo par sens
   autorisé (`oneway:bicycle`). `highway=busway` : voies de bus. Vitesse : `maxspeed`.
4. **Nœuds** : `feux` pour un feu véhicule, `pieton` d'après `crossing` (`traffic_signals` : à
   feux ; `unmarked` : non marqué ; sinon marqué).
5. **Une seule fois** : un second semis est refusé (409). `--reinitialiser` (ou
   `{ "reinitialiser": true }`) efface tout le réseau, corrections et liaisons comprises, le sème
   de nouveau, puis retrouve les nœuds de chaque carrefour d'après ses feux.

Semis du 27/09/2026 (données OSM de 16:52 UTC, 6 904 voies) : **11 313 nœuds**, **13 036
tronçons** dont 978 cyclables, 360 lignes d'arrêt à feux, 3 309 passages piétons, en moins
d'une seconde.

## 4. Carrefours bâtis sur le réseau

### Composition

On compose un carrefour comme avant, en choisissant ses feux ([ARCHITECTURE.md
§5.3](ARCHITECTURE.md#53-composition-manuelle-des-carrefours)). Il prend alors les nœuds libres
parmi ses feux (`rattacherNoeuds`, [carrefours.ts](../apps/api/src/reseau/carrefours.ts)) :
ceux à moins de 8 m de l'enveloppe convexe des feux, et les nœuds OSM de ses feux. Un giratoire
prend aussi tout son anneau (tronçons `junction=roundabout` reliés). Ajouter des feux ajoute les
nœuds qu'ils couvrent ; les nœuds se retirent ou s'ajoutent ensuite à la main (outil Nœuds). Un
nœud appartient à un carrefour au plus.

### Vue du carrefour

`vueCarrefour` ([@voirie/engine](../packages/engine/src/vueCarrefour.ts)) déduit du groupe de
nœuds ce qu'attendent les lignes de feux, les conflits et le programme :

- **Branche** : un tronçon qui entre dans le groupe. On suit son **approche** vers l'intérieur
  (nœuds de degré 2 : passage piéton, élargissement) jusqu'à la première ligne d'arrêt à feux,
  à défaut le premier passage piéton à feux (traversée piétonne), à défaut l'intersection. Ses
  voies entrantes arrivent là, ses voies sortantes en repartent. Son code est son point
  cardinal (N, NE…, suffixé s'il est pris), gardé ensuite sur le bout du tronçon
  (`branche_de` / `branche_vers`) : les lignes de feux y renvoient.
- **Branche interne** : un feu véhicule sur un tronçon interne, hors des approches (terre-plein
  central d'une chaussée séparée, anneau d'un giratoire). Codes R1, R2… On y arrive (voies
  sortantes, prises à leur départ du nœud d'avant), puis on en repart (voies entrantes).
- **Connexion** : d'une voie entrante à une voie sortante (ou une ligne d'arrêt interne),
  dessinée en courbe entre les deux voies, comme dans un carrefour dessiné à la main. Le
  carrefour est une **boîte noire** : on n'en voit que les bouts des rues, pas les nœuds ni les
  liaisons de son cœur. Celles **proposées** suivent les liaisons de chaque nœud du groupe (le
  chemin existe dans le réseau) ; une fois retouchées dans le calque du carrefour (outil
  Liaison) et enregistrées, elles sont **saisies** (`carrefour.connexions_saisies`) et gardées
  quand le réseau change, sauf celles dont une voie a disparu. « Reprendre les proposées »
  (`DELETE /branches/connexions`) les oublie.
- **Passage piéton** d'une branche : d'abord un passage tracé librement (`passage_pieton`) qui
  coupe sa ligne d'arrêt ou son approche (`branche.passage_id`, ses feux reliés vont aux lignes
  piétonnes qui la traversent) ; sinon celui d'un nœud, sur sa ligne d'arrêt, entre elle et
  l'intersection, sinon en amont, en travers du tronçon, de la largeur de ses voies plus 1,5 m de
  chaque côté.

La vue est **écrite** dans `branche`, `voie` et `connexion` (`materialiserCarrefour`) à chaque
modification du réseau autour du carrefour : nœud déplacé, ajouté ou retiré, tronçon tracé,
coupé, fusionné, modifié ou supprimé, liaisons saisies. Lignes de feux, conflits, programme et
temps réel les lisent sans changement ; le sens des mouvements s'y lit sur les voies. Pour un
carrefour bâti sur le réseau, `PUT /branches` n'enregistre que les connexions (ses branches se
déduisent du réseau) ; une connexion vers une voie qu'il n'a pas est refusée (400). Un carrefour
sans nœud (réseau non semé, tests) garde ses branches saisies à la main.

> 💡 L'export SUMO écrit le cœur de chaque carrefour en une seule jonction, avec ses connexions
> (saisies ou proposées) et son programme : voir §5.

## 5. Export SUMO

```bash
pnpm reseau:sumo [--bbox=ouest,sud,est,nord]   # écrit data/sumo/reseau.{nod,edg,con,tll}.xml et reseau.netccfg
cd data/sumo && netconvert -c reseau.netccfg     # → reseau.net.xml
```

Format « plain XML » de SUMO (`exporterSumo`, [sumo.ts](../packages/engine/src/sumo.ts)), en
longitude, latitude : netconvert les projette en UTM (`proj.plain-geo`, `proj.utm`), et
`sumolib` sait revenir en lon/lat (`net.convertXY2LonLat`).

| Élément | SUMO |
|---|---|
| Nœud du réseau | uuid du nœud, `type="priority"` |
| Cœur d'un carrefour | Nœuds au-delà des lignes d'arrêt : **une seule jonction** `c<carrefour>`, `type="traffic_light" tl="c<carrefour>"`, au barycentre de ces nœuds ; les tronçons du cœur disparaissent ([sumoCarrefours.ts](../packages/engine/src/sumoCarrefours.ts)) |
| Approche d'un carrefour | Nœuds entre le bord du carrefour et une ligne d'arrêt (passage piéton, début de présélection) : nœuds ordinaires, les voies d'approche restent des arêtes |
| Connexions d'un carrefour | Ses connexions (saisies ou proposées), de l'arête de la ligne d'arrêt à celle qui repart ; une branche interne (R1…) se traverse (O → R1 puis R1 → E donne O → E) |
| Programme d'un carrefour | `reseau.tll.xml` : `<tlLogic id="c<carrefour>" programID="<plan>">`, d'après le premier plan à cycle (une phase par période sans changement : `G` vert, `y` jaune, `r` rouge, `o` lien sans ligne), et le `linkIndex` de chaque lien. Sans plan à cycle valide : programme par défaut de netconvert |
| Carrefour coupé par l'emprise exportée | Ses nœuds restent séparés, `tl="c<carrefour>"` partagé (comme avant) |
| Tronçon, sens avant / arrière | `t<tronçon>` / `-t<tronçon>` ; voies bus, vélo, tram : `<lane allow="bus\|bicycle\|tram"/>`, une voie vélo avec `width="1.50"` ; une voie dont l'emprise est dessinée prend sa largeur moyenne (`width`) |
| Liaisons de chaque nœud hors carrefour | `<connection>` (saisies, ou à défaut proposées) : ce qu'on voit dans l'éditeur est ce que SUMO simule. SUMO numérote les voies de la droite vers la gauche : index = nombre de voies − 1 − rang. |
| Places visuelles des bouts de voies | Ignorées : la forme des arêtes vient du tracé des tronçons, jamais de la géométrie des voies dessinées. |

## 6. API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/reseau?bbox=` | Tronçons (6 000 au plus, `tronque` au-delà), nœuds de l'emprise avec leurs liaisons, passages piétons tracés librement |
| POST | `/api/reseau/semer` | `{ reinitialiser? }` : sème le réseau depuis OSM, une seule fois (409 ensuite) ; bilan (`EditionGuard`) |
| POST | `/api/reseau/troncons` | `{ points, de, vers, nom, voies_avant, voies_arriere, vitesse_kmh }` ; chaque bout s'accroche à un nœud (`{type:'noeud', id}`), coupe un tronçon (`{type:'troncon', id}`, au point le plus proche, ou sur son bout à moins de 1,5 m) ou crée un nœud (`{type:'libre'}`) (`EditionGuard`) |
| PATCH | `/api/reseau/troncons/:id` | Nom, voies par sens, types de voies, vitesse, tracé (`points`, bouts gardés sur leurs nœuds), `inverser` ; `voie` : ajouter ou retirer une voie à un rang (types, emprises et liaisons saisies aux deux bouts suivent) ; `emprise` : poser ou retirer l'emprise d'une voie (`EditionGuard`) |
| DELETE | `/api/reseau/troncons/:id` | Supprime (tracé à la main) ou masque (OSM) (`EditionGuard`) |
| POST | `/api/reseau/troncons/:id/couper` | `{ position, feux?, pieton? }` : nouveau nœud, qui peut porter d'emblée une ligne d'arrêt ou un passage piéton, au point le plus proche ; voies, types et liaisons gardés de part et d'autre ; entre deux nœuds d'un même carrefour, le nœud en fait partie (`EditionGuard`) |
| PATCH | `/api/reseau/noeuds/:id` | `{ position?, feux?, pieton?, carrefour_id?, placements_voies? }` : déplacer (les tronçons suivent), ligne d'arrêt à feux, passage piéton, carrefour (null : l'en retirer) (`EditionGuard`) |
| DELETE | `/api/reseau/noeuds/:id` | Retire un nœud entre deux tronçons de mêmes voies : ils n'en font plus qu'un ; 400 sinon (`EditionGuard`) |
| POST | `/api/reseau/noeuds/fusion` | `{ noeuds, position? }` ou `{ carrefour, coeur?, position? }` : réunit des nœuds en un seul, au barycentre ; les tronçons entre eux disparaissent (masqués s'ils viennent d'OSM) ; 400 pour des nœuds de carrefours différents (`EditionGuard`) |
| POST | `/api/reseau/passages` | `{ points: [a, b], type, troncons?, feux }` : passage piéton tracé librement ; sans `troncons`, ceux qu'il coupe (`EditionGuard`) |
| PATCH / DELETE | `/api/reseau/passages/:id` | Tracé, type, tronçons traversés, feux reliés ; suppression. Les carrefours des tronçons touchés sont recalculés (`EditionGuard`) |
| PUT | `/api/reseau/noeuds/:id/liaisons` | `{ liaisons: [...] \| null }` (null : proposées) ; 400 pour une voie qui n'arrive pas au nœud (`EditionGuard`) |
| GET | `/api/reseau/sumo/:fichier[?bbox=]` | `reseau.nod.xml`, `reseau.edg.xml`, `reseau.con.xml`, `reseau.netccfg` |
| GET | `/api/carrefours/:id/branches` | Vue du carrefour : `graphe: true` pour un carrefour bâti sur le réseau, et `connexions_saisies` |
| PUT | `/api/carrefours/:id/branches` | Carrefour bâti sur le réseau : n'enregistre que ses connexions, gardées ensuite quand le réseau change ; 400 pour une voie qu'il n'a pas (`EditionGuard`) |
| DELETE | `/api/carrefours/:id/branches/connexions` | Oublie les connexions saisies, reprend celles proposées d'après les liaisons des nœuds (`EditionGuard`) |

Chaque modification recalcule les carrefours dont les nœuds sont touchés, dans la même
transaction. Un tronçon OSM corrigé (voies, tracé, nœud déplacé, coupé) est marqué `modifie`.

## 7. Éditeur des voies

**≡ Voies** sur la carte (touche <kbd>R</kbd>, mode Édition) : tout le réseau sur la photo IGN,
imposée à plat. En dessous du zoom 16, chaque tronçon est un trait de la largeur de sa chaussée ;
à partir du zoom 16, il est dessiné voie par voie, chaque voie à sa largeur au sol (3,25 m, 1,5 m
pour une voie vélo) : voies vélo en vert, bus en rouge, tram en violet, les autres en gris
(OSM), orange (corrigées) ou vert clair (tracées à la main). Chaque nœud montre sa ligne d'arrêt
à feux (pastille rouge) et son passage piéton (zébras en travers de la rue). Un carrefour est
une boîte noire : au cœur, entre ses lignes d'arrêt, seul l'axe des tronçons est dessiné, en
pointillés, sans nœuds ni liaisons ; l'outil Nœuds les montre tous, cerclés de violet (d'orange
pour le carrefour ouvert). Un clic sur le disque d'un carrefour l'ouvre ; au zoom des voies, les
voies et les nœuds qu'il recouvre passent avant lui, pas les feux.

Tout est dessiné en couches MapLibre (`CoucheReseau`, puis `CoucheVoies` au zoom des voies),
pas en SVG : quelques milliers de voies dans la vue restent fluides au déplacement de la carte.
Des zones de prise invisibles, plus larges que les nœuds, les poignées et les liaisons,
reçoivent le pointeur. Seul le carrefour ouvert garde son calque SVG (`CalqueCarrefour`), qui
ne dessine que quelques dizaines d'éléments.

| Outil | Geste |
|---|---|
| ↖ **Sélection** (<kbd>V</kbd>) | Glisser un nœud le déplace. Un clic sur une voie ouvre la popup du tronçon (nom, voies par sens et leur type, vitesse, « Couper ici », « Inverser », « Supprimer ») ; sur un nœud, la sienne (ligne d'arrêt à feux, passage piéton, carrefour, liaisons proposées, « Retirer le nœud »). |
| ＋ **Tracer** (<kbd>T</kbd>) | Cliquer le départ (un nœud, une rue, qui sera coupée à cet endroit, ou un point libre), les points de la rue, puis l'arrivée ; <kbd>Entrée</kbd> finit sur un point libre, <kbd>⌫</kbd> retire le dernier point, <kbd>Échap</kbd> annule. |
| ✂ **Couper** (<kbd>X</kbd>) | Un clic sur une voie pose un nœud : ligne d'arrêt, passage piéton, début d'une voie de présélection (le tronçon d'approche a alors ses propres voies). |
| ↝ **Liaison** (<kbd>C</kbd>) | Du bout d'une voie qui arrive (poignée bleue) vers le début d'une voie qui repart (poignée creuse), à un nœud hors des carrefours ; pointillés : proposées ; refaire le geste ou cliquer une liaison la retire. |
| ✥ **Placer** (<kbd>B</kbd>) | Glisser le bout d'une voie (poignée ronde, à chaque nœud ; dans un carrefour ouvert, à ses nœuds) le pose là où il est sur la photo : ligne d'arrêt, bord de la piste. Un clic le choisit (recul et décalage au centimètre, rotation, « Auto ») ; <kbd>Maj</kbd> + clic en choisit plusieurs, qui se glissent ensemble ; la poignée de pivot (anneau cyan, au bout du bloc) fait tourner le bloc ; un double-clic remet à la place automatique. Le graphe et SUMO ne bougent pas. |
| ◎ **Nœuds** (<kbd>N</kbd>, carrefour ouvert) | Un clic sur un nœud l'ajoute au carrefour ou l'en retire. |

**Carrefour ouvert** : Sélection, Tracer, Couper et Nœuds agissent sur le réseau ; ↝ **Liaison**
(<kbd>C</kbd>) relie ses voies comme dans un carrefour dessiné à la main : glisser d'une voie
entrante (poignée de couleur) vers une voie sortante (poignée blanche), cliquer une liaison la
retire, puis **Enregistrer** ; ● **Feu** (<kbd>F</kbd>) pose les feux sur leur mât. La carte
d'en-tête porte le badge « Sur le réseau » et dit si les liaisons sont proposées ou saisies
(« Reprendre les proposées »). Le calque du carrefour dessine ses branches (bouts des rues qui y
arrivent, relus à chaque modification du réseau), leurs flèches et ses liaisons. Les onglets
Lignes de feux, Programme et Graphe s'en servent comme avant. OSM, IA et JSON ne servent qu'aux
carrefours sans nœud.

Carte d'en-tête de l'éditeur (aucun carrefour ouvert) : aide de l'outil, légende, **⟳ Semer
depuis OSM** (réseau vide) ou **Réinitialiser depuis OSM**, et liens d'**export SUMO** de la
vue ou de toute la ville.
