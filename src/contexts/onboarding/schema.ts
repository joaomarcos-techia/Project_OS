/**
 * Onboarding context — `clinic_invites` (convite mágico para criar clínica).
 *
 * Categoria (ADR-007 §10): GLOBAL PROTECTED. Convite é entidade PRÉ-clínica — não
 * tem `clinic_id` de tenant; `provisioned_clinic_id` aponta para a clínica criada
 * ao concluir o onboarding. O token NUNCA é guardado em claro: só o HMAC
 * (`token_hash`). Acesso só via dbAdmin/service_role — super_admin lê no painel; a
 * rota pública `/join` valida server-side por `token_hash` (nunca via RLS do cliente).
 *
 * `version` = optimistic concurrency (impede duas abas concluírem o mesmo convite).
 * `plan_snapshot` = preço/plano pinados no checkout (mudança futura de preço não
 * altera o acordo). `step_state` = progresso do wizard (contrato Zod em
 * internal/step-state.ts); NUNCA guarda senha nem dado de cartão.
 */
import { sql } from 'drizzle-orm';
import { integer, jsonb, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { uuidPk } from '@/lib/db/types';

export const clinicInvites = pgTable('clinic_invites', {
  id: uuidPk(),
  tokenHash: text('token_hash').notNull().unique(),
  status: text('status').notNull().default('pending'), // pending|started|completed|expired|cancelled
  version: integer('version').notNull().default(0),
  email: text('email'),
  createdBy: uuid('created_by'),
  planSnapshot: jsonb('plan_snapshot'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  provisionedClinicId: uuid('provisioned_clinic_id'),
  stepState: jsonb('step_state'),
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type ClinicInviteRow = typeof clinicInvites.$inferSelect;
export type ClinicInviteInsert = typeof clinicInvites.$inferInsert;

/**
 * `signup_sessions` — sessão anônima do cadastro autônomo (ADR-060, fatia O-2a).
 *
 * Categoria (ADR-007 §10): GLOBAL PROTECTED, como `clinic_invites`. Não tem
 * `clinic_id` porque nasce ANTES de existir clínica. Acesso só via
 * dbAdmin/service_role: a tabela não recebe grant de `anon` nem de
 * `authenticated`, e o navegador sempre passa pelos endpoints de onboarding.
 *
 * O token NUNCA é guardado em claro — só o HMAC, como no convite mágico.
 *
 * ADR-062 O-3a acrescenta staging de nomes, HMAC do e-mail e instante do aceite.
 * Nunca guarda e-mail bruto, senha, telefone ou cartão. O janitor APAGA toda a
 * linha vencida, inclusive staging pessoal; o DTO anônimo não expõe esses campos.
 *
 * `status` é `text` com CHECK, não `pgEnum`, por dois motivos:
 *   1. o CHECK lista SÓ os estados que esta fatia pode produzir, então o banco
 *      recusa uma transição fora de escopo — o congelamento vira constraint, não
 *      comentário pedindo cuidado;
 *   2. estender depois é `DROP CONSTRAINT` + `ADD CONSTRAINT`, sem a armadilha
 *      do `ALTER TYPE ... ADD VALUE` (valor novo inutilizável na mesma transação).
 *
 * NUNCA ordenar por `status` para deduzir progresso de funil: a ordem de `text`
 * é alfabética e não tem relação com a máquina de estados. A ordem do funil vive
 * no código, em `SIGNUP_FUNNEL_ORDER`.
 */
export const signupSessions = pgTable('signup_sessions', {
  id: uuidPk(),
  /** HMAC-SHA256 do token cru (32 bytes CSPRNG). O cru só existe no cookie. */
  tokenHash: text('token_hash').notNull().unique(),
  /** initiated | details_complete | identity_pending | email_pending | email_verified | expired | blocked. */
  status: text('status').notNull().default('initiated'),
  /** Faixa do classificador do §21.8. 0 nesta fatia; O-2b passa a escrever. */
  riskLevel: integer('risk_level').notNull().default(0),
  /** Contador transacional, além dos buckets do Redis. Estourou → blocked. */
  failedAttempts: integer('failed_attempts').notNull().default(0),
  /** CAS: toda escrita exige a versão lida. Aba perdedora recebe 409. */
  rowVersion: integer('row_version').notNull().default(1),
  /** 15 min de inatividade; atividade válida renova SÓ este. */
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  /** 60 min absolutos; atividade NÃO renova. */
  absoluteExpiresAt: timestamp('absolute_expires_at', { withTimezone: true }).notNull(),
  /** Preenchido quando a sessão é consumida pela identidade (fatia seguinte). */
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  /** Owner Auth verificado; sem FK porque ainda não existe profile/tenant. */
  authUserId: uuid('auth_user_id').unique(),
  /** Plano de tabela escolhido no draft; a FK cross-context vive na migration. */
  selectedPlanId: uuid('selected_plan_id'),

  /* --- O-5: intenção de assinatura recorrente (migration 0103) -------------
   * NENHUM dado de cartão entra aqui, nem cifrado. O Asaas coleta o meio na
   * página dele; o Qoro guarda só identificadores do provedor e o estado da
   * tentativa, no padrão de reserva+CAS que a 0100 criou para o envio de e-mail.
   *
   * `creation_unknown` é estado de primeira classe, não erro: o Asaas não aceita
   * Idempotency-Key em POST, então um timeout deixa indeterminado se a assinatura
   * existe. Retry cego nesse estado é como se cria cobrança duplicada. */
  /** 'reserved' | 'active' | 'creation_unknown' | 'failed' */
  billingAttemptState: text('billing_attempt_state'),
  billingAttemptedAt: timestamp('billing_attempted_at', { withTimezone: true }),
  asaasCustomerId: text('asaas_customer_id'),
  asaasCheckoutId: text('asaas_checkout_id'),
  asaasCheckoutUrl: text('asaas_checkout_url'),
  /** UNIQUE: uma assinatura pertence a no máximo um cadastro. */
  asaasSubscriptionId: text('asaas_subscription_id'),
  /** Código sanitizado. NUNCA corpo do provedor — um 4xx pode refletir o request. */
  billingFailureCode: text('billing_failure_code'),

  /* --- As QUATRO perguntas (ADR-060 §1.c.1, migration 0098) ------------
   * IMPESSOAIS por decisão: são sobre a CLÍNICA, nunca sobre a pessoa. É o que
   * permite coletá-las ANTES do consentimento, e o que mantém a propriedade de
   * que o janitor só precisa APAGAR a linha.
   *
   * Cada uma tem CHECK no banco listando as opções. A validação não vive só no
   * Zod de propósito: uma fatia futura pode afrouxar um schema sem querer, e
   * `discovery_source` em particular precisa recusar texto livre — é o que
   * impede alguém digitar o nome de quem indicou (PII de terceiro).
   *
   * NULL = ainda não respondeu. A constraint `answers_all_or_none` garante que
   * as cinco andam juntas, então não existe linha meio respondida. */
  /** '1' | '2_5' | '6_15' | '16_plus' */
  professionalsBand: text('professionals_band'),
  /** 'ate_20' | '21_50' | '51_100' | '100_plus' — faixa, nunca número livre. */
  weeklyAppointmentsBand: text('weekly_appointments_band'),
  /** 'nada_papel' | 'agenda_generica' | 'outro_sistema' */
  currentTooling: text('current_tooling'),
  /** Canal DECLARADO. Guarda o canal, nunca quem indicou. */
  discoverySource: text('discovery_source'),
  /** Distingue "abandonou no passo 0" de "respondeu e parou depois". */
  answeredAt: timestamp('answered_at', { withTimezone: true }),
  /** Staging restrito, só após aceite explícito e CAS (migration 0099). */
  ownerName: text('owner_name'),
  clinicName: text('clinic_name'),
  emailHash: text('email_hash'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  /** Reserva de envio sem senha/e-mail bruto/captcha/UUID retornado por signup. */
  authAttemptKind: text('auth_attempt_kind'),
  authAttemptState: text('auth_attempt_state'),
  authAttemptedAt: timestamp('auth_attempted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type SignupSessionRow = typeof signupSessions.$inferSelect;
export type SignupSessionInsert = typeof signupSessions.$inferInsert;

/* =====================================================================
   O-7 — onboarding OPERACIONAL (depois de a clínica existir).

   Categoria (ADR-007 §10): TENANT + USER. Diferente de `signup_sessions`
   (GLOBAL PROTECTED, pré-tenant), esta linha vive DENTRO de um tenant e
   pertence a UMA pessoa: o par (clinic_id, user_id) é a chave, e as policies
   da migration 0104 exigem os dois GUCs que `withTenant(clinic, fn, actor)`
   estabelece. Um colega da mesma clínica não lê nem escreve este progresso.

   Guarda só o que NÃO é derivável de dado: o checklist de ativação continua
   derivado de presença (dashboard/data.ts) porque derivação não tem o que
   falsificar. Tour e visitas são estado de quem usa.
   ===================================================================== */
export const onboardingProgress = pgTable('onboarding_progress', {
  clinicId: uuid('clinic_id').notNull(),
  userId: uuid('user_id').notNull(),
  /** 'not_started' | 'in_progress' | 'completed' | 'skipped' (CHECK na 0104). */
  tourState: text('tour_state').notNull().default('not_started'),
  tourStep: smallint('tour_step').notNull().default(0),
  tourStartedAt: timestamp('tour_started_at', { withTimezone: true }),
  tourFinishedAt: timestamp('tour_finished_at', { withTimezone: true }),
  docsVisitedAt: timestamp('docs_visited_at', { withTimezone: true }),
  checklistDismissedAt: timestamp('checklist_dismissed_at', { withTimezone: true }),
  /** CAS — duas abas avançando o tour é o caso comum, não o exótico. */
  rowVersion: integer('row_version').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`now()`),
});

export type OnboardingProgressRow = typeof onboardingProgress.$inferSelect;
