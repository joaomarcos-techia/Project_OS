/** Explicit --mail only: one code email to the configured, authorized test inbox.
 * Real UI + Next + local Auth/DB + DEV Resend; stops before financial requests.
 * No trace, password, code, recipient, token or message body is persisted.
 */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Browser } from '@playwright/test';
import { z } from 'zod';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { dbAdmin } from '@/lib/db';
import { createAdminClient, findAdminUserByEmail } from '@/lib/auth/supabase-admin';
import { hashEmail } from '@/lib/auth/email-hash';
import { hashSignupToken } from '@/contexts/onboarding/internal/signup-session';
import { createResendInboxAlias, waitForResendEmail } from '@/lib/email/resend-inspector';
const sql = dbAdmin.$client;
const runId = randomUUID();
const email = z
  .string()
  .email()
  .parse(createResendInboxAlias(process.env.E2E_RESEND_INBOX_ADDRESS ?? '', runId));
const manifestPath = 'dist/quality/signup-code-mail-fixture.json';
const manifest = {
  runId,
  environment: 'local Auth/DB + DEV Resend',
  recipientHmac: hashEmail(email),
  planned: 'One code email to configured test inbox; no Checkout/payment.',
  cleanup:
    'Delete only matching synthetic local Auth user/session after verifying no profile and no billing.',
  status: 'prepared',
  messageId: null as string | null,
};
let browser: Browser;
let ref: string | undefined;
beforeAll(async () => {
  assert.equal(process.env.SIGNUP_LOCAL_MAIL, 'true');
  const db = new URL(process.env.DATABASE_URL!);
  assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.port, '55442');
  assert.equal(
    (await findAdminUserByEmail(email)).kind,
    'missing',
    'Test inbox already exists in local Auth; refuse alteration',
  );
  await mkdir('dist/quality', { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  browser = await chromium.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  const found = await findAdminUserByEmail(email);
  if (found.kind === 'found') {
    assert.ok(ref);
    const [row] =
      await sql`select owner_name,asaas_checkout_id from signup_sessions where token_hash=${ref} and pending_auth_user_id=${found.user.id}::uuid`;
    assert.equal(row?.owner_name, 'Synthetic E2E owner');
    assert.equal(row?.asaas_checkout_id, null);
    const [profile] =
      await sql`select count(*)::int as n from profiles where id=${found.user.id}::uuid`;
    assert.equal(profile?.n, 0);
    await sql`delete from signup_sessions where token_hash=${ref}`;
    assert.equal((await createAdminClient().auth.admin.deleteUser(found.user.id)).error, null);
    assert.equal((await findAdminUserByEmail(email)).kind, 'missing');
    manifest.status = 'cleaned';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  } else if (found.kind === 'missing' && ref) {
    await sql`delete from signup_sessions where token_hash=${ref} and auth_user_id is null and pending_auth_user_id is null and billing_attempt_state is null and asaas_customer_id is null and asaas_subscription_id is null and asaas_checkout_id is null`;
    manifest.status = 'cleaned-before-auth';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  }
  await sql.end({ timeout: 2 });
});
describe('actual code email journey', () => {
  it('traverses questions, single password, real Resend message, code and persisted plan in mobile Chromium', async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    try {
      const page = await ctx.newPage();
      page.setDefaultNavigationTimeout(60_000);
      await page.goto('http://localhost:3210/cadastro');
      for (const label of ['1 médico', 'Até 20', 'Nada ou papel', 'Outro']) {
        const choice = page.getByRole('radio', { name: label, exact: true });
        await choice.waitFor({ timeout: 60_000 });
        const cookie = (await ctx.cookies()).find((c) => c.name === '__Host-qoro_signup');
        assert.ok(cookie);
        ref = hashSignupToken(cookie.value);
        await page.getByText(label, { exact: true }).click();
        expect(await choice.isChecked()).toBe(true);
        await page
          .getByRole('button', {
            name: label === 'Outro' ? 'Salvar e continuar' : 'Continuar',
            exact: true,
          })
          .click();
      }
      await page.getByLabel('Seu nome', { exact: true }).waitFor();
      const cookie = (await ctx.cookies()).find((c) => c.name === '__Host-qoro_signup');
      assert.ok(cookie);
      ref = hashSignupToken(cookie.value);
      const password = `${randomBytes(16).toString('hex')}Dd9!`;
      await page.getByLabel('Seu nome', { exact: true }).fill('Synthetic E2E owner');
      await page.getByLabel('Nome da clínica', { exact: true }).fill('Synthetic E2E clinic');
      await page.getByLabel('E-mail', { exact: true }).fill(email);
      await page.getByLabel('Crie sua senha', { exact: true }).fill(password);
      await page.getByRole('checkbox').check();
      await page.getByRole('button', { name: 'Enviar confirmação por e-mail' }).click();
      await page.getByLabel('Código de confirmação', { exact: true }).waitFor({ timeout: 60_000 });
      await page.screenshot({
        path: 'dist/quality/signup-code-mobile.png',
        mask: [page.getByText(email, { exact: true })],
      });
      await page.setViewportSize({ width: 1280, height: 850 });
      await page.screenshot({
        path: 'dist/quality/signup-code-desktop.png',
        mask: [page.getByText(email, { exact: true })],
      });
      await page.setViewportSize({ width: 390, height: 844 });
      const [row] =
        await sql`select confirmation_message_id,verification_flow_version from signup_sessions where token_hash=${ref}`;
      const receipt = z.string().uuid().parse(row?.confirmation_message_id);
      manifest.messageId = receipt;
      assert.equal(row?.verification_flow_version, 2);
      manifest.status = 'email-sent';
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const response = await fetch(`https://api.resend.com/emails/${receipt}`, {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY!}` },
      });
      assert.equal(response.status, 200);
      const message = z
        .object({
          to: z.array(z.string()),
          text: z.string(),
          html: z.string(),
          last_event: z.string(),
        })
        .parse(await response.json());
      assert.deepEqual(message.to.map(hashEmail), [hashEmail(email)]);
      const code = /^(\d{8})\n/u.exec(message.text)?.[1];
      assert.ok(code);
      assert.ok(!message.html.includes('<script'));
      assert.ok(!message.text.includes(password));
      const received = await waitForResendEmail({
        apiKey: process.env.RESEND_API_KEY!,
        to: email,
        subject: 'Seu código de confirmação — Qoro',
        sentAfter: new Date(Date.now() - 10 * 60_000),
        kind: 'received',
        timeoutMs: 60_000,
        pollMs: 1500,
      });
      assert.ok(
        received.text?.includes(code) || received.html?.includes(code),
        'Actual inbound message must preserve the same code',
      );
      expect(await page.locator('input[type=password]').count()).toBe(0);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByLabel('Código de confirmação').waitFor();
      await page.getByLabel('Código de confirmação').fill(code);
      await page.getByRole('button', { name: 'Confirmar e-mail', exact: true }).click();
      await page.waitForURL('**/cadastro/plano', { timeout: 60_000 });
      expect(await page.locator('input[type=password]').count()).toBe(0);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      const [persisted] =
        await sql`select status,owner_name,clinic_name,email_code_state,asaas_checkout_id from signup_sessions where token_hash=${ref}`;
      expect(persisted?.status).toBe('email_verified');
      expect(persisted?.email_code_state).toBe('verified');
      expect(persisted?.clinic_name).toBe('Synthetic E2E clinic');
      expect(persisted?.asaas_checkout_id).toBeNull();
      manifest.status = 'verified-through-plan';
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    } finally {
      await ctx.close();
    }
  });
});
