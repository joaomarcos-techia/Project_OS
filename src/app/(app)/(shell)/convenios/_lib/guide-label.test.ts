import { describe, expect, it } from 'vitest';

import { guideLabel, guideShortLabel } from './guide-label';

describe('rótulo de guia (decisão de UX de 14/11)', () => {
  it('forma longa por tipo, com o número como gravado', () => {
    expect(guideLabel('consulta', '1')).toBe('Guia de consulta nº 1');
    expect(guideLabel('sp_sadt', '0042')).toBe('Guia de SP/SADT nº 0042');
  });

  it('nunca "Consulta 1" sozinho; tipo desconhecido não inventa nome', () => {
    expect(guideLabel('consulta', '7')).not.toMatch(/^Consulta \d/u);
    expect(guideLabel(null, '7')).toBe('Guia nº 7');
    expect(guideLabel('outro', '7')).toBe('Guia nº 7');
  });

  it('no meio da frase e na forma curta', () => {
    expect(`Valor pago na ${guideLabel('consulta', '3', { lowercase: true })}`).toBe(
      'Valor pago na guia de consulta nº 3',
    );
    expect(guideShortLabel('003')).toBe('nº 003');
  });
});
