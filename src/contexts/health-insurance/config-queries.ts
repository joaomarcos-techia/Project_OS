/**
 * Leituras das telas de configuração de Convênios (P2.6, P3.1/P3.2, P4.4; R44).
 *
 * Tudo pela RLS da clínica da sessão (`withTenant`). Nada aqui decifra a carteirinha:
 * a lista mostra só os 4 últimos caracteres; o número completo sai apenas pela leitura
 * auditada (`readMembershipCardNumberAudited`). O CPF do contratado pessoa física sai
 * mascarado. Os códigos oferecidos (TUSS, CBO, conselho, UF) vêm das tabelas oficiais
 * carregadas; nada é sugerido de fora delas.
 */
import 'server-only';

import { sql } from 'drizzle-orm';

import { withTenant } from '@/lib/db/tenant';

type Row = Record<string, unknown>;
const n = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const day = (v: unknown): string | null => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

export const INSURER_STATUS_LABELS: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Ativa',
  suspended: 'Suspensa',
  archived: 'Arquivada',
};

export const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: 'Ativa',
  inactive: 'Inativa',
  replaced: 'Substituída',
};

export const COVERAGE_STATUS_LABELS: Record<string, string> = {
  incomplete: 'Com pendência',
  pending_authorization: 'Aguardando autorização',
  authorization_recorded: 'Autorização registrada',
  authorization_denied: 'Autorização negada',
  ready: 'Pronta',
  cancelled: 'Cancelada',
};

export const PROVIDER_ID_LABELS: Record<string, string> = {
  codigoPrestadorNaOperadora: 'Código do prestador na operadora',
  cnpjContratado: 'CNPJ do contratado',
  cpfContratado: 'CPF do contratado',
};

/** CPF do contratado pessoa física: dado pessoal, só os 2 últimos dígitos. */
export function maskProviderId(kind: string, value: string): string {
  if (kind === 'cpfContratado') return `•••.•••.•••-${value.slice(-2)}`;
  return value;
}

async function rows(tx: Parameters<Parameters<typeof withTenant>[1]>[0], q: ReturnType<typeof sql>): Promise<Row[]> {
  return (await tx.execute(q)) as unknown as Row[];
}

// ── Painel de configuração ───────────────────────────────────────────────

export interface ReadinessItem {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
  /** Pendência que a clínica não resolve sozinha (habilitação operacional do Qoro). */
  external?: boolean;
}

export interface InsuranceSetup {
  settings: {
    enabled: boolean;
    providerKind: 'PF' | 'PJ' | null;
    contractorName: string | null;
    cnesStatus: 'unknown' | 'has' | 'none_declared';
    cnes: string | null;
  };
  terminologyVersion: string | null;
  insurers: Array<{
    id: string;
    name: string;
    registroAns: string;
    status: string;
    providerIdKind: string;
    providerIdMasked: string;
    plans: number;
    liveLinesToday: number;
    activeCards: number;
  }>;
  professionals: Array<{
    id: string;
    nome: string;
    profile: { council: string; councilNumber: string; councilUf: string; cbo: string; cboTerm: string | null } | null;
  }>;
  councils: Array<{ code: string; term: string }>;
  ufs: Array<{ code: string; term: string; sigla: string | null }>;
  readiness: ReadinessItem[];
}

export async function getInsuranceSetup(clinicId: string): Promise<InsuranceSetup> {
  return withTenant(clinicId, async (tx) => {
    const [st] = await rows(tx, sql`SELECT enabled, provider_kind, contractor_name, cnes_status, cnes FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid`);
    const [tv] = await rows(tx, sql`SELECT version FROM public.tiss_terminology_versions ORDER BY version DESC LIMIT 1`);
    const terminologyVersion = s(tv?.version);
    const insurers = await rows(
      tx,
      sql`SELECT i.id::text AS id, i.name, i.registro_ans, i.status, i.provider_id_kind, i.provider_id_value,
                 (SELECT count(*) FROM public.hi_plans p WHERE p.clinic_id = i.clinic_id AND p.insurer_id = i.id AND p.status = 'active')::int AS plans,
                 (SELECT count(*) FROM public.hi_procedure_contracts c
                   WHERE c.clinic_id = i.clinic_id AND c.insurer_id = i.id
                     AND c.valid_from <= current_date AND (c.valid_until IS NULL OR c.valid_until >= current_date)
                     AND NOT EXISTS (SELECT 1 FROM public.hi_procedure_contracts x WHERE x.clinic_id = c.clinic_id AND x.supersedes_id = c.id))::int AS live_lines,
                 (SELECT count(*) FROM public.hi_memberships m WHERE m.clinic_id = i.clinic_id AND m.insurer_id = i.id AND m.status = 'active')::int AS cards
            FROM public.hi_insurers i WHERE i.clinic_id = ${clinicId}::uuid
           ORDER BY CASE i.status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 WHEN 'suspended' THEN 2 ELSE 3 END, i.name`,
    );
    const pros = await rows(
      tx,
      sql`SELECT p.id::text AS id, p.nome, hp.council, hp.council_number, hp.council_uf, hp.cbo,
                 (SELECT t.term FROM public.tiss_terms t JOIN public.tiss_terminology_versions v ON v.id = t.version_id
                   WHERE t.table_code = '24' AND t.code = hp.cbo ORDER BY v.version DESC LIMIT 1) AS cbo_term
            FROM public.profiles p
            LEFT JOIN public.hi_professional_profiles hp ON hp.clinic_id = p.clinic_id AND hp.professional_id = p.id
           WHERE p.clinic_id = ${clinicId}::uuid AND p.ativo AND p.deleted_at IS NULL
             AND (p.role = 'doctor' OR (p.role IN ('owner', 'gestor') AND p.crm IS NOT NULL AND btrim(p.crm) <> '') OR hp.id IS NOT NULL)
           ORDER BY p.nome`,
    );
    const domain = terminologyVersion
      ? await rows(
          tx,
          sql`SELECT t.table_code, t.code, t.term, t.extra->>'Sigla' AS sigla FROM public.tiss_terms t
                JOIN public.tiss_terminology_versions v ON v.id = t.version_id
               WHERE v.version = ${terminologyVersion} AND t.table_code IN ('26', '59')
                 AND (t.ends_on IS NULL OR t.ends_on >= current_date)
               ORDER BY t.table_code, t.term`,
        )
      : [];

    const settings = {
      enabled: Boolean(st?.enabled),
      providerKind: (s(st?.provider_kind) as 'PF' | 'PJ' | null) ?? null,
      contractorName: s(st?.contractor_name),
      cnesStatus: ((s(st?.cnes_status) ?? 'unknown') as InsuranceSetup['settings']['cnesStatus']),
      cnes: s(st?.cnes),
    };
    const ins = insurers.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      registroAns: String(r.registro_ans),
      status: String(r.status),
      providerIdKind: String(r.provider_id_kind),
      providerIdMasked: maskProviderId(String(r.provider_id_kind), String(r.provider_id_value)),
      plans: n(r.plans),
      liveLinesToday: n(r.live_lines),
      activeCards: n(r.cards),
    }));
    const professionals = pros.map((r) => ({
      id: String(r.id),
      nome: String(r.nome),
      profile: r.council
        ? { council: String(r.council), councilNumber: String(r.council_number), councilUf: String(r.council_uf), cbo: String(r.cbo), cboTerm: s(r.cbo_term) }
        : null,
    }));
    const active = ins.filter((i) => i.status === 'active');
    const identityOk = Boolean(settings.providerKind && settings.contractorName && settings.cnesStatus !== 'unknown');
    const missingPros = professionals.filter((p) => !p.profile);
    const withoutContract = active.filter((i) => i.liveLinesToday === 0);
    const readiness: ReadinessItem[] = [
      {
        key: 'identity',
        ok: identityOk,
        label: 'Identificação do prestador',
        detail: identityOk
          ? `${settings.providerKind === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'} · ${settings.contractorName} · ${settings.cnesStatus === 'has' ? `CNES ${settings.cnes}` : 'sem CNES (declarado)'}`
          : 'Informe se fatura como PJ ou PF, o nome do contratado e o CNES (ou a declaração de que não tem).',
      },
      {
        key: 'insurers',
        ok: active.length > 0,
        label: 'Operadora ativa',
        detail: active.length > 0 ? `${active.length} operadora(s) ativa(s).` : 'Cadastre a operadora com o registro ANS e o código do prestador e ative-a.',
      },
      {
        key: 'contracts',
        ok: active.length > 0 && withoutContract.length === 0,
        label: 'Contrato vigente hoje',
        detail:
          active.length === 0
            ? 'Depende de uma operadora ativa.'
            : withoutContract.length === 0
              ? 'Toda operadora ativa tem procedimento contratado vigente.'
              : `Sem procedimento vigente hoje: ${withoutContract.map((i) => i.name).join(', ')}.`,
      },
      {
        key: 'professionals',
        ok: professionals.length > 0 && missingPros.length === 0,
        label: 'Perfil TISS dos profissionais',
        detail:
          professionals.length === 0
            ? 'Nenhum profissional que atende na clínica.'
            : missingPros.length === 0
              ? 'Todos os profissionais têm conselho, UF e CBO.'
              : `Falta o perfil de: ${missingPros.map((p) => p.nome).join(', ')}. A guia desses atendimentos fica com pendência.`,
      },
      {
        key: 'terminology',
        ok: Boolean(terminologyVersion),
        label: 'Terminologia TUSS',
        detail: terminologyVersion ? `Competência ${terminologyVersion} carregada.` : 'A terminologia oficial não está carregada neste ambiente.',
        external: !terminologyVersion,
      },
      {
        key: 'enabled',
        ok: settings.enabled,
        label: 'Habilitação operacional',
        detail: settings.enabled
          ? 'O Qoro habilitou o faturamento de convênios nesta clínica.'
          : 'A clínica pode preparar o cadastro; as guias só são geradas depois que o Qoro habilitar o módulo (decisão operacional, não automática).',
        external: !settings.enabled,
      },
    ];
    return {
      settings,
      terminologyVersion,
      insurers: ins,
      professionals,
      councils: domain.filter((r) => r.table_code === '26').map((r) => ({ code: String(r.code), term: String(r.term) })),
      ufs: domain.filter((r) => r.table_code === '59').map((r) => ({ code: String(r.code), term: String(r.term), sigla: s(r.sigla) })),
      readiness,
    };
  });
}

// ── Detalhe da operadora ─────────────────────────────────────────────────

export interface ContractLineView {
  id: string;
  planId: string | null;
  planName: string | null;
  guideType: 'consulta' | 'sp_sadt';
  tableCode: string;
  procedureCode: string;
  description: string;
  procedureId: string | null;
  procedureName: string | null;
  unitValueCents: number;
  validFrom: string;
  validUntil: string | null;
  requiresAuthorization: boolean;
  copayKind: 'none' | 'fixed' | 'percentage';
  copayFixedCents: number | null;
  copayPercentage: number | null;
  returnDays: number | null;
  returnBillable: boolean;
  supersedesId: string | null;
  supersededById: string | null;
  createdAt: string;
  createdByName: string | null;
  /** Não substituída por outra versão. */
  live: boolean;
}

export interface InsurerDetail {
  insurer: {
    id: string;
    name: string;
    registroAns: string;
    status: string;
    providerIdKind: 'codigoPrestadorNaOperadora' | 'cnpjContratado' | 'cpfContratado';
    providerIdMasked: string;
    /** Valor editável só para quem gerencia (o formulário de edição); CPF nunca volta inteiro. */
    providerIdEditable: string | null;
    sadtGrouping: 'per_session' | 'per_request';
    createdAt: string;
  };
  plans: Array<{ id: string; name: string; operatorCode: string | null; category: string | null; status: string; cards: number }>;
  lines: ContractLineView[];
  procedures: Array<{ id: string; codigo: string; descricao: string }>;
  history: Array<{ at: string; action: string; userName: string | null; resourceType: string; after: Record<string, unknown> | null }>;
}

export async function getInsurerDetail(clinicId: string, insurerId: string): Promise<InsurerDetail | null> {
  return withTenant(clinicId, async (tx) => {
    const [i] = await rows(
      tx,
      sql`SELECT id::text AS id, name, registro_ans, status, provider_id_kind, provider_id_value, sadt_grouping, created_at
            FROM public.hi_insurers WHERE clinic_id = ${clinicId}::uuid AND id = ${insurerId}::uuid`,
    );
    if (!i) return null;
    const plans = await rows(
      tx,
      sql`SELECT p.id::text AS id, p.name, p.operator_code, p.category, p.status,
                 (SELECT count(*) FROM public.hi_memberships m WHERE m.clinic_id = p.clinic_id AND m.plan_id = p.id AND m.status = 'active')::int AS cards
            FROM public.hi_plans p WHERE p.clinic_id = ${clinicId}::uuid AND p.insurer_id = ${insurerId}::uuid
           ORDER BY p.status, p.name`,
    );
    const lines = await rows(
      tx,
      sql`SELECT c.*, c.id::text AS id_text, pl.name AS plan_name, pr.descricao AS procedure_name, pf.nome AS created_by_name,
                 (SELECT x.id::text FROM public.hi_procedure_contracts x WHERE x.clinic_id = c.clinic_id AND x.supersedes_id = c.id) AS superseded_by
            FROM public.hi_procedure_contracts c
            LEFT JOIN public.hi_plans pl ON pl.clinic_id = c.clinic_id AND pl.id = c.plan_id
            LEFT JOIN public.procedures pr ON pr.clinic_id = c.clinic_id AND pr.id = c.procedure_id
            LEFT JOIN public.profiles pf ON pf.id = c.created_by
           WHERE c.clinic_id = ${clinicId}::uuid AND c.insurer_id = ${insurerId}::uuid
           ORDER BY c.guide_type, c.procedure_code, c.valid_from, c.created_at`,
    );
    const procedures = await rows(
      tx,
      sql`SELECT id::text AS id, codigo, descricao FROM public.procedures WHERE clinic_id = ${clinicId}::uuid AND ativo ORDER BY descricao`,
    );
    const history = await rows(
      tx,
      sql`SELECT a.created_at, a.action, a.resource_type, a.after, pf.nome AS user_name
            FROM public.audit_events a
            LEFT JOIN public.profiles pf ON pf.id = a.user_id
           WHERE a.clinic_id = ${clinicId}::uuid
             AND ((a.resource_type = 'hi_insurer' AND a.resource_id = ${insurerId})
               OR (a.resource_type IN ('hi_plan', 'hi_procedure_contract') AND a.after->>'insurerId' = ${insurerId}))
           ORDER BY a.created_at DESC LIMIT 100`,
    );
    const kind = String(i.provider_id_kind) as InsurerDetail['insurer']['providerIdKind'];
    return {
      insurer: {
        id: String(i.id),
        name: String(i.name),
        registroAns: String(i.registro_ans),
        status: String(i.status),
        providerIdKind: kind,
        providerIdMasked: maskProviderId(kind, String(i.provider_id_value)),
        providerIdEditable: kind === 'cpfContratado' ? null : String(i.provider_id_value),
        sadtGrouping: String(i.sadt_grouping) as 'per_session' | 'per_request',
        createdAt: iso(i.created_at) ?? '',
      },
      plans: plans.map((p) => ({ id: String(p.id), name: String(p.name), operatorCode: s(p.operator_code), category: s(p.category), status: String(p.status), cards: n(p.cards) })),
      lines: lines.map((c) => ({
        id: String(c.id_text),
        planId: s(c.plan_id),
        planName: s(c.plan_name),
        guideType: String(c.guide_type) as 'consulta' | 'sp_sadt',
        tableCode: String(c.table_code),
        procedureCode: String(c.procedure_code),
        description: String(c.description),
        procedureId: s(c.procedure_id),
        procedureName: s(c.procedure_name),
        unitValueCents: n(c.unit_value_cents),
        validFrom: day(c.valid_from) ?? '',
        validUntil: day(c.valid_until),
        requiresAuthorization: Boolean(c.requires_authorization),
        copayKind: String(c.copay_kind) as 'none' | 'fixed' | 'percentage',
        copayFixedCents: c.copay_fixed_cents === null ? null : n(c.copay_fixed_cents),
        copayPercentage: c.copay_percentage === null ? null : n(c.copay_percentage),
        returnDays: c.return_days === null ? null : n(c.return_days),
        returnBillable: Boolean(c.return_billable),
        supersedesId: s(c.supersedes_id),
        supersededById: s(c.superseded_by),
        createdAt: iso(c.created_at) ?? '',
        createdByName: s(c.created_by_name),
        live: c.superseded_by === null || c.superseded_by === undefined,
      })),
      procedures: procedures.map((p) => ({ id: String(p.id), codigo: String(p.codigo), descricao: String(p.descricao) })),
      history: history.map((h) => ({
        at: iso(h.created_at) ?? '',
        action: String(h.action),
        userName: s(h.user_name),
        resourceType: String(h.resource_type),
        after: (h.after as Record<string, unknown> | null) ?? null,
      })),
    };
  });
}

// ── Carteirinhas ─────────────────────────────────────────────────────────

export interface PatientHit {
  id: string;
  nome: string;
  activeCards: number;
}

/** Busca por nome (mín. 2 letras), só pacientes ativos da clínica. */
export async function searchPatientsForCards(clinicId: string, term: string): Promise<PatientHit[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const like = `%${t.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;
  return withTenant(clinicId, async (tx) => {
    const r = await rows(
      tx,
      sql`SELECT p.id::text AS id, p.nome,
                 (SELECT count(*) FROM public.hi_memberships m WHERE m.clinic_id = p.clinic_id AND m.patient_id = p.id AND m.status = 'active')::int AS cards
            FROM public.patients p
           WHERE p.clinic_id = ${clinicId}::uuid AND p.deleted_at IS NULL AND p.anonymized_at IS NULL
             AND p.merged_into_patient_id IS NULL AND p.nome ILIKE ${like}
           ORDER BY p.nome LIMIT 20`,
    );
    return r.map((x) => ({ id: String(x.id), nome: String(x.nome), activeCards: n(x.cards) }));
  });
}

export interface MembershipView {
  id: string;
  insurerId: string;
  insurerName: string;
  insurerStatus: string;
  planId: string | null;
  planName: string | null;
  last4: string;
  holderKind: 'titular' | 'dependente';
  validUntil: string | null;
  isPreferred: boolean;
  status: 'active' | 'inactive' | 'replaced';
  replacedById: string | null;
  createdAt: string;
}

export interface PatientMemberships {
  patient: { id: string; nome: string };
  cards: MembershipView[];
  /** Operadoras que aceitam carteirinha nova (não arquivadas), com os planos ativos. */
  insurers: Array<{ id: string; name: string; status: string; plans: Array<{ id: string; name: string }> }>;
}

export async function getPatientMemberships(clinicId: string, patientId: string): Promise<PatientMemberships | null> {
  return withTenant(clinicId, async (tx) => {
    const [p] = await rows(
      tx,
      sql`SELECT id::text AS id, nome FROM public.patients WHERE clinic_id = ${clinicId}::uuid AND id = ${patientId}::uuid AND deleted_at IS NULL`,
    );
    if (!p) return null;
    const cards = await rows(
      tx,
      sql`SELECT m.id::text AS id, m.insurer_id::text AS insurer_id, i.name AS insurer_name, i.status AS insurer_status,
                 m.plan_id::text AS plan_id, pl.name AS plan_name, m.card_last4, m.holder_kind, m.valid_until,
                 m.is_preferred, m.status, m.replaced_by_id::text AS replaced_by_id, m.created_at
            FROM public.hi_memberships m
            JOIN public.hi_insurers i ON i.clinic_id = m.clinic_id AND i.id = m.insurer_id
            LEFT JOIN public.hi_plans pl ON pl.clinic_id = m.clinic_id AND pl.id = m.plan_id
           WHERE m.clinic_id = ${clinicId}::uuid AND m.patient_id = ${patientId}::uuid
           ORDER BY CASE m.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END, m.is_preferred DESC, m.created_at DESC`,
    );
    const ins = await rows(
      tx,
      sql`SELECT i.id::text AS id, i.name, i.status,
                 coalesce((SELECT json_agg(json_build_object('id', p.id::text, 'name', p.name) ORDER BY p.name)
                             FROM public.hi_plans p WHERE p.clinic_id = i.clinic_id AND p.insurer_id = i.id AND p.status = 'active'), '[]'::json) AS plans
            FROM public.hi_insurers i WHERE i.clinic_id = ${clinicId}::uuid AND i.status <> 'archived'
           ORDER BY i.name`,
    );
    return {
      patient: { id: String(p.id), nome: String(p.nome) },
      cards: cards.map((c) => ({
        id: String(c.id),
        insurerId: String(c.insurer_id),
        insurerName: String(c.insurer_name),
        insurerStatus: String(c.insurer_status),
        planId: s(c.plan_id),
        planName: s(c.plan_name),
        last4: String(c.card_last4),
        holderKind: String(c.holder_kind) as 'titular' | 'dependente',
        validUntil: day(c.valid_until),
        isPreferred: Boolean(c.is_preferred),
        status: String(c.status) as MembershipView['status'],
        replacedById: s(c.replaced_by_id),
        createdAt: iso(c.created_at) ?? '',
      })),
      insurers: ins.map((i) => ({ id: String(i.id), name: String(i.name), status: String(i.status), plans: (i.plans as Array<{ id: string; name: string }>) ?? [] })),
    };
  });
}

// ── Agenda: forma de atendimento ─────────────────────────────────────────

export interface SchedulingInsuranceOptions {
  /** Módulo habilitado pelo Qoro nesta clínica (sem isso o banco recusa "convênio"). */
  enabled: boolean;
  insurers: Array<{ id: string; name: string; plans: Array<{ id: string; name: string }> }>;
}

/** `null` quando o schema de Convênios não existe no ambiente (nada muda na agenda). */
export async function getSchedulingInsuranceOptions(clinicId: string): Promise<SchedulingInsuranceOptions | null> {
  return withTenant(clinicId, async (tx) => {
    const [installed] = await rows(tx, sql`SELECT to_regclass('public.hi_clinic_settings') IS NOT NULL AS ok`);
    if (!installed?.ok) return null;
    const [st] = await rows(tx, sql`SELECT enabled FROM public.hi_clinic_settings WHERE clinic_id = ${clinicId}::uuid`);
    if (!st?.enabled) return { enabled: false, insurers: [] };
    const ins = await rows(
      tx,
      sql`SELECT i.id::text AS id, i.name,
                 coalesce((SELECT json_agg(json_build_object('id', p.id::text, 'name', p.name) ORDER BY p.name)
                             FROM public.hi_plans p WHERE p.clinic_id = i.clinic_id AND p.insurer_id = i.id AND p.status = 'active'), '[]'::json) AS plans
            FROM public.hi_insurers i WHERE i.clinic_id = ${clinicId}::uuid AND i.status = 'active'
           ORDER BY i.name`,
    );
    return { enabled: true, insurers: ins.map((i) => ({ id: String(i.id), name: String(i.name), plans: (i.plans as Array<{ id: string; name: string }>) ?? [] })) };
  });
}

export interface SchedulingCard {
  id: string;
  insurerId: string;
  planId: string | null;
  last4: string;
  validUntil: string | null;
  preferred: boolean;
}

/** Carteirinhas ATIVAS do paciente para escolher no agendamento (mascaradas). */
export async function listPatientCardsForScheduling(clinicId: string, patientId: string): Promise<SchedulingCard[]> {
  return withTenant(clinicId, async (tx) => {
    const r = await rows(
      tx,
      sql`SELECT m.id::text AS id, m.insurer_id::text AS insurer_id, m.plan_id::text AS plan_id, m.card_last4, m.valid_until, m.is_preferred
            FROM public.hi_memberships m
            JOIN public.hi_insurers i ON i.clinic_id = m.clinic_id AND i.id = m.insurer_id AND i.status = 'active'
           WHERE m.clinic_id = ${clinicId}::uuid AND m.patient_id = ${patientId}::uuid AND m.status = 'active'
           ORDER BY m.is_preferred DESC, m.created_at DESC`,
    );
    return r.map((x) => ({ id: String(x.id), insurerId: String(x.insurer_id), planId: s(x.plan_id), last4: String(x.card_last4), validUntil: day(x.valid_until), preferred: Boolean(x.is_preferred) }));
  });
}

// ── Próximos atendimentos de convênio (P3.3/P5.2) ────────────────────────

export interface UpcomingInsuranceAppointment {
  appointmentId: string;
  scheduledAt: string;
  status: string;
  patientId: string | null;
  patientName: string | null;
  doctorName: string | null;
  procedureName: string | null;
  coverage: { status: string; insurerName: string; last4: string | null; issues: Array<{ code: string; message: string; owner: string }> } | null;
}

/** Atendimentos de convênio a partir de hoje (até 30), com a cobertura e as pendências. */
export async function listUpcomingInsuranceAppointments(clinicId: string, limit = 30): Promise<UpcomingInsuranceAppointment[]> {
  return withTenant(clinicId, async (tx) => {
    const r = await rows(
      tx,
      sql`SELECT a.id::text AS id, a.scheduled_at, a.status::text AS status, a.patient_id::text AS patient_id,
                 pt.nome AS patient_name, coalesce(a.snapshot_doctor_nome, d.nome) AS doctor_name,
                 coalesce(a.snapshot_procedure_name, pr.descricao) AS procedure_name,
                 c.status AS coverage_status, c.issues, i.name AS insurer_name, m.card_last4
            FROM public.appointments a
            LEFT JOIN public.patients pt ON pt.id = a.patient_id AND pt.clinic_id = a.clinic_id
            LEFT JOIN public.profiles d ON d.id = a.doctor_id
            LEFT JOIN public.procedures pr ON pr.id = a.procedure_id AND pr.clinic_id = a.clinic_id
            LEFT JOIN public.hi_appointment_coverages c ON c.clinic_id = a.clinic_id AND c.appointment_id = a.id AND c.status <> 'cancelled'
            LEFT JOIN public.hi_insurers i ON i.clinic_id = c.clinic_id AND i.id = c.insurer_id
            LEFT JOIN public.hi_memberships m ON m.clinic_id = c.clinic_id AND m.id = c.membership_id
           WHERE a.clinic_id = ${clinicId}::uuid AND a.billing_mode = 'convenio'
             AND a.status::text IN ('agendado', 'confirmado', 'chegou')
             AND a.scheduled_at >= date_trunc('day', now())
           ORDER BY a.scheduled_at LIMIT ${limit}`,
    );
    return r.map((x) => ({
      appointmentId: String(x.id),
      scheduledAt: iso(x.scheduled_at) ?? '',
      status: String(x.status),
      patientId: s(x.patient_id),
      patientName: s(x.patient_name),
      doctorName: s(x.doctor_name),
      procedureName: s(x.procedure_name),
      coverage: x.coverage_status
        ? {
            status: String(x.coverage_status),
            insurerName: String(x.insurer_name ?? ''),
            last4: s(x.card_last4),
            issues: ((x.issues as Array<{ code: string; message: string; owner: string }>) ?? []).map((i) => ({ code: i.code, message: i.message, owner: i.owner })),
          }
        : null,
    }));
  });
}

// ── Coparticipação a conferir e confirmar (P5.3) ─────────────────────────

export interface CopayToReview {
  id: string;
  status: 'calculated' | 'checked';
  patientName: string | null;
  scheduledAt: string | null;
  procedureName: string | null;
  expectedCents: number;
  calculatedCents: number | null;
  checkedCents: number | null;
}

/** Coparticipações calculadas na conclusão e ainda não confirmadas (nada foi cobrado). */
export async function listCopaysToReview(clinicId: string): Promise<CopayToReview[]> {
  return withTenant(clinicId, async (tx) => {
    const r = await rows(
      tx,
      sql`SELECT c.id::text AS id, c.status, pt.nome AS patient_name, a.scheduled_at, a.snapshot_procedure_name,
                 c.expected_cents, c.calculated_cents, c.checked_cents
            FROM public.hi_copayments c
            LEFT JOIN public.appointments a ON a.id = c.appointment_id AND a.clinic_id = c.clinic_id
            LEFT JOIN public.patients pt ON pt.id = c.patient_id AND pt.clinic_id = c.clinic_id
           WHERE c.clinic_id = ${clinicId}::uuid AND c.status IN ('calculated', 'checked')
           ORDER BY a.scheduled_at DESC NULLS LAST LIMIT 100`,
    );
    return r.map((x) => ({
      id: String(x.id),
      status: String(x.status) as 'calculated' | 'checked',
      patientName: s(x.patient_name),
      scheduledAt: iso(x.scheduled_at),
      procedureName: s(x.snapshot_procedure_name),
      expectedCents: n(x.expected_cents),
      calculatedCents: x.calculated_cents === null ? null : n(x.calculated_cents),
      checkedCents: x.checked_cents === null ? null : n(x.checked_cents),
    }));
  });
}

// ── Exportação do lote em segundo plano (R45) ────────────────────────────

export interface BatchExportJob {
  status: 'pending' | 'processing' | 'processed' | 'failed' | string;
  attempts: number;
  /** Código do motivo (sem dado pessoal); o texto técnico do erro não vai para a tela. */
  errorCode: string | null;
  createdAt: string | null;
  processedAt: string | null;
}

/** O job da versão atual do lote (chave `hi-batch-export:<lote>:v<versão>`), pela RLS da clínica. */
export async function getBatchExportJob(clinicId: string, batchId: string, version: number): Promise<BatchExportJob | null> {
  return withTenant(clinicId, async (tx) => {
    const [r] = await rows(
      tx,
      sql`SELECT status::text AS status, attempts, error_code, created_at, processed_at FROM public.outbox
           WHERE clinic_id = ${clinicId}::uuid AND event_type = 'health_insurance.batch.export_requested'
             AND idempotency_key = ${`hi-batch-export:${batchId}:v${version}`}
           ORDER BY created_at DESC LIMIT 1`,
    );
    if (!r) return null;
    return { status: String(r.status), attempts: n(r.attempts), errorCode: s(r.error_code), createdAt: iso(r.created_at), processedAt: iso(r.processed_at) };
  });
}

// ── Busca nas tabelas oficiais (TUSS 22, CBO 24) ─────────────────────────

/** Até 20 termos da competência mais recente, por código ou parte do texto. */
export async function searchOfficialTerms(clinicId: string, table: '22' | '24', term: string): Promise<Array<{ code: string; term: string }>> {
  const t = term.trim();
  if (t.length < 2) return [];
  const like = `%${t.replace(/[\\%_]/gu, (c) => `\\${c}`)}%`;
  return withTenant(clinicId, async (tx) => {
    const r = await rows(
      tx,
      sql`SELECT t.code, t.term FROM public.tiss_terms t
            JOIN public.tiss_terminology_versions v ON v.id = t.version_id
           WHERE v.version = (SELECT max(version) FROM public.tiss_terminology_versions)
             AND t.table_code = ${table} AND (t.ends_on IS NULL OR t.ends_on >= current_date)
             AND (t.code LIKE ${`${t.replace(/\D/gu, '') || '#'}%`} OR t.term ILIKE ${like})
           ORDER BY (t.code = ${t}) DESC, t.code LIMIT 20`,
    );
    return r.map((x) => ({ code: String(x.code), term: String(x.term) }));
  });
}
