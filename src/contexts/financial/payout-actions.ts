'use server';

import { and, eq, isNull, sql } from 'drizzle-orm';

// eslint-disable-next-line boundaries/element-types -- billingApiV1 é a API versionada de entitlement; o contexto não lê o schema de billing.
import { billingApiV1 } from '@/contexts/billing/api';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { metrics } from '@/lib/observability/metrics';

import { FinancialValidationError } from './errors';
import { idemKey, jsonSafe, requestContext } from './internal/action-helpers';
import { isEligiblePayoutProfessional } from './internal/payout-professional-eligibility';
import { recordProfessionalPayoutReview } from './internal/payout-review';
import { getProfessionalPayoutPolicy } from './payout-queries';
import {
  RemoveProfessionalPayoutRuleSchema,
  ReviewProfessionalPayoutSchema,
  SaveProfessionalPayoutPolicySchema,
  SaveProfessionalPayoutRuleSchema,
  type ProfessionalPayoutPolicyDTO,
  type ProfessionalPayoutReviewDTO,
  type ProfessionalPayoutRuleDTO,
  type ReviewProfessionalPayoutInput,
  type SaveProfessionalPayoutPolicyInput,
  type SaveProfessionalPayoutRuleInput,
} from './payout-types';
import {
  clinicFinancialPolicies,
  clinicFinancialPolicyVersions,
  professionalPayoutRules,
} from './schema';

async function requirePayoutAdmin(): Promise<void> {
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
}

async function requirePayoutPlan(clinicId: string): Promise<void> {
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId))) {
    throw new FinancialValidationError(
      'Políticas de repasse estão disponíveis nos planos Clínica e Pro.',
    );
  }
}

export async function saveProfessionalPayoutPolicy(
  input: SaveProfessionalPayoutPolicyInput,
  idempotencyKey: string,
): Promise<ProfessionalPayoutPolicyDTO> {
  const user = await requireUser();
  await requirePayoutAdmin();
  const clinicId = await requireClinicId();
  await requirePayoutPlan(clinicId);
  const data = SaveProfessionalPayoutPolicySchema.parse(input);
  const ctx = await requestContext();
  const before = await getProfessionalPayoutPolicy(clinicId);

  await idempotentMutation(
    {
      idempotency: {
        key: idemKey('save_payout_policy', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'financial.payout_policy.updated',
        resourceType: 'clinic_financial_policy',
        resourceId: clinicId,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      // Materializa o default antes do lock. Sem linha, `FOR UPDATE` não trava
      // nada e duas primeiras alterações concorrentes poderiam criar versões
      // ambíguas para o mesmo instante.
      await tx
        .insert(clinicFinancialPolicies)
        .values({ clinicId, professionalPayoutBasis: 'gross', updatedBy: null })
        .onConflictDoNothing({ target: clinicFinancialPolicies.clinicId });
      const [current] = await tx
        .select({ basis: clinicFinancialPolicies.professionalPayoutBasis })
        .from(clinicFinancialPolicies)
        .where(eq(clinicFinancialPolicies.clinicId, clinicId))
        .for('update')
        .limit(1);
      if (current?.basis === data.basis) return data;

      await tx
        .update(clinicFinancialPolicies)
        .set({
          professionalPayoutBasis: data.basis,
          updatedBy: user.userId,
          updatedAt: sql`now()`,
        })
        .where(eq(clinicFinancialPolicies.clinicId, clinicId));
      await tx.insert(clinicFinancialPolicyVersions).values({
        clinicId,
        professionalPayoutBasis: data.basis,
        createdBy: user.userId,
      });
      return data;
    },
  );

  metrics.emit('financial.payout_policy.updated', { clinicId, basis: data.basis });
  return getProfessionalPayoutPolicy(clinicId);
}

async function assertRuleReferences(
  tx: Tx,
  clinicId: string,
  professionalId: string,
  procedureId: string | null,
): Promise<void> {
  if (!(await isEligiblePayoutProfessional(tx, clinicId, professionalId))) {
    throw new FinancialValidationError('profissional inválido para repasse nesta clínica');
  }
  if (procedureId) {
    const procedures = await tx.execute<{ ok: number }>(sql`
      SELECT 1 AS ok FROM procedures
      WHERE id = ${procedureId} AND clinic_id = ${clinicId} AND ativo = true
      LIMIT 1
    `);
    if (!procedures[0]) {
      throw new FinancialValidationError('procedimento inválido para esta clínica');
    }
  }
}

export async function saveProfessionalPayoutRule(
  input: SaveProfessionalPayoutRuleInput,
  idempotencyKey: string,
): Promise<ProfessionalPayoutRuleDTO> {
  const user = await requireUser();
  await requirePayoutAdmin();
  const clinicId = await requireClinicId();
  await requirePayoutPlan(clinicId);
  const data = SaveProfessionalPayoutRuleSchema.parse(input);
  const ctx = await requestContext();

  const result = await idempotentMutation(
    {
      idempotency: {
        key: idemKey('save_payout_rule', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'financial.payout_rule.updated',
        resourceType: 'professional_payout_rule',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      await assertRuleReferences(tx, clinicId, data.professionalId, data.procedureId);
      const [clock] = await tx.execute<{ now: Date | string }>(sql`SELECT now() AS now`);
      if (!clock) throw new Error('relógio do banco indisponível');
      const now = new Date(clock.now);
      await tx
        .update(professionalPayoutRules)
        .set({ effectiveTo: now, updatedAt: sql`now()` })
        .where(
          and(
            eq(professionalPayoutRules.clinicId, clinicId),
            eq(professionalPayoutRules.professionalId, data.professionalId),
            data.procedureId === null
              ? isNull(professionalPayoutRules.procedureId)
              : eq(professionalPayoutRules.procedureId, data.procedureId),
            isNull(professionalPayoutRules.effectiveTo),
          ),
        );
      const [row] = await tx
        .insert(professionalPayoutRules)
        .values({
          clinicId,
          professionalId: data.professionalId,
          procedureId: data.procedureId,
          kind: data.kind,
          percentage: data.percentage === null ? null : data.percentage.toFixed(4),
          fixedAmount: data.fixedAmount === null ? null : data.fixedAmount.toFixed(2),
          effectiveFrom: now,
          createdBy: user.userId,
        })
        .returning();
      if (!row) throw new Error('regra de repasse não foi persistida');
      return {
        id: row.id,
        professionalId: row.professionalId,
        procedureId: row.procedureId,
        kind: row.kind,
        percentage: row.percentage === null ? null : Number(row.percentage),
        fixedAmount: row.fixedAmount === null ? null : Number(row.fixedAmount),
        effectiveFrom: row.effectiveFrom.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );

  metrics.emit('financial.payout_rule.updated', {
    clinicId,
    ruleId: result.id,
    professionalId: result.professionalId,
    procedureScoped: result.procedureId !== null,
    kind: result.kind,
  });
  return result;
}

/**
 * Revisão humana do repasse suspenso após estorno ou perda. Qualquer usuário com
 * MANAGE_FINANCIAL em Clínica/Pro registra a decisão; cada uma é uma versão nova
 * e imutável. O teto e o estado do repasse são conferidos sob lock no servidor.
 */
export async function reviewProfessionalPayout(
  input: ReviewProfessionalPayoutInput,
  idempotencyKey: string,
): Promise<ProfessionalPayoutReviewDTO> {
  const user = await requireUser();
  await requirePayoutAdmin();
  const clinicId = await requireClinicId();
  await requirePayoutPlan(clinicId);
  const data = ReviewProfessionalPayoutSchema.parse(input);
  const ctx = await requestContext();

  const result = await idempotentMutation(
    {
      idempotency: {
        key: idemKey('review_payout', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'financial.professional_payout.reviewed',
        resourceType: 'professional_payout',
        resourceId: data.payoutId,
        before: null,
        requestContext: ctx,
      },
    },
    (tx) =>
      recordProfessionalPayoutReview(tx, {
        clinicId,
        payoutId: data.payoutId,
        amount: data.amount,
        reason: data.reason,
        decidedBy: user.userId,
      }),
  );

  metrics.emit('financial.professional_payout.reviewed', {
    clinicId,
    payoutId: result.payoutId,
    version: result.version,
  });
  return result;
}

export async function removeProfessionalPayoutRule(
  input: { ruleId: string },
  idempotencyKey: string,
): Promise<{ removed: boolean }> {
  const user = await requireUser();
  await requirePayoutAdmin();
  const clinicId = await requireClinicId();
  await requirePayoutPlan(clinicId);
  const data = RemoveProfessionalPayoutRuleSchema.parse(input);
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: idemKey('remove_payout_rule', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'financial.payout_rule.removed',
        resourceType: 'professional_payout_rule',
        resourceId: data.ruleId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const rows = await tx
        .update(professionalPayoutRules)
        .set({ effectiveTo: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(professionalPayoutRules.id, data.ruleId),
            eq(professionalPayoutRules.clinicId, clinicId),
            isNull(professionalPayoutRules.effectiveTo),
          ),
        )
        .returning({ id: professionalPayoutRules.id });
      metrics.emit('financial.payout_rule.removed', {
        clinicId,
        ruleId: data.ruleId,
        actorUserId: user.userId,
        removed: rows.length > 0,
      });
      return { removed: rows.length > 0 };
    },
  );
}
