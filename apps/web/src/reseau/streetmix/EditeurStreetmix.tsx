/**
 * Encart de l'éditeur Streetmix : profil en travers théorique d'un tronçon, vu dans son sens du
 * tracé. À l'enregistrement, la rue et son PNG partent dans l'API, ramenés au sens de référence du
 * profil (docs/integration-streetmix.md).
 */
import { Box, Button, CloseButton, Code, Dialog, HStack, Input, Portal, Spinner, Stack, Text } from '@chakra-ui/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { miroirRue } from '@voirie/engine'
import type { ProfilTroncon, RueStreetmix } from '@voirie/schema'
import { useEffect, useEffectEvent, useState } from 'react'
import { api, type Troncon } from '../../api'
import { Case, Message, notifications } from '../../ds'
import { URL_STREETMIX } from './protocole'
import { useEditeurStreetmix } from './useEditeurStreetmix'

interface Props {
  troncon: Troncon
  donnees: ProfilTroncon
  onFermer: () => void
}

/** La rue brouillon de l'instance Streetmix n'a rien à faire dans notre base. */
function sansIdentite({ id: _id, namespacedId: _numero, ...rue }: RueStreetmix): RueStreetmix {
  return rue as RueStreetmix
}

export function EditeurStreetmix({ troncon, donnees, onFermer }: Props) {
  const url = `${URL_STREETMIX}/new?type=empty`
  const { iframe, etat, modifie, charger, exporter } = useEditeurStreetmix(url)
  const queryClient = useQueryClient()
  const { profil, inverse, voisins } = donnees
  const nomRue = troncon.properties.nom
  const [nom, setNom] = useState(profil?.nom ?? nomRue ?? '')
  const [avecVoisins, setAvecVoisins] = useState(!profil && voisins.length > 0)
  const [charge, setCharge] = useState(false)

  // Rue montrée dans le sens du tronçon : celle du profil (retournée s'il la lit depuis l'autre bout), sinon l'estimée.
  const chargerRue = useEffectEvent(() => {
    const vue = profil ? (inverse ? miroirRue(profil.rue) : profil.rue) : donnees.estime
    charger(vue, nomRue)
      .then(() => setCharge(true))
      .catch((erreur: Error) => notifications.create({ type: 'error', title: 'Profil non chargé dans Streetmix', description: erreur.message }))
  })
  // Chargée une fois, quand l'éditeur est prêt.
  useEffect(() => {
    if (etat === 'pret') chargerRue()
  }, [etat])

  const enregistrement = useMutation({
    mutationFn: async () => {
      const vue = await exporter()
      // Ramenée au sens de référence du profil ; son PNG aussi, redessiné dans ce sens.
      const reference = sansIdentite(profil && inverse ? miroirRue(vue.rue) : vue.rue)
      let image = vue.image
      if (profil && inverse) {
        await charger(reference, nomRue)
        image = (await exporter()).image
      }
      const nomProfil = nom.trim() || null
      if (!profil) {
        return api.creerProfil(
          { nom: nomProfil, rue: reference, troncons: [{ id: troncon.id, inverse: false }, ...(avecVoisins ? voisins : [])] },
          image,
        )
      }
      // Voisins orientés par rapport à ce tronçon, qui lui-même lit le profil à l'envers si `inverse`.
      const rattaches = avecVoisins ? voisins.map((v) => ({ id: v.id, inverse: v.inverse !== inverse })) : []
      return api.modifierProfil(profil.id, { nom: nomProfil, rue: reference, troncons: rattaches }, image)
    },
    onSuccess: async () => {
      await Promise.all(['profil-troncon', 'reseau'].map((cle) => queryClient.invalidateQueries({ queryKey: [cle] })))
      notifications.create({ type: 'success', title: 'Profil enregistré' })
      onFermer()
    },
    onError: (erreur: Error) => notifications.create({ type: 'error', title: 'Profil non enregistré', description: erreur.message }),
  })

  const fermer = () => {
    if (enregistrement.isPending) return
    if (modifie && !window.confirm('Fermer sans enregistrer le profil ?')) return
    onFermer()
  }

  return (
    <Dialog.Root open size="cover" closeOnInteractOutside={false} onOpenChange={(e) => !e.open && fermer()}>
      <Portal>
        <Dialog.Backdrop />
        <Dialog.Positioner>
          <Dialog.Content>
            <Dialog.Header flexDirection="column" alignItems="start" gap="0.5">
              <Dialog.Title>Profil en travers · {nomRue ?? 'rue sans nom'}</Dialog.Title>
              <Text textStyle="xs" color="fg.muted">
                Vu depuis le début du tronçon, dans le sens du tracé (&gt;) : à droite, les voies qui s’éloignent.
                {profil && ` Profil suivi par ${profil.troncons} tronçon(s) : le modifier les change tous.`}
              </Text>
            </Dialog.Header>
            <Dialog.Body display="flex" p="0">
              <Box position="relative" flex="1" minH="60vh" borderTopWidth="1px" borderBottomWidth="1px">
                <iframe
                  ref={iframe}
                  src={url}
                  title="Éditeur Streetmix"
                  style={{ border: 0, width: '100%', height: '100%', position: 'absolute', inset: 0 }}
                />
                {(etat !== 'pret' || !charge) && (
                  <Stack position="absolute" inset="0" align="center" justify="center" bg="bg/80" gap="2" textAlign="center" p="4">
                    {etat === 'chargement' || (etat === 'pret' && !charge) ? (
                      <HStack>
                        <Spinner size="sm" />
                        <Text textStyle="sm">Ouverture de Streetmix…</Text>
                      </HStack>
                    ) : etat === 'injoignable' ? (
                      <>
                        <Message ton="erreur">Streetmix ne répond pas sur {URL_STREETMIX}.</Message>
                        <Text textStyle="sm">
                          Lancer l’instance locale : <Code>pnpm streetmix:up</Code>, puis rouvrir l’éditeur.
                        </Text>
                      </>
                    ) : (
                      <Message ton="erreur">Version de Streetmix incompatible : reconstruire l’image (pnpm streetmix:build).</Message>
                    )}
                  </Stack>
                )}
              </Box>
            </Dialog.Body>
            <Dialog.Footer gap="3" flexWrap="wrap">
              <Input size="sm" maxW="72" placeholder="Nom du profil" aria-label="Nom du profil" value={nom} onChange={(e) => setNom(e.target.value)} />
              {voisins.length > 0 && (
                <Case size="sm" coche={avecVoisins} onChange={setAvecVoisins}>
                  Appliquer aussi aux {voisins.length} tronçon(s) voisin(s) de « {nomRue} »
                </Case>
              )}
              <Box flex="1" />
              <Button variant="ghost" onClick={fermer} disabled={enregistrement.isPending}>
                Annuler
              </Button>
              <Button
                colorPalette="blue"
                loading={enregistrement.isPending}
                disabled={etat !== 'pret' || !charge}
                onClick={() => enregistrement.mutate()}
              >
                Enregistrer
              </Button>
            </Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <CloseButton size="sm" />
            </Dialog.CloseTrigger>
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  )
}
