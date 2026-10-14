/**
 * Étiquette d'un véhicule de transport en commun, dessinée sur un canvas : servie à la carte
 * comme image MapLibre (map/iconesVehicules) et affichée telle quelle par EtiquetteVehicule.
 */

/** Densité des images : nettes sur un écran haute résolution. */
export const DENSITE_ETIQUETTE = 2
const DENSITE = DENSITE_ETIQUETTE
const HAUTEUR = 20
const PICTO = 12
const MARGE = 5
const ESPACE = 3
const POLICE = `700 11px "Noto Sans", system-ui, sans-serif`
/** Resserrement de chaque flanc de la silhouette du tram, du bas vers le haut. */
const RETRAIT_TRAM = 3

export type ModeVehicule = 'tram' | 'bus'

/** Rectangle à coins arrondis, ajouté au chemin courant. */
function rectangle(ctx: CanvasRenderingContext2D, x: number, y: number, l: number, h: number, r: number) {
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + l, y, x + l, y + h, r)
  ctx.arcTo(x + l, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + l, y, r)
  ctx.closePath()
}

/**
 * Silhouette de rame, ajoutée au chemin courant : bas plat et plus large, flancs qui se
 * resserrent vers un haut très arrondi.
 */
function silhouetteTram(ctx: CanvasRenderingContext2D, l: number, h: number) {
  const coins: Array<[number, number, number]> = [
    [RETRAIT_TRAM, 0, h / 2],
    [l - RETRAIT_TRAM, 0, h / 2],
    [l, h, 2],
    [0, h, 2],
  ]
  const [x0, y0] = coins[3]!
  const [x1, y1] = coins[0]!
  ctx.moveTo((x0 + x1) / 2, (y0 + y1) / 2)
  for (let i = 0; i < coins.length; i++) {
    const [x, y, r] = coins[i]!
    const [xs, ys] = coins[(i + 1) % coins.length]!
    ctx.arcTo(x, y, xs, ys, r)
  }
  ctx.closePath()
}

/** Tram vu de face, dans un carré de PICTO : pantographe, caisse, pare-brise, feux. */
function pictoTram(ctx: CanvasRenderingContext2D, couleur: string, fond: string) {
  ctx.strokeStyle = couleur
  ctx.fillStyle = couleur
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(3.5, 0.8)
  ctx.lineTo(8.5, 0.8)
  ctx.moveTo(6, 0.8)
  ctx.lineTo(6, 2.5)
  ctx.stroke()
  ctx.beginPath()
  rectangle(ctx, 2, 2.5, 8, 8, 2)
  ctx.fill()
  ctx.fillStyle = fond
  ctx.beginPath()
  rectangle(ctx, 3.3, 3.8, 5.4, 3, 0.8)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(4.2, 8.6, 0.8, 0, 2 * Math.PI)
  ctx.arc(7.8, 8.6, 0.8, 0, 2 * Math.PI)
  ctx.fill()
  ctx.strokeStyle = couleur
  ctx.beginPath()
  ctx.moveTo(3.5, 10.5)
  ctx.lineTo(2.5, 11.8)
  ctx.moveTo(8.5, 10.5)
  ctx.lineTo(9.5, 11.8)
  ctx.stroke()
}

/** Bus vu de face : caisse haute, grand pare-brise, rétroviseurs et roues. */
function pictoBus(ctx: CanvasRenderingContext2D, couleur: string, fond: string) {
  ctx.fillStyle = couleur
  ctx.beginPath()
  rectangle(ctx, 2, 1, 8, 9.5, 1.8)
  ctx.fill()
  ctx.fillRect(1, 3, 1.2, 2.5)
  ctx.fillRect(9.8, 3, 1.2, 2.5)
  ctx.fillRect(2.8, 10, 1.8, 1.8)
  ctx.fillRect(7.4, 10, 1.8, 1.8)
  ctx.fillStyle = fond
  ctx.fillRect(3.2, 2.4, 5.6, 0.9)
  ctx.beginPath()
  rectangle(ctx, 3.2, 4, 5.6, 3.3, 0.6)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(4.1, 8.8, 0.7, 0, 2 * Math.PI)
  ctx.arc(7.9, 8.8, 0.7, 0, 2 * Math.PI)
  ctx.fill()
}

/**
 * Étiquette d'un véhicule : pictogramme du mode et numéro de ligne, aux couleurs de la ligne,
 * bordée de blanc pour rester lisible sur la photo aérienne. Le contour reprend la forme du
 * véhicule : silhouette de rame pour le tram (bas plat et large, haut arrondi), carré à coins
 * légèrement arrondis pour le bus. Les deux se distinguent même sans lire le pictogramme.
 */
export function dessinerEtiquette(mode: ModeVehicule, ligne: string, couleur: string, couleurTexte: string): ImageData {
  const mesure = document.createElement('canvas').getContext('2d')!
  mesure.font = POLICE
  const largeurTexte = Math.ceil(mesure.measureText(ligne).width)
  const marge = mode === 'tram' ? MARGE + RETRAIT_TRAM : MARGE
  const largeur = marge + PICTO + ESPACE + largeurTexte + marge
  const canvas = document.createElement('canvas')
  canvas.width = (largeur + 2) * DENSITE
  canvas.height = (HAUTEUR + 2) * DENSITE
  const ctx = canvas.getContext('2d')!
  ctx.scale(DENSITE, DENSITE)
  ctx.translate(1, 1)

  ctx.beginPath()
  if (mode === 'tram') silhouetteTram(ctx, largeur, HAUTEUR)
  else rectangle(ctx, 0, 0, largeur, HAUTEUR, 4)
  ctx.fillStyle = couleur
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#ffffff'
  ctx.stroke()

  ctx.save()
  ctx.translate(marge, (HAUTEUR - PICTO) / 2)
  if (mode === 'tram') pictoTram(ctx, couleurTexte, couleur)
  else pictoBus(ctx, couleurTexte, couleur)
  ctx.restore()

  ctx.font = POLICE
  ctx.fillStyle = couleurTexte
  ctx.textBaseline = 'middle'
  ctx.fillText(ligne, marge + PICTO + ESPACE, HAUTEUR / 2 + 0.5)
  return ctx.getImageData(0, 0, canvas.width, canvas.height)
}
