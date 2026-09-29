import { expect, test } from '@playwright/test';

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
 * Para auditoria ampla, rode com `E2E_AUTH_REUSE=1`: o `authenticate()` só faz
 * login quando a sessão guardada não serve mais, e é isso que impede a suíte de
 * acionar o rate limit da própria aplicação.
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
  /Visão geral|Auditoria|Pagamentos|Clínicas|Configurações da plataforma|Conversas IA|Feedbacks|Métricas|Saúde da plataforma|Kill-switch|Impersonar|Anúncio global/iu;
const ADMIN_SENSITIVE_RSC_CONTENT =
  /Configurações da plataforma|Saúde da plataforma|Kill-switch|Impersonar|Anúncio global|Trilha cross-tenant/iu;

const DASHBOARD_ROUTER_STATE = encodeURIComponent(
  JSON.stringify([
    '',
    { children: ['dashboard', { children: ['__PAGE__', {}, null, null] }, null, null] },
    null,
    null,
    true,
  ]),
);

test.describe('fronteira de /admin para sessão de clínica', () => {
  /**
   * UM caso, não dois, e UM login.
   *
   * A conta é compartilhada com os outros cenários autenticados e o produto tem
   * rate limit DUAL (IP + e-mail). A primeira versão deste arquivo logava por
   * caso e foi reprovada pelo próprio guard de sessão abaixo, ao bater no
   * limite — o guard fez o trabalho dele: acusou em vez de dar verde falso.
   *
   * Usa o fixture `page` padrão de propósito, para herdar o `storageState` do
   * `playwright.config.ts` quando `E2E_AUTH_REUSE=1` estiver ligado. Um contexto
   * próprio com storage vazio anularia justamente a proteção contra rate limit
   * que o README manda usar em auditoria ampla.
   */
  test('nem rota, nem deep-link de plataforma respondem a uma sessão de clínica', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    test.skip(
      !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD de uma conta de clínica descartável.',
    );

    await authenticate(page);
    const control = await page.goto('/dashboard');
    expect(control?.status(), 'o controle positivo autenticado não respondeu 200').toBe(200);
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/);
    await expect(page.locator('main')).toBeVisible();

    const leaked: string[] = [];
    const cookieHeader = (await page.context().cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ');
    expect(
      cookieHeader,
      'a sessão autenticada não produziu cookies para os probes diretos',
    ).not.toBe('');
    const rscHeaders = {
      Accept: 'text/x-component',
      Cookie: cookieHeader,
      RSC: '1',
      'Next-Router-State-Tree': DASHBOARD_ROUTER_STATE,
      'Next-Url': '/dashboard',
    };

    // UUID inventado no deep-link: o ponto não é existir, é que a ROTA seja
    // negada antes de qualquer consulta. Um 404 vindo de DENTRO do painel já
    // teria provado que a página carregou para quem não podia.
    const alvos = [
      ...ADMIN_ROUTES,
      '/admin/clinicas/00000000-0000-4000-8000-000000000000',
      '/admin/feedbacks/00000000-0000-4000-8000-000000000000',
    ];

    for (const route of alvos) {
      const response = await page.goto(route, { waitUntil: 'domcontentloaded' });

      const finalPath = new URL(page.url()).pathname;
      const visibleText = await page.locator('body').innerText();

      expect(response?.status(), `${route} não aplicou a negativa 404 anti-enumeração`).toBe(404);
      expect(finalPath, `${route} redirecionou e revelou um destino alternativo`).toBe(route);
      await expect(page.getByText('Página não encontrada', { exact: true })).toBeVisible();

      if (ADMIN_ONLY_CONTENT.test(visibleText)) {
        leaked.push(`${route} → conteúdo de plataforma (destino ${finalPath})`);
      }

      const rsc = await page.context().request.get(route, {
        headers: rscHeaders,
      });
      const rscBody = await rsc.text();
      expect(rsc.status(), `${route} devolveu transporte RSC inesperado`).toBe(200);
      expect(rsc.headers()['content-type']).toContain('text/x-component');
      expect(rscBody, `${route} não carregou a negativa 404 no payload RSC`).toContain(
        'NEXT_HTTP_ERROR_FALLBACK;404',
      );
      if (ADMIN_SENSITIVE_RSC_CONTENT.test(rscBody)) {
        leaked.push(`${route} → conteúdo de plataforma no payload RSC`);
      }
    }

    // Lista inteira de uma vez: falhar na primeira esconderia quantas outras
    // também vazam, e num achado destes é isso que se quer saber.
    expect(leaked, 'rotas de plataforma alcançáveis por sessão de clínica').toEqual([]);

    const routeHandlers = [
      {
        method: 'get' as const,
        route: '/admin/feedbacks/export',
        expected: 404,
      },
      {
        method: 'post' as const,
        route:
          '/admin/clinicas/00000000-0000-4000-8000-000000000000/audit/export?from=2026-01-01&to=2026-01-02',
        expected: 404,
      },
      { method: 'get' as const, route: '/api/health', expected: 401 },
      { method: 'get' as const, route: '/api/health/outbox', expected: 401 },
    ];

    for (const handler of routeHandlers) {
      const response =
        handler.method === 'post'
          ? await page.context().request.post(handler.route, {
              headers: { Cookie: cookieHeader },
              maxRedirects: 0,
            })
          : await page.context().request.get(handler.route, {
              headers: { Cookie: cookieHeader },
              maxRedirects: 0,
            });
      const responseBody = await response.text();
      expect(
        response.status(),
        `${handler.method.toUpperCase()} ${handler.route} não bloqueou a sessão tenant (url=${new URL(response.url()).pathname}; contentType=${response.headers()['content-type'] ?? 'ausente'}; disposition=${response.headers()['content-disposition'] ?? 'ausente'}; csv=${responseBody.includes('clinica,autor,titulo,descricao')}; admin=${ADMIN_ONLY_CONTENT.test(responseBody)}; bytes=${Buffer.byteLength(responseBody)})`,
      ).toBe(handler.expected);
      expect(responseBody, `${handler.route} vazou conteúdo administrativo`).not.toMatch(
        ADMIN_ONLY_CONTENT,
      );
    }
  });
});
