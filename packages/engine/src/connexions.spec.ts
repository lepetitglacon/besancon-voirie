import { describe, expect, it } from 'vitest';
import {
  cleVoie,
  flechesParVoie,
  lireCleVoie,
  mouvementsDepuisConnexions,
  proposerConnexions,
  type Connexion,
} from './connexions.js';

const croix = [
  { code: 'N', azimut: 0 },
  { code: 'E', azimut: 90 },
  { code: 'S', azimut: 180 },
  { code: 'O', azimut: 270 },
];

describe('clés de voie', () => {
  it('se lisent et s’écrivent', () => {
    expect(cleVoie('SO', 'entrante', 1)).toBe('SO:e1');
    expect(lireCleVoie('N2:s0')).toEqual({ branche: 'N2', sens: 'sortante', rang: 0 });
    expect(lireCleVoie('N:x0')).toBeNull();
  });
});

describe('mouvements et flèches déduits des connexions', () => {
  const connexions: Connexion[] = [
    { de: 'S:e0', vers: 'O:s0' },
    { de: 'S:e1', vers: 'N:s0' },
    { de: 'S:e1', vers: 'E:s0' },
    { de: 'S:e0', vers: 'N:s0' },
  ];

  it('regroupe les connexions par mouvement', () => {
    expect(mouvementsDepuisConnexions(croix, connexions)).toEqual([
      { origine: 'S', destination: 'O', direction: 'gauche', voies: [0] },
      { origine: 'S', destination: 'N', direction: 'tout_droit', voies: [0, 1] },
      { origine: 'S', destination: 'E', direction: 'droite', voies: [1] },
    ]);
  });

  it('déduit les flèches de chaque voie', () => {
    expect(flechesParVoie(croix, connexions)).toEqual({
      'S:e0': ['gauche', 'tout_droit'],
      'S:e1': ['tout_droit', 'droite'],
    });
  });
});

describe('proposerConnexions', () => {
  it('relie gauche à gauche, droite à droite, tout droit voie par voie', () => {
    const connexions = proposerConnexions([
      { ...croix[0]!, fleches: [], sortantes: 2 },
      { ...croix[1]!, fleches: [], sortantes: 1 },
      { ...croix[2]!, fleches: [['gauche'], ['tout_droit'], ['tout_droit', 'droite']], sortantes: 1 },
      { ...croix[3]!, fleches: [], sortantes: 2 },
    ]);
    expect(connexions).toEqual([
      { de: 'S:e0', vers: 'O:s0' },
      { de: 'S:e1', vers: 'N:s0' },
      { de: 'S:e2', vers: 'N:s1' },
      { de: 'S:e2', vers: 'E:s0' },
    ]);
  });
});
