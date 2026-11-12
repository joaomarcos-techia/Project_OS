import 'server-only';
import { z } from 'zod';

import { env } from '@/lib/env';
import { metrics } from '@/lib/observability/metrics';
import { createAbacatePayTransport } from '@/lib/payments/abacatepay/transport';
import { isAbacatePaySandboxRuntime } from '@/lib/payments/saas/acquisition';
import {
  GatewayReadError,
  parseBillingValue,
  opaqueBillingId,
} from '@/lib/payments/saas/contracts';
import type { ManagementDatabase } from './abacatepay-management';
import { advanceAbacatePayStatementScans } from './abacatepay-statement-scan';
import { reconcileAbacatePayMissingRenewal } from './abacatepay-renewal-recovery';

const MAX_RENEWALS = 10;
const MAX_INITIALS = 10;
const PAGE_BUDGET_MS = 6000;
const MIN_READ_BUDGET_MS = 12_000;
const PROBE_BUDGET_MS = 2000;

/** Existing cron can resume a shared cursor before selecting independent contracts.
 * No new scheduler, external POST or Production composition is introduced here.
 */
export async function reconcileAbacatePayRecoveryBatch(
  database: ManagementDatabase,
  deadlineMs: number,
  reconcileInitialPayment: (input: { deadlineMs: number }) => Promise<{
    scanned: number;
    applied: number;
    review: number;
  }>,
) {
  const result = { scanned: 0, applied: 0, failed: 0, review: 0, deferred: false, pages: 0 };
  if (!isAbacatePaySandboxRuntime() || !env.ABACATEPAY_API_KEY || !env.ABACATEPAY_STORE_ID)
    return result;
  if (!Number.isSafeInteger(deadlineMs)) throw new Error('Invalid recovery deadline');
  if (Date.now() + MIN_READ_BUDGET_MS >= deadlineMs) return { ...result, deferred: true };
  // Store IDs can be shared between modes. Attest the configured test resource
  // before a global bank-statement read; a local account label is not proof.
  const probeId = env.ABACATEPAY_SANDBOX_PROBE_PRODUCT_ID;
  if (!probeId) throw new GatewayReadError('environment_mismatch');
  const probeRequest = createAbacatePayTransport({
    apiKey: env.ABACATEPAY_API_KEY,
    storeId: env.ABACATEPAY_STORE_ID,
    timeoutMs: 1500,
    deadlineMs: Math.min(deadlineMs, Date.now() + PROBE_BUDGET_MS),
  });
  const probe = parseBillingValue(
    z.object({
      success: z.literal(true),
      data: z.object({ id: opaqueBillingId, devMode: z.boolean() }),
    }),
    await probeRequest({
      method: 'GET',
      path: '/products/get',
      params: new URLSearchParams({ id: probeId }),
    }),
  );
  if (probe.data.id !== probeId || !probe.data.devMode)
    throw new GatewayReadError('environment_mismatch');
  const initialDeadline = Math.min(deadlineMs, Date.now() + 8000);
  for (let i = 0; i < MAX_INITIALS && Date.now() + 2000 < initialDeadline; i++) {
    const initial = await reconcileInitialPayment({ deadlineMs: initialDeadline });
    result.scanned += initial.scanned;
    result.applied += initial.applied;
    result.review += initial.review;
    if (initial.scanned === 0) break;
    if (i === MAX_INITIALS - 1) result.deferred = true;
  }
  const scanDeadline = Math.min(deadlineMs, Date.now() + PAGE_BUDGET_MS);
  const scan = await advanceAbacatePayStatementScans(
    database,
    { provider: 'abacatepay', environment: 'sandbox', accountId: env.ABACATEPAY_STORE_ID },
    createAbacatePayTransport({
      apiKey: env.ABACATEPAY_API_KEY,
      storeId: env.ABACATEPAY_STORE_ID,
      timeoutMs: 1500,
      readAttempts: 2,
      deadlineMs: scanDeadline,
    }),
    { maxPages: 10, deadlineMs: scanDeadline },
  );
  result.pages = scan.pages;
  result.failed += scan.failed;
  for (let i = 0; i < MAX_RENEWALS; i++) {
    if (Date.now() + MIN_READ_BUDGET_MS >= deadlineMs) {
      result.deferred = true;
      break;
    }
    const next = await reconcileAbacatePayMissingRenewal(database, { deadlineMs });
    result.scanned += next.scanned;
    result.applied += next.applied;
    result.failed += next.failed;
    result.review += next.review;
    result.deferred ||= next.deferred;
    if (next.scanned === 0) break;
  }
  result.deferred ||= result.scanned >= MAX_RENEWALS || scan.deferred;
  metrics.emit('billing.abacatepay.recovery_batch', result);
  return result;
}
