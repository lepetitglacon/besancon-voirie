import { describe, expect, it } from 'vitest';
import { repereLocal, type LonLat } from './geometrie.js';
import { exporterSumo, type ReseauSumo } from './sumo.js';
import { phasesSumo, preparerJonctions, type CarrefourSumo } from './sumoCarrefours.js';

const centre: LonLat = [6.03, 47.25];
const m = (x: number, y: number) => repereLocal(centre).versLonLat([x, y]);

/**
 * Carrefour « k » : au nord, un passage piéton « p » (approche) puis la ligne d'arrêt « s » ; le
 * cœur va de « s » à l'intersection « j », d'où partent le sud et l'est.
 */
const reseau: ReseauSumo = {
  noeuds: [
    { id: 'n', position: m(0, 300), carrefour: null },
    { id: 'p', position: m(0, 30), carrefour: 'k' },
    { id: 's', position: m(0, 15), carrefour: 'k' },
    { id: 'j', position: centre, carrefour: 'k' },
    { id: 'sud', position: m(0, -300), carrefour: null },
    { id: 'est', position: m(300, 0), carrefour: null },
  ],
  troncons: [
    { id: 'nord', de: 'n', vers: 'p', points: [m(0, 300), m(0, 30)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: null, nom: null, highway: 'secondary' },
    { id: 'approche', de: 'p', vers: 's', points: [m(0, 30), m(0, 15)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: null, nom: null, highway: 'secondary', branche_vers: 'N' },
    { id: 'coeur', de: 's', vers: 'j', points: [m(0, 15), centre], voies_avant: 1, voies_arriere: 1, vitesse_kmh: null, nom: null, highway: 'secondary' },
    { id: 'bas', de: 'j', vers: 'sud', points: [centre, m(0, -300)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: null, nom: null, highway: 'secondary', branche_de: 'S' },
    { id: 'droite', de: 'j', vers: 'est', points: [centre, m(300, 0)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: null, nom: null, highway: 'residential', branche_de: 'E' },
  ],
};

const programme = {
  code: 'jour',
  cycle_s: 60,
  verts: { F1: [[0, 25]] as Array<[number, number]>, F2: [[30, 55]] as Array<[number, number]> },
  jaunes: { F1: [[25, 28]] as Array<[number, number]>, F2: [[55, 58]] as Array<[number, number]> },
};

const carrefour: CarrefourSumo = {
  id: 'k',
  connexions: [
    { de: 'N:e0', vers: 'S:s0' },
    { de: 'N:e0', vers: 'E:s0' },
  ],
  lignes: { 'N>S': 'F1', 'N>E': 'F2' },
  programme,
};

describe('carrefours dans l’export SUMO', () => {
  const jonctions = preparerJonctions({ ...reseau, carrefours: [carrefour] });

  it('le cœur devient une jonction, l’approche reste un nœud ordinaire', () => {
    expect(jonctions.noeudSumo('s')).toBe('ck');
    expect(jonctions.noeudSumo('j')).toBe('ck');
    expect(jonctions.noeudSumo('p')).toBe('p');
    expect(jonctions.interne(reseau.troncons[2]!)).toBe(true);
    expect(jonctions.interne(reseau.troncons[1]!)).toBe(false);
  });

  it('les connexions deviennent les liens de la jonction, avec leur ligne', () => {
    expect(jonctions.coeurs[0]!.liens).toEqual([
      { depuis: 'tapproche', vers: 'tbas', voieDepuis: 0, voieVers: 0, ligne: 'F1' },
      { depuis: 'tapproche', vers: 'tdroite', voieDepuis: 0, voieVers: 0, ligne: 'F2' },
    ]);
  });

  it('une branche interne se traverse : la ligne est celle de la première ligne d’arrêt', () => {
    const avecInterne = preparerJonctions({
      ...reseau,
      carrefours: [{ ...carrefour, connexions: [{ de: 'N:e0', vers: 'R1:s0' }, { de: 'R1:e0', vers: 'E:s0' }], lignes: { 'N>R1': 'F1' } }],
    });
    expect(avecInterne.coeurs[0]!.liens).toEqual([{ depuis: 'tapproche', vers: 'tdroite', voieDepuis: 0, voieVers: 0, ligne: 'F1' }]);
  });

  it('les phases suivent les lignes : vert, jaune, rouge, sans trou', () => {
    expect(phasesSumo(programme, ['F1', 'F2', null])).toEqual([
      { duree_s: 25, etat: 'Gro' },
      { duree_s: 3, etat: 'yro' },
      { duree_s: 2, etat: 'rro' },
      { duree_s: 25, etat: 'rGo' },
      { duree_s: 3, etat: 'ryo' },
      { duree_s: 2, etat: 'rro' },
    ]);
  });

  it('écrit la jonction, ses connexions et son programme', () => {
    const sortie = exporterSumo({ ...reseau, carrefours: [carrefour] });
    expect(sortie.nod).toContain('<node id="ck"');
    expect(sortie.nod).toContain('tl="ck"');
    expect(sortie.nod).toMatch(/<node id="p" [^>]*type="priority"/);
    expect(sortie.edg).not.toContain('id="tcoeur"');
    expect(sortie.edg).toMatch(/id="tapproche" from="p" to="ck"/);
    expect(sortie.con).toContain('<connection from="tapproche" to="tbas" fromLane="0" toLane="0"/>');
    expect(sortie.tll).toContain('<tlLogic id="ck" programID="jour" offset="0" type="static">');
    expect(sortie.tll).toContain('<phase duration="25" state="Gr"/>');
    expect(sortie.tll).toContain('tl="ck" linkIndex="1"');
  });

  it('une emprise dessinée donne la largeur de sa voie', () => {
    // Le tracé va vers le sud : les voies arrière sont à sa gauche, à l'est.
    const emprise = [m(0.2, 200), m(0.2, 100), m(3.4, 100), m(3.4, 200)];
    const sortie = exporterSumo({
      ...reseau,
      troncons: reseau.troncons.map((t) => (t.id === 'nord' ? { ...t, emprises: { 'arriere:0': emprise } } : t)),
    });
    expect(sortie.edg).toMatch(/id="-tnord"[^\n]*>\n {4}<lane index="0" width="3\.20"\/>/);
  });
});
