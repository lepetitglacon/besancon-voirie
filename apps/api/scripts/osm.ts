/**
 * Import OpenStreetMap en ligne de commande — docs/ARCHITECTURE.md §5. Le cœur de l'import est
 * dans src/osm/import-osm.ts, partagé avec l'application (outil « Zone OSM » du mode Édition).
 *
 * Usage (depuis apps/api, Node 24+) :
 *   node scripts/osm.ts import   télécharge via Overpass les feux de la zone d'import (ou de la
 *                                commune), recharge les tables des feux et synchronise `feu` ;
 *                                les voies se chargent à la demande autour des carrefours
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { importerOsm } from '../src/osm/import-osm.ts';

export * from '../src/osm/import-osm.ts';

async function principal(commande: string | undefined) {
  const racine = fileURLToPath(new URL('../../../', import.meta.url));
  const env = parseEnv(readFileSync(`${racine}.env`, 'utf8'));
  const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL manquant');

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    if (commande === 'import') {
      const { horodatage, bilan } = await importerOsm(client, {
        etape: (etape, detail) => console.log(etape === 'telechargement' ? `Téléchargement : ${detail}` : `Chargement : ${detail}`),
      });
      console.log(`Données OSM du ${horodatage ?? '?'} :`, bilan);
    } else {
      console.error('Usage : node scripts/osm.ts import');
      process.exitCode = 1;
    }
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  await principal(process.argv[2]);
}
