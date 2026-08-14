import { describe, expect, it } from 'vitest';

import { scrubEvent } from './sentry-scrub';

describe('scrubEvent', () => {
  it('redige token no caminho de convite e dados estruturados de checkout', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        url: 'https://app.example.test/join/secret-invite-token?token=also-secret',
        data: {
          _1_cardNumber: 'card-number-private',
          _1_cardCvv: '123',
          _1_cpfCnpj: '12345678901',
          _1_password: 'senha-nao-deve-vazar',
          event: 'checkout.failed',
        },
      },
    });

    expect(event.request?.url).toBe('https://app.example.test/join/[REDACTED]?token=[REDACTED]');
    expect(event.request?.data).toEqual({
      _1_cardNumber: '[REDACTED]',
      _1_cardCvv: '[REDACTED]',
      _1_cpfCnpj: '[REDACTED]',
      _1_password: '[REDACTED]',
      event: 'checkout.failed',
    });
  });

  it('remove por inteiro um body multipart bruto', () => {
    const event = scrubEvent({
      type: undefined,
      request: {
        data: 'cardNumber=card-number-private&cardCvv=123',
      },
    });

    expect(event.request?.data).toBe('[REDACTED_REQUEST_BODY]');
  });
});
