import { repereLocal, type LonLat } from '@voirie/engine'
import type { ReseauGeoJson, TronconResume } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import { geometrieRues } from './voiesRues'

const origine: LonLat = [6.03, 47.25]
const { versLonLat, versXY } = repereLocal(origine)
const m = (x: number, y: number) => versLonLat([x, y])

const troncon = (id: string, de: string, vers: string, points: LonLat[], avant: number, arriere: number): ReseauGeoJson['troncons']['features'][number] => ({
  type: 'Feature',
  id,
  geometry: { type: 'LineString', coordinates: points },
  properties: {
    id, nom: null, highway: null, voies_avant: avant, voies_arriere: arriere, types_avant: null, types_arriere: null, vitesse_kmh: null,
    source: 'osm', modifie: false, noeud_de: de, noeud_vers: vers, carrefour_de: null, carrefour_vers: null, branche_de: null, branche_vers: null,
  } satisfies TronconResume,
})
const noeud = (id: string, degre: number, carrefour: string | null = null): ReseauGeoJson['noeuds']['features'][number] => ({
  type: 'Feature',
  id,
  geometry: { type: 'Point', coordinates: origine },
  properties: { id, carrefour_id: carrefour, osm_node_id: null, feux: false, pieton: null, degre, liaisons: null },
})

describe('voies des rues', () => {
  const geometrie = geometrieRues(
    [troncon('t1', 'a', 'n', [m(-100, 0), m(0, 0)], 2, 1), troncon('t2', 'n', 'c', [m(0, 0), m(0, 100)], 1, 1)],
    [noeud('a', 1), noeud('n', 3), noeud('c', 1, 'k')],
  )

  it('donne chaque voie dans son sens de circulation', () => {
    expect(geometrie.voies.map((v) => v.cle)).toEqual(['t1:a0', 't1:a1', 't1:r0', 't2:a0', 't2:r0'])
  })

  it('range les bouts de voies par nœud, reculés à une intersection mais pas au bout du réseau', () => {
    expect(geometrie.arrivees.get('n')?.map((b) => [b.troncon, b.rang])).toEqual([
      ['t1', 0],
      ['t1', 1],
      ['t2', 0],
    ])
    expect(geometrie.departs.get('n')?.map((b) => [b.troncon, b.rang])).toEqual([
      ['t1', 0],
      ['t2', 0],
    ])
    // Nœud à 3 tronçons : recul de 4 + 3 voies × 3,25 × 0,6 ≈ 9,85 m.
    const arrivee = geometrie.arrivees.get('n')![0]!
    expect(versXY(arrivee.bout)[0]).toBeCloseTo(-9.85, 1)
    // Au bout « c » (cul-de-sac), la voie arrive au bout du tronçon.
    expect(versXY(geometrie.arrivees.get('c')![0]!.bout)[1]).toBeCloseTo(100, 3)
  })
})
