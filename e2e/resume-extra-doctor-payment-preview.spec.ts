import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { expect, test } from '@playwright/test';
import postgres from 'postgres';
import { z } from 'zod';

import { assertDevContext } from '../scripts/_env';
import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from './preview-dev-runtime';
import { installVercelBypassForOrigin } from './vercel-bypass';

/** Retoma uma fixture paga preservada pelo E2E interativo, sem criar cobrança. */
const slug = process.env.E2E_EXTRA_DOCTOR_RECOVERY_SLUG ?? '';
const webhookId = process.env.E2E_EXTRA_DOCTOR_RECOVERY_WEBHOOK_ID ?? '';
const preview = new URL(process.env.E2E_BASE_URL ?? 'https://invalid.example');
const asaasBase = process.env.ASAAS_BASE_URL_DEV;
const asaasKey = process.env.ASAAS_API_KEY_DEV;
const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN_DEV;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY;
const password = `Qoro${randomUUID().replaceAll('-', '')}Aa1!`;

type Fixture = {
  clinic_id: string;
  owner_id: string;
  subscription_id: string;
  customer_id: string;
  checkout_id: string;
  change_id: string;
  payment_id: string;
  code: string;
  amount: string;
  change_status: string;
  change_count: number;
  paid_invoices: number;
  history_count: number;
  real_events: number;
  doctors: number;
  users: number;
  patients: number;
};

function preflight(): string {
  assert.equal(process.env.E2E_EXTRA_DOCTOR_RECOVERY, 'DEV_SANDBOX_ONLY');
  assert.match(slug, /^e2e-extra-doctor-[0-9a-f]{8}$/u);
  assert.match(webhookId, /^[0-9a-f-]{36}$/u);
  assert.equal(preview.protocol, 'https:');
  assert.ok(preview.hostname.startsWith('project-os-git-'));
  assert.ok(preview.hostname.endsWith('-clinic-os-v2-s-projects.vercel.app'));
  assert.equal(preview.pathname, '/');
  assert.equal(preview.search, '');
  const databaseUrl = assertDevContext().databaseUrl;
  assert.equal(
    decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1),
    DEV_PROJECT_REF,
  );
  assert.ok(supabaseUrl && supabaseKey && asaasBase && asaasKey && webhookToken);
  assert.equal(new URL(supabaseUrl).hostname.split('.')[0], DEV_PROJECT_REF);
  const sandbox = new URL(asaasBase);
  assert.equal(sandbox.protocol, 'https:');
  assert.ok(
    (sandbox.hostname === 'api-sandbox.asaas.com' && sandbox.pathname === '/v3') ||
      (sandbox.hostname === 'sandbox.asaas.com' && sandbox.pathname === '/api/v3'),
  );
  assert.ok(process.env.VERCEL_AUTOMATION_BYPASS_SECRET);
  return databaseUrl;
}

async function asaas(path: string): Promise<unknown> {
  const response = await fetch(`${asaasBase}/${path}`, {
    headers: { access_token: asaasKey!, accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(
    response.status,
    200,
    `Asaas Sandbox GET ${path.split('/')[0]} HTTP ${response.status}`,
  );
  return response.json();
}

async function fixtureState(db: ReturnType<typeof postgres>): Promise<Fixture> {
  const [row] = await db<Fixture[]>`
    select c.id::text clinic_id,
           (select id::text from profiles where clinic_id = c.id limit 1) owner_id,
           s.asaas_subscription_id subscription_id, bc.asaas_customer_id customer_id,
           ch.provider_checkout_id checkout_id, ch.id::text change_id,
           ch.provider_payment_id payment_id, p.code, pr.amount::text amount,
           ch.status::text change_status, seats.doctors,
           (select count(*)::int from subscription_change_requests where clinic_id = c.id) change_count,
           (select count(*)::int from invoices where clinic_id = c.id and asaas_payment_id = ch.provider_payment_id and status = 'paid') paid_invoices,
           (select count(*)::int from subscription_history where clinic_id = c.id and reason = 'upgrade_payment_confirmed') history_count,
           (select count(*)::int from processed_webhooks where clinic_id = c.id and event_type in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')) real_events,
           (select count(*)::int from profiles where clinic_id = c.id) users,
           (select count(*)::int from patients where clinic_id = c.id) patients
      from clinics c
      join subscriptions s on s.clinic_id = c.id
      join billing_customers bc on bc.clinic_id = c.id
      join plans p on p.id = s.plan_id
      join prices pr on pr.id = s.price_id
      join plan_seat_limits seats on seats.plan_id = s.plan_id
      join lateral (select * from subscription_change_requests where clinic_id = c.id order by created_at asc limit 1) ch on true
     where c.slug = ${slug}
  `;
  assert.ok(row, 'Fixture paga não encontrada');
  assert.equal(row.users, 1, 'Fixture com outro usuário: abortar');
  assert.equal(row.patients, 0, 'Fixture com paciente: abortar');
  assert.ok(
    row.owner_id && row.subscription_id && row.customer_id && row.checkout_id && row.payment_id,
  );
  return row;
}

test('Checkout pago → webhook real → cota → UI → replay → downgrade no vencimento', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const databaseUrl = preflight();
  await assertPreviewRuntimeIsDev(preview.origin, { requireSandboxAsaas: true });
  const db = postgres(databaseUrl, { max: 2, ssl: 'require', prepare: false });
  try {
    const initial = await fixtureState(db);
    expect(initial).toMatchObject({
      code: 'clinica_2026_3',
      amount: '544.00',
      change_status: 'applied',
      change_count: 1,
      paid_invoices: 1,
      history_count: 1,
      doctors: 3,
    });
    expect(initial.real_events).toBeGreaterThan(0);
    const payment = z
      .object({
        id: z.string(),
        status: z.enum(['CONFIRMED', 'RECEIVED']),
        checkoutSession: z.string(),
        value: z.number(),
      })
      .parse(await asaas(`payments/${encodeURIComponent(initial.payment_id)}`));
    expect(payment.checkoutSession).toBe(initial.checkout_id);
    const [change] = await db<{ proration: string }[]>`
      select proration_amount::text proration from subscription_change_requests where id = ${initial.change_id}::uuid
    `;
    expect(payment.value).toBe(Number(change?.proration));
    const subscription = z
      .object({ customer: z.string(), value: z.number(), externalReference: z.string() })
      .parse(await asaas(`subscriptions/${encodeURIComponent(initial.subscription_id)}`));
    expect(subscription.customer).toBe(initial.customer_id);
    expect(subscription.externalReference).toContain(slug.slice('e2e-extra-doctor-'.length));
    expect(subscription.value).toBe(544);
    const recurring = z
      .object({ data: z.array(z.object({ value: z.number() })) })
      .parse(await asaas(`subscriptions/${encodeURIComponent(initial.subscription_id)}/payments`));
    expect(recurring.data.length).toBeGreaterThan(0);
    expect(recurring.data.every((item) => item.value === 544)).toBe(true);
    console.log('PASS pagamento: Asaas, webhook real, invoice e recorrência R$ 544');

    // A FK de profiles exige Auth real. Os quatro usuários sintéticos só existem
    // no DEV durante esta prova; os perfis ficam dentro de uma transação revertida.
    const doctorIds: string[] = [];
    try {
      for (let index = 1; index <= 4; index += 1) {
        const created = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
          method: 'POST',
          headers: {
            apikey: supabaseKey!,
            authorization: `Bearer ${supabaseKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            email: `${slug}-doctor-${index}@example.invalid`,
            password,
            email_confirm: true,
          }),
          signal: AbortSignal.timeout(30_000),
        });
        assert.ok(created.ok, `Auth DEV não criou médico ${index} (HTTP ${created.status})`);
        doctorIds.push(z.object({ id: z.string().uuid() }).parse(await created.json()).id);
      }
      let fourthDenied = false;
      try {
        await db.begin(async (tx) => {
          for (let index = 0; index < 3; index += 1) {
            const doctorId = doctorIds[index];
            assert.ok(doctorId, `Médico sintético ${index + 1} ausente`);
            await tx`
              insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
              values (${doctorId}::uuid, ${initial.clinic_id}::uuid, ${`Médico E2E ${index + 1}`}, 'doctor', true, now())
            `;
          }
          const [used] = await tx<{ total: number }[]>`
            select count(*)::int total from profiles where clinic_id = ${initial.clinic_id}::uuid and role = 'doctor' and ativo = true
          `;
          expect(used?.total).toBe(3);
          const fourthDoctorId = doctorIds[3];
          assert.ok(fourthDoctorId, 'Quarto médico sintético ausente');
          await tx`
            insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
            values (${fourthDoctorId}::uuid, ${initial.clinic_id}::uuid, 'Médico E2E excedente', 'doctor', true, now())
          `;
        });
      } catch (error) {
        const cause = error instanceof Error ? (error.cause ?? error) : error;
        fourthDenied = Boolean(
          cause &&
          typeof cause === 'object' &&
          'code' in cause &&
          cause.code === '23514' &&
          'constraint_name' in cause &&
          cause.constraint_name === 'offer_2026_seat_limit',
        );
        if (!fourthDenied) throw error;
      }
      expect(fourthDenied).toBe(true);
      const [afterSeats] = await db<{ total: number }[]>`
        select count(*)::int total from profiles where clinic_id = ${initial.clinic_id}::uuid and role = 'doctor'
      `;
      expect(afterSeats?.total).toBe(0);
    } finally {
      for (const id of doctorIds) {
        const deleted = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`,
          {
            method: 'DELETE',
            headers: { apikey: supabaseKey!, authorization: `Bearer ${supabaseKey}` },
            signal: AbortSignal.timeout(30_000),
          },
        );
        assert.ok(deleted.ok || deleted.status === 404, 'Auth DEV não limpou médico sintético');
      }
    }
    console.log('PASS vaga: terceiro médico aceito, quarto bloqueado; transação revertida');

    const response = await fetch(
      `${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(initial.owner_id)}`,
      {
        method: 'PUT',
        headers: {
          apikey: supabaseKey!,
          authorization: `Bearer ${supabaseKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ password }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    expect(response.status).toBe(200);
    const context = await browser.newContext({ baseURL: preview.origin });
    await installVercelBypassForOrigin(context, preview.origin);
    try {
      const page = await context.newPage();
      await page.goto('/login');
      await page.locator('#email').fill(`${slug}@example.invalid`);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'Entrar' }).click();
      await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 90_000 });
      await page.goto('/configuracoes/assinatura');
      await expect(page.getByText('R$ 544,00 por mês', { exact: true })).toBeVisible();
      console.log('PASS UI: titular vê recorrência do plano de 3 médicos');

      const [originalEvent] = await db<{ id: string }[]>`
        select asaas_event_id id from processed_webhooks
         where clinic_id = ${initial.clinic_id}::uuid and event_type in ('PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED')
         order by processed_at asc limit 1
      `;
      assert.ok(originalEvent);
      const webhookUrl = new URL('/api/webhooks/asaas', preview);
      webhookUrl.searchParams.set(
        'x-vercel-protection-bypass',
        process.env.VERCEL_AUTOMATION_BYPASS_SECRET!,
      );
      const replay = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'asaas-access-token': webhookToken!, 'content-type': 'application/json' },
        body: JSON.stringify({
          id: originalEvent.id,
          event: 'PAYMENT_CONFIRMED',
          payment: { id: initial.payment_id },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      expect(replay.status).toBe(200);
      expect(await fixtureState(db)).toMatchObject({
        code: 'clinica_2026_3',
        change_count: 1,
        paid_invoices: 1,
        history_count: 1,
        real_events: initial.real_events,
      });
      console.log('PASS replay: evento repetido não cria invoice ou mudança de plano');

      const oldPlan = page
        .locator('main [data-slot="card"]')
        .filter({ has: page.locator('input[name="targetPlanId"][value]') })
        .filter({ hasText: 'Clínica · 2 médicos' });
      await expect(oldPlan).toHaveCount(1);
      await oldPlan.getByRole('button', { name: 'Agendar downgrade' }).click();
      await expect
        .poll(
          async () =>
            (
              await db<{ status: string }[]>`
        select status::text from subscription_change_requests where clinic_id = ${initial.clinic_id}::uuid
         order by created_at desc limit 1
      `
            )[0]?.status,
          { timeout: 30_000 },
        )
        .toBe('scheduled');
      const [scheduled] = await db<{ id: string }[]>`
        select id::text from subscription_change_requests where clinic_id = ${initial.clinic_id}::uuid
         order by created_at desc limit 1
      `;
      assert.ok(scheduled);
      expect((await fixtureState(db)).code).toBe('clinica_2026_3');
      expect(
        z
          .object({ value: z.number() })
          .parse(await asaas(`subscriptions/${encodeURIComponent(initial.subscription_id)}`)).value,
      ).toBe(544);
      console.log('PASS downgrade agendado: plano e cobrança continuam em R$ 544 até vencimento');

      const advanced = spawnSync(
        process.execPath,
        ['--conditions=react-server', '--import=tsx', 'scripts/test-scheduled-doctor-downgrade.ts'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          timeout: 120_000,
          env: {
            ...process.env,
            E2E_EXTRA_DOCTOR_PAYMENT: 'DEV_SANDBOX_ONLY',
            E2E_DOWNGRADE_CLINIC_ID: initial.clinic_id,
            E2E_DOWNGRADE_USER_ID: initial.owner_id,
            E2E_DOWNGRADE_CHANGE_ID: scheduled.id,
            E2E_DOWNGRADE_SUBSCRIPTION_ID: initial.subscription_id,
            E2E_DOWNGRADE_SLUG: slug,
          },
        },
      );
      if (
        advanced.status !== 0 ||
        !advanced.stdout.includes('PASS downgrade da fixture no vencimento simulado')
      ) {
        throw new Error(`Downgrade da fixture falhou; exit ${advanced.status}`);
      }
      const afterDue = await fixtureState(db);
      expect(afterDue).toMatchObject({ code: 'clinica_2026_2', amount: '397.00', change_count: 2 });
      expect(
        z
          .object({ value: z.number() })
          .parse(await asaas(`subscriptions/${encodeURIComponent(initial.subscription_id)}`)).value,
      ).toBe(397);
      await page.goto('/auth/session-refresh?next=%2Fconfiguracoes%2Fassinatura');
      await expect(page).toHaveURL(/\/configuracoes\/assinatura(?:\?|$)/u, { timeout: 60_000 });
      await expect(page.getByText('R$ 397,00 por mês', { exact: true })).toBeVisible();
      console.log('PASS vencimento simulado: Asaas, banco, cota e UI convergiram para R$ 397');
    } finally {
      await context.close();
    }
  } finally {
    await db.end({ timeout: 5 });
  }
});
