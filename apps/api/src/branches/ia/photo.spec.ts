import { cadreEmprise, cadrePhoto, refusEmprise, urlOrthophoto, versLonLat, versPixel } from './photo.js';

const centre: [number, number] = [6.0235472, 47.2450654];

describe('cadrePhoto', () => {
  it('should put the junction centre in the middle of the image', () => {
    const cadre = cadrePhoto(centre, 120, 1024);
    const { x, y } = versPixel(cadre, centre);
    expect(x).toBeCloseTo(512, 6);
    expect(y).toBeCloseTo(512, 6);
    expect(cadre.metres_par_px).toBeCloseTo(0.1172, 4);
  });

  it('should keep north up and east to the right', () => {
    const cadre = cadrePhoto(centre, 120, 1024);
    const nord = versPixel(cadre, [centre[0], centre[1] + 0.0001]);
    const est = versPixel(cadre, [centre[0] + 0.0001, centre[1]]);
    expect(nord.y).toBeLessThan(512);
    expect(est.x).toBeGreaterThan(512);
  });

  it('should match ground distances (10 m east ≈ 10 m / resolution pixels)', () => {
    const cadre = cadrePhoto(centre, 120, 1024);
    const dixMetresEst = 10 / (6_371_008.8 * (Math.PI / 180) * Math.cos((centre[1] * Math.PI) / 180));
    const { x } = versPixel(cadre, [centre[0] + dixMetresEst, centre[1]]);
    expect((x - 512) * cadre.metres_par_px).toBeCloseTo(10, 1);
  });

  it('should convert pixels back to lon/lat within a centimetre', () => {
    const cadre = cadrePhoto(centre, 150, 1024);
    const point: [number, number] = [6.0236586, 47.2449731];
    const retour = versLonLat(cadre, versPixel(cadre, point));
    expect(retour[0]).toBeCloseTo(point[0], 7);
    expect(retour[1]).toBeCloseTo(point[1], 7);
  });

  it('should ask the IGN WMS for a square Web Mercator frame', () => {
    const url = new URL(urlOrthophoto(cadrePhoto(centre, 120, 1024)));
    expect(url.searchParams.get('CRS')).toBe('EPSG:3857');
    expect(url.searchParams.get('LAYERS')).toBe('HR.ORTHOIMAGERY.ORTHOPHOTOS');
    const [xmin, ymin, xmax, ymax] = url.searchParams.get('BBOX')!.split(',').map(Number);
    expect(xmax! - xmin!).toBeCloseTo(ymax! - ymin!, 6);
  });
});

describe('cadreEmprise', () => {
  // Zone dessinée : ~150 m d'est en ouest, ~75 m du sud au nord.
  const cadre = cadreEmprise([6.0225, 47.2447, 6.0245, 47.24537], 1024);

  it('should keep square pixels, the longest side at full size', () => {
    expect(cadre.largeur_m).toBeCloseTo(151, 0);
    expect(cadre.hauteur_m).toBeCloseTo(74.5, 0);
    expect(cadre.largeur_px).toBe(1024);
    expect(cadre.hauteur_px).toBe(Math.round(cadre.hauteur_m / cadre.metres_par_px));
    const url = new URL(urlOrthophoto(cadre));
    expect([url.searchParams.get('WIDTH'), url.searchParams.get('HEIGHT')]).toEqual(['1024', String(cadre.hauteur_px)]);
  });

  it('should map its corners to the image corners', () => {
    const coin = versPixel(cadre, [6.0245, 47.2447]);
    expect(coin.x).toBeCloseTo(cadre.largeur_px, 6);
    expect(coin.y).toBeCloseTo(cadre.hauteur_px, 6);
    const retour = versLonLat(cadre, { x: 0, y: 0 });
    expect(retour).toEqual([6.0225, 47.24537]);
  });

  it('should refuse a zone too small, too large, or without the junction centre', () => {
    expect(refusEmprise(cadre, [6.0235, 47.245])).toBeNull();
    expect(refusEmprise(cadre, [6.03, 47.245])).toMatch(/centre du carrefour/);
    expect(refusEmprise(cadreEmprise([6.0234, 47.2449, 6.0236, 47.2451], 1024), [6.0235, 47.245])).toMatch(/trop petite/);
    expect(refusEmprise(cadreEmprise([6.018, 47.242, 6.029, 47.248], 1024), [6.0235, 47.245])).toMatch(/trop grande/);
  });
});
