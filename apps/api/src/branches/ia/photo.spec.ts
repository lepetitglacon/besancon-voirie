import { cadrePhoto, urlOrthophoto, versLonLat, versPixel } from './photo.js';

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
