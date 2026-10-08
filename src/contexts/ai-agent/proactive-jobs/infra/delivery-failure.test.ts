/**
 * EC-32 — máquina de estados da recusa pós-aceite (`markDeliveryFailedTx`).
 *
 * Só `sent` e `pending` viram `failed`; `processing` pede retry (o processor
 * ainda segura o lease); terminais não mudam. Toda leitura e escrita carrega o
 * predicado da clínica do evento — nunca toca job de outro tenant.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));

import { markDeliveryFailedTx } from './repository';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';

function fakeTx(job: { type: string; status: string } | null) {
  const seen: { selectWhere?: SQL; lock?: unknown; set?: unknown; updateWhere?: SQL } = {};
  const select = Object.assign(Promise.resolve(job ? [job] : []), {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
  });
  select.from.mockReturnValue(select);
  select.where.mockImplementation((clause: SQL) => {
    seen.selectWhere = clause;
    return select;
  });
  select.limit.mockReturnValue(select);
  select.for.mockImplementation((strength: unknown) => {
    seen.lock = strength;
    return select;
  });
  const update = { set: vi.fn(), where: vi.fn() };
  update.set.mockImplementation((patch: unknown) => {
    seen.set = patch;
    return update;
  });
  update.where.mockImplementation(async (clause: SQL) => {
    seen.updateWhere = clause;
  });
  const tx = { select: vi.fn(() => select), update: vi.fn(() => update) };
  return { tx: tx as unknown as Tx, seen, updateCalls: tx.update };
}

const compile = (clause: SQL | undefined) => {
  if (!clause) throw new Error('predicado não capturado');
  return new PgDialect().sqlToQuery(clause);
};

describe('markDeliveryFailedTx', () => {
  it('sent → failed with the Meta reason, guarded by id, clinic and the status it read', async () => {
    const { tx, seen } = fakeTx({ type: 'deposit_link', status: 'sent' });

    await expect(markDeliveryFailedTx(tx, CLINIC, JOB, 'meta_131042')).resolves.toEqual({
      kind: 'failed',
      type: 'deposit_link',
      previousStatus: 'sent',
    });

    expect(seen.set).toEqual({ status: 'failed', failedReason: 'meta_131042' });
    const where = compile(seen.updateWhere);
    expect(where.sql).toContain('"ai_proactive_jobs"."id" = $1');
    expect(where.sql).toContain('"ai_proactive_jobs"."clinic_id" = $2');
    expect(where.sql).toContain('"ai_proactive_jobs"."status" = $3');
    expect(where.params).toEqual([JOB, CLINIC, 'sent']);
  });

  it('reads the job locked, by id AND clinic', async () => {
    const { tx, seen } = fakeTx({ type: 'reminder', status: 'sent' });

    await markDeliveryFailedTx(tx, CLINIC, JOB, 'meta_131026');

    expect(seen.lock).toBe('update');
    const where = compile(seen.selectWhere);
    expect(where.sql).toContain('"ai_proactive_jobs"."id" = $1');
    expect(where.sql).toContain('"ai_proactive_jobs"."clinic_id" = $2');
    expect(where.params).toEqual([JOB, CLINIC]);
  });

  it('pending → failed: a retry would only find the same failed send again', async () => {
    const { tx, seen } = fakeTx({ type: 'deposit_link', status: 'pending' });

    await expect(markDeliveryFailedTx(tx, CLINIC, JOB, 'meta_131042')).resolves.toEqual({
      kind: 'failed',
      type: 'deposit_link',
      previousStatus: 'pending',
    });
    expect(compile(seen.updateWhere).params).toEqual([JOB, CLINIC, 'pending']);
  });

  it('processing → in_flight, without writing: the processor still holds the lease', async () => {
    const { tx, updateCalls } = fakeTx({ type: 'deposit_link', status: 'processing' });

    await expect(markDeliveryFailedTx(tx, CLINIC, JOB, 'meta_131042')).resolves.toEqual({
      kind: 'in_flight',
      type: 'deposit_link',
    });
    expect(updateCalls).not.toHaveBeenCalled();
  });

  it('terminal jobs stay as they are (event redelivery is a no-op)', async () => {
    for (const status of ['failed', 'cancelled']) {
      const { tx, updateCalls } = fakeTx({ type: 'deposit_link', status });

      await expect(markDeliveryFailedTx(tx, CLINIC, JOB, 'meta_131042')).resolves.toEqual({
        kind: 'unchanged',
        type: 'deposit_link',
        status,
      });
      expect(updateCalls).not.toHaveBeenCalled();
    }
  });

  it('a send that is not a job of this clinic changes nothing', async () => {
    const { tx, updateCalls } = fakeTx(null);

    await expect(markDeliveryFailedTx(tx, CLINIC, JOB, 'meta_131042')).resolves.toEqual({
      kind: 'not_found',
    });
    expect(updateCalls).not.toHaveBeenCalled();
  });
});
