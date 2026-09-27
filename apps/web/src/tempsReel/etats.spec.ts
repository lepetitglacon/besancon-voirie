import { describe, expect, it } from 'vitest'
import type { CarrefourTempsReel, PlanTempsReel } from '@voirie/schema'
import { etatCarrefour, jaunesDepuisVerts } from './etats'

// Cycle de 90 s : F1 au vert de 0 à 25, F2 de 30 à 60, P1 (piétons) de 0 à 20.
const jour: PlanTempsReel = {
  code: 'jour',
  mode: 'cycle',
  plages: [{ jours: 'tous', de: '06:00', a: '22:00' }],
  cycle_s: 90,
  jaune_s: 3,
  verts: { F1: [[0, 25]], F2: [[30, 60]], P1: [[0, 20]] },
  // Décalage 0 : à 07:00 (BTS 14 400 s = 160 cycles), le cycle est à 0.
  synchro: { decalage_s: 0, confiance: 'synchronisee', tops: 3, jours: 2, ecart_s: 0.4 },
}
const nuit: PlanTempsReel = { code: 'nuit', mode: 'jaune_clignotant', plages: [{ jours: 'tous', de: '22:00', a: '06:00' }], cycle_s: null, jaune_s: null, verts: null, synchro: null }

const carrefour = (surcharge: Partial<CarrefourTempsReel> = {}): CarrefourTempsReel => ({
  id: 'c',
  nom: 'Test',
  pres_tram: false,
  controleur: { mode: 'fixe', priorite_tc: 'aucune' },
  lignes: [
    { code: 'F1', pieton: false, positions: [[6.02, 47.24]] },
    { code: 'F2', pieton: false, positions: [[6.021, 47.24]] },
    { code: 'P1', pieton: true, positions: [] },
  ],
  plans: [jour, nuit],
  ...surcharge,
})
const a = (hhmmss: string) => Date.parse(`2026-09-28T${hhmmss}+02:00`)

describe('jaunesDepuisVerts', () => {
  it('place le jaune après chaque fin de vert, sans couper un vert à cheval sur la fin du cycle', () => {
    expect(jaunesDepuisVerts([[0, 25]], 90, 3)).toEqual([[25, 28]])
    expect(jaunesDepuisVerts([[0, 10], [80, 90]], 90, 3)).toEqual([[10, 13]])
    expect(jaunesDepuisVerts([[70, 90]], 90, 3)).toEqual([[0, 3]])
  })
})

describe('etatCarrefour', () => {
  it('rejoue le cycle sur l’heure réelle', () => {
    const debut = etatCarrefour(carrefour(), a('07:00:10'))
    expect(debut.position).toBe(10)
    expect(Object.fromEntries(debut.etats)).toEqual({ F1: 'vert', F2: 'rouge', P1: 'vert' })
    expect(debut.fiabilite).toBe('synchronisee')
    const jaune = etatCarrefour(carrefour(), a('07:00:26'))
    expect(Object.fromEntries(jaune.etats)).toEqual({ F1: 'jaune', F2: 'rouge', P1: 'rouge' })
    expect(etatCarrefour(carrefour(), a('07:00:45')).etats.get('F2')).toBe('vert')
  })

  it('fait clignoter le jaune la nuit et éteint les piétons', () => {
    const e = etatCarrefour(carrefour(), a('23:00:00'))
    expect(e.plan?.code).toBe('nuit')
    expect(e.etats.get('F1')).toBe('clignotant')
    expect(e.etats.get('P1')).toBe('eteint')
    expect(etatCarrefour(carrefour(), a('23:00:01')).etats.get('F1')).toBe('eteint')
  })

  it('ne devine rien sans décalage', () => {
    const sansTop = carrefour({ plans: [{ ...jour, synchro: { decalage_s: null, confiance: 'inconnue', tops: 0, jours: 0, ecart_s: null } }] })
    const e = etatCarrefour(sansTop, a('07:00:10'))
    expect(e.fiabilite).toBe('inconnue')
    expect(e.etats.get('F1')).toBe('inconnu')
  })

  it('reste indicatif avec une priorité tram', () => {
    const e = etatCarrefour(carrefour({ pres_tram: true }), a('07:00:10'))
    expect(e.fiabilite).toBe('indicative')
    expect(e.reserves).toHaveLength(1)
  })
})
