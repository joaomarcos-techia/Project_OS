/** Real browser/Next/GoTrue/PostgreSQL. Mail and monetary IO are synthetic boundaries. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { dbAdmin } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';
import { issuePilotInviteTx } from '@/contexts/onboarding/internal/signup-pilot-repository';
import { hashToken } from '@/contexts/onboarding/internal/token';

const origin = 'http://localhost:3210';
const headers = { origin, 'sec-fetch-site': 'same-origin' };
const sql = dbAdmin.$client;
const admin = createAdminClient();
const identity = {
  ownerName: 'Synthetic pilot owner',
  clinicName: `Synthetic pilot ${randomUUID()}`,
  email: `qoro-pilot-${randomUUID()}@example.test`,
};
const password = `${randomBytes(16).toString('hex')}Aa9!`;
const inviteToken = randomBytes(32).toString('hex');
let browser: Browser;
let ctx: BrowserContext;
let phase = 'setup';
let passed = false;
let legacyPasswordCleared: boolean | null = null;
let localAuthVersion: string | null = null;
const http: { method: string; path: string; status: number }[] = [];
let browserErrors = 0;
beforeAll(async () => {
  assert.equal(process.env.SIGNUP_LOCAL_PILOT, 'true');
  const target = new URL(process.env.DATABASE_URL!);
  assert.equal(target.hostname, '127.0.0.1');
  assert.equal(target.port, '55442');
  const health: unknown = await (
    await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/health`)
  ).json();
  if (
    health &&
    typeof health === 'object' &&
    'version' in health &&
    typeof health.version === 'string'
  )
    localAuthVersion = health.version;
  const created = await admin.auth.admin.createUser({
    email: `fixture-admin-${randomUUID()}@example.test`,
    email_confirm: true,
  });
  assert.equal(created.error, null);
  assert.ok(created.data.user);
  await dbAdmin.transaction((tx) =>
    issuePilotInviteTx(tx, {
      identity,
      createdBy: created.data.user!.id,
      tokenHash: hashToken(inviteToken),
    }),
  );
  browser = await chromium.launch({ headless: true });
  ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
});
afterAll(async () => {
  await ctx?.close();
  await browser?.close();
  await writeFile(
    'dist/signup-pilot-browser-summary.json',
    JSON.stringify(
      {
        status: passed ? 'PASS' : 'FAIL',
        phase,
        browserErrors,
        legacyPasswordCleared,
        localAuthVersion,
        http,
        scope:
          'real local GoTrue password, OTP, browser cookies and tenant provisioning; memory-only mail stub; no external financial operation',
        productionWrites: 0,
      },
      null,
      2,
    ),
  );
  await dbAdmin.$client.end({ timeout: 2 });
});

describe('restricted pilot with real local Auth', () => {
  it('measures the old recovery primitive against a synthetic unconfirmed account', async () => {
    const email = `legacy-probe-${randomUUID()}@example.test`;
    const account = await admin.auth.admin.createUser({ email, password, email_confirm: false });
    assert.equal(account.error, null);
    assert.ok(account.data.user);
    const generated = await admin.auth.admin.generateLink({ type: 'recovery', email });
    assert.equal(generated.error, null);
    assert.ok(generated.data.properties?.hashed_token);
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const verified = await client.auth.verifyOtp({
      type: 'recovery',
      token_hash: generated.data.properties.hashed_token,
    });
    assert.equal(verified.error, null);
    const [row] =
      await sql`SELECT length(encrypted_password)=0 AS cleared FROM auth.users WHERE id=${account.data.user.id}::uuid`;
    assert.ok(row);
    legacyPasswordCleared = row.cleared === true;
    await client.auth.signOut({ scope: 'local' });
    // Observation of this isolated version, not a new login or mutation in Production.
  });
  it('preserves one initial password through code proof, tenant creation and another login', async () => {
    const page = await ctx.newPage();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(90_000);
    page.on('pageerror', () => {
      browserErrors++;
    });
    page.on('response', (response) => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith('/api/signup/'))
        http.push({ method: response.request().method(), path, status: response.status() });
    });
    phase = 'public closed / private bootstrap';
    const closed = await ctx.request.post(`${origin}/api/signup/sessions`, { headers, data: {} });
    assert.equal(closed.status(), 503);
    await page.goto(`${origin}/cadastro/piloto#invite=${inviteToken}`);
    await page.getByRole('radio', { name: '1 médico', exact: true }).waitFor();
    phase = 'bootstrap: remove fragment';
    await page.waitForURL((url) => url.hash === '', { timeout: 5_000 });
    assert.equal(new URL(page.url()).hash, '');
    const cookies = await ctx.cookies();
    const invite = cookies.find((c) => c.name === '__Host-qoro_pilot');
    phase = 'bootstrap: HttpOnly Secure cookie';
    assert.ok(invite?.httpOnly && invite.secure);
    assert.equal(await page.evaluate(() => document.cookie.includes('qoro_pilot')), false);
    const stranger = await browser.newContext();
    phase = 'bootstrap: foreign browser';
    try {
      const conflict = await stranger.request.post(`${origin}/api/signup/pilot`, {
        headers,
        data: { inviteToken },
      });
      assert.equal(conflict.status(), 409);
    } finally {
      await stranger.close();
    }
    await page.reload({ waitUntil: 'domcontentloaded' });
    for (const [index, name] of ['1 médico', 'Até 20', 'Nada ou papel', 'Outro'].entries()) {
      phase = `question ${index + 1}`;
      await page.getByText(name, { exact: true }).click();
      assert.equal(await page.getByRole('radio', { name, exact: true }).isChecked(), true);
      await page
        .getByRole('button', {
          name: index === 3 ? 'Salvar e continuar' : 'Continuar',
          exact: true,
        })
        .click();
      if (index === 0) {
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByText('Pergunta 2 de 4', { exact: true }).waitFor();
      }
    }
    phase = 'initial identity and password / synthetic email';
    await page.getByLabel('Crie sua senha').waitFor();
    assert.equal(await page.locator('input[name="email"]').inputValue(), identity.email);
    assert.equal(await page.locator('input[name="email"]').isEditable(), false);
    assert.equal(await page.locator('input[name="clinicName"]').inputValue(), identity.clinicName);
    await page.getByLabel('Crie sua senha').fill(password);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Enviar confirmação por e-mail', exact: true }).click();
    const codeInput = page.getByLabel('Código de confirmação');
    await codeInput.waitFor();
    const [before] =
      await sql`SELECT id, length(encrypted_password)>0 AS has_password, md5(encrypted_password) AS fingerprint FROM auth.users WHERE email=${identity.email}`;
    assert.ok(before?.has_password);
    phase = 'OTP wrong / correct / replay';
    const mailResponse = await fetch(
      `${process.env.PILOT_MAIL_URL}/code?email=${encodeURIComponent(identity.email)}`,
      {
        headers: { authorization: `Bearer ${process.env.PILOT_MAIL_TOKEN}` },
      },
    );
    const mail: unknown = await mailResponse.json();
    assert.ok(
      mail &&
        typeof mail === 'object' &&
        'code' in mail &&
        typeof mail.code === 'string' &&
        /^[0-9]{8}$/u.test(mail.code),
    );
    await codeInput.fill(mail.code === '00000000' ? '11111111' : '00000000');
    await page.getByRole('button', { name: 'Confirmar e-mail', exact: true }).click();
    await page.getByText('O código não confere.', { exact: false }).waitFor();
    await codeInput.fill(mail.code);
    await page.getByRole('button', { name: 'Confirmar e-mail', exact: true }).click();
    await page.waitForURL('**/cadastro/plano');
    const [after] =
      await sql`SELECT email_confirmed_at IS NOT NULL AS confirmed, md5(encrypted_password) AS fingerprint FROM auth.users WHERE id=${before.id}::uuid`;
    assert.ok(after?.confirmed && after.fingerprint === before.fingerprint);
    const direct = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    assert.equal(
      (await direct.auth.signInWithPassword({ email: identity.email, password })).error,
      null,
    );
    await direct.auth.signOut({ scope: 'local' });
    assert.equal(await page.getByRole('radio').count(), 1);
    const [other] = await sql`SELECT id FROM plans WHERE code='clinica_2026_2'`;
    const plan = await ctx.request.get(`${origin}/api/signup/plan`);
    assert.equal(plan.status(), 200);
    const state = await plan.json();
    assert.equal(state.plans[0].priceCents, 19700);
    assert.equal(state.pilot, true);
    const tampered = await ctx.request.put(`${origin}/api/signup/plan`, {
      headers,
      data: { rowVersion: state.rowVersion, planId: other!.id, cycle: 'monthly' },
    });
    assert.equal(tampered.status(), 422);
    phase = 'one click trial / refreshed tenant claims';
    await page.getByText('Consultório', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Começar avaliação gratuita', exact: true }).click();
    await page.waitForURL('**/dashboard');
    const [tenant] =
      await sql`SELECT p.clinic_id, p.role, s.billing_status, s.billing_provider, pr.amount, l.doctors,l.staff FROM profiles p JOIN subscriptions s ON s.clinic_id=p.clinic_id JOIN prices pr ON pr.id=s.price_id JOIN plan_seat_limits l ON l.plan_id=s.plan_id WHERE p.id=${before.id}::uuid`;
    assert.ok(tenant?.clinic_id && tenant.role === 'owner');
    assert.equal(tenant.billing_provider, 'abacatepay');
    assert.equal(tenant.billing_status, 'trial');
    assert.equal(Number(tenant.amount), 197);
    assert.equal(tenant.doctors, 1);
    assert.equal(tenant.staff, 3);
    const repeat = await ctx.request.post(`${origin}/api/signup/pilot/provision`, {
      headers,
      data: {},
    });
    assert.equal(repeat.status(), 200);
    const [count] =
      await sql`SELECT (SELECT count(*)::int FROM clinics WHERE id=${tenant.clinic_id}::uuid) AS clinics,(SELECT count(*)::int FROM subscriptions WHERE clinic_id=${tenant.clinic_id}::uuid) AS subscriptions,(SELECT count(*)::int FROM invoices WHERE clinic_id=${tenant.clinic_id}::uuid) AS invoices`;
    assert.deepEqual(count, { clinics: 1, subscriptions: 1, invoices: 0 });
    phase = 'subscription screen / mobile / logout and new login';
    await page.goto(`${origin}/configuracoes/assinatura`);
    await page
      .getByRole('heading', { name: /Assinatura/u })
      .first()
      .waitFor();
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
      );
    }
    const logout = await ctx.request.post(`${origin}/logout`, { headers, maxRedirects: 0 });
    assert.ok([303, 307].includes(logout.status()));
    await page.goto(`${origin}/login`);
    await page.getByLabel('E-mail', { exact: true }).fill(identity.email);
    await page.getByLabel('Senha', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.waitForURL('**/dashboard');
    assert.equal(browserErrors, 0);
    phase = 'complete';
    passed = true;
  }, 600_000);
});
