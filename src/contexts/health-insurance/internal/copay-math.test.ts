import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: vi.fn() }));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { INSURANCE_COMPLETED: 'scheduling.appointment.insurance_completed' },
}));

import { calculatedCopayCents } from './copay-service';
import { expectedCopayCents } from './coverage-service';
import { dateInTimezone } from './handlers/insurance-completed';

describe('coparticipação: previsto e calculado em centavos inteiros', () => {
  it('percentual sobre o valor do contrato, meio para cima, sem ponto flutuante', () => {
    expect(
      expectedCopayCents(
        { copayKind: 'percentage', copayFixedCents: null, copayPercentage: '30' },
        15000,
      ),
    ).toBe(4500);
    expect(
      expectedCopayCents(
        { copayKind: 'percentage', copayFixedCents: null, copayPercentage: '12.5' },
        333,
      ),
    ).toBe(42);
    expect(
      expectedCopayCents(
        { copayKind: 'percentage', copayFixedCents: null, copayPercentage: '33.33' },
        10001,
      ),
    ).toBe(3333);
  });

  it('fixo nunca passa do valor do procedimento; sem coparticipação não estima', () => {
    expect(
      expectedCopayCents(
        { copayKind: 'fixed', copayFixedCents: 2000, copayPercentage: null },
        22000,
      ),
    ).toBe(2000);
    expect(
      expectedCopayCents(
        { copayKind: 'fixed', copayFixedCents: 5000, copayPercentage: null },
        3000,
      ),
    ).toBe(3000);
    expect(
      expectedCopayCents(
        { copayKind: 'none', copayFixedCents: null, copayPercentage: null },
        15000,
      ),
    ).toBeNull();
  });

  it('calculado na conclusão: percentual sobre o total da guia; fixo limitado ao total', () => {
    expect(
      calculatedCopayCents({ kind: 'percentage', percentage: '30.00', expectedCents: 4500 }, 15000),
    ).toBe(4500);
    expect(
      calculatedCopayCents({ kind: 'percentage', percentage: '30.00', expectedCents: 4500 }, 12000),
    ).toBe(3600);
    expect(
      calculatedCopayCents({ kind: 'fixed', percentage: null, expectedCents: 2000 }, 1500),
    ).toBe(1500);
  });
});

describe('data do atendimento no fuso da clínica', () => {
  it('um atendimento às 01:30 UTC ainda é o dia anterior em São Paulo', () => {
    expect(dateInTimezone('2026-11-12T01:30:00.000Z', 'America/Sao_Paulo')).toBe('2026-11-11');
    expect(dateInTimezone('2026-11-12T13:00:00.000Z', 'America/Sao_Paulo')).toBe('2026-11-12');
  });
});
