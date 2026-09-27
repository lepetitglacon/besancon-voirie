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
      { cadre, detection, feux: [{ numero: 1, type: 'vehicule', position: centre, tags: { highway: 'traffic_signals', note: 'x' } }], voiesOsm: [] },
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
