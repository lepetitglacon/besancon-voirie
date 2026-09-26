import { Controller, Get, Query } from '@nestjs/common';
import { BboxQuery, type Bbox } from '@voirie/schema';
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
}
