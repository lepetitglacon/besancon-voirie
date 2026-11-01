import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module.js';
import { LignesModule } from '../lignes/lignes.module.js';
import { ProgrammeModule } from '../programme/programme.module.js';
import { RelevesModule } from '../releves/releves.module.js';
import { TempsReelModule } from '../temps-reel/temps-reel.module.js';
import { FicheController } from './fiche.controller.js';
import { FicheService } from './fiche.service.js';

@Module({
  imports: [BranchesModule, LignesModule, ProgrammeModule, TempsReelModule, RelevesModule],
  controllers: [FicheController],
  providers: [FicheService],
})
export class FicheModule {}
