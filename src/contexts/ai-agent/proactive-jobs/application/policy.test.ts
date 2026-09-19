import { describe, expect, it } from 'vitest';

/* eslint-disable-next-line boundaries/element-types -- type-only do contrato PÚBLICO do Patient. */
import type { ProactiveContact } from '@/contexts/patient';

import { evaluateProactivePolicy, suppressionPurposeFor } from './policy';

const base: ProactiveContact = {
  nome: 'Maria',
  phone: '5511999990000',
  deceased: false,
  cobrancaWhatsapp: true,
  consentRevoked: false,
  suppressedWhatsapp: false,
  suppressedWhatsappPurposes: [],
};

describe('evaluateProactivePolicy (C14 — matriz por tipo)', () => {
  it('sem contato/telefone → no_contact', () => {
    expect(evaluateProactivePolicy('reminder', null)).toEqual({
      allowed: false,
      reason: 'no_contact',
    });
    expect(evaluateProactivePolicy('reminder', { ...base, phone: null })).toEqual({
      allowed: false,
      reason: 'no_contact',
    });
  });

  it('suppression bloqueia TODOS os tipos', () => {
    const supp: ProactiveContact = {
      ...base,
      suppressedWhatsapp: true,
      suppressedWhatsappPurposes: ['all'],
    };
    for (const t of [
      'reminder',
      'dunning',
      'followup',
      'no_show_followup',
      'remainder_link',
    ] as const) {
      expect(evaluateProactivePolicy(t, supp)).toEqual({ allowed: false, reason: 'suppressed' });
    }
  });

  it('bloqueia qualquer mensagem proativa para paciente falecido', () => {
    for (const type of [
      'reminder',
      'dunning',
      'followup',
      'no_show_followup',
      'remainder_link',
    ] as const) {
      expect(evaluateProactivePolicy(type, { ...base, deceased: true })).toEqual({
        allowed: false,
        reason: 'deceased',
      });
    }
  });

  it('supressão por finalidade não bloqueia mensagens transacionais diferentes', () => {
    const billingOnly: ProactiveContact = {
      ...base,
      suppressedWhatsappPurposes: ['billing'],
    };
    expect(evaluateProactivePolicy('dunning', billingOnly)).toEqual({
      allowed: false,
      reason: 'suppressed',
    });
    expect(evaluateProactivePolicy('remainder_link', billingOnly)).toEqual({
      allowed: false,
      reason: 'suppressed',
    });
    expect(evaluateProactivePolicy('reminder', billingOnly)).toEqual({ allowed: true });
    expect(evaluateProactivePolicy('followup', billingOnly)).toEqual({ allowed: true });
    expect(evaluateProactivePolicy('no_show_followup', billingOnly)).toEqual({ allowed: true });
  });

  it('dunning exige opt-in cobranca_whatsapp não-revogado', () => {
    expect(evaluateProactivePolicy('dunning', { ...base, cobrancaWhatsapp: false })).toEqual({
      allowed: false,
      reason: 'no_consent',
    });
    expect(evaluateProactivePolicy('dunning', { ...base, consentRevoked: true })).toEqual({
      allowed: false,
      reason: 'no_consent',
    });
    expect(evaluateProactivePolicy('dunning', base)).toEqual({ allowed: true });
  });

  it('reminder/followup são transacionais — não exigem cobranca_whatsapp', () => {
    const noConsent = { ...base, cobrancaWhatsapp: false, consentRevoked: true };
    expect(evaluateProactivePolicy('reminder', noConsent)).toEqual({ allowed: true });
    expect(evaluateProactivePolicy('followup', noConsent)).toEqual({ allowed: true });
    expect(evaluateProactivePolicy('no_show_followup', noConsent)).toEqual({ allowed: true });
  });
});

/**
 * A definição É uma só, e este teste é o que impede ela de virar duas de novo.
 *
 * O custo de divergir é silencioso: a política barraria por um propósito e o
 * envio gravaria outro, então o opt-out registrado depois nunca casaria com o
 * que já foi enviado — e o paciente continuaria recebendo o que pediu para não
 * receber.
 */
describe('suppressionPurposeFor — propósito de supressão por tipo', () => {
  it.each([
    ['reminder', 'reminder'],
    ['dunning', 'billing'],
    ['followup', 'followup'],
    ['no_show_followup', 'followup'],
    // Contato proativo de agendamento tem a mesma natureza do followup.
    ['waitlist_offer', 'followup'],
    // 1.6a — TRANSACIONAL: o paciente acabou de marcar e perde a vaga se não
    // pagar. Não é cobrança de dívida (`billing`, que exige opt-in).
    ['deposit_link', 'reminder'],
    // 1.6c — saldo posterior ao atendimento tem a mesma finalidade de billing
    // do dunning; nenhum propósito novo nasce sem os opt-outs existentes.
    ['remainder_link', 'billing'],
  ] as const)('%s → %s', (type, purpose) => {
    expect(suppressionPurposeFor(type)).toBe(purpose);
  });

  it('link do sinal respeita o opt-out de lembrete (não cria propósito novo)', () => {
    // Propósito novo nasceria sem os opt-outs já registrados — ou seja,
    // ressuscitaria contato de quem pediu para não ser contatado.
    const optOut = { ...base, suppressedWhatsappPurposes: ['reminder' as const] };

    expect(evaluateProactivePolicy('deposit_link', optOut)).toEqual({
      allowed: false,
      reason: 'suppressed',
    });
  });

  it('link do sinal NÃO exige opt-in de cobrança (não é dunning)', () => {
    const semOptInCobranca = { ...base, cobrancaWhatsapp: false, consentRevoked: true };

    expect(evaluateProactivePolicy('deposit_link', semOptInCobranca)).toEqual({ allowed: true });
    // Contraste: o mesmo contato é barrado para dunning.
    expect(evaluateProactivePolicy('dunning', semOptInCobranca)).toEqual({
      allowed: false,
      reason: 'no_consent',
    });
  });

  it('link do restante respeita consentimento e opt-out de billing', () => {
    expect(
      evaluateProactivePolicy('remainder_link', {
        ...base,
        suppressedWhatsappPurposes: ['billing'],
      }),
    ).toEqual({ allowed: false, reason: 'suppressed' });
    expect(evaluateProactivePolicy('remainder_link', { ...base, cobrancaWhatsapp: false })).toEqual(
      { allowed: false, reason: 'no_consent' },
    );
    expect(evaluateProactivePolicy('remainder_link', base)).toEqual({ allowed: true });
  });
});
