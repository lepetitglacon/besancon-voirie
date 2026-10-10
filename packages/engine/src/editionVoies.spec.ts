import { describe, expect, it } from 'vitest';
import { decalerEmprises, decalerLiaisons, insererType, largeurEmprise, retirerType, sensDuCote } from './editionVoies.js';
import { repereLocal, type LonLat } from './geometrie.js';

const repere = repereLocal([6.02, 47.24]);
const en = (x: number, y: number): LonLat => repere.versLonLat([x, y]);

describe('types des voies', () => {
  it('insère une voie au rang voulu, les autres gardent leur type', () => {
    expect(insererType(2, ['bus', 'generale'], 0, 'velo')).toEqual(['velo', 'bus', 'generale']);
    expect(insererType(2, null, 2, 'bus')).toEqual(['generale', 'generale', 'bus']);
  });

  it('retire la voie du rang voulu', () => {
    expect(retirerType(3, ['generale', 'bus', 'velo'], 1)).toEqual(['generale', 'velo']);
  });
});

describe('décalages', () => {
  const liaisons = [
    { de: 't1', voie_de: 0, vers: 't2', voie_vers: 1 },
    { de: 't1', voie_de: 1, vers: 't2', voie_vers: 0 },
    { de: 't3', voie_de: 0, vers: 't1', voie_vers: 1 },
  ];

  it('décale les liaisons des voies qui arrivent après une voie ajoutée', () => {
    expect(decalerLiaisons(liaisons, 't1', 'arrivent', 1, 1)).toEqual([
      { de: 't1', voie_de: 0, vers: 't2', voie_vers: 1 },
      { de: 't1', voie_de: 2, vers: 't2', voie_vers: 0 },
      { de: 't3', voie_de: 0, vers: 't1', voie_vers: 1 },
    ]);
  });

  it('retire les liaisons de la voie retirée et décale celles qui la suivent', () => {
    expect(decalerLiaisons(liaisons, 't1', 'repartent', 1, -1)).toEqual(liaisons.slice(0, 2));
    expect(decalerLiaisons(liaisons, 't1', 'arrivent', 0, -1)).toEqual([
      { de: 't1', voie_de: 0, vers: 't2', voie_vers: 0 },
      { de: 't3', voie_de: 0, vers: 't1', voie_vers: 1 },
    ]);
  });

  it('laisse les liaisons proposées par défaut se recalculer', () => {
    expect(decalerLiaisons(null, 't1', 'arrivent', 0, 1)).toBeNull();
  });

  it('fait suivre les emprises de leur voie, dans le seul sens modifié', () => {
    const carre = [en(0, 0), en(1, 0), en(1, 1)];
    expect(decalerEmprises({ 'avant:0': carre, 'avant:1': carre, 'arriere:0': carre }, 'avant', 0, -1)).toEqual({
      'avant:0': carre,
      'arriere:0': carre,
    });
    expect(decalerEmprises({ 'avant:0': carre }, 'avant', 0, -1)).toBeNull();
  });
});

describe('côté de l’axe', () => {
  const axe = [en(0, 0), en(100, 0)];
  const doubleSens = { voies_avant: 1, voies_arriere: 1 };

  it('à droite du tracé : voies avant ; à gauche : voies arrière', () => {
    expect(sensDuCote(axe, en(50, -2), doubleSens)).toBe('avant');
    expect(sensDuCote(axe, en(50, 2), doubleSens)).toBe('arriere');
  });

  it('un sens unique n’a qu’un sens', () => {
    expect(sensDuCote(axe, en(50, 2), { voies_avant: 2, voies_arriere: 0 })).toBe('avant');
  });
});

describe('largeur d’une emprise', () => {
  it('aire divisée par la longueur d’axe couverte', () => {
    const axe = [en(0, 0), en(100, 0)];
    const voie = [en(10, -0.2), en(40, -0.2), en(40, -3.4), en(10, -3.4)];
    expect(largeurEmprise(voie, axe)).toBeCloseTo(3.2, 1);
  });

  it('null sans longueur couverte', () => {
    expect(largeurEmprise([en(10, 1), en(10, 2), en(10, 3)], [en(0, 0), en(100, 0)])).toBeNull();
  });
});
