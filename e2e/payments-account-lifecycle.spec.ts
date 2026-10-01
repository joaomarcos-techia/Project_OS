import { expect, test } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';

import { authenticate, hasE2ECredentials } from './auth';

loadDotenv({ path: '.env.local' });

/**
 * Conta Asaas da clínica — `/configuracoes/pagamentos`.
 *
 * ===================================================================
 * SOMENTE PREVIEW. Nunca produção.
 * ===================================================================
 * Regra do fundador (13/09): escrita e qualquer alteração acontecem só em
 * Preview. Este spec pode CRIAR ESTADO EXTERNO — conectar uma chave faz o Asaas
 * registrar um webhook na conta — então a guarda é fail-closed e aborta com
 * erro, não com skip: um skip silencioso num teste que muta é o caminho curto
 * para alguém "só testar rapidinho" em produção.
 *
 * A conta usada seria a sandbox DA CLÍNICA (`ASAAS_CLINIC_SANDBOX_KEY`), nunca a
 * da plataforma. São coisas diferentes no modelo B: a plataforma cobra a
 * assinatura da clínica; a clínica cobra o paciente com a chave dela. Usar a
 * chave da plataforma registraria um webhook na conta errada e interferiria no
 * `billing:live-check`.
 *
 * ===================================================================
 * Por que o ciclo completo é CONDICIONAL
 * ===================================================================
 * A clínica do Preview **já tem uma conta conectada** (verificado em 13/09).
 * Conectar por cima seria "Trocar chave": substituiria a configuração de quem
 * usa aquele ambiente e deixaria um webhook órfão na conta antiga. Um teste não
 * tem o direito de fazer isso com o ambiente dos outros.
 *
 * Então o arquivo tem duas metades:
 *   - a NÃO-MUTANTE roda sempre: chave inválida é recusada, o estado não muda,
 *     e a chave nunca chega ao browser;
 *   - a MUTANTE (conectar → persistir → desconectar) só roda se a clínica
 *     estiver DESCONECTADA, e restaura o estado inicial ao terminar.
 *
 * Requer: `E2E_BASE_URL` de Preview e `E2E_USER_EMAIL`/`E2E_USER_PASSWORD` de
 * uma conta com `manage:financial`. A metade mutante exige também
 * `ASAAS_CLINIC_SANDBOX_KEY`.
 */

const baseUrl = process.env.E2E_BASE_URL;
const sandboxKey = process.env.ASAAS_CLINIC_SANDBOX_KEY;
const paymentAccountMutation = process.env.E2E_PAYMENT_ACCOUNT_MUTATION;

/** Aborta se o alvo for produção. Erro, não skip — ver cabeçalho. */
function assertPreviewOnly(): void {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const host = new URL(baseUrl).hostname;
  if (host === 'app.qoro.dev' || host === 'qoro.dev') {
    throw new Error(
      'Este spec pode criar estado externo (webhook no Asaas) e só roda contra Preview. ' +
        `Host recusado: ${host}.`,
    );
  }
}

/** O ciclo externo exige opt-in próprio além da chave sandbox. */
function assertPaymentMutationOptIn(): void {
  if (paymentAccountMutation !== 'dev-sandbox') {
    throw new Error(
      'O ciclo de conta Asaas exige E2E_PAYMENT_ACCOUNT_MUTATION=dev-sandbox. ' +
        'A variável confirma que o Preview usa banco DEV e conta Asaas Sandbox dedicados.',
    );
  }
}

/** Estado do painel, lido do texto — é o que o usuário vê. */
async function lerEstado(page: import('@playwright/test').Page): Promise<'conectada' | 'vazia'> {
  const conectada = await page.getByText('Conectada', { exact: true }).count();
  const vazia = await page.getByText(/Nenhuma conta conectada/).count();
  if (conectada === 1 && vazia === 0) return 'conectada';
  if (vazia === 1 && conectada === 0) return 'vazia';
  throw new Error(
    `Estado desconhecido da conta Asaas: marcadores conectada=${conectada}, vazia=${vazia}.`,
  );
}

test.describe.serial('conta de pagamento da clínica (Preview)', () => {
  test('chave inválida é recusada sem alterar o estado, e nunca volta ao browser', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    test.skip(!hasE2ECredentials(), 'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD.');
    assertPreviewOnly();

    await authenticate(page);
    const response = await page.goto('/configuracoes/pagamentos');
    expect(response?.status(), 'a tela de pagamentos não respondeu 200').toBe(200);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    const campo = page.locator('#asaas-api-key');
    // Sem `manage:financial` a tela não oferece o formulário. Dizer isso é
    // melhor que falhar num `toBeVisible` e parecer regressão da tela.
    test.skip(
      (await campo.count()) === 0,
      'A conta de teste não tem manage:financial — a tela não expõe o formulário.',
    );

    const antes = await lerEstado(page);

    const invalidKey = '$aact_chave_invalida_de_teste_0000';
    await campo.fill(invalidKey);
    await page.getByRole('button', { name: /Conectar conta|Trocar chave/ }).click();

    // A recusa tem de ser VISÍVEL. Um erro que some deixando a tela como estava
    // é indistinguível de sucesso para quem opera.
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 90_000 });
    await expect(campo, 'a chave inválida permaneceu no campo após a resposta').toHaveValue('');
    expect(await page.content(), 'a chave inválida permaneceu no HTML').not.toContain(invalidKey);

    // E o estado tem de ser o MESMO de antes — em particular, uma chave
    // inválida não pode derrubar uma conta que já estava conectada.
    await page.reload();
    expect(await lerEstado(page), 'a chave inválida alterou o estado da conta').toBe(antes);
  });

  test('ciclo completo: conecta, persiste e desconecta', async ({ page }) => {
    test.setTimeout(300_000);
    test.skip(!hasE2ECredentials(), 'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD.');
    test.skip(!sandboxKey, 'Defina ASAAS_CLINIC_SANDBOX_KEY (conta sandbox DA CLÍNICA).');
    assertPreviewOnly();
    assertPaymentMutationOptIn();

    await authenticate(page);
    const response = await page.goto('/configuracoes/pagamentos');
    expect(response?.status(), 'a tela de pagamentos não respondeu 200').toBe(200);
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);

    const campo = page.locator('#asaas-api-key');
    test.skip((await campo.count()) === 0, 'A conta de teste não tem manage:financial.');

    // O ponto do skip: conectar por cima seria "Trocar chave" e substituiria a
    // configuração de quem usa o Preview, deixando um webhook órfão na conta
    // antiga. Não é papel de um teste mexer no ambiente dos outros.
    test.skip(
      (await lerEstado(page)) === 'conectada',
      'A clínica do Preview já tem conta conectada; o spec não substitui a chave de ninguém. ' +
        'Para exercitar o ciclo, desconecte pela tela antes — isto NÃO é aprovação do ciclo.',
    );

    let primaryError: unknown;
    try {
      await campo.fill(sandboxKey!);
      await page.getByRole('button', { name: 'Conectar conta' }).click();
      await expect(page.getByText('Conectada', { exact: true })).toBeVisible({ timeout: 90_000 });

      // O DTO carrega só `hasApiKey`. Se a chave aparecer no HTML, ela vazou para
      // o cliente — e uma chave de Asaas movimenta dinheiro.
      expect(await page.content(), 'a chave da clínica apareceu no HTML').not.toContain(
        sandboxKey!,
      );

      await page.reload();
      expect(
        await lerEstado(page),
        'o estado não persistiu — era estado de React, não do banco',
      ).toBe('conectada');
    } catch (error) {
      primaryError = error;
    }

    let cleanupError: unknown;
    try {
      await page.goto('/configuracoes/pagamentos');
      if ((await lerEstado(page)) === 'conectada') {
        await page.getByRole('button', { name: 'Desconectar' }).click();
        await expect(page.getByText(/Nenhuma conta conectada/)).toBeVisible({ timeout: 60_000 });
      }
      await page.reload();
      expect(await lerEstado(page), 'a desconexão não persistiu').toBe('vazia');
    } catch (error) {
      cleanupError = error;
    }

    if (primaryError && cleanupError) {
      throw new AggregateError(
        [primaryError, cleanupError],
        'O ciclo Asaas falhou e a restauração do estado também falhou.',
      );
    }
    if (cleanupError) throw cleanupError;
    if (primaryError) throw primaryError;
  });
});
