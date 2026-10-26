/**
 * Aplica apenas o downgrade da fixture identificada, com relógio controlado.
 * Executado pelo E2E após o agendamento pela UI; não chama o cron global DEV.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from '../e2e/preview-dev-runtime';
import { assertDevContext } from './_env';

if (process.env.E2E_EXTRA_DOCTOR_PAYMENT !== 'DEV_SANDBOX_ONLY') {
  throw new Error('Opt-in DEV/Sandbox ausente');
}
const input = z
  .object({
    clinicId: z.string().uuid(),
    userId: z.string().uuid(),
    changeId: z.string().uuid(),
    subscriptionId: z.string().min(1),
    slug: z.string().regex(/^e2e-extra-doctor-[0-9a-f]{8}$/u),
    preview: z.string().url(),
  })
  .parse({
    clinicId: process.env.E2E_DOWNGRADE_CLINIC_ID,
    userId: process.env.E2E_DOWNGRADE_USER_ID,
    changeId: process.env.E2E_DOWNGRADE_CHANGE_ID,
    subscriptionId: process.env.E2E_DOWNGRADE_SUBSCRIPTION_ID,
    slug: process.env.E2E_DOWNGRADE_SLUG,
    preview: process.env.E2E_BASE_URL,
  });
const databaseUrl = assertDevContext().databaseUrl;
if (decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1) !== DEV_PROJECT_REF) {
  throw new Error('Banco não é o projeto DEV fixado');
}
const sandbox = new URL(process.env.ASAAS_BASE_URL_DEV ?? 'https://invalid.example');
if (
  sandbox.protocol !== 'https:' ||
  !(
    (sandbox.hostname === 'api-sandbox.asaas.com' && sandbox.pathname === '/v3') ||
    (sandbox.hostname === 'sandbox.asaas.com' && sandbox.pathname === '/api/v3')
  ) ||
  !process.env.ASAAS_API_KEY_DEV
) {
  throw new Error('Provider não é o Asaas Sandbox configurado');
}
let stage = 'preview';
try {
  await assertPreviewRuntimeIsDev(input.preview);

  stage = 'imports';
  process.env.ASAAS_BASE_URL = sandbox.toString();
  process.env.ASAAS_API_KEY = process.env.ASAAS_API_KEY_DEV;
  const { dbAdmin } = await import('@/lib/db');
  const { asaasProvider } = await import('@/lib/payments/asaas');
  const { syncProviderPlanChange } =
    await import('@/contexts/billing/internal/plan-change-provider-sync');
  const { applyScheduledPlanChange } = await import('@/contexts/billing/internal/plan-changes');

  stage = 'fixture_read';
  const [fixture] = await dbAdmin.execute<{
    slug: string;
    clinic_id: string;
    change_id: string;
    status: string;
    kind: string;
    current_code: string;
    target_code: string;
    current_amount: string;
    target_amount: string;
    effective_at: Date | string;
    provider_subscription_id: string;
    users: number;
    owner_id: string | null;
    patients: number;
  }>(sql`
  SELECT c.slug, c.id::text clinic_id, ch.id::text change_id,
         ch.status::text, ch.kind::text, old_plan.code current_code,
         new_plan.code target_code, old_price.amount::text current_amount,
         new_price.amount::text target_amount, ch.effective_at,
         s.asaas_subscription_id provider_subscription_id,
         (SELECT count(*)::int FROM profiles WHERE clinic_id = c.id) users,
         (SELECT id::text FROM profiles WHERE clinic_id = c.id LIMIT 1) owner_id,
         (SELECT count(*)::int FROM patients WHERE clinic_id = c.id) patients
    FROM subscription_change_requests ch
    JOIN clinics c ON c.id = ch.clinic_id
    JOIN subscriptions s ON s.id = ch.subscription_id
    JOIN plans old_plan ON old_plan.id = s.plan_id
    JOIN plans new_plan ON new_plan.id = ch.to_plan_id
    JOIN prices old_price ON old_price.id = s.price_id
    JOIN prices new_price ON new_price.id = ch.to_price_id
   WHERE ch.id = ${input.changeId}::uuid AND c.id = ${input.clinicId}::uuid
`);
  stage = 'fixture_guard';
  const effectiveAt = fixture ? new Date(fixture.effective_at) : null;
  if (
    !fixture ||
    fixture.slug !== input.slug ||
    fixture.clinic_id !== input.clinicId ||
    fixture.change_id !== input.changeId ||
    fixture.status !== 'scheduled' ||
    fixture.kind !== 'downgrade' ||
    fixture.current_code !== 'clinica_2026_3' ||
    fixture.target_code !== 'clinica_2026_2' ||
    fixture.current_amount !== '544.00' ||
    fixture.target_amount !== '397.00' ||
    fixture.provider_subscription_id !== input.subscriptionId ||
    fixture.users !== 1 ||
    fixture.owner_id !== input.userId ||
    fixture.patients !== 0 ||
    !effectiveAt ||
    !Number.isFinite(effectiveAt.getTime()) ||
    effectiveAt.getTime() <= Date.now() ||
    effectiveAt.getTime() > Date.now() + 31 * 86_400_000
  ) {
    throw new Error('Fixture isolada de downgrade não confere');
  }

  stage = 'provider_sync';
  await syncProviderPlanChange(asaasProvider, {
    subscriptionId: input.subscriptionId,
    previousAmount: fixture.current_amount,
    amount: fixture.target_amount,
    firstDueDate: effectiveAt.toISOString().slice(0, 10),
    expectedCycle: 'MONTHLY',
  });
  stage = 'local_apply';
  const simulatedNow = new Date(effectiveAt.getTime() + 1_000);
  const result = await dbAdmin.transaction((tx) =>
    applyScheduledPlanChange(tx, input.changeId, simulatedNow),
  );
  if (!result.applied || result.kind !== 'downgrade') {
    throw new Error('Downgrade não foi aplicado no relógio controlado');
  }
  console.log('PASS downgrade da fixture no vencimento simulado');
} catch (error) {
  const safe = (value: unknown): string =>
    typeof value === 'string' && /^[A-Za-z0-9_]{1,60}$/u.test(value) ? value : 'unknown';
  const name = error instanceof Error ? safe(error.name) : 'unknown';
  const code = error && typeof error === 'object' && 'code' in error ? safe(error.code) : 'unknown';
  const httpStatus =
    error &&
    typeof error === 'object' &&
    'httpStatus' in error &&
    typeof error.httpStatus === 'number'
      ? error.httpStatus
      : 0;
  console.error(`[e2e-downgrade] FAIL stage=${stage} name=${name} code=${code} http=${httpStatus}`);
  process.exitCode = 1;
}
