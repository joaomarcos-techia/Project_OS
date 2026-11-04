import { describe, expect, it, vi } from 'vitest';

import { restoreSignupDraftSnapshot, signupDraftSnapshotSchema } from './signup-draft-snapshot';

const db = vi.hoisted(() => ({ transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ dbAdmin: db }));

function snapshot() {
  const now = Date.now();
  return {
    version: 1,
    purpose: 'Authorized lead-04 onboarding recovery; not account authority',
    capturedAt: new Date(now - 1000).toISOString(),
    retainUntil: new Date(now + 86_400_000).toISOString(),
    data: {
      user_id: 'b9779910-3dd9-40c2-84fb-ec6cafbb9f81',
      auth_created_at: new Date(now - 5000).toISOString(),
      owner_name: 'Synthetic owner',
      clinic_name: 'Synthetic clinic',
      email_hash: 'a'.repeat(64),
      accepted_at: new Date(now - 2000).toISOString(),
      professionals_band: '1',
      weekly_appointments_band: 'ate_20',
      current_tooling: 'nada_papel',
      discovery_source: 'outro',
      answered_at: new Date(now - 2000).toISOString(),
      selected_plan_id: null,
      selected_billing_cycle: 'monthly',
    },
  };
}

describe('protected signup draft snapshot', () => {
  it('accepts only the previously captured format, without account authority', () => {
    expect(signupDraftSnapshotSchema.safeParse(snapshot()).success).toBe(true);
    expect(
      signupDraftSnapshotSchema.safeParse({ ...snapshot(), password: 'refused' }).success,
    ).toBe(false);
    expect(
      signupDraftSnapshotSchema.safeParse({
        ...snapshot(),
        data: { ...snapshot().data, asaas_checkout_id: 'refused' },
      }).success,
    ).toBe(false);
  });

  it('does not restore an expired snapshot or grant a fresh retention period', async () => {
    expect(
      await restoreSignupDraftSnapshot({ ...snapshot(), retainUntil: new Date(0).toISOString() }),
    ).toEqual({ ok: false, reason: 'invalid_snapshot' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuses retention beyond fourteen days from the original Auth identity', async () => {
    expect(
      await restoreSignupDraftSnapshot({
        ...snapshot(),
        retainUntil: new Date(Date.now() + 15 * 86_400_000).toISOString(),
      }),
    ).toEqual({ ok: false, reason: 'invalid_snapshot' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('refuses capture from the future and a fabricated later consent', async () => {
    expect(
      await restoreSignupDraftSnapshot({
        ...snapshot(),
        capturedAt: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toEqual({ ok: false, reason: 'invalid_snapshot' });
    const input = snapshot();
    input.data.accepted_at = new Date(Date.now() + 60_000).toISOString();
    expect(await restoreSignupDraftSnapshot(input)).toEqual({
      ok: false,
      reason: 'invalid_snapshot',
    });
    expect(db.transaction).not.toHaveBeenCalled();
  });
});
