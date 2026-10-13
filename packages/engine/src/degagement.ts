/**
 * Rouges de dégagement entre lignes de feux en conflit — docs/CONFIGURATION.md §5.
 *
 * Quand une ligne s'arrête (fin du vert, puis jaune pour les véhicules) et qu'une ligne en
 * conflit démarre, le dernier usager de la première doit avoir dégagé le point de conflit
 * avant que le premier usager de la seconde ne l'atteigne :
 *
 *   rouge = (d_sortant + longueur du véhicule) / v_sortant − d_entrant / v_entrant
 *
 * d_sortant : trajet de la ligne d'arrêt au point de conflit pour l'usager qui dégage ;
 * d_entrant : trajet de la ligne d'arrêt au point de conflit pour l'usager qui arrive.
 * Le véhicule qui dégage a franchi sa ligne d'arrêt au plus tard à la fin du jaune.
 * Un piéton qui dégage part du trottoir le plus éloigné du point de conflit ; un piéton qui
 * arrive part du plus proche. On garde le pire des points de conflit, arrondi à la seconde
 * supérieure.
 */
import { matriceConflits, trajectoiresParMouvement, type GeometrieCarrefour, type LigneConflits } from './conflits.js';
import { intersectionsPolylignes, longueurPolyligne, repereLocal, type XY } from './geometrie.js';
import { PARAMETRES_CERTU } from './parametres.js';

export interface LigneDegagement extends LigneConflits {
  /** Vitesse de dégagement (m/s) ; par défaut celle des véhicules, ou des piétons. */
  vitesse_ms?: number;
}

export interface Degagement {
  /** Ligne qui s'arrête. */
  de: string;
  /** Ligne en conflit qui démarre ensuite. */
  vers: string;
  rouge_s: number;
  /** Trajets retenus pour le calcul (m), absents si la valeur par défaut a été appliquée. */
  distances?: { sortant: number; entrant: number };
}

/** Clé d'un rouge de dégagement : « ligne qui s'arrête>ligne qui démarre ». */
export const cleDegagement = (de: string, vers: string) => `${de}>${vers}`;

interface Parametres {
  longueurVehicule: number;
  vitesseVehicules: number;
  vitessePietons: number;
  rougeDegagementDefaut: number;
}

/**
 * Rouges de dégagement calculés pour chaque couple ordonné de lignes en conflit non admis
 * (les deux sens : F1 puis F2, et F2 puis F1).
 */
export function degagementsCalcules(
  lignes: readonly LigneDegagement[],
  geometrie: GeometrieCarrefour,
  admis: ReadonlyArray<readonly [string, string]> = [],
  parametres: Parametres = PARAMETRES_CERTU,
): Degagement[] {
  const repere = repereLocal(geometrie.centre);
  const parMouvement = trajectoiresParMouvement(geometrie);
  const parCode = new Map(lignes.map((l) => [l.code, l]));
  const vitesse = (l: LigneDegagement) =>
    l.vitesse_ms ?? (l.type === 'pieton' ? parametres.vitessePietons : parametres.vitesseVehicules);
  const courbes = (l: LigneDegagement) => l.mouvements.flatMap((m) => parMouvement.get(m) ?? []);
  const passages = (l: LigneDegagement): XY[][] =>
    (l.traverse ? (geometrie.traversees.get(l.traverse) ?? []) : []).map((segment) => segment.map(repere.versXY));

  /** Couples (trajet de l'usager qui dégage, trajet de celui qui arrive) jusqu'aux points de conflit. */
  const pointsDeConflit = (sortant: LigneDegagement, entrant: LigneDegagement): Array<{ sortant: number; entrant: number }> => {
    if (sortant.type === 'pieton' || entrant.type === 'pieton') {
      const pieton = sortant.type === 'pieton' ? sortant : entrant;
      const vehicule = sortant.type === 'pieton' ? entrant : sortant;
      // Chaque passage va d'un trottoir (ou d'un terre-plein) à l'autre : le piéton qui dégage
      // part du bord le plus éloigné du point de conflit, celui qui arrive du plus proche.
      return passages(pieton).flatMap((passage) => {
        const longueur = longueurPolyligne(passage);
        return courbes(vehicule).flatMap((t) =>
          intersectionsPolylignes(passage, t.courbe).map(({ da, db }) =>
            pieton === sortant
              ? { sortant: Math.max(da, longueur - da), entrant: db }
              : { sortant: db, entrant: Math.min(da, longueur - da) },
          ),
        );
      });
    }
    return courbes(sortant).flatMap((ts) =>
      courbes(entrant).flatMap((te) => {
        if (ts.de === te.de) return [];
        if (ts.vers === te.vers) return [{ sortant: longueurPolyligne(ts.courbe), entrant: longueurPolyligne(te.courbe) }];
        return intersectionsPolylignes(ts.courbe, te.courbe).map(({ da, db }) => ({ sortant: da, entrant: db }));
      }),
    );
  };

  const degagements: Degagement[] = [];
  for (const conflit of matriceConflits(lignes, geometrie, admis)) {
    if (conflit.admis) continue;
    for (const [de, vers] of [
      [conflit.a, conflit.b],
      [conflit.b, conflit.a],
    ] as const) {
      const sortant = parCode.get(de)!;
      const entrant = parCode.get(vers)!;
      const longueur = sortant.type === 'pieton' ? 0 : parametres.longueurVehicule;
      let pire: { rouge: number; sortant: number; entrant: number } | null = null;
      for (const p of pointsDeConflit(sortant, entrant)) {
        const rouge = (p.sortant + longueur) / vitesse(sortant) - p.entrant / vitesse(entrant);
        if (!pire || rouge > pire.rouge) pire = { rouge, ...p };
      }
      degagements.push(
        pire
          ? {
              de,
              vers,
              rouge_s: Math.max(0, Math.ceil(pire.rouge - 1e-9)),
              distances: { sortant: Math.round(pire.sortant * 10) / 10, entrant: Math.round(pire.entrant * 10) / 10 },
            }
          : { de, vers, rouge_s: parametres.rougeDegagementDefaut },
      );
    }
  }
  return degagements;
}
