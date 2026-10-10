import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module.js';
import { LignesModule } from '../lignes/lignes.module.js';
import { ProgrammeModule } from '../programme/programme.module.js';
import { MaturiteController } from './maturite.controller.js';
import { MaturiteService } from './maturite.service.js';

@Module({
  imports: [BranchesModule, LignesModule, ProgrammeModule],
  controllers: [MaturiteController],
  providers: [MaturiteService],
})
export class MaturiteModule {}
