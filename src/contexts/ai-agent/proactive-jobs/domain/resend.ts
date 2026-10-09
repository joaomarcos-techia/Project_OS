/**
 * ADR-064 — quando uma recusa da Meta merece reenvio.
 *
 * Regra PURA, usada nos dois lugares que veem recusa: o processor (resposta
 * síncrona do envio) e o handler do EC-32 (callback `failed`). Reenviar exige
 * chave nova, porque o dedup do sender só devolveria o envio recusado. E chave
 * nova só é segura quando a Meta DISSE que não entregou: por isso a regra parte
 * de um código de recusa, e timeout (`unknown`) nunca chega aqui.
 */
import { BACKOFF_FAIL, backoffDelayMs } from '@/lib/outbox/backoff';

import type { ProactiveJobType } from '../schema';
import type {
  DepositLinkPayload,
  ProactivePayload,
  ReminderPayload,
  WaitlistOfferPayload,
} from './types';

/**
 * Códigos que a Meta trata como passageiros (tabela de erros da Cloud API,
 * conferida em 08/10/2026): indisponibilidade, limite de taxa e erro
 * desconhecido ("Try again"). O resto é definitivo, inclusive 131048
 * (qualidade) e 131049 (a Meta manda esperar 24 h ou mais, e a fila desiste
 * antes).
 */
export const RETRYABLE_META_CODES: ReadonlySet<string> = new Set([
  '1', // pedido inválido ou erro de servidor
  '2', // indisponibilidade temporária
  '4', // limite de chamadas do app
  '80007', // limite da WABA
  '130429', // vazão da Cloud API
  '131000', // erro desconhecido ("Try again")
  '131016', // serviço indisponível
  '131056', // muitas mensagens ao mesmo número ("Wait and retry")
  '131057', // conta em manutenção
  '133004', // servidor indisponível
]);

/** `failed_reason` de uma recusa: `meta_131042`; sem código, `meta_failed`. */
export function refusalReason(code: string | null | undefined): string {
  return code ? `meta_${code}` : 'meta_failed';
}

/**
 * Depois deste instante a mensagem não serve mais, e reenviá-la seria pior do
 * que não enviar. Tipos sem prazo dependem só do limite de tentativas.
 */
export function resendDeadline(type: ProactiveJobType, payload: ProactivePayload): Date | null {
  switch (type) {
    case 'deposit_link':
      // O hold do sinal: vencido, a vaga é liberada e o link não paga mais nada.
      return new Date((payload as DepositLinkPayload).holdExpiresAt);
    case 'reminder':
      return new Date((payload as ReminderPayload).scheduledAt);
    case 'waitlist_offer':
      return new Date((payload as WaitlistOfferPayload).scheduledAt);
    default:
      return null;
  }
}

export type RefusalDecision =
  | { kind: 'resend'; nextAt: Date; delayMs: number }
  | { kind: 'fail'; why: 'not_retryable' | 'attempts_exhausted' | 'past_deadline' };

export function decideAfterRefusal(input: {
  type: ProactiveJobType;
  payload: ProactivePayload;
  /** Tentativas já feitas, incluindo a recusada (o claimDue incrementa antes). */
  attempts: number;
  code: string | null | undefined;
  now: Date;
}): RefusalDecision {
  if (!input.code || !RETRYABLE_META_CODES.has(input.code)) {
    return { kind: 'fail', why: 'not_retryable' };
  }
  const delayMs = backoffDelayMs(input.attempts + 1);
  if (delayMs === BACKOFF_FAIL) return { kind: 'fail', why: 'attempts_exhausted' };
  const nextAt = new Date(input.now.getTime() + delayMs);
  const deadline = resendDeadline(input.type, input.payload);
  if (deadline && nextAt.getTime() >= deadline.getTime()) {
    return { kind: 'fail', why: 'past_deadline' };
  }
  return { kind: 'resend', nextAt, delayMs };
}
