import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  boutsAuNoeud,
  boutsDuSens,
  cleEmprise,
  configurationNetconvert,
  decalerEmprises,
  decalerLiaisons,
  exporterSumo,
  insererType,
  inverserEmprises,
  liaisonsRetenues,
  noeudsApproche,
  partagerEmprises,
  retirerType,
  type CarrefourSumo,
  type EmprisesTroncon,
  type LonLat,
  type ReseauSumo,
  type TypeVoieReseau,
} from '@voirie/engine';
import type {
  Accroche,
  Bbox,
  BilanSemis,
  CoupeTroncon,
  FichierSumo,
  FusionNoeuds,
  Liaison,
  ModificationNoeud,
  ModificationTroncon,
  NoeudResume,
  NouveauTroncon,
  ReseauGeoJson,
  SaisieLiaisons,
  TronconResume,
  TypesVoies,
} from '@voirie/schema';
import { typeLigne } from '@voirie/schema';
import { sql, type SQL } from 'drizzle-orm';
import { BranchesService } from '../branches/branches.service.js';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { LignesService } from '../lignes/lignes.service.js';
import { ProgrammeService } from '../programme/programme.service.js';
import type { Executeur } from '../db/sql.js';
import { materialiserCarrefour, rafraichirCarrefours, rattacherTousLesCarrefours } from './carrefours.js';
import { semerReseau } from './generation.js';

/** Au-delà, la carte ne reçoit qu'une partie des tronçons de l'emprise (`tronque`). */
const LIMITE_TRONCONS = 6000;
/** Un tronçon accroché à moins de cette distance (m) du bout d'un autre s'accroche à son nœud. */
const TOLERANCE_BOUT_M = 1.5;

type LigneTroncon = { [K in keyof TronconResume]: TronconResume[K] } & { geometry: { type: 'LineString'; coordinates: LonLat[] } };
type LigneNoeud = { [K in keyof NoeudResume]: NoeudResume[K] } & { geometry: { type: 'Point'; coordinates: LonLat } };

const COLONNES = sql`
  t.id, ST_AsGeoJSON(t.geom)::json AS geometry, t.nom, t.highway, t.voies_avant, t.voies_arriere, t.types_avant, t.types_arriere,
  t.emprises, t.vitesse_kmh, t.source, t.modifie, t.noeud_de, t.noeud_vers, nd.carrefour_id AS carrefour_de, nv.carrefour_id AS carrefour_vers,
  t.branche_de, t.branche_vers`;

const FROM_TRONCONS = sql`troncon t JOIN noeud nd ON nd.id = t.noeud_de JOIN noeud nv ON nv.id = t.noeud_vers`;

const COLONNES_NOEUD = sql`
  n.id, ST_AsGeoJSON(n.geom)::json AS geometry, n.carrefour_id, n.osm_node_id::float8 AS osm_node_id, n.liaisons, n.feux, n.pieton,
  (SELECT count(*)::int FROM troncon t WHERE NOT t.supprime AND (t.noeud_de = n.id OR t.noeud_vers = n.id)) AS degre`;

const enveloppe = ([minLon, minLat, maxLon, maxLat]: Bbox) => sql`ST_MakeEnvelope(${minLon}, ${minLat}, ${maxLon}, ${maxLat}, 4326)`;
const pointSql = ([lon, lat]: LonLat) => sql`ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)`;
const ligneSql = (points: readonly LonLat[]) => sql`ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify({ type: 'LineString', coordinates: points })}), 4326)`;
const typesSql = (types: TypesVoies | undefined) => (types ? JSON.stringify(types) : null);
const emprisesSql = (emprises: EmprisesTroncon | null) => (emprises && Object.keys(emprises).length > 0 ? JSON.stringify(emprises) : null);

const enFeature = ({ geometry, ...properties }: LigneTroncon) => ({ type: 'Feature' as const, id: properties.id, geometry, properties });
const enFeatureNoeud = ({ geometry, ...properties }: LigneNoeud) => ({ type: 'Feature' as const, id: properties.id, geometry, properties });

/** Types d'un sens ramenés à son nombre de voies ; null si toutes sont générales. */
function typesPour(nombre: number, types: readonly TypeVoieReseau[] | null | undefined): TypeVoieReseau[] | null {
  const retenus = Array.from({ length: nombre }, (_, rang) => types?.[rang] ?? 'generale');
  return retenus.every((t) => t === 'generale') ? null : retenus;
}

/**
 * Un tronçon OSM corrigé (ou supprimé) à la main garde cette trace : un nouvel import OSM ne doit
 * pas l'écraser. Ses moitiés, s'il a été coupé, partagent ses nœuds OSM d'origine : on les marque
 * ensemble.
 */
async function marquerModifie(db: Executeur, id: string): Promise<void> {
  await db.execute(sql`
    UPDATE troncon t SET modifie = true
    FROM troncon o
    WHERE o.id = ${id} AND t.source = 'osm'
      AND (t.id = o.id OR (t.osm_way_id, t.osm_de, t.osm_vers) = (o.osm_way_id, o.osm_de, o.osm_vers))
  `);
}

/** Les liaisons saisies à un nœud qui renvoyaient à un tronçon renvoient désormais à un autre. */
async function renvoyerLiaisons(db: Executeur, noeud: string, ancien: string, nouveau: string): Promise<void> {
  await db.execute(sql`
    UPDATE noeud SET liaisons = replace(liaisons::text, ${ancien}, ${nouveau})::jsonb
    WHERE id = ${noeud} AND liaisons IS NOT NULL
  `);
}

/** Réécrit les liaisons saisies d'un nœud (celles proposées par défaut, null, se recalculent seules). */
async function reecrireLiaisons(db: Executeur, noeud: string, changer: (liaisons: Liaison[] | null) => Liaison[] | null): Promise<void> {
  const { rows } = await db.execute<{ liaisons: Liaison[] | null }>(sql`SELECT liaisons FROM noeud WHERE id = ${noeud} FOR UPDATE`);
  const avant = rows[0]?.liaisons ?? null;
  if (!avant) return;
  await db.execute(sql`UPDATE noeud SET liaisons = ${JSON.stringify(changer(avant))}::jsonb WHERE id = ${noeud}`);
}

/** Nœuds voisins d'un nœud (à l'autre bout de ses tronçons) : leurs voies bougent avec lui. */
async function voisins(db: Executeur, noeud: string): Promise<string[]> {
  const { rows } = await db.execute<{ id: string }>(sql`
    SELECT CASE WHEN noeud_de = ${noeud} THEN noeud_vers ELSE noeud_de END AS id
    FROM troncon WHERE NOT supprime AND (noeud_de = ${noeud} OR noeud_vers = ${noeud})
  `);
  return rows.map((r) => r.id);
}

@Injectable()
export class ReseauService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly branches: BranchesService,
    private readonly lignes: LignesService,
    private readonly programme: ProgrammeService,
  ) {}

  /** Tronçons et nœuds de l'emprise. */
  async dansEmprise(bbox: Bbox): Promise<ReseauGeoJson> {
    const { rows: troncons } = await this.db.execute<LigneTroncon>(sql`
      SELECT ${COLONNES} FROM ${FROM_TRONCONS}
      WHERE NOT t.supprime AND t.geom && ${enveloppe(bbox)}
      LIMIT ${LIMITE_TRONCONS + 1}
    `);
    const { rows: noeuds } = await this.db.execute<LigneNoeud>(sql`
      SELECT ${COLONNES_NOEUD} FROM noeud n WHERE n.geom && ${enveloppe(bbox)}
      LIMIT ${LIMITE_TRONCONS * 2}
    `);
    return {
      troncons: { type: 'FeatureCollection', features: troncons.slice(0, LIMITE_TRONCONS).map(enFeature) },
      noeuds: {
        type: 'FeatureCollection',
        features: noeuds.filter((n) => n.degre > 0 || n.carrefour_id !== null).map(enFeatureNoeud),
      },
      tronque: troncons.length > LIMITE_TRONCONS,
    };
  }

  /** Liaisons voie à voie d'un nœud ; le carrefour dont il fait partie est recalculé. */
  async enregistrerLiaisons(noeudId: string, { liaisons }: SaisieLiaisons): Promise<{ liaisons: Liaison[] | null }> {
    return this.db.transaction(async (tx) => {
      const { rows: noeuds } = await tx.execute(sql`SELECT 1 FROM noeud WHERE id = ${noeudId}`);
      if (!noeuds[0]) throw new NotFoundException('Nœud inconnu');
      const { rows: autour } = await tx.execute<{
        id: string;
        noeud_de: string;
        noeud_vers: string;
        points: LonLat[];
        voies_avant: number;
        voies_arriere: number;
        types_avant: TypeVoieReseau[] | null;
        types_arriere: TypeVoieReseau[] | null;
      }>(sql`
        SELECT id, noeud_de, noeud_vers, (ST_AsGeoJSON(geom)::json)->'coordinates' AS points, voies_avant, voies_arriere,
               types_avant, types_arriere
        FROM troncon WHERE NOT supprime AND (noeud_de = ${noeudId} OR noeud_vers = ${noeudId})
      `);
      if (liaisons) {
        const retenues = liaisonsRetenues(boutsAuNoeud(noeudId, autour), liaisons).liaisons;
        if (retenues.length !== liaisons.length) throw new BadRequestException('Liaison vers un tronçon ou une voie qui n’arrive pas à ce nœud');
      }
      await tx.execute(sql`UPDATE noeud SET liaisons = ${liaisons ? JSON.stringify(liaisons) : null}::jsonb WHERE id = ${noeudId}`);
      await rafraichirCarrefours(tx, [noeudId]);
      return { liaisons };
    });
  }

  /** Semis depuis OSM (une seule fois, ou en effaçant tout), puis nœuds des carrefours retrouvés. */
  semer(reinitialiser: boolean): Promise<BilanSemis> {
    return this.db.transaction(async (tx) => {
      const bilan = await semerReseau(tx, { reinitialiser });
      return { ...bilan, carrefours: await rattacherTousLesCarrefours(tx) };
    });
  }

  /** Tronçon tracé à la main ; ses bouts s'accrochent à des nœuds, coupent des tronçons ou en créent. */
  async creer(nouveau: NouveauTroncon) {
    const id = await this.db.transaction(async (tx) => {
      const de = await this.accrocher(tx, nouveau.de, nouveau.points[0]!);
      const vers = await this.accrocher(tx, nouveau.vers, nouveau.points.at(-1)!);
      if (de.id === vers.id) throw new BadRequestException('Un tronçon relie deux nœuds différents');
      const points = [de.position, ...nouveau.points.slice(1, -1), vers.position];
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO troncon (noeud_de, noeud_vers, geom, nom, voies_avant, voies_arriere, types_avant, types_arriere, vitesse_kmh, source)
        VALUES (${de.id}, ${vers.id}, ${ligneSql(points)}, ${nouveau.nom}, ${nouveau.voies_avant}, ${nouveau.voies_arriere},
                ${typesSql(typesPour(nouveau.voies_avant, nouveau.types_avant))}::jsonb,
                ${typesSql(typesPour(nouveau.voies_arriere, nouveau.types_arriere))}::jsonb,
                ${nouveau.vitesse_kmh}, 'manuel')
        RETURNING id
      `);
      await rafraichirCarrefours(tx, [de.id, vers.id]);
      return rows[0]!.id;
    });
    return this.lire(this.db, id);
  }

  async modifier(id: string, modification: ModificationTroncon) {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{
        source: string;
        noeud_de: string;
        noeud_vers: string;
        voies_avant: number;
        voies_arriere: number;
        types_avant: TypeVoieReseau[] | null;
        types_arriere: TypeVoieReseau[] | null;
        emprises: EmprisesTroncon | null;
      }>(sql`
        SELECT source, noeud_de, noeud_vers, voies_avant, voies_arriere, types_avant, types_arriere, emprises
        FROM troncon WHERE id = ${id} AND NOT supprime FOR UPDATE
      `);
      const troncon = rows[0];
      if (!troncon) throw new NotFoundException('Tronçon inconnu');
      if (modification.inverser) {
        // PostgreSQL évalue tous les SET avec les anciennes valeurs : les échanges sont simultanés.
        await tx.execute(sql`
          UPDATE troncon SET geom = ST_Reverse(geom), noeud_de = noeud_vers, noeud_vers = noeud_de,
            voies_avant = voies_arriere, voies_arriere = voies_avant, types_avant = types_arriere, types_arriere = types_avant,
            branche_de = branche_vers, branche_vers = branche_de
          WHERE id = ${id}
        `);
      }
      const [avant, arriere] = modification.inverser
        ? [troncon.voies_arriere, troncon.voies_avant]
        : [troncon.voies_avant, troncon.voies_arriere];
      const [typesAvant, typesArriere] = modification.inverser
        ? [troncon.types_arriere, troncon.types_avant]
        : [troncon.types_avant, troncon.types_arriere];
      const nouveauxAvant = modification.voies_avant ?? avant;
      const nouveauxArriere = modification.voies_arriere ?? arriere;
      const champs: SQL[] = [];
      if (modification.nom !== undefined) champs.push(sql`nom = ${modification.nom}`);
      if (modification.voies_avant !== undefined) champs.push(sql`voies_avant = ${modification.voies_avant}`);
      if (modification.voies_arriere !== undefined) champs.push(sql`voies_arriere = ${modification.voies_arriere}`);
      if (modification.vitesse_kmh !== undefined) champs.push(sql`vitesse_kmh = ${modification.vitesse_kmh}`);
      // Les types suivent le nombre de voies : une voie ajoutée est générale, une voie retirée perd son type.
      if (modification.types_avant !== undefined || modification.voies_avant !== undefined) {
        champs.push(sql`types_avant = ${typesSql(typesPour(nouveauxAvant, modification.types_avant ?? typesAvant))}::jsonb`);
      }
      if (modification.types_arriere !== undefined || modification.voies_arriere !== undefined) {
        champs.push(sql`types_arriere = ${typesSql(typesPour(nouveauxArriere, modification.types_arriere ?? typesArriere))}::jsonb`);
      }
      let emprises = modification.inverser ? inverserEmprises(troncon.emprises) : troncon.emprises;
      if (modification.voie) {
        const { sens, rang } = modification.voie;
        const nombre = sens === 'avant' ? avant : arriere;
        const autre = sens === 'avant' ? arriere : avant;
        const types = sens === 'avant' ? typesAvant : typesArriere;
        const ajout = modification.voie.action === 'inserer';
        if (ajout && nombre >= 9) throw new BadRequestException('9 voies au plus par sens');
        if (!ajout && rang >= nombre) throw new BadRequestException('Aucune voie à ce rang');
        if (!ajout && nombre - 1 + autre === 0) throw new BadRequestException('Au moins une voie dans un sens');
        const position = Math.min(rang, nombre);
        const nouveaux = modification.voie.action === 'inserer' ? insererType(nombre, types, position, modification.voie.type) : retirerType(nombre, types, rang);
        const typesRetenus = typesSql(typesPour(nouveaux.length, nouveaux));
        champs.push(
          sens === 'avant'
            ? sql`voies_avant = ${nouveaux.length}, types_avant = ${typesRetenus}::jsonb`
            : sql`voies_arriere = ${nouveaux.length}, types_arriere = ${typesRetenus}::jsonb`,
        );
        // Les emprises et les liaisons saisies aux deux bouts suivent les rangs décalés.
        const decalage = ajout ? 1 : -1;
        emprises = decalerEmprises(emprises, sens, position, decalage);
        const bouts = boutsDuSens(troncon, sens);
        await reecrireLiaisons(tx, bouts.arrivent, (l) => decalerLiaisons(l, id, 'arrivent', position, decalage));
        await reecrireLiaisons(tx, bouts.repartent, (l) => decalerLiaisons(l, id, 'repartent', position, decalage));
      }
      if (modification.emprise) {
        const { sens, rang, polygone } = modification.emprise;
        const { [cleEmprise(sens, rang)]: _retiree, ...autres } = emprises ?? {};
        emprises = polygone ? { ...autres, [cleEmprise(sens, rang)]: polygone } : autres;
      }
      if (modification.voie || modification.emprise || modification.inverser) champs.push(sql`emprises = ${emprisesSql(emprises)}::jsonb`);
      if (modification.points) {
        // Les bouts restent sur leurs nœuds : seul le tracé entre eux change.
        champs.push(sql`geom = ST_SetPoint(ST_SetPoint(${ligneSql(modification.points)}, 0, ST_StartPoint(geom)), -1, ST_EndPoint(geom))`);
      }
      if (champs.length > 0) {
        try {
          await tx.execute(sql`UPDATE troncon SET ${sql.join(champs, sql`, `)}, modifie_le = now() WHERE id = ${id}`);
        } catch (erreur) {
          if ((erreur as { cause?: { code?: string } }).cause?.code === '23514') {
            throw new BadRequestException('Au moins une voie dans un sens');
          }
          throw erreur;
        }
      }
      if (troncon.source === 'osm') await marquerModifie(tx, id);
      await rafraichirCarrefours(tx, [troncon.noeud_de, troncon.noeud_vers]);
    });
    return this.lire(this.db, id);
  }

  /** Supprime un tronçon tracé à la main ; un tronçon OSM est masqué, pour garder la trace de la correction. */
  async supprimer(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ source: string; noeud_de: string; noeud_vers: string }>(sql`
        SELECT source, noeud_de, noeud_vers FROM troncon WHERE id = ${id} AND NOT supprime
      `);
      const troncon = rows[0];
      if (!troncon) throw new NotFoundException('Tronçon inconnu');
      if (troncon.source === 'osm') {
        await marquerModifie(tx, id);
        await tx.execute(sql`UPDATE troncon SET supprime = true WHERE id = ${id}`);
      } else {
        await tx.execute(sql`DELETE FROM troncon WHERE id = ${id}`);
      }
      await rafraichirCarrefours(tx, [troncon.noeud_de, troncon.noeud_vers]);
      await tx.execute(sql`
        DELETE FROM noeud n WHERE n.id IN (${troncon.noeud_de}, ${troncon.noeud_vers})
          AND n.carrefour_id IS NULL AND n.osm_node_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM troncon t WHERE t.noeud_de = n.id OR t.noeud_vers = n.id)
      `);
    });
  }

  /**
   * Déplace un nœud (les bouts de ses tronçons le suivent), change sa ligne d'arrêt à feux, son
   * passage piéton, ou le carrefour dont il fait partie. Les carrefours touchés sont recalculés.
   */
  async modifierNoeud(id: string, modification: ModificationNoeud) {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ carrefour_id: string | null }>(sql`SELECT carrefour_id FROM noeud WHERE id = ${id} FOR UPDATE`);
      if (!rows[0]) throw new NotFoundException('Nœud inconnu');
      const ancien = rows[0].carrefour_id;
      const champs: SQL[] = [];
      if (modification.position) champs.push(sql`geom = ${pointSql(modification.position)}`);
      if (modification.feux !== undefined) champs.push(sql`feux = ${modification.feux}`);
      if (modification.pieton !== undefined) champs.push(sql`pieton = ${modification.pieton}::traversee_pieton`);
      if (modification.carrefour_id !== undefined) {
        if (modification.carrefour_id) {
          const { rows: carrefour } = await tx.execute(sql`SELECT 1 FROM carrefour WHERE id = ${modification.carrefour_id}`);
          if (!carrefour[0]) throw new NotFoundException('Carrefour inconnu');
        }
        champs.push(sql`carrefour_id = ${modification.carrefour_id}`);
      }
      if (champs.length > 0) await tx.execute(sql`UPDATE noeud SET ${sql.join(champs, sql`, `)} WHERE id = ${id}`);
      if (modification.position) {
        await tx.execute(sql`UPDATE troncon SET geom = ST_SetPoint(geom, 0, ${pointSql(modification.position)}), modifie_le = now() WHERE noeud_de = ${id}`);
        await tx.execute(sql`UPDATE troncon SET geom = ST_SetPoint(geom, -1, ${pointSql(modification.position)}), modifie_le = now() WHERE noeud_vers = ${id}`);
        const { rows: osm } = await tx.execute<{ id: string }>(sql`
          SELECT id FROM troncon WHERE source = 'osm' AND (noeud_de = ${id} OR noeud_vers = ${id})
        `);
        for (const t of osm) await marquerModifie(tx, t.id);
      }
      await rafraichirCarrefours(tx, [id, ...(await voisins(tx, id))]);
      // Un carrefour qui perd son dernier nœud n'a plus de branches déduites.
      if (ancien && modification.carrefour_id !== undefined && modification.carrefour_id !== ancien && !(await materialiserCarrefour(tx, ancien))) {
        await tx.execute(sql`DELETE FROM branche WHERE carrefour_id = ${ancien}`);
      }
    });
    return this.lireNoeud(this.db, id);
  }

  /**
   * Coupe un tronçon au point le plus proche de `position` : nouveau nœud, voies et liaisons
   * gardées. Le nœud peut porter d'emblée une ligne d'arrêt à feux ou un passage piéton.
   */
  async couper(id: string, { position, feux, pieton }: CoupeTroncon) {
    const noeud = await this.db.transaction(async (tx) => {
      const coupe = await this.accrocher(tx, { type: 'troncon', id }, position);
      const champs: SQL[] = [];
      if (feux !== undefined) champs.push(sql`feux = ${feux}`);
      if (pieton !== undefined) champs.push(sql`pieton = ${pieton}::traversee_pieton`);
      if (champs.length > 0) await tx.execute(sql`UPDATE noeud SET ${sql.join(champs, sql`, `)} WHERE id = ${coupe.id}`);
      await rafraichirCarrefours(tx, [coupe.id, ...(await voisins(tx, coupe.id))]);
      return coupe.id;
    });
    return this.lireNoeud(this.db, noeud);
  }

  /**
   * Retire un nœud qui ne relie que deux tronçons de mêmes voies : ils n'en font plus qu'un
   * (l'inverse d'une coupe). 400 si le nœud est une intersection ou si les voies diffèrent.
   */
  async fusionner(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{
        id: string;
        noeud_de: string;
        noeud_vers: string;
        voies_avant: number;
        voies_arriere: number;
        types_avant: TypeVoieReseau[] | null;
        types_arriere: TypeVoieReseau[] | null;
        source: string;
        branche_de: string | null;
        branche_vers: string | null;
        emprises: EmprisesTroncon | null;
      }>(sql`
        SELECT id, noeud_de, noeud_vers, voies_avant, voies_arriere, types_avant, types_arriere, source, branche_de, branche_vers, emprises
        FROM troncon WHERE NOT supprime AND (noeud_de = ${id} OR noeud_vers = ${id})
        -- Le plus ancien reste : retirer le nœud d'une coupe rend au tronçon coupé son identifiant.
        ORDER BY cree_le, id
      `);
      if (rows.length !== 2) throw new BadRequestException('Seul un nœud entre deux tronçons se retire');
      // Chaque tronçon, orienté pour que le nœud soit entre `a` (qui y arrive, gardé) et `b` (qui en part, retiré).
      const [a, b] = [rows[0]!, rows[1]!].map((t) => ({ ...t, versLeNoeud: t.noeud_vers === id }));
      const sens = (t: typeof a, versLeNoeud: boolean) =>
        t.versLeNoeud === versLeNoeud
          ? { avant: t.voies_avant, arriere: t.voies_arriere, types_avant: t.types_avant, types_arriere: t.types_arriere }
          : { avant: t.voies_arriere, arriere: t.voies_avant, types_avant: t.types_arriere, types_arriere: t.types_avant };
      const [va, vb] = [sens(a!, true), sens(b!, false)];
      if (JSON.stringify(va) !== JSON.stringify(vb)) throw new BadRequestException('Les deux tronçons n’ont pas les mêmes voies : les égaliser avant');
      const debutA = a!.versLeNoeud ? sql`geom` : sql`ST_Reverse(geom)`;
      const debutB = b!.versLeNoeud ? sql`ST_Reverse(geom)` : sql`geom`;
      // Bouts éloignés : `a` garde le sien au début, celui de `b` devient la fin.
      const loinA = a!.versLeNoeud ? { noeud: a!.noeud_de, code: a!.branche_de } : { noeud: a!.noeud_vers, code: a!.branche_vers };
      const loinB = b!.versLeNoeud ? { noeud: b!.noeud_de, code: b!.branche_de } : { noeud: b!.noeud_vers, code: b!.branche_vers };
      if (loinA.noeud === loinB.noeud) throw new BadRequestException('Les deux tronçons relient les mêmes nœuds : impossible de les fusionner');
      // Emprises des deux moitiés, dans le sens du tronçon fusionné (un tronçon retourné échange avant et arrière).
      const orienter = (t: typeof a, versLeNoeud: boolean) => (t!.versLeNoeud === versLeNoeud ? t!.emprises : inverserEmprises(t!.emprises));
      const emprises = { ...orienter(b, false), ...orienter(a, true) };
      await tx.execute(sql`
        UPDATE troncon SET
          geom = ST_RemoveRepeatedPoints(ST_MakeLine(
            (SELECT ${debutA} FROM troncon WHERE id = ${a!.id}),
            (SELECT ${debutB} FROM troncon WHERE id = ${b!.id}))),
          noeud_de = ${loinA.noeud}, noeud_vers = ${loinB.noeud},
          voies_avant = ${va.avant}, voies_arriere = ${va.arriere},
          types_avant = ${typesSql(va.types_avant)}::jsonb, types_arriere = ${typesSql(va.types_arriere)}::jsonb,
          branche_de = ${loinA.code}, branche_vers = ${loinB.code},
          emprises = ${emprisesSql(emprises)}::jsonb,
          modifie_le = now()
        WHERE id = ${a!.id}
      `);
      await renvoyerLiaisons(tx, loinB.noeud, b!.id, a!.id);
      if (b!.source === 'osm') {
        await marquerModifie(tx, b!.id);
        await tx.execute(sql`UPDATE troncon SET supprime = true WHERE id = ${b!.id}`);
      } else await tx.execute(sql`DELETE FROM troncon WHERE id = ${b!.id}`);
      if (a!.source === 'osm') await marquerModifie(tx, a!.id);
      const { rows: bouts } = await tx.execute<{ noeud_de: string; noeud_vers: string }>(sql`SELECT noeud_de, noeud_vers FROM troncon WHERE id = ${a!.id}`);
      await tx.execute(sql`DELETE FROM noeud WHERE id = ${id} AND NOT EXISTS (SELECT 1 FROM troncon WHERE noeud_de = ${id} OR noeud_vers = ${id})`);
      await rafraichirCarrefours(tx, [bouts[0]!.noeud_de, bouts[0]!.noeud_vers]);
    });
  }

  /**
   * Réunit des nœuds en un seul (docs/pipeline-donnees.md, étape 10) : les tronçons entre deux
   * d'entre eux disparaissent (masqués s'ils viennent d'OSM), les autres sont raccordés au nœud
   * gardé, posé au barycentre. Il porte une ligne d'arrêt si l'un d'eux en portait une ; ses
   * liaisons repartent des propositions. Les autres nœuds sortent du carrefour, gardés pour la
   * provenance des tronçons masqués.
   */
  async fusionnerNoeuds(fusion: FusionNoeuds) {
    const garde = await this.db.transaction(async (tx) => {
      const ids = 'noeuds' in fusion ? [...new Set(fusion.noeuds)] : await this.noeudsAFusionner(tx, fusion.carrefour, fusion.coeur);
      if (ids.length < 2) throw new BadRequestException('Au moins deux nœuds à fusionner');
      const { rows } = await tx.execute<{ id: string; lon: number; lat: number; carrefour_id: string | null; feux: boolean; osm_node_id: number | null }>(sql`
        SELECT id, ST_X(geom) AS lon, ST_Y(geom) AS lat, carrefour_id, feux, osm_node_id::float8 AS osm_node_id
        FROM noeud WHERE id = ANY (${`{${ids.join(',')}}`}::uuid[]) ORDER BY osm_node_id NULLS LAST, id FOR UPDATE
      `);
      if (rows.length !== ids.length) throw new NotFoundException('Nœud inconnu');
      const carrefours = [...new Set(rows.flatMap((r) => (r.carrefour_id ? [r.carrefour_id] : [])))];
      if (carrefours.length > 1) throw new BadRequestException('Nœuds de carrefours différents : impossible de les fusionner');
      const position: LonLat = fusion.position ?? [rows.reduce((s, r) => s + r.lon, 0) / rows.length, rows.reduce((s, r) => s + r.lat, 0) / rows.length];
      const garde = rows[0]!.id;
      const liste = sql`${`{${ids.join(',')}}`}::uuid[]`;

      const { rows: touches } = await tx.execute<{ id: string; source: string; noeud_de: string; noeud_vers: string }>(sql`
        SELECT id, source, noeud_de, noeud_vers FROM troncon
        WHERE NOT supprime AND (noeud_de = ANY (${liste}) OR noeud_vers = ANY (${liste}))
      `);
      const dedans = new Set(ids);
      const voisinsExterieurs = new Set<string>();
      for (const t of touches) {
        if (t.source === 'osm') await marquerModifie(tx, t.id);
        if (dedans.has(t.noeud_de) && dedans.has(t.noeud_vers)) {
          if (t.source === 'osm') await tx.execute(sql`UPDATE troncon SET supprime = true WHERE id = ${t.id}`);
          else await tx.execute(sql`DELETE FROM troncon WHERE id = ${t.id}`);
          continue;
        }
        voisinsExterieurs.add(dedans.has(t.noeud_de) ? t.noeud_vers : t.noeud_de);
        if (dedans.has(t.noeud_de)) {
          await tx.execute(sql`UPDATE troncon SET noeud_de = ${garde}, geom = ST_SetPoint(geom, 0, ${pointSql(position)}), modifie_le = now() WHERE id = ${t.id}`);
        } else {
          await tx.execute(sql`UPDATE troncon SET noeud_vers = ${garde}, geom = ST_SetPoint(geom, -1, ${pointSql(position)}), modifie_le = now() WHERE id = ${t.id}`);
        }
      }
      await tx.execute(sql`
        UPDATE noeud SET geom = ${pointSql(position)}, feux = ${rows.some((r) => r.feux)}, pieton = NULL, liaisons = NULL,
          carrefour_id = ${carrefours[0] ?? null}
        WHERE id = ${garde}
      `);
      await tx.execute(sql`
        UPDATE noeud SET carrefour_id = NULL, liaisons = NULL WHERE id = ANY (${liste}) AND id <> ${garde}
      `);
      await rafraichirCarrefours(tx, [garde, ...voisinsExterieurs]);
      return garde;
    });
    return this.lireNoeud(this.db, garde);
  }

  /** Nœuds d'un carrefour à fusionner : tous, ou seulement son cœur (sans les nœuds d'approche). */
  private async noeudsAFusionner(tx: Executeur, carrefourId: string, coeur: boolean): Promise<string[]> {
    const { rows: noeuds } = await tx.execute<{ id: string }>(sql`SELECT id FROM noeud WHERE carrefour_id = ${carrefourId}`);
    if (noeuds.length === 0) throw new NotFoundException('Carrefour sans nœud sur le réseau');
    if (!coeur) return noeuds.map((n) => n.id);
    const liste = sql`${`{${noeuds.map((n) => n.id).join(',')}}`}::uuid[]`;
    const { rows: troncons } = await tx.execute<{ id: string; de: string; vers: string; voies_avant: number; voies_arriere: number; branche_de: string | null; branche_vers: string | null }>(sql`
      SELECT id, noeud_de AS de, noeud_vers AS vers, voies_avant, voies_arriere, branche_de, branche_vers FROM troncon
      WHERE NOT supprime AND (noeud_de = ANY (${liste}) OR noeud_vers = ANY (${liste}))
    `);
    const approches = noeudsApproche(noeuds.map((n) => ({ id: n.id, carrefour: carrefourId })), troncons);
    return noeuds.map((n) => n.id).filter((id) => !approches.has(id));
  }

  /** Fichiers SUMO plain XML du réseau (dans l'emprise, ou en entier). */
  async exporter(fichier: FichierSumo, bbox?: Bbox): Promise<string> {
    if (fichier === 'reseau.netccfg') return configurationNetconvert();
    const reseau = await donneesSumo(this.db, bbox);
    const sortie = exporterSumo({ ...reseau, carrefours: await this.carrefoursSumo(reseau.noeuds) });
    const alertes = sortie.alertes.map((a) => `<!-- ${a.replace(/--/g, '—')} -->`).join('\n');
    const avecAlertes = (xml: string) => (alertes ? xml.replace(/\n/, `\n${alertes}\n`) : xml);
    if (fichier === 'reseau.nod.xml') return avecAlertes(sortie.nod);
    return fichier === 'reseau.edg.xml' ? sortie.edg : fichier === 'reseau.tll.xml' ? sortie.tll : sortie.con;
  }

  /**
   * Carrefours de l'export, chacun en une jonction SUMO : leurs connexions (saisies ou proposées),
   * la ligne de feux véhicules de chaque mouvement, et leur programme retenu.
   */
  private async carrefoursSumo(noeuds: ReseauSumo['noeuds']): Promise<CarrefourSumo[]> {
    const presents = new Map<string, number>();
    for (const n of noeuds) if (n.carrefour) presents.set(n.carrefour, (presents.get(n.carrefour) ?? 0) + 1);
    // Un carrefour coupé par le bord de l'emprise exportée garde ses nœuds tels quels.
    const { rows: complets } = await this.db.execute<{ id: string; noeuds: number }>(sql`
      SELECT carrefour_id AS id, count(*)::int AS noeuds FROM noeud
      WHERE carrefour_id = ANY (${`{${[...presents.keys()].join(',')}}`}::uuid[]) GROUP BY carrefour_id
    `);
    const ids = complets.filter((c) => presents.get(c.id) === c.noeuds).map((c) => c.id);
    const carrefours: CarrefourSumo[] = [];
    for (const id of ids) {
      const { connexions } = await this.branches.lire(id);
      const { lignes } = await this.lignes.lire(id);
      const mouvements = lignes.filter((l) => typeLigne(l.signal) === 'vehicule').flatMap((l) => l.mouvements.map((m) => [m, l.code] as const));
      carrefours.push({ id, connexions, lignes: Object.fromEntries(mouvements), programme: await this.programme.retenuPourSumo(id) });
    }
    return carrefours;
  }

  private async lire(db: Executeur, id: string) {
    const { rows } = await db.execute<LigneTroncon>(sql`SELECT ${COLONNES} FROM ${FROM_TRONCONS} WHERE t.id = ${id}`);
    if (!rows[0]) throw new NotFoundException('Tronçon inconnu');
    return enFeature(rows[0]);
  }

  private async lireNoeud(db: Executeur, id: string) {
    const { rows } = await db.execute<LigneNoeud>(sql`SELECT ${COLONNES_NOEUD} FROM noeud n WHERE n.id = ${id}`);
    if (!rows[0]) throw new NotFoundException('Nœud inconnu');
    return enFeatureNoeud(rows[0]);
  }

  /** Nœud où accrocher un bout de tronçon : existant, nouveau, ou créé en coupant un tronçon. */
  private async accrocher(tx: Executeur, accroche: Accroche, point: LonLat): Promise<{ id: string; position: LonLat }> {
    if (accroche.type === 'noeud') {
      const { rows } = await tx.execute<{ id: string; lon: number; lat: number }>(sql`
        SELECT id, ST_X(geom) AS lon, ST_Y(geom) AS lat FROM noeud WHERE id = ${accroche.id}
      `);
      if (!rows[0]) throw new NotFoundException('Nœud inconnu');
      return { id: rows[0].id, position: [rows[0].lon, rows[0].lat] };
    }
    if (accroche.type === 'libre') {
      const { rows } = await tx.execute<{ id: string }>(sql`INSERT INTO noeud (geom) VALUES (${pointSql(point)}) RETURNING id`);
      return { id: rows[0]!.id, position: point };
    }
    const { rows } = await tx.execute<{
      source: string;
      noeud_de: string;
      noeud_vers: string;
      carrefour: string | null;
      f: number;
      longueur: number;
      lon: number;
      lat: number;
      points: LonLat[];
      emprises: EmprisesTroncon | null;
    }>(sql`
      SELECT source, noeud_de, noeud_vers, f, ST_Length(geom::geography) AS longueur,
             (ST_AsGeoJSON(geom)::json)->'coordinates' AS points, emprises,
             -- Coupé entre deux nœuds du même carrefour, le nouveau nœud en fait partie.
             (SELECT nd.carrefour_id FROM noeud nd JOIN noeud nv ON nv.id = t.noeud_vers
              WHERE nd.id = t.noeud_de AND nd.carrefour_id = nv.carrefour_id) AS carrefour,
             ST_X(ST_LineInterpolatePoint(geom, f)) AS lon, ST_Y(ST_LineInterpolatePoint(geom, f)) AS lat
      FROM (SELECT *, ST_LineLocatePoint(geom, ${pointSql(point)}) AS f FROM troncon WHERE id = ${accroche.id} AND NOT supprime) t
    `);
    const coupe = rows[0];
    if (!coupe) throw new NotFoundException('Tronçon inconnu');
    const bout = async (noeud: string) => this.accrocher(tx, { type: 'noeud', id: noeud }, point);
    if (coupe.f * coupe.longueur < TOLERANCE_BOUT_M) return bout(coupe.noeud_de);
    if ((1 - coupe.f) * coupe.longueur < TOLERANCE_BOUT_M) return bout(coupe.noeud_vers);

    const position: LonLat = [coupe.lon, coupe.lat];
    const { rows: noeud } = await tx.execute<{ id: string }>(sql`
      INSERT INTO noeud (geom, carrefour_id) VALUES (${pointSql(position)}, ${coupe.carrefour}) RETURNING id
    `);
    const milieu = noeud[0]!.id;
    // Chaque emprise reste sur la moitié où elle est posée.
    const [emprisesDebut, emprisesSuite] = partagerEmprises(coupe.emprises, coupe.points, coupe.f);
    const { rows: suite } = await tx.execute<{ id: string }>(sql`
      INSERT INTO troncon (noeud_de, noeud_vers, geom, osm_way_id, osm_de, osm_vers, osm_tags, nom, highway, voies_avant, voies_arriere,
                           types_avant, types_arriere, emprises, vitesse_kmh, source, modifie, branche_vers)
      SELECT ${milieu}, noeud_vers, ST_LineSubstring(geom, ${coupe.f}, 1), osm_way_id, osm_de, osm_vers, osm_tags, nom, highway,
             voies_avant, voies_arriere, types_avant, types_arriere, ${emprisesSql(emprisesSuite)}::jsonb, vitesse_kmh, source, modifie,
             branche_vers
      FROM troncon WHERE id = ${accroche.id}
      RETURNING id
    `);
    // Au bout `vers`, c'est désormais la seconde moitié qui arrive.
    await renvoyerLiaisons(tx, coupe.noeud_vers, accroche.id, suite[0]!.id);
    await tx.execute(sql`
      UPDATE troncon SET geom = ST_LineSubstring(geom, 0, ${coupe.f}), noeud_vers = ${milieu}, branche_vers = NULL,
        emprises = ${emprisesSql(emprisesDebut)}::jsonb
      WHERE id = ${accroche.id}
    `);
    if (coupe.source === 'osm') await marquerModifie(tx, accroche.id);
    return { id: milieu, position };
  }
}

/** Réseau à exporter : tronçons de l'emprise et leurs nœuds, avec le carrefour de chacun. */
export async function donneesSumo(db: Executeur, bbox?: Bbox): Promise<ReseauSumo> {
  const { rows: troncons } = await db.execute<{
    id: string;
    de: string;
    vers: string;
    points: LonLat[];
    voies_avant: number;
    voies_arriere: number;
    types_avant: TypeVoieReseau[] | null;
    types_arriere: TypeVoieReseau[] | null;
    vitesse_kmh: number | null;
    nom: string | null;
    highway: string | null;
    branche_de: string | null;
    branche_vers: string | null;
    emprises: EmprisesTroncon | null;
  }>(sql`
    SELECT t.id, t.noeud_de AS de, t.noeud_vers AS vers, (ST_AsGeoJSON(t.geom)::json)->'coordinates' AS points,
           t.voies_avant, t.voies_arriere, t.types_avant, t.types_arriere, t.vitesse_kmh, t.nom, t.highway,
           t.branche_de, t.branche_vers, t.emprises
    FROM troncon t
    WHERE NOT t.supprime ${bbox ? sql`AND t.geom && ${enveloppe(bbox)}` : sql``}
    ORDER BY t.id
  `);
  const idsNoeuds = [...new Set(troncons.flatMap((t) => [t.de, t.vers]))];
  const { rows: noeuds } = await db.execute<{ id: string; lon: number; lat: number; carrefour_id: string | null; liaisons: Liaison[] | null }>(sql`
    SELECT n.id, ST_X(n.geom) AS lon, ST_Y(n.geom) AS lat, n.carrefour_id, n.liaisons
    FROM noeud n
    WHERE n.id = ANY (${`{${idsNoeuds.join(',')}}`}::uuid[])
  `);
  return {
    noeuds: noeuds.map((n) => ({ id: n.id, position: [n.lon, n.lat], carrefour: n.carrefour_id, liaisons: n.liaisons })),
    troncons,
  };
}
