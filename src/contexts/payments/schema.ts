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
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

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

/**
 * A cobrança do PACIENTE na conta Asaas da clínica. Não confundir com `invoices`
 * (billing), que é a assinatura da clínica na conta do Qoro.
 *
 * As duas travas de idempotência vivem na migration `0083` e são o contrato desta
 * tabela — sem elas, uma reentrega do worker cobraria o paciente duas vezes:
 *   - `UNIQUE (appointment_id, kind)`: um sinal por agendamento;
 *   - `UNIQUE (clinic_id, external_reference)` com referência determinística
 *     (`deposit:<appointmentId>`), que também permite RECUPERAR do Asaas uma
 *     cobrança criada num POST que deu timeout.
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
    /** Link hospedado do Asaas — é o que o paciente abre. Nunca vai para evento/log. */
    invoiceUrl: text('invoice_url'),
    externalReference: text('external_reference').notNull(),
    holdExpiresAt: timestamp('hold_expires_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
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
  }),
);

export type PatientChargeRow = typeof patientCharges.$inferSelect;

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
