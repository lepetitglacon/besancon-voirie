import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { CompteController } from './compte.controller.js';
import { ComptesService } from './comptes.service.js';
import { ConfigAuth } from './config-auth.js';
import { AccesGuard, GoogleGuard } from './guards.js';
import { JetonsService } from './jetons.service.js';
import { MailService } from './mail.service.js';
import { StrategieGoogle, StrategieMotDePasse, StrategieSession } from './strategies.js';
import { UtilisateursController } from './utilisateurs.controller.js';

/**
 * Comptes et droits — docs/ARCHITECTURE.md §12. Connexion par mot de passe ou par Google, un
 * seul JWT de l'app en cookie, droits CASL des rôles (@voirie/schema) vérifiés par AccesGuard
 * sur toutes les routes.
 */
@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigAuth],
      extraProviders: [ConfigAuth],
      useFactory: (config: ConfigAuth) => ({ secret: config.secret }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 10 }]),
  ],
  controllers: [AuthController, CompteController, UtilisateursController],
  providers: [
    ConfigAuth,
    ComptesService,
    JetonsService,
    MailService,
    AuthService,
    StrategieMotDePasse,
    StrategieSession,
    StrategieGoogle,
    GoogleGuard,
    { provide: APP_GUARD, useClass: AccesGuard },
  ],
})
export class AuthModule {}
