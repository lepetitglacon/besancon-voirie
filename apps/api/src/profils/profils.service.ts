import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { largeurRue, repartitionParMode, tronconVersRue, type EmprisesTroncon, type LonLat, type TypeVoieReseau } from '@voirie/engine';
import type { ModificationProfil, NouveauProfil, Profil, ProfilTroncon, RattachementProfil, RueStreetmix } from '@voirie/schema';
import { sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { tableExiste, uuids, type Executeur } from '../db/sql.js';

/** Dossier des PNG (PROFILS_DOSSIER), relatif au dossier de l'API : `data/profils` à la racine du projet. */
const DOSSIER_DEFAUT = '../../data/profils';
/** Au-delà, les voisins de la même rue ne sont plus cherchés (rue très découpée, ou boucle). */
const VOISINS_MAX = 200;
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type LigneProfil = {
  id: string;
  nom: string | null;
  rue: RueStreetmix;
  largeur_m: number;
  image_le: string | null;
  troncons: number;
  cree_le: string;
  modifie_le: string;
};

const COLONNES_PROFIL = sql`
  p.id, p.nom, p.rue, p.largeur_m, p.image_le, p.cree_le, p.modifie_le,
  (SELECT count(*)::int FROM troncon t WHERE t.profil_theorique_id = p.id AND NOT t.supprime) AS troncons`;

function enProfil(ligne: LigneProfil): Profil {
  const { image_le, ...reste } = ligne;
  return { ...reste, image: image_le ? `/api/profils/${ligne.id}/image?v=${new Date(image_le).getTime()}` : null };
}

/** PNG reçu par multipart (champ `image`). */
export interface ImageRecue {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/**
 * Profils en travers théoriques dessinés dans Streetmix — docs/integration-streetmix.md. Un
 * profil est vu depuis le début de son tronçon de référence ; chaque tronçon qui le suit dit s'il
 * le lit depuis son autre bout (`profil_inverse`).
 */
@Injectable()
export class ProfilsService {
  private readonly dossier: string;

  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    config: ConfigService,
  ) {
    this.dossier = resolve(config.get<string>('PROFILS_DOSSIER') || DOSSIER_DEFAUT);
  }

  private cheminImage(id: string): string {
    return resolve(this.dossier, `${id}.png`);
  }

  async lire(id: string, db: Executeur = this.db): Promise<Profil> {
    const { rows } = await db.execute<LigneProfil>(sql`SELECT ${COLONNES_PROFIL} FROM profil p WHERE p.id = ${id}`);
    if (!rows[0]) throw new NotFoundException('Profil inconnu');
    return enProfil(rows[0]);
  }

  /** Chemin du PNG d'un profil ; 404 s'il n'en a pas. */
  async image(id: string): Promise<string> {
    const chemin = this.cheminImage(id);
    const present = await stat(chemin).then(
      (s) => s.isFile(),
      () => false,
    );
    if (!present) throw new NotFoundException('Pas d’image pour ce profil');
    return chemin;
  }

  /** Profil théorique d'un tronçon, profil estimé d'après ses voies, voisins de la même rue. */
  async pourTroncon(tronconId: string): Promise<ProfilTroncon> {
    const avecOsm = await tableExiste(this.db, 'osm_way');
    const { rows } = await this.db.execute<{
      points: LonLat[];
      voies_avant: number;
      voies_arriere: number;
      types_avant: TypeVoieReseau[] | null;
      types_arriere: TypeVoieReseau[] | null;
      emprises: EmprisesTroncon | null;
      highway: string | null;
      osm_tags: Record<string, string> | null;
      sens_osm: boolean | null;
      profil_theorique_id: string | null;
      profil_inverse: boolean;
    }>(sql`
      SELECT (ST_AsGeoJSON(t.geom)::json)->'coordinates' AS points, t.voies_avant, t.voies_arriere, t.types_avant, t.types_arriere,
             t.emprises, t.highway, t.osm_tags, t.profil_theorique_id, t.profil_inverse,
             ${
               avecOsm
                 ? sql`(SELECT ST_LineLocatePoint(w.geom, ST_StartPoint(t.geom)) < ST_LineLocatePoint(w.geom, ST_EndPoint(t.geom))
                        FROM osm_way w WHERE w.osm_id = t.osm_way_id)`
                 : sql`NULL::boolean`
             } AS sens_osm
      FROM troncon t WHERE t.id = ${tronconId} AND NOT t.supprime
    `);
    const t = rows[0];
    if (!t) throw new NotFoundException('Tronçon inconnu');
    const estime = tronconVersRue({ ...t, tags: t.osm_tags, sensOsm: t.sens_osm }) as RueStreetmix;
    const profil = t.profil_theorique_id ? await this.lire(t.profil_theorique_id) : null;
    return {
      troncon: tronconId,
      profil,
      inverse: t.profil_inverse,
      estime,
      voisins: await this.voisins(tronconId),
      repartition: { theorique: profil ? repartitionParMode(profil.rue) : null, estime: repartitionParMode(estime) },
    };
  }

  /**
   * Tronçons de la même rue (même nom), dans la continuité de part et d'autre : on avance tant
   * qu'un seul tronçon du même nom prolonge le dernier. `inverse` : tracé dans l'autre sens que
   * le tronçon de départ.
   */
  private async voisins(tronconId: string): Promise<RattachementProfil[]> {
    const { rows } = await this.db.execute<{ id: string; noeud_de: string; noeud_vers: string }>(sql`
      SELECT o.id, o.noeud_de, o.noeud_vers FROM troncon o JOIN troncon t ON t.id = ${tronconId}
      WHERE NOT o.supprime AND o.nom IS NOT NULL AND o.nom = t.nom
    `);
    const depart = rows.find((r) => r.id === tronconId);
    if (!depart) return [];
    const parNoeud = new Map<string, typeof rows>();
    for (const r of rows) for (const n of [r.noeud_de, r.noeud_vers]) parNoeud.set(n, [...(parNoeud.get(n) ?? []), r]);
    const trouves = new Map<string, boolean>([[tronconId, false]]);
    // Depuis chaque bout du départ : `memeSens` vrai si l'on avance dans le sens du tracé du départ.
    for (const [noeudInitial, memeSensInitial] of [
      [depart.noeud_vers, true],
      [depart.noeud_de, false],
    ] as const) {
      let noeud = noeudInitial;
      let precedent = tronconId;
      while (trouves.size < VOISINS_MAX) {
        const suites = (parNoeud.get(noeud) ?? []).filter((r) => r.id !== precedent);
        if (suites.length !== 1 || trouves.has(suites[0]!.id)) break;
        const suite = suites[0]!;
        // En avançant dans le sens du départ, un tronçon qui part du nœud est tracé dans le même sens.
        const partDuNoeud = suite.noeud_de === noeud;
        trouves.set(suite.id, memeSensInitial ? !partDuNoeud : partDuNoeud);
        noeud = partDuNoeud ? suite.noeud_vers : suite.noeud_de;
        precedent = suite.id;
      }
    }
    trouves.delete(tronconId);
    return [...trouves].map(([id, inverse]) => ({ id, inverse }));
  }

  async creer(nouveau: NouveauProfil, image: ImageRecue | undefined): Promise<Profil> {
    const png = this.verifierImage(image);
    const id = await this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO profil (nom, rue, largeur_m, image_le)
        VALUES (${nouveau.nom}, ${JSON.stringify(nouveau.rue)}::jsonb, ${largeurRue(nouveau.rue)}, ${png ? sql`now()` : null})
        RETURNING id
      `);
      const id = rows[0]!.id;
      await this.rattacher(tx, id, nouveau.troncons);
      return id;
    });
    if (png) await this.ecrireImage(id, png);
    return this.lire(id);
  }

  async modifier(id: string, modification: ModificationProfil, image: ImageRecue | undefined): Promise<Profil> {
    const png = this.verifierImage(image);
    await this.db.transaction(async (tx) => {
      const { rowCount } = await tx.execute(sql`
        UPDATE profil SET rue = ${JSON.stringify(modification.rue)}::jsonb, largeur_m = ${largeurRue(modification.rue)},
          ${modification.nom !== undefined ? sql`nom = ${modification.nom},` : sql``}
          ${png ? sql`image_le = now(),` : sql``}
          modifie_le = now()
        WHERE id = ${id}
      `);
      if (!rowCount) throw new NotFoundException('Profil inconnu');
      await this.rattacher(tx, id, modification.troncons);
    });
    if (png) await this.ecrireImage(id, png);
    return this.lire(id);
  }

  /** Le tronçon ne suit plus ce profil ; un profil que plus aucun tronçon ne suit est supprimé, avec son image. */
  async detacher(id: string, tronconId: string): Promise<void> {
    const supprime = await this.db.transaction(async (tx) => {
      const { rowCount } = await tx.execute(sql`
        UPDATE troncon SET profil_theorique_id = NULL, profil_inverse = false, modifie_le = now()
        WHERE id = ${tronconId} AND profil_theorique_id = ${id}
      `);
      if (!rowCount) throw new NotFoundException('Ce tronçon ne suit pas ce profil');
      const { rows } = await tx.execute<{ id: string }>(sql`
        DELETE FROM profil p WHERE p.id = ${id} AND NOT EXISTS (SELECT 1 FROM troncon t WHERE t.profil_theorique_id = p.id)
        RETURNING id
      `);
      return rows.length > 0;
    });
    if (supprime) await rm(this.cheminImage(id), { force: true });
  }

  private async rattacher(tx: Executeur, id: string, troncons: readonly RattachementProfil[]): Promise<void> {
    if (troncons.length === 0) return;
    const ids = troncons.map((t) => t.id);
    const { rows } = await tx.execute<{ id: string }>(sql`SELECT id FROM troncon WHERE id = ANY (${uuids(ids)}) AND NOT supprime`);
    if (rows.length !== new Set(ids).size) throw new NotFoundException('Tronçon inconnu');
    const inverses = troncons.filter((t) => t.inverse).map((t) => t.id);
    await tx.execute(sql`
      UPDATE troncon SET profil_theorique_id = ${id}, profil_inverse = (id = ANY (${uuids(inverses)})), modifie_le = now()
      WHERE id = ANY (${uuids(ids)})
    `);
  }

  private verifierImage(image: ImageRecue | undefined): Buffer | null {
    if (!image) return null;
    if (image.mimetype !== 'image/png' || !image.buffer.subarray(0, 8).equals(SIGNATURE_PNG)) {
      throw new BadRequestException('L’image du profil doit être un PNG');
    }
    return image.buffer;
  }

  private async ecrireImage(id: string, png: Buffer): Promise<void> {
    await mkdir(this.dossier, { recursive: true });
    await writeFile(this.cheminImage(id), png);
  }
}
