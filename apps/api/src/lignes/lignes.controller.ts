import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ConfigurationLignes } from '@voirie/schema';
import { Peut } from '../auth/acces.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { LignesService } from './lignes.service.js';

@Controller('carrefours/:id/lignes')
export class LignesController {
  constructor(private readonly lignes: LignesService) {}

  @Get()
  lire(@Param('id', ParseUUIDPipe) id: string) {
    return this.lignes.lire(id);
  }

  @Put()
  @Peut('update', 'LigneFeux')
  enregistrer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfigurationLignes)) configuration: ConfigurationLignes,
  ) {
    return this.lignes.enregistrer(id, configuration);
  }
}
