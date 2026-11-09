import { expect, test } from '@playwright/test';
import { installVercelBypassForOrigin } from './vercel-bypass';

/** Real browser/app UI with explicit HTTP doubles. No provider, Auth or DB writes. */
const enabled = process.env.E2E_SIGNUP_DELIVERY_UI === '1';
const origin = process.env.E2E_BASE_URL;
if (
  enabled &&
  (!origin || !/^(localhost|127\.0\.0\.1|[a-z0-9-]+\.vercel\.app)$/u.test(new URL(origin).hostname))
)
  throw new Error('Delivery UI proof requires an isolated local or Preview URL, never Production');
const answers = {
  professionalsBand: '1',
  weeklyAppointmentsBand: 'ate_20',
  currentTooling: 'nada_papel',
  discoverySource: 'busca_google',
};
const email = 'synthetic@gmail.com';

for (const width of [1440, 390]) {
  test(`delivery UI and correction ${width}px — HTTP fixtures, no external send`, async ({
    page,
  }) => {
    test.skip(!enabled, 'E2E_SIGNUP_DELIVERY_UI=1 required');
    if (!origin) throw new Error('Isolated UI origin required');
    const applicationOrigin = new URL(origin).origin;
    await page.context().setExtraHTTPHeaders({});
    await installVercelBypassForOrigin(page.context(), applicationOrigin);
    // Never emit analytics or send the automation header to an external host.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== applicationOrigin || url.pathname.startsWith('/api/'))
        return route.abort();
      return route.fallback();
    });
    await page.setViewportSize({ width, height: 950 });
    let session = {
      status: 'details_complete',
      riskLevel: 0,
      rowVersion: 3,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      answers,
      verificationFlowVersion: 2,
      emailDelivery: 'pending',
    };
    let address = email,
      authCalls = 0,
      correctionCalls = 0;
    await page.route('**/api/signup/**', async (route) => {
      const req = route.request(),
        pathname = new URL(req.url()).pathname;
      const json = (body: object, status = 200) =>
        route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      if (pathname === '/api/signup/sessions/me') return json({ session });
      if (pathname === '/api/signup/sessions/destination') return json({ email: address });
      if (pathname === '/api/signup/sessions/identity') {
        const body: unknown = req.postDataJSON();
        expect(body).toMatchObject({
          ownerName: 'Pessoa sintética',
          clinicName: 'Clínica sintética',
          email,
        });
        session = { ...session, status: 'identity_pending', rowVersion: 4 };
        return json({ rowVersion: 4 });
      }
      if (pathname === '/api/signup/sessions/auth') {
        authCalls++;
        const body: unknown = req.postDataJSON();
        expect(body).toMatchObject({ email: address, password: 'SyntheticPassword123!' });
        session = {
          ...session,
          status: 'email_pending',
          rowVersion: session.rowVersion + 2,
          emailDelivery: 'failed',
        };
        return json({ rowVersion: session.rowVersion });
      }
      if (pathname === '/api/signup/sessions/email') {
        correctionCalls++;
        expect(req.postDataJSON()).toEqual({
          rowVersion: 6,
          currentEmail: email,
          email: 'corrected@example.test',
        });
        address = 'corrected@example.test';
        session = {
          ...session,
          status: 'identity_pending',
          rowVersion: 7,
          emailDelivery: 'pending',
        };
        return json({ rowVersion: 7 });
      }
      throw new Error(`Unexpected signup UI request: ${pathname}`);
    });
    await page.goto('/cadastro');
    await page.getByLabel('Seu nome', { exact: true }).fill('Pessoa sintética');
    await page.getByLabel('Nome da clínica', { exact: true }).fill('Clínica sintética');
    await page.getByLabel('E-mail', { exact: true }).fill('synthetic@gmail.comq');
    await page.getByLabel('Crie sua senha', { exact: true }).fill('SyntheticPassword123!');
    await page.getByRole('checkbox').click();
    await expect(page.getByText('Você quis dizer', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Usar endereço sugerido' }).click();
    await page.getByRole('button', { name: 'Enviar confirmação por e-mail' }).click();
    await expect(page.getByRole('heading', { name: 'Confirme seu e-mail aqui' })).toBeVisible();
    expect(authCalls).toBe(1);
    await page.reload();
    await expect(
      page.getByText('Não conseguimos entregar o código', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Corrigir endereço de e-mail' }).click();
    await page.getByLabel('Novo e-mail', { exact: true }).fill('corrected@example.test');
    await page.getByRole('button', { name: 'Salvar endereço corrigido' }).click();
    await expect(page.getByLabel('E-mail', { exact: true })).toHaveValue('corrected@example.test');
    await expect(page.getByLabel('Seu nome', { exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Nome da clínica', { exact: true })).toHaveCount(0);
    expect(correctionCalls).toBe(1);
    expect(authCalls).toBe(1);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(new URL(page.url()).search).toBe('');
  });
}
