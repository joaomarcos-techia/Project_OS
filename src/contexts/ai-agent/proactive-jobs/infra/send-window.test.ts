/**
 * ADR-066 — a janela de resposta da oferta da lista de espera corre só nas horas
 * em que a C14 envia (`claimDue`). Se uma mudar sem a outra, a oferta volta a
 * vencer em horas em que o convite não pode sair.
 */
import { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db', () => ({ dbAdmin: {} }));
vi.mock('@/lib/db/tenant', () => ({ withTenant }));

/* eslint-disable-next-line boundaries/element-types -- só o teste lê a política do Scheduling, para prender a janela da oferta à de envio. */
import { WAITLIST_OFFER_SEND_HOURS } from '@/contexts/scheduling/waitlist-policy';

import { deferUntilSendWindow, SEND_WINDOW_END_HOUR, SEND_WINDOW_START_HOUR } from './repository';
import { nextSendWindowStart } from './send-window';

describe('janela de envio da C14', () => {
  it('é a mesma em que corre a janela de resposta da oferta da lista de espera', () => {
    expect({ start: SEND_WINDOW_START_HOUR, end: SEND_WINDOW_END_HOUR }).toEqual(
      WAITLIST_OFFER_SEND_HOURS,
    );
  });

  it('usa o fuso da clínica também fora de São Paulo', () => {
    expect(nextSendWindowStart('America/Manaus', new Date('2026-10-10T00:00:00.000Z'))).toEqual(
      new Date('2026-10-10T12:00:00.000Z'),
    );
    expect(nextSendWindowStart('America/Manaus', new Date('2026-10-09T12:00:00.000Z'))).toBeNull();
  });

  it('devolve o job à fila para 08h sem gastar tentativa nem trocar chave', async () => {
    const update = { set: vi.fn(), where: vi.fn().mockResolvedValue([]) };
    update.set.mockReturnValue(update);
    const tx = { update: vi.fn().mockReturnValue(update) };
    withTenant.mockImplementation((_clinicId: string, fn: (value: unknown) => unknown) => fn(tx));
    const next = new Date('2026-10-10T11:00:00.000Z');

    await deferUntilSendWindow('clinic-1', 'job-1', 'lease-1', next);

    expect(withTenant).toHaveBeenCalledWith('clinic-1', expect.any(Function));
    const patch = update.set.mock.calls[0]?.[0];
    expect(patch).toMatchObject({ status: 'pending', scheduledFor: next, leaseToken: null });
    expect(patch.sendKey).toBeUndefined();
    if (!(patch.attempts instanceof SQL)) throw new Error('decremento SQL ausente');
    expect(new PgDialect().sqlToQuery(patch.attempts).sql).toBe(
      '"ai_proactive_jobs"."attempts" - 1',
    );
    const predicate = update.where.mock.calls[0]?.[0];
    if (!(predicate instanceof SQL)) throw new Error('predicado do lease ausente');
    const where = new PgDialect().sqlToQuery(predicate);
    expect(where.sql).toContain('"ai_proactive_jobs"."lease_token" =');
    expect(where.params).toContain('lease-1');
  });
});
