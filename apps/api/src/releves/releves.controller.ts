import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { EnvoiReleve } from '@voirie/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RelevesService } from './releves.service.js';

@Controller()
export class RelevesController {
  constructor(private readonly releves: RelevesService) {}

  /** POST /api/releves : relevé terrain, anonyme, enregistré en attente de modération. */
  @Post('releves')
  @HttpCode(202)
  recevoir(@Body(new ZodValidationPipe(EnvoiReleve)) envoi: EnvoiReleve) {
    return this.releves.recevoir(envoi);
  }

  @Get('carrefours/:id/releves')
  duCarrefour(@Param('id', ParseUUIDPipe) id: string) {
    return this.releves.duCarrefour(id);
  }
}
