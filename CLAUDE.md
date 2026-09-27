# Besançon Voirie — consignes du projet

Projet citoyen solo : inventaire des feux de Besançon, ondes vertes, puis simulation SUMO.
Présentation et feuille de route : `README.md` ; architecture : `docs/ARCHITECTURE.md` ;
configuration des carrefours : `docs/CONFIGURATION.md`.

## Commits

- Pas de préfixe de ticket JIRA sur ce projet.
- Messages en français, descriptifs, dans le style des commits existants (`git log --oneline`).

## Tests

- **Ne pas lancer les tests pendant le développement** (ni `pnpm test`, ni `test:e2e`, ni
  `vitest` en mode watch) : ils saturent la machine.
- Les lancer **une seule fois, à la fin**, quand le travail est terminé, avant de committer.

## Worktrees

Le projet est géré par le Nevven Worktree Manager (id `besancon-voirie`, target unique `app`).
Chaque worktree a ses propres bases `voirie_wt_<worktree>` et `voirie_wt_<worktree>_test`,
créées par `pnpm db:prepare`. La base de `main` est `voirie`.

## Migrations

- **Nommées par horodatage** : `pnpm db:generate` produit `AAAAMMJJHHMMSS_nom.sql`
  (`migrations.prefix: 'timestamp'` dans `apps/api/drizzle.config.ts`). Les migrations
  `0000` à `0011` gardent leur numéro.
- **Vérifier avant chaque merge dans main**, depuis la branche à merger, après y avoir
  fusionné main :

  ```bash
  pnpm db:verifier voirie
  ```

  Le script compare le journal de la branche à la base de main :
  - une migration **déjà appliquée** sur main doit figurer dans le journal ;
  - chaque migration **en attente** doit être datée après la dernière appliquée.
    `drizzle-kit migrate` ignore sans message une migration plus ancienne : il faut la
    re-dater (champ `when` du journal) avant de merger.

  Relancer ensuite `pnpm db:verifier` sans argument pour la base du worktree.
- Après un merge, `pnpm db:prepare` (ou `pnpm db:migrate`) sur main applique les nouvelles
  migrations ; `pnpm db:verifier` doit alors indiquer « 0 en attente ».
- drizzle-kit 0.31 ignore le SRID des colonnes `geometry` : corriger chaque migration générée
  en `geometry(Point, 4326)` / `geometry(LineString, 4326)`.
