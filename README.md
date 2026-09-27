# Besançon Voirie — inventaire des feux, ondes vertes et simulation

> Projet personnel, open source, mené **en solo**.
>
> 1. **Phase 1**: recenser l'**état actuel de tous les feux** de Besançon : quel carrefour,
>    quels feux, quelle programmation.
> 2. **Phase 1 bis**: **relier les carrefours** entre eux et tester des **ondes vertes**
>    (décalages, bande passante, diagramme espace-temps).
> 3. **Phase 2**: rejouer l'existant et les variantes dans **SUMO** pour mesurer l'effet réel
>    (temps de parcours, arrêts, files, rues transversales, piétons).
>
> Le tout publié sur une carte interactive à laquelle n'importe qui peut contribuer.
>
> **Hors périmètre, volontairement** : toute démarche administrative ou juridique.
> Le projet produit de l'**information publique**, pas une étude réglementaire.

## Démarrage

Prérequis : Node 24, pnpm 11, Docker.

```bash
cp .env.example .env
pnpm install
pnpm db:up          # PostgreSQL 17 + PostGIS 3.5 + pgRouting 4.0 (port 5433)
pnpm db:prepare     # bases voirie + voirie_test, extensions, migrations
pnpm osm:import     # feux, voies et tram depuis OpenStreetMap (Overpass, mis en cache)
pnpm dev            # packages en watch + API :3000 + web :5173
```

| Commande | Effet |
|---|---|
| `pnpm test` | Tests unitaires (schema, engine, api) |
| `pnpm test:e2e` | Tests de l'API contre la base `voirie_test` (nécessite `pnpm db:up`) |
| `pnpm typecheck` / `pnpm lint` | Vérifications TypeScript et oxlint |
| `pnpm db:psql` | Console SQL sur la base de développement |
| `pnpm db:migrate` | Applique les nouvelles migrations Drizzle |
| `pnpm db:verifier [base]` | Compare le journal des migrations à une base (par défaut celle du `.env`) : à lancer avant tout merge, voir `CLAUDE.md` |
| `pnpm db:reset` | Recrée le conteneur de zéro (supprime le volume et toutes les bases) |

### Avec le Nevven Worktree Manager

Le projet est déclaré dans le manager sous l'id `besancon-voirie` : un seul target `app`
pour tout le monorepo. Au démarrage d'un worktree, le manager lance
`pnpm install`, `pnpm db:up`, `pnpm db:prepare` puis `pnpm dev`.

- **Ports** : web sur `5400 + slot`, API sur `3400 + slot` (le port du web moins 2000).
- **Un conteneur PostgreSQL partagé** par tous les checkouts (nom de projet Compose fixe),
  mais **des bases séparées par worktree** : `voirie_wt_<worktree>` et
  `voirie_wt_<worktree>_test`. `db:prepare` les crée et écrit leurs URL dans le `.env`
  du worktree. Les commandes lancées à la main dans le worktree (`pnpm test:e2e`,
  `pnpm db:migrate`) visent donc aussi ces bases. `pnpm db:psql` ouvre toujours la base
  `voirie` : taper `\c voirie_wt_<worktree>` pour changer de base.
- `node_modules` n'est pas partagé avec le dépôt principal : chaque worktree a le sien, rapide
  à installer grâce au store pnpm. Sinon, les liens vers les packages internes pointeraient
  vers le dépôt principal.
- Bases d'un worktree supprimé : `pnpm db:psql` puis `DROP DATABASE voirie_wt_<worktree>;`.

Organisation : `apps/web` (React + MapLibre), `apps/api` (NestJS + Drizzle),
`packages/schema` (zod), `packages/engine` (calcul des feux). Détails dans
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Sommaire

1. [TL;DR](#1-tldr)
2. [Vocabulaire des feux](#2-vocabulaire-des-feux)
3. [Phase 1 — Inventaire des feux](#3-phase-1--inventaire-des-feux)
4. [Phase 1 bis — Liaisons et onde verte](#4-phase-1-bis--liaisons-et-onde-verte)
5. [Phase 2 — Simulation SUMO](#5-phase-2--simulation-sumo)
6. [Architecture](#6-architecture)
7. [Ce qui existe déjà](#7-ce-qui-existe-déjà)
8. [DiagFeux (Cerema) — analyse](#8-diagfeux-cerema--analyse)
9. [Sources de données](#9-sources-de-données)
10. [Coûts](#10-coûts)
11. [Garde-fous légaux (le strict minimum)](#11-garde-fous-légaux-le-strict-minimum)
12. [Faire circuler les résultats](#12-faire-circuler-les-résultats)
13. [Feuille de route](#13-feuille-de-route)
14. [Sources](#14-sources)

---

## 1. TL;DR

- **Point de départ gratuit** : OpenStreetMap recense déjà ~**390 feux** (`highway=traffic_signals`)
  dans la zone de Besançon (~130 à 180 carrefours à feux selon le regroupement), plus ~500
  passages piétons à feux et ~65 traversées de tram (requête du 26/09/2026, voir §3.1).
  → la carte peut être pré-remplie : il « suffit » de relever la programmation de chacun.
- **Relevé sans matériel** : une page web mobile « chrono de feux ». On tape un bouton quand
  chaque feu passe au vert ou au rouge ; elle calcule le cycle, les durées et l'**horodatage absolu**
  qui permet ensuite de calculer les décalages entre carrefours.
- **Onde verte en analytique** (phase 1 bis) : diagramme espace-temps, bande passante par sens,
  optimisation des décalages. Tout tourne dans le navigateur, sans SUMO.
- **SUMO** (phase 2) : rejouer les plans relevés (`tlLogic` + changements horaires WAUT)
  pour mesurer ce que l'analytique ignore : files, rues transversales pénalisées, piétons, bus.
- **Stack** : React + MapLibre, NestJS, PostgreSQL + PostGIS + pgRouting, moteur de calcul
  TypeScript partagé front/back. Contributions anonymes modérées, VPS à ~5–10 €/mois
  (voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)).
- **Limite n°1** : beaucoup de carrefours bisontins ne sont **pas à cycle fixe** (priorité tram,
  bouton piéton, détection). Le relevé doit le signaler, sinon les ondes vertes calculées sont fausses.

---

## 2. Vocabulaire des feux

| Terme | Sens | Dans le modèle de données |
|---|---|---|
| **Carrefour à feux** | Intersection gérée par un même contrôleur | `carrefours/<id>/` |
| **Ligne de feux** (signal group) | Ensemble de feux qui changent toujours ensemble (ex. les 2 feux de la branche Nord) | `lignes_de_feux[]` |
| Type de feu | R11v (véhicules), R12 (piétons), R13c (vélos), R17/R18 (transports en commun) — voir IISR 6ᵉ partie | `lignes_de_feux[].signal` |
| **Cycle** | Durée d'une séquence complète, qui se répète (souvent 60–120 s) | `plans[].cycle_s` |
| **Phase** | Période pendant laquelle un ensemble de lignes compatibles est au vert | déduit |
| **Plan de feux** | Durées de vert/jaune/rouge de chaque ligne sur un cycle | `plans[].lignes` |
| **Programmation horaire** | Quel plan s'applique à quelle heure (pointe, creuse, nuit en jaune clignotant…) | `plans[].plages` |
| **Rouge de dégagement** | Temps « tout rouge » entre deux phases antagonistes | déduit des intervalles |
| **Décalage** (offset) | Instant de début du cycle d'un carrefour par rapport à une référence commune | `plans[].reference_t0` |
| **Onde verte** | Décalages choisis pour qu'un véhicule à vitesse constante trouve tous les feux au vert | `corridors/` |
| **Bande passante** | Largeur (en s) de la « bande verte » traversant tous les carrefours d'un axe | calculée |

---

## 3. Phase 1 — Inventaire des feux

### 3.1 Feux importés d'OpenStreetMap, carrefours composés à la main

Requête Overpass (zone ≈ Besançon, bbox) :

```text
[out:json][timeout:60][bbox:47.195,5.935,47.295,6.085];
( node["highway"="traffic_signals"];
  node["crossing"="traffic_signals"];
  node["railway"="tram_crossing"]; );
out body;
```

Résultat au 26/09/2026 (bbox, donc déborde un peu sur les communes voisines) :

| Élément OSM | Nombre |
|---|---|
| `highway=traffic_signals` (feux de carrefour) | 387 |
| … dont avec `traffic_signals:direction` | 178 |
| … dont `button_operated` renseigné | 11 |
| `highway=crossing` + `crossing=traffic_signals` (passages piétons à feux) | ~500 |
| `railway=tram_crossing` (traversées de tram) | ~65 |
| Carrefours obtenus en regroupant les feux à < 30 m / < 50 m / < 80 m | 180 / 136 / 125 |

**Aucun regroupement automatique.** Une distance ne dit pas quels feux partagent un même
contrôleur, donc une même programmation. Deux carrefours proches peuvent être pilotés
ensemble, et deux feux à 30 m l'un de l'autre peuvent être indépendants. Donc :

1. `pnpm osm:import` charge chaque feu OSM de la commune dans la table `feu` (type véhicule ou
   piéton, position, balises), sans créer aucun carrefour.
2. Sur la carte, en mode « Composer un carrefour », on clique les feux qui partagent la
   **même programmation**. Un nom est proposé d'après les rues proches et reste modifiable.
   La nature (carrefour ou traversée piétonne) se choisit au même moment.
3. Un carrefour se modifie ensuite (ajout ou retrait de feux, nom, nature) ou se supprime,
   ce qui libère ses feux. La suppression est refusée s'il a des relevés ou des plans de feux.
4. Un réimport ne touche jamais aux regroupements. Les feux déplacés sont mis à jour, les
   nouveaux apparaissent libres (en orange), et ceux qui ont disparu d'OSM sont marqués
   (contour rouge) sans être supprimés.
5. Proximité du tram : le carrefour est signalé si une voie de tram passe à moins de 25 m
   (priorité tram probable, donc cycle non fixe).

### 3.2 Modèle de données d'un carrefour

**Choix clé** : stocker la programmation **par ligne de feux** (intervalles de vert dans le cycle),
comme un diagramme de feux papier. C'est ce qu'on observe sur le terrain, et c'est convertible
mécaniquement en phases SUMO (phase 2).

Représentation logique ci-dessous en YAML, pour la lisibilité. En base, ce sont les tables
`carrefour`, `branche`, `ligne_feux`, `plan_feux` et `releve` (voir [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#4-base-de-données)).

```yaml
# carrefour (exemple fictif : valeurs inventées)
id: vesoul-blum
nom: "Rue de Vesoul × Boulevard Léon Blum"
position: { lat: 47.2551, lon: 6.0252 }
feux: [feu-1, feu-2, feu-3]                # feux rattachés à la main (table feu)
statut: mesure                              # non_releve | estime | mesure | verifie (≥ 2 relevés concordants)

controleur:
  mode: fixe                                # fixe | semi_actue | actue | inconnu
  priorite_tc: aucune                       # aucune | tram | bus | inconnue
  appel_pieton: false                       # bouton piéton présent ?
  feu_recompense: false                     # passe au vert si on arrive lentement ?
  remarques: ""

branches:
  - { id: N, nom: "Rue de Vesoul (nord)", osm_way: 444 }
  - { id: S, nom: "Rue de Vesoul (sud)",  osm_way: 555 }
  - { id: E, nom: "Bd Léon Blum (est)",   osm_way: 666 }
  - { id: O, nom: "Bd Léon Blum (ouest)", osm_way: 777 }

lignes_de_feux:
  - { id: F1, signal: R11v, branche: N, mouvements: [tout_droit, droite], voies: 1 }
  - { id: F2, signal: R11v, branche: S, mouvements: [tout_droit, droite, gauche], voies: 1 }
  - { id: F3, signal: R11v, branche: E, mouvements: [tout_droit, droite, gauche], voies: 2 }
  - { id: F4, signal: R11v, branche: O, mouvements: [tout_droit, droite, gauche], voies: 2 }
  - { id: P1, signal: R12,  traverse: E }
  - { id: P2, signal: R12,  traverse: O }

plans:
  - id: jour
    plages:
      - { jours: [lun, mar, mer, jeu, ven], de: "06:30", a: "20:30" }
    cycle_s: 80
    jaune_s: 3
    # Instant absolu (horloge téléphone synchronisée) d'un début de vert de la ligne de référence.
    # Avec cycle_s, il permet de calculer le décalage par rapport à n'importe quel autre carrefour.
    reference: { ligne: F1, t0: "2026-10-07T08:02:17.400+02:00" }
    lignes:                                 # [début, fin] du VERT, en s depuis le début du cycle
      F1: [[0, 34]]
      F2: [[0, 34]]
      F3: [[40, 74]]
      F4: [[40, 74]]
      P1: [[0, 20]]
      P2: [[0, 20]]
  - id: nuit
    plages:
      - { jours: tous, de: "22:00", a: "06:00" }
    mode: jaune_clignotant

releves:
  - fichier: releves/2026-10-07T0802_pseudo.json   # données brutes de l'appli chrono
    auteur: "github:pseudo"
    cycles_observes: 6
    ecart_type_cycle_s: 0.3                  # ≈ 0 → cycle fixe ; élevé → actué / priorité TC
```

Déductions automatiques, sans comptage :
- **Rouges de dégagement** et **phases** (intervalles où l'ensemble des verts ne change pas).
- **Capacité théorique par ligne** (méthode CERTU/DiagFeux) :
  `1 800 UVP/h × voies × (vert utile / cycle)`.
- **Cohérence** : alerte si deux lignes antagonistes sont vertes en même temps (erreur de saisie),
  ou si le vert piéton est plus court que `longueur de traversée / 1 m/s`.

### 3.3 Relevé terrain : l'appli « chrono de feux »

Une page web mobile, sans serveur :

1. Choisir le carrefour sur la carte (pré-rempli depuis OSM).
2. Déclarer les lignes de feux visibles (boutons F1, F2, P1…).
3. À chaque changement, taper **« vert »** ou **« rouge »** sur la ligne concernée. L'appli
   enregistre `Date.now()`, l'heure du téléphone, synchronisée par le réseau à ~0,1 s près.
4. Après 4 à 6 cycles, elle calcule le cycle (médiane et écart-type), les intervalles de vert
   et l'instant de référence `t0`.
5. Envoi à l'API : le relevé est enregistré **en attente de modération**. Il est stocké
   hors-ligne sur le téléphone tant que le réseau manque.

Le relevé se fait **à l'œil depuis le trottoir, sans rien filmer ni poser** : aucune autorisation n'est nécessaire.

Protocole conseillé :
- Relever chaque plan horaire séparément : pointe du matin (7h30–9h), heures creuses (10h–16h),
  pointe du soir (16h30–18h30), et la nuit si possible.
- Si l'écart-type du cycle dépasse ~2 s, ou si un vert change d'une fois sur l'autre, marquer
  `mode: actue` et décrire ce qui déclenche (bouton, tram, détection).
- Un carrefour passe en `verifie` après 2 relevés concordants faits par 2 personnes ou à 2 dates.

### 3.4 Carte publique (phase 1)

- Couleurs par statut : gris `non_releve`, orange `estime`, bleu `mesure`, vert `verifie`,
  violet actué/tram.
- Fiche du carrefour : **diagramme de feux** (barres vert/jaune/rouge par ligne sur un cycle),
  plans horaires, capacité par ligne, historique des relevés.
- Filtres : priorité tram, cycles identiques, carrefours non relevés proches de moi.

---

## 4. Phase 1 bis — Liaisons et onde verte

### 4.1 Modèle d'un corridor

```yaml
# corridor (exemple fictif) : tables corridor + corridor_carrefour
id: bd-blum
nom: "Boulevard Léon Blum, d'ouest en est"
vitesse_progression_kmh: 30             # vitesse de l'onde (30 = onde verte « apaisée »)
plan: jour                              # plan horaire des carrefours à coordonner
carrefours:                             # dans l'ordre du sens « aller »
  - { id: carrefour-a, aller: F3, retour: F4 }
  - { id: vesoul-blum, aller: F4, retour: F3 }
  - { id: carrefour-c, aller: F1, retour: F2 }
# les distances entre lignes d'arrêt sont calculées depuis OSM (surchargeables à la main)
```

### 4.2 Calculs

1. **Décalages actuels** : pour deux carrefours de même cycle `C`,
   `décalage(B/A) = (t0_B − t0_A) mod C`. Ça marche même si A et B ont été relevés à des heures
   différentes, tant que les contrôleurs sont synchronisés (cycle fixe, horloge commune).
   Si `C_A ≠ C_B`, il n'y a pas de coordination possible (sauf cycles doubles ou moitiés) : c'est déjà un constat en soi.
2. **Diagramme espace-temps** (distance en ordonnée, temps en abscisse), comme sur les
   diagrammes de Marey : les verts de chaque carrefour sont des segments horizontaux répétés
   tous les `C`, les trajectoires à vitesse `v` sont des droites de pente `v`.
3. **Bande passante** d'un sens : ensemble des instants de départ au premier feu tels que
   la trajectoire à vitesse `v` tombe dans le vert à *chaque* carrefour aval. On l'obtient par
   intersection d'intervalles décalés du temps de parcours `d/v`, modulo `C`.
   **Efficacité** = bande passante / C, par sens.
4. **Optimisation des décalages** : maximiser `bande_aller + k × bande_retour`
   (`k` = importance relative du retour).
   - Jusqu'à ~5 carrefours : recherche exhaustive avec un pas de 1 s sur les décalages (quasi instantanée dans le navigateur).
   - Au-delà : descente coordonnée, ou formulation **MAXBAND** (Little, 1966-1981) en
     programmation linéaire en nombres entiers, avec un solveur libre (HiGHS, glpk.js).
   - Variantes à tester : cycle commun différent, vitesse de progression 30 ou 50 km/h,
     inversion de l'ordre des phases (gauche en premier ou en dernier).
5. **Garde-fous** : ne jamais réduire un vert piéton sous son minimum. Signaler les carrefours
   à priorité tram, car la coordination y est cassée à chaque passage.

Toute la phase 1 bis est **analytique et tourne dans le navigateur** : curseurs de décalage et
de vitesse, avec le diagramme espace-temps qui se met à jour en direct.

---

## 5. Phase 2 — Simulation SUMO

Ce que l'analytique ne dit pas, et que SUMO mesure :
- les **files d'attente** qui débordent (l'onde verte arrive sur une file arrêtée) ;
- l'effet sur les **rues transversales**, pénalisées par une onde verte longue ;
- l'attente des piétons et des vélos, et les bus Ginko ;
- le nombre d'**arrêts** par véhicule, les émissions et le temps de parcours réel.

### Méthode

1. **Réseau** : import OSM du corridor ou du quartier (`osmGet.py`, `netconvert`, ou
   `osmWebWizard.py` pour les essais), puis corrections dans `netedit` (voies, mouvements).
2. **Feux relevés → SUMO** :
   - associer chaque ligne de feux à ses *connexions* SUMO (branche + mouvement donnent les indices de lien du `tlLogic`),
     semi-automatiquement puis contrôle visuel dans `netedit`. C'est l'étape la plus délicate ;
   - convertir les intervalles par ligne en phases SUMO : chaque instant de changement ouvre
     une nouvelle phase, avec une chaîne d'état `G`/`y`/`r` par lien ;
   - le décalage devient l'attribut `offset` du `tlLogic` ;
   - les plans horaires deviennent plusieurs `programID`, basculés par un **WAUT** (changement horaire).
   - Carrefours actués : `type="actuated"` avec détecteurs. Priorité tram : modéliser le tram
     (GTFS Ginko) et une logique de préemption simplifiée.
3. **Demande** : sans comptage exhaustif, commencer par une demande plausible (`randomTrips.py`
   pondéré par la hiérarchie des voies), puis caler sur les comptages disponibles
   (manuels, Telraam, Cerema) avec `routeSampler.py`.
4. **Scénarios** : `actuel` / `décalages optimisés (phase 1 bis)` / `SUMO tlsCoordinator.py`
   / `cycle commun modifié` / `vitesse de progression 30 vs 50`.
5. **Validation** : comparer le temps de parcours simulé du corridor au temps réel. Parcourir
   l'axe à vélo ou en voiture avec une trace GPS, plusieurs fois aux mêmes heures.
6. **Répétitions** : 10 graines aléatoires par scénario, publier la moyenne et la dispersion.

### Indicateurs publiés

| Indicateur | Outil SUMO |
|---|---|
| Temps de parcours du corridor, par sens | `tripinfo` / `edgeData` |
| Nombre d'arrêts par véhicule sur l'axe | `tripinfo` (`waitingCount`) |
| Retard sur les rues transversales | `tripinfo` filtré par route |
| Files max et 95ᵉ centile par branche | détecteurs E2 |
| Attente piétons et vélos | `personinfo` |
| Conflits (TTC < 1,5 s) | device `ssm` |
| CO₂ / NOx | modèle HBEFA |

---

## 6. Architecture

Le détail est dans **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**. En résumé :

| Couche | Choix |
|---|---|
| Front | React + Vite + TypeScript + **MapLibre GL** (`react-map-gl/maplibre`) |
| Calcul métier partagé | `packages/engine` en TypeScript pur : phases, capacité, décalages, onde verte, optimisation (navigateur + API) |
| Schémas partagés | zod (`packages/schema`) |
| API | **NestJS** + Drizzle |
| Base | **PostgreSQL + PostGIS + pgRouting** (programmation des feux en `jsonb`) |
| Jobs (phase 2) | pg-boss (dans Postgres) + worker Nest avec SUMO |
| Import OSM | osm2pgsql / osm2pgrouting |
| Déploiement | Docker Compose sur un VPS (~5–10 €/mois), Caddy |

Pourquoi Postgres plutôt que Mongo : feux et carrefours dans l'emprise de la carte, distances le
long du réseau pour l'onde verte (`pgr_dijkstra`), orientation des branches, proximité du
tram, import OSM, export Lambert 93. Tout est natif dans PostGIS et serait à recoder avec Mongo
(voir la décision 001 dans ARCHITECTURE.md).

Contributions **anonymes, sans comptes**, modérées avant publication.

---

## 7. Ce qui existe déjà

### À Besançon

| Quoi | Quand | Intérêt pour le projet |
|---|---|---|
| Carte interactive de signalement « circulation apaisée » (Ville) | oct.–déc. 2022 | Précédent de carte participative ; pas de simulation. |
| Plan de circulation (apaisement, écoles, secteur Nord-Est prioritaire) | 2022 → 2026 | Priorités de la Ville ; bureaux d'études. |
| **Plan de Mobilité** Grand Besançon Métropole | 2025 → 2035 | Cadre de référence (modes actifs, TC) : privilégier des ondes vertes « apaisées ». |
| Plan piéton | conseil communautaire fév. 2026 | Contraintes de verts piétons à respecter. |
| Demandes d'aménagement de l'Association Vélo Besançon | continu | Idées de corridors à étudier. |
| Budget participatif (saison 3, 250 k€) | 2024-2026 | Débouché possible, non requis. |
| Portail open data `data.grandbesancon.fr` | continu | Pas de plans de feux ni de comptages routiers détaillés publiés. |

Aucun inventaire public des plans de feux bisontins n'a été trouvé. La phase 1 à elle seule est donc inédite.

### Ailleurs

- **[Telraam](https://telraam.net/fr)** : comptage citoyen depuis les fenêtres (utile en phase 2).
- **A/B Street** : redessiner des rues à partir d'OSM et simuler l'effet.
- **[SUMO @ Fabrique des Mobilités](https://wiki.lafabriquedesmobilites.fr/wiki/SUMO)** : communauté française SUMO.
- **[DiagFeux](https://github.com/CEREMA/territoires-ville.DiagFeux)** : voir section suivante.

---

## 8. DiagFeux (Cerema) — analyse

Dépôt : <https://github.com/CEREMA/territoires-ville.DiagFeux>

| | |
|---|---|
| Objet | Conception du diagramme des feux d'un carrefour (CERTU, maîtrise d'œuvre CETE de l'Ouest) |
| Licence | **GPL-3.0** (anciennement propriétaire) |
| Statut | **Plus maintenu**, dernier commit le 9 juillet 2019 |
| Stack réelle | **VB.NET / Visual Studio 2005 (.NET 2.0)**. Le README dit « VB 6.0 », mais le dépôt contient `DiagFeux.vbproj` (`ProductVersion 8.0.50727`) et des `.vb`/`.resx` WinForms |
| Plateforme | Windows (`DiagFeux.exe` fourni). Sous Linux : Wine, non testé |
| Données | XML via DataSet .NET (`.xsd`), paramètres dans `Diagfeux.par` |
| Entrées / sorties | Fond de plan DXF, branches, voies, trajectoires, trafic → plans de feux, phases, diagnostic |

Au premier lancement, il demande un « numéro de licence » : saisir n'importe quel caractère
alphanumérique, ce qui crée `relic.ctu` et `reser.ctu`.

**À réutiliser : la méthode, pas le code.** Les paramètres par défaut constituent le référentiel CERTU :

| Paramètre | Défaut |
|---|---|
| Débit de saturation | 1 800 UVP/h par voie |
| Cycle par défaut / max / max absolu | 70 s / 120 s / 130 s |
| Jaune en agglomération / hors agglo | 3 s / 5 s |
| Vert minimum / rouge minimum | 6 s / 5 s |
| Temps perdu | 5 s |
| Équivalence UVP poids lourd / deux-roues | 2 / 0,3 |
| Vitesse de dégagement piétons / véhicules / vélos | 1 / 10 / 10 m/s |

```text
Capacité théorique  = DébitSaturation × (DuréeCycle − TempsPerdu) / DuréeCycle   (PlanFeux.vb)
Réserve de capacité = Capacité théorique − Demande
Stockage            = Trafic total (UVP/h) × DuréeCycle / 3600
Cycle optimal (Webster) C₀ = (1,5 L + 5) / (1 − Y)
```

Ces valeurs servent en phase 1 (capacité par ligne, contrôles de cohérence) et en phase 2
(proposer un cycle quand la demande est connue). Le projet étant sous AGPL/GPL, on peut
aussi s'inspirer librement du code source.

---

## 9. Sources de données

| Besoin | Source | Licence |
|---|---|---|
| Feux, rues, voies, tram | OpenStreetMap (Overpass / extrait Geofabrik) | ODbL |
| Référentiel topo, orthophotos | IGN BD TOPO / Géoplateforme | Licence Ouverte |
| Tram et bus (lignes, fréquences) | GTFS Ginko — transport.data.gouv.fr | voir fiche |
| Open data local | data.grandbesancon.fr | Licence Ouverte |
| Comptages grands axes | Cerema, DREAL | Licence Ouverte |
| **Plans de feux** | **Relevé terrain** (§3.3) | les tiens |
| Comptages fins (phase 2) | Comptage manuel, Telraam | les tiens |

Les plans de feux officiels sont dans les contrôleurs et au poste de régulation de la
métropole. Un simple mail au service Mobilité peut les obtenir, facultatif. Le projet fonctionne sans.

---

## 10. Coûts

| Poste | Coût |
|---|---|
| Logiciels (SUMO, MapLibre, OSM, IGN, TypeScript…) | 0 € |
| VPS (API, base, front) | ~5–10 €/mois |
| Relevé des feux | un téléphone et du temps |
| Nom de domaine (optionnel) | ~10 €/an |
| Capteurs Telraam, phase 2 (optionnel) | 199 € TTC l'unité |

---

## 11. Garde-fous légaux (le strict minimum)

- [ ] Attribution « © contributeurs OpenStreetMap » sur la carte.
- [ ] Données dérivées d'OSM sous **ODbL** (`DATA_LICENSE.md`), code sous **AGPL-3.0**.
- [ ] **Mentions légales** : en tant que particulier non professionnel, tu peux ne publier que le nom
      et l'adresse de l'hébergeur (le VPS).
- [ ] Pas de cookies ni d'analytics, donc pas de bandeau cookies.
- [ ] Pas de photos ni de vidéos dans les contributions : relevés chiffrés et texte uniquement.
- [ ] Avertissement visible : « outil citoyen indépendant, sans lien avec la Ville ou la
      Métropole ; données relevées à l'œil, indicatives ».
- [ ] Ne pas reprendre le logo ni la charte graphique de la Ville ou de la métropole.
- [ ] Relevés depuis l'espace public, **sans rien poser, filmer ni piloter** : pas de tubes, de
      caméra ou de drone. Ne pas relever en conduisant.
- [ ] Scénarios réalistes : respecter l'IISR (6ᵉ partie, feux), les verts piétons minimaux
      et l'accessibilité PMR. Ce n'est pas une obligation, mais c'est une question de crédibilité.

---

## 12. Faire circuler les résultats

- **Formats** : GeoJSON pour le web, export **Lambert 93 / EPSG:2154** (GeoPackage) pour les SIG
  des collectivités, plans de feux en YAML/JSON et CSV.
- **Fiche corridor PDF** générée automatiquement : diagramme espace-temps actuel et optimisé,
  bande passante, gains simulés en phase 2, hypothèses et limites.
- **Destinataires (un mail suffit)** : service Mobilité / régulation du trafic de Grand
  Besançon Métropole, l'élu chargé des mobilités, l'AVB, les conseils de quartier.

---

## 13. Feuille de route

### Phase 1 — Inventaire des feux
- [ ] Initialiser le monorepo (pnpm, React + MapLibre, NestJS + Drizzle, PostGIS en Docker, schémas zod, licences).
- [x] Import OSM (Overpass) : 860 feux dans la table `feu` (359 véhicule, 501 piéton), sans regroupement automatique.
- [x] Composition manuelle des carrefours sur la carte (sélection des feux, nom proposé, modification, suppression).
- [ ] Composer les ~130 carrefours et traversées de la ville.
- [x] Sélection des feux par rectangle (bouton, ou Maj + glisser).
- [x] Configuration, étape 1 : branches, voies calées sur la photo IGN, passages piétons, connexions entre voies par glisser-déposer (« lane connector » de TM:PE) ; flèches et mouvements déduits — voir [docs/CONFIGURATION.md](docs/CONFIGURATION.md).
- [x] Configuration, étape 2 : lignes de feux, feux physiques, matrice des conflits et conflits admis.
- [x] Fond de carte « Satellite » (orthophotos IGN) pour vérifier voies et marquages.
- [x] Configuration, étape 3 : plans de feux et plages horaires, programme par étapes, jaune et rouges de dégagement calculés sur la géométrie, diagramme de feux, lecture du cycle sur la carte.
- [x] Configuration, étape 4 : graphe des étapes (étapes sur appel, priorité tram, arcs conditionnels) et simulation d'un scénario de demandes (attentes, journal, lecture sur la carte).
- [x] Giratoires à feux, par nœuds comme dans TM:PE : nœuds posés sur la photo (ou détectés dans OSM), liaisons à chaque nœud, feux d'anneau, conflits d'insertion — voir [docs/CONFIGURATION.md §7](docs/CONFIGURATION.md#7-giratoires).
- [ ] Comparer le diagramme de feux aux relevés terrain (après le chrono).
- [x] Carte MapLibre : carrefours colorés par statut, bulle avec nom, nature et tram.
- [ ] Fiche carrefour avec diagramme de feux ; calcul des branches (`ST_Azimuth`).
- [ ] `engine/` : capacité par ligne, contrôles de cohérence avec les relevés (phases et rouges de dégagement : faits à l'étape 3).
- [ ] Chrono de feux (PWA hors-ligne) → `POST /api/releves` → modération.
- [ ] **Pilote** : relever entièrement **un axe de 4 à 6 carrefours consécutifs**, pour préparer la phase 1 bis.
- [ ] Ouvrir les contributions (guide de relevé, écran de modération).

### Phase 1 bis — Liaisons et onde verte
- [ ] Tables `corridor` + topologie pgRouting, avec distances automatiques le long du réseau.
- [ ] Calcul des décalages actuels à partir des `t0` relevés.
- [ ] Diagramme espace-temps interactif et bande passante par sens.
- [ ] Optimisation des décalages (recherche exhaustive, puis MAXBAND).
- [ ] Rapport actuel vs optimisé sur l'axe pilote.

### Phase 2 — SUMO
- [ ] Réseau SUMO de l'axe pilote depuis OSM, puis corrections.
- [ ] Convertisseur plan de feux → `tlLogic` (+ offsets, WAUT), association lignes ↔ liens.
- [ ] Demande plausible, puis calée sur des comptages.
- [ ] Scénarios actuel / optimisé / `tlsCoordinator` ; indicateurs ; 10 graines.
- [ ] Validation par traces GPS du temps de parcours réel.
- [ ] Simulations en jobs (pg-boss + worker), résultats sur la carte.

### Plus tard
- Scénarios d'aménagement (giratoire, suppression de feux, voies bus) sur le même socle.
- Prise en compte du tram (préemption) et des bus Ginko dans l'optimisation.
- Réseau de comptage Telraam.

---

## 14. Sources

**Besançon**
- [Carte interactive de signalement circulation, 2022 — macommune.info](https://www.macommune.info/circulation-a-besancon-une-carte-interactive-pour-signaler-les-desagrements-des-bisontins/)
- [Plan de circulation d'ici 2026 — macommune.info](https://www.macommune.info/vitesse-securite-stationnement-la-ville-de-besancon-prevoit-un-grand-changement-de-plan-de-circulation-dici-2026/)
- [Plan de Mobilité Grand Besançon Métropole 2025-2035 (PDF)](https://www.grandbesancon.fr/wp-content/uploads/sites/2/2025/08/GBM_PDM_entier-Juin2025.pdf)
- [Réseau piéton GBM — macommune.info](https://www.macommune.info/grand-besancon-metropole-trace-les-contours-de-son-futur-reseau-pieton/)
- [Perturbations et travaux — grandbesancon.fr](https://www.grandbesancon.fr/infos-pratiques/urbanisme-voirie-travaux/perturbations-de-circulation/)
- [Demandes d'aménagements — Association Vélo Besançon](https://asso.velobesancon.info/demandes-amenagements-avb-ville/)
- [Budget participatif saison 3 — macommune.info](https://www.macommune.info/budget-participatif-les-votes-pour-designer-les-meilleurs-projets-de-la-saison-3-sont-ouverts/)
- [Ateliers citoyens de la Ville de Besançon](https://atelierscitoyens.besancon.fr/themes/budget-participatif)

**Données**
- [Open data Besançon — Transport & Mobilité](https://data.grandbesancon.fr/opendata/dataset/list/nouvelle/recherche/domaine/Transport%20-%20Mobilit%C3%A9)
- [Grand Besançon Métropole sur data.gouv.fr](https://www.data.gouv.fr/organizations/grand-besancon-metropole/datasets)
- [GTFS réseau Ginko — transport.data.gouv.fr](https://transport.data.gouv.fr/datasets/gtfs-du-reseau-ginko-besancon-lignes-urbaines-et-periurbaines)
- [Données trafic routier open data — Cerema](https://trafic-routier.data.cerema.fr/acces-aux-donnees-de-trafic-routier-open-data-r25.html)
- [Comptages routiers — DREAL Grand Est](https://www.grand-est.developpement-durable.gouv.fr/comptage-les-donnees-de-trafic-routier-2024-sont-a22089.html?lang=fr)
- [Overpass API (OpenStreetMap)](https://overpass-api.de/)

**Outils**
- [Eclipse SUMO](https://eclipse.dev/sumo/)
- [SUMO — import OpenStreetMap](https://github.com/eclipse-sumo/sumo/blob/main/docs/web/docs/Networks/Import/OpenStreetMap.md)
- [SUMO — Fabrique des Mobilités](https://wiki.lafabriquedesmobilites.fr/wiki/SUMO)
- [DiagFeux — Cerema (GitHub)](https://github.com/CEREMA/territoires-ville.DiagFeux)
- [Telraam — boutique et tarifs](https://telraam.net/fr/shop)
- [Telraam — France Mobilités](https://www.francemobilites.fr/solutions/reseau-comptage-telraam)
