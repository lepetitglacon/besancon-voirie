import { describe, expect, it } from 'vitest'
import type { CarrefourTempsReel, ReseauTram } from '@voirie/schema'
import { preparerReseau } from '../tram/positionsTrams'
import { approchesTram, carrefoursSurLeTrace } from './priorite'

// Parcours rectiligne vers l'est, ~755 m ; un carrefour à mi-chemin, un autre à 200 m au nord.
const reseau = preparerReseau({
  version: '20260910',
  parcours: [
    {
      id: '101-0',
      ligne: 'T1',
      couleur: '#e2001a',
      couleurTexte: '#ffffff',
      destination: 'Chalezeule',
      coordonnees: [
        [6.0, 47.24],
        [6.01, 47.24],
      ],
      arrets: [],
    },
  ],
} satisfies ReseauTram)
const carrefour = (id: string, position: [number, number]) => ({ id, position }) as CarrefourTempsReel
const surLeTrace = carrefoursSurLeTrace(reseau, [carrefour('milieu', [6.005, 47.2401]), carrefour('loin', [6.005, 47.242])])
const rame = (distance: number, departDans?: number) => ({ vehicule: '801', parcours: '101-0', distance, vitesse: 6, etat: 'en_ligne' as const, departDans })

describe('priorité tram', () => {
  it('repère les carrefours sur le tracé', () => {
    expect([...surLeTrace.keys()]).toEqual(['milieu'])
    expect(surLeTrace.get('milieu')![0]!.distance).toBeCloseTo(378, -1)
  })

  it('donne la priorité de l’approche jusqu’au dégagement du carrefour', () => {
    const d = surLeTrace.get('milieu')![0]!.distance
    expect(approchesTram(surLeTrace, reseau, [rame(d - 300)]).size).toBe(0)
    const approche = approchesTram(surLeTrace, reseau, [rame(d - 60)]).get('milieu')![0]!
    expect(approche).toMatchObject({ ligne: 'T1', distance: 60, dans_s: 10 })
    expect(approchesTram(surLeTrace, reseau, [rame(d + 20)]).get('milieu')![0]!.dans_s).toBe(0)
    expect(approchesTram(surLeTrace, reseau, [rame(d + 60)]).size).toBe(0)
  })

  it('attend le départ d’une rame à quai', () => {
    const d = surLeTrace.get('milieu')![0]!.distance
    expect(approchesTram(surLeTrace, reseau, [rame(d - 50, 30)]).size).toBe(0)
    expect(approchesTram(surLeTrace, reseau, [rame(d - 50, 5)]).size).toBe(1)
  })
})
