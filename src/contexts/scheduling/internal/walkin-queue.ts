export type QueuePriority = 'urgent' | 'normal';
export type QueueStatus = 'waiting' | 'in_service' | 'completed' | 'cancelled';

export interface QueueCandidate {
  id: string;
  status: QueueStatus;
  priority: QueuePriority;
  queuedAt: string;
  durationMinutes: number;
}

interface CapacityInput {
  remainingAvailabilityMinutes: number;
  committedMinutes: number;
  requestedDurationMinutes: number;
}

export interface WalkInCapacity {
  availableMinutes: number;
  remainingSlotsForRequestedDuration: number;
  accepted: boolean;
}

export function calculateWalkInCapacity(input: CapacityInput): WalkInCapacity {
  if (!Number.isFinite(input.requestedDurationMinutes) || input.requestedDurationMinutes <= 0) {
    throw new Error('requestedDurationMinutes must be positive');
  }
  const availableMinutes = Math.max(
    0,
    Math.floor(input.remainingAvailabilityMinutes) - Math.floor(input.committedMinutes),
  );
  const remainingSlotsForRequestedDuration = Math.floor(
    availableMinutes / input.requestedDurationMinutes,
  );
  return {
    availableMinutes,
    remainingSlotsForRequestedDuration,
    accepted: remainingSlotsForRequestedDuration > 0,
  };
}

function statusRank(status: QueueStatus): number {
  if (status === 'in_service') return 0;
  if (status === 'waiting') return 1;
  return 2;
}

function priorityRank(priority: QueuePriority): number {
  return priority === 'urgent' ? 0 : 1;
}

export function orderQueue<T extends QueueCandidate>(entries: readonly T[]): T[] {
  return entries
    .filter((entry) => entry.status === 'waiting' || entry.status === 'in_service')
    .slice()
    .sort((left, right) => {
      const byStatus = statusRank(left.status) - statusRank(right.status);
      if (byStatus !== 0) return byStatus;
      const byPriority = priorityRank(left.priority) - priorityRank(right.priority);
      if (byPriority !== 0) return byPriority;
      const byArrival = new Date(left.queuedAt).getTime() - new Date(right.queuedAt).getTime();
      return byArrival !== 0 ? byArrival : left.id.localeCompare(right.id);
    });
}

export function estimateWaitMinutes(
  entries: readonly QueueCandidate[],
  requestedPriority: QueuePriority,
): number {
  return orderQueue(entries)
    .filter(
      (entry) =>
        entry.status === 'in_service' ||
        requestedPriority === 'normal' ||
        entry.priority === 'urgent',
    )
    .reduce((total, entry) => total + Math.max(0, entry.durationMinutes), 0);
}
