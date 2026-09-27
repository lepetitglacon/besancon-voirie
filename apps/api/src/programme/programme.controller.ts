import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from '@nestjs/common';
import { ConfigurationProgramme } from '@voirie/schema';
import { EditionGuard } from '../common/edition.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProgrammeService } from './programme.service.js';

@Controller('carrefours/:id/programme')
export class ProgrammeController {
  constructor(private readonly programme: ProgrammeService) {}

  @Get()
  lire(@Param('id', ParseUUIDPipe) id: string) {
    return this.programme.lire(id);
  }

  @Put()
  @UseGuards(EditionGuard)
  enregistrer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfigurationProgramme)) configuration: ConfigurationProgramme,
  ) {
    return this.programme.enregistrer(id, configuration);
  }
}
