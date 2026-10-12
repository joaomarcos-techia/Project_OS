'use server';

import { and, eq, sql } from 'drizzle-orm';

// eslint-disable-next-line boundaries/element-types -- billingApiV1 é a API versionada de entitlement; o contexto não lê o schema de billing.
import { billingApiV1 } from '@/contexts/billing/api';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS } from '@/lib/auth/permissions';
import { requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { idempotentMutation } from '@/lib/idempotency/mutation';
import { makeIdemKey } from '@/lib/idempotency/idem-key';
import { jsonSafe } from '@/lib/idempotency/json-safe';
import { MUTATION_IDEM_TTL_SECONDS } from '@/lib/idempotency/ttl';
import { metrics } from '@/lib/observability/metrics';

import { PaymentValidationError } from './errors';
import { getPaymentPricingPolicy } from './pricing-queries';
import {
  RemoveProcedurePaymentPriceSchema,
  SavePaymentPricingPolicySchema,
  SaveProcedurePaymentPriceSchema,
  type PaymentPricingPolicyDTO,
  type ProcedurePaymentPriceDTO,
  type SavePaymentPricingPolicyInput,
  type SaveProcedurePaymentPriceInput,
} from './pricing-types';
import { clinicPaymentPricingPolicies, procedurePaymentPrices } from './schema';

const pricingIdemKey = makeIdemKey('payments', (message) => new PaymentValidationError(message));

async function requirePricingAdmin(): Promise<void> {
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
}

async function requirePricingPlan(clinicId: string): Promise<void> {
  if (!(await billingApiV1.hasAdvancedFinancialPolicies(clinicId))) {
    throw new PaymentValidationError(
      'Preço por meio de pagamento está disponível nos planos Clínica e Pro.',
    );
  }
}

async function assertProcedureInClinic(
  tx: Tx,
  clinicId: string,
  procedureId: string,
): Promise<void> {
  const rows = await tx.execute<{ ok: number }>(sql`
    SELECT 1 AS ok FROM procedures
    WHERE id = ${procedureId} AND clinic_id = ${clinicId} AND ativo = true
    LIMIT 1
  `);
  if (!rows[0]) throw new PaymentValidationError('procedimento inválido para esta clínica');
}

export async function savePaymentPricingPolicy(
  input: SavePaymentPricingPolicyInput,
  idempotencyKey: string,
): Promise<PaymentPricingPolicyDTO> {
  const user = await requireUser();
  await requirePricingAdmin();
  const clinicId = await requireClinicId();
  await requirePricingPlan(clinicId);
  const data = SavePaymentPricingPolicySchema.parse(input);
  const ctx = await requestContext();
  const before = await getPaymentPricingPolicy(clinicId);

  await idempotentMutation(
    {
      idempotency: {
        key: pricingIdemKey('save_pricing_policy', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'payments.pricing_policy.updated',
        resourceType: 'clinic_payment_pricing_policy',
        resourceId: clinicId,
        before,
        requestContext: ctx,
      },
    },
    async (tx) => {
      if (data.mode === 'payment_method_pricing') {
        const configured = await tx.execute<{ count: number }>(sql`
          SELECT count(*)::int AS count FROM procedure_payment_prices
          WHERE clinic_id = ${clinicId} AND active = true
            AND (payment_method IN ('pix', 'cash')
              OR (payment_method = 'credit_card' AND installment_count = 1))
        `);
        if ((configured[0]?.count ?? 0) === 0) {
          throw new PaymentValidationError(
            'Cadastre ao menos um preço por método antes de ativar esta política.',
          );
        }
      }
      await tx
        .insert(clinicPaymentPricingPolicies)
        .values({ clinicId, mode: data.mode, updatedBy: user.userId })
        .onConflictDoUpdate({
          target: clinicPaymentPricingPolicies.clinicId,
          set: { mode: data.mode, updatedBy: user.userId, updatedAt: sql`now()` },
        });
      return data;
    },
  );

  metrics.emit('payments.pricing_policy.updated', { clinicId, mode: data.mode });
  return getPaymentPricingPolicy(clinicId);
}

export async function saveProcedurePaymentPrice(
  input: SaveProcedurePaymentPriceInput,
  idempotencyKey: string,
): Promise<ProcedurePaymentPriceDTO> {
  const user = await requireUser();
  await requirePricingAdmin();
  const clinicId = await requireClinicId();
  await requirePricingPlan(clinicId);
  const data = SaveProcedurePaymentPriceSchema.parse(input);
  const ctx = await requestContext();

  return idempotentMutation(
    {
      idempotency: {
        key: pricingIdemKey('save_method_price', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'payments.method_price.updated',
        resourceType: 'procedure_payment_price',
        resourceId: null,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      await assertProcedureInClinic(tx, clinicId, data.procedureId);
      const existing = await tx.execute<{ id: string }>(sql`
        SELECT id FROM procedure_payment_prices
        WHERE clinic_id = ${clinicId}
          AND procedure_id = ${data.procedureId}
          AND payment_method = ${data.paymentMethod}
          AND coalesce(installment_count, 0) = coalesce(${data.installmentCount}, 0)
          AND active = true
        FOR UPDATE
      `);
      if (existing[0]) {
        await tx
          .update(procedurePaymentPrices)
          .set({ active: false, effectiveTo: sql`now()`, updatedAt: sql`now()` })
          .where(
            and(
              eq(procedurePaymentPrices.id, existing[0].id),
              eq(procedurePaymentPrices.clinicId, clinicId),
              eq(procedurePaymentPrices.active, true),
            ),
          );
      }
      const [row] = await tx
        .insert(procedurePaymentPrices)
        .values({
          clinicId,
          procedureId: data.procedureId,
          paymentMethod: data.paymentMethod,
          installmentCount: data.installmentCount,
          grossAmount: data.grossAmount.toFixed(2),
          active: true,
          effectiveFrom: sql`now()`,
          updatedBy: user.userId,
        })
        .returning();
      if (!row) throw new Error('preço por método não foi persistido');
      return {
        id: row.id,
        procedureId: row.procedureId,
        paymentMethod: row.paymentMethod,
        installmentCount: row.installmentCount,
        grossAmount: Number(row.grossAmount),
        updatedAt: row.updatedAt.toISOString(),
      };
    },
  );
}

export async function removeProcedurePaymentPrice(
  input: { priceId: string },
  idempotencyKey: string,
): Promise<{ removed: boolean }> {
  await requireUser();
  await requirePricingAdmin();
  const clinicId = await requireClinicId();
  await requirePricingPlan(clinicId);
  const data = RemoveProcedurePaymentPriceSchema.parse(input);
  const ctx = await requestContext();
  return idempotentMutation(
    {
      idempotency: {
        key: pricingIdemKey('remove_method_price', idempotencyKey),
        payload: jsonSafe(data),
        ttlSeconds: MUTATION_IDEM_TTL_SECONDS,
      },
      audit: {
        action: 'payments.method_price.removed',
        resourceType: 'procedure_payment_price',
        resourceId: data.priceId,
        before: null,
        requestContext: ctx,
      },
    },
    async (tx) => {
      const rows = await tx
        .update(procedurePaymentPrices)
        .set({ active: false, effectiveTo: sql`now()`, updatedAt: sql`now()` })
        .where(
          and(
            eq(procedurePaymentPrices.id, data.priceId),
            eq(procedurePaymentPrices.clinicId, clinicId),
            eq(procedurePaymentPrices.active, true),
          ),
        )
        .returning({ id: procedurePaymentPrices.id });
      return { removed: rows.length > 0 };
    },
  );
}
