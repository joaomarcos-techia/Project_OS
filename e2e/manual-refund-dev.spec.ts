import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import postgres from 'postgres';

import { assertDevContext } from '../scripts/_env';

/** Browser + Auth + Postgres DEV + reconciliador real; o readback do Asaas é sintético. */
const runId = randomUUID();
const clinicSlug = `refund-e2e-${runId.slice(0, 8)}`;
const email = `${clinicSlug}@example.invalid`;
const password = `Qoro${runId.replaceAll('-', '')}Aa1!`;
const appointmentId = randomUUID();
const missingIdAppointmentId = randomUUID();
const legacyAppointmentId = randomUUID();
const patientId = randomUUID();
const procedureId = randomUUID();
const chargeId = randomUUID();
const missingIdChargeId = randomUUID();
const legacyChargeId = randomUUID();
const intentId = randomUUID();
const legacyIntentId = randomUUID();
let clinicId = '';
let userId = '';
let sql: ReturnType<typeof postgres> | null = null;

function fixtureConfig(): { databaseUrl: string; supabaseUrl: string; secretKey: string } {
  const { databaseUrl } = assertDevContext();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) throw new Error('Auth DEV não configurado.');
  const databaseRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const authRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (!databaseRef || databaseRef !== authRef) {
    throw new Error('Database e Auth DEV pertencem a projetos diferentes.');
  }
  return { databaseUrl, supabaseUrl, secretKey };
}

async function createFixture(): Promise<void> {
  const config = fixtureConfig();
  sql = postgres(config.databaseUrl, { max: 2, ssl: 'require', prepare: false });
  const [catalog] = await sql<{ plan_id: string; price_id: string }[]>`
    SELECT p.id::text plan_id, pr.id::text price_id
      FROM plans p JOIN prices pr ON pr.plan_id = p.id
     WHERE p.code = 'pro' AND p.ativo = true
       AND pr.billing_cycle = 'monthly' AND pr.active_until IS NULL
       AND pr.campaign_code IS NULL
     ORDER BY pr.active_from DESC LIMIT 1
  `;
  if (!catalog) throw new Error('Plano Pro mensal ausente no DEV.');

  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
  if (!response.ok || typeof body?.id !== 'string') {
    throw new Error(`Auth DEV recusou fixture (HTTP ${response.status}).`);
  }
  userId = body.id;

  const [clinic] = await sql<{ id: string }[]>`
    INSERT INTO clinics (slug, nome, status)
    VALUES (${clinicSlug}, 'Clínica E2E Devolução', 'active') RETURNING id::text
  `;
  if (!clinic) throw new Error('Clínica E2E não foi criada.');
  clinicId = clinic.id;
  await sql`
    INSERT INTO subscriptions
      (clinic_id, plan_id, price_id, billing_status, started_at,
       current_period_start, current_period_end)
    VALUES (${clinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid,
            'active', now(), now(), now() + interval '1 month')
  `;
  await sql`
    INSERT INTO profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
    VALUES (${userId}::uuid, ${clinicId}::uuid, 'Owner E2E Devolução',
            'owner'::role_enum, true, now())
  `;
  await sql`
    INSERT INTO patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
    VALUES (${patientId}::uuid, ${clinicId}::uuid, 'Paciente E2E Devolução',
            'fixture', ${runId.replaceAll('-', '').padEnd(64, '0')})
  `;
  await sql`
    INSERT INTO procedures (id, clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
    VALUES (${procedureId}::uuid, ${clinicId}::uuid, ${`RFD-${runId.slice(0, 8)}`},
            'Consulta sintética', 150, 30)
  `;
  for (const id of [appointmentId, missingIdAppointmentId, legacyAppointmentId]) {
    await sql`
      INSERT INTO appointments
        (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
         duration_min, status, valor, snapshot_procedure_name,
         snapshot_procedure_valor, snapshot_procedure_duracao_min,
         snapshot_doctor_nome, created_via)
      VALUES (${id}::uuid, ${clinicId}::uuid, ${userId}::uuid, ${patientId}::uuid,
              ${procedureId}::uuid, now(), 30, 'cancelado', 150,
              'Consulta sintética', 150, 30, 'Owner E2E Devolução', 'attendant')
    `;
  }
  await sql`
    INSERT INTO patient_charges
      (id, clinic_id, appointment_id, patient_id, kind, status, amount,
       provider, provider_payment_id, external_reference, paid_at)
    VALUES (${chargeId}::uuid, ${clinicId}::uuid, ${appointmentId}::uuid,
            ${patientId}::uuid, 'deposit', 'paid', 50, 'asaas',
            ${`pay_fixture_${runId.slice(0, 8)}`}, ${`deposit:${appointmentId}`}, now()),
           (${missingIdChargeId}::uuid, ${clinicId}::uuid, ${missingIdAppointmentId}::uuid,
            ${patientId}::uuid, 'deposit', 'paid', 25, 'asaas', NULL,
            ${`deposit:${missingIdAppointmentId}`}, now()),
           (${legacyChargeId}::uuid, ${clinicId}::uuid, ${legacyAppointmentId}::uuid,
            ${patientId}::uuid, 'deposit', 'paid', 30, 'asaas',
            ${`pay_legacy_${runId.slice(0, 8)}`}, ${`deposit:${legacyAppointmentId}`}, now())
  `;
  await sql`
    INSERT INTO patient_refund_intents
      (id, clinic_id, patient_charge_id, purpose, amount, status,
       provider_payment_id, baseline_refunded_amount, baseline_refund_count,
       baseline_rejected_refund_count, failure_code, source_event_id)
    VALUES (${intentId}::uuid, ${clinicId}::uuid, ${chargeId}::uuid,
            'deposit_closeout', 50, 'confirmation_pending',
            ${`pay_fixture_${runId.slice(0, 8)}`}, 0, 0, 0,
            'manual_action_required', ${randomUUID()}::uuid),
           (${legacyIntentId}::uuid, ${clinicId}::uuid, ${legacyChargeId}::uuid,
            'deposit_closeout', 30, 'failed', ${`pay_legacy_${runId.slice(0, 8)}`},
            0, 0, 0, 'refund_cancelled', ${randomUUID()}::uuid)
  `;
}

async function cleanupFixture(): Promise<void> {
  if (!sql) return;
  const config = fixtureConfig();
  const errors: string[] = [];
  if (clinicId) {
    try {
      await sql`DELETE FROM patient_refund_intents WHERE clinic_id = ${clinicId}::uuid`;
      await sql`DELETE FROM clinics WHERE id = ${clinicId}::uuid`;
    } catch {
      errors.push('limpeza da clínica DEV falhou');
    }
  }
  if (userId) {
    const response = await fetch(
      `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` },
      },
    );
    if (!response.ok && response.status !== 404)
      errors.push(`limpeza Auth HTTP ${response.status}`);
    const readback = await fetch(
      `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`,
      { headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` } },
    );
    if (readback.status !== 404) errors.push(`Auth residual HTTP ${readback.status}`);
  }
  const [remaining] = await sql<{ clinics: number; intents: number; profiles: number }[]>`
    SELECT (SELECT count(*)::int FROM clinics WHERE slug = ${clinicSlug}) clinics,
           (SELECT count(*)::int FROM patient_refund_intents WHERE clinic_id = ${clinicId || null}::uuid) intents,
           (SELECT count(*)::int FROM profiles WHERE id = ${userId || null}::uuid) profiles
  `;
  await sql.end({ timeout: 5 });
  sql = null;
  if (remaining?.clinics !== 0 || remaining.intents !== 0 || remaining.profiles !== 0)
    errors.push('readback encontrou resíduo DEV');
  if (errors.length) throw new Error(errors.join('; '));
}

test.describe('devolução assistida — DEV isolado', () => {
  test.beforeAll(async () => {
    const baseUrl = new URL(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000');
    if (!['127.0.0.1', 'localhost'].includes(baseUrl.hostname)) {
      throw new Error('Este teste com escrita no DEV exige app local.');
    }
    await createFixture();
  });
  test.afterAll(cleanupFixture);

  test('Caixa mantém pendências até DONE, com replay e isolamento', async ({ page }) => {
    test.setTimeout(180_000);
    if (!sql) throw new Error('Fixture não foi criada.');
    const { flagPaidChargeMissingPaymentId } =
      await import('../src/contexts/payments/internal/charge-store');
    const { listManualRefundTasks } =
      await import('../src/contexts/payments/internal/refund-status');
    const { confirmRefundIntentFromReadback, listRefundIntentReconcileCandidates } =
      await import('../src/contexts/payments/internal/excess-refund');

    expect(await flagPaidChargeMissingPaymentId(clinicId, missingIdChargeId)).toBe(true);
    expect(await flagPaidChargeMissingPaymentId(clinicId, missingIdChargeId)).toBe(true);
    expect(await flagPaidChargeMissingPaymentId(randomUUID(), missingIdChargeId)).toBe(false);
    expect(await listManualRefundTasks(clinicId)).toHaveLength(3);
    expect(await listManualRefundTasks(randomUUID())).toHaveLength(0);
    expect(await listRefundIntentReconcileCandidates(clinicId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: legacyIntentId })]),
    );

    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 90_000 });
    await page.goto('/caixa');
    await expect(
      page.getByText(/3 devoluções de paciente pendentes de verificação/i),
    ).toBeVisible();
    await page.getByText(/3 devoluções de paciente pendentes de verificação/i).click();
    await expect(
      page.getByText(/identificador da cobrança Asaas não foi registrado/i),
    ).toBeVisible();
    await expect(page.getByText(/Confira se já há estorno em andamento/i)).toBeVisible();

    expect(
      await confirmRefundIntentFromReadback({
        clinicId,
        intentId,
        refunds: [{ refundId: null, status: 'PENDING', value: 50 }],
      }),
    ).toBe('pending');
    expect(
      await confirmRefundIntentFromReadback({
        clinicId,
        intentId,
        refunds: [{ refundId: null, status: 'CANCELLED', value: 50 }],
      }),
    ).toBe('failed');
    await page.reload();
    await expect(
      page.getByText(/3 devoluções de paciente pendentes de verificação/i),
    ).toBeVisible();

    const done = [{ refundId: null, status: 'DONE', value: 50 }] as const;
    expect(await confirmRefundIntentFromReadback({ clinicId, intentId, refunds: done })).toBe(
      'confirmed',
    );
    expect(await confirmRefundIntentFromReadback({ clinicId, intentId, refunds: done })).toBe(
      'confirmed',
    );
    const [state] = await sql<
      { charge_status: string; intent_status: string; closed_events: number }[]
    >`
      SELECT c.status::text charge_status, i.status::text intent_status,
             (SELECT count(*)::int FROM outbox WHERE clinic_id = ${clinicId}::uuid
               AND idempotency_key = ${`charge-closed:${chargeId}`}) closed_events
        FROM patient_charges c JOIN patient_refund_intents i ON i.patient_charge_id = c.id
       WHERE i.id = ${intentId}::uuid
    `;
    expect(state).toEqual({
      charge_status: 'refunded',
      intent_status: 'confirmed',
      closed_events: 1,
    });
    await page.reload();
    await expect(
      page.getByText(/2 devoluções de paciente pendentes de verificação/i),
    ).toBeVisible();

    expect(
      await confirmRefundIntentFromReadback({
        clinicId,
        intentId: legacyIntentId,
        refunds: [{ refundId: 'old-cancelled', status: 'CANCELLED', value: 30 }],
      }),
    ).toBe('failed');
    expect(
      await confirmRefundIntentFromReadback({
        clinicId,
        intentId: legacyIntentId,
        refunds: [
          { refundId: 'old-cancelled', status: 'CANCELLED', value: 30 },
          { refundId: null, status: 'DONE', value: 30 },
        ],
      }),
    ).toBe('confirmed');
    const [legacyState] = await sql<{ charge_status: string; intent_status: string }[]>`
      SELECT c.status::text charge_status, i.status::text intent_status
        FROM patient_charges c JOIN patient_refund_intents i ON i.patient_charge_id = c.id
       WHERE i.id = ${legacyIntentId}::uuid
    `;
    expect(legacyState).toEqual({ charge_status: 'refunded', intent_status: 'confirmed' });
    await page.reload();
    await expect(page.getByText(/1 devolução de paciente pendente de verificação/i)).toBeVisible();
    expect(await listManualRefundTasks(clinicId)).toEqual([
      expect.objectContaining({ id: missingIdChargeId, state: 'payment_id_missing' }),
    ]);
  });
});
