/**
 * `getWaitlistOfferState` — o fim da janela de resposta que a C14 confere no
 * envio (ADR-065). Só existe com a oferta aberta: `offered_at` sobrevive ao
 * `booked`, e uma oferta aceita não tem prazo a vencer. A janela corre só nas
 * horas de envio, no fuso da clínica (ADR-066), pela mesma regra do cron.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withTenant } = vi.hoisted(() => ({ withTenant: vi.fn() }));

vi.mock('@/lib/db/tenant', () => ({ withTenant }));

import { getWaitlistOfferState } from './queries';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';
const PATIENT = '33333333-3333-4333-8333-333333333333';
const SLOT = '44444444-4444-4444-8444-444444444444';
/** Sexta 09/10/2026, 8h em São Paulo. */
const OFFERED_AT = new Date('2026-10-09T11:00:00.000Z');

const execute = vi.fn();

function returnsRow(
  row: Record<string, unknown> | undefined,
  timezone: string | null = 'America/Sao_Paulo',
): void {
  const chain = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => (row ? [row] : [])),
  };
  execute.mockResolvedValue(timezone === null ? [] : [{ timezone }]);
  withTenant.mockImplementation((_clinicId: string, fn: (tx: unknown) => unknown) =>
    fn({ select: vi.fn(() => chain), execute }),
  );
}

function offered(offeredAt: Date): Record<string, unknown> {
  return { status: 'offered', patientId: PATIENT, offeredAppointmentId: SLOT, offeredAt };
}

beforeEach(() => {
  withTenant.mockReset();
  execute.mockReset();
});

describe('janela de resposta da oferta', () => {
  it('oferta aberta devolve o fim da janela, sem expor offered_at', async () => {
    returnsRow(offered(OFFERED_AT));

    await expect(getWaitlistOfferState(CLINIC, ENTRY)).resolves.toEqual({
      status: 'offered',
      patientId: PATIENT,
      offeredAppointmentId: SLOT,
      // 8h + 240 min = 12h locais.
      offerExpiresAt: new Date('2026-10-09T15:00:00.000Z'),
    });
    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
    // O fuso vem da própria clínica, dentro da mesma transação.
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('oferta das 21h: a janela abre às 8h e fecha às 12h do dia seguinte', async () => {
    returnsRow(offered(new Date('2026-10-09T21:00:00-03:00')));

    const state = await getWaitlistOfferState(CLINIC, ENTRY);

    // É o que a C14 confere às 8h: a oferta segue aberta, e o convite sai com a
    // janela inteira.
    expect(state?.offerExpiresAt).toEqual(new Date('2026-10-10T12:00:00-03:00'));
  });

  it('as horas de envio são as do fuso da clínica', async () => {
    returnsRow(offered(new Date('2026-10-09T21:00:00-04:00')), 'America/Manaus');

    const state = await getWaitlistOfferState(CLINIC, ENTRY);

    expect(state?.offerExpiresAt).toEqual(new Date('2026-10-10T12:00:00-04:00'));
  });

  it('sem fuso gravado, usa o de São Paulo', async () => {
    returnsRow(offered(new Date('2026-10-09T21:00:00-03:00')), null);

    const state = await getWaitlistOfferState(CLINIC, ENTRY);

    expect(state?.offerExpiresAt).toEqual(new Date('2026-10-10T12:00:00-03:00'));
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
    // Sem janela, nem o fuso é lido.
    expect(execute).not.toHaveBeenCalled();
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
