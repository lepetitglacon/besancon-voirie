import type { EssaiSumo, TronconSumo } from '@voirie/schema'

/** Indicateurs affichables sur un tronçon, à un instant (tranche de 5 min) ou sur tout l'essai. */
export type CleIndicateur = 'debit' | 'presents' | 'densite' | 'vitesse' | 'relative' | 'perte' | 'attente'

/** « instant » : la tranche de la timeline ; sinon un agrégat de l'essai. */
export type Statistique = 'instant' | 'moy' | 'min' | 'max'

export interface Palier {
  /** Borne haute (exclue) ; le dernier palier n'en a pas. */
  jusqua: number
  couleur: string
  libelle: string
}

export interface Indicateur {
  cle: CleIndicateur
  libelle: string
  unite: string
  /** Aide sous le choix de l'indicateur. */
  aide: string
  decimales: number
  /** Du plus petit au plus grand. */
  paliers: Palier[]
  /** Agrégats de l'essai proposés, avec leur valeur pour un tronçon. */
  agregats: Partial<Record<Exclude<Statistique, 'instant'>, (t: TronconSumo) => number | null>>
}

const ROUGES = ['#7f1d1d', '#dc2626', '#f97316', '#facc15', '#16a34a'] as const
const CHARGE = ['#fde68a', '#fbbf24', '#f97316', '#dc2626', '#7f1d1d'] as const

/** Paliers à partir des bornes : `bornes.length + 1` couleurs, libellés avec l'unité. */
function paliers(bornes: number[], couleurs: readonly string[], unite: string): Palier[] {
  return couleurs.map((couleur, k) => ({
    jusqua: bornes[k] ?? Infinity,
    couleur,
    libelle:
      k === 0 ? `< ${bornes[0]} ${unite}` : k === bornes.length ? `≥ ${bornes[k - 1]}` : `${bornes[k - 1]} – ${bornes[k]}`,
  }))
}

const parKm = (t: TronconSumo, vehicules: number) => (vehicules / t.longueur) * 1000

export const INDICATEURS: Record<CleIndicateur, Indicateur> = {
  debit: {
    cle: 'debit',
    libelle: 'Débit',
    unite: 'véh/h',
    aide: "Voitures entrées sur le tronçon, ramenées à l'heure.",
    decimales: 0,
    paliers: paliers([100, 300, 600, 1000], CHARGE, 'véh/h'),
    agregats: { max: (t) => t.debitMax },
  },
  presents: {
    cle: 'presents',
    libelle: 'Voitures présentes',
    unite: 'véh',
    aide: 'Nombre moyen de voitures sur le tronçon (densité absolue).',
    decimales: 1,
    paliers: paliers([2, 5, 10, 25], CHARGE, 'véh'),
    agregats: { max: (t) => (t.densiteMax * t.longueur) / 1000 },
  },
  densite: {
    cle: 'densite',
    libelle: 'Densité',
    unite: 'véh/km',
    aide: 'Voitures par kilomètre de tronçon, toutes voies confondues. Bouchon : 100 à 150 par voie.',
    decimales: 0,
    paliers: paliers([10, 25, 50, 100], CHARGE, 'véh/km'),
    agregats: { max: (t) => t.densiteMax },
  },
  vitesse: {
    cle: 'vitesse',
    libelle: 'Vitesse',
    unite: 'km/h',
    aide: 'Vitesse moyenne des voitures sur le tronçon.',
    decimales: 0,
    paliers: paliers([10, 20, 30, 45], ROUGES, 'km/h'),
    agregats: { moy: (t) => t.vitesseMoy, min: (t) => t.vitesseMin, max: (t) => t.vitesseMax },
  },
  relative: {
    cle: 'relative',
    libelle: 'Vitesse / autorisée',
    unite: '%',
    aide: 'Vitesse moyenne rapportée à la vitesse autorisée.',
    decimales: 0,
    paliers: paliers([20, 40, 60, 80], ROUGES, '%'),
    agregats: {
      moy: (t) => (t.vitesseMoy === null ? null : (t.vitesseMoy / t.vmax) * 100),
      min: (t) => (t.vitesseMin === null ? null : (t.vitesseMin / t.vmax) * 100),
      max: (t) => (t.vitesseMax === null ? null : (t.vitesseMax / t.vmax) * 100),
    },
  },
  perte: {
    cle: 'perte',
    libelle: 'Temps perdu',
    unite: 's/véh',
    aide: 'Temps perdu par voiture sur le tronçon, par rapport à la vitesse souhaitée.',
    decimales: 0,
    paliers: paliers([5, 15, 30, 60], [...ROUGES].reverse(), 's'),
    agregats: { moy: (t) => t.perte },
  },
  attente: {
    cle: 'attente',
    libelle: "Temps à l'arrêt",
    unite: 's/véh',
    aide: "Temps passé à l'arrêt par voiture (feu rouge, file).",
    decimales: 0,
    paliers: paliers([5, 15, 30, 60], [...ROUGES].reverse(), 's'),
    agregats: { moy: (t) => t.attente },
  },
}

export const LIBELLES_STATISTIQUE: Record<Statistique, string> = {
  instant: 'À l’instant',
  moy: 'Moyenne',
  min: 'Minimum',
  max: 'Maximum',
}

/** Valeurs brutes d'une tranche pour un tronçon, d'après le format des séries de l'essai. */
export interface Mesure {
  entres: number
  secondes: number
  /** m/s ; null sans voiture. */
  vitesse: number | null
  perte: number
  attente: number
}

/** Accès aux séries d'un essai : uint16 rangés [tranche][grandeur][tronçon]. */
export class Series {
  private readonly donnees: Uint16Array
  private readonly essai: EssaiSumo
  private readonly rang: Record<keyof Mesure, number>
  private readonly facteurs: number[]

  constructor(donnees: Uint16Array, essai: EssaiSumo) {
    this.donnees = donnees
    this.essai = essai
    const cles = essai.series.grandeurs.map((g) => g.cle)
    this.rang = Object.fromEntries(cles.map((cle, g) => [cle, g])) as Record<keyof Mesure, number>
    this.facteurs = essai.series.grandeurs.map((g) => g.facteur)
  }

  private brut(t: number, g: number, i: number): number {
    return this.donnees[(t * this.facteurs.length + g) * this.essai.troncons + i]!
  }

  mesure(t: number, i: number): Mesure {
    const lire = (cle: keyof Mesure) => this.brut(t, this.rang[cle], i) * this.facteurs[this.rang[cle]]!
    const vitesse = this.brut(t, this.rang.vitesse, i)
    return {
      entres: lire('entres'),
      secondes: lire('secondes'),
      vitesse: vitesse === this.essai.series.absent ? null : vitesse * this.facteurs[this.rang.vitesse]!,
      perte: lire('perte'),
      attente: lire('attente'),
    }
  }

  /** Valeur d'un indicateur sur une tranche ; null si personne n'a emprunté le tronçon. */
  valeur(cle: CleIndicateur, t: number, troncon: TronconSumo): number | null {
    return valeurIndicateur(cle, this.mesure(t, troncon.i), troncon, this.essai.pas)
  }
}

export function valeurIndicateur(cle: CleIndicateur, m: Mesure, troncon: TronconSumo, pas: number): number | null {
  if (m.secondes === 0) return null
  const presents = m.secondes / pas
  // Voitures passées ≈ secondes × vitesse / longueur ; à l'arrêt, celles qui sont là.
  const voitures = Math.max(m.vitesse ? (m.secondes * m.vitesse) / troncon.longueur : 0, presents)
  switch (cle) {
    case 'debit':
      return (m.entres * 3600) / pas
    case 'presents':
      return presents
    case 'densite':
      return parKm(troncon, presents)
    case 'vitesse':
      return m.vitesse === null ? null : m.vitesse * 3.6
    case 'relative':
      return m.vitesse === null ? null : ((m.vitesse * 3.6) / troncon.vmax) * 100
    case 'perte':
      return m.perte / voitures
    case 'attente':
      return m.attente / voitures
  }
}

/** Couleur du palier où tombe la valeur. */
export function couleurPalier(indicateur: Indicateur, valeur: number): string {
  return (indicateur.paliers.find((p) => valeur < p.jusqua) ?? indicateur.paliers.at(-1)!).couleur
}

export function formater(indicateur: Indicateur, valeur: number | null): string {
  if (valeur === null) return '–'
  return `${valeur.toLocaleString('fr-FR', { maximumFractionDigits: indicateur.decimales })} ${indicateur.unite}`
}

/** 27000 -> « 7:30 ». */
export function heure(secondes: number): string {
  const minutes = Math.floor(secondes / 60)
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
}
