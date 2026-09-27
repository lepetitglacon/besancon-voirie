/**
 * Raccordement du réseau à un carrefour configuré — docs/RESEAU.md. Les tronçons s'arrêtent sur
 * le cercle du carrefour (le bout de sa plus longue voie, plus une marge) : les intersections
 * OSM de l'intérieur disparaissent au profit d'un nœud unique, le carrefour. Chaque bout de
 * tronçon se raccorde à la branche de même direction, voie par voie.
 */
import { BadRequestException } from '@nestjs/common';
import {
  extraire,
  horsDuCercle,
  liensParDefaut,
  normaliserAngle,
  preparerPolyligne,
  repereLocal,
  type LonLat,
} from '@voirie/engine';
import type { Extremite, LiensRaccordement, Raccordement, RaccordementsCarrefour, SaisieRaccordements } from '@voirie/schema';
import { sql } from 'drizzle-orm';
import type { Executeur } from '../db/sql.js';

/** Marge (m) ajoutée au bout de la plus longue voie du carrefour pour tracer son cercle. */
export const MARGE_RACCORDEMENT_M = 5;
/** Écart d'azimut (°) au-delà duquel un bout de tronçon n'est rattaché à aucune branche. */
const ECART_BRANCHE_MAX = 40;
/** Longueur (m) du bout de tronçon renvoyé pour le dessiner dans l'éditeur du carrefour. */
const LONGUEUR_BOUT_M = 40;

interface BrancheCarrefour {
  code: string;
  azimut: number;
  entrantes: number;
  sortantes: number;
}

interface Cercle {
  centre: LonLat;
  rayon: number;
  branches: BrancheCarrefour[];
}

/** Centre, rayon du cercle et branches (avec leur nombre de voies) ; null sans aucune voie. */
async function cercle(db: Executeur, carrefourId: string): Promise<Cercle | null> {
  const { rows } = await db.execute<{ lon: number; lat: number; rayon: number | null; branches: BrancheCarrefour[] | null }>(sql`
    SELECT ST_X(c.geom) AS lon, ST_Y(c.geom) AS lat,
           (SELECT max(ST_Distance(c.geom::geography, ST_EndPoint(v.geom)::geography))
            FROM voie v JOIN branche b ON b.id = v.branche_id WHERE b.carrefour_id = c.id) AS rayon,
           (SELECT json_agg(json_build_object(
                     'code', b.code, 'azimut', b.azimut_deg,
                     'entrantes', (SELECT count(*) FROM voie v WHERE v.branche_id = b.id AND v.sens = 'entrante'),
                     'sortantes', (SELECT count(*) FROM voie v WHERE v.branche_id = b.id AND v.sens = 'sortante')))
            FROM branche b WHERE b.carrefour_id = c.id) AS branches
    FROM carrefour c WHERE c.id = ${carrefourId}
  `);
  const ligne = rows[0];
  if (!ligne || ligne.rayon === null) return null;
  return {
    centre: [ligne.lon, ligne.lat],
    rayon: ligne.rayon + MARGE_RACCORDEMENT_M,
    branches: (ligne.branches ?? []).map((b) => ({ ...b, entrantes: Number(b.entrantes), sortantes: Number(b.sortantes) })),
  };
}

const azimut = (centre: LonLat, point: LonLat) => {
  const [x, y] = repereLocal(centre).versXY(point);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
};

/** Branche la plus proche en azimut (à 40° près), ou null. */
function brancheProche(branches: BrancheCarrefour[], direction: number): string | null {
  const proche = branches
    .map((b) => ({ code: b.code, ecart: Math.abs(normaliserAngle(b.azimut - direction)) }))
    .filter((b) => b.ecart <= ECART_BRANCHE_MAX)
    .sort((a, b) => a.ecart - b.ecart)[0];
  return proche?.code ?? null;
}

type TronconLu = {
  id: string;
  noeud_de: string;
  noeud_vers: string;
  points: LonLat[];
  nom: string | null;
  voies_avant: number;
  voies_arriere: number;
  branche_de: string | null;
  branche_vers: string | null;
  liens_de: LiensRaccordement | null;
  liens_vers: LiensRaccordement | null;
};

const COLONNES_TRONCON = sql`
  id, noeud_de, noeud_vers, (ST_AsGeoJSON(geom)::json)->'coordinates' AS points, nom, voies_avant, voies_arriere,
  branche_de, branche_vers, liens_de, liens_vers`;

/** Voies qui arrivent au carrefour par ce bout du tronçon, et qui en repartent. */
function voiesAuBout(t: Pick<TronconLu, 'voies_avant' | 'voies_arriere'>, extremite: Extremite) {
  return extremite === 'vers'
    ? { arrivent: t.voies_avant, repartent: t.voies_arriere }
    : { arrivent: t.voies_arriere, repartent: t.voies_avant };
}

/** Liens valides pour ce nombre de voies (sinon null : on revient aux liens par défaut). */
function liensValides(liens: LiensRaccordement | null, arrivent: number, repartent: number, branche: BrancheCarrefour | undefined) {
  if (!liens || !branche) return null;
  const ok =
    liens.entree.every(([i, j]) => i < arrivent && j < branche.entrantes) &&
    liens.sortie.every(([j, i]) => j < branche.sortantes && i < repartent);
  return ok ? liens : null;
}

/** Nœud qui représente le carrefour dans le réseau (créé au besoin), placé en son centre. */
async function noeudCarrefour(db: Executeur, carrefourId: string, centre: LonLat): Promise<string> {
  const { rows } = await db.execute<{ id: string }>(sql`
    INSERT INTO noeud (carrefour_id, geom) VALUES (${carrefourId}, ST_SetSRID(ST_MakePoint(${centre[0]}, ${centre[1]}), 4326))
    ON CONFLICT (carrefour_id) DO UPDATE SET geom = EXCLUDED.geom
    RETURNING id
  `);
  return rows[0]!.id;
}

/**
 * Un tronçon OSM corrigé (ou supprimé) à la main est gardé à la régénération. Ses moitiés, s'il a
 * été coupé, partagent ses nœuds OSM d'origine : on les marque ensemble.
 */
export async function marquerModifie(db: Executeur, id: string): Promise<void> {
  await db.execute(sql`
    UPDATE troncon t SET modifie = true
    FROM troncon o
    WHERE o.id = ${id} AND t.source = 'osm'
      AND (t.id = o.id OR (t.osm_way_id, t.osm_de, t.osm_vers) = (o.osm_way_id, o.osm_de, o.osm_vers))
  `);
}

const ligneGeoJson = (points: LonLat[]) => JSON.stringify({ type: 'LineString', coordinates: points });

/**
 * Coupe les tronçons au cercle du carrefour et les raccorde à ses branches. Sans effet pour un
 * carrefour sans voie. Idempotent : un tronçon déjà raccordé est recoupé au même endroit.
 */
export async function raccorderCarrefour(db: Executeur, carrefourId: string): Promise<void> {
  const c = await cercle(db, carrefourId);
  if (!c) return;
  const noeud = await noeudCarrefour(db, carrefourId, c.centre);
  const point = sql`ST_SetSRID(ST_MakePoint(${c.centre[0]}, ${c.centre[1]}), 4326)`;

  const { rows: proches } = await db.execute<TronconLu>(sql`
    SELECT ${COLONNES_TRONCON} FROM troncon
    WHERE NOT supprime AND ST_DWithin(geom::geography, ${point}::geography, ${c.rayon + 1})
  `);
  for (const t of proches) {
    // Un bout déjà raccordé repart du centre : il est recoupé sur le cercle (qui a pu changer).
    const points = [...(t.noeud_de === noeud ? [c.centre] : []), ...t.points, ...(t.noeud_vers === noeud ? [c.centre] : [])];
    const morceaux = horsDuCercle(points, c.centre, c.rayon).filter((m) => !(m.debutSurCercle && m.finSurCercle));
    if (morceaux.length === 0) {
      await db.execute(sql`DELETE FROM troncon WHERE id = ${t.id}`);
      continue;
    }
    const premier = morceaux[0]!;
    const dernier = morceaux.at(-1)!;
    if (!premier.debutSurCercle && !premier.finSurCercle && morceaux.length === 1) continue; // ne fait que frôler le cercle
    // Coupé en deux, le tronçon laisse à sa seconde moitié son autre bout (et le raccordement de ce bout).
    const coupeEnDeux = morceaux.length > 1;
    await db.execute(sql`
      UPDATE troncon SET
        geom = ST_SetSRID(ST_GeomFromGeoJSON(${ligneGeoJson(premier.points)}), 4326),
        noeud_de = ${premier.debutSurCercle ? noeud : t.noeud_de},
        noeud_vers = ${premier.finSurCercle ? noeud : t.noeud_vers}
        ${coupeEnDeux ? sql`, branche_vers = NULL, liens_vers = NULL` : sql``}
      WHERE id = ${t.id}
    `);
    if (coupeEnDeux) {
      // Le tronçon traverse le carrefour : sa seconde moitié repart du carrefour.
      await db.execute(sql`
        INSERT INTO troncon (noeud_de, noeud_vers, geom, osm_way_id, osm_de, osm_vers, nom, highway, voies_avant, voies_arriere,
                             vitesse_kmh, source, modifie, branche_vers, liens_vers)
        SELECT ${noeud}, ${dernier.finSurCercle ? noeud : t.noeud_vers},
               ST_SetSRID(ST_GeomFromGeoJSON(${ligneGeoJson(dernier.points)}), 4326),
               osm_way_id, osm_de, osm_vers, nom, highway, voies_avant, voies_arriere, vitesse_kmh, source, modifie,
               ${t.branche_vers}, ${t.liens_vers ? JSON.stringify(t.liens_vers) : null}::jsonb
        FROM troncon WHERE id = ${t.id}
      `);
    }
  }

  // Les intersections OSM de l'intérieur du cercle n'ont plus de tronçon : elles disparaissent.
  await db.execute(sql`
    DELETE FROM noeud n
    WHERE n.carrefour_id IS NULL AND ST_DWithin(n.geom::geography, ${point}::geography, ${c.rayon})
      AND NOT EXISTS (SELECT 1 FROM troncon t WHERE t.noeud_de = n.id OR t.noeud_vers = n.id)
  `);

  // Branche de chaque bout raccordé : celle choisie si elle existe encore, sinon la plus proche en azimut.
  const parCode = new Map(c.branches.map((b) => [b.code, b]));
  const { rows: raccordes } = await db.execute<TronconLu>(sql`
    SELECT ${COLONNES_TRONCON} FROM troncon WHERE NOT supprime AND (noeud_de = ${noeud} OR noeud_vers = ${noeud})
  `);
  for (const t of raccordes) {
    for (const extremite of ['de', 'vers'] as const) {
      if ((extremite === 'de' ? t.noeud_de : t.noeud_vers) !== noeud) continue;
      const bout = extremite === 'de' ? t.points[0]! : t.points.at(-1)!;
      const actuelle = extremite === 'de' ? t.branche_de : t.branche_vers;
      const branche = actuelle && parCode.has(actuelle) ? actuelle : brancheProche(c.branches, azimut(c.centre, bout));
      const { arrivent, repartent } = voiesAuBout(t, extremite);
      const liens = liensValides(extremite === 'de' ? t.liens_de : t.liens_vers, arrivent, repartent, branche ? parCode.get(branche) : undefined);
      const json = liens ? JSON.stringify(liens) : null;
      await db.execute(
        extremite === 'de'
          ? sql`UPDATE troncon SET branche_de = ${branche}, liens_de = ${json}::jsonb WHERE id = ${t.id}`
          : sql`UPDATE troncon SET branche_vers = ${branche}, liens_vers = ${json}::jsonb WHERE id = ${t.id}`,
      );
    }
  }
}

/** Bouts de tronçons raccordés au carrefour, avec leurs voies et leurs liens. */
export async function lireRaccordements(db: Executeur, carrefourId: string): Promise<RaccordementsCarrefour> {
  const c = await cercle(db, carrefourId);
  if (!c) return { rayon_m: 0, raccordements: [], alertes: [] };
  const { rows: noeuds } = await db.execute<{ id: string }>(sql`SELECT id FROM noeud WHERE carrefour_id = ${carrefourId}`);
  const noeud = noeuds[0]?.id;
  const { rows: troncons } = noeud
    ? await db.execute<TronconLu>(sql`
        SELECT ${COLONNES_TRONCON} FROM troncon WHERE NOT supprime AND (noeud_de = ${noeud} OR noeud_vers = ${noeud})
        ORDER BY id
      `)
    : { rows: [] as TronconLu[] };
  const parCode = new Map(c.branches.map((b) => [b.code, b]));

  const raccordements: Raccordement[] = troncons.flatMap((t) =>
    (['de', 'vers'] as const)
      .filter((extremite) => (extremite === 'de' ? t.noeud_de : t.noeud_vers) === noeud)
      .map((extremite): Raccordement => {
        const depuisLeBout = extremite === 'de' ? t.points : [...t.points].reverse();
        const ligne = preparerPolyligne(depuisLeBout);
        const branche = extremite === 'de' ? t.branche_de : t.branche_vers;
        const saisis = extremite === 'de' ? t.liens_de : t.liens_vers;
        const { arrivent, repartent } = voiesAuBout(t, extremite);
        const b = branche ? parCode.get(branche) : undefined;
        return {
          troncon_id: t.id,
          extremite,
          nom: t.nom,
          branche,
          azimut: Math.round(azimut(c.centre, depuisLeBout[0]!) * 10) / 10,
          points: extraire(ligne, 0, Math.min(LONGUEUR_BOUT_M, ligne.longueur)),
          voies_vers_carrefour: arrivent,
          voies_depuis_carrefour: repartent,
          liens: saisis ?? {
            entree: liensParDefaut(arrivent, b?.entrantes ?? 0),
            sortie: liensParDefaut(b?.sortantes ?? 0, repartent),
          },
          liens_auto: saisis === null,
        };
      }),
  );

  const alertes = [
    ...raccordements
      .filter((r) => r.branche === null)
      .map((r) => `Tronçon ${r.nom ?? 'sans nom'} (azimut ${Math.round(r.azimut)}°) : aucune branche dans cette direction`),
    ...c.branches
      .filter((b) => b.entrantes + b.sortantes > 0 && !raccordements.some((r) => r.branche === b.code))
      .map((b) => `Branche ${b.code} : aucun tronçon raccordé`),
  ];
  return { rayon_m: Math.round(c.rayon * 10) / 10, raccordements, alertes };
}

/** Enregistre la branche et les liens choisis pour chaque bout (liens null : par défaut). */
export async function enregistrerRaccordements(db: Executeur, carrefourId: string, saisie: SaisieRaccordements): Promise<void> {
  const c = await cercle(db, carrefourId);
  if (!c) throw new BadRequestException('Carrefour sans voie : rien à raccorder');
  const parCode = new Map(c.branches.map((b) => [b.code, b]));
  const { rows: noeuds } = await db.execute<{ id: string }>(sql`SELECT id FROM noeud WHERE carrefour_id = ${carrefourId}`);
  const noeud = noeuds[0]?.id;

  for (const r of saisie.raccordements) {
    const { rows } = await db.execute<TronconLu>(sql`SELECT ${COLONNES_TRONCON} FROM troncon WHERE id = ${r.troncon_id}`);
    const t = rows[0];
    if (!t || !noeud || (r.extremite === 'de' ? t.noeud_de : t.noeud_vers) !== noeud) {
      throw new BadRequestException(`Le tronçon ${r.troncon_id} n'est pas raccordé à ce carrefour par son bout « ${r.extremite} »`);
    }
    if (r.branche !== null && !parCode.has(r.branche)) throw new BadRequestException(`Branche ${r.branche} inconnue`);
    const { arrivent, repartent } = voiesAuBout(t, r.extremite);
    if (r.liens && !liensValides(r.liens, arrivent, repartent, r.branche ? parCode.get(r.branche) : undefined)) {
      throw new BadRequestException(`Liens du tronçon ${t.nom ?? r.troncon_id} : voie inexistante`);
    }
    const json = r.liens ? JSON.stringify(r.liens) : null;
    await db.execute(
      r.extremite === 'de'
        ? sql`UPDATE troncon SET branche_de = ${r.branche}, liens_de = ${json}::jsonb WHERE id = ${t.id}`
        : sql`UPDATE troncon SET branche_vers = ${r.branche}, liens_vers = ${json}::jsonb WHERE id = ${t.id}`,
    );    // Raccordement saisi à la main : la régénération depuis OSM garde le tronçon (et ses liens).
    await marquerModifie(db, t.id);
  }
}
