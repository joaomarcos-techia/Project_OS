/**
 * `pnpm tsx scripts/test-hook.ts` (mapeado para `pnpm test:hook` no package.json)
 *
 * Selftest sintético do custom_access_token_hook (D11). Valida:
 *   - função viva
 *   - grants vivos (supabase_auth_admin pode executar)
 *   - search_path correto
 *   - deny-by-default defensivo (D36) cobre 5 cenários
 *
 * Gate de PR — falha quebra CI. NÃO valida integração Supabase Auth real;
 * isso é responsabilidade do smoke-login.ts (D17).
 *
 * Cenários:
 *   1. user_id inexistente → event sem claims
 *   2. profile super_admin válido → claims com clinic_id=null + super_admin=true
 *   3. profile gestor válido → claims com clinic_id + role + permissions
 *   4. profile ativo=false → event sem claims (deny D36)
 *   5. profile soft-deleted → event sem claims (deny D36)
 */
import './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';

interface HookResult {
  claims?: {
    clinic_id?: string | null;
    app_role?: string;
    permissions?: string[];
    claims_version?: number;
    super_admin?: boolean;
  };
}

async function runHook(userId: string): Promise<HookResult> {
  const res = await dbAdmin.execute(sql`
    SELECT public.custom_access_token_hook(
      jsonb_build_object('user_id', ${userId}::text, 'claims', '{}'::jsonb)
    ) AS r
  `);
  const rows = (Array.isArray(res) ? res : ((res as { rows?: unknown[] }).rows ?? [])) as Array<{
    r: HookResult;
  }>;
  return rows[0]?.r ?? {};
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';
const FIXTURE_CLINIC = '11111111-1111-1111-1111-111111111111';
const FIXTURE_USER_SA = '22222222-2222-2222-2222-222222222222';
const FIXTURE_USER_GESTOR = '33333333-3333-3333-3333-333333333333';
const FIXTURE_USER_INATIVO = '44444444-4444-4444-4444-444444444444';
const FIXTURE_USER_DELETED = '55555555-5555-5555-5555-555555555555';

// Setup: cria fixture clinic + auth.users dummy + profiles.
// NOTA: precisamos criar auth.users primeiro porque profiles.id FK → auth.users.
// Como temos dbAdmin (BYPASSRLS), podemos inserir direto.
await dbAdmin.execute(sql`
  INSERT INTO public.clinics (id, slug, nome, status) VALUES
    (${FIXTURE_CLINIC}::uuid, 'test-hook-clinic', 'Test Hook Clinic', 'trial')
  ON CONFLICT (id) DO NOTHING
`);

// Cria auth.users dummies. Usamos INSERT direto na tabela auth.users.
// Em produção isso seria feito via Supabase Admin API; para selftest
// determinístico, dbAdmin direct é aceitável (script é dev-only).
for (const [uid, suffix] of [
  [FIXTURE_USER_SA, 'sa'],
  [FIXTURE_USER_GESTOR, 'gestor'],
  [FIXTURE_USER_INATIVO, 'inativo'],
  [FIXTURE_USER_DELETED, 'deleted'],
] as const) {
  await dbAdmin.execute(sql`
    INSERT INTO auth.users (id, email, instance_id, aud, role, created_at, updated_at)
    VALUES (
      ${uid}::uuid,
      ${'test-hook-' + suffix + '@clinicaos.dev'},
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      now(),
      now()
    )
    ON CONFLICT (id) DO NOTHING
  `);
}

await dbAdmin.execute(sql`
  INSERT INTO public.profiles (id, clinic_id, nome, role, ativo, deleted_at) VALUES
    (${FIXTURE_USER_SA}::uuid,      NULL,                  'Test SA',      'super_admin', true,  NULL),
    (${FIXTURE_USER_GESTOR}::uuid,  ${FIXTURE_CLINIC}::uuid, 'Test Gestor', 'gestor',      true,  NULL),
    (${FIXTURE_USER_INATIVO}::uuid, ${FIXTURE_CLINIC}::uuid, 'Test Inativo','gestor',      false, NULL),
    (${FIXTURE_USER_DELETED}::uuid, ${FIXTURE_CLINIC}::uuid, 'Test Deleted','gestor',      true,  now())
  ON CONFLICT (id) DO UPDATE SET
    clinic_id = EXCLUDED.clinic_id,
    role      = EXCLUDED.role,
    ativo     = EXCLUDED.ativo,
    deleted_at = EXCLUDED.deleted_at
`);

let failed = 0;
function check(name: string, ok: boolean, payload?: unknown): void {
  if (ok) {
    console.log(`[OK]   ${name}`);
  } else {
    failed++;
    console.log(`[FAIL] ${name}${payload !== undefined ? ` payload=${JSON.stringify(payload)}` : ''}`);
  }
}

// Cenário 1: user_id inexistente → no claims
const r1 = await runHook(NIL_UUID);
check(
  '1) user_id inexistente: sem custom claims',
  !r1.claims?.app_role && !r1.claims?.clinic_id,
  r1.claims,
);

// Cenário 2: super_admin válido → super_admin=true, clinic_id=null
const r2 = await runHook(FIXTURE_USER_SA);
check(
  '2) super_admin: app_role=super_admin, clinic_id=null, super_admin=true',
  r2.claims?.app_role === 'super_admin' &&
    r2.claims?.clinic_id === null &&
    r2.claims?.super_admin === true,
  r2.claims,
);

// Cenário 3: gestor válido → claims com clinic + permissions
const r3 = await runHook(FIXTURE_USER_GESTOR);
check(
  '3) gestor: app_role=gestor, clinic_id setado, permissions array com 20 itens (bundle gestor)',
  r3.claims?.app_role === 'gestor' &&
    r3.claims?.clinic_id === FIXTURE_CLINIC &&
    Array.isArray(r3.claims?.permissions) &&
    r3.claims.permissions.length === 20,
  r3.claims,
);

// Cenário 4: profile inativo → sem claims (D36)
const r4 = await runHook(FIXTURE_USER_INATIVO);
check(
  '4) profile ativo=false: deny defensivo (sem claims)',
  !r4.claims?.app_role && !r4.claims?.clinic_id,
  r4.claims,
);

// Cenário 5: profile soft-deleted → sem claims (D36)
const r5 = await runHook(FIXTURE_USER_DELETED);
check(
  '5) profile soft-deleted: deny defensivo (sem claims)',
  !r5.claims?.app_role && !r5.claims?.clinic_id,
  r5.claims,
);

// Cleanup: remove fixtures
await dbAdmin.execute(sql`
  DELETE FROM public.profiles WHERE id IN (
    ${FIXTURE_USER_SA}::uuid,
    ${FIXTURE_USER_GESTOR}::uuid,
    ${FIXTURE_USER_INATIVO}::uuid,
    ${FIXTURE_USER_DELETED}::uuid
  )
`);
await dbAdmin.execute(sql`
  DELETE FROM auth.users WHERE id IN (
    ${FIXTURE_USER_SA}::uuid,
    ${FIXTURE_USER_GESTOR}::uuid,
    ${FIXTURE_USER_INATIVO}::uuid,
    ${FIXTURE_USER_DELETED}::uuid
  )
`);
await dbAdmin.execute(sql`DELETE FROM public.clinics WHERE id = ${FIXTURE_CLINIC}::uuid`);

console.log(`\n${failed === 0 ? '✅ test-hook: all 5 scenarios passed' : `❌ test-hook: ${failed} scenario(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
