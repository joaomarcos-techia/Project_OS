import { localDateMinutes, zonedWallToUtc } from './slot-resolver';

export type WaitlistPriority = 'urgent' | 'normal';

/**
 * WAIT-001 — janela de resposta de uma oferta. Curta porque a vaga é perecível —
 * em geral o horário liberado é dos próximos dias — e porque quem não respondeu
 * volta para a fila, não perde o lugar. O cron devolve a oferta vencida à fila,
 * e a C14 não envia convite de oferta vencida (ADR-065).
 */
export const WAITLIST_OFFER_TTL_MINUTES = 240;

/**
 * Horas locais em que a janela de resposta corre (ADR-066): as mesmas em que o
 * convite pode sair, a janela 8–20h do `claimDue` da C14. Um teste da C14 prende
 * as duas.
 */
export const WAITLIST_OFFER_SEND_HOURS = { start: 8, end: 20 } as const;

const MINUTE_MS = 60 * 1000;

/** Abertura e fechamento das horas de envio no dia local `date` (YYYY-MM-DD). */
function sendHoursOn(date: string, timeZone: string): { opens: number; closes: number } {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const at = (hour: number) => zonedWallToUtc(year, month, day, hour, 0, timeZone).getTime();
  return { opens: at(WAITLIST_OFFER_SEND_HOURS.start), closes: at(WAITLIST_OFFER_SEND_HOURS.end) };
}

/** Dia-calendário seguinte a `date` (aritmética pura, sem fuso). */
function nextDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

/**
 * Fim da janela de resposta da oferta feita em `offeredAt`, no fuso da clínica.
 *
 * O relógio só corre nas horas de envio (ADR-066). Contadas as horas da
 * madrugada, a oferta das 21h vencia antes das 8h, e o cron a repassava sem que
 * o primeiro candidato tivesse sido convidado. Agora ela vence às 12h, e a das
 * 17h usa a hora que falta das 8h às 9h do dia seguinte.
 */
export function waitlistOfferExpiresAt(offeredAt: Date, timeZone: string): Date {
  let remainingMs = WAITLIST_OFFER_TTL_MINUTES * MINUTE_MS;
  for (let date = localDateMinutes(offeredAt, timeZone).date; ; date = nextDate(date)) {
    const { opens, closes } = sendHoursOn(date, timeZone);
    const from = Math.max(offeredAt.getTime(), opens);
    if (from >= closes) continue;
    if (remainingMs <= closes - from) return new Date(from + remainingMs);
    remainingMs -= closes - from;
  }
}

/** O fim é exclusivo, como o prazo da C14: no próprio instante a oferta já venceu. */
export function isWaitlistOfferExpired(offeredAt: Date, timeZone: string, now: Date): boolean {
  return now.getTime() >= waitlistOfferExpiresAt(offeredAt, timeZone).getTime();
}

export interface WaitlistCandidate {
  id: string;
  doctorId: string | null;
  procedureId: string;
  priority: WaitlistPriority;
  preferredFrom: Date | null;
  preferredUntil: Date | null;
  createdAt: Date;
}

interface AvailableSlot {
  doctorId: string;
  procedureId: string;
  startsAt: Date;
}

export function chooseWaitlistCandidate(
  candidates: readonly WaitlistCandidate[],
  slot: AvailableSlot,
): WaitlistCandidate | null {
  return (
    candidates
      .filter(
        (candidate) =>
          candidate.procedureId === slot.procedureId &&
          (!candidate.doctorId || candidate.doctorId === slot.doctorId) &&
          (!candidate.preferredFrom || candidate.preferredFrom <= slot.startsAt) &&
          (!candidate.preferredUntil || candidate.preferredUntil >= slot.startsAt),
      )
      .slice()
      .sort((left, right) => {
        if (left.priority !== right.priority) return left.priority === 'urgent' ? -1 : 1;
        const byCreatedAt = left.createdAt.getTime() - right.createdAt.getTime();
        return byCreatedAt !== 0 ? byCreatedAt : left.id.localeCompare(right.id);
      })[0] ?? null
  );
}
