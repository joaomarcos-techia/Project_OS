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
  /Clínicas da plataforma|Kill-switch|Impersonar|Assinaturas da plataforma|Anúncio global/i;

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

    // O login pode ser recusado pelo rate limit DUAL do produto (IP + e-mail) —
    // a conta é compartilhada, e repetir a suíte dentro da janela de 15 min
    // esgota o balde. Isso é o produto funcionando, não regressão.
    let autenticado = true;
    try {
      await authenticate(page);
      await page.goto('/dashboard');
      autenticado = /\/dashboard(?:\?|$)/.test(page.url());
    } catch {
      autenticado = false;
    }

    // Skip ANOTADO, nunca verde. Sem sessão válida, todo caso abaixo "passaria"
    // pelo motivo errado: o teste diria "admin protegido" quando na verdade
    // ninguém tinha entrado. É a diferença entre negar e não ter entrado — e é
    // exatamente o falso positivo que a auditoria manda evitar.
    test.skip(
      !autenticado,
      'Não foi possível estabelecer sessão de clínica (rate limit de login, provável). ' +
        'Aguarde a janela de 15 min ou use E2E_AUTH_REUSE=1 — isto NÃO é aprovação.',
    );

    const leaked: string[] = [];

    // UUID inventado no deep-link: o ponto não é existir, é que a ROTA seja
    // negada antes de qualquer consulta. Um 404 vindo de DENTRO do painel já
    // teria provado que a página carregou para quem não podia.
    const alvos = [...ADMIN_ROUTES, '/admin/clinicas/00000000-0000-4000-8000-000000000000'];

    for (const route of alvos) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });

      const finalPath = new URL(page.url()).pathname;
      const body = await page.content();

      // Dois desfechos aceitáveis: sair de /admin (redirect) ou ficar e mostrar
      // negativa. O que NÃO é aceitável é ficar e renderizar o painel — nem
      // entregar o conteúdo no corpo de um redirect, que já teria vazado.
      if (ADMIN_ONLY_CONTENT.test(body)) {
        leaked.push(`${route} → conteúdo de plataforma (destino ${finalPath})`);
      }
    }

    // Lista inteira de uma vez: falhar na primeira esconderia quantas outras
    // também vazam, e num achado destes é isso que se quer saber.
    expect(leaked, 'rotas de plataforma alcançáveis por sessão de clínica').toEqual([]);
  });
});
