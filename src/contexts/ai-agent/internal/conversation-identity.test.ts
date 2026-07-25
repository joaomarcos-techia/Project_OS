import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { resolvePhoneIdentity } from './conversation';

describe('identidade de paciente por telefone compartilhado', () => {
  it('associa somente quando existe exatamente um paciente', () => {
    const only = { id: 'p1', nome: 'Maria' };
    expect(resolvePhoneIdentity([only])).toEqual({ patient: only, ambiguous: false });
  });

  it('falha fechado quando mais de um paciente usa o telefone', () => {
    expect(
      resolvePhoneIdentity([
        { id: 'p1', nome: 'Maria' },
        { id: 'p2', nome: 'João' },
      ]),
    ).toEqual({ patient: null, ambiguous: true });
  });

  it('não inventa paciente quando não há correspondência', () => {
    expect(resolvePhoneIdentity([])).toEqual({ patient: null, ambiguous: false });
  });

  it('consulta até dois pacientes e nunca usa LIMIT 1 no match do telefone', () => {
    const source = readFileSync(new URL('./conversation.ts', import.meta.url), 'utf8');
    const lookup = source.slice(
      source.indexOf('const patientMatches'),
      source.indexOf('// Conversa não-encerrada'),
    );
    expect(lookup).toContain('.limit(2)');
    expect(lookup).not.toContain('.limit(1)');
  });
});
