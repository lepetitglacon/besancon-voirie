import { describe, expect, it } from 'vitest';
import {
  calculerMouvements,
  codeCardinal,
  codesBranches,
  directionMouvement,
  lireTurnLanes,
  normaliserAngle,
  voiesParDefaut,
  type BrancheGeometrie,
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

describe('calculerMouvements', () => {
  const croix: BrancheGeometrie[] = [
    { code: 'N', azimut: 0, sens: 'double', voies: [{ rang: 0, mouvements: ['gauche', 'tout_droit', 'droite'] }] },
    { code: 'E', azimut: 90, sens: 'double', voies: [{ rang: 0, mouvements: ['tout_droit'] }] },
    {
      code: 'S',
      azimut: 180,
      sens: 'entrant',
      voies: [
        { rang: 0, mouvements: ['gauche'] },
        { rang: 1, mouvements: ['tout_droit', 'droite'] },
      ],
    },
    { code: 'O', azimut: 270, sens: 'sortant', voies: [] },
  ];

  it('déduit les mouvements des flèches, sans entrer par une branche sortante', () => {
    const { mouvements, alertes } = calculerMouvements(croix);
    expect(mouvements).toEqual([
      { origine: 'N', destination: 'E', direction: 'gauche', voies: [0] },
      { origine: 'N', destination: 'O', direction: 'droite', voies: [0] },
      { origine: 'E', destination: 'O', direction: 'tout_droit', voies: [0] },
      { origine: 'S', destination: 'O', direction: 'gauche', voies: [0] },
      { origine: 'S', destination: 'N', direction: 'tout_droit', voies: [1] },
      { origine: 'S', destination: 'E', direction: 'droite', voies: [1] },
    ]);
    // N tout droit mène au sud, qui est entrant seulement.
    expect(alertes).toEqual([{ branche: 'N', rang: 0, direction: 'tout_droit' }]);
  });

  it('alimente toutes les sorties d’une même direction', () => {
    const cinq: BrancheGeometrie[] = [
      { code: 'S', azimut: 180, sens: 'entrant', voies: [{ rang: 0, mouvements: ['gauche'] }] },
      { code: 'O', azimut: 270, sens: 'sortant', voies: [] },
      { code: 'NO', azimut: 315, sens: 'sortant', voies: [] },
    ];
    expect(calculerMouvements(cinq).mouvements.map((m) => m.destination)).toEqual(['O', 'NO']);
  });
});
