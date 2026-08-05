/**
 * `pnpm seed:c9` (ou `pnpm tsx scripts/seed-c9-test.ts`)
 *
 * RESET + SEED de ambiente de teste para o C9 (Caixa/Financeiro). SÓ DEV
 * (assertDevContext). Idempotente: pode rodar várias vezes.
 *
 * O que faz:
 *   1. APAGA todas as clínicas (CASCADE remove appointments/lançamentos/profiles
 *      de clínica/etc.) e todos os usuários do Auth, EXCETO os super_admin (para
 *      você não perder o login de admin).
 *   2. Cria 2 clínicas: "Clínica A" (clinica-a) e "Clínica B" (clinica-b).
 *   3. Em cada uma, cria 3 usuários (senha = SEED_C9_PASSWORD ou 'Teste@123456'):
 *        gestor.<a|b>@clinicaos.test     (role gestor    — tudo)
 *        atendente.<a|b>@clinicaos.test  (role attendant — opera o Caixa)
 *        medico.<a|b>@clinicaos.test     (role doctor    — encerra consultas)
 *   4. Cria 1 procedimento, 1 paciente e 2 atendimentos por clínica:
 *        - um EM ATENDIMENTO (clique "Encerrar" no /consultorio → faturamento)
 *        - um AGENDADO (para o fluxo completo de check-in → atender → encerrar)
 *   5. Imprime no final TODOS os IDs (clínicas, usuários, atendimentos).
 *
 * Depois: `pnpm dev`, login com um dos e-mails acima. Para o lançamento aparecer
 * no /caixa após "Encerrar", rode `pnpm worker:once` (em dev o outbox não roda só).
 */
import { assertDevContext } from './_env';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { appointments, procedures } from '@/contexts/scheduling/schema';
import { patients } from '@/contexts/patient/schema';

const { databaseUrl } = assertDevContext();
console.log(`[seed:c9] target: ${redact(databaseUrl)}`);

const supabase = createAdminClient();
const PASSWORD = process.env.SEED_C9_PASSWORD ?? 'Teste@123456';

function redact(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '[unparseable-url]';
  }
}

/** Hoje (local) numa hora `h` — cai na janela "hoje" do board/Caixa. */
function todayAt(h: number): Date {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d;
}

interface ClinicSeed {
  nome: string;
  slug: string;
  clinicId: string;
  gestor: string;
  atendente: string;
  medico: string;
  procedureId: string;
  patientId: string;
  apptEmAtendimento: string;
  apptAgendado: string;
}

async function createUser(
  clinicId: string,
  email: string,
  role: 'gestor' | 'attendant' | 'doctor',
  nome: string,
  doctor?: { crm: string; crmUf: string; esp: string },
): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error(`createUser falhou: ${email}`);
  const userId = data.user.id;
  await dbAdmin.execute(sql`
    INSERT INTO public.profiles (id, clinic_id, nome, role, ativo, crm, crm_uf, especialidade)
    VALUES (${userId}::uuid, ${clinicId}::uuid, ${nome}, ${role}::role_enum, true,
            ${doctor?.crm ?? null}, ${doctor?.crmUf ?? null}, ${doctor?.esp ?? null})
    ON CONFLICT (id) DO UPDATE SET clinic_id = EXCLUDED.clinic_id, nome = EXCLUDED.nome,
            role = EXCLUDED.role, ativo = true, deleted_at = NULL, updated_at = now()
  `);
  return userId;
}

async function setupClinic(suffix: 'a' | 'b', nome: string, slug: string): Promise<ClinicSeed> {
  const [c] = (await dbAdmin.execute(sql`
    INSERT INTO public.clinics (slug, nome, status, timezone)
    VALUES (${slug}, ${nome}, 'active', 'America/Sao_Paulo')
    RETURNING id::text AS id
  `)) as unknown as Array<{ id: string }>;
  const clinicId = c!.id;

  const gestor = await createUser(
    clinicId,
    `gestor.${suffix}@clinicaos.test`,
    'gestor',
    `Gestor ${suffix.toUpperCase()}`,
  );
  const atendente = await createUser(
    clinicId,
    `atendente.${suffix}@clinicaos.test`,
    'attendant',
    `Atendente ${suffix.toUpperCase()}`,
  );
  const medico = await createUser(
    clinicId,
    `medico.${suffix}@clinicaos.test`,
    'doctor',
    `Dr(a). ${suffix.toUpperCase()}`,
    {
      crm: suffix === 'a' ? '111111' : '222222',
      crmUf: 'SP',
      esp: 'Clínica Médica',
    },
  );

  const seeded = await withTenant(clinicId, async (tx) => {
    const [proc] = await tx
      .insert(procedures)
      .values({
        clinicId,
        codigo: 'CONS',
        descricao: 'Consulta',
        categoria: 'consulta',
        valorPadrao: '200.00',
        duracaoPadraoMin: 30,
      })
      .returning({ id: procedures.id });

    const [pat] = await tx
      .insert(patients)
      .values({
        clinicId,
        nome: `Paciente ${suffix.toUpperCase()}`,
        cpfEncrypted: 'enc',
        cpfHash: (suffix === 'a' ? '1' : '2').repeat(64),
        email: `paciente.${suffix}@clinicaos.test`,
        dataNascimento: '1990-01-01',
        sexo: 'F',
      })
      .returning({ id: patients.id });

    const apptBase = {
      clinicId,
      doctorId: medico,
      procedureId: proc!.id,
      patientId: pat!.id,
      durationMin: 30,
      valor: '200.00',
      snapshotProcedureName: 'Consulta',
      snapshotProcedureCodigo: 'CONS',
      snapshotProcedureCategoria: 'consulta',
      snapshotProcedureValor: '200.00',
      snapshotProcedureDuracaoMin: 30,
      snapshotDoctorNome: `Dr(a). ${suffix.toUpperCase()}`,
      createdVia: 'attendant' as const,
    };

    const [em] = await tx
      .insert(appointments)
      .values({ ...apptBase, scheduledAt: todayAt(9), status: 'em_atendimento' })
      .returning({ id: appointments.id });
    const [ag] = await tx
      .insert(appointments)
      .values({ ...apptBase, scheduledAt: todayAt(11), status: 'agendado' })
      .returning({ id: appointments.id });

    return { procedureId: proc!.id, patientId: pat!.id, apptEm: em!.id, apptAg: ag!.id };
  });

  return {
    nome,
    slug,
    clinicId,
    gestor,
    atendente,
    medico,
    procedureId: seeded.procedureId,
    patientId: seeded.patientId,
    apptEmAtendimento: seeded.apptEm,
    apptAgendado: seeded.apptAg,
  };
}

async function main(): Promise<void> {
  // 1. WIPE — preserva super_admins (clinic_id null, role super_admin).
  const superRows = (await dbAdmin.execute(
    sql`SELECT id::text AS id FROM public.profiles WHERE role = 'super_admin'`,
  )) as unknown as Array<{ id: string }>;
  const superIds = new Set(superRows.map((r) => r.id));

  await dbAdmin.execute(sql`DELETE FROM public.clinics`); // CASCADE: tudo tenant-scoped

  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) throw listErr;
  let deleted = 0;
  for (const u of listed.users) {
    if (superIds.has(u.id)) continue;
    await supabase.auth.admin.deleteUser(u.id);
    deleted++;
  }
  console.log(
    `[seed:c9] wipe: clínicas removidas, ${deleted} usuário(s) removido(s), ${superIds.size} super_admin preservado(s).`,
  );

  // 2-4. Seed das duas clínicas.
  const a = await setupClinic('a', 'Clínica A', 'clinica-a');
  const b = await setupClinic('b', 'Clínica B', 'clinica-b');

  // 5. Summary.
  const line = (s: ClinicSeed) => `
  ── ${s.nome}  (slug: ${s.slug})
     clinic_id ........ ${s.clinicId}
     gestor ........... gestor.${s.slug.endsWith('a') ? 'a' : 'b'}@clinicaos.test   (${s.gestor})
     atendente ........ atendente.${s.slug.endsWith('a') ? 'a' : 'b'}@clinicaos.test (${s.atendente})
     médico ........... medico.${s.slug.endsWith('a') ? 'a' : 'b'}@clinicaos.test    (${s.medico})
     paciente_id ...... ${s.patientId}
     appt EM ATENDIMENTO (Encerrar → faturamento): ${s.apptEmAtendimento}
     appt AGENDADO (fluxo completo) .............. ${s.apptAgendado}`;

  console.log(`
[seed:c9] ✅ pronto.

Senha de todos os usuários: ${PASSWORD}
${line(a)}
${line(b)}

COMO TESTAR:
  1. pnpm dev → login com medico.a@clinicaos.test (senha acima).
  2. /consultorio → o atendimento "EM ATENDIMENTO" aparece → clique Encerrar.
  3. pnpm worker:once   (processa o outbox em dev)
  4. login como atendente.a@clinicaos.test → /caixa → confirme o pagamento.
  5. login como gestor.a@clinicaos.test → /caixa → teste Estornar.

Para ver os clinic_id depois:  SELECT id, slug, nome FROM clinics ORDER BY created_at;
`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[seed:c9] FALHOU:', e instanceof Error ? e.stack : e);
    process.exit(1);
  });
