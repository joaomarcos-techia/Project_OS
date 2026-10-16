import { describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

import { assertCommercialPriceInput, insertScheduledAppointment } from './appointment-core';

const clinicId = '11111111-1111-4111-8111-111111111111';
const procedureId = '22222222-2222-4222-8222-222222222222';
const doctorId = '33333333-3333-4333-8333-333333333333';
const priceId = '44444444-4444-4444-8444-444444444444';

describe('retirada do preço por meio de pagamento', () => {
  it('recusa preço por método na entrada interna antes de consultar ou gravar', async () => {
    const tx = { select: vi.fn(), insert: vi.fn(), execute: vi.fn() } as unknown as Tx;
    await expect(
      insertScheduledAppointment(tx, {
        clinicId,
        userId: 'user-test',
        actorType: 'user',
        correlationId: null,
        idempotencyKey: 'idem-test',
        scheduledAt: new Date('2026-10-17T10:00:00Z'),
        data: {
          doctorId,
          procedureId,
          scheduledAt: '2026-10-17T10:00:00Z',
          pricingPolicyMode: 'payment_method_pricing',
          commercialPaymentMethod: 'pix',
          commercialPriceId: priceId,
        },
      }),
    ).rejects.toThrow('não está mais disponível');
    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it.each([
    { commercialPaymentMethod: 'pix' as const },
    { commercialInstallmentCount: 1 },
    { commercialPriceId: priceId },
  ])('recusa metadados comerciais avulsos', async (fields) => {
    const tx = { select: vi.fn(), insert: vi.fn(), execute: vi.fn() } as unknown as Tx;
    await expect(
      assertCommercialPriceInput(tx, clinicId, { doctorId, procedureId, ...fields }),
    ).rejects.toThrow('não está mais disponível');
    expect(tx.select).not.toHaveBeenCalled();
  });

  it('mantém o preço padrão sem exigir escolha de meio de pagamento', async () => {
    const tx = { select: vi.fn(), insert: vi.fn(), execute: vi.fn() } as unknown as Tx;
    await expect(
      assertCommercialPriceInput(tx, clinicId, {
        doctorId,
        procedureId,
        pricingPolicyMode: 'absorb_fees',
      }),
    ).resolves.toBeUndefined();
    expect(tx.select).not.toHaveBeenCalled();
  });
});
