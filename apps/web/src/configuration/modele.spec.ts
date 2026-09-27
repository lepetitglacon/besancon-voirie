import { distanceArretGiratoire, genererVoies, repereLocal, type LonLat, type Segment } from '@voirie/engine'
import type { Branche } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import {
  ajouterVoie,
  basculerConnexion,
  basculerTraversee,
  changerPrioriteEntree,
  creerAnneau,
  deplacerPoignee,
  deplacerVoie,
  regenererVoies,
  retirerAnneau,
  renommerBranche,
  retirerVoie,
  supprimerBranche,
  supprimerVoie,
  tracerVoie,
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
    priorite_entree: null,
  }
}

const depart: Brouillon = {
  branches: [branche('S', 180, 1, 1), branche('N', 0, 1, 1)],
  connexions: [
    { de: 'S:e0', vers: 'N:s0' },
    { de: 'N:e0', vers: 'S:s0' },
  ],
  anneau: null,
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
    expect(supprimerBranche(depart, 'N')).toEqual({ branches: [depart.branches[0]], connexions: [], anneau: null })
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

describe('voies tracées à la main', () => {
  const { versLonLat } = repereLocal(centre)
  /** Segment en mètres autour du centre : x vers l'est, y vers le nord. */
  const trait = (a: [number, number], b: [number, number]): Segment => [versLonLat(a), versLonLat(b)]

  it('rejoint la branche la plus proche, au rang que donne sa position', () => {
    // Branche S (azimut 180) : l'entrante e0 est à 1,6 m à l'est de l'axe ; la nouvelle, entre l'axe
    // et e0, est la plus à gauche du conducteur qui remonte vers le nord.
    const resultat = tracerVoie(depart, trait([0.4, -15], [0.4, -40]), centre)!
    expect(resultat.cle).toBe('S:e0')
    expect(voiesDe(resultat.brouillon.branches[0]!, 'entrante')).toHaveLength(2)
    expect(resultat.brouillon.connexions).toEqual([
      { de: 'S:e1', vers: 'N:s0' },
      { de: 'N:e0', vers: 'S:s0' },
    ])
  })

  it('déduit le sens de son côté de l’axe', () => {
    expect(tracerVoie(depart, trait([-5, -15], [-5, -40]), centre)!.cle).toBe('S:s1')
    expect(tracerVoie(depart, trait([5, -15], [5, -40]), centre)!.cle).toBe('S:e1')
  })

  it('ouvre une nouvelle branche loin des autres', () => {
    const resultat = tracerVoie(depart, trait([15, 1], [40, 1]), centre)!
    expect(resultat.cle).toBe('E:e0')
    expect(resultat.brouillon.branches.at(-1)).toMatchObject({ code: 'E', nom: null, traversee: null })
    expect(resultat.brouillon.branches.at(-1)!.azimut).toBeCloseTo(88.6, 0)
  })

  it('ignore un trait trop court', () => {
    expect(tracerVoie(depart, trait([0, -15], [0, -16]), centre)).toBeNull()
  })

  it('supprime une voie quelconque et fait remonter les suivantes', () => {
    const avec = tracerVoie(depart, trait([0.4, -15], [0.4, -40]), centre)!.brouillon
    const sans = supprimerVoie(avec, 'S:e0')
    expect(voiesDe(sans.branches[0]!, 'entrante').map((v) => v.rang)).toEqual([0])
    expect(sans.connexions).toEqual(depart.connexions)
  })

  it('change une voie de sens en retirant ses connexions', () => {
    const resultat = deplacerVoie(depart, 'S:e0', { branche: 'S', sens: 'sortante' }, centre)!
    expect(resultat.cle).toBe('S:s0')
    expect(voiesDe(resultat.brouillon.branches[0]!, 'entrante')).toEqual([])
    expect(voiesDe(resultat.brouillon.branches[0]!, 'sortante').map((v) => v.rang)).toEqual([0, 1])
    expect(resultat.brouillon.connexions).toEqual([{ de: 'N:e0', vers: 'S:s1' }])
  })
})

describe('giratoire', () => {
  const giratoire = creerAnneau(depart, centre)
  const distance = (a: LonLat, b: LonLat) => Math.hypot(...repereLocal(a).versXY(b))

  it('replace les voies au bord de l’anneau, depuis le centre de l’îlot', () => {
    const decale = deplacerPoignee(giratoire, { role: 'anneau', point: 'centre' }, [6.0301, 47.2501])
    const replace = regenererVoies(decale, 'S', centre)
    const entree = voiesDe(replace.branches[0]!, 'entrante')[0]!
    expect(distance(decale.anneau!.centre, entree.geom[0])).toBeGreaterThan(distanceArretGiratoire(decale.anneau!) - 0.01)
    expect(distance(decale.anneau!.centre, entree.geom[0])).toBeLessThan(distanceArretGiratoire(decale.anneau!) + 2)
  })

  it('règle le rayon en tirant le bord de l’anneau, dans les bornes du schéma', () => {
    const [x, y] = [20, 0]
    const bord = repereLocal(centre).versLonLat([x, y])
    expect(deplacerPoignee(giratoire, { role: 'anneau', point: 'bord' }, bord).anneau!.rayon_m).toBe(20)
    expect(deplacerPoignee(giratoire, { role: 'anneau', point: 'bord' }, centre).anneau!.rayon_m).toBe(4)
  })

  it('enregistre le cédez-le-passage comme règle par défaut, et l’oublie sans anneau', () => {
    const stop = changerPrioriteEntree(giratoire, 'S', 'stop')
    expect(stop.branches[0]!.priorite_entree).toBe('stop')
    expect(changerPrioriteEntree(stop, 'S', 'cedez_le_passage').branches[0]!.priorite_entree).toBeNull()
    expect(retirerAnneau(stop).branches[0]!.priorite_entree).toBeNull()
  })

  it('garde l’anneau quand on renomme ou supprime une branche', () => {
    expect(renommerBranche(giratoire, 'S', 'S2').anneau).toEqual(giratoire.anneau)
    expect(supprimerBranche(giratoire, 'S').anneau).toEqual(giratoire.anneau)
  })
})
