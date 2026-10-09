/**
 * Validade de cada tipo de job da C14 (ADR-065) — FUNÇÃO PURA, como `policy.ts`.
 *
 * Um job que perdeu a janela útil não é enviado atrasado: o guard de send-time
 * o cancela com `expired_<tipo>`. A validade sai do payload, do fuso da clínica
 * e de `created_at` — nunca de `scheduled_for`, que o backoff reescreve —, então
 * vale também para os jobs que já estão na fila, sem coluna nova.
 *
 * Os cortes por dia são dias-calendário no fuso da clínica (ADR-2): o job vale
 * até a meia-noite local que abre o dia do corte.
 *
 * O que só o seam de origem sabe continua no guard: a janela de resposta da
 * oferta da lista de espera (`lookupWaitlistOffer`) e a cobrança ainda pagável
 * (`getPayableCharge`).
 */
import type {
  DepositLinkPayload,
  DunningPayload,
  FollowupPayload,
  NoShowFollowupPayload,
  ProactivePayload,
  ReminderPayload,
  WaitlistOfferPayload,
} from '../domain/types';
import { addCalendarDays, clinicLocalToUtc, localDateYMD, nextWeekday } from '../infra/tz';
import type { ProactiveJobType } from '../schema';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Dunning — até que dia de atraso cada estágio fala sozinho.
 *
 * O D+3 vale até o D+7 começar: os dois usam o mesmo template, e um D+3
 * atrasado sairia no mesmo dia que o D+7. O D+7 vale até o D+15, quando o
 * `routeDunning` do Financial passa o caso para revisão humana — e contato
 * automático em cima de cobrança conduzida por uma pessoa são duas vozes.
 */
export const DUNNING_STAGE_VALID_UNTIL_DAYS = { 3: 7, 7: 15 } as const;

/**
 * Followup — dias depois da data do retorno em que o convite ainda vale. O job
 * sai dois dias antes do retorno; uma semana depois dele o atraso ainda é pequeno
 * frente ao intervalo que o médico pediu, e "no seu último atendimento" segue
 * verdadeiro. Depois disso é a clínica quem decide o contato.
 */
export const FOLLOWUP_GRACE_DAYS = 7;

/**
 * No-show — dias úteis depois da falta em que o contato ainda vale. O job nasce
 * para o 1º dia útil (ADR-057); mais dois absorvem a cauda do backoff, que a
 * janela 8–20h empurra para o dia seguinte. Depois, "sua consulta consta como não
 * realizada" já não aponta com clareza para aquela falta.
 */
export const NO_SHOW_FOLLOWUP_BUSINESS_DAYS = 3;

/**
 * Restante — dias depois do enfileiramento: a promessa de cobrança do link do
 * restante (`REMAINDER_DUE_DAYS` do Payments, D58). O corpo não cita data, então
 * a mensagem vale enquanto o link pagaria.
 */
export const REMAINDER_LINK_VALID_DAYS = 7;

export interface ValidityContext {
  /** Fuso da clínica: os cortes por dia são dias-calendário locais. */
  timezone: string;
  /** `created_at` do job — o `scheduled_for` o backoff reescreve. */
  createdAt: Date;
}

/** Motivo estável do cancelamento por validade: `expired_reminder`, `expired_dunning`… */
export type ExpiredReason = `expired_${ProactiveJobType}`;

export function expiredReason(type: ProactiveJobType): ExpiredReason {
  return `expired_${type}`;
}

/** Meia-noite local que abre `dateYMD` no fuso da clínica. */
function startOfLocalDay(timezone: string, dateYMD: string): Date {
  return clinicLocalToUtc(timezone, dateYMD, 0);
}

/** Instante a partir do qual o job não sai mais. */
export function sendDeadline(
  type: ProactiveJobType,
  payload: ProactivePayload,
  ctx: ValidityContext,
): Date {
  switch (type) {
    case 'reminder': {
      // O corpo diz "amanhã às {{2}}". No dia da consulta ele aponta o dia
      // errado — e a 5ª tentativa do backoff (+6 h) passa da meia-noite e só é
      // reservada às 8h dele.
      const { scheduledAt } = payload as ReminderPayload;
      return startOfLocalDay(ctx.timezone, localDateYMD(ctx.timezone, new Date(scheduledAt)));
    }
    case 'deposit_link':
      // "Você tem até {{3}} para pagar": depois do hold o prazo da mensagem é
      // falso e a vaga já voltou para a agenda.
      return new Date((payload as DepositLinkPayload).holdExpiresAt);
    case 'waitlist_offer':
      // Convite para um horário que já começou não tem como ser aceito.
      return new Date((payload as WaitlistOfferPayload).scheduledAt);
    case 'dunning': {
      const { dueDate, stage } = payload as DunningPayload;
      return startOfLocalDay(
        ctx.timezone,
        addCalendarDays(dueDate, DUNNING_STAGE_VALID_UNTIL_DAYS[stage]),
      );
    }
    case 'followup': {
      const { returnDate } = payload as FollowupPayload;
      return startOfLocalDay(ctx.timezone, addCalendarDays(returnDate, FOLLOWUP_GRACE_DAYS + 1));
    }
    case 'no_show_followup': {
      const { noShowAt } = payload as NoShowFollowupPayload;
      let lastDay = localDateYMD(ctx.timezone, new Date(noShowAt));
      for (let day = 0; day < NO_SHOW_FOLLOWUP_BUSINESS_DAYS; day += 1) {
        lastDay = nextWeekday(lastDay);
      }
      return startOfLocalDay(ctx.timezone, addCalendarDays(lastDay, 1));
    }
    case 'remainder_link':
      return new Date(ctx.createdAt.getTime() + REMAINDER_LINK_VALID_DAYS * DAY_MS);
    default: {
      const unsupported: never = type;
      throw new Error(`[c14] tipo de job sem validade definida: ${String(unsupported)}`);
    }
  }
}

export function isExpired(
  type: ProactiveJobType,
  payload: ProactivePayload,
  ctx: ValidityContext & { now: Date },
): boolean {
  return ctx.now.getTime() >= sendDeadline(type, payload, ctx).getTime();
}
