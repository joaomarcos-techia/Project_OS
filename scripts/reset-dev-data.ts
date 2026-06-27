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

// 2. usuários de clínica (não-super_admin) → apagar do Auth ANTES de dropar as
//    clínicas (depois disso os profiles somem por cascade e perderíamos os ids).
const profs = (await dbAdmin.execute(
  sql`SELECT id::text AS id FROM public.profiles WHERE role <> 'super_admin'`,
)) as unknown as Array<{ id: string }>;

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

// 3. órfãos no Auth nos domínios de seed (sem profile) → limpeza defensiva para
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

// 4. apagar TODAS as clínicas — CASCADE limpa profiles (exceto super_admin, que
//    tem clinic_id NULL e não referencia clínica) + todos os dados de tenant.
const [{ n: clinicCount } = { n: 0 }] = (await dbAdmin.execute(
  sql`SELECT count(*)::int AS n FROM public.clinics`,
)) as unknown as Array<{ n: number }>;
await dbAdmin.execute(sql`DELETE FROM public.clinics`);

console.log(`[reset:dev] clínicas removidas: ${clinicCount} (cascade limpou profiles + dados de tenant).`);
console.log(`[reset:dev] auth users removidos: ${deletedByProfile} (por profile) + ${deletedOrphans} (órfãos por domínio).`);
console.log('[reset:dev] ✅ done. super_admin e tabelas de plataforma preservados.');
console.log('[reset:dev] próximo passo: pnpm seed:dev');

process.exit(0);
