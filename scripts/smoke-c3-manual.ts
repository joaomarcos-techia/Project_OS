/**
 * `pnpm tsx scripts/smoke-c3-manual.ts`
 *
 * Smoke automatizado dos testes 3.6.x que originalmente eram manuais.
 * Cria fixtures (2 clínicas + 2 gestores + 1 doctor), faz login real via
 * Supabase Auth, e exercita RLS / WITH CHECK / claims drift / permissions /
 * rate limit por código (não pela UI).
 *
 * Cobre:
 *   3.6.2  RLS via JWT respeita tenant
 *   3.6.3  cross-tenant read manipulation
 *   3.6.4  claims drift detection (claims_version bump)
 *   3.6.5  requireCachedPermission via permissions[] no JWT
 *   3.6.6  rate limit DUAL (IP + email_hash)
 *  3.6.10  WITH CHECK cross-tenant insert
 *
 * Cleanup automático no fim (delete profiles + auth.users + clinics fixture).
 * Idempotente — re-rodável sem efeito colateral.
 *
 * NÃO cobre (validados em outras vias):
 *   3.6.1 / 3.6.7 / 3.6.8 → validados manualmente na UI
 *   3.6.9 → coberto por pnpm test:auth-e2e
 */
import './_env';

import { createHmac } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';
import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';

// Reimplementação local de hashEmail / assertLoginAllowed para evitar
// importar src/lib/auth/email-hash e rate-limit que marcam server-only
// (lançam quando carregados por tsx fora do bundle Next).
const PEPPER = process.env.LOGIN_HASH_PEPPER;
if (!PEPPER) {
  console.error('LOGIN_HASH_PEPPER ausente no env. Configure para rodar smoke.');
  process.exit(1);
}
function hashEmail(email: string): string {
  return createHmac('sha256', PEPPER!).update(email.trim().toLowerCase()).digest('hex');
}

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOK = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!REDIS_URL || !REDIS_TOK) {
  console.error('UPSTASH_REDIS_REST_URL / TOKEN ausentes. Configure para rodar smoke.');
  process.exit(1);
}
const redis = new Redis({ url: REDIS_URL, token: REDIS_TOK });
const ipLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, '15 m'), prefix: 'rl:login:ip', analytics: false });
const emailLimiter = new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(5, '15 m'), prefix: 'rl:login:email', analytics: false });
async function assertLoginAllowed(ip: string, emailH: string): Promise<{ ok: boolean }> {
  const [ipR, emR] = await Promise.all([ipLimiter.limit(ip), emailLimiter.limit(emailH)]);
  return { ok: ipR.success && emR.success };
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const CLINIC_A = 'aaaaaaa1-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLINIC_B = 'bbbbbbb2-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GESTOR_A_EMAIL = 'smoke-gestor-a@clinicaos.dev';
const GESTOR_B_EMAIL = 'smoke-gestor-b@clinicaos.dev';
const DOCTOR_EMAIL = 'smoke-doctor@clinicaos.dev';
const PASSWORD = 'smoke-passwd-min-12-chars';

const admin = createAdminClient();
let failed = 0;
const log = (name: string, ok: boolean, detail?: unknown): void => {
  if (ok) console.log(`[OK]   ${name}`);
  else {
    failed++;
    console.log(`[FAIL] ${name}${detail !== undefined ? ` detail=${JSON.stringify(detail)}` : ''}`);
  }
};

// --- SETUP ----------------------------------------------------------
console.log('[setup] fixtures…');
await dbAdmin.execute(sql`
  INSERT INTO public.clinics (id, slug, nome, status) VALUES
    (${CLINIC_A}::uuid, 'smoke-clinic-a', 'Smoke Clinic A', 'active'),
    (${CLINIC_B}::uuid, 'smoke-clinic-b', 'Smoke Clinic B', 'active')
  ON CONFLICT (id) DO NOTHING
`);

async function ensureUser(email: string): Promise<string> {
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = list.users.find((u) => u.email?.toLowerCase() === email);
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });
    return existing.id;
  }
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !created.user) throw error ?? new Error('createUser falhou');
  return created.user.id;
}

const gestorA = await ensureUser(GESTOR_A_EMAIL);
const gestorB = await ensureUser(GESTOR_B_EMAIL);
const doctorId = await ensureUser(DOCTOR_EMAIL);

await dbAdmin.execute(sql`
  INSERT INTO public.profiles (id, clinic_id, nome, role, ativo) VALUES
    (${gestorA}::uuid, ${CLINIC_A}::uuid, 'Gestor A', 'gestor', true),
    (${gestorB}::uuid, ${CLINIC_B}::uuid, 'Gestor B', 'gestor', true),
    (${doctorId}::uuid, ${CLINIC_A}::uuid, 'Doctor A', 'doctor', true)
  ON CONFLICT (id) DO UPDATE SET
    clinic_id = EXCLUDED.clinic_id,
    role = EXCLUDED.role,
    ativo = true,
    deleted_at = NULL
`);

function authedClient() {
  return createClient(SUPA_URL, SUPA_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

async function signIn(email: string): Promise<{ accessToken: string; refreshToken: string; client: ReturnType<typeof authedClient> }> {
  const c = authedClient();
  const { data, error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error || !data.session) throw error ?? new Error('signIn falhou');
  return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token, client: c };
}

function decode(token: string): Record<string, unknown> {
  const parts = token.split('.');
  const norm = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  const padded = norm + '=='.slice(0, (4 - (norm.length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
}

// --- TESTES ---------------------------------------------------------

console.log('\n=== 3.6.2 RLS via JWT respeita tenant ===');
{
  const gA = await signIn(GESTOR_A_EMAIL);
  // PostgREST via REST API com JWT do gestor-a.
  const r = await fetch(`${SUPA_URL}/rest/v1/clinics?select=id,slug`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${gA.accessToken}` },
  });
  const rows = (await r.json()) as Array<{ id: string; slug: string }>;
  log(
    '3.6.2.a gestor-a vê só Clinic A',
    rows.length === 1 && rows[0]!.id === CLINIC_A,
    rows,
  );
}

console.log('\n=== 3.6.3 cross-tenant read manipulation ===');
{
  const gA = await signIn(GESTOR_A_EMAIL);
  // Tenta consultar Clinic B explicitamente por id.
  const r = await fetch(`${SUPA_URL}/rest/v1/clinics?id=eq.${CLINIC_B}&select=id`, {
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${gA.accessToken}` },
  });
  const rows = (await r.json()) as unknown[];
  log('3.6.3 gestor-a NÃO acessa Clinic B (RLS bloqueia)', rows.length === 0, rows);
}

console.log('\n=== 3.6.4 claims drift detection ===');
{
  // Login → JWT inicial com claims_version v1.
  const gA1 = await signIn(GESTOR_A_EMAIL);
  const claims1 = decode(gA1.accessToken);
  const v1 = (claims1 as { claims_version: number }).claims_version;

  // Mudar role via psql/dbAdmin (simula admin SQL direto).
  await dbAdmin.execute(sql`UPDATE public.profiles SET role = 'attendant' WHERE id = ${gestorA}::uuid`);

  // Refresh do session → Hook reexecuta → claims_version deve incrementar.
  const { data: refreshed, error: refErr } = await gA1.client.auth.refreshSession({
    refresh_token: gA1.refreshToken,
  });
  if (refErr || !refreshed.session) {
    log('3.6.4 refresh post-update', false, refErr?.message);
  } else {
    const claims2 = decode(refreshed.session.access_token);
    const v2 = (claims2 as { claims_version: number; app_role: string }).claims_version;
    const role2 = (claims2 as { app_role: string }).app_role;
    log(
      `3.6.4 claims_version incrementou (${v1} → ${v2}) e app_role atualizou (gestor → ${role2})`,
      v2 > v1 && role2 === 'attendant',
      { v1, v2, role2 },
    );
  }

  // Restaurar role para próximos testes.
  await dbAdmin.execute(sql`UPDATE public.profiles SET role = 'gestor' WHERE id = ${gestorA}::uuid`);
}

console.log('\n=== 3.6.5 requireCachedPermission via permissions[] no JWT ===');
{
  // gestor tem 'manage:financial' no bundle; doctor NÃO tem por default.
  const gA = await signIn(GESTOR_A_EMAIL);
  const claimsG = decode(gA.accessToken) as { permissions: string[] };
  log(
    '3.6.5.a gestor JWT contém manage:financial (via role_permissions bundle)',
    Array.isArray(claimsG.permissions) && claimsG.permissions.includes('manage:financial'),
    { count: claimsG.permissions?.length, sample: claimsG.permissions?.slice(0, 3) },
  );

  const d = await signIn(DOCTOR_EMAIL);
  const claimsD = decode(d.accessToken) as { permissions: string[] };
  log(
    '3.6.5.b doctor JWT NÃO contém manage:financial (não está no bundle)',
    Array.isArray(claimsD.permissions) && !claimsD.permissions.includes('manage:financial'),
    { count: claimsD.permissions?.length, has: claimsD.permissions?.includes('manage:financial') },
  );

  // Adicionar override granted=true para doctor.
  await dbAdmin.execute(sql`
    INSERT INTO public.user_permission_overrides (user_id, clinic_id, permission_code, granted)
    VALUES (${doctorId}::uuid, ${CLINIC_A}::uuid, 'manage:financial', true)
    ON CONFLICT (user_id, permission_code) DO UPDATE SET granted = true
  `);
  // Refresh JWT do doctor.
  const { data: refreshed } = await d.client.auth.refreshSession({ refresh_token: d.refreshToken });
  const claimsD2 = decode(refreshed!.session!.access_token) as { permissions: string[]; claims_version: number };
  log(
    '3.6.5.c após override granted=true + refresh, doctor JWT TEM manage:financial',
    claimsD2.permissions.includes('manage:financial'),
    { has: claimsD2.permissions.includes('manage:financial'), v: claimsD2.claims_version },
  );

  // Cleanup override.
  await dbAdmin.execute(sql`
    DELETE FROM public.user_permission_overrides
    WHERE user_id = ${doctorId}::uuid AND permission_code = 'manage:financial'
  `);
}

console.log('\n=== 3.6.6 rate limit DUAL (IP + email_hash) ===');
{
  const ip = '192.0.2.66'; // RFC 5737 documentation IP
  const emailHash = hashEmail(`smoke-rl-${Date.now()}@clinicaos.dev`);

  // 5 tentativas devem passar; 6ª (email_hash limit) deve bloquear.
  let lastResult: Awaited<ReturnType<typeof assertLoginAllowed>> = { ok: true };
  for (let i = 0; i < 6; i++) {
    lastResult = await assertLoginAllowed(ip, emailHash);
  }
  log(
    '3.6.6.a 6ª tentativa do mesmo email bloqueia (email_hash limit 5/15min)',
    lastResult.ok === false,
    lastResult,
  );

  // Limite por IP: 10 tentativas com emails diferentes → 11ª bloqueia.
  const ipOnly = '192.0.2.99';
  // já consumimos 6 do email anterior, mas ipOnly é novo IP. Faz 10 com emails distintos.
  for (let i = 0; i < 10; i++) {
    await assertLoginAllowed(ipOnly, hashEmail(`rl-ip-${Date.now()}-${i}@clinicaos.dev`));
  }
  const eleventh = await assertLoginAllowed(ipOnly, hashEmail(`rl-ip-final-${Date.now()}@clinicaos.dev`));
  log(
    '3.6.6.b 11ª tentativa do mesmo IP (emails diferentes) bloqueia (ip limit 10/15min)',
    eleventh.ok === false,
    eleventh,
  );
}

console.log('\n=== 3.6.10 WITH CHECK cross-tenant insert ===');
{
  const gA = await signIn(GESTOR_A_EMAIL);
  // gestor-a tenta criar clinic_unit em Clinic B (WITH CHECK deve rejeitar).
  const r = await fetch(`${SUPA_URL}/rest/v1/clinic_units`, {
    method: 'POST',
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${gA.accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({ clinic_id: CLINIC_B, nome: '_smoke_should_fail' }),
  });
  const body = await r.json().catch(() => ({}));
  log(
    '3.6.10 gestor-a NÃO insere unit em Clinic B (WITH CHECK rejeita)',
    r.status >= 400,
    { status: r.status, body },
  );
}

// --- CLEANUP --------------------------------------------------------
console.log('\n[cleanup] removendo fixtures…');
await dbAdmin.execute(sql`
  DELETE FROM public.profiles WHERE id IN (${gestorA}::uuid, ${gestorB}::uuid, ${doctorId}::uuid)
`);
await admin.auth.admin.deleteUser(gestorA);
await admin.auth.admin.deleteUser(gestorB);
await admin.auth.admin.deleteUser(doctorId);
await dbAdmin.execute(sql`DELETE FROM public.clinics WHERE id IN (${CLINIC_A}::uuid, ${CLINIC_B}::uuid)`);

console.log(`\n${failed === 0 ? '✅ all manual smokes passed' : `❌ ${failed} check(s) failed`}`);
process.exit(failed === 0 ? 0 : 1);
