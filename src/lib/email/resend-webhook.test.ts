import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { parseResendDeliveryEvent, verifyResendWebhook } from './resend-webhook';

const secret = 'whsec_plJ3nmyCDGBKInavdOK15jsl';
const raw = '{"event_type":"ping","data":{"success":true}}';
const id = 'msg_loFOjxBNrRLzqYUf';
const timestamp = '1731705121';
const now = Number(timestamp) * 1000;
const signature = 'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=';
const headers = () =>
  new Headers({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': signature });

describe('Resend/Svix authenticity', () => {
  it('matches the independent vector published by Svix', () => {
    expect(verifyResendWebhook({ raw, secret, headers: headers(), now })).toBe(true);
  });
  it.each(['body', 'id', 'timestamp', 'secret', 'signature'])('rejects a modified %s', (field) => {
    const h = headers();
    if (field === 'id') h.set('svix-id', 'msg_other');
    if (field === 'timestamp') h.set('svix-timestamp', String(Number(timestamp) + 1));
    if (field === 'signature') h.set('svix-signature', 'v1,' + 'A'.repeat(43) + '=');
    expect(
      verifyResendWebhook({
        raw: field === 'body' ? raw + ' ' : raw,
        secret: field === 'secret' ? secret + 'a' : secret,
        headers: h,
        now,
      }),
    ).toBe(false);
  });
  it.each([-301, 301])('rejects signatures outside the clock window (%s seconds)', (offset) => {
    expect(verifyResendWebhook({ raw, secret, headers: headers(), now: now + offset * 1000 })).toBe(
      false,
    );
  });
  it('accepts a valid rotated key signature among multiple versions', () => {
    const h = headers();
    h.set('svix-signature', `v2,unknown v1,${'A'.repeat(43)}= ${signature}`);
    expect(verifyResendWebhook({ raw, secret, headers: h, now })).toBe(true);
  });
  it.each(['svix-id', 'svix-timestamp', 'svix-signature'])('rejects missing %s', (name) => {
    const h = headers();
    h.delete(name);
    expect(verifyResendWebhook({ raw, secret, headers: h, now })).toBe(false);
  });
  it('binds raw UTF-8 content without JSON reserialization', () => {
    const value = '{ "message": "confirmação" }';
    const signed = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`${id}.${timestamp}.${value}`)
      .digest('base64');
    const h = headers();
    h.set('svix-signature', `v1,${signed}`);
    expect(verifyResendWebhook({ raw: value, secret, headers: h, now })).toBe(true);
    expect(
      verifyResendWebhook({ raw: JSON.stringify(JSON.parse(value)), secret, headers: h, now }),
    ).toBe(false);
  });
});

describe('sanitized delivery event', () => {
  const event = {
    type: 'email.bounced',
    created_at: '2026-11-03T23:00:00.000Z',
    data: {
      email_id: '11111111-1111-4111-8111-111111111111',
      to: ['sensitive@example.test'],
      subject: 'private',
      bounce: { type: 'Permanent', message: 'private provider detail' },
    },
  };
  it('keeps only provider ID, machine state, timestamp and bounce class', () => {
    expect(parseResendDeliveryEvent(event)).toEqual({
      messageId: event.data.email_id,
      state: 'bounced',
      occurredAt: new Date(event.created_at),
      bounceType: 'Permanent',
    });
    expect(JSON.stringify(parseResendDeliveryEvent(event))).not.toContain('private');
    expect(JSON.stringify(parseResendDeliveryEvent(event))).not.toContain('sensitive');
  });
  it.each([
    null,
    {},
    { ...event, type: 'email.opened' },
    { ...event, created_at: 'invalid' },
    { ...event, data: { email_id: 'invalid' } },
  ])('rejects unsupported or malformed payload', (value) => {
    expect(parseResendDeliveryEvent(value)).toBeNull();
  });
});
