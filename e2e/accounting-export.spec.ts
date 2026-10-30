/**
 * 2.1A — o CSV contábil pelo caminho HTTP autenticado, ponta a ponta.
 *
 * POR QUE existe: a rota `/relatorios/contabilidade.csv` tinha 5 testes de
 * unidade (RBAC fresco, mês inválido, teto de linhas, rate limit, permissão
 * negada) e 22 de serialização/projeção — e nenhum spec exercitava o caminho
 * real. Unidade com I/O substituído não prova cabeçalho HTTP, BOM, disposition
 * nem o que a rota devolve ao browser de verdade.
 *
 * SOMENTE LEITURA: um GET autenticado e um anônimo. Não cria fixture, não
 * escreve no banco e não chama provider — por isso pode rodar contra Preview.
 *
 * A asserção central não é "deu 200": é que o arquivo **não contém paciente**.
 * O export é operacional e não fiscal (ADR-058); vazar identidade de paciente
 * num CSV que vai para a contabilidade seria o defeito grave desta rota.
 */
import { expect, test } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

const ROUTE = '/relatorios/contabilidade.csv';

/** Colunas que o arquivo DEVE ter (ADR-058). */
const EXPECTED_HEADER = [
  'data_movimento',
  'hora_movimento',
  'tipo_movimento',
  'natureza_lancamento',
  'descricao',
  'fornecedor',
  'fornecedor_cnpj',
  'valor_movimento',
  'efeito_caixa',
  'forma_pagamento',
  'vencimento',
  'status_atual_lancamento',
  'origem_lancamento',
  'lancamento_id',
  'transacao_id',
  'transacao_original_id',
  'motivo_estorno',
];

function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === 'year')!.value;
  const month = parts.find((p) => p.type === 'month')!.value;
  return `${year}-${month}`;
}

test.describe('2.1A — exportação contábil pelo HTTP autenticado', () => {
  test.describe.configure({ timeout: 180_000 });

  test('entrega CSV com cabeçalho da ADR-058, sem dado de paciente', async ({
    page,
    context,
  }, testInfo) => {
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta descartável.',
    );

    await authenticate(page);
    const baseUrl = new URL(page.url()).origin;

    const response = await context.request.get(`${baseUrl}${ROUTE}?mes=${currentMonth()}`);
    expect(response.status()).toBe(200);

    const headers = response.headers();
    expect(headers['content-type']).toContain('text/csv');
    // Extração em massa de dado financeiro não pode ser cacheada por
    // intermediário nem sniffada para outro tipo.
    expect(headers['cache-control']).toContain('no-store');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-disposition']).toContain('attachment');
    expect(headers['content-disposition']).toContain('movimentacao-financeira-');

    const body = await response.text();

    // BOM UTF-8: sem ele o Excel em português abre acento quebrado. A rota
    // prefixa `U+FEFF` de propósito (ADR-058).
    expect(body.charCodeAt(0)).toBe(0xfeff);

    const firstLine = body.slice(1).split('\r\n')[0]!;
    expect(firstLine.split(';')).toEqual(EXPECTED_HEADER);

    // CRLF separa registros; um mês sem movimentos contém só o cabeçalho.
    // Nenhuma quebra isolada deve aparecer em qualquer dos dois casos.
    expect(body.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/u);

    // O QUE MAIS IMPORTA: nenhuma coluna de paciente, CPF, consulta ou clínica.
    expect(firstLine).not.toMatch(/paciente|cpf|diagnostico|prontuario|consulta/iu);

    await testInfo.attach('accounting-export-audit', {
      body: JSON.stringify(
        { status: response.status(), bytes: body.length, columns: firstLine.split(';').length },
        null,
        2,
      ),
      contentType: 'application/json',
    });
  });

  test('recusa mês malformado sem entregar arquivo', async ({ page, context }) => {
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta descartável.',
    );

    await authenticate(page);
    const baseUrl = new URL(page.url()).origin;

    const response = await context.request.get(`${baseUrl}${ROUTE}?mes=agosto`);

    // 422 e não 500: mês inválido é entrada do usuário, não falha do servidor.
    expect(response.status()).toBe(422);
    expect(response.headers()['content-type']).not.toContain('text/csv');
  });
});

/**
 * Bloco separado porque precisa ANULAR o `storageState`: com `E2E_AUTH_REUSE=1`
 * a config injeta a sessão em todos os fixtures, inclusive no `request`, e um
 * "anônimo" autenticado passaria por engano — foi o que aconteceu na primeira
 * execução deste spec.
 */
test.describe('2.1A — exportação contábil sem sessão', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('anônimo não recebe o arquivo', async ({ request, baseURL }) => {
    const response = await request.get(`${baseURL}${ROUTE}`, { maxRedirects: 0 });

    // O middleware intercepta antes do handler; o que importa é que nenhum byte
    // de CSV atravessa sem sessão.
    expect(response.status()).toBeGreaterThanOrEqual(300);
    expect(response.headers()['content-type'] ?? '').not.toContain('text/csv');
  });
});
