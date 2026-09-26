/**
 * Brouillon du programme par étapes d'un carrefour (plans de feux) et opérations d'édition,
 * sans effet de bord. Le calcul (transitions, diagramme de feux) est celui de @voirie/engine.
 */
import {
  cleVoie,
  proposerEtapes,
  type ContexteProgramme,
  type GeometrieCarrefour,
  type LigneConflits,
} from '@voirie/engine'
import {
  PLAGE_TOUTE_LA_JOURNEE,
  typeLigne,
  type BranchesCarrefour,
  type Connexion,
  type Jour,
  type LigneFeux,
  type Plage,
  type PlanEtapes,
  type PlanProgramme,
  type PlanSaisi,
} from '@voirie/schema'
import type { EtatFeu } from './calque/elements'

export const JOURS: Array<{ jour: Jour; lettre: string; nom: string }> = [
  { jour: 'lun', lettre: 'L', nom: 'lundi' },
  { jour: 'mar', lettre: 'M', nom: 'mardi' },
  { jour: 'mer', lettre: 'M', nom: 'mercredi' },
  { jour: 'jeu', lettre: 'J', nom: 'jeudi' },
  { jour: 'ven', lettre: 'V', nom: 'vendredi' },
  { jour: 'sam', lettre: 'S', nom: 'samedi' },
  { jour: 'dim', lettre: 'D', nom: 'dimanche' },
]

/** Géométrie enregistrée du carrefour, telle que le moteur l'attend. */
export function geometrieEnregistree(configuration: BranchesCarrefour): GeometrieCarrefour {
  return {
    centre: configuration.centre,
    connexions: configuration.connexions,
    voies: new Map(
      configuration.branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v.geom] as const)),
    ),
    traversees: new Map(configuration.branches.flatMap((b) => (b.traversee ? [[b.code, b.traversee] as const] : []))),
  }
}

export const lignesPourMoteur = (lignes: readonly LigneFeux[]): LigneConflits[] =>
  lignes.map((l) => ({ code: l.code, type: typeLigne(l.signal), mouvements: l.mouvements, traverse: l.traverse }))

/** Plans tels qu'ils se saisissent et s'enregistrent : sans les champs calculés par l'API. */
export const plansSaisis = (plans: readonly (PlanSaisi | PlanProgramme)[]): PlanSaisi[] =>
  plans.map((plan) => {
    const { cycle_s: _cycle, etapes_deduites: _deduites, ...saisi } = plan as PlanProgramme
    return saisi
  })

const CODES_PLANS = ['jour', 'nuit', 'pointe-matin', 'pointe-soir', 'week-end']

export function nouveauPlan(plans: readonly PlanSaisi[], contexte: ContexteProgramme): PlanEtapes {
  const pris = new Set(plans.map((p) => p.code))
  let code = CODES_PLANS.find((c) => !pris.has(c))
  for (let n = 2; !code; n++) if (!pris.has(`plan-${n}`)) code = `plan-${n}`
  return {
    code,
    mode: 'cycle',
    plages: [PLAGE_TOUTE_LA_JOURNEE],
    jaune_s: 3,
    etapes: proposerEtapes(contexte.lignes, contexte.conflits),
    degagements: {},
  }
}

/** Change le mode d'un plan ; repasser en cycle propose des étapes. */
export function changerMode(plan: PlanSaisi, mode: PlanSaisi['mode'], contexte: ContexteProgramme): PlanSaisi {
  if (mode === plan.mode) return plan
  if (mode !== 'cycle') return { code: plan.code, plages: plan.plages, mode }
  return { ...nouveauPlan([], contexte), code: plan.code, plages: plan.plages }
}

/** Ajoute ou retire un jour d'une plage ; les sept jours s'écrivent « tous », et il en reste toujours un. */
export function basculerJour(plage: Plage, jour: Jour): Plage {
  const jours = new Set(plage.jours === 'tous' ? JOURS.map((j) => j.jour) : plage.jours)
  if (jours.has(jour)) jours.delete(jour)
  else jours.add(jour)
  if (jours.size === 0) return plage
  return { ...plage, jours: jours.size === JOURS.length ? 'tous' : JOURS.map((j) => j.jour).filter((j) => jours.has(j)) }
}

export function basculerLigneEtape(plan: PlanEtapes, index: number, code: string, ordre: readonly string[]): PlanEtapes {
  return {
    ...plan,
    etapes: plan.etapes.map((etape, i) => {
      if (i !== index) return etape
      const lignes = etape.lignes.includes(code) ? etape.lignes.filter((c) => c !== code) : [...etape.lignes, code]
      // Ordre des lignes de feux, les codes inconnus à la fin.
      const rang = (c: string) => (ordre.includes(c) ? ordre.indexOf(c) : ordre.length)
      return { ...etape, lignes: lignes.sort((a, b) => rang(a) - rang(b)) }
    }),
  }
}

export function deplacerEtape(plan: PlanEtapes, index: number, decalage: -1 | 1): PlanEtapes {
  const cible = index + decalage
  if (cible < 0 || cible >= plan.etapes.length) return plan
  const etapes = [...plan.etapes]
  ;[etapes[index], etapes[cible]] = [etapes[cible]!, etapes[index]!]
  return { ...plan, etapes }
}

/** Rouge de dégagement saisi à la main ; null revient à la valeur calculée. */
export function saisirDegagement(plan: PlanEtapes, cle: string, rouge: number | null): PlanEtapes {
  const { [cle]: _ancien, ...autres } = plan.degagements
  return { ...plan, degagements: rouge === null ? autres : { ...autres, [cle]: rouge } }
}

/**
 * Couleur du feu de chaque connexion et de chaque passage piéton, d'après l'état de chaque
 * ligne de feux (lecture du programme sur la carte).
 */
export function feuxDesLignes(
  etats: ReadonlyMap<string, EtatFeu>,
  lignes: readonly LigneFeux[],
  connexions: readonly Connexion[],
): { connexions: Map<string, EtatFeu>; traversees: Map<string, EtatFeu> } {
  const parMouvement = new Map<string, EtatFeu>()
  const traversees = new Map<string, EtatFeu>()
  for (const ligne of lignes) {
    const etat = etats.get(ligne.code)
    if (!etat) continue
    for (const mouvement of ligne.mouvements) parMouvement.set(mouvement, etat)
    if (ligne.traverse) traversees.set(ligne.traverse, etat)
  }
  const branche = (cle: string) => cle.split(':')[0]
  return {
    connexions: new Map(
      connexions.flatMap((c) => {
        const etat = parMouvement.get(`${branche(c.de)}>${branche(c.vers)}`)
        return etat ? [[`${c.de}>${c.vers}`, etat] as const] : []
      }),
    ),
    traversees,
  }
}
