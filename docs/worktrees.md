# Worktrees WTM : bases de données et merges sans casse

> **Objectif** : développer plusieurs branches en parallèle dans des worktrees du Nevven Worktree Manager, chacune avec sa base, et les merger dans `main` sans perdre ni sauter de migration.
> **Statut** : brouillon
> **Dernière mise à jour** : 2026-09-27

## Contexte

Un seul conteneur PostgreSQL (Compose `besancon-voirie`, port 5433) sert tous les checkouts.
`main` utilise la base `voirie` ; chaque worktree a ses bases `voirie_wt_<worktree>` et
`voirie_wt_<worktree>_test`, créées par [prepare-db.ts](../apps/api/scripts/prepare-db.ts).
Le schéma évolue par migrations Drizzle ([apps/api/drizzle](../apps/api/drizzle)), vérifiées
par [verifier-migrations.ts](../apps/api/scripts/verifier-migrations.ts).
Hors périmètre : déploiement sur le VPS.

## Les contraintes, en bref

| Contrainte | Conséquence |
|---|---|
| Conteneur partagé | `pnpm db:down` / `pnpm db:reset` coupent ou **effacent toutes les bases**, y compris `voirie`. Jamais depuis un worktree. |
| `.env` réécrit par `db:prepare` | Il doit être **copié** (`copyEnv`) dans le worktree, jamais symlinké : un lien ferait pointer `main` sur la base du worktree. |
| `drizzle-kit migrate` compare les dates | Il n'applique que les migrations dont le `when` (journal) est **postérieur à la dernière appliquée**. Une migration plus ancienne est ignorée **sans message**. |
| Chaîne de snapshots | Chaque `meta/<tag>_snapshot.json` décrit le schéma complet et pointe sur le précédent (`prevId`). Deux branches qui génèrent chacune une migration à partir du même parent produisent deux snapshots « frères » : le prochain `db:generate` se base sur le dernier du journal, qui ignore les changements de l'autre branche, et régénère ou supprime du DDL déjà existant. |
| Migration déjà appliquée = figée | Drizzle ne rejoue pas une migration modifiée après application (il ne regarde que `created_at`). Modifier ou re-dater une migration déjà appliquée sur la base du worktree impose de **recréer cette base**. |
| Base de worktree = copie de `voirie` | À sa création, la base du worktree reçoit tout `voirie` (schéma, données, journal des migrations), puis les migrations de la branche. Copie faite une seule fois : ensuite les deux bases vivent séparément, et les données saisies dans un worktree **ne partent pas au merge** (seul le code part). |
| SRID perdu par drizzle-kit 0.31 | Chaque migration générée doit être corrigée en `geometry(Point, 4326)` / `geometry(LineString, 4326)`, y compris après une régénération. |

## Prérequis

- [ ] Docker lancé, conteneur `besancon-voirie-db-1` démarré (`pnpm db:up`)
- [ ] Nevven Worktree Manager lancé (`npm start` dans `/home/esteban/PhpstormProjects/nevven-wtm`)
- [ ] Cache OSM présent dans le dépôt principal : `data/osm/besancon.json` (sinon `pnpm osm:import` une fois sur `main`)

## Étapes

### Étape 1 — Déclarer le projet dans le manager

Une seule target `app` pour tout le monorepo. Le port du slot va au web (`WEB_PORT`), l'API prend
ce port moins 2000. `VOIRIE_WORKTREE_SANDBOX` n'est pas injecté sur `main` (le manager omet les
variables qui dépendent de `{SANDBOX}`), donc `db:prepare` n'y réécrit jamais le `.env`.

Déclaré le 2026-09-27 (outil `create_project` du manager), worktrees rangés sous
`/home/esteban/worktrees/besancon-voirie`. Fichier `projects/besancon-voirie.json` :

```json
{
  "id": "besancon-voirie",
  "label": "Besançon Voirie",
  "repos": {
    "app": {
      "label": "API + web (pnpm)",
      "path": "/home/esteban/PhpstormProjects/besancon-voirie",
      "cmd": "pnpm install --frozen-lockfile && pnpm db:up && pnpm db:prepare && API_PORT=$((WEB_PORT-2000)) pnpm dev",
      "portEnv": "WEB_PORT",
      "portBase": 5400,
      "copyEnv": [".env"],
      "linkNodeModules": false,
      "readyRegex": "Local:|ready in",
      "urlTemplate": "http://localhost:{PORT}",
      "extraEnv": {
        "VOIRIE_WORKTREE": "{FEATURE}",
        "VOIRIE_WORKTREE_SANDBOX": "{SANDBOX}"
      }
    }
  }
}
```

Le manager est installé sous `/usr/lib/nevven-worktree-manager` ; ses projets sont dans
`~/.config/nevven-wtm/projects/`.

**Résultat attendu** : `list_projects` affiche `besancon-voirie` avec la target `app`.

> 💡 `linkNodeModules: false` : un `node_modules` lié pointerait les packages `@voirie/*` du
> workspace vers le dépôt principal. Le bouton « réinstaller » du manager lance `npm install` :
> ne pas l'utiliser ici, relancer le worktree (la commande fait `pnpm install`).

> 💡 Dans `cmd`, seul `WEB_PORT` existe dans l'environnement du shell (`portEnv`) : `$PORT`
> y est vide. Avec `$((PORT-2000))`, l'API recevait le port `-2000` et Vite plantait au premier
> appel `/api` (`ERR_INVALID_URL … localhost:-2000`).

> 💡 **Appels extérieurs coupés par défaut dans les worktrees.** Au premier `db:prepare` d'un
> worktree (son `.env` copié vise encore `voirie`), [prepare-db.ts](../apps/api/scripts/prepare-db.ts)
> écrit `TRAM_COLLECTE=false`, `BUS_COLLECTE=false` et `IA_PARALLELE=0` dans son `.env`. Pour un
> worktree qui travaille sur le tram, le bus ou l'IA, remettre `true` / `2` à la main dans ce `.env` : les passages
> suivants n'y touchent plus. Chaque API lancée appelle sinon d'elle-même :
>
> | Service | Déclencheur | Fréquence | Réglage |
> |---|---|---|---|
> | Ginko GTFS-RT (`api.ginko.voyage`, clé `GINKO_API_KEY`) | collecte tram et bus au démarrage | toutes les 10 s, en continu (une lecture pour les deux) | `TRAM_COLLECTE`, `BUS_COLLECTE` |
> | Ginko GTFS-RT | carte temps réel ouverte | au plus 1 fois / 10 s (cache) | — |
> | Ginko GTFS statique (`gtfs-ginko.zip`, public) | réseau tram ou bus demandé | 1 fois / 24 h (cache mémoire, partagé) | — |
> | `claude -p` (abonnement Claude, coût par analyse) | file IA : au démarrage, puis veille toutes les 30 s | selon les demandes en attente **en base** | `IA_PARALLELE` (0 = aucune) |
> | Orthophoto IGN WMS (`data.geopf.fr`, public) | chaque analyse IA | 1 image / analyse | — |
> | Overpass (OSM) | `pnpm osm:import` à la main (cache `data/osm`) | ponctuel | `--refresh` |
>
> Côté navigateur : tuiles OpenFreeMap et orthophotos IGN WMTS (fond de carte).
> Avec la collecte active dans N worktrees, Ginko reçoit N fois les appels et l'historique tram
> part dans N bases : seule celle de `voirie` sert à la calibration.

### Étape 2 — Créer un worktree

Par l'outil `create_worktree` du manager (branche partie de `main`). Avant `start`, copier le
cache OSM du dépôt principal : la version installée du manager ignore le bloc `seed` qui
devait le faire. Remplacer `mon-wt` par le nom du worktree :

```bash
mkdir -p ~/worktrees/besancon-voirie/mon-wt/app/data && cp -r ~/PhpstormProjects/besancon-voirie/data/osm ~/worktrees/besancon-voirie/mon-wt/app/data/
```

Puis `start` dans le manager.

**Résultat attendu** : dans les logs, `Worktree « <nom> » : TRAM_COLLECTE=false, IA_PARALLELE=0`,
`bases voirie_wt_<nom> et voirie_wt_<nom>_test`, `migrations applied successfully!`, puis
`Local:` de Vite et `Nest application successfully started`. Web sur `5400 + slot`, API sur
`3400 + slot` ; `curl http://localhost:<port web>/api/tram/historique/etat` renvoie
`"collecteActive":false`.

### Étape 3 — Données du worktree (automatique)

Rien à faire : au premier `start`, [prepare-db.ts](../apps/api/scripts/prepare-db.ts) crée
`voirie_wt_<nom>` en copiant `voirie` en entier (`pg_dump | pg_restore` dans le conteneur),
retire de la copie les analyses IA `en_attente` / `en_cours` de `main` (le worktree les
relancerait et les facturerait), puis `drizzle-kit migrate` applique les migrations de la branche.
La base de test `voirie_wt_<nom>_test` reste vide.

**Résultat attendu** : dans les logs, `copie de voirie terminée`, puis la carte du worktree
affiche les mêmes feux et carrefours que `main`.

- **Refus** : `Copie de voirie impossible : drizzle-kit migrate y ignorerait …`. La branche a des
  migrations datées avant la dernière de `main` : elles seraient sautées sur la copie. Fusionner
  `main` dans la branche et re-dater ses migrations (étape 5), puis relancer. Rien n'est créé
  tant que la copie est refusée.
- **Base vide voulue** (schéma seul) : `VOIRIE_COPIE=0` dans le `.env` du worktree avant le
  premier `start`, puis `pnpm osm:import` depuis le worktree pour les données OSM.
- **Recopier** plus tard les données de `main` : recréer la base (étape 7).

### Étape 4 — Écrire une migration dans le worktree

```bash
pnpm --filter api db:generate
```

Corriger le SRID dans le `.sql` généré, puis appliquer sur la base du worktree :

```bash
pnpm db:migrate
```

Une transformation de **données existantes** (renommage de valeurs, remplissage d'une colonne)
va dans le SQL de la migration (`UPDATE …`), jamais dans un clic sur la carte du worktree :
c'est le seul moyen qu'elle atteigne `voirie` au merge.

### Étape 5 — Fusionner `main` dans la branche avant le merge

Depuis le worktree :

```bash
git merge main
```

**Si `main` a reçu de nouvelles migrations depuis le départ de la branche** et que la branche en a
aussi, le journal et les snapshots sont désormais incohérents (cf. tableau). Régénérer la
migration de la branche :

1. supprimer les `.sql` et `meta/*_snapshot.json` de la branche, et leurs entrées dans
   [meta/_journal.json](../apps/api/drizzle/meta/_journal.json) ;
2. relancer `pnpm --filter api db:generate` : une seule migration, datée de maintenant, basée sur
   le snapshot de `main` ;
3. recorriger le SRID ;
4. recréer la base du worktree (étape 7) puis relancer le worktree : `db:prepare` recopie `voirie` (étape 3).

Si seule `main` a de nouvelles migrations (rien côté branche) : rien à régénérer, `pnpm db:migrate`.

### Étape 6 — Vérifier le journal face à la base de `main`

```bash
pnpm db:verifier voirie
```

**Résultat attendu** : `Journal cohérent avec la base.`, avec en attente uniquement les
migrations de la branche. Puis contre la base du worktree :

```bash
pnpm db:verifier
```

**Résultat attendu** : `0 en attente`.

### Étape 7 — Recréer la base du worktree (si besoin)

Nécessaire après une régénération ou la modification d'une migration déjà appliquée. Arrêter le
worktree dans le manager, puis :

```bash
docker compose exec db psql -U voirie -d postgres -c 'DROP DATABASE voirie_wt_mon_wt' -c 'DROP DATABASE voirie_wt_mon_wt_test'
```

Relancer le worktree : `db:prepare` recopie `voirie` dans la base de développement, recrée la
base de test, et applique les migrations de la branche.

### Étape 8 — Merger dans `main` puis migrer `voirie`

Merge par l'outil `merge_worktree` du manager (tests lancés une fois avant, cf. CLAUDE.md). Puis,
dans le dépôt principal :

```bash
pnpm db:prepare
```

**Résultat attendu** : `pnpm db:verifier` sur `main` indique `0 en attente`.

### Étape 9 — Supprimer le worktree et ses bases

Outil `remove_worktree` du manager, puis la commande de l'étape 7 (les bases ne sont pas
supprimées avec le worktree).

## Vérification finale

- [ ] `pnpm db:verifier` sur `main` : `0 en attente`, aucune erreur
- [ ] `ls apps/api/drizzle/*.sql` : aucun horodatage antérieur à une migration déjà présente avant le merge
- [ ] `\l` dans `pnpm db:psql` : pas de base `voirie_wt_*` orpheline

## Pièges & précisions

- Si `db:verifier voirie` dit « Migration appliquée sur voirie … absente du journal » → la base
  `voirie` a été migrée depuis une autre branche (ou depuis ce worktree avec un mauvais `.env`) →
  merger d'abord la branche qui l'a créée ; ne jamais lancer `db:migrate` d'un worktree contre `voirie`.
- Si « en attente mais datée avant la dernière migration appliquée » → une autre branche a été
  mergée entre-temps → étape 5 (régénération) ; re-dater le seul `when` ne suffit que si le
  snapshot n'a pas de frère.
- Si la base du worktree vise `voirie` (logs de `db:prepare` sans ligne « Worktree ») →
  `VOIRIE_WORKTREE_SANDBOX` absent → vérifier `extraEnv` du projet et que le `.env` est bien copié.
- Si deux worktrees modifient la même table → le conflit ne se voit qu'au merge de `schema.ts` ;
  merger `main` souvent dans les branches longues.
- Si une analyse IA reste « en attente » dans un worktree → `IA_PARALLELE=0` (réglage par
  défaut des worktrees) : la file n'a aucun travailleur → mettre `IA_PARALLELE=2` dans le `.env`
  du worktree puis le relancer ; les demandes en attente partent au démarrage.
- Si une analyse IA passe en `echec` avec « OAuth session expired » → le CLI `claude` de la
  machine n'est plus connecté (même erreur hors du manager) → se reconnecter dans un terminal
  (`claude`, puis `/login`) et relancer l'analyse depuis la carte.
- `pnpm db:psql` ouvre toujours `voirie` : `\c voirie_wt_mon_wt` pour changer de base.

## Journal

- 2026-09-27 — création
- 2026-09-27 — inventaire des appels extérieurs (étape 1), file IA copiée avec les données (étape 3)
- 2026-09-27 — copie automatique de `voirie` à la création de la base d'un worktree (étape 3)
- 2026-09-27 — projet créé dans le manager ; collecte tram et file IA coupées par défaut dans les worktrees
- 2026-09-27 — premier worktree `essai-wtm` testé : port de l'API corrigé (`WEB_PORT`), copie manuelle du cache OSM (`seed` non géré)
