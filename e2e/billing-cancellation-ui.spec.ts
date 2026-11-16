import { expect, test } from '@playwright/test';

// Presentation/HTTP doubles only. Separate loopback PostgreSQL proofs exercise persistence.
const harness = '/cadastro/qoro-billing-harness';
for (const width of [390, 1280]) {
  test(`Asaas cancellation confirmation, keyboard and layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(harness + '?billingState=asaas-paid');
    await page.getByRole('button', { name: 'Cancelar assinatura', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('O acesso continua até');
    await expect(
      dialog.getByRole('button', { name: 'Cancelar assinatura', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Cancelar assinatura', exact: true }),
    ).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
  test(`AbacatePay failure, single flight, truthful confirmation and paid access at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    let confirmed = false,
      calls = 0;
    await page.route(
      '**/cadastro/qoro-billing-harness?billingState=abacate-paid',
      async (route) => {
        if (!confirmed) return route.continue();
        const response = await route.fetch({
          url: route.request().url().replace('abacate-paid', 'abacate-cancelled'),
        });
        return route.fulfill({ response });
      },
    );
    await page.route('**/api/billing/cancellation', async (route) => {
      calls++;
      expect(route.request().method()).toBe('POST');
      expect(route.request().postDataJSON()).toEqual({
        contractId: '11111111-1111-4111-8111-111111111111',
      });
      if (calls === 1)
        return route.fulfill({ status: 503, json: { error: 'provider_unavailable' } });
      await new Promise((resolve) => setTimeout(resolve, 400));
      confirmed = true;
      return route.fulfill({ status: 200, json: { state: 'renewal_cancelled' } });
    });
    await page.goto(harness + '?billingState=abacate-paid');
    await page.getByRole('button', { name: 'Cancelar renovação', exact: true }).click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmar cancelamento', exact: true })
      .click();
    await expect(
      page.getByRole('dialog').getByText('Ainda não foi possível confirmar', { exact: false }),
    ).toBeVisible();
    const submit = page
      .getByRole('dialog')
      .getByRole('button', { name: 'Confirmar cancelamento', exact: true });
    await submit.click();
    await expect(submit).toBeDisabled();
    await expect(page.getByText('Renovação cancelada', { exact: false })).toBeVisible();
    // The paid-period timestamp is midnight UTC, hence the previous date in Brasília.
    await expect(page.getByText('14/01/2027', { exact: false }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cancelar renovação', exact: true })).toHaveCount(
      0,
    );
    expect(calls).toBe(2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
test('unavailable management offers no unconfirmed cancellation action', async ({ page }) => {
  await page.goto(harness + '?billingState=abacate-unavailable');
  await expect(page.getByRole('button', { name: 'Cancelar renovação', exact: true })).toHaveCount(
    0,
  );
});
