'use server';

/**
 * Ações da interface de Convênios (P7.7/P9.9) sobre os serviços reais: guia (conferir,
 * devolver, aprovar, cancelar), lote (criar, exportar XML, enviar, protocolo, análise,
 * cancelar) e conta da guia (glosa, recurso, pagamento, estorno, conciliação).
 *
 * Pipeline de toda escrita: requireUser → permissão da matriz I.2 (`rights.ts`: a regra de cada
 * escrita sai do evento de auditoria, falha fechada) → Zod →
 * serviço dentro de withTenant com a pessoa da sessão (as funções do banco conferem a
 * clínica, a versão, o estado e o bloqueio comercial de novo) → auditoria na mesma
 * transação. O resultado é `{ ok, data } | { ok: false, error }` com mensagem para o
 * usuário, sem detalhe técnico nem dado pessoal.
 */
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { logAudit } from '@/lib/audit/log';
import { requestContext } from '@/lib/audit/request-context-from-headers';
import { PERMISSIONS } from '@/lib/auth/permissions';
import {
  AuthError,
  requireCachedAnyPermission,
  requireCachedPermission,
  requireClinicId,
  requireFreshPermission,
  requireUser,
} from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { premiumAccessErrorFrom, premiumDenialMessage } from '@/lib/premium-access';
import { ConveniosModuleDisabledError, assertConveniosOperableTx } from './internal/module-guard';
import {
  AuthorizationError,
  attachAuthorizationReceipt,
  recordManualAuthorizationResponseTx,
} from './internal/authorizations';
import * as alertService from './internal/authorization-alert-service';
import * as receiptUpload from './internal/receipt-upload';
// eslint-disable-next-line boundaries/element-types -- paymentsApiV1 é a API pública do Pagamentos (M14): o único caminho Asaas do convênio é o da coparticipação.
import { paymentsApiV1 } from '@/contexts/payments/api';
import { supabaseTissObjectStore, TissStorageError } from '@/lib/storage/tiss-files';

import { AppealXmlError, exportAppealXml } from './internal/appeal-xml-service';
import * as batches from './internal/batch-service';
import { readBatchGuidesAudited } from './internal/guide-access';
import { readMembershipCardNumberAudited } from './internal/membership-access';
import type { SadtRequestDocumentOutcome } from './internal/sadt-request-document';
import {
  CopayChargeError,
  requestCopayCharge,
  syncCopayChargeTx,
} from './internal/copay-charge-service';
import { GUIDE_STATUS_LABELS } from './guide-status-labels';
import {
  ConsultaOverridesError,
  updateConsultaOverridesInTx,
} from './internal/consulta-overrides-service';
import { CoverageInputError, recordAppointmentCoverage } from './internal/coverage-service';
import * as extraItems from './internal/extra-executed-items';
import { approveConsultaGuide } from './internal/guide-issuance';
import * as acct from './internal/insurance-account-service';
import * as payouts from './internal/insurance-payout-service';
import * as review from './internal/payout-review-service';
import * as cancellation from './internal/guide-cancellation-service';
import * as sadt from './internal/sadt-request-service';
import {
  importOperatorStatement,
  StatementImportError,
  type StatementImportResult,
} from './internal/statement-import-service';
import { loadXmllintValidator } from './tiss/xml/xsd-validator';
import { getAppointmentExtraItems, type SessionExtraItems } from './queries';
import { CONVENIOS_RULES, allows, conveniosRights, ruleForAuditAction, type ConveniosRule } from './rights';

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const BASE = '/convenios';
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Data inválida');
const version = z.number().int().min(1);
const cents = z.number().int().min(1).max(9_999_999_999);
const reason = z.string().trim().min(10, 'Informe o motivo (10 a 500 caracteres).').max(500);
const key = z.string().min(8).max(200);

/** Portão: sessão → QUALQUER código da regra (matriz I.2) → clínica da sessão. */
async function gate(rule: ConveniosRule): Promise<{ clinicId: string; userId: string }> {
  const user = await requireUser();
  await requireCachedAnyPermission(CONVENIOS_RULES[rule]);
  const clinicId = await requireClinicId();
  return { clinicId, userId: user.userId };
}

/** "só se emite guia conferida (estado: approved)" → "Só se emite guia conferida (etapa: Aprovada)". */
function guideIssuanceMessage(raw: string): string {
  const text = raw.replace(
    /\(estado: ([a-z_]+)\)/u,
    (_m, status: string) => `(etapa: ${GUIDE_STATUS_LABELS[status] ?? status})`,
  );
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Mensagem para o usuário: regra de negócio do banco fica; o resto vira mensagem genérica. */
function messageOf(error: unknown): string {
  if (error instanceof AuthError) {
    // Acesso desativado ou conta removida não é "sessão terminou": entrar de novo não resolve, e
    // dizer isso mandava a pessoa para o login só para descobrir o bloqueio lá (P0.3 de 15/11).
    if (error.reason === 'USER_DISABLED' || error.reason === 'USER_DELETED')
      return 'Seu acesso a esta clínica foi desativado. Fale com o administrador da clínica.';
    return error.code === 'unauthenticated'
      ? 'Sua sessão terminou. Entre de novo para continuar.'
      : 'Seu perfil não tem permissão para esta operação de convênios.';
  }
  const premium = premiumAccessErrorFrom(error);
  if (premium) return premiumDenialMessage(premium.feature, premium.reason);
  if (error instanceof ConveniosModuleDisabledError) return error.message;
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Dados inválidos.';
  // Autorização da operadora (P6.1/P6.3): a mensagem já é para o usuário e não leva dado pessoal.
  if (error instanceof AuthorizationError) return error.message;
  if (error instanceof acct.InsuranceAccountError) return error.message;
  if (error instanceof batches.BatchExportError) return error.message;
  // Pelo nome (não por instanceof): a regra contratual do lote (P2.5) já traz a mensagem do usuário.
  if (error instanceof Error && error.name === 'BatchRuleError') return error.message;
  if (error instanceof AppealXmlError) {
    // Pendências do padrão TISS: mensagem humana do validador, sem dado pessoal.
    const first = error.details
      .find((d) => d.includes(': '))
      ?.split(': ')
      .slice(1)
      .join(': ');
    return first ? `${error.message}: ${first}` : error.message;
  }
  if (error instanceof StatementImportError) return error.message;
  if (error instanceof Error && error.name === 'SadtRequestDocumentError') {
    const details = (error as Error & { details?: string[] }).details ?? [];
    const first = details
      .find((d) => d.includes(': '))
      ?.split(': ')
      .slice(1)
      .join(': ');
    const msg = error.message.charAt(0).toUpperCase() + error.message.slice(1);
    return first ? `${msg}: ${first}` : msg;
  }
  if (
    error instanceof sadt.SadtRequestError ||
    error instanceof CoverageInputError ||
    error instanceof payouts.InsurancePayoutError ||
    error instanceof review.PayoutReviewError ||
    error instanceof receiptUpload.ReceiptUploadError ||
    error instanceof alertService.AuthorizationAlertError ||
    error instanceof cancellation.GuideCancellationError ||
    error instanceof CopayChargeError
  ) {
    return error.message.charAt(0).toUpperCase() + error.message.slice(1);
  }
  if (error instanceof TissStorageError)
    return 'O armazenamento de arquivos está indisponível agora. Tente de novo em instantes.';
  // Emissão (P7.5/P14.2): a mensagem já é para o usuário e não leva dado pessoal; a etapa sai
  // pelo nome da tela e a primeira pendência do validador vai junto.
  if (error instanceof Error && error.name === 'GuideIssuanceError') {
    const issues = (error as Error & { issues?: Array<{ message: string }> }).issues ?? [];
    const msg = guideIssuanceMessage(error.message);
    return issues[0] ? `${msg}: ${issues[0].message}` : msg;
  }
  if (error instanceof ConsultaOverridesError) return error.message;
  // P8.4: regra do item executado adicional (mensagem já para o usuário, sem dado pessoal).
  if (error instanceof extraItems.ExtraItemRuleError) return error.message;
  // 0164: o interruptor do módulo também no banco (caminho que pulou o serviço): a mesma mensagem do serviço.
  const constraint = (error as { constraint_name?: string; cause?: { constraint_name?: string } }).constraint_name ??
    (error as { cause?: { constraint_name?: string } }).cause?.constraint_name;
  if (constraint === 'hi_module_enabled') return new ConveniosModuleDisabledError().message;
  const e = error as { code?: string; cause?: { code?: string; message?: string } };
  const code = e.code ?? e.cause?.code;
  // Regras do banco (estado, versão, CHECK): a mensagem já é para o usuário e não leva dado pessoal.
  if (code && ['55000', '23514', '22023', '40001'].includes(code) && e.cause?.message)
    return e.cause.message;
  if (code === '23505') return 'Este registro já existe.';
  if (code === '42501') return 'Sem permissão para esta operação nesta clínica.';
  return 'Não foi possível concluir agora. Tente de novo; se persistir, fale com o suporte.';
}

async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    revalidatePath(BASE, 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Escrita com a pessoa da sessão e auditoria na mesma transação. */
async function write<T>(
  action: string,
  resource: { type: string; id: string | null },
  fn: (
    tx: Parameters<Parameters<typeof withTenant>[1]>[0],
    ctx: { clinicId: string; userId: string },
  ) => Promise<T>,
): Promise<T> {
  const ctx = await gate(ruleForAuditAction(action));
  const rc = await requestContext();
  return withTenant(
    ctx.clinicId,
    async (tx) => {
      const out = await fn(tx, ctx);
      await logAudit(tx, {
        clinicId: ctx.clinicId,
        userId: ctx.userId,
        action,
        resourceType: resource.type,
        resourceId: resource.id ?? (typeof out === 'string' ? out : null),
        before: null,
        after: { result: typeof out === 'string' || typeof out === 'number' ? out : 'ok' },
        requestContext: rc,
      });
      return out;
    },
    ctx.userId,
  );
}

// ── Guias ─────────────────────────────────────────────────────────────────

const GuideRef = z.object({ guideId: uuid, version });

/** Conferência (recepção/gestor): a guia sem pendência fica "conferida". */
export async function reviewGuideAction(
  input: z.input<typeof GuideRef>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GuideRef.parse(input);
    await write(
      'health_insurance.guide.reviewed',
      { type: 'hi_guide', id: d.guideId },
      async (tx, ctx) => {
        // D24: conferir prepara cobrança nova da operadora; em trial ou com a assinatura parada,
        // não. O gatilho do banco em `hi_guides` só barra a CRIAÇÃO da guia, por isso a
        // checagem fica aqui, na mesma transação (P0.3 de 15/11: antes passava com a clínica suspensa).
        await assertConveniosOperableTx(tx, ctx.clinicId); // D24 + módulo ligado (classe A)
        const rows =
          await tx.execute(sql`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${ctx.userId}::uuid
          WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.guideId}::uuid AND version = ${d.version} RETURNING id`);
        if ((rows as unknown as unknown[]).length === 0)
          throw new acct.InsuranceAccountError(
            'A guia mudou desde que a tela foi aberta. Atualize e confira de novo.',
            'conflict',
          );
      },
    );
    return null;
  });
}

// Mensagens em português: a tela só manda códigos da terminologia, mas uma requisição adulterada
// mostrava o texto padrão do Zod, em inglês (P0.3 de 15/11).
const code = (label: string, max: number) =>
  z.string().max(max, `${label}: código fora da terminologia da ANS. Escolha uma opção da lista.`).nullish();
const ConsultaFields = GuideRef.extend({
  regimeAtendimento: code('Regime de atendimento', 2),
  indicacaoAcidente: code('Indicação de acidente', 1),
  tipoConsulta: code('Tipo de consulta', 1),
  coberturaEspecial: code('Cobertura especial', 2),
  saudeOcupacional: code('Saúde ocupacional', 2),
  observacao: z.string().max(500, 'Observação: até 500 caracteres (padrão TISS).').nullish(),
});

/**
 * Ajusta os dados da Guia de Consulta (D11, P4.6) com a guia em edição. Campo vazio volta ao
 * padrão. Devolve a versão nova da guia (a tela usa nas próximas ações).
 */
export async function updateConsultaFieldsAction(
  input: z.input<typeof ConsultaFields>,
): Promise<ActionResult<number>> {
  return run(async () => {
    const { guideId, version: v, ...fields } = ConsultaFields.parse(input);
    return write(
      'health_insurance.guide.consulta_fields_updated',
      { type: 'hi_guide', id: guideId },
      async (tx, ctx) =>
        (
          await updateConsultaOverridesInTx(tx, {
            clinicId: ctx.clinicId,
            guideId,
            version: v,
            input: fields,
          })
        ).version,
    );
  });
}

// ── P8.4: itens executados adicionais (conferência) ──────────────────────

const ExtraItemInput = z.object({
  appointmentId: uuid,
  contractLineId: uuid,
  quantity: z
    .number({ message: 'Informe a quantidade (1 a 999).' })
    .int('A quantidade precisa ser um número inteiro de 1 a 999.')
    .min(1, 'A quantidade precisa ser um número inteiro de 1 a 999.')
    .max(999, 'A quantidade precisa ser um número inteiro de 1 a 999.'),
});

/**
 * Registra, na conferência, um item de contrato executado na sessão além do agendado (P8.4). Só
 * registra: pela P8.4-r, nada entra na guia sem a decisão explícita do faturamento.
 */
export async function recordExtraItemAction(
  input: z.input<typeof ExtraItemInput>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = ExtraItemInput.parse(input);
    return write(
      'health_insurance.extra_item.recorded',
      { type: 'hi_appointment_extra_item', id: null },
      async (tx, ctx) =>
        (
          await extraItems.recordExtraItemTx(tx, {
            clinicId: ctx.clinicId,
            appointmentId: d.appointmentId,
            contractLineId: d.contractLineId,
            quantity: d.quantity,
            source: 'conferencia',
            actorUserId: ctx.userId,
          })
        ).id,
    );
  });
}

/**
 * Exceção do médico (P8.4-r, 24/11): o profissional registra, pelo consultório, o item executado
 * na PRÓPRIA sessão. Regra `ownSession` (quem vê Convênios) + posse do atendimento conferida no
 * servidor, na mesma transação; só registrar (não liga autorização, não inclui, não vê valor).
 */
export async function recordOwnSessionExtraItemAction(
  input: z.input<typeof ExtraItemInput>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = ExtraItemInput.parse(input);
    return write(
      'health_insurance.extra_item.recorded_own_session',
      { type: 'hi_appointment_extra_item', id: null },
      async (tx, ctx) => {
        await extraItems.assertOwnSessionTx(tx, { clinicId: ctx.clinicId, appointmentId: d.appointmentId, userId: ctx.userId });
        return (
          await extraItems.recordExtraItemTx(tx, {
            clinicId: ctx.clinicId,
            appointmentId: d.appointmentId,
            contractLineId: d.contractLineId,
            quantity: d.quantity,
            source: 'consultorio',
            actorUserId: ctx.userId,
          })
        ).id;
      },
    );
  });
}

/**
 * Leitura do bloco do consultório (exceção do médico): os itens da sessão, sem valor nem decisão
 * de faturamento. Sem visão ampla de Convênios, só o profissional da sessão lê (posse no servidor,
 * em `getAppointmentExtraItems`); de outra pessoa, `null`.
 */
export async function loadSessionExtraItemsAction(input: {
  appointmentId: string;
}): Promise<ActionResult<SessionExtraItems | null>> {
  try {
    const { appointmentId } = z.object({ appointmentId: uuid }).parse(input);
    const ctx = await gate('ownSession');
    const user = await requireUser();
    const broad = conveniosRights(user.permissions).broad;
    return { ok: true, data: await getAppointmentExtraItems(ctx.clinicId, appointmentId, { userId: ctx.userId, broad }) };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

const ExtraItemRef = z.object({ itemId: uuid });

/** Recepção ou faturamento: liga a autorização concedida da solicitação da sessão ao item. */
export async function regularizeExtraItemAction(
  input: z.input<typeof ExtraItemRef>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = ExtraItemRef.parse(input);
    await write(
      'health_insurance.extra_item.regularized',
      { type: 'hi_appointment_extra_item', id: d.itemId },
      async (tx, ctx) => {
        await extraItems.regularizeExtraItemTx(tx, { clinicId: ctx.clinicId, itemId: d.itemId });
      },
    );
    return null;
  });
}

const ExtraItemInclude = ExtraItemRef.extend({ insurerRuleConfirmed: z.boolean().default(false) });

/** Faturamento (permissão fresca): "Incluir na guia". Nunca automático; consome o saldo uma vez. */
export async function includeExtraItemAction(
  input: z.input<typeof ExtraItemInclude>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = ExtraItemInclude.parse(input);
    await requireFreshPermission(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    await write(
      'health_insurance.extra_item.included',
      { type: 'hi_appointment_extra_item', id: d.itemId },
      async (tx, ctx) => {
        await extraItems.includeExtraItemTx(tx, {
          clinicId: ctx.clinicId,
          itemId: d.itemId,
          actorUserId: ctx.userId,
          insurerRuleConfirmed: d.insurerRuleConfirmed,
        });
      },
    );
    return null;
  });
}

const ExtraItemExclude = ExtraItemRef.extend({
  reason: z
    .string()
    .trim()
    .min(10, 'Explique o motivo de não faturar (10 a 300 caracteres).')
    .max(300, 'Explique o motivo de não faturar (10 a 300 caracteres).'),
});

/** Faturamento: o item fica registrado e não é faturado, com motivo. */
export async function excludeExtraItemAction(
  input: z.input<typeof ExtraItemExclude>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = ExtraItemExclude.parse(input);
    await write(
      'health_insurance.extra_item.excluded',
      { type: 'hi_appointment_extra_item', id: d.itemId },
      async (tx, ctx) => {
        await extraItems.excludeExtraItemTx(tx, { clinicId: ctx.clinicId, itemId: d.itemId, reason: d.reason });
      },
    );
    return null;
  });
}

const ExtraItemCancel = z.object({
  itemId: uuid,
  reason: z.string().trim().min(3, 'Explique o motivo do cancelamento (3 a 300 caracteres).').max(300, 'Explique o motivo do cancelamento (3 a 300 caracteres).'),
});

/** Cancela um item executado adicional, com motivo (nada é apagado). */
export async function cancelExtraItemAction(
  input: z.input<typeof ExtraItemCancel>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = ExtraItemCancel.parse(input);
    await write(
      'health_insurance.extra_item.cancelled',
      { type: 'hi_appointment_extra_item', id: d.itemId },
      async (tx, ctx) => {
        await extraItems.cancelExtraItemTx(tx, { clinicId: ctx.clinicId, itemId: d.itemId, reason: d.reason });
      },
    );
    return null;
  });
}

const GuideNote = GuideRef.extend({ note: reason });

/** Devolve para correção (conferida ou aprovada ainda fora de lote → "para conferir"). */
export async function returnGuideAction(
  input: z.input<typeof GuideNote>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GuideNote.parse(input);
    await write(
      'health_insurance.guide.returned',
      { type: 'hi_guide', id: d.guideId },
      async (tx, ctx) => {
        // D24: devolver reabre a guia para nova emissão (operação nova); com a assinatura parada,
        // não. Cancelar continua permitido: não gera cobrança e encerra o que não será faturado.
        await assertConveniosOperableTx(tx, ctx.clinicId); // D24 + módulo ligado (classe A)
        const rows =
          await tx.execute(sql`UPDATE public.hi_guides SET status = 'ready_for_review', transition_note = ${d.note}
          WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.guideId}::uuid AND version = ${d.version} RETURNING id`);
        if ((rows as unknown as unknown[]).length === 0)
          throw new acct.InsuranceAccountError(
            'A guia mudou desde que a tela foi aberta. Atualize e tente de novo.',
            'conflict',
          );
      },
    );
    return null;
  });
}

/** Cancela uma guia ainda não faturada (motivo obrigatório; final). */
export async function cancelGuideAction(
  input: z.input<typeof GuideNote>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GuideNote.parse(input);
    await write(
      'health_insurance.guide.cancelled',
      { type: 'hi_guide', id: d.guideId },
      async (tx, ctx) => {
        const rows =
          await tx.execute(sql`UPDATE public.hi_guides SET status = 'cancelled', cancel_reason = ${d.note}, cancelled_by = ${ctx.userId}::uuid
          WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.guideId}::uuid AND version = ${d.version} RETURNING id`);
        if ((rows as unknown as unknown[]).length === 0)
          throw new acct.InsuranceAccountError(
            'A guia mudou desde que a tela foi aberta. Atualize e tente de novo.',
            'conflict',
          );
      },
    );
    return null;
  });
}

/** Aprovação = emissão: congela o snapshot cifrado (leitura auditada da carteirinha). */
export async function approveGuideAction(input: { guideId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { guideId } = z.object({ guideId: uuid }).parse(input);
    const ctx = await gate('bill');
    await requireFreshPermission(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    await approveConsultaGuide(ctx.clinicId, guideId);
    return null;
  });
}

const ApproveWithout = z.object({
  guideId: uuid,
  reason: z
    .string()
    .trim()
    .min(10, 'Explique por que os itens não serão faturados (10 a 300 caracteres).')
    .max(300, 'Explique por que os itens não serão faturados (10 a 300 caracteres).'),
});

/**
 * P8.4-r ("aprovar sem o item"): aprova e emite a guia registrando, na MESMA transação, que os
 * itens executados adicionais pendentes não serão faturados, com o motivo. Auditado.
 */
export async function approveGuideWithoutPendingExtraItemsAction(
  input: z.input<typeof ApproveWithout>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = ApproveWithout.parse(input);
    const ctx = await gate('bill');
    await requireFreshPermission(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    await approveConsultaGuide(ctx.clinicId, d.guideId, { withoutPendingExtraItems: { reason: d.reason } });
    return null;
  });
}

// ── Lotes ─────────────────────────────────────────────────────────────────

const CreateBatch = z.object({
  insurerId: uuid,
  guideType: z.enum(['consulta', 'sp_sadt']).default('consulta'),
  guideIds: z.array(uuid).min(1).max(100),
  idempotencyKey: key,
});

export async function createBatchAction(
  input: z.input<typeof CreateBatch>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = CreateBatch.parse(input);
    return write('health_insurance.batch.created', { type: 'hi_batch', id: null }, (tx, ctx) =>
      batches.createBatchInTx(tx, {
        clinicId: ctx.clinicId,
        insurerId: d.insurerId,
        guideType: d.guideType,
        guideIds: d.guideIds,
        idempotencyKey: `ui:${d.idempotencyKey}`,
      }),
    );
  });
}

/** Os 13 passos da exportação, com o XSD oficial no motor do app e o arquivo cifrado no bucket. */
export async function exportBatchAction(input: { batchId: string }): Promise<ActionResult<string>> {
  return run(async () => {
    const { batchId } = z.object({ batchId: uuid }).parse(input);
    const ctx = await gate('bill');
    await requireFreshPermission(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    const validateXsd = loadXmllintValidator();
    const guideIds = await withTenant(ctx.clinicId, async (tx) =>
      (
        (await tx.execute(sql`SELECT guide_id FROM public.hi_batch_guides
          WHERE clinic_id = ${ctx.clinicId}::uuid AND batch_id = ${batchId}::uuid AND active`)) as unknown as Array<{
          guide_id: string;
        }>
      ).map((r) => r.guide_id),
    );
    if (guideIds.length === 0)
      throw new acct.InsuranceAccountError('O lote não tem guias.', 'invalid');
    const reads = await readBatchGuidesAudited({
      clinicId: ctx.clinicId,
      guideIds,
      operation: 'batch_xml_export',
      batchRef: batchId,
      surface: 'convenios/lote/exportar',
    });
    const out = await batches.exportBatch(
      { store: supabaseTissObjectStore(), validateXsd },
      {
        clinicId: ctx.clinicId,
        batchId,
        contents: reads.map((r) => ({
          guideId: r.guideId,
          revision: r.revision,
          content: r.content,
        })),
        actorUserId: ctx.userId,
        requestContext: await requestContext(),
      },
    );
    return out.kind;
  });
}

const BatchRef = z.object({ batchId: uuid, version });

export async function markBatchSentAction(
  input: z.input<typeof BatchRef> & { sentOn: string; evidence: string },
): Promise<ActionResult<number>> {
  return run(async () => {
    const d = BatchRef.extend({
      sentOn: day,
      evidence: z
        .string()
        .trim()
        .min(10, 'Descreva como o lote foi enviado (portal, protocolo do portal, e-mail).')
        .max(500),
    }).parse(input);
    return write('health_insurance.batch.sent', { type: 'hi_batch', id: d.batchId }, (tx, ctx) =>
      batches.markBatchSentInTx(tx, {
        clinicId: ctx.clinicId,
        batchId: d.batchId,
        version: d.version,
        channel: 'manual',
        sentOn: d.sentOn,
        evidence: d.evidence,
      }),
    );
  });
}

/**
 * Protocolo da operadora: o número vem da operadora e o RECIBO é obrigatório — o SHA-256
 * dele fica registrado como evidência (nada de protocolo sem comprovação).
 */
export async function recordBatchProtocolAction(form: FormData): Promise<ActionResult<number>> {
  return run(async () => {
    const d = z
      .object({
        batchId: uuid,
        version: z.coerce.number().int().min(1),
        // TISS 4.03: o recurso de glosa referencia este protocolo como `st_numerico12`. Aceitar
        // outro formato aqui travaria o recurso do lote depois (achado no E2E de 13/11).
        protocol: z
          .string()
          .trim()
          .min(1, 'Informe o protocolo da operadora.')
          .regex(
            /^\d{1,12}$/u,
            'O protocolo TISS é numérico, com até 12 dígitos, como a operadora devolve no recibo do lote.',
          ),
        receivedOn: day,
      })
      .parse({
        batchId: form.get('batchId'),
        version: form.get('version'),
        protocol: form.get('protocol'),
        receivedOn: form.get('receivedOn'),
      });
    const receipt = form.get('receipt');
    if (!(receipt instanceof File) || receipt.size === 0)
      throw new acct.InsuranceAccountError(
        'Anexe o recibo do protocolo emitido pela operadora.',
        'invalid',
      );
    if (receipt.size > 10 * 1024 * 1024)
      throw new acct.InsuranceAccountError('O recibo passa de 10 MB.', 'invalid');
    const evidenceSha256 = createHash('sha256')
      .update(Buffer.from(await receipt.arrayBuffer()))
      .digest('hex');
    return write(
      'health_insurance.batch.protocol_recorded',
      { type: 'hi_batch', id: d.batchId },
      (tx, ctx) =>
        batches.recordBatchProtocolInTx(tx, {
          clinicId: ctx.clinicId,
          batchId: d.batchId,
          version: d.version,
          protocol: d.protocol,
          receivedOn: d.receivedOn,
          evidenceSha256,
        }),
    );
  });
}

export async function markBatchUnderReviewAction(
  input: z.input<typeof BatchRef>,
): Promise<ActionResult<number>> {
  return run(async () => {
    const d = BatchRef.parse(input);
    return write(
      'health_insurance.batch.under_review',
      { type: 'hi_batch', id: d.batchId },
      (tx, ctx) =>
        batches.markBatchUnderReviewInTx(tx, {
          clinicId: ctx.clinicId,
          batchId: d.batchId,
          version: d.version,
        }),
    );
  });
}

export async function cancelBatchAction(
  input: z.input<typeof BatchRef> & { reason: string },
): Promise<ActionResult<number>> {
  return run(async () => {
    const d = BatchRef.extend({ reason }).parse(input);
    return write(
      'health_insurance.batch.cancelled',
      { type: 'hi_batch', id: d.batchId },
      (tx, ctx) =>
        batches.cancelBatchInTx(tx, {
          clinicId: ctx.clinicId,
          batchId: d.batchId,
          version: d.version,
          reason: d.reason,
        }),
    );
  });
}

// ── Conta da guia: glosa, recurso, pagamento, conciliação ─────────────────

const Gloss = z.object({
  batchId: uuid,
  guideId: uuid,
  itemId: uuid.nullable().optional(),
  code: z
    .string()
    .trim()
    .regex(/^\d{4}$/u, 'Código de glosa da tabela 38 (4 dígitos).'),
  amountCents: cents,
  idempotencyKey: key,
});

/** Glosa informada pela operadora fora do demonstrativo (registro manual de quem conferiu). */
export async function recordGlossAction(
  input: z.input<typeof Gloss>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = Gloss.parse(input);
    return write('health_insurance.gloss.recorded', { type: 'hi_gloss', id: null }, (tx, ctx) =>
      acct.recordGlossInTx(tx, {
        clinicId: ctx.clinicId,
        batchId: d.batchId,
        guideId: d.guideId,
        itemId: d.itemId ?? null,
        code: d.code,
        amountCents: d.amountCents,
        source: 'manual',
        idempotencyKey: `ui:${d.idempotencyKey}`,
      }),
    );
  });
}

const GlossDecision = z.object({
  glossId: uuid,
  version,
  to: z.enum(['under_analysis', 'contested', 'definitive']),
  reason: z.string().trim().max(500).optional(),
});

/** Analisar, contestar ou aceitar como definitiva (com motivo; a decisão não volta). */
export async function decideGlossAction(
  input: z.input<typeof GlossDecision>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GlossDecision.parse(input);
    if (d.to === 'definitive') reason.parse(d.reason ?? '');
    await write(`health_insurance.gloss.${d.to}`, { type: 'hi_gloss', id: d.glossId }, (tx, ctx) =>
      acct.transitionGlossInTx(tx, {
        clinicId: ctx.clinicId,
        glossId: d.glossId,
        version: d.version,
        to: d.to,
        ...(d.reason ? { reason: d.reason } : {}),
      }),
    );
    return null;
  });
}

const Appeal = z.object({
  guideId: uuid,
  glossIds: z.array(uuid).min(1),
  justification: z
    .string()
    .trim()
    .min(20, 'A justificativa do recurso precisa explicar o motivo (mínimo de 20 caracteres).')
    .max(2000, 'A justificativa aceita até 2.000 caracteres.'),
  idempotencyKey: key,
});

/** Recurso: a justificativa é sempre de uma pessoa (nunca gerada). */
export async function createAppealAction(
  input: z.input<typeof Appeal>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = Appeal.parse(input);
    return write(
      'health_insurance.appeal.created',
      { type: 'hi_gloss_appeal', id: null },
      (tx, ctx) =>
        acct.createAppealInTx(tx, {
          clinicId: ctx.clinicId,
          guideId: d.guideId,
          items: d.glossIds.map((glossId) => ({ glossId })),
          justification: d.justification,
          idempotencyKey: `ui:${d.idempotencyKey}`,
        }),
    );
  });
}

const FileAppeal = z.object({
  appealId: uuid,
  version,
  filedOn: day,
  protocol: z.string().trim().max(60).optional(),
  evidence: z.string().trim().max(500).optional(),
});

export async function fileAppealAction(
  input: z.input<typeof FileAppeal>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = FileAppeal.parse(input);
    await write(
      'health_insurance.appeal.filed',
      { type: 'hi_gloss_appeal', id: d.appealId },
      async (tx, ctx) => {
        // O XML oficial gerado para este recurso (se houver) fica anexado à apresentação.
        const [file] =
          (await tx.execute(sql`SELECT id FROM public.hi_files WHERE clinic_id = ${ctx.clinicId}::uuid
          AND appeal_id = ${d.appealId}::uuid AND kind = 'gloss_appeal_xml' ORDER BY created_at DESC LIMIT 1`)) as unknown as Array<{
            id: string;
          }>;
        return acct.fileAppealInTx(tx, {
          clinicId: ctx.clinicId,
          appealId: d.appealId,
          version: d.version,
          channel: 'manual',
          filedOn: d.filedOn,
          ...(d.protocol ? { protocol: d.protocol } : {}),
          ...(d.evidence ? { evidence: d.evidence } : {}),
          ...(file ? { fileId: file.id } : {}),
        });
      },
    );
    return null;
  });
}

/** XML oficial do recurso (P9.7), do registro do recurso em preparo; validado no XSD e guardado cifrado. */
export async function exportAppealXmlAction(input: {
  appealId: string;
}): Promise<ActionResult<string>> {
  return run(async () => {
    const { appealId } = z.object({ appealId: uuid }).parse(input);
    const ctx = await gate('bill');
    const out = await exportAppealXml(
      { store: supabaseTissObjectStore(), validateXsd: loadXmllintValidator() },
      {
        clinicId: ctx.clinicId,
        appealId,
        actorUserId: ctx.userId,
        requestContext: await requestContext(),
      },
    );
    return out.fileId;
  });
}

const AnswerAppeal = z.object({
  appealId: uuid,
  version,
  answeredOn: day,
  items: z.array(z.object({ glossId: uuid, acceptedCents: z.number().int().min(0) })).min(1),
  note: z.string().trim().max(500).optional(),
});

export async function answerAppealAction(
  input: z.input<typeof AnswerAppeal>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = AnswerAppeal.parse(input);
    await write(
      'health_insurance.appeal.answered',
      { type: 'hi_gloss_appeal', id: d.appealId },
      (tx, ctx) =>
        acct.answerAppealInTx(tx, {
          clinicId: ctx.clinicId,
          appealId: d.appealId,
          version: d.version,
          answeredOn: d.answeredOn,
          items: d.items,
          ...(d.note ? { note: d.note } : {}),
        }),
    );
    return null;
  });
}

const Payment = z.object({
  insurerId: uuid,
  batchId: uuid.nullable().optional(),
  paidOn: day,
  amountCents: cents,
  statementRef: z.string().trim().max(60).optional(),
  note: z.string().trim().max(500).optional(),
  allocations: z.array(z.object({ guideId: uuid, batchId: uuid, amountCents: cents })).optional(),
  idempotencyKey: key,
});

/**
 * Pagamento da operadora. Sem alocação explícita e com lote, o banco rateia SÓ se o valor
 * for exatamente o saldo do lote; senão fica "não conciliado" para alguém alocar.
 */
export async function recordPaymentAction(
  input: z.input<typeof Payment>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = Payment.parse(input);
    return write('health_insurance.payment.recorded', { type: 'hi_payment', id: null }, (tx, ctx) =>
      acct.recordPaymentInTx(tx, {
        clinicId: ctx.clinicId,
        insurerId: d.insurerId,
        paidOn: d.paidOn,
        amountCents: d.amountCents,
        source: 'manual',
        idempotencyKey: `ui:${d.idempotencyKey}`,
        ...(d.batchId ? { batchId: d.batchId } : {}),
        ...(d.statementRef ? { statementRef: d.statementRef } : {}),
        ...(d.note ? { note: d.note } : {}),
        ...(d.allocations?.length ? { allocations: d.allocations } : {}),
      }),
    );
  });
}

const Allocate = z.object({
  paymentId: uuid,
  allocations: z.array(z.object({ guideId: uuid, batchId: uuid, amountCents: cents })).min(1),
  idempotencyKey: key,
});

export async function allocatePaymentAction(
  input: z.input<typeof Allocate>,
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = Allocate.parse(input);
    await write(
      'health_insurance.payment.allocated',
      { type: 'hi_payment', id: d.paymentId },
      (tx, ctx) =>
        acct.allocatePaymentInTx(tx, {
          clinicId: ctx.clinicId,
          paymentId: d.paymentId,
          allocationKey: `ui:${d.idempotencyKey}`,
          allocations: d.allocations,
        }),
    );
    return null;
  });
}

export async function reverseAllocationAction(input: {
  allocationId: string;
  reason: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z.object({ allocationId: uuid, reason }).parse(input);
    await write(
      'health_insurance.payment.reversed',
      { type: 'hi_payment_allocation', id: d.allocationId },
      (tx, ctx) =>
        acct.reversePaymentAllocationInTx(tx, {
          clinicId: ctx.clinicId,
          allocationId: d.allocationId,
          reason: d.reason,
        }),
    );
    return null;
  });
}

/** Encerrar (conciliar) a guia: só uma pessoa, com pendente zero e nada em aberto. */
export async function reconcileGuideAction(input: {
  guideId: string;
  version: number;
  note?: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z
      .object({ guideId: uuid, version, note: z.string().trim().max(500).optional() })
      .parse(input);
    await write(
      'health_insurance.guide.reconciled',
      { type: 'hi_guide', id: d.guideId },
      (tx, ctx) =>
        acct.reconcileGuideInTx(tx, {
          clinicId: ctx.clinicId,
          guideId: d.guideId,
          version: d.version,
          ...(d.note ? { note: d.note } : {}),
        }),
    );
    return null;
  });
}

/**
 * Importação de demonstrativo da operadora (P9.5): análise de conta ou pagamento, em XML TISS.
 * O arquivo é conferido (estrutura, hash, XSD, operadora, clínica, lote, protocolo, guia)
 * antes de qualquer efeito; o que não confere volta como divergência, sem ser aplicado.
 */
export async function importStatementAction(
  form: FormData,
): Promise<ActionResult<StatementImportResult>> {
  return run(async () => {
    const ctx = await gate('bill');
    const d = z
      .object({ insurerId: uuid, receivedOn: day })
      .parse({ insurerId: form.get('insurerId'), receivedOn: form.get('receivedOn') });
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0)
      throw new StatementImportError('Escolha o arquivo XML do demonstrativo.', 'FILE_MISSING');
    if (file.size > 16 * 1024 * 1024)
      throw new StatementImportError('O arquivo passa de 16 MB.', 'SIZE');
    return importOperatorStatement(
      { store: supabaseTissObjectStore(), validateXsd: loadXmllintValidator() },
      {
        clinicId: ctx.clinicId,
        insurerId: d.insurerId,
        bytes: new Uint8Array(await file.arrayBuffer()),
        actorUserId: ctx.userId,
        requestContext: await requestContext(),
        receivedOn: d.receivedOn,
      },
    );
  });
}

// ── Solicitações SP/SADT (P6.2) ───────────────────────────────────────────

const SadtCreate = z.object({
  membershipId: uuid,
  patientId: uuid,
  requester: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('internal'), professionalId: uuid }),
    z.object({
      kind: z.literal('external'),
      name: z.string().trim().min(3, 'Nome do solicitante (3 a 70 caracteres).').max(70),
      council: z.string().regex(/^\d{2}$/u, 'Conselho (tabela 26).'),
      councilNumber: z.string().trim().min(1, 'Número no conselho.').max(15),
      councilUf: z.string().regex(/^\d{2}$/u, 'UF do conselho (código IBGE).'),
      cbo: z
        .string()
        .regex(/^\d{6}$/u)
        .nullable(),
    }),
  ]),
  requestedOn: day,
  careCharacter: z.enum(['1', '2']),
  careType: z
    .string()
    .regex(/^\d{2}$/u, 'Tipo de atendimento (tabela 50).')
    .nullable(),
  items: z
    .array(
      z.object({
        tableCode: z.string().regex(/^\d{2}$/u),
        procedureCode: z.string().trim().min(1).max(10),
        quantity: z.number().int().min(1).max(999),
      }),
    )
    .min(1, 'Inclua pelo menos um procedimento.')
    .max(99),
  note: z.string().trim().max(500).nullable(),
});

export async function createSadtRequestAction(
  input: z.input<typeof SadtCreate>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = SadtCreate.parse(input);
    return write(
      'health_insurance.sadt_request.created',
      { type: 'hi_sadt_request', id: null },
      async (tx, ctx) =>
        (
          await sadt.createSadtRequestInTx(tx, {
            ...d,
            clinicId: ctx.clinicId,
            actorUserId: ctx.userId,
          })
        ).requestId,
    );
  });
}

const SadtRef = z.object({ requestId: uuid, version });

export async function checkSadtRequestAction(
  input: z.input<typeof SadtRef> & { careType?: string | null; consultationType?: string | null },
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = SadtRef.extend({
      careType: z
        .string()
        .regex(/^\d{2}$/u)
        .nullable()
        .optional(),
      consultationType: z
        .string()
        .regex(/^[1-4]$/u)
        .nullable()
        .optional(),
    }).parse(input);
    const outcome = await write(
      'health_insurance.sadt_request.checked',
      { type: 'hi_sadt_request', id: d.requestId },
      async (tx, ctx) => {
        const out = await sadt.checkSadtRequestInTx(tx, {
          clinicId: ctx.clinicId,
          requestId: d.requestId,
          version: d.version,
          careType: d.careType ?? null,
          consultationType: d.consultationType ?? null,
          actorUserId: ctx.userId,
        });
        if (out.kind === 'pending') {
          // Pendências gravadas; a mensagem leva a primeira, sem dado pessoal.
          return `pendente: ${out.issues[0]?.message ?? 'conferir dados'}`;
        }
        return out.kind;
      },
    );
    if (outcome !== 'awaiting_authorization') return outcome;
    // Pedido à operadora: o documento oficial (XML + PDF) é congelado logo depois da conferência.
    // Falha aqui não desfaz a conferência: a página mostra "gerar documento" para tentar de novo.
    try {
      await generateSadtRequestDocument(d.requestId, false);
      return 'awaiting_authorization';
    } catch {
      return 'awaiting_authorization:documento_pendente';
    }
  });
}

/** Versão do build no rodapé dos documentos (rastreabilidade do software, req. 36). */
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? null;

/**
 * Documento oficial do pedido de autorização SP/SADT (P6.2): carteirinha pela via auditada
 * (finalidade "autorização"), XML validado no XSD + PDF do modelo oficial, congelados e
 * cifrados. Idempotente: gerar de novo devolve o que já existe.
 */
async function generateSadtRequestDocument(
  requestId: string,
  newborn: boolean,
): Promise<SadtRequestDocumentOutcome> {
  const ctx = await gate('operate');
  const membershipId = await withTenant(
    ctx.clinicId,
    async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT membership_id FROM public.hi_sadt_requests
         WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${requestId}::uuid`)) as unknown as Array<{
        membership_id: string;
      }>;
      return rows[0]?.membership_id ?? null;
    },
    ctx.userId,
  );
  if (!membershipId)
    throw new sadt.SadtRequestError('solicitação inexistente nesta clínica', 'not_found');
  const card = await readMembershipCardNumberAudited(
    ctx.clinicId,
    membershipId,
    'autorizacao',
    'solicitacao_sadt_documento',
  );
  if (!card)
    throw new sadt.SadtRequestError(
      'a carteirinha da solicitação não está nesta clínica',
      'not_found',
    );
  // Import sob demanda: o renderizador de PDF não entra no grafo de toda página que usa as ações.
  const { exportSadtRequestDocument } = await import('./internal/sadt-request-document');
  return exportSadtRequestDocument(
    {
      store: supabaseTissObjectStore(),
      validateXsd: loadXmllintValidator(),
      software: { name: 'Qoro', version: BUILD },
    },
    {
      clinicId: ctx.clinicId,
      requestId,
      card,
      newborn,
      actorUserId: ctx.userId,
      requestContext: await requestContext(),
    },
  );
}

export async function exportSadtRequestDocumentAction(input: {
  requestId: string;
  newborn?: boolean;
}): Promise<ActionResult<string>> {
  return run(async () => {
    const d = z.object({ requestId: uuid, newborn: z.boolean().default(false) }).parse(input);
    const out = await generateSadtRequestDocument(d.requestId, d.newborn);
    return out.pdfFileId;
  });
}

const ConsultaAuthorizationResponse = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('denied'),
    authorizationId: uuid,
    version,
    denialReason: z.string().trim().min(3, 'Informe o motivo da negativa da operadora.').max(500),
  }),
  z.object({
    decision: z.literal('authorized'),
    authorizationId: uuid,
    version,
    authorizedOn: day,
    operatorGuideNumber: z.string().trim().max(20).nullable(),
    operatorProtocol: z.string().trim().max(40).nullable(),
    password: z.string().trim().max(64).nullable(),
    passwordValidUntil: day.nullable(),
    items: z.array(z.object({ itemId: uuid, quantityAuthorized: z.number().int().min(0).max(999) })).min(1),
  }),
]);

// ── Comprovante da autorização em partes (P6.3; até 10 MB sem mexer no limite global) ──

const ReceiptUploadStart = z.object({
  authorizationId: uuid,
  size: z.number().int().min(1).max(10 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  declaredType: z.string().min(3).max(100),
});

/** Início: valida e devolve o token selado do envio (nada é gravado ainda). Recepção (matriz 4.2). */
export async function beginAuthorizationReceiptUploadAction(
  input: z.input<typeof ReceiptUploadStart>,
): Promise<ActionResult<{ token: string; chunkBytes: number; chunks: number }>> {
  return run(async () => {
    const d = ReceiptUploadStart.parse(input);
    const ctx = await gate('operate');
    // A autorização precisa existir NESTA clínica (RLS + clínica da sessão) antes de aceitar partes.
    const found = await withTenant(
      ctx.clinicId,
      async (tx) =>
        ((await tx.execute(sql`SELECT 1 FROM public.hi_authorizations
            WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.authorizationId}::uuid`)) as unknown as unknown[]).length > 0,
      ctx.userId,
    );
    if (!found) throw new AuthorizationError('Autorização inexistente nesta clínica.', 'not_found');
    const out = await receiptUpload.beginReceiptUpload({ clinicId: ctx.clinicId, userId: ctx.userId, ...d });
    return { token: out.token, chunkBytes: out.chunkBytes, chunks: out.chunks };
  });
}

/** Uma parte (FormData: token, index, chunk). Gravada cifrada no armazenamento privado. */
export async function uploadAuthorizationReceiptChunkAction(form: FormData): Promise<ActionResult<null>> {
  return run(async () => {
    const ctx = await gate('operate');
    const token = z.string().min(20).max(4000).parse(form.get('token'));
    const index = z.coerce.number().int().min(0).max(10).parse(form.get('index'));
    const chunk = form.get('chunk');
    if (!(chunk instanceof Blob)) throw new receiptUpload.ReceiptUploadError('Parte sem conteúdo.', 'invalid');
    const claims = await receiptUpload.openReceiptUpload(token, ctx);
    await receiptUpload.putReceiptChunk(supabaseTissObjectStore(), claims, index, new Uint8Array(await chunk.arrayBuffer()));
    return null;
  });
}

/**
 * Fim: junta, confere tamanho e SHA-256 e entrega ao domínio (tipo pelo conteúdo, cifra, registro),
 * com auditoria na mesma transação. Idempotente: o mesmo arquivo já anexado devolve o anexo.
 */
export async function finishAuthorizationReceiptUploadAction(input: { token: string }): Promise<ActionResult<string>> {
  return run(async () => {
    const { token } = z.object({ token: z.string().min(20).max(4000) }).parse(input);
    const session = await gate('operate');
    const claims = await receiptUpload.openReceiptUpload(token, session);
    const store = supabaseTissObjectStore();
    const existing = await withTenant(
      session.clinicId,
      async (tx) =>
        (await tx.execute(sql`SELECT id::text AS id FROM public.hi_authorization_attachments
            WHERE clinic_id = ${session.clinicId}::uuid AND authorization_id = ${claims.authorizationId}::uuid
              AND content_sha256 = ${claims.sha256} LIMIT 1`)) as unknown as Array<{ id: string }>,
      session.userId,
    );
    if (existing[0]) {
      await receiptUpload.discardReceiptUpload(store, claims);
      return existing[0].id;
    }
    const bytes = await receiptUpload.assembleReceiptUpload(store, claims);
    const out = await attachAuthorizationReceipt(
      store,
      (fn) =>
        write('health_insurance.authorization.receipt_attached', { type: 'hi_authorization', id: claims.authorizationId }, (tx) => fn(tx)),
      { clinicId: session.clinicId, authorizationId: claims.authorizationId, bytes, declaredType: claims.type, actorUserId: session.userId },
    );
    await receiptUpload.discardReceiptUpload(store, claims);
    return out.attachmentId;
  });
}

/** Desistência: descarta as partes já enviadas (a manutenção diária limpa o que sobrar). */
export async function abortAuthorizationReceiptUploadAction(input: { token: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { token } = z.object({ token: z.string().min(20).max(4000) }).parse(input);
    const ctx = await gate('operate');
    const claims = await receiptUpload.openReceiptUpload(token, { ...ctx, now: 0 });
    await receiptUpload.discardReceiptUpload(supabaseTissObjectStore(), claims);
    return null;
  });
}

/**
 * P6.3: resposta da operadora a um pedido de autorização da Guia de Consulta (serviço da P6.1). A
 * clínica e o autor vêm da sessão; o serviço confere estado, versão, evidência, datas e quantidades.
 * A auditoria guarda só o resultado (nunca a senha).
 */
export async function recordConsultaAuthorizationResponseAction(
  input: z.input<typeof ConsultaAuthorizationResponse>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = ConsultaAuthorizationResponse.parse(input);
    const filled = (v: string | null) => (v && v.length > 0 ? v : undefined);
    return write(
      'health_insurance.authorization.response_recorded',
      { type: 'hi_authorization', id: d.authorizationId },
      async (tx, ctx) =>
        (
          await recordManualAuthorizationResponseTx(
            tx,
            d.decision === 'denied'
              ? {
                  decision: 'denied',
                  clinicId: ctx.clinicId,
                  authorizationId: d.authorizationId,
                  version: d.version,
                  denialReason: d.denialReason,
                  actorUserId: ctx.userId,
                }
              : {
                  decision: 'authorized',
                  clinicId: ctx.clinicId,
                  authorizationId: d.authorizationId,
                  version: d.version,
                  authorizedOn: d.authorizedOn,
                  operatorGuideNumber: filled(d.operatorGuideNumber),
                  operatorProtocol: filled(d.operatorProtocol),
                  password: filled(d.password),
                  passwordValidUntil: d.passwordValidUntil ?? undefined,
                  items: d.items,
                  actorUserId: ctx.userId,
                },
          )
        ).status,
    );
  });
}

/**
 * P6.6: marca um aviso de autorização como visto. Quem viu é a pessoa da SESSÃO (gravada pelo
 * banco); aviso de outra clínica, inexistente ou já visto recebe a mesma resposta.
 */
export async function markAuthorizationAlertReadAction(input: { alertId: string }): Promise<ActionResult<string>> {
  return run(async () => {
    const d = z.object({ alertId: z.uuid() }).parse(input);
    return write('health_insurance.authorization.alert_read', { type: 'hi_authorization_alert', id: d.alertId }, async (tx, ctx) => {
      const out = await alertService.markAuthorizationAlertReadTx(tx, ctx.clinicId, d.alertId);
      return out.kind;
    });
  });
}

const SadtAuthorize = SadtRef.extend({
  authorizedOn: day,
  operatorGuideNumber: z.string().trim().max(20).nullable(),
  operatorProtocol: z.string().trim().max(40).nullable(),
  password: z.string().trim().max(20).nullable(),
  passwordValidUntil: day.nullable(),
  items: z
    .array(z.object({ requestItemId: uuid, quantityAuthorized: z.number().int().min(0).max(999) }))
    .min(1),
});

export async function recordSadtAuthorizationAction(
  input: z.input<typeof SadtAuthorize>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = SadtAuthorize.parse(input);
    const blank = (v: string | null) => (v && v.length > 0 ? v : null);
    return write(
      'health_insurance.sadt_request.authorization_recorded',
      { type: 'hi_sadt_request', id: d.requestId },
      async (tx, ctx) =>
        (
          await sadt.recordSadtAuthorizationInTx(tx, {
            decision: 'authorized',
            clinicId: ctx.clinicId,
            requestId: d.requestId,
            version: d.version,
            authorizedOn: d.authorizedOn,
            operatorGuideNumber: blank(d.operatorGuideNumber),
            operatorProtocol: blank(d.operatorProtocol),
            password: blank(d.password),
            passwordValidUntil: d.passwordValidUntil,
            items: d.items,
            actorUserId: ctx.userId,
          })
        ).status,
    );
  });
}

export async function denySadtRequestAction(
  input: z.input<typeof SadtRef> & { denialReason: string },
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = SadtRef.extend({
      denialReason: z.string().trim().min(3, 'Motivo da negativa da operadora.').max(500),
    }).parse(input);
    return write(
      'health_insurance.sadt_request.denied',
      { type: 'hi_sadt_request', id: d.requestId },
      async (tx, ctx) =>
        (
          await sadt.recordSadtAuthorizationInTx(tx, {
            decision: 'denied',
            clinicId: ctx.clinicId,
            requestId: d.requestId,
            version: d.version,
            denialReason: d.denialReason,
            actorUserId: ctx.userId,
          })
        ).status,
    );
  });
}

export async function cancelSadtRequestAction(
  input: z.input<typeof SadtRef> & { reason: string },
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = SadtRef.extend({ reason }).parse(input);
    await write(
      'health_insurance.sadt_request.cancelled',
      { type: 'hi_sadt_request', id: d.requestId },
      async (tx, ctx) =>
        sadt.cancelSadtRequestInTx(tx, {
          clinicId: ctx.clinicId,
          requestId: d.requestId,
          version: d.version,
          reason: d.reason,
          actorUserId: ctx.userId,
        }),
    );
    return null;
  });
}

export async function completeSadtRequestAction(
  input: z.input<typeof SadtRef> & { note: string },
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = SadtRef.extend({ note: reason }).parse(input);
    await write(
      'health_insurance.sadt_request.completed',
      { type: 'hi_sadt_request', id: d.requestId },
      async (tx, ctx) =>
        sadt.completeSadtRequestInTx(tx, {
          clinicId: ctx.clinicId,
          requestId: d.requestId,
          version: d.version,
          note: d.note,
          actorUserId: ctx.userId,
        }),
    );
    return null;
  });
}

export async function cancelSadtRequestItemAction(input: {
  requestId: string;
  itemId: string;
  reason: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z.object({ requestId: uuid, itemId: uuid, reason }).parse(input);
    await write(
      'health_insurance.sadt_request.item_cancelled',
      { type: 'hi_sadt_request', id: d.requestId },
      async (tx, ctx) =>
        sadt.cancelSadtRequestItemInTx(tx, {
          clinicId: ctx.clinicId,
          requestId: d.requestId,
          itemId: d.itemId,
          reason: d.reason,
          actorUserId: ctx.userId,
        }),
    );
    return null;
  });
}

/**
 * Indicação clínica: do PROFISSIONAL solicitante (permissão clínica; o serviço confere que
 * é ele). Solicitante externo: a recepção transcreve o pedido dele (permissão de gestão).
 * A auditoria registra que foi informada, nunca o texto.
 */
export async function setSadtClinicalIndicationAction(
  input: z.input<typeof SadtRef> & { text: string },
): Promise<ActionResult<null>> {
  return run(async () => {
    const d = SadtRef.extend({
      text: z.string().trim().min(3, 'Indicação clínica de 3 a 500 caracteres.').max(500),
    }).parse(input);
    const user = await requireUser();
    // Sem entrar em Convênios, nem a existência da solicitação é consultada.
    await requireCachedPermission(PERMISSIONS.VIEW_CONVENIOS);
    const clinicId = await requireClinicId();
    const req = await withTenant(clinicId, async (tx) => {
      const rows = (await tx.execute(
        sql`SELECT requester_kind, requester_professional_id::text AS requester FROM public.hi_sadt_requests WHERE clinic_id = ${clinicId}::uuid AND id = ${d.requestId}::uuid`,
      )) as unknown as Array<{ requester_kind: string; requester: string | null }>;
      return rows[0] ?? null;
    });
    // Posse (matriz 4.2, "C + P para a médica"): sem operar Convênios, só a própria solicitação.
    const broad = allows(user.permissions, 'operate');
    if (!req || (!broad && !user.isSuperAdmin && req.requester !== user.userId))
      throw new sadt.SadtRequestError('Solicitação inexistente nesta clínica.', 'not_found');
    const kind = req.requester_kind;
    await requireCachedPermission(
      kind === 'internal' ? PERMISSIONS.CREATE_PRONTUARIO : PERMISSIONS.OPERATE_CONVENIOS,
    );
    const rc = await requestContext();
    await withTenant(
      clinicId,
      async (tx) => {
        await sadt.setClinicalIndicationInTx(tx, {
          clinicId,
          requestId: d.requestId,
          version: d.version,
          text: d.text,
          actorUserId: user.userId,
        });
        await logAudit(tx, {
          clinicId,
          userId: user.userId,
          action: 'health_insurance.sadt_request.indication_set',
          resourceType: 'hi_sadt_request',
          resourceId: d.requestId,
          before: null,
          after: { result: 'informada' },
          requestContext: rc,
        });
      },
      user.userId,
    );
    return null;
  });
}

/** Liga um atendimento de convênio ao procedimento da solicitação (a sessão que o executa). */
export async function linkAppointmentToSadtItemAction(input: {
  requestId: string;
  itemId: string;
  appointmentId: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z.object({ requestId: uuid, itemId: uuid, appointmentId: uuid }).parse(input);
    await write(
      'health_insurance.sadt_request.session_linked',
      { type: 'hi_sadt_request', id: d.requestId },
      async (tx, ctx) => {
        const rows = (await tx.execute(sql`
        SELECT ap.patient_id, ap.procedure_id, ap.scheduled_at, c.timezone, r.insurer_id, r.plan_id, r.membership_id
          FROM public.appointments ap
          JOIN public.clinics c ON c.id = ap.clinic_id
          JOIN public.hi_sadt_request_items ri ON ri.clinic_id = ap.clinic_id AND ri.id = ${d.itemId}::uuid
          JOIN public.hi_sadt_requests r ON r.clinic_id = ri.clinic_id AND r.id = ri.request_id AND r.id = ${d.requestId}::uuid
         WHERE ap.clinic_id = ${ctx.clinicId}::uuid AND ap.id = ${d.appointmentId}::uuid`)) as unknown as Array<
          Record<string, unknown>
        >;
        const r = rows[0];
        if (!r || !r.patient_id || !r.procedure_id) {
          throw new sadt.SadtRequestError(
            'Atendimento ou solicitação inexistente nesta clínica.',
            'not_found',
          );
        }
        const date = new Intl.DateTimeFormat('en-CA', {
          timeZone: String(r.timezone ?? 'America/Sao_Paulo'),
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date(String(r.scheduled_at)));
        await recordAppointmentCoverage(tx, {
          clinicId: ctx.clinicId,
          appointmentId: d.appointmentId,
          patientId: String(r.patient_id),
          procedureId: String(r.procedure_id),
          appointmentDate: date,
          guideType: 'sp_sadt',
          insurerId: String(r.insurer_id),
          planId: r.plan_id ? String(r.plan_id) : null,
          membershipId: String(r.membership_id),
          authorizationId: null,
          sadtRequestItemId: d.itemId,
          actor: { kind: 'user', userId: ctx.userId },
        });
      },
    );
    return null;
  });
}

// ── Repasse profissional de convênio (P10.4) ─────────────────────────────

const PayoutRef = z.object({ payoutId: uuid, idempotencyKey: key });

export async function authorizeInsurancePayoutAction(input: {
  payoutId: string;
  amountCents: number;
  idempotencyKey: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = PayoutRef.extend({ amountCents: cents }).parse(input);
    await write(
      'health_insurance.payout.authorized',
      { type: 'hi_payout', id: d.payoutId },
      (tx, ctx) =>
        payouts.authorizeInsurancePayoutTx(tx, {
          clinicId: ctx.clinicId,
          payoutId: d.payoutId,
          amountCents: d.amountCents,
          idempotencyKey: `ui:${d.idempotencyKey}`,
          actorUserId: ctx.userId,
        }),
    );
    return null;
  });
}

export async function settleInsurancePayoutAction(input: {
  payoutId: string;
  amountCents: number;
  paidOn: string;
  reference: string | null;
  idempotencyKey: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = PayoutRef.extend({
      amountCents: cents,
      paidOn: day,
      reference: z.string().trim().max(100).nullable(),
    }).parse(input);
    await write(
      'health_insurance.payout.settled',
      { type: 'hi_payout', id: d.payoutId },
      (tx, ctx) =>
        payouts.settleInsurancePayoutTx(tx, {
          clinicId: ctx.clinicId,
          payoutId: d.payoutId,
          amountCents: d.amountCents,
          paidOn: d.paidOn,
          reference: d.reference || null,
          idempotencyKey: `ui:${d.idempotencyKey}`,
          actorUserId: ctx.userId,
        }),
    );
    return null;
  });
}

export async function adjustInsurancePayoutAction(input: {
  payoutId: string;
  amountCents: number;
  reason: string;
  idempotencyKey: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = PayoutRef.extend({
      amountCents: z
        .number()
        .int()
        .min(-9_999_999_999)
        .max(9_999_999_999)
        .refine((v) => v !== 0, 'Informe um valor diferente de zero.'),
      reason,
    }).parse(input);
    await write(
      'health_insurance.payout.adjusted',
      { type: 'hi_payout', id: d.payoutId },
      (tx, ctx) =>
        payouts.adjustInsurancePayoutTx(tx, {
          clinicId: ctx.clinicId,
          payoutId: d.payoutId,
          amountCents: d.amountCents,
          reason: d.reason,
          idempotencyKey: `ui:${d.idempotencyKey}`,
          actorUserId: ctx.userId,
        }),
    );
    return null;
  });
}

// ── Substituição de guia já enviada (P7.5; 0165): pedido, recibo da operadora e substituta ──

const CancellationRequest = z.object({
  guideId: uuid,
  purpose: z.enum(['substitution', 'cancellation']),
  channel: z.enum(['portal', 'webservice', 'email', 'phone', 'other']),
  requestedOn: day,
  reason,
  operatorGuideNumber: z.string().trim().min(1).max(20).nullable().optional(),
  idempotencyKey: key,
  generateXml: z.boolean().default(true),
});

/**
 * Pedido de cancelamento da guia à operadora (preservação: fato sobre guia já enviada). Por padrão
 * gera o `cancelaGuia` validado no XSD oficial; o Qoro NÃO transmite (a clínica envia pelo canal).
 */
export async function requestGuideCancellationAction(
  input: z.input<typeof CancellationRequest>,
): Promise<ActionResult<{ cancellationId: string; xmlSha256: string | null }>> {
  return run(async () => {
    const d = CancellationRequest.parse(input);
    let out: { cancellationId: string; xmlSha256: string | null } = { cancellationId: '', xmlSha256: null };
    await write('health_insurance.guide.substitution_cancellation_requested', { type: 'hi_guide', id: d.guideId }, async (tx, ctx) => {
      const r = await cancellation.requestGuideCancellationTx(tx, { validateXsd: d.generateXml ? loadXmllintValidator() : null }, {
        clinicId: ctx.clinicId,
        guideId: d.guideId,
        purpose: d.purpose,
        channel: d.channel,
        requestedOn: d.requestedOn,
        reason: d.reason,
        operatorGuideNumber: d.operatorGuideNumber ?? null,
        idempotencyKey: d.idempotencyKey,
        generateXml: d.generateXml,
      });
      out = { cancellationId: r.cancellationId, xmlSha256: r.xmlSha256 };
      return r.cancellationId;
    });
    return out;
  });
}

const CancellationReceipt = z.object({
  cancellationId: uuid,
  statusCode: z.enum(['1', '2', '3', '4', '5', '6']),
  receivedOn: day,
  operatorProtocol: z.string().trim().min(1).max(12).nullable().optional(),
  operatorMessage: z.string().trim().max(500).nullable().optional(),
  evidenceSha256: z.string().regex(/^[0-9a-f]{64}$/u, 'SHA-256 inválido (64 caracteres hexadecimais).').nullable().optional(),
  idempotencyKey: key,
});

/** Recibo da operadora (Tabela 46): fato registrado por uma pessoa, com evidência. */
export async function recordGuideCancellationReceiptAction(
  input: z.input<typeof CancellationReceipt>,
): Promise<ActionResult<string>> {
  return run(async () => {
    const d = CancellationReceipt.parse(input);
    let status = '';
    await write('health_insurance.guide.substitution_receipt_recorded', { type: 'hi_guide_cancellation', id: d.cancellationId }, async (tx, ctx) => {
      const r = await cancellation.recordGuideCancellationReceiptTx(tx, {
        clinicId: ctx.clinicId,
        cancellationId: d.cancellationId,
        statusCode: d.statusCode,
        receivedOn: d.receivedOn,
        operatorProtocol: d.operatorProtocol ?? null,
        operatorMessage: d.operatorMessage ?? null,
        evidenceSha256: d.evidenceSha256 ?? null,
        idempotencyKey: d.idempotencyKey,
      });
      status = r.status;
      return `codigo=${d.statusCode};situacao=${r.status}`;
    });
    return status;
  });
}

/** Rascunho da substituta (classe A: o banco recusa com o módulo desligado ou a assinatura parada). */
export async function createSubstituteGuideAction(input: {
  originalGuideId: string;
  idempotencyKey: string;
}): Promise<ActionResult<string>> {
  return run(async () => {
    const d = z.object({ originalGuideId: uuid, idempotencyKey: key }).parse(input);
    return write('health_insurance.guide.substitution_created', { type: 'hi_guide', id: d.originalGuideId }, async (tx, ctx) => {
      await assertConveniosOperableTx(tx, ctx.clinicId);
      const r = await cancellation.createSubstituteGuideTx(tx, {
        clinicId: ctx.clinicId,
        originalGuideId: d.originalGuideId,
        idempotencyKey: d.idempotencyKey,
        actorUserId: ctx.userId,
      });
      return r.guideId;
    });
  });
}

/** XML do pedido de cancelamento, para baixar e enviar pelo canal da operadora (sem dado de paciente). */
export async function readGuideCancellationXmlAction(input: {
  cancellationId: string;
}): Promise<ActionResult<{ xml: string; fileName: string; sha256: string }>> {
  return run(async () => {
    const { cancellationId } = z.object({ cancellationId: uuid }).parse(input);
    // P12.4: a leitura do XML é auditada (quem baixou e qual pedido), como os demais documentos
    // gerados; o portão é o do faturamento, derivado do evento.
    return write('health_insurance.guide.substitution_xml_read', { type: 'hi_guide_cancellation', id: cancellationId }, async (tx, ctx) => {
      const r = await cancellation.readCancellationXmlTx(tx, ctx.clinicId, cancellationId);
      if (!r) throw new cancellation.GuideCancellationError('Pedido sem XML nesta clínica.', 'not_found');
      return { xml: r.xml, fileName: `cancela-guia-${r.guideNumber}.xml`, sha256: r.sha256 };
    });
  });
}

// ── Revisão humana do repasse (0163; contrato aprovado em 16/11) ──────────────

const ReviewDecision = z.object({
  reviewId: uuid,
  decision: z.enum(['maintain', 'reduce', 'acknowledge']),
  reason,
  reduceCents: cents.nullable().optional(),
});

/**
 * Decide a revisão aberta quando a guia saiu do atendimento: manter, reduzir (o ajuste vai no mesmo
 * ato) ou ciência do repasse já pago. Faturamento com permissão FRESCA; segregação, tetos e
 * imutabilidade são do banco. Classe C (D-6): sem portão comercial, vale com o módulo desligado.
 * A auditoria leva só a decisão e os valores, nunca paciente ou guia.
 */
export async function decidePayoutReviewAction(
  input: z.input<typeof ReviewDecision>,
): Promise<ActionResult<{ dueCents: number }>> {
  return run(async () => {
    const d = ReviewDecision.parse(input);
    if (d.decision === 'reduce' && !d.reduceCents)
      throw new review.PayoutReviewError('Informe o valor da redução.', 'invalid');
    await requireFreshPermission(PERMISSIONS.MANAGE_FATURAMENTO_CONVENIO);
    let due = 0;
    await write('health_insurance.payout.review_decided', { type: 'hi_payout_review', id: d.reviewId }, async (tx, ctx) => {
      const out = await review.decidePayoutReviewTx(tx, {
        clinicId: ctx.clinicId,
        reviewId: d.reviewId,
        decision: d.decision,
        reason: d.reason,
        reduceCents: d.decision === 'reduce' ? (d.reduceCents ?? null) : null,
      });
      due = out.dueCents;
      return out.reduceCents === null ? `${out.decision};devido=${out.dueCents}` : `${out.decision}:${out.reduceCents};devido=${out.dueCents}`;
    });
    return { dueCents: due };
  });
}

/** Segregação da revisão (D-2: administração da clínica). Vale para as decisões daqui em diante. */
export async function setPayoutReviewPolicyAction(input: {
  segregation: boolean;
  independentAboveCents: number | null;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z
      .object({ segregation: z.boolean(), independentAboveCents: z.number().int().min(0).max(9_999_999_999).nullable() })
      .parse(input);
    await write('health_insurance.payout.segregation_policy_changed', { type: 'hi_clinic_settings', id: null }, async (tx, ctx) => {
      await review.setPayoutReviewPolicyTx(tx, { clinicId: ctx.clinicId, ...d });
      return `segregacao=${d.segregation ? 'sim' : 'nao'};limite=${d.independentAboveCents ?? 'nenhum'}`;
    });
    return null;
  });
}

export async function cancelInsurancePayoutAction(input: {
  payoutId: string;
  reason: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z.object({ payoutId: uuid, reason }).parse(input);
    await write(
      'health_insurance.payout.cancelled',
      { type: 'hi_payout', id: d.payoutId },
      (tx, ctx) =>
        payouts.cancelInsurancePayoutTx(tx, {
          clinicId: ctx.clinicId,
          payoutId: d.payoutId,
          reason: d.reason,
          actorUserId: ctx.userId,
        }),
    );
    return null;
  });
}

/** Cria os repasses que faltam (guias vivas sem repasse), com as regras atuais. */
export async function syncInsurancePayoutsAction(): Promise<ActionResult<number>> {
  return run(() =>
    write('health_insurance.payout.synced', { type: 'hi_payout', id: null }, (tx, ctx) =>
      payouts.syncInsurancePayoutsTx(tx, ctx.clinicId, ctx.userId),
    ),
  );
}

/** Política D16 da clínica (vale para os repasses criados daqui em diante). */
export async function setPayoutEligibilityAction(input: {
  eligibility: string;
}): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z
      .object({ eligibility: z.enum(['on_receipt', 'on_approval', 'on_completion']) })
      .parse(input);
    await write(
      'health_insurance.payout.policy_changed',
      { type: 'hi_clinic_settings', id: null },
      async (tx, ctx) => {
        await tx.execute(
          sql`UPDATE public.hi_clinic_settings SET payout_eligibility = ${d.eligibility} WHERE clinic_id = ${ctx.clinicId}::uuid`,
        );
        return d.eligibility;
      },
    );
    return null;
  });
}

// ── Coparticipação: cobrança Asaas da coparticipação CONFIRMADA (P10.5) ──

const COPAY_OUTCOME: Record<string, string> = {
  created: 'Link de cobrança da coparticipação criado.',
  existing: 'A coparticipação já tem cobrança; nada novo foi criado.',
  no_account: 'A clínica não tem conta Asaas ativa; receba no Caixa.',
  no_identity: 'O paciente não tem CPF válido para a cobrança; receba no Caixa.',
  below_minimum: 'Valor abaixo do mínimo do gateway; receba no Caixa.',
  no_balance: 'Não há saldo a cobrar nesta coparticipação.',
  above_confirmed: 'O saldo não confere com o valor confirmado; nada foi cobrado.',
  account_paused: 'A conta Asaas da clínica está pausada.',
};

export async function requestCopayChargeAction(input: {
  copaymentId: string;
}): Promise<ActionResult<string>> {
  return run(async () => {
    const d = z.object({ copaymentId: uuid }).parse(input);
    const ctx = await gate('patientCharge');
    const out = await requestCopayCharge(
      { createCheckout: (i) => paymentsApiV1.createCopayCheckout(i) },
      { clinicId: ctx.clinicId, copaymentId: d.copaymentId, actorUserId: ctx.userId },
    );
    const rc = await requestContext();
    await withTenant(
      ctx.clinicId,
      (tx) =>
        logAudit(tx, {
          clinicId: ctx.clinicId,
          userId: ctx.userId,
          action: 'health_insurance.copay.charge_requested',
          resourceType: 'hi_copayment',
          resourceId: d.copaymentId,
          before: null,
          after: { result: out.outcome, status: out.status, amountCents: out.amountCents },
          requestContext: rc,
        }),
      ctx.userId,
    );
    return COPAY_OUTCOME[out.outcome] ?? `Situação: ${out.status}.`;
  });
}

export async function syncCopayChargeAction(input: {
  copaymentId: string;
}): Promise<ActionResult<string>> {
  return run(async () => {
    const d = z.object({ copaymentId: uuid }).parse(input);
    return write(
      'health_insurance.copay.charge_synced',
      { type: 'hi_copayment', id: d.copaymentId },
      (tx, ctx) => syncCopayChargeTx(tx, ctx.clinicId, d.copaymentId),
    );
  });
}
