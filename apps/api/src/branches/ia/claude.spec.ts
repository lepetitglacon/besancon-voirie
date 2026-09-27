import { argumentsClaude, ErreurClaude, lireResultat } from './claude.js';

describe('argumentsClaude', () => {
  it('should restrict Claude to reading files in the working folder, with a JSON schema', () => {
    const args = argumentsClaude({ modele: 'opus', dossier: '/tmp/x', systeme: 'Tu…', schemaJson: '{}' });
    expect(args[0]).toBe('-p');
    expect(args).toEqual(expect.arrayContaining(['--json-schema', '{}', '--tools', 'Read', '--add-dir', '/tmp/x']));
    expect(args).toContain('--strict-mcp-config');
    // Pas d'argument positionnel : la consigne passe par l'entrée standard.
    expect(args.at(-1)).toBe('--disable-slash-commands');
  });
});

describe('lireResultat', () => {
  it('should return the structured output, model, duration and cost', () => {
    const brut = JSON.stringify({
      is_error: false,
      result: '{}',
      structured_output: { branches: [] },
      total_cost_usd: 0.0421,
      duration_ms: 64_300,
      modelUsage: { 'claude-opus-5': {} },
    });
    expect(lireResultat(brut)).toEqual({ sortie: { branches: [] }, modele: 'claude-opus-5', duree_s: 64, cout_usd: 0.0421 });
  });

  it('should fail when Claude gave no structured output', () => {
    expect(() => lireResultat(JSON.stringify({ is_error: true, result: 'Credit balance is too low' }))).toThrow(
      /Credit balance is too low/,
    );
    expect(() => lireResultat('pas du JSON')).toThrow(ErreurClaude);
  });
});
