import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

const MAX_CLOCK_SKEW_SECONDS = 300;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
export const EMAIL_DELIVERY_STATES = [
  'sent',
  'delivered',
  'delivery_delayed',
  'bounced',
  'complained',
  'failed',
  'suppressed',
] as const;
export type EmailDeliveryState = (typeof EMAIL_DELIVERY_STATES)[number];

/** Manual Svix protocol, checked against the published independent test vector. */
export function verifyResendWebhook(input: {
  raw: string;
  headers: Headers;
  secret: string;
  now?: number;
}): boolean {
  const id = input.headers.get('svix-id');
  const timestamp = input.headers.get('svix-timestamp');
  const signatures = input.headers.get('svix-signature');
  if (
    !id ||
    !/^[A-Za-z0-9_-]{1,255}$/u.test(id) ||
    !timestamp ||
    !/^\d{1,12}$/u.test(timestamp) ||
    !signatures ||
    signatures.length > 4096 ||
    !input.secret.startsWith('whsec_')
  )
    return false;
  const now = input.now ?? Date.now();
  if (
    !Number.isFinite(now) ||
    Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS
  )
    return false;
  const encoded = input.secret.slice(6);
  if (!BASE64.test(encoded)) return false;
  const key = Buffer.from(encoded, 'base64');
  if (key.length < 16 || key.toString('base64').replace(/=+$/u, '') !== encoded.replace(/=+$/u, ''))
    return false;
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.${input.raw}`, 'utf8')
    .digest();
  return signatures.split(' ').some((part) => {
    const match = /^v1,([A-Za-z0-9+/]{43}=)$/u.exec(part);
    if (!match?.[1]) return false;
    const supplied = Buffer.from(match[1], 'base64');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

const eventSchema = z.object({
  type: z.string().max(100),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().uuid(),
    bounce: z.object({ type: z.enum(['Permanent', 'Transient', 'Undetermined']) }).optional(),
  }),
});

/** Strip recipient, subject, diagnostic text and body before persistence or logs. */
export function parseResendDeliveryEvent(value: unknown): {
  messageId: string;
  state: EmailDeliveryState;
  occurredAt: Date;
  bounceType: string | null;
} | null {
  const event = eventSchema.safeParse(value);
  if (!event.success) return null;
  const state = EMAIL_DELIVERY_STATES.find((candidate) => `email.${candidate}` === event.data.type);
  if (!state) return null;
  return {
    messageId: event.data.data.email_id,
    state,
    occurredAt: new Date(event.data.created_at),
    bounceType: event.data.data.bounce?.type ?? null,
  };
}
