import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';
import { AnalysesIaController } from './ia/analyses-ia.controller.js';
import { FileIaService } from './ia/file-ia.service.js';
import { IaService } from './ia/ia.service.js';

@Module({
  controllers: [BranchesController, AnalysesIaController],
  providers: [BranchesService, IaService, FileIaService],
  exports: [BranchesService],
})
export class BranchesModule {}
