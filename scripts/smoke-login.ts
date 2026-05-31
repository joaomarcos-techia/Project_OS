/**
 * `pnpm tsx scripts/smoke-login.ts` (mapeado para `pnpm test:auth-e2e`)
 *
 * Smoke de login REAL end-to-end (D17). Valida 3 fases:
 *   1. Login flow: signInWithPassword → JWT contém claims customizadas
 *      (clinic_id, role, permissions, claims_version) populadas pelo Hook.
 *   2. Refresh flow: refreshSession → novo JWT mantém claims (Hook reexecuta).
 *   3. Revocation flow (D24 — OBRIGATÓRIO): captura refresh_token original →
 *      signOut({scope:'global'}) → tenta refresh com token capturado → DEVE
 *      falhar. Se passar, signOut é teatro.
 *
 * Pre-requisitos:
 *   - Migrations 0003 + 0004 aplicadas.
 *   - Custom Access Token Hook ATIVADO no Supabase Dashboard
 *     (Auth → Hooks → Custom Access Token → public.custom_access_token_hook).
 *   - SMOKE_USER_EMAIL + SMOKE_USER_PASSWORD env (cria user dedicado para smoke).
 *
 * Idempotente: cria/garante a clinic + profile do smoke user antes do teste.
 * NUNCA usa o super_admin do founder para isso.
 *
 * Gate de PR — falha quebra CI.
 */
import './_env';

import { createClient } from '@supabase/supabase-js';
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';

const SMOKE_EMAIL = process.env.SMOKE_USER_EMAIL ?? 'smoke@clinicaos.dev';
const SMOKE_PASSWORD = process.env.SMOKE_USER_PASSWORD ?? 'smoke-passwd-min-12-chars';
const SMOKE_CLINIC_ID = '99999999-9999-9999-9999-999999999999';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) {
  console.error('[smoke-login] NEXT_PUBLIC_SUPABASE_URL / publishable key ausentes. Abortando.');
  process.exit(1);
}

const admin = createAdminClient();

let failed = 0;
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    console.log(`[OK]   ${name}`);
  } else {
    failed++;
    console.log(`[FAIL] ${name}${detail !== undefined ? ` detail=${JSON.stringify(detail)}` : ''}`);
  }
}

// SETUP: garantir clinic + user + profile do smoke
await dbAdmin.execute(sql`
  INSERT INTO public.clinics (id, slug, nome, status)
  VALUES (${SMOKE_CLINIC_ID}::uuid, 'smoke-clinic', 'Smoke Clinic', 'trial')
  ON CONFLICT (id) DO NOTHING
`);

let smokeUserId: string;
const { data: listed, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw listErr;
const existing = listed.users.find((u) => u.email?.toLowerCase() === SMOKE_EMAIL.toLowerCase());
if (existing) {
  smokeUserId = existing.id;
  // garante senha conhecida
  await admin.auth.admin.updateUserById(smokeUserId, { password: SMOKE_PASSWORD });
} else {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: SMOKE_EMAIL,
    password: SMOKE_PASSWORD,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error('createUser falhou');
  smokeUserId = created.user.id;
}

await dbAdmin.execute(sql`
  INSERT INTO public.profiles (id, clinic_id, nome, role, ativo)
  VALUES (${smokeUserId}::uuid, ${SMOKE_CLINIC_ID}::uuid, 'Smoke User', 'gestor', true)
  ON CONFLICT (id) DO UPDATE SET
    clinic_id = EXCLUDED.clinic_id,
    role      = 'gestor',
    ativo     = true,
    deleted_at = NULL
`);

console.log(`[smoke-login] setup OK (user=${smokeUserId}, clinic=${SMOKE_CLINIC_ID})`);

// FASE 1: login flow
const client1 = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data: signIn, error: signInErr } = await client1.auth.signInWithPassword({
  email: SMOKE_EMAIL,
  password: SMOKE_PASSWORD,
});
if (signInErr || !signIn.session) {
  console.error(`[smoke-login] signIn falhou: ${signInErr?.message ?? '(no session)'}`);
  process.exit(1);
}
const originalRefreshToken = signIn.session.refresh_token;
const claims1 = decodeJwtClaims(signIn.session.access_token);
check(
  '1.1) signInWithPassword retorna session',
  !!signIn.session.access_token,
);
check(
  '1.2) JWT contém claims customizadas (clinic_id, app_role, permissions, claims_version)',
  !!claims1 &&
    claims1.clinic_id === SMOKE_CLINIC_ID &&
    claims1.app_role === 'gestor' &&
    Array.isArray(claims1.permissions) &&
    // F-07: gestor bundle agora tem 21 permissions (export:patient adicionada).
    claims1.permissions.length === 21 &&
    typeof claims1.claims_version === 'number',
  claims1,
);

// FASE 2: refresh flow
const { data: refreshed, error: refreshErr } = await client1.auth.refreshSession({
  refresh_token: originalRefreshToken,
});
if (refreshErr || !refreshed.session) {
  console.error(`[smoke-login] refreshSession falhou: ${refreshErr?.message}`);
  process.exit(1);
}
const newRefreshToken = refreshed.session.refresh_token;
const claims2 = decodeJwtClaims(refreshed.session.access_token);
check(
  '2.1) refreshSession retorna novo access_token',
  refreshed.session.access_token !== signIn.session.access_token,
);
check(
  '2.2) JWT novo MANTÉM claims customizadas (Hook reexecutou)',
  !!claims2 &&
    claims2.clinic_id === SMOKE_CLINIC_ID &&
    claims2.app_role === 'gestor' &&
    Array.isArray(claims2.permissions) &&
    claims2.permissions.length === 21,
  claims2,
);

// FASE 3: revocation REAL (D24)
// Usamos um client NOVO setando manualmente a session capturada — emula
// dispositivo atacante com token roubado tentando refresh após signOut do
// device legítimo.
const client2 = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
await client2.auth.setSession({
  access_token: refreshed.session.access_token,
  refresh_token: newRefreshToken,
});

// signOut global do client1 (device legítimo) — DEVE revogar TODOS os refresh tokens.
const { error: signOutErr } = await client1.auth.signOut({ scope: 'global' });
if (signOutErr) {
  console.error(`[smoke-login] signOut global falhou: ${signOutErr.message}`);
  process.exit(1);
}

// Aguardar 500ms para Supabase propagar revocation (latência interna).
await new Promise((resolve) => setTimeout(resolve, 500));

// Atacante tenta refresh com token capturado — DEVE falhar.
const { data: hackRefresh, error: hackErr } = await client2.auth.refreshSession({
  refresh_token: newRefreshToken,
});
check(
  '3) signOut global REVOGA refresh_token (atacante com token capturado NÃO consegue refresh)',
  !!hackErr || !hackRefresh.session,
  { error: hackErr?.message, session: hackRefresh?.session ? 'present' : 'absent' },
);

// CLEANUP: remove smoke user + profile + clinic
await dbAdmin.execute(sql`DELETE FROM public.profiles WHERE id = ${smokeUserId}::uuid`);
await admin.auth.admin.deleteUser(smokeUserId);
await dbAdmin.execute(sql`DELETE FROM public.clinics WHERE id = ${SMOKE_CLINIC_ID}::uuid`);

console.log(`\n${failed === 0 ? '✅ smoke-login: all phases passed' : `❌ smoke-login: ${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);

function decodeJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const norm = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm + '=='.slice(0, (4 - (norm.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}
