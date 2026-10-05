import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getEffectivePaymentPricingMode: vi.fn(),
  matchesConfiguredProcedurePriceSnapshot: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/contexts/payments', () => ({
  getEffectivePaymentPricingMode: mocks.getEffectivePaymentPricingMode,
  matchesConfiguredProcedurePriceSnapshot: mocks.matchesConfiguredProcedurePriceSnapshot,
}));

import type { Tx } from '@/lib/db';
import { assertCommercialPriceInput, insertScheduledAppointment } from './appointment-core';

const CLINIC_ID = 'clinic-test';
const PROCEDURE_ID = '22222222-2222-4222-8222-222222222222';
const PRICE_ID = '33333333-3333-4333-8333-333333333333';
const tx = { select: vi.fn(), insert: vi.fn(), execute: vi.fn() } as unknown as Tx;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getEffectivePaymentPricingMode.mockResolvedValue('absorb_fees');
  mocks.matchesConfiguredProcedurePriceSnapshot.mockResolvedValue(false);
});

describe('preço por método no core de agendamento', () => {
  it('nega chamada direta no Solo antes de tocar procedimentos ou gravar agenda', async () => {
    await expect(
      insertScheduledAppointment(tx, {
        clinicId: CLINIC_ID,
        userId: 'user-test',
        actorType: 'user',
        correlationId: null,
        idempotencyKey: 'idem-test',
        scheduledAt: new Date('2026-10-03T10:00:00Z'),
        data: {
          doctorId: '11111111-1111-4111-8111-111111111111',
          procedureId: PROCEDURE_ID,
          scheduledAt: '2026-10-03T10:00:00Z',
          pricingPolicyMode: 'payment_method_pricing',
          commercialPaymentMethod: 'pix',
          commercialPriceId: PRICE_ID,
        },
      }),
    ).rejects.toThrow('não está ativo');
    expect(mocks.getEffectivePaymentPricingMode).toHaveBeenCalledWith(tx, CLINIC_ID);
    expect(tx.select).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.execute).not.toHaveBeenCalled();
  });

  it('recusa valor ou versão adulterados antes da gravação', async () => {
    mocks.getEffectivePaymentPricingMode.mockResolvedValue('payment_method_pricing');
    await expect(
      assertCommercialPriceInput(tx, CLINIC_ID, {
        doctorId: '11111111-1111-4111-8111-111111111111',
        procedureId: PROCEDURE_ID,
        pricingPolicyMode: 'payment_method_pricing',
        commercialPaymentMethod: 'pix',
        commercialPriceId: PRICE_ID,
        valorAjustado: true,
        valor: 240,
      }),
    ).rejects.toThrow('Selecione-o novamente');
    expect(mocks.matchesConfiguredProcedurePriceSnapshot).toHaveBeenCalledWith(tx, {
      clinicId: CLINIC_ID,
      procedureId: PROCEDURE_ID,
      priceId: PRICE_ID,
      paymentMethod: 'pix',
      installmentCount: null,
      grossAmount: 240,
    });
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('aceita somente a versão e o valor confirmados na transação', async () => {
    mocks.getEffectivePaymentPricingMode.mockResolvedValue('payment_method_pricing');
    mocks.matchesConfiguredProcedurePriceSnapshot.mockResolvedValue(true);
    await expect(
      assertCommercialPriceInput(tx, CLINIC_ID, {
        doctorId: '11111111-1111-4111-8111-111111111111',
        procedureId: PROCEDURE_ID,
        pricingPolicyMode: 'payment_method_pricing',
        commercialPaymentMethod: 'credit_card',
        commercialInstallmentCount: 1,
        commercialPriceId: PRICE_ID,
        valorAjustado: true,
        valor: 260,
      }),
    ).resolves.toBeUndefined();
  });

  it('bloqueia cartão parcelado antes de consultar versão ou gravar atendimento', async () => {
    mocks.getEffectivePaymentPricingMode.mockResolvedValue('payment_method_pricing');
    await expect(
      assertCommercialPriceInput(tx, CLINIC_ID, {
        doctorId: '11111111-1111-4111-8111-111111111111',
        procedureId: PROCEDURE_ID,
        pricingPolicyMode: 'payment_method_pricing',
        commercialPaymentMethod: 'credit_card',
        commercialInstallmentCount: 3,
        commercialPriceId: PRICE_ID,
        valorAjustado: true,
        valor: 260,
      }),
    ).rejects.toThrow('Link de cartão parcelado ainda não está disponível');
    expect(mocks.matchesConfiguredProcedurePriceSnapshot).not.toHaveBeenCalled();
    expect(tx.insert).not.toHaveBeenCalled();
  });

  it('recusa campos comerciais no modo padrão', async () => {
    await expect(
      assertCommercialPriceInput(tx, CLINIC_ID, {
        doctorId: '11111111-1111-4111-8111-111111111111',
        procedureId: PROCEDURE_ID,
        pricingPolicyMode: 'absorb_fees',
        commercialPaymentMethod: 'pix',
      }),
    ).rejects.toThrow('Condição comercial inválida');
    expect(mocks.getEffectivePaymentPricingMode).toHaveBeenCalledWith(tx, CLINIC_ID);
  });

  it('recusa preço incompleto ou com fração de centavo', async () => {
    mocks.getEffectivePaymentPricingMode.mockResolvedValue('payment_method_pricing');
    await expect(
      assertCommercialPriceInput(tx, CLINIC_ID, {
        doctorId: '11111111-1111-4111-8111-111111111111',
        procedureId: PROCEDURE_ID,
        pricingPolicyMode: 'payment_method_pricing',
        commercialPaymentMethod: 'pix',
        commercialPriceId: PRICE_ID,
        valorAjustado: true,
        valor: 240.001,
      }),
    ).rejects.toThrow('Condição comercial incompleta');
    expect(mocks.matchesConfiguredProcedurePriceSnapshot).not.toHaveBeenCalled();
  });

  it.each([undefined, 'absorb_fees' as const])(
    'bloqueia criação sem cotação sob política explícita (%s), antes de gravar',
    async (pricingPolicyMode) => {
      mocks.getEffectivePaymentPricingMode.mockResolvedValue('payment_method_pricing');
      await expect(
        insertScheduledAppointment(tx, {
          clinicId: CLINIC_ID,
          userId: 'user-test',
          actorType: 'user',
          correlationId: null,
          idempotencyKey: 'idem-test',
          scheduledAt: new Date('2026-10-03T10:00:00Z'),
          data: {
            doctorId: '11111111-1111-4111-8111-111111111111',
            procedureId: PROCEDURE_ID,
            scheduledAt: '2026-10-03T10:00:00Z',
            pricingPolicyMode,
          },
        }),
      ).rejects.toThrow('Escolha uma forma de pagamento na Agenda');
      expect(tx.select).not.toHaveBeenCalled();
      expect(tx.insert).not.toHaveBeenCalled();
      expect(tx.execute).not.toHaveBeenCalled();
    },
  );
});
