import { describe, expect, it } from 'vitest';
import { repereLocal, type LonLat } from './geometrie.js';
import { vueCarrefour, type EntreeVue, type NoeudVue, type TronconVue } from './vueCarrefour.js';

const centre: LonLat = [6.03, 47.25];
const m = (x: number, y: number) => repereLocal(centre).versLonLat([x, y]);

const noeud = (id: string, x: number, y: number, options: Partial<NoeudVue> = {}): NoeudVue & { xy: [number, number] } => ({
  id,
  position: m(x, y),
  feux: false,
  pieton: null,
  liaisons: null,
  xy: [x, y],
  ...options,
});

/** Tronçon droit à une voie par sens. */
function troncon(id: string, de: ReturnType<typeof noeud>, vers: ReturnType<typeof noeud>, options: Partial<TronconVue> = {}): TronconVue {
  return {
    id,
    noeud_de: de.id,
    noeud_vers: vers.id,
    points: [de.position, vers.position],
    voies_avant: 1,
    voies_arriere: 1,
    types_avant: null,
    types_arriere: null,
    nom: id,
    osm_way_id: null,
    branche_de: null,
    branche_vers: null,
    ...options,
  };
}

/** Entrée de la vue : les nœuds du carrefour, les tronçons qui les touchent et le degré de chaque nœud. */
function entree(carrefour: Array<ReturnType<typeof noeud>>, troncons: TronconVue[]): EntreeVue {
  const degres = new Map<string, number>();
  for (const t of troncons) for (const n of [t.noeud_de, t.noeud_vers]) degres.set(n, (degres.get(n) ?? 0) + 1);
  const ids = new Set(carrefour.map((n) => n.id));
  return { noeuds: carrefour, troncons: troncons.filter((t) => ids.has(t.noeud_de) || ids.has(t.noeud_vers)), degres };
}

const cles = (vue: ReturnType<typeof vueCarrefour>) => vue.connexions.map((c) => `${c.de}>${c.vers}`).sort();

describe('vue d’un carrefour tirée du réseau', () => {
  // Intersection « j » ; une ligne d'arrêt à feux sur chaque approche, à 20 m ; un passage piéton
  // entre la ligne d'arrêt sud et l'intersection.
  const j = noeud('j', 0, 0);
  const arrets = {
    n: noeud('sn', 0, 20, { feux: true }),
    s: noeud('ss', 0, -20, { feux: true }),
    e: noeud('se', 20, 0, { feux: true }),
    o: noeud('so', -20, 0, { feux: true }),
  };
  const passageSud = noeud('ps', 0, -12, { pieton: 'marquee' });
  const loin = { n: noeud('an', 0, 200), s: noeud('as', 0, -200), e: noeud('ae', 200, 0), o: noeud('ao', -200, 0) };
  const troncons = [
    troncon('tn', loin.n, arrets.n),
    troncon('in', arrets.n, j),
    troncon('ts', loin.s, arrets.s),
    troncon('is1', arrets.s, passageSud),
    troncon('is2', passageSud, j),
    troncon('te', loin.e, arrets.e),
    troncon('ie', arrets.e, j),
    troncon('to', loin.o, arrets.o),
    troncon('io', arrets.o, j),
  ];
  const vue = vueCarrefour(entree([j, ...Object.values(arrets), passageSud], troncons));

  it('fait une branche de chaque rue qui entre, nommée par son point cardinal, à sa ligne d’arrêt', () => {
    expect(vue.branches.map((b) => [b.code, b.interne]).sort()).toEqual([
      ['E', false],
      ['N', false],
      ['O', false],
      ['S', false],
    ]);
    const nord = vue.branches.find((b) => b.code === 'N')!;
    expect(nord.voies.map((v) => [v.sens, v.rang, v.type])).toEqual([
      ['entrante', 0, 'generale'],
      ['sortante', 0, 'generale'],
    ]);
    // La voie entrante finit sur la ligne d'arrêt (x = 1,6 m à droite de l'axe, y = 20 m).
    const [bout] = nord.voies.find((v) => v.sens === 'entrante')!.geom;
    const [x, y] = repereLocal(centre).versXY(bout);
    expect(y).toBeCloseTo(20, 1);
    expect(Math.abs(x)).toBeCloseTo(1.625, 1);
    expect(vue.codes).toContainEqual({ troncon: 'tn', extremite: 'vers', code: 'N' });
    expect(vue.alertes).toEqual([]);
  });

  it('relie chaque entrée à chaque sortie à travers l’intersection, sans demi-tour', () => {
    expect(cles(vue)).toHaveLength(12);
    expect(cles(vue)).toContain('N:e0>S:s0');
    expect(cles(vue)).toContain('N:e0>E:s0');
    expect(cles(vue)).toContain('S:e0>O:s0');
    expect(cles(vue)).not.toContain('N:e0>N:s0');
  });

  it('prend le passage piéton entre la ligne d’arrêt et l’intersection', () => {
    expect(vue.branches.find((b) => b.code === 'S')!.traversee).not.toBeNull();
    expect(vue.branches.find((b) => b.code === 'N')!.traversee).toBeNull();
  });

  it('suit l’approche jusqu’à la ligne d’arrêt quand le carrefour commence plus loin', () => {
    // Passage piéton sans feux en amont de la ligne d'arrêt nord : il est du carrefour.
    const amont = noeud('pn', 0, 40, { pieton: 'marquee' });
    const autres = troncons.filter((t) => t.id !== 'tn');
    const vueAmont = vueCarrefour(
      entree([j, ...Object.values(arrets), passageSud, amont], [...autres, troncon('tn', loin.n, amont), troncon('tn2', amont, arrets.n)]),
    );
    const nord = vueAmont.branches.find((b) => b.code === 'N')!;
    expect(vueAmont.branches.some((b) => b.interne)).toBe(false);
    expect(repereLocal(centre).versXY(nord.voies.find((v) => v.sens === 'entrante')!.geom[0])[1]).toBeCloseTo(20, 1);
    expect(nord.traversee).not.toBeNull();
    expect(vueAmont.codes).toContainEqual({ troncon: 'tn2', extremite: 'vers', code: 'N' });
  });

  it('garde un code déjà donné', () => {
    const garde = vueCarrefour(
      entree(
        [j, ...Object.values(arrets), passageSud],
        troncons.map((t) => (t.id === 'tn' ? { ...t, branche_vers: 'NX' } : t)),
      ),
    );
    expect(garde.branches.map((b) => b.code).sort()).toEqual(['E', 'NX', 'O', 'S']);
    expect(cles(garde)).toContain('NX:e0>S:s0');
  });
});

describe('feu sur le terre-plein d’une chaussée séparée', () => {
  // Deux intersections reliées par le terre-plein, coupé par une ligne d'arrêt à feux « m ».
  const j1 = noeud('j1', 0, 0);
  const j2 = noeud('j2', 40, 0);
  const mediane = noeud('m', 20, 0, { feux: true });
  const troncons = [
    troncon('to', noeud('ao', -200, 0), j1),
    troncon('tn', noeud('an', 0, 200), j1),
    troncon('m1', j1, mediane),
    troncon('m2', mediane, j2),
    troncon('te', j2, noeud('ae', 240, 0)),
    troncon('ts', j2, noeud('as', 40, -200)),
  ];
  const vue = vueCarrefour(entree([j1, mediane, j2], troncons));

  it('ouvre une branche interne à la ligne d’arrêt du terre-plein', () => {
    expect(vue.branches.filter((b) => b.interne).map((b) => b.code).sort()).toEqual(['R1', 'R2']);
    expect(vue.branches.filter((b) => !b.interne).map((b) => b.code).sort()).toEqual(['E', 'N', 'O', 'S']);
  });

  it('arrête les connexions à la ligne d’arrêt interne, puis repart de là', () => {
    // Vers l'est, le terre-plein arrive à « m » par m1 : c'est la branche interne R2 (azimut 270).
    expect(cles(vue)).toContain('O:e0>R2:s0');
    expect(cles(vue)).toContain('R2:e0>E:s0');
    expect(cles(vue)).toContain('R2:e0>S:s0');
    expect(cles(vue)).not.toContain('O:e0>E:s0');
  });
});
