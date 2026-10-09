import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { OutboundStatusUpdatedSchema } from '../events';
import {
  advanceDeliveryStatus,
  normalizeProviderDeliveryStatus,
  providerFailureCode,
  providerSendErrorCode,
  syncRefusalCode,
  type DeliveryStatus,
  type ProviderDeliveryStatus,
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

  it('a late `sent` never revives a refused send (ADR-064, panel of ADR-047)', () => {
    expect(advanceDeliveryStatus('failed', 'sent')).toBe('failed');
    expect(advanceDeliveryStatus('failed', 'failed')).toBe('failed');
  });

  it('any callback resolves an `unknown` (timeout) send', () => {
    for (const incoming of ['sent', 'delivered', 'read', 'failed'] as const) {
      expect(advanceDeliveryStatus('unknown', incoming)).toBe(incoming);
    }
  });

  it('the final status does not depend on the order the callbacks arrive in', () => {
    const callbacks: ProviderDeliveryStatus[] = ['sent', 'delivered', 'read', 'failed'];
    const starts: DeliveryStatus[] = ['pending', 'accepted', 'unknown', 'sent', 'failed'];
    for (const start of starts) {
      for (const a of callbacks) {
        for (const b of callbacks) {
          const ab = advanceDeliveryStatus(advanceDeliveryStatus(start, a), b);
          const ba = advanceDeliveryStatus(advanceDeliveryStatus(start, b), a);
          expect(ab, `${start} + ${a}/${b}`).toBe(ba);
        }
      }
    }
  });

  it('reads the code of a synchronous refusal from the Graph error body (error.code)', () => {
    // Forma do corpo HTTP de erro da Cloud API, sem o destinatário.
    const raw = {
      error: {
        message: '(#131026) Message undeliverable',
        type: 'OAuthException',
        code: 131026,
        error_data: { messaging_product: 'whatsapp', details: 'Message undeliverable' },
        fbtrace_id: 'AbC',
      },
    };
    expect(providerSendErrorCode(raw)).toBe('131026');
    expect(providerSendErrorCode({ error: { code: '130429' } })).toBe('130429');
    for (const other of [
      null,
      '<html>502 Bad Gateway</html>',
      {},
      { messages: [{ id: 'wamid.X' }] },
      { error: null },
      { error: { code: 'abc' } },
      { errors: [{ code: 131042 }] },
    ]) {
      expect(providerSendErrorCode(other)).toBeNull();
    }
  });

  it('the sender returns a code only for a failed send without wamid', () => {
    const body = { error: { code: 131000 } };
    expect(syncRefusalCode('failed', null, body)).toBe('131000');
    // Com wamid, a Meta aceitou e recusou depois: o código vem no callback.
    expect(syncRefusalCode('failed', 'wamid.X', body)).toBeNull();
    for (const status of ['accepted', 'unknown', 'pending', 'sent', 'delivered'] as const) {
      expect(syncRefusalCode(status, null, body)).toBeNull();
    }
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

  it('the sender reports the synchronous refusal code on fresh and deduplicated sends', () => {
    expect(senderSource.match(/errorCode: syncRefusalCode\(/g)).toHaveLength(2);
    expect(senderSource).toContain('providerResponse: outboundMessages.providerResponse');
  });

  it('consumes callbacks and reconciles callbacks that arrived before sender finalization', () => {
    expect(inboundSource).toContain('applyProviderDeliveryStatus');
    expect(senderSource).toContain('reconcileStoredProviderStatuses');
    expect(migration).toContain("ADD VALUE IF NOT EXISTS 'delivered'");
    expect(migration).toContain('status_updated_at');
  });
});
