import { Module } from '@nestjs/common';
import { BranchesController } from './branches.controller.js';
import { BranchesService } from './branches.service.js';
import { IaService } from './ia/ia.service.js';

@Module({
  controllers: [BranchesController],
  providers: [BranchesService, IaService],
  exports: [BranchesService],
})
export class BranchesModule {}
