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
  if (contact.suppressedWhatsapp) return { allowed: false, reason: 'suppressed' };
  if (type === 'dunning' && (!contact.cobrancaWhatsapp || contact.consentRevoked)) {
    return { allowed: false, reason: 'no_consent' };
  }
  return { allowed: true };
}
