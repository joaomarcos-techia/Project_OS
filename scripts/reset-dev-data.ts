/**
 * `pnpm reset:dev`
 *
 * TEARDOWN DESTRUTIVO de DEV — apaga TODAS as clínicas e TODOS os usuários de
 * clínica (não-super_admin), incluindo, por CASCADE, todos os dados de tenant
 * (pacientes, prescrições, prontuários, agenda, financeiro, mensagens, IA…).
 *
 * PRESERVA:
 *   - super_admin (profile com clinic_id NULL) e seu usuário no Auth;
 *   - tabelas de plataforma (plans, prices, platform_settings, _reserved_slugs…).
 *
 * Guardado por assertDevContext (recusa rodar contra prod). Idempotente.
 * Use junto com `pnpm seed:dev` para recriar contas de teste determinísticas.
 */
// MUST be first: _env carrega .env.local (dotenv) antes de qualquer @/lib/* que
// valide o env no load (senão DATABASE_URL/NEXT_PUBLIC_SUPABASE_URL aparecem vazios).
import { assertDevContext, redact } from './_env';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';

const SEED_EMAIL_DOMAINS = /@(clinica-[ab]|exemplo)\.com$/i;

const { databaseUrl } = assertDevContext();
console.log(`[reset:dev] target: ${redact(databaseUrl)}`);

const supabase = createAdminClient();

// 1. super_admin(s) a preservar.
const superAdmins = (await dbAdmin.execute(
  sql`SELECT id::text AS id FROM public.profiles WHERE role = 'super_admin'`,
)) as unknown as Array<{ id: string }>;
const preserve = new Set(superAdmins.map((s) => s.id));
console.log(`[reset:dev] preservando ${preserve.size} super_admin(s).`);

// 2. Capturar os IDs antes de remover as clínicas. Um Auth delete anterior ao
//    tenant poderia deixar assinatura sem titular se o processo fosse interrompido.
const profs = (await dbAdmin.execute(
  sql`SELECT id::text AS id FROM public.profiles WHERE role <> 'super_admin'`,
)) as unknown as Array<{ id: string }>;

// 2b. S5/0171: com a barreira append-only instalada, o CASCADE de clínica com histórico
//     TISS (hi_account_events) é recusado pelo banco e a trilha da clínica não pode ser
//     apagada (requisito 85 da ANS). Recusa ANTES de apagar qualquer coisa, com o motivo,
//     em vez de falhar no meio com um erro do gatilho. Teardown com a barreira = decisão.
const [{ barrier } = { barrier: false }] = (await dbAdmin.execute(
  sql`SELECT exists(SELECT 1 FROM pg_trigger WHERE tgname = 'audit_events_append_only_row') AS barrier`,
)) as unknown as Array<{ barrier: boolean }>;
if (barrier) {
  console.error(
    '[reset:dev] recusado: a barreira append-only das trilhas (0171) está instalada neste banco. Apagar clínicas com trilha TISS não é permitido; use clínicas sintéticas novas (as fixtures já fazem assim) ou registre a decisão de teardown.',
  );
  process.exit(1);
}

// 3. Apagar as clínicas primeiro: CASCADE limpa profiles e contratos juntos.
const [{ n: clinicCount } = { n: 0 }] = (await dbAdmin.execute(
  sql`SELECT count(*)::int AS n FROM public.clinics`,
)) as unknown as Array<{ n: number }>;
await dbAdmin.execute(sql`DELETE FROM public.clinics`);

let deletedByProfile = 0;
for (const p of profs) {
  if (preserve.has(p.id)) continue;
  const { error } = await supabase.auth.admin.deleteUser(p.id);
  if (error && !/not\s*found/i.test(error.message)) {
    console.warn(`[reset:dev] aviso ao deletar auth user ${p.id}: ${error.message}`);
  } else {
    deletedByProfile++;
  }
}

// 4. órfãos no Auth nos domínios de seed (sem profile) → limpeza defensiva para
//    re-seed limpo. NUNCA toca super_admin.
const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw listErr;
let deletedOrphans = 0;
for (const u of listed.users) {
  if (preserve.has(u.id)) continue;
  if (u.email && SEED_EMAIL_DOMAINS.test(u.email)) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (!error) deletedOrphans++;
  }
}

console.log(
  `[reset:dev] clínicas removidas: ${clinicCount} (cascade limpou profiles + dados de tenant).`,
);
console.log(
  `[reset:dev] auth users removidos: ${deletedByProfile} (por profile) + ${deletedOrphans} (órfãos por domínio).`,
);
console.log('[reset:dev] ✅ done. super_admin e tabelas de plataforma preservados.');
console.log('[reset:dev] próximo passo: pnpm seed:dev');

process.exit(0);
