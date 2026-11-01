import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { DecisionDemande, ModifierUtilisateur, Role, type DemandeRoleAdmin, type UtilisateurAdmin } from '@voirie/schema';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { Peut, UtilisateurCourant, type UtilisateurConnecte } from './acces.js';
import { ComptesService } from './comptes.service.js';
import { MailService } from './mail.service.js';

/** Gestion des droits : comptes, rôles et demandes en attente (admin). */
@Controller('utilisateurs')
@Peut('manage', 'Utilisateur')
export class UtilisateursController {
  constructor(
    private readonly comptes: ComptesService,
    private readonly mail: MailService,
  ) {}

  @Get()
  liste(): Promise<UtilisateurAdmin[]> {
    return this.comptes.listeAdmin();
  }

  @Get('demandes')
  async demandes(): Promise<DemandeRoleAdmin[]> {
    const lignes = await this.comptes.demandesEnAttente();
    return lignes.flatMap(({ role, creeLe, ...ligne }) => {
      const valide = Role.safeParse(role);
      return valide.success ? [{ ...ligne, role: valide.data, creeLe: creeLe.toISOString() }] : [];
    });
  }

  @Post('demandes/:id/:role')
  @HttpCode(204)
  async decider(
    @UtilisateurCourant() moi: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('role', new ZodValidationPipe(Role)) role: Role,
    @Body(new ZodValidationPipe(DecisionDemande)) { decision }: DecisionDemande,
  ) {
    if (!(await this.comptes.deciderDemande(id, role, decision, moi.id))) throw new NotFoundException('Demande introuvable');
    const compte = await this.comptes.parId(id);
    if (compte) await this.mail.decisionRole(compte.email, role, decision);
  }

  /** Active ou désactive un compte (jamais le sien). */
  @Patch(':id')
  @HttpCode(204)
  async modifier(
    @UtilisateurCourant() moi: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ModifierUtilisateur)) { actif }: ModifierUtilisateur,
  ) {
    if (id === moi.id) throw new BadRequestException('Impossible de désactiver son propre compte');
    if (!actif) await this.comptes.garderUnAdmin(id);
    await this.comptes.modifier(id, { actif });
  }

  @Put(':id/roles/:role')
  @HttpCode(204)
  async accorder(
    @UtilisateurCourant() moi: UtilisateurConnecte,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('role', new ZodValidationPipe(Role)) role: Role,
  ) {
    await this.comptes.accorderRole(id, role, moi.id);
  }

  @Delete(':id/roles/:role')
  @HttpCode(204)
  async retirer(@Param('id', ParseUUIDPipe) id: string, @Param('role', new ZodValidationPipe(Role)) role: Role) {
    await this.comptes.retirerRole(id, role);
  }
}
