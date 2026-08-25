/**
 * Handler `payments.patient_charge.closed` → projeção do desfecho na agenda.
 *
 * O que se prova aqui: o mapeamento desfecho → coluna, e que a projeção é
 * MONOTÔNICA — só age quando a coluna ainda está no estado de origem esperado.
 * Sem isso, um evento reentregue fora de ordem sobrescreveria um desfecho mais
 * recente, e o `hold_expires_at` esquecido violaria o CHECK da 0085.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  set: vi.fn(),
  where: vi.fn(),
  returning: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CHARGE_CLOSED: 'payments.patient_charge.closed' },
}));
vi.mock('../../schema', () => ({
  appointments: {
    id: 'appointments.id',
    clinicId: 'appointments.clinic_id',
    depositStatus: 'appointments.deposit_status',
  },
}));
vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (col: unknown, val: unknown) => ({ eq: [col, val] }),
  sql: Object.assign(() => 'NOW', { raw: () => 'NOW' }),
}));

import { metrics } from '@/lib/observability/metrics';

import './patient-charge-closed';

const registration = mocks.registerHandler.mock.calls[0]!;
type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = registration[1] as Handler;

const tx = {
  update: () => ({
    set: (values: unknown) => {
      mocks.set(values);
      return {
        where: (cond: unknown) => {
          mocks.where(cond);
          return { returning: () => mocks.returning() };
        },
      };
    },
  }),
};

const payload = (over: Record<string, unknown> = {}) => ({
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  kind: 'deposit',
  outcome: 'refunded',
  amount: 150,
  closedAt: '2026-08-20T12:00:00.000Z',
  ...over,
});

const run = (over: Record<string, unknown> = {}) =>
  handler({ tx, clinicId: 'clinic-1', payload: payload(over), eventId: 'evt-1' });

/** Estado de ORIGEM exigido no WHERE — é ele que torna a projeção monotônica. */
const sourceInWhere = (): unknown =>
  (mocks.where.mock.calls[0]![0] as { and: Array<{ eq: unknown[] }> }).and[2]!.eq[1];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.returning.mockResolvedValue([{ id: 'apt-1' }]);
});

describe('projeção do fechamento da cobrança', () => {
  it('registra-se no evento público do Payments', () => {
    expect(registration[0]).toBe('payments.patient_charge.closed');
  });

  it.each([
    ['refunded', 'refunded', 'paid'],
    ['expired', 'expired', 'pending'],
    // Nunca houve dinheiro ⇒ do ponto de vista da AGENDA não há hold (0085).
    ['cancelled', 'none', 'pending'],
  ])('desfecho %s → deposit_status %s, saindo de %s', async (outcome, target, source) => {
    await run({ outcome });

    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ depositStatus: target }));
    expect(sourceInWhere()).toBe(source);
  });

  it('sempre limpa o prazo do hold (o CHECK da 0085 rejeitaria o contrário)', async () => {
    await run({ outcome: 'expired' });

    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ holdExpiresAt: null }));
  });

  it('cobrança do RESTANTE não mexe na coluna do hold', async () => {
    await run({ kind: 'remainder' });

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('reentrega que não acha o estado de origem é no-op com métrica, não erro', async () => {
    mocks.returning.mockResolvedValue([]);

    await expect(run()).resolves.toBeUndefined();
    expect(
      vi.mocked(metrics.emit).mock.calls.some((c) => c[0] === 'scheduling.deposit.close_noop'),
    ).toBe(true);
  });

  it('no-op de `expired` NÃO emite métrica: a varredura já projetou, é o caminho normal', async () => {
    mocks.returning.mockResolvedValue([]);

    await run({ outcome: 'expired' });

    expect(
      vi.mocked(metrics.emit).mock.calls.some((c) => c[0] === 'scheduling.deposit.close_noop'),
    ).toBe(false);
  });

  it('escreve sempre com o clinicId do worker no WHERE (isolamento de tenant)', async () => {
    await run({ clinicId: 'clinic-INTRUSA' });

    const cond = mocks.where.mock.calls[0]![0] as { and: Array<{ eq: unknown[] }> };
    expect(cond.and[1]!.eq[1]).toBe('clinic-1');
  });
});
