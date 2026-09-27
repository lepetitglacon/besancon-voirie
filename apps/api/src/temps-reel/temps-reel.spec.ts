import { etapeTram } from './temps-reel.service.js';

describe('etapeTram', () => {
  const tc = new Set(['T1']);

  it('should prefer the out-of-cycle stage that serves the tram', () => {
    const etapes = [
      { lignes: ['F1', 'T1'], duree_s: 30 },
      { lignes: ['F2'], duree_s: 20 },
      { lignes: ['T1', 'P1'], duree_s: 12, hors_cycle: true },
    ];
    expect(etapeTram(etapes, tc)).toEqual(['T1', 'P1']);
  });

  it('should fall back to a base stage, and give null without a tram signal group', () => {
    expect(etapeTram([{ lignes: ['F2'], duree_s: 20 }, { lignes: ['F1', 'T1'], duree_s: 30 }], tc)).toEqual(['F1', 'T1']);
    expect(etapeTram([{ lignes: ['F1'], duree_s: 30 }], tc)).toBeNull();
    expect(etapeTram(null, tc)).toBeNull();
  });
});
