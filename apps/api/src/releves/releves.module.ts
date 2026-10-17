import { Module } from '@nestjs/common';
import { ProgrammeModule } from '../programme/programme.module.js';
import { RelevesController } from './releves.controller.js';
import { RelevesService } from './releves.service.js';

@Module({
  imports: [ProgrammeModule],
  controllers: [RelevesController],
  providers: [RelevesService],
  exports: [RelevesService],
})
export class RelevesModule {}
