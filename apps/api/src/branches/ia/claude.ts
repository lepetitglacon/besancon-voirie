/**
 * Lance Claude Code en mode non interactif (`claude -p`) sur le serveur, avec une sortie JSON
 * contrainte par un schéma. L'image part dans le premier message (entrée stream-json) : pas
 * d'outil, donc pas d'aller-retour pour l'ouvrir ni de relecture. Contexte réduit au strict
 * nécessaire : pas de MCP, pas de réglages utilisateur, pas de skills, pas de session sur disque.
 */
import { spawn } from 'node:child_process';

export interface OptionsClaude {
  /** Commande à lancer (IA_CLAUDE_CMD, `claude` par défaut). */
  commande: string;
  /** Modèle ou alias (`opus`, `sonnet`…). */
  modele: string;
  /** Niveau d'effort (IA_EFFORT, `medium` par défaut) : il borne le temps de réflexion. */
  effort: string;
  /** Dossier de travail, vide : rien à lire autour. */
  dossier: string;
  systeme: string;
  consigne: string;
  image: { donnees: Buffer; type: string };
  schemaJson: string;
  delaiMs: number;
}

export interface ReponseClaude {
  sortie: unknown;
  modele: string;
  duree_s: number;
  cout_usd: number | null;
  tokens_entree: number | null;
  tokens_sortie: number | null;
}

/** Usage par modèle dans la ligne `result`. */
interface UsageModele {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

/** Ligne `result` de `claude -p --output-format stream-json`. */
interface ResultatCli {
  type: string;
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  duration_ms?: number;
  modelUsage?: Record<string, UsageModele>;
}

export class ErreurClaude extends Error {
  /** Sortie brute reçue avant l'échec, pour la garder avec les fichiers de l'analyse. */
  brut = '';
}
/** Délai dépassé : distinct des autres échecs pour le message montré à l'utilisateur. */
export class DelaiClaude extends ErreurClaude {}

export function argumentsClaude(o: Pick<OptionsClaude, 'modele' | 'effort' | 'systeme' | 'schemaJson'>): string[] {
  return [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--json-schema', o.schemaJson,
    '--model', o.modele,
    '--effort', o.effort,
    '--system-prompt', o.systeme,
    '--tools', '',
    '--strict-mcp-config',
    '--setting-sources', '',
    '--no-session-persistence',
    '--disable-slash-commands',
  ];
}

/** Premier message, sur l'entrée standard : l'image puis la consigne. */
export function messageClaude(o: Pick<OptionsClaude, 'consigne' | 'image'>): string {
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: o.image.type, data: o.image.donnees.toString('base64') } },
        { type: 'text', text: o.consigne },
      ],
    },
  };
  return `${JSON.stringify(message)}\n`;
}

/** Lit la sortie stream-json (un objet par ligne) et en garde la ligne `result`. */
export function lireResultat(brut: string): ReponseClaude {
  const resultat = brut
    .split('\n')
    .flatMap((ligne): ResultatCli[] => {
      try {
        return [JSON.parse(ligne) as ResultatCli];
      } catch {
        return [];
      }
    })
    .findLast((l) => l.type === 'result');
  if (!resultat) throw new ErreurClaude(`Réponse de Claude illisible : ${brut.slice(-300)}`);
  if (resultat.is_error || resultat.structured_output === undefined) {
    throw new ErreurClaude(`Claude n'a pas produit de proposition : ${resultat.result ?? 'sans détail'}`);
  }
  // Claude Code appelle aussi un petit modèle en coulisse : le modèle qui a lu la photo est
  // celui qui a coûté le plus.
  const [modele, usage] =
    Object.entries(resultat.modelUsage ?? {}).sort(([, a], [, b]) => (b.costUSD ?? 0) - (a.costUSD ?? 0))[0] ?? [];
  return {
    sortie: resultat.structured_output,
    modele: modele ?? 'inconnu',
    duree_s: Math.round((resultat.duration_ms ?? 0) / 1000),
    cout_usd: resultat.total_cost_usd ?? null,
    tokens_entree: usage
      ? (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) + (usage.cacheCreationInputTokens ?? 0)
      : null,
    tokens_sortie: usage?.outputTokens ?? null,
  };
}

/** Réponse de Claude avec la sortie brute, gardée avec les fichiers de l'analyse. */
export function lancerClaude(o: OptionsClaude): Promise<ReponseClaude & { brut: string }> {
  return new Promise((resolve, reject) => {
    const processus = spawn(o.commande, argumentsClaude(o), { cwd: o.dossier, stdio: ['pipe', 'pipe', 'pipe'] });
    let sortie = '';
    let erreurs = '';
    let fini = false;
    const finir = (erreur: Error | null, reponse?: ReponseClaude) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      if (erreur instanceof ErreurClaude) erreur.brut = sortie;
      if (erreur) reject(erreur);
      else resolve({ ...reponse!, brut: sortie });
    };
    const minuterie = setTimeout(() => {
      processus.kill('SIGTERM');
      finir(new DelaiClaude(`${o.modele} n'a pas répondu en ${Math.round(o.delaiMs / 1000)} s`));
    }, o.delaiMs);

    processus.stdout.on('data', (morceau: Buffer) => (sortie += morceau.toString()));
    processus.stderr.on('data', (morceau: Buffer) => (erreurs += morceau.toString()));
    processus.on('error', (erreur: NodeJS.ErrnoException) =>
      finir(
        new ErreurClaude(
          erreur.code === 'ENOENT'
            ? `Claude Code introuvable sur le serveur (« ${o.commande} », voir IA_CLAUDE_CMD)`
            : `Lancement de Claude impossible : ${erreur.message}`,
        ),
      ),
    );
    processus.on('close', (code) => {
      if (code !== 0 && !sortie) {
        finir(new ErreurClaude(`Claude s'est arrêté (code ${code}) : ${erreurs.trim().slice(0, 300) || 'sans détail'}`));
        return;
      }
      try {
        finir(null, lireResultat(sortie));
      } catch (erreur) {
        finir(erreur as Error);
      }
    });
    // Un processus mort avant de lire l'entrée ne doit pas faire planter l'API.
    processus.stdin.on('error', () => {});
    processus.stdin.end(messageClaude(o));
  });
}
