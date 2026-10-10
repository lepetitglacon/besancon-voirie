import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module.js';
import { LignesModule } from '../lignes/lignes.module.js';
import { ProgrammeController } from './programme.controller.js';
import { ProgrammeService } from './programme.service.js';

@Module({
  imports: [BranchesModule, LignesModule],
  controllers: [ProgrammeController],
  providers: [ProgrammeService],
  exports: [ProgrammeService],
})
export class ProgrammeModule {}
