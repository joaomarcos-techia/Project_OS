/**
 * P1.13 — interruptor de Convênios por clínica no console da plataforma, autenticado no Preview com o super admin
 * de TESTE do DEV (`SUPER_ADMIN_EMAIL_DEV`, TOTP lido de `auth.mfa_factors` na hora, como a jornada do super admin).
 * Alvo: a clínica sintética dedicada `e2e-hi-p113` (`hi-dev-e2e-fixture.ts setup-p113`: paga, módulo desligado).
 *
 *   1. com a disponibilidade comercial desligada (`convenios.available`, padrão), "Ligar" fica bloqueado;
 *   2. com ela ligada SÓ durante o teste: código TOTP errado é recusado e nada muda;
 *   3. motivo + código novo liga; banco (`hi_clinic_settings`), trilha da plataforma (`super_admin_actions`) e
 *      trilha da clínica (`audit_events`) registram com o motivo;
 *   4. motivo + outro código novo desliga; estado volta e fica registrado.
 *
 * ⚠️ `convenios.available` é GLOBAL no DEV (só o console do #55 a lê). O valor anterior é lido ANTES e restaurado no
 * `afterAll`, aconteça o que acontecer; a clínica alvo volta a desligada.
 *
 *   E2E_BASE_URL=<preview do #55> E2E_P113_IDS=<ids.json do setup-p113> DATABASE_URL=<DEV> \
 *   SUPER_ADMIN_EMAIL_DEV=… SUPER_ADMIN_PASSWORD_DEV=… VERCEL_AUTOMATION_BYPASS_SECRET=… \
 *     npx playwright test e2e/convenios-p113-interruptor-preview.spec.ts
 */
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';

import { vercelBypassHeaders } from './vercel-bypass';

const baseUrl = process.env.E2E_BASE_URL;
const email = process.env.SUPER_ADMIN_EMAIL_DEV;
const password = process.env.SUPER_ADMIN_PASSWORD_DEV;
const databaseUrl = process.env.DATABASE_URL;
const idsFile = process.env.E2E_P113_IDS;
const DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const KEY = 'convenios.available';
test.skip(
  !baseUrl || !email || !password || !databaseUrl || !idsFile,
  'requer E2E_BASE_URL, E2E_P113_IDS, DATABASE_URL e SUPER_ADMIN_*_DEV',
);

/** Muta estado: guarda é erro, não skip (mesma regra da jornada do super admin). */
function assertPreviewAndDev() {
  const host = new URL(baseUrl!).hostname;
  if (host === 'app.qoro.dev' || host === 'qoro.dev')
    throw new Error(`só Preview: host recusado ${host}`);
  if (!databaseUrl!.includes(DEV_PROJECT_REF)) throw new Error('DATABASE_URL não é o DEV');
}

function totp(secret: string, at = Date.now()): string {
  let bits = '';
  for (const ch of secret.replace(/=+$/u, '').toUpperCase()) {
    bits += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(ch).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const digest = createHmac('sha1', key).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0xf;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, '0');
}

/** Cada passo com TOTP precisa de uma janela ainda não usada (o Supabase recusa reenvio). */
async function freshCode(secret: string, used: Set<string>): Promise<string> {
  for (let i = 0; i < 40; i += 1) {
    const code = totp(secret);
    if (!used.has(code)) {
      used.add(code);
      return code;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('sem código TOTP novo em 80 s');
}

test.describe.serial('P1.13 — interruptor de Convênios no console (Preview, DEV)', () => {
  test.setTimeout(240_000);
  let sql: ReturnType<typeof postgres>;
  let context: BrowserContext;
  let page: Page;
  let secret = '';
  let superAdminId = '';
  let clinicId = '';
  let previous: { existed: boolean; value: unknown } = { existed: false, value: null };
  const used = new Set<string>();
  const runId = randomUUID().slice(0, 8);

  const moduleState = async () =>
    (
      await sql<{ enabled: boolean | null }[]>`
      SELECT (SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid) AS enabled`
    )[0]!.enabled ?? false;
  const section = () => page.locator('[data-convenios-module]');

  test.beforeAll(async ({ browser }) => {
    assertPreviewAndDev();
    clinicId = (JSON.parse(readFileSync(idsFile!, 'utf8')) as { clinicId: string }).clinicId;
    sql = postgres(databaseUrl!, { max: 2, ssl: 'require' });
    const [factor] = await sql<{ secret: string; user_id: string }[]>`
      SELECT f.secret, f.user_id FROM auth.mfa_factors f JOIN auth.users u ON u.id = f.user_id
       WHERE f.status = 'verified' AND f.factor_type = 'totp' AND u.email = ${email!} LIMIT 1`;
    if (!factor)
      throw new Error(
        `sem TOTP verificado para o super admin de teste (rode seed-super-admin-mfa)`,
      );
    secret = factor.secret;
    superAdminId = factor.user_id;
    const [slug] = await sql<
      { slug: string }[]
    >`SELECT slug FROM public.clinics WHERE id = ${clinicId}::uuid`;
    if (slug?.slug !== 'e2e-hi-p113') throw new Error('clínica alvo não é a sintética e2e-hi-p113');
    const rows = await sql<
      { value: unknown }[]
    >`SELECT value FROM public.platform_settings WHERE key = ${KEY}`;
    previous = rows[0] ? { existed: true, value: rows[0].value } : { existed: false, value: null };

    context = await browser.newContext({
      extraHTTPHeaders: vercelBypassHeaders(),
      viewport: { width: 1280, height: 900 },
    });
    page = await context.newPage();
    await page.goto('/login', { waitUntil: 'load' });
    await page.fill('#email', email!);
    await page.fill('#password', password!);
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByLabel('Código de 6 dígitos').fill(await freshCode(secret, used));
    await page.getByRole('button', { name: 'Verificar' }).click();
    await page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 60_000 });
  });

  test.afterAll(async () => {
    if (sql) {
      if (previous.existed) {
        await sql`UPDATE public.platform_settings SET value = ${sql.json(previous.value as never)} WHERE key = ${KEY}`;
      } else {
        await sql`DELETE FROM public.platform_settings WHERE key = ${KEY}`;
      }
      const after = await sql<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM public.platform_settings WHERE key = ${KEY} AND value = 'true'::jsonb`;
      if (!previous.existed && after[0]!.n !== 0)
        throw new Error('convenios.available NÃO foi restaurado');
      await sql.end();
    }
    await context?.close();
  });

  test('1. disponibilidade comercial desligada (padrão): "Ligar Convênios" bloqueado', async () => {
    test.skip(
      previous.existed && previous.value === true,
      'o DEV já estava com a disponibilidade ligada',
    );
    await page.goto(`/admin/clinicas/${clinicId}`, { waitUntil: 'load' });
    await expect(section()).toContainText('Desligado');
    await expect(section()).toContainText('indisponível comercialmente');
    await expect(section().getByRole('button', { name: 'Ligar Convênios' })).toBeDisabled();
    expect(await moduleState()).toBe(false);
  });

  test('2. código TOTP errado é recusado e nada muda', async () => {
    await sql`
      INSERT INTO public.platform_settings (key, value) VALUES (${KEY}, 'true'::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb`;
    // `getPlatformSetting` guarda o valor por 30 s em cada instância: esperar a validade vencer, não adivinhar.
    await page.waitForTimeout(31_000);
    await page.goto(`/admin/clinicas/${clinicId}`, { waitUntil: 'load' });
    await section().getByRole('button', { name: 'Ligar Convênios' }).click();
    await section().locator('textarea[name="reason"]').fill(`E2E P1.13 ${runId}: código errado`);
    const valid = totp(secret);
    await section()
      .getByLabel('Código do autenticador (TOTP)')
      .fill(valid === '000000' ? '111111' : '000000');
    await section().getByRole('button', { name: 'Confirmar e ligar' }).click();
    await expect(section().locator('.text-danger-600')).toBeVisible({ timeout: 30_000 });
    expect(await moduleState()).toBe(false);
  });

  test('3. motivo + código novo liga; banco e as duas trilhas registram', async () => {
    const reason = `E2E P1.13 ${runId}: ligar para teste sintético`;
    await page.goto(`/admin/clinicas/${clinicId}`, { waitUntil: 'load' });
    await section().getByRole('button', { name: 'Ligar Convênios' }).click();
    await section().locator('textarea[name="reason"]').fill(reason);
    await section()
      .getByLabel('Código do autenticador (TOTP)')
      .fill(await freshCode(secret, used));
    await section().getByRole('button', { name: 'Confirmar e ligar' }).click();
    await expect(section()).toContainText('Ligado', { timeout: 30_000 });
    expect(await moduleState()).toBe(true);
    const [platform] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.super_admin_actions
       WHERE super_admin_id = ${superAdminId}::uuid AND target_clinic_id = ${clinicId}::uuid
         AND action = 'health_insurance.module.enable' AND payload::text LIKE ${`%${runId}%`}`;
    expect(platform!.n, 'trilha da plataforma com o motivo').toBe(1);
    const [clinicTrail] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.audit_events
       WHERE clinic_id = ${clinicId}::uuid AND created_at > now() - interval '10 minutes'
         AND action LIKE 'health_insurance.module%'`;
    expect(clinicTrail!.n, 'trilha da própria clínica').toBeGreaterThanOrEqual(1);
  });

  test('4. motivo + outro código novo desliga; estado volta e fica registrado', async () => {
    await page.goto(`/admin/clinicas/${clinicId}`, { waitUntil: 'load' });
    await section().getByRole('button', { name: 'Desligar Convênios' }).click();
    await section()
      .locator('textarea[name="reason"]')
      .fill(`E2E P1.13 ${runId}: desligar ao fim do teste`);
    await section()
      .getByLabel('Código do autenticador (TOTP)')
      .fill(await freshCode(secret, used));
    await section().getByRole('button', { name: 'Confirmar e desligar' }).click();
    await expect(section()).toContainText('Desligado', { timeout: 30_000 });
    expect(await moduleState()).toBe(false);
    const [platform] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM public.super_admin_actions
       WHERE target_clinic_id = ${clinicId}::uuid AND action = 'health_insurance.module.disable'
         AND payload::text LIKE ${`%${runId}%`}`;
    expect(platform!.n).toBe(1);
  });
});
