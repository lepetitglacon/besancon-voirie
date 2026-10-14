import { liaisonsHorsNoeud, repereLocal, genererVoies, type LonLat } from '@voirie/engine'
import type { Branche } from '@voirie/schema'
import { describe, expect, it } from 'vitest'
import {
  ajouterVoie,
  basculerConnexion,
  basculerTraversee,
  changerPrioriteEntree,
  changerVoiesTroncon,
  deplacerPoignee,
  poserNoeud,
  raccorderBranche,
  regenererVoies,
  retirerAnneau,
  supprimerNoeud,
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
    passages: [g.traversee],
    priorite_entree: null,
    noeud: null,
    troncon: false,
  }
}

const depart: Brouillon = {
  branches: [branche('S', 180, 1, 1), branche('N', 0, 1, 1)],
  connexions: [
    { de: 'S:e0', vers: 'N:s0' },
    { de: 'N:e0', vers: 'S:s0' },
  ],
  chainages: [],
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
    expect(supprimerBranche(depart, 'N')).toEqual({ branches: [depart.branches[0]], connexions: [], chainages: [], anneau: null })
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
    const passage = deplacerPoignee(depart, { role: 'traversee', branche: 'N', index: 0, extremite: 1 }, cible)
    expect(passage.branches[1]!.passages[0]![1]).toEqual(cible)
  })

  it('retire puis remet un passage piéton', () => {
    const sans = basculerTraversee(depart, 'S', centre)
    expect(sans.branches[0]!.passages).toEqual([])
    expect(basculerTraversee(sans, 'S', centre).branches[0]!.passages).toHaveLength(1)
  })
})

describe('giratoire par nœuds', () => {
  const repere = repereLocal(centre)
  const point = (azimut: number, rayon = 15): LonLat =>
    repere.versLonLat([rayon * Math.sin((azimut * Math.PI) / 180), rayon * Math.cos((azimut * Math.PI) / 180)])
  // Quatre nœuds : nord, ouest, sud, puis est (posé en dernier, entre le sud et le nord).
  const quatre = [0, 270, 180, 90].reduce((b, azimut) => poserNoeud(b, point(azimut)), { ...depart, connexions: [] } as Brouillon)
  const troncons = (b: Brouillon) => b.branches.filter((x) => x.troncon).map((x) => x.code).sort()
  const valides = (b: Brouillon) => liaisonsHorsNoeud(b.branches, b.connexions, b.anneau!)

  it('ferme la boucle au troisième nœud et génère un tronçon par nœud', () => {
    const deux = [0, 270].reduce((b, azimut) => poserNoeud(b, point(azimut)), depart)
    expect(troncons(deux)).toEqual([])
    expect(troncons(quatre)).toEqual(['R1', 'R2', 'R3', 'R4'])
    // Chaque nœud a sa liaison « on continue » ; aucune ne relie deux nœuds.
    expect(quatre.connexions).toHaveLength(4)
    expect(valides(quatre)).toEqual([])
  })

  it('coupe un tronçon en deux en posant un nœud, sans liaison entre deux nœuds', () => {
    const cinq = poserNoeud(quatre, point(45))
    expect(troncons(cinq)).toEqual(['R1', 'R2', 'R3', 'R4', 'R5'])
    expect(cinq.connexions).toHaveLength(5)
    expect(valides(cinq)).toEqual([])
  })

  it('recoud la boucle en retirant un nœud', () => {
    const trois = supprimerNoeud(quatre, '2')
    expect(troncons(trois)).toEqual(['R1', 'R3', 'R4'])
    expect(trois.connexions).toHaveLength(3)
    expect(valides(trois)).toEqual([])
  })

  it('raccorde une rue à un nœud avec ses liaisons, et replace ses voies depuis le nœud', () => {
    const raccordee = raccorderBranche(quatre, 'S', '3')
    const sud = raccordee.branches.find((b) => b.code === 'S')!
    expect(sud.noeud).toBe('3')
    expect(raccordee.connexions.filter((c) => c.de.startsWith('S:') || c.vers.startsWith('S:'))).toHaveLength(2)
    expect(valides(raccordee)).toEqual([])
    const replacee = regenererVoies(raccordee, 'S', centre)
    const [bout] = voiesDe(replacee.branches.find((b) => b.code === 'S')!, 'entrante')[0]!.geom
    // La ligne d'arrêt est à une demi-voie d'anneau plus 2 m du nœud.
    expect(Math.hypot(...repereLocal(point(180)).versXY(bout))).toBeGreaterThan(3)
    expect(Math.hypot(...repereLocal(point(180)).versXY(bout))).toBeLessThan(5)
  })

  it('suit un nœud déplacé et garde le nombre de voies des tronçons', () => {
    const deuxVoies = changerVoiesTroncon(quatre, 'R1', 2)
    const deplace = deplacerPoignee(deuxVoies, { role: 'noeud', code: '1' }, point(0, 18))
    expect(voiesDe(deplace.branches.find((b) => b.code === 'R1')!, 'sortante')).toHaveLength(2)
    expect(deplace.anneau!.noeuds.find((n) => n.code === '1')!.position).toEqual(point(0, 18))
  })

  it('enregistre le cédez-le-passage comme règle par défaut, et l’oublie sans anneau', () => {
    const stop = changerPrioriteEntree(quatre, 'S', 'stop')
    expect(stop.branches.find((b) => b.code === 'S')!.priorite_entree).toBe('stop')
    expect(changerPrioriteEntree(stop, 'S', 'cedez_le_passage').branches.find((b) => b.code === 'S')!.priorite_entree).toBeNull()
    const sansAnneau = retirerAnneau(stop)
    expect(sansAnneau.branches.find((b) => b.code === 'S')!.priorite_entree).toBeNull()
    expect(troncons(sansAnneau)).toEqual([])
  })
})
