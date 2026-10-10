import { messageEchec } from './file-ia.service.js';

describe('messageEchec', () => {
  it('should say that no answer in time is abnormal when every model timed out', () => {
    const message = messageEchec(
      [
        { modele: 'opus', statut: 'delai', erreur: "opus n'a pas répondu en 180 s" },
        { modele: 'sonnet', statut: 'delai', erreur: "sonnet n'a pas répondu en 180 s" },
      ],
      180,
    );
    expect(message).toMatch(/n'a pas répondu en 180 s \(opus, sonnet\)/);
    expect(message).toContain('anormal');
  });

  it('should list the error of each model otherwise', () => {
    expect(
      messageEchec(
        [
          { modele: 'opus', statut: 'delai', erreur: "opus n'a pas répondu en 180 s" },
          { modele: 'sonnet', statut: 'echec', erreur: 'Réponse hors schéma' },
        ],
        180,
      ),
    ).toBe("opus : opus n'a pas répondu en 180 s ; sonnet : Réponse hors schéma");
  });
});
