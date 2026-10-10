/**
 * Le focus est dans un champ de saisie, ou dans une fenêtre modale (l'éditeur Streetmix…) : les
 * raccourcis de la carte ne doivent pas s'y déclencher.
 */
export const dansUnChamp = (cible: EventTarget | null) =>
  cible instanceof HTMLElement &&
  (cible.isContentEditable ||
    ['TEXTAREA', 'SELECT'].includes(cible.tagName) ||
    // Une case à cocher ou un bouton radio ne saisit pas de texte : les raccourcis y restent actifs.
    (cible instanceof HTMLInputElement && !['checkbox', 'radio', 'button'].includes(cible.type)) ||
    cible.closest('[role="dialog"][aria-modal="true"]') !== null)
