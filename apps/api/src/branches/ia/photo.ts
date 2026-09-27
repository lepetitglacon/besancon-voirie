/**
 * Cadre de l'orthophoto IGN envoyée à l'IA : un carré centré sur le carrefour, nord en haut,
 * demandé au WMS de la Géoplateforme en Web Mercator (EPSG:3857). Le passage lon/lat ↔ pixel
 * y est exact, ce qui permet de reconvertir sans perte ce que l'IA lit en pixels.
 */
import type { LonLat } from '@voirie/engine';

const RAYON_MERCATOR = 6_378_137;
const RAD = Math.PI / 180;

/** Orthophotos IGN (Licence Ouverte, sans clé), ~20 cm/pixel. */
const WMS_IGN = 'https://data.geopf.fr/wms-r/wms';
const COUCHE_IGN = 'HR.ORTHOIMAGERY.ORTHOPHOTOS';

export interface Pixel {
  x: number;
  y: number;
}

export interface CadrePhoto {
  centre: LonLat;
  /** Côté du carré au sol (m). */
  cote_m: number;
  /** Côté de l'image (px). */
  taille_px: number;
  /** Emprise en Web Mercator : [xmin, ymin, xmax, ymax]. */
  bbox: [number, number, number, number];
  /** Mètres au sol par pixel. */
  metres_par_px: number;
}

const versMercator = ([lon, lat]: LonLat): [number, number] => [
  RAYON_MERCATOR * lon * RAD,
  RAYON_MERCATOR * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2)),
];

const depuisMercator = ([x, y]: [number, number]): LonLat => [
  x / RAYON_MERCATOR / RAD,
  (2 * Math.atan(Math.exp(y / RAYON_MERCATOR)) - Math.PI / 2) / RAD,
];

export function cadrePhoto(centre: LonLat, cote_m: number, taille_px: number): CadrePhoto {
  const [x, y] = versMercator(centre);
  // En Web Mercator, un mètre au sol vaut 1 / cos(lat) mètre projeté.
  const demi = cote_m / 2 / Math.cos(centre[1] * RAD);
  return {
    centre,
    cote_m,
    taille_px,
    bbox: [x - demi, y - demi, x + demi, y + demi],
    metres_par_px: cote_m / taille_px,
  };
}

export function versPixel(cadre: CadrePhoto, lonLat: LonLat): Pixel {
  const [x, y] = versMercator(lonLat);
  const [xmin, ymin, xmax, ymax] = cadre.bbox;
  return {
    x: ((x - xmin) / (xmax - xmin)) * cadre.taille_px,
    y: ((ymax - y) / (ymax - ymin)) * cadre.taille_px,
  };
}

export function versLonLat(cadre: CadrePhoto, { x, y }: Pixel): LonLat {
  const [xmin, ymin, xmax, ymax] = cadre.bbox;
  const [lon, lat] = depuisMercator([xmin + (x / cadre.taille_px) * (xmax - xmin), ymax - (y / cadre.taille_px) * (ymax - ymin)]);
  return [Number(lon.toFixed(7)), Number(lat.toFixed(7))];
}

export function urlOrthophoto(cadre: CadrePhoto): string {
  const parametres = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: COUCHE_IGN,
    STYLES: '',
    CRS: 'EPSG:3857',
    BBOX: cadre.bbox.join(','),
    WIDTH: String(cadre.taille_px),
    HEIGHT: String(cadre.taille_px),
    FORMAT: 'image/jpeg',
  });
  return `${WMS_IGN}?${parametres}`;
}
