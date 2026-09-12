/**
 * API interna PÚBLICA do context `payments` (M14) — o contrato versionado que
 * outros contexts consomem, irmão de `schedulingApiV1`/`patientApiV1`.
 *
 * O que está aqui é deliberadamente estreito. A superfície pública do Payments
 * não devolve chave de clínica, não devolve identidade de paciente, e devolve o
 * link de pagamento **somente** enquanto ele ainda é pagável.
 */
import 'server-only';

import { findPayableCharge, type PayableCharge } from './internal/charge-store';
import { listFailedCharges, type FailedChargeDTO } from './internal/failed-charges';
import { listExcessRefundStatuses, type ExcessRefundStatus } from './internal/refund-status';

export interface PaymentsApiV1 {
  /**
   * A cobrança, só se ainda for pagável (1.6a).
   *
   * `null` quando já foi paga, estornada, cancelada, expirou ou nunca teve link.
   * A guarda mora no seam, não no chamador: quem entrega a mensagem não pode ser
   * o responsável por lembrar de perguntar se ela ainda faz sentido — mandar
   * link de cobrança já paga é o pior desfecho desta fase.
   *
   * Resolvido no **send-time**, e não carregado no payload do job, pela mesma
   * razão que o telefone do paciente também é: o link de pagamento não pode
   * ficar em repouso numa fila que operador e worker leem.
   */
  getPayableCharge(clinicId: string, chargeId: string): Promise<PayableCharge | null>;

  /** Estado sanitizado do estorno automático de excedente exibido no Caixa. */
  listExcessRefundStatuses(
    clinicId: string,
    appointmentIds: readonly string[],
  ): Promise<ExcessRefundStatus[]>;

  /**
   * Cobranças que falharam ao ser criadas — o paciente nunca recebeu link.
   * Falha silenciosa que só aparece se alguém a mostrar; o Caixa mostra.
   */
  listFailedCharges(clinicId: string): Promise<FailedChargeDTO[]>;
}

export const paymentsApiV1: PaymentsApiV1 = {
  getPayableCharge: (clinicId, chargeId) => findPayableCharge(clinicId, chargeId),
  listExcessRefundStatuses,
  listFailedCharges,
};

export type { ExcessRefundStatus, FailedChargeDTO, PayableCharge };
