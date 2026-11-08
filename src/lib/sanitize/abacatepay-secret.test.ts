import { describe, expect, it } from 'vitest';

import { redactStringValue } from './patterns';

describe('AbacatePay query authentication redaction', () => {
  it('removes the webhook secret from request URLs and nested diagnostics', () => {
    const secret = 'synthetic-webhook-secret-32-characters';
    const output = redactStringValue(
      `https://app.example.invalid/api/webhooks/abacatepay?webhookSecret=${secret}&other=ok`,
    );
    expect(output).not.toContain(secret);
    expect(output).toContain('webhookSecret=[REDACTED]&other=ok');
  });
  it('redacts repeated and case-varied webhook secret query parameters', () => {
    expect(redactStringValue('?WEBHOOKSECRET=first&webhookSecret=second')).toBe(
      '?WEBHOOKSECRET=[REDACTED]&webhookSecret=[REDACTED]',
    );
  });
});
