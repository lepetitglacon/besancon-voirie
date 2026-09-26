import { describe, expect, it } from 'vitest';
import { proposerNom, slugifier, slugLibre } from './nommage.js';

describe('proposerNom', () => {
  it('garde trois noms distincts au plus', () => {
    expect(proposerNom(['Avenue B', 'Rue A', 'Rue A', 'Rue C', 'Rue D'])).toBe('Avenue B × Rue A × Rue C');
  });

  it('confond les noms qui ne diffèrent que par les articles', () => {
    expect(proposerNom(['Avenue du Maréchal Foch', 'Avenue Maréchal Foch', "Avenue d'Helvétie"])).toBe(
      "Avenue du Maréchal Foch × Avenue d'Helvétie",
    );
  });

  it('nomme une traversée piétonne d’après sa rue', () => {
    expect(proposerNom(['Rue C', 'Rue D'], 'traversee_pietonne')).toBe('Traversée piétonne, Rue C');
    expect(proposerNom([], 'traversee_pietonne')).toBe('Traversée piétonne');
  });

  it('a un nom par défaut', () => {
    expect(proposerNom([])).toBe('Carrefour sans nom');
  });
});

describe('slugifier / slugLibre', () => {
  it('retire accents et ponctuation', () => {
    expect(slugifier("Avenue d'Helvétie × Rue Édouard Belin")).toBe('avenue-d-helvetie-rue-edouard-belin');
  });

  it('suffixe les slugs déjà pris', () => {
    expect(slugLibre('rue-a', new Set(['rue-a', 'rue-a-2']))).toBe('rue-a-3');
    expect(slugLibre('', new Set())).toBe('carrefour');
  });
});
