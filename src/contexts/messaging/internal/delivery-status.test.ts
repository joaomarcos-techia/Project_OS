import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OutboundStatusUpdatedSchema } from '../events';
import {
  advanceDeliveryStatus,
  normalizeProviderDeliveryStatus,
  providerFailureCode,
} from './delivery-status';

const inboundSource = readFileSync(new URL('./inbound.ts', import.meta.url), 'utf8');
const senderSource = readFileSync(new URL('./sender.ts', import.meta.url), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/migrations/0064_outbound_delivery_status.sql'),
  'utf8',
);

describe('outbound delivery status', () => {
  it('maps Meta callbacks to explicit delivery states', () => {
    expect(normalizeProviderDeliveryStatus('sent')).toBe('sent');
    expect(normalizeProviderDeliveryStatus('delivered')).toBe('delivered');
    expect(normalizeProviderDeliveryStatus('read')).toBe('read');
    expect(normalizeProviderDeliveryStatus('failed')).toBe('failed');
    expect(normalizeProviderDeliveryStatus('unsupported')).toBeNull();
  });

  it('does not regress when callbacks arrive out of order', () => {
    expect(advanceDeliveryStatus('delivered', 'sent')).toBe('delivered');
    expect(advanceDeliveryStatus('read', 'delivered')).toBe('read');
    expect(advanceDeliveryStatus('accepted', 'delivered')).toBe('delivered');
  });

  it('records failure before delivery but never rewrites a confirmed delivery', () => {
    expect(advanceDeliveryStatus('accepted', 'failed')).toBe('failed');
    expect(advanceDeliveryStatus('sent', 'failed')).toBe('failed');
    expect(advanceDeliveryStatus('delivered', 'failed')).toBe('delivered');
    expect(advanceDeliveryStatus('read', 'failed')).toBe('read');
  });

  it('reads the Meta refusal code from errors[0].code (EC-32, callback of 08/10)', () => {
    // Forma do callback `failed` do link do sinal, sem o destinatário.
    const raw = {
      id: 'wamid.HBgM',
      status: 'failed',
      timestamp: '1759921268',
      errors: [
        {
          code: 131042,
          title: 'Business eligibility payment issue',
          message: 'Business eligibility payment issue',
          error_data: { details: 'WhatsApp Business account currency is not configured' },
        },
      ],
    };
    expect(providerFailureCode(raw)).toBe('131042');
    expect(providerFailureCode({ errors: [{ code: ' 131026 ' }] })).toBe('131026');
  });

  it('returns null instead of throwing on a callback without a usable code', () => {
    for (const raw of [
      null,
      undefined,
      'failed',
      42,
      {},
      { status: 'sent' },
      { errors: 'boom' },
      { errors: [] },
      { errors: [null] },
      { errors: [{}] },
      { errors: [{ code: null }] },
      { errors: [{ code: -1 }] },
      { errors: [{ code: 1.5 }] },
      { errors: [{ code: Number.MAX_SAFE_INTEGER + 2 }] },
      { errors: [{ code: '131042; drop table' }] },
      { errors: [{ code: '12345678901' }] },
      { errors: [{ code: '' }] },
      { errors: [{ title: 'sem código' }, { code: 131042 }] },
    ]) {
      expect(providerFailureCode(raw)).toBeNull();
    }
  });

  it('only produces codes the status_updated event accepts (a bad one would 500 the webhook)', () => {
    const base = {
      clinicId: '11111111-1111-4111-8111-111111111111',
      outboundMessageId: '22222222-2222-4222-8222-222222222222',
      providerMessageId: 'wamid.HBgM',
      status: 'failed' as const,
    };
    for (const code of [0, 7, 131042, 2_147_483_647, '0042', '9999999999']) {
      const errorCode = providerFailureCode({ errors: [{ code }] });
      expect(errorCode).not.toBeNull();
      expect(OutboundStatusUpdatedSchema.safeParse({ ...base, errorCode }).success).toBe(true);
    }
  });

  it('consumes callbacks and reconciles callbacks that arrived before sender finalization', () => {
    expect(inboundSource).toContain('applyProviderDeliveryStatus');
    expect(senderSource).toContain('reconcileStoredProviderStatuses');
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'delivered'");
    expect(migration).toContain('status_updated_at');
  });
});
