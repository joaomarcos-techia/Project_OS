import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
const { createAdminClient } = vi.hoisted(() => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/trial-access', () => ({ assertTrialPaidFeature: vi.fn() }));
vi.mock('@/lib/auth/supabase-admin', () => ({ createAdminClient }));
vi.mock('./team-invite-email', () => ({ deliverTeamInviteEmail: vi.fn() }));

import { assertTrialPaidFeature } from '@/lib/trial-access';
import { TrialAccessError } from '@/lib/trial-access/policy';
import { inviteClinicMember, resendClinicInvite } from './members';
import { deliverTeamInviteEmail } from './team-invite-email';

const context = { ip: null, userAgent: null, requestId: 'synthetic', correlationId: null };
describe('unpaid trial invitation boundary', () => {
  it('does not create an Auth account or send an invitation', async () => {
    vi.mocked(assertTrialPaidFeature).mockRejectedValueOnce(new TrialAccessError('team_invites'));
    await expect(
      inviteClinicMember({
        clinicId: 'synthetic-clinic',
        nome: 'Synthetic',
        email: 'synthetic@example.invalid',
        role: 'attendant',
        clinicName: 'Synthetic',
        inviterNome: 'Synthetic',
        funcaoLabel: 'Recepção',
        invitedBy: 'synthetic-owner',
        requestContext: context,
        idempotencyKey: 'synthetic',
        seatLimit: 5,
      }),
    ).rejects.toMatchObject({ restriction: 'team_invites' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(deliverTeamInviteEmail).not.toHaveBeenCalled();
  });
  it('does not regenerate or resend an existing invitation', async () => {
    vi.mocked(assertTrialPaidFeature).mockRejectedValueOnce(new TrialAccessError('team_invites'));
    await expect(
      resendClinicInvite({
        clinicId: 'synthetic-clinic',
        userId: 'synthetic-member',
        inviterRole: 'owner',
        invitedBy: 'synthetic-owner',
        clinicName: 'Synthetic',
        inviterNome: 'Synthetic',
        requestContext: context,
      }),
    ).rejects.toMatchObject({ restriction: 'team_invites' });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(deliverTeamInviteEmail).not.toHaveBeenCalled();
  });
});
