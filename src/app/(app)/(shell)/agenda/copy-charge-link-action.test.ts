/**
 * EC-32 — `copiarLinkDeCobrancaAction`: o link do sinal ou do saldo que a Meta
 * não entregou.
 *
 * A entrada é o id do JOB. Só sai link de um job `failed` desta clínica, e só
 * enquanto o Payments disser que a cobrança é pagável. O link nunca vai para a
 * métrica.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { emit, getFailedJobChargeRef, getPayableCharge } = vi.hoisted(() => ({
  emit: vi.fn(),
  getFailedJobChargeRef: vi.fn(),
  getPayableCharge: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/contexts/ai-agent/queries', () => ({ getFailedJobChargeRef }));
vi.mock('@/contexts/payments', () => ({ paymentsApiV1: { getPayableCharge } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));
vi.mock('@/contexts/patient/queries', () => ({
  getPatientSummaryById: vi.fn(),
  listPatients: vi.fn(),
}));
vi.mock('@/contexts/scheduling/actions', () => ({
  cancelRecurringSeries: vi.fn(),
  createAppointment: vi.fn(),
  createDoctorAbsence: vi.fn(),
  createRecurringAppointments: vi.fn(),
  createWalkInAppointment: vi.fn(),
  recoverAppointment: vi.fn(),
}));
vi.mock('@/contexts/scheduling/queries', () => ({ listAppointments: vi.fn() }));
vi.mock('@/contexts/scheduling/slot-resolver', () => ({ zonedWallToUtc: vi.fn() }));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: vi.fn() }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireCachedPermission: vi.fn().mockResolvedValue(undefined),
  requireClinicId: vi.fn().mockResolvedValue('11111111-1111-4111-8111-111111111111'),
  requireUser: vi.fn().mockResolvedValue({ userId: 'user-a' }),
}));

import { copiarLinkDeCobrancaAction } from './actions';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';
const CHARGE = '66666666-6666-4666-8666-666666666666';
const URL = 'https://sandbox.asaas.com/checkoutSession/show?id=abc';
const INDISPONIVEL = {
  ok: false,
  message: 'Este link não está mais disponível: a cobrança foi paga, cancelada ou expirou.',
};

beforeEach(() => {
  emit.mockReset();
  getFailedJobChargeRef.mockReset();
  getPayableCharge.mockReset();
});

describe('copiarLinkDeCobrancaAction', () => {
  it('job failed da clínica com cobrança pagável → o link; a métrica não leva o link', async () => {
    getFailedJobChargeRef.mockResolvedValue({ jobId: JOB, type: 'deposit_link', chargeId: CHARGE });
    getPayableCharge.mockResolvedValue({
      chargeId: CHARGE,
      appointmentId: 'appt-1',
      amount: 75,
      invoiceUrl: URL,
      holdExpiresAt: null,
    });

    await expect(copiarLinkDeCobrancaAction(JOB)).resolves.toEqual({ ok: true, url: URL });

    expect(getFailedJobChargeRef).toHaveBeenCalledWith(CLINIC, JOB);
    expect(getPayableCharge).toHaveBeenCalledWith(CLINIC, CHARGE);
    expect(emit).toHaveBeenCalledWith('proactive.link.copied', {
      clinicId: CLINIC,
      jobId: JOB,
      type: 'deposit_link',
    });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('asaas');
  });

  it('id que não é uuid não vai ao banco', async () => {
    await expect(copiarLinkDeCobrancaAction('../../etc')).resolves.toEqual(INDISPONIVEL);
    expect(getFailedJobChargeRef).not.toHaveBeenCalled();
  });

  it('job inexistente, de outro tipo ou que não falhou → indisponível, sem perguntar ao Payments', async () => {
    getFailedJobChargeRef.mockResolvedValue(null);

    await expect(copiarLinkDeCobrancaAction(JOB)).resolves.toEqual(INDISPONIVEL);
    expect(getPayableCharge).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('cobrança paga, cancelada ou expirada → indisponível', async () => {
    getFailedJobChargeRef.mockResolvedValue({
      jobId: JOB,
      type: 'remainder_link',
      chargeId: CHARGE,
    });
    getPayableCharge.mockResolvedValue(null);

    await expect(copiarLinkDeCobrancaAction(JOB)).resolves.toEqual(INDISPONIVEL);
    expect(emit).not.toHaveBeenCalled();
  });

  it('erro inesperado vira mensagem genérica, sem detalhe interno', async () => {
    getFailedJobChargeRef.mockRejectedValue(new Error('connection terminated: 10.0.0.5'));

    await expect(copiarLinkDeCobrancaAction(JOB)).resolves.toEqual({
      ok: false,
      message: 'Não foi possível obter o link agora. Tente de novo.',
    });
  });
});
