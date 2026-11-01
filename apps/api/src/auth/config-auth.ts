import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions } from 'express';

/** Cookie du JWT de l'app, le même quel que soit le mode de connexion. */
export const COOKIE_SESSION = 'voirie_session';
/** Cookie court de l'aller-retour Google (state OAuth signé). */
export const COOKIE_OAUTH = 'voirie_oauth';

/** Secret de développement : refusé en production. */
const SECRET_DEV = 'secret-de-developpement-besancon-voirie';

/** Réglages de l'authentification, lus dans l'environnement (voir .env.example). */
@Injectable()
export class ConfigAuth {
  private readonly logger = new Logger(ConfigAuth.name);
  readonly secret: string;
  /** Adresse du site vue par le navigateur : callback Google et liens des e-mails. */
  readonly urlPublique: string;
  readonly dureeSessionJours: number;
  readonly google: { clientId: string; secret: string } | null;

  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET manquant');
    if (!secret) this.logger.warn('JWT_SECRET absent : secret de développement utilisé');
    this.secret = secret || SECRET_DEV;
    this.urlPublique = (config.get<string>('URL_PUBLIQUE') || `http://localhost:${config.get<string>('WEB_PORT') ?? 5173}`).replace(
      /\/$/,
      '',
    );
    this.dureeSessionJours = Number(config.get<string>('JWT_DUREE_JOURS') || 30);
    const clientId = config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = config.get<string>('GOOGLE_CLIENT_SECRET');
    this.google = clientId && clientSecret ? { clientId, secret: clientSecret } : null;
  }

  /** Options des cookies : `SameSite=Lax` pour qu'ils reviennent du détour par Google. */
  cookie(maxAgeMs: number): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.urlPublique.startsWith('https://'),
      path: '/',
      maxAge: maxAgeMs,
    };
  }

  get dureeSessionMs() {
    return this.dureeSessionJours * 24 * 3600 * 1000;
  }
}
