// Superfície pública do context `payments` (ADR-049 — cobrança de PACIENTE).
// Outros contexts só podem importar deste arquivo (eslint-plugin-boundaries).
//
// Não confundir com `billing`: aquele cobra a ASSINATURA da clínica na conta do
// Qoro; este cobra o PACIENTE na conta da própria clínica.
//
// O que NÃO está aqui, de propósito: nada que leia ou devolva a chave da clínica.
// A credencial em claro existe apenas dentro da Server Action que a recebe; a
// leitura decifrada só nascerá quando houver um consumidor real (1.3), com teste
// próprio — função que decifra segredo sem chamador é superfície de ataque de graça.
export {
  clinicDepositPolicy,
  clinicPaymentAccounts,
  clinicPaymentPricingPolicies,
  procedurePaymentPrices,
  type ClinicDepositPolicyRow,
  type ClinicPaymentAccountRow,
} from './schema';
export type { ClinicPricingPolicyMode, ProcedurePaymentMethod } from './schema';
export {
  DEPOSIT_POLICY_OFF,
  isRefundableCancellation,
  resolveDepositAmount,
  type DepositPolicy,
} from './policy';
export { getDepositPolicy, getPaymentAccountStatus } from './queries';
export { getPaymentAccountFees } from './account-fees';
export type { AsaasAccountFees } from '@/lib/payments/asaas';
export {
  ConnectPaymentAccountSchema,
  EMPTY_PAYMENT_ACCOUNT,
  SaveDepositPolicySchema,
  type ConnectPaymentAccountResult,
  type ConnectPaymentAccountInput,
  type DepositPolicyDTO,
  type PaymentAccountClosureDTO,
  type PaymentAccountStatusDTO,
  type PaymentWebhookConfigurationIssue,
  type SaveDepositPolicyInput,
} from './types';
export { PaymentCredentialRejectedError, PaymentProviderUnavailableError } from './errors';
export type {
  PaymentPricingPolicyDTO,
  ProcedurePaymentPriceDTO,
  SavePaymentPricingPolicyInput,
  SaveProcedurePaymentPriceInput,
} from './pricing-types';
export {
  getEffectivePaymentPricingMode,
  getPaymentPricingPolicy,
  listProcedurePaymentPrices,
  matchesConfiguredProcedurePriceSnapshot,
  resolveConfiguredProcedurePaymentPrice,
} from './pricing-queries';
export { PAYMENTS_EVENTS } from './events';
export type {
  PatientChargeClosedPayload,
  PatientChargeCreatedPayload,
  PatientCreditGrantedPayload,
  PatientCreditReleasedPayload,
  PatientChargeLinkReadyPayload,
  PatientChargeFailedPayload,
  PatientChargePaidPayload,
  ExcessRefundConfirmedPayload,
  PatientPaymentRiskChangedPayload,
} from './events';
export type { PatientPaymentEconomicsReconciledPayload } from './events';
export type { PatientPaymentEconomicsCorrectedPayload } from './events';
export {
  paymentsApiV1,
  type ExcessRefundStatus,
  type FailedChargeDTO,
  type ManualRefundTask,
  type PatientChargeEconomicsDTO,
  type PatientChargeStatus,
  type PayableCharge,
  type PaymentsApiV1,
} from './api';
