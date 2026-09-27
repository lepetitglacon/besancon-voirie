import { branchesTroncons, liaisonsHorsNoeud, repereLocal, type LonLat } from '@voirie/engine';
import type { DetectionBranches } from '@voirie/schema';
import { configurationDepuisLecture, consigne, propositionEnPixels, schemaJsonLecture, type LectureIa } from './lecture.js';
import { cadrePhoto, versPixel } from './photo.js';

const centre: [number, number] = [6.0235472, 47.2450654];
const cadre = cadrePhoto(centre, 120, 1024);

const detection: DetectionBranches = {
  centre,
  rayon_m: 30,
  branches: [
    {
      code: 'S',
      nom: 'Avenue du Maréchal Foch',
      azimut: 170,
      osm_way_id: 32311619,
      geom: [centre, [6.0236, 47.2447]],
      sens: 'double',
      voies: [
        { sens: 'entrante', rang: 0, type: 'generale', geom: [[6.02357, 47.24493], [6.02364, 47.24471]] },
        { sens: 'sortante', rang: 0, type: 'generale', geom: [[6.02352, 47.24493], [6.02358, 47.24471]] },
      ],
      traversee: null,
      priorite_entree: null,
      noeud: null,
      troncon: false,
    },
  ],
  connexions: [],
  anneau: null,
  mouvements: [],
  fleches: {},
  alertes: [],
  sources: { S: 'defaut' },
};

const voie = (x: number, y: number) => ({ type: 'generale' as const, debut: { x, y }, fin: { x, y: y + 200 } });

const lecture = (surcharge: Partial<LectureIa> = {}): LectureIa => ({
  branches: [
    {
      code: 's',
      nom: 'Avenue du Maréchal Foch',
      osm_way_id: 32311619,
      azimut: 530,
      entrantes: [voie(560, 600), voie(590, 600)],
      sortantes: [voie(500, 600)],
      traversee: { debut: { x: 480, y: 580 }, fin: { x: 620, y: 580 } },
      confiance: 'moyenne',
      remarques: 'voie de droite dans l’ombre',
    },
    {
      code: 'O',
      nom: 'Avenue Edgar Faure',
      osm_way_id: null,
      azimut: 260,
      entrantes: [voie(300, 540)],
      sortantes: [voie(300, 480)],
      traversee: null,
      confiance: 'haute',
      remarques: '',
    },
  ],
  connexions: [
    { de: 'S:e0', vers: 'O:s0' },
    { de: 'O:e0', vers: 'S:s0' },
    { de: 'O:e0', vers: 'S:s0' }, // doublon
    { de: 'S:e5', vers: 'O:s0' }, // voie inconnue
    { de: 'O:s0', vers: 'S:e0' }, // sens inversé
  ],
  remarques: 'Flèches peu lisibles.',
  ...surcharge,
});

describe('configurationDepuisLecture', () => {
  it('should convert pixels back to lon/lat lanes on the same spot', () => {
    const { configuration } = configurationDepuisLecture(lecture(), cadre, detection);
    const s = configuration.branches.find((b) => b.code === 'S')!;
    const e0 = s.voies.find((v) => v.sens === 'entrante' && v.rang === 0)!;
    const retour = versPixel(cadre, e0.geom[0]);
    expect(retour.x).toBeCloseTo(560, 1);
    expect(retour.y).toBeCloseTo(600, 1);
    expect(s.voies.filter((v) => v.sens === 'entrante').map((v) => v.rang)).toEqual([0, 1]);
    expect(s.traversee).not.toBeNull();
  });

  it('should normalise codes and azimuts, and keep the OSM axis of a known branch', () => {
    const { configuration } = configurationDepuisLecture(lecture(), cadre, detection);
    const s = configuration.branches.find((b) => b.code === 'S')!;
    expect(s.azimut).toBe(170);
    expect(s.geom).toEqual(detection.branches[0]!.geom);
    const o = configuration.branches.find((b) => b.code === 'O')!;
    expect(o.geom?.[0]).toEqual(centre); // nouvelle branche : axe du centre vers ses voies
  });

  it('should drop unknown, reversed and duplicate connections, and report them', () => {
    const { configuration, ecartees } = configurationDepuisLecture(lecture(), cadre, detection);
    expect(configuration.connexions).toEqual([
      { de: 'S:e0', vers: 'O:s0' },
      { de: 'O:e0', vers: 'S:s0' },
    ]);
    expect(ecartees).toEqual(['O:e0 → S:s0', 'S:e5 → O:s0', 'O:s0 → S:e0']);
  });

  it('should keep the confidence and remarks of each branch', () => {
    const { branches } = configurationDepuisLecture(lecture(), cadre, detection);
    expect(branches.S).toEqual({ confiance: 'moyenne', remarques: 'voie de droite dans l’ombre' });
  });

  it('should reject what the editor schema rejects (duplicate branch codes)', () => {
    const doublon = lecture();
    doublon.branches[1]!.code = 'S';
    expect(() => configurationDepuisLecture(doublon, cadre, detection)).toThrow(/Codes de branche en double/);
  });
});

describe('consigne', () => {
  it('should express the OSM proposal in image pixels', () => {
    const proposition = propositionEnPixels(cadre, detection);
    const e0 = proposition.branches[0]!.entrantes[0]!;
    const attendu = versPixel(cadre, [6.02357, 47.24493]);
    expect(e0.debut).toEqual({ x: Math.round(attendu.x), y: Math.round(attendu.y) });
  });

  it('should give the image path, scale and OSM data', () => {
    const texte = consigne(
      {
        cadre,
        giratoire: false,
        detection,
        feux: [{ id: '00000000-0000-4000-8000-000000000001', numero: 1, type: 'vehicule', position: centre, tags: { highway: 'traffic_signals', note: 'x' } }],
        voiesOsm: [],
      },
      '/tmp/orthophoto.jpg',
    );
    expect(texte).toContain('/tmp/orthophoto.jpg');
    expect(texte).toContain('0.117 m/pixel');
    expect(texte).toContain('"numero":"F1"');
    expect(texte).not.toContain('note'); // tags inutiles écartés
  });

  it('should produce a JSON schema for the CLI', () => {
    const schema = JSON.parse(schemaJsonLecture());
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(['branches', 'connexions', 'remarques']);
    expect(schema.$schema).toBeUndefined();
  });
});

describe('giratoire : nœuds lus sur la photo', () => {
  // Anneau de 20 m de rayon autour du centre ; OSM y a posé quatre nœuds (N, O, S, E).
  const repere = repereLocal(centre);
  const surAnneau = (azimut: number, rayon = 20): LonLat =>
    repere.versLonLat([rayon * Math.sin((azimut * Math.PI) / 180), rayon * Math.cos((azimut * Math.PI) / 180)]);
  const pixel = (azimut: number, rayon = 20) => {
    const { x, y } = versPixel(cadre, surAnneau(azimut, rayon));
    return { x: Math.round(x), y: Math.round(y) };
  };
  const anneauOsm = { noeuds: [0, 270, 180, 90].map((azimut, i) => ({ code: String(i + 1), position: surAnneau(azimut) })) };
  const giratoire: DetectionBranches = {
    ...detection,
    anneau: anneauOsm,
    branches: [{ ...detection.branches[0]!, noeud: '3' }, ...branchesTroncons(anneauOsm).map((b) => ({ ...b, sens: 'double' as const }))],
  };
  const voieVers = (azimut: number, sens: 'entrante' | 'sortante') => {
    const decalage = sens === 'entrante' ? -4 : 4;
    return { type: 'generale' as const, debut: pixel(azimut + decalage, 24), fin: pixel(azimut + decalage, 40) };
  };
  const rue = (code: string, azimut: number, noeud: number | null) => ({
    code,
    nom: null,
    osm_way_id: null,
    azimut,
    entrantes: [voieVers(azimut, 'entrante')],
    sortantes: [voieVers(azimut, 'sortante')],
    traversee: null,
    noeud,
    confiance: 'haute' as const,
    remarques: '',
  });
  const tram = {
    ...rue('T', 45, null),
    entrantes: [{ type: 'tram' as const, debut: pixel(45, 24), fin: pixel(45, 40) }],
    sortantes: [{ type: 'tram' as const, debut: pixel(225, 24), fin: pixel(225, 40) }],
  };
  // Lecture de l'IA : cinq nœuds dans le sens horaire (à remettre dans l'ordre), un doublon du
  // nœud sud à 1 m, deux voies d'anneau, la rue S au nœud sud et le tram hors nœud.
  const lue: LectureIa = {
    anneau: {
      noeuds: [
        { numero: 1, ...pixel(0), voies: 2 },
        { numero: 2, ...pixel(72), voies: 2 },
        { numero: 3, ...pixel(144), voies: 2 },
        { numero: 4, ...pixel(180), voies: 2 },
        { numero: 5, ...pixel(183), voies: 2 },
        { numero: 6, ...pixel(288), voies: 2 },
      ],
    },
    branches: [rue('S', 180, 4), tram],
    connexions: [{ de: 'T:e0', vers: 'T:s0' }],
    remarques: '',
  };

  it('should rebuild the ring from the nodes read on the photo', () => {
    const { configuration, noeuds } = configurationDepuisLecture(lue, cadre, giratoire, true);
    const anneau = configuration.anneau!;
    expect(noeuds).toBe('ia');
    expect(anneau.noeuds).toHaveLength(5); // le doublon rejoint le nœud sud
    const troncons = configuration.branches.filter((b) => b.troncon);
    expect(troncons).toHaveLength(5);
    expect(troncons.every((t) => t.voies.filter((v) => v.sens === 'sortante').length === 2)).toBe(true);
    expect(liaisonsHorsNoeud(configuration.branches, configuration.connexions, anneau)).toEqual([]);
  });

  it('should attach each street to the node read for it, and leave the tram crossing the island', () => {
    const { configuration } = configurationDepuisLecture(lue, cadre, giratoire, true);
    const anneau = configuration.anneau!;
    const s = configuration.branches.find((b) => b.code === 'S')!;
    const noeudSud = anneau.noeuds.find((n) => n.code === s.noeud)!;
    expect(Math.hypot(...repere.versXY(noeudSud.position).map((v, i) => v - repere.versXY(surAnneau(180))[i]!))).toBeLessThan(1);
    expect(configuration.branches.find((b) => b.code === 'T')!.noeud).toBeNull();
    expect(configuration.connexions).toContainEqual({ de: 'T:e0', vers: 'T:s0' });
  });

  it('should fall back on the OSM nodes when the photo gives fewer than three', () => {
    const { configuration, noeuds } = configurationDepuisLecture({ ...lue, anneau: { noeuds: lue.anneau!.noeuds.slice(3, 5) } }, cadre, giratoire, true);
    expect(noeuds).toBe('osm');
    expect(configuration.anneau).toEqual(anneauOsm);
    expect(configuration.branches.find((b) => b.code === 'S')!.noeud).toBe('3');
  });

  it('should send the OSM nodes and each street node number in the proposal', () => {
    const proposition = propositionEnPixels(cadre, giratoire);
    expect(proposition.anneau!.noeuds.map((n) => n.numero)).toEqual([1, 2, 3, 4]);
    expect(proposition.branches.map((b) => b.code)).toEqual(['S']); // pas de tronçon
    expect(proposition.branches[0]!.noeud).toBe(3);
  });

  it('should explain the node model in the instructions', () => {
    const texte = consigne({ cadre, giratoire: true, detection: giratoire, feux: [], voiesOsm: [] }, '/tmp/orthophoto.jpg');
    expect(texte).toContain('## Giratoire');
    expect(texte).toContain('quatre nœuds au moins');
    expect(texte).toContain('à deux nœuds différents');
  });
  describe('lignes de feux proposées', () => {
    const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
    const feux = [
      { id: id(1), numero: 1, type: 'vehicule' as const, position: centre, tags: {} },
      { id: id(2), numero: 2, type: 'vehicule' as const, position: centre, tags: {} },
      { id: id(3), numero: 3, type: 'pieton' as const, position: centre, tags: {} },
      { id: id(4), numero: 4, type: 'vehicule' as const, position: centre, tags: {} },
      { id: id(5), numero: 5, type: 'vehicule' as const, position: centre, tags: {} },
    ];
    const avecFeux: LectureIa = {
      ...lue,
      feux: [
        { feu: 'F1', branche: 's', noeud: null }, // entrée S
        { feu: 'F5', branche: 'S', noeud: null }, // deuxième tête de la même entrée
        { feu: 'F2', branche: null, noeud: 4 }, // anneau, devant le nœud sud
        { feu: 'F4', branche: 'T', noeud: null }, // tram
        { feu: 'F3', branche: 'S', noeud: null }, // piéton, mais S n'a pas de passage
        { feu: 'F9', branche: 'S', noeud: null }, // feu inconnu
      ],
    };

    it('should propose one line per entry, ring node and tram, grouping the heads that show the same thing', () => {
      const { configuration, lignes } = configurationDepuisLecture(avecFeux, cadre, giratoire, true, feux);
      expect(lignes.map((l) => [l.code, l.signal])).toEqual([
        ['A1', 'R11v'],
        ['F1', 'R11v'],
        ['T1', 'R17'],
      ]);
      const [anneau, entree, tram] = lignes;
      expect(entree!.feux).toEqual([id(1), id(5)]);
      expect(entree!.mouvements.every((m) => m.startsWith('S>'))).toBe(true);
      expect(tram!.mouvements).toEqual(['T>T']);
      // Feu d'anneau : la circulation qui arrive au nœud sud par l'anneau, qu'elle continue ou sorte.
      const s = configuration.branches.find((b) => b.code === 'S')!;
      const arrivee = anneau!.mouvements[0]!.split('>')[0]!;
      expect(anneau!.mouvements).toContain(`${arrivee}>S`);
      expect(configuration.branches.find((b) => b.code === arrivee)!.troncon).toBe(true);
      expect(anneau!.feux).toEqual([id(2)]);
      expect(s.noeud).not.toBeNull();
    });

    it('should report the lights it could not turn into a line', () => {
      const { feuxIgnores } = configurationDepuisLecture(avecFeux, cadre, giratoire, true, feux);
      expect(feuxIgnores).toEqual(['F3 : pas de passage piéton sur la branche S', 'F9 : feu inconnu']);
    });
  });
});
