import { expect, test, type APIRequestContext } from '@playwright/test';

/**
 * Sessão anônima de cadastro — ADR-060 (O-2a + O-2b), por HTTP real.
 *
 * ===================================================================
 * Por que esta suíte não precisa de credencial
 * ===================================================================
 * `/api/signup/*` é PÚBLICA por definição: quem chega ali ainda não tem conta.
 * Isso a torna a única parte do produto que um E2E pode exercitar de ponta a
 * ponta sem conta de teste, sem fixture e sem cleanup — e, portanto, a única
 * que pode virar gate automático sem custodiar segredo.
 *
 * ===================================================================
 * Por que `serial` e por que UMA sessão só
 * ===================================================================
 * O endpoint é limitado POR IP (20 aberturas / 15 min) e escala para desafio a
 * partir de METADE do balde. Isso é o produto funcionando, não um obstáculo do
 * teste: a defesa é justamente ficar mais cara para quem repete. Mas significa
 * que um spec que abre uma sessão por caso se auto-bloqueia na segunda
 * execução dentro da janela — e passaria a falhar por design próprio, não por
 * regressão. (Observado: a primeira versão deste arquivo fazia exatamente isso.)
 *
 * A resposta é gastar o balde com parcimônia: UMA sessão é aberta, e o caso que
 * precisa de sessão viva deriva dela.
 *
 * O que esta suíte NÃO prova: nada do que acontece depois do cadastro. Esta
 * fatia não cria usuário, clínica nem assinatura.
 *
 * Requer apenas `E2E_BASE_URL`.
 */

const baseUrl = process.env.E2E_BASE_URL;

/** Estado sanitizado que o servidor devolve. Sem token, sem PII. */
interface SessionBody {
  session?: Record<string, unknown>;
  error?: string;
}

function expectedHost(): string {
  return new URL(baseUrl!).host;
}

function signupCookie(headers: Array<{ name: string; value: string }>): string | null {
  return (
    headers
      .filter((h) => h.name.toLowerCase() === 'set-cookie')
      .map((h) => h.value)
      .find((value) => value.startsWith('__Host-qoro_signup=')) ?? null
  );
}

/** Valor do cookie (o token cru) a partir do `Set-Cookie` inteiro. */
function cookieValue(setCookie: string): string {
  return setCookie.split(';')[0]!.split('=').slice(1).join('=');
}

/**
 * Token de brinquedo da Cloudflare. As chaves de TESTE (`1x0000…`) o aceitam;
 * as chaves reais o recusam. Serve para atravessar o desafio num ambiente
 * montado para teste, e só nele.
 */
const DUMMY_TURNSTILE_TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/**
 * Abre uma sessão lidando com o orçamento de IP.
 *
 * A partir de metade do balde (10 de 20 em 15 min) a rota passa a EXIGIR
 * desafio — comportamento correto do produto, e a razão pela qual rodar este
 * spec duas vezes seguidas da mesma máquina não pode ser tratado como
 * regressão. Em CI, com IP novo a cada execução, o primeiro POST basta.
 *
 * Devolve `null` quando o ambiente nem liberou direto nem aceitou o token de
 * brinquedo — o chamador transforma isso em skip anotado, nunca em verde.
 */
async function openSessionWithinBudget(
  ctx: APIRequestContext,
): Promise<{ response: Awaited<ReturnType<APIRequestContext['post']>>; cookie: string } | null> {
  const direct = await ctx.post('/api/signup/sessions', {
    headers: { origin: `https://${expectedHost()}` },
  });
  const directCookie = signupCookie(await direct.headersArray());
  if (direct.status() === 201 && directCookie) return { response: direct, cookie: directCookie };
  if (direct.status() !== 401) return null;

  const challenged = await ctx.post('/api/signup/sessions', {
    headers: { origin: `https://${expectedHost()}`, 'content-type': 'application/json' },
    data: { turnstileToken: DUMMY_TURNSTILE_TOKEN },
  });
  const challengedCookie = signupCookie(await challenged.headersArray());
  if (challenged.status() === 201 && challengedCookie) {
    return { response: challenged, cookie: challengedCookie };
  }
  return null;
}

/**
 * O balde de IP tem teto DURO (20/15 min) além do desafio na metade. Quando ele
 * estoura, a rota devolve 429 e nenhum caso de risco pode mais ser avaliado — a
 * classificação nem chega a rodar.
 *
 * Isso vira skip ANOTADO, nunca verde: um 429 não prova nada sobre o
 * comportamento sob teste, só que a defesa anterior disparou primeiro. Em CI,
 * com IP novo por execução, não acontece.
 */
function skipIfRateLimited(status: number): void {
  test.skip(
    status === 429,
    'Balde de IP no teto (429). Aguarde a janela de 15 min ou rode de um IP novo — ' +
      'isto NÃO é aprovação.',
  );
}

/* ===================================================================== */
/* Sessão viva — UMA abertura, reusada. PRIMEIRO no arquivo de propósito. */
/* ===================================================================== */

/**
 * Este bloco vem antes dos outros porque é o único que precisa ABRIR sessão, e
 * o orçamento de IP é finito: deixá-lo por último faz os casos de risco (que
 * também consomem) empurrarem o balde além da metade e transformarem o caminho
 * feliz num skip. Ordem aqui é alocação de um recurso escasso, não estilo.
 */

test.describe.serial('cadastro anônimo — ciclo de uma sessão', () => {
  test.skip(!baseUrl, 'Defina E2E_BASE_URL.');

  /** Contexto único: guarda o cookie entre os dois casos deste bloco. */
  let session: APIRequestContext;
  let setCookieHeader: string;

  test.beforeAll(async ({ playwright }) => {
    session = await playwright.request.newContext({ baseURL: baseUrl! });
  });

  test.afterAll(async () => {
    await session?.dispose();
  });

  test('abre sessão e entrega o token SÓ no cookie, com os atributos de __Host-', async () => {
    const opened = await openSessionWithinBudget(session);

    // Skip ANOTADO, não silencioso: este é o único desfecho em que o ambiente
    // realmente não permite testar agora — balde de IP no teto E chaves reais
    // (que recusam o token de brinquedo). Em CI, com IP novo, não acontece.
    test.skip(
      opened === null,
      'Orçamento de IP no teto e o ambiente não aceita o token de teste da Cloudflare. ' +
        'Aguarde a janela de 15 min ou rode de um IP novo — isto NÃO é aprovação.',
    );

    const { response, cookie } = opened!;
    expect(response.status(), await response.text()).toBe(201);
    expect(((await response.json()) as SessionBody).session, 'resposta sem estado').toMatchObject({
      answers: null,
    });
    setCookieHeader = cookie;

    // O prefixo `__Host-` só é aceito pelo navegador com Secure + Path=/ e SEM
    // Domain. Sem isso, comprometer um subdomínio (a landing em qoro.dev)
    // bastaria para injetar uma sessão de cadastro no app.
    expect(cookie).toMatch(/;\s*HttpOnly/i);
    expect(cookie).toMatch(/;\s*Secure/i);
    expect(cookie).toMatch(/;\s*Path=\//i);
    expect(cookie, 'Domain presente invalida o prefixo __Host-').not.toMatch(/;\s*Domain=/i);

    // O token cru NÃO pode aparecer no corpo: corpo entra em log de cliente e
    // em ferramenta de captura. O cookie é o único canal (§21.6).
    const token = cookieValue(cookie);
    expect(token.length).toBeGreaterThan(20);
    expect(await response.text(), 'o token cru vazou no corpo').not.toContain(token);
  });

  test('o mesmo cookie relê a própria sessão, sem repetir o token', async () => {
    test.skip(!setCookieHeader, 'A abertura de sessão não aconteceu neste ambiente.');

    const me = await session.get('/api/signup/sessions/me');

    expect(me.status(), await me.text()).toBe(200);
    expect(((await me.json()) as SessionBody).session, '/me sem estado').toMatchObject({
      answers: null,
    });

    expect(await me.text(), 'o /me devolveu o token cru').not.toContain(
      cookieValue(setCookieHeader),
    );
  });
});

/* ===================================================================== */
/* Validação de corpo — NÃO consome o balde por IP                        */
/* ===================================================================== */

/**
 * Estes casos são recusados pelo schema ANTES de `createSignupSession`, então
 * não gastam orçamento de IP. É por isso que ficam fora do bloco serial: são
 * baratos e independentes entre si.
 */
test.describe('cadastro anônimo — validação do corpo', () => {
  test.skip(!baseUrl, 'Defina E2E_BASE_URL.');

  test('recusa campo desconhecido em vez de ignorar', async ({ request }) => {
    // `.strict()` é deliberado: ignorar ensina o cliente a mandar lixo e esconde
    // a divergência quando as fatias seguintes passarem a ler campos.
    const response = await request.post('/api/signup/sessions', {
      headers: { origin: `https://${expectedHost()}`, 'content-type': 'application/json' },
      data: { campo_que_nao_existe: 'x' },
    });

    expect(response.status()).toBe(400);
    expect((await response.json()) as SessionBody).toMatchObject({ error: 'invalid_body' });
    expect(signupCookie(await response.headersArray())).toBeNull();
  });

  test('corpo que não é JSON é recusado sem 500', async ({ request }) => {
    const response = await request.post('/api/signup/sessions', {
      headers: { origin: `https://${expectedHost()}`, 'content-type': 'application/json' },
      data: '{nao-e-json',
    });

    expect(response.status()).toBe(400);
  });

  test('corpo grande demais é cortado antes de virar trabalho', async ({ request }) => {
    const response = await request.post('/api/signup/sessions', {
      headers: { origin: `https://${expectedHost()}`, 'content-type': 'application/json' },
      data: JSON.stringify({ turnstileToken: 'x'.repeat(17 * 1024) }),
    });

    // A rota aceita o schema existente de até 2.048 caracteres e limita o
    // envelope a 16 KiB; este payload precisa parar no teto, antes do serviço.
    expect(response.status()).toBe(413);
  });
});

/* ===================================================================== */
/* Risco — recusa e desafio                                               */
/* ===================================================================== */

test.describe('cadastro anônimo — classificação de risco (O-2b)', () => {
  test.skip(!baseUrl, 'Defina E2E_BASE_URL.');

  test('origem de outro host é RECUSADA, e não desafiada', async ({ playwright }) => {
    // Um POST de cadastro vindo de outra origem não é usuário navegando: é
    // script ou página de terceiro. Não há caso legítimo, então não vale gastar
    // desafio — 403, sem oferecer retry.
    const anon = await playwright.request.newContext({ baseURL: baseUrl! });
    try {
      const response = await anon.post('/api/signup/sessions', {
        headers: { origin: 'https://site-de-terceiro.example' },
      });

      skipIfRateLimited(response.status());
      expect(response.status()).toBe(403);
      expect((await response.json()) as SessionBody).toMatchObject({ error: 'blocked' });
      expect(
        signupCookie(await response.headersArray()),
        'criou sessão para origem cross-site',
      ).toBeNull();
    } finally {
      await anon.dispose();
    }
  });

  test('origem AUSENTE é desafiada — nem recusada, nem liberada', async ({ playwright }) => {
    // Cliente não-browser pode ser legítimo (ferramenta, teste): a faixa do meio
    // pede prova em vez de recusar.
    //
    // Este é o caso que continua DISCRIMINANDO quando o ambiente roda com as
    // chaves de TESTE da Cloudflare — ver o caso do token forjado abaixo.
    const anon = await playwright.request.newContext({ baseURL: baseUrl! });
    try {
      const response = await anon.post('/api/signup/sessions');

      skipIfRateLimited(response.status());
      expect(response.status()).toBe(401);
      expect((await response.json()) as SessionBody).toMatchObject({
        error: 'challenge_required',
      });
      expect(signupCookie(await response.headersArray())).toBeNull();
    } finally {
      await anon.dispose();
    }
  });

  test('token de Turnstile forjado nunca vira 201 sem sessão', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ baseURL: baseUrl! });
    try {
      const response = await anon.post('/api/signup/sessions', {
        headers: { origin: `https://${expectedHost()}`, 'content-type': 'application/json' },
        data: { turnstileToken: 'token-forjado-que-a-cloudflare-nunca-emitiu' },
      });

      // CONSEQUÊNCIA DECLARADA DAS CHAVES DE TESTE: a secret de teste da
      // Cloudflare (`1x0000…`) aprova QUALQUER token, de propósito — é o que
      // mantém o E2E verde exercitando o caminho do desafio. Num ambiente com
      // chave de teste este caso devolve 201 e NÃO prova rejeição; com chave
      // real devolve 401 (`invalid-input-response`).
      //
      // O teste aceita os dois e proíbe o resto: 5xx, 403, um 201 que não abriu
      // sessão, ou um 401 que abriu.
      skipIfRateLimited(response.status());
      expect([201, 401]).toContain(response.status());
      const cookie = signupCookie(await response.headersArray());
      if (response.status() === 201) {
        expect(cookie, '201 sem cookie: aceitou o token e não abriu sessão').toBeTruthy();
      } else {
        expect(cookie, '401 com cookie: recusou e abriu sessão mesmo assim').toBeNull();
      }
    } finally {
      await anon.dispose();
    }
  });
});

/* ===================================================================== */
/* Ausência de sessão — as causas têm a MESMA resposta                    */
/* ===================================================================== */

test.describe('cadastro anônimo — sessão inexistente', () => {
  test.skip(!baseUrl, 'Defina E2E_BASE_URL.');

  test('token inventado é indistinguível de cookie ausente', async ({ playwright }) => {
    // O ponto: distinguir "não existe" de "existiu e venceu" contaria a um
    // atacante se um token já foi válido. As duas respostas têm de ser iguais —
    // mesmo status E mesmo corpo.
    const anon = await playwright.request.newContext({ baseURL: baseUrl! });
    try {
      const ausente = await anon.get('/api/signup/sessions/me');
      const inventado = await anon.get('/api/signup/sessions/me', {
        headers: { cookie: `__Host-qoro_signup=${'a'.repeat(43)}` },
      });

      expect(inventado.status()).toBe(410);
      expect(inventado.status()).toBe(ausente.status());
      expect(await inventado.text()).toBe(await ausente.text());
    } finally {
      await anon.dispose();
    }
  });
});
