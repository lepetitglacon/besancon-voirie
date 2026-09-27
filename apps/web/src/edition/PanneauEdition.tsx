import { Button, Field, Heading, HStack, Input, Kbd, Stack, Text } from '@chakra-ui/react'
import { useQuery } from '@tanstack/react-query'
import type { NatureCarrefour } from '@voirie/schema'
import { api } from '../api'
import { Aide, Message, Selecteur } from '../ds'

export interface Edition {
  /** null pour un nouveau carrefour. */
  carrefourId: string | null
  selection: string[]
  nature: NatureCarrefour
  /** Nom saisi à la main ; tant qu'il est null, on affiche la suggestion. */
  nomSaisi: string | null
  /** Glisser trace un rectangle de sélection au lieu de déplacer la carte. */
  modeRectangle: boolean
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
    <Stack gap="3">
      <Heading as="h2" textStyle="lg" fontWeight="semibold">
        {edition.carrefourId ? 'Modifier le carrefour' : 'Composer un carrefour'}
      </Heading>
      <Aide>
        Sélectionnez les feux qui partagent <strong>la même programmation</strong> (même contrôleur) : un clic
        ajoute ou retire un feu, un rectangle ajoute tous les feux qu'il couvre (<Kbd>Maj</Kbd> + glisser).
      </Aide>
      <HStack gap="1.5">
        <Button
          variant={edition.modeRectangle ? 'subtle' : 'outline'}
          aria-pressed={edition.modeRectangle}
          onClick={() => onChanger({ ...edition, modeRectangle: !edition.modeRectangle })}
        >
          ▭ Rectangle
        </Button>
        <Button disabled={edition.selection.length === 0} onClick={() => onChanger({ ...edition, selection: [] })}>
          Vider
        </Button>
        <Text ms="auto">
          <strong>{edition.selection.length}</strong> feu(x) sélectionné(s)
        </Text>
      </HStack>

      <Field.Root>
        <Field.Label>Nature</Field.Label>
        <Selecteur
          width="full"
          valeur={edition.nature}
          onChange={(valeur) => onChanger({ ...edition, nature: valeur as NatureCarrefour })}
        >
          <option value="carrefour">Carrefour à feux</option>
          <option value="traversee_pietonne">Traversée piétonne à feux</option>
        </Selecteur>
      </Field.Root>

      <Field.Root>
        <Field.Label>Nom</Field.Label>
        <Input
          value={nom}
          placeholder={edition.selection.length ? 'Recherche des rues…' : 'Sélectionnez des feux'}
          onChange={(e) => onChanger({ ...edition, nomSaisi: e.target.value })}
        />
        {edition.nomSaisi !== null && (
          <Button variant="lien" size="xs" onClick={() => onChanger({ ...edition, nomSaisi: null })}>
            Revenir au nom proposé
          </Button>
        )}
      </Field.Root>

      {enregistrement.erreur && <Message ton="erreur">{enregistrement.erreur}</Message>}

      <HStack gap="1.5" justify="end">
        <Button variant="ghost" onClick={onAnnuler}>
          Annuler
        </Button>
        <Button
          variant="solid"
          loading={enregistrement.enCours}
          loadingText="Enregistrement…"
          disabled={edition.selection.length === 0 || nom.trim() === ''}
          onClick={() => onEnregistrer(edition.nomSaisi?.trim() || null)}
        >
          Enregistrer
        </Button>
      </HStack>
    </Stack>
  )
}
