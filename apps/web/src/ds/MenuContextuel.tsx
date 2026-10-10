import { chakra, Menu, Portal } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export type EntreeMenu =
  | { type?: 'action'; valeur: string; glyphe?: ReactNode; libelle: string; raccourci?: string; danger?: boolean }
  | { type: 'separateur' }

interface Props {
  /** Point de l'écran où ouvrir le menu (coordonnées client) ; null : menu fermé. */
  point: { x: number; y: number } | null
  /** Première ligne du menu, en police à chasse fixe : coordonnées du clic. */
  entete?: ReactNode
  entrees: EntreeMenu[]
  onChoisir: (valeur: string) => void
  onFermer: () => void
}

/**
 * Clic droit : actions rapides à l'emplacement du curseur, avec leurs raccourcis. L'ouverture est
 * pilotée par la carte (clic droit sans glisser), pas par l'événement `contextmenu` : sous Linux,
 * il part dès l'appui et ouvrait le menu au début d'une rotation.
 */
export function MenuContextuel({ point, entete, entrees, onChoisir, onFermer }: Props) {
  return (
    <Menu.Root
      size="md"
      open={point !== null}
      onOpenChange={(e) => !e.open && onFermer()}
      onSelect={(e) => onChoisir(e.value)}
      positioning={{ placement: 'bottom-start', gutter: 2 }}
    >
      {/* Ancre invisible, posée au point du clic. */}
      <Menu.Trigger asChild>
        <chakra.span
          position="fixed"
          w="0"
          h="0"
          pointerEvents="none"
          aria-hidden
          tabIndex={-1}
          style={{ left: point?.x ?? 0, top: point?.y ?? 0 }}
        />
      </Menu.Trigger>
      <Portal>
        <Menu.Positioner>
          <Menu.Content minW="250px">
            {entete && (
              <chakra.div px="2.5" pt="1.5" pb="2" fontFamily="mono" textStyle="2xs" color="fg.subtle">
                {entete}
              </chakra.div>
            )}
            {entrees.map((entree, i) =>
              entree.type === 'separateur' ? (
                <Menu.Separator key={i} />
              ) : (
                <Menu.Item key={entree.valeur} value={entree.valeur} color={entree.danger ? 'fg.error' : undefined}>
                  <chakra.span w="18px" textAlign="center" color={entree.danger ? undefined : 'fg.secondary'}>
                    {entree.glyphe}
                  </chakra.span>
                  <Menu.ItemText>{entree.libelle}</Menu.ItemText>
                  {entree.raccourci && <Menu.ItemCommand>{entree.raccourci}</Menu.ItemCommand>}
                </Menu.Item>
              ),
            )}
          </Menu.Content>
        </Menu.Positioner>
      </Portal>
    </Menu.Root>
  )
}
