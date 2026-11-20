import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ guard: vi.fn(), audit: vi.fn(), issue: vi.fn() }));
vi.mock('../_lib/guard', () => ({ guardAdminAccess: m.guard }));
vi.mock('next/headers', () => ({ headers: vi.fn().mockResolvedValue(new Headers()) }));
vi.mock('@/lib/audit/request-context', () => ({ buildRequestContext: () => ({}) }));
vi.mock('@/lib/audit/super-admin', () => ({ superAdminAction: m.audit }));
vi.mock('@/lib/auth/tenant-context', () => ({
  requireUser: vi.fn().mockResolvedValue({ userId: '11111111-1111-4111-8111-111111111111' }),
}));
vi.mock('@/lib/auth/email-hash', () => ({ hashEmail: () => 'hashed-email' }));
vi.mock('@/contexts/onboarding', async () => {
  const { pilotIdentitySchema, PilotSignupError } =
    await import('@/contexts/onboarding/internal/signup-pilot-repository');
  return {
    pilotIdentitySchema,
    PilotSignupError,
    issuePilotInviteTx: m.issue,
    generateInviteToken: () => ({ rawToken: 'a'.repeat(64), tokenHash: 'b'.repeat(64) }),
  };
});
vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
import { createSaasPilotInviteAction } from './saas-pilot';
function form() {
  const f = new FormData();
  f.set('ownerName', 'Synthetic owner');
  f.set('clinicName', 'Synthetic pilot');
  f.set('email', 'owner@example.test');
  return f;
}
beforeEach(() => {
  vi.clearAllMocks();
  m.audit.mockResolvedValue({ created: true, id: 'synthetic-id' });
});
describe('pilot invitation administrative authority', () => {
  it('requires the existing superadmin MFA boundary before any mutation', async () => {
    m.guard.mockRejectedValueOnce(new Error('denied'));
    await expect(createSaasPilotInviteAction({ error: null }, form())).rejects.toThrow('denied');
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('issues only a fragment link and audits without the token or clear email', async () => {
    const r = await createSaasPilotInviteAction({ error: null }, form());
    expect(r.link).toBe('/cadastro/piloto#invite=' + 'a'.repeat(64));
    expect(m.audit.mock.calls[0]?.[0]).toMatchObject({
      action: 'saas_pilot_invite_prepared',
      payload: { emailHash: 'hashed-email', planCode: 'consultorio_2026' },
    });
    expect(JSON.stringify(m.audit.mock.calls[0]?.[0])).not.toContain('owner@example.test');
    expect(JSON.stringify(m.audit.mock.calls[0]?.[0])).not.toContain('a'.repeat(64));
  });
  it('does not fabricate a second link when the same invitation already exists', async () => {
    m.audit.mockResolvedValue({ created: false, id: 'existing' });
    expect(await createSaasPilotInviteAction({ error: null }, form())).toEqual({
      error: null,
      existing: true,
    });
  });
  it('returns the rotated link after a lost response only for an unclaimed reservation', async () => {
    m.audit.mockResolvedValue({ created: false, reissued: true, id: 'existing' });
    expect((await createSaasPilotInviteAction({ error: null }, form())).link).toBe(
      '/cadastro/piloto#invite=' + 'a'.repeat(64),
    );
  });
  it('rejects invalid identity without entering the audit transaction', async () => {
    const f = form();
    f.set('email', 'bad');
    expect((await createSaasPilotInviteAction({ error: null }, f)).error).not.toBeNull();
    expect(m.audit).not.toHaveBeenCalled();
  });
});
