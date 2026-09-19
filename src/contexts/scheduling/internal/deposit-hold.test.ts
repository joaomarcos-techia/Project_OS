/**
 * Hold do sinal na agenda (ADR-049 1.3).
 *
 * As duas garantias que este arquivo protege:
 *   1. **a máquina de estados não é burlada** — expirar um hold cancela via
 *      `applyTransition`, com tudo que ela faz (lock, assert, state log, evento,
 *      oferta da vaga). Nunca um `UPDATE status` por fora;
 *   2. **segurar vaga não retrocede estado** — o `WHERE` do hold exige `agendado`
 *      e `deposit_status = 'none'`, então reentrega do worker ou evento atrasado
 *      não mexem em agendamento que já andou.
 */
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  withTenant: vi.fn(),
  applyTransition: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db', () => ({ dbAdmin: { execute: mocks.execute } }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.withTenant }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('./appointment-core', () => ({ applyTransition: mocks.applyTransition }));

import { metrics } from '@/lib/observability/metrics';

import { applyDepositHold, expireDepositHolds } from './deposit-hold';

const dialect = new PgDialect();

/** tx falso que compila a SQL de UPDATE do Drizzle para texto. */
function makeTx(updated: unknown[] = [{ id: 'apt-1' }]) {
  const sqls: string[] = [];
  const chain = {
    set: () => chain,
    where: (w: SQL) => {
      sqls.push(dialect.sqlToQuery(w).sql);
      return chain;
    },
    returning: async () => updated,
    then: undefined,
  };
  return { tx: { update: () => chain } as never, sqls };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withTenant.mockImplementation((async (_c: string, fn: (tx: unknown) => unknown) =>
    fn({ update: () => ({ set: () => ({ where: async () => undefined }) }) })) as never);
  mocks.applyTransition.mockResolvedValue({ id: 'apt-1' });
});

describe('applyDepositHold', () => {
  it('só segura vaga de agendamento `agendado` e ainda sem hold', async () => {
    const { tx, sqls } = makeTx();

    await expect(
      applyDepositHold(tx, {
        clinicId: 'clinic-1',
        appointmentId: 'apt-1',
        holdExpiresAt: new Date('2026-09-10T14:00:00.000Z'),
      }),
    ).resolves.toBe(true);

    const where = sqls[0] ?? '';
    expect(where).toContain('"status"');
    expect(where).toContain('"deposit_status"');
    expect(where).toContain('"clinic_id"');
  });

  it('agendamento que já andou não é afetado (nenhuma linha casa)', async () => {
    const { tx } = makeTx([]);

    await expect(
      applyDepositHold(tx, {
        clinicId: 'clinic-1',
        appointmentId: 'apt-1',
        holdExpiresAt: new Date(),
      }),
    ).resolves.toBe(false);
  });
});

describe('expireDepositHolds', () => {
  beforeEach(() => {
    mocks.execute.mockResolvedValue([{ clinic_id: 'clinic-1', appointment_id: 'apt-1' }]);
  });

  it('cancela pela máquina de estados congelada, não por UPDATE direto', async () => {
    await expect(expireDepositHolds()).resolves.toEqual({
      scanned: 1,
      cancelled: 1,
      failed: 0,
    });

    expect(mocks.applyTransition).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        target: 'cancelado',
        actorType: 'system',
        cancelReason: 'deposit_expired',
        clientKey: 'deposit-expired:apt-1',
      }),
    );
  });

  it('usa motivo PRÓPRIO de cancelamento — não finge que alguém cancelou', async () => {
    await expireDepositHolds();

    const [, opts] = mocks.applyTransition.mock.calls[0]!;
    expect((opts as { cancelReason: string }).cancelReason).not.toBe('user');
  });

  it('roda o cancelamento no escopo do tenant', async () => {
    await expireDepositHolds();
    expect(mocks.withTenant).toHaveBeenCalledWith('clinic-1', expect.any(Function));
  });

  it('varre só hold pendente, vencido e ainda agendado', async () => {
    await expireDepositHolds();

    const query = dialect.sqlToQuery(mocks.execute.mock.calls[0]![0] as SQL).sql;
    expect(query).toContain("deposit_status = 'pending'");
    expect(query).toContain("status = 'agendado'");
    expect(query).toContain('hold_expires_at < now()');
  });

  it('um agendamento que falha não interrompe a varredura', async () => {
    mocks.execute.mockResolvedValue([
      { clinic_id: 'clinic-1', appointment_id: 'apt-1' },
      { clinic_id: 'clinic-2', appointment_id: 'apt-2' },
    ]);
    mocks.applyTransition.mockRejectedValueOnce(new Error('lock timeout'));

    await expect(expireDepositHolds()).resolves.toEqual({
      scanned: 2,
      cancelled: 1,
      failed: 1,
    });
    expect(metrics.emit).toHaveBeenCalledWith(
      'scheduling.deposit_hold.expire_error',
      expect.objectContaining({ appointmentId: 'apt-1' }),
    );
  });

  it('nada vencido: não abre transação nenhuma', async () => {
    mocks.execute.mockResolvedValue([]);

    await expect(expireDepositHolds()).resolves.toEqual({
      scanned: 0,
      cancelled: 0,
      failed: 0,
    });
    expect(mocks.withTenant).not.toHaveBeenCalled();
  });
});
