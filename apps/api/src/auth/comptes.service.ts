import { ConflictException, Inject, Injectable } from '@nestjs/common';
import {
  creerDroits,
  reglesPour,
  Role,
  ROLES,
  type DemandeRole,
  type RoleUtilisateur,
  type Session,
  type UtilisateurAdmin,
} from '@voirie/schema';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, type Db } from '../db/db.module.js';
import { utilisateur, utilisateurRole } from '../db/schema.js';
import type { UtilisateurConnecte } from './acces.js';
import { ConfigAuth } from './config-auth.js';

export type LigneUtilisateur = typeof utilisateur.$inferSelect;
type LigneRole = typeof utilisateurRole.$inferSelect;

function versRole(ligne: LigneRole): RoleUtilisateur | null {
  const role = Role.safeParse(ligne.role);
  // Rôle retiré du catalogue depuis : ignoré.
  if (!role.success) return null;
  return {
    role: role.data,
    statut: ligne.statut,
    motivation: ligne.motivation,
    creeLe: ligne.creeLe.toISOString(),
    decideLe: ligne.decideLe?.toISOString() ?? null,
  };
}

/** Accès aux comptes et à leurs rôles, partagé par l'authentification, le compte et l'admin. */
@Injectable()
export class ComptesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Db,
    private readonly config: ConfigAuth,
  ) {}

  async parId(id: string): Promise<LigneUtilisateur | null> {
    const [ligne] = await this.db.select().from(utilisateur).where(eq(utilisateur.id, id));
    return ligne ?? null;
  }

  async parEmail(email: string): Promise<LigneUtilisateur | null> {
    const [ligne] = await this.db.select().from(utilisateur).where(eq(utilisateur.email, email.toLowerCase()));
    return ligne ?? null;
  }

  async parGoogleId(googleId: string): Promise<LigneUtilisateur | null> {
    const [ligne] = await this.db.select().from(utilisateur).where(eq(utilisateur.googleId, googleId));
    return ligne ?? null;
  }

  async modifier(id: string, valeurs: Partial<typeof utilisateur.$inferInsert>): Promise<LigneUtilisateur> {
    const [ligne] = await this.db.update(utilisateur).set(valeurs).where(eq(utilisateur.id, id)).returning();
    return ligne;
  }

  /** Révoque tous les JWT du compte. */
  async revoquerSessions(id: string): Promise<LigneUtilisateur> {
    const [ligne] = await this.db
      .update(utilisateur)
      .set({ versionJeton: sql`${utilisateur.versionJeton} + 1` })
      .where(eq(utilisateur.id, id))
      .returning();
    return ligne;
  }

  async rolesDe(ids: string[]): Promise<Map<string, RoleUtilisateur[]>> {
    const parUtilisateur = new Map<string, RoleUtilisateur[]>(ids.map((id) => [id, []]));
    if (ids.length === 0) return parUtilisateur;
    const lignes = await this.db
      .select()
      .from(utilisateurRole)
      .where(inArray(utilisateurRole.utilisateurId, ids))
      .orderBy(asc(utilisateurRole.creeLe));
    for (const ligne of lignes) {
      const role = versRole(ligne);
      if (role) parUtilisateur.get(ligne.utilisateurId)?.push(role);
    }
    return parUtilisateur;
  }

  /**
   * Compte d'un JWT : actif, e-mail vérifié et jeton de la version courante, sinon null
   * (compte désactivé ou sessions révoquées depuis).
   */
  async chargerConnecte(id: string, versionJeton: number): Promise<UtilisateurConnecte | null> {
    const ligne = await this.parId(id);
    if (!ligne || !ligne.actif || !ligne.emailVerifieLe || ligne.versionJeton !== versionJeton) return null;
    return this.connecte(ligne);
  }

  async connecte(ligne: LigneUtilisateur): Promise<UtilisateurConnecte> {
    const roles = (await this.rolesDe([ligne.id])).get(ligne.id) ?? [];
    const accordes = roles.filter((r) => r.statut === 'accorde').map((r) => r.role);
    return {
      id: ligne.id,
      nom: ligne.nom,
      email: ligne.email,
      googleId: ligne.googleId,
      aMotDePasse: ligne.motDePasse !== null,
      versionJeton: ligne.versionJeton,
      roles,
      droits: creerDroits(reglesPour(accordes)),
    };
  }

  session(connecte: UtilisateurConnecte | null): Session {
    const googleDisponible = this.config.google !== null;
    if (!connecte) return { utilisateur: null, regles: [], googleDisponible };
    return {
      googleDisponible,
      utilisateur: {
        id: connecte.id,
        nom: connecte.nom,
        email: connecte.email,
        google: connecte.googleId !== null,
        motDePasse: connecte.aMotDePasse,
        roles: connecte.roles,
      },
      regles: connecte.droits.rules,
    };
  }

  async sessionDe(id: string): Promise<Session> {
    const ligne = await this.parId(id);
    return this.session(ligne ? await this.connecte(ligne) : null);
  }

  /**
   * Demandes de rôles : accordés tout de suite s'ils ne demandent pas de validation, sinon en
   * attente avec leur motivation. Un rôle refusé peut être redemandé ; un rôle accordé ou déjà
   * en attente reste tel quel.
   */
  async demanderRoles(utilisateurId: string, demandes: DemandeRole[]): Promise<void> {
    for (const { role, motivation } of demandes) {
      const accorde = !ROLES[role].validation;
      await this.db
        .insert(utilisateurRole)
        .values({
          utilisateurId,
          role,
          statut: accorde ? 'accorde' : 'en_attente',
          motivation: motivation ?? null,
          decideLe: accorde ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: [utilisateurRole.utilisateurId, utilisateurRole.role],
          set: {
            statut: accorde ? 'accorde' : 'en_attente',
            motivation: motivation ?? null,
            decidePar: null,
            decideLe: accorde ? new Date() : null,
            creeLe: new Date(),
          },
          setWhere: eq(utilisateurRole.statut, 'refuse'),
        });
    }
  }

  async accorderRole(utilisateurId: string, role: Role, decidePar: string): Promise<void> {
    const valeurs = { statut: 'accorde' as const, decidePar, decideLe: new Date() };
    await this.db
      .insert(utilisateurRole)
      .values({ utilisateurId, role, ...valeurs })
      .onConflictDoUpdate({ target: [utilisateurRole.utilisateurId, utilisateurRole.role], set: valeurs });
  }

  async deciderDemande(utilisateurId: string, role: Role, decision: 'accorde' | 'refuse', decidePar: string) {
    const [ligne] = await this.db
      .update(utilisateurRole)
      .set({ statut: decision, decidePar, decideLe: new Date() })
      .where(
        and(
          eq(utilisateurRole.utilisateurId, utilisateurId),
          eq(utilisateurRole.role, role),
          eq(utilisateurRole.statut, 'en_attente'),
        ),
      )
      .returning();
    return ligne ?? null;
  }

  /** Retire un rôle (accordé ou demandé), sauf le dernier admin. */
  async retirerRole(utilisateurId: string, role: Role): Promise<void> {
    if (role === 'admin') await this.garderUnAdmin(utilisateurId);
    await this.db
      .delete(utilisateurRole)
      .where(and(eq(utilisateurRole.utilisateurId, utilisateurId), eq(utilisateurRole.role, role)));
  }

  /** Refuse l'opération si `utilisateurId` est le seul admin actif. */
  async garderUnAdmin(utilisateurId: string): Promise<void> {
    const admins = await this.db
      .select({ id: utilisateur.id })
      .from(utilisateurRole)
      .innerJoin(utilisateur, eq(utilisateur.id, utilisateurRole.utilisateurId))
      .where(and(eq(utilisateurRole.role, 'admin'), eq(utilisateurRole.statut, 'accorde'), eq(utilisateur.actif, true)));
    if (admins.length === 1 && admins[0].id === utilisateurId) {
      throw new ConflictException('Impossible : c’est le dernier compte admin');
    }
  }

  async supprimer(id: string): Promise<void> {
    await this.garderUnAdmin(id);
    await this.db.delete(utilisateur).where(eq(utilisateur.id, id));
  }

  async listeAdmin(): Promise<UtilisateurAdmin[]> {
    const lignes = await this.db.select().from(utilisateur).orderBy(asc(utilisateur.nom));
    const roles = await this.rolesDe(lignes.map((l) => l.id));
    return lignes.map((l) => ({
      id: l.id,
      nom: l.nom,
      email: l.email,
      google: l.googleId !== null,
      motDePasse: l.motDePasse !== null,
      roles: roles.get(l.id) ?? [],
      emailVerifie: l.emailVerifieLe !== null,
      actif: l.actif,
      creeLe: l.creeLe.toISOString(),
      derniereConnexionLe: l.derniereConnexionLe?.toISOString() ?? null,
    }));
  }

  async demandesEnAttente() {
    return this.db
      .select({
        utilisateur: { id: utilisateur.id, nom: utilisateur.nom, email: utilisateur.email },
        role: utilisateurRole.role,
        motivation: utilisateurRole.motivation,
        creeLe: utilisateurRole.creeLe,
      })
      .from(utilisateurRole)
      .innerJoin(utilisateur, eq(utilisateur.id, utilisateurRole.utilisateurId))
      .where(eq(utilisateurRole.statut, 'en_attente'))
      .orderBy(asc(utilisateurRole.creeLe));
  }
}
