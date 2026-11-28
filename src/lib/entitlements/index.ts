import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { withTenant } from '@/lib/db/tenant';
import type { TrialSql } from '@/lib/trial-access';
import {
  evaluateModuleAccess,
  OperationalAccessError,
  type OperationalModule,
  type ModuleAccess,
} from './policy';

const subscriptionSchema = z.object({
  clinic_status: z.string(),
  billing_status: z.string().nullable(),
  plan_code: z.string().nullable(),
  period_start: z.coerce.date().nullable(),
  period_end: z.coerce.date().nullable(),
  grace_until: z.coerce.date().nullable(),
  cancel_at_period_end: z.boolean(),
  enrolled: z.boolean(),
  verified_release: z.boolean(),
});

/** One authoritative commercial gate, shared by HTTP, actions and workers. No JWT/cache. */
export async function getOperationalModuleAccessTx(
  tx: TrialSql,
  clinicId: string,
  module: OperationalModule,
): Promise<ModuleAccess> {
  z.uuid().parse(clinicId);
  const rows = z
    .array(subscriptionSchema)
    .max(1)
    .parse(
      await tx.execute(sql`
    SELECT c.status::text clinic_status,s.billing_status::text,p.code plan_code,
      s.current_period_start period_start,s.current_period_end period_end,
      s.grace_period_until grace_until,coalesce(s.cancel_at_period_end,false) cancel_at_period_end,
      (ta.clinic_id IS NOT NULL) enrolled,
      (ta.released_at IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.invoices i WHERE i.id=ta.released_by_invoice_id
          AND i.clinic_id=c.id AND i.subscription_id=s.id
          AND i.status='paid' AND i.paid_at IS NOT NULL AND i.total_amount > 0
      )) verified_release
    FROM public.clinics c LEFT JOIN public.subscriptions s ON s.clinic_id=c.id
    LEFT JOIN public.plans p ON p.id=s.plan_id
    LEFT JOIN public.trial_access_policies ta ON ta.clinic_id=c.id AND ta.subscription_id=s.id
    WHERE c.id=${clinicId}::uuid
  `),
    );
  const decision = evaluateModuleAccess(rows[0] ?? null, module, new Date());
  if (!decision.allowed) return decision;
  // N/N-1 compatibility while TISS 0151 is being prepared in its own branch.
  // Once present, the shared database decision may further restrict access.
  // A missing/malformed result never means permission to execute an operation.
  const [schema] = z
    .array(z.object({ shared_gate: z.boolean() }))
    .length(1)
    .parse(
      await tx.execute(
        sql`SELECT to_regprocedure('public.qoro_premium_denial(uuid,text)') IS NOT NULL shared_gate`,
      ),
    );
  if (!schema?.shared_gate) return decision;
  const feature = module === 'patient_payments' ? 'patient_charges' : module;
  const [shared] = z
    .array(z.object({ denial: z.string().nullable() }))
    .length(1)
    .parse(
      await tx.execute(sql`SELECT public.qoro_premium_denial(${clinicId}::uuid,${feature}) denial`),
    );
  if (shared?.denial === null) return decision;
  return { allowed: false, reason: 'subscription_inactive' };
}

export function getOperationalModuleAccess(clinicId: string, module: OperationalModule) {
  return withTenant(clinicId, (tx) => getOperationalModuleAccessTx(tx, clinicId, module));
}

export async function assertOperationalModuleAccessTx(
  tx: TrialSql,
  clinicId: string,
  module: OperationalModule,
): Promise<void> {
  const decision = await getOperationalModuleAccessTx(tx, clinicId, module);
  if (!decision.allowed) throw new OperationalAccessError(module, decision.reason);
}

export async function assertOperationalModuleAccess(clinicId: string, module: OperationalModule) {
  await withTenant(clinicId, (tx) => assertOperationalModuleAccessTx(tx, clinicId, module));
}
