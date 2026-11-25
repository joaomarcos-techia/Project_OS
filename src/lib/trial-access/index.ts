import 'server-only';

import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import { withTenant } from '@/lib/db/tenant';

import {
  isTrialResource,
  TrialAccessError,
  type TrialPaidFeature,
  type TrialResource,
} from './policy';

const policySchema = z.object({ released_at: z.coerce.date().nullable() });
const usageSchema = z.array(
  z.object({ metric: z.string(), consumed: z.number().int().nonnegative() }),
);
export interface TrialSql {
  execute(statement: SQL): PromiseLike<unknown>;
}
export interface TrialAccessSnapshot {
  restricted: boolean;
  usage: Partial<Record<TrialResource, number>>;
}

export async function loadTrialAccessTx(
  tx: TrialSql,
  clinicId: string,
): Promise<TrialAccessSnapshot | null> {
  const policies = z.array(policySchema).parse(
    await tx.execute(sql`
    SELECT released_at FROM public.trial_access_policies WHERE clinic_id = ${clinicId}::uuid
  `),
  );
  if (!policies[0]) return null; // Existing contracts are not enrolled retroactively.
  const rows = usageSchema.parse(
    await tx.execute(sql`
    SELECT metric, consumed FROM public.trial_resource_usage WHERE clinic_id = ${clinicId}::uuid
  `),
  );
  const usage: TrialAccessSnapshot['usage'] = {};
  for (const row of rows) {
    if (!isTrialResource(row.metric)) throw new Error('Unknown trial resource metric');
    usage[row.metric] = row.consumed;
  }
  return { restricted: policies[0].released_at === null, usage };
}

export function loadTrialAccess(clinicId: string): Promise<TrialAccessSnapshot | null> {
  return withTenant(clinicId, (tx) => loadTrialAccessTx(tx, clinicId));
}

export async function assertTrialPaidFeatureTx(
  tx: TrialSql,
  clinicId: string,
  feature: TrialPaidFeature,
): Promise<void> {
  const rows = z.array(policySchema).parse(
    await tx.execute(sql`
    SELECT released_at FROM public.trial_access_policies
    WHERE clinic_id = ${clinicId}::uuid
  `),
  );
  if (rows[0]?.released_at === null) throw new TrialAccessError(feature);
}

/** Run before any Auth, Meta or Asaas side effect, and repeat at persistence. */
export async function assertTrialPaidFeature(
  clinicId: string,
  feature: TrialPaidFeature,
): Promise<void> {
  await withTenant(clinicId, (tx) => assertTrialPaidFeatureTx(tx, clinicId, feature));
}

/**
 * Privileged worker only. Invoke after authoritative provider readback, inside
 * the same transaction that materializes the paid subscription invoice.
 * authenticated has no UPDATE grant on this table, even if it forges an invoice.
 * No callback, ACTIVE status, patient payment or browser claim releases quotas.
 */
export async function releaseTrialAfterVerifiedPaymentTx(
  tx: TrialSql,
  clinicId: string,
  invoiceId: string,
): Promise<void> {
  await tx.execute(sql`
    UPDATE public.trial_access_policies AS policy
       SET released_at = now(), released_by_invoice_id = invoice.id, updated_at = now()
      FROM public.invoices AS invoice
     WHERE policy.clinic_id = ${clinicId}::uuid AND policy.released_at IS NULL
       AND invoice.id = ${invoiceId}::uuid AND invoice.clinic_id = policy.clinic_id
       AND invoice.subscription_id = policy.subscription_id
       AND invoice.status = 'paid' AND invoice.paid_at IS NOT NULL
       AND invoice.total_amount > 0
  `);
}
