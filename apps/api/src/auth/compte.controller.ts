import { BadRequestException, Body, Controller, Delete, HttpCode, Param, Patch, Post, Put, Res } from '@nestjs/common';
import { ChangerMotDePasse, DemandeRole, ModifierCompte, Role } from '@voirie/schema';
import type { Response } from 'express';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Connecte, UtilisateurCourant, type UtilisateurConnecte } from './acces.js';
import { AuthService } from './auth.service.js';
import { ComptesService } from './comptes.service.js';

/** Paramètres du compte connecté. Chaque modification renvoie la session à jour. */
@Controller('compte')
@Connecte()
export class CompteController {
  constructor(
    private readonly auth: AuthService,
    private readonly comptes: ComptesService,
  ) {}

  @Patch()
  async modifier(@UtilisateurCourant() moi: UtilisateurConnecte, @Body(new ZodValidationPipe(ModifierCompte)) { nom }: ModifierCompte) {
    await this.comptes.modifier(moi.id, { nom });
    return this.comptes.sessionDe(moi.id);
  }

  /** Change le mot de passe, ou le définit pour un compte Google. Les autres sessions sont fermées. */
  @Put('mot-de-passe')
  async changerMotDePasse(
    @UtilisateurCourant() moi: UtilisateurConnecte,
    @Body(new ZodValidationPipe(ChangerMotDePasse)) { actuel, nouveau }: ChangerMotDePasse,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.ouvrirSession(res, await this.auth.changerMotDePasse(moi, actuel, nouveau));
  }

  /** Délie Google : seulement si un mot de passe permet encore de se connecter. */
  @Delete('google')
  async delierGoogle(@UtilisateurCourant() moi: UtilisateurConnecte) {
    if (!moi.aMotDePasse) throw new BadRequestException('Définissez d’abord un mot de passe');
    await this.comptes.modifier(moi.id, { googleId: null });
    return this.comptes.sessionDe(moi.id);
  }

  @Post('deconnexion-partout')
  @HttpCode(204)
  async deconnexionPartout(@UtilisateurCourant() moi: UtilisateurConnecte, @Res({ passthrough: true }) res: Response) {
    await this.comptes.revoquerSessions(moi.id);
    this.auth.fermerSession(res);
  }

  @Post('roles')
  async demanderRole(@UtilisateurCourant() moi: UtilisateurConnecte, @Body(new ZodValidationPipe(DemandeRole)) demande: DemandeRole) {
    await this.comptes.demanderRoles(moi.id, [demande]);
    return this.comptes.sessionDe(moi.id);
  }

  /** Renonce à un rôle, ou retire une demande. */
  @Delete('roles/:role')
  async renoncer(@UtilisateurCourant() moi: UtilisateurConnecte, @Param('role', new ZodValidationPipe(Role)) role: Role) {
    await this.comptes.retirerRole(moi.id, role);
    return this.comptes.sessionDe(moi.id);
  }

  @Delete()
  @HttpCode(204)
  async supprimer(@UtilisateurCourant() moi: UtilisateurConnecte, @Res({ passthrough: true }) res: Response) {
    await this.comptes.supprimer(moi.id);
    this.auth.fermerSession(res);
  }
}
