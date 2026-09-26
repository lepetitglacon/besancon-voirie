/**
 * Vérifie le journal des migrations Drizzle face à une base, avant un merge.
 *
 * `drizzle-kit migrate` n'applique que les migrations plus récentes (`when` du journal) que la
 * dernière migration enregistrée en base : une migration d'une branche datée avant une
 * migration déjà appliquée sur main serait ignorée sans message. Le script signale :
 * - une migration appliquée en base mais absente du journal (base migrée depuis une autre
 *   branche : le journal à merger ne la contient pas) ;
 * - une migration en attente plus ancienne que la dernière appliquée (elle serait ignorée) ;
 * - un journal dont les dates ne croissent pas, ou une nouvelle migration sans horodatage.
 *
 * Usage (depuis apps/api, Node 24+) :
 *   node scripts/verifier-migrations.ts            # base DATABASE_URL du .env
 *   node scripts/verifier-migrations.ts voirie     # autre base du même serveur (ex. celle de main)
 *   node scripts/verifier-migrations.ts postgres://…
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';

interface Entree {
  idx: number;
  when: number;
  tag: string;
}

/** Dernière migration numérotée ; les suivantes sont préfixées par leur horodatage (drizzle.config.ts). */
const DERNIERE_NUMEROTEE = '0011_graphe_etapes';
const HORODATEE = /^\d{14}_/;

const racine = fileURLToPath(new URL('../../../', import.meta.url));
const dossier = fileURLToPath(new URL('../drizzle/', import.meta.url));
const env = existsSync(`${racine}.env`) ? parseEnv(readFileSync(`${racine}.env`, 'utf8')) : {};
const defaut = process.env.DATABASE_URL ?? env.DATABASE_URL;
if (!defaut) throw new Error('DATABASE_URL manquant');

const argument = process.argv[2];
const url = !argument ? defaut : argument.includes('://') ? argument : Object.assign(new URL(defaut), { pathname: `/${argument}` }).toString();
const base = decodeURIComponent(new URL(url).pathname.slice(1));

const { entries } = JSON.parse(readFileSync(`${dossier}meta/_journal.json`, 'utf8')) as { entries: Entree[] };
const erreurs: string[] = [];
const avertissements: string[] = [];
const date = (ms: number) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// 1. Journal : fichiers présents, dates croissantes, horodatage des nouvelles migrations.
let apresNumerotees = false;
entries.forEach((e, i) => {
  if (!existsSync(`${dossier}${e.tag}.sql`)) erreurs.push(`${e.tag} : fichier SQL absent`);
  const precedente = entries[i - 1];
  if (precedente && e.when <= precedente.when) {
    erreurs.push(`${e.tag} : datée (${date(e.when)}) avant ${precedente.tag} (${date(precedente.when)}) dans le journal`);
  }
  if (apresNumerotees && !HORODATEE.test(e.tag)) {
    avertissements.push(`${e.tag} : les nouvelles migrations sont préfixées par leur horodatage (pnpm db:generate)`);
  }
  if (e.tag === DERNIERE_NUMEROTEE) apresNumerotees = true;
});

// 2. Base : migrations déjà appliquées (created_at = `when` du journal).
const client = new pg.Client({ connectionString: url });
await client.connect();
let appliquees: number[] = [];
try {
  const { rows } = await client.query<{ existe: boolean }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS existe",
  );
  if (rows[0]?.existe) {
    const resultat = await client.query<{ created_at: string }>(
      'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at',
    );
    appliquees = resultat.rows.map((r) => Number(r.created_at));
  }
} finally {
  await client.end();
}

const parDate = new Map(entries.map((e) => [e.when, e]));
for (const quand of appliquees) {
  if (!parDate.has(quand)) {
    erreurs.push(`Migration appliquée sur ${base} le ${date(quand)} absente du journal : merger d'abord la branche qui l'a créée`);
  }
}
const derniere = appliquees.at(-1) ?? 0;
const enAttente = entries.filter((e) => !appliquees.includes(e.when));
for (const e of enAttente) {
  if (e.when <= derniere) {
    erreurs.push(
      `${e.tag} : en attente mais datée (${date(e.when)}) avant la dernière migration appliquée sur ${base} ` +
        `(${date(derniere)}) : drizzle-kit migrate l'ignorerait. La re-dater dans le journal.`,
    );
  }
}

console.log(`Base ${base} : ${appliquees.length} migration(s) appliquée(s), ${enAttente.length} en attente`);
for (const e of enAttente) console.log(`  à appliquer : ${e.tag}`);
for (const message of avertissements) console.log(`Avertissement : ${message}`);
for (const message of erreurs) console.error(`Erreur : ${message}`);
if (erreurs.length > 0) process.exit(1);
console.log('Journal cohérent avec la base.');
