import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import './provide-procedure-price';
import { getTool, type ToolContext } from './registry';

const mocks = vi.hoisted(() => ({
  listProcedures: vi.fn(),
  getPaymentPricingPolicy: vi.fn(),
  listProcedurePaymentPrices: vi.fn(),
}));

vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { listProcedures: mocks.listProcedures },
}));
vi.mock('@/contexts/payments', () => ({
  getPaymentPricingPolicy: mocks.getPaymentPricingPolicy,
  listProcedurePaymentPrices: mocks.listProcedurePaymentPrices,
}));

const PROCEDURE_ID = '55555555-5555-5555-5555-555555555555';
const context: ToolContext = {
  tx: {} as Tx,
  clinicId: '11111111-1111-1111-1111-111111111111',
  conversationId: '22222222-2222-2222-2222-222222222222',
  eventId: '33333333-3333-3333-3333-333333333333',
  aiRequestId: '44444444-4444-4444-4444-444444444444',
  patientId: null,
  patientNome: null,
  identityAmbiguous: false,
  verifiedPhone: '+5511999990000',
  currentMessage: 'Quanto custa a consulta?',
  canScheduleAnonymous: false,
  maxDaysAhead: 30,
  clinicTimeZone: 'America/Sao_Paulo',
  pendingAppointmentProcedureName: null,
  canDisclosePayments: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listProcedures.mockResolvedValue([
    {
      id: PROCEDURE_ID,
      descricao: 'Consulta Cardiológica',
      categoria: 'consulta',
      valorPadrao: 250,
      duracaoPadraoMin: 30,
    },
  ]);
  mocks.getPaymentPricingPolicy.mockResolvedValue({ mode: 'payment_method_pricing' });
  mocks.listProcedurePaymentPrices.mockResolvedValue([
    { procedureId: PROCEDURE_ID, paymentMethod: 'pix', installmentCount: null, grossAmount: 180 },
    {
      procedureId: PROCEDURE_ID,
      paymentMethod: 'credit_card',
      installmentCount: 1,
      grossAmount: 200,
    },
    {
      procedureId: PROCEDURE_ID,
      paymentMethod: 'credit_card',
      installmentCount: 3,
      grossAmount: 220,
    },
    { procedureId: PROCEDURE_ID, paymentMethod: 'cash', installmentCount: null, grossAmount: 170 },
  ]);
});

describe('provide_procedure_price por meio de pagamento', () => {
  it('mostra preços configurados, inclusive dinheiro na clínica, e não apresenta o preço padrão como preço cobrável', async () => {
    const result = await getTool('provide_procedure_price')!.handler({}, context);
    expect(result.procedures).toEqual([
      {
        procedure_id: PROCEDURE_ID,
        descricao: 'Consulta Cardiológica',
        categoria: 'consulta',
        valor: null,
        duracao_min: 30,
        payment_options: [
          {
            payment_method: 'pix',
            installment_count: null,
            gross_amount: 180,
            hosted_checkout_supports_option: true,
            paid_at_clinic: false,
          },
          {
            payment_method: 'credit_card',
            installment_count: 1,
            gross_amount: 200,
            hosted_checkout_supports_option: true,
            paid_at_clinic: false,
          },
          {
            payment_method: 'credit_card',
            installment_count: 3,
            gross_amount: 220,
            hosted_checkout_supports_option: false,
            paid_at_clinic: false,
          },
          {
            payment_method: 'cash',
            installment_count: null,
            gross_amount: 170,
            hosted_checkout_supports_option: false,
            paid_at_clinic: true,
          },
        ],
      },
    ]);
  });

  it('mantém preço padrão no modo sem preços por meio de pagamento', async () => {
    mocks.getPaymentPricingPolicy.mockResolvedValue({ mode: 'absorb_fees' });
    const result = await getTool('provide_procedure_price')!.handler({}, context);
    expect(result.procedures[0]).toMatchObject({ valor: 250, payment_options: [] });
    expect(mocks.listProcedurePaymentPrices).not.toHaveBeenCalled();
  });
});
