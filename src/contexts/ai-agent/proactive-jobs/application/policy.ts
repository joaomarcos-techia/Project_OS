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

/** Propósito de supressão de cada tipo de job. */
export type SuppressionPurpose = 'reminder' | 'followup' | 'billing' | 'marketing';

/**
 * Tipo de job → propósito de supressão. **Uma definição só**, consumida pela
 * política (que BLOQUEIA) e pelo envio (que REGISTRA o propósito na mensagem).
 *
 * Estava duplicada nos dois lugares. Divergir tem um custo silencioso: a
 * política barraria por um propósito e o envio gravaria outro, então o opt-out
 * que o paciente registrou depois nunca casaria com o que foi enviado antes.
 *
 * **Nenhum tipo ganha propósito novo sem necessidade.** Propósito novo nasce sem
 * os opt-outs já registrados — ou seja, ressuscita contato de quem pediu para
 * não ser contatado:
 *   - `waitlist_offer` → `followup`: contato proativo de agendamento;
 *   - `deposit_link` → `reminder`: é TRANSACIONAL. O paciente acabou de marcar e
 *     perde a vaga se não pagar; não é cobrança de dívida (`billing`, que exige
 *     opt-in), é a conclusão de um ato que ele mesmo iniciou.
 */
export function suppressionPurposeFor(type: ProactiveJobType): SuppressionPurpose {
  if (type === 'dunning') return 'billing';
  if (type === 'waitlist_offer' || type === 'followup') return 'followup';
  return 'reminder'; // reminder + deposit_link
}

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
  const purpose = suppressionPurposeFor(type);
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
