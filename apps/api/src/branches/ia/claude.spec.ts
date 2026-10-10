import { argumentsClaude, ErreurClaude, lireResultat, messageClaude } from './claude.js';

describe('argumentsClaude', () => {
  it('should run Claude without tools nor session, with a JSON schema and an effort level', () => {
    const args = argumentsClaude({ modele: 'opus', effort: 'medium', systeme: 'Tu…', schemaJson: '{}' });
    expect(args[0]).toBe('-p');
    expect(args).toEqual(expect.arrayContaining(['--json-schema', '{}', '--effort', 'medium', '--tools', '']));
    expect(args).toEqual(expect.arrayContaining(['--input-format', 'stream-json', '--output-format', 'stream-json']));
    expect(args).toContain('--strict-mcp-config');
    expect(args).toContain('--no-session-persistence');
    // Pas d'argument positionnel : le message passe par l'entrée standard.
    expect(args.at(-1)).toBe('--disable-slash-commands');
  });
});

describe('messageClaude', () => {
  it('should send the image before the instructions, in the first message', () => {
    const ligne = messageClaude({ consigne: 'Lis la photo', image: { donnees: Buffer.from('jpg'), type: 'image/jpeg' } });
    expect(ligne.endsWith('\n')).toBe(true);
    const { message } = JSON.parse(ligne);
    expect(message.content).toEqual([
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from('jpg').toString('base64') } },
      { type: 'text', text: 'Lis la photo' },
    ]);
  });
});

describe('lireResultat', () => {
  const flux = (resultat: object) =>
    [{ type: 'system', subtype: 'init' }, { type: 'assistant', message: {} }, { type: 'result', ...resultat }]
      .map((l) => JSON.stringify(l))
      .join('\n');

  it('should return the structured output, the model that read the photo, duration, cost and tokens', () => {
    const brut = flux({
      is_error: false,
      structured_output: { branches: [] },
      total_cost_usd: 0.0421,
      duration_ms: 64_300,
      modelUsage: {
        'claude-haiku-4-5': { inputTokens: 300, outputTokens: 20, costUSD: 0.001 },
        'claude-opus-5': { inputTokens: 10, cacheReadInputTokens: 7000, cacheCreationInputTokens: 2000, outputTokens: 5000, costUSD: 0.04 },
      },
    });
    expect(lireResultat(brut)).toEqual({
      sortie: { branches: [] },
      modele: 'claude-opus-5',
      duree_s: 64,
      cout_usd: 0.0421,
      tokens_entree: 9010,
      tokens_sortie: 5000,
    });
  });

  it('should fail when Claude gave no structured output', () => {
    expect(() => lireResultat(flux({ is_error: true, result: 'Credit balance is too low' }))).toThrow(/Credit balance is too low/);
    expect(() => lireResultat('pas du JSON')).toThrow(ErreurClaude);
  });
});
