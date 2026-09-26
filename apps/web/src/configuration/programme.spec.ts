import type { ContexteProgramme } from '@voirie/engine'
import type { LigneFeux, PlanEtapes } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import { basculerJour, basculerLigneEtape, changerMode, feuxDesLignes, nouveauPlan, plansSaisis, saisirDegagement } from './programme'

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
