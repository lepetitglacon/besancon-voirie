import type { XY } from '@voirie/engine'
import { useEffect, type RefObject } from 'react'
import { useMap } from 'react-map-gl/maplibre'

/** Au-delà (px) entre l'appui et le relâché, c'est un déplacement de la carte, pas un clic. */
export const TOLERANCE_CLIC_PX = 3

/**
 * MapLibre n'écoute la molette et l'appui de la souris que sur son conteneur de canvas : on lui
 * renvoie ceux reçus par les éléments d'un calque SVG, pour zoomer et déplacer la carte depuis
 * une voie ou une liaison. Les poignées gardent l'appui (glisser-déposer). La suite du geste
 * (mousemove, mouseup) est écoutée par MapLibre sur tout le document.
 */
export function useRelaisCarte(refSvg: RefObject<SVGSVGElement | null>) {
  const { current: carte } = useMap()
  useEffect(() => {
    const svg = refSvg.current
    const canvas = carte?.getCanvas()
    if (!svg || !canvas) return
    // Écouteur non passif, pour bloquer aussi le zoom du navigateur (pincement = molette + ctrl).
    const relayerMolette = (e: WheelEvent) => {
      e.preventDefault()
      canvas.dispatchEvent(new WheelEvent('wheel', e))
    }
    let appui: XY | null = null
    const relayerAppui = (e: globalThis.MouseEvent) => {
      if (e.button !== 0 || (e.target as Element).closest('.calque-poignee, .calque-zone-trace, .calque-noeud-reseau.interactive')) return
      appui = [e.clientX, e.clientY]
      canvas.dispatchEvent(new globalThis.MouseEvent('mousedown', e))
    }
    // Un déplacement de la carte ne vaut pas clic sur l'élément où la souris a été relâchée.
    const filtrerClic = (e: globalThis.MouseEvent) => {
      if (appui && Math.hypot(e.clientX - appui[0], e.clientY - appui[1]) > TOLERANCE_CLIC_PX) e.stopPropagation()
      appui = null
    }
    svg.addEventListener('wheel', relayerMolette, { passive: false })
    svg.addEventListener('mousedown', relayerAppui)
    svg.addEventListener('click', filtrerClic, { capture: true })
    return () => {
      svg.removeEventListener('wheel', relayerMolette)
      svg.removeEventListener('mousedown', relayerAppui)
      svg.removeEventListener('click', filtrerClic, { capture: true })
    }
  }, [carte, refSvg])
}
