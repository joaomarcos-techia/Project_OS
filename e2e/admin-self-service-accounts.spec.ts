import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test, type Locator } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';

import { assertPreviewRuntimeIsDev, DEV_PROJECT_REF } from './preview-dev-runtime';
import { installVercelBypassForOrigin } from './vercel-bypass';

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
});

async function fillCredential(field: Locator, value: string): Promise<void> {
  try {
    await field.fill(value);
  } catch {
    throw new Error('Credential field unavailable; sensitive action diagnostics suppressed');
  }
}

function totp(secret: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of secret.replace(/=+$/u, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid fixture TOTP encoding');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8)
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

test('super_admin sees incomplete self-service accounts without a transient draft; anonymous access stays denied', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const baseUrl = process.env.E2E_BASE_URL;
  const databaseUrl = process.env.DATABASE_URL_DEV;
  const adminEmail = process.env.SUPER_ADMIN_EMAIL_DEV;
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD_DEV;
  const authSecret = process.env.SUPABASE_SECRET_KEY_DEV;
  if (
    process.env.E2E_ADMIN_SIGNUP_FIXTURE !== 'ALLOW_DEV_ONLY' ||
    !baseUrl ||
    !databaseUrl ||
    !adminEmail ||
    !adminPassword ||
    !authSecret
  )
    throw new Error('Explicit DEV/Preview fixture preconditions missing; no write performed');
  const target = new URL(baseUrl);
  if (
    target.protocol !== 'https:' ||
    !/^project-[a-z0-9-]+-clinic-os-v2-s-projects\.vercel\.app$/u.test(target.hostname)
  )
    throw new Error('Only the authorized Preview origin is allowed');
  const database = new URL(databaseUrl);
  if (
    !decodeURIComponent(database.username).includes(DEV_PROJECT_REF) &&
    database.hostname !== `db.${DEV_PROJECT_REF}.supabase.co`
  )
    throw new Error('Database is not the known DEV project');
  if (
    databaseUrl === process.env.DATABASE_URL_PROD ||
    authSecret === process.env.SUPABASE_SECRET_KEY_PROD
  )
    throw new Error('Production credentials refused');
  await assertPreviewRuntimeIsDev(baseUrl);
  const sql = postgres(databaseUrl, { max: 1, prepare: false, ssl: 'require' });
  const admin = createClient(`https://${DEV_PROJECT_REF}.supabase.co`, authSecret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const fixtureEmail = `zz.qoro-admin-pending-${randomUUID()}@resend.dev`;
  const signupRef = randomBytes(32).toString('hex');
  let fixtureId: string | null = null;
  const fixturePath = path.join(
    process.cwd(),
    '.playwright',
    'admin-signup-visibility-fixture.json',
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: { cookies: [], origins: [] },
  });
  await installVercelBypassForOrigin(context, target.origin);
  try {
    const factors = await sql<{ secret: string }[]>`
      select f.secret from auth.mfa_factors f join auth.users u on u.id=f.user_id
      join public.profiles p on p.id=u.id
      where u.email=${adminEmail} and p.role='super_admin' and p.ativo is true
      and p.deleted_at is null and f.status='verified' and f.factor_type='totp' limit 1`;
    if (!factors[0])
      throw new Error('DEV super_admin with verified MFA required before creating fixture');
    await mkdir(path.dirname(fixturePath), { recursive: true });
    const fixture = await open(fixturePath, 'wx');
    await fixture.writeFile(
      JSON.stringify({
        projectRef: DEV_PROJECT_REF,
        email: fixtureEmail,
        createdAt: new Date().toISOString(),
        cleanup:
          'Verify exact email, absence of profile and DEV project before removing only this Auth user',
      }),
    );
    await fixture.close();
    const created = await admin.auth.admin.createUser({
      email: fixtureEmail,
      email_confirm: false,
      app_metadata: {
        qoro_self_service_signup: {
          version: 1,
          kind: 'self_service',
          signup_ref: signupRef,
          password_state: 'pending',
        },
      },
    });
    if (created.error || !created.data.user)
      throw new Error('Synthetic Auth fixture creation failed');
    fixtureId = created.data.user.id;
    await writeFile(
      fixturePath,
      JSON.stringify({
        projectRef: DEV_PROJECT_REF,
        email: fixtureEmail,
        userId: fixtureId,
        cleanup: 'Verify exact email and absence of profile, then remove only this DEV Auth user',
      }),
    );
    const before = await sql<
      { n: number }[]
    >`select count(*)::int as n from public.signup_sessions where token_hash=${signupRef}`;
    expect(before[0]?.n).toBe(0);
    const page = await context.newPage();
    await page.goto(`${target.origin}/login`);
    await fillCredential(page.getByLabel('E-mail', { exact: true }), adminEmail);
    await fillCredential(page.getByLabel('Senha', { exact: true }), adminPassword);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await expect(page).toHaveURL(/\/login\/mfa/u, { timeout: 45_000 });
    const remainingMs = 30_000 - (Date.now() % 30_000);
    if (remainingMs < 4_000) await page.waitForTimeout(remainingMs + 250);
    await fillCredential(page.getByLabel('Código de 6 dígitos'), totp(factors[0].secret));
    await page.getByRole('button', { name: 'Verificar', exact: true }).click();
    await expect(page).toHaveURL(/\/admin(?:\?|$)/u, { timeout: 45_000 });
    await page.goto(`${target.origin}/admin/clinicas`);
    const row = page.locator(`[data-signup-account-id="${fixtureId}"]`);
    await expect(row).toBeVisible({ timeout: 30_000 });
    await expect(row).toContainText('Aguardando confirmar e-mail');
    await expect(row).toContainText('Indisponível; precisa retomar o cadastro');
    await expect(row).toContainText('zz***@resend.dev');
    expect(await page.content()).not.toContain(fixtureEmail);
    expect(await page.content()).not.toContain(signupRef);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      ).toBe(true);
      await expect(row).toBeVisible();
    }
    const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    try {
      await installVercelBypassForOrigin(anonymous, target.origin);
      const denied = await anonymous.newPage();
      const response = await denied.goto(`${target.origin}/admin/clinicas`);
      expect(response?.status()).toBe(404);
      expect(await denied.content()).not.toContain('zz***@resend.dev');
    } finally {
      await anonymous.close();
    }
  } finally {
    try {
      await context.close();
    } finally {
      try {
        if (fixtureId) {
          const profile = await sql<
            { n: number }[]
          >`select count(*)::int as n from public.profiles where id=${fixtureId}`;
          if (profile[0]?.n !== 0)
            throw new Error('Unexpected profile on fixture; cleanup refused');
          const found = await admin.auth.admin.getUserById(fixtureId);
          if (found.error || found.data.user?.email !== fixtureEmail)
            throw new Error('Exact cleanup identity mismatch');
          const removed = await admin.auth.admin.deleteUser(fixtureId);
          if (removed.error) throw new Error('Synthetic Auth cleanup failed');
          const remaining = await sql<
            { n: number }[]
          >`select count(*)::int as n from auth.users where id=${fixtureId} or email=${fixtureEmail}`;
          expect(remaining[0]?.n).toBe(0);
          await rm(fixturePath);
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  }
});
