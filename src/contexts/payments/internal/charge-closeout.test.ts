/**
 * Fechamento da cobrança do sinal (ADR-049 1.5, ramos A e C).
 *
 * Aqui dinheiro se move. Cada teste protege uma decisão que, invertida, custa
 * dinheiro a alguém: estornar duas vezes, apagar cobrança já paga, reter o sinal
 * de quem cancelou a tempo, ou marcar `refunded` sem ter devolvido nada.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as AsaasModule from '@/lib/payments/asaas';

const mocks = vi.hoisted(() => ({
  findOpenCharge: vi.fn(),
  closeCharge: vi.fn(),
  flagPaidChargeMissingPaymentId: vi.fn(),
  releaseCreditAsRetained: vi.fn(),
  getClinicAsaasClient: vi.fn(),
  getDepositPolicy: vi.fn(),
  lookupAppointment: vi.fn(),
  getPayment: vi.fn(),
  listPaymentRefunds: vi.fn(),
  refundPayment: vi.fn(),
  queueManualDepositRefund: vi.fn(),
  reconcileRefundIntentsForPayment: vi.fn(),
  cancelPayment: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/payments/account-store', () => ({
  getClinicAsaasClient: mocks.getClinicAsaasClient,
}));
vi.mock('@/contexts/scheduling', () => ({
  schedulingApiV1: { lookupAppointment: mocks.lookupAppointment },
}));
vi.mock('../queries', () => ({ getDepositPolicy: mocks.getDepositPolicy }));
vi.mock('./charge-store', () => ({
  findOpenCharge: mocks.findOpenCharge,
  closeCharge: mocks.closeCharge,
  flagPaidChargeMissingPaymentId: mocks.flagPaidChargeMissingPaymentId,
  releaseCreditAsRetained: mocks.releaseCreditAsRetained,
}));
vi.mock('./excess-refund', () => ({
  queueManualDepositRefund: mocks.queueManualDepositRefund,
  reconcileRefundIntentsForPayment: mocks.reconcileRefundIntentsForPayment,
  confirmedRefundTotal: (refunds: { status: string; value: number }[]) =>
    refunds
      .filter((refund) => refund.status === 'DONE')
      .reduce((sum, refund) => sum + refund.value, 0),
}));
// Erros REAIS (o código usa `instanceof` + `httpStatus`); só o client é trocado.
vi.mock('@/lib/payments/asaas', async (importActual) => {
  const actual = await importActual<typeof AsaasModule>();
  return { ...actual };
});

import { metrics } from '@/lib/observability/metrics';
import { PoisonPillError } from '@/lib/outbox/errors';
import { BillingProviderError } from '@/lib/payments/asaas';

import { closeChargeForCancellation, closeChargeForNoShow } from './charge-closeout';

const CLINIC = 'clinic-1';
const APPOINTMENT = 'apt-1';
const EVENT = 'event-1';

const POLICY = {
  enabled: true,
  percent: 50,
  cancellationWindowHours: 24,
  appliesToFirstVisit: true,
  appliesToReturn: true,
  updatedAt: null,
};

const charge = (over: Record<string, unknown> = {}) => ({
  id: 'charge-1',
  status: 'pending',
  kind: 'deposit',
  amount: 150,
  providerPaymentId: 'pay_1',
  ...over,
});

const client = () => ({
  getPayment: mocks.getPayment,
  listPaymentRefunds: mocks.listPaymentRefunds,
  refundPayment: mocks.refundPayment,
  cancelPayment: mocks.cancelPayment,
});

/** Consulta daqui a 10 dias — cancelar agora está confortavelmente na janela. */
const FUTURE = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

const emitted = (name: string) => vi.mocked(metrics.emit).mock.calls.filter((c) => c[0] === name);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.closeCharge.mockResolvedValue(true);
  mocks.releaseCreditAsRetained.mockResolvedValue(undefined);
  mocks.getClinicAsaasClient.mockResolvedValue(client());
  mocks.getDepositPolicy.mockResolvedValue(POLICY);
  mocks.lookupAppointment.mockResolvedValue({ scheduledAt: FUTURE });
  mocks.getPayment.mockResolvedValue({ paymentId: 'pay_1', status: 'PENDING', deleted: false });
  mocks.listPaymentRefunds.mockResolvedValue([]);
  mocks.cancelPayment.mockResolvedValue({ deleted: true });
  mocks.refundPayment.mockResolvedValue({ refundId: 'ref_1', status: 'REFUNDED', value: 150 });
  mocks.queueManualDepositRefund.mockResolvedValue('submitted');
  mocks.reconcileRefundIntentsForPayment.mockResolvedValue(1);
});

describe('ramo A — o paciente faltou', () => {
  it('sem cobrança aberta não toca em nada', async () => {
    mocks.findOpenCharge.mockResolvedValue(null);

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(mocks.getClinicAsaasClient).not.toHaveBeenCalled();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
  });

  it('sinal PAGO vira taxa retida: nada é escrito e nada é estornado', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge({ status: 'paid' }));

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(mocks.refundPayment).not.toHaveBeenCalled();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(emitted('payments.deposit.retained')[0]?.[1]).toMatchObject({ reason: 'no_show' });
  });

  it('sinal NÃO pago tem o link morto no gateway — senão a falta ainda gera pagamento', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(mocks.cancelPayment).toHaveBeenCalledWith('pay_1');
    expect(mocks.closeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'pending', outcome: 'cancelled' }),
    );
  });

  it('cobrança já removida (200 + deleted) não é apagada de novo, e fecha', async () => {
    // O caso REAL: o Asaas responde 200 no GET de cobrança apagada, com o status
    // congelado em PENDING. Sem olhar `deleted`, o código a trataria como viva.
    mocks.findOpenCharge.mockResolvedValue(charge());
    mocks.getPayment.mockResolvedValue({ paymentId: 'pay_1', status: 'PENDING', deleted: true });

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(mocks.cancelPayment).not.toHaveBeenCalled();
    expect(mocks.closeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'pending', outcome: 'cancelled' }),
    );
  });

  it('cobrança já removida do Asaas (404) fecha mesmo assim', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());
    mocks.getPayment.mockRejectedValue(new BillingProviderError('sumiu', 'x', 404));

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(mocks.cancelPayment).not.toHaveBeenCalled();
    expect(mocks.closeCharge).toHaveBeenCalled();
  });

  it('o paciente pagou e o webhook ainda não conciliou: NÃO apaga, volta depois', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'RECEIVED',
      billingType: 'PIX',
      deleted: false,
    });

    await expect(
      closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT }),
    ).rejects.toThrow(/não conciliada/);

    expect(mocks.cancelPayment).not.toHaveBeenCalled();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
  });

  it('conta desconectada: fecha o registro local e deixa o link órfão visível', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());
    mocks.getClinicAsaasClient.mockResolvedValue(null);

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(emitted('payments.deposit.void_orphan_link')).toHaveLength(1);
    expect(mocks.closeCharge).toHaveBeenCalled();
  });

  it('erro indeterminado do gateway sobe (o worker retenta)', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());
    mocks.getPayment.mockRejectedValue(new BillingProviderError('500', 'x', 500));

    await expect(
      closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT }),
    ).rejects.toThrow();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
  });
});

describe('ramo C — cancelamento com o sinal ainda pendente', () => {
  it('hold vencido fecha como EXPIRED, não como cancelado', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'deposit_expired',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.closeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'pending', outcome: 'expired' }),
    );
  });

  it('cancelamento comum fecha como CANCELLED e mata o link', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.cancelPayment).toHaveBeenCalledWith('pay_1');
    expect(mocks.closeCharge).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'cancelled' }),
    );
    // Sem pagamento não há o que estornar.
    expect(mocks.refundPayment).not.toHaveBeenCalled();
  });
});

describe('ramo C — cancelamento com o sinal PAGO', () => {
  beforeEach(() => {
    mocks.findOpenCharge.mockResolvedValue(charge({ status: 'paid' }));
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'RECEIVED',
      billingType: 'PIX',
      deleted: false,
    });
  });

  it('sinal pago sem ID do Asaas fica visível para investigação sem estorno', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge({ status: 'paid', providerPaymentId: null }));

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.flagPaidChargeMissingPaymentId).toHaveBeenCalledWith(CLINIC, 'charge-1');
    expect(mocks.queueManualDepositRefund).not.toHaveBeenCalled();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(mocks.refundPayment).not.toHaveBeenCalled();
  });

  it('dentro da janela: registra a pendência manual sem solicitar estorno ao Asaas', async () => {
    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.queueManualDepositRefund).toHaveBeenCalledWith({
      clinicId: CLINIC,
      chargeId: 'charge-1',
      amount: 150,
      sourceEventId: EVENT,
      client: expect.any(Object),
    });
    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(mocks.refundPayment).not.toHaveBeenCalled();
    expect(emitted('payments.deposit.refunded')).toHaveLength(0);
  });

  it('fora da janela: retém, sem estorno e sem escrita', async () => {
    // Consulta em 2h, janela de 24h ⇒ cancelou tarde demais.
    mocks.lookupAppointment.mockResolvedValue({
      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.queueManualDepositRefund).not.toHaveBeenCalled();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(emitted('payments.deposit.retained')[0]?.[1]).toMatchObject({
      reason: 'cancelamento_fora_da_janela',
    });
  });

  it.each(['doctor_absence', 'patient_deceased', 'patient_deleted', 'reschedule'])(
    'motivo %s devolve o sinal mesmo em cima da hora',
    async (cancelReason) => {
      mocks.lookupAppointment.mockResolvedValue({
        scheduledAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });

      await closeChargeForCancellation({
        clinicId: CLINIC,
        appointmentId: APPOINTMENT,
        cancelReason,
        cancelledAt: new Date(),
        sourceEventId: EVENT,
      });

      expect(mocks.queueManualDepositRefund).toHaveBeenCalledOnce();
      // Nem consulta a agenda: a janela não se aplica a estes motivos.
      expect(mocks.lookupAppointment).not.toHaveBeenCalled();
    },
  );

  it('reagendamento devolve o sinal — senão o paciente paga sinal duas vezes', async () => {
    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'reschedule',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.queueManualDepositRefund).toHaveBeenCalledTimes(1);
  });

  it('já estornado no Asaas: passa pela intenção e reconcilia sem POSTar outro estorno', async () => {
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'REFUNDED',
      billingType: 'PIX',
      deleted: false,
    });
    mocks.listPaymentRefunds.mockResolvedValue([{ refundId: null, status: 'DONE', value: 150 }]);

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.queueManualDepositRefund).toHaveBeenCalledOnce();
    expect(mocks.reconcileRefundIntentsForPayment).toHaveBeenCalledWith({
      clinicId: CLINIC,
      providerPaymentId: 'pay_1',
      loadRefunds: expect.any(Function),
    });
    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(mocks.refundPayment).not.toHaveBeenCalled();
  });

  it('outro DONE não fecha diretamente uma intenção cujo refund identificado segue PENDING', async () => {
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'REFUNDED',
      billingType: 'PIX',
      deleted: false,
    });
    mocks.listPaymentRefunds.mockResolvedValue([
      { refundId: 'ref_pending', status: 'PENDING', value: 150 },
      { refundId: 'ref_other', status: 'DONE', value: 150 },
    ]);
    mocks.queueManualDepositRefund.mockResolvedValue('already_started');
    mocks.reconcileRefundIntentsForPayment.mockResolvedValue(0);

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(mocks.reconcileRefundIntentsForPayment).toHaveBeenCalledOnce();
  });

  it('status REFUNDED com item ainda PENDING não fecha o sinal', async () => {
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'REFUNDED',
      billingType: 'PIX',
      deleted: false,
    });
    mocks.listPaymentRefunds.mockResolvedValue([{ refundId: null, status: 'PENDING', value: 150 }]);

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(mocks.queueManualDepositRefund).toHaveBeenCalledOnce();
    expect(mocks.refundPayment).not.toHaveBeenCalled();
  });

  it.each(['REFUND_REQUESTED', 'REFUND_IN_PROGRESS'])(
    '%s ainda não fecha nem inicia outro estorno, mas acompanha a pendência',
    async (status) => {
      mocks.getPayment.mockResolvedValue({
        paymentId: 'pay_1',
        status,
        billingType: 'PIX',
        deleted: false,
      });

      await closeChargeForCancellation({
        clinicId: CLINIC,
        appointmentId: APPOINTMENT,
        cancelReason: 'user',
        cancelledAt: new Date(),
        sourceEventId: EVENT,
      });

      expect(mocks.queueManualDepositRefund).toHaveBeenCalledOnce();
      expect(mocks.closeCharge).not.toHaveBeenCalled();
      expect(emitted('payments.deposit.refund_skipped')[0]?.[1]).toMatchObject({
        reason: 'provider_refund_in_progress',
        providerStatus: status,
      });
    },
  );

  it('o gateway não confirma o pagamento: não estorna dinheiro que não entrou', async () => {
    mocks.getPayment.mockResolvedValue({ paymentId: 'pay_1', status: 'PENDING', deleted: false });

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.queueManualDepositRefund).not.toHaveBeenCalled();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(emitted('payments.deposit.refund_skipped')[0]?.[1]).toMatchObject({
      reason: 'provider_nao_confirma_pagamento',
    });
  });

  it.each(['BOLETO', 'UNDEFINED', null])(
    'forma de pagamento %s exige devolução manual sem marcar refunded',
    async (billingType) => {
      // Regra do Asaas verificada ao vivo: só PIX e cartão são estornáveis.
      mocks.getPayment.mockResolvedValue({
        paymentId: 'pay_1',
        status: 'RECEIVED',
        billingType,
        deleted: false,
      });

      await closeChargeForCancellation({
        clinicId: CLINIC,
        appointmentId: APPOINTMENT,
        cancelReason: 'user',
        cancelledAt: new Date(),
        sourceEventId: EVENT,
      });

      expect(mocks.queueManualDepositRefund).toHaveBeenCalledOnce();
      expect(mocks.closeCharge).not.toHaveBeenCalled();
      expect(mocks.refundPayment).not.toHaveBeenCalled();
    },
  );

  it('conta desconectada NÃO marca refunded — o dinheiro não voltou', async () => {
    mocks.getClinicAsaasClient.mockResolvedValue(null);

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(mocks.queueManualDepositRefund).toHaveBeenCalledWith({
      clinicId: CLINIC,
      chargeId: 'charge-1',
      amount: 150,
      sourceEventId: EVENT,
      client: null,
    });
  });

  it('agendamento inexistente não move dinheiro às cegas', async () => {
    mocks.lookupAppointment.mockResolvedValue(null);

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.queueManualDepositRefund).not.toHaveBeenCalled();
    expect(emitted('payments.deposit.refund_skipped')[0]?.[1]).toMatchObject({
      reason: 'agendamento_nao_encontrado',
    });
  });

  it('confirmação feita pela intenção não fecha novamente no chamador', async () => {
    mocks.queueManualDepositRefund.mockResolvedValue('confirmed');

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(emitted('payments.deposit.refunded')).toHaveLength(0);
  });

  it('a antecedência é medida pelo instante do CANCELAMENTO, não pelo do worker', async () => {
    // Consulta em 3h. O cancelamento aconteceu 5 dias atrás (worker atrasado):
    // na época faltavam mais de 24h, então o paciente TEM direito ao estorno.
    mocks.lookupAppointment.mockResolvedValue({
      scheduledAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    });

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
      sourceEventId: EVENT,
    });

    expect(mocks.queueManualDepositRefund).toHaveBeenCalledTimes(1);
  });
});

describe('recusa do gateway — o que retenta e o que não retenta', () => {
  beforeEach(() => {
    mocks.findOpenCharge.mockResolvedValue(charge({ status: 'paid' }));
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'RECEIVED',
      deleted: false,
      billingType: 'PIX',
    });
  });

  it('4xx no estorno vira poison pill: retentar repetiria a mesma recusa', async () => {
    mocks.queueManualDepositRefund.mockResolvedValue('failed');

    const err = await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PoisonPillError);
    // Não marca `refunded`: o dinheiro NÃO voltou.
    expect(mocks.closeCharge).not.toHaveBeenCalled();
    expect(mocks.queueManualDepositRefund).toHaveBeenCalledOnce();
  });

  it('429 NÃO é terminal — é o único 4xx que muda sozinho com o tempo', async () => {
    mocks.getPayment.mockRejectedValue(new BillingProviderError('rate', 'x', 429));

    const err = await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(BillingProviderError);
    expect(err).not.toBeInstanceOf(PoisonPillError);
  });

  it('4xx ao apagar o link também é terminal', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge());
    mocks.getPayment.mockResolvedValue({ paymentId: 'pay_1', status: 'PENDING', deleted: false });
    mocks.cancelPayment.mockRejectedValue(new BillingProviderError('nao da', 'x', 400));

    await expect(
      closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT }),
    ).rejects.toBeInstanceOf(PoisonPillError);
    expect(mocks.closeCharge).not.toHaveBeenCalled();
  });
});

/**
 * ADR-051 1.5b.1 — retenção também precisa fechar o CRÉDITO no Financial.
 *
 * Não contradiz a 1.5a: na `patient_charges` "retido" continua DERIVADO (não há
 * status `retained` na cobrança, e não passa a haver). O que ganha estado é o
 * crédito, que é outro objeto — um crédito `available` é promessa sobre dinheiro
 * futuro, e deixá-lo assim faria um lançamento posterior absorver dinheiro que
 * já foi retido como taxa de falta.
 */
describe('retenção libera o crédito no Financial', () => {
  const paga = () => mocks.findOpenCharge.mockResolvedValue(charge({ status: 'paid' }));

  it('falta: retém e publica a liberação como `retained`', async () => {
    paga();

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(mocks.releaseCreditAsRetained).toHaveBeenCalledWith({
      clinicId: CLINIC,
      chargeId: 'charge-1',
      appointmentId: APPOINTMENT,
      amount: 150,
    });
    // A COBRANÇA continua sem status próprio de retenção.
    expect(mocks.closeCharge).not.toHaveBeenCalled();
  });

  it('cancelamento fora da janela também libera como `retained`', async () => {
    paga();
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'RECEIVED',
      billingType: 'PIX',
      deleted: false,
    });
    mocks.lookupAppointment.mockResolvedValue({
      scheduledAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    });

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.releaseCreditAsRetained).toHaveBeenCalledTimes(1);
  });

  it('cobrança NÃO paga não libera crédito nenhum — nunca houve', async () => {
    mocks.findOpenCharge.mockResolvedValue(charge({ status: 'pending' }));

    await closeChargeForNoShow({ clinicId: CLINIC, appointmentId: APPOINTMENT });

    expect(mocks.releaseCreditAsRetained).not.toHaveBeenCalled();
  });

  it('estorno NÃO passa por aqui: a liberação sai junto do fechamento', async () => {
    paga();
    mocks.getPayment.mockResolvedValue({
      paymentId: 'pay_1',
      status: 'RECEIVED',
      billingType: 'PIX',
      deleted: false,
    });

    await closeChargeForCancellation({
      clinicId: CLINIC,
      appointmentId: APPOINTMENT,
      cancelReason: 'user',
      cancelledAt: new Date(),
      sourceEventId: EVENT,
    });

    expect(mocks.releaseCreditAsRetained).not.toHaveBeenCalled();
    expect(mocks.queueManualDepositRefund).toHaveBeenCalledOnce();
    expect(mocks.closeCharge).not.toHaveBeenCalled();
  });
});
