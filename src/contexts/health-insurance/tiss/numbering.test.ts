import { describe, expect, it } from 'vitest';

import {
  COUNTER_MAX_VALUE,
  TissNumberingError,
  formatTissNumber,
  sortForAllocation,
} from './numbering';

describe('numeração TISS (P7.1)', () => {
  it('formata com prefixo e largura, aceitando o bigint do driver como texto', () => {
    expect(formatTissNumber('guide', '42', { prefix: 'G', width: 7 })).toBe('G0000042');
    expect(formatTissNumber('batch', 7)).toBe('7');
    expect(formatTissNumber('transaction', 123, { width: 12 })).toBe('000000000123');
  });

  it('respeita os limites do XSD: lote e transação até 12, guia até 20; nunca trunca', () => {
    expect(formatTissNumber('batch', COUNTER_MAX_VALUE)).toBe('999999999999');
    expect(() => formatTissNumber('batch', 1, { prefix: 'L', width: 12 })).toThrow(
      TissNumberingError,
    );
    expect(formatTissNumber('guide', COUNTER_MAX_VALUE, { prefix: 'GUIA0000' })).toHaveLength(20);
    expect(() => formatTissNumber('guide', COUNTER_MAX_VALUE, { prefix: 'GUIA00000' })).toThrow(
      /até 20/u,
    );
  });

  it('recusa valor fora do contador e prefixo com símbolo', () => {
    for (const v of [0, -1, 1.5, COUNTER_MAX_VALUE + 1, 'abc']) {
      expect(() => formatTissNumber('guide', v)).toThrow(TissNumberingError);
    }
    expect(() => formatTissNumber('guide', 1, { prefix: 'g-' })).toThrow(/prefixo/u);
  });

  it('ordem canônica de alocação, sem repetição', () => {
    expect(sortForAllocation(['guide', 'transaction', 'batch', 'guide'])).toEqual([
      'transaction',
      'batch',
      'guide',
    ]);
  });
});
