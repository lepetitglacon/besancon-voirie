import { Controller, Get, Query } from '@nestjs/common';
import { BboxQuery, type Bbox } from '@voirie/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CarrefoursService } from './carrefours.service.js';

@Controller('carrefours')
export class CarrefoursController {
  constructor(private readonly carrefours: CarrefoursService) {}

  /** GET /api/carrefours?bbox=minLon,minLat,maxLon,maxLat */
  @Get()
  dansEmprise(@Query('bbox', new ZodValidationPipe(BboxQuery)) bbox: Bbox) {
    return this.carrefours.dansEmprise(bbox);
  }
}
