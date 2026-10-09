/**
 * WAIT-001 / ADR-066 — a passada do cron não repassa a oferta feita de noite
 * antes de o convite poder sair.
 *
 * `findStaleWaitlistOffers` é o real, porque a regra mora nele. O banco devolve
 * as ofertas que o pré-filtro do SQL deixaria passar, e o repasse é falso: o que
 * se prova é QUAIS ofertas a passada devolve à fila, e quando.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as WaitlistStore from './internal/waitlist-store';

const { scanned, releaseWaitlistOffer, withTenant } = vi.hoisted(() => ({
  scanned: { rows: [] as unknown[] },
  releaseWaitlistOffer: vi.fn(),
  withTenant: vi.fn(),
}));

vi.mock('@/lib/db', () => {
  const chain: Record<string, unknown> = {};
  for (const key of ['select', 'from', 'where', 'orderBy', 'limit']) chain[key] = () => chain;
  chain.offset = async () => scanned.rows;
  return { dbAdmin: { transaction: (fn: (tx: unknown) => unknown) => fn(chain) } };
});
vi.mock('@/lib/db/tenant', () => ({ withTenant }));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: vi.fn() }));
vi.mock('./internal/waitlist-store', async (importOriginal) => ({
  ...(await importOriginal<typeof WaitlistStore>()),
  releaseWaitlistOffer,
}));

import { expireStaleWaitlistOffers } from './waitlist-expiry';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const ENTRY = '22222222-2222-4222-8222-222222222222';

function offeredAt(iso: string): void {
  scanned.rows = [
    {
      id: ENTRY,
      clinicId: CLINIC,
      offeredAt: new Date(iso),
      offeredAppointmentId: 'appt-1',
      timeZone: 'America/Sao_Paulo',
    },
  ];
}

async function passAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  return expireStaleWaitlistOffers({ limit: 200 });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  releaseWaitlistOffer.mockReset();
  releaseWaitlistOffer.mockResolvedValue({ released: true, nextEntryId: 'proximo' });
  withTenant.mockReset();
  withTenant.mockImplementation((_clinicId: string, fn: (tx: unknown) => unknown) => fn({}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('expireStaleWaitlistOffers — a janela só corre nas horas de envio', () => {
  it('cancelamento às 21h: a passada das 8h não repassa a vaga, e o convite sai', async () => {
    offeredAt('2026-10-09T21:00:00-03:00');

    const summary = await passAt('2026-10-10T08:00:00-03:00');

    expect(summary).toEqual({ expiredScanned: 0, expiredReleased: 0, expiredReoffered: 0 });
    expect(releaseWaitlistOffer).not.toHaveBeenCalled();
  });

  it('cancelamento às 21h: a oferta volta à fila às 12h, depois das 4 h de convite', async () => {
    offeredAt('2026-10-09T21:00:00-03:00');

    await expect(passAt('2026-10-10T11:45:00-03:00')).resolves.toMatchObject({
      expiredReleased: 0,
    });
    const summary = await passAt('2026-10-10T12:00:00-03:00');

    expect(summary).toEqual({ expiredScanned: 1, expiredReleased: 1, expiredReoffered: 1 });
    expect(withTenant).toHaveBeenCalledWith(CLINIC, expect.any(Function));
    expect(releaseWaitlistOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        clinicId: CLINIC,
        entryId: ENTRY,
        expectedOffer: {
          offeredAt: new Date('2026-10-09T21:00:00-03:00'),
          appointmentId: 'appt-1',
        },
      }),
    );
  });

  it('duas gerações da mesma entrada usam chaves diferentes; replay conserva a chave', async () => {
    offeredAt('2026-10-09T10:00:00-03:00');
    await passAt('2026-10-09T14:00:00-03:00');
    await passAt('2026-10-09T14:15:00-03:00');
    offeredAt('2026-10-09T15:00:00-03:00');
    await passAt('2026-10-09T19:00:00-03:00');
    const keys = releaseWaitlistOffer.mock.calls.map((call) => call[1].idempotencyKey);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it('oferta diurna: volta à fila 240 min depois, como antes', async () => {
    offeredAt('2026-10-09T10:00:00-03:00');

    await expect(passAt('2026-10-09T13:45:00-03:00')).resolves.toMatchObject({
      expiredReleased: 0,
    });
    await expect(passAt('2026-10-09T14:00:00-03:00')).resolves.toMatchObject({
      expiredReleased: 1,
    });
  });

  it('oferta das 17h: não é repassada na primeira passada do dia seguinte', async () => {
    // Convidada às 17h, ela tem 3 h hoje e a hora que falta das 8h às 9h, para
    // a clínica responder ao que chegou de noite.
    offeredAt('2026-10-09T17:00:00-03:00');

    await expect(passAt('2026-10-10T08:00:00-03:00')).resolves.toMatchObject({
      expiredReleased: 0,
    });
    await expect(passAt('2026-10-10T09:00:00-03:00')).resolves.toMatchObject({
      expiredReleased: 1,
    });
  });
});
