import { Module } from '@nestjs/common';
import { LancementsSumoController } from './lancements.controller.js';
import { LancementsSumoService } from './lancements.service.js';
import { SumoController } from './sumo.controller.js';

@Module({ controllers: [SumoController, LancementsSumoController], providers: [LancementsSumoService] })
export class SumoModule {}
