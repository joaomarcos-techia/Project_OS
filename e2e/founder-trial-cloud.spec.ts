import { mkdir, writeFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { z } from 'zod';

import { assertPreviewRuntimeIsDev } from './preview-dev-runtime';
import { installVercelBypassForOrigin } from './vercel-bypass';

const PREVIEW = 'https://project-26afjm4bg-clinic-os-v2-s-projects.vercel.app';
const SHA = 'bd776c15783a3637a1f6053cd53765833a28864f';
const USER = 'c570d612-f45d-4b6d-91f9-c217b8d08243';
const CLINIC = '11ee3521-a990-46ec-9160-377ca5ac6f36';
const SUBSCRIPTION = 'cd15e440-10bb-4e49-9b43-84a0e6bb9d17';
const sessionSchema = z.object({
  origin: z.literal(PREVIEW),
  sha: z.literal(SHA),
  userId: z.literal(USER),
  clinicId: z.literal(CLINIC),
  subscriptionId: z.literal(SUBSCRIPTION),
  expiresAt: z.iso.datetime(),
  cookies: z.array(z.object({
    name: z.string().regex(/^sb-pqhkirrszzpwezdaqrai-auth-token-v2-/u),
    value: z.string().min(1),
  })).min(1),
  // Only an already attested Sandbox checkout may be opened by the browser.
  checkoutUrl: z.url().optional(),
});

function fixtureCpf(index: number): string {
  const digits = Array.from(`9876500${String(index).padStart(2, '0')}`, Number);
  for (const weight of [10, 11]) {
    const remainder = digits.reduce((sum, digit, offset) => sum + digit * (weight - offset), 0) % 11;
    digits.push(remainder < 2 ? 0 : 11 - remainder);
  }
  return digits.join('');
}

async function createPatient(page: Page, index: number): Promise<void> {
  await page.goto('/pacientes?novo=1');
  await page.locator('#patient-name').fill(`QA trial sintético ${index}`);
  await page.locator('#patient-cpf').fill(fixtureCpf(index));
  await page.locator('#patient-email').fill(`trial-qa-${index}@example.invalid`);
  await page.getByRole('button', { name: 'Criar paciente', exact: true }).click();
}

test('founder DEV trial: real browser, immutable candidate, no payment or paid-state seam', async ({ browser }) => {
  const phase = z.enum(['active', 'expired']).parse(process.env.BILLING_TRIAL_PHASE);
  const session = sessionSchema.parse(JSON.parse(process.env.BILLING_TRIAL_SESSION ?? '{}'));
  const remaining = Date.parse(session.expiresAt) - Date.now();
  if (remaining < 60_000 || remaining > 7_200_000) throw new Error('Short-lived DEV session outside approved window');
  await assertPreviewRuntimeIsDev(PREVIEW, { requireSandboxAsaas: true });
  const stages: string[] = [];
  let stage = 'session';
  let outcome = 'FAIL';
  const context = await browser.newContext({ baseURL: PREVIEW, viewport: { width: 1440, height: 1000 } });
  // These are Qoro server-session cookies only. No Supabase admin, DB or financial key.
  await context.addCookies(session.cookies.map(cookie => ({ ...cookie, url: PREVIEW, httpOnly: true, secure: true, sameSite: 'Lax' })));
  await installVercelBypassForOrigin(context, PREVIEW);
  // A browser may display the hosted checkout; it must never submit payment.
  await context.route(/https:\/\/(?:app|pay|api)\.abacatepay\.com\//u, route =>
    ['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort(),
  );
  const page = await context.newPage();
  const runtimeErrors: string[] = [];
  page.on('pageerror', error => {
    runtimeErrors.push(/hydration|#418/iu.test(error.message) ? 'hydration' : 'unhandled_browser_exception');
  });
  try {
    if (phase === 'active') {
      stage = 'responsive_trial_counters';
      await page.goto('/dashboard');
      await expect(page).toHaveURL(`${PREVIEW}/dashboard`);
      for (const width of [1440, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const counters = page.getByRole('list', { name: 'Uso da avaliação' });
        await expect(counters.getByRole('listitem')).toHaveCount(9);
        await expect(counters).toContainText('Pacientes: 0/10');
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      }
      stages.push(stage);
      stage = 'unpaid_integration_and_invite_gates';
      await page.goto('/configuracoes/whatsapp');
      await expect(page.getByText('WhatsApp disponível após o pagamento', { exact: true })).toBeVisible();
      await page.goto('/configuracoes/pagamentos');
      await expect(page.getByText('Asaas disponível após o pagamento', { exact: true })).toBeVisible();
      await page.goto('/equipe');
      await expect(page.getByText(/Convites.*após.*pagamento/u).last()).toBeVisible();
      await expect(page.getByRole('button', { name: /Convidar/u })).toHaveCount(0);
      stages.push(stage);
      await page.setViewportSize({ width: 1440, height: 1000 });
      stage = 'ten_patients_created_eleventh_refused';
      for (let index = 1; index <= 10; index++) {
        await createPatient(page, index);
        await expect(page).toHaveURL(/\/pacientes\/[a-f0-9-]+(?:\?|$)/u, { timeout: 60_000 });
      }
      await createPatient(page, 11);
      await expect(page.getByText(/Limite da avaliação atingido: 10 pacientes/u)).toBeVisible();
      stages.push(stage);
      stage = 'fifteen_procedures_created_sixteenth_refused';
      for (let index = 1; index <= 16; index++) {
        await page.goto('/configuracoes/procedimentos');
        await page.getByRole('button', { name: 'Novo procedimento', exact: true }).click();
        await page.locator('#proc-codigo').fill(`QA-TRIAL-${index}`);
        await page.locator('#proc-descricao').fill(`Procedimento sintético trial ${index}`);
        await page.locator('#proc-duracao').fill('30');
        await page.getByRole('button', { name: 'Salvar', exact: true }).click();
        if (index <= 15) await expect(page.locator('#proc-codigo')).toHaveCount(0);
        else await expect(page.getByText(/Limite da avaliação atingido: 15 procedimentos/u)).toBeVisible();
      }
      stages.push(stage);
      stage = 'quota_persistence_after_reload';
      await page.goto('/dashboard');
      await page.reload();
      const counters = page.getByRole('list', { name: 'Uso da avaliação' });
      await expect(counters).toContainText('Pacientes: 10/10');
      await expect(counters).toContainText('Procedimentos: 15/15');
      stages.push(stage);
    }
    stage = `${phase}_subscription_screen`;
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('/configuracoes/assinatura');
      await expect(page.getByText(phase === 'expired' ? 'Contratação pendente' : 'Avaliação sem cartão', { exact: true })).toBeVisible();
      await expect(page.getByRole('region', { name: 'Assinatura e avaliação' })).toContainText('397,00');
      await expect(page.getByRole('button', { name: 'Contratar assinatura', exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    stages.push(stage);
    if (phase === 'expired') {
      stage = 'expired_trial_write_refused';
      await createPatient(page, 12);
      await expect(page.getByText(/avaliação.*(?:terminou|encerrad)|(?:prazo|período).*avaliação/iu).last()).toBeVisible();
      stages.push(stage);
      stage = 'one_click_existing_sandbox_checkout';
      if (!session.checkoutUrl) throw new Error('Attested pending checkout required for navigation');
      const checkout = new URL(session.checkoutUrl);
      if (checkout.protocol !== 'https:' || !['app.abacatepay.com', 'pay.abacatepay.com'].includes(checkout.hostname)) throw new Error('Invalid hosted Sandbox checkout origin');
      await page.goto('/configuracoes/assinatura');
      const response = page.waitForResponse(result => result.url() === `${PREVIEW}/api/billing/checkout` && result.request().method() === 'POST');
      await page.getByRole('button', { name: 'Contratar assinatura', exact: true }).click();
      expect((await response).status()).toBe(200);
      await page.waitForURL(session.checkoutUrl, { timeout: 60_000, waitUntil: 'commit' });
      stages.push(stage);
      // Stop here. No card, Pix, simulator or payment button is used.
    }
    stage = 'browser_runtime';
    expect(runtimeErrors).toEqual([]);
    stages.push(stage);
    outcome = 'PASS';
  } catch {
    // No HTML, account details, cookies, tokens, network bodies or provider URLs in diagnostics.
    throw new Error(`DEV browser check failed at ${stage}; sensitive diagnostics suppressed`);
  } finally {
    await context.close();
    await mkdir('dist', { recursive: true });
    await writeFile('dist/billing-trial-cloud.json', JSON.stringify({
      status: outcome, phase, stage, stages, sha: SHA, clinicId: CLINIC,
      subscriptionId: SUBSCRIPTION, at: new Date().toISOString(),
      browser: 'Chromium on GitHub Actions', payments: 0, productionWrites: 0,
      syntheticPaidStateUsed: false, runtimeErrors,
    }, null, 2));
  }
});
