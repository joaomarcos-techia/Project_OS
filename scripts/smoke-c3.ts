/**
 * Smoke C3 — bateria de validação pós-migration 0003/0004.
 * Roda via tsx contra qoro-dev (DATABASE_URL do .env.local).
 * NUNCA usar contra prod — script é dev/CI only.
 */
// Smoke usa dbAdmin (pool single já criado em @/lib/db/index.ts).
// scripts/_env é carregado primeiro para garantir .env.local antes do import.
import './_env';

import { sql as sqlTag } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

// Wrap dbAdmin.execute para devolver array de rows compat com a API antiga.
const sql = async (query: string): Promise<unknown[]> => {
  const result = await dbAdmin.execute(sqlTag.raw(query));
  return Array.isArray(result)
    ? (result as unknown[])
    : ((result as { rows?: unknown[] }).rows ?? []);
};
const sqlUnsafe = { unsafe: sql, end: async () => undefined };

const checks: Array<{ name: string; query: string; expect?: (r: unknown) => boolean }> = [
  {
    name: 'tables exist (5)',
    query: `SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename IN ('profiles','permissions','role_permissions','user_permission_overrides','login_attempts')`,
    expect: (r) => (r as { n: number }[])[0]?.n === 5,
  },
  {
    name: 'profiles RLS ENABLE+FORCE',
    query: `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='profiles'`,
    expect: (r) =>
      (r as { relrowsecurity: boolean; relforcerowsecurity: boolean }[])[0]?.relrowsecurity ===
        true &&
      (r as { relrowsecurity: boolean; relforcerowsecurity: boolean }[])[0]?.relforcerowsecurity ===
        true,
  },
  {
    name: 'profiles has 3 policies',
    query: `SELECT count(*)::int AS n FROM pg_policies WHERE tablename='profiles'`,
    expect: (r) => (r as { n: number }[])[0]?.n === 3,
  },
  {
    name: 'user_permission_overrides policy is defaultTenantPolicy',
    query: `SELECT polname FROM pg_policy WHERE polrelid='public.user_permission_overrides'::regclass`,
    expect: (r) =>
      (r as { polname: string }[]).some(
        (x) => x.polname === 'user_permission_overrides_tenant_access',
      ),
  },
  {
    name: 'profiles.id FK -> auth.users',
    query: `SELECT conname FROM pg_constraint WHERE conname='profiles_id_auth_users_id_fk'`,
    expect: (r) => (r as { conname: string }[]).length === 1,
  },
  {
    name: 'login_attempts.ip is inet',
    query: `SELECT format_type(atttypid, atttypmod) AS t FROM pg_attribute WHERE attrelid='public.login_attempts'::regclass AND attname='ip'`,
    expect: (r) => (r as { t: string }[])[0]?.t === 'inet',
  },
  {
    name: 'all SECURITY DEFINER functions are SET search_path',
    query: `SELECT proname, COALESCE(array_to_string(proconfig, ','), '') AS cfg FROM pg_proc WHERE proname IN ('custom_access_token_hook','auth_hook_selftest','record_login_attempt') ORDER BY proname`,
    expect: (r) =>
      (r as { proname: string; cfg: string }[]).every((x) =>
        x.cfg.includes('search_path=public, pg_temp'),
      ),
  },
  {
    name: 'custom_access_token_hook is VOLATILE',
    query: `SELECT provolatile FROM pg_proc WHERE proname='custom_access_token_hook'`,
    expect: (r) => (r as { provolatile: string }[])[0]?.provolatile === 'v',
  },
  {
    name: 'effective_permissions_v view exists',
    query: `SELECT count(*)::int AS n FROM information_schema.views WHERE table_schema='public' AND table_name='effective_permissions_v'`,
    expect: (r) => (r as { n: number }[])[0]?.n === 1,
  },
  {
    // F-07: +export:patient → 21 permissions (migration 0013).
    name: 'permissions seed has 21 codes (20 canônicas + export:patient F-07)',
    query: `SELECT count(*)::int AS n FROM permissions`,
    expect: (r) => (r as { n: number }[])[0]?.n === 21,
  },
  {
    // F-07: owner 20→21, gestor 20→21 (export:patient nos bundles).
    name: 'role_permissions seed total = 66 (21 owner + 21 gestor + 11 doctor + 7 attendant + 6 financial)',
    query: `SELECT count(*)::int AS n FROM role_permissions`,
    expect: (r) => (r as { n: number }[])[0]?.n === 66,
  },
  {
    // F-07 cardinalidade: sem duplicatas (PK composta + ON CONFLICT DO NOTHING).
    name: 'role_permissions sem duplicatas (COUNT = COUNT DISTINCT)',
    query: `SELECT count(*)::int AS total, count(DISTINCT (role, permission_code))::int AS distinct_n FROM role_permissions`,
    expect: (r) => {
      const row = (r as { total: number; distinct_n: number }[])[0];
      return !!row && row.total === row.distinct_n;
    },
  },
  {
    name: 'role bundles per role correct',
    query: `SELECT role::text, count(*)::int AS n FROM role_permissions GROUP BY 1 ORDER BY 1`,
    expect: (r) => {
      const map = Object.fromEntries(
        (r as { role: string; n: number }[]).map((x) => [x.role, x.n]),
      );
      return (
        map.owner === 21 &&
        map.gestor === 21 &&
        map.doctor === 11 &&
        map.attendant === 7 &&
        map.financial === 6 &&
        map.super_admin === undefined
      );
    },
  },
  {
    name: 'auth_hook_selftest returns ok=true',
    query: `SELECT public.auth_hook_selftest() AS r`,
    expect: (r) => {
      const out = (r as { r: { ok: boolean; claims_keys: string[] } }[])[0]?.r;
      return out?.ok === true && Array.isArray(out.claims_keys);
    },
  },
  {
    name: '_schema_version has c3-identity-core',
    query: `SELECT count(*)::int AS n FROM _schema_version WHERE version='c3-identity-core'`,
    expect: (r) => (r as { n: number }[])[0]?.n === 1,
  },
  {
    name: '_schema_version has c3-identity-hardening',
    query: `SELECT count(*)::int AS n FROM _schema_version WHERE version='c3-identity-hardening'`,
    expect: (r) => (r as { n: number }[])[0]?.n === 1,
  },
];

let failed = 0;
for (const c of checks) {
  try {
    const result = await sqlUnsafe.unsafe(c.query);
    const ok = c.expect ? c.expect(result) : true;
    if (ok) {
      console.log(`[OK]   ${c.name}`);
    } else {
      failed++;
      console.log(`[FAIL] ${c.name}\n       result: ${JSON.stringify(result)}`);
    }
  } catch (e) {
    failed++;
    console.log(`[FAIL] ${c.name}\n       error: ${(e as Error).message}`);
  }
}

await sqlUnsafe.end();
console.log(`\n${failed === 0 ? '✅ all checks passed' : `❌ ${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
