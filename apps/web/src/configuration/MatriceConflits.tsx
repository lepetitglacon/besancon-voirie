import type { ConflitLignes } from '@voirie/engine'

const SYMBOLES: Record<ConflitLignes['nature'], { symbole: string; titre: string }> = {
  croisement: { symbole: '✕', titre: 'Trajectoires qui se croisent' },
  convergence: { symbole: '⋎', titre: 'Même sortie' },
  pieton: { symbole: 'P', titre: 'Traversée piétonne' },
}

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
      <table className="matrice">
        <thead>
          <tr>
            <th />
            {codes.map((code) => (
              <th key={code}>{code}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {codes.map((ligne) => (
            <tr key={ligne}>
              <th>{ligne}</th>
              {codes.map((colonne) => {
                if (ligne === colonne) return <td key={colonne} className="diagonale" />
                const conflit = trouver(ligne, colonne)
                if (!conflit) return <td key={colonne} title="Compatibles" />
                const { symbole, titre } = SYMBOLES[conflit.nature]
                return (
                  <td
                    key={colonne}
                    className={conflit.admis ? `conflit admis` : `conflit ${conflit.nature}`}
                    title={`${titre} : ${conflit.cause.join(' / ')}${conflit.admis ? ' — admis' : ''}. Cliquer pour ${conflit.admis ? 'annuler' : 'admettre'}.`}
                  >
                    <button onClick={() => onBasculerAdmis(ligne, colonne)}>{conflit.admis ? '✓' : symbole}</button>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="discret note-legende">
        ✕ croisement · ⋎ même sortie · P piétons · ✓ conflit admis (vert simultané toléré)
      </p>
    </>
  )
}
