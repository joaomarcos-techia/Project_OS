import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));
import {
  assertTrialPaidFeatureTx,
  loadTrialAccessTx,
  releaseTrialAfterVerifiedPaymentTx,
} from './index';

const clinic = 'bb18aaa8-8c20-4c17-bff0-a546fa9a1a1f';
function connection(results: unknown[]) {
  let index = 0;
  return { execute: vi.fn(async (_query: SQL) => results[index++]) };
}

describe('trial persisted policy', () => {
  it('preserves an existing contract without enrollment', async () => {
    const tx = connection([[]]);
    expect(await loadTrialAccessTx(tx, clinic)).toBeNull();
    expect(tx.execute).toHaveBeenCalledTimes(1);
    await expect(
      assertTrialPaidFeatureTx(connection([[]]), clinic, 'asaas'),
    ).resolves.toBeUndefined();
  });
  it('shows lifetime usage while an enrolled trial is unpaid', async () => {
    expect(
      await loadTrialAccessTx(
        connection([[{ released_at: null }], [{ metric: 'patients', consumed: 10 }]]),
        clinic,
      ),
    ).toEqual({ restricted: true, usage: { patients: 10 } });
  });
  it('removes temporary restrictions after the privileged release marker', async () => {
    const tx = connection([[{ released_at: '2026-11-08T10:00:00.000Z' }], []]);
    expect((await loadTrialAccessTx(tx, clinic))?.restricted).toBe(false);
    await expect(
      assertTrialPaidFeatureTx(connection([[{ released_at: new Date() }]]), clinic, 'whatsapp'),
    ).resolves.toBeUndefined();
  });
  for (const feature of ['whatsapp', 'asaas', 'team_invites'] as const) {
    it(`blocks ${feature} on the server`, async () => {
      await expect(
        assertTrialPaidFeatureTx(connection([[{ released_at: null }]]), clinic, feature),
      ).rejects.toMatchObject({ code: 'trial_access_restricted', restriction: feature });
    });
  }
  it('fails closed on malformed policy or unknown metric', async () => {
    await expect(loadTrialAccessTx(connection([[{}]]), clinic)).rejects.toThrow();
    await expect(
      loadTrialAccessTx(
        connection([[{ released_at: null }], [{ metric: 'unknown', consumed: 1 }]]),
        clinic,
      ),
    ).rejects.toThrow();
    await expect(
      assertTrialPaidFeatureTx(connection([undefined]), clinic, 'asaas'),
    ).rejects.toThrow();
  });
  it('scopes release to the same positive, paid subscription invoice', async () => {
    const tx = connection([[]]);
    const invoice = '14c92bc2-fc8a-40c5-a97c-1a5bf96d42eb';
    await releaseTrialAfterVerifiedPaymentTx(tx, clinic, invoice);
    const query = new PgDialect().sqlToQuery(tx.execute.mock.calls[0]![0]);
    expect(query.params).toEqual([clinic, invoice]);
    expect(query.sql).toContain('invoice.subscription_id = policy.subscription_id');
    expect(query.sql).toContain("invoice.status = 'paid'");
    expect(query.sql).toContain('invoice.total_amount > 0');
    expect(query.sql).toContain('policy.released_at IS NULL');
  });
});
