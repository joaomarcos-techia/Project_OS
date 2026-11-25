import { describe, expect, it } from 'vitest';

import { maskValues } from './xsd-validator';

describe('maskValues', () => {
  it('nenhum valor de campo sai do validador XSD; o elemento e a regra ficam', () => {
    const facet = maskValues(
      "Element '{http://www.ans.gov.br/padroes/tiss/schemas}nomeBeneficiario': [facet 'maxLength'] The value 'MARIA DA SILVA SAURO' has a length of 70",
    );
    expect(facet).not.toContain('MARIA');
    expect(facet).toContain('nomeBeneficiario');
    expect(facet).toContain("[facet 'maxLength'] The value '…'");
    const atomic = maskValues(
      "Element '{http://www.ans.gov.br/padroes/tiss/schemas}numeroCarteira': '0081234500012345X' is not a valid value of the atomic type 'st_texto20'.",
    );
    expect(atomic).not.toContain('0081234500012345');
    expect(atomic).toContain("numeroCarteira': '…' is not a valid value of the atomic type 'st_texto20'");
    expect(maskValues('valor "0081234500012345" inválido')).toBe('valor "…" inválido');
  });

  it('normaliza espaços e corta em 240 caracteres', () => {
    expect(maskValues(`a\n\n  b ${'x'.repeat(400)}`).length).toBe(240);
    expect(maskValues('a\n\n  b')).toBe('a b');
  });
});
