import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_TEAM === 'ALLOW_TEST_ACCOUNT';
const baseUrl = process.env.E2E_BASE_URL;
// A jornada consome quatro vagas de equipe. Quando a clinica do storageState
// padrao nao tem capacidade livre, aponte para outro owner descartavel com
// E2E_TEAM_OWNER_EMAIL (a senha compartilhada ja existe para os testes A<->B).
const ownerOverrideEmail = process.env.E2E_TEAM_OWNER_EMAIL;
const ownerOverridePassword = process.env.E2E_TENANT_PASSWORD;

// Convite/recovery e senha são credenciais bearer. Não entram em artefatos.
test.use({
  // Este gate de producao reutiliza deliberadamente a sessao autenticada do
  // owner descartavel. Ele nunca deve iniciar login interativo nem exigir
  // credenciais na linha de comando.
  storageState: '.playwright/.auth/user.json',
  // Trace includes navigation URLs and could retain bearer magic links. Video
  // does not record the browser chrome and preserves safe visual evidence.
  trace: 'off',
  video: 'on',
  screenshot: 'off',
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

type Role = 'gestor' | 'doctor' | 'attendant' | 'financial';

type Member = {
  role: Role;
  label: string;
  name: string;
  email: string;
  password: string;
  context?: BrowserContext;
  userId?: string;
};

const ROUTES = [
  '/dashboard',
  '/agenda',
  '/agenda/ausencias',
  '/agenda/importar',
  '/agenda/lista-espera',
  '/caixa',
  '/financeiro',
  '/financeiro/fornecedores',
  '/configuracoes',
  '/configuracoes/assinatura',
  '/configuracoes/horarios',
  '/configuracoes/perfil',
  '/configuracoes/procedimentos',
  '/configuracoes/recursos',
  '/configuracoes/sugestoes',
  '/configuracoes/lgpd',
  '/configuracoes/whatsapp',
  '/equipe',
  '/pacientes',
  '/consultorio',
  '/conversas',
  '/documentos',
  '/modelos-receita',
  '/relatorios',
  '/account/security',
] as const;

function sessionClaims(cookies: Array<{ name: string; value: string }>): Record<string, unknown> {
  const value = cookies
    .filter((cookie) => cookie.name.includes('auth-token'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((cookie) => cookie.value)
    .join('');
  if (!value.startsWith('base64-')) throw new Error('Cookie Auth inesperado.');
  const session = JSON.parse(Buffer.from(value.slice(7), 'base64url').toString('utf8')) as {
    access_token?: unknown;
  };
  if (typeof session.access_token !== 'string') throw new Error('Access token ausente.');
  const payload = session.access_token.split('.')[1];
  if (!payload) throw new Error('JWT malformado.');
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function assertConfirmationUrl(link: string): void {
  const parsed = new URL(link);
  expect(parsed.protocol).toBe('https:');
  expect(parsed.origin).toBe('https://app.qoro.dev');
  expect(parsed.pathname).toBe('/auth/confirm');
  expect(parsed.searchParams.has('token_hash')).toBe(true);
  expect(parsed.searchParams.get('type')).toBe('recovery');
  expect(parsed.searchParams.get('next')).toBe('/convite');
  expect(parsed.hash).toBe('');
}

async function responseFailureDetail(response: Awaited<ReturnType<Page['goto']>>): Promise<string> {
  if (!response || response.status() < 500) return '';
  // A resposta de produção pode conter um digest do Next, mas jamais deve ser
  // anexada inteira: ela pode trazer payloads de RSC. O digest é opaco e basta
  // para correlacionar a falha no Sentry sem vazar dados da sessão.
  const match = /"digest":"([^"\\]{1,128})"/u.exec(await response.text());
  return match ? ` (digest ${match[1]})` : '';
}

async function login(context: BrowserContext, email: string, password: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 60_000 });
  return page;
}

async function sendInvite(page: Page, member: Member, runId: string): Promise<void> {
  await page.goto('/equipe');
  await page.getByRole('button', { name: 'Convidar', exact: true }).click();
  const drawer = page.getByRole('dialog').filter({ hasText: 'Convidar para a equipe' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('radio', { name: member.label, exact: true }).click();
  await drawer.getByPlaceholder('Nome completo').fill(member.name);
  await drawer.getByPlaceholder('pessoa@email.com').fill(member.email);
  if (member.role === 'doctor') {
    await drawer.getByPlaceholder('123456').fill(`E2E${runId}`);
    await drawer.getByPlaceholder('SP').fill('SP');
  }
  await drawer.getByRole('button', { name: 'Enviar convite' }).click();
  await expect(page.getByText('Convite enviado', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  const row = page.getByText(member.name, { exact: true }).locator('xpath=ancestor::tr[1]');
  await expect(row.getByText('Convite pendente', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/**
 * This production journey needs the owner plus its four role fixtures. Check
 * the contracted capacity before creating anything so a reused test account
 * cannot fail halfway through after consuming seats.
 */
async function assertTeamCapacity(page: Page, requiredSeats: number): Promise<void> {
  await page.goto('/equipe');
  const indicator = page.getByText(/^Usuários: \d+ de \d+$/u);
  if ((await indicator.count()) === 0) return;

  const label = (await indicator.textContent())?.trim() ?? '';
  const match = /^Usuários: (\d+) de (\d+)$/u.exec(label);
  if (!match) throw new Error(`Indicador de vagas da equipe inválido: ${label || '(vazio)'}.`);

  const activeUsers = Number(match[1]);
  const seatLimit = Number(match[2]);
  const availableSeats = seatLimit - activeUsers;
  if (availableSeats < requiredSeats) {
    throw new Error(
      `Conta E2E sem vagas suficientes: ${activeUsers} de ${seatLimit} usuários em uso; ` +
        `a jornada exige ${requiredSeats} vagas livres para gestor, médico, atendente e financeiro. ` +
        'Use uma clínica descartável com capacidade livre antes de executar o teste.',
    );
  }
}

async function resendInvite(page: Page, member: Member): Promise<string> {
  const row = page.getByText(member.name, { exact: true }).locator('xpath=ancestor::tr[1]');
  await row.getByRole('button', { name: `Ações do convite de ${member.name}` }).click();
  await page.getByRole('menuitem', { name: 'Reenviar convite' }).click();
  await expect(page.getByText('Link copiado', { exact: true })).toBeVisible({ timeout: 30_000 });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  assertConfirmationUrl(link);
  return link;
}

/**
 * Fixture bridge for invitations whose real delivery is validated separately.
 * It never sends email and is deliberately limited to accounts this test has
 * just created. The doctor still exercises the product's visible re-send flow.
 */
async function generateFixtureRecoveryLink(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: 'https://app.qoro.dev/convite' },
  });
  if (error || !data?.properties.hashed_token) {
    throw error ?? new Error('Não foi possível gerar a fixture de aceite.');
  }
  const link = new URL('https://app.qoro.dev/auth/confirm');
  link.searchParams.set('token_hash', data.properties.hashed_token);
  link.searchParams.set('type', 'recovery');
  link.searchParams.set('next', '/convite');
  assertConfirmationUrl(link.toString());
  return link.toString();
}

async function acceptInvite(
  browserContext: BrowserContext,
  link: string,
  member: Member,
  exerciseValidation: boolean,
): Promise<Record<string, unknown>> {
  const page = await browserContext.newPage();
  await page.goto(link);
  // `goto()` já concluiu a confirmação SSR. Validamos somente origem e path
  // para jamais incluir a credencial one-time em uma mensagem de falha ou artefato.
  const destination = new URL(page.url());
  expect(destination.origin).toBe('https://app.qoro.dev');
  expect(destination.pathname).toBe('/convite');
  expect(destination.hash).toBe('');
  await expect(page.getByRole('heading', { name: 'Criar senha de acesso' })).toBeVisible({
    timeout: 30_000,
  });

  if (exerciseValidation) {
    await page.getByLabel('Senha', { exact: true }).fill('SemSimbolo123');
    await page.getByLabel('Confirmar senha').fill('SemSimbolo123');
    await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
    await expect(page.getByText('A senha deve conter ao menos um símbolo.')).toBeVisible();
  }

  await page.getByLabel('Senha', { exact: true }).fill(member.password);
  await page.getByLabel('Confirmar senha').fill(member.password);
  await page.getByRole('button', { name: 'Criar senha e entrar' }).click();
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 60_000 });
  return sessionClaims(await browserContext.cookies());
}

async function routeInventory(
  context: BrowserContext,
): Promise<
  Array<{ route: string; status: number | null; finalPath: string; buttons: number; forms: number }>
> {
  const page = await context.newPage();
  const result = [];
  try {
    for (const route of ROUTES) {
      const response = await page.goto(route);
      const status = response?.status() ?? null;
      expect(status, `${route} sem status`).not.toBeNull();
      const failureDetail = await responseFailureDetail(response);
      expect(status!, `${route} retornou ${status}${failureDetail}`).toBeLessThan(500);
      await expect(page).not.toHaveURL(/\/login(?:\?|$)/u);
      result.push({
        route,
        status,
        finalPath: new URL(page.url()).pathname,
        buttons: await page.getByRole('button').count(),
        forms: await page.locator('form').count(),
      });
    }
    return result;
  } finally {
    await page.close();
  }
}

test.describe('produção: equipe e papéis autorizados na conta de teste', () => {
  test.describe.configure({ retries: 0 });

  test('convida, aceita, audita rotas, muda função e desativa/reativa', async ({
    browser,
    page: defaultOwnerPage,
  }, testInfo) => {
    test.setTimeout(900_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_TEAM=ALLOW_TEST_ACCOUNT para criar membros de teste.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('A jornada de equipe autorizada só pode apontar para app.qoro.dev.');
    }

    const databaseUrl = process.env.DATABASE_URL_PROD;
    const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
    if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
    const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
    if (!projectRef) throw new Error('Project ref PROD ausente.');
    const admin = createClient(`https://${projectRef}.supabase.co`, adminSecret, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const sql = postgres(databaseUrl, { max: 1, ssl: 'require' });

    if (ownerOverrideEmail && !ownerOverridePassword) {
      throw new Error('E2E_TEAM_OWNER_EMAIL exige E2E_TENANT_PASSWORD.');
    }
    // O contexto sobrescrito nasce sem cookies para nao herdar a sessao do
    // storageState padrao; o owner correto vem apenas do login.
    const ownerContext = ownerOverrideEmail
      ? await browser.newContext({ baseURL: baseUrl, storageState: { cookies: [], origins: [] } })
      : undefined;
    const page = ownerContext
      ? await login(ownerContext, ownerOverrideEmail!, ownerOverridePassword!)
      : defaultOwnerPage;

    const ownerClaims = sessionClaims(await page.context().cookies());
    const ownerClinicId = typeof ownerClaims.clinic_id === 'string' ? ownerClaims.clinic_id : '';
    const ownerEmail = typeof ownerClaims.email === 'string' ? ownerClaims.email : '';
    expect(ownerClaims.app_role).toBe('owner');
    if (!/^[0-9a-f-]{36}$/iu.test(ownerClinicId) || !ownerEmail.includes('@')) {
      throw new Error('Sessão owner da conta de teste inválida.');
    }
    const [local, domain] = ownerEmail.toLowerCase().split('@');
    if (!local || !domain) throw new Error('E-mail owner inválido.');
    const mailbox = local.split('+')[0]!;
    const runId = String(Date.now()).slice(-9);
    const members: Member[] = [
      {
        role: 'gestor',
        label: 'Gestor',
        name: `[E2E-TEAM-${runId}] Gestor`,
        email: '',
        password: '',
      },
      {
        role: 'doctor',
        label: 'Médico',
        name: `[E2E-TEAM-${runId}] Médico`,
        email: '',
        password: '',
      },
      {
        role: 'attendant',
        label: 'Atendente',
        name: `[E2E-TEAM-${runId}] Atendente`,
        email: '',
        password: '',
      },
      {
        role: 'financial',
        label: 'Financeiro',
        name: `[E2E-TEAM-${runId}] Financeiro`,
        email: '',
        password: '',
      },
    ];
    for (const member of members) {
      member.email = `${mailbox}+e2e-${member.role}-${runId}@${domain}`;
      member.password = `Aa1!${randomBytes(18).toString('base64url')}`;
    }
    const emails = new Set(members.map((member) => member.email));

    const inventories: Record<string, Awaited<ReturnType<typeof routeInventory>>> = {};
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], {
      origin: 'https://app.qoro.dev',
    });

    try {
      await assertTeamCapacity(page, members.length);

      const acceptMember = async (
        member: Member,
        link: string,
        exerciseValidation: boolean,
        auditRoutes = true,
      ): Promise<void> => {
        // O state do owner é aplicado ao contexto principal deste teste. Cada
        // convidado deve começar sem cookies/origins, senão o aceite poderia
        // reutilizar a sessão de quem convidou em vez da identidade do link.
        const context = await browser.newContext({
          baseURL: 'https://app.qoro.dev',
          storageState: { cookies: [], origins: [] },
        });
        member.context = context;
        const claims = await acceptInvite(context, link, member, exerciseValidation);
        expect(claims.app_role).toBe(member.role);
        expect(claims.clinic_id).toBe(ownerClinicId);
        expect(claims.aal).toBe('aal1');
        if (typeof claims.sub === 'string') member.userId = claims.sub;
        expect(member.userId).toMatch(/^[0-9a-f-]{36}$/iu);

        if (auditRoutes) inventories[member.role] = await routeInventory(context);
        const teamPage = await context.newPage();
        await teamPage.goto('/equipe');
        if (member.role === 'gestor') {
          await expect(
            teamPage.getByRole('button', { name: 'Convidar', exact: true }),
          ).toBeVisible();
        } else {
          await expect(
            teamPage.getByText('Seu perfil não tem permissão para gerenciar a equipe.'),
          ).toBeVisible();
        }
        await teamPage.close();
      };

      const gestor = members.find((member) => member.role === 'gestor')!;
      await sendInvite(page, gestor, runId);
      // O rate limit de reenvio pertence à clínica inteira. Usamos este link
      // administrativo, sem envio, exclusivamente para materializar a fixture
      // inicial; o reenvio visível é exercitado logo abaixo pelo gestor novo.
      await acceptMember(
        gestor,
        await generateFixtureRecoveryLink(admin, gestor.email),
        true,
        false,
      );
      // A contagem de usuários muda depois do aceite. O owner e o gestor devem
      // continuar renderizando a tela de assinatura sob esse mesmo estado.
      const ownerSubscription = await page.goto('/configuracoes/assinatura');
      const ownerSubscriptionStatus = ownerSubscription?.status() ?? null;
      expect(ownerSubscriptionStatus, 'owner /configuracoes/assinatura sem status').not.toBeNull();
      expect(
        ownerSubscriptionStatus!,
        `owner /configuracoes/assinatura retornou ${ownerSubscriptionStatus}${await responseFailureDetail(ownerSubscription)}`,
      ).toBeLessThan(500);
      inventories[gestor.role] = await routeInventory(gestor.context!);

      const doctor = members.find((member) => member.role === 'doctor')!;
      const gestorPage = await gestor.context!.newPage();
      await gestor.context!.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin: 'https://app.qoro.dev',
      });
      await sendInvite(gestorPage, doctor, runId);
      const doctorLink = await resendInvite(gestorPage, doctor);
      await gestorPage.close();
      await acceptMember(doctor, doctorLink, false);

      for (const member of members.filter((candidate) =>
        ['attendant', 'financial'].includes(candidate.role),
      )) {
        await sendInvite(page, member, runId);
        await acceptMember(member, await generateFixtureRecoveryLink(admin, member.email), false);
      }

      const attendant = members.find((member) => member.role === 'attendant')!;
      await page.goto('/equipe');
      let attendantRow = page
        .getByText(attendant.name, { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await attendantRow.getByRole('button', { name: `Ações de ${attendant.name}` }).click();
      await page.getByRole('menuitem', { name: 'Desativar acesso' }).click();
      await page.getByRole('button', { name: 'Desativar acesso', exact: true }).click();
      await expect(attendantRow.getByText('Inativo', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      const attendantPage = await attendant.context!.newPage();
      const disabledDashboard = await attendantPage.goto('/dashboard');
      expect(
        disabledDashboard?.status(),
        'sessão desativada não pode gerar 500 no dashboard',
      ).toBeLessThan(500);
      await expect(attendantPage).toHaveURL(/\/login(?:\?|$)/u, { timeout: 30_000 });

      await page.reload();
      attendantRow = page
        .getByText(attendant.name, { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await attendantRow.getByRole('button', { name: `Ações de ${attendant.name}` }).click();
      await page.getByRole('menuitem', { name: 'Reativar acesso' }).click();
      await expect(attendantRow.getByText('Ativo', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await attendantPage.locator('#email').fill(attendant.email);
      await attendantPage.locator('input[name="password"]').fill(attendant.password);
      await attendantPage.getByRole('button', { name: 'Entrar' }).click();
      await expect(attendantPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      await attendantPage.getByRole('button', { name: 'Sair' }).click();
      await expect(attendantPage).toHaveURL(/\/login(?:\?|$)/u, { timeout: 30_000 });
      const unauthenticatedTeam = await attendantPage.goto('/equipe');
      expect(
        unauthenticatedTeam?.status(),
        'sessão ausente não pode gerar 500 em equipe',
      ).toBeLessThan(500);
      await expect(attendantPage).toHaveURL(/\/login(?:\?|$)/u, { timeout: 30_000 });

      const financial = members.find((member) => member.role === 'financial')!;
      await page.goto('/equipe');
      const financialRow = page
        .getByText(financial.name, { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await financialRow.getByRole('button', { name: `Ações de ${financial.name}` }).click();
      await page.getByRole('menuitem', { name: 'Trocar função' }).click();
      const roleDialog = page.getByRole('dialog', { name: `Trocar função de ${financial.name}` });
      await roleDialog.getByLabel('Função').selectOption('attendant');
      await roleDialog.getByRole('button', { name: 'Salvar função' }).click();
      await expect(page.getByText('Função atualizada', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await page.reload();
      const changedRow = page
        .getByText(financial.name, { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await changedRow.getByRole('button', { name: `Ações de ${financial.name}` }).click();
      await page.getByRole('menuitem', { name: 'Trocar função' }).click();
      const restoreDialog = page.getByRole('dialog', {
        name: `Trocar função de ${financial.name}`,
      });
      await restoreDialog.getByLabel('Função').selectOption('financial');
      await restoreDialog.getByRole('button', { name: 'Salvar função' }).click();
      await expect(page.getByText('Função atualizada', { exact: true })).toBeVisible({
        timeout: 30_000,
      });

      await testInfo.attach('production-team-route-inventory.json', {
        body: JSON.stringify(
          Object.fromEntries(
            Object.entries(inventories).map(([role, routes]) => [
              role,
              { routes, count: routes.length },
            ]),
          ),
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      try {
        for (const member of members) await member.context?.close().catch(() => undefined);
        await ownerContext?.close().catch(() => undefined);

        const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
        if (listed.error) throw listed.error;
        const targets = listed.data.users.filter((user) => user.email && emails.has(user.email));
        for (const user of targets) {
          const removed = await admin.auth.admin.deleteUser(user.id);
          if (removed.error) throw removed.error;
        }
        const remaining = await sql.begin(async (tx) => {
          // O pooler de producao inicia a sessao como `authenticator`. A
          // verificacao de limpeza usa somente a clinica e o prefixo deste run,
          // e restaura o papel administrativo dentro da transacao curta.
          await tx.unsafe('RESET ROLE');
          return tx<{ count: number }[]>`
            select count(*)::int as count
            from profiles
            where clinic_id = ${ownerClinicId}::uuid
              and nome like ${`[E2E-TEAM-${runId}]%`}
          `;
        });
        expect(remaining[0]?.count).toBe(0);
      } finally {
        await sql.end();
      }
    }
  });
});
