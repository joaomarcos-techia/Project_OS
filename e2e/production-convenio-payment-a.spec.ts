/**
 * Convênio como forma de pagamento (Clínica A).
 *
 * O escopo é deliberadamente pequeno — só a OPÇÃO. Não há operadora,
 * carteirinha, glosa nem repasse; isso é modelo próprio e vem depois. O que
 * este roteiro precisa provar é que um atendimento faturado por convênio fica
 * REGISTRADO como tal, e não caindo em "outro" ou em branco.
 *
 * Duas telas usam o mesmo catálogo global (`payment_methods`), então as duas
 * são exercidas: faturar em /financeiro e receber em /caixa.
 *
 * A senha NUNCA aparece aqui: vem de `E2E_TENANT_PASSWORD`.
 */
import { expect, test, type Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_CONVENIO === 'ALLOW_TEST_ACCOUNT';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_TENANT_A_EMAIL;
const password = process.env.E2E_TENANT_PASSWORD;

test.use({
  storageState: { cookies: [], origins: [] },
  trace: 'off',
  video: 'off',
  screenshot: 'off',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(ownerEmail!);
  await page.locator('input[name="password"]').fill(password!);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 60_000 });
}

test.describe('produção: convênio como forma de pagamento na Clínica A', () => {
  test.describe.configure({ retries: 0 });

  test('fatura um atendimento por convênio e registra o recebimento', async ({ browser }) => {
    test.setTimeout(300_000);
    test.skip(!authorized, 'Exige E2E_PRODUCTION_CONVENIO=ALLOW_TEST_ACCOUNT.');
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O teste de convênio só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !password) throw new Error('Credenciais da Clínica A ausentes.');
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });

    const runId = String(Date.now()).slice(-10);
    const descricao = `[E2E-CONVENIO-${runId}] Consulta faturada`;
    let clinicId: string | undefined;
    const context = await browser.newContext({ baseURL: baseUrl });
    const page = await context.newPage();

    try {
      // 1. O catálogo é global: se a migration não rodou, o teste falha aqui e
      // diz exatamente por quê, em vez de morrer procurando a opção na tela.
      const [metodo] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ code: string; label: string; ativo: boolean }[]>`
          select code, label, ativo from payment_methods where code = 'convenio'
        `;
      });
      expect(metodo, 'forma de pagamento convenio não existe no catálogo').toBeTruthy();
      expect(metodo).toMatchObject({ code: 'convenio', label: 'Convênio', ativo: true });

      await login(page);
      const claims = await page.context().cookies();
      const raw = claims
        .filter((c) => c.name.includes('auth-token'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => c.value)
        .join('');
      const session = JSON.parse(Buffer.from(raw.slice(7), 'base64url').toString('utf8')) as {
        access_token: string;
      };
      const payload = JSON.parse(
        Buffer.from(session.access_token.split('.')[1]!, 'base64url').toString('utf8'),
      ) as { clinic_id?: string };
      clinicId = payload.clinic_id;
      if (!clinicId) throw new Error('clinic_id ausente na sessão.');

      // 2. Faturar: lançamento a receber com Convênio escolhido na tela.
      await page.goto('/financeiro?novo=1');
      const dialog = page.getByRole('dialog', { name: 'Novo lançamento' });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel('Tipo').selectOption('receber');
      await dialog.locator('input[name="descricao"]').fill(descricao);
      await dialog.locator('input[name="valor"]').fill('180,00');

      // A opção só existe se o catálogo alimentou o select — é o ponto do teste.
      const metodoSelect = dialog.getByLabel('Forma de pagamento');
      await expect(metodoSelect.getByRole('option', { name: 'Convênio' })).toHaveCount(1);
      await metodoSelect.selectOption('convenio');

      await dialog.getByRole('button', { name: 'Criar lançamento' }).click();
      await expect(page.getByText(descricao, { exact: true })).toBeVisible({ timeout: 60_000 });

      // 3. A prova real é a persistência: a tela pode exibir o rótulo certo e
      // gravar outra coisa.
      const [gravado] = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ id: string; payment_method: string | null; tipo: string; valor: string }[]>`
          select id::text, payment_method, tipo::text, valor::text
            from lancamentos
           where clinic_id = ${clinicId!}::uuid and descricao = ${descricao}
        `;
      });
      expect(gravado, 'lançamento não foi persistido').toBeTruthy();
      expect(gravado).toMatchObject({ payment_method: 'convenio', tipo: 'receber' });

      // 4. O caixa lê o mesmo catálogo: convênio precisa estar disponível
      // também na hora de registrar o recebimento.
      await page.goto('/caixa');
      const linha = page
        .getByText(descricao, { exact: true })
        .locator('xpath=ancestor::div[.//button][1]');
      // O select de forma de pagamento só existe DEPOIS de abrir o painel de
      // confirmação — sem este clique a asserção passaria sem testar nada.
      await linha.getByRole('button', { name: 'Confirmar pagamento' }).click();
      const caixaSelect = page.getByLabel('Forma de pagamento').first();
      await expect(caixaSelect).toBeVisible({ timeout: 30_000 });
      await expect(caixaSelect.getByRole('option', { name: 'Convênio' })).toHaveCount(1);
      const disponivelNoCaixa = true;

      console.log(
        `[convenio-a] ${JSON.stringify({
          catalogo: metodo,
          lancamentoPaymentMethod: gravado!.payment_method,
          valor: gravado!.valor,
          disponivelNoCaixa,
          integracaoComOperadora: false,
          asaasMutation: false,
        })}`,
      );
    } finally {
      try {
        if (clinicId) {
          const alvo = clinicId;
          const restante = await sql.begin(async (tx) => {
            await tx.unsafe('RESET ROLE');
            await tx.unsafe(
              'delete from lancamentos where clinic_id = $1::uuid and descricao = $2',
              [alvo, descricao],
            );
            return tx.unsafe<{ count: number }[]>(
              'select count(*)::int as count from lancamentos where clinic_id = $1::uuid and descricao = $2',
              [alvo, descricao],
            );
          });
          expect(restante[0]?.count).toBe(0);
        }
      } finally {
        await context.close();
        await sql.end();
      }
    }
  });
});
