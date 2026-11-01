import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { BboxQuery, PlacementFeu, type Bbox } from '@voirie/schema';
import { Peut } from '../auth/acces.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FeuxService } from './feux.service.js';

@Controller('feux')
export class FeuxController {
  constructor(private readonly feux: FeuxService) {}

  /** GET /api/feux?bbox=minLon,minLat,maxLon,maxLat */
  @Get()
  dansEmprise(@Query('bbox', new ZodValidationPipe(BboxQuery)) bbox: Bbox) {
    return this.feux.dansEmprise(bbox);
  }

  /** PUT /api/feux/:id/position { position: [lon, lat] | null } : sur son mât, ou retour à OSM. */
  @Put(':id/position')
  @Peut('update', 'Feu')
  placer(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(PlacementFeu)) placement: PlacementFeu) {
    return this.feux.placer(id, placement);
  }
}
