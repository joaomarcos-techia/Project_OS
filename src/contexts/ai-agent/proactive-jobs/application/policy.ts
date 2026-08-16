/**
 * Política de envio proativo (C14) — FUNÇÃO PURA, testável (M2: política separada
 * do I/O). Decide se um job pode ser enviado a partir do contato já resolvido.
 *
 * Ordem dos bloqueios (mais forte primeiro):
 *   - no_contact : paciente sem telefone (nada a enviar).
 *   - suppressed : telefone na suppression_list (opt-out/spam/LGPD) — vale p/ TODOS.
 *   - no_consent : DUNNING sem opt-in de cobrança (LGPD; reminder/followup são
 *                  transacionais e NÃO exigem o flag).
 */
/* eslint-disable-next-line boundaries/element-types -- type-only do contrato PÚBLICO do Patient (ProactiveContact). */
import type { ProactiveContact } from '@/contexts/patient';

import type { ProactivePolicyResult } from '../domain/types';
import type { ProactiveJobType } from '../schema';

export function evaluateProactivePolicy(
  type: ProactiveJobType,
  contact: ProactiveContact | null,
): ProactivePolicyResult {
  if (!contact || !contact.phone) return { allowed: false, reason: 'no_contact' };
  if (contact.deceased) return { allowed: false, reason: 'deceased' };
  // WAIT-001 — a oferta de vaga é contato proativo de agendamento, a mesma
  // natureza do followup: quem pediu para não receber followup também não quer
  // ser chamado por causa de um cancelamento alheio. Não se cria um propósito
  // novo de supressão para não invalidar os opt-outs já registrados.
  const purpose = type === 'dunning' ? 'billing' : type === 'waitlist_offer' ? 'followup' : type;
  if (
    contact.suppressedWhatsapp ||
    contact.suppressedWhatsappPurposes.includes('all') ||
    contact.suppressedWhatsappPurposes.includes(purpose)
  ) {
    return { allowed: false, reason: 'suppressed' };
  }
  if (type === 'dunning' && (!contact.cobrancaWhatsapp || contact.consentRevoked)) {
    return { allowed: false, reason: 'no_consent' };
  }
  return { allowed: true };
}
