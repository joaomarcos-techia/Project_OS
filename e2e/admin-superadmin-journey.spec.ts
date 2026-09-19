import { createHmac } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

/**
 * Jornada do `super_admin` — o caminho POSITIVO de `/admin`.
 *
 * ===================================================================
 * O buraco que este arquivo fecha
 * ===================================================================
 * A auditoria de 13/09 achou `/admin` sem nenhum E2E autenticado: 11 páginas, a
 * única superfície com poder sobre TODAS as clínicas. `admin-boundary-rbac`
 * fechou a metade da NEGATIVA (sessão de clínica não entra). Esta fecha a outra:
 * o que o super_admin consegue fazer depois de entrar — e, mais importante, o
 * que continua valendo quando alguém tenta burlar.
 *
 * ===================================================================
 * SOMENTE PREVIEW, e somente clínica de TESTE
 * ===================================================================
 * Regra do fundador (13/09): escrita e alteração acontecem só em Preview. Este
 * spec MUTA estado global (kill-switch) e cria sessão de impersonate, então as
 * guardas são `throw`, não `skip`: um skip silencioso num teste que muta é o
 * caminho curto para alguém rodá-lo em produção sem perceber.
 *
 * A clínica alvo do impersonate é escolhida por nome — só `Smoke %`, que são
 * fixtures de outros smokes. Nunca uma clínica de gente.
 *
 * ⚠️ O kill-switch é GLOBAL. O valor anterior é lido ANTES e restaurado no
 * `afterAll`, aconteça o que acontecer — deixar `fallback_only` ligado
 * desligaria o agente de todas as clínicas do ambiente.
 *
 * Requer: `E2E_BASE_URL` de Preview, `SUPER_ADMIN_EMAIL_DEV`,
 * `SUPER_ADMIN_PASSWORD_DEV` e `DATABASE_URL` do mesmo projeto.
 */

const baseUrl = process.env.E2E_BASE_URL;
const email = process.env.SUPER_ADMIN_EMAIL_DEV;
const password = process.env.SUPER_ADMIN_PASSWORD_DEV;
const databaseUrl = process.env.DATABASE_URL;

test.use({ storageState: { cookies: [], origins: [] }, trace: 'retain-on-failure', video: 'off' });

/** Aborta se o alvo for produção. Erro, não skip — ver cabeçalho. */
function assertPreviewOnly(): void {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const host = new URL(baseUrl).hostname;
  if (host === 'app.qoro.dev' || host === 'qoro.dev') {
    throw new Error(
      `Este spec muta estado GLOBAL e só roda contra Preview. Host recusado: ${host}.`,
    );
  }
}

/* ---------------------------------------------------------------------
 * TOTP — RFC 6238. Mesma implementação de `production-mfa-lifecycle.spec.ts`.
 * ------------------------------------------------------------------ */

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const character of value.replace(/=+$/u, '').replace(/\s+/gu, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Secret TOTP em Base32 inválido.');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, now = Date.now()): string {
  const counter = Math.floor(now / 30_000);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest.at(-1)! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Código de uma janela AINDA NÃO usada.
 *
 * O impersonate exige step-up de TOTP a cada uso, então esta jornada precisa de
 * DOIS códigos: um no login e outro no impersonate. Reenviar o mesmo é recusado
 * pelo Supabase — a espera pela próxima janela de 30 s não é folga, é requisito.
 */
async function proximoCodigoInedito(secret: string, jaUsados: Set<string>): Promise<string> {
  for (let tentativa = 0; tentativa < 40; tentativa += 1) {
    const codigo = totp(secret);
    if (!jaUsados.has(codigo)) {
      jaUsados.add(codigo);
      return codigo;
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('Não consegui obter um código TOTP novo em 80 s.');
}

test.describe.serial('jornada do super_admin (Preview)', () => {
  let sql: ReturnType<typeof postgres>;
  let context: BrowserContext;
  let page: Page;
  const codigosUsados = new Set<string>();
  let secret = '';
  let superAdminId = '';
  let clinicaAlvo: { id: string; nome: string } | null = null;

  /** Valor do kill-switch ANTES do teste, para restaurar sem adivinhar. */
  let modoOriginal: string = 'normal';
  let flagFoiAlterada = false;

  test.beforeAll(async ({ browser }) => {
    assertPreviewOnly();
    if (!email || !password) {
      throw new Error('SUPER_ADMIN_EMAIL_DEV e SUPER_ADMIN_PASSWORD_DEV são obrigatórios.');
    }
    if (!databaseUrl) throw new Error('DATABASE_URL ausente — o spec confere efeitos no banco.');

    sql = postgres(databaseUrl, { max: 2, ssl: 'require' });

    // O segredo do TOTP vem do BANCO, não de um arquivo: um segundo fator num
    // `.env` deixa de ser segundo fator. Isso não amplia exposição — quem roda o
    // teste já tem o `DATABASE_URL` de admin, bem mais poderoso que 6 dígitos.
    const fatores = await sql<{ secret: string; user_id: string }[]>`
      SELECT f.secret, f.user_id
        FROM auth.mfa_factors f
        JOIN auth.users u ON u.id = f.user_id
       WHERE f.status = 'verified' AND u.email = ${email}
       LIMIT 1`;
    if (!fatores[0]) {
      throw new Error(`Sem fator TOTP verificado para ${email}. Rode 'pnpm seed:super-admin-mfa'.`);
    }
    secret = fatores[0].secret;
    superAdminId = fatores[0].user_id;

    // Clínica de TESTE, escolhida por nome. Nunca uma clínica de gente.
    const clinicas = await sql<{ id: string; nome: string }[]>`
      SELECT id, nome FROM clinics WHERE nome LIKE 'Smoke %' ORDER BY created_at DESC LIMIT 1`;
    clinicaAlvo = clinicas[0] ?? null;

    const [flag] = await sql<{ value: string | null }[]>`
      SELECT value FROM platform_settings WHERE key = 'ai_agent.mode' LIMIT 1`;
    // Ausente = default seguro do produto (`getAiAgentMode` devolve 'normal').
    modoOriginal = flag?.value ?? 'normal';

    context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    page = await context.newPage();

    // --- login + step-up até AAL2 ---
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Entrar' }).click();

    await expect(page, 'super_admin deveria cair no desafio TOTP').toHaveURL(/\/login\/mfa/u, {
      timeout: 60_000,
    });

    await page
      .getByLabel('Código de 6 dígitos')
      .fill(await proximoCodigoInedito(secret, codigosUsados));
    await page.getByRole('button', { name: 'Verificar' }).click();
    await expect(page, 'o TOTP não elevou para AAL2').toHaveURL(/\/admin(?:\?|$)/u, {
      timeout: 60_000,
    });
  });

  test.afterAll(async () => {
    // Restauração PRIMEIRO, antes de fechar qualquer coisa: o kill-switch é
    // global e um teste não tem o direito de deixar o ambiente degradado.
    //
    // Escrita DIRETA, sem passar pela UI, de propósito: este caminho só roda
    // quando o teste falhou no meio, e nesse estado a tela pode estar
    // inutilizável. A restauração pela UI (com auditoria simétrica) acontece no
    // caminho feliz, dentro do próprio caso.
    try {
      if (flagFoiAlterada && sql) {
        await sql`
          INSERT INTO platform_settings (key, value)
          VALUES ('ai_agent.mode', ${sql.json(modoOriginal)})
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
      }
    } finally {
      await context?.close();
      await sql?.end();
    }
  });

  test('o painel de plataforma abre com AAL2 e mostra conteúdo real', async () => {
    await page.goto('/admin/clinicas');

    // Conteúdo que SÓ existe no painel — a contraparte exata do que o
    // `admin-boundary-rbac` proíbe de vazar para sessão de clínica.
    await expect(page.getByText(/Clínicas da plataforma|clínicas/i).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(new URL(page.url()).pathname, 'foi expulso do painel').toBe('/admin/clinicas');
  });

  test('as seis telas de leitura do painel renderizam conteúdo próprio', async () => {
    test.setTimeout(180_000);

    // Cada tela é afirmada por DOIS âncoras: o `<h1>` dela e um bloco que só
    // existe quando a consulta de dados terminou. Só o título provaria que a
    // rota respondeu — a casca renderiza igual quando o corpo falha, e foi
    // exatamente essa a fraqueza que a auditoria apontou no
    // `authenticated-readonly-routes` (visita a página, aceita qualquer status
    // < 500 e conclui "coberto").
    const telas = [
      { rota: '/admin/billing', titulo: 'Pagamentos', dado: /Receita · últimos 6 meses/ },
      { rota: '/admin/metricas', titulo: 'Métricas', dado: /Usuários ativos diários/ },
      { rota: '/admin/feedbacks', titulo: 'Feedbacks', dado: /Por status/ },
      { rota: '/admin/saude', titulo: 'Saúde da plataforma', dado: /Incidentes ativos/ },
      { rota: '/admin/conversas-ia', titulo: 'Conversas IA', dado: /Conversas recentes/ },
      // Auditoria aceita os dois desfechos: a tabela OU o estado vazio. Um log
      // vazio é legítimo, e exigir linhas tornaria o teste dependente de
      // atividade prévia — o antipadrão "depende de estado anterior".
      { rota: '/admin/audit', titulo: 'Auditoria', dado: /Todas as clínicas|Nenhum evento/ },
    ] as const;

    const quebradas: string[] = [];
    for (const tela of telas) {
      await page.goto(tela.rota, { waitUntil: 'domcontentloaded' });

      const titulo = page.getByRole('heading', { level: 1, name: tela.titulo });
      if ((await titulo.count()) === 0) {
        quebradas.push(`${tela.rota} → sem o <h1> "${tela.titulo}"`);
        continue;
      }
      const corpo = await page.locator('main').innerText();
      if (!tela.dado.test(corpo)) {
        quebradas.push(`${tela.rota} → título ok, mas o conteúdo não carregou`);
      }
    }

    // Lista inteira: falhar na primeira esconderia quantas outras também estão
    // quebradas, e num painel de plataforma é isso que se quer saber.
    expect(quebradas, 'telas do painel sem conteúdo próprio').toEqual([]);
  });

  test('kill-switch grava a flag E a auditoria — as duas, ou nenhuma', async () => {
    test.setTimeout(120_000);
    await page.goto('/admin/config');

    const antes = await sql<{ value: unknown }[]>`
      SELECT value FROM platform_settings WHERE key = 'ai_agent.mode' LIMIT 1`;
    const valorAntes = antes[0]?.value ?? 'normal';

    const marcoTemporal = new Date();
    await page.getByRole('button', { name: 'Alternar agente de IA' }).click();
    flagFoiAlterada = true;

    // O valor mudou no banco…
    await expect
      .poll(
        async () => {
          const [r] = await sql<{ value: unknown }[]>`
            SELECT value FROM platform_settings WHERE key = 'ai_agent.mode' LIMIT 1`;
          return JSON.stringify(r?.value);
        },
        { timeout: 30_000, message: 'a flag não mudou no banco' },
      )
      .not.toBe(JSON.stringify(valorAntes));

    // …e a auditoria existe. Esta é a asserção que vale: a escrita acontece
    // DENTRO da transação do log (`superAdminAction`). Afirmar as duas juntas é
    // o que prova a atomicidade — uma sem a outra é exatamente o bug que
    // interessa, e que nenhum teste de UI pegaria.
    const auditoria = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM super_admin_actions
       WHERE action = 'platform_flag_set'
         AND super_admin_id = ${superAdminId}::uuid
         AND created_at >= ${marcoTemporal}`;
    expect(auditoria[0]?.n ?? 0, 'flag mudou sem linha de auditoria').toBeGreaterThan(0);

    // Restaura pela UI, para o log ficar simétrico (duas alterações, duas linhas).
    await page.getByRole('button', { name: 'Alternar agente de IA' }).click();
    await expect
      .poll(
        async () => {
          const [r] = await sql<{ value: unknown }[]>`
            SELECT value FROM platform_settings WHERE key = 'ai_agent.mode' LIMIT 1`;
          return JSON.stringify(r?.value);
        },
        { timeout: 30_000, message: 'a flag não voltou ao valor original' },
      )
      .toBe(JSON.stringify(valorAntes));
    flagFoiAlterada = false;
  });

  test('impersonate entra na clínica, cria sessão viva e fica auditado', async () => {
    test.setTimeout(180_000);
    test.skip(
      clinicaAlvo === null,
      'Nenhuma clínica `Smoke %` no ambiente — o spec não impersona clínica de gente.',
    );

    await page.goto(`/admin/clinicas/${clinicaAlvo!.id}`);

    // O formulário fica atrás de um gatilho: o campo de TOTP só existe depois de
    // "Impersonar clínica". É desenho deliberado — a ação mais perigosa do
    // produto não fica a um clique de distância — e o teste respeita isso em vez
    // de contornar pelo DOM.
    await page.getByRole('button', { name: 'Impersonar clínica' }).click();

    const campo = page.getByLabel('Código do autenticador (TOTP)');
    await expect(campo, 'o formulário de impersonate não abriu').toBeVisible({ timeout: 15_000 });

    // O código é buscado DEPOIS de o formulário abrir: pegá-lo antes gastaria
    // parte da janela de 30 s esperando a UI.
    await campo.fill(await proximoCodigoInedito(secret, codigosUsados));
    await page.getByRole('button', { name: 'Confirmar e entrar' }).click();

    await expect(page, 'impersonate não levou ao dashboard da clínica').toHaveURL(
      /\/dashboard(?:\?|$)/u,
      { timeout: 60_000 },
    );

    const sessoes = await sql<{ id: string }[]>`
      SELECT id FROM impersonation_sessions
       WHERE super_admin_id = ${superAdminId}::uuid
         AND clinic_id = ${clinicaAlvo!.id}::uuid
         AND revoked_at IS NULL
       ORDER BY started_at DESC LIMIT 1`;
    expect(sessoes[0], 'sessão de impersonate não existe no banco').toBeTruthy();

    const log = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM super_admin_actions
       WHERE action = 'impersonate_start'
         AND super_admin_id = ${superAdminId}::uuid
         AND target_clinic_id = ${clinicaAlvo!.id}::uuid`;
    expect(log[0]?.n ?? 0, 'impersonate sem linha de auditoria').toBeGreaterThan(0);
  });

  test('REVOGAR a linha encerra o impersonate, com o cookie intacto', async () => {
    test.setTimeout(120_000);
    test.skip(clinicaAlvo === null, 'Sem clínica de teste.');

    // Esta é a asserção mais valiosa do arquivo. O cookie carrega só o id
    // assinado — "a LINHA manda". Revogar direto no banco, sem tocar no
    // navegador, prova que o cookie não é a autoridade: se fosse, a sessão
    // continuaria de pé.
    const antes = await sql<{ id: string }[]>`
      SELECT id FROM impersonation_sessions
       WHERE super_admin_id = ${superAdminId}::uuid AND revoked_at IS NULL
       ORDER BY started_at DESC LIMIT 1`;
    expect(antes[0], 'não havia sessão viva para revogar').toBeTruthy();

    await sql`UPDATE impersonation_sessions SET revoked_at = now() WHERE id = ${antes[0]!.id}::uuid`;

    await page.goto('/dashboard');
    // Sem impersonate, o shell devolve o super_admin para /admin (OR-I10).
    await expect(page, 'o cookie revogado continuou valendo').toHaveURL(/\/admin(?:\?|$)/u, {
      timeout: 60_000,
    });
  });

  test('encerrar pelo banner revoga e AUDITA — o ciclo fecha', async () => {
    test.setTimeout(180_000);
    test.skip(clinicaAlvo === null, 'Sem clínica de teste.');

    // O caso anterior provou que a LINHA manda, revogando por fora. Este prova o
    // caminho que a pessoa usa de verdade — e é o único que exercita
    // `stopImpersonationAction` e a linha `impersonate_stop`. Sem ele, o ciclo
    // ficaria com o começo coberto e o fim não, que é justamente onde mora a
    // pergunta operacional: "esse impersonate foi encerrado?".
    await page.goto(`/admin/clinicas/${clinicaAlvo!.id}`);
    await page.getByRole('button', { name: 'Impersonar clínica' }).click();
    const campo = page.getByLabel('Código do autenticador (TOTP)');
    await expect(campo).toBeVisible({ timeout: 15_000 });
    await campo.fill(await proximoCodigoInedito(secret, codigosUsados));
    await page.getByRole('button', { name: 'Confirmar e entrar' }).click();
    await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 60_000 });

    const marcoTemporal = new Date();
    await page.getByRole('button', { name: 'Encerrar impersonate' }).click();
    await expect(page, 'encerrar não devolveu ao painel').toHaveURL(/\/admin(?:\?|$)/u, {
      timeout: 60_000,
    });

    // Nenhuma sessão viva: o encerramento revoga de verdade, não só limpa o cookie.
    const vivas = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM impersonation_sessions
       WHERE super_admin_id = ${superAdminId}::uuid AND revoked_at IS NULL`;
    expect(vivas[0]?.n ?? -1, 'sobrou sessão de impersonate viva').toBe(0);

    const log = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM super_admin_actions
       WHERE action = 'impersonate_stop'
         AND super_admin_id = ${superAdminId}::uuid
         AND created_at >= ${marcoTemporal}`;
    expect(log[0]?.n ?? 0, 'encerrou sem linha de auditoria').toBeGreaterThan(0);
  });
});
