export type WaitlistPriority = 'urgent' | 'normal';

/**
 * WAIT-001 — janela de resposta de uma oferta. Curta porque a vaga é perecível —
 * em geral o horário liberado é dos próximos dias — e porque quem não respondeu
 * volta para a fila, não perde o lugar. O cron devolve a oferta vencida à fila,
 * e a C14 não envia convite de oferta vencida (ADR-065).
 */
export const WAITLIST_OFFER_TTL_MINUTES = 240;

/** Fim da janela de resposta da oferta feita em `offeredAt`. */
export function waitlistOfferExpiresAt(offeredAt: Date): Date {
  return new Date(offeredAt.getTime() + WAITLIST_OFFER_TTL_MINUTES * 60 * 1000);
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
