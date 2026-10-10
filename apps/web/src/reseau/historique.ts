/**
 * Annuler et refaire les modifications du réseau de la session (Ctrl Z, Ctrl Maj Z) :
 * docs/pipeline-donnees.md, étape 2. Chaque modification enregistrée par l'API laisse ici de
 * quoi la défaire (la requête inverse) et la refaire.
 */
import { useRef, useState } from 'react'

export interface Operation {
  /** « Voies du tronçon », « Nœud déplacé »… : ce que dit la notification. */
  libelle: string
  annuler: () => Promise<unknown>
  refaire: () => Promise<unknown>
}

/** Au-delà, les plus anciennes modifications ne s'annulent plus. */
const PROFONDEUR = 100

export function useHistorique() {
  const passe = useRef<Operation[]>([])
  const futur = useRef<Operation[]>([])
  // Les piles vivent hors du rendu ; leurs tailles, en état, redessinent les boutons quand elles changent.
  const [tailles, setTailles] = useState({ passe: 0, futur: 0 })
  const publier = () => setTailles({ passe: passe.current.length, futur: futur.current.length })
  const enCours = useRef(false)

  /** Une modification vient d'aboutir : elle s'annule ; ce qui avait été annulé ne se refait plus. */
  const enregistrer = (operation: Operation) => {
    if (enCours.current) return
    passe.current = [...passe.current.slice(-(PROFONDEUR - 1)), operation]
    futur.current = []
    publier()
  }

  /** Déplace la dernière opération d'une pile à l'autre après l'avoir jouée ; undefined s'il n'y a rien. */
  const rejouer = async (depuis: typeof passe, vers: typeof passe, jouer: (o: Operation) => Promise<unknown>): Promise<Operation | undefined> => {
    const operation = depuis.current.at(-1)
    if (!operation || enCours.current) return undefined
    enCours.current = true
    try {
      await jouer(operation)
      depuis.current = depuis.current.slice(0, -1)
      vers.current = [...vers.current, operation]
      return operation
    } finally {
      enCours.current = false
      publier()
    }
  }

  return {
    enregistrer,
    annuler: () => rejouer(passe, futur, (o) => o.annuler()),
    refaire: () => rejouer(futur, passe, (o) => o.refaire()),
    /** Une modification qui ne s'annule pas (suppression) : les précédentes pourraient viser ce qu'elle a retiré. */
    vider: () => {
      passe.current = []
      futur.current = []
      publier()
    },
    peutAnnuler: tailles.passe > 0,
    peutRefaire: tailles.futur > 0,
  }
}
