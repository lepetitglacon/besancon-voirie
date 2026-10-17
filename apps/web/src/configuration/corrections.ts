/**
 * Corrections d'un plan de feux tirées d'un relevé terrain (docs/refonte-plan-de-feux.md §5) :
 * durées d'étape d'après les verts mesurés, étapes servies sur appel quand leur vert manque à
 * certains cycles. Chacune s'applique au brouillon du programme, rien n'est enregistré sans relecture.
 */
import { dureeDuVert, ECART_RELEVE_S, type ResultatProgramme, type SyntheseReleve } from '@voirie/engine'
import type { PlanEtapes } from '@voirie/schema'
import { changerAppel, DUREE_ETAPE_MAX_S, DUREE_ETAPE_MIN_S } from './programme'

export interface Correction {
  /** Stable d'un calcul à l'autre : la liste se redessine à chaque saisie du brouillon. */
  cle: string
  message: string
  appliquer: (plan: PlanEtapes) => PlanEtapes
}

/** Une ligne vue au vert sur moins de cette part des cycles relevés est servie à la demande. */
const PART_DES_CYCLES_APPEL = 0.7

/** Écart de jaune qui vaut une correction (s), et bornes du jaune comme dans la saisie. */
const ECART_JAUNE_S = 1
const JAUNE_MIN_S = 2
const JAUNE_MAX_S = 6

const arrondi = (x: number) => Math.round(x * 10) / 10

export function proposerCorrections(
  plan: PlanEtapes,
  resultat: ResultatProgramme,
  releve: SyntheseReleve,
): { corrections: Correction[]; remarques: string[] } {
  const corrections: Correction[] = []
  const remarques: string[] = []
  const etapesDe = (ligne: string) => plan.etapes.flatMap((e, i) => (e.lignes.includes(ligne) && !e.hors_cycle ? [i] : []))

  // 1. Verts : l'écart d'une ligne s'ajoute à la durée de la seule étape qui la met au vert.
  const ecartsParEtape = new Map<number, Array<{ ligne: string; ecart_s: number }>>()
  for (const [ligne, mesure_s] of Object.entries(releve.verts)) {
    const theorique_s = dureeDuVert(resultat.verts[ligne] ?? [], resultat.cycle_s)
    if (mesure_s === null || theorique_s === null || Math.abs(mesure_s - theorique_s) < ECART_RELEVE_S) continue
    const etapes = etapesDe(ligne)
    if (etapes.length !== 1) {
      remarques.push(`${ligne} : vert mesuré ${mesure_s} s, programme ${theorique_s} s, sur ${etapes.length} étapes : à répartir à la main.`)
      continue
    }
    ecartsParEtape.set(etapes[0]!, [...(ecartsParEtape.get(etapes[0]!) ?? []), { ligne, ecart_s: mesure_s - theorique_s }])
  }
  let ajout_s = 0
  for (const [index, ecarts] of ecartsParEtape) {
    // Plusieurs lignes de la même étape : on retient leur écart moyen.
    const ecart_s = Math.round(ecarts.reduce((total, e) => total + e.ecart_s, 0) / ecarts.length)
    const avant = plan.etapes[index]!.duree_s
    const apres = Math.min(DUREE_ETAPE_MAX_S, Math.max(DUREE_ETAPE_MIN_S, avant + ecart_s))
    if (apres === avant) continue
    ajout_s += apres - avant
    corrections.push({
      cle: `duree:${index}`,
      message: `Étape ${index + 1} : ${avant} → ${apres} s (vert de ${ecarts.map((e) => e.ligne).join(', ')} ${ecart_s > 0 ? 'plus long' : 'plus court'} de ${Math.abs(ecart_s)} s)`,
      appliquer: (p) => ({ ...p, etapes: p.etapes.map((e, i) => (i === index ? { ...e, duree_s: apres } : e)) }),
    })
  }

  // 2. Appels : une ligne vue au vert sur une partie des cycles seulement.
  const passages = Object.values(releve.tops).map((t) => t.length)
  const cyclesVus = Math.max(0, ...passages)
  if (cyclesVus >= 3) {
    for (const [ligne, tops] of Object.entries(releve.tops)) {
      if (tops.length === 0 || tops.length >= cyclesVus * PART_DES_CYCLES_APPEL) continue
      for (const index of etapesDe(ligne)) {
        const etape = plan.etapes[index]!
        if (etape.appel) continue
        corrections.push({
          cle: `appel:${index}:${ligne}`,
          message: `Étape ${index + 1} servie sur appel de ${ligne} (vue au vert ${tops.length} cycles sur ${cyclesVus})`,
          appliquer: (p) => changerAppel(p, index, ligne),
        })
      }
    }
  }

  // 3. Jaune : la médiane des jaunes relevés (lignes véhicules), s'il diffère du plan d'une seconde ou plus.
  const jaunesVus = Object.values(releve.jaunes ?? {}).filter((j): j is number => j !== null)
  if (jaunesVus.length > 0) {
    const tries = [...jaunesVus].sort((a, b) => a - b)
    const mesure_s = tries[Math.floor(tries.length / 2)]!
    const jaune_s = Math.min(JAUNE_MAX_S, Math.max(JAUNE_MIN_S, Math.round(mesure_s)))
    if (Math.abs(mesure_s - plan.jaune_s) >= ECART_JAUNE_S && jaune_s !== plan.jaune_s) {
      corrections.push({
        cle: 'jaune',
        message: `Jaune : ${plan.jaune_s} → ${jaune_s} s (mesuré ${arrondi(mesure_s)} s)`,
        appliquer: (p) => ({ ...p, jaune_s }),
      })
    }
  }

  // 4. Ce que les corrections n'expliquent pas, et ce que le relevé a vu.
  if (releve.cycle) {
    const reste_s = arrondi(releve.cycle.cycle_s - resultat.cycle_s - ajout_s)
    if (Math.abs(reste_s) >= ECART_RELEVE_S) {
      remarques.push(
        `Cycle mesuré ${releve.cycle.cycle_s} s : il reste ${reste_s > 0 ? '+' : ''}${reste_s} s après corrections (rouges de dégagement, jaune, ou ligne non relevée).`,
      )
    }
  }
  const { bus, tram, boucle, pieton } = releve.evenements
  if (bus + tram > 0) {
    remarques.push(`${bus + tram} passage(s) de bus ou de tram vus : si un vert s'allonge à leur arrivée, ajoutez une priorité (onglet Graphe).`)
  }
  if (boucle + pieton > 0 && !corrections.some((c) => c.cle.startsWith('appel:'))) {
    remarques.push(`${boucle + pieton} appel(s) vus (boucle, bouton) sans étape manquante : le carrefour sert peut-être ces étapes à chaque cycle.`)
  }
  return { corrections, remarques }
}
