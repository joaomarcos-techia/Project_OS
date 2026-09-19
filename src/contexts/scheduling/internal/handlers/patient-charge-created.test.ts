/**
 * Handler `payments.patient_charge.created` → segura a vaga.
 *
 * Prova a divisão de ownership (regra R3): o Payments publica, a AGENDA escreve
 * em `appointments`. E prova que só o SINAL segura vaga — o restante cobrado
 * depois do atendimento (1.5) não tem nada a segurar.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyDepositHold: vi.fn(),
  registerHandler: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/outbox/registry', () => ({ registerHandler: mocks.registerHandler }));
vi.mock('../deposit-hold', () => ({ applyDepositHold: mocks.applyDepositHold }));
vi.mock('@/contexts/payments', () => ({
  PAYMENTS_EVENTS: { CHARGE_CREATED: 'payments.patient_charge.created' },
}));

import './patient-charge-created';

type Handler = (ctx: {
  tx: unknown;
  clinicId: string;
  payload: Record<string, unknown>;
}) => Promise<void>;

const handler = () => mocks.registerHandler.mock.calls[0]![1] as Handler;

const payload = (over: Record<string, unknown> = {}) => ({
  chargeId: 'charge-1',
  clinicId: 'clinic-1',
  appointmentId: 'apt-1',
  patientId: 'pac-1',
  kind: 'deposit',
  amount: 150,
  holdExpiresAt: '2026-09-10T14:00:00.000Z',
  ...over,
});

beforeEach(() => {
  mocks.applyDepositHold.mockClear();
});

describe('handler de cobrança criada', () => {
  it('registra-se para o evento público do Payments', () => {
    expect(mocks.registerHandler).toHaveBeenCalledWith(
      'payments.patient_charge.created',
      expect.any(Function),
    );
  });

  it('segura a vaga até o prazo do hold', async () => {
    await handler()({ tx: 'TX', clinicId: 'clinic-1', payload: payload() });

    expect(mocks.applyDepositHold).toHaveBeenCalledWith('TX', {
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      holdExpiresAt: new Date('2026-09-10T14:00:00.000Z'),
    });
  });

  it('cobrança do RESTANTE não segura vaga nenhuma', async () => {
    await handler()({ tx: 'TX', clinicId: 'clinic-1', payload: payload({ kind: 'remainder' }) });

    expect(mocks.applyDepositHold).not.toHaveBeenCalled();
  });
});
