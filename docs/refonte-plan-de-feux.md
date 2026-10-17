# Refonte du module Plan de feux

> **Objectif** : sortir le plan de feux du tiroir du bas, lui donner sa place dans la barre d'outils,
> et l'adapter à ses deux usages : la conception au bureau et la correction devant le feu.
> **Statut** : brouillon
> **Dernière mise à jour** : 2026-10-17 (étapes 1 à 4 faites)
> **Worktree** : `refonte-plan-de-feux` (port 5427)

## Ce qui existe

- Le panneau `PanneauBas` « Plan de feux » de [ConfigurationCarrefour.tsx](../apps/web/src/configuration/ConfigurationCarrefour.tsx),
  posé en bas de l'écran par-dessus la carte. Il s'ouvre avec **Tab** ou l'outil `▭ Plan ⇥` de la barre d'outils.
- Trois onglets : **Lignes de feux** ([OngletLignes](../apps/web/src/configuration/OngletLignes.tsx)),
  **Programme** ([OngletProgramme](../apps/web/src/configuration/OngletProgramme.tsx), avec le
  [Chronogramme](../apps/web/src/configuration/Chronogramme.tsx)) et **Graphe et simulation**
  ([OngletGraphe](../apps/web/src/configuration/OngletGraphe.tsx)).
- La barre d'outils mêle la géométrie (Sélection, Voie, Liaison, Feu, Piéton, Nœud), l'import (OSM, IA, JSON)
  et le plan de feux.
- Le relevé terrain « chrono de feux » est décrit au [README §3.3](../README.md#33-relevé-terrain--lappli-chrono-de-feux).
  La table `releve` existe déjà (brut, synthèse, cycles observés, modération), mais aucun écran ni `POST /api/releves`.
- Les **tops** existent déjà : [SynchroPlan](../apps/web/src/configuration/SynchroPlan.tsx), sous le diagramme de
  l'onglet Programme (« Top : F1 passe au vert », table `top_synchro`), cale le cycle sur l'heure réelle.
  C'est la graine du mode Terrain.

Ce qui ne va pas :

- Le tiroir prend la moitié basse de l'écran : on ne voit plus la carte qu'on est en train de lire.
- Tab est un raccourci invisible, détourné de la navigation clavier.
- Un seul écran pour deux usages très différents (voir plus bas).

## Les deux utilisateurs

| | **Concepteur** (au bureau) | **Releveur** (devant le feu) |
|---|---|---|
| Appareil | PC, grand écran, souris et clavier | Téléphone, debout, une main, au soleil |
| Ce qu'il fait | Lignes de feux, étapes, durées, graphe, simulation | Tape les changements de couleur, note ce qui déclenche (bus, boucle, bouton piéton, tram) |
| Ce qu'il attend | Voir et éditer tout le programme, la carte à côté | Des gros boutons, rien d'autre ; marcher sans réseau |
| Ce qu'il produit | Un programme théorique (brouillon puis enregistré) | Un relevé daté, puis des corrections proposées au programme |

Les deux se rejoignent sur une vue : **le chronogramme théorique superposé au relevé**, d'où partent les corrections.

## Proposition

### 1. Une icône de feu dans la barre d'outils

- Nouveau composant DS `IconeFeu` : une tête de feu tricolore miniature (dérivée de [TeteDeFeu](../apps/web/src/ds/TeteDeFeu.tsx)),
  utilisable comme `glyphe` d'un `BarreOutils.Outil`.
- Elle remplace `▭ Plan ⇥` dans la barre et dans le menu contextuel ([actions.ts](../apps/web/src/configuration/actions.ts)).
  Libellé « Plan de feux ».
- Pendant la lecture du cycle, l'icône peut afficher la couleur courante de la ligne active (petit plus, pas indispensable).
- Ajout à la vitrine du design system.

### 2. Un conteneur à la place du tiroir

Le plan de feux devient un **mode** de la configuration, au même titre que l'édition de la géométrie
(le `BandeauMode` existe déjà) : on bascule de l'un à l'autre, la barre d'outils change avec.

- **Bureau** (≥ `lg`) : panneau latéral droit, pleine hauteur, pour l'édition (lignes, étapes, graphe) ;
  bande fine en bas avec le chronogramme et la tête de lecture, toujours visible ; la carte reste au centre
  avec les feux colorés selon l'instant lu.
- **Téléphone** : plein écran, la carte réduite à un bandeau ou masquée.

### 3. Mode Conception (bureau)

- Les trois onglets deviennent **trois étapes** guidées (Lignes → Programme → Graphe), avec leur état
  (non saisi, brouillon, enregistré, en erreur) : c'est l'ordre dans lequel on les remplit.
- Chronogramme **éditable** : tirer le bord d'une barre de vert change la durée de l'étape.
- Matrice des conflits et alertes dans le panneau latéral, à côté de ce qu'elles concernent.

### 4. Mode Terrain (téléphone)

L'appli « chrono de feux » du README, intégrée au module :

1. Choix du carrefour (géolocalisation, ou depuis la carte) et du plan horaire en cours (déduit de l'heure).
2. Un gros bouton par ligne de feux visible : un appui = changement de couleur, horodaté.
3. Boutons d'**événements** : bus (avec la ligne, pré-remplie par le temps réel des bus déjà dans l'appli),
   tram, voiture sur la boucle, appui sur le bouton piéton. Chacun horodaté.
4. Après quelques cycles : cycle mesuré (médiane, écart-type), verts mesurés, `t0`.
5. Stockage local tant qu'il n'y a pas de réseau, envoi ensuite.

### 5. Comparer et corriger

Vue commune aux deux modes, au bureau après coup ou sur place :

- Chronogramme théorique et relevé superposés, événements en marqueurs.
- Écarts détectés, avec une correction proposée pour chacun :
  durée d'étape différente → ajuster la durée ; étape absente sur certains cycles → la passer « sur appel »
  (ligne d'appel : boucle ou bouton) ; vert allongé à l'arrivée d'un bus → priorité bus dans le graphe.
- Accepter une correction l'écrit dans le **brouillon** du programme : rien n'est enregistré sans relecture.

## Découpage en étapes

Chaque étape se merge seule dans `main`.

- [x] **Étape 1 — Icône** : `IconeFeu` dans le DS et la vitrine, remplace `▭` dans la barre (libellé « Plan ») et le menu.
- [x] **Étape 2 — Conteneur** : contenu du `PanneauBas` sorti dans [PlanDeFeux](../apps/web/src/configuration/PlanDeFeux.tsx).
  À partir de `xl` (1 280 px), panneau latéral droit (640 px au plus, 800 px laissés à la carte), onglets numérotés
  sous le titre ; en dessous, panneau du bas comme avant. Les onglets passent sur deux colonnes selon la largeur
  du panneau (requête de conteneur), plus selon celle de la fenêtre.
- [x] **Étape 3 — Mode Conception** :
  - onglets numérotés avec leur état (pastille : à faire, non enregistré, en erreur, enregistré) et bouton
    « Étape suivante » en bas de chaque onglet ;
  - chronogramme éditable : tirer le bord droit d'une étape change sa durée, à la seconde (`etirerEtape`) ;
  - panneau à droite : le diagramme (onglet Programme) ou la simulation (onglet Graphe) passe dans une bande
    sous la carte ([BandeChronogramme](../apps/web/src/configuration/BandeChronogramme.tsx)), barres et contrôles
    au-dessus d'elle. Panneau en bas : le diagramme reste dans l'onglet, éditable aussi.
- [x] **Étape 4 — Mode Terrain** : page `/terrain/:carrefourId` ([ReleveTerrain](../apps/web/src/terrain/ReleveTerrain.tsx)),
  sans la carte, ouverte par « Relever » (fiche temps réel) ou « Relevé terrain » (plan de feux) :
  - un gros bouton par ligne : chaque appui la passe au vert puis au rouge, avec le temps écoulé ;
  - événements : bus, tram, boucle, bouton piéton, comptés ;
  - mesuré ([releve.ts](../apps/web/src/terrain/releve.ts)) : cycle (médiane, écart-type, appuis oubliés écartés),
    vert médian par ligne, écarts de 2 s ou plus avec le plan en vigueur ;
  - les passages au vert partent au calage par l'API des tops existante, lot par lot, sans doublon ;
  - séance gardée dans le stockage du téléphone, écran maintenu allumé, vibration à l'appui.
  Côté API, seulement `GET /api/temps-reel/carrefours/:id` (le rejeu d'un carrefour, même sans plan).
  Les événements et les verts restent sur le téléphone : leur envoi (table `releve`) est l'étape 5.
- [ ] **Étape 5 — Relevés côté API** : table `releve` (+ événements), `POST /api/releves`, migration horodatée
  (penser au `pnpm db:verifier voirie` avant merge).
- [ ] **Étape 6 — Comparer et corriger** : superposition, détection des écarts, corrections vers le brouillon.

## Questions ouvertes

1. **« Faire des stops »** : ce sont les **tops** de `SynchroPlan`, étendus à chaque changement de couleur
   et aux événements (bus, boucle) ? Ou autre chose ?
2. **Choix du mode** : bascule explicite (Conception / Terrain), ou déduit de la taille d'écran ?
   Il n'y a pas de comptes : le mode ne peut pas venir d'un rôle.
3. **Tab** : on garde le raccourci (affiché dans l'infobulle) ou on le libère pour la navigation clavier ?
4. **Mode Terrain** : dans la configuration (il faut que le carrefour ait ses lignes), ou route publique
   à part (`/releve`) ouverte aux contributeurs, avec modération ?
5. **Boucles magnétiques** : on les modélise comme objets posés sur la voie (étape 1 de la configuration),
   ou seulement comme ligne d'appel dans le graphe, comme aujourd'hui ?
