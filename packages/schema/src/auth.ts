import { z } from 'zod';
import { ROLES, Role, type RegleDroit } from './droits.js';

/** Comptes, connexion (mot de passe ou Google) et demandes de rôles. */

export const MOT_DE_PASSE_MIN = 12;

export const Email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Adresse e-mail invalide'));

export const MotDePasse = z
  .string()
  .min(MOT_DE_PASSE_MIN, `${MOT_DE_PASSE_MIN} caractères au moins`)
  .max(200);

export const NomAffiche = z.string().trim().min(1, 'Nom obligatoire').max(80);

export const Motivation = z.string().trim().max(2000);

export const StatutDemandeRole = z.enum(['en_attente', 'accorde', 'refuse']);
export type StatutDemandeRole = z.infer<typeof StatutDemandeRole>;

/** Demande d'un rôle : la motivation est obligatoire pour un rôle soumis à validation. */
export const DemandeRole = z
  .object({ role: Role, motivation: Motivation.optional() })
  .superRefine(({ role, motivation }, ctx) => {
    if (!ROLES[role].demandable) ctx.addIssue({ code: 'custom', path: ['role'], message: 'Rôle non demandable' });
    if (ROLES[role].validation && !motivation)
      ctx.addIssue({ code: 'custom', path: ['motivation'], message: `Motivation obligatoire (${ROLES[role].libelle})` });
  });
export type DemandeRole = z.infer<typeof DemandeRole>;

export const Inscription = z.object({
  nom: NomAffiche,
  email: Email,
  motDePasse: MotDePasse,
  roles: z
    .array(DemandeRole)
    .max(Role.options.length)
    .refine((roles) => new Set(roles.map((r) => r.role)).size === roles.length, 'Rôle en double'),
});
export type Inscription = z.infer<typeof Inscription>;

/** Connexion par mot de passe. */
export const Identifiants = z.object({ email: Email, motDePasse: z.string().min(1).max(200) });
export type Identifiants = z.infer<typeof Identifiants>;

export const Jeton = z.object({ jeton: z.string().min(20).max(200) });
export type Jeton = z.infer<typeof Jeton>;

export const MotDePasseOublie = z.object({ email: Email });
export type MotDePasseOublie = z.infer<typeof MotDePasseOublie>;

export const Reinitialisation = z.object({ jeton: Jeton.shape.jeton, motDePasse: MotDePasse });
export type Reinitialisation = z.infer<typeof Reinitialisation>;

export const ModifierCompte = z.object({ nom: NomAffiche });
export type ModifierCompte = z.infer<typeof ModifierCompte>;

/** `actuel` n'est demandé que si le compte a déjà un mot de passe (sinon on le définit). */
export const ChangerMotDePasse = z.object({ actuel: z.string().max(200).optional(), nouveau: MotDePasse });
export type ChangerMotDePasse = z.infer<typeof ChangerMotDePasse>;

export const ModifierUtilisateur = z.object({ actif: z.boolean() });
export type ModifierUtilisateur = z.infer<typeof ModifierUtilisateur>;

export const DecisionDemande = z.object({ decision: z.enum(['accorde', 'refuse']) });
export type DecisionDemande = z.infer<typeof DecisionDemande>;

export interface RoleUtilisateur {
  role: Role;
  statut: StatutDemandeRole;
  motivation: string | null;
  creeLe: string;
  decideLe: string | null;
}

/** Compte connecté, tel que le voit son propriétaire. */
export interface UtilisateurSession {
  id: string;
  nom: string;
  email: string;
  /** Compte Google lié. */
  google: boolean;
  /** Mot de passe local défini. */
  motDePasse: boolean;
  roles: RoleUtilisateur[];
}

/** Réponse de `GET /api/auth/moi` : `utilisateur` nul pour un visiteur. */
export interface Session {
  utilisateur: UtilisateurSession | null;
  regles: RegleDroit[];
  /** Connexion Google configurée sur le serveur (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET). */
  googleDisponible: boolean;
}

/** Compte vu depuis la gestion des droits. */
export interface UtilisateurAdmin extends UtilisateurSession {
  emailVerifie: boolean;
  actif: boolean;
  creeLe: string;
  derniereConnexionLe: string | null;
}

export interface DemandeRoleAdmin {
  utilisateur: { id: string; nom: string; email: string };
  role: Role;
  motivation: string | null;
  creeLe: string;
}
