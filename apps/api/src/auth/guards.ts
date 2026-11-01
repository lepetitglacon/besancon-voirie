import {
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ACCES, type Acces, type UtilisateurConnecte } from './acces.js';
import { ConfigAuth } from './config-auth.js';

/**
 * Guard global des routes : lit `@Peut`, `@Connecte` ou `@SessionFacultative`, charge le compte
 * du cookie de session (stratégie « jwt ») et refuse en 401 sans compte, en 403 sans le droit.
 * Une route sans métadonnée reste publique, sans lecture du cookie.
 */
@Injectable()
export class AccesGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super();
  }

  override async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const acces = this.reflector.getAllAndOverride<Acces | undefined>(ACCES, [ctx.getHandler(), ctx.getClass()]);
    if (!acces) return true;
    // Développement local et tests e2e : les routes d'édition restent ouvertes sans compte.
    if (acces.type === 'droit' && this.config.get<string>('EDITION_LOCALE') === 'true') return true;

    await super.canActivate(ctx);
    const utilisateur = ctx.switchToHttp().getRequest<{ user: UtilisateurConnecte | null }>().user;
    if (acces.type === 'session') return true;
    if (!utilisateur) throw new UnauthorizedException('Connexion requise');
    if (acces.type === 'droit' && !utilisateur.droits.can(acces.action, acces.sujet)) {
      throw new ForbiddenException('Droits insuffisants');
    }
    return true;
  }

  /** Cookie absent, expiré ou révoqué : visiteur, la décision revient à canActivate. */
  override handleRequest<T>(erreur: unknown, utilisateur: T): T | null {
    if (erreur) throw erreur;
    return utilisateur || null;
  }
}

/** Erreur de l'aller-retour Google, renvoyée au front plutôt que levée. */
export interface EchecGoogle {
  erreur: string;
}

/** Aller-retour Google ; 503 tant que GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET manquent. */
@Injectable()
export class GoogleGuard extends AuthGuard('google') {
  constructor(private readonly config: ConfigAuth) {
    super();
  }

  override canActivate(ctx: ExecutionContext) {
    if (!this.config.google) throw new ServiceUnavailableException('Connexion Google non configurée');
    return super.canActivate(ctx);
  }

  override handleRequest<T>(erreur: unknown, resultat: T, info: { message?: string } | undefined): T | EchecGoogle {
    if (erreur) return { erreur: erreur instanceof Error ? erreur.message : 'Connexion Google impossible' };
    return resultat || { erreur: info?.message ?? 'Connexion Google annulée' };
  }
}
