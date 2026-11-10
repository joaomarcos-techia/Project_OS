import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ReviewModule from '@/contexts/billing/internal/abacatepay-review';

const m = vi.hoisted(() => ({
  guard: vi.fn(),
  client: vi.fn(),
  factors: vi.fn(),
  verify: vi.fn(),
  user: vi.fn(),
  audit: vi.fn(),
  authorize: vi.fn(),
  worker: vi.fn(),
  capture: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock('../_lib/guard', () => ({ guardAdminAccess: m.guard }));
vi.mock('@/lib/auth/supabase-server', () => ({ createServerClient: m.client }));
vi.mock('@/lib/auth/mfa', () => ({ listFactors: m.factors, challengeAndVerify: m.verify }));
vi.mock('@/lib/auth/tenant-context', () => ({ requireUser: m.user }));
vi.mock('@/lib/audit/super-admin', () => ({ superAdminAction: m.audit }));
vi.mock('@/lib/audit/request-context', () => ({
  buildRequestContext: () => ({ requestId: 'synthetic' }),
}));
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/observability/capture', () => ({ captureBackgroundError: m.capture }));
vi.mock('@/contexts/billing/internal/abacatepay-processing', () => ({
  reconcileAbacatePayInbox: m.worker,
}));
vi.mock('@/contexts/billing/internal/abacatepay-review', async (importOriginal) => ({
  ...(await importOriginal<typeof ReviewModule>()),
  authorizeAbacatePayReplayTx: m.authorize,
}));
import { replayAbacatePayReviewAction as replay } from './abacatepay-review';
import { AbacatePayReviewError } from '@/contexts/billing/internal/abacatepay-review';

const actor = '11111111-1111-4111-8111-111111111111';
function form() {
  const input = new FormData();
  Object.entries({
    accountId: actor,
    eventId: 'log_synthetic',
    clinicId: actor,
    snapshot: 'a'.repeat(64),
    reason: 'provider_recovered',
    evidenceReference: 'INC-20261110-001',
    code: '123456',
  }).forEach(([key, value]) => input.set(key, value));
  return input;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.client.mockResolvedValue({});
  m.factors.mockResolvedValue([{ id: 'factor_synthetic', status: 'verified' }]);
  m.user.mockResolvedValue({ userId: actor });
  m.audit.mockImplementation(async (_opts: unknown, fn: (tx: object) => Promise<unknown>) =>
    fn({}),
  );
  m.authorize.mockResolvedValue({ approvalId: actor, state: 'queued' });
  m.worker.mockResolvedValue({ scanned: 1, review: 1, applied: 0 });
});
describe('financial review authorization boundary', () => {
  it('denies before MFA, parsing effects or audit when platform guard rejects', async () => {
    m.guard.mockRejectedValue(new Error('denied'));
    await expect(replay({ error: null }, form())).rejects.toThrow('denied');
    expect(m.client).not.toHaveBeenCalled();
    expect(m.audit).not.toHaveBeenCalled();
    expect(m.worker).not.toHaveBeenCalled();
  });
  it.each(['accountId', 'clinicId', 'snapshot', 'reason', 'evidenceReference', 'code'])(
    'rejects invalid %s without authorization or provider access',
    async (field) => {
      const input = form();
      input.set(field, 'invalid');
      expect((await replay({ error: null }, input)).error).toBeTruthy();
      expect(m.verify).not.toHaveBeenCalled();
      expect(m.audit).not.toHaveBeenCalled();
      expect(m.worker).not.toHaveBeenCalled();
    },
  );
  it('requires a verified factor even for an existing AAL2 session', async () => {
    m.factors.mockResolvedValue([]);
    expect((await replay({ error: null }, form())).error).toBeTruthy();
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('does not expose raw MFA errors or mutate after rejected fresh TOTP', async () => {
    m.verify.mockRejectedValue(new Error('synthetic-sensitive-upstream-value'));
    const result = await replay({ error: null }, form());
    expect(result.error).not.toContain('synthetic-sensitive');
    expect(m.audit).not.toHaveBeenCalled();
  });
  it('uses the server actor and atomic audit; no OTP or arbitrary financial values in audit', async () => {
    const input = form();
    input.set('requestedBy', 'spoofed');
    input.set('amount', '1');
    await replay({ error: null }, input);
    expect(m.verify).toHaveBeenCalledWith({}, 'factor_synthetic', '123456');
    expect(m.authorize).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ eventId: 'log_synthetic' }),
      actor,
    );
    expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(/123456|spoofed|"amount"/);
    expect(m.audit.mock.invocationCallOrder[0]).toBeGreaterThan(
      m.verify.mock.invocationCallOrder[0]!,
    );
    expect(m.worker.mock.invocationCallOrder[0]).toBeGreaterThan(
      m.audit.mock.invocationCallOrder[0]!,
    );
  });
  it('does not run a worker when audit/authorization fails', async () => {
    m.audit.mockRejectedValue(new Error('synthetic DB rollback'));
    expect((await replay({ error: null }, form())).error).toBeTruthy();
    expect(m.worker).not.toHaveBeenCalled();
  });
  it.each(['snapshot_changed', 'replay_limit'] as const)('reports %s safely', async (code) => {
    m.authorize.mockRejectedValue(new AbacatePayReviewError(code));
    expect((await replay({ error: null }, form())).error).toBeTruthy();
    expect(m.worker).not.toHaveBeenCalled();
  });
  it('retains a durable queued authorization when the immediate worker fails', async () => {
    m.worker.mockRejectedValue(new Error('synthetic I/O failure'));
    const result = await replay({ error: null }, form());
    expect(result.error).toBeNull();
    expect(result.message).toContain('enfileirada');
    expect(m.capture).toHaveBeenCalledOnce();
  });
  it('does not call review completion a manual grant of paid access', async () => {
    const result = await replay({ error: null }, form());
    expect(result.message).toContain('continua em revisão');
    expect(m.revalidate).toHaveBeenCalledWith('/admin/billing/operacao');
  });
});
