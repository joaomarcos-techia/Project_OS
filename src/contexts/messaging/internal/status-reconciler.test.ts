/**
 * EC-32 — o callback `failed` da Meta precisa levar o CÓDIGO da recusa até o
 * evento `messaging.outbound.status_updated`, que é o que a C14 consome. Aqui se
 * prova o produtor: o código viaja só em `failed`, o payload continua válido no
 * schema do catálogo e o caminho de reconciliação (callback antes do finalize do
 * sender) leva o mesmo código.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Tx } from '@/lib/db';

type PublishArgs = {
  clinicId: string;
  eventType: string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};
const mocks = vi.hoisted(() => ({
  publishEvent: vi.fn<(tx: unknown, args: PublishArgs) => Promise<void>>(async () => {}),
}));
vi.mock('@/lib/outbox/publish', () => ({ publishEvent: mocks.publishEvent }));

import { OutboundStatusUpdatedSchema } from '../events';
import { providerStatusEventsRaw } from '../schema';
import { applyProviderDeliveryStatus, reconcileStoredProviderStatuses } from './status-reconciler';

const CLINIC = '11111111-1111-4111-8111-111111111111';
const OUTBOUND = '22222222-2222-4222-8222-222222222222';
const WAMID = 'wamid.HBgM';

const metaRefusal = {
  id: WAMID,
  status: 'failed',
  errors: [{ code: 131042, title: 'Business eligibility payment issue' }],
};

function query(rows: unknown[]) {
  const q = Object.assign(Promise.resolve(rows), {
    where: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
    orderBy: vi.fn(),
  });
  q.where.mockReturnValue(q);
  q.limit.mockReturnValue(q);
  q.for.mockReturnValue(q);
  q.orderBy.mockReturnValue(q);
  return q;
}

/** Envio em `outbound_messages` + callbacks guardados; o status avança como no banco. */
function fakeTx(initial: string, stored: Array<{ id: string; status: string; raw: unknown }> = []) {
  let status = initial;
  const tx = {
    select: vi.fn(() => ({
      from: vi.fn((table: unknown) =>
        table === providerStatusEventsRaw ? query(stored) : query([{ id: OUTBOUND, status }]),
      ),
    })),
    update: vi.fn(() => ({
      set: vi.fn((patch: { status: string }) => ({
        where: vi.fn(async () => {
          status = patch.status;
        }),
      })),
    })),
  };
  return tx as unknown as Tx;
}

const published = () => mocks.publishEvent.mock.calls.map(([, args]) => args.payload);

beforeEach(() => {
  mocks.publishEvent.mockClear();
});

describe('applyProviderDeliveryStatus', () => {
  it('publishes the refusal code with a failed status, in a payload the catalog accepts', async () => {
    await applyProviderDeliveryStatus(fakeTx('accepted'), {
      clinicId: CLINIC,
      providerMessageId: WAMID,
      status: 'failed',
      sourceId: 'raw-1',
      errorCode: '131042',
    });

    const [, args] = mocks.publishEvent.mock.calls[0]!;
    expect(args).toMatchObject({
      clinicId: CLINIC,
      eventType: 'messaging.outbound.status_updated',
      idempotencyKey: 'provider-status:raw-1',
    });
    const payload = published()[0]!;
    expect(payload).toEqual({
      clinicId: CLINIC,
      outboundMessageId: OUTBOUND,
      providerMessageId: WAMID,
      status: 'failed',
      errorCode: '131042',
    });
    expect(OutboundStatusUpdatedSchema.parse(payload)).toEqual(payload);
  });

  it('keeps the old payload shape when the failure has no code', async () => {
    const base = {
      clinicId: CLINIC,
      providerMessageId: WAMID,
      status: 'failed',
      sourceId: 'raw-1',
    } as const;

    await applyProviderDeliveryStatus(fakeTx('sent'), { ...base, errorCode: null });
    await applyProviderDeliveryStatus(fakeTx('sent'), base);

    expect(published()).toHaveLength(2);
    for (const payload of published()) expect(payload).not.toHaveProperty('errorCode');
  });

  it('never attaches a code to a status that is not a failure', async () => {
    await applyProviderDeliveryStatus(fakeTx('accepted'), {
      clinicId: CLINIC,
      providerMessageId: WAMID,
      status: 'sent',
      sourceId: 'raw-1',
      errorCode: '131042',
    });

    expect(published()[0]).toMatchObject({ status: 'sent' });
    expect(published()[0]).not.toHaveProperty('errorCode');
  });

  it('publishes nothing when a failure arrives after a confirmed delivery', async () => {
    await applyProviderDeliveryStatus(fakeTx('delivered'), {
      clinicId: CLINIC,
      providerMessageId: WAMID,
      status: 'failed',
      sourceId: 'raw-1',
      errorCode: '131042',
    });

    expect(mocks.publishEvent).not.toHaveBeenCalled();
  });
});

describe('reconcileStoredProviderStatuses', () => {
  it('carries the stored callback code when it reconciles after the sender finalized', async () => {
    await reconcileStoredProviderStatuses(
      fakeTx('accepted', [
        { id: 'raw-sent', status: 'sent', raw: { id: WAMID, status: 'sent' } },
        { id: 'raw-failed', status: 'failed', raw: metaRefusal },
      ]),
      CLINIC,
      WAMID,
    );

    expect(published()).toEqual([
      { clinicId: CLINIC, outboundMessageId: OUTBOUND, providerMessageId: WAMID, status: 'sent' },
      {
        clinicId: CLINIC,
        outboundMessageId: OUTBOUND,
        providerMessageId: WAMID,
        status: 'failed',
        errorCode: '131042',
      },
    ]);
    expect(mocks.publishEvent.mock.calls.map(([, args]) => args.idempotencyKey)).toEqual([
      'provider-status:raw-sent',
      'provider-status:raw-failed',
    ]);
  });
});
