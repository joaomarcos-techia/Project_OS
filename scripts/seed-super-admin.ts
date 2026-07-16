/**
 * `pnpm tsx scripts/seed-super-admin.ts [--reset-mfa]`
 *
 * Cria/atualiza o profile super_admin do founder. Idempotente.
 *
 * Inputs (env):
 *   - SUPER_ADMIN_EMAIL (obrigatório)
 *   - SUPER_ADMIN_PASSWORD (obrigatório quando user não existe ainda)
 *   - NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY (já no .env.local)
 *
 * Flags:
 *   --reset-mfa  Remove todos os factors TOTP do super_admin (recovery "perdi
 *                meu celular"). Idempotente — sem factors, no-op.
 *
 * Output:
 *   1. Garante user em auth.users (Admin API createUser ou no-op se existir).
 *   2. UPSERT em profiles: role=super_admin, clinic_id=NULL, ativo=true.
 *   3. Instruções para ativar MFA via /account/security no primeiro login +
 *      guardar QR/secret em gerenciador de senhas (não há recovery codes
 *      nativos no Supabase TOTP).
 *
 * NUNCA usar contra prod sem dupla confirmação manual. Este script só é
 * pensado para dev e setup inicial. Em prod, criar super_admin via Supabase
 * Dashboard + psql é mais auditável.
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { dbAdmin } from '@/lib/db';
import { createAdminClient } from '@/lib/auth/supabase-admin';

const { databaseUrl } = assertDevContext();
console.log(`[seed-super-admin] target: ${redact(databaseUrl)}`);

const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;
const resetMfa = process.argv.includes('--reset-mfa');

if (!email) {
  console.error('[seed-super-admin] SUPER_ADMIN_EMAIL ausente no env. Abortando.');
  process.exit(1);
}

const supabase = createAdminClient();

// 1. user em auth.users
let userId: string;
const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({
  perPage: 1000,
});
if (listErr) throw listErr;
const existing = listed.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (existing) {
  userId = existing.id;
  console.log(`[seed-super-admin] user existente: ${email} (${userId})`);
} else {
  if (!password) {
    console.error(
      '[seed-super-admin] user inexistente e SUPER_ADMIN_PASSWORD ausente. Setar para criar.',
    );
    process.exit(1);
  }
  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createErr || !created.user) throw createErr ?? new Error('createUser sem retorno');
  userId = created.user.id;
  console.log(`[seed-super-admin] user criado: ${email} (${userId})`);
}

// 2. UPSERT profile
// invite_accepted_at = now(): o super_admin NÃO passa por convite (ele É semeado).
// Sem isto, o gate de aceite do convite (0041 / I-3) trataria o super_admin como
// "pendente" e o hook negaria as claims — lockout do painel. "Semeado = aceito",
// espelho de "owner nasce aceito" na saga de onboarding.
await dbAdmin.execute(sql`
  INSERT INTO public.profiles (id, clinic_id, nome, role, ativo, invite_accepted_at)
  VALUES (${userId}::uuid, NULL, 'Super Admin', 'super_admin', true, now())
  ON CONFLICT (id) DO UPDATE SET
    role = 'super_admin',
    clinic_id = NULL,
    ativo = true,
    deleted_at = NULL,
    invite_accepted_at = COALESCE(public.profiles.invite_accepted_at, now()),
    updated_at = now()
`);
console.log('[seed-super-admin] profile upserted.');

// 3. --reset-mfa: remove factors TOTP
if (resetMfa) {
  const { data: factorsList, error: factorsErr } = await supabase.auth.admin.mfa.listFactors({
    userId,
  });
  if (factorsErr) throw factorsErr;
  for (const f of factorsList.factors) {
    const { error: delErr } = await supabase.auth.admin.mfa.deleteFactor({
      userId,
      id: f.id,
    });
    if (delErr) throw delErr;
    console.log(`[seed-super-admin] factor removido: ${f.id} (${f.factor_type})`);
  }
  // Limpa mfa_enrolled_at do profile
  await dbAdmin.execute(sql`
    UPDATE public.profiles SET mfa_enrolled_at = NULL WHERE id = ${userId}::uuid
  `);
  console.log('[seed-super-admin] mfa_enrolled_at zerado.');
}

console.log(`
[seed-super-admin] ✅ done.

PRÓXIMOS PASSOS (manual):
  1. Login em /login com ${email}.
  2. Você será redirecionado para /account/security?force=1 (MFA obrigatório super_admin).
  3. Escanear QR no Authy/Google Authenticator.
  4. GUARDAR QR + SECRET no seu gerenciador de senhas — Supabase TOTP NÃO emite
     backup codes. Sem isso, perda do dispositivo = bloqueio total.
     Recovery: re-rodar 'tsx scripts/seed-super-admin.ts --reset-mfa' e reenrollar.
  5. Verificar primeiro código TOTP → AAL2 ativo → /admin (Platform Admin, C15).
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
