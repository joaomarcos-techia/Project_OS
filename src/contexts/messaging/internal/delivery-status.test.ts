import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { advanceDeliveryStatus, normalizeProviderDeliveryStatus } from './delivery-status';

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

  it('consumes callbacks and reconciles callbacks that arrived before sender finalization', () => {
    expect(inboundSource).toContain('applyProviderDeliveryStatus');
    expect(senderSource).toContain('reconcileStoredProviderStatuses');
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'delivered'");
    expect(migration).toContain('status_updated_at');
  });
});
