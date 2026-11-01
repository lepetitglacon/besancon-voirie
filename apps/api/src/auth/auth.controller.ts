import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Inscription, Jeton, MotDePasseOublie, Reinitialisation } from '@voirie/schema';
import type { Request, Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SessionFacultative, UtilisateurCourant, type UtilisateurConnecte } from './acces.js';
import { AuthService, type EtatGoogle, type ResultatGoogle } from './auth.service.js';
import { ComptesService, type LigneUtilisateur } from './comptes.service.js';
import { type EchecGoogle, GoogleGuard } from './guards.js';

/** Tentatives par minute et par IP sur les routes exposées aux robots. */
const LIMITE = { default: { limit: 10, ttl: 60_000 } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly comptes: ComptesService,
  ) {}

  /** Session courante : `utilisateur` nul pour un visiteur. */
  @Get('moi')
  @SessionFacultative()
  moi(@UtilisateurCourant() utilisateur: UtilisateurConnecte | null) {
    return this.comptes.session(utilisateur);
  }

  /** Le compte s'active par le lien envoyé par e-mail. */
  @Post('inscription')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle(LIMITE)
  async inscrire(@Body(new ZodValidationPipe(Inscription)) inscription: Inscription) {
    await this.auth.inscrire(inscription);
  }

  @Post('verification')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle(LIMITE)
  async verifier(@Body(new ZodValidationPipe(Jeton)) { jeton }: Jeton, @Res({ passthrough: true }) res: Response) {
    return this.auth.ouvrirSession(res, await this.auth.verifierEmail(jeton));
  }

  /** Corps : `{ email, motDePasse }`, vérifiés par la stratégie « local ». */
  @Post('connexion')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard, AuthGuard('local'))
  @Throttle(LIMITE)
  connexion(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.ouvrirSession(res, req.user as LigneUtilisateur);
  }

  @Post('deconnexion')
  @HttpCode(204)
  deconnexion(@Res({ passthrough: true }) res: Response) {
    this.auth.fermerSession(res);
  }

  @Post('mot-de-passe-oublie')
  @HttpCode(204)
  @UseGuards(ThrottlerGuard)
  @Throttle(LIMITE)
  async motDePasseOublie(@Body(new ZodValidationPipe(MotDePasseOublie)) { email }: MotDePasseOublie) {
    await this.auth.motDePasseOublie(email);
  }

  @Post('reinitialisation')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @Throttle(LIMITE)
  async reinitialiser(
    @Body(new ZodValidationPipe(Reinitialisation)) { jeton, motDePasse }: Reinitialisation,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.ouvrirSession(res, await this.auth.reinitialiser(jeton, motDePasse));
  }

  /** Départ vers Google. `?mode=liaison` rattache Google au compte connecté ; `?retour=/chemin`. */
  @Get('google')
  @UseGuards(GoogleGuard)
  google() {
    // Redirigé vers Google par la stratégie.
  }

  /** Retour de Google : session ouverte, puis retour au site (erreur dans `?erreur=`). */
  @Get('google/callback')
  @UseGuards(GoogleGuard)
  async retourGoogle(@Req() req: Request, @Res() res: Response) {
    const resultat = req.user as (ResultatGoogle & { etat: EtatGoogle }) | EchecGoogle;
    if ('erreur' in resultat) {
      res.redirect(`/connexion?erreur=${encodeURIComponent(resultat.erreur)}`);
      return;
    }
    if (resultat.etat.mode === 'connexion') await this.auth.ouvrirSession(res, resultat.utilisateur);
    if (resultat.nouveau) res.redirect('/parametres?onglet=roles&bienvenue=1');
    else if (resultat.etat.mode === 'liaison') res.redirect('/parametres?onglet=comptes');
    else res.redirect(resultat.etat.retour);
  }
}
