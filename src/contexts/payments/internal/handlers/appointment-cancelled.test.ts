/**
 * Handler `scheduling.appointment.cancelled` → estorno/fim do link (1.5, ramo C).
 *
 * O que estes testes protegem é a FIAÇÃO, não a regra (essa é do
 * `charge-closeout.test.ts`): registro no evento certo, execução DETACHED (chamada
 * externa fora da TX do worker) e o instante do cancelamento chegando intacto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDetachedHandler: vi.fn(),
  registerHandler: vi.fn(),
  closeChargeForCancellation: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({
  registerDetachedHandler: mocks.registerDetachedHandler,
  registerHandler: mocks.registerHandler,
}));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { CANCELLED: 'scheduling.appointment.cancelled' },
}));
vi.mock('../charge-closeout', () => ({
  closeChargeForCancellation: mocks.closeChargeForCancellation,
}));

import { metrics } from '@/lib/observability/metrics';

import './appointment-cancelled';

// Capturado no LOAD do módulo: `clearAllMocks` apagaria o registro.
const registration = mocks.registerDetachedHandler.mock.calls[0]!;

type Handler = (ctx: { clinicId: string; payload: Record<string, unknown> }) => Promise<void>;
const handler = registration[1] as Handler;

const payload = (over: Record<string, unknown> = {}) => ({
  appointmentId: 'apt-1',
  clinicId: 'clinic-1',
  fromStatus: 'agendado',
  toStatus: 'cancelado',
  cancelReason: 'user',
  reason: null,
  cancelledAt: '2026-08-20T12:00:00.000Z',
  ...over,
});

beforeEach(() => {
  mocks.closeChargeForCancellation.mockClear();
  vi.mocked(metrics.emit).mockClear();
});

describe('handler de agendamento cancelado', () => {
  it('registra-se no evento de cancelamento do Scheduling', () => {
    expect(registration[0]).toBe('scheduling.appointment.cancelled');
  });

  it('é DETACHED: nunca chama o Asaas dentro da transação do worker', () => {
    expect(mocks.registerHandler).not.toHaveBeenCalled();
  });

  it('repassa o instante do cancelamento vindo do evento', async () => {
    await handler({ clinicId: 'clinic-1', payload: payload() });

    expect(mocks.closeChargeForCancellation).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      cancelReason: 'user',
      cancelledAt: new Date('2026-08-20T12:00:00.000Z'),
    });
  });

  it('evento antigo sem `cancelledAt` degrada para o relógio, com métrica', async () => {
    const before = Date.now();
    await handler({ clinicId: 'clinic-1', payload: payload({ cancelledAt: undefined }) });

    const arg = mocks.closeChargeForCancellation.mock.calls[0]![0] as { cancelledAt: Date };
    expect(arg.cancelledAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(
      vi
        .mocked(metrics.emit)
        .mock.calls.some((c) => c[0] === 'payments.deposit.cancel_without_timestamp'),
    ).toBe(true);
  });

  it('usa o clinicId do worker (contexto RLS), não o do payload', async () => {
    await handler({ clinicId: 'clinic-1', payload: payload({ clinicId: 'clinic-INTRUSA' }) });

    expect(mocks.closeChargeForCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'clinic-1' }),
    );
  });
});
