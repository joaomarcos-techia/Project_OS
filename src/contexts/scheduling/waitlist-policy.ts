export type WaitlistPriority = 'urgent' | 'normal';

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
