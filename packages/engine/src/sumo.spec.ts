import { describe, expect, it } from 'vitest';
import { genererVoies, repereLocal, type LonLat } from './geometrie.js';
import { configurationNetconvert, exporterSumo, vitesseParDefaut, type ReseauSumo } from './sumo.js';

const centre: LonLat = [6.03, 47.25];
const m = (x: number, y: number) => repereLocal(centre).versLonLat([x, y]);

function branche(code: string, azimut: number, entrantes: number, sortantes: number) {
  const g = genererVoies(centre, azimut, entrantes, sortantes);
  return {
    code,
    voies: [
      ...g.entrantes.map((geom, rang) => ({ sens: 'entrante' as const, rang, type: 'generale' as const, geom })),
      ...g.sortantes.map((geom, rang) => ({ sens: 'sortante' as const, rang, type: 'generale' as const, geom })),
    ],
  };
}

/** Carrefour N–S : un tronçon au nord (2 voies vers le carrefour, 1 en repartant), un au sud. */
const reseau: ReseauSumo = {
  noeuds: [
    { id: 'n1', position: m(0, 300) },
    { id: 'c', position: centre },
    { id: 'n2', position: m(0, -300) },
  ],
  troncons: [
    { id: 'nord', de: 'n1', vers: 'c', points: [m(0, 300), m(0, 45)], voies_avant: 2, voies_arriere: 1, vitesse_kmh: null, nom: 'Rue & Cie', highway: 'secondary' },
    { id: 'sud', de: 'c', vers: 'n2', points: [m(0, -45), m(0, -300)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: 30, nom: null, highway: 'residential' },
  ],
  carrefours: [
    {
      id: 'k',
      nom: 'Carrefour test',
      noeud: 'c',
      centre,
      branches: [branche('N', 0, 2, 1), branche('S', 180, 1, 1)],
      connexions: [
        { de: 'N:e0', vers: 'S:s0' },
        { de: 'N:e1', vers: 'S:s0' },
        { de: 'S:e0', vers: 'N:s0' },
      ],
    },
  ],
  raccordements: [
    { troncon: 'nord', extremite: 'vers', carrefour: 'k', branche: 'N', liens: null },
    { troncon: 'sud', extremite: 'de', carrefour: 'k', branche: 'S', liens: { entree: [[0, 0]], sortie: [[0, 0]] } },
  ],
};

describe('export SUMO plain XML', () => {
  const sortie = exporterSumo(reseau);

  it('écrit un nœud à feux au centre et un nœud de raccordement par bout de tronçon', () => {
    expect(sortie.nod).toContain('<node id="ck" x="6.0300000" y="47.2500000" type="traffic_light"/>');
    expect(sortie.nod).toContain('id="rnord_vers"');
    expect(sortie.nod).toContain('id="rsud_de"');
    // Le nœud réseau du carrefour n'est plus utilisé : les tronçons s'arrêtent au raccordement.
    expect(sortie.nod).not.toContain('id="c"');
  });

  it('écrit une arête par sens de tronçon et les approches de chaque branche', () => {
    expect(sortie.edg).toContain('<edge id="tnord" from="n1" to="rnord_vers" numLanes="2" speed="13.89" priority="9" name="Rue &amp; Cie"');
    expect(sortie.edg).toContain('<edge id="-tnord" from="rnord_vers" to="n1" numLanes="1"');
    expect(sortie.edg).toContain('<edge id="tsud" from="rsud_de" to="n2" numLanes="1" speed="8.33"');
    expect(sortie.edg).toContain('id="ak_N_e_rnord_vers" from="rnord_vers" to="ck" numLanes="2"');
    expect(sortie.edg).toContain('id="ak_S_s_rsud_de" from="ck" to="rsud_de" numLanes="1"');
  });

  it('traduit les connexions du carrefour en index SUMO (0 = la voie de droite)', () => {
    // N:e0 est la plus à gauche des deux entrantes : index SUMO 1.
    expect(sortie.con).toContain('<connection from="ak_N_e_rnord_vers" to="ak_S_s_rsud_de" fromLane="1" toLane="0"/>');
    expect(sortie.con).toContain('<connection from="ak_N_e_rnord_vers" to="ak_S_s_rsud_de" fromLane="0" toLane="0"/>');
  });

  it('relie les voies du tronçon à celles de la branche', () => {
    // Automatique au nord : 2 voies → 2 entrantes, voie à voie.
    expect(sortie.con).toContain('<connection from="tnord" to="ak_N_e_rnord_vers" fromLane="1" toLane="1"/>');
    expect(sortie.con).toContain('<connection from="ak_N_s_rnord_vers" to="-tnord" fromLane="0" toLane="0"/>');
    // Saisi au sud : le tronçon arrive par son arête inverse.
    expect(sortie.con).toContain('<connection from="-tsud" to="ak_S_e_rsud_de" fromLane="0" toLane="0"/>');
    expect(sortie.alertes).toEqual([]);
  });

  it('signale une branche sans tronçon, et la termine en cul-de-sac', () => {
    const sansSud = exporterSumo({ ...reseau, troncons: [reseau.troncons[0]!], raccordements: [reseau.raccordements[0]!] });
    expect(sansSud.alertes).toEqual(['Carrefour test : branche S sans tronçon raccordé (cul-de-sac)']);
    expect(sansSud.nod).toContain('id="bk_S"');
    expect(sansSud.nod).toMatch(/id="bk_S" [^>]*type="dead_end"/);
  });

  it('écrit les liaisons d’un nœud ordinaire, saisies ou proposées', () => {
    // Au nord, le tronçon « nord » se prolonge par « amont » au nœud n1 (1 voie → 2 voies).
    const avecAmont: ReseauSumo = {
      ...reseau,
      noeuds: [...reseau.noeuds, { id: 'n0', position: m(0, 600) }],
      troncons: [
        ...reseau.troncons,
        { id: 'amont', de: 'n0', vers: 'n1', points: [m(0, 600), m(0, 300)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: null, nom: null, highway: null },
      ],
    };
    const proposees = exporterSumo(avecAmont).con;
    expect(proposees).toContain('<connection from="tamont" to="tnord" fromLane="0" toLane="1"/>');
    expect(proposees).toContain('<connection from="tamont" to="tnord" fromLane="0" toLane="0"/>');
    const saisies = exporterSumo({
      ...avecAmont,
      noeuds: avecAmont.noeuds.map((n) => (n.id === 'n1' ? { ...n, liaisons: [{ de: 'amont', voie_de: 0, vers: 'nord', voie_vers: 0 }] } : n)),
    }).con;
    // Rang 0 (gauche) parmi 2 : index SUMO 1 ; seule la liaison saisie est écrite à ce nœud.
    expect(saisies).toContain('<connection from="tamont" to="tnord" fromLane="0" toLane="1"/>');
    expect(saisies).not.toContain('from="tamont" to="tnord" fromLane="0" toLane="0"');
    expect(saisies).not.toContain('from="-tnord" to="-tamont"');
  });

  it('donne une vitesse par défaut selon le type de voie', () => {
    expect(vitesseParDefaut('residential')).toBe(30);
    expect(vitesseParDefaut(null)).toBe(50);
    expect(configurationNetconvert()).toContain('<proj.plain-geo value="true"/>');
  });
});
