import { describe, expect, it } from 'vitest';
import { basculerEmbranchement, embranchements, liaisonsEntre } from './embranchements.js';
import { repereLocal, type LonLat } from './geometrie.js';
import { boutsAuNoeud, liaisonsParDefaut } from './reseau.js';

const centre: LonLat = [6.03, 47.25];
const m = (x: number, y: number) => repereLocal(centre).versLonLat([x, y]);
const rue = (id: string, x: number, y: number, voies = 1) => ({
  id,
  noeud_de: 'j',
  noeud_vers: id,
  points: [centre, m(x, y)],
  voies_avant: voies,
  voies_arriere: voies,
});
// Croisement : nord (2 voies par sens), sud, est, ouest.
const bouts = boutsAuNoeud('j', [rue('nord', 0, 100, 2), rue('sud', 0, -100), rue('est', 100, 0), rue('ouest', -100, 0)]);

describe('embranchements d’un nœud', () => {
  it('chaque rue qui arrive peut aller où la proposition par défaut la mène, pas en demi-tour', () => {
    const depuisNord = embranchements(bouts, liaisonsParDefaut(bouts)).find((e) => e.de === 'nord')!;
    expect(depuisNord.vers.map((v) => [v.vers, v.direction, v.autorise])).toEqual([
      ['nord', 'demi_tour', false],
      ['sud', 'tout_droit', true],
      ['est', 'gauche', true],
      ['ouest', 'droite', true],
    ]);
  });

  it('interdire un embranchement retire toutes ses liaisons, l’autoriser les remet', () => {
    const defaut = liaisonsParDefaut(bouts);
    const sansSud = basculerEmbranchement(bouts, defaut, 'nord', 'sud', false);
    expect(sansSud.some((l) => l.de === 'nord' && l.vers === 'sud')).toBe(false);
    expect(sansSud.length).toBe(defaut.length - liaisonsEntre(bouts, 'nord', 'sud').length);
    expect(basculerEmbranchement(bouts, sansSud, 'nord', 'sud', true)).toHaveLength(defaut.length);
  });

  it('un demi-tour autorisé part de la voie de gauche vers la voie de gauche', () => {
    expect(liaisonsEntre(bouts, 'nord', 'nord')).toEqual([{ de: 'nord', voie_de: 0, vers: 'nord', voie_vers: 0 }]);
  });
});
