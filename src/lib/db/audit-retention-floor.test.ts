import { describe, expect, it } from 'vitest';

import { AUDIT_TRAIL_MIN_RETAIN_MONTHS, assertAuditRetainMonths } from './audit-retention-floor';

describe('piso de retenção da trilha (S5)', () => {
  it('0 = só provisiona; 6 ou mais = permitido', () => {
    for (const n of [0, 6, 7, 24, 60]) expect(() => assertAuditRetainMonths(n)).not.toThrow();
    expect(AUDIT_TRAIL_MIN_RETAIN_MONTHS).toBe(6);
  });

  it('abaixo de 6 meses, fracionário, negativo ou inválido: recusado', () => {
    for (const n of [1, 3, 5, 5.5, -1, Number.NaN, 6.5])
      expect(() => assertAuditRetainMonths(n)).toThrow(/recusado/u);
  });
});
