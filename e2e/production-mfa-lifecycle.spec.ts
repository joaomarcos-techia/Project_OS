import { createHmac } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_MFA === 'ALLOW_TEST_ACCOUNT';
const baseUrl = process.env.E2E_BASE_URL;

// Trace, vídeo e screenshot capturam o secret exibido durante o enrollment.
// Este gate produz apenas asserts e estados booleanos, sem material TOTP.
test.use({ trace: 'off', video: 'off', screenshot: 'off' });

type Session = { access_token: string };

function decodeSessionCookie(value: string): Session {
  if (!value.startsWith('base64-')) throw new Error('Cookie Auth em formato inesperado.');
  const parsed = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as {
    access_token?: unknown;
  };
  if (typeof parsed.access_token !== 'string') throw new Error('Access token ausente.');
  return { access_token: parsed.access_token };
}

function jwtClaims(token: string): Record<string, unknown> {
  const payload = token.split('.')[1];
  if (!payload) throw new Error('JWT malformado.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/u, '').replace(/\s+/gu, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Secret TOTP em Base32 inválido.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest.at(-1)! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

function productionProjectRef(): string {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return projectRef;
}

test.describe('produção: ciclo MFA autorizado na conta de teste', () => {
  // Uma falha pode acontecer depois de criar um fator. O próprio finally faz
  // cleanup na mesma sessão; repetir automaticamente criaria outro lifecycle.
  test.describe.configure({ retries: 0 });

  test('ativa, eleva a AAL2 e remove TOTP sem deixar fator ou profile divergente', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_MFA=ALLOW_TEST_ACCOUNT para alterar a conta de teste.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O ciclo MFA autorizado só pode apontar para app.qoro.dev.');
    }

    const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!adminSecret || !databaseUrl) throw new Error('Credenciais operacionais PROD ausentes.');

    const projectRef = productionProjectRef();
    const admin = createClient(`https://${projectRef}.supabase.co`, adminSecret, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require' });

    const authCookies = () =>
      page
        .context()
        .cookies()
        .then((cookies) =>
          cookies
            .filter((cookie) => cookie.name.includes('auth-token'))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );

    await page.goto('/account/security');
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
    const initialSession = decodeSessionCookie((await authCookies()).map((c) => c.value).join(''));
    const initialClaims = jwtClaims(initialSession.access_token);
    const userId = typeof initialClaims.sub === 'string' ? initialClaims.sub : '';
    if (!/^[0-9a-f-]{36}$/iu.test(userId)) throw new Error('Usuário da sessão inválido.');

    const profileState = async (): Promise<boolean> => {
      const rows = await sql<{ enrolled: boolean }[]>`
        select mfa_enrolled_at is not null as enrolled
        from profiles
        where id = ${userId}::uuid
      `;
      if (rows.length !== 1) throw new Error('Profile da conta de teste não encontrado.');
      return rows[0]!.enrolled;
    };

    let createdFactorId: string | null = null;
    try {
      const before = await admin.auth.admin.mfa.listFactors({ userId });
      if (before.error) throw before.error;
      for (const factor of before.data.factors.filter((item) => item.status === 'unverified')) {
        const removed = await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id });
        if (removed.error) throw removed.error;
      }
      expect(before.data.factors.filter((factor) => factor.status === 'verified')).toHaveLength(0);
      expect(await profileState()).toBe(false);

      await page.getByRole('button', { name: 'Ativar TOTP' }).click();
      const verifyForm = page.locator('form').filter({ hasText: 'Confirmar e ativar' });
      await expect(verifyForm).toBeVisible();
      createdFactorId = await verifyForm.locator('input[name="factorId"]').inputValue();
      const secret = (await verifyForm.locator('.font-mono').textContent())?.trim() ?? '';
      expect(createdFactorId).toMatch(/^[0-9a-f-]{36}$/iu);
      expect(secret).toMatch(/^[A-Z2-7]+=*$/iu);

      const remainingMs = 30_000 - (Date.now() % 30_000);
      if (remainingMs < 4_000) await page.waitForTimeout(remainingMs + 500);
      await verifyForm.getByLabel('Código de 6 dígitos').fill(totp(secret));
      await verifyForm.getByRole('button', { name: 'Confirmar e ativar' }).click();
      await expect(page.getByText(/TOTP ativo \(1 factor\)/u)).toBeVisible({
        timeout: 30_000,
      });
      expect(await profileState()).toBe(true);

      const elevated = decodeSessionCookie((await authCookies()).map((c) => c.value).join(''));
      expect(jwtClaims(elevated.access_token).aal).toBe('aal2');

      await page.reload();
      await expect(page.getByText(/TOTP ativo \(1 factor\)/u)).toBeVisible();
      await page.getByRole('button', { name: 'Remover' }).click();
      await expect(page.getByRole('button', { name: 'Ativar TOTP' })).toBeVisible({
        timeout: 30_000,
      });
      expect(await profileState()).toBe(false);
      createdFactorId = null;

      await page.context().storageState({ path: '.playwright/.auth/user.json' });

      const after = await admin.auth.admin.mfa.listFactors({ userId });
      if (after.error) throw after.error;
      expect(after.data.factors).toHaveLength(0);
    } finally {
      if (createdFactorId) {
        const factors = await admin.auth.admin.mfa.listFactors({ userId });
        const created = factors.data?.factors.find((factor) => factor.id === createdFactorId);
        if (created?.status === 'verified' && !page.isClosed()) {
          await page.goto('/account/security');
          const remove = page.getByRole('button', { name: 'Remover' });
          if ((await remove.count()) === 1) {
            await remove.click();
            await expect(page.getByRole('button', { name: 'Ativar TOTP' })).toBeVisible({
              timeout: 30_000,
            });
            expect(await profileState()).toBe(false);
            createdFactorId = null;
          }
        } else if (created?.status === 'unverified') {
          const cleanup = await admin.auth.admin.mfa.deleteFactor({
            userId,
            id: createdFactorId,
          });
          if (cleanup.error) throw cleanup.error;
          createdFactorId = null;
        }
      }
      await sql.end();
    }
  });
});
