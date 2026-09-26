import { Module } from '@nestjs/common';
import { FeuxController } from './feux.controller.js';
import { FeuxService } from './feux.service.js';

@Module({
  controllers: [FeuxController],
  providers: [FeuxService],
})
export class FeuxModule {}
