import { describe, expect, it } from 'vitest';

/* eslint-disable-next-line boundaries/element-types -- type-only do contrato PÚBLICO do Patient. */
import type { ProactiveContact } from '@/contexts/patient';

import { evaluateProactivePolicy } from './policy';

const base: ProactiveContact = {
  nome: 'Maria',
  phone: '5511999990000',
  cobrancaWhatsapp: true,
  consentRevoked: false,
  suppressedWhatsapp: false,
};

describe('evaluateProactivePolicy (C14 — matriz por tipo)', () => {
  it('sem contato/telefone → no_contact', () => {
    expect(evaluateProactivePolicy('reminder', null)).toEqual({ allowed: false, reason: 'no_contact' });
    expect(evaluateProactivePolicy('reminder', { ...base, phone: null })).toEqual({
      allowed: false,
      reason: 'no_contact',
    });
  });

  it('suppression bloqueia TODOS os tipos', () => {
    const supp = { ...base, suppressedWhatsapp: true };
    for (const t of ['reminder', 'dunning', 'followup'] as const) {
      expect(evaluateProactivePolicy(t, supp)).toEqual({ allowed: false, reason: 'suppressed' });
    }
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
  });
});
