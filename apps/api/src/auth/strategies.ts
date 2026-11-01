import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PassportStrategy } from '@nestjs/passport';
import { Identifiants } from '@voirie/schema';
import type { Request } from 'express';
import { randomBytes } from 'node:crypto';
import { Strategy as OAuthGoogle, type Profile } from 'passport-google-oauth20';
import type { Metadata, StateStore, StateStoreStoreCallback, StateStoreVerifyCallback } from 'passport-oauth2';
import { Strategy as JwtPassport } from 'passport-jwt';
import { Strategy as LocalPassport } from 'passport-local';
import type { UtilisateurConnecte } from './acces.js';
import { AuthService, type ContenuJeton, type EtatGoogle, type ResultatGoogle } from './auth.service.js';
import { ComptesService } from './comptes.service.js';
import { COOKIE_OAUTH, COOKIE_SESSION, ConfigAuth } from './config-auth.js';

/** Connexion par e-mail et mot de passe (POST /api/auth/connexion). */
@Injectable()
export class StrategieMotDePasse extends PassportStrategy(LocalPassport, 'local') {
  constructor(private readonly auth: AuthService) {
    super({ usernameField: 'email', passwordField: 'motDePasse' });
  }

  validate(email: string, motDePasse: string) {
    const identifiants = Identifiants.parse({ email, motDePasse });
    return this.auth.validerIdentifiants(identifiants.email, identifiants.motDePasse);
  }
}

/** JWT de l'app, lu dans le cookie de session ; le compte est rechargé en base. */
@Injectable()
export class StrategieSession extends PassportStrategy(JwtPassport, 'jwt') {
  constructor(
    private readonly comptes: ComptesService,
    config: ConfigAuth,
  ) {
    super({
      jwtFromRequest: (req: Request) => (req.cookies as Record<string, string> | undefined)?.[COOKIE_SESSION] ?? null,
      secretOrKey: config.secret,
    });
  }

  validate(contenu: ContenuJeton): Promise<UtilisateurConnecte | null> {
    return this.comptes.chargerConnecte(contenu.sub, contenu.v);
  }
}

type RequeteGoogle = Request & { etatGoogle?: EtatGoogle };

/** Adresse de retour après Google : un chemin du site seulement. */
function cheminDuSite(valeur: unknown): string {
  return typeof valeur === 'string' && valeur.startsWith('/') && !valeur.startsWith('//') ? valeur : '/';
}

/**
 * `state` OAuth sans express-session : un nonce, renvoyé par Google, et son double signé dans
 * un cookie court, avec le mode (connexion ou liaison) et l'adresse de retour.
 */
class EtatOAuthCookie implements StateStore {
  private readonly options;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigAuth,
  ) {
    this.options = { ...config.cookie(10 * 60_000), path: '/api/auth/google' };
  }

  // Paramètres en reste : passport-oauth2 choisit la signature d'après leur nombre, ici sans `meta`.
  store(req: Request, ...args: [StateStoreStoreCallback] | [Metadata, StateStoreStoreCallback]) {
    const rappel = args[args.length - 1] as StateStoreStoreCallback;
    const nonce = randomBytes(16).toString('base64url');
    const etat: EtatGoogle = {
      mode: req.query.mode === 'liaison' ? 'liaison' : 'connexion',
      retour: cheminDuSite(req.query.retour),
    };
    req.res?.cookie(COOKIE_OAUTH, this.jwt.sign({ nonce, ...etat }, { expiresIn: '10m' }), this.options);
    rappel(null, nonce);
  }

  verify(req: RequeteGoogle, nonce: string, ...args: [StateStoreVerifyCallback] | [Metadata, StateStoreVerifyCallback]) {
    const rappel = args[args.length - 1] as StateStoreVerifyCallback;
    const jeton = (req.cookies as Record<string, string> | undefined)?.[COOKIE_OAUTH];
    req.res?.clearCookie(COOKIE_OAUTH, { ...this.options, maxAge: undefined });
    try {
      const contenu = this.jwt.verify<EtatGoogle & { nonce: string }>(jeton ?? '');
      if (contenu.nonce !== nonce) return rappel(null, false, { message: 'Connexion Google invalide, recommencez' });
      req.etatGoogle = { mode: contenu.mode, retour: cheminDuSite(contenu.retour) };
      rappel(null, true, nonce);
    } catch {
      rappel(null, false, { message: 'Connexion Google expirée, recommencez' });
    }
  }
}

/** Connexion Google, fusionnée avec le compte local de même e-mail (AuthService.connexionGoogle). */
@Injectable()
export class StrategieGoogle extends PassportStrategy(OAuthGoogle, 'google') {
  constructor(
    private readonly auth: AuthService,
    jwt: JwtService,
    config: ConfigAuth,
  ) {
    super({
      // Sans identifiants, GoogleGuard refuse avant d'atteindre la stratégie.
      clientID: config.google?.clientId ?? 'non-configure',
      clientSecret: config.google?.secret ?? 'non-configure',
      callbackURL: `${config.urlPublique}/api/auth/google/callback`,
      scope: ['email', 'profile'],
      passReqToCallback: true,
      store: new EtatOAuthCookie(jwt, config),
    });
  }

  async validate(req: RequeteGoogle, _accessToken: string, _refreshToken: string, profil: Profile): Promise<ResultatGoogle & { etat: EtatGoogle }> {
    const etat = req.etatGoogle ?? { mode: 'connexion', retour: '/' };
    const courant = await this.auth.connecteDepuisCookie((req.cookies as Record<string, string> | undefined)?.[COOKIE_SESSION]);
    const verifie = profil._json.email_verified as unknown;
    const resultat = await this.auth.connexionGoogle(
      {
        id: profil.id,
        email: profil.emails?.[0]?.value ?? null,
        emailVerifie: verifie === true || verifie === 'true',
        nom: profil.displayName,
      },
      etat,
      courant,
    );
    return { ...resultat, etat };
  }
}
