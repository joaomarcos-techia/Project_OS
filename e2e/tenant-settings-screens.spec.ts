import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

/**
 * Telas de configuração do tenant que a auditoria de 13/09 listou como
 * **não cobertas** ou **superficiais**.
 *
 * As três apareciam na matriz por motivos diferentes, e vale distinguir:
 *
 *   - `/configuracoes/auditoria` — nunca visitada por E2E nenhum;
 *   - `/modelos-receita` — visitada só em inventário de rota (`status < 500`),
 *     que é exatamente o que a auditoria chamou de cobertura aparente;
 *   - `/configuracoes/lgpd` — idem.
 *
 * ===================================================================
 * O que este arquivo deliberadamente NÃO faz
 * ===================================================================
 * Não processa solicitação LGPD e não mexe em consentimento. As duas coisas
 * tocam dado de PACIENTE — anonimização, exclusão física, revogação — e mesmo
 * em Preview não é um teste que deve decidir exercitar isso sem fixture própria
 * e sem cleanup provado. Elas seguem descobertas, e o motivo está aqui em vez de
 * numa linha em branco da matriz.
 *
 * Preview por padrão (regra de 13/09: escrita só em Preview). O único caso que
 * MUTA é o de modelos de receita, e ele cria e apaga o próprio registro.
 *
 * Rode com `E2E_AUTH_REUSE=1` — a conta é compartilhada e o rate limit é dual.
 */

const baseUrl = process.env.E2E_BASE_URL;

/** O caso mutante recusa produção; os de leitura rodam em qualquer ambiente. */
function assertPreviewParaMutacao(): void {
  const host = baseUrl ? new URL(baseUrl).hostname : 'localhost';
  if (host === 'app.qoro.dev' || host === 'qoro.dev') {
    throw new Error(`Este caso cria e apaga registro; só roda contra Preview. Host: ${host}.`);
  }
}

test.describe.serial('telas de configuração do tenant', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!hasE2ECredentials(), 'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD.');
    await authenticate(page);
  });

  test('a auditoria da clínica exporta CSV de verdade', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/configuracoes/auditoria');

    await expect(page.getByRole('heading', { level: 1, name: 'Auditoria' })).toBeVisible();

    // O download é montado no CLIENTE a partir do CSV que a Server Action
    // devolve. Interceptar o evento de download é o que prova o caminho inteiro
    // — a action rodou, autorizou, consultou e devolveu conteúdo. Afirmar só que
    // o botão existe provaria que o botão existe.
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      page.getByRole('button', { name: 'Exportar CSV' }).click(),
    ]);

    expect(download.suggestedFilename(), 'o export não veio como .csv').toMatch(/\.csv$/u);

    const stream = await download.createReadStream();
    const conteudo = await new Promise<string>((resolve, reject) => {
      let texto = '';
      stream.on('data', (parte: Buffer) => (texto += parte.toString('utf8')));
      stream.on('end', () => resolve(texto));
      stream.on('error', reject);
    });

    expect(conteudo.length, 'CSV veio vazio').toBeGreaterThan(0);

    // O CONJUNTO DE COLUNAS é a asserção que vale, e vale por um motivo preciso.
    //
    // A tela promete: "a trilha responde quem fez o quê e quando, não qual era o
    // dado do paciente". Procurar palavras clínicas no corpo NÃO testa isso — a
    // primeira versão deste caso fazia exatamente essa busca e reprovou, porque
    // `recurso_tipo` legitimamente contém `prontuario`. Saber que alguém tocou
    // um recurso do tipo prontuário é o PROPÓSITO de uma trilha de auditoria; o
    // que não pode sair é o CONTEÚDO daquele prontuário.
    //
    // Travar o cabeçalho pega o que importa: no dia em que alguém acrescentar
    // uma coluna de conteúdo, este teste falha. Uma busca por palavra não pegaria
    // — o texto clínico é prosa livre, em português, e não casa com regex.
    const cabecalho = conteudo.replace(/^\uFEFF/u, '').split(/\r?\n/u)[0];
    expect(cabecalho, 'as colunas do export de auditoria mudaram').toBe(
      'data_hora,acao,recurso_tipo,recurso_id,usuario_id,ip',
    );
  });

  test('a fila de LGPD renderiza conteúdo próprio, não só a casca', async ({ page }) => {
    await page.goto('/configuracoes/lgpd');

    await expect(page.getByRole('heading', { level: 1, name: /Solicitações LGPD/u })).toBeVisible();

    // Dois âncoras: o título prova a rota; o corpo prova que a consulta terminou.
    // Era exatamente esta segunda metade que faltava quando a matriz classificava
    // a tela como "superficial".
    const corpo = await page.locator('main').innerText();
    expect(corpo, 'a fila de LGPD não carregou conteúdo').toMatch(/prazo|solicita|nenhuma/iu);
  });

  test('modelo de receita: cria, aparece na lista e some ao apagar', async ({ page }) => {
    test.setTimeout(180_000);
    assertPreviewParaMutacao();

    await page.goto('/modelos-receita');
    await expect(page.getByRole('heading', { level: 1, name: 'Modelos de receita' })).toBeVisible();

    // Nome único por execução: sem isso o teste passaria por causa de um resíduo
    // de execução anterior — o falso positivo clássico de CRUD.
    const nome = `E2E modelo ${Date.now()}`;

    // O editor fica atrás de "Novo modelo" — o formulário não existe no DOM
    // antes disso. Mesmo desenho do impersonate: o teste abre pelo caminho que a
    // pessoa usa, em vez de contornar.
    await page.getByRole('button', { name: 'Novo modelo' }).click();
    await page.getByPlaceholder('Nome *').fill(nome);
    await page.getByPlaceholder('Medicamento *').first().fill('Medicamento de teste');
    await page.getByRole('button', { name: 'Salvar' }).click();

    // Aparece na lista…
    await expect(page.getByText(nome), 'o modelo não apareceu depois de salvar').toBeVisible({
      timeout: 30_000,
    });

    // …e PERSISTE. Sem o reload, isto provaria estado de React, não gravação.
    await page.reload();
    await expect(page.getByText(nome), 'o modelo não sobreviveu ao reload').toBeVisible({
      timeout: 30_000,
    });

    // Excluir é confirmado por `DestructiveAction` — o teste passa pela
    // confirmação em vez de contorná-la, porque a confirmação É parte do
    // contrato de uma exclusão.
    const linha = page.locator('.listrow').filter({ hasText: nome }).first();
    await linha.getByRole('button', { name: 'Excluir' }).click();
    await page.getByRole('button', { name: 'Excluir modelo' }).click();

    // Cleanup É a asserção de exclusão: o registro some de verdade, e o ambiente
    // volta ao estado em que foi encontrado.
    await expect(page.getByText(nome), 'o modelo continuou na lista após excluir').toHaveCount(0, {
      timeout: 30_000,
    });

    await page.reload();
    await expect(page.getByText(nome), 'a exclusão não persistiu').toHaveCount(0, {
      timeout: 30_000,
    });
  });
});
