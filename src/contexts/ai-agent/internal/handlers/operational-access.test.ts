import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DetachedHandler } from '@/lib/outbox/types';
/* eslint-disable-next-line boundaries/element-types -- type-only public Messaging event used by the registered AI handler. */
import type { InboundReceivedPayload } from '@/contexts/messaging';
import type { ModuleAccess } from '@/lib/entitlements/policy';

const mocks = vi.hoisted(() => ({
  register: vi.fn<(event: string, handler: DetachedHandler<InboundReceivedPayload>) => void>(),
  access: vi.fn<() => Promise<ModuleAccess>>(),
  tenant: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/outbox/registry', () => ({ registerDetachedHandler: mocks.register }));
vi.mock('@/lib/entitlements', () => ({ getOperationalModuleAccess: mocks.access }));
vi.mock('@/lib/db/tenant', () => ({ withTenant: mocks.tenant }));
vi.mock('@/lib/observability/metrics', () => ({ metrics: { emit: mocks.emit } }));
import './inbound-received';

const clinicId = '11111111-1111-4111-8111-111111111111';
const event = {
  clinicId,
  eventId: '22222222-2222-4222-8222-222222222222',
  attempt: 1,
  payload: {
    clinicId,
    inboundMessageId: '33333333-3333-4333-8333-333333333333',
    providerMessageId: 'synthetic-inbound',
    provider: 'meta',
    fromNumberHash: 'synthetic-hash',
    toPhoneId: 'synthetic-phone-id',
    hasText: true,
    receivedAt: '2026-11-11T12:00:00Z',
  },
} satisfies Parameters<DetachedHandler<InboundReceivedPayload>>[0];
const handler = mocks.register.mock.calls.find(
  ([name]) => name === 'messaging.inbound.received',
)?.[1];
if (!handler) throw new Error('Inbound handler was not registered');
beforeEach(() => {
  mocks.access.mockReset();
  mocks.tenant.mockClear();
  mocks.emit.mockClear();
});
describe('inbound worker commercial boundary', () => {
  it.each([
    'payment_required',
    'subscription_inactive',
    'period_expired',
    'plan_not_included',
    'module_unavailable',
  ] as const)(
    'skips %s before conversation persistence, tools, LLM or WhatsApp',
    async (reason) => {
      mocks.access.mockResolvedValue({ allowed: false, reason });
      await handler(event);
      expect(mocks.access).toHaveBeenCalledWith(clinicId, 'ai_agents');
      expect(mocks.tenant).not.toHaveBeenCalled();
      expect(mocks.emit).toHaveBeenCalledWith(
        'ai_agent.turn.skipped',
        expect.objectContaining({ reason }),
      );
    },
  );
  it('fails before any patient read or operation if the entitlement database is unavailable', async () => {
    mocks.access.mockRejectedValue(new Error('Synthetic entitlement failure'));
    await expect(handler(event)).rejects.toThrow('Synthetic entitlement failure');
    expect(mocks.tenant).not.toHaveBeenCalled();
  });
});
