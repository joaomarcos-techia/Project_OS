import { randomBytes } from 'node:crypto';

import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_TEAM === 'ALLOW_TEST_ACCOUNT';
const baseUrl = process.env.E2E_BASE_URL;

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

async function invite(page: Page, member: Member, runId: string): Promise<string> {
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
  await row.getByRole('button', { name: `Ações do convite de ${member.name}` }).click();
  await page.getByRole('menuitem', { name: 'Reenviar convite' }).click();
  await expect(page.getByText('Link copiado', { exact: true })).toBeVisible({ timeout: 30_000 });
  const link = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = new URL(link);
  expect(parsed.protocol).toBe('https:');
  expect(parsed.hostname).toMatch(/\.supabase\.co$/u);
  return link;
}

async function acceptInvite(
  browserContext: BrowserContext,
  link: string,
  member: Member,
  exerciseValidation: boolean,
): Promise<Record<string, unknown>> {
  const page = await browserContext.newPage();
  await page.goto(link);
  await page.waitForURL(/\/convite(?:\?|$)/u, { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Criar senha de acesso' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(member.name, { exact: false })).toBeVisible();

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
      expect(status!, `${route} retornou ${status}`).toBeLessThan(500);
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
    page,
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
      for (const [index, member] of members.entries()) {
        const link = await invite(page, member, runId);
        const context = await browser.newContext({ baseURL: 'https://app.qoro.dev' });
        member.context = context;
        const claims = await acceptInvite(context, link, member, index === 0);
        expect(claims.app_role).toBe(member.role);
        expect(claims.clinic_id).toBe(ownerClinicId);
        expect(claims.aal).toBe('aal1');
        if (typeof claims.sub === 'string') member.userId = claims.sub;
        expect(member.userId).toMatch(/^[0-9a-f-]{36}$/iu);

        inventories[member.role] = await routeInventory(context);
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
      await attendantPage.goto('/dashboard');
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

      await attendantPage.getByLabel('Email').fill(attendant.email);
      await attendantPage.locator('input[name="password"]').fill(attendant.password);
      await attendantPage.getByRole('button', { name: 'Entrar' }).click();
      await expect(attendantPage).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
      await attendantPage.getByRole('button', { name: 'Sair' }).click();
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
