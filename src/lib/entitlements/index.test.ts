import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));
import { withTenant } from '@/lib/db/tenant';
import {
  getOperationalModuleAccessTx,
  assertOperationalModuleAccessTx,
  getOperationalModuleAccess,
} from './index';

const clinicId = '11111111-1111-4111-8111-111111111111';
const paid = {
  clinic_status: 'active',
  billing_status: 'active',
  plan_code: 'clinica_2026_2',
  period_start: new Date(Date.now() - 1000),
  period_end: new Date(Date.now() + 86400000),
  enrolled: true,
  verified_release: true,
  grace_until: null,
  cancel_at_period_end: false,
};
const connection = (rows: unknown) => ({
  execute: vi.fn(async (statement: SQL) => {
    const query = new PgDialect().sqlToQuery(statement);
    return query.sql.includes('to_regprocedure') ? [{ shared_gate: false }] : rows;
  }),
});
beforeEach(() => vi.clearAllMocks());
describe('authoritative module access boundary', () => {
  it.each([null, 'trial', 'subscription_cancelled', 'new_unknown_reason'])(
    'honors the shared TISS database contract for %s without trusting an unknown denial',
    async (denial) => {
      const tx = {
        execute: vi
          .fn()
          .mockResolvedValueOnce([paid])
          .mockResolvedValueOnce([{ shared_gate: true }])
          .mockResolvedValueOnce([{ denial }]),
      };
      expect((await getOperationalModuleAccessTx(tx, clinicId, 'patient_payments')).allowed).toBe(
        denial === null,
      );
      const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[2]![0]);
      expect(query.params).toEqual([clinicId, 'patient_charges']);
    },
  );
  it('does not treat an absent shared-function result as a grant', async () => {
    const tx = {
      execute: vi
        .fn()
        .mockResolvedValueOnce([paid])
        .mockResolvedValueOnce([{ shared_gate: true }])
        .mockResolvedValueOnce([]),
    };
    await expect(getOperationalModuleAccessTx(tx, clinicId, 'ai_agents')).rejects.toThrow();
  });
  it('scopes the policy, invoice and subscription to the same clinic', async () => {
    const tx = connection([paid]);
    expect(await getOperationalModuleAccessTx(tx, clinicId, 'patient_payments')).toEqual({
      allowed: true,
    });
    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[0]![0]);
    expect(query.params).toEqual([clinicId]);
    expect(query.sql).toContain('i.clinic_id=c.id AND i.subscription_id=s.id');
    expect(query.sql).toContain('i.id=ta.released_by_invoice_id');
    expect(query.sql).toContain("i.status='paid'");
  });
  it('never trusts a paid status without the enrolled invoice release', async () => {
    await expect(
      assertOperationalModuleAccessTx(
        connection([{ ...paid, verified_release: false }]),
        clinicId,
        'ai_agents',
      ),
    ).rejects.toMatchObject({ code: 'paid_module_restricted', reason: 'payment_required' });
  });
  it('rejects missing or malformed rows rather than permitting a worker', async () => {
    expect(
      (await getOperationalModuleAccessTx(connection([]), clinicId, 'ai_agents')).allowed,
    ).toBe(false);
    await expect(
      getOperationalModuleAccessTx(connection([{}]), clinicId, 'ai_agents'),
    ).rejects.toThrow();
    await expect(
      getOperationalModuleAccessTx(
        connection([{ ...paid, period_end: 'invalid' }]),
        clinicId,
        'ai_agents',
      ),
    ).rejects.toThrow();
  });
  it('validates clinic identity before any query', async () => {
    const tx = connection([]);
    await expect(getOperationalModuleAccessTx(tx, 'invalid', 'ai_agents')).rejects.toThrow();
    expect(tx.execute).not.toHaveBeenCalled();
  });
  it('propagates database failure without granting operational access', async () => {
    const tx = {
      execute: vi.fn(async (_statement: SQL) => {
        throw new Error('Synthetic database down');
      }),
    };
    await expect(getOperationalModuleAccessTx(tx, clinicId, 'ai_agents')).rejects.toThrow(
      'Synthetic database down',
    );
  });
  it('opens the existing tenant-scoped transaction for sessionless workers', async () => {
    vi.mocked(withTenant).mockResolvedValue({ allowed: false, reason: 'payment_required' });
    expect(await getOperationalModuleAccess(clinicId, 'ai_agents')).toEqual({
      allowed: false,
      reason: 'payment_required',
    });
    expect(withTenant).toHaveBeenCalledWith(clinicId, expect.any(Function));
  });
});
