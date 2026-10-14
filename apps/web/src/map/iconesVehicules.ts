import type { Map as CarteMapLibre } from 'maplibre-gl'
import { DENSITE_ETIQUETTE, dessinerEtiquette, type ModeVehicule } from '../ds'

/** Identifiant d'image d'un véhicule : un par mode et par ligne. */
export function idIcone(mode: ModeVehicule, ligne: string): string {
  return `vehicule:${mode}:${ligne}`
}

/**
 * Fournit à la carte les images des véhicules à la demande (`styleimagemissing`) : il y a une
 * image par ligne, et le style les perd à chaque changement de fond. Renvoie le désabonnement.
 */
export function fournirIcones(
  carte: CarteMapLibre,
  mode: ModeVehicule,
  couleurs: (ligne: string) => { couleur: string; couleurTexte: string } | undefined,
): () => void {
  const prefixe = idIcone(mode, '')
  const manquante = ({ id }: { id: string }) => {
    if (!id.startsWith(prefixe) || carte.hasImage(id)) return
    const ligne = id.slice(prefixe.length)
    const teintes = couleurs(ligne)
    if (!teintes) return
    carte.addImage(id, dessinerEtiquette(mode, ligne, teintes.couleur, teintes.couleurTexte), {
      pixelRatio: DENSITE_ETIQUETTE,
    })
  }
  carte.on('styleimagemissing', manquante)
  return () => carte.off('styleimagemissing', manquante)
}
