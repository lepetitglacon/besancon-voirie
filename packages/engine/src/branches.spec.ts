import { describe, expect, it } from 'vitest';
import {
  codeCardinal,
  codesBranches,
  directionMouvement,
  lireTurnLanes,
  normaliserAngle,
  voiesParDefaut,
} from './branches.js';

describe('angles et codes', () => {
  it('normalise dans ]−180, 180]', () => {
    expect(normaliserAngle(270)).toBe(-90);
    expect(normaliserAngle(-180)).toBe(180);
    expect(normaliserAngle(725)).toBe(5);
  });

  it('donne le point cardinal et des codes uniques', () => {
    expect([0, 44, 90, 180, 250, 315, 350].map(codeCardinal)).toEqual(['N', 'NE', 'E', 'S', 'O', 'NO', 'N']);
    expect(codesBranches([0, 10, 180, 355])).toEqual(['N', 'N2', 'S', 'N3']);
  });
});

describe('directionMouvement', () => {
  // On arrive par le sud (branche à 180°), on roule donc vers le nord.
  it('classe les sorties vues depuis le sud', () => {
    expect(directionMouvement(180, 0)).toBe('tout_droit');
    expect(directionMouvement(180, 90)).toBe('droite');
    expect(directionMouvement(180, 270)).toBe('gauche');
    expect(directionMouvement(180, 20)).toBe('tout_droit');
    expect(directionMouvement(180, 180, true)).toBe('demi_tour');
  });

  it('voit un demi-tour vers une autre branche qui repart presque en sens inverse (deux chaussées)', () => {
    expect(directionMouvement(180, 170)).toBe('demi_tour');
    expect(directionMouvement(180, 140)).toBe('droite');
  });
});

describe('lireTurnLanes / voiesParDefaut', () => {
  it('lit les flèches OSM de gauche à droite', () => {
    expect(lireTurnLanes('left|through;right')).toEqual([['gauche'], ['tout_droit', 'droite']]);
    expect(lireTurnLanes('slight_left;left|none|merge_to_left')).toEqual([['gauche'], [], []]);
  });

  it('propose des flèches par défaut', () => {
    expect(voiesParDefaut(1)).toEqual([['gauche', 'tout_droit', 'droite']]);
    expect(voiesParDefaut(3)).toEqual([['gauche', 'tout_droit'], ['tout_droit'], ['tout_droit', 'droite']]);
    expect(voiesParDefaut(0)).toEqual([]);
  });
});
