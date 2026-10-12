import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelRecurringSeries,
  getFailedJobChargeRef,
  getPayableCharge,
  requireCachedPermission,
  requireUser,
} = vi.hoisted(() => ({
  cancelRecurringSeries: vi.fn(),
  getFailedJobChargeRef: vi.fn(),
  getPayableCharge: vi.fn(),
  requireCachedPermission: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/contexts/ai-agent/queries', () => ({ getFailedJobChargeRef }));
vi.mock('@/contexts/payments', () => ({ paymentsApiV1: { getPayableCharge } }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/contexts/patient/queries', () => ({
  getPatientSummaryById: vi.fn(),
  listPatients: vi.fn(),
}));
vi.mock('@/contexts/scheduling/actions', () => ({
  cancelRecurringSeries,
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
  requireCachedPermission,
  requireClinicId: vi.fn(),
  requireUser,
}));

import { PERMISSIONS } from '@/lib/auth/permissions';

import { cancelarSerieRecorrenteAction, copiarLinkDeCobrancaAction } from './actions';

function authError(): Error {
  const error = new Error('denied');
  error.name = 'AuthError';
  return error;
}

function formDataQueFalhaAoLer() {
  const formData = new FormData();
  const get = vi.spyOn(formData, 'get').mockImplementation(() => {
    throw new Error('a entrada foi lida antes da autenticação');
  });
  return { formData, get };
}

describe('cancelarSerieRecorrenteAction — ordem de autenticação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ userId: 'user-a' });
    requireCachedPermission.mockResolvedValue(undefined);
  });

  it('nega sessão inválida antes de ler qualquer campo externo', async () => {
    requireUser.mockRejectedValueOnce(authError());
    const { formData, get } = formDataQueFalhaAoLer();

    await expect(cancelarSerieRecorrenteAction(null, formData)).resolves.toEqual({
      ok: false,
      message: 'Sem permissão para criar atendimento.',
    });

    expect(get).not.toHaveBeenCalled();
    expect(requireCachedPermission).not.toHaveBeenCalled();
    expect(cancelRecurringSeries).not.toHaveBeenCalled();
  });

  it('nega falta de permissão antes de ler qualquer campo externo', async () => {
    requireCachedPermission.mockRejectedValueOnce(authError());
    const { formData, get } = formDataQueFalhaAoLer();

    await expect(cancelarSerieRecorrenteAction(null, formData)).resolves.toEqual({
      ok: false,
      message: 'Sem permissão para criar atendimento.',
    });

    expect(requireCachedPermission).toHaveBeenCalledWith(PERMISSIONS.EDIT_AGENDA);
    expect(get).not.toHaveBeenCalled();
    expect(cancelRecurringSeries).not.toHaveBeenCalled();
  });
});

describe('copiarLinkDeCobrancaAction — ordem de autenticação', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUser.mockResolvedValue({ userId: 'user-a' });
    requireCachedPermission.mockResolvedValue(undefined);
  });

  it('nega sessão inválida antes de procurar o job ou o link', async () => {
    requireUser.mockRejectedValueOnce(authError());

    await expect(copiarLinkDeCobrancaAction('job-1')).resolves.toEqual({
      ok: false,
      message: 'Sem permissão para copiar o link.',
    });

    expect(requireCachedPermission).not.toHaveBeenCalled();
    expect(getFailedJobChargeRef).not.toHaveBeenCalled();
    expect(getPayableCharge).not.toHaveBeenCalled();
  });

  it('exige edit:agenda antes de procurar o job ou o link', async () => {
    requireCachedPermission.mockRejectedValueOnce(authError());

    await expect(copiarLinkDeCobrancaAction('job-1')).resolves.toEqual({
      ok: false,
      message: 'Sem permissão para copiar o link.',
    });

    expect(requireCachedPermission).toHaveBeenCalledWith(PERMISSIONS.EDIT_AGENDA);
    expect(getFailedJobChargeRef).not.toHaveBeenCalled();
    expect(getPayableCharge).not.toHaveBeenCalled();
  });
});
