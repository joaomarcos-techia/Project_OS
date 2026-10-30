import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

import { authenticate, hasE2ECredentials } from './auth';
import { vercelBypassHeaders } from './vercel-bypass';
import { assertDevContext } from '../scripts/_env';
import { cleanupSandboxFixtureWebhook } from '../src/lib/test/asaas-fixture-webhook-cleanup';

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
const isolatedFixture = process.env.E2E_PAYMENT_ACCOUNT_ISOLATED === '1';
const fixtureRunId = randomUUID();
const EXPECTED_DEV_PROJECT_REF = 'pqhkirrszzpwezdaqrai';
const fixtureSlug = `e2e-payments-${fixtureRunId.slice(0, 8)}`;
const fixtureEmail = `e2e-payments-${fixtureRunId}@example.invalid`;
const fixturePassword = `Qoro${fixtureRunId.replaceAll('-', '')}Aa1!`;
let fixtureClinicId = '';
let fixtureUserId = '';
let fixtureDoctorId = '';
let fixtureSql: ReturnType<typeof postgres> | null = null;
let fixtureAuthCookies: Awaited<
  ReturnType<import('@playwright/test').BrowserContext['cookies']>
> | null = null;

function isolatedFixtureConfig(): {
  databaseUrl: string;
  supabaseUrl: string;
  secretKey: string;
} {
  const { databaseUrl } = assertDevContext();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error('Fixture isolada exige Supabase Auth DEV configurado.');
  }
  const databaseRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const authRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (databaseRef !== EXPECTED_DEV_PROJECT_REF || authRef !== EXPECTED_DEV_PROJECT_REF) {
    throw new Error('Fixture isolada exige Database e Auth no projeto DEV fixado.');
  }
  return { databaseUrl, supabaseUrl, secretKey };
}

async function assertPreviewRuntimeIsDev(): Promise<void> {
  const secret = process.env.MAGIC_TOKEN_SECRET_DEV ?? process.env.MAGIC_TOKEN_SECRET;
  if (!baseUrl || !secret) throw new Error('Prova assinada do runtime Preview indisponível.');
  const timestamp = Date.now();
  const nonce = randomBytes(32).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`POST\n/api/signup/runtime-fingerprint\n${timestamp}\n${nonce}`)
    .digest('hex');
  const response = await fetch(new URL('/api/signup/runtime-fingerprint', baseUrl), {
    method: 'POST',
    headers: {
      ...vercelBypassHeaders(),
      'content-type': 'application/json',
      'x-qoro-e2e-signature': signature,
    },
    body: JSON.stringify({ timestamp, nonce }),
    cache: 'no-store',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Preview recusou a prova do projeto DEV (${response.status}).`);
  const result: unknown = await response.json();
  if (
    !result ||
    typeof result !== 'object' ||
    !('environment' in result) ||
    !('authProjectRef' in result) ||
    !('databaseProjectRef' in result) ||
    result.environment !== 'preview' ||
    result.authProjectRef !== EXPECTED_DEV_PROJECT_REF ||
    result.databaseProjectRef !== EXPECTED_DEV_PROJECT_REF
  ) {
    throw new Error('Preview não comprovou Auth e banco no projeto DEV esperado.');
  }
}

async function createIsolatedFixture(): Promise<void> {
  const config = isolatedFixtureConfig();
  fixtureSql = postgres(config.databaseUrl, { max: 2, ssl: 'require', prepare: false });
  const [catalog] = await fixtureSql<{ plan_id: string; price_id: string }[]>`
    select p.id::text plan_id, pr.id::text price_id
      from plans p
      join prices pr on pr.plan_id = p.id
     where p.code = 'pro'
       and p.ativo = true
       and pr.billing_cycle = 'monthly'
       and pr.active_until is null
       and pr.campaign_code is null
     order by pr.active_from desc
     limit 1
  `;
  if (!catalog) throw new Error('Plano Pro mensal vigente ausente no DEV.');

  const authResponse = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: fixtureEmail,
      password: fixturePassword,
      email_confirm: true,
    }),
  });
  const authBody = (await authResponse.json().catch(() => null)) as { id?: unknown } | null;
  if (!authResponse.ok || typeof authBody?.id !== 'string') {
    throw new Error(`Auth DEV recusou a fixture de pagamentos (HTTP ${authResponse.status}).`);
  }
  fixtureUserId = authBody.id;

  const [clinic] = await fixtureSql<{ id: string }[]>`
    insert into clinics (slug, nome, status)
    values (${fixtureSlug}, ${`E2E Payments ${fixtureRunId}`}, 'active')
    returning id::text
  `;
  if (!clinic) throw new Error('Clínica isolada de pagamentos não foi criada.');
  fixtureClinicId = clinic.id;
  await fixtureSql`
    insert into subscriptions
      (clinic_id, plan_id, price_id, billing_status, started_at,
       current_period_start, current_period_end)
    values
      (${fixtureClinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid,
       'active', now(), now(), now() + interval '1 month')
  `;
  await fixtureSql`
    insert into procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min)
    values (${fixtureClinicId}::uuid, ${`E2E-${fixtureRunId.slice(0, 8)}`},
      'Consulta E2E financeira', 240, 30)
  `;
  await fixtureSql`
    insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
    values
      (${fixtureUserId}::uuid, ${fixtureClinicId}::uuid,
       ${`E2E Payments Owner ${fixtureRunId.slice(0, 8)}`}, 'owner'::role_enum, true, now())
  `;
}

async function cleanupIsolatedFixture(): Promise<void> {
  if (!fixtureSql) return;
  const config = isolatedFixtureConfig();
  if (fixtureClinicId) {
    const [account] = await fixtureSql<{ webhook_ref: string }[]>`
      select webhook_ref::text from clinic_payment_accounts
       where clinic_id = ${fixtureClinicId}::uuid
    `;
    if (account) {
      if (!sandboxKey || !baseUrl) {
        throw new Error(
          'Fixture com conta Asaas sem chave Sandbox ou URL de Preview para cleanup.',
        );
      }
      // Externo primeiro: se o Asaas recusar, preserve a fixture para investigação.
      // Apagar a clínica antes deixaria um webhook ativo apontando para ref inexistente.
      await cleanupSandboxFixtureWebhook({
        apiKey: sandboxKey,
        webhookRef: account.webhook_ref,
        previewUrl: baseUrl,
      });
    }
  }
  const cleanupErrors: string[] = [];
  if (fixtureClinicId) {
    try {
      await fixtureSql`delete from clinics where id = ${fixtureClinicId}::uuid`;
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : 'falha ao remover clínica');
    }
  }
  for (const userId of [fixtureDoctorId, fixtureUserId].filter(Boolean)) {
    const url = `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(userId)}`;
    const headers = { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` };
    const response = await fetch(url, { method: 'DELETE', headers });
    const readback = await fetch(url, { method: 'GET', headers });
    if ((!response.ok && response.status !== 404) || readback.status !== 404) {
      cleanupErrors.push(
        `Auth cleanup incompleto (DELETE ${response.status}, GET ${readback.status})`,
      );
    }
  }
  const [remaining] = await fixtureSql<{ clinics: number; profiles: number }[]>`
    select
      (select count(*)::int from clinics where slug = ${fixtureSlug}) clinics,
      (select count(*)::int from profiles where id = ${fixtureUserId || null}::uuid) profiles
  `;
  await fixtureSql.end({ timeout: 5 });
  fixtureSql = null;
  if (remaining?.clinics !== 0 || remaining.profiles !== 0) {
    cleanupErrors.push(
      `readback residual clinics=${remaining?.clinics ?? '?'} profiles=${remaining?.profiles ?? '?'}`,
    );
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors.map((message) => new Error(message)),
      'Cleanup falhou.',
    );
  }
}

async function authenticateForTest(page: import('@playwright/test').Page): Promise<void> {
  if (!isolatedFixture) return authenticate(page);
  if (fixtureAuthCookies) {
    await page.context().addCookies(fixtureAuthCookies);
    await page.goto('/dashboard');
    if (/\/dashboard(?:\?|$)/u.test(page.url())) return;
    if (!/\/login(?:\?|$)/u.test(page.url())) {
      throw new Error('A sessão da fixture não abriu dashboard nem solicitou login.');
    }
  }
  await page.goto('/login');
  await page.locator('#email').fill(fixtureEmail);
  await page.locator('input[name="password"]').fill(fixturePassword);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/, { timeout: 90_000 });
  // Só em memória deste worker: reutiliza a sessão da fixture entre os testes
  // de Payments sem consumir o orçamento de 10 logins/IP/15 min do Preview.
  fixtureAuthCookies = await page.context().cookies();
}

/** Aborta se o alvo for produção. Erro, não skip — ver cabeçalho. */
function assertPreviewOnly(): void {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app')) {
    throw new Error(
      'Este spec pode criar estado externo (webhook no Asaas) e só roda contra Preview Vercel.',
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
  test.beforeAll(async () => {
    if (!isolatedFixture) return;
    assertPreviewOnly();
    assertPaymentMutationOptIn();
    isolatedFixtureConfig();
    await assertPreviewRuntimeIsDev();
    await createIsolatedFixture();
  });

  test.afterAll(async () => {
    if (!isolatedFixture) return;
    try {
      await cleanupIsolatedFixture();
    } finally {
      if (fixtureSql) {
        await fixtureSql.end({ timeout: 5 });
        fixtureSql = null;
      }
    }
  });

  test('chave inválida é recusada sem alterar o estado, e nunca volta ao browser', async ({
    page,
  }) => {
    test.setTimeout(240_000);
    test.skip(
      !isolatedFixture && !hasE2ECredentials(),
      'Defina E2E_USER_EMAIL e E2E_USER_PASSWORD.',
    );
    assertPreviewOnly();

    await authenticateForTest(page);
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
    await page.getByRole('button', { name: /Conectar conta|Conectar ou retomar/ }).click();

    // A recusa tem de ser VISÍVEL. Um erro que some deixando a tela como estava
    // é indistinguível de sucesso para quem opera.
    const feedback = page.getByRole('alert').filter({
      hasText: 'O Asaas não aceitou essa chave.',
    });
    await expect(feedback).toBeVisible({ timeout: 90_000 });
    await expect(campo, 'a chave inválida permaneceu no campo após a resposta').toHaveValue('');
    expect(await page.content(), 'a chave inválida permaneceu no HTML').not.toContain(invalidKey);

    // E o estado tem de ser o MESMO de antes — em particular, uma chave
    // inválida não pode derrubar uma conta que já estava conectada.
    await page.reload();
    expect(await lerEstado(page), 'a chave inválida alterou o estado da conta').toBe(antes);
  });

  test('ciclo completo: conecta, persiste e desconecta', async ({ page }) => {
    test.setTimeout(300_000);
    test.skip(!isolatedFixture, 'O ciclo mutante exige clínica isolada no DEV.');
    test.skip(!sandboxKey, 'Defina ASAAS_CLINIC_SANDBOX_KEY (conta sandbox DA CLÍNICA).');
    assertPreviewOnly();
    assertPaymentMutationOptIn();

    await authenticateForTest(page);
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

    let webhookRef = '';
    let primaryError: unknown;
    try {
      await campo.fill(sandboxKey!);
      await page.getByRole('button', { name: 'Conectar conta' }).click();
      await expect(page.getByText('Conectada', { exact: true })).toBeVisible({ timeout: 90_000 });

      // O DTO carrega só `hasApiKey`. Se a chave aparecer no HTML, ela vazou para
      // o cliente — e uma chave de Asaas movimenta dinheiro.
      expect(
        (await page.content()).includes(sandboxKey!),
        'a chave da clínica apareceu no HTML',
      ).toBe(false);

      await page.reload();
      expect(
        await lerEstado(page),
        'o estado não persistiu — era estado de React, não do banco',
      ).toBe('conectada');
      const [account] = await fixtureSql!<{ webhook_ref: string; accept_new_charges: boolean }[]>`
        select webhook_ref::text, accept_new_charges
          from clinic_payment_accounts where clinic_id = ${fixtureClinicId}::uuid
      `;
      expect(account?.accept_new_charges, 'a conexão não habilitou novas cobranças').toBe(true);
      if (!account?.webhook_ref) throw new Error('Conta conectada sem referência do webhook.');
      webhookRef = account.webhook_ref;
    } catch (error) {
      primaryError = error;
    }

    let cleanupError: unknown;
    try {
      await page.goto('/configuracoes/pagamentos');
      if ((await lerEstado(page)) === 'conectada') {
        // O HTML do Server Component pode aparecer antes do handler client ser
        // hidratado. Prove uma interação controlada antes do clique mutante.
        const reconnectButton = page.getByRole('button', { name: 'Conectar ou retomar' });
        await page.locator('#asaas-api-key').fill('e2e-hydration-check');
        await expect(reconnectButton).toBeEnabled();
        await page.locator('#asaas-api-key').fill('');
        await expect(reconnectButton).toBeDisabled();
        await page.getByRole('button', { name: 'Pausar ou desconectar' }).click();
        await expect(page.getByText(/Nenhuma conta conectada/)).toBeVisible({ timeout: 60_000 });
      }
      await page.reload();
      expect(await lerEstado(page), 'a desconexão não persistiu').toBe('vazia');
      if (webhookRef) {
        const [account] = await fixtureSql!<
          {
            active: boolean;
            accept_new_charges: boolean;
            api_key_encrypted: string | null;
            webhook_token_encrypted: string | null;
          }[]
        >`
          select active, accept_new_charges, api_key_encrypted, webhook_token_encrypted
            from clinic_payment_accounts where clinic_id = ${fixtureClinicId}::uuid
        `;
        expect(account).toMatchObject({
          active: false,
          accept_new_charges: false,
          api_key_encrypted: null,
          webhook_token_encrypted: null,
        });
        const headers = { access_token: sandboxKey! };
        const list = await fetch('https://api-sandbox.asaas.com/v3/webhooks?offset=0&limit=100', {
          headers,
        });
        expect(list.status, 'Asaas não permitiu ler os webhooks da fixture').toBe(200);
        const body: unknown = await list.json();
        if (!body || typeof body !== 'object' || !('data' in body) || !Array.isArray(body.data)) {
          throw new Error('Listagem de webhooks Sandbox malformada.');
        }
        const expectedPath = `/api/webhooks/asaas/patient/${webhookRef}`;
        const matches = body.data.filter((item: unknown) => {
          if (!item || typeof item !== 'object' || !('url' in item)) return false;
          if (typeof item.url !== 'string') return false;
          try {
            return new URL(item.url).pathname === expectedPath;
          } catch {
            return false;
          }
        });
        expect(
          matches,
          'o webhook da fixture não existe mais para confirmar enabled=false',
        ).toHaveLength(1);
        const remote = matches[0];
        if (
          !remote ||
          typeof remote !== 'object' ||
          !('id' in remote) ||
          typeof remote.id !== 'string'
        ) {
          throw new Error('Webhook da fixture sem ID no readback.');
        }
        const detail = await fetch(
          `https://api-sandbox.asaas.com/v3/webhooks/${encodeURIComponent(remote.id)}`,
          { headers },
        );
        expect(detail.status, 'Asaas não permitiu confirmar o webhook da fixture').toBe(200);
        const remoteDetail: unknown = await detail.json();
        expect(remoteDetail, 'o webhook da fixture não foi desativado').toMatchObject({
          enabled: false,
        });
      }
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

  test('Pro e Clínica exibem repasse; Solo bloqueia UI e ação direta', async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!isolatedFixture, 'Exige fixture isolada em DEV para trocar o plano.');
    assertPreviewOnly();
    await authenticateForTest(page);
    const response = await page.goto('/configuracoes/pagamentos');
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Política financeira' })).toBeVisible();
    await expect(page.locator('input[name="pricing-policy"]')).toHaveCount(0);
    await expect(page.locator('#price-procedure')).toHaveCount(0);

    const actionRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === 'POST' &&
        request.url().includes('/configuracoes/pagamentos') &&
        Boolean(request.headers()['next-action']),
    );
    await page.getByText('Valor líquido', { exact: true }).click();
    await page.getByRole('button', { name: 'Salvar base de repasse' }).click();
    const policyAction = await actionRequestPromise;
    const policyActionBody = policyAction.postDataBuffer();
    if (!policyActionBody) throw new Error('Server Action de repasse sem corpo capturável.');
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Base de repasse salva para os próximos atendimentos.',
      }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole('radio', { name: /Valor líquido/u })).toBeChecked();
    const [payout] = await fixtureSql!<{ professional_payout_basis: string }[]>`
      select professional_payout_basis from clinic_financial_policies
       where clinic_id = ${fixtureClinicId}::uuid
    `;
    expect(payout?.professional_payout_basis).toBe('net');

    const [solo] = await fixtureSql!<{ plan_id: string; price_id: string }[]>`
      select p.id::text plan_id, pr.id::text price_id
        from plans p join prices pr on pr.plan_id = p.id
       where p.code = 'solo' and p.ativo = true
         and pr.billing_cycle = 'monthly' and pr.active_until is null
         and pr.campaign_code is null
       order by pr.active_from desc limit 1
    `;
    if (!solo) throw new Error('Plano Solo mensal vigente ausente no DEV.');
    const switched = await fixtureSql!<{ clinic_id: string }[]>`
      update subscriptions set plan_id = ${solo.plan_id}::uuid, price_id = ${solo.price_id}::uuid
       where clinic_id = ${fixtureClinicId}::uuid returning clinic_id::text
    `;
    expect(switched).toHaveLength(1);
    const stale = await page.request.get('/configuracoes/pagamentos', {
      maxRedirects: 0,
      failOnStatusCode: false,
    });
    expect([303, 307, 308]).toContain(stale.status());
    expect(new URL(stale.headers()['location'] ?? '', baseUrl).pathname).toBe('/login');
    await page.goto('/auth/session-refresh?next=/configuracoes/pagamentos');
    await expect(page).toHaveURL(/\/configuracoes\/pagamentos(?:\?|$)/u);
    await expect(
      page.getByRole('alert').filter({
        hasText: 'Regras de repasse estão disponíveis nos planos Clínica e Pro.',
      }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Política financeira' })).toHaveCount(0);

    const actionHeaders = policyAction.headers();
    const replayHeaders = Object.fromEntries(
      [
        'accept',
        'content-type',
        'next-action',
        'next-router-state-tree',
        'next-url',
        'origin',
        'referer',
      ].flatMap((name) => (actionHeaders[name] ? [[name, actionHeaders[name]]] : [])),
    );
    const replay = await page.request.fetch(policyAction.url(), {
      method: 'POST',
      headers: replayHeaders,
      data: policyActionBody,
      failOnStatusCode: false,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.text()).toContain(
      'Políticas de repasse estão disponíveis nos planos Clínica e Pro.',
    );

    const [clinicPlan] = await fixtureSql!<{ plan_id: string; price_id: string }[]>`
      select p.id::text plan_id, pr.id::text price_id
        from plans p join prices pr on pr.plan_id = p.id
       where p.code = 'clinica' and p.ativo = true
         and pr.billing_cycle = 'monthly' and pr.active_until is null
         and pr.campaign_code is null
       order by pr.active_from desc limit 1
    `;
    if (!clinicPlan) throw new Error('Plano Clínica mensal vigente ausente no DEV.');
    await fixtureSql!`
      update subscriptions set plan_id = ${clinicPlan.plan_id}::uuid,
        price_id = ${clinicPlan.price_id}::uuid
       where clinic_id = ${fixtureClinicId}::uuid
    `;
    await page.goto('/auth/session-refresh?next=/configuracoes/pagamentos');
    await expect(page.getByRole('heading', { name: 'Política financeira' })).toBeVisible();
    await expect(page.getByRole('radio', { name: /Valor líquido/u })).toBeChecked();
    fixtureAuthCookies = await page.context().cookies();
  });

  test('Caixa Solo distingue economia alocada e fatos de cada cobrança', async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!isolatedFixture, 'Exige fixture isolada em DEV para criar cobrança sintética.');
    assertPreviewOnly();
    await authenticateForTest(page);

    const [solo] = await fixtureSql!<{ plan_id: string; price_id: string }[]>`
      select p.id::text plan_id, pr.id::text price_id
        from plans p join prices pr on pr.plan_id = p.id
       where p.code = 'solo' and p.ativo = true
         and pr.billing_cycle = 'monthly' and pr.active_until is null
         and pr.campaign_code is null
       order by pr.active_from desc limit 1
    `;
    if (!solo) throw new Error('Plano Solo mensal vigente ausente no DEV.');
    await fixtureSql!`
      update subscriptions set plan_id = ${solo.plan_id}::uuid, price_id = ${solo.price_id}::uuid
       where clinic_id = ${fixtureClinicId}::uuid
    `;

    const patientId = randomUUID();
    const appointmentId = randomUUID();
    const lancamentoId = randomUUID();
    const depositChargeId = randomUUID();
    const remainderChargeId = randomUUID();
    const patientName = `Paciente economia ${fixtureRunId.slice(0, 8)}`;
    const [procedure] = await fixtureSql!<{ id: string }[]>`
      select id::text from procedures where clinic_id = ${fixtureClinicId}::uuid limit 1
    `;
    if (!procedure) throw new Error('Procedimento da fixture financeira não encontrado.');
    await fixtureSql!`
      insert into patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${patientId}::uuid, ${fixtureClinicId}::uuid, ${patientName},
              'fixture', ${fixtureRunId.replaceAll('-', '').padEnd(64, '0')})
    `;
    await fixtureSql!`
      insert into appointments
        (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
         duration_min, status, valor, snapshot_procedure_name,
         snapshot_procedure_valor, snapshot_procedure_duracao_min,
         snapshot_doctor_nome, created_via)
      values (${appointmentId}::uuid, ${fixtureClinicId}::uuid, ${fixtureUserId}::uuid,
              ${patientId}::uuid, ${procedure.id}::uuid, now(), 30, 'atendido', 150,
              'Consulta sintética', 150, 30, 'Profissional E2E', 'attendant')
    `;
    await fixtureSql!`
      insert into lancamentos
        (id, clinic_id, tipo, descricao, valor, valor_pago, status, paid_at,
         appointment_id, patient_id, created_via)
      values (${lancamentoId}::uuid, ${fixtureClinicId}::uuid, 'receber',
              'Consulta sintética', 150, 150, 'pago', now(),
              ${appointmentId}::uuid, ${patientId}::uuid, 'auto')
    `;
    await fixtureSql!`
      insert into patient_charges
        (id, clinic_id, appointment_id, patient_id, kind, status, amount,
         provider, external_reference, paid_at, provider_gross_amount,
          provider_fee_amount, provider_net_amount, economics_reconciled_at,
          provider_economics_revision, created_at)
      values
        (${depositChargeId}::uuid, ${fixtureClinicId}::uuid, ${appointmentId}::uuid,
         ${patientId}::uuid, 'deposit', 'paid', 50, 'asaas',
          ${`deposit:${appointmentId}`}, now(), 50, 1, 49, now(), 1, now() - interval '1 second'),
        (${remainderChargeId}::uuid, ${fixtureClinicId}::uuid, ${appointmentId}::uuid,
         ${patientId}::uuid, 'remainder', 'paid', 100, 'asaas',
          ${`remainder:${appointmentId}`}, now(), 100, null, null, null, 0, now())
    `;
    await fixtureSql!`
      insert into patient_credits
        (clinic_id, patient_id, appointment_id, patient_charge_id, amount,
         allocated_amount, allocated_lancamento_id, kind, status, payment_method,
         provider_gross_amount, provider_fee_amount, provider_net_amount,
          provider_economics_reconciled_at, provider_economics_revision)
      values
        (${fixtureClinicId}::uuid, ${patientId}::uuid, ${appointmentId}::uuid,
         ${depositChargeId}::uuid, 50, 50, ${lancamentoId}::uuid,
          'deposit', 'allocated', 'pix', 50, 1, 49, now(), 1),
        (${fixtureClinicId}::uuid, ${patientId}::uuid, ${appointmentId}::uuid,
         ${remainderChargeId}::uuid, 100, 100, ${lancamentoId}::uuid,
          'remaining_payment', 'allocated', 'cartao_credito', 100, null, null, null, 0)
    `;

    await page.goto('/auth/session-refresh?next=/caixa');
    await expect(page).toHaveURL(/\/caixa(?:\?|$)/u);
    const received = page.locator('section[aria-label="Recebidos hoje"]');
    await expect(received.getByText(patientName)).toBeVisible();
    const composition = received.locator('details').first();
    await page.waitForLoadState('networkidle');
    await composition.locator('summary').click();
    await expect(composition).toHaveAttribute('open', '');
    await expect(composition.getByText('Cada cobrança Asaas')).toBeVisible();
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Valor recebido alocado' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('R$ 150,00');
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Tarifa real alocada' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('Não informado');
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Líquido real alocado' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('Não informado');
    await expect(composition.getByText('Repasse profissional')).toHaveCount(0);
    const deposit = composition.locator('dl').nth(1);
    const remainder = composition.locator('dl').nth(2);
    await expect(deposit.locator('dd')).toHaveText([
      'R$ 50,00',
      'R$ 50,00',
      '− R$ 1,00',
      'R$ 49,00',
    ]);
    await expect(remainder.locator('dd')).toHaveText([
      'R$ 100,00',
      'R$ 100,00',
      'Não informado',
      'Não informado',
    ]);

    await fixtureSql!`
      update patient_charges
         set provider_fee_amount = 2, provider_net_amount = 98,
              economics_reconciled_at = now(), provider_economics_revision = 1
       where id = ${remainderChargeId}::uuid and clinic_id = ${fixtureClinicId}::uuid
    `;
    await fixtureSql!`
      update patient_credits
         set provider_fee_amount = 2, provider_net_amount = 98,
              provider_economics_reconciled_at = now(), provider_economics_revision = 1
       where patient_charge_id = ${remainderChargeId}::uuid
         and clinic_id = ${fixtureClinicId}::uuid
    `;
    await page.reload();
    const reconciled = page.locator('section[aria-label="Recebidos hoje"] details').first();
    await page.waitForLoadState('networkidle');
    await reconciled.locator('summary').click();
    await expect(reconciled).toHaveAttribute('open', '');
    await expect(
      reconciled
        .locator('dt')
        .filter({ hasText: 'Tarifa real alocada' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('− R$ 3,00');
    await expect(
      reconciled
        .locator('dt')
        .filter({ hasText: 'Líquido real alocado' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('R$ 147,00');
    fixtureAuthCookies = await page.context().cookies();
  });

  test('Caixa Pro mostra base NET, repasse e suspensão sem confundir tarifa', async ({ page }) => {
    test.setTimeout(180_000);
    test.skip(!isolatedFixture, 'Exige fixture isolada em DEV para criar repasse sintético.');
    assertPreviewOnly();
    await authenticateForTest(page);

    const [pro] = await fixtureSql!<{ plan_id: string; price_id: string }[]>`
      select p.id::text plan_id, pr.id::text price_id
        from plans p join prices pr on pr.plan_id = p.id
       where p.code = 'pro' and p.ativo = true
         and pr.billing_cycle = 'monthly' and pr.active_until is null
         and pr.campaign_code is null
       order by pr.active_from desc limit 1
    `;
    if (!pro) throw new Error('Plano Pro mensal vigente ausente no DEV.');
    await fixtureSql!`
      update subscriptions set plan_id = ${pro.plan_id}::uuid, price_id = ${pro.price_id}::uuid
       where clinic_id = ${fixtureClinicId}::uuid
    `;

    const config = isolatedFixtureConfig();
    const doctorEmail = `e2e-payout-doctor-${fixtureRunId}@example.invalid`;
    const doctorResponse = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: config.secretKey,
        authorization: `Bearer ${config.secretKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: doctorEmail, password: fixturePassword, email_confirm: true }),
    });
    const doctorBody = (await doctorResponse.json().catch(() => null)) as { id?: unknown } | null;
    if (!doctorResponse.ok || typeof doctorBody?.id !== 'string') {
      throw new Error(`Auth DEV recusou o médico sintético (HTTP ${doctorResponse.status}).`);
    }
    fixtureDoctorId = doctorBody.id;
    await fixtureSql!`
      insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
      values (${fixtureDoctorId}::uuid, ${fixtureClinicId}::uuid,
              'Médico E2E de repasse', 'doctor'::role_enum, true, now())
    `;

    const [procedure] = await fixtureSql!<{ id: string }[]>`
      select id::text from procedures where clinic_id = ${fixtureClinicId}::uuid limit 1
    `;
    const [policyVersion] = await fixtureSql!<{ id: string }[]>`
      select id::text from clinic_financial_policy_versions
       where clinic_id = ${fixtureClinicId}::uuid
         and professional_payout_basis = 'net'
       order by effective_from desc limit 1
    `;
    if (!procedure || !policyVersion) {
      throw new Error('Procedimento ou versão NET da fixture Pro não persistiu.');
    }

    const patientId = randomUUID();
    const appointmentId = randomUUID();
    const lancamentoId = randomUUID();
    const chargeId = randomUUID();
    const ruleId = randomUUID();
    const patientName = `Paciente repasse ${fixtureRunId.slice(0, 8)}`;
    await fixtureSql!`
      insert into patients (id, clinic_id, nome, cpf_encrypted, cpf_hash)
      values (${patientId}::uuid, ${fixtureClinicId}::uuid, ${patientName},
              'fixture', ${randomUUID().replaceAll('-', '').padEnd(64, '0')})
    `;
    await fixtureSql!`
      insert into appointments
        (id, clinic_id, doctor_id, patient_id, procedure_id, scheduled_at,
         duration_min, status, valor, snapshot_procedure_name,
         snapshot_procedure_valor, snapshot_procedure_duracao_min,
         snapshot_doctor_nome, created_via, pricing_policy_mode)
      values (${appointmentId}::uuid, ${fixtureClinicId}::uuid, ${fixtureDoctorId}::uuid,
              ${patientId}::uuid, ${procedure.id}::uuid, now(), 30, 'atendido', 240,
              'Consulta sintética', 240, 30, 'Médico E2E de repasse', 'attendant',
              'absorb_fees')
    `;
    await fixtureSql!`
      insert into lancamentos
        (id, clinic_id, tipo, descricao, valor, valor_pago, status, paid_at,
         appointment_id, patient_id, created_via)
      values (${lancamentoId}::uuid, ${fixtureClinicId}::uuid, 'receber',
              'Consulta sintética', 240, 240, 'pago', now(),
              ${appointmentId}::uuid, ${patientId}::uuid, 'auto')
    `;
    await fixtureSql!`
      insert into patient_charges
        (id, clinic_id, appointment_id, patient_id, kind, status, amount,
         provider, external_reference, paid_at, provider_gross_amount,
          provider_fee_amount, provider_net_amount, economics_reconciled_at,
          provider_economics_revision)
      values (${chargeId}::uuid, ${fixtureClinicId}::uuid, ${appointmentId}::uuid,
              ${patientId}::uuid, 'remainder', 'paid', 240, 'asaas',
          ${`remainder:${appointmentId}`}, now(), 240, 4, 236, now(), 1)
    `;
    await fixtureSql!`
      insert into patient_credits
        (clinic_id, patient_id, appointment_id, patient_charge_id, amount,
         allocated_amount, allocated_lancamento_id, kind, status, payment_method,
         provider_gross_amount, provider_fee_amount, provider_net_amount,
          provider_economics_reconciled_at, provider_economics_revision)
      values (${fixtureClinicId}::uuid, ${patientId}::uuid, ${appointmentId}::uuid,
              ${chargeId}::uuid, 240, 240, ${lancamentoId}::uuid,
          'remaining_payment', 'allocated', 'pix', 240, 4, 236, now(), 1)
    `;
    await fixtureSql!`
      insert into professional_payout_rules
        (id, clinic_id, professional_id, procedure_id, kind, percentage, effective_from)
      values (${ruleId}::uuid, ${fixtureClinicId}::uuid, ${fixtureDoctorId}::uuid,
              ${procedure.id}::uuid, 'percentage', 30, now() - interval '1 hour')
    `;
    await fixtureSql!`
      insert into professional_payouts
        (clinic_id, appointment_id, professional_id, procedure_id,
         policy_version_id, rule_id, calculation_basis, rule_kind,
         rule_percentage, gross_amount, provider_fee_amount, net_amount,
         basis_amount, payout_amount, status, calculated_at)
      values (${fixtureClinicId}::uuid, ${appointmentId}::uuid,
              ${fixtureDoctorId}::uuid, ${procedure.id}::uuid,
              ${policyVersion.id}::uuid, ${ruleId}::uuid, 'net', 'percentage',
              30, 240, 4, 236, 236, 70.80, 'calculated', now())
    `;

    await page.goto('/auth/session-refresh?next=/caixa');
    await expect(page).toHaveURL(/\/caixa(?:\?|$)/u);
    const received = page.locator('section[aria-label="Recebidos hoje"]');
    const patient = received.getByText(patientName, { exact: true });
    await expect(patient).toBeVisible();
    const composition = patient.locator('xpath=../..').locator('details');
    await page.waitForLoadState('networkidle');
    await composition.locator('summary').click();
    await expect(composition).toHaveAttribute('open', '');
    await expect(composition.getByText('Base do repasse')).toBeVisible();
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Valor do atendimento' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('R$ 240,00');
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Tarifa real alocada' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('− R$ 4,00');
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Líquido real alocado' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('R$ 236,00');
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Base do repasse' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('Líquido');
    await expect(
      composition
        .locator('dt')
        .filter({ hasText: 'Repasse profissional' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('R$ 70,80');
    const [persisted] = await fixtureSql!<{ status: string; payout_amount: string }[]>`
      select status, payout_amount::text from professional_payouts
       where clinic_id = ${fixtureClinicId}::uuid and appointment_id = ${appointmentId}::uuid
    `;
    expect(persisted).toEqual({ status: 'calculated', payout_amount: '70.80' });

    // O smoke PostgreSQL separado exercita o serviço que suspende a obrigação;
    // aqui a fixture confirma que o estado persistido chega ao navegador.
    await fixtureSql!`
      update professional_payouts
         set status = 'cancelled', basis_amount = null, payout_amount = null,
             calculated_at = null, updated_at = now()
       where clinic_id = ${fixtureClinicId}::uuid
         and appointment_id = ${appointmentId}::uuid
    `;
    await page.reload();
    await page.waitForLoadState('networkidle');
    const suspendedPatient = page
      .locator('section[aria-label="Recebidos hoje"]')
      .getByText(patientName, { exact: true });
    const suspendedComposition = suspendedPatient.locator('xpath=../..').locator('details');
    await suspendedComposition.locator('summary').click();
    await expect(
      suspendedComposition
        .locator('dt')
        .filter({ hasText: 'Repasse profissional' })
        .locator('xpath=following-sibling::dd[1]'),
    ).toHaveText('Suspenso');
    await expect(
      suspendedComposition.getByText('Revise o valor devido antes de pagar o profissional.'),
    ).toBeVisible();
    const [suspended] = await fixtureSql!<{ status: string; payout_amount: string | null }[]>`
      select status, payout_amount::text from professional_payouts
       where clinic_id = ${fixtureClinicId}::uuid and appointment_id = ${appointmentId}::uuid
    `;
    expect(suspended).toEqual({ status: 'cancelled', payout_amount: null });
    fixtureAuthCookies = await page.context().cookies();
  });

  test('com cobrança histórica, pausa preserva credencial e webhook; mesma chave retoma', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    test.skip(!isolatedFixture, 'Exige cobranças sintéticas da fixture isolada em DEV.');
    test.skip(!sandboxKey, 'Exige a chave da conta Asaas Sandbox da clínica.');
    assertPreviewOnly();
    assertPaymentMutationOptIn();
    if (!sandboxKey) throw new Error('Chave Asaas Sandbox ausente após a precondição.');
    await authenticateForTest(page);

    const [history] = await fixtureSql!<{ total: number }[]>`
      select count(*)::int total from patient_charges
       where clinic_id = ${fixtureClinicId}::uuid
    `;
    expect(history?.total, 'a fixture não tem cobrança histórica').toBeGreaterThan(0);

    await page.goto('/configuracoes/pagamentos');
    await expect(page.getByText(/Nenhuma conta conectada/)).toBeVisible();
    await page.locator('#asaas-api-key').fill(sandboxKey);
    await page.getByRole('button', { name: 'Conectar conta' }).click();
    await expect(page.getByText('Conectada', { exact: true })).toBeVisible({ timeout: 90_000 });

    const [connected] = await fixtureSql!<
      {
        webhook_ref: string;
        webhook_token_encrypted: string | null;
        api_key_encrypted: string | null;
      }[]
    >`
      select webhook_ref::text, webhook_token_encrypted, api_key_encrypted
        from clinic_payment_accounts where clinic_id = ${fixtureClinicId}::uuid
    `;
    expect(
      Boolean(
        connected?.webhook_ref && connected.webhook_token_encrypted && connected.api_key_encrypted,
      ),
    ).toBe(true);

    await page.getByRole('button', { name: 'Pausar ou desconectar' }).click();
    await expect(page.getByText('Pausada', { exact: true })).toBeVisible({ timeout: 60_000 });
    await page.reload();
    await expect(page.getByText('Novas cobranças pausadas')).toBeVisible();
    const [paused] = await fixtureSql!<
      {
        active: boolean;
        accept_new_charges: boolean;
        webhook_ref: string;
        webhook_token_encrypted: string | null;
        api_key_encrypted: string | null;
      }[]
    >`
      select active, accept_new_charges, webhook_ref::text,
             webhook_token_encrypted, api_key_encrypted
        from clinic_payment_accounts where clinic_id = ${fixtureClinicId}::uuid
    `;
    expect(paused?.active).toBe(true);
    expect(paused?.accept_new_charges).toBe(false);
    expect(Boolean(paused?.api_key_encrypted && paused.webhook_token_encrypted)).toBe(true);
    expect(paused?.webhook_ref === connected?.webhook_ref).toBe(true);
    expect(paused?.webhook_token_encrypted === connected?.webhook_token_encrypted).toBe(true);

    const remoteResponse = await fetch(
      'https://api-sandbox.asaas.com/v3/webhooks?offset=0&limit=100',
      {
        headers: { access_token: sandboxKey },
      },
    );
    expect(remoteResponse.status, 'Asaas não permitiu ler os webhooks da fixture').toBe(200);
    const remoteBody: unknown = await remoteResponse.json();
    if (
      !remoteBody ||
      typeof remoteBody !== 'object' ||
      !('data' in remoteBody) ||
      !Array.isArray(remoteBody.data)
    ) {
      throw new Error('Listagem de webhooks Sandbox malformada.');
    }
    const expectedPath = `/api/webhooks/asaas/patient/${paused?.webhook_ref}`;
    const matches = remoteBody.data.filter((item: unknown) => {
      if (!item || typeof item !== 'object' || !('url' in item) || typeof item.url !== 'string')
        return false;
      try {
        return new URL(item.url).pathname === expectedPath;
      } catch {
        return false;
      }
    });
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ enabled: true });

    await page.locator('#asaas-api-key').fill(sandboxKey);
    await page.getByRole('button', { name: 'Conectar ou retomar' }).click();
    await expect(page.getByText('Conectada', { exact: true })).toBeVisible({ timeout: 90_000 });
    const [resumed] = await fixtureSql!<
      {
        accept_new_charges: boolean;
        webhook_ref: string;
        webhook_token_encrypted: string | null;
      }[]
    >`
      select accept_new_charges, webhook_ref::text, webhook_token_encrypted
        from clinic_payment_accounts where clinic_id = ${fixtureClinicId}::uuid
    `;
    expect(resumed?.accept_new_charges).toBe(true);
    expect(resumed?.webhook_ref === paused?.webhook_ref).toBe(true);
    expect(resumed?.webhook_token_encrypted === paused?.webhook_token_encrypted).toBe(true);

    await page.getByRole('button', { name: 'Pausar ou desconectar' }).click();
    await expect(page.getByText('Pausada', { exact: true })).toBeVisible({ timeout: 60_000 });
    // Decisão de 07/10/2026: com histórico, o caminho deixa de ser "Tentar
    // desconexão" (que não fazia nada) e passa a ser o encerramento definitivo.
    await expect(page.getByRole('button', { name: 'Tentar desconexão' })).toHaveCount(0);
    await expect(page.getByText(/encerrada automaticamente em/u)).toBeVisible();

    // Contestação em andamento impede o encerramento: a tela explica e não oferece o botão.
    const [disputed] = await fixtureSql!<{ id: string }[]>`
      update patient_charges set dispute_status = 'in_dispute'
       where id = (select id from patient_charges
                    where clinic_id = ${fixtureClinicId}::uuid and status = 'paid'
                    order by created_at limit 1)
      returning id::text
    `;
    expect(disputed, 'a fixture não tem cobrança paga para contestar').toBeTruthy();
    await page.reload();
    await expect(
      page.getByText('Para encerrar, resolva antes: 1 contestação em andamento.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Encerrar definitivamente' })).toHaveCount(0);
    await fixtureSql!`
      update patient_charges set dispute_status = null where id = ${disputed!.id}::uuid
    `;

    await page.reload();
    await page.getByRole('button', { name: 'Encerrar definitivamente' }).click();
    await page.getByRole('button', { name: 'Confirmar encerramento' }).click();
    await expect(page.getByText(/Conta encerrada\./u)).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(/Nenhuma conta conectada/)).toBeVisible();

    const [closed] = await fixtureSql!<
      {
        active: boolean;
        accept_new_charges: boolean;
        has_key: boolean;
        has_token: boolean;
        notice: string | null;
        disconnected: boolean;
      }[]
    >`
      select active, accept_new_charges,
             api_key_encrypted is not null has_key,
             webhook_token_encrypted is not null has_token,
             closure_notice_sent_at::text notice,
             disconnected_at is not null disconnected
        from clinic_payment_accounts where clinic_id = ${fixtureClinicId}::uuid
    `;
    expect(closed).toEqual({
      active: false,
      accept_new_charges: false,
      has_key: false,
      has_token: false,
      notice: null,
      disconnected: true,
    });
    const audits = await fixtureSql!<
      { after: { trigger?: string; remoteWebhookDisabled?: boolean } }[]
    >`
      select after from audit_events
       where clinic_id = ${fixtureClinicId}::uuid and action = 'payments.account.closed'
    `;
    expect(audits).toHaveLength(1);
    expect(audits[0]?.after).toMatchObject({ trigger: 'manual', remoteWebhookDisabled: true });

    const afterClose = await fetch('https://api-sandbox.asaas.com/v3/webhooks?offset=0&limit=100', {
      headers: { access_token: sandboxKey },
    });
    expect(afterClose.status, 'Asaas não permitiu reler os webhooks da fixture').toBe(200);
    const afterBody = (await afterClose.json()) as {
      data?: Array<{ url?: string; enabled?: boolean }>;
    };
    const remaining = (afterBody.data ?? []).filter((item) => {
      try {
        return new URL(item.url ?? '').pathname === expectedPath;
      } catch {
        return false;
      }
    });
    // Desativado, não apagado: o cleanup da fixture remove o recurso depois.
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.enabled).toBe(false);
  });
});
