import { useQuery } from '@tanstack/react-query'
import type { NatureCarrefour } from '@voirie/schema'
import { api } from '../api'

export interface Edition {
  /** null pour un nouveau carrefour. */
  carrefourId: string | null
  selection: string[]
  nature: NatureCarrefour
  /** Nom saisi à la main ; tant qu'il est null, on affiche la suggestion. */
  nomSaisi: string | null
}

interface Props {
  edition: Edition
  enregistrement: { enCours: boolean; erreur: string | null }
  onChanger: (edition: Edition) => void
  onEnregistrer: (nom: string | null) => void
  onAnnuler: () => void
}

export function PanneauEdition({ edition, enregistrement, onChanger, onEnregistrer, onAnnuler }: Props) {
  const selectionTriee = [...edition.selection].sort()
  const suggestion = useQuery({
    queryKey: ['suggestion-nom', selectionTriee, edition.nature],
    queryFn: () => api.suggestionNom(selectionTriee, edition.nature),
    enabled: selectionTriee.length > 0 && edition.nomSaisi === null,
    staleTime: Infinity,
  })
  const nom = edition.nomSaisi ?? suggestion.data?.nom ?? ''

  return (
    <div className="edition">
      <h2>{edition.carrefourId ? 'Modifier le carrefour' : 'Composer un carrefour'}</h2>
      <p>
        Cliquez sur les feux qui partagent <strong>la même programmation</strong> (même contrôleur). Cliquez
        à nouveau pour retirer un feu.
      </p>
      <p>
        <strong>{edition.selection.length}</strong> feu(x) sélectionné(s)
      </p>

      <label>
        Nature
        <select
          value={edition.nature}
          onChange={(e) => onChanger({ ...edition, nature: e.target.value as NatureCarrefour })}
        >
          <option value="carrefour">Carrefour à feux</option>
          <option value="traversee_pietonne">Traversée piétonne à feux</option>
        </select>
      </label>

      <label>
        Nom
        <input
          value={nom}
          placeholder={edition.selection.length ? 'Recherche des rues…' : 'Sélectionnez des feux'}
          onChange={(e) => onChanger({ ...edition, nomSaisi: e.target.value })}
        />
      </label>
      {edition.nomSaisi !== null && (
        <button className="lien" onClick={() => onChanger({ ...edition, nomSaisi: null })}>
          Revenir au nom proposé
        </button>
      )}

      {enregistrement.erreur && <p className="etat-erreur">{enregistrement.erreur}</p>}

      <div className="actions">
        <button
          className="principal"
          disabled={edition.selection.length === 0 || enregistrement.enCours || nom.trim() === ''}
          onClick={() => onEnregistrer(edition.nomSaisi?.trim() || null)}
        >
          {enregistrement.enCours ? 'Enregistrement…' : 'Enregistrer'}
        </button>
        <button onClick={onAnnuler}>Annuler</button>
      </div>
    </div>
  )
}
