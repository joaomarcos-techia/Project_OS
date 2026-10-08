/**
 * `messaging.outbound.status_updated` ganhou `errorCode` (EC-32) de forma ADITIVA:
 * o outbox guarda eventos publicados antes do campo, e o worker revalida cada
 * payload com este schema antes do handler — um campo obrigatório novo
 * derrubaria todos eles.
 */
import { describe, expect, it } from 'vitest';

import { MESSAGING_EVENTS, OutboundStatusUpdatedSchema } from './events';

const legacy = {
  clinicId: '11111111-1111-4111-8111-111111111111',
  outboundMessageId: '22222222-2222-4222-8222-222222222222',
  providerMessageId: 'wamid.HBgM',
  status: 'failed',
};

describe('OutboundStatusUpdatedSchema', () => {
  it('keeps the event name the outbox already stores', () => {
    expect(MESSAGING_EVENTS.OUTBOUND_STATUS_UPDATED).toBe('messaging.outbound.status_updated');
  });

  it('still accepts every payload published before errorCode existed', () => {
    for (const status of ['sent', 'delivered', 'read', 'failed']) {
      const parsed = OutboundStatusUpdatedSchema.parse({ ...legacy, status });
      expect(parsed).toEqual({ ...legacy, status });
      expect(parsed).not.toHaveProperty('errorCode');
    }
  });

  it('carries the Meta refusal code when present', () => {
    expect(OutboundStatusUpdatedSchema.parse({ ...legacy, errorCode: '131042' })).toEqual({
      ...legacy,
      errorCode: '131042',
    });
  });

  it('rejects a code that is not the digits the producer normalizes to', () => {
    for (const errorCode of [131042, '', 'meta_131042', '131042 ', '12345678901', null]) {
      expect(OutboundStatusUpdatedSchema.safeParse({ ...legacy, errorCode }).success).toBe(false);
    }
  });
});
