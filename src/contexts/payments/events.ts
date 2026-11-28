/**
 * Payments context events (ADR-049). Schemas Zod do lado PRODUTOR, registrados no
 * catálogo do outbox no load do módulo (via barrel `src/lib/db/schema/index.ts`,
 * que importa `./schema`, que por sua vez importa este arquivo).
 *
 * Regras congeladas (ADR-011):
 *   - nome em 3 segmentos `<context>.<entity>.<action>`;
 *   - payload JSON-safe: timestamp como `z.string().datetime()`, dinheiro como
 *     `z.number()`, e **só id + escalar não sensível**.
 *
 * O que NUNCA entra nestes payloads: chave do Asaas, `invoice_url` e qualquer dado
 * do paciente além do id. O outbox é uma tabela lida por operador e por worker; um
 * link de pagamento ali dentro é um link de pagamento vazado. Quem precisar do link
 * lê `patient_charges` com o escopo do tenant.
 *
 * **Ownership (R3, mesma regra do Financial): o Payments NÃO escreve `appointments`.**
 * Ele emite `payments.patient_charge.*`; quem marca `deposit_status`/`hold_expires_at`
 * e quem move a máquina de estados é o Scheduling, reagindo a estes eventos.
 */
import { z } from 'zod';

import { registerEventSchema } from '@/lib/outbox/catalog';

export const PAYMENTS_EVENTS = {
  /** Sinal gerado no gateway; a vaga passa a ficar segurada até `holdExpiresAt`. */
  CHARGE_CREATED: 'payments.patient_charge.created',
  /** O gateway recusou a criação. Não há link, não há hold — a agenda segue normal. */
  CHARGE_FAILED: 'payments.patient_charge.failed',
  /** Sinal conciliado. É o que faz a agenda CONFIRMAR o agendamento. */
  CHARGE_PAID: 'payments.patient_charge.paid',
  /**
   * A cobrança chegou a um estado terminal que a AGENDA precisa projetar
   * (ADR-049 1.5): estornada, cancelada antes do pagamento, ou expirada.
   *
   * Um evento só, com `outcome`, em vez de três: o consumidor é o mesmo, a
   * projeção é a mesma coluna, e o registry do outbox aceita **um handler por
   * evento** — três eventos exigiriam três handlers escrevendo `deposit_status`.
   *
   * **Retenção não está aqui de propósito.** "Sinal retido" (faltou, ou cancelou
   * tarde) não é estado novo: é a cobrança seguir `paid` enquanto o agendamento
   * é `faltou`/`cancelado`. Gravar um `retained` seria denormalizar um fato
   * derivável — e que passaria a mentir no dia em que a agenda for reaberta
   * (`recovery-policy`: `faltou → agendado`). O que existe para ele é métrica.
   */
  CHARGE_CLOSED: 'payments.patient_charge.closed',
  /**
   * A cobranca tem um link PAGAVEL, pronto para chegar ao paciente (1.6a).
   *
   * **Por que nao reaproveitar o `created`:** ele ja tem dono — a agenda, que o
   * usa para segurar a vaga — e o registry aceita **um handler por evento**.
   * Mas a razao de fundo e melhor que a restricao: os dois fatos sao diferentes.
   * `created` significa *a cobranca existe*; `invoiceUrl` e nullable, entao pode
   * existir cobranca sem link. Este evento significa *existe um link que o
   * paciente consegue abrir* — que e a unica condicao sob a qual faz sentido
   * mandar mensagem.
   *
   * **O link NAO viaja neste payload.** Igual a todos os outros: o outbox e uma
   * tabela lida por operador e por worker, e link de pagamento ali dentro e link
   * de pagamento vazado. O consumidor recebe o `chargeId` e resolve o link no
   * momento do envio, pelo seam do Payments — do mesmo jeito que o telefone do
   * paciente ja e resolvido no send-time e nunca persistido na fila.
   */
  CHARGE_LINK_READY: 'payments.patient_charge.link_ready',
  /**
   * ADR-051 1.5b.1 — entrou dinheiro do paciente. Evento voltado ao FINANCIAL.
   *
   * **Por que nao reusar `patient_charge.paid`:** ele ja tem dono (o Scheduling,
   * que confirma a vaga) e o registry e 1 handler por evento. Mas a razao de
   * fundo e melhor que a restricao: os dois fatos sao diferentes para dominios
   * diferentes. Para a agenda, "o sinal foi pago" significa *confirme a vaga*;
   * para o financeiro, significa *entrou dinheiro que precisa ser alocado*.
   * Nomear o evento pelo fato do consumidor e o que mantem o contrato honesto —
   * e o que impede o Financial de herdar o vocabulario do gateway.
   */
  CREDIT_GRANTED: 'payments.patient_credit.granted',
  /**
   * O Asaas passou a informar o líquido depois de a cobrança já ter sido
   * reconhecida. Não é um novo crédito: é a complementação autoritativa dos
   * fatos econômicos usados pelo Caixa e pelo repasse profissional.
   */
  PAYMENT_ECONOMICS_RECONCILED: 'payments.patient_payment.economics_reconciled',
  /** Readback posterior mudou a tarifa efetiva; não concede crédito outra vez. */
  PAYMENT_ECONOMICS_CORRECTED: 'payments.patient_payment.economics_corrected',
  /**
   * O credito saiu de `available` sem ter sido alocado a um lancamento.
   *
   * O payload carrega `disposition` EXPLICITA, nunca implicita no nome: em
   * `refunded` o dinheiro **saiu** da conta da clinica; em `retained` ele
   * **continua sendo receita**, so que sem atendimento associado. Sao fatos
   * economicamente opostos, e deixar isso implicito obrigaria o Financial a
   * inferir o fato economico a partir do nome de um evento de outro context.
   */
  CREDIT_RELEASED: 'payments.patient_credit.released',
  /** D50: o provider confirmou a devolução do excedente não alocado. */
  EXCESS_REFUND_CONFIRMED: 'payments.patient_refund.confirmed',
  /** D27: estado financeiro autoritativo do chargeback/dinheiro desfeito. */
  PATIENT_PAYMENT_RISK_CHANGED: 'payments.patient_payment.risk_changed',
  /**
   * R54: devolução feita DIRETO no Asaas (sem intenção do Qoro), confirmada pela API do
   * Asaas com a chave da clínica (estornos DONE em `GET /payments/{id}/refunds`). O
   * Financial compensa a baixa original sem apagá-la.
   */
  EXTERNAL_REFUND_RECOGNIZED: 'payments.patient_refund.external_recognized',
  /**
   * R54: o Asaas mostra devolução que o Qoro não consegue atribuir com segurança (disputa,
   * intenção ainda aberta, valor divergente). O Financial
   * só abre a pendência para revisão humana; nada é compensado.
   */
  EXTERNAL_REFUND_REVIEW_REQUIRED: 'payments.patient_refund.external_review_required',
} as const;

const uuid = z.string().uuid();
const chargeKind = z.enum(['deposit', 'remainder']);

// --- patient_charge.created -------------------------------------------------
export const PatientChargeCreatedSchema = z.object({
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  patientId: uuid.nullable(),
  kind: chargeKind,
  amount: z.number().positive(),
  /** Até quando a vaga fica segurada aguardando pagamento. */
  holdExpiresAt: z.string().datetime(),
});
export type PatientChargeCreatedPayload = z.infer<typeof PatientChargeCreatedSchema>;

// --- patient_charge.failed --------------------------------------------------
export const PatientChargeFailedSchema = z.object({
  clinicId: uuid,
  appointmentId: uuid,
  kind: chargeKind,
  amount: z.number().positive(),
  /** Código estável já sanitizado pelo adapter — nunca o corpo do provedor. */
  failureCode: z.string(),
});
export type PatientChargeFailedPayload = z.infer<typeof PatientChargeFailedSchema>;

// --- patient_charge.paid ----------------------------------------------------
export const PatientChargePaidSchema = z.object({
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  patientId: uuid.nullable(),
  kind: chargeKind,
  amount: z.number().positive(),
  paidAt: z.string().datetime(),
});
export type PatientChargePaidPayload = z.infer<typeof PatientChargePaidSchema>;

// --- patient_charge.closed --------------------------------------------------
/**
 * Como a agenda deve projetar o desfecho:
 *   `refunded`  → `appointments.deposit_status = 'refunded'` (havia dinheiro, voltou)
 *   `expired`   → `'expired'`  (o hold venceu sem pagamento)
 *   `cancelled` → `'none'`     (nunca houve dinheiro; do ponto de vista da AGENDA
 *                               não há hold nenhum — mesmo mapeamento da 0085)
 */
export const PatientChargeClosedSchema = z.object({
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  kind: chargeKind,
  outcome: z.enum(['refunded', 'cancelled', 'expired']),
  amount: z.number().positive(),
  closedAt: z.string().datetime(),
});
export type PatientChargeClosedPayload = z.infer<typeof PatientChargeClosedSchema>;

// --- patient_charge.link_ready ----------------------------------------------
/** So ids e o prazo: nada aqui identifica o paciente nem abre a cobranca. */
export const PatientChargeLinkReadySchema = z.object({
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  patientId: uuid,
  kind: chargeKind,
  amount: z.number().positive(),
  /** Ate quando o paciente tem para pagar — e o que da urgencia a mensagem. */
  holdExpiresAt: z.string().datetime(),
});
export type PatientChargeLinkReadyPayload = z.infer<typeof PatientChargeLinkReadySchema>;

// --- patient_credit.granted / .released (ADR-051) ---------------------------
const creditKind = z.enum(['deposit', 'remaining_payment']);

const PatientCreditGrantedCurrentSchema = z.object({
  /** Id da COBRANCA. E a chave de idempotencia do lado do Financial. */
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  patientId: uuid.nullable(),
  kind: creditKind,
  amount: z.number().positive(),
  /** Valor bruto confirmado pelo readback no provedor. */
  providerGrossAmount: z.number().positive(),
  /** Taxa efetiva derivada dos valores bruto/líquido autoritativos; NULL se desconhecida. */
  providerFeeAmount: z.number().nonnegative().nullable(),
  /** Valor líquido informado pelo Asaas; NULL enquanto indisponível. */
  providerNetAmount: z.number().nonnegative().nullable(),
  /** Despesa de antecipação é outro fato; não é inferida a partir do pagamento. */
  earlySettlementFeeAmount: z.number().nonnegative().nullable(),
  installmentNumber: z.number().int().positive().nullable(),
  paidAt: z.string().datetime(),
  /**
   * Codigo do catalogo `payment_methods` (`pix` | `cartao_credito`), derivado do
   * `billingType` do gateway. Nulo quando o provedor nao informa: melhor uma
   * baixa sem forma de pagamento do que uma baixa com forma inventada.
   */
  paymentMethod: z.string().nullable(),
});
/** O produtor sempre emite os campos economicos, inclusive NULL quando desconhecidos. */
export type PatientCreditGrantedPayload = z.infer<typeof PatientCreditGrantedCurrentSchema>;

// Eventos ja persistidos antes dos campos economicos continuam no outbox. O
// strict impede que um evento novo com apenas parte desses campos caia no ramo
// legado e perca dados silenciosamente durante o parse.
const PatientCreditGrantedLegacySchema = PatientCreditGrantedCurrentSchema.omit({
  providerGrossAmount: true,
  providerFeeAmount: true,
  providerNetAmount: true,
  earlySettlementFeeAmount: true,
  installmentNumber: true,
}).strict();

export const PatientCreditGrantedSchema = z.union([
  PatientCreditGrantedCurrentSchema,
  PatientCreditGrantedLegacySchema,
]);

export const PatientPaymentEconomicsReconciledSchema = z.object({
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  providerGrossAmount: z.number().positive(),
  providerFeeAmount: z.number().nonnegative().nullable(),
  providerNetAmount: z.number().nonnegative(),
  /** Antecipação continua sendo um fato separado; NULL quando não informado. */
  earlySettlementFeeAmount: z.number().nonnegative().nullable(),
  installmentNumber: z.number().int().positive().nullable(),
  paidAt: z.string().datetime(),
  paymentMethod: z.string().nullable(),
});
export type PatientPaymentEconomicsReconciledPayload = z.infer<
  typeof PatientPaymentEconomicsReconciledSchema
>;

export const PatientPaymentEconomicsCorrectedSchema = z.object({
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  providerPaymentId: z.string().min(1),
  revision: z.number().int().min(2),
  providerGrossAmount: z.number().positive(),
  providerFeeAmount: z.number().nonnegative(),
  providerNetAmount: z.number().nonnegative(),
  observedAt: z.string().datetime(),
});
export type PatientPaymentEconomicsCorrectedPayload = z.infer<
  typeof PatientPaymentEconomicsCorrectedSchema
>;

export const PatientCreditReleasedSchema = z.object({
  chargeId: uuid,
  clinicId: uuid,
  appointmentId: uuid,
  amount: z.number().positive(),
  /** `refunded` = o dinheiro saiu. `retained` = ficou, sem atendimento. */
  disposition: z.enum(['refunded', 'retained']),
  releasedAt: z.string().datetime(),
});
export type PatientCreditReleasedPayload = z.infer<typeof PatientCreditReleasedSchema>;

export const ExcessRefundConfirmedSchema = z.object({
  clinicId: uuid,
  appointmentId: uuid,
  chargeId: uuid,
  refundIntentId: uuid,
  amount: z.number().positive(),
  confirmedAt: z.string().datetime(),
});
export type ExcessRefundConfirmedPayload = z.infer<typeof ExcessRefundConfirmedSchema>;

export const PatientPaymentRiskChangedSchema = z.object({
  clinicId: uuid,
  appointmentId: uuid,
  chargeId: uuid,
  amount: z.number().positive(),
  state: z.enum([
    'requested',
    'in_dispute',
    'awaiting_reversal',
    'reversed',
    'lost',
    'cash_undone',
  ]),
  reason: z.string().max(80).nullable(),
  changedAt: z.string().datetime(),
});
export type PatientPaymentRiskChangedPayload = z.infer<typeof PatientPaymentRiskChangedSchema>;

export const ExternalRefundRecognizedSchema = z.object({
  clinicId: uuid,
  appointmentId: uuid,
  chargeId: uuid,
  /** Linha de evidência (`patient_external_refunds`) que este evento compensa. */
  externalRefundId: uuid,
  /** O que este reconhecimento acrescentou ao estorno externo da cobrança. */
  amount: z.number().positive(),
  /** Patamar acumulado devolvido por fora do Qoro depois deste reconhecimento. */
  externalTotal: z.number().positive(),
  fullRefund: z.boolean(),
  observedAt: z.string().datetime(),
});
export type ExternalRefundRecognizedPayload = z.infer<typeof ExternalRefundRecognizedSchema>;

export const ExternalRefundReviewRequiredSchema = z.object({
  clinicId: uuid,
  appointmentId: uuid,
  chargeId: uuid,
  /** Valor devolvido no Asaas que ficou sem explicação automática. */
  amount: z.number().positive(),
  reason: z.enum(['dispute', 'open_refund_intent', 'amount_mismatch', 'amount_exceeds']),
  // Sem horário de leitura: a mesma situação lida de novo (reentrega, varredura) tem de dar o
  // MESMO payload, senão a chave idempotente do outbox recusaria a segunda entrega.
});
export type ExternalRefundReviewRequiredPayload = z.infer<
  typeof ExternalRefundReviewRequiredSchema
>;

registerEventSchema(PAYMENTS_EVENTS.CHARGE_PAID, PatientChargePaidSchema);
registerEventSchema(PAYMENTS_EVENTS.CREDIT_GRANTED, PatientCreditGrantedSchema);
registerEventSchema(
  PAYMENTS_EVENTS.PAYMENT_ECONOMICS_RECONCILED,
  PatientPaymentEconomicsReconciledSchema,
);
registerEventSchema(
  PAYMENTS_EVENTS.PAYMENT_ECONOMICS_CORRECTED,
  PatientPaymentEconomicsCorrectedSchema,
);
registerEventSchema(PAYMENTS_EVENTS.CREDIT_RELEASED, PatientCreditReleasedSchema);
registerEventSchema(PAYMENTS_EVENTS.CHARGE_LINK_READY, PatientChargeLinkReadySchema);
registerEventSchema(PAYMENTS_EVENTS.CHARGE_CLOSED, PatientChargeClosedSchema);
registerEventSchema(PAYMENTS_EVENTS.CHARGE_CREATED, PatientChargeCreatedSchema);
registerEventSchema(PAYMENTS_EVENTS.CHARGE_FAILED, PatientChargeFailedSchema);
registerEventSchema(PAYMENTS_EVENTS.EXCESS_REFUND_CONFIRMED, ExcessRefundConfirmedSchema);
registerEventSchema(PAYMENTS_EVENTS.EXTERNAL_REFUND_RECOGNIZED, ExternalRefundRecognizedSchema);
registerEventSchema(
  PAYMENTS_EVENTS.EXTERNAL_REFUND_REVIEW_REQUIRED,
  ExternalRefundReviewRequiredSchema,
);
registerEventSchema(PAYMENTS_EVENTS.PATIENT_PAYMENT_RISK_CHANGED, PatientPaymentRiskChangedSchema);
