import { chakra, Menu, Portal } from '@chakra-ui/react'
import type { ReactNode } from 'react'

export type EntreeMenu =
  | { type?: 'action'; valeur: string; glyphe?: ReactNode; libelle: string; raccourci?: string; danger?: boolean }
  | { type: 'separateur' }

interface Props {
  /** Zone où le clic droit ouvre le menu (la carte). */
  children: ReactNode
  /** Première ligne du menu, en police à chasse fixe : coordonnées du clic. */
  entete?: ReactNode
  entrees: EntreeMenu[]
  onChoisir: (valeur: string) => void
}

/** Clic droit : actions rapides à l'emplacement du curseur, avec leurs raccourcis. */
export function MenuContextuel({ children, entete, entrees, onChoisir }: Props) {
  return (
    <Menu.Root size="md" onSelect={(e) => onChoisir(e.value)}>
      <Menu.ContextTrigger asChild>{children}</Menu.ContextTrigger>
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
