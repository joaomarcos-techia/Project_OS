/**
 * Payments schema — cobrança de PACIENTE (ADR-049, Modelo B).
 *
 * Não confundir com `billing`: `billing` cobra a ASSINATURA da clínica na conta do
 * Qoro; `payments` cobra o PACIENTE na conta da própria clínica. Contextos
 * separados porque o dono do dinheiro é outro, a credencial é outra e o ciclo de
 * vida é outro.
 *
 * `clinic_payment_accounts` guarda a credencial Asaas da clínica. As garantias que
 * NÃO estão neste arquivo, e sim na migration `0081` (é lá que elas valem de fato):
 *   - `api_key_encrypted`/`api_key_hash` ficam FORA do GRANT SELECT de
 *     `authenticated` — `SELECT *` na sessão do app dá erro de permissão;
 *   - CHECK `active = false OR api_key_encrypted IS NOT NULL` — não existe conta
 *     ativa sem chave; desconectar APAGA a chave;
 *   - RLS ENABLE+FORCE com policy por `clinic_id`.
 *
 * Consequência prática para quem escrever query aqui: **nunca use `SELECT *`**.
 * Liste colunas. A leitura (`queries.ts`) e a escrita (`lib/payments/account-store.ts`)
 * já fazem isso.
 */
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

import { timestampsPattern, uuidPk } from '@/lib/db/types';

// Side-effect: registra os schemas `payments.*` no catálogo do outbox onde quer
// que `publishEvent` rode (o barrel `lib/db/schema` reexporta este arquivo).
import './events';

/* eslint-disable-next-line boundaries/element-types -- tenantIdRef vive no schema de tenancy por design (D35), mesma exceção dos demais schemas. */
import { tenantIdRef } from '@/contexts/tenancy/schema';

export const clinicPaymentAccounts = pgTable(
  'clinic_payment_accounts',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    /** Single-gateway por design (§13.15): só 'asaas'. CHECK na migration. */
    provider: text('provider').notNull().default('asaas'),
    /** service_role-only no grant. Nulo = desconectada (a chave é APAGADA, não escondida). */
    apiKeyEncrypted: text('api_key_encrypted'),
    /** service_role-only no grant. HMAC — reconhece rotação no-op sem tocar plaintext. */
    apiKeyHash: text('api_key_hash'),
    /** Bump a cada rotação: sinal para invalidar client Asaas em cache (1.3+). */
    keyVersion: integer('key_version').notNull().default(0),
    /** Nome da conta como o Asaas devolve — confirmação visual, sem PII de terceiro. */
    accountName: text('account_name'),
    active: boolean('active').notNull().default(false),
    /** Pausa novas cobranças; chave/webhook permanecem para conciliar obrigações. */
    acceptNewCharges: boolean('accept_new_charges').notNull().default(false),
    /**
     * ADR-049 1.4 — ENDEREÇO do webhook desta clínica, não segredo. Vai na URL
     * (`/api/webhooks/asaas/patient/<ref>`) para resolver qual clínica sem
     * consulta cega. NÃO é o `clinic_id`: id de tenant em URL pública vira
     * oráculo de enumeração. Fora do grant de `authenticated`.
     */
    webhookRef: uuid('webhook_ref').notNull(),
    /** O SEGREDO. Gerado por nós, configurado no Asaas da clínica, guardado cifrado. */
    webhookTokenEncrypted: text('webhook_token_encrypted'),
    webhookConfiguredAt: timestamp('webhook_configured_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    connectedBy: uuid('connected_by'),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    /**
     * Migration 0115 — quando saiu o aviso de encerramento automático da conta
     * pausada. Só vale se for posterior à última movimentação. Fora do grant de
     * `authenticated`: lida e escrita só pelo account-store.
     */
    closureNoticeSentAt: timestamp('closure_notice_sent_at', { withTimezone: true }),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('clinic_payment_accounts_clinic_id_idx').on(t.clinicId),
    /** 1 clínica = 1 conta por provider. Ver migration para o porquê de não ser no hash. */
    clinicProviderUniq: unique('clinic_payment_accounts_clinic_provider_uniq').on(
      t.clinicId,
      t.provider,
    ),
  }),
);

export type ClinicPaymentAccountRow = typeof clinicPaymentAccounts.$inferSelect;

/**
 * clinic_deposit_policy — a regra do sinal, uma linha por clínica.
 *
 * **É o gate por clínica da Camada 1** (decisão D1): não existe flag genérica por
 * tenant no sistema, então `enabled` (default `false`) é o mecanismo. Clínica sem
 * linha = sinal desligado = comportamento de hoje.
 *
 * Os CHECKs que impedem estado morto (ligada mas incapaz de cobrar) vivem na
 * migration `0082` — percentual 1..100, janela 0..720h e "ao menos um escopo
 * quando ligada". As regras que LEEM isso são funções puras em `policy.ts`.
 */
export const clinicDepositPolicy = pgTable('clinic_deposit_policy', {
  /** PK: a política é do tenant, não um histórico. Alterar é UPDATE auditado. */
  clinicId: tenantIdRef().primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  percent: integer('percent').notNull().default(50),
  /** Antecedência MÍNIMA para o cancelamento render estorno. */
  cancellationWindowHours: integer('cancellation_window_hours').notNull().default(24),
  appliesToFirstVisit: boolean('applies_to_first_visit').notNull().default(true),
  appliesToReturn: boolean('applies_to_return').notNull().default(true),
  updatedBy: uuid('updated_by'),
  ...timestampsPattern(),
});

export type ClinicDepositPolicyRow = typeof clinicDepositPolicy.$inferSelect;

export type ClinicPricingPolicyMode = 'absorb_fees';
export type ProcedurePaymentMethod = 'pix' | 'cash' | 'credit_card';

/** Legado: mantido para preservar auditoria; novas políticas só absorvem as taxas. */
export const clinicPaymentPricingPolicies = pgTable(
  'clinic_payment_pricing_policies',
  {
    clinicId: tenantIdRef().primaryKey(),
    mode: text('mode').$type<ClinicPricingPolicyMode>().notNull().default('absorb_fees'),
    updatedBy: uuid('updated_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    modeCheck: check('clinic_payment_pricing_policies_mode_chk', sql`${t.mode} = 'absorb_fees'`),
  }),
);

/**
 * Versões históricas de preços por meio. Novas versões não são cadastradas;
 * manter esta tabela preserva os vínculos e snapshots de atendimentos antigos.
 */
export const procedurePaymentPrices = pgTable(
  'procedure_payment_prices',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    procedureId: uuid('procedure_id').notNull(),
    paymentMethod: text('payment_method').$type<ProcedurePaymentMethod>().notNull(),
    installmentCount: integer('installment_count'),
    grossAmount: numeric('gross_amount', { precision: 12, scale: 2 }).notNull(),
    active: boolean('active').notNull().default(false),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).notNull().defaultNow(),
    effectiveTo: timestamp('effective_to', { withTimezone: true }),
    updatedBy: uuid('updated_by'),
    ...timestampsPattern(),
  },
  (t) => ({
    methodCheck: check(
      'procedure_payment_prices_method_chk',
      sql`${t.paymentMethod} IN ('pix', 'cash', 'credit_card')`,
    ),
    installmentCheck: check(
      'procedure_payment_prices_installment_chk',
      sql`(${t.paymentMethod} = 'credit_card' AND ${t.installmentCount} IS NOT NULL
            AND ${t.installmentCount} BETWEEN 1 AND 12)
          OR (${t.paymentMethod} IN ('pix', 'cash') AND ${t.installmentCount} IS NULL)`,
    ),
    amountCheck: check('procedure_payment_prices_amount_chk', sql`${t.grossAmount} > 0`),
    retiredCheck: check('procedure_payment_prices_retired_chk', sql`${t.active} = false`),
    effectiveWindowCheck: check(
      'procedure_payment_prices_effective_window_chk',
      sql`(${t.active} = true AND ${t.effectiveTo} IS NULL)
          OR (${t.active} = false
              AND ${t.effectiveTo} IS NOT NULL
              AND ${t.effectiveTo} >= ${t.effectiveFrom})`,
    ),
    procedureMethodUniq: uniqueIndex('procedure_payment_prices_active_method_uniq')
      .on(t.clinicId, t.procedureId, t.paymentMethod, sql`coalesce(${t.installmentCount}, 0)`)
      .where(sql`${t.active} = true`),
  }),
);

export type ClinicPaymentPricingPolicyRow = typeof clinicPaymentPricingPolicies.$inferSelect;
export type ProcedurePaymentPriceRow = typeof procedurePaymentPrices.$inferSelect;

// --- patient_charges (1.3) ---------------------------------------------------

export const patientChargeStatus = pgEnum('patient_charge_status', [
  'pending',
  'paid',
  'expired',
  'cancelled',
  'refunded',
  'failed',
]);

export const patientChargeKind = pgEnum('patient_charge_kind', ['deposit', 'remainder']);

export const patientCheckoutGenerationStatus = pgEnum('patient_checkout_generation_status', [
  'creating',
  'active',
  'creation_unknown',
  'paid',
  'cancelled',
  'expired',
  'failed',
]);

export const patientRefundIntentStatus = pgEnum('patient_refund_intent_status', [
  'pending',
  'submitting',
  'confirmation_pending',
  'confirmed',
  'failed',
]);

export const patientChargeDisputeStatus = pgEnum('patient_charge_dispute_status', [
  'requested',
  'in_dispute',
  'awaiting_reversal',
  'reversed',
  'lost',
  'cash_undone',
]);

/**
 * A cobrança do PACIENTE na conta Asaas da clínica. Não confundir com `invoices`
 * (billing), que é a assinatura da clínica na conta do Qoro.
 *
 * As duas travas de idempotência vivem na migration `0083` e são o contrato desta
 * tabela — sem elas, uma reentrega do worker cobraria o paciente duas vezes:
 *   - `UNIQUE (appointment_id, kind)`: um sinal por agendamento;
 *   - `UNIQUE (clinic_id, external_reference)` com referência determinística
 *     (`deposit:<appointmentId>`), que impede uma segunda dívida mesmo quando a
 *     criação do Checkout termina em estado indeterminado.
 */
export const patientCharges = pgTable(
  'patient_charges',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    appointmentId: uuid('appointment_id').notNull(), // FK appointments via migration
    patientId: uuid('patient_id'), // FK patients SET NULL via migration
    kind: patientChargeKind('kind').notNull().default('deposit'),
    status: patientChargeStatus('status').notNull().default('pending'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    provider: text('provider').notNull().default('asaas'),
    /** Id da cobrança no Asaas. Público (não é credencial). */
    providerPaymentId: text('provider_payment_id'),
    /** Snapshot econômico autoritativo, preenchido somente após readback no Asaas. */
    providerGrossAmount: numeric('provider_gross_amount', { precision: 12, scale: 2 }),
    providerFeeAmount: numeric('provider_fee_amount', { precision: 12, scale: 2 }),
    providerNetAmount: numeric('provider_net_amount', { precision: 12, scale: 2 }),
    earlySettlementFeeAmount: numeric('early_settlement_fee_amount', {
      precision: 12,
      scale: 2,
    }),
    providerBillingType: text('provider_billing_type'),
    providerInstallmentId: text('provider_installment_id'),
    providerInstallmentNumber: integer('provider_installment_number'),
    /** Condição comercial escolhida antes do Checkout; snapshot auditável. */
    requestedPaymentMethod: text('requested_payment_method').$type<ProcedurePaymentMethod>(),
    requestedInstallmentCount: integer('requested_installment_count'),
    economicsReconciledAt: timestamp('economics_reconciled_at', { withTimezone: true }),
    /** 0 = desconhecido; 1 = primeira leitura; cada correção autoritativa incrementa. */
    providerEconomicsRevision: integer('provider_economics_revision').notNull().default(0),
    /** Ultima tentativa do backstop, para alternar candidatos sem bloquear a fila. */
    providerReconcileCheckedAt: timestamp('provider_reconcile_checked_at', { withTimezone: true }),
    /** R54 (0160): cursor da varredura de estorno feito direto no Asaas (webhook perdido). */
    refundCheckedAt: timestamp('refund_checked_at', { withTimezone: true }),
    /** Geração corrente do Checkout hospedado; não é a dívida nem o payment. */
    providerCheckoutId: text('provider_checkout_id'),
    checkoutGeneration: integer('checkout_generation').notNull().default(0),
    checkoutExpiresAt: timestamp('checkout_expires_at', { withTimezone: true }),
    /** Fim da promessa de cobrança; pode abranger várias gerações de até 24h. */
    collectionExpiresAt: timestamp('collection_expires_at', { withTimezone: true }),
    /** Link hospedado do Asaas — é o que o paciente abre. Nunca vai para evento/log. */
    invoiceUrl: text('invoice_url'),
    externalReference: text('external_reference').notNull(),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    /** Projeção operacional do chargeback; o fato clínico permanece intocado. */
    disputeStatus: patientChargeDisputeStatus('dispute_status'),
    /** Código estável do provedor, já sanitizado. Nunca o corpo bruto. */
    failureCode: text('failure_code'),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('patient_charges_clinic_id_idx').on(t.clinicId),
    appointmentIdx: index('patient_charges_appointment_idx').on(t.appointmentId),
    appointmentKindUniq: unique('patient_charges_appointment_kind_uniq').on(
      t.appointmentId,
      t.kind,
    ),
    externalReferenceUniq: unique('patient_charges_external_reference_uniq').on(
      t.clinicId,
      t.externalReference,
    ),
    providerCheckoutUniq: uniqueIndex('patient_charges_provider_checkout_uniq')
      .on(t.clinicId, t.providerCheckoutId)
      .where(sql`${t.providerCheckoutId} is not null`),
    providerPaymentUniq: uniqueIndex('patient_charges_provider_payment_uniq')
      .on(t.clinicId, t.providerPaymentId)
      .where(sql`${t.providerPaymentId} is not null`),
    checkoutRenewalIdx: index('patient_charges_checkout_renewal_idx')
      .on(t.checkoutExpiresAt, t.collectionExpiresAt)
      .where(sql`${t.status} = 'pending' and ${t.providerCheckoutId} is not null`),
    pendingEconomicsScanIdx: index('patient_charges_pending_economics_scan_idx')
      .on(t.providerReconcileCheckedAt.asc().nullsFirst(), t.paidAt.asc().nullsFirst(), t.id)
      .where(
        sql`${t.status} = 'paid' and ${t.providerPaymentId} is not null and ${t.economicsReconciledAt} is null`,
      ),
    refundCheckIdx: index('patient_charges_refund_check_idx')
      .on(t.refundCheckedAt.asc().nullsFirst(), t.paidAt.desc())
      .where(sql`${t.status} = 'paid' and ${t.providerPaymentId} is not null`),
    pendingMismatchScanIdx: index('patient_charges_pending_mismatch_scan_idx')
      .on(t.providerReconcileCheckedAt.asc().nullsFirst(), t.updatedAt, t.id)
      .where(
        sql`${t.status} = 'pending' and ${t.providerPaymentId} is not null and ${t.failureCode} in ('payment_method_mismatch', 'payment_installment_mismatch', 'payment_amount_mismatch')`,
      ),
    requestedPaymentChk: check(
      'patient_charges_requested_payment_chk',
      sql`(${t.requestedPaymentMethod} IS NULL AND ${t.requestedInstallmentCount} IS NULL)
          OR (${t.requestedPaymentMethod} IS NOT NULL AND (
            (${t.requestedPaymentMethod} = 'pix' AND ${t.requestedInstallmentCount} IS NULL)
            OR (${t.requestedPaymentMethod} = 'credit_card'
              AND ${t.requestedInstallmentCount} IS NOT NULL
              AND ${t.requestedInstallmentCount} BETWEEN 1 AND 12)))`,
    ),
    economicsChk: check(
      'patient_charges_economics_nonnegative_chk',
      sql`(${t.providerGrossAmount} IS NULL OR (${t.providerGrossAmount} >= 0 AND ${t.providerGrossAmount} = ${t.amount}))
          AND (${t.providerFeeAmount} IS NULL OR (${t.providerGrossAmount} IS NOT NULL AND ${t.providerFeeAmount} >= 0 AND ${t.providerFeeAmount} <= ${t.providerGrossAmount}))
          AND (${t.providerNetAmount} IS NULL OR (${t.providerGrossAmount} IS NOT NULL AND ${t.providerNetAmount} >= 0 AND ${t.providerNetAmount} <= ${t.providerGrossAmount}))
          AND (${t.earlySettlementFeeAmount} IS NULL OR ${t.earlySettlementFeeAmount} >= 0)
          AND (${t.providerInstallmentNumber} IS NULL OR ${t.providerInstallmentNumber} > 0)
          AND (${t.economicsReconciledAt} IS NULL OR (
            ${t.providerGrossAmount} IS NOT NULL
            AND ${t.providerFeeAmount} IS NOT NULL
            AND ${t.providerNetAmount} IS NOT NULL
          ))`,
    ),
  }),
);

export type PatientChargeRow = typeof patientCharges.$inferSelect;

/**
 * Histórico operacional dos links hospedados de uma cobrança.
 *
 * O lease torna o POST exclusivo; `creation_unknown` é terminal para retry
 * automático porque o Asaas não oferece consulta/idempotency-key de Checkout.
 */
export const patientCheckoutGenerations = pgTable(
  'patient_checkout_generations',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientChargeId: uuid('patient_charge_id')
      .notNull()
      .references(() => patientCharges.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    externalReference: text('external_reference').notNull(),
    status: patientCheckoutGenerationStatus('status').notNull().default('creating'),
    providerCheckoutId: text('provider_checkout_id'),
    checkoutUrl: text('checkout_url'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    ...timestampsPattern(),
  },
  (t) => ({
    chargeGenerationUniq: unique('patient_checkout_generations_charge_generation_uniq').on(
      t.patientChargeId,
      t.generation,
    ),
    externalReferenceUniq: unique('patient_checkout_generations_external_reference_uniq').on(
      t.clinicId,
      t.externalReference,
    ),
    providerCheckoutUniq: uniqueIndex('patient_checkout_generations_provider_checkout_uniq')
      .on(t.clinicId, t.providerCheckoutId)
      .where(sql`${t.providerCheckoutId} is not null`),
    oneOpenUniq: uniqueIndex('patient_checkout_generations_one_open_uniq')
      .on(t.patientChargeId)
      .where(sql`${t.status} in ('creating', 'active', 'creation_unknown')`),
    renewalIdx: index('patient_checkout_generations_renewal_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'active'`),
  }),
);

export type PatientCheckoutGenerationRow = typeof patientCheckoutGenerations.$inferSelect;

// --- patient_refund_intents (D50) -----------------------------------------

/**
 * Intenção persistida antes de solicitar ou acompanhar uma devolução.
 *
 * `submitting`/`confirmation_pending` nunca voltam automaticamente a `pending`:
 * no fluxo legado, um timeout pode esconder um POST aceito e repetir seria
 * devolver duas vezes. No fluxo manual, a clínica age na própria conta Asaas.
 */
export const patientRefundIntents = pgTable(
  'patient_refund_intents',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientChargeId: uuid('patient_charge_id')
      .notNull()
      .references(() => patientCharges.id, { onDelete: 'restrict' }),
    purpose: text('purpose').notNull().default('excess'),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    status: patientRefundIntentStatus('status').notNull().default('pending'),
    providerPaymentId: text('provider_payment_id').notNull(),
    providerRefundId: text('provider_refund_id'),
    baselineRefundedAmount: numeric('baseline_refunded_amount', { precision: 12, scale: 2 }),
    baselineRefundCount: integer('baseline_refund_count'),
    baselineRejectedRefundCount: integer('baseline_rejected_refund_count'),
    attemptedAt: timestamp('attempted_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    sourceEventId: uuid('source_event_id').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    chargePurposeUniq: unique('patient_refund_intents_charge_purpose_uniq').on(
      t.clinicId,
      t.patientChargeId,
      t.purpose,
    ),
    sourceEventUniq: unique('patient_refund_intents_source_event_uniq').on(
      t.clinicId,
      t.sourceEventId,
    ),
    providerRefundUniq: uniqueIndex('patient_refund_intents_provider_refund_uniq')
      .on(t.clinicId, t.providerRefundId)
      .where(sql`${t.providerRefundId} is not null`),
    reconcileIdx: index('patient_refund_intents_reconcile_idx')
      .on(t.updatedAt)
      .where(sql`${t.status} in ('submitting', 'confirmation_pending')`),
  }),
);

export type PatientRefundIntentRow = typeof patientRefundIntents.$inferSelect;

// --- patient_external_refunds (R54, 0160) -----------------------------------

/**
 * Evidência de estorno feito DIRETO no Asaas (sem intenção do Qoro), só de inclusão.
 *
 * Uma linha por patamar acumulado devolvido por fora do Qoro: o item de estorno do Asaas
 * pode vir sem id, então a chave idempotente é `external_total` — reentrega do webhook,
 * varredura e duas instâncias concorrentes caem no mesmo UNIQUE. `evidence` guarda só
 * status, valor e data dos estornos lidos em `GET /payments/{id}/refunds`.
 */
export const patientExternalRefunds = pgTable(
  'patient_external_refunds',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientChargeId: uuid('patient_charge_id')
      .notNull()
      .references(() => patientCharges.id, { onDelete: 'restrict' }),
    appointmentId: uuid('appointment_id').notNull(),
    providerPaymentId: text('provider_payment_id').notNull(),
    externalTotal: numeric('external_total', { precision: 12, scale: 2 }).notNull(),
    amount: numeric('amount', { precision: 12, scale: 2 }).notNull(),
    providerRefundedTotal: numeric('provider_refunded_total', {
      precision: 12,
      scale: 2,
    }).notNull(),
    intentsClaimed: numeric('intents_claimed', { precision: 12, scale: 2 }).notNull(),
    providerStatus: text('provider_status').notNull(),
    fullRefund: boolean('full_refund').notNull(),
    source: text('source').$type<'webhook' | 'reconcile'>().notNull(),
    asaasEventId: text('asaas_event_id'),
    evidence: jsonb('evidence').$type<ExternalRefundEvidenceItem[]>().notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    levelUniq: unique('patient_external_refunds_level_uniq').on(
      t.clinicId,
      t.patientChargeId,
      t.externalTotal,
    ),
    chargeIdx: index('patient_external_refunds_charge_idx').on(
      t.clinicId,
      t.patientChargeId,
      t.externalTotal.desc(),
    ),
  }),
);

/** Item da evidência: o que a API do Asaas devolveu, sem dado pessoal. */
export interface ExternalRefundEvidenceItem {
  status: string;
  value: number;
  dateCreated: string | null;
}

export type PatientExternalRefundRow = typeof patientExternalRefunds.$inferSelect;

// --- patient_payment_customers (ADR-050) -------------------------------------

/**
 * Mapa paciente → customer na conta Asaas DA CLÍNICA.
 *
 * Guarda **só o id do customer**. Nome e CPF não são copiados para cá: eles já
 * vivem em `patients`, cifrados. Duplicar PII para "facilitar" seria criar um
 * segundo lugar por onde ela pode vazar.
 *
 * `UNIQUE (clinic_id, patient_id, provider)` é a trava de idempotência — sem ela,
 * uma reentrega do worker criaria um segundo customer para a mesma pessoa e a
 * conciliação da clínica passaria a enxergar dois pagadores para um paciente.
 *
 * Sem UPDATE/DELETE no grant (migration 0084): vínculo financeiro não se
 * sobrescreve em silêncio.
 */
export const patientPaymentCustomers = pgTable(
  'patient_payment_customers',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    patientId: uuid('patient_id').notNull(), // FK patients CASCADE via migration
    provider: text('provider').notNull().default('asaas'),
    providerCustomerId: text('provider_customer_id').notNull(),
    ...timestampsPattern(),
  },
  (t) => ({
    clinicIdx: index('patient_payment_customers_clinic_id_idx').on(t.clinicId),
    uniq: unique('patient_payment_customers_uniq').on(t.clinicId, t.patientId, t.provider),
  }),
);

export type PatientPaymentCustomerRow = typeof patientPaymentCustomers.$inferSelect;

/**
 * Dedup dos webhooks de paciente.
 *
 * Tabela própria (e não a `processed_webhooks` do billing) por uma razão concreta:
 * lá a chave é só o id do evento, o que assume um emissor único. Aqui os emissores
 * são N contas Asaas diferentes, e nada garante que dois provedores nunca repitam
 * um id. A chave é `(clinic_id, asaas_event_id)`.
 */
export const patientWebhookEvents = pgTable(
  'patient_webhook_events',
  {
    id: uuidPk(),
    clinicId: tenantIdRef(),
    asaasEventId: text('asaas_event_id').notNull(),
    eventType: text('event_type').notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    clinicIdx: index('patient_webhook_events_clinic_idx').on(t.clinicId, t.processedAt),
    uniq: unique('patient_webhook_events_uniq').on(t.clinicId, t.asaasEventId),
  }),
);

export type PatientWebhookEventRow = typeof patientWebhookEvents.$inferSelect;
