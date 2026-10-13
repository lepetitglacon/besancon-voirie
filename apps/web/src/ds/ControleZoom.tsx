import { createSlotRecipeContext, type HTMLChakraProps } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { useMap } from 'react-map-gl/maplibre'
import { controleZoom } from '../theme/recettes-projet'

const { withProvider, withContext } = createSlotRecipeContext({ recipe: controleZoom })

const Racine = withProvider<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'root', { defaultProps: { role: 'group' } })
const Bouton = withContext<HTMLButtonElement, HTMLChakraProps<'button'>>('button', 'bouton', { defaultProps: { type: 'button' } })
const Separateur = withContext<HTMLDivElement, HTMLChakraProps<'div'>>('div', 'separateur')

/**
 * Zoom et remise au nord, dans la `<Map>` ou à côté (sous le MapProvider). Le bouton « nord »
 * n'apparaît que lorsque la carte est tournée ou inclinée.
 */
export function ControleZoom(props: HTMLChakraProps<'div'>) {
  // Dans la <Map> (current) ou à côté, sous le MapProvider (carte d'id « carte »).
  const cartes = useMap()
  const carte = cartes.current ?? cartes.carte
  const [oriente, setOriente] = useState(false)

  useEffect(() => {
    if (!carte) return
    const suivre = () => setOriente(Math.abs(carte.getBearing()) > 0.5 || carte.getPitch() > 0.5)
    suivre()
    carte.on('rotate', suivre)
    carte.on('pitch', suivre)
    return () => {
      carte.off('rotate', suivre)
      carte.off('pitch', suivre)
    }
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
      {oriente && (
        <>
          <Separateur />
          <Bouton aria-label="Remettre au nord" title="Remettre au nord" fontSize="13px" onClick={() => carte?.resetNorthPitch()}>
            N
          </Bouton>
        </>
      )}
    </Racine>
  )
}
