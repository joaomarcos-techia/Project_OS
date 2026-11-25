/** Retained synthetic Sandbox fixture only. GET + READ ONLY; no recovery commands. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { parse } from 'dotenv';
import { z } from 'zod';
import { guardedDevDatabase, readSession } from './abacatepay-checkout-session';
import { summarizeRenewalObservation } from './abacatepay-renewal-observation';
import { GatewayReadError } from '../src/lib/payments/saas/contracts';

const iso = z.iso.datetime({ offset: true });
const snapshotSchema = z.object({
  clinic_id: z.uuid(),
  subscription_id: z.uuid(),
  customer_id: z.string().startsWith('cust_'),
  remote_id: z.string().startsWith('subs_'),
  product_id: z.string().startsWith('prod_'),
  amount_minor: z.coerce.number().int().positive(),
  status: z.string(),
  initial_end: iso,
  period_end: iso,
  initial_consistent: z.boolean(),
  closure_confirmed: z.boolean(),
  cycles: z
    .array(
      z.object({
        paymentId: z.string(),
        invoiceId: z.uuid(),
        periodEnd: iso,
        consistent: z.boolean(),
        accessEffect: z.enum(['advanced', 'historical', 'review']),
      }),
    )
    .max(1200),
  inbox: z.array(
    z.object({ type: z.string(), state: z.string(), count: z.number().int().nonnegative() }),
  ),
});
let stage = 'arguments';
async function main() {
  const { values } = parseArgs({
    options: {
      session: { type: 'string' },
      'settings-file': { type: 'string', default: 'C:/dev/ClinicaOS_V2/.env.local' },
    },
    strict: true,
  });
  const slot = z
    .string()
    .regex(/^next-checkout-[a-z0-9-]{1,50}$/)
    .parse(values.session);
  const base = z.string().min(1).parse(process.env.LOCALAPPDATA);
  assert.ok(path.isAbsolute(base));
  const session = await readSession(path.join(base, 'Qoro', 'SandboxBilling', slot));
  assert.ok(
    session?.phase === 'verified' && session.userId && session.checkoutId,
    'Only an already verified retained fixture can be observed',
  );
  const settings = parse(await readFile(values['settings-file'], 'utf8'));
  const url = guardedDevDatabase(z.string().min(1).parse(settings.DATABASE_URL_DEV));
  // Bind before importing the existing central pool. Never fall back to live.
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url,
    DATABASE_URL_RUNTIME: url,
    SUPABASE_PROJECT_ENV: 'dev',
    NEXT_PUBLIC_SUPABASE_URL: 'https://pqhkirrszzpwezdaqrai.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic_observer_import_only',
  });
  delete process.env.DATABASE_URL_PROD;
  delete process.env.VERCEL_ENV;
  const { dbAdmin } = await import('../src/lib/db');
  const sql = dbAdmin.$client;
  try {
    async function snapshot() {
      return sql.begin(async (tx) => {
        await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
        await tx`SET LOCAL statement_timeout='10s'`;
        const rows = await tx`SELECT s.clinic_id::text,s.id::text subscription_id,
          b.external_customer_id customer_id,b.external_subscription_id remote_id,
          intent.product_id,intent.amount_minor::text,s.billing_status status,
          to_char(p.period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') initial_end,
          to_char(s.current_period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') period_end,
          (i.status='paid' AND i.total_amount=intent.amount_minor/100.0 AND t.released_by_invoice_id=i.id
            AND t.released_at IS NOT NULL) initial_consistent,
          EXISTS(SELECT 1 FROM billing_gateway.operations o WHERE o.account_id=a.id
            AND o.subscription_id=s.id AND o.clinic_id=s.clinic_id AND o.kind='close_paid_checkout'
            AND o.business_key=b.external_checkout_id AND o.state='confirmed') closure_confirmed,
          coalesce((SELECT jsonb_agg(jsonb_build_object('paymentId',c.payment_id,'invoiceId',c.invoice_id,
            'periodEnd',to_char(c.period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'accessEffect',c.access_effect,'consistent',
              ci.status='paid' AND ci.total_amount=obs.amount_minor/100.0
              AND ci.clinic_id=s.clinic_id AND ci.subscription_id=s.id
              AND obs.external_customer_id=b.external_customer_id AND obs.origin_checkout_id=b.external_checkout_id
              AND obs.external_subscription_id=b.external_subscription_id
              AND (SELECT count(*) FROM public.payment_attempts pa WHERE pa.invoice_id=ci.id
                AND pa.clinic_id=s.clinic_id AND pa.provider='abacatepay' AND pa.status='confirmed'
                AND pa.provider_payment_id=concat('["abacatepay","sandbox",',to_json(a.external_account_id)::text,',"payment",',to_json(c.payment_id)::text,']')
              )=1) ORDER BY c.cycle_index)
            FROM billing_gateway.recurring_access_periods c
            JOIN billing_gateway.recurring_payment_observations obs ON obs.account_id=c.account_id AND obs.payment_id=c.payment_id
            JOIN public.invoices ci ON ci.id=c.invoice_id
            WHERE c.account_id=a.id AND c.subscription_id=s.id AND c.clinic_id=s.clinic_id
              AND c.external_subscription_id=b.external_subscription_id),'[]'::jsonb) cycles
          FROM public.subscriptions s JOIN public.profiles owner ON owner.clinic_id=s.clinic_id
          JOIN auth.users identity ON identity.id=owner.id
          JOIN billing_gateway.bindings b ON b.subscription_id=s.id AND b.clinic_id=s.clinic_id
          JOIN billing_gateway.accounts a ON a.id=b.account_id
          JOIN billing_gateway.checkout_intents intent ON intent.account_id=a.id AND intent.subscription_id=s.id AND intent.clinic_id=s.clinic_id
          JOIN billing_gateway.paid_checkouts p ON p.account_id=a.id AND p.subscription_id=s.id AND p.clinic_id=s.clinic_id AND p.checkout_id=b.external_checkout_id
          JOIN public.invoices i ON i.id=p.invoice_id AND i.subscription_id=s.id AND i.clinic_id=s.clinic_id
          JOIN public.trial_access_policies t ON t.subscription_id=s.id AND t.clinic_id=s.clinic_id
          WHERE owner.id=${session!.userId}::uuid AND owner.role='owner' AND owner.ativo
            AND identity.raw_user_meta_data->>'qoro_fixture_run'=${session!.runId}
            AND s.billing_provider='abacatepay' AND s.asaas_subscription_id IS NULL
            AND a.provider='abacatepay' AND a.environment='sandbox'
            AND b.external_checkout_id=${session!.checkoutId}
            AND encode(sha256(convert_to(a.external_account_id,'UTF8')),'hex')=${session!.storeHash}`;
        assert.equal(rows.length, 1, 'Fixture binding missing or changed');
        const row = rows[0]!;
        const inbox =
          await tx`SELECT event_type type,state,count(*)::int count FROM billing_gateway.event_inbox
          WHERE subscription_id=${row.subscription_id}::uuid AND clinic_id=${row.clinic_id}::uuid
          GROUP BY event_type,state ORDER BY event_type,state`;
        return snapshotSchema.parse({ ...row, inbox });
      });
    }
    stage = 'guarded_read_only_snapshot';
    const before = await snapshot();
    assert.equal(before.product_id, session.productId);
    assert.equal(before.amount_minor, session.amountMinor);
    const { createAbacatePayReadClient } = await import('../src/lib/payments/abacatepay/reader');
    const reader = createAbacatePayReadClient({
      apiKey: z.string().min(1).parse(settings.ABACATEPAY_API_KEY),
      environment: 'sandbox',
      timeoutMs: 15_000,
      readAttempts: 2,
    });
    stage = 'sandbox_get_only';
    const store = await reader.readStore();
    assert.equal(createHash('sha256').update(store.id).digest('hex'), session.storeHash);
    const product = await reader.readProduct(session.productId);
    assert.equal(product.price, session.amountMinor);
    assert.equal(product.cycle, 'MONTHLY');
    assert.equal(product.trialDays ?? null, null);
    const remote = await reader.readSubscription(before.remote_id);
    stage = 'snapshot_stability';
    assert.deepEqual(
      await snapshot(),
      before,
      'Concurrent change: rerun observation, never commands',
    );
    const observation = summarizeRenewalObservation({
      now: new Date().toISOString(),
      initialPeriodEnd: before.initial_end,
      localPeriodEnd: before.period_end,
      localStatus: before.status,
      initialPaymentConsistent: before.initial_consistent,
      closureConfirmed: before.closure_confirmed,
      cycles: before.cycles,
      remote: {
        devMode: remote.devMode,
        status: remote.status,
        nextChargeAt: remote.nextChargeAt ?? null,
        bindingMatches:
          remote.checkoutId === session.checkoutId &&
          remote.customerId === before.customer_id &&
          remote.amount === session.amountMinor &&
          remote.method === 'CARD' &&
          remote.trialEndsAt === null,
      },
    });
    const report = {
      observedAt: new Date().toISOString(),
      runId: session.runId,
      verifiedInitialRuntimeSha: session.sha,
      environment: 'sandbox',
      ...observation,
      cycles: before.cycles,
      inbox: before.inbox,
      newCheckouts: 0,
      paymentsExecuted: 0,
      nextAction:
        observation.state === 'awaiting_next_cycle'
          ? 'retain_fixture_and_observe_natural_cycle'
          : 'review_evidence_and_use_existing_authorized_reconciliation_runbook',
    };
    await mkdir('dist', { recursive: true });
    await writeFile(
      `dist/abacatepay-renewal-observation-${session.runId}.json`,
      JSON.stringify(report, null, 2) + '\n',
    );
    console.log(JSON.stringify(report));
    if (report.observationStatus !== 'PASS' || report.state === 'due_unobserved')
      process.exitCode = 2;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      observationStatus: 'BLOCKED',
      stage,
      reason:
        error instanceof GatewayReadError ? error.code : 'precondition_failed_details_suppressed',
      databaseWrites: 0,
      providerMutations: 0,
    }),
  );
  process.exitCode = 1;
});
