import { analyserReleve, calculerProgramme, degagementsRetenus, type ContexteProgramme, type SaisieReleve } from '@voirie/engine'
import type { PlanEtapes } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import { proposerCorrections } from './corrections'

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

const plan: PlanEtapes = {
  code: 'jour',
  mode: 'cycle',
  plages: [{ jours: 'tous', de: '00:00', a: '00:00' }],
  jaune_s: 3,
  degagements: {},
  arcs: [],
  etapes: [
    { lignes: ['F1', 'P1'], duree_s: 20 },
    { lignes: ['F2'], duree_s: 20 },
  ],
}

const resultat = calculerProgramme({
  ...contexte,
  etapes: plan.etapes,
  jaune_s: plan.jaune_s,
  degagements: degagementsRetenus(contexte.degagements, plan.degagements),
})

/**
 * `n` cycles relevés d'après le diagramme calculé : F1 au vert `ecart_s` de plus (le cycle s'allonge
 * d'autant, F2 se décale), P1 absent des cycles `sansP1`.
 */
function releve(n: number, { ecart_s = 0, sansP1 = [] as number[] } = {}): SaisieReleve[] {
  const cycle_s = resultat.cycle_s + ecart_s
  const vert = (ligne: string): [number, number] => {
    const [a, b] = resultat.verts[ligne]![0]!
    return ligne === 'F1' ? [a, b + ecart_s] : ligne === 'F2' ? [a + ecart_s, b + ecart_s] : [a, b]
  }
  return Array.from({ length: n }, (_, i) =>
    ['F1', 'F2', 'P1']
      .filter((ligne) => !(ligne === 'P1' && sansP1.includes(i)))
      .flatMap((ligne) => {
        const [a, b] = vert(ligne)
        return [
          { t: (i * cycle_s + a) * 1000, ligne, couleur: 'vert' as const },
          { t: (i * cycle_s + b) * 1000, ligne, couleur: 'rouge' as const },
        ]
      }),
  ).flat()
}

const corriger = (saisies: SaisieReleve[]) => proposerCorrections(plan, resultat, analyserReleve(saisies, ['F1', 'F2', 'P1']))

describe('corrections tirées d’un relevé', () => {
  it('allonge l’étape dont le vert est mesuré plus long, et rien d’autre', () => {
    const { corrections, remarques } = corriger(releve(5, { ecart_s: 5 }))
    expect(corrections.map((c) => c.cle)).toEqual(['duree:0'])
    expect(corrections[0]!.appliquer(plan).etapes.map((e) => e.duree_s)).toEqual([25, 20])
    expect(remarques).toEqual([])
  })

  it('passe sur appel l’étape d’une ligne absente de certains cycles', () => {
    const { corrections } = corriger(releve(5, { sansP1: [1, 3] }))
    expect(corrections.map((c) => c.cle)).toEqual(['appel:0:P1'])
    expect(corrections[0]!.appliquer(plan).etapes[0]).toMatchObject({ appel: 'P1' })
  })

  it('signale les bus vus, sans correction', () => {
    const { corrections, remarques } = corriger([...releve(4), { t: 1000, evenement: 'bus' }])
    expect(corrections).toEqual([])
    expect(remarques).toHaveLength(1)
    expect(remarques[0]).toMatch(/priorité/)
  })

  it('corrige le jaune mesuré quand il diffère du plan d’une seconde ou plus', () => {
    // Le jaune de F1 et F2 relevé à 4 s (plan : 3 s), juste avant leur rouge.
    const avecJaune = releve(5).flatMap((s) =>
      'couleur' in s && s.couleur === 'rouge' && s.ligne !== 'P1' ? [{ ...s, t: s.t - 4000, couleur: 'jaune' as const }, s] : [s],
    )
    const { corrections } = corriger(avecJaune)
    expect(corrections.find((c) => c.cle === 'jaune')?.appliquer(plan).jaune_s).toBe(4)
  })

  it('n’a rien à corriger quand le relevé suit le programme', () => {
    expect(corriger(releve(5))).toEqual({ corrections: [], remarques: [] })
  })
})
