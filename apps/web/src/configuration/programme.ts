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
  type LonLat,
} from '@voirie/engine'
import {
  PLAGE_TOUTE_LA_JOURNEE,
  typeLigne,
  type Branche,
  type Connexion,
  type Jour,
  type LigneFeux,
  type ArcGraphe,
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

/** Géométrie du carrefour (enregistrée ou brouillon), telle que le moteur l'attend. */
export function geometrieEnregistree(configuration: {
  centre: LonLat
  branches: readonly Branche[]
  connexions: readonly Connexion[]
}): GeometrieCarrefour {
  return {
    centre: configuration.centre,
    connexions: configuration.connexions,
    voies: new Map(
      configuration.branches.flatMap((b) => b.voies.map((v) => [cleVoie(b.code, v.sens, v.rang), v.geom] as const)),
    ),
    traversees: new Map(configuration.branches.flatMap((b) => (b.passages.length ? [[b.code, b.passages] as const] : []))),
    troncons: new Set(configuration.branches.filter((b) => b.troncon).map((b) => b.code)),
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
    arcs: [],
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

/** Échange deux étapes, en suivant leurs arcs. */
export function deplacerEtape(plan: PlanEtapes, index: number, decalage: -1 | 1): PlanEtapes {
  const cible = index + decalage
  if (cible < 0 || cible >= plan.etapes.length) return plan
  const etapes = [...plan.etapes]
  ;[etapes[index], etapes[cible]] = [etapes[cible]!, etapes[index]!]
  const suivre = (i: number) => (i === index ? cible : i === cible ? index : i)
  return { ...plan, etapes, arcs: plan.arcs.map((a) => ({ ...a, de: suivre(a.de), vers: suivre(a.vers) })) }
}

/** Retire une étape et les arcs qui la touchent ; les arcs suivants sont renumérotés. */
export function retirerEtape(plan: PlanEtapes, index: number): PlanEtapes {
  const suivre = (i: number) => (i > index ? i - 1 : i)
  return {
    ...plan,
    etapes: plan.etapes.filter((_, i) => i !== index),
    arcs: plan.arcs
      .filter((a) => a.de !== index && a.vers !== index)
      .map((a) => ({ ...a, de: suivre(a.de), vers: suivre(a.vers) })),
  }
}

/** Met une étape sur appel d'une de ses lignes, ou la sert toujours (null). */
export function changerAppel(plan: PlanEtapes, index: number, appel: string | null): PlanEtapes {
  return { ...plan, etapes: plan.etapes.map((e, i) => (i === index ? { ...e, appel } : e)) }
}

/** Sort une étape du cycle de base (étape tram) ou l'y remet ; une étape hors cycle n'a pas d'appel. */
export function basculerHorsCycle(plan: PlanEtapes, index: number): PlanEtapes {
  return {
    ...plan,
    etapes: plan.etapes.map((e, i) => (i === index ? { ...e, hors_cycle: !e.hors_cycle, appel: null } : e)),
  }
}

export function ajouterArc(plan: PlanEtapes, arc: ArcGraphe): PlanEtapes {
  return { ...plan, arcs: [...plan.arcs, arc] }
}

export function modifierArc(plan: PlanEtapes, k: number, modification: Partial<ArcGraphe>): PlanEtapes {
  return {
    ...plan,
    arcs: plan.arcs.map((a, j) => {
      if (j !== k) return a
      const arc = { ...a, ...modification }
      return arc.demande === null ? { ...arc, anticipe: false } : arc
    }),
  }
}

export function retirerArc(plan: PlanEtapes, k: number): PlanEtapes {
  return { ...plan, arcs: plan.arcs.filter((_, j) => j !== k) }
}

/**
 * Priorité (tram, bus) : une étape hors cycle qui sert `ligne`, atteinte depuis chaque étape
 * du cycle dès que `ligne` est demandée (en écourtant l'étape en cours) ; le cycle reprend
 * ensuite après l'étape interrompue.
 */
export function ajouterPriorite(plan: PlanEtapes, ligne: string, duree_s = 12): PlanEtapes {
  const index = plan.etapes.length
  const base = plan.etapes.flatMap((e, i) => (e.hors_cycle ? [] : [i]))
  // Une étape où la ligne est déjà au vert sert sa demande sans détour.
  const depuis = base.filter((i) => !plan.etapes[i]!.lignes.includes(ligne))
  return {
    ...plan,
    etapes: [...plan.etapes, { lignes: [ligne], duree_s, hors_cycle: true, appel: null }],
    arcs: [
      ...plan.arcs,
      ...depuis.map((de) => ({ de, vers: index, demande: ligne, anticipe: true })),
    ],
  }
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
