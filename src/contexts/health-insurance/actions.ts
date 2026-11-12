'use server';

/**
 * Ações da interface de Convênios (P7.7/P9.9) sobre os serviços reais: guia (conferir,
 * devolver, aprovar, cancelar), lote (criar, exportar XML, enviar, protocolo, análise,
 * cancelar) e conta da guia (glosa, recurso, pagamento, estorno, conciliação).
 *
 * Pipeline de toda escrita: requireUser → permissão (gerenciar financeiro) → Zod →
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
import { AuthError, requireCachedPermission, requireClinicId, requireUser } from '@/lib/auth/tenant-context';
import { withTenant } from '@/lib/db/tenant';
import { premiumAccessErrorFrom, premiumDenialMessage } from '@/lib/premium-access';
import { supabaseTissObjectStore, TissStorageError } from '@/lib/storage/tiss-files';

import * as batches from './internal/batch-service';
import { readBatchGuidesAudited } from './internal/guide-access';
import { approveConsultaGuide } from './internal/guide-issuance';
import * as acct from './internal/insurance-account-service';
import { loadXmllintValidator } from './tiss/xml/xsd-validator';

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const BASE = '/financeiro/convenios';
const uuid = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, 'Data inválida');
const version = z.number().int().min(1);
const cents = z.number().int().min(1).max(9_999_999_999);
const reason = z.string().trim().min(10, 'Informe o motivo (10 a 500 caracteres).').max(500);
const key = z.string().min(8).max(200);

async function gate(): Promise<{ clinicId: string; userId: string }> {
  const user = await requireUser();
  await requireCachedPermission(PERMISSIONS.MANAGE_FINANCIAL);
  const clinicId = await requireClinicId();
  return { clinicId, userId: user.userId };
}

/** Mensagem para o usuário: regra de negócio do banco fica; o resto vira mensagem genérica. */
function messageOf(error: unknown): string {
  if (error instanceof AuthError) {
    return error.code === 'unauthenticated'
      ? 'Sua sessão terminou. Entre de novo para continuar.'
      : 'Seu perfil não tem permissão para esta operação de convênios.';
  }
  const premium = premiumAccessErrorFrom(error);
  if (premium) return premiumDenialMessage(premium.feature, premium.reason);
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? 'Dados inválidos.';
  if (error instanceof acct.InsuranceAccountError) return error.message;
  if (error instanceof batches.BatchExportError) return error.message;
  if (error instanceof TissStorageError) return 'O armazenamento de arquivos está indisponível agora. Tente de novo em instantes.';
  const e = error as { code?: string; cause?: { code?: string; message?: string } };
  const code = e.code ?? e.cause?.code;
  // Regras do banco (estado, versão, CHECK): a mensagem já é para o usuário e não leva dado pessoal.
  if (code && ['55000', '23514', '22023', '40001'].includes(code) && e.cause?.message) return e.cause.message;
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
  fn: (tx: Parameters<Parameters<typeof withTenant>[1]>[0], ctx: { clinicId: string; userId: string }) => Promise<T>,
): Promise<T> {
  const ctx = await gate();
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
export async function reviewGuideAction(input: z.input<typeof GuideRef>): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GuideRef.parse(input);
    await write('health_insurance.guide.reviewed', { type: 'hi_guide', id: d.guideId }, async (tx, ctx) => {
      const rows = await tx.execute(sql`UPDATE public.hi_guides SET status = 'reviewed', reviewed_by = ${ctx.userId}::uuid
          WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.guideId}::uuid AND version = ${d.version} RETURNING id`);
      if ((rows as unknown as unknown[]).length === 0) throw new acct.InsuranceAccountError('A guia mudou desde que a tela foi aberta. Atualize e confira de novo.', 'conflict');
    });
    return null;
  });
}

const GuideNote = GuideRef.extend({ note: reason });

/** Devolve para correção (conferida ou aprovada ainda fora de lote → "para conferir"). */
export async function returnGuideAction(input: z.input<typeof GuideNote>): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GuideNote.parse(input);
    await write('health_insurance.guide.returned', { type: 'hi_guide', id: d.guideId }, async (tx, ctx) => {
      const rows = await tx.execute(sql`UPDATE public.hi_guides SET status = 'ready_for_review', transition_note = ${d.note}
          WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.guideId}::uuid AND version = ${d.version} RETURNING id`);
      if ((rows as unknown as unknown[]).length === 0) throw new acct.InsuranceAccountError('A guia mudou desde que a tela foi aberta. Atualize e tente de novo.', 'conflict');
    });
    return null;
  });
}

/** Cancela uma guia ainda não faturada (motivo obrigatório; final). */
export async function cancelGuideAction(input: z.input<typeof GuideNote>): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GuideNote.parse(input);
    await write('health_insurance.guide.cancelled', { type: 'hi_guide', id: d.guideId }, async (tx, ctx) => {
      const rows = await tx.execute(sql`UPDATE public.hi_guides SET status = 'cancelled', cancel_reason = ${d.note}, cancelled_by = ${ctx.userId}::uuid
          WHERE clinic_id = ${ctx.clinicId}::uuid AND id = ${d.guideId}::uuid AND version = ${d.version} RETURNING id`);
      if ((rows as unknown as unknown[]).length === 0) throw new acct.InsuranceAccountError('A guia mudou desde que a tela foi aberta. Atualize e tente de novo.', 'conflict');
    });
    return null;
  });
}

/** Aprovação = emissão: congela o snapshot cifrado (leitura auditada da carteirinha). */
export async function approveGuideAction(input: { guideId: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const { guideId } = z.object({ guideId: uuid }).parse(input);
    const ctx = await gate();
    await approveConsultaGuide(ctx.clinicId, guideId);
    return null;
  });
}

// ── Lotes ─────────────────────────────────────────────────────────────────

const CreateBatch = z.object({ insurerId: uuid, guideIds: z.array(uuid).min(1).max(100), idempotencyKey: key });

export async function createBatchAction(input: z.input<typeof CreateBatch>): Promise<ActionResult<string>> {
  return run(async () => {
    const d = CreateBatch.parse(input);
    return write('health_insurance.batch.created', { type: 'hi_batch', id: null }, (tx, ctx) =>
      batches.createBatchInTx(tx, {
        clinicId: ctx.clinicId,
        insurerId: d.insurerId,
        guideType: 'consulta',
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
    const ctx = await gate();
    const validateXsd = loadXmllintValidator();
    const guideIds = await withTenant(ctx.clinicId, async (tx) =>
      ((await tx.execute(sql`SELECT guide_id FROM public.hi_batch_guides
          WHERE clinic_id = ${ctx.clinicId}::uuid AND batch_id = ${batchId}::uuid AND active`)) as unknown as Array<{ guide_id: string }>).map((r) => r.guide_id),
    );
    if (guideIds.length === 0) throw new acct.InsuranceAccountError('O lote não tem guias.', 'invalid');
    const reads = await readBatchGuidesAudited({ clinicId: ctx.clinicId, guideIds, operation: 'batch_xml_export', batchRef: batchId, surface: 'convenios/lote/exportar' });
    const out = await batches.exportBatch(
      { store: supabaseTissObjectStore(), validateXsd },
      {
        clinicId: ctx.clinicId,
        batchId,
        contents: reads.map((r) => ({ guideId: r.guideId, revision: r.revision, content: r.content })),
        actorUserId: ctx.userId,
        requestContext: await requestContext(),
      },
    );
    return out.kind;
  });
}

const BatchRef = z.object({ batchId: uuid, version });

export async function markBatchSentAction(input: z.input<typeof BatchRef> & { sentOn: string; evidence: string }): Promise<ActionResult<number>> {
  return run(async () => {
    const d = BatchRef.extend({ sentOn: day, evidence: z.string().trim().min(10, 'Descreva como o lote foi enviado (portal, protocolo do portal, e-mail).').max(500) }).parse(input);
    return write('health_insurance.batch.sent', { type: 'hi_batch', id: d.batchId }, (tx, ctx) =>
      batches.markBatchSentInTx(tx, { clinicId: ctx.clinicId, batchId: d.batchId, version: d.version, channel: 'manual', sentOn: d.sentOn, evidence: d.evidence }),
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
        protocol: z.string().trim().min(1, 'Informe o protocolo da operadora.').max(60),
        receivedOn: day,
      })
      .parse({ batchId: form.get('batchId'), version: form.get('version'), protocol: form.get('protocol'), receivedOn: form.get('receivedOn') });
    const receipt = form.get('receipt');
    if (!(receipt instanceof File) || receipt.size === 0) throw new acct.InsuranceAccountError('Anexe o recibo do protocolo emitido pela operadora.', 'invalid');
    if (receipt.size > 10 * 1024 * 1024) throw new acct.InsuranceAccountError('O recibo passa de 10 MB.', 'invalid');
    const evidenceSha256 = createHash('sha256').update(Buffer.from(await receipt.arrayBuffer())).digest('hex');
    return write('health_insurance.batch.protocol_recorded', { type: 'hi_batch', id: d.batchId }, (tx, ctx) =>
      batches.recordBatchProtocolInTx(tx, { clinicId: ctx.clinicId, batchId: d.batchId, version: d.version, protocol: d.protocol, receivedOn: d.receivedOn, evidenceSha256 }),
    );
  });
}

export async function markBatchUnderReviewAction(input: z.input<typeof BatchRef>): Promise<ActionResult<number>> {
  return run(async () => {
    const d = BatchRef.parse(input);
    return write('health_insurance.batch.under_review', { type: 'hi_batch', id: d.batchId }, (tx, ctx) =>
      batches.markBatchUnderReviewInTx(tx, { clinicId: ctx.clinicId, batchId: d.batchId, version: d.version }),
    );
  });
}

export async function cancelBatchAction(input: z.input<typeof BatchRef> & { reason: string }): Promise<ActionResult<number>> {
  return run(async () => {
    const d = BatchRef.extend({ reason }).parse(input);
    return write('health_insurance.batch.cancelled', { type: 'hi_batch', id: d.batchId }, (tx, ctx) =>
      batches.cancelBatchInTx(tx, { clinicId: ctx.clinicId, batchId: d.batchId, version: d.version, reason: d.reason }),
    );
  });
}

// ── Conta da guia: glosa, recurso, pagamento, conciliação ─────────────────

const Gloss = z.object({ batchId: uuid, guideId: uuid, itemId: uuid.nullable().optional(), code: z.string().trim().regex(/^\d{4}$/u, 'Código de glosa da tabela 38 (4 dígitos).'), amountCents: cents, idempotencyKey: key });

/** Glosa informada pela operadora fora do demonstrativo (registro manual de quem conferiu). */
export async function recordGlossAction(input: z.input<typeof Gloss>): Promise<ActionResult<string>> {
  return run(async () => {
    const d = Gloss.parse(input);
    return write('health_insurance.gloss.recorded', { type: 'hi_gloss', id: null }, (tx, ctx) =>
      acct.recordGlossInTx(tx, { clinicId: ctx.clinicId, batchId: d.batchId, guideId: d.guideId, itemId: d.itemId ?? null, code: d.code, amountCents: d.amountCents, source: 'manual', idempotencyKey: `ui:${d.idempotencyKey}` }),
    );
  });
}

const GlossDecision = z.object({ glossId: uuid, version, to: z.enum(['under_analysis', 'contested', 'definitive']), reason: z.string().trim().max(500).optional() });

/** Analisar, contestar ou aceitar como definitiva (com motivo; a decisão não volta). */
export async function decideGlossAction(input: z.input<typeof GlossDecision>): Promise<ActionResult<null>> {
  return run(async () => {
    const d = GlossDecision.parse(input);
    if (d.to === 'definitive') reason.parse(d.reason ?? '');
    await write(`health_insurance.gloss.${d.to}`, { type: 'hi_gloss', id: d.glossId }, (tx, ctx) =>
      acct.transitionGlossInTx(tx, { clinicId: ctx.clinicId, glossId: d.glossId, version: d.version, to: d.to, ...(d.reason ? { reason: d.reason } : {}) }),
    );
    return null;
  });
}

const Appeal = z.object({ guideId: uuid, glossIds: z.array(uuid).min(1), justification: z.string().trim().min(30, 'A justificativa do recurso precisa explicar o motivo (mínimo de 30 caracteres).').max(4000), idempotencyKey: key });

/** Recurso: a justificativa é sempre de uma pessoa (nunca gerada). */
export async function createAppealAction(input: z.input<typeof Appeal>): Promise<ActionResult<string>> {
  return run(async () => {
    const d = Appeal.parse(input);
    return write('health_insurance.appeal.created', { type: 'hi_gloss_appeal', id: null }, (tx, ctx) =>
      acct.createAppealInTx(tx, { clinicId: ctx.clinicId, guideId: d.guideId, items: d.glossIds.map((glossId) => ({ glossId })), justification: d.justification, idempotencyKey: `ui:${d.idempotencyKey}` }),
    );
  });
}

const FileAppeal = z.object({ appealId: uuid, version, filedOn: day, protocol: z.string().trim().max(60).optional(), evidence: z.string().trim().max(500).optional() });

export async function fileAppealAction(input: z.input<typeof FileAppeal>): Promise<ActionResult<null>> {
  return run(async () => {
    const d = FileAppeal.parse(input);
    await write('health_insurance.appeal.filed', { type: 'hi_gloss_appeal', id: d.appealId }, (tx, ctx) =>
      acct.fileAppealInTx(tx, {
        clinicId: ctx.clinicId,
        appealId: d.appealId,
        version: d.version,
        channel: 'manual',
        filedOn: d.filedOn,
        ...(d.protocol ? { protocol: d.protocol } : {}),
        ...(d.evidence ? { evidence: d.evidence } : {}),
      }),
    );
    return null;
  });
}

const AnswerAppeal = z.object({ appealId: uuid, version, answeredOn: day, items: z.array(z.object({ glossId: uuid, acceptedCents: z.number().int().min(0) })).min(1), note: z.string().trim().max(500).optional() });

export async function answerAppealAction(input: z.input<typeof AnswerAppeal>): Promise<ActionResult<null>> {
  return run(async () => {
    const d = AnswerAppeal.parse(input);
    await write('health_insurance.appeal.answered', { type: 'hi_gloss_appeal', id: d.appealId }, (tx, ctx) =>
      acct.answerAppealInTx(tx, { clinicId: ctx.clinicId, appealId: d.appealId, version: d.version, answeredOn: d.answeredOn, items: d.items, ...(d.note ? { note: d.note } : {}) }),
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
export async function recordPaymentAction(input: z.input<typeof Payment>): Promise<ActionResult<string>> {
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

const Allocate = z.object({ paymentId: uuid, allocations: z.array(z.object({ guideId: uuid, batchId: uuid, amountCents: cents })).min(1), idempotencyKey: key });

export async function allocatePaymentAction(input: z.input<typeof Allocate>): Promise<ActionResult<null>> {
  return run(async () => {
    const d = Allocate.parse(input);
    await write('health_insurance.payment.allocated', { type: 'hi_payment', id: d.paymentId }, (tx, ctx) =>
      acct.allocatePaymentInTx(tx, { clinicId: ctx.clinicId, paymentId: d.paymentId, allocationKey: `ui:${d.idempotencyKey}`, allocations: d.allocations }),
    );
    return null;
  });
}

export async function reverseAllocationAction(input: { allocationId: string; reason: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z.object({ allocationId: uuid, reason }).parse(input);
    await write('health_insurance.payment.reversed', { type: 'hi_payment_allocation', id: d.allocationId }, (tx, ctx) =>
      acct.reversePaymentAllocationInTx(tx, { clinicId: ctx.clinicId, allocationId: d.allocationId, reason: d.reason }),
    );
    return null;
  });
}

/** Encerrar (conciliar) a guia: só uma pessoa, com pendente zero e nada em aberto. */
export async function reconcileGuideAction(input: { guideId: string; version: number; note?: string }): Promise<ActionResult<null>> {
  return run(async () => {
    const d = z.object({ guideId: uuid, version, note: z.string().trim().max(500).optional() }).parse(input);
    await write('health_insurance.guide.reconciled', { type: 'hi_guide', id: d.guideId }, (tx, ctx) =>
      acct.reconcileGuideInTx(tx, { clinicId: ctx.clinicId, guideId: d.guideId, version: d.version, ...(d.note ? { note: d.note } : {}) }),
    );
    return null;
  });
}

