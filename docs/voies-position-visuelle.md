# Position visuelle des voies au carrefour

> **Objectif** : placer librement, voie par voie, l'endroit où chaque voie arrive à un nœud sur
> la photo, sans toucher au graphe ni à ce que reçoit SUMO.
> **Statut** : étapes 1 à 11 faites et essayées dans le navigateur (worktree `pipeline-donnees`), non commitées
> **Dernière mise à jour** : 2026-10-10

## Contexte

Aujourd'hui, une voie n'a pas de position à elle : `voiesTroncon`
([reseau.ts](../packages/engine/src/reseau.ts)) la calcule depuis l'axe du tronçon (côte à
côte, rang 0 contre l'axe, vélo 1,5 m, autres 3 m), puis la recule au nœud d'une valeur
automatique. Résultat sur la photo : une voie vélo qui longe le bord de la chaussée est dessinée
contre les voies générales, et toutes les voies s'arrêtent à la même distance du centre, alors
que leurs lignes d'arrêt réelles sont décalées.

Le principe retenu sépare deux choses :

| | Technique (graphe, SUMO) | Visuel (carte, éditeur) |
|---|---|---|
| Nœud | position du nœud, jonction SUMO | inchangé |
| Tronçon | tracé = forme de l'arête SUMO | inchangé |
| Voie | sens, rang, type, liaisons → `<lane>`, `<connection>` | **position de son bout au nœud : libre** |

Le réglage visuel est stocké **sur le nœud**, comme ses liaisons : c'est la configuration du
nœud, donc du carrefour qui le contient.

Hors périmètre : déplacer le nœud, retracer la rue, rebrancher une rue (le graphe) ; la surface
exacte d'une voie (l'outil Emprise existe déjà) ; la position des voies loin du carrefour.

## Prérequis

- [x] Base de départ : le commit `d0d0bf7` (état actuel du worktree). Le stash `stash@{0}`
  (étapes 12 à 26 de [pipeline-donnees.md](pipeline-donnees.md)) n'est pas réappliqué : ses
  points d'accroche et ses recul et décalage par rue modifient le tracé des tronçons, donc les
  arêtes SUMO. On le garde de côté pour y reprendre des morceaux (saisie signée dans `Compteur`).
- [x] Un carrefour de référence ouvert sur la photo : Avenue d'Helvétie × Avenue Édouard Droz ×
  Rue Victor Delavelle (voies vélo de SO2 et SE mal placées).

## Modèle

À un nœud, le bout de chaque voie qui y arrive ou en repart a une **position libre** : on
l'attrape et on le pose où l'on veut sur la photo. Le bloc de la voie près du carrefour (les
40 m qu'en montre la vue du carrefour, `LONGUEUR_AXE_M`) se déplace d'un bloc, sans se
déformer. Au-delà, la voie rejoint sa place normale dans la rue par une courte transition.
L'autre bout de la rue n'est pas affecté.

La position est enregistrée par rapport à la voie, pas en coordonnées absolues :

```ts
/** Clé : `<tronçon>:avant:<rang>` (sens du tracé) ou `<tronçon>:arriere:<rang>` (sens inverse). */
type PlacementsVoies = Record<string, { recul: number; decalage: number; decalage_loin?: number }>;
```

- `recul` (m) : le déplacement **le long de la voie**, par rapport au recul automatique (> 0 :
  la voie s'arrête plus tôt, < 0 : elle s'allonge) ; entre −30 et 60 m, la voie garde au moins
  1 m.
- `decalage` (m) : le déplacement **de côté**, positif à droite du sens de circulation ; entre
  −15 et 15 m. Le bloc de 40 m (`LONGUEUR_BLOC_PLACE_M`) glisse d'un tenant, puis la voie
  rejoint sa place sur 10 m (`TRANSITION_PLACEMENT_M`) ; une voie plus courte glisse en entier.
- `decalage_loin` (m) : décalage au bout éloigné du bloc ; absent, il vaut `decalage` (le bloc
  reste parallèle à la rue). Différent, le bloc **pivote** autour de son bout : le décalage varie
  de `decalage` à `decalage_loin` le long des 40 m, puis revient à 0 sur la transition.

Ces deux nombres décomposent un seul geste libre ; l'utilisateur ne les manipule pas à part.
Grâce à ce repère, si on corrige ensuite le tracé de la rue, la voie suit la rue au lieu de
rester accrochée à un point de la photo.

## Étapes

### Étape 1 — Stocker les placements sur le nœud

Colonne `noeud.placements_voies` (`jsonb`, null par défaut) dans
[schema.ts](../apps/api/src/db/schema.ts), à côté de `liaisons`. Type `PlacementsVoies` dans
`packages/schema/src/reseau.ts`, renvoyé dans les propriétés des nœuds de `GET /api/reseau`.

```bash
pnpm db:generate --name=placements_voies
```

**Résultat attendu** : une migration `AAAAMMJJHHMMSS_placements_voies.sql` avec une seule
`ALTER TABLE "noeud" ADD COLUMN "placements_voies" jsonb;`, datée après la dernière de `main`.

### Étape 2 — Écrire `placerBoutVoie` dans le moteur

Fonction pure dans [reseau.ts](../packages/engine/src/reseau.ts) : prend la polyligne d'une voie,
le bout concerné (début ou fin) et un placement, et rend la polyligne modifiée : les 40 m du
bout déplacés d'un bloc (`recul`, `decalage`), puis une transition jusqu'au reste de la voie.
`placementVers` fait l'inverse : il décompose un point lâché en recul et décalage.
`placerVoiesTroncon` ([editionVoies.ts](../packages/engine/src/editionVoies.ts)) applique aux
voies d'un tronçon les placements de ses deux nœuds.

**Résultat attendu** : `voiesTroncon` n'est pas modifié ; la nouvelle fonction s'applique après.

### Étape 3 — Appliquer les placements au dessin des rues

Dans `geometrieRues` ([voiesRues.ts](../apps/web/src/reseau/voiesRues.ts)), après
`voiesTroncon` : pour chaque voie, appliquer le placement du nœud de départ et celui du nœud
d'arrivée. `arrivees` et `departs` partent de la polyligne placée ; `bouts` liste chaque bout de voie avec
sa voie à la place automatique, pour l'outil Placer.

**Résultat attendu** : les bandes, les liaisons (courbes tirées de `arrivees` / `departs`) et
les poignées de l'outil Liaison suivent toutes seules.

### Étape 4 — Appliquer les placements à la vue du carrefour

Dans `vueCarrefour` ([vueCarrefour.ts](../packages/engine/src/vueCarrefour.ts)), chaque voie de
branche a deux géométries :

| Champ | Contenu | Lu par |
|---|---|---|
| `geom` | segment de 25 m, voie à sa place automatique | direction des mouvements, conflits (`geometrieDe`), traversée du tram |
| `trace` | 25 premiers mètres de la voie dessinée : suit la courbe de la rue et la place posée à la main | calque du carrefour (blocs, courbes de connexion, flèches), position d'un feu en temps réel |

`trace` est rangé dans la colonne `voie.trace` (migration `trace_voies`) ;
`materialiserCarrefour` ([carrefours.ts](../apps/api/src/reseau/carrefours.ts)) passe les
placements de chaque nœud. Un carrefour reçoit son `trace` au premier recalcul (toute
modification du réseau autour de lui) ; sans `trace`, le calque dessine `geom`.

**Résultat attendu** : un carrefour ouvert et le réseau autour montrent les mêmes bouts de voies ;
une rue courbe n'est plus coupée par un bloc droit.

> 💡 Placer ou faire pivoter un bloc ne change que `trace` : la direction des mouvements et les
> conflits restent ceux de la voie à sa place automatique.

### Étape 5 — Enregistrer les placements par l'API

`PATCH /api/reseau/noeuds/:id { placements_voies }` (`EditionGuard`), avec un objet complet (null
pour tout effacer). 400 pour une clé qui ne désigne pas une voie qui touche ce nœud. Le nœud est
recalculé dans son carrefour, comme pour ses liaisons.

**Résultat attendu** : une clé inconnue répond « Place d’une voie qui n’arrive pas à ce nœud ».

### Étape 6 — Garder les clés à jour quand le réseau change

Les clés contiennent tronçon et rang. Elles doivent suivre, comme les liaisons et les emprises
le font déjà dans `reseau.service.ts` :

| Changement | Effet sur les placements |
|---|---|
| ajouter / retirer une voie à un rang | rangs décalés ; placement de la voie retirée supprimé |
| moins de voies dans un sens (réglages de la rue) | places des voies disparues oubliées |
| inverser un tronçon | `avant` ↔ `arriere` aux deux nœuds ; rang et décalage, comptés dans le sens de circulation, ne changent pas |
| couper un tronçon | au nœud `vers`, la clé passe à la seconde moitié |
| retirer un nœud de passage | au nœud éloigné, la moitié retirée est remplacée par celle gardée (retournée si besoin) ; ses propres places disparaissent avec lui |
| fusionner des nœuds | le nœud gardé reçoit les places de tous, sauf celles des tronçons disparus |
| supprimer un tronçon | ses clés disparaissent des deux nœuds |

Fonctions du moteur : `decalerPlacements`, `inverserPlacements`, `renommerPlacements`,
`retirerPlacements` ; dans le service, `reecrirePlacements`.

### Étape 7 — Ajouter l'outil « Placer les voies » à l'éditeur

Outil **Placer** (`B`), dans la barre du carrefour ouvert comme dans l'éditeur des voies :

- une poignée au bout de chaque voie : dans un carrefour ouvert, aux nœuds du carrefour ; hors
  carrefour, à tous les nœuds. Creuse à la place automatique, pleine (cyan) une fois placée ;
- la glisser déplace librement la voie, avec un aperçu ; lâchée à moins de 30 cm de sa place
  automatique, elle y revient ;
- un clic la choisit (ses réglages s'affichent), un double-clic la remet à sa place automatique ;
- chaque geste part aussitôt à l'API et s'annule (`Ctrl Z`), comme les autres gestes du réseau ;
  un geste sur plusieurs bouts s'annule d'un seul `Ctrl Z`.

**Résultat attendu** : sur le carrefour de référence, la voie vélo de SO2 se pose sur la bande
verte de la photo d'un seul glisser, et ses liaisons partent de là.

### Étape 8 — Afficher les réglages numériques d'une voie

Bouts choisis avec l'outil : « Recul » et « Décalage » en mètres (pas de 0,25 m, saisie signée),
« Rotation » en degrés (pas de 0,5°, positive : le bout éloigné du bloc va à droite de la
circulation), avec un bouton « Auto » qui efface le placement. Avec plusieurs bouts choisis, les
valeurs affichées sont celles du premier, et une valeur saisie s'applique à tous ; changer le
décalage garde la rotation
([ReglagesPlacement.tsx](../apps/web/src/reseau/ReglagesPlacement.tsx)). Le choix est oublié en
ouvrant ou fermant un carrefour.

**Résultat attendu** : les valeurs suivent le glisser, et une saisie déplace la poignée.

### Étape 9 — Faire pivoter le bloc d'une voie

Pour chaque bout choisi, une **poignée de pivot** (anneau cyan, reliée au bout par un tireté) se
tient au bout éloigné de son bloc de 40 m (`pointPivot`). La glisser fait tourner le bloc autour de
son bout (`pivotVers` donne `decalage_loin`) ; un double-clic sur elle remet le bloc parallèle à
la rue. Glisser ensuite le bout déplace le bloc d'un tenant, rotation comprise.

**Résultat attendu** : une voie dont l'axe OSM n'a pas l'angle de la vraie route se cale sur la
photo sans coude. Essayé sur la branche E du carrefour de référence : −6,3°, le calque suit,
annulé ensuite.

### Étape 10 — Choisir et déplacer plusieurs bouts (Maj)

`Maj` + clic sur un bout l'ajoute aux bouts choisis, ou l'en retire. Glisser un bout choisi
emmène tous les bouts choisis, du même déplacement ; glisser la poignée de pivot de l'un fait
tourner tous les blocs d'autant. Un double-clic sur un bout choisi les remet tous à leur place
automatique. Les bouts peuvent être à des nœuds différents : un enregistrement par nœud, un seul
geste à annuler (`placerVoies` dans [modeReseau.ts](../apps/web/src/reseau/modeReseau.ts)).

**Résultat attendu** : les voies d'une même branche se calent ensemble. Essayé sur les deux voies
E : glissées puis tournées ensemble, annulées en deux `Ctrl Z`.

### Étape 11 — Vérifier que SUMO n'a pas bougé

Exporter le carrefour avant et après avoir placé ses voies, puis comparer les fichiers.
[sumo.ts](../packages/engine/src/sumo.ts) tire la forme des arêtes du tracé du tronçon
(`a.points`) et jamais de la géométrie des voies : la comparaison doit être vide.

```bash
diff avant/reseau.edg.xml apres/reseau.edg.xml
```

**Résultat attendu** : aucune différence, ni dans `reseau.nod.xml` ni dans `reseau.con.xml`.
Vérifié le 2026-10-10 sur l'emprise du carrefour de référence : nod, edg, con et tll identiques
avec et sans placement ; de nouveau après pivot et placements de plusieurs branches : `edg`,
`con` et `tll` identiques.

### Étape 12 — Documenter

[RESEAU.md](RESEAU.md) : le champ `placements_voies`, la route, la règle « visuel seulement »
dans le tableau de l'export SUMO.

## Vérification finale

- [x] Hors carrefour (pont de la République) : la voie vélo glissée suit, ses réglages
  s'affichent, `Ctrl Z` la remet.
- [x] Dans le carrefour de référence : la voie de la branche SO glissée, le bloc du calque et ses
  liaisons suivent ; « + » sur le décalage, puis « Auto ».
- [x] Les fichiers SUMO exportés sont identiques avant et après (étape 9).
- [x] Une clé inconnue est refusée (400).
- [ ] Caler toutes les voies du carrefour de référence sur la photo (à faire par toi).
- [ ] Ajouter une voie, inverser ou couper une rue placée, puis vérifier que les places suivent.

## Décisions

- **Visuel séparé du technique.** Le nœud et le tracé du tronçon restent la vérité du graphe et
  de SUMO ; le placement ne sert qu'au dessin.
  *Écarté* : bouger le bout du tronçon (points d'accroche, recul et décalage par rue du stash).
  Ces solutions changent les arêtes SUMO et agissent sur toute la rue, pas voie par voie.
- **Stocké sur le nœud**, comme les liaisons, et pas sur le tronçon : c'est un réglage du
  carrefour, et chaque bout d'une même voie a le sien.
- **Repère de la voie** (`recul`, `decalage`) plutôt que des coordonnées absolues : le placement
  survit à une correction du tracé.
  *Écarté* : un tracé libre par voie, sommet par sommet, plus lourd à saisir, et la voie ne suit
  plus la rue quand on la retrace.

## Pièges & précisions

- Si un placement saute sur la voie d'à côté après un ajout de voie → la clé contient le rang →
  renuméroter à l'étape 6, comme les liaisons.
- L'emprise d'une voie (outil Emprise) est un polygone posé sur la photo : le placement ne la
  déplace pas. Les deux sont indépendants.
- Si une voie fait un cran à un nœud de passage (ligne d'arrêt, passage piéton) → chaque bout a
  sa place à son nœud, celle de la rue d'à côté n'a pas bougé → placer aussi le bout de la voie
  qui continue, au même nœud.
- Si une voie placée garde un angle qui ne suit pas la route de la photo, avec un coude au bout
  du bloc → l'angle vient du tracé du tronçon (l'axe OSM) sur ses premiers mètres au nœud, pas du
  centre du carrefour. Le placement fait glisser le bloc de 40 m **parallèlement** à cet axe,
  puis le ramène sur l'axe en 10 m, d'où le coude. Dans le calque, chaque voie de branche est en
  plus un segment droit de 25 m, qui coupe une rue courbe. → faire pivoter le bloc (étape 9) ;
  le calque suit désormais la courbe de la rue (`trace`, étape 4). Si l'axe OSM est faux sur
  toute la rue, le corriger avec l'outil Forme (`D`), qui change aussi la forme de l'arête SUMO.
- Si `pnpm db:verifier` échoue sur la base du worktree avec « Migration appliquée … le
  2026-10-10 13:43:15 absente du journal » → c'est la migration `decalage_voies` du stash, appliquée
  avant le retour à `d0d0bf7` (colonne `troncon.decalage_voies`, 0,5 m sur un tronçon de l'avenue
  d'Helvétie) → sans effet sur le code, mais à retirer avant de vérifier : supprimer la colonne
  et la ligne de `drizzle.__drizzle_migrations`, ou repartir d'une base neuve (`pnpm db:prepare`).
  La base de `main` n'est pas touchée.

## Journal

- 2026-10-10 — création : modèle (recul, décalage par bout de voie, stocké sur le nœud), plan en
  10 étapes, deux points à confirmer (base de départ, longueur du décalage).
- 2026-10-10 — on repart de `d0d0bf7` sans le stash ; position libre : le bloc de 40 m du bout
  se déplace d'un bloc, plus de longueur à régler.
- 2026-10-10 — étapes 1 à 9 faites, sans tests (phase de développement) ; clés au format
  `<tronçon>:avant:0` ; l'inversion ne change pas le signe du décalage ; essai dans le navigateur ;
  deux pièges ajoutés (cran à un nœud de passage, migration orpheline du stash).
- 2026-10-10 — piège ajouté : angle du bloc placé (axe OSM au nœud, coude de la transition) ; pivot du bloc à confirmer.
- 2026-10-10 — étapes 9 et 10 : poignée de pivot (`decalage_loin`), choix de plusieurs bouts avec
  Maj ; le calque dessine `trace` (voie placée, qui suit la rue), `geom` reste technique ;
  migration `trace_voies`.
