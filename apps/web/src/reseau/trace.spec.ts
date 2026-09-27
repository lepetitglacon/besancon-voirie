import type { LonLat } from '@voirie/engine'
import { describe, expect, it } from 'vitest'
import { cliquer, retirerDernier, versNouveauTroncon, type Trace } from './trace'

const memePoint = (a: LonLat, b: LonLat) => a[0] === b[0] && a[1] === b[1]
const N1 = '00000000-0000-4000-8000-000000000001'
const T1 = '00000000-0000-4000-8000-000000000002'

describe('tracé d’un tronçon', () => {
  it('part d’un nœud, passe par un point libre et finit sur un tronçon', () => {
    let r = cliquer([], [6, 47], { type: 'noeud', id: N1 }, memePoint)
    expect(r.termine).toBe(false)
    r = cliquer(r.trace, [6.001, 47], null, memePoint)
    expect(r.termine).toBe(false)
    r = cliquer(r.trace, [6.002, 47.001], { type: 'troncon', id: T1 }, memePoint)
    expect(r.termine).toBe(true)
    expect(versNouveauTroncon(r.trace, { nom: null, voies_avant: 1, voies_arriere: 1, vitesse_kmh: null })).toEqual({
      nom: null,
      voies_avant: 1,
      voies_arriere: 1,
      vitesse_kmh: null,
      points: [
        [6, 47],
        [6.001, 47],
        [6.002, 47.001],
      ],
      de: { type: 'noeud', id: N1 },
      vers: { type: 'troncon', id: T1 },
    })
  })

  it('finit sur un point libre en recliquant le dernier point', () => {
    const trace: Trace = [
      { position: [6, 47], accroche: { type: 'libre' } },
      { position: [6.001, 47], accroche: { type: 'libre' } },
    ]
    expect(cliquer(trace, [6.001, 47], null, memePoint)).toEqual({ trace, termine: true })
  })

  it('ignore un second clic sur le nœud de départ', () => {
    const { trace } = cliquer([], [6, 47], { type: 'noeud', id: N1 }, memePoint)
    expect(cliquer(trace, [6, 47], { type: 'noeud', id: N1 }, memePoint)).toEqual({ trace, termine: false })
  })

  it('retire le dernier point, et refuse un tracé d’un seul point', () => {
    const { trace } = cliquer([], [6, 47], null, memePoint)
    expect(retirerDernier(trace)).toEqual([])
    expect(versNouveauTroncon(trace, { nom: null, voies_avant: 1, voies_arriere: 1, vitesse_kmh: null })).toBeNull()
  })
})
