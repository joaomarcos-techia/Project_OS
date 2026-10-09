/**
 * ADR-064 — até quando um REENVIO da C14 ainda serve. Depois deste instante a
 * mensagem diria algo falso ou inútil, e reenviá-la seria pior do que não enviar.
 *
 * Só vale para reenvio: o primeiro envio segue o guard de send-time de sempre.
 * A sessão "C14: validade por tipo" traz um prazo para todos os envios
 * (`sendDeadline`, em `application/validity.ts`); quando as duas branches se
 * encontrarem, este arquivo dá lugar a ele, e os chamadores trocam a função.
 */
import type { ProactiveJobType } from '../schema';
import type {
  DepositLinkPayload,
  ProactivePayload,
  ReminderPayload,
  WaitlistOfferPayload,
} from '../domain/types';
import { clinicLocalToUtc, localDateYMD } from '../infra/tz';

export function resendDeadline(
  type: ProactiveJobType,
  payload: ProactivePayload,
  timezone: string,
): Date | null {
  switch (type) {
    case 'deposit_link':
      // O hold do sinal: vencido, a vaga é liberada e o link não paga mais nada.
      return new Date((payload as DepositLinkPayload).holdExpiresAt);
    case 'reminder': {
      // O corpo diz "agendado para amanhã às {{2}}": no próprio dia da consulta
      // ele já mente. Vence na meia-noite local do dia da consulta.
      const appointment = new Date((payload as ReminderPayload).scheduledAt);
      return clinicLocalToUtc(timezone, localDateYMD(timezone, appointment), 0);
    }
    case 'waitlist_offer':
      return new Date((payload as WaitlistOfferPayload).scheduledAt);
    default:
      return null;
  }
}
