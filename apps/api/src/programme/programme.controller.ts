import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { ConfigurationProgramme } from '@voirie/schema';
import { Peut } from '../auth/acces.js';
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
  @Peut('update', 'Programme')
  enregistrer(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfigurationProgramme)) configuration: ConfigurationProgramme,
  ) {
    return this.programme.enregistrer(id, configuration);
  }
}
