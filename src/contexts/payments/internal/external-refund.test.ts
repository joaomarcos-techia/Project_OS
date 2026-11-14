/**
 * R54 — a regra de atribuição do estorno feito direto no Asaas, sem banco. A prova com o
 * livro real, o worker e a concorrência está em `scripts/security/payments-external-refund-db.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { decideExternalRefund, type ExternalRefundFacts } from './external-refund';

const facts = (over: Partial<ExternalRefundFacts> = {}): ExternalRefundFacts => ({
  chargeStatus: 'paid',
  disputeStatus: null,
  chargeGross: 150,
  recordedExternal: 0,
  intents: [],
  payment: { status: 'RECEIVED', value: 150, chargebackStatus: null, deleted: false },
  refunds: [],
  ...over,
});
const done = (value: number) => ({ refundId: null, status: 'DONE', value });

describe('decideExternalRefund (R54)', () => {
  it('estorno integral DONE: reconhece tudo e marca integral', () => {
    expect(
      decideExternalRefund(
        facts({
          payment: { status: 'REFUNDED', value: 150, deleted: false },
          refunds: [done(150)],
        }),
      ),
    ).toEqual({
      kind: 'record',
      providerTotal: 150,
      claimed: 0,
      externalTotal: 150,
      delta: 150,
      full: true,
    });
  });

  it('estorno parcial e depois outro parcial: cada patamar acrescenta só a diferença', () => {
    const first = decideExternalRefund(facts({ refunds: [done(40)] }));
    expect(first).toMatchObject({ kind: 'record', externalTotal: 40, delta: 40, full: false });
    const second = decideExternalRefund(
      facts({ recordedExternal: 40, refunds: [done(40), done(30)] }),
    );
    expect(second).toMatchObject({ kind: 'record', externalTotal: 70, delta: 30, full: false });
  });

  it('mesmo patamar de novo (reentrega, varredura, duplicado): nada muda', () => {
    expect(decideExternalRefund(facts({ recordedExternal: 40, refunds: [done(40)] }))).toEqual({
      kind: 'unchanged',
      providerTotal: 40,
      claimed: 0,
    });
  });

  it('só estorno DONE conta: PENDING/CANCELLED não compensam nada', () => {
    expect(
      decideExternalRefund(
        facts({
          refunds: [
            { refundId: null, status: 'PENDING', value: 50 },
            { refundId: null, status: 'CANCELLED', value: 50 },
          ],
        }),
      ),
    ).toMatchObject({ kind: 'unchanged' });
  });

  it('pagamento já REFUNDED mas sem estorno DONE ainda: espera o Asaas', () => {
    expect(
      decideExternalRefund(
        facts({
          payment: { status: 'REFUNDED', value: 150, deleted: false },
          refunds: [{ refundId: null, status: 'PENDING', value: 150 }],
        }),
      ),
    ).toEqual({ kind: 'pending_provider' });
  });

  it('o que a intenção CONFIRMADA do Qoro explica não é externo', () => {
    expect(
      decideExternalRefund(
        facts({
          intents: [{ status: 'confirmed', amount: 30, failureCode: null }],
          refunds: [done(30), done(50)],
        }),
      ),
    ).toMatchObject({ kind: 'record', claimed: 30, externalTotal: 50, delta: 50 });
    expect(
      decideExternalRefund(
        facts({
          intents: [{ status: 'confirmed', amount: 30, failureCode: null }],
          refunds: [done(30)],
        }),
      ),
    ).toMatchObject({ kind: 'unchanged' });
  });

  it('intenção ainda aberta: atribuição ambígua vai para revisão humana', () => {
    for (const intent of [
      { status: 'confirmation_pending', amount: 30, failureCode: null },
      { status: 'pending', amount: 30, failureCode: null },
      { status: 'failed', amount: 30, failureCode: 'manual_refund_cancelled' },
    ]) {
      expect(decideExternalRefund(facts({ intents: [intent], refunds: [done(30)] }))).toEqual({
        kind: 'manual_review',
        reason: 'open_refund_intent',
        unexplained: 30,
      });
    }
  });

  it('cobrança que o Qoro nunca baixou (estorno antes do webhook de pagamento): não compensa', () => {
    expect(
      decideExternalRefund(
        facts({
          chargeStatus: 'pending',
          payment: { status: 'REFUNDED', value: 150, deleted: false },
          refunds: [done(150)],
        }),
      ),
    ).toEqual({ kind: 'not_settled', providerTotal: 150 });
  });

  it('disputa (chargeback) aberta ou perdida: revisão, nunca compensação dupla', () => {
    expect(
      decideExternalRefund(facts({ disputeStatus: 'in_dispute', refunds: [done(50)] })),
    ).toMatchObject({ kind: 'manual_review', reason: 'dispute' });
    expect(
      decideExternalRefund(
        facts({
          payment: {
            status: 'RECEIVED',
            value: 150,
            chargebackStatus: 'REQUESTED',
            deleted: false,
          },
          refunds: [done(50)],
        }),
      ),
    ).toMatchObject({ kind: 'manual_review', reason: 'dispute' });
    expect(
      decideExternalRefund(facts({ disputeStatus: 'reversed', refunds: [done(50)] })),
    ).toMatchObject({ kind: 'record', delta: 50 });
  });

  it('chargeback perdido é do D27: o "devolvido" é a própria perda, sem aviso nem compensação aqui', () => {
    for (const over of [
      { disputeStatus: 'lost' },
      { disputeStatus: 'cash_undone' },
      { payment: { status: 'REFUNDED', value: 150, chargebackStatus: 'DONE', deleted: false } },
      {
        payment: {
          status: 'RECEIVED',
          value: 150,
          chargebackStatus: 'DISPUTE_LOST',
          deleted: false,
        },
      },
    ] as Partial<ExternalRefundFacts>[]) {
      expect(decideExternalRefund(facts({ ...over, refunds: [done(150)] }))).toMatchObject({
        kind: 'unchanged',
      });
    }
    // Disputa ganha (REVERSED com pagamento de volta): estorno externo depois é reconhecido.
    expect(
      decideExternalRefund(
        facts({
          payment: { status: 'RECEIVED', value: 150, chargebackStatus: 'REVERSED', deleted: false },
          refunds: [done(30)],
        }),
      ),
    ).toMatchObject({ kind: 'record', delta: 30 });
  });

  it('valor do pagamento no Asaas diferente do da cobrança: revisão', () => {
    expect(
      decideExternalRefund(
        facts({ payment: { status: 'RECEIVED', value: 145, deleted: false }, refunds: [done(50)] }),
      ),
    ).toMatchObject({ kind: 'manual_review', reason: 'amount_mismatch' });
  });

  it('devolvido mais que o valor da cobrança: revisão', () => {
    expect(decideExternalRefund(facts({ refunds: [done(100), done(60)] }))).toMatchObject({
      kind: 'manual_review',
      reason: 'amount_exceeds',
    });
  });

  it('leitura mais antiga que a já reconhecida (webhook atrasado): nada muda, nunca "devolve a devolução"', () => {
    expect(decideExternalRefund(facts({ recordedExternal: 70, refunds: [done(40)] }))).toEqual({
      kind: 'unchanged',
      providerTotal: 40,
      claimed: 0,
      stale: true,
    });
  });

  it('pagamento apagado no Asaas não é estorno', () => {
    expect(
      decideExternalRefund(
        facts({ payment: { status: 'RECEIVED', value: 150, deleted: true }, refunds: [done(150)] }),
      ),
    ).toMatchObject({ kind: 'unchanged' });
  });
});
