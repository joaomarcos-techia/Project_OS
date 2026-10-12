import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

const productionMutationAuthorized = process.env.E2E_PRODUCTION_MUTATION === 'ALLOW_TEST_ACCOUNT';
const baseUrl = process.env.E2E_BASE_URL;
const WEEKDAY_NAMES = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

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

function isoToBrDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) throw new Error(`Data ISO inválida: ${iso}`);
  return `${day}/${month}/${year}`;
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

function reportStage(stage: string): void {
  console.log(`[production-authorized-mutations] stage=${stage}`);
}

test.describe('produção: mutações autorizadas em conta de teste', () => {
  let cleanupCurrentRun: (() => Promise<void>) | null = null;

  test.afterEach(async ({}, testInfo) => {
    testInfo.setTimeout(240_000);
    const cleanup = cleanupCurrentRun;
    cleanupCurrentRun = null;
    if (cleanup) await cleanup();
  });

  test('valida limites e percorre paciente, agenda, financeiro manual e LGPD', async ({
    page,
  }, testInfo) => {
    // A jornada atravessa várias Functions frias de produção. Seu orçamento não
    // inclui o cleanup: o afterEach tem relógio separado e preserva a fixture
    // mesmo quando o corpo principal expira.
    test.setTimeout(1_800_000);
    test.skip(
      !productionMutationAuthorized || !hasE2ECredentials(),
      'Exige E2E_PRODUCTION_MUTATION=ALLOW_TEST_ACCOUNT e credenciais da conta de teste.',
    );
    assertProductionTarget();
    page.setDefaultTimeout(60_000);
    page.setDefaultNavigationTimeout(90_000);

    const runId = `${Date.now()}`.slice(-10);
    const marker = `[E2E-PROD-${runId}]`;
    const patientName = `${marker} Paciente`;
    const patientEmail = `e2e-prod-${runId}@example.test`;
    const procedureCode = `E2E-${runId}`;
    const procedureName = `${marker} Procedimento`;
    const financialDescription = `${marker} Recebimento manual`;
    const credentialCrm = `E2E${runId}`;
    const appointmentDate = futureDate(21);
    let patientUrl: string | null = null;
    let procedureCreated = false;
    let temporaryAvailabilityAdded = false;
    const todayWeekday = WEEKDAY_NAMES[new Date().getDay()]!;

    cleanupCurrentRun = async () => {
      reportStage('cleanup_started');
      try {
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
            await expect(procedureRow).toHaveCount(0, { timeout: 30_000 });
            await page.getByLabel('Mostrar inativos').check();
            const inactiveProcedureRow = page
              .getByText(procedureCode, { exact: true })
              .locator('xpath=ancestor::div[contains(@class,"listrow")][1]');
            await expect(inactiveProcedureRow.getByText('inativo', { exact: true })).toBeVisible({
              timeout: 30_000,
            });
          }
        }
      } finally {
        try {
          if (temporaryAvailabilityAdded) {
            await page.goto('/configuracoes/horarios');
            const temporaryWindow = page.getByRole('button', {
              name: `Remover ${todayWeekday} 00:00`,
            });
            await expect(temporaryWindow).toBeVisible({ timeout: 30_000 });
            await temporaryWindow.click();
            await expect(temporaryWindow).toHaveCount(0, { timeout: 30_000 });
          }
        } finally {
          if (patientUrl) {
            await page.goto(patientUrl);
            await page.getByRole('button', { name: 'Solicitar exclusão (LGPD)' }).click();
            const lgpdDialog = page.getByRole('dialog', {
              name: 'Registrar solicitação de exclusão LGPD',
            });
            await expect(lgpdDialog).toBeVisible();
            await lgpdDialog.getByRole('button', { name: 'Registrar solicitação' }).click();
            await expect(page).toHaveURL(/\/pacientes(?:\?|$)/, { timeout: 30_000 });
          }
        }
      }
      reportStage('cleanup_completed');
    };

    await test.step('jornada funcional autorizada', async () => {
      await authenticate(page);
      reportStage('authenticated');

      // Prova a jornada de conta solo: owner/gestor com CRM torna-se profissional
      // sem depender de outro membro. Só preenche quando a conta de teste ainda
      // não possui credencial; nunca sobrescreve uma credencial existente.
      await page.goto('/configuracoes/perfil');
      const credentialForm = page.getByTestId('professional-credential-form');
      await expect(credentialForm).toBeVisible();
      const crmInput = credentialForm.getByLabel('CRM');
      if (!(await crmInput.inputValue()).trim()) {
        await crmInput.fill(credentialCrm);
        await credentialForm.getByLabel('UF').fill('SP');
        await credentialForm.getByLabel('Especialidade').fill('Medicina de teste E2E');
        await credentialForm.getByRole('button', { name: 'Salvar credencial' }).click();
        await expect(page.getByText('Credencial profissional salva.', { exact: true })).toBeVisible(
          {
            timeout: 30_000,
          },
        );
      }
      reportStage('professional_ready');

      // The authorized account can be created without working hours. To run a
      // real walk-in/consulting-room flow without bypassing capacity rules, add
      // a window only when the current weekday has none. The afterEach removes it.
      await page.goto('/configuracoes/horarios');
      const weekdayRow = page
        .getByText(todayWeekday, { exact: true })
        .locator('xpath=ancestor::li[1]');
      await expect(weekdayRow).toBeVisible();
      if ((await weekdayRow.getByRole('button', { name: /^Remover / }).count()) === 0) {
        await page.getByLabel('Dia').selectOption({ label: todayWeekday });
        await page.getByRole('checkbox').click();
        await page.getByLabel('Início', { exact: true }).fill('00:00');
        await page.getByLabel('Fim', { exact: true }).fill('23:59');
        await page.getByRole('button', { name: 'Adicionar janela', exact: true }).click();
        await expect(page.getByText('Janela adicionada.', { exact: true })).toBeVisible({
          timeout: 30_000,
        });
        temporaryAvailabilityAdded = true;
      }
      reportStage('availability_ready');

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
      reportStage('patient_created');

      await page.getByRole('button', { name: 'Editar dados', exact: true }).click();
      const editForm = page.locator('#patient-profile-editor');
      await expect(
        editForm.getByRole('heading', { name: 'Editar dados cadastrais' }),
      ).toBeVisible();
      await editForm.locator('input[name="telefone"]').fill('11988880000');
      reportStage('patient_edit_submitting');
      await editForm.getByRole('button', { name: 'Salvar alterações' }).click();
      reportStage('patient_edit_submitted');
      await expect(page).toHaveURL(/\/pacientes\/[0-9a-f-]{36}(?:\?|$)/, { timeout: 30_000 });

      reportStage('procedure_page_opening');
      await page.goto('/configuracoes/procedimentos');
      reportStage('procedure_page_opened');
      await page.getByRole('button', { name: 'Novo procedimento' }).click();
      await expect(page.getByRole('heading', { name: 'Novo procedimento' })).toBeVisible();
      const procedureCodeInput = page.locator('#proc-codigo');
      const procedureDescriptionInput = page.locator('#proc-descricao');
      await expect(procedureCodeInput).toHaveAttribute('maxlength', '40');
      await expect(procedureDescriptionInput).toHaveAttribute('maxlength', '160');
      await procedureCodeInput.fill(procedureCode);
      await procedureDescriptionInput.fill(procedureName);
      await page.locator('#proc-valor').fill('12,34');
      await page.locator('#proc-duracao').fill('30');
      await page.getByRole('button', { name: 'Salvar', exact: true }).click();
      await expect(page.getByText('Procedimento salvo.', { exact: true })).toBeVisible({
        timeout: 30_000,
      });
      procedureCreated = true;
      reportStage('procedure_created');

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
      if ((await doctorSelect.count()) > 0) {
        const doctorOptionCount = await doctorSelect.locator('option').count();
        if (doctorOptionCount < 2) {
          throw new Error('A conta de teste não possui profissional disponível para a Agenda.');
        }
        await doctorSelect.selectOption({ index: 1 });
      }
      await appointmentDrawer.getByLabel('Data', { exact: true }).fill(appointmentDate);
      await appointmentDrawer.getByLabel('Hora', { exact: true }).fill('10:37');
      await appointmentDrawer.getByRole('button', { name: 'Agendar', exact: true }).click();
      await expect(page.getByText('Atendimento agendado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto(`/agenda?view=day&date=${appointmentDate}`);
      const scheduledAppointmentRow = page.getByRole('row').filter({ hasText: patientName });
      await expect(scheduledAppointmentRow).toBeVisible({ timeout: 30_000 });
      await expect(scheduledAppointmentRow.getByText('Agendada', { exact: true })).toBeVisible();
      reportStage('scheduled_appointment_created');

      // A correção excepcional só é permitida em atendimento. Cria um encaixe,
      // chama o paciente e então valida a transição real em vez de tentar uma
      // combinação de estado/tipo que o contrato corretamente rejeita.
      await page.goto('/agenda');
      await page.getByRole('button', { name: 'Novo atendimento' }).click();
      const cancellationWalkInDrawer = page.getByRole('dialog', { name: 'Novo atendimento' });
      await cancellationWalkInDrawer.getByRole('radio', { name: 'Encaixe (agora)' }).click();
      await cancellationWalkInDrawer
        .getByPlaceholder('Buscar por nome (mín. 2 letras)')
        .fill(patientName);
      await cancellationWalkInDrawer.getByRole('option', { name: patientName }).click();
      await cancellationWalkInDrawer.getByLabel('Procedimento', { exact: true }).selectOption({
        label: procedureName,
      });
      const cancellationWalkInDoctorSelect = cancellationWalkInDrawer.getByLabel('Profissional', {
        exact: true,
      });
      if ((await cancellationWalkInDoctorSelect.count()) > 0) {
        const doctorOptionCount = await cancellationWalkInDoctorSelect.locator('option').count();
        if (doctorOptionCount < 2) {
          throw new Error('A conta de teste não possui profissional disponível para o encaixe.');
        }
        await cancellationWalkInDoctorSelect.selectOption({ index: 1 });
      }
      await cancellationWalkInDrawer
        .getByRole('button', { name: 'Criar encaixe', exact: true })
        .click();
      await expect(page.getByText('Encaixe criado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto('/consultorio');
      await page.waitForLoadState('networkidle');
      const cancellationWaitingCard = page
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
      await expect(cancellationWaitingCard).toBeVisible({ timeout: 30_000 });
      const cancellationCallButton = cancellationWaitingCard.getByRole('button', {
        name: 'Chamar',
      });
      await cancellationCallButton.click();
      await expect(cancellationCallButton).toHaveCount(0, { timeout: 90_000 });
      await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible({
        timeout: 90_000,
      });

      await page.goto(`/agenda?view=day&date=${futureDate(0)}`);
      const cancellationAppointmentRow = page.getByRole('row').filter({ hasText: patientName });
      await expect(cancellationAppointmentRow).toBeVisible({ timeout: 30_000 });
      await cancellationAppointmentRow.getByRole('button', { name: 'Corrigir' }).click();
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
      reportStage('exceptional_cancellation_completed');

      await page.goto('/agenda');
      await page.getByRole('button', { name: 'Novo atendimento' }).click();
      const completionWalkInDrawer = page.getByRole('dialog', { name: 'Novo atendimento' });
      await completionWalkInDrawer.getByRole('radio', { name: 'Encaixe (agora)' }).click();
      await completionWalkInDrawer
        .getByPlaceholder('Buscar por nome (mín. 2 letras)')
        .fill(patientName);
      await completionWalkInDrawer.getByRole('option', { name: patientName }).click();
      await completionWalkInDrawer.getByLabel('Procedimento', { exact: true }).selectOption({
        label: procedureName,
      });
      const completionWalkInDoctorSelect = completionWalkInDrawer.getByLabel('Profissional', {
        exact: true,
      });
      if ((await completionWalkInDoctorSelect.count()) > 0) {
        const doctorOptionCount = await completionWalkInDoctorSelect.locator('option').count();
        if (doctorOptionCount < 2) {
          throw new Error('A conta de teste não possui profissional disponível para o encaixe.');
        }
        await completionWalkInDoctorSelect.selectOption({ index: 1 });
      }
      await completionWalkInDrawer
        .getByRole('button', { name: 'Criar encaixe', exact: true })
        .click();
      await expect(page.getByText('Encaixe criado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.goto('/consultorio');
      await page.waitForLoadState('networkidle');
      const waitingCard = page
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::div[.//button[normalize-space()="Chamar"]][1]');
      await expect(waitingCard).toBeVisible({ timeout: 30_000 });
      const callButton = waitingCard.getByRole('button', { name: 'Chamar' });
      await callButton.click();
      await expect(callButton).toHaveCount(0, { timeout: 90_000 });
      await expect(page.getByRole('heading', { name: patientName, exact: true })).toBeVisible({
        timeout: 90_000,
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
      await expect(page.getByText('Prontuário assinado', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.getByRole('button', { name: 'Encerrar consulta', exact: true }).click();
      const completedCard = page
        .getByText(patientName, { exact: true })
        .locator('xpath=ancestor::button[1]');
      await expect(completedCard).toBeVisible({
        timeout: 30_000,
      });
      reportStage('clinical_journey_completed');

      await page.goto('/financeiro?novo=1');
      const financialDrawer = page.getByRole('dialog', { name: 'Novo lançamento' });
      await expect(financialDrawer).toBeVisible();
      await expect(financialDrawer.locator('input[name="descricao"]')).toHaveAttribute(
        'maxlength',
        '200',
      );
      await financialDrawer.getByLabel('Descrição').fill(financialDescription);
      await financialDrawer.getByLabel('Valor (R$)').fill('12,34');
      await financialDrawer.getByLabel('Vencimento').fill(isoToBrDate(futureDate(1)));
      await financialDrawer.getByRole('button', { name: 'Criar lançamento' }).click();
      await expect(page).toHaveURL(/\/financeiro$/, { timeout: 30_000 });
      await expect(
        page.getByText(financialDescription, { exact: true }).locator('xpath=ancestor::tr[1]'),
      ).toBeVisible({ timeout: 30_000 });

      await page.goto('/caixa');
      await page.waitForLoadState('networkidle');
      const receivablesRegion = page.getByRole('region', { name: 'A receber' });
      const receivedRegion = page.getByRole('region', { name: 'Recebidos hoje' });
      const initialRefundButtons = await receivedRegion
        .getByRole('button', { name: 'Reembolsar' })
        .count();
      expect(
        initialRefundButtons,
        'a conta E2E deve iniciar sem recebimento reembolsável hoje',
      ).toBe(0);
      const financialCard = receivablesRegion
        .locator('div[data-status]')
        .filter({ hasText: financialDescription });
      for (let pageIndex = 0; pageIndex < 5 && (await financialCard.count()) === 0; pageIndex++) {
        const nextPage = receivablesRegion.getByRole('button', {
          name: 'Próxima página de A receber',
        });
        await expect(nextPage).toBeEnabled();
        await nextPage.click();
      }
      await expect(financialCard).toBeVisible({ timeout: 30_000 });
      await financialCard.getByRole('button', { name: 'Confirmar pagamento' }).click();
      await expect(financialCard.getByLabel('Valor recebido')).toHaveValue('12.34');
      await financialCard.getByRole('button', { name: /Receber R\$/ }).click();
      await expect(financialCard).toHaveCount(0, { timeout: 30_000 });
      const refundButtons = receivedRegion.getByRole('button', { name: 'Reembolsar' });
      await expect(refundButtons).toHaveCount(initialRefundButtons + 1, { timeout: 30_000 });
      const paidCard = refundButtons
        .last()
        .locator('xpath=ancestor::div[contains(@class,"border-b")][1]');
      await paidCard.getByRole('button', { name: 'Reembolsar' }).click();
      await paidCard.getByLabel('Motivo do reembolso').fill(`${marker} estorno de teste`);
      await paidCard.getByRole('button', { name: 'Confirmar reembolso' }).click();
      await expect(refundButtons).toHaveCount(initialRefundButtons, { timeout: 30_000 });
      await page.goto('/financeiro?status=estornado');
      const estornadoRow = page
        .getByText(financialDescription, { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await expect(estornadoRow).toBeVisible({ timeout: 30_000 });
      await expect(estornadoRow.getByText('Estornado', { exact: true })).toBeVisible();
      reportStage('financial_journey_completed');

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
    });
  });
});
