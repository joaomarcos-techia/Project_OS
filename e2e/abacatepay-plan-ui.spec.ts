import { expect, test } from '@playwright/test';

const enabled = process.env.E2E_ABACATEPAY_PLAN_UI === '1';
const origin = process.env.E2E_BASE_URL;
const catalog = [1, 2, 3, 4, 5].map((doctors) => ({
  id: `00000000-0000-4000-8000-00000000000${doctors}`,
  code: doctors === 1 ? 'consultorio_2026' : `clinica_2026_${doctors}`,
  name: doctors === 1 ? 'Consultório' : `Clínica ${doctors}`,
  priceCents: doctors === 1 ? 19700 : 39700 + (doctors - 2) * 14700,
  cycle: 'monthly',
}));

/** Actual TSX/CSS in an isolated local Next harness; HTTP doubles, no Auth/DB/payment proof. */
for (const width of [1440, 390]) {
  for (const doctors of [2, 3, 4, 5]) {
    test(`${doctors} doctors: redesigned summary, one click and preserved price at ${width}px`, async ({
      page,
    }) => {
      test.skip(!enabled, 'Explicit isolated local harness required');
      expect(origin && new URL(origin).hostname).toBe('127.0.0.1');
      await page.setViewportSize({ width, height: 1000 });
      const chosen = catalog[doctors - 1];
      if (!chosen) throw new Error('Missing synthetic plan');
      let selectedPlanId: string | null = null;
      let rowVersion = 7;
      const writes: string[] = [];
      await page.route('**/api/signup/plan', async (route) => {
        if (route.request().method() === 'PUT') {
          expect(route.request().postDataJSON()).toEqual({
            planId: chosen.id,
            cycle: 'monthly',
            rowVersion: 7,
          });
          writes.push('plan');
          selectedPlanId = chosen.id;
          rowVersion++;
          await route.fulfill({
            json: { rowVersion, selectedPlanId, selectedBillingCycle: 'monthly' },
          });
          return;
        }
        expect(route.request().method()).toBe('GET');
        await route.fulfill({
          json: {
            status: 'email_verified',
            rowVersion,
            clinicName: 'Clínica sintética UI',
            selectedPlanId,
            selectedBillingCycle: 'monthly',
            plans: catalog,
            trialDays: 14,
            offerTrialEndsAt: '2026-11-24T12:00:00.000Z',
            signupFlow: 'trial_first',
          },
        });
      });
      await page.route('**/api/signup/checkout', async (route) => {
        expect(route.request().method()).toBe('POST');
        expect(route.request().postDataJSON()).toEqual({});
        expect(selectedPlanId).toBe(chosen.id);
        writes.push('trial');
        await route.fulfill({ json: { state: 'provisioned' } });
      });
      await page.route('**/auth/session-refresh?next=/dashboard', (route) =>
        route.fulfill({
          contentType: 'text/html; charset=utf-8',
          body: '<h1>Destino sintético da avaliação</h1>',
        }),
      );
      await page.goto('/cadastro/qoro-billing-harness');
      await page
        .locator('label')
        .filter({ has: page.locator(`input[value="${chosen.id}"]`) })
        .click();
      const summary = page.getByRole('complementary');
      await expect(summary.getByRole('heading', { name: chosen.name })).toBeVisible();
      await expect(summary.getByText('Mensalidade após a avaliação')).toBeVisible();
      await expect(summary).toContainText(
        new RegExp(`R\\$\\s*${(chosen.priceCents / 100).toFixed(2).replace('.', ',')}`),
      );
      await expect(
        page.getByText(`${doctors} médicos + até 3 acessos administrativos`),
      ).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.reload();
      expect(writes).toEqual([]);
      await page
        .locator('label')
        .filter({ has: page.locator(`input[value="${chosen.id}"]`) })
        .click();
      await page.getByRole('button', { name: 'Começar avaliação gratuita' }).evaluate((element) => {
        if (!(element instanceof HTMLButtonElement)) throw new Error('Expected native button');
        element.click();
        element.click();
      });
      await expect(
        page.getByRole('heading', { name: 'Destino sintético da avaliação' }),
      ).toBeVisible();
      expect(writes).toEqual(['plan', 'trial']);
    });
  }
}
