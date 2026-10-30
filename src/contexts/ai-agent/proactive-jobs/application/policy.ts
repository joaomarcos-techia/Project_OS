/**
 * Política de envio proativo (C14) — FUNÇÃO PURA, testável (M2: política separada
 * do I/O). Decide se um job pode ser enviado a partir do contato já resolvido.
 *
 * Ordem dos bloqueios (mais forte primeiro):
 *   - no_contact : paciente sem telefone (nada a enviar).
 *   - suppressed : telefone na suppression_list (opt-out/spam/LGPD) — vale p/ TODOS.
 *   - no_consent : agendamento exige opt-in operacional; cobrança exige opt-in
 *                  financeiro; link de sinal exige ambos. Telefone salvo não é
 *                  permissão de contato.
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
 *   - `no_show_followup` → `followup`: recuperação operacional da agenda;
 *   - `deposit_link` → `reminder`: participa da reserva, mas o conteúdo também é
 *     financeiro, então exige os dois opt-ins no gate abaixo.
 *   - `remainder_link` → `billing`: é o saldo pendente de um atendimento que já
 *     aconteceu e respeita o mesmo consentimento/opt-out da cobrança amigável.
 */
export function suppressionPurposeFor(type: ProactiveJobType): SuppressionPurpose {
  if (type === 'dunning' || type === 'remainder_link') return 'billing';
  if (type === 'waitlist_offer' || type === 'followup' || type === 'no_show_followup') {
    return 'followup';
  }
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
    contact.suppressedWhatsappPurposes.includes(purpose) ||
    (type === 'deposit_link' && contact.suppressedWhatsappPurposes.includes('billing'))
  ) {
    return { allowed: false, reason: 'suppressed' };
  }
  if ((purpose === 'reminder' || purpose === 'followup') && !contact.agendamentoWhatsapp) {
    return { allowed: false, reason: 'no_consent' };
  }
  if (
    (purpose === 'billing' || type === 'deposit_link') &&
    (!contact.cobrancaWhatsapp || contact.consentRevoked)
  ) {
    return { allowed: false, reason: 'no_consent' };
  }
  return { allowed: true };
}
