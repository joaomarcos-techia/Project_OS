/**
 * Revisão humana do repasse quando a guia sai do atendimento (0163; contrato aprovado em 16/11:
 * docs/convenios/cancelamento-repasse-contrato.md).
 *
 * A ABERTURA é do banco (gatilho deferido em `hi_guides`, no commit da transação que cancela ou
 * substitui a guia): nenhum caminho do app abre revisão. Aqui só a LEITURA e a DECISÃO, que chama
 * `hi_payout_review_decide()` — clínica e pessoa vêm da sessão (`withTenant`), os tetos, a trava do
 * repasse, a segregação e a imutabilidade são do banco. Nenhum livro, recebível ou Caixa é tocado.
 */
import { sql } from 'drizzle-orm';

import type { Tx } from '@/lib/db';

export type PayoutReviewDecision = 'maintain' | 'reduce' | 'acknowledge';

export class PayoutReviewError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'decided' | 'segregation' | 'invalid',
  ) {
    super(message);
    this.name = 'PayoutReviewError';
  }
}

export interface PayoutReviewRow {
  id: string;
  payoutId: string;
  guideId: string;
  guideStatus: 'cancelled' | 'replaced';
  kind: 'blocking' | 'acknowledgement';
  status: 'open' | 'decided';
  openedBy: string | null;
  openedAt: string;
  openAuthorizedCents: number;
  openAdjustmentsCents: number;
  openSettledCents: number;
  decision: PayoutReviewDecision | null;
  decisionReason: string | null;
  reduceCents: number | null;
  decidedBy: string | null;
  decidedAt: string | null;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v));

export async function listPayoutReviewsTx(
  tx: Tx,
  clinicId: string,
  f: { status?: 'open' | 'decided'; payoutId?: string } = {},
): Promise<PayoutReviewRow[]> {
  const rows = (await tx.execute(sql`
    SELECT * FROM public.hi_payout_reviews
     WHERE clinic_id = ${clinicId}::uuid
       AND (${f.status ?? null}::text IS NULL OR status = ${f.status ?? null}::text)
       AND (${f.payoutId ?? null}::uuid IS NULL OR payout_id = ${f.payoutId ?? null}::uuid)
     ORDER BY opened_at DESC LIMIT 500`)) as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    payoutId: String(r.payout_id),
    guideId: String(r.guide_id),
    guideStatus: r.guide_status as PayoutReviewRow['guideStatus'],
    kind: r.kind as PayoutReviewRow['kind'],
    status: r.status as PayoutReviewRow['status'],
    openedBy: r.opened_by ? String(r.opened_by) : null,
    openedAt: iso(r.opened_at),
    openAuthorizedCents: num(r.open_authorized_cents),
    openAdjustmentsCents: num(r.open_adjustments_cents),
    openSettledCents: num(r.open_settled_cents),
    decision: (r.decision ?? null) as PayoutReviewDecision | null,
    decisionReason: r.decision_reason ? String(r.decision_reason) : null,
    reduceCents: r.reduce_cents === null || r.reduce_cents === undefined ? null : Number(r.reduce_cents),
    decidedBy: r.decided_by ? String(r.decided_by) : null,
    decidedAt: r.decided_at ? iso(r.decided_at) : null,
  }));
}

/** Código e mensagem do Postgres, no erro direto ou no `cause` do driver. */
function pgError(e: unknown): { code: string | undefined; constraint: string | undefined; message: string } {
  const x = e as { code?: string; constraint_name?: string; message?: string; cause?: { code?: string; constraint_name?: string; message?: string } };
  return {
    code: x.code ?? x.cause?.code,
    constraint: x.constraint_name ?? x.cause?.constraint_name,
    message: x.cause?.message ?? x.message ?? '',
  };
}

export async function decidePayoutReviewTx(
  tx: Tx,
  input: {
    clinicId: string;
    reviewId: string;
    decision: PayoutReviewDecision;
    reason: string;
    reduceCents?: number | null;
  },
): Promise<{ reviewId: string; payoutId: string; decision: PayoutReviewDecision; reduceCents: number | null; dueCents: number }> {
  try {
    const rows = (await tx.execute(sql`
      SELECT * FROM public.hi_payout_review_decide(
        ${input.clinicId}::uuid, ${input.reviewId}::uuid, ${input.decision}, ${input.reason},
        ${input.reduceCents ?? null}::bigint)`)) as unknown as Row[];
    const r = rows[0]!;
    return {
      reviewId: String(r.review_id),
      payoutId: String(r.payout_id),
      decision: r.decision as PayoutReviewDecision,
      reduceCents: r.reduce_cents === null || r.reduce_cents === undefined ? null : Number(r.reduce_cents),
      dueCents: num(r.due_cents),
    };
  } catch (e) {
    const p = pgError(e);
    if (p.code === 'P0002') throw new PayoutReviewError('Revisão de repasse não encontrada nesta clínica.', 'not_found');
    if (p.constraint === 'hi_payout_review_decided') throw new PayoutReviewError('Esta revisão já foi decidida.', 'decided');
    if (p.constraint === 'hi_payout_review_segregation')
      throw new PayoutReviewError(
        'Esta revisão exige outra pessoa: quem tirou a guia do atendimento não decide (segregação da clínica ou valor em jogo).',
        'segregation',
      );
    if (p.code === '22023') throw new PayoutReviewError(p.message, 'invalid');
    throw e;
  }
}

/** Política de segregação da revisão (D-2: administração da clínica). */
export async function setPayoutReviewPolicyTx(
  tx: Tx,
  input: { clinicId: string; segregation: boolean; independentAboveCents: number | null },
): Promise<void> {
  await tx.execute(sql`
    UPDATE public.hi_clinic_settings
       SET payout_review_segregation = ${input.segregation},
           payout_review_independent_above_cents = ${input.independentAboveCents}::bigint
     WHERE clinic_id = ${input.clinicId}::uuid`);
}
