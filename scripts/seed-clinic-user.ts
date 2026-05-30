/**
 * `pnpm tsx scripts/seed-clinic-user.ts`
 *
 * Cria/atualiza uma CLÍNICA de teste + um USUÁRIO de clínica (default role
 * `gestor`, que tem todas as permissões de paciente — migration 0003). Use para
 * testar a C5 (Patient) ponta a ponta: o super_admin NÃO tem clinic_id e é
 * roteado para /admin/select-clinic (C15, ainda não existe). A UI de paciente
 * exige um usuário de clínica.
 *
 * Idempotente. SÓ dev (assertDevContext).
 *
 * Inputs (env, em .env.local ou na sessão do shell):
 *   - SEED_USER_EMAIL     (obrigatório)
 *   - SEED_USER_PASSWORD  (obrigatório quando o user ainda não existe)
 *   - SEED_USER_ROLE      (opcional, default 'gestor'; use 'attendant' p/ testar 403 de delete)
 *   - SEED_CLINIC_SLUG    (opcional, default 'clinica-teste')
 *   - SEED_CLINIC_NOME    (opcional, default 'Clínica Teste')
 *   - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (já no .env.local)
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';

const { databaseUrl } = assertDevContext();
console.log(`[seed-clinic-user] target: ${redact(databaseUrl)}`);

const email = process.env.SEED_USER_EMAIL;
const password = process.env.SEED_USER_PASSWORD;
const role = process.env.SEED_USER_ROLE ?? 'gestor';
const slug = process.env.SEED_CLINIC_SLUG ?? 'clinica-teste';
const nome = process.env.SEED_CLINIC_NOME ?? 'Clínica Teste';

const TENANT_ROLES = ['gestor', 'owner', 'attendant', 'doctor', 'financial'];
if (!TENANT_ROLES.includes(role)) {
  console.error(`[seed-clinic-user] SEED_USER_ROLE inválido: ${role}. Use um de ${TENANT_ROLES.join(', ')}.`);
  process.exit(1);
}
if (!/^[a-z0-9-]{3,30}$/.test(slug)) {
  console.error(`[seed-clinic-user] SEED_CLINIC_SLUG inválido: ${slug} (regex ^[a-z0-9-]{3,30}$).`);
  process.exit(1);
}
if (!email) {
  console.error('[seed-clinic-user] SEED_USER_EMAIL ausente no env. Abortando.');
  process.exit(1);
}

const supabase = createAdminClient();

// 1. Clínica (upsert por slug).
const clinicRows = (await dbAdmin.execute(sql`
  INSERT INTO public.clinics (slug, nome, status)
  VALUES (${slug}, ${nome}, 'active')
  ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, status = 'active', updated_at = now()
  RETURNING id::text AS id
`)) as unknown as Array<{ id: string }>;
const clinicId = clinicRows[0]!.id;
console.log(`[seed-clinic-user] clínica: ${nome} (${slug}) → ${clinicId}`);

// 2. Usuário em auth.users (find ou createUser).
let userId: string;
const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw listErr;
const existing = listed.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (existing) {
  userId = existing.id;
  console.log(`[seed-clinic-user] user existente: ${email} (${userId})`);
} else {
  if (!password) {
    console.error('[seed-clinic-user] user inexistente e SEED_USER_PASSWORD ausente. Setar para criar.');
    process.exit(1);
  }
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error('createUser sem retorno');
  userId = created.user.id;
  console.log(`[seed-clinic-user] user criado: ${email} (${userId})`);
}

// 3. Profile (upsert) — clinic_id obrigatório p/ não-super_admin (CHECK em profiles).
await dbAdmin.execute(sql`
  INSERT INTO public.profiles (id, clinic_id, nome, role, ativo)
  VALUES (${userId}::uuid, ${clinicId}::uuid, ${'Usuário ' + role}, ${role}::role_enum, true)
  ON CONFLICT (id) DO UPDATE SET
    clinic_id = ${clinicId}::uuid,
    role = ${role}::role_enum,
    ativo = true,
    deleted_at = NULL,
    updated_at = now()
`);
console.log(`[seed-clinic-user] profile upserted: role=${role}, clinic_id=${clinicId}`);

console.log(`
[seed-clinic-user] ✅ done.

PRÓXIMOS PASSOS:
  1. Garanta os secrets de crypto no .env.local (CRYPTO_MASTER_KEY_V1 + CRYPTO_LOOKUP_SALT).
  2. pnpm dev
  3. Login em /login com ${email}.
     Roles de clínica NÃO exigem MFA → vai direto para /dashboard.
  4. Navegue para /pacientes e teste criar/editar/excluir.
`);

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[unparseable-url]';
  }
}

process.exit(0);
