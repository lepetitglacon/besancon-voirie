import { chakra, createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import { NavigationControl } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { controleZoom } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: controleZoom })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root', { defaultProps: { role: 'group' } })
const Bouton = withContext<HTMLButtonElement, HTMLChakraProps<'button'>>('button', 'bouton', { defaultProps: { type: 'button' } })
const Separateur = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'separateur')

/**
 * Zoom et boussole, dans la `<Map>` ou à côté (sous le MapProvider). La boussole de MapLibre
 * reste affichée : clic, remettre au nord et à plat ; glisser, tourner et incliner.
 */
export function ControleZoom(props: HTMLChakraProps<'div'>) {
  // Dans la <Map> (current) ou à côté, sous le MapProvider (carte d'id « carte »).
  const cartes = useMap()
  const carte = cartes.current ?? cartes.carte
  // Seul le bouton de la boussole est repris, sans le contrôle MapLibre (index.css l'habille).
  const boussole = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const conteneur = boussole.current
    if (!carte || !conteneur) return
    const controle = new NavigationControl({ showZoom: false, visualizePitch: true })
    conteneur.append(controle.onAdd(carte.getMap()))
    const bouton = conteneur.querySelector('button')
    if (bouton) {
      bouton.title = 'Glisser : tourner et incliner la carte ; clic : remettre au nord'
      bouton.setAttribute('aria-label', 'Boussole')
    }
    return () => controle.onRemove()
  }, [carte])

  return (
    <Racine aria-label="Zoom" {...props}>
      <Bouton aria-label="Zoomer" onClick={() => carte?.zoomIn()}>
        +
      </Bouton>
      <Separateur />
      <Bouton aria-label="Dézoomer" onClick={() => carte?.zoomOut()}>
        −
      </Bouton>
      <Separateur />
      <chakra.div ref={boussole} className="controle-zoom__boussole" />
    </Racine>
  )
}
