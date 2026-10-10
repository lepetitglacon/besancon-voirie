/**
 * Prépare les bases PostgreSQL du checkout courant : crée la base de développement et la
 * base de test si elles manquent, puis les extensions PostGIS et pgRouting.
 *
 * Dans un worktree du Nevven Worktree Manager (VOIRIE_WORKTREE_SANDBOX défini, ce qui
 * n'arrive jamais sur la branche principale), chaque worktree reçoit ses propres bases
 * `voirie_wt_<worktree>` et `voirie_wt_<worktree>_test`. Leurs URL sont écrites dans le
 * .env du worktree, pour que l'API, drizzle-kit et les tests e2e lancés à la main
 * visent les mêmes bases.
 *
 * À sa création, la base de développement d'un worktree est une copie complète de celle de
 * main (`voirie` : schéma, données, journal des migrations), sur laquelle `drizzle-kit migrate`
 * applique ensuite les migrations de la branche. La base de test reste vide.
 * `VOIRIE_COPIE=0` (environnement ou .env) : base vide, schéma seul.
 *
 * Usage : node scripts/prepare-db.ts   (depuis apps/api, Node 24+)
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

const racine = fileURLToPath(new URL('../../../', import.meta.url));
const fichierEnv = `${racine}.env`;

if (!existsSync(fichierEnv)) {
  copyFileSync(`${racine}.env.example`, fichierEnv);
  console.log('.env créé depuis .env.example');
}

function nomDeBase(worktree: string): string {
  const nom = worktree
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `voirie_wt_${nom}`.slice(0, 50);
}

function remplacerVariable(contenu: string, cle: string, valeur: string): string {
  const ligne = `${cle}=${valeur}`;
  const motif = new RegExp(`^${cle}=.*$`, 'm');
  return motif.test(contenu) ? contenu.replace(motif, ligne) : `${contenu.trimEnd()}\n${ligne}\n`;
}

function avecBase(url: string, base: string): string {
  const u = new URL(url);
  u.pathname = `/${base}`;
  return u.toString();
}

/** Base de main, copiée dans chaque nouveau worktree. */
const BASE_MAIN = 'voirie';

/**
 * Migrations de la branche que `drizzle-kit migrate` ignorerait sur une copie de main : datées
 * avant la dernière migration appliquée sur main (cf. scripts/verifier-migrations.ts).
 */
async function migrationsIgnorees(urlMain: string): Promise<string[]> {
  const journal = fileURLToPath(new URL('../drizzle/meta/_journal.json', import.meta.url));
  const { entries } = JSON.parse(readFileSync(journal, 'utf8')) as { entries: { when: number; tag: string }[] };
  const client = new pg.Client({ connectionString: urlMain });
  await client.connect();
  try {
    const { rows } = await client.query<{ created_at: string }>(
      'SELECT created_at FROM drizzle.__drizzle_migrations',
    );
    const appliquees = new Set(rows.map((r) => Number(r.created_at)));
    const derniere = Math.max(0, ...appliquees);
    return entries.filter((e) => !appliquees.has(e.when) && e.when <= derniere).map((e) => e.tag);
  } finally {
    await client.end();
  }
}

/** Copie complète de la base de main dans une base vide, dans le conteneur partagé. */
function copierBaseMain(base: string): void {
  // Conteneur à nom de projet fixe (docker-compose.yml) : le même depuis tous les checkouts.
  execFileSync(
    'docker',
    [
      'compose', 'exec', '-T', 'db', 'sh', '-c',
      `pg_dump -U "$POSTGRES_USER" -Fc ${BASE_MAIN} | pg_restore -U "$POSTGRES_USER" -d "$1" --no-owner --exit-on-error`,
      'sh', base,
    ],
    { cwd: racine, stdio: 'inherit' },
  );
}

// 1. Worktree : bases dédiées, écrites dans le .env du worktree.
const worktree = process.env.VOIRIE_WORKTREE;
if (process.env.VOIRIE_WORKTREE_SANDBOX && worktree) {
  const env = parseEnv(readFileSync(fichierEnv, 'utf8'));
  if (!env.DATABASE_URL) throw new Error(`DATABASE_URL manquant dans ${fichierEnv}`);
  const base = nomDeBase(worktree);
  let contenu = readFileSync(fichierEnv, 'utf8');
  // Premier passage (le .env copié vise encore la base de main) : pas d'appels extérieurs
  // par défaut, main s'en charge. Réactivables ensuite à la main dans le .env du worktree.
  if (new URL(env.DATABASE_URL).pathname !== `/${base}`) {
    contenu = remplacerVariable(contenu, 'TRAM_COLLECTE', 'false');
    contenu = remplacerVariable(contenu, 'IA_PARALLELE', '0');
    console.log(`Worktree « ${worktree} » : TRAM_COLLECTE=false, IA_PARALLELE=0`);
  }
  contenu = remplacerVariable(contenu, 'DATABASE_URL', avecBase(env.DATABASE_URL, base));
  contenu = remplacerVariable(contenu, 'DATABASE_URL_TEST', avecBase(env.DATABASE_URL, `${base}_test`));
  writeFileSync(fichierEnv, contenu);
  console.log(`Worktree « ${worktree} » : bases ${base} et ${base}_test`);
}

// 2. Création des bases et des extensions.
const env = parseEnv(readFileSync(fichierEnv, 'utf8'));
const copie =
  !!(process.env.VOIRIE_WORKTREE_SANDBOX && worktree) && (process.env.VOIRIE_COPIE ?? env.VOIRIE_COPIE) !== '0';
const urls = [env.DATABASE_URL, env.DATABASE_URL_TEST].filter((url): url is string => !!url);

for (const url of urls) {
  const base = decodeURIComponent(new URL(url).pathname.slice(1));
  let copiee = false;

  const maintenance = new pg.Client({ connectionString: avecBase(url, 'postgres') });
  await maintenance.connect();
  try {
    const { rowCount } = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [base]);
    if (!rowCount) {
      if (copie && url === env.DATABASE_URL) {
        const ignorees = await migrationsIgnorees(avecBase(url, BASE_MAIN));
        if (ignorees.length > 0) {
          console.error(
            `Copie de ${BASE_MAIN} impossible : drizzle-kit migrate y ignorerait ${ignorees.join(', ')}, ` +
              `datée(s) avant la dernière migration de main. Fusionner main dans la branche et re-dater ` +
              `ces migrations (pnpm db:verifier ${BASE_MAIN}), ou relancer avec VOIRIE_COPIE=0 pour une base vide.`,
          );
          process.exit(1);
        }
        await maintenance.query(`CREATE DATABASE ${pg.escapeIdentifier(base)}`);
        console.log(`Base ${base} créée, copie de ${BASE_MAIN}…`);
        copierBaseMain(base);
        copiee = true;
      } else {
        await maintenance.query(`CREATE DATABASE ${pg.escapeIdentifier(base)}`);
        console.log(`Base ${base} créée`);
      }
    }
  } finally {
    await maintenance.end();
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgrouting');
    if (copiee) {
      // Analyses IA en cours sur main : le worktree les relancerait (et les facturerait).
      const { rowCount } = await client.query(
        "DELETE FROM analyse_ia WHERE statut IN ('en_attente', 'en_cours')",
      );
      console.log(`Base ${base} : copie de ${BASE_MAIN} terminée (${rowCount ?? 0} analyse(s) IA en cours retirée(s))`);
    }
  } finally {
    await client.end();
  }
  console.log(`Base ${base} prête (PostGIS + pgRouting)`);
}
