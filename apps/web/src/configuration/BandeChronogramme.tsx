import { Box, type BoxProps } from '@chakra-ui/react'
import type { LigneProgramme } from '@voirie/engine'
import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { PanneauBas } from '../ds'
import { Chronogramme } from './Chronogramme'
import { Lecture } from './Lecture'

type PropsChronogramme = ComponentProps<typeof Chronogramme>

/** Les props de boîte placent la bande (position, bords). */
interface Props extends Omit<BoxProps, 'title'> {
  titre: string
  chronologie: PropsChronogramme['chronologie']
  lignes: readonly LigneProgramme[]
  instant: number
  onInstant: (t: number) => void
  vitesse: number | null
  onVitesse: (vitesse: number | null) => void
  demandes?: PropsChronogramme['demandes']
  onEtirer?: PropsChronogramme['onEtirer']
  /** Hauteur occupée en bas de l'écran (px), 0 quand la bande disparaît : la carte et les barres s'écartent. */
  onHauteur: (hauteur: number) => void
}

/**
 * Diagramme de feux en bande, sous la carte, quand le plan de feux est posé à droite : on lit le cycle
 * (et on tire les étapes) en gardant la carte et le panneau en vue.
 */
export function BandeChronogramme({ titre, chronologie, lignes, instant, onInstant, vitesse, onVitesse, demandes, onEtirer, onHauteur, ...props }: Props) {
  const racine = useRef<HTMLDivElement>(null)
  const corps = useRef<HTMLDivElement>(null)
  /** Largeur du dessin = largeur affichée : le texte garde sa taille. */
  const [largeur, setLargeur] = useState<number | null>(null)

  useEffect(() => {
    const observateur = new ResizeObserver(() => {
      if (racine.current) onHauteur(racine.current.offsetHeight)
      if (corps.current) setLargeur(corps.current.clientWidth)
    })
    if (racine.current) observateur.observe(racine.current)
    if (corps.current) observateur.observe(corps.current)
    return () => {
      observateur.disconnect()
      onHauteur(0)
    }
  }, [onHauteur])

  return (
    <Box ref={racine} {...props}>
      <PanneauBas.Root cote="bas" aria-label="Diagramme de feux">
        <PanneauBas.Entete titre={titre} py="1.5">
          <Lecture instant={instant} vitesse={vitesse} onVitesse={onVitesse} />
        </PanneauBas.Entete>
        <PanneauBas.Corps py="2" overflow="visible">
          <Box ref={corps}>
            {largeur !== null && (
              <Chronogramme
                chronologie={chronologie}
                lignes={lignes}
                instant={instant}
                onInstant={onInstant}
                demandes={demandes}
                onEtirer={onEtirer}
                largeur={Math.max(400, largeur)}
              />
            )}
          </Box>
        </PanneauBas.Corps>
      </PanneauBas.Root>
    </Box>
  )
}
