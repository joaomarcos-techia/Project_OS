/**
 * `pnpm seed:dev`
 *
 * Cria contas de teste DETERMINÍSTICAS para dev: 2 clínicas, cada uma com 1
 * usuário por role, emails previsíveis e a MESMA senha. Idempotente (reusa
 * usuário/clínica existentes). SÓ dev (assertDevContext).
 *
 *   Clínica A (clinica-a)  → todas as roles
 *   Clínica B (clinica-b)  → owner + médico (para teste de RLS A/B entre tenants)
 *
 * Emails: <local>@<slug>.com   (ex.: medico@clinica-a.com)
 * Senha (todos):  SenhaForte123!
 *
 * O médico já nasce com CRM e a clínica com endereço/telefone, para emitir o
 * Receituário de Controle Especial sem preparo manual.
 *
 * Rode `pnpm reset:dev` antes para limpar contas antigas.
 */
// MUST be first: _env carrega .env.local (dotenv) antes de qualquer @/lib/* que
// valide o env no load (senão DATABASE_URL/NEXT_PUBLIC_SUPABASE_URL aparecem vazios).
import { assertDevContext, redact } from './_env';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';

const PASSWORD = 'SenhaForte123!';

interface SeedUser {
  local: string; // parte local do email
  role: 'owner' | 'gestor' | 'doctor' | 'attendant' | 'financial';
  nome: string;
  crm?: string;
  crmUf?: string;
  especialidade?: string;
}

interface SeedClinic {
  slug: string; // vira o domínio do email também
  nome: string;
  endereco: string;
  telefone: string;
  users: SeedUser[];
}

const CLINICS: SeedClinic[] = [
  {
    slug: 'clinica-a',
    nome: 'Clínica A',
    endereco: 'Av. Paulista, 1000 — Sala 50, São Paulo/SP',
    telefone: '(11) 4000-0000',
    users: [
      { local: 'owner', role: 'owner', nome: 'Olívia Owner' },
      { local: 'gestor', role: 'gestor', nome: 'Gustavo Gestor' },
      { local: 'medico', role: 'doctor', nome: 'Dra. Ana Souza', crm: '123456', crmUf: 'SP', especialidade: 'Clínica Médica' },
      { local: 'atendente', role: 'attendant', nome: 'Aline Atendente' },
      { local: 'financeiro', role: 'financial', nome: 'Fábio Financeiro' },
    ],
  },
  {
    slug: 'clinica-b',
    nome: 'Clínica B',
    endereco: 'Rua B, 200 — Rio de Janeiro/RJ',
    telefone: '(21) 3000-0000',
    users: [
      { local: 'owner', role: 'owner', nome: 'Bruno Owner B' },
      { local: 'medico', role: 'doctor', nome: 'Dr. Bruno Médico B', crm: '654321', crmUf: 'RJ', especialidade: 'Clínica Médica' },
    ],
  },
];

const { databaseUrl } = assertDevContext();
console.log(`[seed:dev] target: ${redact(databaseUrl)}`);

const supabase = createAdminClient();

// Mapa email→id do Auth (1 listagem; evita N chamadas).
const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listErr) throw listErr;
const byEmail = new Map(listed.users.map((u) => [u.email?.toLowerCase() ?? '', u.id]));

async function findOrCreateUser(email: string): Promise<string> {
  const existing = byEmail.get(email.toLowerCase());
  if (existing) return existing;
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`createUser sem retorno (${email})`);
  byEmail.set(email.toLowerCase(), data.user.id);
  return data.user.id;
}

const summary: Array<{ clinica: string; email: string; role: string; senha: string }> = [];

for (const c of CLINICS) {
  // 1. clínica (upsert por slug) — com endereço/telefone p/ o receituário.
  const [{ id: clinicId } = { id: '' }] = (await dbAdmin.execute(sql`
    INSERT INTO public.clinics (slug, nome, status, endereco, telefone)
    VALUES (${c.slug}, ${c.nome}, 'active', ${c.endereco}, ${c.telefone})
    ON CONFLICT (slug) DO UPDATE SET
      nome = EXCLUDED.nome,
      status = 'active',
      endereco = EXCLUDED.endereco,
      telefone = EXCLUDED.telefone,
      updated_at = now()
    RETURNING id::text AS id
  `)) as unknown as Array<{ id: string }>;
  console.log(`[seed:dev] clínica: ${c.nome} (${c.slug}) → ${clinicId}`);

  // 2. usuários da clínica.
  for (const u of c.users) {
    const email = `${u.local}@${c.slug}.com`;
    const userId = await findOrCreateUser(email);
    await dbAdmin.execute(sql`
      INSERT INTO public.profiles (id, clinic_id, nome, role, ativo, crm, crm_uf, especialidade)
      VALUES (${userId}::uuid, ${clinicId}::uuid, ${u.nome}, ${u.role}::role_enum, true,
              ${u.crm ?? null}, ${u.crmUf ?? null}, ${u.especialidade ?? null})
      ON CONFLICT (id) DO UPDATE SET
        clinic_id = ${clinicId}::uuid,
        nome = ${u.nome},
        role = ${u.role}::role_enum,
        ativo = true,
        crm = ${u.crm ?? null},
        crm_uf = ${u.crmUf ?? null},
        especialidade = ${u.especialidade ?? null},
        deleted_at = NULL,
        updated_at = now()
    `);
    summary.push({ clinica: c.nome, email, role: u.role, senha: PASSWORD });
    console.log(`[seed:dev]   • ${email}  (role=${u.role}${u.crm ? `, CRM ${u.crmUf} ${u.crm}` : ''})`);
  }
}

console.log('\n[seed:dev] ✅ done. Credenciais (senha igual para todos):\n');
console.table(summary);
console.log(`
Login em /login. Roles de clínica não exigem MFA → vão direto para /dashboard.
Para emitir Receituário de Controle Especial use o médico (medico@clinica-a.com),
que já tem CRM e cuja clínica já tem endereço/telefone.
Teste de RLS A/B: logue como medico@clinica-b.com e tente abrir uma prescrição da Clínica A.
`);

process.exit(0);
