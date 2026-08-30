import { createHash } from 'node:crypto';

import { createServerClient as createSsrClient } from '@supabase/ssr';
import { expect, test, type BrowserContext } from '@playwright/test';

import { readMutationFixture } from './mutation-fixture';

const testEmail = process.env.E2E_USER_EMAIL;
const testPassword = process.env.E2E_USER_PASSWORD;
const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY_DEV ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function authenticate(context: BrowserContext): Promise<void> {
  if (!testEmail || !testPassword || !supabaseUrl || !supabaseKey) {
    throw new Error('Credenciais E2E/Supabase incompletas.');
  }

  let nextCookies: Array<{ name: string; value: string }> = [];
  const client = createSsrClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        nextCookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: testEmail,
    password: testPassword,
  });
  if (error || !data.session || nextCookies.length === 0) {
    throw new Error(error?.message ?? 'Login E2E não produziu sessão.');
  }
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
}

function psychiatryPatient(runId: string): { name: string; email: string; cpf: string } {
  const source = createHash('sha256').update(`${runId}-psychiatry`).digest();
  const digits = Array.from(source.subarray(0, 9), (byte) => byte % 10);
  const cpfDigit = (values: number[], startWeight: number) => {
    const sum = values.reduce((total, digit, index) => total + digit * (startWeight - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  const first = cpfDigit(digits, 10);
  const second = cpfDigit([...digits, first], 11);
  return {
    name: `[E2E] Psiquiatria ${runId}`,
    email: `e2e-psychiatry-${runId}@example.test`,
    cpf: [...digits, first, second].join(''),
  };
}

test.describe('template clínico de Psiquiatria', () => {
  test.describe.configure({ timeout: 240_000 });

  test.beforeEach(async ({ context, page }) => {
    test.skip(
      process.env.E2E_MUTATION !== '1' || !testEmail || !testPassword,
      'Defina E2E_MUTATION=1 e uma conta descartável antes de alterar dados.',
    );

    // O login tem spec próprio; este cenário usa uma sessão real do provedor
    // para ficar isolado do rate-limit da tela de autenticação.
    await authenticate(context);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  });

  test('seleciona, preenche e persiste o modelo no prontuário', async ({ page }) => {
    const fixture = await readMutationFixture();
    const patient = psychiatryPatient(fixture.runId);
    const mentalState = `[E2E] Estado mental sintético ${fixture.runId}`;

    await page.goto('/pacientes?novo=1');
    await expect(page.getByRole('heading', { name: 'Novo paciente' })).toBeVisible();
    await page.getByLabel('Nome', { exact: true }).fill(patient.name);
    await page.getByLabel('CPF', { exact: true }).fill(patient.cpf);
    await page.getByLabel('E-mail', { exact: true }).fill(patient.email);
    await page.getByRole('button', { name: 'Criar paciente' }).click();
    await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/u, { timeout: 90_000 });

    await page.goto(`${new URL(page.url()).pathname}?tab=prontuarios`);
    await page.getByRole('button', { name: 'Novo prontuário', exact: true }).click();
    await expect(page).toHaveURL(
      /\/pacientes\/[0-9a-f-]{36}\/prontuarios\/[0-9a-f-]{36}(?:\?|$)/u,
      { timeout: 90_000 },
    );

    const template = page.getByRole('combobox', { name: 'Template' });
    await template.selectOption('psiquiatria');
    await expect(
      page.getByText('História clínica e psicossocial (S)', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Exame físico, estado mental e risco (O)', { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText('Plano terapêutico e de segurança (P)', { exact: true }),
    ).toBeVisible();

    const mentalStateField = page.getByPlaceholder(/risco de suicídio.*tentativas anteriores/iu);
    await mentalStateField.fill(mentalState);
    await page.getByRole('button', { name: 'Salvar agora', exact: true }).click();
    await expect(page.getByText(/Salvo/u)).toBeVisible({ timeout: 30_000 });

    await page.reload();
    await template.selectOption('psiquiatria');
    await expect(mentalStateField).toHaveValue(mentalState);
  });
});
