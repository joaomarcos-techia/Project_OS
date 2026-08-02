import { expect, test } from '@playwright/test';

import { readMutationFixture } from './mutation-fixture';

const testEmail = process.env.E2E_USER_EMAIL;
const testPassword = process.env.E2E_USER_PASSWORD;

test.describe('fluxos mutáveis da Clínica A', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_MUTATION !== '1' || !testEmail || !testPassword,
      'Defina E2E_MUTATION=1 e uma conta descartável antes de alterar dados.',
    );

    await page.goto('/login');
    await page.getByLabel('Email').fill(testEmail!);
    await page.locator('input[name="password"]').fill(testPassword!);
    await page.getByRole('button', { name: 'Entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
  });

  test('cria paciente, agenda atendimento e confirma recebimento pela interface', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const fixture = await readMutationFixture();

    await page.goto('/pacientes?novo=1');
    await expect(page.getByRole('heading', { name: 'Novo paciente' })).toBeVisible();
    await page.getByLabel('Nome', { exact: true }).fill(fixture.patientName);
    await page.getByLabel('CPF', { exact: true }).fill(fixture.patientCpf);
    await page.getByLabel('E-mail', { exact: true }).fill(fixture.patientEmail);
    await page.getByRole('button', { name: 'Criar paciente' }).click();
    await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/, { timeout: 30_000 });
    await expect(
      page.getByRole('heading', { name: fixture.patientName, exact: true }),
    ).toBeVisible();

    await page.goto('/agenda');
    await page.getByRole('button', { name: 'Novo atendimento' }).click();
    const drawer = page.getByRole('dialog', { name: 'Novo atendimento' });
    await expect(drawer).toBeVisible();
    await drawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(fixture.patientName);
    await drawer.getByRole('option', { name: fixture.patientName }).click();
    await drawer
      .getByLabel('Procedimento', { exact: true })
      .selectOption({ label: fixture.procedureName });
    await drawer
      .getByLabel('Profissional', { exact: true })
      .selectOption({ label: fixture.doctorName });
    await drawer.getByLabel('Data', { exact: true }).fill(fixture.appointmentDate);
    await drawer.getByLabel('Hora', { exact: true }).fill('10:00');
    await drawer.getByRole('button', { name: 'Agendar', exact: true }).click();
    await expect(page.getByText('Atendimento agendado', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(drawer).toBeHidden();

    await page.goto(`/agenda?view=day&date=${fixture.appointmentDate}`);
    await expect(page.getByText(fixture.patientName, { exact: true })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto('/caixa');
    const description = page.getByText(fixture.paymentDescription, { exact: true });
    await expect(description).toBeVisible({ timeout: 30_000 });
    const card = description.locator(
      'xpath=ancestor::div[.//button[normalize-space()="Confirmar pagamento"]][1]',
    );
    await card.getByRole('button', { name: 'Confirmar pagamento' }).click();
    await expect(card.getByLabel('Forma de pagamento')).toBeVisible();
    await expect(card.getByLabel('Valor recebido')).toHaveValue(fixture.paymentAmount);
    await card.getByRole('button', { name: /Receber R\$/ }).click();
    await expect(card.getByText('Pago', { exact: true })).toBeVisible({ timeout: 30_000 });
  });
});
