import { createReadStream } from 'node:fs';
import { access, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Controller, Get, Header, NotFoundException, Param, StreamableFile } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MOTIF_ID_ESSAI, type EssaiSumo, type EssaiSumoResume } from '@voirie/schema';

/**
 * Essais SUMO de la ville, produits hors de l'API par `data/sumo/ville/` (`./simuler.sh`, qui
 * appelle `essai.py`) dans `essais/<id>/`. Dossier réglable par `SUMO_VILLE_DIR`.
 */
@Controller('sumo/essais')
export class SumoController {
  private readonly dossier: string;

  constructor(config: ConfigService) {
    this.dossier = resolve(config.get<string>('SUMO_VILLE_DIR', '../../data/sumo/ville'), 'essais');
  }

  /** GET /api/sumo/essais : essais archivés, du plus récent au plus ancien. */
  @Get()
  async liste(): Promise<EssaiSumoResume[]> {
    const ids = await readdir(this.dossier).catch(() => [] as string[]);
    const essais = await Promise.all(
      ids.filter((id) => MOTIF_ID_ESSAI.test(id)).map((id) => this.lireMeta(id).catch(() => null)),
    );
    return essais
      .filter((essai) => essai !== null)
      .map(({ series: _series, globales: _globales, parametres: _parametres, vehicules: _vehicules, ...resume }) => resume)
      .sort((a, b) => b.cree.localeCompare(a.cree));
  }

  /** GET /api/sumo/essais/:id : résumé, format des séries et courbes de la ville. */
  @Get(':id')
  essai(@Param('id') id: string): Promise<EssaiSumo> {
    return this.lireMeta(id);
  }

  /** GET /api/sumo/essais/:id/troncons : tronçons empruntés (GeoJSON) et leurs agrégats. */
  @Get(':id/troncons')
  @Header('Content-Type', 'application/geo+json')
  async troncons(@Param('id') id: string): Promise<StreamableFile> {
    return new StreamableFile(createReadStream(await this.fichier(id, 'troncons.geojson')));
  }

  /** GET /api/sumo/essais/:id/series : mesures par tranche et par tronçon (uint16, gzip). */
  @Get(':id/series')
  @Header('Content-Type', 'application/octet-stream')
  @Header('Content-Encoding', 'gzip')
  async series(@Param('id') id: string): Promise<StreamableFile> {
    return new StreamableFile(createReadStream(await this.fichier(id, 'series.bin.gz')));
  }

  /**
   * GET /api/sumo/essais/:id/vehicules : itinéraire et heures de sortie de chaque voiture (binaire,
   * gzip ; format dans data/sumo/ville/essai.py).
   */
  @Get(':id/vehicules')
  @Header('Content-Type', 'application/octet-stream')
  @Header('Content-Encoding', 'gzip')
  async vehicules(@Param('id') id: string): Promise<StreamableFile> {
    return new StreamableFile(createReadStream(await this.fichier(id, 'vehicules.bin.gz')));
  }

  private async lireMeta(id: string): Promise<EssaiSumo> {
    return JSON.parse(await readFile(await this.fichier(id, 'meta.json'), 'utf8')) as EssaiSumo;
  }

  /** Chemin d'un fichier de l'essai ; 404 si l'essai ou le fichier n'existe pas. */
  private async fichier(id: string, nom: string): Promise<string> {
    const chemin = resolve(this.dossier, id, nom);
    if (!MOTIF_ID_ESSAI.test(id) || !(await access(chemin).then(() => true, () => false))) {
      throw new NotFoundException(`Essai SUMO « ${id} » introuvable`);
    }
    return chemin;
  }
}
