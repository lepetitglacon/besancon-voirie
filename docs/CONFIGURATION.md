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
6. [Étape 4 — Graphe des étapes et simulation](#6-étape-4--graphe-des-étapes-et-simulation)
7. [Giratoires](#7-giratoires)
8. [Ce qu'OSM fournit déjà](#8-ce-quosm-fournit-déjà)
9. [Découpage en worktrees](#9-découpage-en-worktrees)

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
        │         ⇒ contrôle : jamais deux lignes en conflit au vert ensemble ; chronogramme
 5. Graphe        étapes sur appel, étapes prioritaires (tram), arcs conditionnels ; simulation
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

### Proposition OSM + IA

**✦ IA** (barre d'outils de la configuration, touche <kbd>I</kbd> ou menu contextuel) part de la détection OSM et la fait corriger par Claude d'après la photo aérienne
(`apps/api/src/branches/ia/`) :

0. **Zone de la photo** : avant la mise en file, la carte montre le cadre de la photo, le reste
   assombri. Par défaut, un carré centré sur le carrefour, de 100 à 180 m de côté d'après
   l'éloignement des feux (`GET /branches/detection-ia/cadre`) ; un glisser sur la carte dessine
   une autre zone (40 à 400 m de côté, contenant le centre du carrefour), envoyée avec la demande
   (`emprise` : [ouest, sud, est, nord]). <kbd>Entrée</kbd> lance, <kbd>Échap</kbd> annule.
1. **Photo** : orthophoto IGN de la zone, demandée au WMS de la Géoplateforme en Web Mercator,
   1024 px sur le plus grand côté (pixels carrés) : ~15 cm/pixel à 150 m, ~39 cm/pixel à 400 m.
   Nord en haut ; le passage lon/lat ↔ pixel est exact (`photo.ts`).
2. **Consigne** (`lecture.ts`) : la photo brute (rien n'est dessiné dessus), et en texte, en
   pixels de l'image : les feux OSM du carrefour, les voies OSM découpées au cadre avec leurs tags utiles
   (`lanes`, `turn:lanes`, `oneway`, bus, vélo, tram) et la proposition OSM au format attendu en
   réponse. Claude n'a qu'à la corriger d'après le marquage au sol.
3. **Claude Code sur le serveur** (`claude.ts`) : `claude -p` avec `--json-schema` (schéma zod
   `LectureIa`) et `--output-format json`, seul l'outil Read, dans un dossier temporaire, sans
   MCP, réglages utilisateur ni skills : ~5 k tokens de contexte au lieu de ~60 k.
4. **Retour** : les pixels sont reconvertis en lon/lat, les connexions vers des voies inconnues
   ou en double sont écartées (et signalées), puis la proposition est validée par
   `ConfigurationBranches`, comme un `PUT`. Elle arrive dans l'éditeur comme celle d'OSM ; la
   popup de chaque branche porte le badge « Lu sur la photo par l'IA », la confiance de l'IA et
   ses remarques, la carte d'en-tête ses remarques générales.

**File d'attente.** ✦ IA met le carrefour en file (`analyse_ia`) et rend la main tout de
suite : on peut en demander plusieurs et continuer à travailler. Un travailleur de l'API
(`FileIaService`) lance les analyses dans l'ordre, `IA_PARALLELE` à la fois (2 par défaut, 0 pour
n'en lancer aucune, comme dans les tests e2e). La file est en base : une analyse interrompue par
un redémarrage de l'API est remise en file et relancée. Un carrefour déjà en file n'y est pas
ajouté une seconde fois.

Dans l'application :
- une liste « ✦ Propositions IA » dans la carte de suivi, en bas à droite : en attente (avec la
  place dans la file), en cours (chrono), prête (« Ouvrir »), en échec (motif au survol) ; « × »
  annule une demande ou retire une ligne ;
- dans la carte d'en-tête du carrefour configuré : où en est son analyse, et « Charger » quand
  elle est prête ;
- à la fin de chaque analyse, une notification (en bas à gauche) « Proposition IA prête » avec un bouton
  « Ouvrir », plus une notification système si l'onglet est en arrière-plan (permission
  demandée au premier ajout) ;
- « Ouvrir » recentre la carte sur le carrefour, ouvre sa configuration et charge la proposition
  comme brouillon (confirmation si des modifications ne sont pas enregistrées). La proposition
  est alors marquée consultée : elle quitte la liste au bout d'une heure.

### Ouverture d'un carrefour et brouillons

Un clic sur un carrefour (son disque ou l'un de ses feux) ouvre directement sa configuration,
à la place de celle qui était ouverte, sauf pendant le tracé de la zone IA ou le choix des feux
d'une ligne. La carte d'en-tête résume le carrefour : nature, nombre de feux, statut de la
programmation, tram à proximité, avec « Feux » (ajouter ou retirer des feux) et « Supprimer ».

Les modifications non enregistrées (branches, lignes de feux, programme) sont gardées par
carrefour (`configuration/brouillons.ts`) : quitter la configuration ou passer à un autre
carrefour ne les perd pas. La carte de suivi, en bas à droite, liste les carrefours concernés :
« Reprendre » rouvre la configuration avec ses brouillons, « × » les abandonne. Ils vivent en
mémoire : le navigateur demande confirmation avant de fermer ou recharger la page.

Variables (`.env`) : `IA_CLAUDE_CMD` (commande, `claude` par défaut ; Claude Code doit être
installé et connecté sur le serveur), `IA_MODELE` (`opus` par défaut), `IA_PARALLELE` (2),
`IA_DELAI_S` (300), `IA_GARDER_FICHIERS=true` pour garder la photo dans `/tmp/voirie-ia-*`.

Premier essai, Edgar Faure × Maréchal Foch (chaussées séparées, 8 feux) : 52 s, 0,18 $ avec
Opus 5.5. 4 branches et 9 connexions, voies posées sur le marquage (3 entrantes sur Edgar Faure
de part et d'autre de l'îlot, sortie sud à 2 voies), branche nord-est notée « confiance basse »
car sous les arbres.

**⇪ JSON** (barre d'outils ou menu contextuel) charge dans l'éditeur un fichier `{ branches, connexions }` (le corps d'un
`PUT /branches`), validé par le même schéma.

### API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/carrefours/:id/branches` | Centre, branches (voies, passages piétons), connexions, mouvements, flèches, alertes |
| GET | `/api/carrefours/:id/branches/detection` | Proposition depuis OSM, **non enregistrée** |
| POST | `/api/carrefours/:id/branches/detection-ia` | Met le carrefour dans la file « OSM + IA » (`EditionGuard`), 202 avec l'analyse |
| GET | `/api/analyses-ia` | File : en attente, en cours, finies non consultées ou depuis moins d'une heure |
| GET | `/api/analyses-ia/:id` | Une analyse, avec sa proposition (`DetectionBranchesIa`, **non enregistrée**) une fois terminée |
| PUT | `/api/analyses-ia/:id/consultee` | Proposition chargée dans l'éditeur (`EditionGuard`) |
| DELETE | `/api/analyses-ia/:id` | Annule ou retire une analyse, sauf en cours (409) (`EditionGuard`) |
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

Sur la **photo aérienne** (fond de carte « Satellite »), l'éditeur dessine :
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

### Feux posés sur leur mât

OSM place en général un feu au milieu de la chaussée, au niveau de la ligne d'arrêt, pas sur
son mât. **⚑ Placer les feux** rend chaque feu du carrefour déplaçable : on le fait glisser
jusqu'à son mât sur la photo, et c'est enregistré au lâcher (`PUT /api/feux/:id/position`). La
position OSM reste connue (`feu.geom_osm`), dessinée par un point creux relié au feu en
pointillés ; un clic dessus remet le feu à sa position OSM. Un feu posé à la main
(`position_manuelle`) ne bouge plus aux imports suivants. Le centre du carrefour (centre de
ses feux) est recalculé ; les voies, elles, se calent à la main (mode « Ajuster »).

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
| Giratoire : une entrée s'insère devant la circulation de l'anneau | `insertion` (§7) |

Deux lignes sont en conflit si l'un de leurs mouvements l'est. Un conflit peut être **admis**
à la main : les deux lignes pourront être au vert ensemble. Exemples : tourne-à-droite avec
les piétons, tourne-à-gauche qui cède le passage au tout-droit d'en face. L'étape 3
refuse toute étape qui met au vert deux lignes en conflit non admis.

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

### Modèle

Un carrefour a un ou plusieurs **plans de feux** (table `plan_feux`), chacun actif sur des
plages horaires (jours + heures ; « de 00:00 à 00:00 » = toute la journée) : cycle par étapes
le jour, jaune clignotant ou éteint la nuit. Un plan à cycle se saisit comme les feux
temporisés de TM:PE :

```yaml
code: jour
plages: [{ jours: [lun, mar, mer, jeu, ven], de: '06:30', a: '20:30' }]
jaune_s: 3
etapes:
  - { lignes: [F1, P2], duree_s: 25 }   # durée où toutes ces lignes sont au vert
  - { lignes: [F2], duree_s: 15 }
degagements: { F1>F2: 4 }              # saisie manuelle, remplace le calcul
```

Le moteur (`@voirie/engine`, `programme.ts`) en déduit le cycle et le **diagramme de feux**
(intervalles de vert et de jaune par ligne), enregistré dans `plan_feux.lignes` pour la
suite (onde verte, SUMO). Le temps 0 est le début de la première étape.

### Transitions

Entre deux étapes :

- les lignes qui s'arrêtent passent au **jaune** (3 s en agglomération, 0 pour les piétons)
  puis au rouge ;
- chaque ligne qui démarre attend, pour **chaque ligne en conflit** qui s'arrête, la fin de
  son jaune puis le **rouge de dégagement** du couple ; sans conflit, elle démarre aussitôt
  (démarrage anticipé) ;
- une ligne présente dans les deux étapes reste au vert ;
- la transition dure jusqu'au démarrage de la dernière ligne ; son couple le plus exigeant
  est affiché (« F2 attend P1 : dégagement 8 s »).

### Rouges de dégagement (`degagement.ts`)

Calculés pour chaque couple ordonné de lignes en conflit non admis, sur les trajectoires de
l'étape 1 :

```text
rouge = (d_sortant + 6 m) / v_sortant − d_entrant / v_entrant      arrondi à la seconde supérieure
```

- `d_sortant` : trajet, depuis la ligne d'arrêt, du dernier usager qui dégage jusqu'au point
  de conflit (croisement des courbes, bout de la voie de sortie commune, ou passage piéton) ;
  il a franchi sa ligne d'arrêt au plus tard à la fin du jaune. Les 6 m sont la longueur du
  véhicule (0 pour un piéton).
- `d_entrant` : trajet du premier usager de la ligne suivante jusqu'au même point.
- Vitesses : 10 m/s pour les véhicules et les vélos, 1 m/s pour les piétons. Un piéton qui
  dégage part du trottoir le plus éloigné du point de conflit ; un piéton qui arrive, du plus
  proche.
- On garde le pire des points de conflit ; valeur par défaut 2 s si la géométrie ne donne
  aucun point. Toute valeur peut être remplacée à la main, plan par plan.

### Contrôles

| Niveau | Contrôle |
|---|---|
| erreur (refus d'enregistrement) | deux lignes en conflit non admis dans la même étape ; ligne inconnue ; cycle > 300 s |
| avertissement | étape plus courte que le vert minimal (6 s) ; ligne jamais au vert ; vert d'une ligne < 6 s ; vert piéton plus court que la traversée à 1 m/s ; cycle > 120 s |

### Diagramme → étapes

Pour un plan saisi comme diagramme de feux (relevé terrain au chronomètre), le moteur
reconstruit les étapes (`etapesDepuisDiagramme`) : le cycle est découpé aux instants de
changement ; une période sans aucun vert, ou plus courte que 6 s et dont les verts se
retrouvent tous dans la période suivante (démarrages anticipés), est une transition ; les
autres périodes sont les étapes. L'API renvoie alors `etapes_deduites: true`.

### API

| Méthode | Route | Effet |
|---|---|---|
| GET | `/api/carrefours/:id/programme` | Plans (étapes saisies ou reconstruites, cycle), rouges de dégagement calculés, plans devenus incohérents |
| PUT | `/api/carrefours/:id/programme` | Remplace les plans (étapes, arcs du graphe) ; calcule et enregistre cycle et diagramme ; refuse un plan en erreur, y compris dans son graphe (`EditionGuard`). Un plan conservé garde sa référence de synchronisation (`reference`) |

### Interface (onglet « 3. Programme »)

- Un bouton par plan, « + Plan » (étapes proposées d'emblée) ; nom, mode, plages horaires
  (jours L M M J V S D, heures).
- **Diagramme de feux** du plan : une rangée par ligne (vert, jaune, rouge), étapes et
  transitions au-dessus. Cliquer ou glisser place le curseur ; « Lecture » ×1, ×4, ×10 fait
  défiler le cycle.
- **Sur la carte**, chaque trajectoire et chaque passage piéton prend la couleur de son feu à
  l'instant du curseur (vert, jaune, rouge ; gris pointillé si aucune ligne ne le commande).
- **Étapes** : durée, ordre (↑ ↓), puces des lignes à mettre au vert ; une ligne en conflit
  avec une ligne déjà dans l'étape est barrée et désactivée (« F2 est en conflit avec F1 »).
  Entre deux étapes, la durée de la transition et le couple qui la fixe. « Proposer des
  étapes » : chaque étape part de la première ligne non servie et reçoit toutes les lignes
  compatibles (celles de l'étape précédente restent au vert si possible).
- **Rouges de dégagement** (repliable) : valeur calculée et distances, champ de saisie
  manuelle.
- Le programme s'appuie sur les lignes **enregistrées** (comme les lignes sur les branches
  enregistrées).

## 6. Étape 4 — Graphe des étapes et simulation

**Diagramme de feux** (chronogramme) : une ligne par ligne de feux, sur un cycle. C'est la
forme enregistrée (`plan_feux.lignes`), affichée dès l'étape 3 ; reste à la comparer aux
relevés terrain quand le chrono existera.

**Graphe des étapes** : nœuds = étapes, arcs = enchaînements possibles et leurs conditions.
Indispensable pour les feux à la demande (bouton piéton, boucle de détection) et la
**priorité tram** (48 carrefours à moins de 25 m d'une voie de tram), qu'un chronogramme seul
ne décrit pas.

```text
        ┌──────────── É1 : axe 34 s ◄──────────────┐
        │  si T1 (écourte)     │                    │
        ▼                      ▼                    │
 [É-tram T1 12 s]      [É2 : piétons, sur appel P1] │ sans P1 : É2 sautée
        │ reprise après        │                    │
        │ l'étape interrompue  ▼                    │
        └──────────────► É3 : transversale 20 s ────┘
```

### Modèle (en plus de l'étape 3)

- Une étape peut être **sur appel** d'une de ses lignes (`appel: "P1"`) : elle n'est servie
  que si cette ligne est demandée, sinon on la saute.
- Une étape peut être **hors cycle** (`hors_cycle: true`) : absente du cycle de base, elle
  n'est atteinte que par un arc (étape tram).
- **Arcs saisis** (`plan_feux.arcs`) : `{ de, vers, demande, anticipe }`. Depuis l'étape
  `de`, aller à `vers` si la ligne `demande` est demandée ; `anticipe` écourte l'étape `de`
  dès son vert minimal (6 s). Un arc sans demande remplace la suite du cycle.
- À la fin d'une étape : premier arc saisi dont la demande est présente, sinon arc saisi sans
  condition, sinon prochaine étape servie du cycle de base — après une étape hors cycle, celle
  qui suit **l'étape interrompue**.
- Une demande reste présente jusqu'à ce que sa ligne passe au vert.
- Les transitions entre deux étapes quelconques se calculent comme à l'étape 3 (jaune, rouges
  de dégagement, démarrages anticipés).
- Le cycle de base enregistré (`cycle_s`, `lignes`) ignore les étapes hors cycle et compte les
  étapes sur appel comme toujours demandées (cycle le plus long).

### Contrôles du graphe (`validerGraphe`)

| Niveau | Contrôle |
|---|---|
| erreur | étape 1 hors cycle ; toutes les étapes du cycle sur appel ; ligne d'appel inconnue ou pas au vert dans l'étape ; arc vers une étape inexistante ou vers elle-même ; ligne demandée inconnue, ou pas au vert dans l'étape d'arrivée (sa demande ne serait jamais servie) ; arc sans demande qui écourte |
| avertissement | étape hors cycle jamais atteinte ; plusieurs arcs sans condition depuis une étape ; appel sur une étape hors cycle |

### Simulation (`simulerGraphe`)

Déroule le graphe sur une durée donnée, à partir du début de l'étape 1, avec un scénario de
demandes `{ ligne, t }` (appui piéton, détection, tram). Sortie : étapes et transitions
parcourues, diagramme de feux sur la durée, journal (« É2 sautée : pas d'appel P1 »,
« Demande T1 : É1 écourtée à 8 s »), **attente de chaque demande** jusqu'au vert de sa ligne.
C'est l'outil pour comparer des variantes de graphe sur un même scénario, en attendant SUMO.

### Interface (onglet « 4. Graphe »)

- Même plans que l'onglet 3, même brouillon, même bouton d'enregistrement.
- **Graphe** : cycle de base sur un cercle, étapes hors cycle au centre ; arcs de suite (gris),
  sauts d'étape sur appel (bleu pointillé), arcs sur demande (orange), durée de transition sur
  chaque arc ; l'étape et l'arc en cours de simulation sont en vert.
- **Étapes** : « toujours servie » ou « sur appel » d'une de ses lignes, case « hors cycle ».
  « Ajouter une étape prioritaire » : étape hors cycle pour une ligne (tram, bus), atteinte
  depuis chaque étape qui ne la sert pas déjà, en écourtant l'étape en cours.
- **Arcs ajoutés** : départ, arrivée, condition, « écourte ».
- **Simulation** : demandes (ligne, instant), durée ; chronogramme avec les demandes marquées,
  curseur et lecture qui pilotent les feux sur la carte, tableau des attentes, journal
  cliquable.

## 7. Giratoires

### À Besançon

Recensement du 27/09/2026 dans OSM : 147 giratoires (`junction=roundabout` ou `circular`),
dont **6 ont des feux véhicules** à moins de 25 m (17 feux sur 359). Ce sont surtout des
anneaux **coupés par un transport en site propre** : des feux posés sur l'anneau arrêtent la
circulation quand le tram ou le bus traverse l'îlot.

| Giratoire | Rayon | Feux (sur l'anneau / autour) | Traversé par |
|---|---|---|---|
| Mitterrand × Salvador Allende (Planoise) | 36 m, 3 voies | 4 / 4 | tram |
| Rue de Belfort × chemin du Fort Benoît | 17 m | 2 / 0 | tram |
| Avenue de Bourgogne × Salvador Allende | 20 m | 2 / 0 | tram |
| Léo Lagrange × Trépillot × Charles Weiss | 15 m | 2 / 0 | bus en site propre |
| Joachim du Bellay × René Char | 14 m | 0 / 2 | bus en site propre |
| Rue de Dole × Alexandre Ribot | 10 m | 0 / 1 | — |

Rayon : cercle de même aire que l'enveloppe du tracé OSM, qui suit le milieu de la chaussée.

### Modèle : des nœuds, comme dans TM:PE

Un giratoire est un carrefour de nature `giratoire` dont l'anneau est une **boucle de
nœuds** posés sur la photo, dans l'ordre de circulation (antihoraire vu du ciel). On ne
dessine pas de cercle : les nœuds suivent l'anneau réel, ovale ou déformé par un tram.

- **Nœud** : un mini-carrefour, là où une rue (ou le tram) touche l'anneau. Trois nœuds au
  moins ferment la boucle ; à partir de quatre, la courbe suit bien un anneau réel.
- **Tronçon d'anneau** : entre deux nœuds, une courbe lissée qui passe par les nœuds
  (Catmull-Rom centripète). C'est une **branche générée** : `R1` part du nœud 1. Ses voies
  (rang 0 côté îlot) sont sortantes au nœud de départ, entrantes au nœud d'arrivée ; on
  choisit leur nombre par tronçon. Elles se recalculent quand un nœud bouge.
- **Rue** : une branche ordinaire, raccordée à un nœud (`noeud`) ; ses voies proposées
  partent du nœud, ligne d'arrêt à une demi-largeur d'anneau plus 2 m. Le tram ou un bus en
  site propre qui traverse l'îlot n'est raccordé à aucun nœud.
- **Liaisons** : l'outil Liaison habituel, à chaque nœud : `R1:e0 → R2:s0` (on continue),
  `R1:e0 → O:s0` (on sort), `O:e0 → R2:s0` (on s'insère). Une liaison entre deux nœuds
  différents est refusée à l'enregistrement.
- **Priorité d'une entrée** : cédez-le-passage à l'anneau par défaut, stop, ou priorité à
  droite (anneau non prioritaire, type place de l'Étoile). C'est un attribut, pas une
  supposition. Une entrée à feux garde ce régime quand ses feux sont éteints ou au jaune
  clignotant.
- **Feu d'anneau** : une ligne de feux ordinaire, qui commande le mouvement « on continue »
  d'un nœud (`R1>R2`).

```sql
ALTER TYPE nature_carrefour ADD VALUE 'giratoire';
ALTER TABLE carrefour ADD COLUMN anneau jsonb;             -- { noeuds: [{ code, position }] }
CREATE TYPE priorite_entree AS ENUM ('cedez_le_passage', 'stop', 'priorite_a_droite');
ALTER TABLE branche   ADD COLUMN priorite_entree priorite_entree;  -- null = cédez-le-passage
ALTER TABLE branche   ADD COLUMN noeud text;               -- rue : son nœud ; tronçon : nœud de départ
ALTER TABLE branche   ADD COLUMN troncon boolean NOT NULL DEFAULT false;
```

C'est aussi le modèle d'OSM (l'anneau est une voie `junction=roundabout` que chaque rue
touche en un nœud) et de SUMO (une jonction par raccord) : la phase 2 s'y branche sans
traduction.

### Sens des mouvements

À un nœud, le sens d'un mouvement se lit sur les voies elles-mêmes, pas sur l'azimut des
branches depuis le centre : les voies d'anneau prennent la tangente de l'anneau au nœud.
Continuer sur l'anneau est un tout-droit, on y entre et on en sort à droite.

### Conflits

Les liaisons étant propres à chaque nœud, le calcul ordinaire des conflits suffit (§4). Deux
liaisons qui aboutissent à la même voie d'anneau sont une **insertion** : c'est le conflit
entre un feu d'anneau et l'entrée qu'il protège, au même nœud. Le tram qui traverse l'îlot
coupe la liaison « on continue » du nœud posé à son passage : `croisement`.

Les mouvements sans feux ne sont signalés que pour les origines (rue ou tronçon) dont un
autre mouvement a des feux : une entrée sans feux cède le passage, l'anneau sans feu
d'anneau circule librement.

### Éditeur

- Outil **Nœud** (<kbd>N</kbd>, giratoires seulement) : un clic sur la carte pose un nœud,
  inséré dans la boucle là où il l'allonge le moins (le tronçon coupé en deux garde ses
  liaisons, le nouveau nœud reçoit les liaisons par défaut) ; glisser un nœud le cale ;
  cliquer ouvre ses réglages.
- **Popup d'un nœud** : rues raccordées (cocher pour raccorder), voies du tronçon qui en
  part, « Proposer les liaisons » (continuer, sortir, s'insérer), suppression (le tronçon
  qui arrivait va jusqu'au nœud suivant).
- **Popup d'une rue** : son nœud de raccordement et la priorité de son entrée.
- Carte d'en-tête : nombre de nœuds et de rues raccordées ; retirer l'anneau.

### Détection OSM

Pour un carrefour de nature `giratoire`, `GET /branches/detection` :

1. prend l'anneau OSM le plus proche (60 m au plus) : voies `junction=roundabout` reliées en
   une boucle, dans le sens de leur tracé (celui de la circulation) ;
2. pose un nœud là où chaque rue et le tram touchent l'anneau (deux raccords à moins de 6 m
   n'en font qu'un), puis en ajoute à mi-chemin des plus grands écarts jusqu'à quatre ;
3. cherche les rues sur un cercle 15 m au-delà de l'anneau, sans compter l'anneau
   lui-même, et raccorde chacune au nœud de sa voie OSM (sinon au plus proche) ;
4. génère les tronçons (voies = `lanes` de l'anneau) et propose les liaisons de chaque nœud.

Le tram n'est pas détecté comme branche (comme pour les carrefours ordinaires) : ses voies
s'ajoutent à la main, en type `tram`, sans nœud. La proposition OSM + IA reçoit les nœuds :
l'IA corrige les rues, les tronçons et les liaisons aux nœuds se reprennent de la
proposition OSM.

### Ce qu'on ne reprend pas de TM:PE

La configuration rapide des ronds-points de TM:PE contient des réglages faits pour l'IA du
jeu, pas des règles françaises :

- **entrer dans un carrefour encombré** : interdit en vrai (ne pas s'engager si l'on risque
  d'y rester bloqué) ;
- **pas de changement de voie sur l'anneau** : ce n'est pas une règle ; on se rabat avant de
  sortir ;
- **suppression des passages piétons** : en France, ils sont reculés d'environ 5 m de
  l'anneau, pas supprimés ;
- **flèches automatiques aux entrées** (voie de droite pour la première sortie) : rares ici ;
  les liaisons restent une proposition à corriger, nœud par nœud.

## 8. Ce qu'OSM fournit déjà

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

## 9. Découpage en worktrees

| Worktree | Contenu |
|---|---|
| `config-branches` | Étape 1, première version : branches et flèches par voie (remplacée par `config-lignes`) |
| `config-lignes` | Étape 1 refondue (voies sur la photo, connexions, passages piétons) et étape 2 : lignes de feux, feux physiques, conflits géométriques |
| `config-programme` | Étape 3 : plans et plages horaires, éditeur d'étapes, jaune et rouges de dégagement calculés, diagramme de feux et lecture du cycle sur la carte |
| `config-graphes` | Étape 4 : graphe des étapes (étapes sur appel, priorité tram, arcs conditionnels) et simulation d'un scénario de demandes |
| `config-recalage` | Feux posés sur leur mât sur la photo, position OSM conservée |
| `config-ia` | Proposition « OSM + IA » : orthophoto IGN lue par Claude Code sur le serveur, import d'un JSON de branches |
| `giratoires` | Giratoires (§7), première version : anneau circulaire (remplacée par `giratoires-noeuds`) |
| `giratoires-noeuds` | Giratoires (§7) par nœuds, comme dans TM:PE : nœuds posés sur la photo ou détectés dans OSM, tronçons d'anneau, liaisons à chaque nœud, feux d'anneau en lignes ordinaires |
