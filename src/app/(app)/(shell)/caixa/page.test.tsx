// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import type { AppointmentFinancialEconomics, LancamentoSummary } from '@/contexts/financial/types';
import { billingApiV1 } from '@/contexts/billing/api';
import {
  getCaixaLancamentos,
  getCaixaPagaveis,
  listAppointmentFinancialEconomics,
  listOpenCollectionCases,
  listPaymentTransactionsForLancamentos,
  listPaymentMethods,
  listPendenciasAbertas,
} from '@/contexts/financial/queries';
import { paymentsApiV1 } from '@/contexts/payments';
import { listPatientCards } from '@/contexts/patient/queries';
import { listAppointmentCommercialPaymentMethods } from '@/contexts/scheduling/queries';
import { getClinicTimezone } from '@/contexts/tenancy/queries';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireClinicId, requireUser } from '@/lib/auth/tenant-context';

vi.mock('@/contexts/billing/api', () => ({
  billingApiV1: { hasAdvancedFinancialPolicies: vi.fn() },
}));
vi.mock('@/contexts/financial/queries', () => ({
  getCaixaLancamentos: vi.fn(),
  getCaixaPagaveis: vi.fn(),
  listAppointmentFinancialEconomics: vi.fn(),
  listOpenCollectionCases: vi.fn(),
  listPaymentTransactionsForLancamentos: vi.fn(),
  listPaymentMethods: vi.fn(),
  listPendenciasAbertas: vi.fn(),
}));
vi.mock('@/contexts/payments', () => ({
  paymentsApiV1: {
    listFailedCharges: vi.fn(),
    listManualRefundTasks: vi.fn(),
    listExcessRefundStatuses: vi.fn(),
    listPatientChargeEconomics: vi.fn(),
  },
}));
vi.mock('@/contexts/patient/queries', () => ({ listPatientCards: vi.fn() }));
vi.mock('@/contexts/scheduling/queries', () => ({
  listAppointmentCommercialPaymentMethods: vi.fn(),
}));
vi.mock('@/contexts/tenancy/queries', () => ({ getClinicTimezone: vi.fn() }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireClinicId: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock('@/lib/db/query-timeout', () => ({
  withQueryDeadline: (_label: string, query: Promise<unknown>) => query,
}));
vi.mock('./caixa-view', () => ({ CaixaView: vi.fn(() => null) }));

import { CaixaView } from './caixa-view';
import CaixaPage from './page';

const lancamento: LancamentoSummary = {
  id: 'l1',
  clinicId: 'c1',
  unitId: null,
  tipo: 'receber',
  descricao: 'Consulta',
  valor: 250,
  valorPago: 250,
  status: 'pago',
  dueDate: '2026-10-02',
  paidAt: '2026-10-02T10:00:00.000Z',
  patientId: null,
  supplierId: null,
  appointmentId: 'a1',
  paymentMethod: 'pix',
  createdVia: 'auto',
  reversesLancamentoId: null,
  snapshotProcedureName: 'Consulta',
  snapshotDoctorNome: null,
  createdAt: '2026-10-02T09:00:00.000Z',
};

const economics: AppointmentFinancialEconomics = {
  appointmentId: 'a1',
  providerGrossAmount: 255,
  providerFeeAmount: 5,
  earlySettlementFeeAmount: 2,
  providerNetAmount: 248,
  payout: {
    id: 'payout-1',
    calculationBasis: 'gross',
    basisAmount: 250,
    payoutAmount: 125,
    status: 'calculated',
    review: null,
    reviewBounds: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    userId: 'u1',
    clinicId: 'c1',
    role: 'owner',
    permissions: [PERMISSIONS.VIEW_FINANCIAL],
    granularPermissionsEnabled: false,
    claimsVersion: 1,
    isSuperAdmin: false,
    aal: 'aal1',
    validatedAt: '2026-10-02T10:00:00.000Z',
  });
  vi.mocked(requireClinicId).mockResolvedValue('c1');
  vi.mocked(getClinicTimezone).mockResolvedValue('America/Sao_Paulo');
  vi.mocked(getCaixaPagaveis).mockResolvedValue([]);
  vi.mocked(listPendenciasAbertas).mockResolvedValue([]);
  vi.mocked(listPaymentMethods).mockResolvedValue([]);
  vi.mocked(listOpenCollectionCases).mockResolvedValue([]);
  vi.mocked(paymentsApiV1.listFailedCharges).mockResolvedValue([]);
  vi.mocked(paymentsApiV1.listManualRefundTasks).mockResolvedValue([]);
  vi.mocked(getCaixaLancamentos).mockResolvedValue({
    pendentes: [],
    parciais: [],
    pagosHoje: [lancamento],
  });
  vi.mocked(paymentsApiV1.listExcessRefundStatuses).mockResolvedValue([]);
  vi.mocked(paymentsApiV1.listPatientChargeEconomics).mockResolvedValue([
    {
      chargeId: 'charge-1',
      appointmentId: 'a1',
      kind: 'deposit',
      status: 'paid',
      requestedAmount: 125,
      providerGrossAmount: 125,
      providerFeeAmount: 2,
      providerNetAmount: 123,
    },
  ]);
  vi.mocked(listPaymentTransactionsForLancamentos).mockResolvedValue([]);
  vi.mocked(listPatientCards).mockResolvedValue([]);
  vi.mocked(listAppointmentCommercialPaymentMethods).mockResolvedValue([
    { appointmentId: 'a1', commercialPaymentMethod: 'cash' },
  ]);
  vi.mocked(listAppointmentFinancialEconomics).mockResolvedValue([economics]);
});

afterEach(cleanup);

describe('CaixaPage — composição financeira por plano', () => {
  it.each([
    ['Solo', false],
    ['Clínica/Pro', true],
  ] as const)(
    'mostra fatos reais no %s e reserva o repasse ao plano avançado',
    async (_, premium) => {
      vi.mocked(billingApiV1.hasAdvancedFinancialPolicies).mockResolvedValue(premium);

      render(await CaixaPage());

      expect(listAppointmentFinancialEconomics).toHaveBeenCalledWith('c1', ['a1']);
      expect(paymentsApiV1.listPatientChargeEconomics).toHaveBeenCalledWith('c1', ['a1']);
      expect(listAppointmentCommercialPaymentMethods).toHaveBeenCalledWith('c1', ['a1']);
      const props = vi.mocked(CaixaView).mock.calls[0]?.[0];
      expect(props).toBeDefined();
      expect(props?.showAdvancedFinancialDetails).toBe(premium);
      expect(props?.pagosHoje[0]?.paymentEconomics).toEqual({
        ...economics,
        earlySettlementFeeAmount: premium ? economics.earlySettlementFeeAmount : null,
        payout: premium ? economics.payout : null,
      });
      expect(props?.pagosHoje[0]?.commercialPaymentMethod).toBe('cash');
      expect(props?.pagosHoje[0]?.chargeEconomics).toEqual([
        expect.objectContaining({ chargeId: 'charge-1', providerNetAmount: 123 }),
      ]);
    },
  );

  it('leva a pendência manual e o nome do paciente ao Caixa', async () => {
    vi.mocked(billingApiV1.hasAdvancedFinancialPolicies).mockResolvedValue(false);
    vi.mocked(paymentsApiV1.listManualRefundTasks).mockResolvedValue([
      {
        id: 'intent-1',
        appointmentId: 'a1',
        patientId: 'patient-1',
        providerPaymentId: 'pay_1',
        amount: 150,
        purpose: 'deposit_closeout',
        state: 'action_required',
      },
    ]);
    vi.mocked(listPatientCards).mockResolvedValue([
      {
        id: 'patient-1',
        nome: 'Paciente de teste',
        alergias: [],
        dataNascimento: null,
        sexo: null,
      },
    ]);

    render(await CaixaPage());

    expect(listPatientCards).toHaveBeenCalledWith('c1', ['patient-1']);
    expect(vi.mocked(CaixaView).mock.calls[0]?.[0].manualRefundTasks).toEqual([
      expect.objectContaining({ id: 'intent-1', pacienteNome: 'Paciente de teste' }),
    ]);
  });
});
