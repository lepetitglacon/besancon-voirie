import { describe, expect, it } from 'vitest';
import { repereLocal, type LonLat } from './geometrie.js';
import { miroirRue, repartitionParMode, rueVersVoies, tronconVersRue, type Rue } from './streetmix.js';
import { exporterSumo, type ReseauSumo } from './sumo.js';

const centre: LonLat = [6.03, 47.25];
const m = (x: number, y: number) => repereLocal(centre).versLonLat([x, y]);
const axe = [m(0, 0), m(100, 0)];

const resume = (rue: Rue) => rue.segments.map((s) => `${s.type} ${s.variantString} ${s.width}`);

describe('profil estimé d’après un tronçon', () => {
  it('range le sens arrière à gauche (inbound), le sens avant à droite (outbound), rang 0 près de l’axe', () => {
    const rue = tronconVersRue({
      points: axe,
      voies_avant: 2,
      voies_arriere: 2,
      types_avant: ['generale', 'velo'],
      types_arriere: ['generale', 'bus'],
      highway: 'service',
    });
    expect(resume(rue)).toEqual([
      'bus-lane inbound|colored|typical 3.5',
      'drive-lane inbound|car 3',
      'drive-lane outbound|car 3',
      'bike-lane outbound|regular|road 1.5',
    ]);
    expect(rue.schemaVersion).toBe(35);
    expect(rue.width).toBe(11);
  });

  it('ajoute trottoirs et stationnement d’après les tags OSM, côtés ramenés au sens du tronçon', () => {
    const tags = { sidewalk: 'right', 'sidewalk:right:width': '2,5', 'parking:left': 'lane', 'parking:left:orientation': 'parallel' };
    const memeSens = tronconVersRue({ points: axe, voies_avant: 1, voies_arriere: 0, highway: 'residential', tags, sensOsm: true });
    expect(resume(memeSens)).toEqual(['parking-lane outbound|left 2', 'drive-lane outbound|car 3', 'sidewalk normal 2.5']);
    // Tracé à rebours de la voie OSM : la droite d'OSM devient la gauche du profil.
    const aRebours = tronconVersRue({ points: axe, voies_avant: 1, voies_arriere: 0, highway: 'residential', tags, sensOsm: false });
    expect(resume(aRebours)).toEqual(['sidewalk normal 2.5', 'drive-lane outbound|car 3', 'parking-lane outbound|right 2']);
  });

  it('suppose des trottoirs des deux côtés d’une rue de ville sans tag, aucun sur une voie de service', () => {
    const ville = tronconVersRue({ points: axe, voies_avant: 1, voies_arriere: 1, highway: 'residential' });
    expect(ville.segments.filter((s) => s.type === 'sidewalk')).toHaveLength(2);
    expect(ville.segments[0]!.elevation).toBe(0.15);
    const nonTague = tronconVersRue({ points: axe, voies_avant: 1, voies_arriere: 1, highway: 'residential', tags: { sidewalk: 'no' } });
    expect(nonTague.segments.some((s) => s.type === 'sidewalk')).toBe(false);
  });

  it('prend la largeur d’une voie dans son emprise dessinée', () => {
    const emprise = [m(10, -1), m(90, -1), m(90, -5), m(10, -5)];
    const rue = tronconVersRue({ points: axe, voies_avant: 1, voies_arriere: 0, emprises: { 'avant:0': emprise }, highway: 'service' });
    expect(rue.segments[0]!.width).toBeCloseTo(4, 1);
  });
});

const rue: Rue = {
  schemaVersion: 35,
  width: 20,
  segments: [
    { id: 'a', type: 'sidewalk', variantString: 'normal', width: 2, elevation: 0.15 },
    { id: 'b', type: 'parking-lane', variantString: 'inbound|left', width: 2, elevation: 0 },
    { id: 'c', type: 'turn-lane', variantString: 'inbound|left', width: 3, elevation: 0 },
    { id: 'd', type: 'drive-lane', variantString: 'inbound|car', width: 3, elevation: 0 },
    { id: 'e', type: 'divider', variantString: 'big-tree', width: 1, elevation: 0 },
    { id: 'f', type: 'drive-lane', variantString: 'outbound|car', width: 3.2, elevation: 0 },
    { id: 'g', type: 'bike-lane', variantString: 'twoway-right|regular|road', width: 2.4, elevation: 0 },
    { id: 'h', type: 'sidewalk-tree', variantString: 'big', width: 1.2, elevation: 0.15 },
    { id: 'i', type: 'sidewalk', variantString: 'normal', width: 2.2, elevation: 0.15 },
  ],
  boundary: { left: { variant: 'residential', floors: 3, elevation: 0.15 }, right: { variant: 'arcade', floors: 2, elevation: 0.15 } },
};

describe('rue vue depuis l’autre bout', () => {
  const miroir = miroirRue(rue);

  it('inverse les segments, échange les sens et les côtés, garde le tourne-à-gauche', () => {
    expect(miroir.segments.map((s) => `${s.id} ${s.variantString}`)).toEqual([
      'i normal',
      'h big',
      'g twoway-left|regular|road',
      'f inbound|car',
      'e big-tree',
      'd outbound|car',
      'c outbound|left',
      'b outbound|right',
      'a normal',
    ]);
    expect(miroir.boundary?.left.variant).toBe('arcade');
  });

  it('revient à la rue de départ quand on la retourne deux fois', () => {
    expect(miroirRue(miroir)).toEqual(rue);
  });
});

describe('voies de circulation d’un profil', () => {
  it('donne les voies de chaque sens, rang 0 = la plus à gauche pour qui y circule', () => {
    const voies = rueVersVoies(rue);
    expect(voies.avant).toEqual([
      { type: 'generale', largeur: 3.2 },
      { type: 'velo', largeur: 1.2 },
    ]);
    // Sens arrière, vu par qui y circule : la voie de présélection est la plus à droite.
    expect(voies.arriere).toEqual([
      { type: 'velo', largeur: 1.2 },
      { type: 'generale', largeur: 3 },
      { type: 'generale', largeur: 3 },
    ]);
    expect(voies.trottoirs).toEqual({ gauche: 2, droite: 3.4 });
    expect(voies.stationnement).toEqual({ gauche: true, droite: false });
    expect(voies.alertes).toHaveLength(1);
  });

  it('lit le profil depuis l’autre bout pour un tronçon inversé', () => {
    const voies = rueVersVoies(rue, true);
    expect(voies.avant.map((v) => v.largeur)).toEqual([1.2, 3, 3]);
    expect(voies.trottoirs).toEqual({ gauche: 3.4, droite: 2 });
  });
});

describe('répartition de l’emprise par mode', () => {
  it('compte chaque segment dans son mode', () => {
    expect(repartitionParMode(rue)).toEqual({
      pieton: 4.2,
      velo: 2.4,
      voiture: 9.2,
      bus: 0,
      tram: 0,
      stationnement: 2,
      vegetal: 2.2,
      autre: 0,
    });
  });
});

describe('export SUMO théorique', () => {
  const reseau: ReseauSumo = {
    noeuds: [
      { id: 'o', position: m(0, 0), carrefour: null, liaisons: [{ de: 'x', voie_de: 0, vers: 't', voie_vers: 0 }] },
      { id: 'e', position: m(100, 0), carrefour: null },
    ],
    troncons: [
      {
        id: 't',
        de: 'o',
        vers: 'e',
        points: axe,
        voies_avant: 1,
        voies_arriere: 1,
        vitesse_kmh: 50,
        nom: null,
        highway: 'secondary',
        profil: { id: 'p', rue, inverse: false },
      },
    ],
  };

  it('garde les voies du tronçon dans la variante réelle', () => {
    expect(exporterSumo(reseau).edg).toContain('<edge id="tt" from="o" to="e" numLanes="1"');
  });

  it('prend les voies, largeurs et trottoirs du profil dans la variante théorique', () => {
    const sortie = exporterSumo(reseau, { variante: 'theorique' });
    expect(sortie.edg).toContain('<edge id="tt" from="o" to="e" numLanes="2"');
    expect(sortie.edg).toContain('<edge id="-tt" from="e" to="o" numLanes="3"');
    // Avant : générale (rang 0) puis vélo (rang 1, index SUMO 0).
    expect(sortie.edg).toMatch(/<edge id="tt" [^>]*>\n {4}<lane index="0" allow="bicycle" width="1\.20"\/>\n {4}<lane index="1" width="3\.20"\/>/);
    expect(sortie.edg).toContain('<param key="voirie.trottoir" value="3.40"/>');
    expect(sortie.edg).toContain('<param key="voirie.stationnement" value="true"/>');
    expect(sortie.alertes.some((a) => a.includes('bidirectionnel'))).toBe(true);
  });
});
