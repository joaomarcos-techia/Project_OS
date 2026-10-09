import { describe, expect, it } from 'vitest';

/* eslint-disable boundaries/element-types -- o tipo vem da API pública do Payments (M14). */
import type { PatientChargeStatus } from '@/contexts/payments';
/* eslint-enable boundaries/element-types */

import { detectPaymentClaim } from '../guards/semantic-guard';
import { decidePaymentClaimReply, PAYMENT_PENDING_PREFIX, relevantCharge } from './payment-claim';

function charge(over: Partial<PatientChargeStatus>): PatientChargeStatus {
  return {
    chargeId: 'c1',
    appointmentId: 'a1',
    kind: 'deposit',
    status: 'pending',
    amount: 75,
    paidAt: null,
    holdExpiresAt: new Date('2026-10-09T14:00:00Z'),
    createdAt: new Date('2026-10-08T14:00:00Z'),
    ...over,
  };
}

const base = {
  cash: false,
  insisting: false,
  appointmentWhen: '12/10/2026 às 11:00',
  holdUntil: '09/10/2026 às 11:00',
};

describe('detectPaymentClaim (EC-22)', () => {
  it('casa a afirmação de pagamento', () => {
    for (const text of [
      'Já paguei',
      'paguei o sinal',
      'Fiz o Pix agora',
      'já transferi',
      'segue o comprovante',
      'pagamento feito!',
    ]) {
      expect(detectPaymentClaim(text)).toEqual({ claimed: true, cash: false });
    }
  });

  it('separa o pagamento em dinheiro', () => {
    expect(detectPaymentClaim('paguei em dinheiro na recepção')).toEqual({
      claimed: true,
      cash: true,
    });
    expect(detectPaymentClaim('já paguei pessoalmente')).toEqual({ claimed: true, cash: true });
  });

  it('pergunta, futuro e negação não são afirmação', () => {
    for (const text of [
      'posso pagar em dinheiro?',
      'vou pagar amanhã',
      'ainda não paguei',
      'não fiz o pix',
      'quanto custa a consulta?',
    ]) {
      expect(detectPaymentClaim(text).claimed).toBe(false);
    }
  });
});

describe('decidePaymentClaimReply (EC-22)', () => {
  it('sinal pago: confirma com valor e consulta, sem equipe', () => {
    const r = decidePaymentClaimReply({
      ...base,
      charges: [charge({ status: 'paid', paidAt: new Date() })],
    });
    expect(r).toEqual({
      text: 'Recebemos o pagamento do sinal (R$ 75,00). Sua consulta de 12/10/2026 às 11:00 está confirmada.',
      handoffReason: null,
    });
  });

  it('pendente: diz que a confirmação não chegou e o prazo do horário, sem equipe', () => {
    const r = decidePaymentClaimReply({ ...base, charges: [charge({})] });
    expect(r.handoffReason).toBeNull();
    expect(r.text.startsWith(`${PAYMENT_PENDING_PREFIX} de R$ 75,00.`)).toBe(true);
    expect(r.text).toContain('O seu horário fica reservado até 09/10/2026 às 11:00.');
    expect(r.text).not.toMatch(/recebemos o pagamento|confirmad/i);
  });

  it('pendente e o paciente insiste: equipe', () => {
    const r = decidePaymentClaimReply({ ...base, insisting: true, charges: [charge({})] });
    expect(r.handoffReason).toBe('payment_claim_unconfirmed');
  });

  it('dinheiro com sinal pendente: o sinal é só pelo link, o restante pode ser em dinheiro, equipe', () => {
    const r = decidePaymentClaimReply({ ...base, cash: true, charges: [charge({})] });
    expect(r.handoffReason).toBe('payment_claim_cash');
    expect(r.text).toContain('O sinal é pago pelo link');
    expect(r.text).toContain('O restante pode ser pago na clínica, inclusive em dinheiro.');
  });

  it('dinheiro com restante pendente: a equipe dá baixa', () => {
    const r = decidePaymentClaimReply({
      ...base,
      cash: true,
      charges: [charge({ kind: 'remainder', holdExpiresAt: null })],
    });
    expect(r).toEqual({
      text: 'Pagamento em dinheiro é registrado pela equipe da clínica. Já avisei a equipe para dar baixa e te retornar por aqui.',
      handoffReason: 'payment_claim_cash',
    });
  });

  it('nenhuma cobrança: equipe confere, e nada é dado como pago', () => {
    const r = decidePaymentClaimReply({ ...base, charges: [] });
    expect(r.handoffReason).toBe('payment_claim_no_charge');
    expect(r.text).not.toMatch(/recebemos/i);
  });

  it('a cobrança relevante é a pendente mais recente, depois a paga mais recente', () => {
    const paid = charge({ chargeId: 'paga', status: 'paid' });
    const pending = charge({ chargeId: 'pendente' });
    const expired = charge({ chargeId: 'vencida', status: 'expired' });
    expect(relevantCharge([expired, paid, pending])?.chargeId).toBe('pendente');
    expect(relevantCharge([expired, paid])?.chargeId).toBe('paga');
    expect(relevantCharge([expired])).toBeNull();
  });
});
