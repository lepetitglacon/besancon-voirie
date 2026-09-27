/**
 * Cadre de l'orthophoto IGN envoyée à l'IA : un rectangle nord en haut (par défaut un carré
 * centré sur le carrefour, sinon la zone dessinée sur la carte), demandé au WMS de la Géoplateforme en Web Mercator (EPSG:3857). Le passage lon/lat ↔ pixel
 * y est exact, ce qui permet de reconvertir sans perte ce que l'IA lit en pixels.
 */
import type { LonLat } from '@voirie/engine';
import { COTE_PHOTO_IA_MAX_M, COTE_PHOTO_IA_MIN_M, type CadrePhotoIa } from '@voirie/schema';

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
  /** Emprise en lon/lat : [ouest, sud, est, nord]. */
  emprise: [number, number, number, number];
  /** Dimensions au sol (m). */
  largeur_m: number;
  hauteur_m: number;
  /** Dimensions de l'image (px) : le plus grand côté mesure `taille_max_px`, pixels carrés. */
  largeur_px: number;
  hauteur_px: number;
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

/** Carré de `cote_m` mètres centré sur `centre`. */
export function cadrePhoto(centre: LonLat, cote_m: number, taille_px: number): CadrePhoto {
  const [x, y] = versMercator(centre);
  // En Web Mercator, un mètre au sol vaut 1 / cos(lat) mètre projeté.
  const demi = cote_m / 2 / Math.cos(centre[1] * RAD);
  return cadreMercator([x - demi, y - demi, x + demi, y + demi], taille_px);
}

/** Rectangle [ouest, sud, est, nord] en lon/lat, par exemple dessiné sur la carte. */
export function cadreEmprise([ouest, sud, est, nord]: [number, number, number, number], taille_max_px: number): CadrePhoto {
  const [xmin, ymin] = versMercator([ouest, sud]);
  const [xmax, ymax] = versMercator([est, nord]);
  return cadreMercator([xmin, ymin, xmax, ymax], taille_max_px);
}

function cadreMercator(bbox: [number, number, number, number], taille_max_px: number): CadrePhoto {
  const [xmin, ymin, xmax, ymax] = bbox;
  const [ouest, sud] = depuisMercator([xmin, ymin]);
  const [est, nord] = depuisMercator([xmax, ymax]);
  const echelle = Math.cos(((sud + nord) / 2) * RAD);
  const largeur_m = (xmax - xmin) * echelle;
  const hauteur_m = (ymax - ymin) * echelle;
  const metres_par_px = Math.max(largeur_m, hauteur_m) / taille_max_px;
  return {
    emprise: [ouest, sud, est, nord],
    largeur_m,
    hauteur_m,
    largeur_px: Math.max(1, Math.round(largeur_m / metres_par_px)),
    hauteur_px: Math.max(1, Math.round(hauteur_m / metres_par_px)),
    bbox,
    metres_par_px,
  };
}

/** Ce que le navigateur montre du cadre, sans l'emprise Web Mercator. */
export const cadrePourClient = ({ bbox: _bbox, ...cadre }: CadrePhoto): CadrePhotoIa => cadre;

/** Raison du refus d'une zone dessinée à la main, null si elle convient. */
export function refusEmprise(cadre: CadrePhoto, centre: LonLat): string | null {
  const cotes = [cadre.largeur_m, cadre.hauteur_m];
  if (cotes.some((c) => c < COTE_PHOTO_IA_MIN_M)) return `Zone trop petite : ${COTE_PHOTO_IA_MIN_M} m de côté au moins`;
  if (cotes.some((c) => c > COTE_PHOTO_IA_MAX_M)) return `Zone trop grande : ${COTE_PHOTO_IA_MAX_M} m de côté au plus`;
  const [ouest, sud, est, nord] = cadre.emprise;
  const [lon, lat] = centre;
  if (lon < ouest || lon > est || lat < sud || lat > nord) return 'La zone doit contenir le centre du carrefour';
  return null;
}

export function versPixel(cadre: CadrePhoto, lonLat: LonLat): Pixel {
  const [x, y] = versMercator(lonLat);
  const [xmin, ymin, xmax, ymax] = cadre.bbox;
  return {
    x: ((x - xmin) / (xmax - xmin)) * cadre.largeur_px,
    y: ((ymax - y) / (ymax - ymin)) * cadre.hauteur_px,
  };
}

export function versLonLat(cadre: CadrePhoto, { x, y }: Pixel): LonLat {
  const [xmin, ymin, xmax, ymax] = cadre.bbox;
  const [lon, lat] = depuisMercator([xmin + (x / cadre.largeur_px) * (xmax - xmin), ymax - (y / cadre.hauteur_px) * (ymax - ymin)]);
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
    WIDTH: String(cadre.largeur_px),
    HEIGHT: String(cadre.hauteur_px),
    FORMAT: 'image/jpeg',
  });
  return `${WMS_IGN}?${parametres}`;
}
