import { repereLocal, type LonLat, type Segment } from './geometrie.js';

/** Marge autour de l'espace utile d'un carrefour (m) : de quoi voir l'approche des voies. */
export const MARGE_EMPRISE_M = 25;

/** Emprise [ouest, sud, est, nord], en degrés. */
export type Emprise = [number, number, number, number];

interface BrancheEmprise {
  voies: ReadonlyArray<{ geom: Segment }>;
  passages?: readonly Segment[];
}

/**
 * Espace utile d'un carrefour : les lignes d'arrêt (bout de chaque voie côté carrefour), les
 * passages piétons et les feux physiques, plus une marge. Les voies elles-mêmes, dessinées loin
 * en amont, n'y entrent pas : elles élargiraient le cadre bien au-delà du carrefour.
 * null s'il n'y a aucun point (carrefour ni configuré ni pourvu de feux).
 */
export function empriseCarrefour(
  branches: readonly BrancheEmprise[],
  feux: readonly LonLat[] = [],
  marge_m = MARGE_EMPRISE_M,
): Emprise | null {
  const points: LonLat[] = [
    ...branches.flatMap((b) => [...b.voies.map((v) => v.geom[0]), ...(b.passages ?? []).flat()]),
    ...feux,
  ];
  if (points.length === 0) return null;
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const [ouest, sud, est, nord] = [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  // La marge en degrés dépend de la latitude pour la longitude.
  const { versLonLat } = repereLocal([(ouest + est) / 2, (sud + nord) / 2]);
  const [lon0, lat0] = versLonLat([0, 0]);
  const [lon1, lat1] = versLonLat([marge_m, marge_m]);
  const [dLon, dLat] = [lon1 - lon0, lat1 - lat0];
  return [ouest - dLon, sud - dLat, est + dLon, nord + dLat];
}
