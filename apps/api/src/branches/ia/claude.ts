/**
 * Lance Claude Code en mode non interactif (`claude -p`) sur le serveur, avec une sortie JSON
 * contrainte par un schéma. Contexte réduit au strict nécessaire : pas de MCP, pas de réglages
 * utilisateur, pas de skills, seul l'outil Read (pour ouvrir l'image) dans un dossier temporaire.
 */
import { spawn } from 'node:child_process';

export interface OptionsClaude {
  /** Commande à lancer (IA_CLAUDE_CMD, `claude` par défaut). */
  commande: string;
  /** Modèle ou alias (IA_MODELE, `opus` par défaut). */
  modele: string;
  /** Dossier de travail : le seul que Claude peut lire. */
  dossier: string;
  systeme: string;
  consigne: string;
  schemaJson: string;
  delaiMs: number;
}

export interface ReponseClaude {
  sortie: unknown;
  modele: string;
  duree_s: number;
  cout_usd: number | null;
}

/** Résultat de `claude -p --output-format json`. */
interface ResultatCli {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  modelUsage?: Record<string, unknown>;
}

export class ErreurClaude extends Error {}

export function argumentsClaude(o: Pick<OptionsClaude, 'modele' | 'dossier' | 'systeme' | 'schemaJson'>): string[] {
  return [
    '-p',
    '--output-format', 'json',
    '--json-schema', o.schemaJson,
    '--model', o.modele,
    '--system-prompt', o.systeme,
    '--tools', 'Read',
    '--allowedTools', 'Read',
    '--add-dir', o.dossier,
    '--strict-mcp-config',
    '--setting-sources', '',
    '--disable-slash-commands',
  ];
}

export function lireResultat(brut: string): ReponseClaude {
  let resultat: ResultatCli;
  try {
    resultat = JSON.parse(brut) as ResultatCli;
  } catch {
    throw new ErreurClaude(`Réponse de Claude illisible : ${brut.slice(0, 300)}`);
  }
  if (resultat.is_error || resultat.structured_output === undefined) {
    throw new ErreurClaude(`Claude n'a pas produit de proposition : ${resultat.result ?? 'sans détail'}`);
  }
  return {
    sortie: resultat.structured_output,
    modele: Object.keys(resultat.modelUsage ?? {})[0] ?? 'inconnu',
    duree_s: Math.round((resultat.duration_ms ?? 0) / 1000),
    cout_usd: resultat.total_cost_usd ?? null,
  };
}

export function lancerClaude(o: OptionsClaude): Promise<ReponseClaude> {
  return new Promise((resolve, reject) => {
    // La consigne passe par l'entrée standard : les options à valeurs multiples (--tools,
    // --add-dir) avaleraient un argument positionnel placé après elles.
    const processus = spawn(o.commande, argumentsClaude(o), { cwd: o.dossier, stdio: ['pipe', 'pipe', 'pipe'] });
    let sortie = '';
    let erreurs = '';
    const minuterie = setTimeout(() => {
      processus.kill('SIGTERM');
      reject(new ErreurClaude(`Claude n'a pas répondu en ${Math.round(o.delaiMs / 1000)} s`));
    }, o.delaiMs);
    processus.stdout.on('data', (morceau: Buffer) => (sortie += morceau.toString()));
    processus.stderr.on('data', (morceau: Buffer) => (erreurs += morceau.toString()));
    processus.on('error', (erreur: NodeJS.ErrnoException) => {
      clearTimeout(minuterie);
      reject(
        new ErreurClaude(
          erreur.code === 'ENOENT'
            ? `Claude Code introuvable sur le serveur (« ${o.commande} », voir IA_CLAUDE_CMD)`
            : `Lancement de Claude impossible : ${erreur.message}`,
        ),
      );
    });
    processus.on('close', (code) => {
      clearTimeout(minuterie);
      if (code !== 0 && !sortie) {
        reject(new ErreurClaude(`Claude s'est arrêté (code ${code}) : ${erreurs.trim().slice(0, 300) || 'sans détail'}`));
        return;
      }
      try {
        resolve(lireResultat(sortie));
      } catch (erreur) {
        reject(erreur);
      }
    });
    processus.stdin.end(o.consigne);
  });
}
