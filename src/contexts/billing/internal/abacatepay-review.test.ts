import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ runtime: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/payments/saas/acquisition', () => ({ isAbacatePaySandboxRuntime: m.runtime }));
vi.mock('@/lib/env', () => ({ env: { ABACATEPAY_STORE_ID: 'store_synthetic' } }));
import { abacatePayReplayInput, listAbacatePayReviews } from './abacatepay-review';
beforeEach(() => {
  vi.resetAllMocks();
  m.runtime.mockReturnValue(true);
  m.execute.mockResolvedValue([]);
});
describe('bounded administrative review input', () => {
  const valid = {
    accountId: '11111111-1111-4111-8111-111111111111',
    clinicId: '11111111-1111-4111-8111-111111111111',
    eventId: 'log_synthetic',
    snapshot: 'a'.repeat(64),
    reason: 'provider_recovered',
    evidenceReference: 'INC-20261110-001',
  };
  it('does not query a database in a production/disabled runtime', async () => {
    m.runtime.mockReturnValue(false);
    expect(await listAbacatePayReviews({ execute: m.execute })).toEqual([]);
    expect(m.execute).not.toHaveBeenCalled();
  });
  it.each(['amount', 'paymentId', 'periodEnd', 'requestedBy'])(
    'rejects caller-provided %s',
    (field) => {
      expect(abacatePayReplayInput.safeParse({ ...valid, [field]: 'untrusted' }).success).toBe(
        false,
      );
    },
  );
  it.each(['https://example.invalid/receipt', 'patient@example.invalid', 'raw invoice details'])(
    'rejects unstructured or sensitive evidence reference %s',
    (evidenceReference) => {
      expect(abacatePayReplayInput.safeParse({ ...valid, evidenceReference }).success).toBe(false);
    },
  );
});
