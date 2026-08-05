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
import { encryptForTenant, hashForLookup, normalizeCpf } from '@/lib/crypto';
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

interface SeedPatient {
  nome: string;
  cpf: string; // CPF válido (Luhn) — raw insert cifra/hash server-side
  email: string;
  logradouro: string;
  cidade: string;
  estado: string;
  cep: string;
}

interface SeedClinic {
  slug: string; // vira o domínio do email também
  nome: string;
  endereco: string;
  telefone: string;
  users: SeedUser[];
  /** Paciente + atendimento de exemplo p/ destravar o consultório sem a Agenda. */
  patient: SeedPatient;
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
      {
        local: 'medico',
        role: 'doctor',
        nome: 'Dra. Ana Souza',
        crm: '123456',
        crmUf: 'SP',
        especialidade: 'Clínica Médica',
      },
      { local: 'atendente', role: 'attendant', nome: 'Aline Atendente' },
      { local: 'financeiro', role: 'financial', nome: 'Fábio Financeiro' },
    ],
    patient: {
      nome: 'Maria Teste',
      cpf: '529.982.247-25',
      email: 'paciente@clinica-a.com',
      logradouro: 'Rua das Flores, 50',
      cidade: 'São Paulo',
      estado: 'SP',
      cep: '01000-000',
    },
  },
  {
    slug: 'clinica-b',
    nome: 'Clínica B',
    endereco: 'Rua B, 200 — Rio de Janeiro/RJ',
    telefone: '(21) 3000-0000',
    users: [
      { local: 'owner', role: 'owner', nome: 'Bruno Owner B' },
      {
        local: 'medico',
        role: 'doctor',
        nome: 'Dr. Bruno Médico B',
        crm: '654321',
        crmUf: 'RJ',
        especialidade: 'Clínica Médica',
      },
    ],
    patient: {
      nome: 'Carlos Teste',
      cpf: '111.444.777-35',
      email: 'paciente@clinica-b.com',
      logradouro: 'Rua B, 200',
      cidade: 'Rio de Janeiro',
      estado: 'RJ',
      cep: '20000-000',
    },
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
    console.log(
      `[seed:dev]   • ${email}  (role=${u.role}${u.crm ? `, CRM ${u.crmUf} ${u.crm}` : ''})`,
    );
  }

  // 3. Dados de exemplo p/ destravar o CONSULTÓRIO sem a Agenda (que é só front).
  //    procedimento + paciente (cifrado, c/ endereço) + 1 atendimento em_atendimento.
  const doctor = c.users.find((u) => u.role === 'doctor')!;
  const doctorId = byEmail.get(`${doctor.local}@${c.slug}.com`)!;

  // 3a. procedimento (upsert por codigo).
  const [{ id: procedureId } = { id: '' }] = (await dbAdmin.execute(sql`
    INSERT INTO public.procedures (clinic_id, codigo, descricao, categoria, valor_padrao, duracao_padrao_min, ativo)
    VALUES (${clinicId}::uuid, 'CONS', 'Consulta', 'Consulta', '150.00', 30, true)
    ON CONFLICT (clinic_id, codigo) DO UPDATE SET descricao = EXCLUDED.descricao, updated_at = now()
    RETURNING id::text AS id
  `)) as unknown as Array<{ id: string }>;

  // 3b. paciente (insere se ainda não existir, por cpf_hash). Cifra CPF + endereço.
  const cpfNorm = normalizeCpf(c.patient.cpf);
  const cpfHash = await hashForLookup(cpfNorm);
  const existingPat = (await dbAdmin.execute(sql`
    SELECT id::text AS id FROM public.patients
    WHERE clinic_id = ${clinicId}::uuid AND cpf_hash = ${cpfHash} LIMIT 1
  `)) as unknown as Array<{ id: string }>;
  let patientId = existingPat[0]?.id;
  if (!patientId) {
    const cpfEnc = await encryptForTenant(clinicId, cpfNorm);
    const [{ id } = { id: '' }] = (await dbAdmin.execute(sql`
      INSERT INTO public.patients (clinic_id, nome, cpf_encrypted, cpf_hash, email)
      VALUES (${clinicId}::uuid, ${c.patient.nome}, ${cpfEnc}, ${cpfHash}, ${c.patient.email})
      RETURNING id::text AS id
    `)) as unknown as Array<{ id: string }>;
    patientId = id;
    const logEnc = await encryptForTenant(clinicId, c.patient.logradouro);
    const cepEnc = await encryptForTenant(clinicId, c.patient.cep);
    await dbAdmin.execute(sql`
      INSERT INTO public.patient_addresses
        (clinic_id, patient_id, tipo, logradouro_encrypted, cidade, estado, cep_encrypted, principal)
      VALUES (${clinicId}::uuid, ${patientId}::uuid, 'residencial', ${logEnc},
              ${c.patient.cidade}, ${c.patient.estado}, ${cepEnc}, true)
    `);
    console.log(`[seed:dev]   • paciente: ${c.patient.nome} (com endereço)`);
  }

  // 3c. atendimento em_atendimento (walk-in) — só se o médico não tiver um ativo.
  //     loadAtendimento cria o prontuário sob demanda ao abrir (status em_atendimento).
  const activeAppt = (await dbAdmin.execute(sql`
    SELECT 1 AS one FROM public.appointments
    WHERE clinic_id = ${clinicId}::uuid AND doctor_id = ${doctorId}::uuid
      AND status NOT IN ('cancelado','faltou','atendido') LIMIT 1
  `)) as unknown as Array<{ one: number }>;
  if (activeAppt.length === 0) {
    await dbAdmin.execute(sql`
      INSERT INTO public.appointments
        (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
         snapshot_procedure_name, snapshot_procedure_codigo, snapshot_procedure_categoria,
         snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome,
         created_via, created_by)
      VALUES (${clinicId}::uuid, ${doctorId}::uuid, ${patientId}::uuid, ${procedureId}::uuid, now(), 30,
         'em_atendimento', '150.00', 'Consulta', 'CONS', 'Consulta', '150.00', 30, ${doctor.nome},
         'walkin', ${doctorId}::uuid)
    `);
    console.log(`[seed:dev]   • atendimento em_atendimento criado p/ ${doctor.nome}`);
  }
}

console.log('\n[seed:dev] ✅ done. Credenciais (senha igual para todos):\n');
console.table(summary);
console.log(`
Login em /login. Roles de clínica não exigem MFA → vão direto para /dashboard.
Para emitir Receituário de Controle Especial use o médico (medico@clinica-a.com),
que já tem CRM e cuja clínica já tem endereço/telefone.
Cada clínica já tem 1 paciente (com endereço) + 1 atendimento "em atendimento" no
Consultório — abra o Consultório como médico para testar prescrição/modelos por lá.
Teste de RLS A/B: logue como medico@clinica-b.com e tente abrir uma prescrição da Clínica A.
`);

process.exit(0);
