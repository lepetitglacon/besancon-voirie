import { Module } from '@nestjs/common';
import { BranchesModule } from '../branches/branches.module.js';
import { LignesController } from './lignes.controller.js';
import { LignesService } from './lignes.service.js';

@Module({
  imports: [BranchesModule],
  controllers: [LignesController],
  providers: [LignesService],
})
export class LignesModule {}
