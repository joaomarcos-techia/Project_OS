'use server';

/**
 * Ações das telas de configuração de Convênios (P2.1–P2.5, P3.1; R44): identificação
 * do prestador, operadoras, planos, contratos, perfil TISS e carteirinhas.
 *
 * Pipeline de toda escrita: requireUser → permissão do papel → Zod → serviço dentro de
 * `withTenant` com a pessoa da sessão (o banco confere de novo: CHECK, FK composta,
 * gatilho de mesma clínica, contrato imutável e o bloqueio comercial D24 na
 * carteirinha) → auditoria na MESMA transação, sem número de carteirinha nem CPF.
 *
 * Permissões: cadastro da operadora, plano, contrato, prestador e perfil TISS =
 * gerenciar o financeiro; carteirinha = editar paciente (a recepção cadastra); o número
 * completo só pela leitura auditada (finalidade "atendimento").
 */
import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS, type Permission } from '@/lib/auth/permissions';
import {
  AuthError,
  requireCachedPermission,
  requireClinicId,
  requireFreshPermission,
  requireUser,
} from '@/lib/auth/tenant-context';
import type { Tx } from '@/lib/db';
import { withTenant } from '@/lib/db/tenant';
import { premiumAccessErrorFrom, premiumDenialMessage } from '@/lib/premium-access';

import {
  listPatientCardsForScheduling,
  searchOfficialTerms,
  type SchedulingCard,
} from './config-queries';
import * as cfg from './internal/config-service';
import { CoverageInputError, recordAppointmentCoverage } from './internal/coverage-service';
import { readMembershipCardNumberAudited } from './internal/membership-access';
import { ConveniosModuleDisabledError } from './internal/module-guard';
import { revokeInsurerCredentialTx, saveInsurerCredentialTx } from './internal/insurer-credentials';
import { allows } from './rights';
import { ModalityChangeError, changeAppointmentModalityTx } from './modality-change';
import { CONTRACT_IMPORT_LIMITS, ContractImportFileError } from './internal/contract-import';
import {
  ContractImportError,
  applyContractImport,
  validateContractImport,
  type ContractImportPreview,
} from './internal/contract-import-service';

export type ConfigResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Data inválida');
const optDay = day
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const optUuid = uuid
  .nullable()
  .optional()
  .transform((v) => v ?? null);

function messageOf(error: unknown): string {
  if (error instanceof AuthError) {
    return error.code === 'unauthenticated'
      ? 'Sua sessão terminou. Entre de novo para continuar.'
      : 'Seu perfil não tem permissão para esta configuração de convênios.';
  }
  const premium = premiumAccessErrorFrom(error);
  if (premium) return premiumDenialMessage(premium.feature, premium.reason);
  if (error instanceof ConveniosModuleDisabledError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Dados inválidos.';
  if (error instanceof cfg.InsuranceConfigError) return error.message;
  if (error instanceof ModalityChangeError) return error.message;
  if (error instanceof ContractImportFileError || error instanceof ContractImportError)
    return error.message;
  if (error instanceof Error && error.name === 'BillingModeChangeError') return error.message;
  if (error instanceof CoverageInputError)
    return error.message.charAt(0).toUpperCase() + error.message.slice(1);
  // 0164: o interruptor do módulo também no banco (caminho que pulou o serviço): a mesma mensagem do serviço.
  const constraint = (error as { constraint_name?: string; cause?: { constraint_name?: string } }).constraint_name ??
    (error as { cause?: { constraint_name?: string } }).cause?.constraint_name;
  if (constraint === 'hi_module_enabled') return new ConveniosModuleDisabledError().message;
  const e = error as { code?: string; cause?: { code?: string; message?: string } };
  const code = e.code ?? e.cause?.code;
  if (code && ['55000', '23514', '22023'].includes(code) && e.cause?.message)
    return e.cause.message;
  if (code === '23505') return 'Este registro já existe.';
  if (code === '23503') return 'Um dos itens escolhidos não pertence a esta clínica.';
  if (code === '42501') return 'Sem permissão para esta operação nesta clínica.';
  return 'Não foi possível concluir agora. Tente de novo; se persistir, fale com o suporte.';
}

async function run<T>(fn: () => Promise<T>): Promise<ConfigResult<T>> {
  try {
    const data = await fn();
    revalidatePath('/convenios', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

interface Ctx {
  clinicId: string;
  userId: string;
}

/**
 * Recepção com posse (D-3, opção B, aprovada em 16/11): quem opera Convênios age na clínica inteira;
 * quem só entra no módulo (a médica no pacote padrão) age só no que o servidor confere como dela,
 * dentro da MESMA transação da escrita. O que não é dela responde "não encontrado" (não confirma
 * existência por id adulterado).
 */
interface OperateOrOwn {
  kind: 'operate_or_own';
  /** Confere a posse com a pessoa da sessão (`ctx.userId`); só roda sem `operate:convenios`. */
  owns: (tx: Tx, ctx: Ctx) => Promise<boolean>;
  notFound: string;
}
type WriteAccess = Permission | OperateOrOwn;

/** Escrita com a pessoa da sessão; o `audit` devolvido pelo passo vai para a MESMA transação. */
async function write<T>(
  access: WriteAccess,
  action: string,
  resourceType: string,
  fn: (
    tx: Tx,
    ctx: Ctx,
  ) => Promise<{ result: T; resourceId: string | null; before?: unknown; after: unknown }>,
): Promise<T> {
  const user = await requireUser();
  let ownership: OperateOrOwn | null = null;
  if (typeof access === 'string') {
    await requireCachedPermission(access);
  } else {
    await requireCachedPermission(PERMISSIONS.VIEW_CONVENIOS);
    if (!user.isSuperAdmin && !allows(user.permissions, 'operate')) ownership = access;
  }
  const clinicId = await requireClinicId();
  const ctx = { clinicId, userId: user.userId };
  const rc = await requestContext();
  return withTenant(
    clinicId,
    async (tx) => {
      if (ownership && !(await ownership.owns(tx, ctx)))
        throw new cfg.InsuranceConfigError(ownership.notFound, 'NOT_FOUND');
      const out = await fn(tx, ctx);
      await logAudit(tx, {
        clinicId,
        userId: user.userId,
        action,
        resourceType,
        resourceId: out.resourceId,
        before: out.before ?? null,
        after: out.after,
        requestContext: rc,
      });
      return out.result;
    },
    user.userId,
  );
}

/** Cadastro e configuração (matriz 4.1; D-1 preços e D-2 política: só owner e gestor). */
const MANAGE = PERMISSIONS.MANAGE_CONVENIOS;

// ── Identificação do prestador ───────────────────────────────────────────

const Identity = z.object({
  providerKind: z.enum(['PF', 'PJ'], { message: 'Escolha pessoa jurídica ou física.' }),
  contractorName: z.string().max(200),
  cnesStatus: z.enum(['has', 'none_declared', 'unknown']),
  cnes: z
    .string()
    .max(20)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export async function saveProviderIdentityAction(
  input: z.input<typeof Identity>,
): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = Identity.parse(input);
    await write(
      MANAGE,
      'health_insurance.config.provider_identity_saved',
      'hi_clinic_settings',
      async (tx, ctx) => {
        const r = await cfg.saveProviderIdentityTx(tx, ctx.clinicId, d);
        return { result: null, resourceId: ctx.clinicId, before: r.before, after: r.after };
      },
    );
    return null;
  });
}

// ── Operadoras ───────────────────────────────────────────────────────────

const Insurer = z.object({
  name: z.string().max(200),
  registroAns: z.string().max(20),
  providerIdKind: z.enum(['codigoPrestadorNaOperadora', 'cnpjContratado', 'cpfContratado']),
  providerIdValue: z.string().max(40),
  sadtGrouping: z.enum(['per_session', 'per_request']).default('per_session'),
});

export async function createInsurerAction(
  input: z.input<typeof Insurer>,
): Promise<ConfigResult<string>> {
  return run(async () => {
    const d = Insurer.parse(input);
    return write(
      MANAGE,
      'health_insurance.config.insurer_created',
      'hi_insurer',
      async (tx, ctx) => {
        const r = await cfg.createInsurerTx(tx, ctx.clinicId, ctx.userId, d);
        const { providerIdValue: _omit, ...safe } = r.after;
        return {
          result: r.insurerId,
          resourceId: r.insurerId,
          after: { ...safe, insurerId: r.insurerId },
        };
      },
    );
  });
}

export async function updateInsurerAction(
  input: z.input<typeof Insurer> & { insurerId: string },
): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = Insurer.extend({ insurerId: uuid }).parse(input);
    const { insurerId, ...rest } = d;
    await write(
      MANAGE,
      'health_insurance.config.insurer_updated',
      'hi_insurer',
      async (tx, ctx) => {
        const r = await cfg.updateInsurerTx(tx, ctx.clinicId, insurerId, rest);
        // O identificador do prestador pode ser CPF: na auditoria só o tipo e se mudou.
        const strip = (x: { providerIdValue: string } & Record<string, unknown>) => {
          const { providerIdValue: _v, ...o } = x;
          return o;
        };
        return {
          result: null,
          resourceId: insurerId,
          before: strip(r.before),
          after: {
            ...strip(r.after),
            insurerId,
            providerIdChanged: r.before.providerIdValue !== r.after.providerIdValue,
          },
        };
      },
    );
    return null;
  });
}

export async function setInsurerStatusAction(input: {
  insurerId: string;
  status: string;
}): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = z
      .object({ insurerId: uuid, status: z.enum(['active', 'suspended', 'archived']) })
      .parse(input);
    await write(
      MANAGE,
      `health_insurance.config.insurer_${d.status}`,
      'hi_insurer',
      async (tx, ctx) => {
        const r = await cfg.setInsurerStatusTx(tx, ctx.clinicId, d.insurerId, d.status);
        return {
          result: null,
          resourceId: d.insurerId,
          before: { status: r.before },
          after: { status: r.after, insurerId: d.insurerId },
        };
      },
    );
    return null;
  });
}

// ── Planos ───────────────────────────────────────────────────────────────

const Plan = z.object({
  insurerId: uuid,
  name: z.string().max(200),
  operatorCode: z
    .string()
    .max(60)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  category: z
    .enum(['ambulatorial', 'hospitalar', 'referencia', 'outro'])
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

export async function createPlanAction(input: z.input<typeof Plan>): Promise<ConfigResult<string>> {
  return run(async () => {
    const d = Plan.parse(input);
    return write(MANAGE, 'health_insurance.config.plan_created', 'hi_plan', async (tx, ctx) => {
      const r = await cfg.createPlanTx(tx, ctx.clinicId, d.insurerId, d);
      return { result: r.planId, resourceId: r.planId, after: r.after };
    });
  });
}

export async function setPlanStatusAction(input: {
  planId: string;
  status: string;
}): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = z.object({ planId: uuid, status: z.enum(['active', 'archived']) }).parse(input);
    await write(
      MANAGE,
      `health_insurance.config.plan_${d.status === 'active' ? 'reactivated' : 'archived'}`,
      'hi_plan',
      async (tx, ctx) => {
        const r = await cfg.setPlanStatusTx(tx, ctx.clinicId, d.planId, d.status);
        return {
          result: null,
          resourceId: d.planId,
          before: { status: r.before },
          after: { status: r.after, insurerId: r.insurerId },
        };
      },
    );
    return null;
  });
}

// ── Contratos ────────────────────────────────────────────────────────────

const cents = z.number().int().min(0).max(9_999_999_999);
const Terms = z.object({
  unitValueCents: cents,
  requiresAuthorization: z.boolean(),
  copayKind: z.enum(['none', 'fixed', 'percentage']),
  copayFixedCents: cents
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  copayPercentage: z
    .number()
    .min(0)
    .max(100)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  returnDays: z
    .number()
    .int()
    .min(1)
    .max(365)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  returnBillable: z.boolean().default(false),
});

const ContractLine = Terms.extend({
  insurerId: uuid,
  planId: optUuid,
  guideType: z.enum(['consulta', 'sp_sadt']),
  procedureCode: z.string().max(20),
  description: z
    .string()
    .max(150)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  procedureId: uuid,
  validFrom: day,
  validUntil: optDay,
});

export async function createContractLineAction(
  input: z.input<typeof ContractLine>,
): Promise<ConfigResult<string>> {
  return run(async () => {
    const d = ContractLine.parse(input);
    return write(
      MANAGE,
      'health_insurance.config.contract_line_created',
      'hi_procedure_contract',
      async (tx, ctx) => {
        const r = await cfg.createContractLineTx(tx, ctx.clinicId, ctx.userId, {
          ...d,
          tableCode: '22',
        });
        return { result: r.lineId, resourceId: r.lineId, after: r.after };
      },
    );
  });
}

const reasonText = z.string().trim().min(10, 'Informe o motivo (10 a 500 caracteres).').max(500);
const Revision = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('correct'),
    terms: Terms,
    description: z
      .string()
      .max(150)
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    procedureId: uuid,
    reason: reasonText,
  }),
  z.object({ mode: z.literal('new_period'), from: day, terms: Terms, reason: reasonText }),
  z.object({ mode: z.literal('end'), until: day, reason: reasonText }),
]);

export async function reviseContractLineAction(input: {
  lineId: string;
  revision: z.input<typeof Revision>;
}): Promise<ConfigResult<string[]>> {
  return run(async () => {
    const d = z.object({ lineId: uuid, revision: Revision }).parse(input);
    return write(
      MANAGE,
      `health_insurance.config.contract_line_${d.revision.mode}`,
      'hi_procedure_contract',
      async (tx, ctx) => {
        const [cur] = (await tx.execute(
          sql`SELECT insurer_id::text AS insurer_id FROM public.hi_procedure_contracts WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.lineId}::uuid`,
        )) as unknown as Array<{ insurer_id: string }>;
        const r = await cfg.reviseContractLineTx(
          tx,
          ctx.clinicId,
          ctx.userId,
          d.lineId,
          d.revision,
        );
        return {
          result: r.lineIds,
          resourceId: d.lineId,
          after: { ...r.after, insurerId: cur?.insurer_id ?? null, lineIds: r.lineIds },
        };
      },
    );
  });
}

// ── Regras da operadora (P2.5) ───────────────────────────────────────────

const Rules = z.object({
  insurerId: uuid,
  requireProfessionalCredential: z.boolean(),
  maxGuidesPerBatch: z.number().int().min(1).max(100),
  submissionDeadlineDays: z.number().int().min(1).max(365).nullable(),
  // P8.4-r: sem a informação, fica "desconhecida" (o padrão não presume aceite).
  extraItemsAfterSession: z.enum(['unknown', 'accepts', 'forbids']).optional(),
});

export async function saveInsurerRulesAction(
  input: z.input<typeof Rules>,
): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = Rules.parse(input);
    await write(
      MANAGE,
      'health_insurance.config.insurer_rules_updated',
      'hi_insurer',
      async (tx, ctx) => {
        const r = await cfg.saveInsurerRulesTx(tx, ctx.clinicId, d.insurerId, d);
        return { result: null, resourceId: d.insurerId, before: r.before, after: r.after };
      },
    );
    return null;
  });
}

// ── Credenciamento por plano e vigência (P2.2) ───────────────────────────

const Credential = z.object({
  insurerId: uuid,
  planId: optUuid,
  allPlans: z.boolean().default(false),
  professionalId: optUuid,
  providerCode: z
    .string()
    .max(40)
    .nullable()
    .optional()
    .transform((v) => v ?? null),
  validFrom: day,
  validUntil: day
    .nullable()
    .optional()
    .transform((v) => v ?? null),
});

const reason = z.string().max(300);
const CredentialRevision = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('end'), validUntil: day, reason }),
  z.object({ mode: z.literal('suspend'), reason }),
  z.object({ mode: z.literal('reactivate'), reason }),
  z.object({
    mode: z.literal('new_period'),
    validFrom: day,
    validUntil: day
      .nullable()
      .optional()
      .transform((v) => v ?? null),
    providerCode: z.string().max(40).nullable().optional(),
    reason,
  }),
]);

export async function createCredentialAction(
  input: z.input<typeof Credential>,
): Promise<ConfigResult<string>> {
  return run(async () => {
    const d = Credential.parse(input);
    return write(
      MANAGE,
      'health_insurance.config.credential_created',
      'hi_credential',
      async (tx, ctx) => {
        const r = await cfg.createCredentialTx(tx, ctx.clinicId, ctx.userId, d);
        return { result: r.credentialId, resourceId: r.credentialId, after: r.after };
      },
    );
  });
}

export async function reviseCredentialAction(input: {
  credentialId: string;
  revision: z.input<typeof CredentialRevision>;
}): Promise<ConfigResult<string | null>> {
  return run(async () => {
    const d = z.object({ credentialId: uuid, revision: CredentialRevision }).parse(input);
    return write(
      MANAGE,
      `health_insurance.config.credential_${d.revision.mode}`,
      'hi_credential',
      async (tx, ctx) => {
        const r = await cfg.reviseCredentialTx(
          tx,
          ctx.clinicId,
          ctx.userId,
          d.credentialId,
          d.revision,
        );
        return {
          result: r.newCredentialId,
          resourceId: d.credentialId,
          before: r.before,
          after: { ...r.after, newCredentialId: r.newCredentialId },
        };
      },
    );
  });
}

// ── Perfil TISS do profissional ──────────────────────────────────────────

const Profile = z.object({
  professionalId: uuid,
  council: z.string().max(4),
  councilNumber: z.string().max(30),
  councilUf: z.string().max(4),
  cbo: z.string().max(12),
});

export async function saveProfessionalProfileAction(
  input: z.input<typeof Profile>,
): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = Profile.parse(input);
    await write(
      MANAGE,
      'health_insurance.config.professional_profile_saved',
      'hi_professional_profile',
      async (tx, ctx) => {
        const r = await cfg.saveProfessionalProfileTx(tx, ctx.clinicId, d);
        return { result: null, resourceId: d.professionalId, before: r.before, after: r.after };
      },
    );
    return null;
  });
}

// ── Busca nas tabelas oficiais ───────────────────────────────────────────

export async function searchOfficialTermsAction(input: {
  table: '22' | '24';
  term: string;
}): Promise<ConfigResult<Array<{ code: string; term: string }>>> {
  try {
    const d = z.object({ table: z.enum(['22', '24']), term: z.string().max(80) }).parse(input);
    await requireUser();
    await requireCachedPermission(PERMISSIONS.VIEW_CONVENIOS);
    const clinicId = await requireClinicId();
    return { ok: true, data: await searchOfficialTerms(clinicId, d.table, d.term) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

// ── Carteirinhas ─────────────────────────────────────────────────────────

const holder = z.enum(['titular', 'dependente']);
const Membership = z.object({
  patientId: uuid,
  insurerId: uuid,
  planId: optUuid,
  cardNumber: z.string().min(1, 'Informe o número da carteirinha.').max(40),
  holderKind: holder.default('titular'),
  validUntil: optDay,
  preferred: z.boolean().default(false),
});

/**
 * Carteirinha (matriz 4.2, D-3 opção B): a recepção em qualquer paciente da clínica; sem operar
 * Convênios, só no paciente com quem a pessoa tem atendimento (não cancelado) nesta clínica.
 */
function membershipAccess(patient: (tx: Tx, ctx: Ctx) => Promise<string | null>): OperateOrOwn {
  return {
    kind: 'operate_or_own',
    notFound: 'Carteirinha ou paciente não encontrado nesta clínica.',
    owns: async (tx, ctx) => {
      const patientId = await patient(tx, ctx);
      if (!patientId) return false;
      const rows = (await tx.execute(sql`
        SELECT 1 FROM public.appointments
         WHERE clinic_id = ${ctx.clinicId}::uuid AND patient_id = ${patientId}::uuid
           AND doctor_id = ${ctx.userId}::uuid AND status::text <> 'cancelado'
         LIMIT 1`)) as unknown as unknown[];
      return rows.length > 0;
    },
  };
}
const membershipPatient =
  (membershipId: string) =>
  async (tx: Tx, ctx: Ctx): Promise<string | null> => {
    const rows = (await tx.execute(sql`
      SELECT patient_id::text AS patient_id FROM public.hi_memberships
       WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${membershipId}::uuid`)) as unknown as Array<{
      patient_id: string;
    }>;
    return rows[0]?.patient_id ?? null;
  };
/** Cobertura do atendimento (D-3 opção B): sem operar Convênios, só no atendimento em que a pessoa é a profissional. */
function appointmentAccess(appointmentId: string): OperateOrOwn {
  return {
    kind: 'operate_or_own',
    notFound: 'Atendimento não encontrado nesta clínica.',
    owns: async (tx, ctx) => {
      const rows = (await tx.execute(sql`
        SELECT 1 FROM public.appointments
         WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${appointmentId}::uuid AND doctor_id = ${ctx.userId}::uuid`)) as unknown as unknown[];
      return rows.length > 0;
    },
  };
}

export async function createMembershipAction(
  input: z.input<typeof Membership>,
): Promise<ConfigResult<string>> {
  return run(async () => {
    const d = Membership.parse(input);
    return write(
      membershipAccess(async () => d.patientId),
      'health_insurance.config.membership_created',
      'hi_membership',
      async (tx, ctx) => {
        const r = await cfg.createMembershipTx(tx, ctx.clinicId, ctx.userId, d);
        return { result: r.membershipId, resourceId: r.membershipId, after: r.after };
      },
    );
  });
}

export async function replaceMembershipAction(input: {
  membershipId: string;
  cardNumber: string;
  planId?: string | null;
  holderKind: string;
  validUntil?: string | null;
}): Promise<ConfigResult<string>> {
  return run(async () => {
    const d = z
      .object({
        membershipId: uuid,
        cardNumber: z.string().min(1).max(40),
        planId: optUuid,
        holderKind: holder,
        validUntil: optDay,
      })
      .parse(input);
    return write(
      membershipAccess(membershipPatient(d.membershipId)),
      'health_insurance.config.membership_replaced',
      'hi_membership',
      async (tx, ctx) => {
        const r = await cfg.replaceMembershipTx(tx, ctx.clinicId, ctx.userId, d.membershipId, d);
        return { result: r.membershipId, resourceId: r.membershipId, after: r.after };
      },
    );
  });
}

export async function updateMembershipAction(input: {
  membershipId: string;
  planId?: string | null;
  holderKind: string;
  validUntil?: string | null;
}): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = z
      .object({ membershipId: uuid, planId: optUuid, holderKind: holder, validUntil: optDay })
      .parse(input);
    await write(
      membershipAccess(membershipPatient(d.membershipId)),
      'health_insurance.config.membership_updated',
      'hi_membership',
      async (tx, ctx) => {
        const r = await cfg.updateMembershipTx(tx, ctx.clinicId, d.membershipId, d);
        return { result: null, resourceId: d.membershipId, before: r.before, after: r.after };
      },
    );
    return null;
  });
}

export async function setMembershipActiveAction(input: {
  membershipId: string;
  active: boolean;
}): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = z.object({ membershipId: uuid, active: z.boolean() }).parse(input);
    await write(
      membershipAccess(membershipPatient(d.membershipId)),
      `health_insurance.config.membership_${d.active ? 'reactivated' : 'deactivated'}`,
      'hi_membership',
      async (tx, ctx) => {
        const r = await cfg.setMembershipActiveTx(tx, ctx.clinicId, d.membershipId, d.active);
        return {
          result: null,
          resourceId: d.membershipId,
          before: { status: r.before },
          after: { status: r.after },
        };
      },
    );
    return null;
  });
}

export async function setPreferredMembershipAction(input: {
  membershipId: string;
}): Promise<ConfigResult<null>> {
  return run(async () => {
    const d = z.object({ membershipId: uuid }).parse(input);
    await write(
      membershipAccess(membershipPatient(d.membershipId)),
      'health_insurance.config.membership_preferred',
      'hi_membership',
      async (tx, ctx) => {
        await cfg.setPreferredMembershipTx(tx, ctx.clinicId, d.membershipId);
        return { result: null, resourceId: d.membershipId, after: { preferred: true } };
      },
    );
    return null;
  });
}

/** Número completo para conferir no atendimento: leitura auditada (finalidade e superfície). */
export async function revealMembershipNumberAction(input: {
  membershipId: string;
}): Promise<ConfigResult<string>> {
  try {
    const d = z.object({ membershipId: uuid }).parse(input);
    await requireUser();
    const clinicId = await requireClinicId();
    const card = await readMembershipCardNumberAudited(
      clinicId,
      d.membershipId,
      'atendimento',
      'convenios_carteirinhas',
    );
    if (!card) return { ok: false, error: 'Carteirinha não encontrada nesta clínica.' };
    return { ok: true, data: card.cardNumber };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Agenda: carteirinhas ativas (mascaradas) do paciente para a forma de atendimento "Convênio". */
export async function listSchedulingCardsAction(input: {
  patientId: string;
}): Promise<ConfigResult<SchedulingCard[]>> {
  try {
    const d = z.object({ patientId: uuid }).parse(input);
    await requireUser();
    await requireCachedPermission(PERMISSIONS.EDIT_AGENDA);
    const clinicId = await requireClinicId();
    return { ok: true, data: await listPatientCardsForScheduling(clinicId, d.patientId) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

// ── Cobertura de um atendimento já agendado (P5.1/P5.2) ──────────────────

const CoverageChoice = z.object({
  appointmentId: uuid,
  insurerId: uuid,
  planId: optUuid,
  membershipId: optUuid,
  guideType: z.enum(['consulta', 'sp_sadt']),
});

/**
 * Registra ou corrige a cobertura de um atendimento de convênio ainda não começado
 * (remarcado, criado sem carteirinha, operadora trocada). O serviço rederiva contrato,
 * autorização e coparticipação; o banco congela a cobertura quando o atendimento começa.
 */
export async function recordAppointmentCoverageAction(
  input: z.input<typeof CoverageChoice>,
): Promise<ConfigResult<{ status: string; issues: string[] }>> {
  return run(async () => {
    const d = CoverageChoice.parse(input);
    return write(
      appointmentAccess(d.appointmentId),
      'health_insurance.coverage.recorded',
      'hi_appointment_coverage',
      async (tx, ctx) => {
        const [ap] = (await tx.execute(
          sql`SELECT a.patient_id::text AS patient_id, a.procedure_id::text AS procedure_id, a.billing_mode, a.status::text AS status,
                   to_char(a.scheduled_at AT TIME ZONE coalesce(c.timezone, 'America/Sao_Paulo'), 'YYYY-MM-DD') AS day
              FROM public.appointments a JOIN public.clinics c ON c.id = a.clinic_id
             WHERE a.clinic_id = ${ctx.clinicId}::uuid AND a.id = ${d.appointmentId}::uuid`,
        )) as unknown as Array<{
          patient_id: string | null;
          procedure_id: string;
          billing_mode: string;
          status: string;
          day: string;
        }>;
        if (!ap)
          throw new cfg.InsuranceConfigError(
            'Atendimento não encontrado nesta clínica.',
            'APPOINTMENT_NOT_FOUND',
          );
        if (ap.billing_mode !== 'convenio')
          throw new cfg.InsuranceConfigError('Este atendimento é particular.', 'NOT_INSURANCE');
        if (!ap.patient_id)
          throw new cfg.InsuranceConfigError('O atendimento não tem paciente.', 'NO_PATIENT');
        const out = await recordAppointmentCoverage(tx, {
          clinicId: ctx.clinicId,
          appointmentId: d.appointmentId,
          patientId: ap.patient_id,
          procedureId: ap.procedure_id,
          appointmentDate: ap.day,
          guideType: d.guideType,
          insurerId: d.insurerId,
          planId: d.planId,
          membershipId: d.membershipId,
          authorizationId: null,
          actor: { kind: 'user', userId: ctx.userId },
        });
        return {
          result: { status: out.status, issues: out.issues.map((i) => i.message) },
          resourceId: out.coverageId,
          after: {
            appointmentId: d.appointmentId,
            insurerId: d.insurerId,
            status: out.status,
            issues: out.issues.map((i) => i.code),
          },
        };
      },
    );
  });
}

// ── Forma de atendimento de um atendimento já criado (P4.3) ──────────────

const ModalityChange = z.object({
  appointmentId: uuid,
  to: z.enum(['particular', 'convenio']),
  insurerId: optUuid,
  planId: optUuid,
  membershipId: optUuid,
  guideType: z.enum(['consulta', 'sp_sadt']).default('consulta'),
  reason: z
    .string()
    .trim()
    .min(10, 'Diga o motivo da troca (10 a 500 caracteres).')
    .max(500, 'O motivo tem no máximo 500 caracteres.'),
  idempotencyKey: uuid,
});

/**
 * Troca particular ↔ convênio pela agenda, até a chegada (P4.3). Pré-condições, troca da
 * modalidade e cobertura (ou o cancelamento dela) numa transação, com auditoria. Devolve a chave
 * do `billing_mode_changed` para a camada de app processar logo (o Payments anula o link
 * particular aberto quando vira convênio).
 */
export async function changeAppointmentModalityAction(
  input: z.input<typeof ModalityChange>,
): Promise<
  ConfigResult<{
    from: 'particular' | 'convenio';
    to: 'particular' | 'convenio';
    coverageStatus: string | null;
    issues: string[];
    eventKey: string;
  }>
> {
  return run(async () => {
    const d = ModalityChange.parse(input);
    if (d.to === 'convenio' && !d.insurerId) {
      throw new cfg.InsuranceConfigError(
        'Escolha a operadora (e, se houver, o plano e a carteirinha).',
        'CHOICE_REQUIRED',
      );
    }
    return write(
      PERMISSIONS.EDIT_AGENDA,
      'health_insurance.appointment.modality_changed',
      'appointment',
      async (tx, ctx) => {
        const out = await changeAppointmentModalityTx(tx, {
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          appointmentId: d.appointmentId,
          to: d.to,
          choice:
            d.to === 'convenio' && d.insurerId
              ? {
                  insurerId: d.insurerId,
                  planId: d.planId ?? null,
                  membershipId: d.membershipId ?? null,
                  guideType: d.guideType,
                }
              : null,
          reason: d.reason,
          idempotencyKey: d.idempotencyKey,
        });
        return {
          result: {
            from: out.from,
            to: out.to,
            coverageStatus: out.coverageStatus,
            issues: out.issues,
            eventKey: out.eventKey,
          },
          resourceId: d.appointmentId,
          before: { billingMode: out.from },
          after: {
            billingMode: out.to,
            reason: d.reason,
            insurerId: d.to === 'convenio' ? (d.insurerId ?? null) : null,
            coverageId: out.coverageId,
            coverageStatus: out.coverageStatus,
          },
        };
      },
    );
  });
}

// ── Importação da tabela contratual por planilha (P2.7) ──────────────────

/**
 * Prévia: lê o CSV/XLSX, valida cada linha pela MESMA regra da tela numa transação desfeita e
 * registra a importação (validada ou recusada) com o resultado por linha. Nenhum contrato muda.
 */
export async function validateContractImportAction(
  formData: FormData,
): Promise<ConfigResult<ContractImportPreview>> {
  return run(async () => {
    // Sessão e permissão ANTES de ler o arquivo.
    const user = await requireUser();
    await requireCachedPermission(MANAGE);
    const clinicId = await requireClinicId();
    const insurerId = uuid.parse(formData.get('insurerId'));
    const file = formData.get('file');
    if (!(file instanceof File)) {
      throw new cfg.InsuranceConfigError('Escolha a planilha (.csv ou .xlsx).', 'IMPORT_FILE');
    }
    if (file.size > CONTRACT_IMPORT_LIMITS.maxBytes) {
      throw new cfg.InsuranceConfigError(
        'O arquivo passa de 2 MB. Divida em arquivos menores.',
        'IMPORT_FILE',
      );
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return validateContractImport({
      clinicId,
      userId: user.userId,
      insurerId,
      fileName: file.name,
      bytes,
      requestContext: await requestContext(),
    });
  });
}

/** Aplica uma importação validada: tudo ou nada, revalidando contra o estado atual. */
export async function applyContractImportAction(input: {
  importId: string;
}): Promise<ConfigResult<Awaited<ReturnType<typeof applyContractImport>>>> {
  return run(async () => {
    const user = await requireUser();
    await requireCachedPermission(MANAGE);
    const clinicId = await requireClinicId();
    const importId = uuid.parse(input.importId);
    return applyContractImport({
      clinicId,
      userId: user.userId,
      importId,
      requestContext: await requestContext(),
    });
  });
}

// ── Credenciais da clínica na operadora (P2.5, engenharia sem operadora real) ──

const InsurerCredential = z.object({
  insurerId: uuid,
  kind: z.enum(['webservice_login', 'certificate']),
  username: z.string().trim().max(200).nullable().optional(),
  secret: z.string().min(8, 'A senha/certificado precisa ter pelo menos 8 caracteres.').max(16_384),
});

/** Salva ou rotaciona (a anterior vira revogada). A auditoria nunca leva o segredo. */
export async function saveInsurerCredentialAction(
  input: z.input<typeof InsurerCredential>,
): Promise<ConfigResult<{ rotated: boolean }>> {
  return run(async () => {
    const d = InsurerCredential.parse(input);
    // Segredo da operadora: permissão FRESCA (relida do banco), não só a do token (matriz 4.1).
    await requireFreshPermission(MANAGE);
    return write(
      MANAGE,
      'health_insurance.config.insurer_credential_saved',
      'hi_insurer_credential',
      async (tx, ctx) => {
        const out = await saveInsurerCredentialTx(tx, {
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          insurerId: d.insurerId,
          kind: d.kind,
          username: d.username ?? null,
          secret: d.secret,
        });
        return {
          result: { rotated: out.rotated },
          resourceId: out.credentialId,
          after: { insurerId: d.insurerId, kind: d.kind, rotated: out.rotated },
        };
      },
    );
  });
}

export async function revokeInsurerCredentialAction(input: {
  insurerId: string;
  credentialId: string;
}): Promise<ConfigResult<null>> {
  return run(async () => {
    const insurerId = uuid.parse(input.insurerId);
    const credentialId = uuid.parse(input.credentialId);
    await requireFreshPermission(MANAGE);
    return write(
      MANAGE,
      'health_insurance.config.insurer_credential_revoked',
      'hi_insurer_credential',
      async (tx, ctx) => {
        await revokeInsurerCredentialTx(tx, { clinicId: ctx.clinicId, insurerId, credentialId });
        return { result: null, resourceId: credentialId, after: { insurerId, status: 'revoked' } };
      },
    );
  });
}
