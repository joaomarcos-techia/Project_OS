/**
 * EC-32 — o webhook guarda o callback cru e o aplica ao envio na mesma TX. O
 * código da recusa sai do `raw` da Meta (`errors[0].code`) e segue para
 * `applyProviderDeliveryStatus`, que o publica no evento consumido pela C14.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ParsedStatusEvent } from '@/lib/messaging';

const mocks = vi.hoisted(() => ({
  applyProviderDeliveryStatus: vi.fn<
    (tx: unknown, input: Record<string, unknown>) => Promise<boolean>
  >(async () => true),
  inserted: [] as Array<Record<string, unknown>>,
}));

vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: vi.fn() } }));
vi.mock('@/lib/crypto', () => ({
  encryptForTenant: vi.fn(),
  hashForLookup: vi.fn(async () => 'recipient-hash'),
  normalizePhone: (phone: string) => phone,
}));
vi.mock('@/lib/db/tenant', () => ({
  withTenant: async (_clinicId: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn({
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          mocks.inserted.push(row);
          return {
            onConflictDoNothing: () => ({
              returning: async () => [{ id: `raw-${mocks.inserted.length}` }],
            }),
          };
        },
      }),
    }),
}));
vi.mock('./status-reconciler', () => ({
  applyProviderDeliveryStatus: mocks.applyProviderDeliveryStatus,
}));

import { persistStatusEvents } from './inbound';

const CLINIC = '11111111-1111-4111-8111-111111111111';

const status = (over: Partial<ParsedStatusEvent>): ParsedStatusEvent => ({
  providerMessageId: 'wamid.HBgM',
  status: 'sent',
  recipientNumber: '5500000000000',
  toPhoneId: 'phone-id',
  raw: { id: 'wamid.HBgM', status: 'sent' },
  ...over,
});

beforeEach(() => {
  mocks.applyProviderDeliveryStatus.mockClear();
  mocks.inserted.length = 0;
});

describe('persistStatusEvents', () => {
  it('passes the Meta refusal code of a failed callback to the reconciler', async () => {
    await persistStatusEvents(CLINIC, 'meta', [
      status({
        status: 'failed',
        raw: {
          id: 'wamid.HBgM',
          status: 'failed',
          errors: [{ code: 131042, title: 'Business eligibility payment issue' }],
        },
      }),
    ]);

    expect(mocks.applyProviderDeliveryStatus).toHaveBeenCalledWith(expect.anything(), {
      clinicId: CLINIC,
      providerMessageId: 'wamid.HBgM',
      status: 'failed',
      sourceId: 'raw-1',
      errorCode: '131042',
    });
    // O cru continua guardado inteiro: é a evidência do que a Meta disse.
    expect(mocks.inserted[0]).toMatchObject({ statusText: 'failed' });
    expect(JSON.stringify(mocks.inserted[0]!.raw)).toContain('131042');
  });

  it('passes no code for callbacks without errors', async () => {
    await persistStatusEvents(CLINIC, 'meta', [
      status({}),
      status({ status: 'delivered', raw: { id: 'wamid.HBgM', status: 'delivered' } }),
    ]);

    expect(
      mocks.applyProviderDeliveryStatus.mock.calls.map(([, input]) => input.errorCode),
    ).toEqual([null, null]);
  });
});
