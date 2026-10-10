# Pipeline des données et éditeur des voies

> **Objectif** : dire qui fait quoi, quand, et comment savoir que c'est bon, de la donnée
> brute (OSM, photo IGN, IA, Ginko, terrain) jusqu'aux sorties (feux, onde verte, SUMO) ; puis
> rendre l'éditeur des voies capable de modéliser finement un carrefour.
> **Statut** : étapes 1 à 7 faites, 8 à 11 en cours (worktree `pipeline-donnees`, bâti sur `reseau-voies` + `main`)
> **Dernière mise à jour** : 2026-10-10

## Contexte

Sur `main`, trois couches ne se parlent pas :

- l'inventaire des feux (OSM → `feu`) ;
- les carrefours dessinés à la main (`branche` / `voie` / `connexion`, propositions OSM et IA
  en brouillon) ;
- SUMO, qui repart du cache OSM brut avec des feux inventés.

La branche `reseau-voies` ([reseau-d-abord.md](reseau-d-abord.md), [RESEAU.md](RESEAU.md))
corrige l'essentiel : un **réseau** `noeud` / `troncon` semé une fois depuis OSM, corrigé sur la
photo, dont chaque carrefour est un groupe de nœuds, et qui s'exporte vers SUMO. Ce chantier
part donc de `reseau-voies` (fusionné avec `main`), et :

1. fixe la chaîne de bout en bout, avec un responsable et un contrôle par niveau ;
2. ajoute les contrôles et un tableau de bord de maturité par carrefour ;
3. donne à l'éditeur des voies des outils réglables : créer une voie, un passage piéton, une
   ligne d'arrêt, dessiner l'emprise réelle d'une voie, supprimer, annuler ;
4. branche le programme des feux dans l'export SUMO.

Hors périmètre de ce chantier : la réconciliation OSM ([reseau-d-abord.md](reseau-d-abord.md)
étape 3), la réorientation de l'IA vers le graphe (étape 7), les relevés terrain, l'onde verte
(phase 1 bis).

## La chaîne, niveau par niveau

```text
 N0 SOURCES            N1 RÉSEAU DE RÉFÉRENCE      N2 CARREFOUR             N3 FONCTIONNEMENT        N4 SORTIES
 (jamais éditées)      (semé une fois, corrigé)    (groupe de nœuds)        (feux, temps)            (générées)
 ────────────────      ────────────────────────    ─────────────────        ─────────────────        ──────────
 OSM (Overpass) ──┐
                  ├─► noeud / troncon        ──►  nœuds + feux       ──►  lignes de feux     ──►  carte, chrono, temps réel
 photo IGN ───────┤   voies par sens, types       connexions saisies       conflits admis           onde verte (1 bis)
                  │   lignes d'arrêt, passages    vue : branche/voie/      programme, graphe        export SUMO (nod, edg,
 IA (Claude) ─────┤   liaisons aux nœuds          connexion (calculée)     tops de synchro          con, tll)
                  │   emprises de voies
 Ginko GTFS ──────┤                                                        priorité tram
 terrain ─────────┘                                                        (relevés : à venir)
```

**Règle** : les données ne descendent que vers la droite. Une sortie N4 ne s'édite jamais à la
main. Si SUMO ou la carte sont faux, on corrige N1, N2 ou N3, et on régénère.

| Niveau | Contenu | Qui le produit | Quand | Contrôle « c'est bon » |
|---|---|---|---|---|
| N0 Sources | `osm_*`, cache `data/osm/besancon.json`, orthophoto IGN, GTFS Ginko | scripts (`pnpm osm:import`), la nuit pour Ginko | à la demande ; Ginko chaque nuit | import sans erreur ; nombre de feux `present_osm=false` stable |
| N1 Réseau | `noeud`, `troncon` (voies, types, vitesses, emprises), liaisons aux nœuds | semis (`pnpm reseau:semer`, une fois), puis **toi** dans l'éditeur des voies | une fois, puis au fil des corrections ; réconciliation à chaque nouvel instantané OSM | constats réseau : cul-de-sac inattendu, nœud isolé, tronçon sans voie, emprise incohérente |
| N2 Carrefour | nœuds et feux du carrefour, connexions saisies ; vue `branche` / `voie` / `connexion` écrite par le serveur | **toi** (composition par les feux, outil Nœuds, outil Liaison) ; le serveur pour la vue | à la composition, puis à chaque correction du réseau autour | constats N2 : voie entrante sans connexion, voie sortante jamais atteinte, feu sans ligne, branche inattendue (R1…) |
| N3 Fonctionnement | lignes de feux, conflits admis, programme par étapes, graphe, tops | **toi**, aidé par le moteur (conflits, dégagements, graphe) | après N2 ; les tops sur place | constats N3 : mouvement non commandé, conflit non admis, programme ou graphe en erreur, statut `estime` → `mesure` → `verifie` |
| N4 Sorties | carte, chrono, temps réel ; export SUMO avec `tlLogic` | générées (API, `pnpm reseau:sumo`) | à la demande | export sans erreur ; chaque carrefour programmé a son `tlLogic` ; `netconvert` sans avertissement sur ses jonctions |

### Rôle de chaque source

| Source | Ce qu'elle apporte | Ce qu'elle n'apporte pas | Où elle entre |
|---|---|---|---|
| OSM | routes, voies (souvent fausses), sens, vitesses, feux, passages piétons, pistes cyclables | voies réelles en carrefour, plans de feux | N1, par le semis (une fois) puis la réconciliation |
| Photo IGN | marquage au sol : voies, flèches, lignes d'arrêt, passages, emprises | temps | N1, à la main dans l'éditeur ; par l'IA plus tard (reseau-d-abord étape 7) |
| IA (Claude) | lecture de la photo : voies, flèches, feux | certitude : chaque proposition se relit | aujourd'hui N2 des carrefours sans nœud seulement ; à réorienter vers N1 |
| Ginko GTFS (+ RT) | tracé du tram, horaires, passages réels | rien sur les feux | N3 (priorité tram), temps réel |
| Open data Grand Besançon | à évaluer (comptages, voirie) | plans de feux | N4 (demande SUMO), si des comptages existent |
| Terrain | durées, cycles, tops | — | N3 (`top_synchro` ; table `releve` sans API pour l'instant) |

### Tableau de bord de maturité

Pour chaque carrefour, une ligne : statut, et pour N2, N3 et N4 un état ✔ / ⚠ / ✖ avec ses
constats. C'est la réponse à « où en est ce carrefour, et que lui manque-t-il ». Les mêmes
constats s'affichent dans la carte d'en-tête du carrefour ouvert.

## Prérequis

- [x] Worktree `pipeline-donnees` bâti sur `reseau-voies`, `main` fusionné (migrations du réseau
      re-datées après `essais_ia`).
- [ ] Base du worktree préparée : `pnpm db:prepare`, puis réseau semé (`pnpm osm:import` et
      `pnpm reseau:semer`, ou copie de `voirie_wt_reseau_voies`).

## Étapes

### Étape 1 — Donner des réglages aux outils de l'éditeur des voies

Les réglages de l'outil actif s'affichent dans la carte d'en-tête, sous l'aide de l'outil
(mêmes composants que les popups : `Section`, `Compteur`, `Segments`). Ils s'appliquent à chaque
geste suivant.

| Outil | Geste | Réglages |
|---|---|---|
| ＋ Tracer (T) | points de la rue, puis arrivée | nom, voies par sens, type des voies, vitesse |
| ✂ Couper (X) | clic sur une rue | ce que porte le nœud posé : rien (début de présélection), ligne d'arrêt à feux, passage piéton (et son type) |
| ≡ Voie (L) | clic sur une rue, du côté voulu | ajouter ou retirer une voie ; type de la voie ajoutée ; position (au bord ou contre l'axe) |
| ▦ Passage (P) | clic sur une rue (pose un nœud) ou sur un nœud | type de passage : marqué, à feux, non marqué |
| ▱ Emprise (E) | clic sur une voie, puis les sommets ; Entrée ferme | — |

**Résultat attendu** : créer une rue à 2 voies par sens, une voie de bus, un passage à feux et
une ligne d'arrêt se fait sans ouvrir de popup.

### Étape 2 — Supprimer au clavier et annuler

- `Suppr` : supprime le tronçon sélectionné (ou le masque s'il vient d'OSM), retire le nœud
  sélectionné (s'il n'est qu'entre deux tronçons).
- `Ctrl Z` / `Ctrl Maj Z` : annule et refait les modifications du réseau de la session
  (voies, types, vitesse, nom, sens, tracé, nœud déplacé, feux, passage, carrefour, liaisons,
  coupe, tronçon tracé). Une suppression de tronçon ne s'annule pas : elle demande confirmation.

### Étape 3 — Dessiner l'emprise réelle d'une voie

Une voie garde son axe (déduit du tronçon, il sert aux liaisons et aux conflits). Elle peut
avoir en plus une **emprise** : un polygone posé sur le marquage de la photo, qui en donne la
surface réelle (largeur, évasement d'une présélection). Stockée par tronçon
(`troncon.emprises`, clé `avant:0`, `arriere:1`…), dessinée sous les voies, sa largeur moyenne
(aire ÷ longueur de l'axe) s'affiche dans la popup du tronçon et part dans l'export SUMO
(`<lane width>`).

> 💡 La clé d'une emprise suit le rang de la voie : ajouter ou retirer une voie avant elle la
> décale, comme les types de voies.

### Étape 4 — Écrire les contrôles par niveau dans le moteur

`controlerCarrefour` (`packages/engine/src/controles.ts`), fonction pure, appelée par l'API
(tableau de bord) et par le web (carte d'en-tête du carrefour) :

- N2 : voie entrante sans connexion ; voie sortante jamais atteinte ; branche interne (R1…)
  inattendue ; feu du carrefour sur aucune ligne ;
- N3 : mouvement non commandé ; référence de ligne invalide ; aucun programme ; programme ou
  graphe en erreur ;
- N4 : carrefour programmé sans nœud sur le réseau (pas exportable vers SUMO).

### Étape 5 — Ajouter le tableau de bord de maturité

`GET /api/carrefours/maturite` : par carrefour, statut, état de N2, N3, N4 et constats. Côté
web, dans la carte de suivi (mêmes composants), triable par niveau bloquant ; un clic ouvre le
carrefour.

### Étape 6 — Exporter le programme des feux vers SUMO

- Le **cœur** de chaque carrefour (ses nœuds au-delà des lignes d'arrêt) devient une jonction
  `c<carrefour>` ; les approches restent des arêtes, avec leurs présélections
  ([sumoCarrefours.ts](../packages/engine/src/sumoCarrefours.ts)).
- Ses connexions (saisies ou proposées) deviennent les liens de la jonction ; une branche
  interne (R1…) se traverse, sous la ligne de la première ligne d'arrêt.
- `versTlLogic` : le premier plan à cycle devient un `<tlLogic>`, une phase par période sans
  changement (`G`, `y`, `r`, `o` pour un lien sans ligne), dans `reseau.tll.xml` avec le
  `linkIndex` de chaque lien (décision S4 de poc-sumo.md révisée).
- Une voie dont l'emprise est dessinée prend sa largeur moyenne (`<lane width>`).

```bash
pnpm reseau:sumo --bbox=6.0265,47.2443,6.0300,47.2463
```

**Résultat attendu** : `data/sumo/reseau.tll.xml` contient un `<tlLogic id="c<carrefour>">` par
carrefour programmé et entièrement dans l'emprise.

> ❓ **À confirmer** : `netconvert` n'est pas installé sur le poste ; l'export est vérifié par
> les tests du moteur et à la main sur la base du worktree, pas encore par un `netconvert` réel
> (`netconvert -c reseau.netccfg`, puis `sumo-gui` avec « show link tls index »).

### Étape 7 — Garder les brouillons au rechargement

Les brouillons (connexions, lignes, programme) sont gardés dans le navigateur
(`localStorage`, clé `voirie.brouillons`) : un rechargement ne les perd plus, et la page ne
demande plus confirmation avant de se fermer. Ils restent propres à ce navigateur.

**Résultat attendu** : après un rechargement, la carte de suivi (en bas à droite) liste le
carrefour modifié, avec « Reprendre ».

### Étape 8 — Corriger le tracé d'un tronçon OSM ✅

Outil **◇ Forme (D)** : un clic sur une rue montre ses sommets. On glisse un sommet pour le
déplacer, on glisse le losange au milieu d'un segment pour créer un sommet, un clic droit sur un
sommet le retire. Les bouts restent sur leurs nœuds : pour les déplacer, on glisse le nœud
(Sélection). Chaque geste est enregistré aussitôt (`PATCH … { points }`) et s'annule
(`Ctrl Z`). Un tronçon OSM corrigé passe en « OSM corrigé ».

**Résultat attendu** : une rue OSM mal placée se recale sur la photo, sommet par sommet.

> 💡 Un clic sur un sommet le sélectionne (il grossit) ; `Suppr` ou `⌫` le retire ; `Échap`
> désélectionne, puis quitte le tronçon. Il faut viser une voie dessinée (zoom 16 et plus).

### Étape 9 — Régler les embranchements d'un nœud, à la TM:PE ✅

Outil **⑂ Embranchements (J)**, à la manière des « junction restrictions » de TM:PE : un clic
sur un nœud ouvre, pour chaque rue qui y arrive, la liste des rues où elle peut aller. Décocher
une rue retire toutes les liaisons de l'une vers l'autre ; cocher en ajoute, voie à voie, comme
le ferait la proposition par défaut (demi-tour compris s'il est coché). Le réglage voie à voie
reste possible avec l'outil Liaison (C).

Dans un carrefour ouvert, le même réglage se fait par branche : un clic sur le code d'une branche
(N, S…) ouvre « depuis N, on peut aller vers… », qui ajoute ou retire ses connexions (à
enregistrer).

**Résultat attendu** : « à ce nœud, la rue A peut aller vers B et C, pas vers D » se dit en
trois clics.

> 💡 Les cases restent actives au clavier : `Ctrl Z` annule depuis la popup. Sur un carrefour à
> branches internes (R1, R2…), « Depuis SO » ne mène souvent qu'à R3 : c'est le cas où fusionner
> les nœuds (étape 10) simplifie le réglage.

### Étape 10 — Fusionner les nœuds d'un carrefour en un seul ✅

OSM découpe un carrefour complexe en beaucoup de nœuds (chaussées séparées, îlots, passages).
Dans un carrefour ouvert, **Fusionner les nœuds** (carte d'en-tête) les réunit en un seul :

- au choix, **tous** les nœuds du carrefour, ou seulement **le cœur** (les nœuds d'approche,
  lignes d'arrêt et passages, restent) ;
- les tronçons entre deux nœuds fusionnés disparaissent (masqués s'ils viennent d'OSM) ; les
  autres sont raccordés au nœud restant, au barycentre ;
- le nœud restant porte une ligne d'arrêt si l'un des nœuds fusionnés en portait une ; ses
  liaisons repartent des propositions par défaut ;
- les codes des branches sont gardés, les connexions saisies du carrefour aussi tant que leurs
  voies existent.

`POST /api/reseau/noeuds/fusion { noeuds, position? }`. Ne s'annule pas : confirmation demandée.

**Résultat attendu** : un carrefour de 15 nœuds devient un nœud unique, dont on règle les
connexions et les lignes à la main.

> 💡 Le nœud gardé est un nœud OSM s'il y en a un (provenance). Les autres sortent du carrefour
> sans être effacés : ils portent encore les tronçons OSM masqués, gardés pour la réconciliation.
> Les tronçons raccordés passent en « OSM corrigé ». Le passage piéton d'un nœud fusionné
> disparaît : le redessiner en passage libre (étape 11).

### Étape 11 — Créer des passages piétons libres, reliés à des feux et des tronçons

Jusqu'ici, un passage piéton est une propriété d'un nœud, posé en travers de sa rue. Il devient
aussi un objet à part (`passage_pieton`) :

- **tracé librement** avec l'outil Passage (P), réglage « Libre » : deux clics, d'un trottoir à
  l'autre ; type marqué, à feux ou non marqué ;
- **relié à des tronçons** (ceux qu'il traverse, trouvés à la création, modifiables) et **à des
  feux** (feux piétons proches, à cocher dans sa popup) ;
- dans un carrefour, un passage libre qui traverse une rue d'une branche devient la traversée de
  cette branche (à la place du passage sur nœud) ; une ligne de feux piétonne qui traverse cette
  branche reçoit ses feux d'office.

Le passage sur nœud reste (semis OSM, outil Couper) ; les deux se dessinent pareil.

**Résultat attendu** : un passage décalé de l'intersection, en biais, se dessine tel qu'il est
sur la photo, et ses feux piétons sont ceux de sa ligne de feux.

### Étape 12 — Suites (hors de ce chantier)

- Réconciliation OSM relue (reseau-d-abord étape 3).
- IA réorientée vers le graphe (reseau-d-abord étape 7) : elle proposerait des corrections de
  N1 (voies, types, lignes d'arrêt, liaisons), relues comme une saisie.
- Relevés terrain : API et formulaire pour `releve`, un relevé validé faisant passer le
  carrefour en `mesure`.
- Open data : inventaire des jeux (comptages surtout), branchés seulement s'ils alimentent un
  niveau précis.

## Vérification finale

- [ ] Pour n'importe quel carrefour, le tableau de bord dit où il en est en N2, N3 et N4, et
      pourquoi.
- [ ] Une voie, un passage piéton, une ligne d'arrêt et une emprise se créent avec les outils,
      sans popup ; `Suppr` et `Ctrl Z` marchent.
- [ ] L'export SUMO d'un carrefour programmé contient son `tlLogic`.
- [ ] Un rechargement de la page garde les brouillons.
- [x] Tests lancés une fois à la fin (2026-10-10 : 264 tests unitaires, 70 e2e ; le test e2e de
      l'export SUMO mis à jour pour la jonction unique, deux tests e2e ajoutés).
- [x] `pnpm db:verifier voirie` : journal cohérent, 4 migrations en attente (réseau et emprises),
      toutes datées après `essais_ia`. À relancer après une nouvelle fusion de `main`.

## Pièges & précisions

- Si une migration du réseau ne s'applique pas sur une base qui a déjà `essais_ia` → elle est
  datée avant → à la fusion de `main`, les trois migrations du réseau ont été re-datées (`when`)
  **et renommées** `20261009200601_reseau`, `…602_graphe`, `…603_carrefour_boite_noire` :
  `drizzle-kit generate` part du dernier instantané par ordre de nom, qui doit être l'état complet.
- Si `drizzle-kit generate` recrée des tables qui existent déjà → le dernier instantané (par
  nom de fichier) n'est pas l'état cumulé → vérifier que `meta/20261009200603_snapshot.json`
  contient `essai_ia` et les tables du réseau.
- Si une emprise disparaît après la fusion de deux tronçons → les deux moitiés avaient une
  emprise sur la même voie → une seule est gardée (celle du premier tronçon) : la redessiner.
- Si des liaisons saisies partent sur une mauvaise voie après l'ajout ou le retrait d'une voie
  → les liaisons renvoient au rang de la voie → l'outil Voie décale les liaisons saisies des
  deux nœuds du tronçon.

## Décisions

- **Partir de `reseau-voies`**, pas de `main` : le réseau de référence est le N1 qui manquait ;
  repartir de `main` aurait fait un second éditeur en conflit avec lui.
- **Pas de table `suggestion`** : les propositions IA sont déjà gardées (`analyse_ia`,
  `essai_ia`), la détection OSM se recalcule ; l'IA doit d'abord être réorientée vers le réseau.
- **Emprise à côté de l'axe**, pas à sa place : l'axe déduit du tronçon reste la référence des
  liaisons et des conflits ; l'emprise décrit la surface réelle (affichage, largeur SUMO).
- **Réglages d'outil dans la carte d'en-tête** : on garde les panneaux et le design system
  existants, seule la logique change.

## Références

- [reseau-d-abord.md](reseau-d-abord.md), [RESEAU.md](RESEAU.md), [CONFIGURATION.md](CONFIGURATION.md),
  [poc-sumo.md](poc-sumo.md).
- Éditeur des voies : [modeReseau.ts](../apps/web/src/reseau/modeReseau.ts),
  [CoucheVoies.tsx](../apps/web/src/reseau/CoucheVoies.tsx),
  [EnTeteReseau.tsx](../apps/web/src/reseau/EnTeteReseau.tsx).

## Journal

- 2026-10-10 — création : niveaux N0 à N4, plan en 8 étapes, refonte de l'éditeur.
- 2026-10-10 — réécrit sur `reseau-voies` (réseau d'abord) ; emprise de voie ; pas de table
  `suggestion` ; panneaux existants gardés.
- 2026-10-10 — étapes 1 à 7 faites ; export SUMO par cœur de carrefour (sans `<join>`), S4 révisée.
- 2026-10-10 — ajout des étapes 8 à 11 : tracé des tronçons, embranchements à la TM:PE, fusion
  des nœuds d'un carrefour, passages piétons libres.
