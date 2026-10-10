/**
 * Réseau routier — docs/RESEAU.md. Client de l'API en cours d'exécution (`pnpm dev`).
 *
 * Usage (depuis apps/api, Node 24+) :
 *   node scripts/reseau.ts semer [--reinitialiser]  sème le réseau depuis les données OSM importées (une seule
 *                                                   fois ; --reinitialiser efface tout le réseau avant)
 *   node scripts/reseau.ts sumo [--bbox=o,s,e,n]    écrit data/sumo/reseau.{nod,edg,con,tll}.xml et reseau.netccfg
 *        [--sortie=dossier]                         puis : cd data/sumo && netconvert -c reseau.netccfg
 *        [--theorique]                              voies des profils Streetmix (docs/integration-streetmix.md)
 *   --api=http://localhost:3000                     URL de l'API (par défaut : API_PORT du .env)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const FICHIERS = ['reseau.nod.xml', 'reseau.edg.xml', 'reseau.con.xml', 'reseau.tll.xml', 'reseau.netccfg'];

function option(options: string[], nom: string): string | undefined {
  return options.find((o) => o.startsWith(`--${nom}=`))?.slice(nom.length + 3);
}

async function appeler(url: string, init?: RequestInit): Promise<Response> {
  const reponse = await fetch(url, init).catch((erreur: Error) => {
    throw new Error(`API injoignable (${url}) : lancer \`pnpm dev\`, ou préciser --api=… (${erreur.message})`);
  });
  if (!reponse.ok) throw new Error(`${init?.method ?? 'GET'} ${url} : ${reponse.status} ${await reponse.text()}`);
  return reponse;
}

async function principal(commande: string | undefined, options: string[]) {
  const racine = fileURLToPath(new URL('../../../', import.meta.url));
  const env = parseEnv(readFileSync(`${racine}.env`, 'utf8'));
  const api = option(options, 'api') ?? `http://localhost:${process.env.API_PORT ?? env.API_PORT ?? 3000}`;

  if (commande === 'semer') {
    const reinitialiser = options.includes('--reinitialiser');
    console.log(reinitialiser ? 'Réseau effacé, nouveau semis depuis OSM…' : 'Semis du réseau depuis OSM…');
    const bilan = await (
      await appeler(`${api}/api/reseau/semer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reinitialiser }),
      })
    ).json();
    console.log(bilan);
  } else if (commande === 'sumo') {
    const bbox = option(options, 'bbox');
    const parametres = new URLSearchParams({ ...(bbox && { bbox }), ...(options.includes('--theorique') && { variante: 'theorique' }) }).toString();
    const sortie = option(options, 'sortie') ?? join(racine, 'data/sumo');
    mkdirSync(sortie, { recursive: true });
    for (const fichier of FICHIERS) {
      const texte = await (await appeler(`${api}/api/reseau/sumo/${fichier}${parametres ? `?${parametres}` : ''}`)).text();
      writeFileSync(join(sortie, fichier), texte);
      console.log(`${join(sortie, fichier)} (${Math.round(texte.length / 1024)} Ko)`);
    }
    console.log(`Puis : cd ${sortie} && netconvert -c reseau.netccfg`);
  } else {
    console.error('Usage : node scripts/reseau.ts semer [--reinitialiser] | sumo [--bbox=o,s,e,n] [--sortie=dossier] [--theorique] [--api=url]');
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await principal(process.argv[2], process.argv.slice(3));
}
