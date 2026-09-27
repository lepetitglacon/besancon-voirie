import type { Fiabilite } from './etats'

export const FIABILITES: Record<Fiabilite, { libelle: string; couleur: string; aide: string }> = {
  synchronisee: { libelle: 'Synchronisé', couleur: 'green', aide: 'Calé sur des tops relevés plusieurs jours, qui concordent.' },
  estimee: { libelle: 'Estimé', couleur: 'blue', aide: 'Calé sur des tops d’un seul jour : à confirmer un autre jour.' },
  indicative: { libelle: 'Indicatif', couleur: 'orange', aide: 'Le cycle réel peut s’écarter du programme.' },
  inconnue: { libelle: 'Phase inconnue', couleur: 'gray', aide: 'Programme connu, mais aucun top pour le caler sur l’heure.' },
}
