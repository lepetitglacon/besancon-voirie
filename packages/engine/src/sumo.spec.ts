import { describe, expect, it } from 'vitest';
import { repereLocal, type LonLat } from './geometrie.js';
import { configurationNetconvert, exporterSumo, vitesseParDefaut, type ReseauSumo } from './sumo.js';

const centre: LonLat = [6.03, 47.25];
const m = (x: number, y: number) => repereLocal(centre).versLonLat([x, y]);

/**
 * Carrefour de deux nœuds (ligne d'arrêt « s » au nord, intersection « j ») sur une rue nord-sud,
 * et une rue vers l'est : le nord a 2 voies vers le carrefour (dont une vélo), 1 en repartant.
 */
const reseau: ReseauSumo = {
  noeuds: [
    { id: 'n', position: m(0, 300), carrefour: null },
    { id: 's', position: m(0, 20), carrefour: 'k' },
    { id: 'j', position: centre, carrefour: 'k' },
    { id: 'sud', position: m(0, -300), carrefour: null },
    { id: 'est', position: m(300, 0), carrefour: null },
  ],
  troncons: [
    {
      id: 'nord',
      de: 'n',
      vers: 's',
      points: [m(0, 300), m(0, 20)],
      voies_avant: 2,
      voies_arriere: 1,
      types_avant: ['generale', 'velo'],
      vitesse_kmh: null,
      nom: 'Rue & Cie',
      highway: 'secondary',
    },
    { id: 'approche', de: 's', vers: 'j', points: [m(0, 20), centre], voies_avant: 2, voies_arriere: 1, types_avant: ['generale', 'velo'], vitesse_kmh: null, nom: null, highway: 'secondary' },
    { id: 'bas', de: 'j', vers: 'sud', points: [centre, m(0, -300)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: 30, nom: null, highway: 'residential' },
    { id: 'droite', de: 'j', vers: 'est', points: [centre, m(300, 0)], voies_avant: 1, voies_arriere: 1, vitesse_kmh: null, nom: null, highway: 'residential' },
  ],
};

describe('export SUMO plain XML', () => {
  const sortie = exporterSumo(reseau);

  it('écrit un nœud par nœud du réseau ; ceux d’un carrefour partagent un même feu', () => {
    expect(sortie.nod).toMatch(/<node id="n" x="6\.0300000" y="47\.25\d+" type="priority"\/>/);
    expect(sortie.nod).toMatch(/<node id="s" [^>]*type="traffic_light" tl="ck"\/>/);
    expect(sortie.nod).toMatch(/<node id="j" [^>]*type="traffic_light" tl="ck"\/>/);
    expect(sortie.alertes).toEqual([]);
  });

  it('écrit une arête par sens de tronçon, avec ses voies réservées', () => {
    expect(sortie.edg).toContain('<edge id="tnord" from="n" to="s" numLanes="2" speed="13.89" priority="9" name="Rue &amp; Cie"');
    expect(sortie.edg).toContain('<edge id="-tnord" from="s" to="n" numLanes="1"');
    expect(sortie.edg).toContain('<edge id="tbas" from="j" to="sud" numLanes="1" speed="8.33"');
    // Voie vélo au rang 1 (la plus à droite) parmi 2 : index SUMO 0.
    expect(sortie.edg).toMatch(/<edge id="tnord" [^>]*>\n {4}<lane index="0" allow="bicycle"\/>\n {2}<\/edge>/);
  });

  it('traduit les liaisons de chaque nœud en index SUMO (0 = la voie de droite)', () => {
    // À la ligne d'arrêt « s » (deux tronçons) : on continue voie à voie.
    expect(sortie.con).toContain('<connection from="tnord" to="tapproche" fromLane="1" toLane="1"/>');
    expect(sortie.con).toContain('<connection from="tnord" to="tapproche" fromLane="0" toLane="0"/>');
    // À l'intersection : la voiture (rang 0, index 1) continue au sud et tourne à gauche vers l'est.
    expect(sortie.con).toContain('<connection from="tapproche" to="tbas" fromLane="1" toLane="0"/>');
    expect(sortie.con).toContain('<connection from="tapproche" to="tdroite" fromLane="1" toLane="0"/>');
  });

  it('écrit les liaisons saisies à un nœud à la place de celles proposées', () => {
    const saisies = exporterSumo({
      ...reseau,
      noeuds: reseau.noeuds.map((n) => (n.id === 'j' ? { ...n, liaisons: [{ de: 'approche', voie_de: 0, vers: 'bas', voie_vers: 0 }] } : n)),
    }).con;
    expect(saisies).toContain('<connection from="tapproche" to="tbas" fromLane="1" toLane="0"/>');
    expect(saisies).not.toContain('from="tapproche" to="tdroite"');
  });

  it('ignore une boucle sur un seul nœud, et donne une vitesse par défaut selon le type de voie', () => {
    const boucle = exporterSumo({ ...reseau, troncons: [...reseau.troncons, { ...reseau.troncons[0]!, id: 'boucle', de: 'n', vers: 'n' }] });
    expect(boucle.alertes).toEqual(['Tronçon Rue & Cie : boucle sur un seul nœud, ignoré']);
    expect(vitesseParDefaut('residential')).toBe(30);
    expect(vitesseParDefaut('cycleway')).toBe(20);
    expect(vitesseParDefaut(null)).toBe(50);
    expect(configurationNetconvert()).toContain('<proj.plain-geo value="true"/>');
  });
});
