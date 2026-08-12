import { expect, test, type Page } from '@playwright/test';

const testEmail = process.env.E2E_USER_EMAIL;
const testPassword = process.env.E2E_USER_PASSWORD;
const productionMutationAuthorized = process.env.E2E_PRODUCTION_MUTATION === 'ALLOW_TEST_ACCOUNT';
const baseUrl = process.env.E2E_BASE_URL;

function assertProductionTarget(): void {
  if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
    throw new Error('E2E_PRODUCTION_MUTATION exige E2E_BASE_URL=https://app.qoro.dev.');
  }
}

function futureDate(daysAhead: number): string {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

function validCpfForRun(runId: string): string {
  const digits = Array.from(runId.replace(/\D/g, '').padEnd(9, '7').slice(0, 9), Number);
  const digit = (values: number[], weight: number) => {
    const rest =
      (values.reduce((sum, value, index) => sum + value * (weight - index), 0) * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return [...digits, digit(digits, 10), digit([...digits, digit(digits, 10)], 11)].join('');
}

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email').fill(testEmail!);
  await page.locator('input[name="password"]').fill(testPassword!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 30_000 });
}

test.describe('produção: mutações autorizadas em conta de teste', () => {
  test('valida limites e percorre paciente, agenda, financeiro manual e LGPD', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300_000);
    test.skip(
      !productionMutationAuthorized || !testEmail || !testPassword,
      'Exige E2E_PRODUCTION_MUTATION=ALLOW_TEST_ACCOUNT e credenciais da conta de teste.',
    );
    assertProductionTarget();

    const runId = `${Date.now()}`.slice(-10);
    const marker = `[E2E-PROD-${runId}]`;
    const patientName = `${marker} Paciente`;
    const patientEmail = `e2e-prod-${runId}@example.test`;
    const procedureCode = `E2E-${runId}`;
    const procedureName = `${marker} Procedimento`;
    const financialDescription = `${marker} Recebimento manual`;
    const appointmentDate = futureDate(21);
    let patientUrl: string | null = null;
    let procedureCreated = false;

    try {
      await login(page);

      await page.goto('/pacientes?novo=1');
      const patientDrawer = page.getByRole('dialog', { name: 'Novo paciente' });
      await expect(patientDrawer).toBeVisible();
      await expect(patientDrawer.locator('input[name="nome"]')).toHaveAttribute('maxlength', '120');
      await expect(patientDrawer.locator('input[name="cpf"]')).toHaveAttribute('maxlength', '14');
      await expect(patientDrawer.locator('input[name="email"]')).toHaveAttribute(
        'maxlength',
        '120',
      );
      await expect(patientDrawer.locator('input[name="endLogradouro"]')).toHaveAttribute(
        'maxlength',
        '300',
      );

      await patientDrawer.getByRole('button', { name: 'Criar paciente' }).click();
      const patientNameInput = patientDrawer.locator('input[name="nome"]');
      expect(
        await patientNameInput.evaluate((element) => {
          if (!(element instanceof HTMLInputElement)) throw new Error('Campo nome não é input.');
          return element.validity.valueMissing;
        }),
      ).toBe(true);
      expect(
        await patientNameInput.evaluate((element) => {
          if (!(element instanceof HTMLInputElement)) throw new Error('Campo nome não é input.');
          return element.validationMessage;
        }),
      ).toMatch(/\S/);

      await patientDrawer.locator('input[name="nome"]').fill(patientName);
      await patientDrawer.locator('input[name="cpf"]').fill('11111111111');
      await patientDrawer.locator('input[name="email"]').fill(patientEmail);
      await patientDrawer.getByRole('button', { name: 'Criar paciente' }).click();
      await expect(patientDrawer.getByRole('alert')).toHaveText('CPF inválido', {
        timeout: 30_000,
      });
      await expect(patientDrawer.locator('input[name="nome"]')).toHaveValue(patientName);
      await expect(patientDrawer.locator('input[name="email"]')).toHaveValue(patientEmail);

      await patientDrawer.locator('input[name="cpf"]').fill(validCpfForRun(runId));
      await patientDrawer.locator('input[name="telefone"]').fill('11999990000');
      await patientDrawer.locator('input[name="endLogradouro"]').fill('Rua de Teste, 1');
      await patientDrawer.locator('input[name="endCidade"]').fill('São Paulo');
      await patientDrawer.locator('input[name="endEstado"]').fill('SP');
      await patientDrawer.locator('input[name="endCep"]').fill('01001000');
      await patientDrawer.getByRole('button', { name: 'Criar paciente' }).click();
      await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/, { timeout: 90_000 });
      patientUrl = page.url();
      await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible();

      const editForm = page.getByRole('heading', { name: 'Editar', exact: true }).locator('..');
      await editForm.locator('input[name="telefone"]').fill('11988880000');
      await editForm.getByRole('button', { name: 'Salvar alterações' }).click();
      await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/, { timeout: 30_000 });

      await page.goto('/configuracoes/procedimentos');
      await page.getByRole('button', { name: 'Novo procedimento' }).click();
      await expect(page.getByRole('heading', { name: 'Novo procedimento' })).toBeVisible();
      await expect(page.getByPlaceholder('Código * (ex: CONS)')).toHaveAttribute('maxlength', '40');
      await expect(page.getByPlaceholder('Descrição * (ex: Consulta)')).toHaveAttribute(
        'maxlength',
        '160',
      );
      await page.getByPlaceholder('Código * (ex: CONS)').fill(procedureCode);
      await page.getByPlaceholder('Descrição * (ex: Consulta)').fill(procedureName);
      await page.getByPlaceholder('0,00').fill('12,34');
      await page.getByPlaceholder('30').fill('30');
      await page.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(page.getByText('Procedimento salvo.', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      procedureCreated = true;

      await page.goto('/agenda');
      await page.getByRole('button', { name: 'Novo atendimento' }).click();
      const appointmentDrawer = page.getByRole('dialog', { name: 'Novo atendimento' });
      await expect(appointmentDrawer).toBeVisible();
      await appointmentDrawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(patientName);
      await appointmentDrawer.getByRole('option', { name: patientName }).click();
      await appointmentDrawer.getByLabel('Procedimento', { exact: true }).selectOption({
        label: procedureName,
      });
      const doctorSelect = appointmentDrawer.getByLabel('Profissional', { exact: true });
      if ((await doctorSelect.count()) > 0) await doctorSelect.selectOption({ index: 1 });
      await appointmentDrawer.getByLabel('Data', { exact: true }).fill(appointmentDate);
      await appointmentDrawer.getByLabel('Hora', { exact: true }).fill('10:37');
      await appointmentDrawer.getByRole('button', { name: 'Agendar', exact: true }).click();
      await expect(page.getByText('Atendimento agendado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto(`/agenda?view=day&date=${appointmentDate}`);
      const appointmentRow = page
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::li[1]');
      await expect(appointmentRow).toBeVisible({ timeout: 30_000 });
      await appointmentRow.getByRole('button', { name: 'Corrigir' }).click();
      const correctionDialog = page.getByRole('dialog', { name: 'Corrigir atendimento' });
      await expect(correctionDialog).toBeVisible();
      await correctionDialog.locator('select[name="kind"]').selectOption('exceptional_cancel');
      await expect(correctionDialog.locator('textarea[name="reason"]')).toHaveAttribute(
        'maxlength',
        '500',
      );
      await correctionDialog
        .locator('textarea[name="reason"]')
        .fill(`${marker} cancelamento de teste`);
      await correctionDialog.getByRole('button', { name: 'Registrar correção' }).click();
      await expect(page.getByText('Agenda corrigida', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto('/agenda');
      await page.getByRole('button', { name: 'Novo atendimento' }).click();
      const walkInDrawer = page.getByRole('dialog', { name: 'Novo atendimento' });
      await walkInDrawer.getByRole('radio', { name: 'Encaixe (agora)' }).click();
      await walkInDrawer.getByPlaceholder('Buscar por nome (mín. 2 letras)').fill(patientName);
      await walkInDrawer.getByRole('option', { name: patientName }).click();
      await walkInDrawer.getByLabel('Procedimento', { exact: true }).selectOption({
        label: procedureName,
      });
      const walkInDoctorSelect = walkInDrawer.getByLabel('Profissional', { exact: true });
      if ((await walkInDoctorSelect.count()) > 0)
        await walkInDoctorSelect.selectOption({ index: 1 });
      await walkInDrawer.getByRole('button', { name: 'Criar encaixe', exact: true }).click();
      await expect(page.getByText('Encaixe criado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto('/consultorio');
      const waitingCard = page
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
      await expect(waitingCard).toBeVisible({ timeout: 30_000 });
      await waitingCard.getByRole('button', { name: 'Chamar' }).click();
      await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const prontuarioField = page.locator('textarea').first();
      await prontuarioField.fill(`${marker} evolução clínica de teste sem dados reais.`);
      await page.getByRole('button', { name: 'Salvar agora', exact: true }).click();
      await expect(page.getByText(/Salvo/)).toBeVisible({ timeout: 30_000 });

      await page.getByRole('button', { name: 'Prescrição', exact: true }).click();
      const prescriptionDrawer = page.getByRole('dialog', { name: 'Emitir prescrição' });
      await expect(prescriptionDrawer).toBeVisible();
      await prescriptionDrawer
        .getByPlaceholder('Ex.: Amoxicilina 500mg')
        .fill('Medicamento de teste');
      await prescriptionDrawer.getByPlaceholder('1 cp').fill('1 cp');
      await prescriptionDrawer.getByPlaceholder('8/8h por 7 dias').fill('uso conforme orientação');
      const [prescriptionPdf] = await Promise.all([
        page.waitForEvent('popup'),
        prescriptionDrawer.getByRole('button', { name: 'Emitir prescrição (PDF)' }).click(),
      ]);
      await expect(prescriptionPdf).toHaveURL(/\/prescricoes\/[0-9a-f-]{36}\/pdf/, {
        timeout: 60_000,
      });
      await prescriptionPdf.close();
      await expect(page.getByText('Prescrição emitida', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole('button', { name: 'Documento', exact: true }).click();
      const documentDrawer = page.getByRole('dialog', { name: 'Emitir documento' });
      await expect(documentDrawer).toBeVisible();
      await documentDrawer.getByLabel('Descrição').fill(`${marker} documento clínico de teste`);
      const [documentPdf] = await Promise.all([
        page.waitForEvent('popup'),
        documentDrawer.getByRole('button', { name: 'Emitir documento (PDF)' }).click(),
      ]);
      await expect(documentPdf).toHaveURL(/\/documentos\/[0-9a-f-]{36}\/pdf/, {
        timeout: 60_000,
      });
      await documentPdf.close();
      await expect(page.getByText('Atestado emitido', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole('button', { name: 'Assinar consulta', exact: true }).click();
      const signDialog = page.getByRole('dialog', { name: 'Assinar prontuário' });
      await expect(signDialog).toBeVisible();
      await signDialog.getByText('Precisa retornar', { exact: true }).click();
      await signDialog.getByRole('spinbutton').fill('14');
      await signDialog.getByRole('button', { name: 'Assinar consulta', exact: true }).click();
      await expect(page.getByText('Prontuário assinado', { exact: false })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole('button', { name: 'Encerrar consulta', exact: true }).click();
      await expect(page.getByText('Consulta finalizada', { exact: false })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto('/financeiro?novo=1');
      const financialDrawer = page.getByRole('dialog', { name: 'Novo lançamento' });
      await expect(financialDrawer).toBeVisible();
      await expect(financialDrawer.locator('input[name="descricao"]')).toHaveAttribute(
        'maxlength',
        '200',
      );
      await financialDrawer.locator('input[name="descricao"]').fill(financialDescription);
      await financialDrawer.locator('input[name="valor"]').fill('12,34');
      await financialDrawer.locator('input[name="dueDate"]').fill(futureDate(1));
      await financialDrawer.getByRole('button', { name: 'Criar lançamento' }).click();
      await expect(page).toHaveURL(/\/financeiro(?:\?|$)/, { timeout: 30_000 });

      await page.goto('/caixa');
      const financialCard = page
        .getByText(financialDescription, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Confirmar pagamento"]][1]');
      await expect(financialCard).toBeVisible({ timeout: 30_000 });
      await financialCard.getByRole('button', { name: 'Confirmar pagamento' }).click();
      await expect(financialCard.getByLabel('Valor recebido')).toHaveValue('12.34');
      await financialCard.getByRole('button', { name: /Receber R\$/ }).click();
      await expect(financialCard.getByText('Pago', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      await financialCard.getByRole('button', { name: 'Reembolsar' }).click();
      await financialCard.getByLabel('Motivo do reembolso').fill(`${marker} estorno de teste`);
      await financialCard.getByRole('button', { name: 'Confirmar reembolso' }).click();
      await page.goto('/financeiro?status=estornado');
      const estornadoRow = page
        .getByText(financialDescription, { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await expect(estornadoRow).toBeVisible({ timeout: 30_000 });
      await expect(estornadoRow.getByText('Estornado', { exact: true })).toBeVisible();

      await testInfo.attach('production-authorized-mutation-result.json', {
        body: JSON.stringify(
          {
            marker,
            patient: 'lgpd_delete_requested',
            appointment: 'scheduled_exceptional_cancel_and_walkin_completed',
            clinical: 'prontuario_saved_prescription_document_signed',
            procedure: 'will_be_deactivated',
            financial: 'manual_payment_and_refund_recorded',
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      if (procedureCreated) {
        await page.goto('/configuracoes/procedimentos');
        await page
          .getByPlaceholder('Buscar por código, descrição ou categoria')
          .fill(procedureCode);
        const procedureRow = page
          .getByText(procedureCode, { exact: true })
          .locator('xpath=ancestor::div[contains(@class,"listrow")][1]');
        if ((await procedureRow.count()) > 0) {
          page.once('dialog', (dialog) => dialog.accept());
          await procedureRow.getByRole('button', { name: 'Desativar' }).click();
          await expect(procedureRow.getByText('inativo', { exact: true })).toBeVisible({
            timeout: 30_000,
          });
        }
      }

      if (patientUrl) {
        await page.goto(patientUrl);
        page.once('dialog', (dialog) => dialog.accept());
        await page.getByRole('button', { name: 'Solicitar exclusão (LGPD)' }).click();
        await expect(page).toHaveURL(/\/pacientes(?:\?|$)/, { timeout: 30_000 });
      }
    }
  });
});
