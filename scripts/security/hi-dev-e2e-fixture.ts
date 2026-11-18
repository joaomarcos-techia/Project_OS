/**
 * Fixture SINTÉTICA de Convênios no DEV para a validação da interface em navegador (P5/P3 da
 * orientação de 12/11): três clínicas marcadas `e2e-hi-*` — paga (módulo habilitado), em trial
 * e suspensa pelo dunning — com contas sintéticas (gestor, recepção sem financeiro, médica),
 * operadora, contratos (Consulta e SP/SADT com autorização), perfil TISS, regra de repasse,
 * pacientes e carteirinhas sintéticas (cifradas pela cifra REAL do app) e atendimentos de
 * convênio com guias de Consulta em rascunho criadas pelo serviço real.
 *
 * Só DEV (`assertDevContext` + `--expected-ref` na URL); nunca toca linha que não seja das
 * clínicas `e2e-hi-*`; `cleanup` só desativa essas contas e clínicas (sem apagar dado
 * financeiro gerado pela interface: o histórico do teste fica auditável).
 *
 * As senhas são geradas aqui e gravadas SÓ no arquivo indicado em `--accounts` (fora do
 * repositório). Nada de dado real: nomes, carteirinhas e e-mails são sintéticos.
 *
 *   npx tsx --conditions=react-server scripts/security/hi-dev-e2e-fixture.ts setup \
 *     --expected-ref <ref DEV> --accounts <arquivo fora do repo> --out <ids.json>
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

import { sql } from 'drizzle-orm';

import { createAdminClient } from '@/lib/auth/supabase-admin';
import { encryptForTenant, hashForLookup } from '@/lib/crypto/encryption';
import { dbAdmin } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';

/**
 * Guarda de DEV própria (o build isolado copia só `scripts/security` e `src`, então este
 * arquivo não importa `scripts/_env.ts`): URL presente, com TLS, sem cara de produção, sem
 * `SUPABASE_PROJECT_ENV=prod`, e do projeto que o operador nomeou.
 */
function assertDevContext(): { databaseUrl: string } {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL ausente');
  if (process.env.SUPABASE_PROJECT_ENV === 'prod') throw new Error('SUPABASE_PROJECT_ENV=prod: recusado');
  if (/(prod|production)/iu.test(new URL(databaseUrl).hostname)) throw new Error('host com cara de produção: recusado');
  if (!databaseUrl.includes('sslmode=require')) throw new Error('DATABASE_URL sem sslmode=require');
  return { databaseUrl };
}

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const command = process.argv[2];
const expectedRef = arg('expected-ref');
const accountsFile = arg('accounts');
const outFile = arg('out');
/**
 * Comandos das regressões de estado (P0.3 de 15/11), chamados pelo spec durante a execução:
 *   setup-states --run <marca>                       três guias novas na clínica paga (duas para conferir, uma com pendência)
 *   set-state --state paid|trial|suspended           estado comercial da clínica PAGA (só ela)
 *   set-active --account <chave> --active true|false perfil ativo/desativado de uma conta e2e-hi-*
 *   guide-state --guide <id>                         status, versão, ajuste e eventos (só leitura)
 */
const COMMANDS = ['setup', 'setup-config', 'cleanup', 'setup-states', 'setup-authorizations', 'setup-i2', 'deliver-alerts', 'setup-p75', 'setup-sadt', 'complete-sadt', 'set-state', 'set-active', 'guide-state'];
if (!COMMANDS.includes(command ?? '') || !expectedRef || !accountsFile || !outFile) {
  throw new Error(`uso: ${COMMANDS.join('|')} --expected-ref <ref> --accounts <arquivo> --out <ids.json>`);
}
const { databaseUrl } = assertDevContext();
const u = new URL(databaseUrl);
if (!`${u.hostname} ${decodeURIComponent(u.username)}`.includes(expectedRef)) throw new Error('não é o DEV esperado');

const SYS = '00000000-0000-4000-8000-000000000001';
const CARDS = ['0081234500012345', '0081234500012346', '0081234500012347'];
/** CPFs sintéticos de formato válido (geradores públicos de teste), só nas clínicas e2e-hi-*. */
const CPFS = ['52998224725', '11144477735', '98765432100'];
/** P3.2: dígitos verificadores calculados sobre bases sintéticas fixas (idempotente entre execuções). */
const cpfOf = (base: string) => {
  const d = [...base].map(Number);
  const dv = (xs: number[]) => {
    const r = (xs.reduce((acc, x, i) => acc + x * (xs.length + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(d);
  return `${base}${d1}${dv([...d, d1])}`;
};
const TAB_CPFS = ['271828182', '314159265', '161803398', '141421356'].map(cpfOf);
const TAB_CARDS = ['0081234500022221', '0081234500022222', '0081234500022223'];
const exec = async <T = Record<string, unknown>>(q: ReturnType<typeof sql>) => (await dbAdmin.execute(q)) as unknown as T[];
const password = () => `${randomBytes(18).toString('base64url')}Aa1!`;

async function ensureUser(email: string, pass: string): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const found = data.users.find((x) => x.email?.toLowerCase() === email);
  if (found) {
    const upd = await admin.auth.admin.updateUserById(found.id, { password: pass, email_confirm: true, ban_duration: 'none' });
    if (upd.error) throw upd.error;
    return found.id;
  }
  const created = await admin.auth.admin.createUser({ email, password: pass, email_confirm: true });
  if (created.error || !created.data.user) throw created.error ?? new Error('createUser');
  return created.data.user.id;
}

async function clinic(slug: string, nome: string): Promise<string> {
  const [row] = await exec<{ id: string }>(sql`
    INSERT INTO public.clinics (slug, nome, status) VALUES (${slug}, ${nome}, 'active')
    ON CONFLICT (slug) DO UPDATE SET nome = EXCLUDED.nome, status = 'active', updated_at = now()
    RETURNING id::text AS id`);
  return row!.id;
}

async function profile(userId: string, clinicId: string, nome: string, role: string) {
  await exec(sql`
    INSERT INTO public.profiles (id, clinic_id, nome, role, ativo)
    VALUES (${userId}::uuid, ${clinicId}::uuid, ${nome}, ${role}::role_enum, true)
    ON CONFLICT (id) DO UPDATE SET clinic_id = EXCLUDED.clinic_id, nome = EXCLUDED.nome, role = EXCLUDED.role,
      ativo = true, deleted_at = NULL, updated_at = now()`);
}

/** Assinatura no estado pedido; o plano é o do catálogo real (inclui Convênios). */
async function subscription(clinicId: string, state: 'paid' | 'trial' | 'suspended') {
  await exec(sql`DELETE FROM public.subscriptions WHERE clinic_id = ${clinicId}::uuid`);
  if (state === 'trial') {
    await exec(sql`
      INSERT INTO public.subscriptions (clinic_id, plan_id, price_id, billing_status, trial_ends_at, enforce_trial_deadline)
      SELECT ${clinicId}::uuid, pl.id, pr.id, 'trial', now() + interval '10 days', true
        FROM public.plans pl JOIN public.prices pr ON pr.plan_id = pl.id
       WHERE pl.code = 'clinica_2026_2' ORDER BY pr.id LIMIT 1`);
    return;
  }
  await exec(sql`
    INSERT INTO public.subscriptions (clinic_id, plan_id, price_id, billing_status, current_period_start, current_period_end, grace_period_until)
    SELECT ${clinicId}::uuid, pl.id, pr.id,
           ${state === 'paid' ? 'active' : 'past_due'},
           ${state === 'paid' ? sql`now() - interval '1 day'` : sql`now() - interval '40 days'`},
           ${state === 'paid' ? sql`now() + interval '30 days'` : sql`now() - interval '10 days'`},
           ${state === 'paid' ? null : sql`now() - interval '3 days'`}
      FROM public.plans pl JOIN public.prices pr ON pr.plan_id = pl.id
     WHERE pl.code = 'clinica_2026_2' ORDER BY pr.id LIMIT 1`);
}

async function setup() {
  const [tv] = await exec<{ version: string }>(sql`SELECT version FROM public.tiss_terminology_versions ORDER BY version DESC LIMIT 1`);
  if (!tv) throw new Error('terminologia TISS não carregada no DEV');
  const [plan] = await exec<{ n: number }>(sql`SELECT count(*)::int AS n FROM public.plans WHERE code = 'clinica_2026_2'`);
  if (!plan?.n) throw new Error('plano clinica_2026_2 ausente no DEV');

  const accounts: Record<string, { email: string; password: string; userId: string; clinic: string; role: string }> = {};
  const add = async (key: string, clinicKey: string, clinicId: string, role: string, nome: string) => {
    const email = `e2e-hi-${key}@example.com`;
    const pass = password();
    const userId = await ensureUser(email, pass);
    await profile(userId, clinicId, nome, role);
    accounts[key] = { email, password: pass, userId, clinic: clinicKey, role };
    return userId;
  };

  const paga = await clinic('e2e-hi-paga', 'Clínica Sintética E2E Convênios');
  const trial = await clinic('e2e-hi-trial', 'Clínica Sintética E2E Trial');
  const suspensa = await clinic('e2e-hi-suspensa', 'Clínica Sintética E2E Suspensa');
  const gestor = await add('gestor', 'paga', paga, 'gestor', 'Gestora Sintética E2E');
  await add('recepcao', 'paga', paga, 'attendant', 'Recepção Sintética E2E');
  const medica = await add('medica', 'paga', paga, 'doctor', 'Dra. Sintética E2E');
  await add('gestor-trial', 'trial', trial, 'owner', 'Dona Trial E2E');
  await add('gestor-suspensa', 'suspensa', suspensa, 'gestor', 'Gestor Suspensa E2E');
  // Assinaturas depois das contas: o gatilho de trial (#53) exige o dono da clínica.
  await subscription(paga, 'paid');
  await subscription(trial, 'trial');
  // A suspensa nasce paga (habilita o módulo); cai no dunning no fim da fixture.
  await subscription(suspensa, 'paid');

  // Módulo habilitado na paga e na suspensa (a suspensa tinha operado antes do dunning).
  for (const c of [paga, suspensa]) {
    await exec(sql`
      INSERT INTO public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status, contractor_name)
      VALUES (${c}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared', 'Clínica Sintética E2E Ltda')
      ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, contractor_name = EXCLUDED.contractor_name`);
  }
  await exec(sql`
    INSERT INTO public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    VALUES (${paga}::uuid, ${medica}::uuid, '06', '12345', '35', '225125')
    ON CONFLICT DO NOTHING`);

  // Procedimentos, operadora, contratos.
  const proc = async (codigo: string, descricao: string, valor: number) => {
    const found = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.procedures WHERE clinic_id = ${paga}::uuid AND codigo = ${codigo}`);
    if (found[0]) return found[0].id;
    const [r] = await exec<{ id: string }>(sql`
      INSERT INTO public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      VALUES (${paga}::uuid, ${codigo}, ${descricao}, ${valor}, 30, true) RETURNING id::text AS id`);
    return r!.id;
  };
  const consulta = await proc('E2E-CONS', 'Consulta sintética E2E', 150);
  const psico = await proc('E2E-PSI', 'Psicoterapia sintética E2E', 120);
  let [ins] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_insurers WHERE clinic_id = ${paga}::uuid AND registro_ans = '999901'`);
  if (!ins) {
    [ins] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, sadt_grouping, created_by)
      VALUES (${paga}::uuid, 'Operadora Sintética E2E', '999901', 'codigoPrestadorNaOperadora', 'E2E0001', 'active', 'per_request', ${SYS}::uuid)
      RETURNING id::text AS id`);
    await exec(sql`
      INSERT INTO public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
        unit_value_cents, valid_from, requires_authorization, copay_kind, copay_fixed_cents, created_by)
      VALUES
        (${paga}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${consulta}::uuid, 15000, '2026-01-01', false, 'fixed', 3000, ${SYS}::uuid),
        (${paga}::uuid, ${ins!.id}::uuid, 'sp_sadt', '22', '50000470', 'Sessão de psicoterapia individual', ${psico}::uuid, 12000, '2026-01-01', true, 'none', null, ${SYS}::uuid),
        (${paga}::uuid, ${ins!.id}::uuid, 'sp_sadt', '22', '50000462', 'Sessão de psicoterapia em grupo', ${psico}::uuid, 8000, '2026-01-01', true, 'none', null, ${SYS}::uuid)`);
  }
  const insurerId = ins!.id;
  // P2.2: credenciamento da clínica e habilitação da médica em todos os planos (escolha explícita
  // da fixture), idempotente: só cria o que falta.
  await exec(sql`
    INSERT INTO public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    SELECT ${paga}::uuid, ${insurerId}::uuid, NULL, x.pro, '2026-01-01', 'active', ${SYS}::uuid
      FROM (VALUES (NULL::uuid), (${medica}::uuid)) AS x(pro)
     WHERE NOT EXISTS (SELECT 1 FROM public.hi_credentials c WHERE c.clinic_id = ${paga}::uuid AND c.insurer_id = ${insurerId}::uuid
                         AND c.plan_id IS NULL AND c.professional_id IS NOT DISTINCT FROM x.pro AND c.status = 'active')`);
  await exec(sql`
    INSERT INTO public.professional_payout_rules (clinic_id, professional_id, procedure_id, kind, percentage, created_by)
    SELECT ${paga}::uuid, ${medica}::uuid, NULL, 'percentage', 40, ${gestor}::uuid
     WHERE NOT EXISTS (SELECT 1 FROM public.professional_payout_rules WHERE clinic_id = ${paga}::uuid AND professional_id = ${medica}::uuid)`);

  // Pacientes e carteirinhas sintéticas (cifra e hash de busca REAIS do app).
  const patients: Array<{ id: string; membershipId: string; nome: string }> = [];
  for (const [i, nome] of ['Paciente Sintético E2E Um', 'Paciente Sintético E2E Dois', 'Paciente Sintético E2E Três'].entries()) {
    let [p] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.patients WHERE clinic_id = ${paga}::uuid AND nome = ${nome}`);
    if (!p) {
      [p] = await exec<{ id: string }>(sql`
        INSERT INTO public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        VALUES (${paga}::uuid, ${nome}, ${await encryptForTenant(paga, CPFS[i]!)}, ${await hashForLookup(CPFS[i]!)}) RETURNING id::text AS id`);
    }
    let [m] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_memberships WHERE clinic_id = ${paga}::uuid AND patient_id = ${p!.id}::uuid`);
    if (!m) {
      [m] = await exec<{ id: string }>(sql`
        INSERT INTO public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
        VALUES (${paga}::uuid, ${p!.id}::uuid, ${insurerId}::uuid, ${await encryptForTenant(paga, CARDS[i]!)},
          ${await hashForLookup(`${paga}:${CARDS[i]!}`)}, ${CARDS[i]!.slice(-4)}, ${SYS}::uuid)
        RETURNING id::text AS id`);
    }
    patients.push({ id: p!.id, membershipId: m!.id, nome });
  }

  // P3.2 (aba Convênios da ficha): um paciente por estado da aba, idempotente — sem nenhum
  // registro (vazio), com duas carteirinhas sendo uma vencida, da clínica em trial (contratável)
  // e da suspensa com carteirinha (consulta, sem operar). A suspensa recebe a operadora e a
  // carteirinha ANTES do dunning do fim da fixture, como uma clínica que operou e depois parou.
  const ensurePatient = async (clinicId: string, nome: string, cpf: string) => {
    const [found] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.patients WHERE clinic_id = ${clinicId}::uuid AND nome = ${nome}`);
    if (found) return found.id;
    const [r] = await exec<{ id: string }>(sql`
      INSERT INTO public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      VALUES (${clinicId}::uuid, ${nome}, ${await encryptForTenant(clinicId, cpf)}, ${await hashForLookup(cpf)}) RETURNING id::text AS id`);
    return r!.id;
  };
  const ensureCard = async (clinicId: string, patientId: string, insurer: string, card: string, validUntil: string | null) => {
    const hash = await hashForLookup(`${clinicId}:${card}`);
    const [found] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_memberships WHERE clinic_id = ${clinicId}::uuid AND card_number_hash = ${hash}`);
    if (found) return found.id;
    const [r] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, valid_until, created_by)
      VALUES (${clinicId}::uuid, ${patientId}::uuid, ${insurer}::uuid, ${await encryptForTenant(clinicId, card)}, ${hash}, ${card.slice(-4)},
        ${validUntil}::date, ${SYS}::uuid)
      RETURNING id::text AS id`);
    return r!.id;
  };
  const emptyPatient = await ensurePatient(paga, 'Paciente Sintético E2E Sem Convênio', TAB_CPFS[0]!);
  const multiPatient = await ensurePatient(paga, 'Paciente Sintético E2E Duas Carteirinhas', TAB_CPFS[1]!);
  await ensureCard(paga, multiPatient, insurerId, TAB_CARDS[0]!, '2030-12-31');
  await ensureCard(paga, multiPatient, insurerId, TAB_CARDS[1]!, '2026-01-31');
  const trialPatient = await ensurePatient(trial, 'Paciente Sintético E2E Trial', TAB_CPFS[2]!);
  let [insSusp] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_insurers WHERE clinic_id = ${suspensa}::uuid AND registro_ans = '999902'`);
  if (!insSusp) {
    [insSusp] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, sadt_grouping, created_by)
      VALUES (${suspensa}::uuid, 'Operadora Sintética E2E Suspensa', '999902', 'codigoPrestadorNaOperadora', 'E2E0002', 'active', 'per_request', ${SYS}::uuid)
      RETURNING id::text AS id`);
  }
  const suspensaPatient = await ensurePatient(suspensa, 'Paciente Sintético E2E Suspensa', TAB_CPFS[3]!);
  await ensureCard(suspensa, suspensaPatient, insSusp!.id, TAB_CARDS[2]!, '2030-12-31');
  const tabPatients = { empty: emptyPatient, multi: multiPatient, trial: trialPatient, suspensa: suspensaPatient };

  // Atendimentos de convênio: 2 consultas atendidas (guias de Consulta pelo serviço real) e
  // 2 sessões agendadas do paciente três (para ligar ao item de uma solicitação SP/SADT).
  const coverage = await import('../../src/contexts/health-insurance/internal/coverage-service');
  const guides = await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
  const appointments: Record<string, string> = {};
  const guideIds: string[] = [];
  const mk = async (key: string, patient: { id: string; membershipId: string }, procedureId: string, at: string, status: string) => {
    const found = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.appointments WHERE clinic_id = ${paga}::uuid AND observacoes = ${`e2e-hi:${key}`}`);
    if (found[0]) return (appointments[key] = found[0].id);
    const [a] = await exec<{ id: string }>(sql`
      INSERT INTO public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
        snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, observacoes)
      VALUES (${paga}::uuid, ${medica}::uuid, ${patient.id}::uuid, ${procedureId}::uuid, ${at}::timestamptz, 30, ${status}::appointment_status, 150,
        'Sintético E2E', 150, 30, 'Dra. Sintética E2E', 'attendant', ${`e2e-hi:${key}`})
      RETURNING id::text AS id`);
    return (appointments[key] = a!.id);
  };
  for (const [i, p] of patients.slice(0, 2).entries()) {
    const date = `2026-11-0${3 + i}`;
    const apId = await mk(`consulta-${i + 1}`, p, consulta, `${date}T13:00:00Z`, 'agendado');
    // A cobertura é registrada ANTES do atendimento começar (regra do domínio); depois ele é atendido.
    const [st] = await exec<{ status: string }>(sql`SELECT status::text AS status FROM public.appointments WHERE id = ${apId}::uuid`);
    if (st?.status === 'agendado') {
      await withTenant(paga, (tx) => coverage.recordAppointmentCoverage(tx, {
        clinicId: paga, appointmentId: apId, patientId: p.id, procedureId: consulta, appointmentDate: date, guideType: 'consulta',
        insurerId, planId: null, membershipId: p.membershipId, authorizationId: null, actor: { kind: 'user', userId: gestor },
      }), gestor);
      await exec(sql`UPDATE public.appointments SET status = 'atendido' WHERE id = ${apId}::uuid`);
    }
    const out = await withTenant(paga, async (tx) => {
      return guides.createConsultaGuideForAppointment(tx, {
        clinicId: paga,
        appointment: { id: apId, patientId: p.id, professionalId: medica, procedureId: consulta, date, billingMode: 'convenio' },
        coverage: { insurerId, planId: null, membershipId: p.membershipId },
        terminologyVersion: tv.version,
        actor: { kind: 'automation' },
      });
    }, gestor);
    if ('guideId' in out) guideIds.push((out as { guideId: string }).guideId);
  }
  await mk('sadt-1', patients[2]!, psico, '2026-11-20T13:00:00Z', 'agendado');
  await mk('sadt-2', patients[2]!, psico, '2026-11-27T13:00:00Z', 'agendado');
  await exec(sql`UPDATE public.appointments SET billing_mode = 'convenio' WHERE clinic_id = ${paga}::uuid AND observacoes IN ('e2e-hi:sadt-1', 'e2e-hi:sadt-2')`);

  // Dunning: período vencido e carência acabada (D24: só preservação).
  await exec(sql`UPDATE public.subscriptions SET billing_status = 'past_due', current_period_start = now() - interval '40 days',
      current_period_end = now() - interval '10 days', grace_period_until = now() - interval '3 days' WHERE clinic_id = ${suspensa}::uuid`);

  writeFileSync(accountsFile!, JSON.stringify(accounts, null, 1));
  writeFileSync(outFile!, JSON.stringify({ clinics: { paga, trial, suspensa }, insurerId, medica, gestor, patients: patients.map(({ id, membershipId }) => ({ id, membershipId })), tabPatients, appointments, guideIds, terminology: tv.version }, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: 3 clínicas, ${Object.keys(accounts).length} contas, ${patients.length} pacientes, ${guideIds.length} guias de Consulta em rascunho`);
}

/**
 * Clínica ZERADA para provar R44 (configuração pela interface): só o que NÃO é cadastro
 * da clínica — a clínica sintética, as contas, a assinatura paga e a habilitação
 * operacional do módulo (decisão do Qoro, registrada com o ator de sistema). Nenhuma
 * operadora, plano, contrato, perfil TISS, carteirinha, procedimento ou paciente: o E2E
 * cadastra tudo pela interface.
 *
 * Cada execução cria uma clínica sintética NOVA (`e2e-hi-config-<marca>`) e move as contas
 * para ela: nada é apagado. Guia emitida, arquivo, prontuário e lançamento das execuções
 * anteriores ficam intactos (retenção; o banco também impede apagar), e as clínicas
 * anteriores têm o módulo DESLIGADO (desligar não é operação nova no D24).
 */
async function setupConfig() {
  const accounts: Record<string, { email: string; password: string; userId: string; clinic: string; role: string }> = {};
  await exec(sql`UPDATE public.hi_clinic_settings SET enabled = false
                  WHERE enabled AND clinic_id IN (SELECT id FROM public.clinics WHERE slug LIKE 'e2e-hi-config%')`);
  const slug = `e2e-hi-config-${Date.now().toString(36)}`;
  const clinicId = await clinic(slug, 'Clínica Sintética E2E Configuração');
  const [own] = await exec<{ ok: boolean }>(sql`SELECT slug = ${slug} AS ok FROM public.clinics WHERE id = ${clinicId}::uuid`);
  if (!own?.ok) throw new Error('clínica inesperada');
  const add = async (key: string, role: string, nome: string) => {
    const email = `e2e-hi-${key}@example.com`;
    const pass = password();
    const userId = await ensureUser(email, pass);
    await profile(userId, clinicId, nome, role);
    await exec(sql`UPDATE public.profiles SET invite_accepted_at = coalesce(invite_accepted_at, now()) WHERE id = ${userId}::uuid`);
    accounts[key] = { email, password: pass, userId, clinic: 'config', role };
    return userId;
  };
  await add('cfg-gestor', 'gestor', 'Gestora Sintética Configuração');
  await add('cfg-recepcao', 'attendant', 'Recepção Sintética Configuração');
  const medica = await add('cfg-medica', 'doctor', 'Dra. Sintética Configuração');
  // Agenda BASE da médica (cadastro da Agenda, não do convênio): sem disponibilidade o encaixe é
  // recusado ("sem capacidade operacional"), como deve ser. Todos os dias, o dia inteiro.
  // A disponibilidade é única por profissional: a da médica (que mudou de clínica) vem junto.
  await exec(sql`UPDATE public.doctor_availability SET clinic_id = ${clinicId}::uuid WHERE doctor_id = ${medica}::uuid`);
  for (let weekday = 0; weekday < 7; weekday++) {
    await exec(sql`
      INSERT INTO public.doctor_availability (clinic_id, doctor_id, weekday, start_time, end_time)
      VALUES (${clinicId}::uuid, ${medica}::uuid, ${weekday}, '00:00', '23:59')
      ON CONFLICT DO NOTHING`);
  }
  await subscription(clinicId, 'paid');
  // Habilitação operacional (Qoro): módulo ligado; identificação do prestador VAZIA (a clínica preenche).
  await exec(sql`
    INSERT INTO public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, cnes_status)
    VALUES (${clinicId}::uuid, true, now(), ${SYS}::uuid, 'unknown')
    ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, enabled_at = now(), enabled_by = ${SYS}::uuid,
      provider_kind = NULL, contractor_name = NULL, cnes = NULL, cnes_status = 'unknown'`);
  writeFileSync(accountsFile!, JSON.stringify(accounts, null, 1));
  writeFileSync(outFile!, JSON.stringify({ clinicId, medica }, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: clínica nova ${slug} (nada de convênio cadastrado), ${Object.keys(accounts).length} contas, módulo habilitado; as anteriores ficaram intactas e desligadas`);
}

async function cleanup() {
  const admin = createAdminClient();
  const rows = await exec<{ id: string }>(sql`SELECT p.id::text AS id FROM public.profiles p JOIN public.clinics c ON c.id = p.clinic_id WHERE c.slug LIKE 'e2e-hi-%'`);
  for (const r of rows) await admin.auth.admin.updateUserById(r.id, { ban_duration: '876000h' });
  await exec(sql`UPDATE public.profiles SET ativo = false WHERE clinic_id IN (SELECT id FROM public.clinics WHERE slug LIKE 'e2e-hi-%')`);
  await exec(sql`UPDATE public.hi_clinic_settings SET enabled = false WHERE clinic_id IN (SELECT id FROM public.clinics WHERE slug LIKE 'e2e-hi-%')`);
  console.log(`[hi-dev-e2e-fixture] contas bloqueadas e módulo desligado nas clínicas e2e-hi-* (${rows.length} perfis)`);
}

// ── Regressões de estado (P0.3 de 15/11) ─────────────────────────────────────────────────────

/** Só a clínica paga das regressões: os comandos abaixo nunca alteram outra clínica. */
async function pagaClinic(): Promise<string> {
  const [c] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.clinics WHERE slug = 'e2e-hi-paga'`);
  if (!c) throw new Error('clínica e2e-hi-paga ausente (rode setup antes)');
  return c.id;
}

const pgCode = (e: unknown): string | undefined => {
  const x = e as { code?: string; cause?: { code?: string } };
  return x.code ?? x.cause?.code;
};

/**
 * Três guias de Consulta NOVAS na clínica paga, pelo serviço real (cobertura antes do atendimento,
 * atendimento concluído, guia montada): `ready1` e `ready2` para conferir e `pending1` com a
 * carteirinha vencida (pendência real do validador). Idempotente pela marca da execução; dias de
 * outubro/2026 que variam com a marca, porque a agenda da médica não aceita sobreposição.
 */
async function setupStates() {
  const run = arg('run');
  if (!run || !/^[A-Z0-9]{3,12}$/u.test(run)) throw new Error('--run <marca> obrigatório (A-Z e 0-9)');
  const paga = await pagaClinic();
  const accounts = JSON.parse(readFileSync(accountsFile!, 'utf8')) as Record<string, { userId: string; clinic: string }>;
  const medica = accounts.medica?.clinic === 'paga' ? accounts.medica.userId : undefined;
  const gestor = accounts.gestor?.clinic === 'paga' ? accounts.gestor.userId : undefined;
  if (!medica || !gestor) throw new Error('contas medica/gestor da clínica paga ausentes no arquivo de contas');
  const [tv] = await exec<{ version: string }>(sql`SELECT version FROM public.tiss_terminology_versions ORDER BY version DESC LIMIT 1`);
  const [ids] = await exec<{ insurer: string | null; consulta: string | null }>(sql`
    SELECT (SELECT id::text FROM public.hi_insurers WHERE clinic_id = ${paga}::uuid AND registro_ans = '999901') AS insurer,
           (SELECT id::text FROM public.procedures WHERE clinic_id = ${paga}::uuid AND codigo = 'E2E-CONS') AS consulta`);
  if (!tv || !ids?.insurer || !ids.consulta) throw new Error('clínica paga sem operadora/procedimento da fixture (rode setup antes)');
  const insurerId = ids.insurer;
  const consulta = ids.consulta;
  const card = async (patientName: string, cardNumber: string | null) => {
    const rows = await exec<{ patient: string; membership: string }>(sql`
      SELECT p.id::text AS patient, m.id::text AS membership
        FROM public.patients p JOIN public.hi_memberships m ON m.patient_id = p.id AND m.clinic_id = p.clinic_id
       WHERE p.clinic_id = ${paga}::uuid AND p.nome = ${patientName}
         AND (${cardNumber}::text IS NULL OR m.card_number_hash = ${cardNumber ? await hashForLookup(`${paga}:${cardNumber}`) : ''})
       ORDER BY m.created_at LIMIT 1`);
    if (!rows[0]) throw new Error(`carteirinha da fixture ausente (${patientName})`);
    return rows[0];
  };
  const coverage = await import('../../src/contexts/health-insurance/internal/coverage-service');
  const guides = await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
  const seed = [...run].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 997, 7);
  const make = async (key: string, who: { patient: string; membership: string }, hour: string) => {
    const tag = `e2e-hi:states-${run}-${key}`;
    let [ap] = await exec<{ id: string; date: string }>(sql`
      SELECT id::text AS id, to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date
        FROM public.appointments WHERE clinic_id = ${paga}::uuid AND observacoes = ${tag}`);
    for (let attempt = 0; !ap && attempt < 40; attempt++) {
      const date = new Date(Date.UTC(2026, 9, 1 + ((seed + attempt) % 30))).toISOString().slice(0, 10);
      try {
        [ap] = await exec<{ id: string; date: string }>(sql`
          INSERT INTO public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
            snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, observacoes)
          VALUES (${paga}::uuid, ${medica}::uuid, ${who.patient}::uuid, ${consulta}::uuid, ${`${date}T${hour}:00:00Z`}::timestamptz, 30,
            'agendado'::appointment_status, 150, 'Sintético E2E', 150, 30, 'Dra. Sintética E2E', 'attendant', ${tag})
          RETURNING id::text AS id, ${date}::text AS date`);
      } catch (e) {
        if (pgCode(e) !== '23P01') throw e; // horário ocupado: tenta o dia seguinte
      }
    }
    if (!ap) throw new Error('sem horário livre para a médica sintética em outubro/2026');
    const [st] = await exec<{ status: string }>(sql`SELECT status::text AS status FROM public.appointments WHERE id = ${ap.id}::uuid`);
    if (st?.status === 'agendado') {
      await withTenant(paga, (tx) => coverage.recordAppointmentCoverage(tx, {
        clinicId: paga, appointmentId: ap!.id, patientId: who.patient, procedureId: consulta, appointmentDate: ap!.date, guideType: 'consulta',
        insurerId, planId: null, membershipId: who.membership, authorizationId: null, actor: { kind: 'user', userId: gestor },
      }), gestor);
      await exec(sql`UPDATE public.appointments SET status = 'atendido' WHERE id = ${ap.id}::uuid`);
    }
    const out = await withTenant(paga, (tx) => guides.createConsultaGuideForAppointment(tx, {
      clinicId: paga,
      appointment: { id: ap!.id, patientId: who.patient, professionalId: medica, procedureId: consulta, date: ap!.date, billingMode: 'convenio' },
      coverage: { insurerId, planId: null, membershipId: who.membership },
      terminologyVersion: tv.version,
      actor: { kind: 'automation' },
    }), gestor);
    const guideId = (out as { guideId?: string }).guideId;
    if (!guideId) throw new Error(`guia não criada (${key})`);
    const [g] = await exec<{ status: string }>(sql`SELECT status FROM public.hi_guides WHERE id = ${guideId}::uuid`);
    return { id: guideId, status: g!.status, date: ap.date };
  };
  const out = {
    clinicId: paga,
    run,
    guides: {
      ready1: await make('ready-1', await card('Paciente Sintético E2E Um', null), '10'),
      ready2: await make('ready-2', await card('Paciente Sintético E2E Dois', null), '11'),
      pending1: await make('pending-1', await card('Paciente Sintético E2E Duas Carteirinhas', TAB_CARDS[1]!), '12'),
    },
  };
  writeFileSync(outFile!, JSON.stringify(out, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: 3 guias novas (${Object.values(out.guides).map((g) => g.status).join(', ')}) na clínica paga, marca ${run}`);
}

/** Estado comercial da clínica PAGA, no meio da execução (o spec restaura `paid` no fim). */
async function setState() {
  const state = arg('state');
  const paga = await pagaClinic();
  if (state === 'trial') {
    await exec(sql`UPDATE public.subscriptions SET billing_status = 'trial', trial_ends_at = now() + interval '10 days',
      enforce_trial_deadline = true WHERE clinic_id = ${paga}::uuid`);
  } else if (state === 'suspended') {
    await exec(sql`UPDATE public.clinics SET status = 'suspended_readonly', updated_at = now() WHERE id = ${paga}::uuid`);
  } else if (state === 'paid') {
    await exec(sql`UPDATE public.clinics SET status = 'active', updated_at = now() WHERE id = ${paga}::uuid`);
    await exec(sql`UPDATE public.subscriptions SET billing_status = 'active', trial_ends_at = NULL, enforce_trial_deadline = false,
      current_period_start = now() - interval '1 day', current_period_end = now() + interval '30 days', grace_period_until = NULL
      WHERE clinic_id = ${paga}::uuid`);
  } else {
    throw new Error('--state paid|trial|suspended');
  }
  const [d] = await exec<{ denial: string | null }>(sql`SELECT public.qoro_premium_denial_for(${paga}::uuid, 'health_insurance') AS denial`);
  console.log(`STATE ${JSON.stringify({ state, denial: d?.denial ?? null })}`);
}

/** Perfil ativo/desativado de uma conta e2e-hi-* (o spec reativa no fim). */
async function setActive() {
  const key = arg('account');
  const active = arg('active');
  if (!key || (active !== 'true' && active !== 'false')) throw new Error('--account <chave> --active true|false');
  const accounts = JSON.parse(readFileSync(accountsFile!, 'utf8')) as Record<string, { userId: string }>;
  const userId = accounts[key]?.userId;
  if (!userId) throw new Error(`conta ${key} ausente no arquivo de contas`);
  const rows = await exec<{ id: string }>(sql`
    UPDATE public.profiles SET ativo = ${active === 'true'}, updated_at = now()
     WHERE id = ${userId}::uuid AND clinic_id IN (SELECT id FROM public.clinics WHERE slug LIKE 'e2e-hi-%')
    RETURNING id::text AS id`);
  if (rows.length !== 1) throw new Error('perfil fora das clínicas e2e-hi-*: recusado');
  console.log(`ACTIVE ${JSON.stringify({ account: key, active: active === 'true' })}`);
}

/** Só leitura: o que o banco diz da guia (prova de que uma recusa não mudou nada). */
async function guideState() {
  const id = arg('guide');
  if (!id || !/^[0-9a-f-]{36}$/u.test(id)) throw new Error('--guide <uuid>');
  const [g] = await exec<{ status: string; version: number; adjusted: boolean; events: number; revisions: number }>(sql`
    SELECT g.status, g.version, (g.consulta_overrides IS NOT NULL) AS adjusted,
           (SELECT count(*)::int FROM public.hi_guide_events e WHERE e.guide_id = g.id) AS events,
           (SELECT count(*)::int FROM public.hi_guide_snapshots s WHERE s.guide_id = g.id) AS revisions
      FROM public.hi_guides g JOIN public.clinics c ON c.id = g.clinic_id AND c.slug LIKE 'e2e-hi-%'
     WHERE g.id = ${id}::uuid`);
  if (!g) throw new Error('guia fora das clínicas e2e-hi-*');
  console.log(`GUIDE_STATE ${JSON.stringify(g)}`);
}

/**
 * P6.3: duas autorizações de Consulta NOVAS na clínica paga, pelos serviços reais da P6.1: uma
 * aguardando a operadora (para registrar a resposta na tela) e uma concedida com a senha vencendo
 * amanhã (alerta da P6.6 na fila). Cada execução cria as suas; a marca vai no número da operadora.
 */
async function setupAuthorizations() {
  const run = arg('run');
  if (!run || !/^[A-Z0-9]{3,12}$/u.test(run)) throw new Error('--run <marca> obrigatório (A-Z e 0-9)');
  const paga = await pagaClinic();
  const accounts = JSON.parse(readFileSync(accountsFile!, 'utf8')) as Record<string, { userId: string; clinic: string }>;
  const gestor = accounts.gestor?.clinic === 'paga' ? accounts.gestor.userId : undefined;
  if (!gestor) throw new Error('conta gestor da clínica paga ausente no arquivo de contas');
  const [ctx] = await exec<{ insurer: string | null; membership: string | null; today: string; tomorrow: string }>(sql`
    SELECT (SELECT id::text FROM public.hi_insurers WHERE clinic_id = ${paga}::uuid AND registro_ans = '999901') AS insurer,
           (SELECT m.id::text FROM public.hi_memberships m JOIN public.patients p ON p.id = m.patient_id AND p.clinic_id = m.clinic_id
             WHERE m.clinic_id = ${paga}::uuid AND p.nome = 'Paciente Sintético E2E Um' ORDER BY m.created_at LIMIT 1) AS membership,
           (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS today,
           ((now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date + 1)::text AS tomorrow
      FROM public.clinics c WHERE c.id = ${paga}::uuid`);
  if (!ctx?.insurer || !ctx.membership) throw new Error('clínica paga sem operadora/carteirinha da fixture (rode setup antes)');
  const auths = await import('../../src/contexts/health-insurance/internal/authorizations');
  const request = () =>
    withTenant(paga, (tx) => auths.requestManualAuthorizationTx(tx, {
      clinicId: paga, insurerId: ctx.insurer!, membershipId: ctx.membership!, requestedOn: ctx.today,
      items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: gestor,
    }), gestor);
  const waiting = await request();
  const expiring = await request();
  const [item] = await exec<{ id: string }>(sql`
    SELECT id::text AS id FROM public.hi_authorization_items WHERE authorization_id = ${expiring.authorizationId}::uuid`);
  await withTenant(paga, (tx) => auths.recordManualAuthorizationResponseTx(tx, {
    decision: 'authorized', clinicId: paga, authorizationId: expiring.authorizationId, version: 1, authorizedOn: ctx.today,
    operatorGuideNumber: `E2E${run}`, passwordValidUntil: ctx.tomorrow, items: [{ itemId: item!.id, quantityAuthorized: 1 }], actorUserId: gestor,
  }), gestor);
  const out = { clinicId: paga, run, waiting: waiting.authorizationId, expiring: expiring.authorizationId, tomorrow: ctx.tomorrow };
  writeFileSync(outFile!, JSON.stringify(out, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: 2 autorizações de Consulta (aguardando e vencendo amanhã) na clínica paga, marca ${run}`);
}

/**
 * Matriz I.2 no Preview (17/11): clínica PRÓPRIA `e2e-hi-i2`, no plano legado `clinica` (permissões
 * granulares e sem teto de assentos), com um perfil por papel da matriz — dona, gestora, recepção,
 * financeiro, duas médicas, uma pessoa SEM `view:convenios` (negativa individual) e uma desativada.
 * Dados da execução (marca): uma guia de Consulta de cada médica e um atendimento futuro de convênio
 * de cada médica, ainda sem cobertura (D-3). "Outra clínica" é a gestora da `e2e-hi-paga`.
 */
async function setupI2() {
  const run = arg('run');
  if (!run || !/^[A-Z0-9]{3,12}$/u.test(run)) throw new Error('--run <marca> obrigatório (A-Z e 0-9)');
  const [tv] = await exec<{ version: string }>(sql`SELECT version FROM public.tiss_terminology_versions ORDER BY version DESC LIMIT 1`);
  if (!tv) throw new Error('terminologia TISS não carregada no DEV');
  const i2 = await clinic('e2e-hi-i2', 'Clínica Sintética E2E Matriz');
  const accounts: Record<string, { email: string; password: string; userId: string; clinic: string; role: string }> = {};
  const add = async (key: string, role: string, nome: string) => {
    const email = `e2e-hi-${key}@example.com`;
    const pass = password();
    const userId = await ensureUser(email, pass);
    await profile(userId, i2, nome, role);
    accounts[key] = { email, password: pass, userId, clinic: 'i2', role };
    return userId;
  };
  // Assinatura paga no plano legado ANTES dos perfis (o teto de assentos é dos planos 2026).
  await exec(sql`DELETE FROM public.subscriptions WHERE clinic_id = ${i2}::uuid`);
  const sub = await exec(sql`
    INSERT INTO public.subscriptions (clinic_id, plan_id, price_id, billing_status, current_period_start, current_period_end)
    SELECT ${i2}::uuid, pl.id, pr.id, 'active', now() - interval '1 day', now() + interval '30 days'
      FROM public.plans pl JOIN public.prices pr ON pr.plan_id = pl.id
     WHERE pl.code = 'clinica' ORDER BY pr.id LIMIT 1 RETURNING id`);
  if (sub.length !== 1) throw new Error('plano legado clinica ausente no DEV');
  const owner = await add('i2-owner', 'owner', 'Dona Matriz E2E');
  const gestor = await add('i2-gestor', 'gestor', 'Gestora Matriz E2E');
  await add('i2-recepcao', 'attendant', 'Recepção Matriz E2E');
  await add('i2-financeiro', 'financial', 'Financeiro Matriz E2E');
  const medica = await add('i2-medica', 'doctor', 'Dra. Matriz Um E2E');
  const medica2 = await add('i2-medica2', 'doctor', 'Dra. Matriz Dois E2E');
  const semperm = await add('i2-semperm', 'doctor', 'Dra. Sem Convênios E2E');
  const desativado = await add('i2-desativado', 'attendant', 'Recepção Desativada E2E');
  // Estado conhecido das exceções: só a negativa de `view:convenios` da pessoa sem permissão.
  await exec(sql`DELETE FROM public.user_permission_overrides WHERE clinic_id = ${i2}::uuid`);
  await exec(sql`
    INSERT INTO public.user_permission_overrides (user_id, clinic_id, permission_code, granted, granted_by)
    VALUES (${semperm}::uuid, ${i2}::uuid, 'view:convenios', false, ${owner}::uuid)`);
  await exec(sql`UPDATE public.profiles SET ativo = false, updated_at = now() WHERE id = ${desativado}::uuid AND clinic_id = ${i2}::uuid`);

  await exec(sql`
    INSERT INTO public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status, contractor_name)
    VALUES (${i2}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared', 'Clínica Sintética Matriz E2E Ltda')
    ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, contractor_name = EXCLUDED.contractor_name`);
  for (const [doc, num] of [[medica, '22345'], [medica2, '22346']] as const) {
    await exec(sql`
      INSERT INTO public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
      VALUES (${i2}::uuid, ${doc}::uuid, '06', ${num}, '35', '225125') ON CONFLICT DO NOTHING`);
  }
  let [proc] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.procedures WHERE clinic_id = ${i2}::uuid AND codigo = 'E2E-CONS'`);
  if (!proc) {
    [proc] = await exec<{ id: string }>(sql`
      INSERT INTO public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      VALUES (${i2}::uuid, 'E2E-CONS', 'Consulta sintética E2E', 150, 30, true) RETURNING id::text AS id`);
  }
  const consulta = proc!.id;
  let [ins] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_insurers WHERE clinic_id = ${i2}::uuid AND registro_ans = '999903'`);
  if (!ins) {
    [ins] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, sadt_grouping, created_by)
      VALUES (${i2}::uuid, 'Operadora Sintética Matriz', '999903', 'codigoPrestadorNaOperadora', 'E2E0003', 'active', 'per_request', ${SYS}::uuid)
      RETURNING id::text AS id`);
    await exec(sql`
      INSERT INTO public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
        unit_value_cents, valid_from, requires_authorization, copay_kind, copay_fixed_cents, created_by)
      VALUES (${i2}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${consulta}::uuid, 17350, '2026-01-01', false, 'none', null, ${SYS}::uuid)`);
  }
  const insurerId = ins!.id;
  await exec(sql`
    INSERT INTO public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    SELECT ${i2}::uuid, ${insurerId}::uuid, NULL, x.pro, '2026-01-01', 'active', ${SYS}::uuid
      FROM (VALUES (NULL::uuid), (${medica}::uuid), (${medica2}::uuid)) AS x(pro)
     WHERE NOT EXISTS (SELECT 1 FROM public.hi_credentials c WHERE c.clinic_id = ${i2}::uuid AND c.insurer_id = ${insurerId}::uuid
                         AND c.plan_id IS NULL AND c.professional_id IS NOT DISTINCT FROM x.pro AND c.status = 'active')`);

  const I2_CPFS = ['577215664', '693147180'].map(cpfOf);
  const I2_CARDS = ['0081234500033331', '0081234500033332'];
  const people: Array<{ patient: string; membership: string }> = [];
  for (const [i, nome] of ['Paciente Sintético Matriz Um', 'Paciente Sintético Matriz Dois'].entries()) {
    let [p] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.patients WHERE clinic_id = ${i2}::uuid AND nome = ${nome}`);
    if (!p) {
      [p] = await exec<{ id: string }>(sql`
        INSERT INTO public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        VALUES (${i2}::uuid, ${nome}, ${await encryptForTenant(i2, I2_CPFS[i]!)}, ${await hashForLookup(I2_CPFS[i]!)}) RETURNING id::text AS id`);
    }
    const hash = await hashForLookup(`${i2}:${I2_CARDS[i]!}`);
    let [m] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_memberships WHERE clinic_id = ${i2}::uuid AND card_number_hash = ${hash}`);
    if (!m) {
      [m] = await exec<{ id: string }>(sql`
        INSERT INTO public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
        VALUES (${i2}::uuid, ${p!.id}::uuid, ${insurerId}::uuid, ${await encryptForTenant(i2, I2_CARDS[i]!)}, ${hash}, ${I2_CARDS[i]!.slice(-4)}, ${SYS}::uuid)
        RETURNING id::text AS id`);
    }
    people.push({ patient: p!.id, membership: m!.id });
  }

  const coverage = await import('../../src/contexts/health-insurance/internal/coverage-service');
  const guides = await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
  const seed = [...run].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 997, 7);
  /** Atendimento novo num dia livre da profissional (a agenda recusa sobreposição: tenta o dia seguinte). */
  const appointment = async (key: string, doctor: string, doctorName: string, who: { patient: string }, month: number, hour: string) => {
    const tag = `e2e-hi:i2-${run}-${key}`;
    let [ap] = await exec<{ id: string; date: string }>(sql`
      SELECT id::text AS id, to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date
        FROM public.appointments WHERE clinic_id = ${i2}::uuid AND observacoes = ${tag}`);
    for (let attempt = 0; !ap && attempt < 40; attempt++) {
      const date = new Date(Date.UTC(2026, month, 1 + ((seed + attempt) % 28))).toISOString().slice(0, 10);
      try {
        [ap] = await exec<{ id: string; date: string }>(sql`
          INSERT INTO public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
            snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, observacoes)
          VALUES (${i2}::uuid, ${doctor}::uuid, ${who.patient}::uuid, ${consulta}::uuid, ${`${date}T${hour}:00:00Z`}::timestamptz, 30,
            'agendado'::appointment_status, 150, 'Sintético E2E', 150, 30, ${doctorName}, 'attendant', ${tag})
          RETURNING id::text AS id, ${date}::text AS date`);
      } catch (e) {
        if (pgCode(e) !== '23P01') throw e;
      }
    }
    if (!ap) throw new Error(`sem horário livre (${key})`);
    return ap;
  };
  const guide = async (key: string, doctor: string, doctorName: string, who: { patient: string; membership: string }, hour: string) => {
    const ap = await appointment(key, doctor, doctorName, who, 9, hour);
    const [st] = await exec<{ status: string }>(sql`SELECT status::text AS status FROM public.appointments WHERE id = ${ap.id}::uuid`);
    if (st?.status === 'agendado') {
      await withTenant(i2, (tx) => coverage.recordAppointmentCoverage(tx, {
        clinicId: i2, appointmentId: ap.id, patientId: who.patient, procedureId: consulta, appointmentDate: ap.date, guideType: 'consulta',
        insurerId, planId: null, membershipId: who.membership, authorizationId: null, actor: { kind: 'user', userId: gestor },
      }), gestor);
      await exec(sql`UPDATE public.appointments SET status = 'atendido' WHERE id = ${ap.id}::uuid`);
    }
    const out = await withTenant(i2, (tx) => guides.createConsultaGuideForAppointment(tx, {
      clinicId: i2,
      appointment: { id: ap.id, patientId: who.patient, professionalId: doctor, procedureId: consulta, date: ap.date, billingMode: 'convenio' },
      coverage: { insurerId, planId: null, membershipId: who.membership },
      terminologyVersion: tv.version,
      actor: { kind: 'automation' },
    }), gestor);
    const guideId = (out as { guideId?: string }).guideId;
    if (!guideId) throw new Error(`guia não criada (${key})`);
    const [g] = await exec<{ status: string }>(sql`SELECT status FROM public.hi_guides WHERE id = ${guideId}::uuid`);
    return { id: guideId, status: g!.status };
  };
  const future = async (key: string, doctor: string, doctorName: string, who: { patient: string }, hour: string) => {
    const ap = await appointment(key, doctor, doctorName, who, 11, hour);
    await exec(sql`UPDATE public.appointments SET billing_mode = 'convenio' WHERE id = ${ap.id}::uuid AND clinic_id = ${i2}::uuid`);
    return ap.id;
  };
  const out = {
    clinicId: i2,
    run,
    insurerId,
    insurerName: 'Operadora Sintética Matriz',
    value: '173,50',
    patients: { own: people[0]!.patient, other: people[1]!.patient },
    guides: {
      own: await guide('guia-a', medica, 'Dra. Matriz Um E2E', people[0]!, '10'),
      other: await guide('guia-b', medica2, 'Dra. Matriz Dois E2E', people[1]!, '10'),
    },
    appointments: {
      own: await future('futuro-a', medica, 'Dra. Matriz Um E2E', people[0]!, '13'),
      other: await future('futuro-b', medica2, 'Dra. Matriz Dois E2E', people[1]!, '13'),
    },
  };
  writeFileSync(accountsFile!, JSON.stringify(accounts, null, 1));
  writeFileSync(outFile!, JSON.stringify(out, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: clínica e2e-hi-i2, ${Object.keys(accounts).length} contas, guias ${out.guides.own.status}/${out.guides.other.status}, marca ${run}`);
}

/**
 * P6.6 — prova da ENTREGA dos avisos no DEV, pelo caminho real (17/11). Clínica sintética própria
 * `e2e-hi-alertas` (módulo ligado, assinatura paga) com três pessoas cujos e-mails são aliases do
 * inbound CONSENTIDO do Resend de DEV (`E2E_RESEND_INBOX_ADDRESS`): a recepção ativa (opera), uma
 * recepção desativada e uma médica (não opera). Uma autorização com a senha vencendo amanhã.
 *
 *   1. a manutenção (a mesma do fim do financial-reconcile) cria o aviso e põe o pedido no outbox,
 *      sem ninguém abrir a tela;
 *   2. o worker do outbox, só para ESTE evento, roda o handler real e envia pelo Resend de DEV;
 *   3. o Resend confirma `delivered`, e o inbound recebe o e-mail com a contagem e sem dado de
 *      paciente;
 *   4. a desativada e a médica não recebem nada;
 *   5. rodar de novo não cria aviso nem e-mail; marcar como visto grava a pessoa.
 * Nada é impresso além de contagens e estados (nem endereço, nem corpo).
 */
async function deliverAlerts() {
  const run = arg('run');
  if (!run || !/^[A-Z0-9]{3,12}$/u.test(run)) throw new Error('--run <marca> obrigatório (A-Z e 0-9)');
  const inbox = process.env.E2E_RESEND_INBOX_ADDRESS;
  const apiKey = process.env.RESEND_API_KEY ?? process.env.RESEND_API_KEY_DEV;
  if (!inbox || !apiKey) throw new Error('E2E_RESEND_INBOX_ADDRESS e a chave Resend de DEV são obrigatórias');
  const inspector = await import('../../src/lib/email/resend-inspector');
  const alias = (who: string) => inspector.createResendInboxAlias(inbox, `hi-${run}-${who}`.toLowerCase());
  const [tv] = await exec<{ version: string }>(sql`SELECT version FROM public.tiss_terminology_versions ORDER BY version DESC LIMIT 1`);
  if (!tv) throw new Error('terminologia TISS não carregada no DEV');

  const clinicId = await clinic('e2e-hi-alertas', 'Clínica Sintética E2E Avisos');
  await subscription(clinicId, 'paid');
  const people: Record<string, string> = {};
  for (const [key, role, nome] of [
    ['recepcao', 'attendant', 'Recepção Avisos E2E'],
    ['desligada', 'attendant', 'Recepção Desligada Avisos E2E'],
    ['medica', 'doctor', 'Dra. Avisos E2E'],
  ] as const) {
    const userId = await ensureUser(alias(key), password());
    await profile(userId, clinicId, nome, role);
    people[key] = userId;
  }
  await exec(sql`UPDATE public.profiles SET ativo = false, updated_at = now() WHERE id = ${people.desligada!}::uuid AND clinic_id = ${clinicId}::uuid`);
  await exec(sql`
    INSERT INTO public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status, contractor_name)
    VALUES (${clinicId}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared', 'Clínica Sintética Avisos E2E Ltda')
    ON CONFLICT (clinic_id) DO UPDATE SET enabled = true`);
  let [ins] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_insurers WHERE clinic_id = ${clinicId}::uuid AND registro_ans = '999904'`);
  if (!ins) {
    [ins] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, sadt_grouping, created_by)
      VALUES (${clinicId}::uuid, 'Operadora Sintética Avisos', '999904', 'codigoPrestadorNaOperadora', 'E2E0004', 'active', 'per_request', ${SYS}::uuid)
      RETURNING id::text AS id`);
  }
  const patientName = 'Paciente Sintético Avisos Um';
  let [p] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.patients WHERE clinic_id = ${clinicId}::uuid AND nome = ${patientName}`);
  if (!p) {
    const cpf = cpfOf('662607015');
    [p] = await exec<{ id: string }>(sql`
      INSERT INTO public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      VALUES (${clinicId}::uuid, ${patientName}, ${await encryptForTenant(clinicId, cpf)}, ${await hashForLookup(cpf)}) RETURNING id::text AS id`);
  }
  const card = '0081234500044441';
  const hash = await hashForLookup(`${clinicId}:${card}`);
  let [m] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_memberships WHERE clinic_id = ${clinicId}::uuid AND card_number_hash = ${hash}`);
  if (!m) {
    [m] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      VALUES (${clinicId}::uuid, ${p!.id}::uuid, ${ins!.id}::uuid, ${await encryptForTenant(clinicId, card)}, ${hash}, '4441', ${SYS}::uuid)
      RETURNING id::text AS id`);
  }
  const [ctx] = await exec<{ today: string; tomorrow: string }>(sql`
    SELECT (now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date::text AS today,
           ((now() AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'))::date + 1)::text AS tomorrow
      FROM public.clinics c WHERE c.id = ${clinicId}::uuid`);
  // Só os avisos desta execução: os abertos de execuções anteriores são encerrados antes (o banco grava).
  await withTenant(clinicId, (tx) => tx.execute(sql`
    UPDATE public.hi_authorization_alerts SET status = 'cancelled', cancel_reason = 'obsolete'
     WHERE clinic_id = ${clinicId}::uuid AND status = 'open'`));
  const auths = await import('../../src/contexts/health-insurance/internal/authorizations');
  const recep = people.recepcao!;
  const { authorizationId } = await withTenant(clinicId, (tx) => auths.requestManualAuthorizationTx(tx, {
    clinicId, insurerId: ins!.id, membershipId: m!.id, requestedOn: ctx!.today,
    items: [{ tableCode: '22', procedureCode: '10101012', quantityRequested: 1 }], actorUserId: recep,
  }), recep);
  const [item] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_authorization_items WHERE authorization_id = ${authorizationId}::uuid`);
  await withTenant(clinicId, (tx) => auths.recordManualAuthorizationResponseTx(tx, {
    decision: 'authorized', clinicId, authorizationId, version: 1, authorizedOn: ctx!.today,
    operatorGuideNumber: `AV${run}`, passwordValidUntil: ctx!.tomorrow, items: [{ itemId: item!.id, quantityAuthorized: 1 }], actorUserId: recep,
  }), recep);

  // 1. A manutenção cria o aviso e pede a entrega.
  const maint = await import('../../src/contexts/health-insurance/maintenance');
  const now = new Date();
  now.setUTCMinutes(5);
  const startedAt = new Date(Date.now() - 5_000);
  const r1 = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 50_000, now, clinics: [clinicId] });
  const [ob] = await exec<{ key: string; payload: { count: number } }>(sql`
    SELECT idempotency_key AS key, payload FROM public.outbox
     WHERE clinic_id = ${clinicId}::uuid AND event_type = 'health_insurance.authorization_alerts.delivery_requested' AND status = 'pending'
     ORDER BY created_at DESC LIMIT 1`);
  if (!ob) throw new Error('a manutenção não pôs o pedido de entrega no outbox');

  // 2. O worker do outbox, só para este evento, com o handler real.
  await import('../../src/app/api/cron/outbox/insurance-alerts-delivery-handler');
  const { runOutboxEventsNow } = await import('../../src/lib/outbox/worker');
  const tick = await runOutboxEventsNow([{ eventType: 'health_insurance.authorization_alerts.delivery_requested', idempotencyKeys: [ob.key] }]);

  // 3. Resend: entregue e recebido no inbound, com a contagem e sem dado de paciente.
  const subject = `Qoro: ${ob.payload.count === 1 ? '1 aviso de autorização de convênio' : `${ob.payload.count} avisos de autorização de convênio`}`;
  const sent = await inspector.waitForResendEmail({
    apiKey, to: alias('recepcao'), subject, sentAfter: startedAt, kind: 'sent', timeoutMs: 90_000,
    acceptedLastEvents: ['delivered', 'opened', 'clicked'], rejectedLastEvents: ['bounced', 'complained', 'canceled', 'failed'],
  });
  const received = await inspector.waitForResendEmail({ apiKey, to: alias('recepcao'), subject, sentAfter: startedAt, kind: 'received', timeoutMs: 90_000 });
  const body = `${received.text ?? ''} ${received.html ?? ''}`;
  const content = {
    countLine: body.includes('autorização com a senha vencendo') || body.includes('autorizações com a senha vencendo'),
    noPatient: !body.includes(patientName) && !body.includes(card) && !body.includes('4441'),
    noPassword: !/senha:\s*\S/iu.test(body),
  };

  // 4. Desativada e médica: nada.
  const nothingFor = async (who: string) => {
    try {
      await inspector.waitForResendEmail({ apiKey, to: alias(who), subject, sentAfter: startedAt, kind: 'sent', timeoutMs: 15_000 });
      return false;
    } catch {
      return true;
    }
  };
  const silent = { desligada: await nothingFor('desligada'), medica: await nothingFor('medica') };

  // 5. Estado no banco; segunda rodada; marcar como visto.
  const [alert] = await exec<{ id: string; status: string; delivered: boolean; attempts: number }>(sql`
    SELECT id::text AS id, status, delivered_at IS NOT NULL AS delivered, delivery_attempts AS attempts
      FROM public.hi_authorization_alerts WHERE clinic_id = ${clinicId}::uuid AND authorization_id = ${authorizationId}::uuid`);
  const r2 = await maint.runInsuranceMaintenance({ deadlineAt: Date.now() + 50_000, now, clinics: [clinicId] });
  const svc = await import('../../src/contexts/health-insurance/internal/authorization-alert-service');
  await withTenant(clinicId, (tx) => svc.markAuthorizationAlertReadTx(tx, clinicId, alert!.id), recep);
  const [seen] = await exec<{ status: string; reader_ok: boolean }>(sql`
    SELECT status, read_by = ${recep}::uuid AS reader_ok FROM public.hi_authorization_alerts WHERE id = ${alert!.id}::uuid`);

  const out = {
    run,
    maintenance: { created: r1.alertsCreated, queued: r1.alertsQueued },
    outbox: { processed: tick.processed, failed: tick.failed },
    resend: { delivered: ['delivered', 'opened', 'clicked'].includes(sent.lastEvent ?? ''), received: true, ...content },
    silent,
    alert: { delivered: alert!.delivered, attempts: alert!.attempts },
    second: { created: r2.alertsCreated, queued: r2.alertsQueued },
    read: { status: seen!.status, readerIsSession: seen!.reader_ok },
  };
  writeFileSync(outFile!, JSON.stringify(out, null, 1));
  const ok = r1.alertsCreated >= 1 && tick.processed === 1 && out.resend.delivered && content.countLine && content.noPatient && content.noPassword
    && silent.desligada && silent.medica && alert!.delivered && r2.alertsCreated === 0 && r2.alertsQueued === 0
    && seen!.status === 'read' && seen!.reader_ok;
  console.log(`DELIVER_ALERTS ${JSON.stringify(out)}`);
  if (!ok) throw new Error('a prova da entrega dos avisos não fechou (ver DELIVER_ALERTS)');
  console.log('[hi-dev-e2e-fixture] ok: aviso criado pela manutenção, entregue pelo Resend de DEV, recebido no inbound, sem dado de paciente');
}

/**
 * P7.5 no Preview (17/11): clínica sintética PRÓPRIA `e2e-hi-p75` (para o lote não levar guias das
 * outras provas) com gestora, recepção e médica, uma operadora e DUAS guias de Consulta novas para
 * conferir, da marca da execução. O spec confere, aprova, monta o lote, gera o XML, registra o envio
 * e o protocolo pela tela, e então pede o cancelamento e cria a substituta.
 */
async function setupP75() {
  const run = arg('run');
  if (!run || !/^[A-Z0-9]{3,12}$/u.test(run)) throw new Error('--run <marca> obrigatório (A-Z e 0-9)');
  const [tv] = await exec<{ version: string }>(sql`SELECT version FROM public.tiss_terminology_versions ORDER BY version DESC LIMIT 1`);
  if (!tv) throw new Error('terminologia TISS não carregada no DEV');
  const c = await clinic('e2e-hi-p75', 'Clínica Sintética E2E Substituição');
  await subscription(c, 'paid');
  const accounts: Record<string, { email: string; password: string; userId: string; clinic: string; role: string }> = {};
  const add = async (key: string, role: string, nome: string) => {
    const email = `e2e-hi-${key}@example.com`;
    const pass = password();
    const userId = await ensureUser(email, pass);
    await profile(userId, c, nome, role);
    accounts[key] = { email, password: pass, userId, clinic: 'p75', role };
    return userId;
  };
  const gestor = await add('p75-gestor', 'gestor', 'Gestora Substituição E2E');
  await add('p75-recepcao', 'attendant', 'Recepção Substituição E2E');
  const medica = await add('p75-medica', 'doctor', 'Dra. Substituição E2E');
  await exec(sql`
    INSERT INTO public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status, contractor_name)
    VALUES (${c}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared', 'Clínica Sintética Substituição E2E Ltda')
    ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, contractor_name = EXCLUDED.contractor_name`);
  await exec(sql`
    INSERT INTO public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
    VALUES (${c}::uuid, ${medica}::uuid, '06', '32345', '35', '225125') ON CONFLICT DO NOTHING`);
  let [proc] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.procedures WHERE clinic_id = ${c}::uuid AND codigo = 'E2E-CONS'`);
  if (!proc) {
    [proc] = await exec<{ id: string }>(sql`
      INSERT INTO public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      VALUES (${c}::uuid, 'E2E-CONS', 'Consulta sintética E2E', 150, 30, true) RETURNING id::text AS id`);
  }
  const insurerName = 'Operadora Sintética Substituição';
  let [ins] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_insurers WHERE clinic_id = ${c}::uuid AND registro_ans = '999905'`);
  if (!ins) {
    [ins] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, sadt_grouping, created_by)
      VALUES (${c}::uuid, ${insurerName}, '999905', 'codigoPrestadorNaOperadora', 'E2E0005', 'active', 'per_request', ${SYS}::uuid)
      RETURNING id::text AS id`);
    await exec(sql`
      INSERT INTO public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
        unit_value_cents, valid_from, requires_authorization, copay_kind, copay_fixed_cents, created_by)
      VALUES (${c}::uuid, ${ins!.id}::uuid, 'consulta', '22', '10101012', 'Consulta em consultório', ${proc!.id}::uuid, 16000, '2026-01-01', false, 'none', null, ${SYS}::uuid)`);
  }
  const insurerId = ins!.id;
  await exec(sql`
    INSERT INTO public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    SELECT ${c}::uuid, ${insurerId}::uuid, NULL, x.pro, '2026-01-01', 'active', ${SYS}::uuid
      FROM (VALUES (NULL::uuid), (${medica}::uuid)) AS x(pro)
     WHERE NOT EXISTS (SELECT 1 FROM public.hi_credentials k WHERE k.clinic_id = ${c}::uuid AND k.insurer_id = ${insurerId}::uuid
                         AND k.plan_id IS NULL AND k.professional_id IS NOT DISTINCT FROM x.pro AND k.status = 'active')`);
  const P75_CPFS = ['602214076', '161803399'].map(cpfOf);
  const P75_CARDS = ['0081234500055551', '0081234500055552'];
  const people: Array<{ patient: string; membership: string }> = [];
  for (const [i, nome] of ['Paciente Sintético Substituição Um', 'Paciente Sintético Substituição Dois'].entries()) {
    let [p] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.patients WHERE clinic_id = ${c}::uuid AND nome = ${nome}`);
    if (!p) {
      [p] = await exec<{ id: string }>(sql`
        INSERT INTO public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
        VALUES (${c}::uuid, ${nome}, ${await encryptForTenant(c, P75_CPFS[i]!)}, ${await hashForLookup(P75_CPFS[i]!)}) RETURNING id::text AS id`);
    }
    const hash = await hashForLookup(`${c}:${P75_CARDS[i]!}`);
    let [m] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_memberships WHERE clinic_id = ${c}::uuid AND card_number_hash = ${hash}`);
    if (!m) {
      [m] = await exec<{ id: string }>(sql`
        INSERT INTO public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
        VALUES (${c}::uuid, ${p!.id}::uuid, ${insurerId}::uuid, ${await encryptForTenant(c, P75_CARDS[i]!)}, ${hash}, ${P75_CARDS[i]!.slice(-4)}, ${SYS}::uuid)
        RETURNING id::text AS id`);
    }
    people.push({ patient: p!.id, membership: m!.id });
  }
  const coverage = await import('../../src/contexts/health-insurance/internal/coverage-service');
  const guides = await import('../../src/contexts/health-insurance/internal/consulta-guide-service');
  const seed = [...run].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 997, 7);
  const guide = async (key: string, who: { patient: string; membership: string }, hour: string) => {
    const tag = `e2e-hi:p75-${run}-${key}`;
    let [ap] = await exec<{ id: string; date: string }>(sql`
      SELECT id::text AS id, to_char(scheduled_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date
        FROM public.appointments WHERE clinic_id = ${c}::uuid AND observacoes = ${tag}`);
    for (let attempt = 0; !ap && attempt < 40; attempt++) {
      const date = new Date(Date.UTC(2026, 9, 1 + ((seed + attempt) % 28))).toISOString().slice(0, 10);
      try {
        [ap] = await exec<{ id: string; date: string }>(sql`
          INSERT INTO public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
            snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, observacoes)
          VALUES (${c}::uuid, ${medica}::uuid, ${who.patient}::uuid, ${proc!.id}::uuid, ${`${date}T${hour}:00:00Z`}::timestamptz, 30,
            'agendado'::appointment_status, 150, 'Sintético E2E', 150, 30, 'Dra. Substituição E2E', 'attendant', ${tag})
          RETURNING id::text AS id, ${date}::text AS date`);
      } catch (e) {
        if (pgCode(e) !== '23P01') throw e;
      }
    }
    if (!ap) throw new Error(`sem horário livre (${key})`);
    const [st] = await exec<{ status: string }>(sql`SELECT status::text AS status FROM public.appointments WHERE id = ${ap.id}::uuid`);
    if (st?.status === 'agendado') {
      await withTenant(c, (tx) => coverage.recordAppointmentCoverage(tx, {
        clinicId: c, appointmentId: ap!.id, patientId: who.patient, procedureId: proc!.id, appointmentDate: ap!.date, guideType: 'consulta',
        insurerId, planId: null, membershipId: who.membership, authorizationId: null, actor: { kind: 'user', userId: gestor },
      }), gestor);
      await exec(sql`UPDATE public.appointments SET status = 'atendido' WHERE id = ${ap.id}::uuid`);
    }
    const out = await withTenant(c, (tx) => guides.createConsultaGuideForAppointment(tx, {
      clinicId: c,
      appointment: { id: ap!.id, patientId: who.patient, professionalId: medica, procedureId: proc!.id, date: ap!.date, billingMode: 'convenio' },
      coverage: { insurerId, planId: null, membershipId: who.membership },
      terminologyVersion: tv.version,
      actor: { kind: 'automation' },
    }), gestor);
    const guideId = (out as { guideId?: string }).guideId;
    if (!guideId) throw new Error(`guia não criada (${key})`);
    const [g] = await exec<{ status: string }>(sql`SELECT status FROM public.hi_guides WHERE id = ${guideId}::uuid`);
    return { id: guideId, status: g!.status };
  };
  const out = {
    clinicId: c,
    run,
    insurerName,
    guides: { a: await guide('a', people[0]!, '14'), b: await guide('b', people[1]!, '15') },
  };
  writeFileSync(accountsFile!, JSON.stringify(accounts, null, 1));
  writeFileSync(outFile!, JSON.stringify(out, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: clínica e2e-hi-p75, ${Object.keys(accounts).length} contas, guias ${out.guides.a.status}/${out.guides.b.status}, marca ${run}`);
}

/**
 * Jornada SP/SADT no Preview (fase 1 pela tela): clínica e2e-hi-sadt com o contrato de psicoterapia
 * (exige autorização), uma paciente com carteirinha e três sessões de convênio de HOJE (data da
 * clínica, de manhã) ainda sem ligação, para a recepção ligar pela tela. Nada é enviado a operadora.
 */
async function setupSadt() {
  const run = arg('run');
  if (!run || !/^[A-Z0-9]{3,12}$/u.test(run)) throw new Error('--run <marca> obrigatório (A-Z e 0-9)');
  const c = await clinic('e2e-hi-sadt', 'Clínica Sintética E2E SP/SADT');
  await subscription(c, 'paid');
  const accounts: Record<string, { email: string; password: string; userId: string; clinic: string; role: string }> = {};
  const add = async (key: string, role: string, nome: string) => {
    const email = `e2e-hi-${key}@example.com`;
    const pass = password();
    const userId = await ensureUser(email, pass);
    await profile(userId, c, nome, role);
    accounts[key] = { email, password: pass, userId, clinic: 'sadt', role };
    return userId;
  };
  await add('sadt-gestor', 'gestor', 'Gestora SP/SADT E2E');
  await add('sadt-recepcao', 'attendant', 'Recepção SP/SADT E2E');
  await add('sadt-financeiro', 'financial', 'Financeiro SP/SADT E2E');
  const medica = await add('sadt-medica', 'doctor', 'Dra. Solicitante SP/SADT E2E');
  const medica2 = await add('sadt-medica2', 'doctor', 'Dra. Outra SP/SADT E2E');
  await exec(sql`
    INSERT INTO public.hi_clinic_settings (clinic_id, enabled, enabled_at, enabled_by, provider_kind, cnes_status, contractor_name)
    VALUES (${c}::uuid, true, now(), ${SYS}::uuid, 'PJ', 'none_declared', 'Clínica Sintética SP/SADT E2E Ltda')
    ON CONFLICT (clinic_id) DO UPDATE SET enabled = true, contractor_name = EXCLUDED.contractor_name`);
  for (const [pro, num] of [[medica, '42345'], [medica2, '42346']] as const) {
    await exec(sql`
      INSERT INTO public.hi_professional_profiles (clinic_id, professional_id, council, council_number, council_uf, cbo)
      VALUES (${c}::uuid, ${pro}::uuid, '06', ${num}, '35', '225133') ON CONFLICT DO NOTHING`);
  }
  let [proc] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.procedures WHERE clinic_id = ${c}::uuid AND codigo = 'E2E-PSI'`);
  if (!proc) {
    [proc] = await exec<{ id: string }>(sql`
      INSERT INTO public.procedures (clinic_id, codigo, descricao, valor_padrao, duracao_padrao_min, ativo)
      VALUES (${c}::uuid, 'E2E-PSI', 'Psicoterapia sintética E2E', 120, 50, true) RETURNING id::text AS id`);
  }
  const insurerName = 'Operadora Sintética SP/SADT';
  let [ins] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_insurers WHERE clinic_id = ${c}::uuid AND registro_ans = '999906'`);
  if (!ins) {
    [ins] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_insurers (clinic_id, name, registro_ans, provider_id_kind, provider_id_value, status, sadt_grouping, created_by)
      VALUES (${c}::uuid, ${insurerName}, '999906', 'codigoPrestadorNaOperadora', 'E2E0006', 'active', 'per_request', ${SYS}::uuid)
      RETURNING id::text AS id`);
    await exec(sql`
      INSERT INTO public.hi_procedure_contracts (clinic_id, insurer_id, guide_type, table_code, procedure_code, description, procedure_id,
        unit_value_cents, valid_from, requires_authorization, copay_kind, copay_fixed_cents, created_by)
      VALUES (${c}::uuid, ${ins!.id}::uuid, 'sp_sadt', '22', '50000470', 'Sessão de psicoterapia individual', ${proc!.id}::uuid, 9000, '2026-01-01', true, 'none', null, ${SYS}::uuid)`);
  }
  const insurerId = ins!.id;
  await exec(sql`
    INSERT INTO public.hi_credentials (clinic_id, insurer_id, plan_id, professional_id, valid_from, status, created_by)
    SELECT ${c}::uuid, ${insurerId}::uuid, NULL, x.pro, '2026-01-01', 'active', ${SYS}::uuid
      FROM (VALUES (NULL::uuid), (${medica}::uuid), (${medica2}::uuid)) AS x(pro)
     WHERE NOT EXISTS (SELECT 1 FROM public.hi_credentials k WHERE k.clinic_id = ${c}::uuid AND k.insurer_id = ${insurerId}::uuid
                         AND k.plan_id IS NULL AND k.professional_id IS NOT DISTINCT FROM x.pro AND k.status = 'active')`);
  const cpf = cpfOf('314159265');
  const card = '0081234500066661';
  const nome = 'Paciente Sintética SP/SADT';
  let [p] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.patients WHERE clinic_id = ${c}::uuid AND nome = ${nome}`);
  if (!p) {
    [p] = await exec<{ id: string }>(sql`
      INSERT INTO public.patients (clinic_id, nome, cpf_encrypted, cpf_hash)
      VALUES (${c}::uuid, ${nome}, ${await encryptForTenant(c, cpf)}, ${await hashForLookup(cpf)}) RETURNING id::text AS id`);
  }
  const hash = await hashForLookup(`${c}:${card}`);
  let [m] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.hi_memberships WHERE clinic_id = ${c}::uuid AND card_number_hash = ${hash}`);
  if (!m) {
    [m] = await exec<{ id: string }>(sql`
      INSERT INTO public.hi_memberships (clinic_id, patient_id, insurer_id, card_number_encrypted, card_number_hash, card_last4, created_by)
      VALUES (${c}::uuid, ${p!.id}::uuid, ${insurerId}::uuid, ${await encryptForTenant(c, card)}, ${hash}, ${card.slice(-4)}, ${SYS}::uuid)
      RETURNING id::text AS id`);
  }
  // Sessões de rodadas anteriores que ninguém ligou saem da lista de "ligar sessão" (canceladas).
  await exec(sql`
    UPDATE public.appointments ap SET status = 'cancelado'
     WHERE ap.clinic_id = ${c}::uuid AND ap.status = 'agendado' AND ap.observacoes LIKE 'e2e-hi:sadt-%'
       AND ap.observacoes NOT LIKE ${`e2e-hi:sadt-${run}-%`}
       AND NOT EXISTS (SELECT 1 FROM public.hi_appointment_coverages cv WHERE cv.clinic_id = ap.clinic_id AND cv.appointment_id = ap.id)`);
  const [today] = await exec<{ d: string }>(sql`SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`);
  const sessions: string[] = [];
  let hour = 10;
  for (let i = 0; i < 3; i++) {
    const tag = `e2e-hi:sadt-${run}-s${i + 1}`;
    let [ap] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.appointments WHERE clinic_id = ${c}::uuid AND observacoes = ${tag}`);
    // Horário livre de HOJE (data da clínica): uma rodada anterior pode ocupar o mesmo horário.
    for (; !ap && hour <= 22; hour++) {
      try {
        [ap] = await exec<{ id: string }>(sql`
          INSERT INTO public.appointments (clinic_id, doctor_id, patient_id, procedure_id, scheduled_at, duration_min, status, valor,
            snapshot_procedure_name, snapshot_procedure_valor, snapshot_procedure_duracao_min, snapshot_doctor_nome, created_via, observacoes, billing_mode)
          VALUES (${c}::uuid, ${medica}::uuid, ${p!.id}::uuid, ${proc!.id}::uuid, ${`${today!.d}T${String(hour).padStart(2, '0')}:00:00Z`}::timestamptz, 50,
            'agendado'::appointment_status, 120, 'Psicoterapia sintética E2E', 120, 50, 'Dra. Solicitante SP/SADT E2E', 'attendant', ${tag}, 'convenio')
          RETURNING id::text AS id`);
      } catch (e) {
        if (pgCode(e) !== '23P01') throw e;
      }
    }
    if (!ap) throw new Error('sem horário livre hoje para as sessões');
    sessions.push(ap.id);
  }
  const out = { clinicId: c, run, today: today!.d, insurerName, patientName: nome, cardLast4: card.slice(-4), procedureCode: '50000470', sessions };
  writeFileSync(accountsFile!, JSON.stringify(accounts, null, 1));
  writeFileSync(outFile!, JSON.stringify(out, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: clínica e2e-hi-sadt, ${Object.keys(accounts).length} contas, 3 sessões de hoje (${today!.d}), marca ${run}`);
}

/**
 * Fase 2 da jornada SP/SADT: as sessões que a recepção LIGOU pela tela são concluídas pelo caminho
 * real (prontuário assinado + `applyTransition` do Scheduling) e o worker do outbox roda só os
 * eventos delas, com os handlers reais (a guia SP/SADT nasce da conclusão). Só na clínica sintética.
 */
async function completeSadt() {
  const run = arg('run');
  if (!run || !/^[A-Z0-9]{3,12}$/u.test(run)) throw new Error('--run <marca> obrigatório (A-Z e 0-9)');
  const [c] = await exec<{ id: string }>(sql`SELECT id::text AS id FROM public.clinics WHERE slug = 'e2e-hi-sadt'`);
  if (!c) throw new Error('clínica e2e-hi-sadt ausente (rode setup-sadt)');
  const linked = await exec<{ id: string; patient_id: string; doctor_id: string; status: string }>(sql`
    SELECT ap.id::text AS id, ap.patient_id::text AS patient_id, ap.doctor_id::text AS doctor_id, ap.status::text AS status
      FROM public.appointments ap
      JOIN public.hi_appointment_coverages cv ON cv.clinic_id = ap.clinic_id AND cv.appointment_id = ap.id AND cv.sadt_request_item_id IS NOT NULL
     WHERE ap.clinic_id = ${c.id}::uuid AND ap.observacoes LIKE ${`e2e-hi:sadt-${run}-s%`}
     ORDER BY ap.scheduled_at`);
  if (linked.length === 0) throw new Error('nenhuma sessão ligada pela tela nesta marca');
  const { applyTransition } = await import('../../src/contexts/scheduling/internal/appointment-core');
  await import('../../src/contexts/health-insurance/internal/handlers/insurance-completed');
  const { runOutboxEventsNow } = await import('../../src/lib/outbox/worker');
  const keys: string[] = [];
  for (const ap of linked) {
    if (ap.status === 'agendado') {
      await exec(sql`UPDATE public.appointments SET status = 'em_atendimento' WHERE id = ${ap.id}::uuid AND status = 'agendado'`);
      await exec(sql`
        INSERT INTO public.prontuarios (clinic_id, patient_id, doctor_id, appointment_id, status, signed_at, signed_by, content_encrypted)
        VALUES (${c.id}::uuid, ${ap.patient_id}::uuid, ${ap.doctor_id}::uuid, ${ap.id}::uuid, 'assinado', now(), ${ap.doctor_id}::uuid,
          ${await encryptForTenant(c.id, JSON.stringify({ sintetico: 'Registro sintético E2E, sem conteúdo clínico' }))})`);
    }
    if (ap.status !== 'atendido') {
      await withTenant(c.id, (tx) => applyTransition(tx, {
        clinicId: c.id, appointmentId: ap.id, target: 'atendido', transitionedBy: ap.doctor_id, actorType: 'user',
        clientKey: `e2e-sadt-concluir-${ap.id}`, correlationId: null,
      }), ap.doctor_id);
    }
    keys.push(`e2e-sadt-concluir-${ap.id}:atendido:convenio`);
  }
  const tick = await runOutboxEventsNow([{ eventType: 'scheduling.appointment.insurance_completed', idempotencyKeys: keys }]);
  const guides = await exec<{ id: string; status: string; items: number }>(sql`
    SELECT DISTINCT g.id::text AS id, g.status, (SELECT count(*)::int FROM public.hi_guide_items i WHERE i.guide_id = g.id) AS items
      FROM public.hi_guides g JOIN public.hi_guide_items gi ON gi.guide_id = g.id
     WHERE g.clinic_id = ${c.id}::uuid AND g.guide_type = 'sp_sadt' AND gi.appointment_id = ANY(${`{${linked.map((l) => l.id).join(',')}}`}::uuid[])`);
  const out = { run, completed: linked.length, outbox: { processed: tick.processed, failed: tick.failed }, guides };
  writeFileSync(outFile!, JSON.stringify(out, null, 1));
  console.log(`[hi-dev-e2e-fixture] ok: ${linked.length} sessões concluídas, outbox ${tick.processed}/${tick.failed}, guias SP/SADT ${guides.map((g) => `${g.status}(${g.items})`).join(', ')}`);
}

// Comando desconhecido NÃO cai no cleanup (antes era o ramo padrão: um erro de digitação desativava
// as contas e clínicas e2e-hi-*). O cleanup só roda pelo nome.
const main =
  command === 'setup' ? setup
  : command === 'setup-config' ? setupConfig
  : command === 'setup-states' ? setupStates
  : command === 'setup-authorizations' ? setupAuthorizations
  : command === 'setup-i2' ? setupI2
  : command === 'deliver-alerts' ? deliverAlerts
  : command === 'setup-p75' ? setupP75
  : command === 'setup-sadt' ? setupSadt
  : command === 'complete-sadt' ? completeSadt
  : command === 'set-state' ? setState
  : command === 'set-active' ? setActive
  : command === 'guide-state' ? guideState
  : command === 'cleanup' ? cleanup
  : () => Promise.reject(new Error(`comando desconhecido: ${String(command)} (use setup, setup-config, setup-states, setup-authorizations, set-state, set-active, guide-state ou cleanup)`));
main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    const cause = (e as { cause?: { message?: string; detail?: string } })?.cause;
    const first = e instanceof Error ? e.message.split(/\r?\n/u)[0] : String(e);
    console.error('[hi-dev-e2e-fixture] FALHOU:', first, cause?.message ?? '', cause?.detail ?? '');
    process.exit(1);
  });
