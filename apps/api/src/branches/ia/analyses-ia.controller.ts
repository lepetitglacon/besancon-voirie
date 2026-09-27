import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { EditionGuard } from '../../common/edition.guard.js';
import { FileIaService } from './file-ia.service.js';

/** File des propositions « OSM + IA » : suivi, résultat, consultation. */
@Controller('analyses-ia')
export class AnalysesIaController {
  constructor(private readonly file: FileIaService) {}

  @Get()
  lister() {
    return this.file.lister();
  }

  /** L'analyse avec sa proposition (DetectionBranchesIa) une fois terminée. */
  @Get(':id')
  lire(@Param('id', ParseUUIDPipe) id: string) {
    return this.file.lire(id);
  }

  /** Proposition chargée dans l'éditeur : plus de notification. */
  @Put(':id/consultee')
  @UseGuards(EditionGuard)
  marquerConsultee(@Param('id', ParseUUIDPipe) id: string) {
    return this.file.marquerConsultee(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(EditionGuard)
  retirer(@Param('id', ParseUUIDPipe) id: string) {
    return this.file.retirer(id);
  }
}
