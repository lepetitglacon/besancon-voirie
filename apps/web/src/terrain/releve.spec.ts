import { describe, expect, it } from 'vitest'
import { basculer, couleurCourante, ecarts, synthese, type Saisie } from './releve'

/** Un feu observé : F1 vert 30 s sur un cycle de 90 s, à partir de `debut` (s). */
const cycles = (n: number, cycle_s = 90, vert_s = 30, debut = 0): Saisie[] =>
  Array.from({ length: n }, (_, i) => [
    { t: (debut + i * cycle_s) * 1000, ligne: 'F1', couleur: 'vert' as const },
    { t: (debut + i * cycle_s + vert_s) * 1000, ligne: 'F1', couleur: 'rouge' as const },
  ]).flat()

describe('saisie au carrefour', () => {
  it('passe une ligne au vert, puis au rouge, à chaque appui', () => {
    const un = basculer([], 'F1', 1000)
    expect(couleurCourante(un, 'F1')).toBe('vert')
    expect(couleurCourante(basculer(un, 'F1', 2000), 'F1')).toBe('rouge')
    expect(couleurCourante(un, 'F2')).toBeNull()
  })
})

describe('synthèse du relevé', () => {
  it('mesure le cycle, le vert et compte les événements', () => {
    const r = synthese([...cycles(5), { t: 5000, evenement: 'bus' }], ['F1', 'F2'])
    expect(r.cycle).toEqual({ cycle_s: 90, ecart_type_s: 0, cycles: 4 })
    expect(r.verts).toEqual({ F1: 30, F2: null })
    expect(r.tops.F1).toHaveLength(5)
    expect(r.evenements.bus).toBe(1)
  })

  it('écarte un cycle doublé par un appui oublié', () => {
    const saisies = cycles(5).filter((s) => s.t !== 180_000)
    expect(synthese(saisies, ['F1']).cycle).toMatchObject({ cycle_s: 90, cycles: 2 })
  })

  it('attend deux cycles avant de donner un cycle mesuré', () => {
    expect(synthese(cycles(2), ['F1']).cycle).toBeNull()
  })
})

describe('écarts avec le programme', () => {
  const releve = synthese(cycles(5, 96, 24), ['F1'])

  it('signale un cycle et un vert qui diffèrent de 2 s ou plus', () => {
    const liste = ecarts(releve, { code: 'jour', cycle_s: 90, verts: { F1: [[0, 30]] } })
    expect(liste.map((e) => e.ligne ?? 'cycle')).toEqual(['cycle', 'F1'])
  })

  it('recolle un vert à cheval sur la fin du cycle', () => {
    expect(ecarts(releve, { code: 'jour', cycle_s: 96, verts: { F1: [[86, 96], [0, 14]] } })).toEqual([])
  })

  it('ne compare rien sans plan à cycle', () => {
    expect(ecarts(releve, null)).toEqual([])
  })
})
