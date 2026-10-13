import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { EnregistrementZoneOsm } from '@voirie/schema';
import { z } from 'zod';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { OsmService } from './osm.service.js';

const Longitude = z.coerce.number().min(-180).max(180);
const Latitude = z.coerce.number().min(-90).max(90);

@Controller('osm')
export class OsmController {
  constructor(private readonly osm: OsmService) {}

  /** GET /api/osm/zone : zone d'import, dernier import, feux, import en cours. */
  @Get('zone')
  zone() {
    return this.osm.lire();
  }

  /** PUT /api/osm/zone { polygones, source } : prise en compte au prochain import. */
  @Put('zone')
  @UseGuards(EditionGuard)
  enregistrer(@Body(new ZodValidationPipe(EnregistrementZoneOsm)) zone: EnregistrementZoneOsm) {
    return this.osm.enregistrer(zone);
  }

  /** DELETE /api/osm/zone : plus de zone, l'import suivant revient à la commune de Besançon. */
  @Delete('zone')
  @UseGuards(EditionGuard)
  supprimer() {
    return this.osm.supprimer();
  }

  /** GET /api/osm/contours?lon=&lat= : contours administratifs qui contiennent le point (Overpass). */
  @Get('contours')
  contoursAuPoint(@Query('lon', new ZodValidationPipe(Longitude)) lon: number, @Query('lat', new ZodValidationPipe(Latitude)) lat: number) {
    return this.osm.contoursAuPoint(lon, lat);
  }

  /** GET /api/osm/contours/:id : contour d'une relation OSM, élargi et simplifié (Overpass). */
  @Get('contours/:id')
  contour(@Param('id', ParseIntPipe) id: number) {
    return this.osm.contour(id);
  }

  /** POST /api/osm/import : télécharge les feux de la zone et les synchronise, en tâche de fond. */
  @Post('import')
  @HttpCode(202)
  @UseGuards(EditionGuard)
  importer() {
    return this.osm.lancerImport();
  }
}
