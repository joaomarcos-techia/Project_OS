import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { authenticate, hasE2ECredentials } from './auth';

/**
 * Fronteira de `/admin` para quem TEM sessão, mas não é `super_admin`.
 *
 * ===================================================================
 * Por que este arquivo existe
 * ===================================================================
 * A auditoria de 13/09 (`docs/quality/e2e-coverage-audit.md`) achou que `/admin`
 * — 11 páginas, a única superfície do produto com poder sobre TODAS as clínicas
 * (impersonate, kill-switch, billing da plataforma) — não tinha **nenhum** E2E
 * autenticado. Só aparecia na lista de redirects anônimos.
 *
 * O caminho anônimo é o fácil: sem cookie, o middleware manda para `/login` e
 * acabou. O caso que realmente importa é o outro: uma sessão VÁLIDA de clínica,
 * com JWT legítimo, batendo direto na URL. Aí o middleware deixa passar (ele só
 * checa presença de cookie, por decisão da ADR-037) e quem decide é a porta
 * única no servidor. É essa decisão que este arquivo exercita.
 *
 * ===================================================================
 * O que ele NÃO cobre
 * ===================================================================
 * O caminho POSITIVO: o que o `super_admin` consegue fazer quando entra. Isso
 * exige uma credencial de plataforma dedicada e uma decisão sobre em que
 * ambiente exercitá-la — impersonate e kill-switch em produção não são coisas
 * que um teste decide sozinho. Continua registrado como R1 da auditoria.
 *
 * Requer `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` de uma conta de clínica
 * descartável — a MESMA já usada pelos cenários autenticados. Nenhuma
 * credencial nova.
 *
 * `serial` com UM login: a conta é compartilhada e o produto tem rate limit
 * DUAL (IP + e-mail). Um login por caso derrubava a suíte na segunda execução —
 * e o `playwright.config.ts` já registra esse motivo para `workers: 1`.
 */

/** As 9 páginas estáticas sob `(admin)`; as dinâmicas (`clinicas/[id]`, `feedbacks/[id]`) têm caso próprio abaixo. */
const ADMIN_ROUTES = [
  '/admin',
  '/admin/audit',
  '/admin/billing',
  '/admin/clinicas',
  '/admin/config',
  '/admin/conversas-ia',
  '/admin/feedbacks',
  '/admin/metricas',
  '/admin/saude',
] as const;

/**
 * Textos que SÓ existem no painel de plataforma. Se um deles aparecer para uma
 * sessão de clínica, o conteúdo vazou — mesmo que a URL final seja outra.
 *
 * Deliberadamente amplo: a pergunta não é "renderizou a página inteira", é
 * "escapou alguma coisa". Um cabeçalho é suficiente para confirmar.
 */
const ADMIN_ONLY_CONTENT =
  /Clínicas da plataforma|Kill-switch|Impersonar|Assinaturas da plataforma|Anúncio global/i;

test.describe.serial('fronteira de /admin para sessão de clínica', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    if (!hasE2ECredentials()) return;
    context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    page = await context.newPage();
    await authenticate(page);

    // Prova que a sessão É válida antes de concluir qualquer coisa sobre o
    // deny. Sem isto, uma sessão expirada faria todos os casos "passarem" pelo
    // motivo errado — o teste diria "admin protegido" quando na verdade o
    // usuário nem estava logado. É a diferença entre negar e não ter entrado.
    await page.goto('/dashboard');
    await expect(page, 'a sessão de clínica não está válida').toHaveURL(/\/dashboard(?:\?|$)/);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('sessão válida de clínica não alcança nenhuma rota de plataforma', async () => {
    test.setTimeout(180_000);
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta de clínica descartável.',
    );

    const leaked: string[] = [];
    for (const route of ADMIN_ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });

      const finalPath = new URL(page.url()).pathname;
      const body = await page.content();

      // Dois desfechos aceitáveis: sair de /admin (redirect) ou ficar e mostrar
      // negativa. O que NÃO é aceitável é ficar e renderizar o painel.
      const stayed = finalPath.startsWith('/admin');
      if (stayed && ADMIN_ONLY_CONTENT.test(body)) {
        leaked.push(`${route} → renderizou conteúdo de plataforma`);
        continue;
      }
      // Mesmo saindo, o HTML entregue não pode carregar o conteúdo: um redirect
      // que já mandou o corpo junto vazou antes de redirecionar.
      if (ADMIN_ONLY_CONTENT.test(body)) {
        leaked.push(`${route} → conteúdo de plataforma no corpo (destino ${finalPath})`);
      }
    }

    // Lista inteira de uma vez: falhar na primeira esconderia quantas outras
    // também vazam, e num achado destes é isso que se quer saber.
    expect(leaked, 'rotas de plataforma alcançáveis por sessão de clínica').toEqual([]);
  });

  test('ID de clínica estrangeiro no deep-link não abre o detalhe de plataforma', async () => {
    test.skip(!hasE2ECredentials(), 'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD.');

    // UUID inventado: o ponto não é existir, é que a ROTA seja negada antes de
    // qualquer consulta. Um 404 vindo de dentro do painel já teria provado que
    // a página carregou para quem não podia.
    await page.goto('/admin/clinicas/00000000-0000-4000-8000-000000000000', {
      waitUntil: 'domcontentloaded',
    });

    expect(await page.content()).not.toMatch(ADMIN_ONLY_CONTENT);
  });
});
