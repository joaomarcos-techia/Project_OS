/**
 * Handler `payments.patient_charge.paid` → confirma o agendamento (ADR-049 1.4).
 *
 * O caso que este arquivo existe para travar é o do **pagamento sobre agendamento
 * que já não está `agendado`** — o paciente paga o link minutos depois de a
 * secretária cancelar, ou depois de o hold expirar. A regra: registra o pagamento
 * (o dinheiro entrou), mas NÃO ressuscita a vaga. Forçar `confirmado` a partir de
 * `cancelado` devolveria ao paciente um horário que a clínica já deu a outra
 * pessoa.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  applyTransition: vi.fn(),
  select: vi.fn(),
  update: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('../appointment-core', () => ({ applyTransition: mocks.applyTransition }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CHARGE_PAID: 'payments.patient_charge.paid' },
}));

import { metrics } from '@/lib/observability/metrics';

import './patient-charge-paid';

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;

// Capturado no load do módulo: `clearAllMocks` no beforeEach apagaria o registro,
// que acontece uma única vez, no import.
const registered = mocks.registerHandler.mock.calls[0]!;
const handler = () => registered[1] as Handler;

function txWith(status: string | null) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (status === null ? [] : [{ status }]) }),
      }),
    }),
    update: () => ({ set: () => ({ where: mocks.update }) }),
  };
}

const payload = (over: Record<string, unknown> = {}) => ({
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  patientId: 'pac-1',
  kind: 'deposit',
  amount: 150,
  paidAt: '2026-09-01T12:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.update.mockResolvedValue(undefined);
  mocks.applyTransition.mockResolvedValue({ id: 'apt-1' });
});

describe('handler de sinal pago', () => {
  it('registra-se para o evento público do Payments', () => {
    expect(registered[0]).toBe('payments.patient_charge.paid');
  });

  it('confirma pela máquina de estados congelada', async () => {
    await handler()({
      tx: txWith('agendado'),
      clinicId: 'clinic-1',
      payload: payload(),
      eventId: 'evt-1',
    });

    expect(mocks.applyTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        target: 'confirmado',
        actorType: 'system',
        clientKey: 'deposit-paid:charge-1',
      }),
    );
  });

  it('pagamento sobre agendamento CANCELADO não ressuscita a vaga', async () => {
    await handler()({
      tx: txWith('cancelado'),
      clinicId: 'clinic-1',
      payload: payload(),
      eventId: 'evt-1',
    });

    expect(mocks.applyTransition).not.toHaveBeenCalled();
    expect(metrics.emit).toHaveBeenCalledWith(
      'scheduling.deposit.paid_on_inactive_appointment',
      expect.objectContaining({ status: 'cancelado' }),
    );
  });

  it('mesmo sem confirmar, registra que o sinal foi pago', async () => {
    await handler()({
      tx: txWith('faltou'),
      clinicId: 'clinic-1',
      payload: payload(),
      eventId: 'evt-1',
    });

    // O UPDATE de deposit_status roda antes da decisão de transição.
    expect(mocks.update).toHaveBeenCalled();
  });

  it('agendamento inexistente não faz nada', async () => {
    await handler()({
      tx: txWith(null),
      clinicId: 'clinic-1',
      payload: payload(),
      eventId: 'evt-1',
    });

    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.applyTransition).not.toHaveBeenCalled();
  });

  it('cobrança do RESTANTE não confirma nada', async () => {
    await handler()({
      tx: txWith('agendado'),
      clinicId: 'clinic-1',
      payload: payload({ kind: 'remainder' }),
      eventId: 'evt-1',
    });

    expect(mocks.applyTransition).not.toHaveBeenCalled();
  });
});
