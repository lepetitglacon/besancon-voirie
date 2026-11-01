import type { DemandeRole, Role } from '@voirie/schema'

/** Rôles cochés (ChoixRoles), avec leur motivation (vide pour un rôle accordé sans validation). */
export type Choix = Partial<Record<Role, string>>

export function demandesDepuisChoix(choix: Choix): DemandeRole[] {
  return Object.entries(choix).map(([role, motivation]) => ({
    role: role as Role,
    motivation: motivation?.trim() || undefined,
  }))
}
