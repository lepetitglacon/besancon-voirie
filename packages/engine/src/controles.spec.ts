import { describe, expect, it } from 'vitest';
import { controlerCarrefour, etatNiveau, type EntreeControles } from './controles.js';

/** Carrefour en T bâti sur le réseau, programmé, sans défaut. */
const complet: EntreeControles = {
  nature: 'carrefour',
  surLeReseau: true,
  branches: [
    { code: 'N', voies: [{ sens: 'entrante', rang: 0 }, { sens: 'sortante', rang: 0 }] },
    { code: 'S', voies: [{ sens: 'entrante', rang: 0 }, { sens: 'sortante', rang: 0 }] },
  ],
  connexions: [
    { de: 'N:e0', vers: 'S:s0' },
    { de: 'S:e0', vers: 'N:s0' },
  ],
  feux: ['f1', 'f2'],
  lignes: [
    { code: 'F1', feux: ['f1'] },
    { code: 'F2', feux: ['f2'] },
  ],
  nonCommandes: [],
  alertesLignes: [],
  plans: [{ code: 'jour', mode: 'cycle', etapes: 2 }],
  alertesProgramme: [],
};

const codes = (e: EntreeControles) => controlerCarrefour(e).map((c) => c.code);

describe('contrôles d’un carrefour', () => {
  it('rien à redire sur un carrefour complet', () => {
    const constats = controlerCarrefour(complet);
    expect(constats).toEqual([]);
    expect(['N2', 'N3', 'N4'].map((n) => etatNiveau(constats, n as 'N2'))).toEqual(['ok', 'ok', 'ok']);
  });

  it('N2 : voie entrante sans connexion, voie sortante jamais atteinte', () => {
    const constats = controlerCarrefour({ ...complet, connexions: [{ de: 'N:e0', vers: 'S:s0' }] });
    expect(constats.map((c) => c.code)).toEqual(['voie-sans-connexion', 'sortie-jamais-atteinte']);
    expect(constats[0]!.message).toContain('S:e0');
    expect(etatNiveau(constats, 'N2')).toBe('avertissement');
  });

  it('N2 : branche interne inattendue sur le réseau, pas dans un giratoire', () => {
    const avecInterne = { ...complet, branches: [...complet.branches, { code: 'R1', voies: [] }] };
    expect(codes(avecInterne)).toContain('branche-interne');
    expect(codes({ ...avecInterne, nature: 'giratoire' })).not.toContain('branche-interne');
  });

  it('N3 : feu sur aucune ligne, mouvement non commandé, programme absent', () => {
    const constats = controlerCarrefour({ ...complet, lignes: [{ code: 'F1', feux: ['f1'] }], nonCommandes: ['S>N'], plans: [] });
    expect(constats.map((c) => c.code)).toEqual(['feu-sans-ligne', 'mouvement-non-commande', 'aucun-programme', 'sumo-programme-par-defaut']);
    expect(etatNiveau(constats, 'N3')).toBe('erreur');
    expect(etatNiveau(constats, 'N4')).toBe('avertissement');
  });

  it('N4 : un carrefour dessiné à la main n’est pas exporté vers SUMO', () => {
    expect(etatNiveau(controlerCarrefour({ ...complet, surLeReseau: false }), 'N4')).toBe('erreur');
  });
});
