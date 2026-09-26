import { Module } from '@nestjs/common';
import { CarrefoursController } from './carrefours.controller.js';
import { CarrefoursService } from './carrefours.service.js';

@Module({
  controllers: [CarrefoursController],
  providers: [CarrefoursService],
})
export class CarrefoursModule {}
