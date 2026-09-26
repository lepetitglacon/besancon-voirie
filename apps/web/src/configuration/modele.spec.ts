import { genererVoies, type LonLat } from '@voirie/engine'
import type { Branche } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import {
  ajouterVoie,
  basculerConnexion,
  basculerTraversee,
  deplacerPoignee,
  renommerBranche,
  retirerVoie,
  supprimerBranche,
  voiesDe,
  type Brouillon,
} from './modele'

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
    traversee: g.traversee,
  }
}

const depart: Brouillon = {
  branches: [branche('S', 180, 1, 1), branche('N', 0, 1, 1)],
  connexions: [
    { de: 'S:e0', vers: 'N:s0' },
    { de: 'N:e0', vers: 'S:s0' },
  ],
}

describe('opérations du brouillon', () => {
  it('ajoute une voie à côté de la dernière, sans déplacer les voies calées', () => {
    const suivant = ajouterVoie(depart, 'S', 'entrante', centre)
    const voies = voiesDe(suivant.branches[0]!, 'entrante')
    expect(voies.map((v) => v.rang)).toEqual([0, 1])
    expect(voies[0]!.geom).toEqual(voiesDe(depart.branches[0]!, 'entrante')[0]!.geom)
    expect(voies[1]!.geom).toEqual(genererVoies(centre, 180, 2, 1).entrantes[1]!.map(([x, y]) => [
      expect.closeTo(x, 9),
      expect.closeTo(y, 9),
    ]))
  })

  it('retire la dernière voie et ses connexions', () => {
    const suivant = retirerVoie(depart, 'N', 'sortante')
    expect(voiesDe(suivant.branches[1]!, 'sortante')).toEqual([])
    expect(suivant.connexions).toEqual([{ de: 'N:e0', vers: 'S:s0' }])
  })

  it('répercute un renommage dans les connexions', () => {
    const suivant = renommerBranche(depart, 'S', 'S2')
    expect(suivant.branches[0]!.code).toBe('S2')
    expect(suivant.connexions).toEqual([
      { de: 'S2:e0', vers: 'N:s0' },
      { de: 'N:e0', vers: 'S2:s0' },
    ])
  })

  it('supprime une branche et ses connexions', () => {
    expect(supprimerBranche(depart, 'N')).toEqual({ branches: [depart.branches[0]], connexions: [] })
  })

  it('ajoute puis retire une connexion par le même geste', () => {
    const avec = basculerConnexion(depart, 'S:e0', 'S:s0')
    expect(avec.connexions).toHaveLength(3)
    expect(basculerConnexion(avec, 'S:e0', 'S:s0').connexions).toEqual(depart.connexions)
  })

  it('déplace l’extrémité d’une voie ou d’un passage piéton', () => {
    const cible: LonLat = [6.0301, 47.2499]
    const voie = deplacerPoignee(depart, { role: 'voie', cle: 'S:e0', sens: 'entrante', extremite: 0 }, cible)
    expect(voiesDe(voie.branches[0]!, 'entrante')[0]!.geom[0]).toEqual(cible)
    const passage = deplacerPoignee(depart, { role: 'traversee', branche: 'N', extremite: 1 }, cible)
    expect(passage.branches[1]!.traversee![1]).toEqual(cible)
  })

  it('retire puis remet un passage piéton', () => {
    const sans = basculerTraversee(depart, 'S', centre)
    expect(sans.branches[0]!.traversee).toBeNull()
    expect(basculerTraversee(sans, 'S', centre).branches[0]!.traversee).toHaveLength(2)
  })
})
