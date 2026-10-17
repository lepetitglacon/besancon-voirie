import type { ContexteProgramme } from '@voirie/engine'
import type { LigneFeux, PlanEtapes } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import {
  ajouterPriorite,
  basculerJour,
  basculerLigneEtape,
  changerMode,
  deplacerEtape,
  etirerEtape,
  feuxDesLignes,
  modifierArc,
  nouveauPlan,
  plansSaisis,
  retirerEtape,
  saisirDegagement,
} from './programme'

const contexte: ContexteProgramme = {
  lignes: [
    { code: 'F1', type: 'vehicule' },
    { code: 'F2', type: 'vehicule' },
    { code: 'P1', type: 'pieton' },
  ],
  conflits: [['F1', 'F2'], ['F2', 'P1']],
  degagements: [],
  longueursTraversees: new Map(),
}

describe('brouillon du programme', () => {
  it('crée un plan à cycle avec des étapes proposées et un nom libre', () => {
    const plan = nouveauPlan([nouveauPlan([], contexte)], contexte)
    expect(plan.code).toBe('nuit')
    expect(plan.etapes.map((e) => e.lignes)).toEqual([['F1', 'P1'], ['F2']])
  })

  it('passe en jaune clignotant puis revient en cycle en gardant nom et plages', () => {
    const jour = nouveauPlan([], contexte)
    const nuit = changerMode(jour, 'jaune_clignotant', contexte)
    expect(nuit).toEqual({ code: 'jour', plages: jour.plages, mode: 'jaune_clignotant' })
    expect(changerMode(nuit, 'cycle', contexte)).toMatchObject({ code: 'jour', mode: 'cycle', jaune_s: 3 })
  })

  it('écrit « tous » pour les sept jours et garde au moins un jour', () => {
    const semaine = basculerJour(basculerJour({ jours: 'tous', de: '07:00', a: '09:00' }, 'sam'), 'dim')
    expect(semaine.jours).toEqual(['lun', 'mar', 'mer', 'jeu', 'ven'])
    expect(basculerJour(basculerJour(semaine, 'sam'), 'dim').jours).toBe('tous')
    const lundi = { jours: ['lun' as const], de: '07:00', a: '09:00' }
    expect(basculerJour(lundi, 'lun')).toBe(lundi)
  })

  it('range les lignes d’une étape dans l’ordre des lignes de feux', () => {
    const plan: PlanEtapes = { ...nouveauPlan([], contexte), etapes: [{ lignes: ['P1'], duree_s: 20 }] }
    expect(basculerLigneEtape(plan, 0, 'F1', ['F1', 'F2', 'P1']).etapes[0]!.lignes).toEqual(['F1', 'P1'])
    expect(basculerLigneEtape(plan, 0, 'P1', ['F1', 'F2', 'P1']).etapes[0]!.lignes).toEqual([])
  })

  it('étire une étape tirée sur le diagramme, à la seconde, entre 1 et 300 s', () => {
    const plan: PlanEtapes = { ...nouveauPlan([], contexte), etapes: [{ lignes: ['F1'], duree_s: 20 }, { lignes: ['F2'], duree_s: 20 }] }
    expect(etirerEtape(plan, 0, 20, 27.4).etapes.map((e) => e.duree_s)).toEqual([27, 20])
    expect(etirerEtape(plan, 1, 45, 10).etapes[1]!.duree_s).toBe(1)
    expect(etirerEtape(plan, 0, 20, 20.3)).toBe(plan)
  })

  it('remplace un rouge de dégagement calculé, puis revient au calcul', () => {
    const plan = saisirDegagement(nouveauPlan([], contexte), 'F1>F2', 4)
    expect(plan.degagements).toEqual({ 'F1>F2': 4 })
    expect(saisirDegagement(plan, 'F1>F2', null).degagements).toEqual({})
  })

  it('retire les champs calculés par l’API avant l’enregistrement', () => {
    const lu = { ...nouveauPlan([], contexte), cycle_s: 50, etapes_deduites: false }
    expect(plansSaisis([lu])[0]).not.toHaveProperty('cycle_s')
  })
})

describe('graphe des étapes', () => {
  const avecTram = (): PlanEtapes =>
    ajouterPriorite(
      {
        ...nouveauPlan([], contexte),
        etapes: [
          { lignes: ['F1'], duree_s: 20 },
          { lignes: ['F2'], duree_s: 20 },
        ],
      },
      'T1',
    )

  it('ajoute une étape prioritaire hors cycle, atteinte depuis chaque étape qui ne sert pas déjà la ligne', () => {
    const plan = avecTram()
    expect(plan.etapes[2]).toMatchObject({ lignes: ['T1'], hors_cycle: true })
    expect(plan.arcs).toEqual([
      { de: 0, vers: 2, demande: 'T1', anticipe: true },
      { de: 1, vers: 2, demande: 'T1', anticipe: true },
    ])
    const avecF1 = ajouterPriorite({ ...nouveauPlan([], contexte), etapes: [{ lignes: ['F1'], duree_s: 20 }, { lignes: ['F2'], duree_s: 20 }] }, 'F1')
    expect(avecF1.arcs.map((a) => a.de)).toEqual([1])
  })

  it('suit les arcs quand on déplace ou retire une étape', () => {
    const deplace = deplacerEtape(avecTram(), 1, 1)
    expect(deplace.etapes[1]).toMatchObject({ hors_cycle: true })
    expect(deplace.arcs).toEqual([
      { de: 0, vers: 1, demande: 'T1', anticipe: true },
      { de: 2, vers: 1, demande: 'T1', anticipe: true },
    ])
    expect(retirerEtape(avecTram(), 0).arcs).toEqual([{ de: 0, vers: 1, demande: 'T1', anticipe: true }])
  })

  it('n’écourte pas une étape sur un arc sans condition', () => {
    expect(modifierArc(avecTram(), 0, { demande: null }).arcs[0]).toEqual({ de: 0, vers: 2, demande: null, anticipe: false })
  })
})

describe('lecture du programme sur la carte', () => {
  it('colore chaque connexion d’après la ligne qui commande son mouvement, et chaque passage piéton', () => {
    const lignes: LigneFeux[] = [
      { code: 'F1', signal: 'R11v', mouvements: ['S>N'], traverse: null, feux: [] },
      { code: 'P1', signal: 'R12', mouvements: [], traverse: 'E', feux: [] },
    ]
    const feux = feuxDesLignes(
      new Map([
        ['F1', 'jaune'],
        ['P1', 'vert'],
      ]),
      lignes,
      [
        { de: 'S:e0', vers: 'N:s0' },
        { de: 'S:e1', vers: 'N:s1' },
        { de: 'E:e0', vers: 'O:s0' },
      ],
    )
    expect([...feux.connexions]).toEqual([
      ['S:e0>N:s0', 'jaune'],
      ['S:e1>N:s1', 'jaune'],
    ])
    expect(feux.traversees.get('E')).toBe('vert')
  })
})
