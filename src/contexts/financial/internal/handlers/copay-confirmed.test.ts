/**
 * `health_insurance.copay.confirmed` → recebível do paciente pela coparticipação
 * CONFIRMADA (convênios P10.5, parte do recebível). Nunca o valor cheio do
 * atendimento; reentrega não duplica; sem repasse e sem cobrança automática.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerHandler: vi.fn(),
  publishEvent: vi.fn(),
  lancamentoValues: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));
vi.mock('@/contexts/health-insurance', () => ({
  HEALTH_INSURANCE_EVENTS: { COPAY_CONFIRMED: 'health_insurance.copay.confirmed' },
}));
vi.mock('../../schema', () => ({
  lancamentos: { __t: 'lancamentos', appointmentId: 'l.appointment_id', id: 'l.id' },
}));

import { PoisonPillError } from '@/lib/outbox/errors';

import './copay-confirmed';

const [eventType, handler] = mocks.registerHandler.mock.calls[0]! as [
  string,
  (ctx: {
    tx: unknown;
    clinicId: string;
    payload: Record<string, unknown>;
    eventId: string;
  }) => Promise<void>,
];

const stubTx = (returned: unknown[] = [{ id: 'lanc-9' }]) =>
  ({
    execute: async () => [{ timezone: 'America/Sao_Paulo' }],
    insert: () => ({
      values: (v: unknown) => {
        mocks.lancamentoValues(v);
        return { onConflictDoNothing: () => ({ returning: async () => returned }) };
      },
    }),
  }) as never;

const payload = {
  copaymentId: '00000000-0000-4000-8000-000000000001',
  clinicId: 'clinic-1',
  appointmentId: '00000000-0000-4000-8000-000000000002',
  patientId: '00000000-0000-4000-8000-000000000003',
  chargeableCents: 4500,
  procedureName: 'Consulta',
};

beforeEach(() => vi.clearAllMocks());

describe('handler de coparticipação confirmada', () => {
  it('consome health_insurance.copay.confirmed', () => {
    expect(eventType).toBe('health_insurance.copay.confirmed');
  });

  it('cria o recebível do paciente pelo valor COBRÁVEL confirmado, no mesmo atendimento', async () => {
    await handler({ tx: stubTx(), clinicId: 'clinic-1', payload, eventId: 'evt-1' });
    expect(mocks.lancamentoValues).toHaveBeenCalledWith(
      expect.objectContaining({
        tipo: 'receber',
        valor: '45.00',
        valorPago: '0.00',
        status: 'pendente',
        patientId: payload.patientId,
        appointmentId: payload.appointmentId,
        createdVia: 'auto',
        descricao: 'Coparticipação - Consulta',
      }),
    );
    expect(mocks.publishEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        eventType: 'financial.lancamento.created',
        payload: expect.objectContaining({ valor: 45, appointmentId: payload.appointmentId }),
      }),
    );
  });

  it('reentrega: o recebível já existia (UNIQUE por atendimento) → nada a mais', async () => {
    await handler({ tx: stubTx([]), clinicId: 'clinic-1', payload, eventId: 'evt-1' });
    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });

  it('clínica divergente é poison pill, não retentativa', async () => {
    await expect(
      handler({ tx: stubTx(), clinicId: 'outra', payload, eventId: 'evt-1' }),
    ).rejects.toBeInstanceOf(PoisonPillError);
    expect(mocks.lancamentoValues).not.toHaveBeenCalled();
  });
});
