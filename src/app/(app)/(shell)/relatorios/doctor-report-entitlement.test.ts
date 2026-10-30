import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasAdvancedFinancialPolicies: vi.fn(),
  getClinicTimezone: vi.fn(),
  getAppointmentStatsByDoctor: vi.fn(),
  getRecebimentosByAppointment: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: mocks.hasAdvancedFinancialPolicies },
}));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: mocks.getClinicTimezone }));
vi.mock('@/contexts/scheduling/queries', () => ({
  getAppointmentStatsByDoctor: mocks.getAppointmentStatsByDoctor,
}));
vi.mock('@/contexts/financial/queries', () => ({
  getRecebimentosByAppointment: mocks.getRecebimentosByAppointment,
}));

import { getConsolidadoPorProfissional } from './data';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getClinicTimezone.mockResolvedValue('America/Sao_Paulo');
  mocks.getAppointmentStatsByDoctor.mockResolvedValue([
    {
      doctorId: 'doctor-a',
      nome: 'Médico sintético',
      total: 2,
      atendidos: 1,
      faltas: 1,
      appointmentIds: ['appt-a'],
    },
  ]);
  mocks.getRecebimentosByAppointment.mockResolvedValue([
    { appointmentId: 'appt-a', recebido: 150 },
  ]);
});

describe('entitlement do consolidado por médico', () => {
  it('Consultório não consulta nem devolve dados por médico mesmo com permissão financeira', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(false);
    await expect(
      getConsolidadoPorProfissional('clinic-a', 30, { includeFaturamento: true }),
    ).resolves.toBeNull();
    expect(mocks.getClinicTimezone).not.toHaveBeenCalled();
    expect(mocks.getAppointmentStatsByDoctor).not.toHaveBeenCalled();
    expect(mocks.getRecebimentosByAppointment).not.toHaveBeenCalled();
  });
  it('Clínica consulta somente seu tenant e respeita a permissão de valores', async () => {
    mocks.hasAdvancedFinancialPolicies.mockResolvedValue(true);
    const result = await getConsolidadoPorProfissional('clinic-a', 30, {
      includeFaturamento: false,
    });
    expect(result).toEqual([
      {
        doctorId: 'doctor-a',
        nome: 'Médico sintético',
        total: 2,
        atendidos: 1,
        faltas: 1,
        recebido: null,
      },
    ]);
    expect(mocks.hasAdvancedFinancialPolicies).toHaveBeenCalledWith('clinic-a');
    expect(mocks.getAppointmentStatsByDoctor).toHaveBeenCalledWith(
      'clinic-a',
      expect.any(Date),
      expect.any(Date),
    );
    expect(mocks.getRecebimentosByAppointment).not.toHaveBeenCalled();
  });
  it('falha de leitura do plano não libera o relatório', async () => {
    mocks.hasAdvancedFinancialPolicies.mockRejectedValue(new Error('billing unavailable'));
    await expect(
      getConsolidadoPorProfissional('clinic-a', 30, { includeFaturamento: true }),
    ).rejects.toThrow('billing unavailable');
    expect(mocks.getAppointmentStatsByDoctor).not.toHaveBeenCalled();
  });
});
