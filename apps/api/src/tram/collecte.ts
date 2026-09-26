import type { ReseauTramInterne } from './gtfs.js';
import type { FluxTempsReel } from './temps-reel.js';

/** Passage d'une rame à un arrêt, prêt à enregistrer (instants en s epoch). */
export interface Passage {
  jour: string;
  course: string;
  sequence: number;
  vehicule: string | null;
  parcours: string;
  arret: string;
  arretPrecedent: string | null;
  heurePrevue: number;
  detecteA: number;
  heureTheorique: number | null;
  previsions: Record<string, number>;
}

/** Horizons auxquels on garde la prévision, pour mesurer l'erreur de Ginko selon l'avance. */
export const HORIZONS_S = [30, 60, 120, 300, 600] as const;

/** Une prévision n'est rattachée à un horizon que si elle a été lue à moins de ça de celui-ci. */
const TOLERANCE_HORIZON_S = 30;
/** Les prévisions plus anciennes que ça ne servent plus à aucun horizon. */
const MEMOIRE_S = HORIZONS_S[HORIZONS_S.length - 1] + 2 * TOLERANCE_HORIZON_S;
/**
 * Un arrêt qui disparaît bien avant son heure prévue n'a pas été desservi normalement
 * (arrêt sauté, régulation) : on ne l'enregistre pas.
 */
const DISPARITION_ANTICIPEE_MAX_S = 120;
/** Fin de course : le terminus disparaît avec la course, on l'accepte près de son heure prévue. */
const FENETRE_TERMINUS_S = 300;

interface SuiviArret {
  arret: string;
  /** Prévisions lues : [instant de lecture, heure prévue], en s epoch. */
  previsions: Array<[number, number]>;
}

interface SuiviCourse {
  jour: string;
  course: string;
  vehicule?: string;
  arrets: Map<number, SuiviArret>;
}

/** Jour de service `AAAA-MM-JJ` à Paris pour un instant (s epoch). */
function jourParis(instant: number): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(instant * 1000));
}

/**
 * Début du jour de service GTFS (« midi moins 12 h », heure de Paris), en s epoch : les
 * horaires GTFS en comptent les secondes, ce qui reste juste les jours de changement d'heure.
 */
export function debutJourService(jour: string): number {
  const [annee, mois, j] = jour.split('-').map(Number) as [number, number, number];
  const midiUtc = Date.UTC(annee, mois - 1, j, 12);
  const decalage = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', timeZoneName: 'longOffset' })
    .formatToParts(new Date(midiUtc))
    .find((partie) => partie.type === 'timeZoneName')!.value; // « GMT+02:00 »
  // « GMT » seul à l'heure UTC : décalage nul.
  const [, signe = '+', heures = '0', minutes = '0'] = /GMT([+-])(\d{2}):(\d{2})/.exec(decalage) ?? [];
  const decalage_s = (signe === '-' ? -1 : 1) * (Number(heures) * 3600 + Number(minutes) * 60);
  return midiUtc / 1000 - decalage_s - 12 * 3600;
}

/**
 * Déduit les passages des lectures successives du flux GTFS-RT. Ginko retire de la liste des
 * arrêts restants d'une course ceux que la rame a desservis : un arrêt qui disparaît entre deux
 * lectures est un passage, daté par la dernière heure prévue (la plus proche du réel ; la
 * disparition elle-même arrive ~8 s plus tard, voir docs/ARCHITECTURE.md §8.1).
 */
export class DetecteurPassages {
  private readonly courses = new Map<string, SuiviCourse>();
  private dernierHorodatage = 0;

  observer(reseau: ReseauTramInterne, flux: FluxTempsReel): Passage[] {
    const maintenant = flux.horodatage;
    if (maintenant <= this.dernierHorodatage) return [];
    this.dernierHorodatage = maintenant;

    const passages: Passage[] = [];
    const vues = new Set<string>();

    for (const { course, jour, vehicule, arrets } of flux.courses) {
      if (!reseau.courses.has(course) || arrets.length === 0) continue;
      const cle = `${jour ?? jourParis(arrets[0]!.arrivee)}|${course}`;
      vues.add(cle);
      let suivi = this.courses.get(cle);
      if (!suivi) {
        suivi = { jour: cle.slice(0, 10), course, arrets: new Map() };
        this.courses.set(cle, suivi);
      }
      if (vehicule) suivi.vehicule = vehicule;

      // Arrêts disparus : desservis depuis la lecture précédente.
      const restants = new Set(arrets.map(({ sequence }) => sequence));
      const premier = arrets[0]!.sequence;
      for (const [sequence, arret] of suivi.arrets) {
        if (restants.has(sequence)) continue;
        suivi.arrets.delete(sequence);
        if (sequence > premier) continue; // retiré sans avoir été atteint
        const passage = this.passage(reseau, suivi, sequence, arret, maintenant);
        if (passage && passage.heurePrevue - maintenant <= DISPARITION_ANTICIPEE_MAX_S) passages.push(passage);
      }

      for (const { sequence, arret, arrivee } of arrets) {
        if (arrivee - maintenant > MEMOIRE_S) continue;
        let suiviArret = suivi.arrets.get(sequence);
        if (!suiviArret) {
          suiviArret = { arret, previsions: [] };
          suivi.arrets.set(sequence, suiviArret);
        }
        suiviArret.previsions.push([maintenant, arrivee]);
        while (suiviArret.previsions.length && maintenant - suiviArret.previsions[0]![0] > MEMOIRE_S) {
          suiviArret.previsions.shift();
        }
      }
    }

    // Courses disparues du flux : terminées. Seul le terminus, s'il restait, est un passage.
    for (const [cle, suivi] of this.courses) {
      if (vues.has(cle)) continue;
      this.courses.delete(cle);
      if (suivi.arrets.size !== 1) continue;
      const [[sequence, arret]] = [...suivi.arrets];
      const passage = this.passage(reseau, suivi, sequence!, arret!, maintenant);
      if (passage && Math.abs(passage.heurePrevue - maintenant) <= FENETRE_TERMINUS_S) passages.push(passage);
    }

    return passages;
  }

  private passage(
    reseau: ReseauTramInterne,
    suivi: SuiviCourse,
    sequence: number,
    { arret, previsions }: SuiviArret,
    maintenant: number,
  ): Passage | undefined {
    const derniere = previsions.at(-1);
    const statique = reseau.courses.get(suivi.course);
    if (!derniere || !statique) return undefined;
    const heurePrevue = derniere[1];
    const rang = statique.arrets.findIndex((a) => a.sequence === sequence);
    const theorique = statique.arrets[rang]?.theorique;

    const parHorizon: Record<string, number> = {};
    for (const horizon of HORIZONS_S) {
      const cible = heurePrevue - horizon;
      const lue = previsions.findLast(([lecture]) => lecture <= cible);
      if (lue && cible - lue[0] <= TOLERANCE_HORIZON_S) parHorizon[horizon] = lue[1];
    }

    return {
      jour: suivi.jour,
      course: suivi.course,
      sequence,
      vehicule: suivi.vehicule ?? null,
      parcours: statique.parcours,
      arret,
      arretPrecedent: rang > 0 ? statique.arrets[rang - 1]!.arret : null,
      heurePrevue,
      detecteA: maintenant,
      heureTheorique: theorique === undefined ? null : debutJourService(suivi.jour) + theorique,
      previsions: parHorizon,
    };
  }
}
