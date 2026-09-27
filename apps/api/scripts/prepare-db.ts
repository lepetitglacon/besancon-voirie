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
 * Usage : node scripts/prepare-db.ts   (depuis apps/api, Node 24+)
 */
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
const urls = [env.DATABASE_URL, env.DATABASE_URL_TEST].filter((url): url is string => !!url);

for (const url of urls) {
  const base = decodeURIComponent(new URL(url).pathname.slice(1));

  const maintenance = new pg.Client({ connectionString: avecBase(url, 'postgres') });
  await maintenance.connect();
  try {
    const { rowCount } = await maintenance.query('SELECT 1 FROM pg_database WHERE datname = $1', [base]);
    if (!rowCount) {
      await maintenance.query(`CREATE DATABASE ${pg.escapeIdentifier(base)}`);
      console.log(`Base ${base} créée`);
    }
  } finally {
    await maintenance.end();
  }

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS postgis');
    await client.query('CREATE EXTENSION IF NOT EXISTS pgrouting');
  } finally {
    await client.end();
  }
  console.log(`Base ${base} prête (PostGIS + pgRouting)`);
}
