import { chakra, Table } from '@chakra-ui/react'
import type { ConflitLignes } from '@voirie/engine'
import { Aide } from '../ds'

const SYMBOLES: Record<ConflitLignes['nature'] | 'admis', { symbole: string; titre: string; couleur: string }> = {
  croisement: { symbole: '✕', titre: 'Trajectoires qui se croisent', couleur: 'conflit.croisement' },
  convergence: { symbole: '⋎', titre: 'Même sortie', couleur: 'conflit.convergence' },
  pieton: { symbole: 'P', titre: 'Traversée piétonne', couleur: 'conflit.pieton' },
  admis: { symbole: '✓', titre: 'Conflit admis', couleur: 'conflit.admis' },
}

const Case = chakra('button', {
  base: { w: 'full', h: 'full', fontWeight: 'bold', cursor: 'pointer', _hover: { filter: 'brightness(0.95)' }, focusVisibleRing: 'inside' },
})

interface Props {
  codes: string[]
  conflits: ConflitLignes[]
  onBasculerAdmis: (a: string, b: string) => void
}

/**
 * Matrice des conflits entre lignes : une case par paire. Cliquer une case en conflit la
 * marque « admise » (les deux lignes peuvent être au vert ensemble), ou annule l'admission.
 */
export function MatriceConflits({ codes, conflits, onBasculerAdmis }: Props) {
  const trouver = (a: string, b: string) => conflits.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a))

  return (
    <>
      <Table.Root variant="outline" width="auto" textAlign="center" css={{ '& th, & td': { w: '7', h: '26px', p: '0', textAlign: 'center' } }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader />
            {codes.map((code) => (
              <Table.ColumnHeader key={code} fontWeight="semibold" color="fg">
                {code}
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {codes.map((ligne) => (
            <Table.Row key={ligne}>
              <Table.ColumnHeader fontWeight="semibold" color="fg">
                {ligne}
              </Table.ColumnHeader>
              {codes.map((colonne) => {
                if (ligne === colonne) return <Table.Cell key={colonne} bg="bg.emphasized" />
                const conflit = trouver(ligne, colonne)
                if (!conflit) return <Table.Cell key={colonne} title="Compatibles" />
                const { symbole, titre, couleur } = SYMBOLES[conflit.admis ? 'admis' : conflit.nature]
                return (
                  <Table.Cell
                    key={colonne}
                    color={couleur}
                    style={{ background: `color-mix(in srgb, var(--chakra-colors-${couleur.replace('.', '-')}) 16%, transparent)` }}
                    title={`${SYMBOLES[conflit.nature].titre} : ${conflit.cause.join(' / ')}${conflit.admis ? ' — admis' : ''}. Cliquer pour ${conflit.admis ? 'annuler' : 'admettre'}.`}
                  >
                    <Case aria-label={titre} onClick={() => onBasculerAdmis(ligne, colonne)}>
                      {symbole}
                    </Case>
                  </Table.Cell>
                )
              })}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
      <Aide>✕ croisement · ⋎ même sortie · P piétons · ✓ conflit admis (vert simultané toléré)</Aide>
    </>
  )
}
