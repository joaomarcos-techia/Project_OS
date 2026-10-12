/**
 * Por que um job da C14 terminou `failed` — a leitura que o painel faz de
 * `failed_reason`.
 *
 * O motivo é gravado em três lugares, e cada um tem o seu vocabulário:
 *   - a recusa da Meta depois do aceite (EC-32): `meta_<código>`, ou
 *     `meta_failed` quando o callback não trouxe código;
 *   - o fim do backoff do processor: `meta_failed`, `meta_unknown`,
 *     `meta_pending` ou `meta_error`;
 *   - as falhas de configuração e de payload: `number_not_connected`,
 *     `template_not_configured` e `invalid_payload`.
 *
 * `unknown`, `pending` e `error` não são recusa: a mensagem pode ter chegado.
 * Por isso viram `unconfirmed`, e a tela nunca afirma "não chegou" sobre eles.
 * O mesmo cuidado do Caixa com `creation_unknown`.
 */

/** Janela da leitura do painel: a Agenda lista e o painel conta sobre o mesmo período. */
export const DELIVERY_FAILURE_WINDOW_DAYS = 7;
/** Teto da lista; a tela avisa quando ele é atingido. */
export const DELIVERY_FAILURE_LIST_LIMIT = 100;

export function deliveryFailureWindowStart(now: Date = new Date()): Date {
  return new Date(now.getTime() - DELIVERY_FAILURE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

export type ProactiveFailureCause =
  /** A Meta recusou. `code` é o da Meta (só dígitos); null quando não veio. */
  | { kind: 'meta_refused'; code: string | null }
  /** Não há como saber se a mensagem chegou. */
  | { kind: 'unconfirmed' }
  /** A clínica estava sem número de WhatsApp conectado. */
  | { kind: 'number_not_connected' }
  /** O modelo (template) do tipo não está configurado no Qoro. */
  | { kind: 'template_not_configured' }
  /** Payload inválido ou motivo desconhecido: defeito do Qoro, não da clínica. */
  | { kind: 'internal' };

/** O `errorCode` do evento de status é só dígitos, de 1 a 10. */
const META_CODE = /^meta_(\d{1,10})$/;

export function failureCauseOf(reason: string | null): ProactiveFailureCause {
  if (!reason) return { kind: 'internal' };
  const code = META_CODE.exec(reason)?.[1];
  if (code) return { kind: 'meta_refused', code };
  switch (reason) {
    case 'meta_failed':
      return { kind: 'meta_refused', code: null };
    case 'meta_unknown':
    case 'meta_pending':
    case 'meta_error':
      return { kind: 'unconfirmed' };
    case 'number_not_connected':
      return { kind: 'number_not_connected' };
    case 'template_not_configured':
      return { kind: 'template_not_configured' };
    default:
      return { kind: 'internal' };
  }
}
