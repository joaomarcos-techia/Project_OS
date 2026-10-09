/**
 * EC-32 + ADR-064 — leitura e fechamento do job cuja geração a Meta recusou.
 *
 * O job é achado pela chave da geração ATUAL (id com `send_key` NULL na geração
 * 0, `send_key` depois), travado, e fechado ou reagendado com chave nova num
 * UPDATE que confere o status e o lease lidos. Toda leitura e escrita carrega o
 * predicado da clínica do evento — nunca toca job de outro tenant.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: vi.fn() }));

import { lockJobBySendKeyTx, settleRefusedJobTx, type RefusedJob } from './repository';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';
const KEY = '55555555-5555-4555-8555-555555555555';

function fakeTx(rows: unknown[]) {
  const seen: {
    fields?: Record<string, unknown>;
    selectWhere?: SQL;
    lock?: unknown;
    set?: unknown;
    updateWhere?: SQL;
  } = {};
  const select = Object.assign(Promise.resolve(rows), {
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
  const tx = {
    select: vi.fn((fields: Record<string, unknown>) => {
      seen.fields = fields;
      return select;
    }),
    update: vi.fn(() => update),
  };
  return { tx: tx as unknown as Tx, seen };
}

const compile = (clause: SQL | undefined) => {
  if (!clause) throw new Error('predicado não capturado');
  return new PgDialect().sqlToQuery(clause);
};

const refused = (over: Partial<RefusedJob> = {}): RefusedJob => ({
  id: JOB,
  type: 'deposit_link',
  status: 'sent',
  payload: {},
  attempts: 1,
  leaseToken: null,
  leaseExpired: false,
  createdAt: new Date('2026-10-08T11:00:00.000Z'),
  ...over,
});

describe('lockJobBySendKeyTx', () => {
  it('finds the job by the CURRENT key only: id with no send_key, or the send_key itself', async () => {
    const { tx, seen } = fakeTx([refused()]);

    await expect(lockJobBySendKeyTx(tx, CLINIC, KEY)).resolves.toEqual(refused());

    const where = compile(seen.selectWhere);
    expect(where.sql).toBe(
      '("ai_proactive_jobs"."clinic_id" = $1 and (("ai_proactive_jobs"."id" = $2 and "ai_proactive_jobs"."send_key" is null) or "ai_proactive_jobs"."send_key" = $3))',
    );
    expect(where.params).toEqual([CLINIC, KEY, KEY]);
    expect(seen.lock).toBe('update');
  });

  it('reads whether a processing lease already expired, with the claimDue clock (now())', async () => {
    const { tx, seen } = fakeTx([refused()]);

    await lockJobBySendKeyTx(tx, CLINIC, KEY);

    expect(Object.keys(seen.fields ?? {})).toEqual([
      'id',
      'type',
      'status',
      'payload',
      'attempts',
      'leaseToken',
      'leaseExpired',
      // ADR-065: base do prazo do `remainder_link` no handler.
      'createdAt',
    ]);
    expect(compile(seen.fields?.leaseExpired as SQL).sql).toBe(
      'coalesce("ai_proactive_jobs"."lease_expires_at" <= now(), false)',
    );
  });

  it('a key with no current job (replaced generation, AI or manual reply) returns null', async () => {
    const { tx } = fakeTx([]);

    await expect(lockJobBySendKeyTx(tx, CLINIC, KEY)).resolves.toBeNull();
  });
});

describe('settleRefusedJobTx', () => {
  it('failed: records the Meta reason and clears any lease, guarded by id, clinic, status and lease', async () => {
    const { tx, seen } = fakeTx([]);

    await settleRefusedJobTx(tx, CLINIC, refused(), { status: 'failed', reason: 'meta_131042' });

    expect(seen.set).toEqual({
      status: 'failed',
      failedReason: 'meta_131042',
      processingStartedAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
    });
    const where = compile(seen.updateWhere);
    expect(where.sql).toBe(
      '("ai_proactive_jobs"."id" = $1 and "ai_proactive_jobs"."clinic_id" = $2 and "ai_proactive_jobs"."status" = $3 and "ai_proactive_jobs"."lease_token" is null)',
    );
    expect(where.params).toEqual([JOB, CLINIC, 'sent']);
  });

  it('pending: reschedules with the NEW key in the same UPDATE', async () => {
    const { tx, seen } = fakeTx([]);
    const nextAt = new Date('2026-10-08T15:00:00.000Z');

    await settleRefusedJobTx(tx, CLINIC, refused(), {
      status: 'pending',
      reason: 'meta_131000',
      nextAt,
      sendKey: KEY,
    });

    expect(seen.set).toEqual({
      status: 'pending',
      failedReason: 'meta_131000',
      scheduledFor: nextAt,
      sendKey: KEY,
      processingStartedAt: null,
      leaseExpiresAt: null,
      leaseToken: null,
    });
  });

  it('taking over a dead processing attempt checks the lease token it read', async () => {
    const { tx, seen } = fakeTx([]);

    await settleRefusedJobTx(
      tx,
      CLINIC,
      refused({ status: 'processing', leaseToken: 'lease-1', leaseExpired: true }),
      { status: 'failed', reason: 'meta_131026' },
    );

    const where = compile(seen.updateWhere);
    expect(where.sql).toContain('"ai_proactive_jobs"."lease_token" = $4');
    expect(where.params).toEqual([JOB, CLINIC, 'processing', 'lease-1']);
  });
});
