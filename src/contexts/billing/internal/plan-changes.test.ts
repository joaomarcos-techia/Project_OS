import { describe, expect, it } from 'vitest';

import {
  calculateUpgradeProration,
  changeIdFromExternalReference,
  comparePlans,
  nextPeriodEnd,
  planChangeExternalReference,
} from './plan-changes';

describe('plan changes', () => {
  it('ordena os três planos suportados', () => {
    expect(comparePlans('solo', 'clinica')).toBe(1);
    expect(comparePlans('pro', 'clinica')).toBe(-1);
    expect(comparePlans('clinica', 'clinica')).toBe(0);
  });

  it('calcula o rateio do upgrade apenas para a fração restante do ciclo', () => {
    const start = new Date('2026-08-01T00:00:00.000Z');
    const end = new Date('2026-08-31T00:00:00.000Z');
    const halfway = new Date('2026-08-16T00:00:00.000Z');

    expect(calculateUpgradeProration('100.00', '160.00', start, end, halfway)).toBe(3000);
    expect(calculateUpgradeProration('100.00', '160.00', start, end, end)).toBe(0);
  });

  it('aceita apenas referências de alteração de plano com UUID válido', () => {
    const id = '00000000-0000-0000-0000-000000000001';
    expect(changeIdFromExternalReference(planChangeExternalReference(id))).toBe(id);
    expect(changeIdFromExternalReference('other:00000000-0000-0000-0000-000000000001')).toBeNull();
  });

  it('calcula o término da reativação sem ultrapassar o último dia do mês', () => {
    expect(nextPeriodEnd(new Date('2026-01-31T12:00:00.000Z'), 'monthly').toISOString()).toBe(
      '2026-02-28T12:00:00.000Z',
    );
    expect(nextPeriodEnd(new Date('2026-02-28T12:00:00.000Z'), 'annual').toISOString()).toBe(
      '2027-02-28T12:00:00.000Z',
    );
  });
});
