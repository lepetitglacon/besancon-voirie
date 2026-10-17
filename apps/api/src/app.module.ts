import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BranchesModule } from './branches/branches.module.js';
import { CarrefoursModule } from './carrefours/carrefours.module.js';
import { DbModule } from './db/db.module.js';
import { FicheModule } from './fiche/fiche.module.js';
import { FeuxModule } from './feux/feux.module.js';
import { HealthController } from './health/health.controller.js';
import { LignesModule } from './lignes/lignes.module.js';
import { OsmModule } from './osm/osm.module.js';
import { ProgrammeModule } from './programme/programme.module.js';
import { RelevesModule } from './releves/releves.module.js';
import { SumoModule } from './sumo/sumo.module.js';
import { TempsReelModule } from './temps-reel/temps-reel.module.js';
import { TramModule } from './tram/tram.module.js';

@Module({
  imports: [
    // Le .env de la racine du monorepo, puis un éventuel .env local à l'API.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    DbModule,
    CarrefoursModule,
    BranchesModule,
    LignesModule,
    ProgrammeModule,
    FeuxModule,
    TramModule,
    TempsReelModule,
    RelevesModule,
    // Après CarrefoursModule : GET /api/carrefours/:slug ne doit pas masquer /suggestion-nom.
    FicheModule,
    SumoModule,
    OsmModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
