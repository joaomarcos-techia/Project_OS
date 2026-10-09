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
import { previewDepositForBooking } from './internal/deposit-preview';
import {
  listPatientChargeStatuses,
  type PatientChargeStatus,
} from './internal/patient-charge-status';
import { listFailedCharges, type FailedChargeDTO } from './internal/failed-charges';
import {
  listExcessRefundStatuses,
  listManualRefundTasks,
  type ExcessRefundStatus,
  type ManualRefundTask,
} from './internal/refund-status';
import {
  listPatientChargeEconomics,
  type PatientChargeEconomicsDTO,
} from './internal/charge-economics';

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
  /** Devoluções de pacientes que a clínica deve conferir e executar na própria conta. */
  listManualRefundTasks(clinicId: string): Promise<ManualRefundTask[]>;

  /**
   * Cobranças que falharam ao ser criadas — o paciente nunca recebeu link.
   * Falha silenciosa que só aparece se alguém a mostrar; o Caixa mostra.
   */
  listFailedCharges(clinicId: string): Promise<FailedChargeDTO[]>;
  /** Fatos individuais da cobrança para a transparência do Caixa em todos os planos. */
  listPatientChargeEconomics(
    clinicId: string,
    appointmentIds: readonly string[],
  ): Promise<PatientChargeEconomicsDTO[]>;
  /**
   * O sinal que um agendamento novo vai cobrar, sem efeito (08/10/2026). O
   * agente explica no resumo que o horário só se confirma com o sinal pago pelo
   * link e não oferece "tudo em dinheiro" quando há sinal.
   */
  previewDepositForBooking(input: {
    clinicId: string;
    patientId: string | null;
    basePrice: number;
    /** O paciente já tem outro agendamento? Só é chamado com a política ligada. */
    isReturnVisit: () => Promise<boolean>;
    scheduledAt?: Date;
  }): Promise<{ amount: number } | null>;
  /**
   * Status real das cobranças recentes do paciente, para o agente responder
   * "já paguei" (08/10/2026). Sem link e sem dado do provedor.
   */
  listPatientChargeStatuses(clinicId: string, patientId: string): Promise<PatientChargeStatus[]>;
}

export const paymentsApiV1: PaymentsApiV1 = {
  getPayableCharge: (clinicId, chargeId) => findPayableCharge(clinicId, chargeId),
  listExcessRefundStatuses,
  listManualRefundTasks,
  listFailedCharges,
  listPatientChargeEconomics,
  previewDepositForBooking,
  listPatientChargeStatuses: (clinicId, patientId) => listPatientChargeStatuses(clinicId, patientId),
};

export type {
  ExcessRefundStatus,
  FailedChargeDTO,
  ManualRefundTask,
  PatientChargeEconomicsDTO,
  PatientChargeStatus,
  PayableCharge,
};
