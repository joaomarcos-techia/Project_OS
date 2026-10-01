import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

import { ALL_PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import { TENANT_ROLES, type Role } from '@/lib/auth/roles';

import { assertDevContext } from '../scripts/_env';

loadDotenv({ path: '.env.local' });

type TenantRole = Exclude<Role, 'super_admin'>;
type FixtureUser = { id: string; email: string; name: string; role: TenantRole };

const baseUrl = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const runId = randomUUID();
const slug = `e2e-rbac-${runId.slice(0, 8)}`;
const password = `Qoro${runId.replaceAll('-', '')}Aa1!`;
const users = new Map<TenantRole, FixtureUser>();
const createdAuthIds: string[] = [];
let clinicId = '';

const routeMatrix: ReadonlyArray<{ path: string; permission: Permission }> = [
  { path: '/consultorio', permission: 'view:consultorio' },
  { path: '/financeiro', permission: 'view:financial' },
  { path: '/caixa', permission: 'view:financial' },
  { path: '/conversas', permission: 'view:conversations' },
  { path: '/equipe', permission: 'manage:employees' },
  { path: '/configuracoes/perfil', permission: 'manage:settings' },
  { path: '/configuracoes/procedimentos', permission: 'manage:procedures' },
  { path: '/configuracoes/horarios', permission: 'manage:availability' },
  { path: '/configuracoes/pagamentos', permission: 'manage:financial' },
  { path: '/configuracoes/agente', permission: 'manage:agent' },
  { path: '/agenda/importar', permission: 'import:agenda' },
  { path: '/configuracoes/lgpd', permission: 'export:patient' },
  { path: '/modelos-receita', permission: 'create:prescription' },
  { path: '/configuracoes/auditoria', permission: 'export:audit' },
  { path: '/documentos', permission: 'view:prescription' },
];

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function devConfig(): { databaseUrl: string; supabaseUrl: string; secretKey: string } {
  const hostname = new URL(baseUrl).hostname;
  if (!['127.0.0.1', 'localhost', '::1'].includes(hostname)) {
    throw new Error('A matriz RBAC DEV só pode apontar para localhost.');
  }
  const { databaseUrl } = assertDevContext();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!supabaseUrl || !secretKey) throw new Error('Supabase DEV não configurado.');

  const databaseRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  const authRef = new URL(supabaseUrl).hostname.split('.')[0];
  if (!databaseRef || databaseRef !== authRef) {
    throw new Error('Database e Auth DEV apontam para projetos diferentes.');
  }
  return { databaseUrl, supabaseUrl, secretKey };
}

const config = devConfig();
const sql = postgres(config.databaseUrl, { max: 3, ssl: 'require', prepare: false });

async function adminCreateUser(email: string): Promise<string> {
  const response = await fetch(`${config.supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: config.secretKey,
      authorization: `Bearer ${config.secretKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = (await response.json().catch(() => null)) as {
    id?: unknown;
    message?: unknown;
  } | null;
  if (!response.ok || typeof body?.id !== 'string') {
    throw new Error(
      `[rbac-dev] Auth recusou criação (HTTP ${response.status}, resposta=${typeof body?.message === 'string' ? body.message.slice(0, 120) : 'inválida'}).`,
    );
  }
  return body.id;
}

async function adminDeleteUser(id: string): Promise<string | null> {
  const response = await fetch(
    `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { apikey: config.secretKey, authorization: `Bearer ${config.secretKey}` },
    },
  );
  if (response.ok || response.status === 404) return null;
  return `Auth cleanup HTTP ${response.status}`;
}

async function signIn(page: Page, user: FixtureUser): Promise<void> {
  // O login real também grava o seletor de geração da sessão usado pelo
  // middleware. Injetar apenas o cookie do Supabase produz uma sessão válida no
  // Auth, mas deliberadamente incompleta para o Qoro e termina em /login.
  await page.goto('/login', { timeout: 150_000, waitUntil: 'domcontentloaded' });
  await page.locator('#email').fill(user.email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Entrar' }).click({ noWaitAfter: true });
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 180_000 });
}

async function effectivePermissions(userId: string): Promise<{
  claimsVersion: number;
  permissions: string[];
  override: boolean | null;
}> {
  const [row] = await sql<
    { claims_version: number; permissions: string[]; override: boolean | null }[]
  >`
    select ep.claims_version,
           ep.permissions,
           (select granted from user_permission_overrides
             where user_id = ep.user_id and permission_code = 'manage:procedures') as override
      from effective_permissions_v ep
     where ep.user_id = ${userId}::uuid
  `;
  if (!row) throw new Error('Permissões efetivas ausentes.');
  return {
    claimsVersion: row.claims_version,
    permissions: row.permissions,
    override: row.override,
  };
}

async function changeProcedureOverride(
  actorPage: Page,
  target: FixtureUser,
  value: 'default' | 'grant',
): Promise<void> {
  await actorPage.goto('/equipe', { timeout: 180_000 });
  const row = actorPage.getByText(target.name, { exact: true }).locator('xpath=ancestor::tr[1]');
  await row.getByRole('button', { name: `Ações de ${target.name}` }).click();
  await actorPage.getByRole('menuitem', { name: 'Permissões individuais' }).click();
  const dialog = actorPage.getByRole('dialog', { name: `Permissões de ${target.name}` });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Gerenciar procedimentos', { exact: true }).selectOption(value);
  await expect(actorPage.getByText('Permissão atualizada', { exact: true }).last()).toBeVisible({
    timeout: 60_000,
  });
  const close = dialog.getByRole('button', { name: 'Fechar' });
  if ((await close.count()) === 1) await close.click();
}

test.describe.serial('DEV: matriz real de RBAC por usuário', () => {
  test.describe.configure({ retries: 0 });

  test.beforeAll(async () => {
    const [catalog] = await sql<{ plan_id: string; price_id: string }[]>`
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
    if (!catalog) throw new Error('Plano Pro mensal vigente ausente em DEV.');

    const [clinic] = await sql<{ id: string }[]>`
      insert into clinics (slug, nome, status)
      values (${slug}, ${`E2E RBAC ${runId}`}, 'active')
      returning id::text
    `;
    if (!clinic) throw new Error('Clínica RBAC não foi criada.');
    clinicId = clinic.id;
    await sql`
      insert into subscriptions
        (clinic_id, plan_id, price_id, billing_status, started_at,
         current_period_start, current_period_end)
      values
        (${clinicId}::uuid, ${catalog.plan_id}::uuid, ${catalog.price_id}::uuid,
         'active', now(), now(), now() + interval '1 month')
    `;
    await sql`insert into ai_clinic_config (clinic_id) values (${clinicId}::uuid)`;

    for (const role of TENANT_ROLES) {
      const email = `e2e-rbac-${runId}-${role}@example.invalid`;
      const name = `E2E RBAC ${role} ${runId.slice(0, 8)}`;
      const userId = await adminCreateUser(email);
      createdAuthIds.push(userId);
      await sql`
        insert into profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
        values (${userId}::uuid, ${clinicId}::uuid, ${name}, ${role}::role_enum, true, now())
      `;
      users.set(role, { id: userId, email, name, role });
    }
  });

  test.afterAll(async () => {
    const cleanupErrors: string[] = [];
    if (clinicId) {
      try {
        await sql`delete from clinics where id = ${clinicId}::uuid`;
      } catch (error) {
        cleanupErrors.push(error instanceof Error ? error.message : 'falha ao remover clínica');
      }
    }
    for (const id of createdAuthIds) {
      const error = await adminDeleteUser(id);
      if (error) cleanupErrors.push(error);
    }
    const [remaining] = await sql<{ clinics: number; profiles: number }[]>`
      select
        (select count(*)::int from clinics where slug = ${slug}) clinics,
        (select count(*)::int from profiles where id::text = any(${createdAuthIds}::text[])) profiles
    `;
    await sql.end();
    expect(remaining).toEqual({ clinics: 0, profiles: 0 });
    expect(cleanupErrors).toEqual([]);
  });

  test('os cinco usuários recebem exatamente o bundle atual de sua role', async () => {
    const rows = await sql<{ user_id: string; role: TenantRole; permissions: string[] }[]>`
      select ep.user_id::text, ep.role::text, ep.permissions
        from effective_permissions_v ep
       where ep.clinic_id = ${clinicId}::uuid
       order by ep.role
    `;
    expect(rows).toHaveLength(TENANT_ROLES.length);
    for (const row of rows) {
      const bundle = await sql<{ permission_code: string }[]>`
        select permission_code from role_permissions
         where role = ${row.role}::role_enum
         order by permission_code
      `;
      expect([...row.permissions].sort()).toEqual(
        bundle.map(({ permission_code }) => permission_code),
      );
      expect(users.get(row.role)?.id).toBe(row.user_id);
    }
    expect(ALL_PERMISSIONS).toContain('refund:financial');
  });

  test('UI aplica o mesmo gate nas quinze áreas para cada role', async ({ browser }) => {
    // Uma execução local fria compila cada domínio sob demanda. O teto cobre
    // esse custo sem reduzir a matriz; em Preview as mesmas navegações são bem
    // mais rápidas.
    test.setTimeout(1_800_000);
    for (const [roleIndex, role] of TENANT_ROLES.entries()) {
      const user = users.get(role);
      if (!user) throw new Error(`Fixture ${role} ausente.`);
      const context = await browser.newContext({
        baseURL: baseUrl,
        // Rede reservada para benchmarks (RFC 2544). Cada usuário atravessa o
        // limitador real, mas não consome o mesmo bucket local dos demais.
        extraHTTPHeaders: { 'x-forwarded-for': `198.18.0.${roleIndex + 10}` },
      });
      const page = await context.newPage();
      try {
        await signIn(page, user);
        const effective = await effectivePermissions(user.id);
        for (const entry of routeMatrix) {
          const response = await page.goto(entry.path, {
            timeout: 180_000,
            waitUntil: 'domcontentloaded',
          });
          expect(response?.status(), `${role} ${entry.path}`).toBeLessThan(500);
          expect(
            new URL(page.url()).pathname,
            `${role} não pode ser redirecionado ao autenticar ${entry.path}`,
          ).toBe(entry.path);
          const denied = page.getByText('Sem acesso', { exact: true });
          if (effective.permissions.includes(entry.permission)) {
            await expect(denied, `${role} deveria acessar ${entry.path}`).toHaveCount(0);
          } else {
            await expect(denied, `${role} não deveria acessar ${entry.path}`).toBeVisible();
          }
        }
      } finally {
        await context.close();
      }
    }
  });

  test('owner concede e remove permissão; sessão antiga é revogada nas duas transições', async ({
    browser,
  }) => {
    test.setTimeout(900_000);
    const owner = users.get('owner');
    const attendant = users.get('attendant');
    if (!owner || !attendant) throw new Error('Fixtures owner/attendant ausentes.');

    const ownerContext = await browser.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: { 'x-forwarded-for': '198.18.1.10' },
    });
    const targetContext = await browser.newContext({
      baseURL: baseUrl,
      extraHTTPHeaders: { 'x-forwarded-for': '198.18.1.11' },
    });
    const ownerPage = await ownerContext.newPage();
    const targetPage = await targetContext.newPage();
    try {
      await signIn(ownerPage, owner);
      await signIn(targetPage, attendant);
      const initial = await effectivePermissions(attendant.id);
      expect(initial.override).toBeNull();
      expect(initial.permissions).not.toContain('manage:procedures');
      await targetPage.goto('/configuracoes/procedimentos', { timeout: 180_000 });
      await expect(targetPage.getByText('Sem acesso', { exact: true })).toBeVisible();

      await changeProcedureOverride(ownerPage, attendant, 'grant');
      await expect.poll(() => effectivePermissions(attendant.id)).toMatchObject({ override: true });
      const granted = await effectivePermissions(attendant.id);
      expect(granted.claimsVersion).toBeGreaterThan(initial.claimsVersion);
      expect(granted.permissions).toContain('manage:procedures');

      await targetPage.goto('/configuracoes/procedimentos', { timeout: 180_000 });
      await expect(targetPage).toHaveURL(/\/login(?:\?|$)/u);
      await signIn(targetPage, attendant);
      await targetPage.goto('/configuracoes/procedimentos', { timeout: 180_000 });
      await expect(
        targetPage
          .locator('button:visible')
          .filter({ hasText: /^Novo procedimento$/u })
          .first(),
      ).toBeVisible();

      await changeProcedureOverride(ownerPage, attendant, 'default');
      await expect.poll(() => effectivePermissions(attendant.id)).toMatchObject({ override: null });
      const restored = await effectivePermissions(attendant.id);
      expect(restored.claimsVersion).toBeGreaterThan(granted.claimsVersion);
      expect(restored.permissions).not.toContain('manage:procedures');

      await targetPage.goto('/configuracoes/procedimentos', { timeout: 180_000 });
      await expect(targetPage).toHaveURL(/\/login(?:\?|$)/u);
      await signIn(targetPage, attendant);
      await targetPage.goto('/configuracoes/procedimentos');
      await expect(targetPage.getByText('Sem acesso', { exact: true })).toBeVisible();
    } finally {
      await Promise.all([ownerContext.close(), targetContext.close()]);
    }
  });
});
