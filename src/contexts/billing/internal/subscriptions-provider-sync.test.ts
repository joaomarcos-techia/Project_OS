import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

const { emit } = vi.hoisted(() => ({ emit: vi.fn() }));

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit } }));

import type { InvoiceRow } from '../schema';
import { syncInvoiceFromProviderPayment } from './subscriptions';

const CLINIC_ID = '00000000-0000-4000-8000-000000000001';

function invoice(overrides: Partial<InvoiceRow> = {}): InvoiceRow {
  return {
    id: '00000000-0000-4000-8000-000000000002',
    clinicId: CLINIC_ID,
    subscriptionId: '00000000-0000-4000-8000-000000000003',
    periodStart: null,
    periodEnd: null,
    totalAmount: '199.00',
    status: 'cancelled',
    dueDate: '2026-08-24',
    paidAt: null,
    asaasPaymentId: 'pay_restore_1',
    nfeUrl: null,
    paymentMethod: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function syncTx(restored: InvoiceRow | null) {
  const updates: Array<Record<string, unknown>> = [];
  const timeline: Array<Record<string, unknown>> = [];
  const tx = {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updates.push(values);
        return {
          where: () => ({ returning: async () => (restored ? [restored] : []) }),
        };
      },
    }),
    insert: () => ({
      values: async (values: Record<string, unknown>) => {
        timeline.push(values);
      },
    }),
  } as unknown as Tx;
  return { tx, updates, timeline };
}

beforeEach(() => {
  emit.mockClear();
});

describe('syncInvoiceFromProviderPayment — restauração autoritativa', () => {
  it('reabre por CAS, sincroniza campos e grava timeline observável', async () => {
    const restored = invoice({
      status: 'open',
      dueDate: '2026-09-05',
      totalAmount: '249.00',
    });
    const { tx, updates, timeline } = syncTx(restored);

    const result = await syncInvoiceFromProviderPayment(
      tx,
      CLINIC_ID,
      invoice(),
      {
        exists: true,
        status: 'open',
        dueDate: '2026-09-05',
        totalCents: 24_900,
      },
      { idemSuffix: 'evt_restore_1' },
    );

    expect(result.action).toEqual({
      kind: 'restore',
      status: 'open',
      dueDate: '2026-09-05',
      totalCents: 24_900,
      amountChanged: true,
    });
    expect(result.invoice).toBe(restored);
    expect(updates).toEqual([{ status: 'open', dueDate: '2026-09-05', totalAmount: '249.00' }]);
    expect(timeline).toContainEqual(
      expect.objectContaining({
        clinicId: CLINIC_ID,
        type: 'invoice.restored',
        payload: expect.objectContaining({ reason: 'provider_restored' }),
      }),
    );
    expect(emit).toHaveBeenCalledWith('billing.invoice.restored', {
      clinicId: CLINIC_ID,
      invoiceId: restored.id,
    });
    expect(emit).toHaveBeenCalledWith('billing.invoice.amount_changed', {
      clinicId: CLINIC_ID,
      invoiceId: restored.id,
    });
  });

  it('CAS perdido não grava restauração nem timeline duplicada', async () => {
    const { tx, timeline } = syncTx(null);

    const result = await syncInvoiceFromProviderPayment(
      tx,
      CLINIC_ID,
      invoice(),
      { exists: true, status: 'open', dueDate: '2026-08-24', totalCents: 19_900 },
      { idemSuffix: 'evt_restore_race' },
    );

    expect(result.action).toEqual({ kind: 'noop', reason: 'lost_cas' });
    expect(timeline).toHaveLength(0);
    expect(emit).not.toHaveBeenCalledWith('billing.invoice.restored', expect.anything());
  });

  it('replay sobre invoice já aberta não escreve novamente', async () => {
    const alreadyOpen = invoice({ status: 'open' });
    const { tx, updates, timeline } = syncTx(alreadyOpen);

    const result = await syncInvoiceFromProviderPayment(
      tx,
      CLINIC_ID,
      alreadyOpen,
      { exists: true, status: 'open', dueDate: '2026-08-24', totalCents: 19_900 },
      { idemSuffix: 'evt_restore_replay' },
    );

    expect(result.action).toEqual({ kind: 'noop', reason: 'in_sync' });
    expect(updates).toHaveLength(0);
    expect(timeline).toHaveLength(0);
  });
});
