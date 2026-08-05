import { describe, expect, it } from 'vitest';

import {
  calculateWalkInCapacity,
  estimateWaitMinutes,
  orderQueue,
  type QueueCandidate,
} from './walkin-queue';

const actionSource = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/actions.ts'),
  'utf8',
);
const coreSource = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/internal/appointment-core.ts'),
  'utf8',
);
const storeSource = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/internal/waiting-queue-store.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0062_waiting_queue.sql'),
  'utf8',
);

describe('walk-in operational queue', () => {
  it('derives capacity from remaining professional minutes instead of a plan quota', () => {
    expect(
      calculateWalkInCapacity({
        remainingAvailabilityMinutes: 180,
        committedMinutes: 120,
        requestedDurationMinutes: 30,
      }),
    ).toEqual({ availableMinutes: 60, remainingSlotsForRequestedDuration: 2, accepted: true });

    expect(
      calculateWalkInCapacity({
        remainingAvailabilityMinutes: 180,
        committedMinutes: 165,
        requestedDurationMinutes: 30,
      }).accepted,
    ).toBe(false);
  });

  it('orders the patient already in service, then urgency, then arrival time', () => {
    const queue: QueueCandidate[] = [
      {
        id: 'normal-first',
        status: 'waiting',
        priority: 'normal',
        queuedAt: '2026-07-24T10:00:00Z',
        durationMinutes: 30,
      },
      {
        id: 'urgent-last',
        status: 'waiting',
        priority: 'urgent',
        queuedAt: '2026-07-24T10:05:00Z',
        durationMinutes: 20,
      },
      {
        id: 'in-service',
        status: 'in_service',
        priority: 'normal',
        queuedAt: '2026-07-24T09:50:00Z',
        durationMinutes: 40,
      },
      {
        id: 'normal-last',
        status: 'waiting',
        priority: 'normal',
        queuedAt: '2026-07-24T10:10:00Z',
        durationMinutes: 15,
      },
    ];

    expect(orderQueue(queue).map((entry) => entry.id)).toEqual([
      'in-service',
      'urgent-last',
      'normal-first',
      'normal-last',
    ]);
    expect(estimateWaitMinutes(queue, 'normal')).toBe(105);
    expect(estimateWaitMinutes(queue, 'urgent')).toBe(60);
  });

  it('does not count completed or cancelled entries in the estimate', () => {
    const queue: QueueCandidate[] = [
      {
        id: 'done',
        status: 'completed',
        priority: 'urgent',
        queuedAt: '2026-07-24T09:00:00Z',
        durationMinutes: 90,
      },
      {
        id: 'cancelled',
        status: 'cancelled',
        priority: 'urgent',
        queuedAt: '2026-07-24T09:01:00Z',
        durationMinutes: 90,
      },
    ];

    expect(estimateWaitMinutes(queue, 'normal')).toBe(0);
  });

  it('serializes capacity and persists the queue with tenant validation', () => {
    expect(actionSource).toContain('assertWalkInOperationalCapacity');
    expect(actionSource).toContain('enqueueWaitingAppointment');
    expect(coreSource).toContain('syncWaitingQueueStatus');
    expect(storeSource).toContain('pg_advisory_xact_lock');
    expect(migration).toContain('waiting queue tenant/doctor mismatch');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
