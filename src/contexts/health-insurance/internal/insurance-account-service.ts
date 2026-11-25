/**
 * Glosas, recursos de glosa e pagamentos da operadora (P9.6, P9.7, P9.8; migration 0152).
 *
 * Toda escrita é uma função SECURITY DEFINER do banco (`hi_gloss_*`, `hi_payment_*`,
 * `hi_guide_reconcile`): o runtime só lê as tabelas. Este serviço valida a entrada,
 * chama a função na transação do chamador (`withTenant`) e traduz os erros do banco
 * para `InsuranceAccountError`, com a mensagem em português que o banco já escreve.
 *
 * Regras que vivem no banco (e são provadas no harness de glosas e pagamentos):
 *  - pago + glosa em aberto + glosa definitiva ≤ faturado, por guia e por item;
 *  - pagamento parcial nunca quita; encerrar (conciliar) é ato de uma pessoa;
 *  - mesma chave ou mesmo demonstrativo não entra duas vezes;
 *  - estorno é lançamento compensatório; glosa decidida não volta.
 *
 * D24: glosa, recurso e pagamento são PRESERVAÇÃO de obrigação já faturada (lote já
 * enviado): seguem disponíveis com a assinatura suspensa. Por isso não há gate
 * comercial aqui, ao contrário de criar guia, lote ou exportar.
 */
import 'server-only';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type { Tx } from '@/lib/db';
import { metrics } from '@/lib/observability/metrics';

export type InsuranceAccountErrorKind = 'invalid' | 'state' | 'conflict' | 'duplicate' | 'forbidden' | 'not_found';

export class InsuranceAccountError extends Error {
  constructor(
    message: string,
    readonly kind: InsuranceAccountErrorKind,
  ) {
    super(message);
    this.name = 'InsuranceAccountError';
  }
}

const SQLSTATE_KIND: Record<string, InsuranceAccountErrorKind> = {
  '23514': 'invalid',
  '22023': 'invalid',
  '55000': 'state',
  '40001': 'conflict',
  '23505': 'duplicate',
  '42501': 'forbidden',
  '23503': 'not_found',
};

function translate(error: unknown): never {
  const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = e.code ?? e.cause?.code;
  const kind = code ? SQLSTATE_KIND[code] : undefined;
  if (kind) throw new InsuranceAccountError(e.cause?.message ?? e.message ?? 'erro', kind);
  throw error;
}

async function call<T>(tx: Tx, q: ReturnType<typeof sql>): Promise<T> {
  try {
    const rows = (await tx.execute(q)) as unknown as Array<Record<string, T>>;
    return Object.values(rows[0] ?? {})[0] as T;
  } catch (error) {
    return translate(error);
  }
}

const uuid = z.uuid();
const cents = z.number().int().positive().max(9_999_999_999);
const key = z.string().min(8).max(200);
const day = z.iso.date();
const reason = z.string().trim().min(10).max(500);

// ── Glosas ──────────────────────────────────────────────────────────────

export const GlossInput = z.object({
  clinicId: uuid,
  batchId: uuid,
  guideId: uuid,
  itemId: uuid.nullable().default(null),
  /** Tabela 38 da TUSS: 4 dígitos. */
  code: z.string().regex(/^[0-9]{4}$/u),
  amountCents: cents,
  source: z.enum(['manual', 'statement']),
  returnId: uuid.nullable().default(null),
  idempotencyKey: key,
  note: z.string().max(500).nullable().default(null),
});

export async function recordGlossInTx(tx: Tx, input: z.input<typeof GlossInput>): Promise<string> {
  const a = GlossInput.parse(input);
  const id = await call<string>(
    tx,
    sql`SELECT public.hi_gloss_record(${a.clinicId}::uuid, ${a.batchId}::uuid, ${a.guideId}::uuid, ${a.itemId}::uuid,
          ${a.code}, ${a.amountCents}::bigint, ${a.source}, ${a.returnId}::uuid, ${a.idempotencyKey}, ${a.note}) AS id`,
  );
  metrics.emit('insurance.gloss.recorded', { source: a.source });
  return id;
}

export type GlossTarget = 'under_analysis' | 'contested' | 'definitive' | 'reversed';

export async function transitionGlossInTx(
  tx: Tx,
  input: { clinicId: string; glossId: string; version: number; to: GlossTarget; reason?: string | null },
): Promise<number> {
  const a = z
    .object({
      clinicId: uuid,
      glossId: uuid,
      version: z.number().int().positive(),
      to: z.enum(['under_analysis', 'contested', 'definitive', 'reversed']),
      reason: reason.nullable().default(null),
    })
    .parse(input);
  if ((a.to === 'definitive' || a.to === 'reversed') && !a.reason) {
    throw new InsuranceAccountError('Informe o motivo (10 a 500 caracteres).', 'invalid');
  }
  return call<number>(
    tx,
    sql`SELECT public.hi_gloss_transition(${a.clinicId}::uuid, ${a.glossId}::uuid, ${a.version}, ${a.to}, ${a.reason}) AS v`,
  );
}

// ── Recursos de glosa ───────────────────────────────────────────────────

export async function createAppealInTx(
  tx: Tx,
  input: {
    clinicId: string;
    guideId: string;
    items: ReadonlyArray<{ glossId: string; requestedCents?: number }>;
    /** Texto de uma pessoa autorizada: o Qoro nunca gera justificativa. */
    justification: string;
    idempotencyKey: string;
  },
): Promise<string> {
  const a = z
    .object({
      clinicId: uuid,
      guideId: uuid,
      items: z.array(z.object({ glossId: uuid, requestedCents: cents.optional() })).min(1).max(99),
      justification: z.string().trim().min(20).max(2000),
      idempotencyKey: key,
    })
    .parse(input);
  return call<string>(
    tx,
    sql`SELECT public.hi_gloss_appeal_create(${a.clinicId}::uuid, ${a.guideId}::uuid, ${JSON.stringify(a.items)}::jsonb,
          ${a.justification}, ${a.idempotencyKey}) AS id`,
  );
}

export async function fileAppealInTx(
  tx: Tx,
  input: {
    clinicId: string;
    appealId: string;
    version: number;
    channel: 'manual' | 'connector';
    filedOn: string;
    /** Protocolo devolvido pela operadora; sem ele, a evidência do envio é obrigatória. */
    protocol?: string | null;
    evidence?: string | null;
    fileId?: string | null;
  },
): Promise<number> {
  const a = z
    .object({
      clinicId: uuid,
      appealId: uuid,
      version: z.number().int().positive(),
      channel: z.enum(['manual', 'connector']),
      filedOn: day,
      protocol: z.string().trim().regex(/^[0-9A-Za-z./-]{1,30}$/u).nullable().default(null),
      evidence: z.string().trim().min(10).max(500).nullable().default(null),
      fileId: uuid.nullable().default(null),
    })
    .parse(input);
  if (!a.protocol && !a.evidence) {
    throw new InsuranceAccountError('Informe o protocolo da operadora ou a evidência do envio do recurso.', 'invalid');
  }
  return call<number>(
    tx,
    sql`SELECT public.hi_gloss_appeal_file(${a.clinicId}::uuid, ${a.appealId}::uuid, ${a.version}, ${a.channel},
          ${a.filedOn}::date, ${a.protocol}, ${a.evidence}, ${a.fileId}::uuid) AS v`,
  );
}

export async function answerAppealInTx(
  tx: Tx,
  input: {
    clinicId: string;
    appealId: string;
    version: number;
    answeredOn: string;
    /** Valor aceito de cada glosa recorrida (0 = negado). O resto vira glosa definitiva. */
    items: ReadonlyArray<{ glossId: string; acceptedCents: number }>;
    note?: string | null;
  },
): Promise<number> {
  const a = z
    .object({
      clinicId: uuid,
      appealId: uuid,
      version: z.number().int().positive(),
      answeredOn: day,
      items: z.array(z.object({ glossId: uuid, acceptedCents: z.number().int().min(0) })).min(1),
      note: z.string().trim().max(500).nullable().default(null),
    })
    .parse(input);
  return call<number>(
    tx,
    sql`SELECT public.hi_gloss_appeal_answer(${a.clinicId}::uuid, ${a.appealId}::uuid, ${a.version}, ${a.answeredOn}::date,
          ${JSON.stringify(a.items)}::jsonb, ${a.note}) AS v`,
  );
}

export async function cancelAppealInTx(
  tx: Tx,
  input: { clinicId: string; appealId: string; version: number; reason: string },
): Promise<number> {
  const a = z.object({ clinicId: uuid, appealId: uuid, version: z.number().int().positive(), reason }).parse(input);
  return call<number>(
    tx,
    sql`SELECT public.hi_gloss_appeal_cancel(${a.clinicId}::uuid, ${a.appealId}::uuid, ${a.version}, ${a.reason}) AS v`,
  );
}

// ── Pagamentos ─────────────────────────────────────────────────────────

const Allocation = z.object({ guideId: uuid, batchId: uuid, itemId: uuid.optional(), amountCents: cents });

export async function recordPaymentInTx(
  tx: Tx,
  input: {
    clinicId: string;
    insurerId: string;
    batchId?: string | null;
    statementRef?: string | null;
    paidOn: string;
    amountCents: number;
    source: 'manual' | 'statement';
    returnId?: string | null;
    idempotencyKey: string;
    note?: string | null;
    /** Sem alocação e com lote: só aloca sozinho se o valor for exatamente o saldo do lote. */
    allocations?: ReadonlyArray<z.input<typeof Allocation>> | null;
  },
): Promise<string> {
  const a = z
    .object({
      clinicId: uuid,
      insurerId: uuid,
      batchId: uuid.nullable().default(null),
      statementRef: z.string().trim().min(1).max(60).nullable().default(null),
      paidOn: day,
      amountCents: z.number().int().positive().max(99_999_999_999),
      source: z.enum(['manual', 'statement']),
      returnId: uuid.nullable().default(null),
      idempotencyKey: key,
      note: z.string().max(500).nullable().default(null),
      allocations: z.array(Allocation).max(1000).nullable().default(null),
    })
    .parse(input);
  const id = await call<string>(
    tx,
    sql`SELECT public.hi_payment_record(${a.clinicId}::uuid, ${a.insurerId}::uuid, ${a.batchId}::uuid, ${a.statementRef},
          ${a.paidOn}::date, ${a.amountCents}::bigint, ${a.source}, ${a.returnId}::uuid, ${a.idempotencyKey}, ${a.note},
          ${a.allocations ? JSON.stringify(a.allocations) : null}::jsonb) AS id`,
  );
  metrics.emit('insurance.payment.recorded', { source: a.source });
  return id;
}

export async function allocatePaymentInTx(
  tx: Tx,
  input: { clinicId: string; paymentId: string; allocationKey: string; allocations: ReadonlyArray<z.input<typeof Allocation>> },
): Promise<number> {
  const a = z
    .object({ clinicId: uuid, paymentId: uuid, allocationKey: key, allocations: z.array(Allocation).min(1).max(1000) })
    .parse(input);
  return Number(
    await call<string | number>(
      tx,
      sql`SELECT public.hi_payment_allocate(${a.clinicId}::uuid, ${a.paymentId}::uuid, ${a.allocationKey},
            ${JSON.stringify(a.allocations)}::jsonb) AS v`,
    ),
  );
}

export async function reversePaymentAllocationInTx(
  tx: Tx,
  input: { clinicId: string; allocationId: string; reason: string },
): Promise<string> {
  const a = z.object({ clinicId: uuid, allocationId: uuid, reason }).parse(input);
  return call<string>(
    tx,
    sql`SELECT public.hi_payment_reverse(${a.clinicId}::uuid, ${a.allocationId}::uuid, ${a.reason}) AS id`,
  );
}

/** Conciliação: encerra a guia quando pago + glosa definitiva = faturado e nada está em aberto. */
export async function reconcileGuideInTx(
  tx: Tx,
  input: { clinicId: string; guideId: string; version: number; note?: string | null },
): Promise<number> {
  const a = z
    .object({ clinicId: uuid, guideId: uuid, version: z.number().int().positive(), note: z.string().max(500).nullable().default(null) })
    .parse(input);
  return call<number>(
    tx,
    sql`SELECT public.hi_guide_reconcile(${a.clinicId}::uuid, ${a.guideId}::uuid, ${a.version}, ${a.note}) AS v`,
  );
}

// ── Leitura da conta ────────────────────────────────────────────────────

export interface GuideAccount {
  guideId: string;
  insurerId: string;
  guideType: 'consulta' | 'sp_sadt';
  number: string;
  status: string;
  version: number;
  billedCents: number;
  paidCents: number;
  glossOpenCents: number;
  glossDefinitiveCents: number;
  glossReversedCents: number;
  /** Faturado − pago − glosa definitiva. Glosa em aberto continua pendente (não é perda). */
  pendingCents: number;
}

const accountRow = z.object({
  guide_id: z.string(),
  insurer_id: z.string(),
  guide_type: z.enum(['consulta', 'sp_sadt']),
  number: z.string(),
  status: z.string(),
  version: z.coerce.number(),
  billed_cents: z.coerce.number(),
  paid_cents: z.coerce.number(),
  gloss_open_cents: z.coerce.number(),
  gloss_definitive_cents: z.coerce.number(),
  gloss_reversed_cents: z.coerce.number(),
  pending_cents: z.coerce.number(),
});

const toAccount = (r: z.infer<typeof accountRow>): GuideAccount => ({
  guideId: r.guide_id,
  insurerId: r.insurer_id,
  guideType: r.guide_type,
  number: r.number,
  status: r.status,
  version: r.version,
  billedCents: r.billed_cents,
  paidCents: r.paid_cents,
  glossOpenCents: r.gloss_open_cents,
  glossDefinitiveCents: r.gloss_definitive_cents,
  glossReversedCents: r.gloss_reversed_cents,
  pendingCents: r.pending_cents,
});

export async function readGuideAccountInTx(tx: Tx, clinicId: string, guideId: string): Promise<GuideAccount | null> {
  const rows = await tx.execute(
    sql`SELECT * FROM public.hi_guide_accounts WHERE clinic_id = ${clinicId}::uuid AND guide_id = ${guideId}::uuid`,
  );
  const r = (rows as unknown as unknown[])[0];
  return r ? toAccount(accountRow.parse(r)) : null;
}

/** Contas das guias de um lote (painel do lote: pago, glosado, pendente). */
export async function listBatchAccountsInTx(tx: Tx, clinicId: string, batchId: string): Promise<GuideAccount[]> {
  const rows = await tx.execute(sql`
    SELECT a.* FROM public.hi_guide_accounts a
      JOIN public.hi_batch_guides bg ON bg.clinic_id = a.clinic_id AND bg.guide_id = a.guide_id AND bg.active
     WHERE a.clinic_id = ${clinicId}::uuid AND bg.batch_id = ${batchId}::uuid
     ORDER BY a.number`);
  return z.array(accountRow).parse(rows).map(toAccount);
}

export interface PaymentBalance {
  paymentId: string;
  amountCents: number;
  allocatedCents: number;
  /** Recebido e ainda não atribuído a guia: divergência a conciliar, nunca quitação. */
  unreconciledCents: number;
}

export async function readPaymentBalanceInTx(tx: Tx, clinicId: string, paymentId: string): Promise<PaymentBalance | null> {
  const rows = (await tx.execute(
    sql`SELECT payment_id, amount_cents, allocated_cents, unreconciled_cents FROM public.hi_payment_balances
         WHERE clinic_id = ${clinicId}::uuid AND payment_id = ${paymentId}::uuid`,
  )) as unknown as Array<Record<string, string | number>>;
  const r = rows[0];
  return r
    ? {
        paymentId: String(r.payment_id),
        amountCents: Number(r.amount_cents),
        allocatedCents: Number(r.allocated_cents),
        unreconciledCents: Number(r.unreconciled_cents),
      }
    : null;
}


// ── 0153: o livro da clínica (projeção da conta da guia) ──────────────

/** Por operadora: o que foi faturado, recebido, glosado (em aberto e definitivo) e falta receber. */
export interface InsurerReceivables {
  insurerId: string;
  guides: number;
  billedCents: number;
  paidCents: number;
  glossOpenCents: number;
  glossDefinitiveCents: number;
  pendingCents: number;
  /** Dinheiro recebido da operadora e ainda não alocado a guias (conciliação). */
  unreconciledCents: number;
}

export async function listInsurerReceivablesInTx(tx: Tx, clinicId: string): Promise<InsurerReceivables[]> {
  const rows = (await tx.execute(
    sql`SELECT insurer_id, guides, billed_cents, paid_cents, gloss_open_cents, gloss_definitive_cents, pending_cents,
               unreconciled_cents
          FROM public.hi_insurer_receivables WHERE clinic_id = ${clinicId}::uuid ORDER BY insurer_id`,
  )) as unknown as Array<Record<string, string | number>>;
  return rows.map((r) => ({
    insurerId: String(r.insurer_id),
    guides: Number(r.guides),
    billedCents: Number(r.billed_cents),
    paidCents: Number(r.paid_cents),
    glossOpenCents: Number(r.gloss_open_cents),
    glossDefinitiveCents: Number(r.gloss_definitive_cents),
    pendingCents: Number(r.pending_cents),
    unreconciledCents: Number(r.unreconciled_cents),
  }));
}

export type LedgerDriftKind = 'missing_receivable' | 'billed_mismatch' | 'paid_mismatch' | 'gloss_mismatch' | 'stale_receivable';

/** Guias em que o livro não bate com a conta (deve ser sempre vazio; alerta se não for). */
export async function listLedgerDriftInTx(
  tx: Tx,
  clinicId: string,
): Promise<Array<{ guideId: string; number: string; drift: LedgerDriftKind }>> {
  const rows = (await tx.execute(
    sql`SELECT guide_id, number, drift FROM public.hi_ledger_drift WHERE clinic_id = ${clinicId}::uuid ORDER BY number`,
  )) as unknown as Array<Record<string, string>>;
  return rows.map((r) => ({ guideId: String(r.guide_id), number: String(r.number), drift: r.drift as LedgerDriftKind }));
}

/** Reprocessa a ponte da clínica da sessão (idempotente). Devolve quantas guias conferiu. */
export async function syncLedgerForClinicInTx(tx: Tx, clinicId: string): Promise<number> {
  return Number(await call<number>(tx, sql`SELECT public.hi_ledger_sync_clinic(${clinicId}::uuid) AS n`));
}
