import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServerClient as createSsrClient } from '@supabase/ssr';
import { config as loadDotenv } from 'dotenv';
import postgres from 'postgres';

import { ALL_PERMISSIONS, type Permission } from '@/lib/auth/permissions';

loadDotenv({ path: '.env.local' });

const authorized = process.env.E2E_PRODUCTION_ALL_PERMISSIONS === 'ALLOW_TEST_ACCOUNT';
const baseUrl = process.env.E2E_BASE_URL;
const ownerEmail = process.env.E2E_PERMISSION_OWNER_EMAIL;
const targetEmail = process.env.E2E_PERMISSION_TARGET_EMAIL;
const sharedPassword = process.env.E2E_PERMISSION_PASSWORD;

type Identity = {
  userId: string;
  clinicId: string;
  name: string;
  role: string;
};

type PermissionState = {
  claimsVersion: number;
  permissions: string[];
  override: boolean | null;
};

test.use({
  storageState: { cookies: [], origins: [] },
  actionTimeout: 30_000,
  navigationTimeout: 60_000,
});

function productionSupabaseConfig(): { url: string; key: string } {
  const databaseUrl = process.env.DATABASE_URL_PROD;
  const adminSecret = process.env.SUPABASE_SECRET_KEY_PROD;
  if (!databaseUrl || !adminSecret) throw new Error('Credenciais operacionais PROD ausentes.');
  const projectRef = decodeURIComponent(new URL(databaseUrl).username).split('.').at(-1);
  if (!projectRef || !/^[a-z]{20}$/u.test(projectRef)) {
    throw new Error('Project ref de produção inválido.');
  }
  return { url: `https://${projectRef}.supabase.co`, key: adminSecret };
}

async function signInContext(
  context: BrowserContext,
  email: string,
  password: string,
): Promise<Page> {
  if (!baseUrl) throw new Error('E2E_BASE_URL ausente.');
  let nextCookies: Array<{ name: string; value: string }> = [];
  const { url, key } = productionSupabaseConfig();
  const client = createSsrClient(url, key, {
    cookies: {
      getAll: () => [],
      setAll: (items) => {
        nextCookies = items.map(({ name, value }) => ({ name, value }));
      },
    },
    auth: { autoRefreshToken: false, persistSession: true },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session || nextCookies.length === 0) {
    throw new Error(error?.message ?? 'Login não produziu sessão.');
  }
  await context.addCookies(
    nextCookies
      .filter(({ value }) => value !== '')
      .map(({ name, value }) => ({ name, value, url: baseUrl })),
  );
  const page = await context.newPage();
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard(?:\?|$)/u, { timeout: 30_000 });
  return page;
}

test.describe('produção: lifecycle de todos os overrides', () => {
  test.describe.configure({ retries: 0 });

  test('nega, concede e restaura as 28 permissões canônicas', async ({ browser }) => {
    test.setTimeout(720_000);
    test.skip(
      !authorized,
      'Exige E2E_PRODUCTION_ALL_PERMISSIONS=ALLOW_TEST_ACCOUNT para alterar o atendente de teste.',
    );
    if (!baseUrl || new URL(baseUrl).hostname !== 'app.qoro.dev') {
      throw new Error('O lifecycle só pode apontar para app.qoro.dev.');
    }
    if (!ownerEmail || !targetEmail || !sharedPassword || ownerEmail === targetEmail) {
      throw new Error('Credenciais owner/target distintas são obrigatórias.');
    }
    const databaseUrl = process.env.DATABASE_URL_PROD;
    if (!databaseUrl) throw new Error('DATABASE_URL_PROD ausente.');

    const sql = postgres(databaseUrl, { max: 1, ssl: 'require', prepare: false });
    const context = await browser.newContext({ baseURL: baseUrl });
    let target: Identity | undefined;
    let ownsLifecycle = false;

    const state = async (permission: Permission): Promise<PermissionState> => {
      const currentTarget = target;
      if (!currentTarget) throw new Error('Target não carregado.');
      return sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const [effective] = await tx<{ claims_version: number; permissions: string[] }[]>`
          select claims_version, permissions
            from effective_permissions_v
           where user_id = ${currentTarget.userId}::uuid
        `;
        const overrides = await tx<{ granted: boolean }[]>`
          select granted
            from user_permission_overrides
           where user_id = ${currentTarget.userId}::uuid
             and permission_code = ${permission}
        `;
        if (!effective || overrides.length > 1) throw new Error('Estado de permissão inválido.');
        return {
          claimsVersion: effective.claims_version,
          permissions: effective.permissions,
          override: overrides[0]?.granted ?? null,
        };
      });
    };

    try {
      const identities = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        const rows = await tx<
          { email: string; user_id: string; clinic_id: string; name: string; role: string }[]
        >`
          select lower(u.email) as email, p.id::text as user_id,
                 p.clinic_id::text as clinic_id, p.nome as name, p.role::text as role
            from auth.users u
            join profiles p on p.id = u.id
           where lower(u.email) in (${ownerEmail.toLowerCase()}, ${targetEmail.toLowerCase()})
             and p.ativo = true
             and p.deleted_at is null
        `;
        const owner = rows.find((row) => row.email === ownerEmail.toLowerCase());
        const selectedTarget = rows.find((row) => row.email === targetEmail.toLowerCase());
        if (!owner || !selectedTarget || owner.clinic_id !== selectedTarget.clinic_id) {
          throw new Error('Owner e target não pertencem ao mesmo tenant de teste.');
        }
        if (owner.role !== 'owner' || selectedTarget.role !== 'attendant') {
          throw new Error('Roles divergentes do cenário owner→attendant.');
        }
        return { target: selectedTarget };
      });
      target = {
        userId: identities.target.user_id,
        clinicId: identities.target.clinic_id,
        name: identities.target.name,
        role: identities.target.role,
      };

      const initialOverrides = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ permission_code: string }[]>`
          select permission_code
            from user_permission_overrides
           where user_id = ${target!.userId}::uuid
        `;
      });
      if (initialOverrides.length !== 0) {
        throw new Error(
          'Overrides preexistentes: cenário recusado para preservar o estado inicial.',
        );
      }
      ownsLifecycle = true;

      const initialStates = new Map<Permission, PermissionState>();
      for (const permission of ALL_PERMISSIONS)
        initialStates.set(permission, await state(permission));
      const initialVersion = initialStates.get(ALL_PERMISSIONS[0]!)?.claimsVersion ?? -1;

      const ownerPage = await signInContext(context, ownerEmail, sharedPassword);
      await ownerPage.goto('/equipe');
      const row = ownerPage
        .getByText(target.name, { exact: true })
        .locator('xpath=ancestor::tr[1]');
      await row.getByRole('button', { name: `Ações de ${target.name}` }).click();
      await ownerPage.getByRole('menuitem', { name: 'Permissões individuais' }).click();
      const dialog = ownerPage.getByRole('dialog', { name: `Permissões de ${target.name}` });
      await expect(dialog).toBeVisible();
      const selects = dialog.locator('select[id*="permission-"]');
      await expect(selects).toHaveCount(ALL_PERMISSIONS.length);

      let transitions = 0;
      for (const [index, permission] of ALL_PERMISSIONS.entries()) {
        const baseline = initialStates.get(permission);
        if (!baseline) throw new Error(`Baseline ausente para ${permission}.`);
        const sequence: Array<{
          option: 'deny' | 'grant' | 'default';
          override: boolean | null;
          effective: boolean;
        }> = baseline.permissions.includes(permission)
          ? [
              { option: 'deny', override: false, effective: false },
              { option: 'grant', override: true, effective: true },
              { option: 'default', override: null, effective: true },
            ]
          : [
              { option: 'grant', override: true, effective: true },
              { option: 'deny', override: false, effective: false },
              { option: 'default', override: null, effective: false },
            ];

        for (const expected of sequence) {
          const before = await state(permission);
          const select = selects.nth(index);
          await expect(select).toBeEnabled();
          await select.selectOption(expected.option);
          await expect
            .poll(async () => state(permission), { timeout: 30_000 })
            .toMatchObject({ override: expected.override });
          const after = await state(permission);
          expect(after.claimsVersion).toBeGreaterThan(before.claimsVersion);
          expect(after.permissions.includes(permission)).toBe(expected.effective);
          await expect(selects.nth(index)).toHaveValue(expected.option);
          transitions += 1;
        }
      }

      const finalRows = await sql.begin(async (tx) => {
        await tx.unsafe('RESET ROLE');
        return tx<{ claims_version: number; permissions: string[]; overrides: number }[]>`
          select ep.claims_version,
                 ep.permissions,
                 (select count(*)::int from user_permission_overrides o
                   where o.user_id = ep.user_id) as overrides
            from effective_permissions_v ep
           where ep.user_id = ${identities.target.user_id}::uuid
        `;
      });
      const finalState = finalRows[0];
      if (!finalState) throw new Error('Estado final ausente.');
      expect(finalState.overrides).toBe(0);
      expect(finalState.permissions.slice().sort()).toEqual(
        initialStates.get(ALL_PERMISSIONS[0]!)!.permissions.slice().sort(),
      );
      expect(finalState.claims_version).toBeGreaterThanOrEqual(
        initialVersion + ALL_PERMISSIONS.length * 3,
      );

      console.log(
        `[all-permission-overrides] ${JSON.stringify({
          permissions: ALL_PERMISSIONS.length,
          transitions,
          deny: ALL_PERMISSIONS.length,
          grant: ALL_PERMISSIONS.length,
          restoreDefault: ALL_PERMISSIONS.length,
          finalOverrides: finalState.overrides,
          claimsVersionDelta: finalState.claims_version - initialVersion,
          result: 'persisted-and-restored',
        })}`,
      );
    } finally {
      if (target && ownsLifecycle) {
        const cleanup = await sql.begin(async (tx) => {
          await tx.unsafe('RESET ROLE');
          const removed = await tx<{ permission_code: string }[]>`
            delete from user_permission_overrides
             where user_id = ${target!.userId}::uuid
               and permission_code in ${sql([...ALL_PERMISSIONS])}
            returning permission_code
          `;
          const [remaining] = await tx<{ n: number }[]>`
            select count(*)::int as n
              from user_permission_overrides
             where user_id = ${target!.userId}::uuid
          `;
          return { removed: removed.length, remaining: remaining?.n ?? -1 };
        });
        expect(cleanup.remaining).toBe(0);
        console.log(`[all-permission-overrides] cleanup ${JSON.stringify(cleanup)}`);
      }
      await context.close();
      await sql.end();
    }
  });
});
