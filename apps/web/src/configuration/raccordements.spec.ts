import { genererVoies, type LonLat } from '@voirie/engine'
import type { Branche, Raccordement } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import { basculerLien, editer, raccordementsAffiches } from './raccordements'

const centre: LonLat = [6.03, 47.25]
function branche(code: string, azimut: number, entrantes: number, sortantes: number): Branche {
  const g = genererVoies(centre, azimut, entrantes, sortantes)
  return {
    code,
    nom: null,
    azimut,
    osm_way_id: null,
    geom: null,
    voies: [
      ...g.entrantes.map((geom, rang) => ({ sens: 'entrante' as const, rang, type: 'generale' as const, geom })),
      ...g.sortantes.map((geom, rang) => ({ sens: 'sortante' as const, rang, type: 'generale' as const, geom })),
    ],
    traversee: null,
    priorite_entree: null,
  }
}

const lu: Raccordement = {
  troncon_id: 't',
  extremite: 'vers',
  nom: 'Rue',
  branche: 'S',
  azimut: 180,
  points: [
    [6.03, 47.2496],
    [6.03, 47.249],
  ],
  voies_vers_carrefour: 1,
  voies_depuis_carrefour: 1,
  liens: { entree: [[0, 0]], sortie: [[0, 0]] },
  liens_auto: true,
}

describe('raccordements dans l’éditeur', () => {
  it('recalcule les liens par défaut sur les voies du brouillon', () => {
    const [r] = raccordementsAffiches([lu], null, [branche('S', 180, 2, 1)])
    expect(r).toMatchObject({ cle: 't:vers', branche: 'S', liens_auto: true })
    expect(r!.liens.entree).toEqual([
      [0, 0],
      [0, 1],
    ])
  })

  it('garde les liens enregistrés, puis ceux saisis', () => {
    const enregistre = { ...lu, liens_auto: false, liens: { entree: [[0, 1]] as Array<[number, number]>, sortie: [] } }
    const [r] = raccordementsAffiches([enregistre], null, [branche('S', 180, 2, 1)])
    expect(r!.liens.entree).toEqual([[0, 1]])
    const brouillon = editer(null, r!, { liens: basculerLien(r!.liens, 'sortie', [0, 0]) })
    const [apres] = raccordementsAffiches([enregistre], brouillon, [branche('S', 180, 2, 1)])
    expect(apres).toMatchObject({ liens_auto: false, liens: { entree: [[0, 1]], sortie: [[0, 0]] } })
  })

  it('change de branche, et revient aux liens par défaut', () => {
    const [r] = raccordementsAffiches([lu], null, [branche('S', 180, 1, 1), branche('O', 270, 2, 2)])
    const brouillon = editer(null, r!, { branche: 'O', liens: null })
    const [apres] = raccordementsAffiches([lu], brouillon, [branche('S', 180, 1, 1), branche('O', 270, 2, 2)])
    expect(apres).toMatchObject({ branche: 'O', liens_auto: true })
    expect(apres!.liens.sortie).toEqual([
      [0, 0],
      [1, 0],
    ])
  })

  it('bascule un lien', () => {
    const liens = { entree: [[0, 0]] as Array<[number, number]>, sortie: [] }
    expect(basculerLien(liens, 'entree', [0, 0]).entree).toEqual([])
    expect(basculerLien(liens, 'entree', [0, 1]).entree).toEqual([
      [0, 0],
      [0, 1],
    ])
  })
})
