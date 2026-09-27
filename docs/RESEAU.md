# Réseau routier

> Toutes les rues de la ville, pas seulement les carrefours à feux : des **tronçons** relient
> des **nœuds**, chacun avec ses voies par sens. Rues et carrefours s'éditent ensemble, voie par
> voie, et toutes les voies se relient avec le même geste, comme le « lane connector » de
> TM:PE : à chaque intersection, au bord de chaque carrefour et dans le carrefour. Le réseau
> s'exporte au format SUMO pour la simulation (phase 2).
> Complète [ARCHITECTURE.md](ARCHITECTURE.md) ; la configuration d'un carrefour (branches,
> voies, connexions) est dans [CONFIGURATION.md](CONFIGURATION.md).

## Sommaire

1. [Vue d'ensemble](#1-vue-densemble)
2. [Modèle](#2-modèle)
3. [Génération depuis OSM](#3-génération-depuis-osm)
4. [Raccordement aux carrefours](#4-raccordement-aux-carrefours)
5. [Export SUMO](#5-export-sumo)
6. [API](#6-api)
7. [Interface](#7-interface)

---

## 1. Vue d'ensemble

```text
 osm_way (pnpm osm:import)
    │  découpe aux nœuds partagés
    ▼
 nœuds ──── tronçons ────  nœuds          ← corrigés à la main (voies, sens, nom, vitesse),
    │                        │               complétés par des tronçons tracés sur la carte
    │   carrefour configuré  │
    ▼                        ▼
  ╭─────── cercle ───────╮   les tronçons s'arrêtent sur le cercle du carrefour ;
  │  branches et voies   │   chaque bout se raccorde à une branche, voie à voie
  ╰──────────────────────╯
    │
    ▼
 reseau.nod.xml / .edg.xml / .con.xml  ──netconvert──▶  reseau.net.xml (SUMO, sumolib, TraCI)
```

Même règle que pour les carrefours : OSM propose, on corrige. Une correction à la main n'est
jamais écrasée par une nouvelle génération.

## 2. Modèle

```sql
CREATE TYPE source_reseau AS ENUM ('osm', 'manuel');

CREATE TABLE noeud (
  id            uuid PRIMARY KEY,
  osm_node_id   bigint UNIQUE,                    -- intersection ou bout de voie OSM
  carrefour_id  uuid UNIQUE REFERENCES carrefour ON DELETE SET NULL,  -- le carrefour qu'il représente
  geom          geometry(Point, 4326) NOT NULL,
  liaisons      jsonb        -- liaisons voie à voie saisies [{de, voie_de, vers, voie_vers}] ; null : proposées
);

CREATE TABLE troncon (
  id             uuid PRIMARY KEY,
  noeud_de       uuid NOT NULL REFERENCES noeud ON DELETE CASCADE,
  noeud_vers     uuid NOT NULL REFERENCES noeud ON DELETE CASCADE,
  geom           geometry(LineString, 4326) NOT NULL,   -- de noeud_de vers noeud_vers
  osm_way_id     bigint, osm_de bigint, osm_vers bigint, -- voie et nœuds OSM d'origine
  nom text, highway text,
  voies_avant    smallint NOT NULL,   -- dans le sens de tracé (0 : sens interdit)
  voies_arriere  smallint NOT NULL,   -- dans l'autre sens
  vitesse_kmh    smallint,            -- null : vitesse par défaut du type de voie
  source         source_reseau NOT NULL,
  modifie        boolean NOT NULL DEFAULT false,  -- tronçon OSM corrigé : gardé à la régénération
  supprime       boolean NOT NULL DEFAULT false,  -- tronçon OSM supprimé : masqué, jamais recréé
  branche_de     text, branche_vers text,         -- branche du carrefour à chaque bout
  liens_de       jsonb, liens_vers jsonb,         -- liens voie à voie (null : par défaut)
  CHECK (voies_avant + voies_arriere > 0), CHECK (noeud_de <> noeud_vers)
);
```

| Notion | Convention |
|---|---|
| Sens d'un tronçon | `avant` : de `noeud_de` vers `noeud_vers`, dans le sens de la géométrie. « Inverser » retourne la géométrie et échange tout (nœuds, voies, branches, liens). |
| Rang d'une voie de tronçon | Comme pour les branches : 0 = la plus à gauche dans son sens de circulation. |
| Liens d'un bout raccordé | `entree` : `[voie du tronçon qui arrive, voie entrante de la branche]` ; `sortie` : `[voie sortante de la branche, voie du tronçon qui repart]`. |
| Liens par défaut | `liensParDefaut(n, m)` : chaque voie source mène à sa part des voies cibles, et chaque cible est servie. 1 → 3 : la voie mène aux trois (élargissement) ; 3 → 1 : les trois se rejoignent. |
| Voies d'une rue | `voiesTroncon` : tout du long de l'axe, `avant` à droite de l'axe et `arriere` à gauche (rang 0 contre l'axe), un sens unique centré. Reculées aux intersections (`retraitAuNoeud` : 3 m entre deux tronçons, 4 m + 0,6 voie par voie au-delà) pour laisser la place aux liaisons, pas au bord d'un carrefour. |
| Liaisons d'un nœud | D'une voie qui arrive (`de`, `voie_de`) vers une voie qui repart (`vers`, `voie_vers`), rangs dans chaque sens. Proposées par `liaisonsParDefaut` comme les connexions d'un carrefour : tout droit voie à voie, tourne-à-gauche de gauche à gauche, tourne-à-droite de droite à droite, pas de demi-tour ; deux tronçons seuls se prolongent voie à voie. Des liaisons saisies devenues impossibles (voie retirée, tronçon supprimé) sont ignorées. |

## 3. Génération depuis OSM

```bash
pnpm reseau:generer        # client de l'API (pnpm dev doit tourner) : POST /api/reseau/generer
```

1. Voies de `osm_way` circulables (comme la détection des branches : `motorway` →
   `living_street`, `busway`, `road`, leurs `_link` ; sans `service`, sans `area=yes`, sans
   `access=no` ni `motor_vehicle=no`).
2. **Découpe** (`decouperVoies`, `apps/api/src/reseau/osm.ts`) : un nœud OSM partagé par deux
   voies (ou deux fois par la même) coupe la voie. Une boucle qui revient sur son nœud de départ
   est coupée à mi-parcours (SUMO refuse une arête d'un nœud vers lui-même).
3. **Voies par sens** : `lanes:forward` / `lanes:backward`, sinon `lanes` (moitié par sens pour
   une rue à double sens, tout pour un sens unique), `oneway` (`-1` : sens inverse), giratoires
   en sens unique. Vitesse : `maxspeed` (km/h ou mph), sinon celle du type de voie à l'export.
4. **Ce qui est gardé** : les tronçons tracés à la main, et les tronçons OSM corrigés ou
   supprimés, reconnus par `(osm_way_id, osm_de, osm_vers)` même après une coupe. Leurs moitiés
   sont marquées ensemble. Tout le reste est recréé.
5. Chaque carrefour configuré est ensuite **raccordé** (§4).

Import du 27/09/2026 (6 219 voies circulables) : **8 608 tronçons** et 7 026 nœuds en une seconde.

## 4. Raccordement aux carrefours

Un carrefour dont les branches ont des voies devient un nœud du réseau (`noeud.carrefour_id`),
placé en son centre (`raccorderCarrefour`, `apps/api/src/reseau/raccordement.ts`) :

1. **Cercle** : rayon = distance du centre au bout de la voie la plus longue, plus 5 m.
2. Chaque tronçon qui entre dans le cercle y est **coupé** (`horsDuCercle`, `@voirie/engine`) :
   le bout intérieur passe sur le nœud du carrefour. Un tronçon qui traverse le carrefour est coupé
   en deux ; un tronçon entièrement dedans disparaît, comme les intersections OSM de l'intérieur.
3. Chaque bout raccordé prend la **branche** de même direction (azimut du centre vers le bout, à
   40° près). Une branche choisie à la main est gardée tant qu'elle existe ; des liens devenus
   impossibles (voie retirée) reviennent aux liens par défaut.

Le raccordement est relancé à chaque enregistrement des branches (le cercle dépend des voies), à
chaque génération, et quand on trace ou modifie un tronçon qui touche le carrefour. Il est
idempotent : un bout déjà raccordé est recoupé au même endroit.

Enregistrer une branche ou des liens à la main marque le tronçon comme corrigé : la régénération
le garde, avec ses liens. De même, saisir les liaisons d'un nœud marque corrigés les tronçons qui
le touchent : leurs identifiants, auxquels les liaisons renvoient, ne changent plus.

## 5. Export SUMO

```bash
pnpm reseau:sumo [--bbox=ouest,sud,est,nord]   # écrit data/sumo/reseau.{nod,edg,con}.xml et reseau.netccfg
cd data/sumo && netconvert -c reseau.netccfg     # → reseau.net.xml
```

Format « plain XML » de SUMO (`exporterSumo`, `packages/engine/src/sumo.ts`), en longitude,
latitude : netconvert les projette en UTM (`proj.plain-geo`, `proj.utm` dans `reseau.netccfg`),
et `sumolib` sait revenir en lon/lat (`net.convertXY2LonLat`).

| Élément | Identifiant SUMO |
|---|---|
| Nœud du réseau | uuid du nœud, `type="priority"` |
| Carrefour configuré | `c<carrefour>`, `type="traffic_light"` (programme par défaut de netconvert, en attendant `versTlLogic`) |
| Bout de tronçon raccordé | `r<tronçon>_<de\|vers>`, sur le cercle |
| Tronçon, sens avant / arrière | `t<tronçon>` / `-t<tronçon>` |
| Approche d'une branche | `a<carrefour>_<branche>_e_…` (vers le centre, voies entrantes), `…_s_…` (voies sortantes) |
| Branche sans tronçon | nœud `b<carrefour>_<branche>` en cul-de-sac (alerte) |

- Les **connexions du carrefour** (`S:e0 → O:s1`) deviennent des `<connection>` entre arêtes
  d'approche ; les **liens de raccordement**, des `<connection>` entre le tronçon et l'approche ;
  les **liaisons de chaque nœud** (saisies, ou à défaut proposées), des `<connection>` entre
  tronçons. Ce qu'on voit dans l'éditeur est donc ce que SUMO simule.
  SUMO numérote les voies de la droite vers la gauche : index = nombre de voies − 1 − rang.
- Voies bus, vélo, tram d'une branche : `<lane allow="bus|bicycle|tram"/>`.
- Priorité des arêtes d'après `highway` (les approches d'un carrefour passent en premier).
- Les **alertes** (branche sans tronçon, deux tronçons sur la même branche, tronçon non
  raccordé) sont écrites en commentaire en tête de `reseau.nod.xml`.

## 6. API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/reseau?bbox=` | Tronçons (6 000 au plus, `tronque` au-delà), nœuds avec leurs liaisons, et carrefours configurés de l'emprise (branches, connexions, raccordements) |
| PUT | `/api/reseau/noeuds/:id/liaisons` | `{ liaisons: [...] \| null }` : liaisons d'un nœud ordinaire (null : proposées) ; 400 pour une voie qui n'arrive pas au nœud ou un nœud de carrefour (`EditionGuard`) |
| POST | `/api/reseau/generer` | (Re)génère depuis OSM, garde les corrections (`EditionGuard`) |
| POST | `/api/reseau/troncons` | `{ points, de, vers, nom, voies_avant, voies_arriere, vitesse_kmh }` ; chaque bout s'accroche à un nœud (`{type:'noeud', id}`), coupe un tronçon (`{type:'troncon', id}`, au point le plus proche, ou sur son bout à moins de 1,5 m) ou crée un nœud (`{type:'libre'}`) (`EditionGuard`) |
| PATCH | `/api/reseau/troncons/:id` | Nom, voies par sens, vitesse, `inverser` (`EditionGuard`) |
| DELETE | `/api/reseau/troncons/:id` | Supprime (tracé à la main) ou masque (OSM) (`EditionGuard`) |
| GET | `/api/reseau/sumo/:fichier[?bbox=]` | `reseau.nod.xml`, `reseau.edg.xml`, `reseau.con.xml`, `reseau.netccfg` |
| GET | `/api/carrefours/:id/raccordements` | Rayon, bouts raccordés (branche, voies, liens), alertes |
| PUT | `/api/carrefours/:id/raccordements` | Branche et liens de chaque bout (`liens: null` : par défaut) (`EditionGuard`) |
| POST | `/api/carrefours/:id/raccordements/recalculer` | Recoupe au cercle du carrefour (`EditionGuard`) |

## 7. Interface

Un seul éditeur pour les rues et les carrefours : **≡ Voies** sur la carte (touche <kbd>R</kbd>),
ou un clic sur un carrefour. À partir du zoom 16, les rues sont dessinées voie par voie, à leur
largeur, comme les voies des carrefours (en gris pour OSM, orange corrigées, vert tracées à la
main) ; plus loin, une ligne par tronçon. Les carrefours configurés de la vue sont dessinés avec
leurs voies et leurs connexions ; un clic en ouvre un, sans quitter l'éditeur et **en gardant
l'outil en cours**. <kbd>Échap</kbd> referme le carrefour (ses modifications restent dans les
brouillons), puis quitte l'éditeur.

- **↖ Sélection** (<kbd>V</kbd>) : un clic sur une rue ouvre sa popup. Nom, voies dans le sens du
  tracé et dans l'autre (0 : sens interdit), vitesse (vide : celle du type de voie),
  « Inverser », « Supprimer ». Chaque changement est enregistré aussitôt.
- **＋ Tracer** (<kbd>T</kbd>) : cliquer le départ (un nœud, une rue, qui sera coupée à cet
  endroit, ou un point libre), les points de la rue, puis l'arrivée sur un nœud ou une rue.
  <kbd>Entrée</kbd> (ou un second clic sur le dernier point) finit sur un point libre ;
  <kbd>⌫</kbd> retire le dernier point, <kbd>Échap</kbd> annule. La rue a une voie par sens, à
  régler ensuite. Tracée jusqu'au centre d'un carrefour, elle s'arrête à son bord et se relie à la
  branche de même direction. Carrefour ouvert, le même outil trace aussi ses voies : glisser de la
  ligne d'arrêt vers l'amont donne une voie du carrefour, cliquer pose un point de rue.
- **↝ Liaison** (<kbd>C</kbd>) : partout le même geste, du bout d'une voie qui arrive (poignée
  bleue) vers le début d'une voie qui repart (poignée creuse). Les liaisons proposées sont en
  pointillé, celles saisies en trait plein ; refaire le geste ou cliquer une liaison la retire.
  - À une intersection : entre les voies des rues, enregistré aussitôt.
  - Au bord d'un carrefour (ouvert) : d'une voie de rue vers le bout d'une voie entrante, ou du
    bout d'une voie sortante (poignée grise) vers une voie de rue. Viser une autre branche que
    celle de la rue l'y relie, avec les liens proposés. Enregistré avec le carrefour.
  - Dans le carrefour : les connexions entre ses voies, comme avant.
- Carte d'en-tête (aucun carrefour ouvert) : aide de l'outil, légende, **⟳ Générer depuis OSM**
  (garde les corrections) et liens d'**export SUMO** de la vue ou de toute la ville. Carrefour
  ouvert, le badge « rue non reliée » signale une rue qu'aucune branche ne prolonge.
