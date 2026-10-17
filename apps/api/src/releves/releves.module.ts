import { Module } from '@nestjs/common';
import { RelevesController } from './releves.controller.js';
import { RelevesService } from './releves.service.js';

@Module({
  controllers: [RelevesController],
  providers: [RelevesService],
  exports: [RelevesService],
})
export class RelevesModule {}
