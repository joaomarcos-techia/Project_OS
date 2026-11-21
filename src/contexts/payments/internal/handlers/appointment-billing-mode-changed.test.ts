/**
 * Handler `scheduling.appointment.billing_mode_changed` (P4.3). A regra está em
 * `charge-closeout` e a prova com banco e Asaas simulado em
 * `scripts/security/health-insurance-modality-change-db.ts`; aqui, a fiação: evento certo,
 * execução DETACHED (chama o Asaas fora da TX do worker) e só "virou convênio" fecha cobrança.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  registerDetachedHandler: vi.fn(),
  registerHandler: vi.fn(),
  closeChargesForBillingModeChange: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/outbox/registry', () => ({
  registerDetachedHandler: mocks.registerDetachedHandler,
  registerHandler: mocks.registerHandler,
}));
vi.mock('@/contexts/scheduling', () => ({
  SCHEDULING_EVENTS: { BILLING_MODE_CHANGED: 'scheduling.appointment.billing_mode_changed' },
}));
vi.mock('../charge-closeout', () => ({
  closeChargesForBillingModeChange: mocks.closeChargesForBillingModeChange,
}));

import './appointment-billing-mode-changed';

const registration = mocks.registerDetachedHandler.mock.calls[0]!;
type Handler = (ctx: {
  clinicId: string;
  payload: Record<string, unknown>;
  eventId: string;
}) => Promise<void>;
const handler = registration[1] as Handler;

const payload = (to: 'particular' | 'convenio') => ({
  appointmentId: 'apt-1',
  clinicId: 'clinic-1',
  patientId: 'pat-1',
  from: to === 'convenio' ? 'particular' : 'convenio',
  to,
  changedAt: '2026-11-14T12:00:00.000Z',
});

beforeEach(() => mocks.closeChargesForBillingModeChange.mockReset());

describe('handler da troca de forma de atendimento (P4.3)', () => {
  it('registra-se DETACHED no evento do Scheduling', () => {
    expect(registration[0]).toBe('scheduling.appointment.billing_mode_changed');
    expect(mocks.registerHandler).not.toHaveBeenCalled();
  });

  it('virou convênio: fecha a cobrança particular aberta, com o id do evento', async () => {
    await handler({ clinicId: 'clinic-1', payload: payload('convenio'), eventId: 'evt-1' });
    expect(mocks.closeChargesForBillingModeChange).toHaveBeenCalledWith({
      clinicId: 'clinic-1',
      appointmentId: 'apt-1',
      sourceEventId: 'evt-1',
    });
  });

  it('virou particular: nada é fechado nem criado', async () => {
    await handler({ clinicId: 'clinic-1', payload: payload('particular'), eventId: 'evt-2' });
    expect(mocks.closeChargesForBillingModeChange).not.toHaveBeenCalled();
  });
});
