import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Action, Droits, RoleUtilisateur, Sujet } from '@voirie/schema';

/** Compte connecté, rechargé en base à chaque requête qui le demande (rôles et droits à jour). */
export interface UtilisateurConnecte {
  id: string;
  nom: string;
  email: string;
  googleId: string | null;
  aMotDePasse: boolean;
  versionJeton: number;
  /** Tous les rôles du compte, accordés, en attente ou refusés. */
  roles: RoleUtilisateur[];
  /** Droits des rôles accordés. */
  droits: Droits;
}

/** Ce qu'une route exige, lu par AccesGuard. Sans métadonnée, la route est publique. */
export type Acces =
  | { type: 'droit'; action: Action; sujet: Sujet }
  | { type: 'connecte' }
  /** Session lue si présente, jamais exigée (GET /api/auth/moi). */
  | { type: 'session' };

export const ACCES = 'acces';

/** Route réservée aux comptes qui ont ce droit (rôles de @voirie/schema). */
export const Peut = (action: Action, sujet: Sujet) => SetMetadata(ACCES, { type: 'droit', action, sujet } satisfies Acces);

/** Route réservée aux comptes connectés, sans droit particulier. */
export const Connecte = () => SetMetadata(ACCES, { type: 'connecte' } satisfies Acces);

export const SessionFacultative = () => SetMetadata(ACCES, { type: 'session' } satisfies Acces);

/** Compte connecté (null pour un visiteur, sur une route `SessionFacultative`). */
export const UtilisateurCourant = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    (ctx.switchToHttp().getRequest<{ user?: UtilisateurConnecte | null }>().user ?? null) as UtilisateurConnecte,
);
