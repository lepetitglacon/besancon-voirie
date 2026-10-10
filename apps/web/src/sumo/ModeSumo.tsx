import { useQuery } from '@tanstack/react-query'
import type { LancerEssaiSumo } from '@voirie/schema'
import { Box } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { api } from '../api'
import { Aide, Message } from '../ds'
import { CarteEssais } from './CarteEssais'
import { CarteIndicateurs } from './CarteIndicateurs'
import { etatSumo, useDonneesEssai, useEtatSumo } from './etat'
import { FormulaireLancement } from './FormulaireLancement'
import { useLancementSumo } from './lancement'
import { SuiviLancement } from './SuiviLancement'
import { Timeline } from './Timeline'

/** Réglages des essais lancés par `simuler.sh` (décisions S10 et S11). */
const SCENARIO_PROJET: LancerEssaiSumo['scenario'] = {
  graine: 42,
  volume: 100,
  retourSoir: true,
  midi: 20,
  flux: [],
  feux: 'coordonnes',
  itineraire: 'depart',
  periodeReacheminement: 120,
}

/** Heure affichée à l'ouverture d'un essai : la pointe du matin. */
const HEURE_OUVERTURE = 8 * 3600

/** Largeurs des cartes latérales : la timeline prend la place entre les deux. */
const GAUCHE = '340px'
/** Le formulaire de lancement a besoin de place. */
const GAUCHE_FORMULAIRE = '440px'
const DROITE = '340px'
/** Les contrôles de la carte (zoom, calques) occupent le bord droit. */
const MARGE_DROITE = '64px'

/**
 * Mode SUMO : essais à gauche, indicateurs et fiche du tronçon à droite, timeline en bas. La couche
 * de la carte est `CoucheSumo`, rendue dans la carte ; les deux partagent `etatSumo`.
 */
export function ModeSumo() {
  const essais = useQuery({ queryKey: ['sumo-essais'], queryFn: api.essaisSumo })
  const essaiId = useEtatSumo((e) => e.essaiId)
  const { essai, troncons, series, vehicules, chargementVehicules, chargement, erreur } = useDonneesEssai()
  const { lancement, actif } = useLancementSumo()
  /** Formulaire ouvert, avec ses réglages de départ (null : par défaut). */
  const [formulaire, setFormulaire] = useState<{ depart: LancerEssaiSumo | null } | null>(null)
  /** Lancement terminé dont l'utilisateur a masqué le suivi. */
  const [masque, setMasque] = useState<string | null>(null)

  // Par défaut, le plus récent ; un essai disparu est oublié.
  useEffect(() => {
    if (!essais.data) return
    if (essaiId === null || !essais.data.some((e) => e.id === essaiId)) {
      etatSumo.modifier({ essaiId: essais.data[0]?.id ?? null, troncon: null })
    }
  }, [essais.data, essaiId])

  // Nouvel essai : la pointe du matin, à l'arrêt.
  useEffect(() => {
    if (essai) etatSumo.modifier({ temps: Math.max(essai.debut, Math.min(HEURE_OUVERTURE, essai.fin)), lecture: false })
  }, [essai])

  return (
    <>
      <CarteEssais
        position="fixed"
        top="3"
        left="3"
        zIndex="2"
        w={formulaire ? GAUCHE_FORMULAIRE : GAUCHE}
        maxW="calc(100vw - 24px)"
        maxH="calc(100vh - 24px)"
        // Le formulaire occupe toute la hauteur et défile à l'intérieur.
        bottom={formulaire ? '3' : undefined}
        essais={essais.data}
        erreur={essais.error}
        choisi={essaiId}
        onChoisir={(id) => etatSumo.modifier({ essaiId: id, troncon: null, vehicule: null, suivre: false })}
        onNouvel={(depuis) =>
          setFormulaire({
            depart:
              depuis && essai?.id === depuis
                ? (essai.parametres ?? {
                    nom: essai.nom,
                    description: essai.description,
                    scenario: SCENARIO_PROJET,
                    options: {},
                  })
                : null,
          })
        }
        suivi={
          lancement &&
          lancement.id !== masque && (
            <SuiviLancement lancement={lancement} onFermer={() => setMasque(lancement.id)} />
          )
        }
        formulaire={
          formulaire && (
            <FormulaireLancement
              depart={formulaire.depart}
              occupe={actif}
              onLance={() => setFormulaire(null)}
              onAnnuler={() => setFormulaire(null)}
            />
          )
        }
      />
      <CarteIndicateurs
        position="fixed"
        top="3"
        right={MARGE_DROITE}
        zIndex="2"
        w={DROITE}
        maxH="calc(100vh - 24px)"
        essai={essai}
        troncons={troncons?.features.map((f) => f.properties)}
        series={series}
        vehicules={vehicules}
        chargementVehicules={chargementVehicules}
      />
      <Box
        position="fixed"
        bottom="3"
        left={`calc(${formulaire ? GAUCHE_FORMULAIRE : GAUCHE} + 24px)`}
        right={`calc(${DROITE} + ${MARGE_DROITE} + 12px)`}
        zIndex="2"
      >
        {essai ? (
          <Timeline essai={essai} maxW="880px" mx="auto" />
        ) : (
          (chargement || erreur) && (
            <Box bg="bg.panel" borderRadius="l3" boxShadow="carte" p="10px 14px" maxW="880px" mx="auto">
              {erreur ? <Message ton="erreur">{erreur.message}</Message> : <Aide>Chargement de l'essai…</Aide>}
            </Box>
          )
        )}
      </Box>
    </>
  )
}
