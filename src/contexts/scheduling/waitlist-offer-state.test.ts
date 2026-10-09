/**
 * `getWaitlistOfferState` — o fim da janela de resposta que a C14 confere no
 * envio (ADR-065). Só existe com a oferta aberta: `offered_at` sobrevive ao
 * `booked`, e uma oferta aceita não tem prazo a vencer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { getWaitlistOfferState } from './queries';
import { WAITLIST_OFFER_TTL_MINUTES, waitlistOfferExpiresAt } from './waitlist-policy';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const PATIENT = '33333333-3333-4333-8333-333333333333';
const SLOT = '44444444-4444-4444-8444-444444444444';
const OFFERED_AT = new Date('2026-10-09T11:00:00.000Z');

function returnsRow(row: Record<string, unknown> | undefined): void {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => (row ? [row] : [])),
  };
  withTenant.mockImplementation((_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({ select: vi.fn(() => chain) }),
  );
}

beforeEach(() => {
  withTenant.mockReset();
});

describe('janela de resposta da oferta', () => {
  it('dura WAITLIST_OFFER_TTL_MINUTES a partir de offered_at', () => {
    expect(WAITLIST_OFFER_TTL_MINUTES).toBe(240);
    expect(waitlistOfferExpiresAt(OFFERED_AT)).toEqual(new Date('2026-10-09T15:00:00.000Z'));
  });

  it('oferta aberta devolve o fim da janela, sem expor offered_at', async () => {
    returnsRow({
      status: 'offered',
      patientId: PATIENT,
      offeredAppointmentId: SLOT,
      offeredAt: OFFERED_AT,
    });

    await expect(getWaitlistOfferState(CLINIC, ENTRY)).resolves.toEqual({
      status: 'offered',
      patientId: PATIENT,
      offeredAppointmentId: SLOT,
      offerExpiresAt: new Date('2026-10-09T15:00:00.000Z'),
    });
    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
  });

  it('oferta aceita mantém offered_at, mas não tem janela', async () => {
    returnsRow({
      status: 'booked',
      patientId: PATIENT,
      offeredAppointmentId: SLOT,
      offeredAt: OFFERED_AT,
    });

    const state = await getWaitlistOfferState(CLINIC, ENTRY);

    expect(state?.offerExpiresAt).toBeNull();
  });

  it('oferta devolvida à fila não tem janela', async () => {
    returnsRow({
      status: 'waiting',
      patientId: PATIENT,
      offeredAppointmentId: null,
      offeredAt: null,
    });

    const state = await getWaitlistOfferState(CLINIC, ENTRY);

    expect(state?.offerExpiresAt).toBeNull();
  });

  it('entrada inexistente devolve null', async () => {
    returnsRow(undefined);

    await expect(getWaitlistOfferState(CLINIC, ENTRY)).resolves.toBeNull();
  });
});
