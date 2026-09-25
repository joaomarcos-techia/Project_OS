import 'server-only';

import { randomBytes } from 'node:crypto';

import { and, asc, desc, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';

/* eslint-disable boundaries/element-types -- O-4 resolve o catálogo global de Billing
   no servidor; signup_sessions continua pré-tenant e não recebe preço do browser. */
import { plans, prices } from '@/contexts/billing/schema';
/* eslint-enable boundaries/element-types */
import { signupSessions } from '@/contexts/onboarding/schema';
import { hashEmail } from '@/lib/auth/email-hash';
import { dbAdmin } from '@/lib/db';
import { env } from '@/lib/env';

import { QORO_SELF_SERVICE_TRIAL_DAYS } from '../trial';
import { signupAnswerValuesSchema, type SignupAnswerValues } from './signup-answer-values';
import { hashSignupToken, SIGNUP_ABSOLUTE_TTL_SECONDS, signupNameSchema } from './signup-session';

const userIdSchema = z.string().uuid();
const verifiedEmailSchema = z.string().max(160).email();
const signupReferenceSchema = z.string().regex(/^[a-f0-9]{64}$/u);
/**
 * Recomeço explícito: o único POST do draft depois que o e-mail foi verificado.
 *
 * Não existe modo de vínculo pelo cookie anônimo. Quem já tem um cadastro vivo é
 * reencontrado no servidor por `claimSignupDraftByVerifiedEmail`, antes de
 * qualquer formulário; este corpo só aparece quando não há nada a recuperar e a
 * pessoa reescreve tudo. Ids, versão, plano, preço, papel e tenant são recusados.
 */
export const signupDraftMutationSchema = z
  .object({
    ownerName: signupNameSchema,
    clinicName: signupNameSchema,
    answers: signupAnswerValuesSchema,
    accepted: z.literal(true),
  })
  .strict();

export interface SignupDraftState {
  status: 'email_verified';
  rowVersion: number;
  ownerName: string;
  clinicName: string;
  answers: SignupAnswerValues;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
}

export const signupPlanMutationSchema = z
  .object({
    rowVersion: z.number().int().min(1).max(2_147_483_646),
    planId: z.string().uuid(),
  })
  .strict();

export interface SignupPlan {
  id: string;
  code: string;
  name: string;
  priceCents: number;
  cycle: 'monthly';
}

export interface SignupPlanState {
  status: 'email_verified';
  rowVersion: number;
  clinicName: string;
  selectedPlanId: string | null;
  plans: SignupPlan[];
  trialDays: number;
}

/** Sem `gone`: criar não depende de linha anterior; o que falha é disputa ou gate. */
type DraftOutcome =
  | { ok: true; rowVersion: number }
  | { ok: false; reason: 'conflict' | 'unavailable' };
type DraftReadOutcome =
  | { ok: true; draft: SignupDraftState }
  | { ok: false; reason: 'gone' | 'unavailable' };
export type ClaimSignupDraftOutcome =
  | { ok: true; rowVersion: number }
  | { ok: false; reason: 'gone' | 'conflict' | 'unavailable' };
export type EnsureSignupDraftOutcome =
  | { ok: true; rowVersion: number }
  | { ok: false; reason: 'gone' | 'unavailable' };
export type OwnedSignupCredentialState = 'reserved' | 'completed' | 'uncertain' | null;
export type OwnedSignupReferenceOutcome =
  | { ok: true; signupRef: string; credentialState: OwnedSignupCredentialState }
  | { ok: false; reason: 'gone' | 'unavailable' };
type PlanWriteOutcome =
  | { ok: true; rowVersion: number; selectedPlanId: string }
  | { ok: false; reason: 'gone' | 'conflict' | 'invalid_plan' | 'unavailable' };
type PlanReadOutcome =
  | { ok: true; state: SignupPlanState }
  | { ok: false; reason: 'gone' | 'unavailable' };

function enabled(): boolean {
  return env.SIGNUP_AUTH_ENABLED && env.SIGNUP_IDENTITY_ENABLED;
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('code' in error && error.code === '23505') return true;
  return (
    'cause' in error &&
    typeof error.cause === 'object' &&
    error.cause !== null &&
    'code' in error.cause &&
    error.cause.code === '23505'
  );
}

function ownerDraftCondition(userId: string) {
  return and(
    eq(signupSessions.authUserId, userId),
    eq(signupSessions.status, 'email_verified'),
    isNotNull(signupSessions.consumedAt),
    gt(signupSessions.idleExpiresAt, sql`now()`),
    gt(signupSessions.absoluteExpiresAt, sql`now()`),
  );
}

/**
 * Referência autoritativa do draft já vinculado à identidade verificada.
 *
 * Ela nunca vai ao browser. O callback usa esta leitura para reparar uma falha
 * parcial entre o claim SQL e o rebind no Auth, e o login a usa somente para a
 * compatibilidade das contas pré-tenant criadas antes do marker em app_metadata.
 */
export async function readOwnedSignupReference(
  userId: string,
  email: string,
): Promise<OwnedSignupReferenceOutcome> {
  if (!enabled()) return { ok: false, reason: 'unavailable' };
  const identity = z.object({ userId: userIdSchema, email: verifiedEmailSchema }).safeParse({
    userId,
    email,
  });
  if (!identity.success) return { ok: false, reason: 'unavailable' };

  try {
    const [owned] = await dbAdmin
      .select({
        signupRef: signupSessions.tokenHash,
        credentialState: signupSessions.authAttemptState,
      })
      .from(signupSessions)
      .where(
        and(
          ownerDraftCondition(identity.data.userId),
          eq(signupSessions.emailHash, hashEmail(identity.data.email)),
        ),
      )
      .limit(1);
    if (!owned) return { ok: false, reason: 'gone' };
    const credentialState = owned.credentialState;
    if (
      credentialState !== null &&
      credentialState !== 'reserved' &&
      credentialState !== 'completed' &&
      credentialState !== 'uncertain'
    ) {
      return { ok: false, reason: 'unavailable' };
    }
    return {
      ok: true,
      signupRef: owned.signupRef,
      credentialState,
    };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

function priceToCents(value: string): number {
  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/u.exec(value);
  if (!match) throw new Error('[signup] invalid_catalog_price');
  const major = Number(match[1]);
  const minor = Number((match[2] ?? '').padEnd(2, '0'));
  return major * 100 + minor;
}

/** Catálogo autônomo: somente preço mensal BRL de tabela, nunca campanha de convite. */
async function listSelfServicePlans(): Promise<SignupPlan[]> {
  const rows = await dbAdmin
    .select({
      id: plans.id,
      code: plans.code,
      name: plans.name,
      amount: prices.amount,
    })
    .from(plans)
    .innerJoin(
      prices,
      and(
        eq(prices.planId, plans.id),
        eq(prices.billingCycle, 'monthly'),
        eq(prices.currency, 'BRL'),
        lte(prices.activeFrom, sql`now()`),
        isNull(prices.activeUntil),
        isNull(prices.campaignCode),
      ),
    )
    .where(eq(plans.ativo, true))
    .orderBy(asc(plans.name));

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    priceCents: priceToCents(row.amount),
    cycle: 'monthly',
  }));
}

/** Lê draft e catálogo sem renovar TTL nem aceitar preço do cliente. */
export async function readSignupPlan(userId: string): Promise<PlanReadOutcome> {
  if (!enabled() || !userIdSchema.safeParse(userId).success)
    return { ok: false, reason: 'unavailable' };

  const [draft] = await dbAdmin
    .select({
      rowVersion: signupSessions.rowVersion,
      clinicName: signupSessions.clinicName,
      selectedPlanId: signupSessions.selectedPlanId,
    })
    .from(signupSessions)
    .where(ownerDraftCondition(userId))
    .limit(1);
  if (!draft) return { ok: false, reason: 'gone' };
  if (!draft.clinicName) return { ok: false, reason: 'unavailable' };

  return {
    ok: true,
    state: {
      status: 'email_verified',
      rowVersion: draft.rowVersion,
      clinicName: draft.clinicName,
      selectedPlanId: draft.selectedPlanId,
      plans: await listSelfServicePlans(),
      trialDays: QORO_SELF_SERVICE_TRIAL_DAYS,
    },
  };
}

/** Salva apenas o plano ativo; preço e trial continuam resolvidos no servidor. */
export async function writeSignupPlan(userId: string, input: unknown): Promise<PlanWriteOutcome> {
  if (!enabled()) return { ok: false, reason: 'unavailable' };
  if (!userIdSchema.safeParse(userId).success) throw new Error('[signup] invalid_plan_owner');
  const parsed = signupPlanMutationSchema.safeParse(input);
  if (!parsed.success) throw new Error('[signup] invalid_plan');

  const { planId, rowVersion } = parsed.data;
  return dbAdmin.transaction(async (tx) => {
    const [availablePlan] = await tx
      .select({ id: plans.id })
      .from(plans)
      .innerJoin(
        prices,
        and(
          eq(prices.planId, plans.id),
          eq(prices.billingCycle, 'monthly'),
          eq(prices.currency, 'BRL'),
          lte(prices.activeFrom, sql`now()`),
          isNull(prices.activeUntil),
          isNull(prices.campaignCode),
        ),
      )
      .where(and(eq(plans.id, planId), eq(plans.ativo, true)))
      .for('share')
      .limit(1);
    if (!availablePlan) return { ok: false, reason: 'invalid_plan' };

    const [saved] = await tx
      .update(signupSessions)
      .set({
        // Sem tocar em `idle_expires_at`: num draft já vinculado ele é igual ao
        // absoluto, e `least(now() + idle, absoluto)` ENCURTARIA o prazo a cada
        // escolha de plano — a leitura autenticada não renova nada depois.
        selectedPlanId: planId,
        rowVersion: sql`${signupSessions.rowVersion} + 1`,
      })
      .where(
        and(
          ownerDraftCondition(userId),
          eq(signupSessions.rowVersion, rowVersion),
          // A reserva congela o plano que foi enviado ao provedor. Troca após
          // esse ponto permitiria provisionar outro plano com a mesma cobrança.
          // O predicado no UPDATE serializa esta escrita com a reserva por CAS.
          or(
            isNull(signupSessions.billingAttemptState),
            eq(signupSessions.billingAttemptState, 'failed'),
          ),
        ),
      )
      .returning({
        rowVersion: signupSessions.rowVersion,
        selectedPlanId: signupSessions.selectedPlanId,
      });
    if (saved?.selectedPlanId) {
      return { ok: true, rowVersion: saved.rowVersion, selectedPlanId: saved.selectedPlanId };
    }

    const [live] = await tx
      .select({
        rowVersion: signupSessions.rowVersion,
        selectedPlanId: signupSessions.selectedPlanId,
        billingAttemptState: signupSessions.billingAttemptState,
      })
      .from(signupSessions)
      .where(ownerDraftCondition(userId))
      .limit(1);
    if (!live) return { ok: false, reason: 'gone' };
    if (live.billingAttemptState !== null && live.billingAttemptState !== 'failed') {
      return { ok: false, reason: 'conflict' };
    }
    if (live.selectedPlanId === planId && live.rowVersion === rowVersion + 1) {
      return { ok: true, rowVersion: live.rowVersion, selectedPlanId: planId };
    }
    return { ok: false, reason: 'conflict' };
  });
}

/** Leitura autenticada, sem renovar nenhum dos dois TTLs. */
export async function readSignupDraft(
  userId: string,
  expectedTokenHash?: string,
): Promise<DraftReadOutcome> {
  if (!enabled() || !userIdSchema.safeParse(userId).success)
    return { ok: false, reason: 'unavailable' };
  if (expectedTokenHash && !signupReferenceSchema.safeParse(expectedTokenHash).success) {
    return { ok: false, reason: 'unavailable' };
  }
  const [row] = await dbAdmin
    .select({
      rowVersion: signupSessions.rowVersion,
      ownerName: signupSessions.ownerName,
      clinicName: signupSessions.clinicName,
      professionalsBand: signupSessions.professionalsBand,
      weeklyAppointmentsBand: signupSessions.weeklyAppointmentsBand,
      currentTooling: signupSessions.currentTooling,
      discoverySource: signupSessions.discoverySource,
      idleExpiresAt: signupSessions.idleExpiresAt,
      absoluteExpiresAt: signupSessions.absoluteExpiresAt,
    })
    .from(signupSessions)
    .where(
      and(
        ownerDraftCondition(userId),
        expectedTokenHash ? eq(signupSessions.tokenHash, expectedTokenHash) : undefined,
      ),
    )
    .limit(1);
  if (!row) return { ok: false, reason: 'gone' };
  const answers = signupAnswerValuesSchema.safeParse({
    professionalsBand: row.professionalsBand,
    weeklyAppointmentsBand: row.weeklyAppointmentsBand,
    currentTooling: row.currentTooling,
    discoverySource: row.discoverySource,
  });
  if (!answers.success || !row.ownerName || !row.clinicName) {
    return { ok: false, reason: 'unavailable' };
  }
  return {
    ok: true,
    draft: {
      status: 'email_verified',
      rowVersion: row.rowVersion,
      ownerName: row.ownerName,
      clinicName: row.clinicName,
      answers: answers.data,
      idleExpiresAt: row.idleExpiresAt.toISOString(),
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    },
  };
}

/**
 * Vincula o draft ao usuário que acabou de provar o mesmo e-mail no Auth.
 *
 * O e-mail verificado substitui com segurança o cookie anônimo quando o link é
 * aberto em outro aparelho. O candidato mais recente é travado e consumido por
 * CAS; nenhum nome, resposta ou aceite vem novamente do navegador.
 *
 * `auth_attempt_state` NÃO filtra o candidato: a constraint da migration 0100 já
 * exige tentativa em `email_pending`, e uma reserva cuja finalização se perdeu
 * (`reserved`) descreve justamente o e-mail que pode ter sido entregue. Quem
 * chega aqui carrega um OTP válido daquele endereço — recusar a reserva órfã
 * devolveria a redigitação que esta correção existe para eliminar.
 */
export async function claimSignupDraftByVerifiedEmail(
  userId: string,
  email: string,
  expectedTokenHash: string,
): Promise<ClaimSignupDraftOutcome> {
  if (!enabled()) return { ok: false, reason: 'unavailable' };
  const identity = z.object({ userId: userIdSchema, email: verifiedEmailSchema }).safeParse({
    userId,
    email,
  });
  if (!identity.success) return { ok: false, reason: 'unavailable' };
  if (!signupReferenceSchema.safeParse(expectedTokenHash).success) {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    return await dbAdmin.transaction(async (tx) => {
      // O UNIQUE(auth_user_id) inclui linhas expiradas ate o janitor remove-las.
      // Limpar o ocupante morto dentro desta mesma transacao evita que uma conta
      // Qoro pending confirmada fique impedida de adotar um draft novo.
      await tx.delete(signupSessions).where(
        and(
          eq(signupSessions.authUserId, identity.data.userId),
          // Qualquer tentativa de billing é trilha de reconciliação. Mesmo
          // `failed` pode carregar customer/failure code e não deve sumir por
          // efeito colateral de uma nova confirmação de e-mail.
          isNull(signupSessions.billingAttemptState),
          isNull(signupSessions.billingAttemptedAt),
          isNull(signupSessions.asaasCustomerId),
          isNull(signupSessions.asaasSubscriptionId),
          or(
            lte(signupSessions.idleExpiresAt, sql`now()`),
            lte(signupSessions.absoluteExpiresAt, sql`now()`),
          ),
        ),
      );

      const [owned] = await tx
        .select({ rowVersion: signupSessions.rowVersion })
        .from(signupSessions)
        .where(
          and(
            ownerDraftCondition(identity.data.userId),
            eq(signupSessions.tokenHash, expectedTokenHash),
          ),
        )
        .for('update')
        .limit(1);
      if (owned) return { ok: true, rowVersion: owned.rowVersion };

      const [candidate] = await tx
        .select({ id: signupSessions.id, rowVersion: signupSessions.rowVersion })
        .from(signupSessions)
        .where(
          and(
            eq(signupSessions.emailHash, hashEmail(identity.data.email)),
            eq(signupSessions.tokenHash, expectedTokenHash),
            eq(signupSessions.status, 'email_pending'),
            isNotNull(signupSessions.authAttemptedAt),
            isNull(signupSessions.authUserId),
            isNull(signupSessions.consumedAt),
            gt(signupSessions.absoluteExpiresAt, sql`now()`),
          ),
        )
        .orderBy(desc(signupSessions.authAttemptedAt), desc(signupSessions.createdAt))
        .for('update')
        .limit(1);
      if (!candidate) return { ok: false, reason: 'gone' };

      const [claimed] = await tx
        .update(signupSessions)
        .set({
          status: 'email_verified',
          authUserId: identity.data.userId,
          consumedAt: sql`now()`,
          // Normaliza reservas/finalizações de entrega: a partir do claim,
          // `completed` é o único estado que pode reservar a primeira mutação
          // de senha. Isso impede que um `reserved` antigo pareça uma escrita
          // de credencial já em andamento.
          authAttemptState: 'completed',
          idleExpiresAt: signupSessions.absoluteExpiresAt,
          rowVersion: sql`${signupSessions.rowVersion} + 1`,
        })
        .where(
          and(
            eq(signupSessions.id, candidate.id),
            eq(signupSessions.rowVersion, candidate.rowVersion),
            eq(signupSessions.status, 'email_pending'),
            isNull(signupSessions.authUserId),
            isNull(signupSessions.consumedAt),
          ),
        )
        .returning({ rowVersion: signupSessions.rowVersion });
      return claimed
        ? { ok: true, rowVersion: claimed.rowVersion }
        : { ok: false, reason: 'conflict' };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'conflict' };
    throw error;
  }
}

/**
 * Garante o vínculo de forma idempotente para o callback e sua página de
 * destino. A releitura cobre a corrida em que outra requisição venceu o CAS e
 * também a janela em que o SELECT do candidato já não enxerga a linha porque
 * ela acabou de ser consumida.
 */
export async function ensureSignupDraftForVerifiedEmail(
  userId: string,
  email: string,
  expectedTokenHash: string,
): Promise<EnsureSignupDraftOutcome> {
  try {
    if (!signupReferenceSchema.safeParse(expectedTokenHash).success) {
      return { ok: false, reason: 'unavailable' };
    }
    const existing = await readSignupDraft(userId, expectedTokenHash);
    if (existing.ok) return { ok: true, rowVersion: existing.draft.rowVersion };
    if (existing.reason === 'unavailable') return existing;
    const claimed = await claimSignupDraftByVerifiedEmail(userId, email, expectedTokenHash);
    if (claimed.ok) return claimed;
    if (claimed.reason === 'unavailable') return { ok: false, reason: 'unavailable' };

    const afterRace = await readSignupDraft(userId, expectedTokenHash);
    return afterRace.ok
      ? { ok: true, rowVersion: afterRace.draft.rowVersion }
      : { ok: false, reason: afterRace.reason };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export interface WriteSignupDraftInput {
  userId: string;
  email: string;
  input: unknown;
}

/**
 * Cria o draft verificado do próprio usuário; nunca cria profile, tenant, role
 * ou plano. Só chega aqui quem não tinha nada a recuperar: a linha nasce já
 * consumida, sem devolver credencial anônima nova ao navegador.
 */
export async function writeSignupDraft(args: WriteSignupDraftInput): Promise<DraftOutcome> {
  if (!enabled()) return { ok: false, reason: 'unavailable' };
  const identity = z
    .object({ userId: userIdSchema, email: verifiedEmailSchema })
    .safeParse({ userId: args.userId, email: args.email });
  const input = signupDraftMutationSchema.safeParse(args.input);
  if (!identity.success || !input.success) throw new Error('[signup] invalid_draft');

  try {
    return await dbAdmin.transaction(async (tx) => {
      const { userId, email } = identity.data;
      const data = input.data;
      await tx.delete(signupSessions).where(
        and(
          eq(signupSessions.authUserId, userId),
          // Uma linha vencida pode ter parado no meio de uma operação do
          // Asaas. Reiniciar o formulário não pode apagar a única trilha de
          // reconciliação; nesse caso o SELECT abaixo devolve conflito.
          isNull(signupSessions.billingAttemptState),
          isNull(signupSessions.billingAttemptedAt),
          isNull(signupSessions.asaasCustomerId),
          isNull(signupSessions.asaasSubscriptionId),
          or(
            lte(signupSessions.idleExpiresAt, sql`now()`),
            lte(signupSessions.absoluteExpiresAt, sql`now()`),
          ),
        ),
      );
      const [owned] = await tx
        .select({ id: signupSessions.id })
        .from(signupSessions)
        .where(eq(signupSessions.authUserId, userId))
        .limit(1);
      if (owned) return { ok: false, reason: 'conflict' };

      const [created] = await tx
        .insert(signupSessions)
        .values({
          tokenHash: hashSignupToken(randomBytes(32).toString('base64url')),
          status: 'email_verified',
          authUserId: userId,
          consumedAt: sql`now()`,
          ownerName: data.ownerName,
          clinicName: data.clinicName,
          emailHash: hashEmail(email),
          acceptedAt: sql`now()`,
          professionalsBand: data.answers.professionalsBand,
          weeklyAppointmentsBand: data.answers.weeklyAppointmentsBand,
          currentTooling: data.answers.currentTooling,
          discoverySource: data.answers.discoverySource,
          answeredAt: sql`now()`,
          // Idle igual ao absoluto, como no claim: a janela de inatividade
          // existe para limitar a credencial ANÔNIMA, e esta linha
          // já nasce consumida e presa a um usuário verificado. Mantê-la em 15
          // min com leitura que não renova (`readSignupDraft`) apagaria o
          // cadastro que a pessoa acabou de redigitar. O teto absoluto de 60
          // min continua valendo e é o único prazo desta linha.
          idleExpiresAt: sql`now() + make_interval(secs => ${SIGNUP_ABSOLUTE_TTL_SECONDS})`,
          absoluteExpiresAt: sql`now() + make_interval(secs => ${SIGNUP_ABSOLUTE_TTL_SECONDS})`,
        })
        .returning({ rowVersion: signupSessions.rowVersion });
      if (!created) throw new Error('[signup] draft_insert_failed');
      return { ok: true, rowVersion: created.rowVersion };
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, reason: 'conflict' };
    throw error;
  }
}
