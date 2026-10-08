/**
 * EC-32 — `getOutboundIdempotencyKey` é o elo envio → job: o evento de status
 * traz o id do envio, e a chave que o remetente passou ao `sendText` é o id do
 * job da C14. A leitura precisa ser da clínica do evento, e só dela.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

vi.mock('./internal/sender', () => ({ sendOutbound: vi.fn() }));

import { messagingApiV1 } from './api';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const OUTBOUND = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';

function fakeTx(rows: unknown[]) {
  let where: SQL | null = null;
  const query = Object.assign(Promise.resolve(rows), {
    from: vi.fn(),
    where: vi.fn(),
    limit: vi.fn(),
  });
  query.from.mockReturnValue(query);
  query.where.mockImplementation((clause: SQL) => {
    where = clause;
    return query;
  });
  query.limit.mockReturnValue(query);
  return {
    tx: { select: vi.fn().mockReturnValue(query) } as unknown as Tx,
    compiledWhere: () => {
      if (!where) throw new Error('predicado não capturado');
      return new PgDialect().sqlToQuery(where);
    },
  };
}

describe('messagingApiV1.getOutboundIdempotencyKey', () => {
  it('returns the key the sender stored for that send, filtered by id AND clinic', async () => {
    const { tx, compiledWhere } = fakeTx([{ key: JOB }]);

    await expect(messagingApiV1.getOutboundIdempotencyKey(tx, CLINIC, OUTBOUND)).resolves.toBe(JOB);

    const compiled = compiledWhere();
    expect(compiled.sql).toContain('"outbound_messages"."id" = $1');
    expect(compiled.sql).toContain('"outbound_messages"."clinic_id" = $2');
    expect(compiled.params).toEqual([OUTBOUND, CLINIC]);
  });

  it('returns null when the send does not exist in this clinic', async () => {
    const { tx } = fakeTx([]);

    await expect(
      messagingApiV1.getOutboundIdempotencyKey(tx, CLINIC, OUTBOUND),
    ).resolves.toBeNull();
  });
});
