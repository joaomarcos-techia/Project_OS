import { describe, expect, it } from 'vitest';

import { chooseWaitlistCandidate, type WaitlistCandidate } from './waitlist-policy';

const core = readFileSync(
  resolve(process.cwd(), 'src/contexts/scheduling/internal/appointment-core.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0063_waitlist_recurrence.sql'),
  'utf8',
);
const waitlistPage = readFileSync(
  resolve(process.cwd(), 'src/app/(app)/(shell)/agenda/lista-espera/page.tsx'),
  'utf8',
);

describe('waitlist candidate selection', () => {
  const slot = {
    doctorId: 'doctor-1',
    procedureId: 'procedure-1',
    startsAt: new Date('2026-07-30T13:00:00.000Z'),
  };

  it('prefers urgent compatible candidates, then oldest request', () => {
    const candidates: WaitlistCandidate[] = [
      {
        id: 'old-normal',
        doctorId: null,
        procedureId: 'procedure-1',
        priority: 'normal',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date('2026-07-20T10:00:00Z'),
      },
      {
        id: 'new-urgent',
        doctorId: 'doctor-1',
        procedureId: 'procedure-1',
        priority: 'urgent',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date('2026-07-24T10:00:00Z'),
      },
    ];

    expect(chooseWaitlistCandidate(candidates, slot)?.id).toBe('new-urgent');
  });

  it('ignores candidates for another doctor, procedure or preferred period', () => {
    const candidates: WaitlistCandidate[] = [
      {
        id: 'doctor',
        doctorId: 'doctor-2',
        procedureId: 'procedure-1',
        priority: 'urgent',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date(),
      },
      {
        id: 'procedure',
        doctorId: null,
        procedureId: 'procedure-2',
        priority: 'urgent',
        preferredFrom: null,
        preferredUntil: null,
        createdAt: new Date(),
      },
      {
        id: 'period',
        doctorId: null,
        procedureId: 'procedure-1',
        priority: 'urgent',
        preferredFrom: new Date('2026-08-01T00:00:00Z'),
        preferredUntil: null,
        createdAt: new Date(),
      },
    ];

    expect(chooseWaitlistCandidate(candidates, slot)).toBeNull();
  });

  it('offers a compatible waiting entry when an appointment is cancelled', () => {
    expect(core).toContain('offerWaitlistForCancelledAppointment');
    expect(migration).toContain('waitlist entry tenant mismatch');
    expect(migration).toContain('waitlist_entries_clinic_status_priority_idx');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(waitlistPage).toContain('listWaitlistEntries(clinicId, true)');
    expect(waitlistPage).toContain('PERMISSIONS.EDIT_AGENDA');
  });
});
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
