import { expect, test } from '@playwright/test';

/**
 * Superfície pública — o que dá para provar SEM conta nenhuma.
 *
 * ===================================================================
 * Por que este arquivo existe separado dos `production-*`
 * ===================================================================
 * Os 51 specs `production-*` são excelentes e provam coisas que nada mais
 * prova — mas todos exigem (a) uma autorização por variável de ambiente, (b)
 * credenciais de clínica sintética e, a maioria, (c) conexão direta ao Postgres
 * de PRODUÇÃO. Isso os torna uma FERRAMENTA DE AUDITORIA operada por gente, não
 * um gate: nenhum deles pode rodar em CI, e de fato nenhum roda (`ci.yml` não
 * tem passo de Playwright).
 *
 * Este arquivo cobre a fatia que não precisa de segredo: cabeçalhos, fronteira
 * sem sessão e integridade estrutural do formulário de login. É pouco comparado
 * ao que os outros fazem — e é o pouco que pode rodar a cada PR.
 *
 * Requer apenas `E2E_BASE_URL` (ou o servidor local que o Playwright sobe).
 */

/** Rotas que NINGUÉM sem sessão pode ver renderizadas. */
const PROTECTED_ROUTES = [
  '/dashboard',
  '/pacientes',
  '/agenda',
  '/consultorio',
  '/conversas',
  '/financeiro',
  '/caixa',
  '/relatorios',
  '/equipe',
  '/documentos',
  '/modelos-receita',
  '/configuracoes',
  '/configuracoes/pagamentos',
  '/configuracoes/auditoria',
  '/admin',
  '/admin/saude',
  '/admin/metricas',
  '/admin/billing',
  '/admin/audit',
  '/admin/config',
  '/admin/conversas-ia',
  '/admin/feedbacks',
] as const;

test.use({ storageState: { cookies: [], origins: [] } });

test('retorno público do Checkout informa verificação sem afirmar pagamento', async ({ page }) => {
  await page.goto('/?payment=success', { waitUntil: 'domcontentloaded' });

  await expect(
    page.getByRole('heading', { name: 'Estamos verificando seu pagamento' }),
  ).toBeVisible();
  await expect(
    page.getByText('O Asaas ainda precisa confirmar a cobrança', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Esta página não é um comprovante', { exact: false })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('a ponte de retomada executa sob CSP restrita e só envia prova após clique', async ({
  page,
}) => {
  // Prova de navegador da ponte, sem Auth/SQL: somente a API é interceptada.
  // O token sintético não corresponde a nenhum grant ou destinatário.
  const token = 'A'.repeat(43);
  let submissions = 0;
  await page.route('**/api/signup/recovery/consume', async (route) => {
    submissions++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({
      status: 410,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'invalid' }),
    });
  });

  const response = await page.goto(`/cadastro/retomar#token=${token}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  const csp = response?.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("script-src 'sha256-");
  expect(csp).not.toContain('unsafe-inline');
  await expect.poll(() => new URL(page.url()).hash).toBe('');
  expect(submissions).toBe(0);
  await page.getByRole('button', { name: 'Continuar meu cadastro', exact: true }).click();
  await expect(page.locator('#feedback')).toContainText('Este link expirou ou já foi usado.');
  expect(submissions).toBe(1);
});

test.describe('fronteira sem sessão', () => {
  test('toda rota protegida redireciona SEM entregar corpo', async ({ request }) => {
    test.setTimeout(180_000);

    // Contexto HTTP em vez de navegador, e `maxRedirects: 0` de propósito: o
    // ponto não é "acaba em /login", é que a resposta da rota protegida seja um
    // redirect e NÃO um 200 com o shell renderizado. Seguir o redirect
    // esconderia exatamente o caso ruim — um corpo entregue antes do destino.
    // Aquecimento: quando o alvo é um Preview protegido, a PRIMEIRA resposta é
    // um redirect da própria Vercel para a mesma URL, só para fixar o cookie de
    // bypass. Sem este GET descartável, o primeiro salto observado abaixo seria
    // o da Vercel e não o da aplicação — e o teste reportaria um vazamento que
    // não existe (foi o que aconteceu na primeira versão).
    await request.get('/login');

    /**
     * Uma tentativa. Devolve `null` quando a rota se comportou como deve.
     *
     * Separado em função porque o chamador tenta DUAS vezes: a primeira
     * requisição a uma rota fria (servidor recém-subido, função serverless
     * adormecida) pode responder de forma atípica, e um gate que quebra o merge
     * de todo mundo por causa disso é pior que inútil — ensina a ignorar
     * vermelho. Uma rota genuinamente desprotegida falha nas duas.
     */
    const probe = async (route: string): Promise<string | null> => {
      const response = await request.get(route, { maxRedirects: 0 });
      const location = response.headers()['location'] ?? '';
      const redirected = response.status() >= 300 && response.status() < 400;

      if (!redirected || !location.includes('/login')) {
        return `${route} → ${response.status()} ${location || '(sem Location)'}`;
      }
      // Corpo vazio: um redirect que ainda assim carrega HTML do shell teria
      // vazado o conteúdo para quem olha a resposta crua.
      const body = await response.text();
      if (/<main|data-clinic|Prontuário|Agenda da clínica/i.test(body)) {
        return `${route} → redirect COM corpo (${body.length} bytes)`;
      }
      return null;
    };

    const leaked: string[] = [];
    for (const route of PROTECTED_ROUTES) {
      const first = await probe(route);
      if (first === null) continue;
      const second = await probe(route);
      if (second !== null) leaked.push(second);
    }

    // Lista inteira de uma vez: falhar na primeira esconderia quantas outras
    // também vazam, e é justamente isso que se quer saber num achado destes.
    expect(leaked, 'rotas protegidas alcançáveis sem sessão').toEqual([]);
  });

  test('as rotas de super_admin não são exceção', async ({ page }) => {
    // Separado de propósito: `/admin` é a única superfície do produto com poder
    // sobre TODAS as clínicas. Um vazamento aqui não é de um tenant, é de todos.
    await page.goto('/admin', { waitUntil: 'domcontentloaded' });

    expect(page.url(), '/admin não mandou para o login').toMatch(/\/login(?:\?|$)/);
    expect(await page.content(), 'conteúdo de admin no HTML entregue').not.toMatch(
      /Clínicas da plataforma|Kill-switch|Impersonar/i,
    );
  });
});

test.describe('cabeçalhos de segurança da página pública', () => {
  test('a CSP libera o Turnstile nas três diretivas e nenhum curinga', async ({ page }) => {
    const response = await page.goto('/login');
    const csp =
      response?.headers()['content-security-policy'] ??
      response?.headers()['Content-Security-Policy'] ??
      '';

    expect(csp, 'CSP ausente na página de login').toBeTruthy();

    const directive = (name: string) =>
      csp
        .split(';')
        .map((p) => p.trim())
        .find((p) => p.startsWith(`${name} `)) ?? '';

    // O widget CARREGA script, RENDERIZA em iframe e FALA com a Cloudflare.
    // Faltando qualquer uma das três, ele some sem erro visível.
    for (const name of ['script-src', 'frame-src', 'connect-src']) {
      expect(directive(name), `${name} sem o Turnstile`).toContain(
        'https://challenges.cloudflare.com',
      );
    }

    // As proteções que já existiam continuam de pé: sem curinga, sem `https:`
    // genérico (que permitiria exfiltrar prontuário para qualquer host TLS).
    for (const name of ['connect-src', 'img-src', 'script-src', 'frame-src']) {
      expect(directive(name), `${name} aceita curinga`).not.toMatch(/(?:^|\s)\*(?:$|\s)/);
      expect(directive(name), `${name} aceita https: genérico`).not.toMatch(
        /(?:^|\s)https:(?:$|\s)/,
      );
    }
  });

  test('a secret do Turnstile NUNCA chega ao navegador', async ({ page }) => {
    const secret = process.env.TURNSTILE_SECRET_KEY;
    test.skip(!secret, 'TURNSTILE_SECRET_KEY não configurada neste ambiente.');

    await page.goto('/login');

    // Checagem contra o valor REAL do ambiente, que o gate estático de bundle
    // não tem como conhecer. Falhar aqui significa que a secret foi declarada
    // com prefixo `NEXT_PUBLIC_` em algum lugar.
    expect(await page.content(), 'secret do Turnstile no HTML servido').not.toContain(secret!);
  });
});

test.describe('integridade estrutural do formulário de login', () => {
  test('os campos que a server action lê existem com os nomes que ela espera', async ({ page }) => {
    await page.goto('/login');

    // `loginAction` faz `formData.get('email' | 'password')`. Renomear um input
    // no design quebra o login inteiro e NENHUM teste unitário percebe: o teste
    // da action monta o FormData à mão.
    //
    // O escopo é o form QUE TEM SENHA: a recuperação inline usa o mesmo
    // `name="email"` (com id próprio), então contar por name na página inteira
    // dá 2 e não diz nada sobre qual formulário está certo.
    const loginForm = page.locator('form:has(input[name="password"])');
    await expect(loginForm).toHaveCount(1);
    await expect(loginForm.locator('input[name="email"]')).toHaveCount(1);
    await expect(loginForm.locator('input[name="password"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
  });

  test('o campo do captcha acompanha a presença da site key', async ({ page }) => {
    await page.goto('/login');

    const field = page.locator('form:has(input[name="password"]) input[name="captchaToken"]');
    const widget = page.getByTestId('turnstile-widget');

    // Contrato dos dois lados: com site key configurada, o campo TEM de existir
    // (senão o token nunca chega ao Supabase e o login quebra no dia em que o
    // captcha for ligado); sem ela, NÃO deve existir — um campo vazio enviado
    // ao GoTrue é token inválido, não token ausente.
    if ((await widget.count()) > 0) {
      await expect(field).toHaveCount(1);
    } else {
      await expect(field, 'campo de captcha sem widget que o preencha').toHaveCount(0);
    }
  });

  test('o desafio resolve e entrega token — não fica preso em "loading"', async ({ page }) => {
    await page.goto('/login');

    const hosts = page.getByTestId('turnstile-widget');
    const total = await hosts.count();
    test.skip(total === 0, 'Ambiente sem NEXT_PUBLIC_TURNSTILE_SITE_KEY — não há widget.');

    // ESTE é o teste que custou uma hora de diagnóstico em 13/09.
    //
    // A falha do Turnstile é MUDA: chave registrada para outro hostname, CSP
    // sem `frame-src`, script que não injetou — tudo produz o MESMO sintoma,
    // `loading` para sempre, sem iframe, sem token e sem callback de erro. Um
    // teste que só verificasse "o widget existe" passaria em todos esses casos.
    //
    // O que ele afirma é o desfecho: estado terminal e token no campo que a
    // server action vai ler. `error`/`expired` também reprovam — não é "saiu de
    // loading", é "resolveu".
    for (let i = 0; i < total; i++) {
      const host = hosts.nth(i);
      await expect(host, `widget ${i} não resolveu o desafio`).toHaveAttribute(
        'data-turnstile-state',
        'solved',
        { timeout: 30_000 },
      );
    }

    const tokens = page.locator('input[name="captchaToken"]');
    for (let i = 0; i < (await tokens.count()); i++) {
      expect(
        (await tokens.nth(i).inputValue()).length,
        `campo ${i} ficou sem token`,
      ).toBeGreaterThan(0);
    }

    // Uma injeção só, compartilhada pelos dois widgets da tela (login e
    // recuperação). Duas tags significaria a corrida que o singleton evita.
    expect(
      await page.locator('script[src*="challenges.cloudflare.com"]').count(),
      'o script do Turnstile foi injetado mais de uma vez',
    ).toBe(1);
  });

  test('a recuperação de senha não aninha formulário dentro do login', async ({ page }) => {
    await page.goto('/login');
    await page.getByText('Esqueci a senha').click();

    // `<form>` dentro de `<form>` é HTML inválido: o navegador descarta o
    // interno e o botão de recuperação passa a submeter o LOGIN. Já foi o
    // motivo de o `ForgotPasswordForm` viver fora do form de login.
    expect(await page.locator('form form').count(), 'formulário aninhado').toBe(0);
    await expect(page.locator('input[name="email"]#recovery-email')).toBeVisible();
  });
});
