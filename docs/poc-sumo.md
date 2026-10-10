# POC SUMO : un carrefour de bout en bout

> **Objectif** : simuler dans SUMO un carrefour tel qu'il est saisi dans le projet (réseau,
> lignes de feux, plan), comparer deux programmes et rejouer la simulation, sur la carte et
> dans `sumo-gui` ; puis voir circuler la ville entière sur la carte.
> **Statut** : brouillon
> **Dernière mise à jour** : 2026-10-09

## Contexte

La phase 2 du [README](../README.md#5-phase-2--simulation-sumo) prévoit de rejouer les plans
relevés dans SUMO. Le chantier `reseau-voies` produit déjà la moitié du chemin : un réseau
`noeud` / `troncon` semé depuis OSM et un export SUMO « plain XML »
(`pnpm reseau:sumo`, `packages/engine/src/sumo.ts`, `docs/RESEAU.md` §5). Il lui manque ce que
son propre plan met hors périmètre : **le programme des feux dans SUMO (`versTlLogic`) et la
demande de trafic**. Le POC ajoute ces deux pièces, lance la simulation et l'affiche, sur **un
seul carrefour** : *Rue des Glacis × Avenue Edgar Faure × Rue Battant* (15 nœuds, 4 lignes
d'arrêt, lignes F1 à F4, plan « jour » de 101 s en 4 étapes). C'est aujourd'hui le seul
carrefour qui a un programme, et il n'existe que dans la base `voirie_wt_reseau_voies`.

Hors périmètre : piétons, tram et bus, carrefours actués, plages horaires (WAUT), décalages
entre carrefours, calage sur des comptages, worker pg-boss.

## Réponses rapides

### Ce que SUMO attend

```text
 reseau.nod.xml  ┐
 reseau.edg.xml  ├─ netconvert ─▶ reseau.net.xml ─┐
 reseau.con.xml  ┘                                │
 feux.add.xml    (tlLogic : notre plan)  ─────────┤
 demande.rou.xml (véhicules)             ─────────┼─ sumo / sumo-gui ─▶ tripinfo.xml, queue.xml,
 poc.sumocfg     (ce qui est chargé, durée, graine, sorties) ┘              fcd.xml, feux-etats.xml
```

| Fichier | Contenu | Chez nous |
|---|---|---|
| `reseau.nod.xml` | Nœuds : position, type (`priority`, `traffic_light` + id du feu), et `<join nodes="…"/>` pour fusionner des nœuds en une jonction | `exporterSumo` (existe), `<join>` à ajouter |
| `reseau.edg.xml` | Arêtes : nœuds de départ et d'arrivée, nombre de voies, vitesse (m/s), tracé ; `<lane allow="bus">` ; `<param>` libres, recopiés dans `net.xml` | `exporterSumo` (existe) |
| `reseau.con.xml` | Connexions voie à voie : `from`, `to`, `fromLane`, `toLane`. SUMO numérote les voies de la **droite (0)** vers la gauche, nous de la gauche | `exporterSumo` (existe) |
| `reseau.net.xml` | Réseau compilé par `netconvert` : jonctions, voies internes, coordonnées en UTM (m), et surtout les **liens** de chaque feu, numérotés (`linkIndex`) | généré |
| `feux.add.xml` | `<tlLogic id programID offset type="static">` puis une `<phase duration state/>` par période sans changement. `state` : **un caractère par lien** du feu, `G` vert prioritaire, `g` vert qui cède, `y` jaune, `r` rouge, `O` éteint. Plusieurs plans : plusieurs `programID`, basculés par un `<WAUT>` | **à écrire** : `versTlLogic` |
| `demande.rou.xml` | `<vType>` (gabarit, accélération) et `<flow from to begin end vehsPerHour>` : SUMO calcule l'itinéraire au départ | **à écrire** : flux par mouvement |
| `poc.sumocfg` | Fichiers chargés, `begin` / `end`, pas de temps, graine, sorties | **à écrire** |

Sorties utiles : `tripinfo.xml` (par véhicule : durée, attente, nombre d'arrêts, temps perdu,
retard au départ), `queue.xml` (file par voie et par pas), `fcd.xml` (position de chaque
véhicule à chaque pas, en lon/lat avec `--fcd-output.geo`), états des feux
(`<timedEvent type="SaveTLSStates">`).

Exemple : plan « jour » du Glacis (F1 vert [0, 20], F2 [26, 46], F3 [50, 70], F4 [76, 96],
jaune 3 s). Indices de liens fictifs : F1 → 0‑3, F2 → 4‑5, F3 → 6‑9, F4 → 10‑13.

```xml
<tlLogic id="…" programID="releve" offset="0" type="static">
  <phase duration="20" state="GGGGrrrrrrrrrr"/>  <!-- F1 vert -->
  <phase duration="3"  state="yyyyrrrrrrrrrr"/>  <!-- F1 jaune -->
  <phase duration="3"  state="rrrrrrrrrrrrrr"/>  <!-- dégagement -->
  <phase duration="20" state="rrrrGGrrrrrrrr"/>  <!-- F2 -->
  <phase duration="3"  state="rrrryyrrrrrrrr"/>
  <phase duration="1"  state="rrrrrrrrrrrrrr"/>
  <phase duration="20" state="rrrrrrGGGGrrrr"/>  <!-- F3 -->
  <phase duration="3"  state="rrrrrryyyyrrrr"/>
  <phase duration="3"  state="rrrrrrrrrrrrrr"/>
  <phase duration="20" state="rrrrrrrrrrGGGG"/>  <!-- F4 -->
  <phase duration="3"  state="rrrrrrrrrryyyy"/>
  <phase duration="2"  state="rrrrrrrrrrrrrr"/>  <!-- total 101 s -->
</tlLogic>
```

### À quelle échelle

SUMO lui-même tient une ville entière : des scénarios de référence comme Cologne ou Luxembourg
simulent des centaines de milliers de trajets par jour. La limite, ici, ce sont **les données** :
un seul carrefour a un programme, et aucune matrice origine-destination n'existe.

| Échelle | Taille | Calcul (ordre de grandeur, à mesurer) | Données nécessaires | Sert à |
|---|---|---|---|---|
| **Carrefour isolé** (POC) | 1 carrefour, rayon 250 m | quelques secondes par heure simulée | lignes + plan : **disponibles pour le Glacis** | valider la conversion, comparer deux programmes |
| Axe pilote | 4 à 6 carrefours, 1 à 2 km | quelques secondes à une dizaine | plans relevés + tops (décalages) des 6 | confronter l'onde verte calculée (phase 1 bis) à la simulation |
| Quartier | 20 à 40 carrefours | de l'ordre de la minute | + comptages pour caler la demande | effets sur les rues transversales, reports |
| Ville | 13 036 tronçons, ~130 carrefours (import OSM direct : 11 864 arêtes, 106 feux) | **mesuré** (étape 14) : réseau en 3 s ; pointe du matin (7 h 00 - 8 h 30, 28 000 véhicules) en 4 min 50 sur 12 threads, 0,8 Go | tous les plans + matrice OD | voir la ville circuler sur la carte ; aucune mesure utile tant que les feux non relevés sont inventés |

Réglages du POC : 1 h simulée précédée de 10 min de chauffe (véhicules partis avant exclus des
mesures), pas de 1 s, 3 graines par scénario (10 à terme). Sur un carrefour, une simulation
prend moins de 200 Mo de mémoire.

### Affichage

1. **`sumo-gui`** : le même `poc.sumocfg`, en direct : vitesse réglable, pas à pas, clic sur
   un véhicule ou un feu, couleur des véhicules selon leur attente. L'option « show link tls
   index » des jonctions affiche l'indice de chaque lien : c'est l'outil pour vérifier
   l'association lignes ↔ liens. Aucun code.
2. **Rejeu dans l'application** : `fcd.xml` et les états des feux convertis en JSON, servis par
   l'API ; un mode *Simulation*, à côté de *Temps réel*, anime les véhicules sur MapLibre et
   colore les lignes de feux d'après SUMO (lecture, pause, vitesse, curseur de temps).
   Le même rendu tient **la ville entière** (étape 14) : 5 700 à 7 300 véhicules à la fois
   entre 8 h 00 et 8 h 15, positions en binaire (8 octets par véhicule et par seconde, 47 Mo
   pour ces 15 min), feux en `feature-state`.
3. **Résultats** : attente moyenne, arrêts et file maximale par mouvement et par branche,
   programme relevé contre programme par défaut de SUMO.

### Réalisme de la ville : ce qu'on peut régler

Ce qui cloche dans la pointe du matin de l'étape 14 :

- **Vitesses** : une voie OSM sans `maxspeed` prend la vitesse par défaut de SUMO, prévue hors
  agglomération : 100 km/h pour `primary` et `secondary`, 80 km/h pour `tertiary`, 50 km/h pour
  `residential`. Résultat : 101 arêtes `secondary` à 100 km/h (la valeur par défaut), jusqu'à
  334 `tertiary` à 80 km/h, et 4 432 `residential` à 50 km/h malgré les nombreuses zones 30.
  Seules 27 % des voies ont `lanes` et 3 % `turn:lanes`.
- **Demande** : départs et arrivées tirés au hasard, au prorata de la longueur des voies. La
  moitié du réseau est résidentiel, donc la moitié des trajets part d'une rue quelconque. Les
  bords de la carte sont favorisés (`--fringe-factor 5`), mais une entrée de ville comme la
  RN57 ne l'est pas plus qu'une petite rue coupée par le bord : la RN57 (2,5 % du réseau)
  reste peu chargée.
- **Itinéraires** : chaque véhicule prend le plus rapide du moment ; avec des rues
  résidentielles à 50 km/h, il coupe par les quartiers.
- **Feux** : les 106 feux ont le même programme inventé, un cycle de 90 s, sans lien avec le
  trafic ni coordination.
- **Blocages** : 613 téléportations (319 à des cédez-le-passage, 211 dans des bouchons, 83 sur
  une mauvaise voie), signe de carrefours mal reconstitués par netconvert.

Leviers, du plus rentable au plus coûteux :

| Levier | Corrige | Dans SUMO | Données | Effort |
|---|---|---|---|---|
| Vitesses et voies urbaines | 80 à 100 km/h en ville, raccourcis par les quartiers | fichier de types maison (`netconvert --type-files`) : 50 km/h de `primary` à `unclassified`, 30 km/h pour `residential` sans `maxspeed` ; `--osm.turn-lanes`, `--osm.lane-access` | OSM (déjà là) | faible |
| Feux | un cycle de 90 s partout | `tlsCycleAdaptation.py` (cycle et verts de Webster d'après la demande), `tlsCoordinator.py` (ondes vertes) ; plans relevés par `versTlLogic` | les plans relevés, quand il y en a | faible |
| Demande | quartiers nord saturés, RN57 vide | départs pondérés par la population, arrivées par les emplois (`randomTrips.py --weights-prefix`) ; flux entrants aux entrées de ville (RN57, RN83, RD683, A36) ; ou zones et matrice (`od2trips`) | INSEE : population carroyée à 200 m, emplois, navettes domicile-travail par commune (MOBPRO) ; enquête ménages 2018 (flux par secteur) | moyen |
| Calage sur comptages | volumes par axe | `routeSampler.py` choisit les itinéraires qui reproduisent les comptages ; sortie `edgeData` pour comparer | comptages DIR Est (RN57), Département, Ville | moyen |
| Choix d'itinéraire | répartition entre les axes | `duaIterate.py` : équilibre où chacun connaît les temps de parcours, au lieu du seul réacheminement | aucune | calcul 10 à 50 fois plus long |
| Carrefours bloquants | téléportations | relire les avertissements de `sumo` (arête, carrefour), corriger dans `netedit` ou par options (`--junctions.join-dist`, priorités) | aucune | au cas par cas |
| Conducteurs et véhicules | comportement trop uniforme | `vType` : `speedFactor`, `sigma`, `tau`, `impatience`, `jmTimegapMinor` ; poids lourds (12 % sur la RN57 selon la DREAL), bus Ginko (`gtfs2pt.py`), tram | GTFS Ginko | faible à moyen |

Ordre conseillé : vitesses (quelques minutes, effet visible tout de suite), feux, demande, puis
calage si des comptages sont accessibles.

> ❓ **À confirmer** : l'accès aux comptages (station de la DIR Est à Micropolis sur la RN57,
> Département du Doubs, Ville de Besançon). Hypothèse retenue : données partielles, à demander.

### Analyser vite, sans tout configurer à la main

La lenteur et la configuration viennent du même choix : simuler **toute la ville finement à
chaque essai**. Une analyse compare des programmes de feux sur un axe ; le réalisme n'est utile
que là où l'on mesure, et le reste de la ville ne sert qu'à fournir les flux qui y entrent.

Chaîne en trois niveaux, chacun relancé seulement quand ses entrées changent :

| Niveau | Quand le relancer | Ce qu'il fait | Durée |
|---|---|---|---|
| 1. Ville | quand la demande ou le réseau change | réseau + demande + itinéraires **figés une fois** (`duarouter`, ou `duaIterate.py` pour l'équilibre) ; simulation micro, ou méso (`--mesosim`) pour caler les volumes | minutes, une fois |
| 2. Découpe | quand l'axe étudié change | `cutRoutes.py` garde les trajets qui traversent l'emprise de l'axe et les coupe à ses bords ; `netconvert --keep-edges.in-geo-boundary` découpe le réseau | secondes |
| 3. Axe | à chaque programme testé | simulation micro de l'axe seul, itinéraires figés, sorties légères, plusieurs graines et programmes **en parallèle** | secondes par run |

L'axe hérite ainsi d'une demande cohérente avec la ville (reports, mouvements tournants) sans
saisir un seul flux.

Leviers de vitesse, du plus rentable au moins rentable :

| Levier | Gain | Comment |
|---|---|---|
| Ne plus réacheminer en route | **85 % du temps** de la ville (mesuré : 25 s au lieu de 159 s pour 30 min sur 1 thread) | itinéraires figés au niveau 1, puis `device.rerouting.probability 0`. Si on garde le réacheminement : `period 300` et `probability 0.3` au lieu de 120 / 1 |
| Ne pas tout refaire à chaque run | netconvert, `demande.py`, `tlsCycleAdaptation.py` : ~1 min par run | séparer `lancer.sh` en `preparer.sh` (réseau, demande, itinéraires) et `simuler.sh` (sumo + sorties) |
| Sorties d'analyse au lieu de positions | `fcd` : 750 Mo pour 40 min | analyse : `tripinfo`, `edgeData` agrégé par 5 min, détecteurs E2 sur les voies d'approche ; `fcd` seulement pour le rejeu |
| Simuler l'axe, pas la ville | 13 036 tronçons → quelques centaines | niveau 2 |
| Runs en parallèle plutôt que threads | `--threads 8` : 159 s → 48 s seulement | programmes et graines sont indépendants : un run d'axe (< 200 Mo, 1 thread) par cœur libre |
| Mésoscopique | environ un ordre de grandeur, à mesurer | `--mesosim` pour la ville (volumes, temps de parcours) ; jamais pour comparer des programmes, les feux y sont approchés |

Ce qu'il faut vraiment fournir, et seulement sur l'axe étudié :

- **Plans de feux** des carrefours de l'axe (relevés + décalages) ; ailleurs,
  `tlsCycleAdaptation.py` et `tlsCoordinator.py` suffisent (déjà dans `lancer.sh`).
- **Volumes** : comptages par axe si on les obtient, passés à `routeSampler.py`, qui choisit
  parmi les itinéraires de la ville ceux qui les reproduisent. Faute de comptages, un relevé
  manuel de 15 min par carrefour (vidéo à la pointe, mouvements tournants) alimente
  `routeSampler.py --turn-files`.
- **Sans aucun comptage** : faire varier la demande de ±20 % et ±40 % ; une conclusion
  « le programme B fait mieux que A » ne vaut que si l'ordre tient sur toutes les variantes et
  toutes les graines.

> ❓ **À confirmer** : `--routing-algorithm CH` accélère-t-il encore les itinéraires de la ville
> (niveau 1) ? Hypothèse retenue : à mesurer sur `duarouter` avant de l'adopter.

### Dire « à cette heure, x voitures vont d'ici à là-bas »

SUMO le permet de plusieurs façons : un `<flow from to begin end number>` entre deux rues, ou
des zones (TAZ) et une matrice origine-destination par tranche horaire (`od2trips`). Dans le mode
SUMO de l'app, c'est la section **Flux ajoutés à la main** du scénario : origine et destination
cliquées sur la carte, rayon, plage horaire, nombre de voitures. Chaque voiture part d'une rue
tirée dans le cercle d'origine (au prorata des longueurs) vers une rue du cercle de destination ;
départs répartis sur la plage. Les flux s'ajoutent à la demande générale :

| Motif | Qui | Quand | Script |
|---|---|---|---|
| Aller | 28 000 voitures (100 %), origines et destinations pondérées par le type de voie et les entrées de ville | 7 h - 8 h 30 | `demande.py` (décision S10) |
| Midi | 20 % des navetteurs : moitié rentre manger, moitié à 400 m - 2 km du travail | sortie vers 12 h 15 (± 20 min), retour 45 min - 1 h 15 plus tard | `deplacements.py --midi 0.2` |
| Soir | chaque navetteur, trajet inverse | aller + 9 h 30 (± 15 min) | `deplacements.py` |
| Flux | ce qui est saisi | ce qui est saisi | `deplacements.py --flux flux.json` |

Chaque déplacement est vérifié sur le graphe des connexions du réseau (grande composante
fortement connexe) : on garde la rue d'en face, la même rue, ou la rue joignable la plus proche
(moins de 1 km) ; sinon le trajet est abandonné.

### Itinéraires qui coupent par les petites rues

Un itinéraire au plus court temps ne voit ni l'attente aux feux ni le cédez-le-passage : une
rue résidentielle à 50 km/h (beaucoup sont marquées ainsi dans OSM) paraît aussi rapide qu'un
axe. Deux options de SUMO, réglées dans `ville.sumocfg` :

- `weights.priority-factor 1` : le coût d'une arête est multiplié selon son rang dans la
  hiérarchie (priorité du type de voie) : ~1,85 pour une rue résidentielle, ~1,15 pour une
  primaire ;
- `weights.tls-penalty 1` : chaque feu traversé ajoute son temps de rouge moyen.

Les deux se règlent aussi par essai, dans la catégorie « Itinéraires (routage) » du formulaire.

## Décisions

| # | Décision | Alternative écartée | Raison |
|---|---|---|---|
| S1 | Worktree `sumo-poc` **créé depuis `reseau-voies`** | Depuis `main` | `main` n'a ni le réseau `noeud` / `troncon` ni l'export SUMO, et sa base ne contient aucun carrefour. Conséquence : le POC se fusionne dans `reseau-voies`, ou dans `main` après lui. |
| S2 | Base du POC = **copie de `voirie_wt_reseau_voies`** avant le premier démarrage | Lire la base de `reseau-voies` depuis le POC ; recomposer le carrefour à la main | Seule base avec un carrefour programmé ; une copie isole les deux worktrees. |
| S3 | Le carrefour devient **une seule jonction SUMO** (`<join>` de ses nœuds), avec les connexions du carrefour (voie entrante → voie sortante) | Garder un nœud SUMO par nœud du réseau, reliés à un même feu (export actuel) | Un lien SUMO correspond alors à une connexion du carrefour, donc à un mouvement `O>D`, donc à une ligne de feux. Avec des nœuds séparés, il faut suivre chaque lien à travers le cœur du carrefour et décider du feu des nœuds sans ligne d'arrêt. On perd le stockage entre deux lignes d'arrêt internes (branches R1, R2…), absentes du Glacis. Cela reprend aussi l'étape 9 de `reseau-d-abord.md` (exporter les connexions saisies). |
| S4 | ~~Liens ↔ lignes associés en relisant `reseau.net.xml` après netconvert~~ → **`linkIndex` imposé dans `reseau.tll.xml`** (révisée le 2026-10-10, docs/pipeline-donnees.md étape 6) | Relire `reseau.net.xml` | L'API écrit l'export sans lancer netconvert : imposer l'ordre des liens rend le `<tlLogic>` exact dès l'export. À vérifier avec un vrai netconvert. |
| S5 | Demande = **un flux par mouvement** du carrefour | `randomTrips.py` | Chaque ligne de feux est chargée, et les résultats se lisent par mouvement. |
| S6 | Orchestration par un **script Node** (`pnpm sumo:poc`), client de l'API comme `reseau.ts` | Worker Nest + pg-boss | Le worker attendra que la chaîne soit validée. |
| S7 | Réseau de la ville (étape 14) = **import OSM direct** : `netconvert --osm-files` sur le cache `data/osm/besancon.json` | `pnpm reseau:sumo` (export du réseau `noeud` / `troncon`) | Marche sur `main`, sans base ni worktree. netconvert devine 106 feux d'après les nœuds `highway=traffic_signals` et leur invente un programme ; l'export `reseau-voies` n'en aurait que 7. |
| S8 | Rejeu de la ville en **binaire** : 8 octets par véhicule et par pas (id, lon, lat quantifiées à ~0,2 m, angle, vitesse), plus un JSON des feux (état à chaque changement) | JSON `[id, lon, lat, angle, vitesse]` par pas | 8 h 00 - 8 h 15 = 5,8 millions de positions : 47 Mo en binaire, environ 4 fois plus en JSON. Le `fcd.csv` de SUMO pèse 750 Mo pour 40 min. |
| S9 | Véhicules sur une **source GeoJSON mise à jour à chaque image** (boucle hors React, comme `CoucheTrams`) ; feux en `setFeatureState` sur les voies d'approche | deck.gl (`ScatterplotLayer` en surcouche) | Aucune dépendance nouvelle ; construire l'image coûte 0,2 à 0,5 ms pour 6 000 véhicules. deck.gl si la fluidité manque au-delà. |
| S10 | Demande de la ville = **pointe du matin** : 7 h 00 - 8 h 30, 12 000 puis 20 000 puis 24 000 véh/h par tranche de 30 min, origines et destinations tirées au hasard | 9 000 véh/h constants pendant 30 min (première version) | L'enquête ménages 2018 compte 288 000 déplacements par jour en voiture conducteur dans l'agglomération, avec une pointe marquée entre 7 h et 9 h. Environ 10 % dans l'heure de pointe, plus les entrées depuis l'extérieur de l'agglomération : 20 000 à 25 000 véh/h. Le volume est plausible ; les trajets ne le sont pas tant qu'il n'y a pas de matrice origine-destination. |
| S11 | Itinéraire choisi **au départ**, d'après le trafic du moment, puis gardé (`device.rerouting.period 0`) ; aller le matin, **retour le soir** (trajet inverse, 9 h 30 plus tard) | Réacheminement toutes les 2 min ; itinéraires calculés sur la ville vide | Un navetteur ne change pas de route en chemin. Itinéraires de la ville vide : tout le monde sur les mêmes axes, ville bloquée (8 000 voitures encore en route à 14 h 30, 7 400 téléportations). Choix au départ : le matin se résorbe vers 13 h 45. |
| S12 | **Mode SUMO** dans l'app (worktree `sumo-trajets`), à côté de Données brutes : essais à gauche, indicateurs et fiche du tronçon à droite, timeline en bas. Un essai = une journée archivée par `essai.py` dans `essais/<id>/` (meta.json, troncons.geojson, series.bin.gz : mesures par tronçon et par tranche de 5 min, uint16 gzip) ; API `GET /api/sumo/essais[/:id[/troncons\|/series]]` | Couche de Données brutes (premier POC), une heatmap par pointe | Plusieurs essais à comparer, des indicateurs qui évoluent dans la journée, et un menu qui va grossir. |
| S13 | **Lancer des essais depuis l'app** : formulaire en accordéon (Scénario, puis une section par catégorie d'options SUMO, générée par `options_sumo.py` depuis `sumo --save-template`), lanceur `lancer_essai.py` détaché de l'API dans `lancements/<id>/`, avancement en **SSE** lu dans `summary.xml` (écrit à chaque seconde simulée) ; un lancement à la fois | TraCI pour suivre la simulation ; options recopiées à la main | `summary.xml` ne coûte rien en calcul, TraCI ralentit 2 à 5 fois ; 306 options modifiables ne se recopient pas. Le lanceur détaché survit au redémarrage de l'API (rechargement à chaud). |
| S14 | Déplacements de la journée par **`deplacements.py`** (soir, midi, flux), chacun vérifié sur le réseau ; hiérarchie des routes et feux dans le choix d'itinéraire (`weights.priority-factor 1`, `weights.tls-penalty 1`) | `retour_soir.py` sans vérification ; vitesses plus basses sur les petites rues | Le retour du soir partait parfois d'une rue qui ne mène pas à destination : sans itinéraire, la voiture restait bloquée (« wrong lane ») ; 1 514 des 1 523 téléportations de 17 h 30 - 18 h. Baisser les vitesses fausserait les temps de parcours réels ; la hiérarchie agit sur le choix seul. |

> ❓ **À confirmer** : S1 et S3. Hypothèse retenue : worktree sur `reseau-voies`, carrefour en
> une jonction.

> ❓ **À confirmer** : la fluidité de S9 dans un vrai navigateur (compteur « Images par seconde »
> de `carte.html`). Hypothèse retenue : 6 000 points par `setData` restent fluides ; sinon deck.gl.

## Prérequis

- [ ] Nevven Worktree Manager lancé (`node server.js` dans `nevven-wtm/`).
- [ ] Conteneur `besancon-voirie-db-1` démarré (`pnpm db:up`).
- [ ] Worktree `reseau-voies` sans changement en cours sur les données du Glacis (la copie de
      l'étape 3 est un instantané).
- [ ] Environ 1 Go libre sur le disque pour SUMO.

## Étapes

Sauf mention contraire, les commandes se lancent depuis la racine du worktree :
`/home/esteban/worktrees/besancon-voirie/sumo-poc/app`.

### Étape 1 — Installer SUMO

Un environnement Python partagé par tous les worktrees, hors du dépôt. `eclipse-sumo` apporte
les binaires (`sumo`, `sumo-gui`, `netconvert`, `netedit`) et les outils Python (`randomTrips.py`…).

```bash
python3 -m venv ~/.local/share/sumo-venv
```

```bash
~/.local/share/sumo-venv/bin/pip install eclipse-sumo
```

```bash
~/.local/share/sumo-venv/bin/sumo --version
```

**Résultat attendu** : `Eclipse SUMO sumo 1.27.1`.

La roue pip fournit bien `sumo-gui` et `netedit` sous Linux (vérifié le 2026-09-27) ; le venv
pèse environ 510 Mo.

### Étape 2 — Créer le worktree `sumo-poc`

Par le manager, **sans le démarrer** (l'étape 3 doit précéder le premier `db:prepare`) : outil
`create_worktree` avec `branch = sumo-poc`, `base = reseau-voies`. Puis déplacer ce document
dans le worktree (`docs/poc-sumo.md`) : il y sera commité.

**Résultat attendu** : `/home/esteban/worktrees/besancon-voirie/sumo-poc/app` existe, sur la
branche `sumo-poc`, statut `stopped`.

### Étape 3 — Copier la base de `reseau-voies`

`db:prepare` ne crée la base d'un worktree que si elle n'existe pas : on la crée d'abord, en
copie de celle de `reseau-voies` (réseau semé, carrefours, lignes, plans). `reseau-voies` peut
continuer de tourner.

```bash
docker exec besancon-voirie-db-1 createdb -U voirie voirie_wt_sumo_poc
```

```bash
docker exec besancon-voirie-db-1 sh -c "pg_dump -U voirie -Fc voirie_wt_reseau_voies | pg_restore -U voirie --no-owner -d voirie_wt_sumo_poc"
```

```bash
docker exec besancon-voirie-db-1 psql -U voirie -d voirie_wt_sumo_poc -Atc "select count(*) from plan_feux"
```

**Résultat attendu** : `1`.

### Étape 4 — Démarrer le worktree

Par le manager (outil `start`). Il lance `pnpm install`, `db:prepare` (base trouvée,
migrations à jour, `.env` écrit avec `TRAM_COLLECTE=false`), puis `pnpm dev`.

**Résultat attendu** : `pnpm db:verifier` indique `0 en attente` ; le Glacis s'affiche sur la
carte du worktree avec son programme.

### Étape 5 — Faire tourner un premier réseau sans rien coder

Valide la chaîne export → netconvert → sumo-gui avec ce qui existe déjà : programme par défaut
de netconvert, trafic aléatoire.

```bash
pnpm reseau:sumo --bbox=6.0184,47.2423,6.0250,47.2468
```

```bash
cd data/sumo && ~/.local/share/sumo-venv/bin/netconvert -c reseau.netccfg
```

```bash
cd data/sumo && ~/.local/share/sumo-venv/bin/python "$(~/.local/share/sumo-venv/bin/python -c 'import sumo; print(sumo.SUMO_HOME)')/tools/randomTrips.py" -n reseau.net.xml -e 3600 -p 3 -o essai.rou.xml
```

```bash
cd data/sumo && ~/.local/share/sumo-venv/bin/sumo-gui -n reseau.net.xml -r essai.rou.xml
```

**Résultat attendu** : netconvert sans erreur, le quartier du Glacis dans sumo-gui, des
véhicules qui circulent, les feux du Glacis sur un programme inventé par netconvert. Noter les
avertissements de netconvert : ils préfigurent les corrections de l'étape 6.

### Étape 6 — Exporter le carrefour en une seule jonction

Dans `exporterSumo` (`packages/engine/src/sumo.ts`), option `joindre` :

- une ligne `<join nodes="…"/>` par carrefour de l'emprise, avec tous ses nœuds ;
- les liaisons des nœuds du carrefour remplacées par ses **connexions** (table `connexion` :
  voie entrante de la branche → voie sortante, index SUMO = voies − 1 − rang) ;
- sur chaque arête qui entre dans un carrefour ou en sort :
  `<param key="carrefour" value="…"/>` et `<param key="branche" value="NE2"/>`, tirés de
  `troncon.branche_de` / `branche_vers`. netconvert les recopie dans `reseau.net.xml`.

`donneesSumo` (`apps/api/src/reseau/reseau.service.ts`) lit en plus les codes de branche des
tronçons et les connexions des carrefours ; `GET /api/reseau/sumo/:fichier` accepte `joindre=1`.

**Résultat attendu** : après netconvert, une seule jonction `traffic_light` pour le Glacis ;
chacun de ses liens part d'une arête dont le `param` `branche` est une branche entrante et
arrive sur une branche sortante.

> ❓ **À confirmer** à cette étape : l'identifiant que netconvert donne à la jonction jointe et à
> son feu (`grep '<tlLogic' reseau.net.xml`).

### Étape 7 — Écrire `versTlLogic`

Fonction pure dans `packages/engine/src/sumo.ts`, avec son `sumo.spec.ts` :

- entrée : les liens du feu lus dans `net.xml` (`linkIndex`, branche d'origine, branche de
  destination), les lignes de feux (`mouvements`), le diagramme de feux du moteur (intervalles
  de vert et de jaune de chaque ligne, sur le cycle) ;
- chaque lien prend la ligne qui commande son mouvement `O>D` ; un lien sans ligne reste au
  rouge et produit une alerte ;
- chaque instant de changement d'une ligne ouvre une phase ; état `G` au vert, `g` si une ligne
  en conflit admis est au vert en même temps et que le lien tourne, `y` au jaune, `r` sinon ;
- sortie : `<tlLogic id="…" programID="releve" offset="0" type="static">` et les alertes.

**Résultat attendu** : pour le plan « jour » du Glacis, 12 phases dont la somme fait 101 s,
comme dans l'exemple plus haut.

### Étape 8 — Générer la demande

Fonction `demandeSumo` à côté de `versTlLogic` : pour chaque mouvement commandé, un `<flow>`
de l'arête de la branche entrante vers l'arête de la branche sortante, de −600 s à 3600 s.
Débit par voie entrante réglable (250 véh/h par défaut, soit ~70 % de la capacité d'une voie
qui a 20 s de vert sur 101 s), réparti entre les mouvements de la voie : 60 % tout droit, 20 %
à gauche, 20 % à droite, renormalisé sur les mouvements qui existent. Identifiant du flux =
mouvement (`NE2-NO2`), pour regrouper les résultats.

**Résultat attendu** : un `demande.rou.xml` avec un flux par mouvement commandé du Glacis.

### Étape 9 — Écrire le script `pnpm sumo:poc`

`apps/api/scripts/simulation.ts`, client de l'API comme `reseau.ts`, plus `"sumo:poc"` dans
`apps/api/package.json` et le `package.json` racine. Variable `SUMO_BIN` dans le `.env`
(`/home/esteban/.local/share/sumo-venv/bin`). Pour un carrefour, dans
`data/sumo/<slug>/` :

1. emprise = carrefour + 250 m ; export plain XML avec `joindre=1` ;
2. `netconvert` ;
3. lecture des liens du feu dans `reseau.net.xml` ;
4. `versTlLogic` → `feux.add.xml` (scénario `releve`) ; le scénario `defaut` garde le
   programme de netconvert ;
5. `demandeSumo` → `demande.rou.xml` ;
6. `poc.sumocfg` par scénario : `begin -600`, `end 3600`, sorties `tripinfo`, `queue`,
   `fcd` (géo), états des feux (`<timedEvent type="SaveTLSStates">`) ;
7. `sumo` sans interface, pour chaque scénario et chaque graine (`--seed`), une à la fois ;
8. agrégation de `tripinfo.xml` → `resultats.json`, par mouvement et par branche : nombre,
   attente moyenne, arrêts moyens, temps perdu, retard au départ.

```bash
pnpm sumo:poc --carrefour=rue-des-glacis-avenue-edgar-faure-rue-battant --graines=3
```

**Résultat attendu** : `data/sumo/rue-des-glacis-avenue-edgar-faure-rue-battant/` contient
`releve/` et `defaut/`, chacun avec ses sorties et un `resultats.json` ; la sortie de SUMO
indique `Teleports: 0`.

### Étape 10 — Contrôler dans `sumo-gui`

```bash
cd data/sumo/rue-des-glacis-avenue-edgar-faure-rue-battant/releve && ~/.local/share/sumo-venv/bin/sumo-gui -c poc.sumocfg
```

Activer « show link tls index » (réglages de la vue, onglet Junctions).

**Résultat attendu** : un cycle de 101 s ; pendant le vert de F1, seuls les liens venant de NE2
sont verts ; les files se vident à chaque vert.

### Étape 11 — Comparer les scénarios

Le script affiche en fin de course un tableau par branche : attente moyenne et arrêts moyens,
`releve` contre `defaut`, moyenne et écart entre graines.

**Résultat attendu** : des chiffres stables d'une graine à l'autre (écart faible devant
l'écart entre scénarios).

### Étape 12 — Servir le rejeu par l'API

Le script convertit `fcd.xml` et les états des feux (15 premières minutes après la chauffe) en
`rejeu.json` : pas de temps, positions `[id, lon, lat, angle, vitesse]` à chaque pas, état de
chaque ligne de feux à chaque changement (lien → ligne, par l'association de l'étape 7).
Nouveau `GET /api/simulations/:slug/:scenario/rejeu` (et `/resultats`), qui lit
`data/sumo/<slug>/<scenario>/`.

**Résultat attendu** : `curl http://localhost:<API_PORT>/api/simulations/rue-des-glacis-avenue-edgar-faure-rue-battant/releve/rejeu`
renvoie le JSON (quelques Mo).

> 💡 Pour un carrefour, le JSON suffit. Pour la ville, reprendre le format binaire de l'étape 14
> (décision S8), servi tel quel par l'API.

### Étape 13 — Ajouter le mode Simulation à la carte

Dans `apps/web`, à côté des modes Temps réel et Édition : choix du carrefour et du scénario,
véhicules en points sur une source GeoJSON mise à jour à chaque image, lignes de feux colorées
avec le rendu du mode Temps réel mais d'après les états SUMO, lecture / pause / vitesse (×1 à
×20) / curseur. Panneau bas : le tableau de l'étape 11.

**Résultat attendu** : le rejeu du Glacis tourne sur la carte, feux et véhicules synchrones.

> 💡 Composant `CoucheSimulation` calqué sur
> [CoucheTrams.tsx](../apps/web/src/map/CoucheTrams.tsx) : boucle `requestAnimationFrame` hors
> de React, positions interpolées entre deux pas, `setData` seulement si un véhicule a bougé à
> l'écran. Le prototype de l'étape 14 (`data/sumo/ville/carte.html`) contient la boucle et le
> décodage du binaire à reprendre.

### Étape 14 — Simuler et afficher la ville entière

Indépendant du worktree : se fait sur `main`, depuis
`/home/esteban/PhpstormProjects/besancon-voirie/data/sumo/ville/` (réseau importé d'OSM,
décision S7). Deux scripts :

- `./preparer.sh [graine]`, à relancer seulement si le réseau ou la demande changent (~1 min 30) :
  `osm_vers_xml.py` (cache Overpass → `besancon.osm`), `netconvert`, `demande.py` (aller du
  matin, décision S10), `deplacements.py` (retour du soir, midi, flux : décision S14), feux adaptés et
  coordonnés, `sorties_feux.py` ;
- `./simuler.sh [graine]` : la journée 7 h 00 - 20 h 00 (itinéraire choisi au départ, décision
  S11), état sauvegardé à 8 h 00 et 17 h 30, puis rejeux 8 h 00 - 8 h 15 et 17 h 30 - 17 h 45
  repris depuis ces états (`sorties/rejeu-matin.bin`, `sorties/rejeu-soir.bin`) ;
- `simuler.sh` archive ensuite la journée comme **essai** du mode SUMO (`essai.py "<nom>"
  "<description>"` → `essais/<id>/`), d'après les mesures par tronçon et par tranche de 5 min
  (`mesures.add.xml`), `summary.xml` et `tripinfo.xml`.

```bash
./simuler.sh 42 "Choix d'itinéraire au départ" "Description de l'essai"
```

**Résultat attendu** : `essai 2026…-choix-d-itineraire-au-depart : 156 tranches de 300 s, ~11 000
tronçons` ; l'essai apparaît dans la carte de gauche du mode SUMO de l'app.

Depuis l'app (décision S13), le mode SUMO lance aussi des essais : « Nouvel essai », ou « Relancer
avec d'autres réglages » sur un essai. `lancer_essai.py lancements/<id>` prépare la demande et les
feux selon le scénario, simule avec la configuration de `ville.sumocfg` plus les options modifiées,
puis archive l'essai ; il ne garde ensuite dans `lancements/<id>/` que les paramètres, l'état et les
journaux. Après une mise à jour de SUMO, régénérer le catalogue des options :

```bash
~/.local/share/sumo-venv/bin/python options_sumo.py
```

**Résultat attendu** : `Eclipse SUMO sumo 1.27.1 : 472 options en 27 catégories, dont 306 modifiables`.

`./lancer.sh` enchaîne `preparer.sh` et `simuler.sh`. Les feux restent ceux inventés par
netconvert : c'est une démonstration visuelle.

Installer `pyproj`, qui convertit les voies d'approche des feux en lon/lat :

```bash
~/.local/share/sumo-venv/bin/pip install pyproj
```

Lancer la chaîne (préparation ~1 min 30 ; journée 11 à 16 min selon la charge de la machine) :

```bash
/home/esteban/PhpstormProjects/besancon-voirie/data/sumo/ville/lancer.sh
```

**Résultat attendu** : 106 feux ; `Inserted: 27963` ; environ 5 700 véhicules en circulation à
8 h 00 et 7 300 à 8 h 15 ; environ 600 téléportations ; `rejeu.bin` d'environ 47 Mo. Pic
mémoire de `sumo` : 0,8 Go.

Servir le dépôt en local (le prototype lit ses fichiers par `fetch`, et MapLibre depuis
`apps/web/node_modules`), depuis la racine du dépôt :

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Ouvrir `http://localhost:8765/data/sumo/ville/carte.html`, puis Lecture.

**Résultat attendu** : l'horloge part de 08:00:00 ; les véhicules circulent sur toute la
ville (rouge à l'arrêt, bleu fluide), avec des files au nord (Saint-Claude, Montrapon, les
Chaprais, les Orchamps) ; les voies d'approche des 106 feux changent de couleur ; le compteur
« Images par seconde » reste proche de 60.

> ❓ **À confirmer** : garder ces scripts ? `data/` n'est pas versionné. Hypothèse retenue : les
> déplacer dans `sumo/` (prévu par `docs/ARCHITECTURE.md`) quand le POC est validé.

### Étape 15 — Tester et commiter

Une seule fois, à la fin (voir `CLAUDE.md`) : `pnpm typecheck`, `pnpm lint`, `pnpm test`,
`pnpm test:e2e`. Aucune migration n'est prévue ; `pnpm db:verifier` doit indiquer
`0 en attente`. Mettre à jour `docs/RESEAU.md` §5 (option `joindre`) et `docs/ARCHITECTURE.md`
§10.

## Vérification finale

- [ ] `sumo-gui` montre le Glacis avec le programme relevé, lignes et liens concordants.
- [ ] `resultats.json` existe pour `releve` et `defaut`, sans téléportation.
- [ ] Le rejeu tourne dans le mode Simulation de l'application.
- [ ] `versTlLogic` et `demandeSumo` sont couverts par `sumo.spec.ts`.
- [ ] `carte.html` rejoue la ville entière de façon fluide dans un vrai navigateur.

## Pièges & précisions

- Si des véhicules sont téléportés (`Teleports: N`) → un lien reste toujours rouge ou le
  carrefour se bloque → lire les alertes de `versTlLogic` (mouvement sans ligne), puis regarder
  dans sumo-gui où la file ne se vide pas.
- Si netconvert signale des arêtes inconnues dans `reseau.con.xml` → des liaisons internes au
  carrefour sont restées dans l'export → l'option `joindre` doit les omettre.
- Si la file dépasse le tronçon d'approche → SUMO retarde l'insertion (`departDelay`) au lieu
  d'allonger la file → compter `departDelay` dans les indicateurs, ou faire partir les flux plus
  en amont.
- Si `python3 -m venv` échoue → paquet manquant → `sudo apt install python3.12-venv`.
- La base du POC est un instantané de `reseau-voies` : une correction faite ensuite là-bas n'y
  arrive pas. Pour la reprendre : arrêter le worktree, supprimer `voirie_wt_sumo_poc`, refaire
  l'étape 3.
- Le plan « jour » du Glacis est au statut `non_releve` : les résultats démontrent la chaîne,
  ils ne décrivent pas la circulation réelle.
- `net.xml` est en UTM (mètres) : lon/lat par `--fcd-output.geo`, ou `net.convertXY2LonLat` de
  sumolib.
- Ne jamais supposer l'ordre des liens d'un feu : toujours le relire dans `net.xml`.
- Machine à 14 Go déjà bien remplis : une simulation à la fois pendant le développement.
- Si `carte.html` reste vide quand on l'ouvre en `file://` → le navigateur bloque `fetch` sur
  les fichiers locaux → passer par le serveur de l'étape 14.
- Si le fichier des états de feux est énorme → `SaveTLSStates` écrit à chaque pas →
  `SaveTLSSwitchStates` n'écrit qu'aux changements (1,2 Mo pour 106 feux et 30 min).
- Si les files de la carte ne ressemblent pas à la réalité (bouchons dans les quartiers nord,
  RN57 fluide alors qu'elle sature chaque matin) → origines et destinations tirées au hasard,
  programmes de feux inventés par netconvert (environ 600 téléportations sur la matinée) →
  démonstration visuelle, pas un diagnostic. Charger la RN57 et les entrées de ville demande une
  matrice origine-destination.
- Si `fcd.xml` dépasse le gigaoctet → la pointe fait 6 000 à 8 000 véhicules à chaque pas →
  écrire en CSV (`sorties/fcd.csv`, 750 Mo pour 40 min) et ne commencer l'enregistrement qu'au
  début de la fenêtre utile (`<device.fcd.begin value="28200"/>`).
- Si la simulation de la ville est lente → c'est le réacheminement : chaque véhicule recalcule
  son itinéraire toutes les 2 min sur 11 864 arêtes, soit environ 85 % du temps de calcul →
  `<threads value="12"/>` (un par cœur) dans `ville.sumocfg`. Mesuré sur 7 h 00 - 7 h 30 :
  25 s sans réacheminement, 159 s avec sur 1 thread, 63 s avec
  `--device.rerouting.threads 8`, 48 s avec `--threads 8`. Plus de RAM n'y change rien (SUMO
  occupe 0,4 à 0,7 Go), et SUMO n'utilise pas le GPU : la simulation microscopique est
  séquentielle. Le GPU sert au rendu de la carte.
- Si le compteur « Images par seconde » affiche 1 dans le navigateur intégré de Claude →
  l'onglet y est bridé → mesurer dans un vrai navigateur.
- Si `randomTrips.py --fringe-speed-exponent` plante (`TypeError … 'float' and 'str'`) → bug de
  SUMO 1.27, l'option est lue comme du texte. Et même corrigée, elle multiplie le poids des
  bords de carte par vitesse³ sans normaliser : 100 % des trajets partaient du bord. →
  `demande.py` calcule lui-même les poids (`--weights-prefix`).
- Si une « entrée de ville » tombe en plein centre → le critère « un seul tronçon entrant »
  prend aussi les séparations de chaussée → ne retenir que les nœuds où rien n'arrive, sauf la
  voie de retour du tronçon lui-même (ce que fait `demande.py`).
- Un identifiant SUMO ne peut pas contenir `>` : un flux se nomme `NE2-NO2`, pas `NE2>NO2`.

- Si `sumo` sort avec le code 248 et que `fcd-*.csv` est vide → `--step-log.period 0` fait planter
  SUMO 1.27.1 à la fermeture, avant l'écriture des sorties → `--no-step-log`.
- Si la ville reste bloquée toute la journée (milliers de voitures à l'arrêt l'après-midi) → les
  itinéraires ont été calculés sur la ville vide → itinéraire choisi au départ
  (`device.rerouting.probability 1`, `period 0`), décision S11.
- Si la journée s'arrête sur « Too many teleports » vers 17 h - 18 h, avec surtout des
  « wrong lane » → des retours sans itinéraire possible (journal : « No route for vehicle »),
  insérés quand même à cause de `ignore-route-errors` → `deplacements.py` vérifie chaque
  trajet ; pour diagnostiquer, rejouer depuis `sorties/etat-soir.xml.gz` avec
  `--no-warnings false` et compter les téléportations par voie et par véhicule.
- Si l'avancement de `sumo` n'apparaît pas dans le log → la sortie est mise en tampon quand elle
  va dans un fichier → lire l'heure simulée dans `sorties/summary.xml`, écrit au fil de l'eau.
- Si un fichier additionnel écrit dans `sorties/sorties/…` → ses chemins sont relatifs à son
  propre dossier → le placer à la racine de `ville/`.
- Si un essai lancé depuis l'app reste « en cours » après un redémarrage de la machine → le lanceur
  a été tué → l'API le signale en erreur (« Lanceur arrêté… ») ; relancer l'essai.
- Si `options_sumo.py` échoue sur « not well-formed » → les aides de SUMO contiennent `--`, interdit
  dans un commentaire XML → le modèle se lit ligne par ligne, pas avec un parseur XML.
- Une fin normale a aussi une « Reason » dans le journal de SUMO (« The final simulation step has
  been reached ») : seule une autre raison est un arrêt anticipé.
## Références

- [Enquête mobilité 2018, premiers résultats (AUDAB, décembre 2019)](https://www.audab.org/files/missions/publi-emd-2019-final-bd.pdf) :
  660 400 déplacements par jour, 44 % en voiture conducteur (288 000), pointe du matin 7 h - 9 h.
- [Aménagement de la RN57 entre les Boulevards et Beure (DREAL, avril 2021)](https://www.grandbesancon.fr/wp-content/uploads/sites/2/2021/05/Presentation-du-projet-DREAl.pdf) :
  à la pointe du matin, la demande dépasse de 32 à 42 % la capacité des échangeurs.

## Rollback

- Supprimer le worktree par le manager (`remove_worktree`).
- Supprimer ses bases : `pnpm db:psql` puis
  `DROP DATABASE voirie_wt_sumo_poc; DROP DATABASE voirie_wt_sumo_poc_test;`.
- Désinstaller SUMO : `rm -rf ~/.local/share/sumo-venv`.
- Supprimer les prototypes : `rm -rf data/sumo/demo-carrefour data/sumo/ville .claude/launch.json`.

## Journal

- 2026-09-27 — création
- 2026-09-27 — SUMO installé (étape 1). Démo hors application dans `data/sumo/demo-carrefour/`
  (non versionné) : carrefour-jouet à 4 branches, plan « jour » du Glacis, `./lancer.sh` refait
  toute la chaîne et écrit une page de rejeu. Constats : un identifiant SUMO ne peut pas contenir
  `>` (d'où `NE2-NO2` à l'étape 8) ; `SaveTLSStates` écrit l'état du feu à chaque pas, pas
  seulement aux changements.
- 2026-09-27 — étape 14 réécrite : la ville entière simulée depuis le cache OSM et rejouée sur
  MapLibre (`data/sumo/ville/carte.html`) ; décisions S7 à S9 ; tableau « À quelle échelle »
  complété par les mesures ; pièges sur `file://`, `SaveTLSSwitchStates` et les files de la
  démonstration.
- 2026-09-27 — ville à la pointe du matin (décision S10, sources en Références) : 7 h 00 - 8 h 30,
  28 000 véhicules, rejeu 8 h 00 - 8 h 15 ; positions en CSV ; 12 threads (piège sur la lenteur,
  mesures du banc d'essai) ; étape 14 et tableau « À quelle échelle » mis à jour.
- 2026-09-27 — ajout « Réalisme de la ville : ce qu'on peut régler » (diagnostic de la pointe du
  matin, leviers classés, ordre conseillé) ; comptages à confirmer.
- 2026-10-09 — ajout « Analyser vite, sans tout configurer à la main » : chaîne ville → découpe
  → axe, leviers de vitesse chiffrés, données à fournir sur l'axe seulement.
- 2026-10-09 — journée aller-retour sans réacheminement (S11), `preparer.sh` / `simuler.sh`,
  rejeux matin et soir depuis un état sauvegardé, mode SUMO dans l'app (S12,
  worktree `sumo-trajets`) ; pièges sur le code 248, le blocage et le retour du soir.
- 2026-10-09 — mode SUMO (S12) : essais archivés par `essai.py`, mesures par tranche de 5 min,
  `charge_troncons.py` retiré ; voie de départ « best » pour l'aller et le retour.
- 2026-10-09 — lancement d'essais depuis l'app (S13) : catalogue des options SUMO, lanceur détaché,
  avancement en SSE ; pièges sur le redémarrage, le modèle de SUMO et la raison de fin.
- 2026-10-09 — retour du soir corrigé (trajets vérifiés), sorties du midi, flux ajoutés à la main
  (S14) ; hiérarchie des routes et pénalité aux feux dans le choix d'itinéraire.
