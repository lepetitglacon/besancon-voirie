import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module.js';
import { LignesModule } from '../lignes/lignes.module.js';
import { ProgrammeModule } from '../programme/programme.module.js';
import { ReseauController } from './reseau.controller.js';
import { ReseauService } from './reseau.service.js';

/** Réseau routier (nœuds, tronçons, liaisons voie à voie) et export SUMO — docs/RESEAU.md. */
@Module({
  // Export SUMO : connexions, lignes de feux et programme de chaque carrefour.
  imports: [BranchesModule, LignesModule, ProgrammeModule],
  controllers: [ReseauController],
  providers: [ReseauService],
})
export class ReseauModule {}
