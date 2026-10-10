import type { LonLat } from '@voirie/engine'

/** Altitudes Terrarium (Mapzen, AWS Open Data), sans clé, ~30 m de précision en France. */
export const MNT_TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

/** Zoom des tuiles lues pour les profils : une dizaine de mètres par pixel à Besançon. */
const ZOOM = 14
const TAILLE_TUILE = 256

/** Tuiles déjà décodées (ou en cours), partagées entre les mesures. */
const tuiles = new Map<string, Promise<ImageData>>()

function tuile(x: number, y: number): Promise<ImageData> {
  const cle = `${x}/${y}`
  let donnees = tuiles.get(cle)
  if (!donnees) {
    donnees = new Promise<ImageData>((resoudre, rejeter) => {
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.onload = () => {
        const toile = document.createElement('canvas')
        toile.width = toile.height = TAILLE_TUILE
        const contexte = toile.getContext('2d', { willReadFrequently: true })
        if (!contexte) return rejeter(new Error('Canvas 2D indisponible'))
        contexte.drawImage(image, 0, 0)
        resoudre(contexte.getImageData(0, 0, TAILLE_TUILE, TAILLE_TUILE))
      }
      image.onerror = () => rejeter(new Error(`Tuile d'altitude ${cle} illisible`))
      image.src = MNT_TERRARIUM.replace('{z}', String(ZOOM)).replace('{x}', String(x)).replace('{y}', String(y))
    })
    // Un échec n'est pas gardé : la tuile sera redemandée à la prochaine mesure.
    donnees.catch(() => tuiles.delete(cle))
    tuiles.set(cle, donnees)
  }
  return donnees
}

/** Altitude en mètres d'un point, lue dans la tuile Terrarium qui le couvre. */
async function altitude([lon, lat]: LonLat): Promise<number> {
  const monde = TAILLE_TUILE * 2 ** ZOOM
  const rad = (lat * Math.PI) / 180
  const px = ((lon + 180) / 360) * monde
  const py = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * monde
  const x = Math.floor(px / TAILLE_TUILE)
  const y = Math.floor(py / TAILLE_TUILE)
  const image = await tuile(x, y)
  const i = (Math.floor(py - y * TAILLE_TUILE) * TAILLE_TUILE + Math.floor(px - x * TAILLE_TUILE)) * 4
  const d = image.data
  return d[i]! * 256 + d[i + 1]! + d[i + 2]! / 256 - 32768
}

/** Altitudes de plusieurs points (les tuiles communes ne sont lues qu'une fois). */
export function altitudes(points: LonLat[]): Promise<number[]> {
  return Promise.all(points.map(altitude))
}
