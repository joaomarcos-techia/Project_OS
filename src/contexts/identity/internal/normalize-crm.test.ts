import { describe, expect, it } from 'vitest';

import { normalizeCrm, normalizeCrmUf } from './normalize-crm';

describe('normalizeCrm (ADR-032 §5 — protege o UNIQUE)', () => {
  it('mantém um CRM já limpo', () => {
    expect(normalizeCrm('12345')).toBe('12345');
  });

  it('remove espaços nas bordas', () => {
    expect(normalizeCrm('  12345  ')).toBe('12345');
  });

  it('remove espaços internos (o caso que o UNIQUE não pegaria)', () => {
    expect(normalizeCrm('12 345')).toBe('12345');
  });

  it('uppercase para formatos com letra', () => {
    expect(normalizeCrm('crm123')).toBe('CRM123');
  });

  it('string vazia / só espaços → null', () => {
    expect(normalizeCrm('')).toBeNull();
    expect(normalizeCrm('   ')).toBeNull();
  });

  it('null/undefined → null', () => {
    expect(normalizeCrm(null)).toBeNull();
    expect(normalizeCrm(undefined)).toBeNull();
  });
});

describe('normalizeCrmUf', () => {
  it('uppercase + trim', () => {
    expect(normalizeCrmUf(' sp ')).toBe('SP');
    expect(normalizeCrmUf('rj')).toBe('RJ');
  });

  it('vazio/null → null', () => {
    expect(normalizeCrmUf('')).toBeNull();
    expect(normalizeCrmUf(null)).toBeNull();
  });
});
